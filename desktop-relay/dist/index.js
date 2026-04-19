"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const dotenv_1 = require("dotenv");
const runner_js_1 = require("./runner.js");
(0, dotenv_1.config)();
const PORT = parseInt(process.env.RELAY_PORT ?? '7878', 10);
const SECRET = process.env.RELAY_SECRET ?? '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GEMMA_API_KEY ?? '';
if (!SECRET) {
    console.warn('[relay] RELAY_SECRET not set — accepting requests from any client on the network.');
}
if (!GEMINI_API_KEY) {
    console.error('[relay] GEMINI_API_KEY (or GEMMA_API_KEY) not set — OpenClaw will fail to call Gemma 4.');
    process.exit(1);
}
// ── SSE ───────────────────────────────────────────────────────────────────────
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
// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth(req) {
    if (!SECRET)
        return true;
    return req.headers['x-relay-secret'] === SECRET;
}
// ── Body parsing ──────────────────────────────────────────────────────────────
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
const sessions = new Map();
// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http_1.default.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-relay-secret');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    // ── GET /ping ───────────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now(), agent: 'openclaw/jarvis', model: 'google/gemma-4-27b-it' }));
        return;
    }
    // ── POST /task ──────────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/task') {
        if (!checkAuth(req)) {
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
        // SSE keep-alive
        const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
        const { child, sendConfirmation } = (0, runner_js_1.runOpenClawTask)(body, (event) => {
            sendEvent(res, event);
            if (event.type === 'result' || event.type === 'error') {
                clearInterval(keepAlive);
                sessions.delete(sessionId);
                res.end();
            }
        }, GEMINI_API_KEY);
        sessions.set(sessionId, { sendConfirmation });
        res.on('close', () => {
            clearInterval(keepAlive);
            sessions.delete(sessionId);
            if (!child.killed)
                child.kill();
        });
        return;
    }
    // ── POST /confirm ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/confirm') {
        if (!checkAuth(req)) {
            res.writeHead(401);
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
        if (session) {
            session.sendConfirmation(body.answer);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
        }
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🦞 Jarvis Desktop Relay (OpenClaw + Gemma 4)`);
    console.log(`   listening on port ${PORT}`);
    console.log(`   agent:  openclaw/jarvis`);
    console.log(`   model:  google/gemma-4-27b-it`);
    console.log(`\n   Tailscale IP: run \`tailscale ip -4\` and set RELAY_URL=http://<ip>:${PORT} in the app's .env\n`);
});
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[relay] Port ${PORT} in use. Set RELAY_PORT=<other> in .env`);
    }
    else {
        console.error('[relay] Server error:', err);
    }
    process.exit(1);
});
