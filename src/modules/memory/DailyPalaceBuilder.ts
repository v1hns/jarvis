import type { CactusLM } from 'cactus-react-native';
import type {
  EpisodeRecord,
  DailyMemoryPalace,
  PlaceNode,
  DaySegment,
  ObjectSighting,
} from './types';

const PALACE_SYSTEM_PROMPT = `You compress a day of episodic memory from smart-glasses frames into a canonical structure.

You will receive an ordered JSON array of episodes. Merge near-duplicate place labels into canonical names. Group consecutive episodes at the same place into ordered segments with a short activity phrase. Produce a short daySummary (1-2 sentences).

Return strict minified JSON with exactly these fields:
{"places":[{"label":"<canonical>","episodeIds":["..."]}],"segments":[{"startMs":<num>,"endMs":<num>,"placeLabel":"<canonical>","activity":"<short>"}],"daySummary":"<1-2 sentences>"}

No prose outside the JSON.`;

function normalizeLabel(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function buildObjectLastSeen(episodes: EpisodeRecord[]): ObjectSighting[] {
  const map = new Map<string, ObjectSighting>();
  for (const ep of episodes) {
    for (const obj of ep.objects) {
      const key = obj.toLowerCase();
      const prev = map.get(key);
      if (!prev || ep.timestampMs > prev.lastSeenMs) {
        map.set(key, {
          object: obj,
          lastSeenMs: ep.timestampMs,
          placeLabel: ep.placeLabel,
          episodeId: ep.id,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

function fallbackPalace(dayKey: string, episodes: EpisodeRecord[]): DailyMemoryPalace {
  const placesMap = new Map<string, PlaceNode>();
  const segments: DaySegment[] = [];
  let currentSeg: DaySegment | null = null;

  for (const ep of episodes) {
    const key = normalizeLabel(ep.placeLabel);
    const node = placesMap.get(key);
    if (node) {
      node.episodeIds.push(ep.id);
      node.lastSeenMs = Math.max(node.lastSeenMs, ep.timestampMs);
    } else {
      placesMap.set(key, {
        label: ep.placeLabel,
        episodeIds: [ep.id],
        firstSeenMs: ep.timestampMs,
        lastSeenMs: ep.timestampMs,
      });
    }

    if (!currentSeg || normalizeLabel(currentSeg.placeLabel) !== key) {
      if (currentSeg) segments.push(currentSeg);
      currentSeg = {
        startMs: ep.timestampMs,
        endMs: ep.timestampMs,
        placeLabel: ep.placeLabel,
        activity: ep.activityHint || '',
      };
    } else {
      currentSeg.endMs = ep.timestampMs;
    }
  }
  if (currentSeg) segments.push(currentSeg);

  return {
    dayKey,
    places: Array.from(placesMap.values()),
    segments,
    objectLastSeen: buildObjectLastSeen(episodes),
    daySummary: '',
    episodeCount: episodes.length,
  };
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

/**
 * Compress a day's raw episodes into a DailyMemoryPalace. Tries Gemma first
 * for semantic merging + day summary; falls back to a purely programmatic
 * structural compression on any failure.
 */
export async function buildDailyPalace(
  lm: CactusLM,
  dayKey: string,
  episodes: EpisodeRecord[],
): Promise<DailyMemoryPalace> {
  if (episodes.length === 0) {
    return {
      dayKey,
      places: [],
      segments: [],
      objectLastSeen: [],
      daySummary: '',
      episodeCount: 0,
    };
  }

  const sorted = [...episodes].sort((a, b) => a.timestampMs - b.timestampMs);
  const objectLastSeen = buildObjectLastSeen(sorted);

  // Pass trimmed episode data so the prompt stays small.
  const compact = sorted.map(ep => ({
    id: ep.id,
    t: ep.timestampMs,
    place: ep.placeLabel,
    scene: ep.sceneSummary,
    activity: ep.activityHint,
  }));

  try {
    const result = await lm.completion([
      { role: 'system', content: PALACE_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(compact) },
    ]);
    const response = result.content ?? result.text ?? '';
    const parsed = extractJson(response);
    if (parsed && Array.isArray(parsed.places) && Array.isArray(parsed.segments)) {
      const places = (parsed.places as Array<Record<string, unknown>>)
        .filter(p => typeof p.label === 'string' && Array.isArray(p.episodeIds))
        .map(p => {
          const ids = (p.episodeIds as unknown[]).filter((x): x is string => typeof x === 'string');
          const times = sorted
            .filter(ep => ids.includes(ep.id))
            .map(ep => ep.timestampMs);
          return {
            label: p.label as string,
            episodeIds: ids,
            firstSeenMs: times.length ? Math.min(...times) : 0,
            lastSeenMs: times.length ? Math.max(...times) : 0,
          } as PlaceNode;
        });
      const segments = (parsed.segments as Array<Record<string, unknown>>)
        .filter(s =>
          typeof s.startMs === 'number' &&
          typeof s.endMs === 'number' &&
          typeof s.placeLabel === 'string',
        )
        .map(s => ({
          startMs: s.startMs as number,
          endMs: s.endMs as number,
          placeLabel: s.placeLabel as string,
          activity: typeof s.activity === 'string' ? s.activity : '',
        } as DaySegment));
      const daySummary = typeof parsed.daySummary === 'string' ? parsed.daySummary : '';

      if (places.length > 0 && segments.length > 0) {
        return { dayKey, places, segments, objectLastSeen, daySummary, episodeCount: sorted.length };
      }
    }
  } catch (err) {
    console.warn('[DailyPalaceBuilder] Gemma compression failed, using fallback:', err);
  }

  return fallbackPalace(dayKey, sorted);
}
