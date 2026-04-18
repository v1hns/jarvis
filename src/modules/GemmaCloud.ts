import { GEMMA_API_KEY, GEMMA_CLOUD_MODEL } from '@env';

const DEFAULT_MODEL = 'gemma-4-27b-it';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

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

export function isCloudConfigured(): boolean {
  return typeof GEMMA_API_KEY === 'string' && GEMMA_API_KEY.length > 0;
}

export function cloudModelName(): string {
  return GEMMA_CLOUD_MODEL || DEFAULT_MODEL;
}

/**
 * Calls Google AI Studio's Gemma API. Gemma chat templates do not accept a
 * dedicated system role, so we fold `system` into the first user turn.
 */
export async function cloudComplete(opts: CloudCompleteOptions): Promise<string> {
  if (!isCloudConfigured()) {
    throw new Error('GEMMA_API_KEY not set — cannot call cloud Gemma.');
  }

  const contents = opts.messages.map((m, i) => {
    const text = i === 0 && opts.system ? `${opts.system}\n\n${m.content}` : m.content;
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    };
  });

  const url = `${ENDPOINT}/${cloudModelName()}:generateContent?key=${GEMMA_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens ?? 512,
        temperature: opts.temperature ?? 0.7,
      },
    }),
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
