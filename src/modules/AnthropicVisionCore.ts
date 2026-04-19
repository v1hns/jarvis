export interface VisionConfig {
  apiKey: string;
  model: string;
  /** Defaults to global fetch; tests inject a fake. */
  fetchFn?: typeof fetch;
}

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export const VISION_SYSTEM_PROMPT =
  'You are Jarvis, a concise AI assistant on Meta Ray-Ban smart glasses. ' +
  'The user is asking about something they see through the glasses camera. ' +
  'Respond in 1-2 short sentences — your answer will be spoken aloud.';

export function buildVisionRequestBody(
  model: string,
  prompt: string,
  imageBase64: string,
): object {
  return {
    model,
    max_tokens: 512,
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
}

/**
 * Send a base64 JPEG frame + prompt to the Anthropic Messages API. Tests
 * pass a fake `fetchFn`.
 */
export async function visionQueryWith(
  cfg: VisionConfig,
  prompt: string,
  imageBase64: string,
): Promise<string> {
  const fetchImpl = cfg.fetchFn ?? fetch;
  const res = await fetchImpl(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(buildVisionRequestBody(cfg.model, prompt, imageBase64)),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic vision ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`No text in vision response: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return text;
}
