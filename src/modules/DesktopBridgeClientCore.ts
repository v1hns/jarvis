export interface BridgeTask {
  task: string;
  context?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Actions requiring voice confirmation before execution */
  confirm_before?: string[];
  session_id?: string;
}

export type BridgeEventType = 'progress' | 'needs_confirmation' | 'result' | 'error';
export type ConfirmationAnswer = 'CONFIRMED' | 'CANCELLED';

export interface BridgeEvent {
  type: BridgeEventType;
  payload: string;
}

export interface BridgeConfig {
  relayUrl: string;
  relaySecret?: string;
  /** Defaults to global fetch; tests inject a fake. */
  fetchFn?: typeof fetch;
}

export const DEFAULT_CONFIRM_BEFORE = ['send', 'pay', 'delete', 'submit', 'post'];

export function buildRelayHeaders(relaySecret?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(relaySecret ? { 'x-relay-secret': relaySecret } : {}),
  };
}

/**
 * Apply defaults (`confirm_before`, `session_id`) to a task before POSTing.
 * `sessionIdFn` lets tests supply a deterministic id; defaults to Date.now.
 */
export function buildTaskBody(
  task: BridgeTask,
  sessionIdFn: () => string = () => `jarvis-${Date.now()}`,
): object {
  return {
    ...task,
    confirm_before: task.confirm_before ?? DEFAULT_CONFIRM_BEFORE,
    session_id: task.session_id ?? sessionIdFn(),
  };
}

interface StreamReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
}

/**
 * Parse an SSE stream of newline-delimited JSON events. Each parsed event is
 * delivered to `onEvent`. Lines starting with `:` are SSE keepalives and
 * skipped; a `data: ` prefix is stripped. Non-JSON lines are ignored.
 * Returns the payload of the last `result` event seen, or '' if none.
 */
export async function parseSseStream(
  reader: StreamReader,
  onEvent: (event: BridgeEvent) => void | Promise<void>,
): Promise<string> {
  const decoder = new TextDecoder();
  let finalResult = '';
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
      try {
        const event = JSON.parse(jsonStr) as BridgeEvent;
        void Promise.resolve(onEvent(event)).catch(err => {
          console.warn('[DesktopBridgeClient] event handler failed:', err);
        });
        if (event.type === 'result') finalResult = event.payload;
      } catch {
        // non-JSON line — ignore
      }
    }
  }

  // Flush any final line the stream forgot to terminate.
  const tail = buffer.trim();
  if (tail && !tail.startsWith(':')) {
    const jsonStr = tail.startsWith('data: ') ? tail.slice(6) : tail;
    try {
      const event = JSON.parse(jsonStr) as BridgeEvent;
      void Promise.resolve(onEvent(event)).catch(() => {});
      if (event.type === 'result') finalResult = event.payload;
    } catch {
      // ignore
    }
  }

  return finalResult;
}

export async function sendTaskWith(
  cfg: BridgeConfig,
  task: BridgeTask,
  onEvent: (event: BridgeEvent) => void | Promise<void>,
  signal?: AbortSignal,
  sessionIdFn?: () => string,
): Promise<string> {
  const fetchImpl = cfg.fetchFn ?? fetch;
  const res = await fetchImpl(`${cfg.relayUrl}/task`, {
    method: 'POST',
    headers: buildRelayHeaders(cfg.relaySecret),
    body: JSON.stringify(buildTaskBody(task, sessionIdFn)),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay ${res.status}: ${body.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Relay returned no response body.');

  return parseSseStream(reader as StreamReader, onEvent);
}

export async function sendConfirmationWith(
  cfg: BridgeConfig,
  sessionId: string,
  answer: ConfirmationAnswer,
  signal?: AbortSignal,
): Promise<void> {
  const fetchImpl = cfg.fetchFn ?? fetch;
  const res = await fetchImpl(`${cfg.relayUrl}/confirm`, {
    method: 'POST',
    headers: buildRelayHeaders(cfg.relaySecret),
    body: JSON.stringify({ session_id: sessionId, answer }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay confirm ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function checkHeartbeatWith(cfg: BridgeConfig): Promise<boolean> {
  const fetchImpl = cfg.fetchFn ?? fetch;
  try {
    const res = await fetchImpl(`${cfg.relayUrl}/ping`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
