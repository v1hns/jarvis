import type { CactusLM } from 'cactus-react-native';
import type { EpisodeRecord, DailyMemoryPalace, MemoryQueryResult } from './types';
import {
  loadEpisodes,
  loadPalace,
  listStoredDays,
  todayKey,
  dayKeyFromTimestamp,
} from './MemoryStore';

const ANSWER_SYSTEM_PROMPT = `You answer spoken questions about the user's episodic memory from smart-glasses frames.

Rules:
- Keep answers to 1-2 short sentences (spoken aloud).
- Cite approximate time and place when relevant (e.g. "around 2pm in your kitchen").
- If the evidence is weak or missing, say "I'm not sure" — never invent a location or time.
- Do not list raw episode IDs.
- The JSON context block contains the facts; do not contradict it.`;

const STOP = new Set([
  'the','a','an','is','are','was','were','my','me','i','to','of','in','on','at','and','or','it','that','this','did','do','have','had','what','when','where','how','why','today','yesterday','last','time','ago','for','with','about','be','been','just','you','your',
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
}

function dayKeyOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dayKeyFromTimestamp(d.getTime());
}

export interface QueryScope {
  focusDayKey: string | null;
  includeWindow: boolean;
}

export function parseQueryScope(query: string): QueryScope {
  const q = query.toLowerCase();
  if (/\byesterday\b/.test(q)) return { focusDayKey: dayKeyOffset(-1), includeWindow: false };
  if (/\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b|\bearlier\b|\bjust now\b/.test(q)) {
    return { focusDayKey: todayKey(), includeWindow: false };
  }
  return { focusDayKey: null, includeWindow: true };
}

function scoreEpisode(ep: EpisodeRecord, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hay = [
    ep.sceneSummary,
    ep.placeLabel,
    ep.activityHint,
    ep.objects.join(' '),
    ep.ocrText.join(' '),
  ].join(' ').toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits++;
  }
  return hits;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${suffix}`;
}

interface EvidenceBundle {
  episodes: Array<Pick<EpisodeRecord, 'id' | 'timestampMs' | 'placeLabel' | 'sceneSummary' | 'activityHint' | 'objects'> & { time: string }>;
  palaces: DailyMemoryPalace[];
  dayKey: string;
  confidence: 'high' | 'low' | 'none';
}

async function gatherEvidence(query: string, scope: QueryScope): Promise<EvidenceBundle> {
  const tokens = tokenize(query);
  const today = todayKey();

  // Today focus: rank raw episodes by token overlap, fall back to most recent.
  if (scope.focusDayKey === today || (scope.focusDayKey === null && scope.includeWindow === false)) {
    const raw = await loadEpisodes(today);
    return bundleFromEpisodes(raw, tokens, today);
  }

  // Specific past day focus: use its palace.
  if (scope.focusDayKey && scope.focusDayKey !== today) {
    const palace = await loadPalace(scope.focusDayKey);
    return {
      episodes: [],
      palaces: palace ? [palace] : [],
      dayKey: scope.focusDayKey,
      confidence: palace ? 'high' : 'none',
    };
  }

  // Window mode: today's raw episodes + all past palaces.
  const raw = await loadEpisodes(today);
  const days = await listStoredDays();
  const palaces: DailyMemoryPalace[] = [];
  for (const d of days) {
    if (d === today) continue;
    const p = await loadPalace(d);
    if (p) palaces.push(p);
  }
  const bundle = bundleFromEpisodes(raw, tokens, today);
  bundle.palaces = palaces;
  if (bundle.confidence === 'none' && palaces.length > 0) bundle.confidence = 'low';
  return bundle;
}

function bundleFromEpisodes(raw: EpisodeRecord[], tokens: string[], dayKey: string): EvidenceBundle {
  if (raw.length === 0) {
    return { episodes: [], palaces: [], dayKey, confidence: 'none' };
  }
  const scored = raw
    .map(ep => ({ ep, score: scoreEpisode(ep, tokens) }))
    .sort((a, b) => b.score - a.score || b.ep.timestampMs - a.ep.timestampMs);

  const withHits = scored.filter(s => s.score > 0);
  const pick = (withHits.length > 0 ? withHits : scored.slice(0, 10)).slice(0, 20);
  const confidence: 'high' | 'low' | 'none' = withHits.length > 0 ? 'high' : 'low';

  const episodes = pick.map(({ ep }) => ({
    id: ep.id,
    timestampMs: ep.timestampMs,
    placeLabel: ep.placeLabel,
    sceneSummary: ep.sceneSummary,
    activityHint: ep.activityHint,
    objects: ep.objects,
    time: formatTime(ep.timestampMs),
  }));
  return { episodes, palaces: [], dayKey, confidence };
}

/**
 * Answer a memory query. Uses the MAIN CactusLM for synthesis so the user
 * gets the same latency profile as a normal local answer.
 */
export async function answerMemoryQuery(
  mainLM: CactusLM,
  query: string,
): Promise<MemoryQueryResult> {
  const scope = parseQueryScope(query);
  const evidence = await gatherEvidence(query, scope);

  if (evidence.confidence === 'none' && evidence.episodes.length === 0 && evidence.palaces.length === 0) {
    return {
      answer: "I don't have a memory of that — I haven't captured anything relevant.",
      supportingEpisodeIds: [],
      dayKey: evidence.dayKey,
      confidence: 'none',
    };
  }

  const contextBlock = JSON.stringify({
    focusDayKey: evidence.dayKey,
    confidence: evidence.confidence,
    episodes: evidence.episodes,
    palaces: evidence.palaces,
  });

  let answer: string;
  try {
    const { response } = await mainLM.complete({
      messages: [
        { role: 'system', content: ANSWER_SYSTEM_PROMPT },
        { role: 'user', content: `Question: ${query}\nContext JSON:\n${contextBlock}` },
      ],
    });
    answer = response.trim();
  } catch (err) {
    console.warn('[MemoryQueryEngine] synthesis failed:', err);
    answer = "I couldn't pull that memory up right now.";
  }

  return {
    answer,
    supportingEpisodeIds: evidence.episodes.map(e => e.id),
    dayKey: evidence.dayKey,
    confidence: evidence.confidence,
  };
}
