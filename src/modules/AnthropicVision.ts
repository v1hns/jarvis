import { ANTHROPIC_API_KEY, ANTHROPIC_VISION_MODEL } from '@env';
import { visionQueryWith } from './AnthropicVisionCore';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

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
  return visionQueryWith(
    { apiKey: ANTHROPIC_API_KEY, model: visionModelName() },
    prompt,
    imageBase64,
  );
}
