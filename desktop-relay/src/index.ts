import http from 'http';
import { config } from 'dotenv';
import { runOpenClawTask } from './runner.js';
import type { BridgeEvent, TaskPayload, ConfirmPayload } from './types.js';

export interface RelayServerOptions {
  port: number;
  secret?: string;
  geminiApiKey: string;
  host?: string;
  runTask?: typeof runOpenClawTask;
  logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;
  keepAliveMs?: number;
}

interface Session {
  sendConfirmation: (answer: 'CONFIRMED' | 'CANCELLED') => void;
}

function sseHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sendEvent(res: http.ServerResponse, event: BridgeEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function readBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw) as T); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req: http.IncomingMessage, secret: string): boolean {
  if (!secret) return true;
  return req.headers['x-relay-secret'] === secret;
}

export function createRelayHandler(options: RelayServerOptions): http.RequestListener {
  const {
    secret = '',
    geminiApiKey,
    runTask = runOpenClawTask,
    keepAliveMs = 15_000,
  } = options;
  const sessions = new Map<string, Session>();

  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-relay-secret');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

      let body: TaskPayload;
      try { body = await readBody<TaskPayload>(req); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
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
      const { child, sendConfirmation } = runTask(
        body,
        (event: BridgeEvent) => {
          sendEvent(res, event);
          if (event.type === 'result' || event.type === 'error') {
            clearInterval(keepAlive);
            sessions.delete(sessionId);
            res.end();
          }
        },
        geminiApiKey,
      );

      sessions.set(sessionId, { sendConfirmation });
      res.on('close', () => {
        clearInterval(keepAlive);
        sessions.delete(sessionId);
        if (!child.killed) child.kill();
      });

      return;
    }

    if (req.method === 'POST' && req.url === '/confirm') {
      if (!checkAuth(req, secret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end();
        return;
      }

      let body: ConfirmPayload;
      try { body = await readBody<ConfirmPayload>(req); }
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

export function createRelayServer(options: RelayServerOptions): http.Server {
  return http.createServer(createRelayHandler(options));
}

export function startRelayServer(options: RelayServerOptions): http.Server {
  const {
    port,
    host = '0.0.0.0',
    secret = '',
    geminiApiKey,
    logger = console,
  } = options;

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

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[relay] Port ${port} in use. Set RELAY_PORT=<other> in .env`);
    } else {
      logger.error('[relay] Server error:', err);
    }
    process.exit(1);
  });

  return server;
}

export function loadRelayOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RelayServerOptions {
  return {
    port: parseInt(env.RELAY_PORT ?? '7878', 10),
    secret: env.RELAY_SECRET ?? '',
    geminiApiKey: env.GEMINI_API_KEY ?? env.GEMMA_API_KEY ?? '',
  };
}

if (require.main === module) {
  config();
  try {
    startRelayServer(loadRelayOptionsFromEnv());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
