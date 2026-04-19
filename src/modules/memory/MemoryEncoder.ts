import type { CactusLM } from 'cactus-react-native';
import type { EpisodeRecord } from './types';
import { dayKeyFromTimestamp } from './MemoryStore';

const ENCODE_SYSTEM_PROMPT = `You are an on-device visual memory encoder. You will be given a single frame captured from the user's smart glasses.

Return a single line of strict minified JSON and nothing else, with these exact fields:
{"sceneSummary":"<1 sentence, concrete, includes dominant objects and setting>","placeLabel":"<2-4 words naming the location, e.g. 'home kitchen', 'office desk', 'grocery store aisle'>","objects":["<notable object>", ...],"ocrText":["<any visible text, short>", ...],"activityHint":"<short phrase naming what the wearer is doing>","salience":<0.0-1.0 how memorable/important this moment is>}

Be specific. If a previous place label is provided and this frame is clearly the same place, reuse that exact label. Do not include commentary or markdown.`;

function buildUserPrompt(prevPlaceLabel: string | null): string {
  if (prevPlaceLabel) {
    return `Previous place label: "${prevPlaceLabel}". If this frame is the same place, reuse that exact label. Encode this frame.`;
  }
  return 'Encode this frame.';
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function coerceEpisode(
  raw: Record<string, unknown>,
  timestampMs: number,
): EpisodeRecord | null {
  const sceneSummary = typeof raw.sceneSummary === 'string' ? raw.sceneSummary.trim() : '';
  const placeLabel = typeof raw.placeLabel === 'string' ? raw.placeLabel.trim() : '';
  if (!sceneSummary || !placeLabel) return null;

  const objects = Array.isArray(raw.objects)
    ? raw.objects.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
    : [];
  const ocrText = Array.isArray(raw.ocrText)
    ? raw.ocrText.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
    : [];
  const activityHint = typeof raw.activityHint === 'string' ? raw.activityHint.trim() : '';
  const salience = typeof raw.salience === 'number' && raw.salience >= 0 && raw.salience <= 1
    ? raw.salience
    : 0.5;

  return {
    id: `ep_${timestampMs}_${Math.random().toString(36).slice(2, 8)}`,
    timestampMs,
    dayKey: dayKeyFromTimestamp(timestampMs),
    sceneSummary,
    placeLabel,
    objects,
    ocrText,
    activityHint,
    salience,
  };
}

/**
 * Encodes a captured photo into an EpisodeRecord by asking Gemma (via the
 * dedicated memory CactusLM instance) for structured JSON. On parse failure,
 * retries once with a stricter nudge; if still bad, returns null and the
 * orchestrator drops the frame silently.
 */
export async function encodeEpisode(
  lm: CactusLM,
  imageBase64: string,
  timestampMs: number,
  prevPlaceLabel: string | null,
): Promise<EpisodeRecord | null> {
  const userPrompt = buildUserPrompt(prevPlaceLabel);

  const attempt = async (extraNudge?: string): Promise<EpisodeRecord | null> => {
    try {
      const result = await lm.completion([
        { role: 'system', content: ENCODE_SYSTEM_PROMPT + (extraNudge ?? '') },
        { role: 'user', content: userPrompt, images: [imageBase64] },
      ] as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>);
      const response = result.content ?? result.text ?? '';
      const parsed = extractJson(response);
      if (!parsed) return null;
      return coerceEpisode(parsed, timestampMs);
    } catch (err) {
      console.warn('[MemoryEncoder] encode failed:', err);
      return null;
    }
  };

  const first = await attempt();
  if (first) return first;
  return attempt('\nReturn ONLY a single-line JSON object. No prose.');
}
