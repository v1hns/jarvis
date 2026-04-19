"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRelayHandler = createRelayHandler;
exports.createRelayServer = createRelayServer;
exports.startRelayServer = startRelayServer;
exports.loadRelayOptionsFromEnv = loadRelayOptionsFromEnv;
const http_1 = __importDefault(require("http"));
const dotenv_1 = require("dotenv");
const runner_js_1 = require("./runner.js");
function sseHeaders(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
}
function sendEvent(res, event) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(JSON.parse(raw));
            }
            catch {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
function checkAuth(req, secret) {
    if (!secret)
        return true;
    return req.headers['x-relay-secret'] === secret;
}
function createRelayHandler(options) {
    const { secret = '', geminiApiKey, runTask = runner_js_1.runOpenClawTask, keepAliveMs = 15_000, } = options;
    const sessions = new Map();
    return async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-relay-secret');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === 'GET' && req.url === '/ping') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                ts: Date.now(),
                agent: 'openclaw/jarvis',
                model: 'google/gemma-4-27b-it',
            }));
            return;
        }
        if (req.method === 'POST' && req.url === '/task') {
            if (!checkAuth(req, secret)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            let body;
            try {
                body = await readBody(req);
            }
            catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
                return;
            }
            if (!body.task || typeof body.task !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '`task` string required' }));
                return;
            }
            const sessionId = body.session_id ?? `jarvis-${Date.now()}`;
            body.session_id = sessionId;
            sseHeaders(res);
            sendEvent(res, { type: 'progress', payload: 'Dispatching to OpenClaw + Gemma 4…' });
            const keepAlive = setInterval(() => res.write(': keepalive\n\n'), keepAliveMs);
            const { child, sendConfirmation } = runTask(body, (event) => {
                sendEvent(res, event);
                if (event.type === 'result' || event.type === 'error') {
                    clearInterval(keepAlive);
                    sessions.delete(sessionId);
                    res.end();
                }
            }, geminiApiKey);
            sessions.set(sessionId, { sendConfirmation });
            res.on('close', () => {
                clearInterval(keepAlive);
                sessions.delete(sessionId);
                if (!child.killed)
                    child.kill();
            });
            return;
        }
        if (req.method === 'POST' && req.url === '/confirm') {
            if (!checkAuth(req, secret)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end();
                return;
            }
            let body;
            try {
                body = await readBody(req);
            }
            catch {
                res.writeHead(400);
                res.end();
                return;
            }
            const session = sessions.get(body.session_id);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Session not found' }));
                return;
            }
            session.sendConfirmation(body.answer);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    };
}
function createRelayServer(options) {
    return http_1.default.createServer(createRelayHandler(options));
}
function startRelayServer(options) {
    const { port, host = '0.0.0.0', secret = '', geminiApiKey, logger = console, } = options;
    if (!secret) {
        logger.warn('[relay] RELAY_SECRET not set — accepting requests from any client on the network.');
    }
    if (!geminiApiKey) {
        throw new Error('[relay] GEMINI_API_KEY (or GEMMA_API_KEY) not set — OpenClaw will fail to call Gemma 4.');
    }
    const server = createRelayServer(options);
    server.listen(port, host, () => {
        logger.log(`\n🦞 Jarvis Desktop Relay (OpenClaw + Gemma 4)`);
        logger.log(`   listening on port ${port}`);
        logger.log(`   agent:  openclaw/jarvis`);
        logger.log(`   model:  google/gemma-4-27b-it`);
        logger.log(`\n   Tailscale IP: run \`tailscale ip -4\` and set RELAY_URL=http://<ip>:${port} in the app's .env\n`);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`[relay] Port ${port} in use. Set RELAY_PORT=<other> in .env`);
        }
        else {
            logger.error('[relay] Server error:', err);
        }
        process.exit(1);
    });
    return server;
}
function loadRelayOptionsFromEnv(env = process.env) {
    return {
        port: parseInt(env.RELAY_PORT ?? '7878', 10),
        secret: env.RELAY_SECRET ?? '',
        geminiApiKey: env.GEMINI_API_KEY ?? env.GEMMA_API_KEY ?? '',
    };
}
if (require.main === module) {
    (0, dotenv_1.config)();
    try {
        startRelayServer(loadRelayOptionsFromEnv());
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
    }
}
