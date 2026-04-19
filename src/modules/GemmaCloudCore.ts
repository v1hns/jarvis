export interface CloudMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CloudCompleteOptions {
  system?: string;
  messages: CloudMessage[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface CloudConfig {
  apiKey: string;
  model: string;
  /** Defaults to global fetch; tests inject a fake. */
  fetchFn?: typeof fetch;
}

export const GEMMA_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Build the request body sent to Google AI Studio. Gemma chat templates
 * don't accept a dedicated system role, so `system` is folded into the
 * first user turn.
 */
export function buildGemmaRequestBody(opts: CloudCompleteOptions): object {
  const contents = opts.messages.map((m, i) => {
    const text = i === 0 && opts.system ? `${opts.system}\n\n${m.content}` : m.content;
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    };
  });
  return {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxOutputTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
    },
  };
}

export function buildGemmaUrl(cfg: CloudConfig): string {
  return `${GEMMA_ENDPOINT}/${cfg.model}:generateContent?key=${cfg.apiKey}`;
}

/**
 * Calls Google AI Studio's Gemma API. Tests pass a fake `fetchFn`.
 */
export async function cloudCompleteWith(
  cfg: CloudConfig,
  opts: CloudCompleteOptions,
): Promise<string> {
  const fetchImpl = cfg.fetchFn ?? fetch;
  const res = await fetchImpl(buildGemmaUrl(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGemmaRequestBody(opts)),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloud Gemma ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`Cloud Gemma returned no text: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return text;
}
