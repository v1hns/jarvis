import { ANTHROPIC_API_KEY, ANTHROPIC_VISION_MODEL } from '@env';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function isVisionConfigured(): boolean {
  return typeof ANTHROPIC_API_KEY === 'string' && ANTHROPIC_API_KEY.length > 0;
}

export function visionModelName(): string {
  return ANTHROPIC_VISION_MODEL || DEFAULT_MODEL;
}

/**
 * Send a base64 JPEG frame + text prompt to Claude Sonnet via the Anthropic
 * Messages API. The frame travels directly phone → Anthropic, no relay.
 */
export async function visionQuery(prompt: string, imageBase64: string): Promise<string> {
  if (!isVisionConfigured()) {
    throw new Error('ANTHROPIC_API_KEY not set — cannot call vision model.');
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: visionModelName(),
      max_tokens: 512,
      system:
        'You are Jarvis, a concise AI assistant on Meta Ray-Ban smart glasses. ' +
        'The user is asking about something they see through the glasses camera. ' +
        'Respond in 1-2 short sentences — your answer will be spoken aloud.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
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
