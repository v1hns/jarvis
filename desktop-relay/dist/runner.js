"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOpenClawTask = runOpenClawTask;
const child_process_1 = require("child_process");
const JARVIS_AGENT_ID = 'jarvis';
/**
 * System prompt injected into every task message so Gemma 4 emits structured
 * progress markers the relay can parse and speak through the glasses.
 */
const TASK_PREAMBLE = (confirmBefore) => `You are Jarvis's desktop execution agent running on the user's laptop via OpenClaw.
Complete the task the user describes using any tools available to you.

IMPORTANT RULES:
1. Before any action matching: ${confirmBefore.map(a => `"${a}"`).join(', ')} — output EXACTLY:
   CONFIRM_REQUIRED: <one sentence describing what you are about to do>
   Then stop and wait. You will receive CONFIRMED or CANCELLED to proceed or abort.
2. After each major step, output a short status starting with PROGRESS: so the
   user can hear live updates through their glasses.
3. Keep all output concise — responses are spoken aloud.

`;
/**
 * Build the full message string sent to openclaw agent.
 * Prepends the preamble and any conversation context.
 */
function buildMessage(payload) {
    const preamble = TASK_PREAMBLE(payload.confirm_before ?? ['send', 'pay', 'delete', 'submit', 'post']);
    const contextLines = (payload.context ?? [])
        .map(m => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`)
        .join('\n\n');
    return [preamble, contextLines, `Task: ${payload.task}`].filter(Boolean).join('\n\n');
}
/**
 * Parse a line of openclaw --json output. OpenClaw streams partial JSON events
 * plus a final complete object. We treat any line starting with { as an
 * attempt to parse. Returns the text content if found, null otherwise.
 */
function extractTextFromLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{'))
        return trimmed || null;
    try {
        const obj = JSON.parse(trimmed);
        // Final result has response/text/content at top level
        const text = (typeof obj.response === 'string' && obj.response) ||
            (typeof obj.text === 'string' && obj.text) ||
            (typeof obj.content === 'string' && obj.content) ||
            // Streaming partial: delta.text
            (obj.delta && typeof obj.delta.text === 'string'
                ? obj.delta.text
                : null);
        return text || null;
    }
    catch {
        return trimmed || null;
    }
}
/**
 * Spawn `openclaw agent --agent jarvis --local --message <task> --json` and
 * translate its stdout into BridgeEvents streamed to the onEvent callback.
 * Returns a handle with child process ref and a confirmation injector.
 */
function runOpenClawTask(payload, onEvent, geminiApiKey) {
    const message = buildMessage(payload);
    const sessionId = payload.session_id ?? `jarvis-${Date.now()}`;
    console.log(`[relay] [${sessionId}] task: ${payload.task.slice(0, 120)}`);
    const child = (0, child_process_1.spawn)('openclaw', [
        'agent',
        '--agent', JARVIS_AGENT_ID,
        '--local',
        '--message', message,
        '--json',
        '--session-id', sessionId,
        '--thinking', 'medium',
    ], {
        env: {
            ...process.env,
            GEMINI_API_KEY: geminiApiKey,
            GOOGLE_API_KEY: geminiApiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let finalResult = '';
    let heartbeat = null;
    // Keep SSE alive with progress ticks during long-running tasks
    let lastProgressMs = Date.now();
    heartbeat = setInterval(() => {
        if (Date.now() - lastProgressMs > 8_000) {
            onEvent({ type: 'progress', payload: 'Working…' });
        }
    }, 9_000);
    child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
            const text = extractTextFromLine(line);
            if (!text)
                continue;
            // Walk through all text content line-by-line looking for markers
            for (const contentLine of text.split('\n')) {
                const t = contentLine.trim();
                if (!t)
                    continue;
                if (t.startsWith('PROGRESS:')) {
                    const msg = t.slice('PROGRESS:'.length).trim();
                    lastProgressMs = Date.now();
                    onEvent({ type: 'progress', payload: msg });
                    console.log(`[relay] [${sessionId}] progress: ${msg}`);
                }
                else if (t.startsWith('CONFIRM_REQUIRED:')) {
                    const msg = t.slice('CONFIRM_REQUIRED:'.length).trim();
                    lastProgressMs = Date.now();
                    onEvent({ type: 'needs_confirmation', payload: msg });
                    console.log(`[relay] [${sessionId}] confirmation needed: ${msg}`);
                }
                else {
                    // General output — treat as progress for live audio feedback
                    lastProgressMs = Date.now();
                    onEvent({ type: 'progress', payload: t.slice(0, 200) });
                    finalResult = t; // last non-marker line becomes the result
                }
            }
        }
    });
    child.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg)
            console.error(`[relay] [${sessionId}] stderr:`, msg);
    });
    child.on('close', (code) => {
        if (heartbeat)
            clearInterval(heartbeat);
        if (code !== 0) {
            onEvent({ type: 'error', payload: `OpenClaw exited with code ${code}` });
        }
        else {
            onEvent({ type: 'result', payload: finalResult || 'Task completed.' });
        }
        console.log(`[relay] [${sessionId}] done (exit ${code})`);
    });
    child.on('error', (err) => {
        if (heartbeat)
            clearInterval(heartbeat);
        const msg = err.code === 'ENOENT'
            ? 'openclaw CLI not found — run: npm install -g openclaw  OR  check your PATH'
            : err.message;
        onEvent({ type: 'error', payload: msg });
    });
    const sendConfirmation = (answer) => {
        if (child.stdin && !child.killed) {
            child.stdin.write(`${answer}\n`);
        }
    };
    return { child, sendConfirmation };
}
