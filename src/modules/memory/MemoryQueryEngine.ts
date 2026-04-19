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

REQUIRED output format — your response MUST end with exactly one line:
ANSWER: <your final spoken reply in 1-2 short sentences>

Anything you write before that line is ignored. The ANSWER line is the only thing the user hears.

Rules for the ANSWER line:
- Use the pre-formatted "time" strings in the context (e.g. "2:30pm"). Never compute times from raw millisecond values.
- Cite approximate time and place when relevant.
- If the evidence is weak or missing, write "ANSWER: I'm not sure." — never invent a location or time.
- Do not list raw episode IDs. Do not wrap the answer in quotes or markdown.
- Do not contradict the JSON context.`;

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

  // Today focus: user explicitly asked about today — return the whole day
  // time-sorted so the model can summarize. Don't filter by keywords: broad
  // queries like "what did I do this morning" have no useful tokens.
  if (scope.focusDayKey === today) {
    const raw = [...(await loadEpisodes(today))].sort((a, b) => a.timestampMs - b.timestampMs).slice(0, 40);
    if (raw.length === 0) return { episodes: [], palaces: [], dayKey: today, confidence: 'none' };
    return {
      dayKey: today,
      palaces: [],
      confidence: 'high',
      episodes: raw.map(ep => ({
        id: ep.id,
        timestampMs: ep.timestampMs,
        placeLabel: ep.placeLabel,
        sceneSummary: ep.sceneSummary,
        activityHint: ep.activityHint,
        objects: ep.objects,
        time: formatTime(ep.timestampMs),
      })),
    };
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
  // Broad queries (few or zero tokens, like "what did I do today") deserve
  // the whole day, time-sorted, so the model can summarize the full span.
  // Specific queries (many tokens, strong hits) get the ranked top-N.
  let pick: typeof scored;
  let confidence: 'high' | 'low' | 'none';
  if (tokens.length <= 1 || withHits.length === 0) {
    pick = [...raw]
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .slice(0, 20)
      .map(ep => ({ ep, score: 0 }));
    confidence = raw.length > 0 ? 'low' : 'none';
  } else {
    pick = withHits.slice(0, 20);
    confidence = 'high';
  }

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
 * Strip LLM reasoning scaffolding (bullet-pointed drafts, checklists, leading
 * role preambles) and return just the final spoken sentence. Larger cloud
 * models like Gemma 4 tend to output their full chain-of-thought even when
 * asked not to; smaller on-device models usually don't, but this is cheap
 * and defensive either way.
 */
export function sanitizeAnswer(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Preferred path: explicit ANSWER: tag at the end of the response.
  const tagged = trimmed.match(/(?:^|\n)\s*ANSWER\s*:\s*([^\n]+?)\s*$/i);
  if (tagged) return stripWrapping(tagged[1]);

  const looksStructured = /^\s*[-*•]/m.test(trimmed) || /\bDraft \d/i.test(trimmed) || trimmed.length > 400;

  if (!looksStructured) return stripWrapping(trimmed);

  // Prefer the last quoted sentence — models usually wrap the final answer.
  // Only match quoted sentences ending in . or ! — skip ? because models
  // echo the user question in quotes during reasoning.
  const quoted = [...trimmed.matchAll(/"([^"\n]{12,400}[.!])"/g)];
  if (quoted.length > 0) return stripWrapping(quoted[quoted.length - 1][1]);

  // Otherwise: scan lines from the bottom for the last prose sentence.
  const META = /^(draft|check|constraint|rule|goal|result|role|context|user question|question|time conversion|output format|search for|evidence|episodes?:|palaces?:)\b/i;
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const stripped = lines[i].replace(/^[-*•\s]+/, '').replace(/^\d+\.\s*/, '').trim();
    if (stripped.length < 12) continue;
    if (META.test(stripped)) continue;
    if (/^[`{\[]/.test(stripped)) continue;
    // Skip lines that are just an echoed question.
    if (/\?$/.test(stripped)) continue;
    if (/[.!]$/.test(stripped)) return stripWrapping(stripped);
  }
  return stripWrapping(lines[0] || trimmed);
}

function stripWrapping(s: string): string {
  return s.replace(/^["'`*_]+|["'`*_]+$/g, '').trim();
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const sfx = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${sfx}`;
}

/** Annotate palace ms timestamps with human-readable times so the model
 *  doesn't have to do epoch math (which it gets wrong). */
function annotatePalaceTimes(p: DailyMemoryPalace) {
  return {
    dayKey: p.dayKey,
    daySummary: p.daySummary,
    episodeCount: p.episodeCount,
    places: p.places.map(pl => ({
      label: pl.label,
      episodeIds: pl.episodeIds,
      firstSeenTime: formatClock(pl.firstSeenMs),
      lastSeenTime: formatClock(pl.lastSeenMs),
    })),
    segments: p.segments.map(s => ({
      startTime: formatClock(s.startMs),
      endTime: formatClock(s.endMs),
      placeLabel: s.placeLabel,
      activity: s.activity,
    })),
    objectLastSeen: p.objectLastSeen.map(o => ({
      object: o.object,
      lastSeenTime: formatClock(o.lastSeenMs),
      placeLabel: o.placeLabel,
    })),
  };
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
    palaces: evidence.palaces.map(annotatePalaceTimes),
  });

  let answer: string;
  try {
    const result = await mainLM.completion([
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      { role: 'user', content: `Question: ${query}\nContext JSON:\n${contextBlock}` },
    ]);
    const response = result.content ?? result.text ?? '';
    answer = sanitizeAnswer(response);
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
