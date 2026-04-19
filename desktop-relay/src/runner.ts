import { spawn, ChildProcess } from 'child_process';
import type { BridgeEvent, TaskPayload } from './types.js';

const JARVIS_AGENT_ID = 'jarvis';

/**
 * System prompt injected into every task message so Gemma 4 emits structured
 * progress markers the relay can parse and speak through the glasses.
 */
export const TASK_PREAMBLE = (confirmBefore: string[]) =>
  `You are Jarvis's desktop execution agent running on the user's laptop via OpenClaw.
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
export function buildMessage(payload: TaskPayload): string {
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
export function extractTextFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return trimmed || null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    // Final result has response/text/content at top level
    const text =
      (typeof obj.response === 'string' && obj.response) ||
      (typeof obj.text === 'string' && obj.text) ||
      (typeof obj.content === 'string' && obj.content) ||
      // Streaming partial: delta.text
      (obj.delta && typeof (obj.delta as Record<string, unknown>).text === 'string'
        ? (obj.delta as Record<string, unknown>).text as string
        : null);
    return text || null;
  } catch {
    return trimmed || null;
  }
}

export interface RunnerHandle {
  child: ChildProcess;
  sendConfirmation: (answer: 'CONFIRMED' | 'CANCELLED') => void;
}

export interface RunnerDependencies {
  spawnImpl?: typeof spawn;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  logger?: Pick<typeof console, 'log' | 'error'>;
}

/**
 * Spawn `openclaw agent --agent jarvis --local --message <task> --json` and
 * translate its stdout into BridgeEvents streamed to the onEvent callback.
 * Returns a handle with child process ref and a confirmation injector.
 */
export function runOpenClawTask(
  payload: TaskPayload,
  onEvent: (event: BridgeEvent) => void,
  geminiApiKey: string,
  deps: RunnerDependencies = {},
): RunnerHandle {
  const {
    spawnImpl = spawn,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    logger = console,
  } = deps;
  const message = buildMessage(payload);
  const sessionId = payload.session_id ?? `jarvis-${Date.now()}`;

  logger.log(`[relay] [${sessionId}] task: ${payload.task.slice(0, 120)}`);

  const child = spawnImpl(
    'openclaw',
    [
      'agent',
      '--agent', JARVIS_AGENT_ID,
      '--local',
      '--message', message,
      '--json',
      '--session-id', sessionId,
      '--thinking', 'medium',
    ],
    {
      env: {
        ...process.env,
        GEMINI_API_KEY: geminiApiKey,
        GOOGLE_API_KEY: geminiApiKey,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdoutBuffer = '';
  let finalResult = '';
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Keep SSE alive with progress ticks during long-running tasks
  let lastProgressMs = Date.now();
  heartbeat = setIntervalImpl(() => {
    if (Date.now() - lastProgressMs > 8_000) {
      onEvent({ type: 'progress', payload: 'Working…' });
    }
  }, 9_000);

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const text = extractTextFromLine(line);
      if (!text) continue;

      // Walk through all text content line-by-line looking for markers
      for (const contentLine of text.split('\n')) {
        const t = contentLine.trim();
        if (!t) continue;

        if (t.startsWith('PROGRESS:')) {
          const msg = t.slice('PROGRESS:'.length).trim();
          lastProgressMs = Date.now();
          onEvent({ type: 'progress', payload: msg });
          logger.log(`[relay] [${sessionId}] progress: ${msg}`);
        } else if (t.startsWith('CONFIRM_REQUIRED:')) {
          const msg = t.slice('CONFIRM_REQUIRED:'.length).trim();
          lastProgressMs = Date.now();
          onEvent({ type: 'needs_confirmation', payload: msg });
          logger.log(`[relay] [${sessionId}] confirmation needed: ${msg}`);
        } else {
          // General output — treat as progress for live audio feedback
          lastProgressMs = Date.now();
          onEvent({ type: 'progress', payload: t.slice(0, 200) });
          finalResult = t; // last non-marker line becomes the result
        }
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) logger.error(`[relay] [${sessionId}] stderr:`, msg);
  });

  child.on('close', (code) => {
    if (heartbeat) clearIntervalImpl(heartbeat);
    if (code !== 0) {
      onEvent({ type: 'error', payload: `OpenClaw exited with code ${code}` });
    } else {
      onEvent({ type: 'result', payload: finalResult || 'Task completed.' });
    }
    logger.log(`[relay] [${sessionId}] done (exit ${code})`);
  });

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (heartbeat) clearIntervalImpl(heartbeat);
    const msg =
      err.code === 'ENOENT'
        ? 'openclaw CLI not found — run: npm install -g openclaw  OR  check your PATH'
        : err.message;
    onEvent({ type: 'error', payload: msg });
  });

  const sendConfirmation = (answer: 'CONFIRMED' | 'CANCELLED') => {
    if (child.stdin && !child.killed) {
      child.stdin.write(`${answer}\n`);
    }
  };

  return { child, sendConfirmation };
}
