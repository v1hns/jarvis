import { RELAY_URL, RELAY_SECRET } from '@env';

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

export function isBridgeConfigured(): boolean {
  return typeof RELAY_URL === 'string' && RELAY_URL.length > 0;
}

function relayHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(RELAY_SECRET ? { 'x-relay-secret': RELAY_SECRET } : {}),
  };
}

/**
 * POST a task to the desktop relay and stream back progress events.
 * onEvent is called for each JSON event line from the relay SSE stream.
 * Returns the final result string.
 */
export async function sendTask(
  task: BridgeTask,
  onEvent: (event: BridgeEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  if (!isBridgeConfigured()) {
    throw new Error(
      'RELAY_URL not set. Start desktop-relay on your laptop and set RELAY_URL in .env.',
    );
  }

  const url = `${RELAY_URL}/task`;
  const res = await fetch(url, {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify({
      ...task,
      confirm_before: task.confirm_before ?? ['send', 'pay', 'delete', 'submit', 'post'],
      session_id: task.session_id ?? `jarvis-${Date.now()}`,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay ${res.status}: ${body.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Relay returned no response body.');

  const decoder = new TextDecoder();
  let finalResult = '';
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment / keep-alive

      // Strip "data: " prefix from SSE
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

  return finalResult;
}

/**
 * Send the user's decision back to the paused relay session so the desktop
 * agent can continue or abort.
 */
export async function sendConfirmation(
  sessionId: string,
  answer: ConfirmationAnswer,
  signal?: AbortSignal,
): Promise<void> {
  if (!isBridgeConfigured()) {
    throw new Error(
      'RELAY_URL not set. Start desktop-relay on your laptop and set RELAY_URL in .env.',
    );
  }

  const res = await fetch(`${RELAY_URL}/confirm`, {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify({
      session_id: sessionId,
      answer,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Relay confirm ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Ping relay to check if laptop is reachable. Returns true if alive. */
export async function checkHeartbeat(): Promise<boolean> {
  if (!isBridgeConfigured()) return false;
  try {
    const res = await fetch(`${RELAY_URL}/ping`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
