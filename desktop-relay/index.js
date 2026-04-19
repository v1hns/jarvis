#!/usr/bin/env node
/**
 * Jarvis Desktop Relay
 *
 * Runs on your laptop alongside Claude Code. Receives tasks from the iPhone
 * over Tailscale (or local LAN), translates them into `claude` CLI invocations
 * with computer-use enabled, and streams structured JSON events back.
 *
 * Start: node index.js
 * Requires: RELAY_SECRET and RELAY_PORT in .env (or env vars directly)
 */

const http = require('http');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
require('dotenv').config();

const PORT = parseInt(process.env.RELAY_PORT ?? '7878', 10);
const SECRET = process.env.RELAY_SECRET ?? '';

if (!SECRET) {
  console.warn('[relay] RELAY_SECRET not set — relay will accept requests from any client on the network.');
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sendEvent(res, type, payload) {
  const data = JSON.stringify({ type, payload });
  res.write(`data: ${data}\n\n`);
}

// ── Request parsing ───────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req) {
  if (!SECRET) return true;
  return req.headers['x-relay-secret'] === SECRET;
}

// ── Claude Code invocation ───────────────────────────────────────────────────

/**
 * Build a Claude Code system prompt that instructs it to pause before any
 * action in the confirm_before list and emit a JSON needs_confirmation event.
 */
function buildSystemPrompt(confirmBefore) {
  const guarded = confirmBefore.map(a => `"${a}"`).join(', ');
  return (
    `You are Jarvis's desktop execution agent. Complete the task the user describes.\n` +
    `Before taking any action that involves: ${guarded}, output exactly:\n` +
    `CONFIRM_REQUIRED: <one sentence describing what you are about to do>\n` +
    `and wait. You will receive a CONFIRMED or CANCELLED message to proceed or abort.\n` +
    `After each major step, output a short status line starting with PROGRESS: so the\n` +
    `user can hear what you're doing. Be concise.`
  );
}

/**
 * Invoke the `claude` CLI with --computer-use and stream its output back as
 * SSE events. Parses PROGRESS: and CONFIRM_REQUIRED: markers from stdout.
 */
function runClaudeTask(taskPayload, res) {
  const { task, context = [], confirm_before = [], session_id } = taskPayload;

  const systemPrompt = buildSystemPrompt(confirm_before);
  const fullPrompt = [
    ...context.map(m => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`),
    `Task: ${task}`,
  ].join('\n\n');

  console.log(`[relay] [${session_id}] Task: ${task.slice(0, 120)}`);

  // claude CLI with computer use enabled, streaming JSON output
  const child = spawn('claude', [
    '--computer-use',
    '--output-format', 'stream-json',
    '--system', systemPrompt,
    '--message', fullPrompt,
  ], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let pendingConfirmation = null;

  // Keep SSE alive with a comment every 15s
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15_000);

  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to parse claude's stream-json output
      try {
        const evt = JSON.parse(trimmed);
        const text = evt?.delta?.text ?? evt?.content?.[0]?.text ?? '';
        if (text) processOutputLine(text, res, session_id, c => { pendingConfirmation = c; });
      } catch {
        // Plain text line — process directly
        processOutputLine(trimmed, res, session_id, c => { pendingConfirmation = c; });
      }
    }
  });

  child.stderr.on('data', chunk => {
    const msg = chunk.toString().trim();
    if (msg) console.error(`[relay] [${session_id}] stderr:`, msg);
  });

  // Handle confirmation replies from phone: POST /confirm { session_id, answer: "CONFIRMED"|"CANCELLED" }
  res.socket.pendingConfirmation = pendingConfirmation;

  child.on('close', code => {
    clearInterval(keepAlive);
    if (code !== 0) {
      sendEvent(res, 'error', `Claude Code exited with code ${code}`);
    } else {
      sendEvent(res, 'result', 'Task completed.');
    }
    res.end();
    console.log(`[relay] [${session_id}] done (exit ${code})`);
  });

  child.on('error', err => {
    clearInterval(keepAlive);
    const msg = err.code === 'ENOENT'
      ? 'claude CLI not found — run: npm install -g @anthropic-ai/claude-code'
      : err.message;
    sendEvent(res, 'error', msg);
    res.end();
  });

  return child;
}

function processOutputLine(text, res, sessionId, setConfirmation) {
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('PROGRESS:')) {
      const msg = t.slice('PROGRESS:'.length).trim();
      console.log(`[relay] [${sessionId}] progress: ${msg}`);
      sendEvent(res, 'progress', msg);
    } else if (t.startsWith('CONFIRM_REQUIRED:')) {
      const msg = t.slice('CONFIRM_REQUIRED:'.length).trim();
      console.log(`[relay] [${sessionId}] needs_confirmation: ${msg}`);
      sendEvent(res, 'needs_confirmation', msg);
      setConfirmation(msg);
    } else {
      // General output — emit as progress so user hears something
      sendEvent(res, 'progress', t.slice(0, 200));
    }
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const pendingTasks = new Map(); // session_id → { child, confirmResolve }

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-relay-secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /ping — heartbeat ─────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  // ── POST /task — run a task ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/task') {
    if (!checkAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    if (!body.task || typeof body.task !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '`task` string required' }));
      return;
    }

    sseHeaders(res);
    sendEvent(res, 'progress', 'Received task — starting Claude Code…');

    const child = runClaudeTask(body, res);
    if (body.session_id) {
      pendingTasks.set(body.session_id, { child });
      res.on('close', () => pendingTasks.delete(body.session_id));
    }
    return;
  }

  // ── POST /confirm — user voice-confirmed or cancelled an action ───────────
  if (req.method === 'POST' && req.url === '/confirm') {
    if (!checkAuth(req)) {
      res.writeHead(401);
      res.end();
      return;
    }

    let body;
    try { body = await readBody(req); } catch { res.writeHead(400); res.end(); return; }

    const entry = pendingTasks.get(body.session_id);
    if (entry?.child?.stdin) {
      const answer = body.answer === 'CONFIRMED' ? 'CONFIRMED\n' : 'CANCELLED\n';
      entry.child.stdin.write(answer);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Jarvis Desktop Relay] listening on port ${PORT}`);
  console.log(`[relay] Tailscale: set RELAY_URL=http://<your-tailscale-ip>:${PORT} in the app's .env`);
  console.log(`[relay] Local LAN:  set RELAY_URL=http://<your-mac-ip>:${PORT} in the app's .env`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[relay] Port ${PORT} already in use. Set RELAY_PORT=<other> in .env`);
  } else {
    console.error('[relay] Server error:', err);
  }
  process.exit(1);
});
