// Self-contained test runner for the episodic memory pipeline.
// Run with: node scripts/test-memory.mjs
//
// Exercises pure logic from the memory/Router modules (ported inline here
// because the TS modules import RN-only packages). If GEMMA_API_KEY is set,
// also makes a real cloud Gemma call with the encoder prompt on a test image
// and verifies the response parses into a valid EpisodeRecord.
//
// IMPORTANT: the pure logic below MUST match what's in src/. If you change
// one, update the other.

import { readFileSync } from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n━━ ${name} ━━`); }

// ─── Pure logic (mirrors src/modules/Router.ts + memory/*) ────────────────

const DESKTOP_HINT = /\b(email|inbox|draft|reply|send|calendar|schedule|spreadsheet|file|pr\b|pull request|slack|open (gmail|chrome|safari)|my laptop|my (mac|computer))\b/i;
const VISION_HINT = /\b(what('s| is) this|what am i looking at|read this|on my desk|in front of me|describe (this|what))\b/i;
const MEMORY_HINT = /\b(today|yesterday|earlier|this morning|this afternoon|this evening|last (time|saw)|where did i (leave|put|go|last)|when did i|what did i do|have i (seen|been)|did i (see|go|leave|put))\b/i;
const CODE_HINT = /\b(code|write a (function|script|program)|regex|algorithm|implement|debug|stack trace|typescript|python|swift)\b/i;
const PLAN_HINT = /\b(plan|steps?|outline|compare|pros and cons|trade[- ]?offs?|strateg(y|ies)|break (this|it) down|analy[sz]e)\b/i;

function heuristicRoute(prompt, hasImage, cloudConfigured = false) {
  if (MEMORY_HINT.test(prompt))
    return { route: 'memory_query', reason: 'temporal-past hint' };
  if (hasImage || VISION_HINT.test(prompt))
    return { route: 'vision_query', reason: 'image or vision hint' };
  if (DESKTOP_HINT.test(prompt))
    return { route: 'desktop_action', reason: 'desktop verb' };
  if (!cloudConfigured)
    return { route: 'local_answer', reason: 'cloud disabled' };
  if (prompt.length >= 600 || CODE_HINT.test(prompt) || PLAN_HINT.test(prompt))
    return { route: 'cloud_answer', reason: 'complexity' };
  return null;
}

function dayKeyFromTimestamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function coerceEpisode(raw, timestampMs) {
  const sceneSummary = typeof raw.sceneSummary === 'string' ? raw.sceneSummary.trim() : '';
  const placeLabel = typeof raw.placeLabel === 'string' ? raw.placeLabel.trim() : '';
  if (!sceneSummary || !placeLabel) return null;
  const objects = Array.isArray(raw.objects)
    ? raw.objects.filter(x => typeof x === 'string').map(s => s.trim()).filter(Boolean) : [];
  const ocrText = Array.isArray(raw.ocrText)
    ? raw.ocrText.filter(x => typeof x === 'string').map(s => s.trim()).filter(Boolean) : [];
  const activityHint = typeof raw.activityHint === 'string' ? raw.activityHint.trim() : '';
  const salience = typeof raw.salience === 'number' && raw.salience >= 0 && raw.salience <= 1
    ? raw.salience : 0.5;
  return {
    id: `ep_${timestampMs}_xxx`,
    timestampMs,
    dayKey: dayKeyFromTimestamp(timestampMs),
    sceneSummary, placeLabel, objects, ocrText, activityHint, salience,
  };
}

const STOP = new Set(['the','a','an','is','are','was','were','my','me','i','to','of','in','on','at','and','or','it','that','this','did','do','have','had','what','when','where','how','why','today','yesterday','last','time','ago','for','with','about','be','been','just','you','your']);
function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
}

function scoreEpisode(ep, tokens) {
  if (tokens.length === 0) return 0;
  const hay = [ep.sceneSummary, ep.placeLabel, ep.activityHint, ep.objects.join(' '), ep.ocrText.join(' ')].join(' ').toLowerCase();
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits++;
  return hits;
}

function buildObjectLastSeen(episodes) {
  const map = new Map();
  for (const ep of episodes) {
    for (const obj of ep.objects) {
      const key = obj.toLowerCase();
      const prev = map.get(key);
      if (!prev || ep.timestampMs > prev.lastSeenMs) {
        map.set(key, { object: obj, lastSeenMs: ep.timestampMs, placeLabel: ep.placeLabel, episodeId: ep.id });
      }
    }
  }
  return [...map.values()].sort((a,b) => b.lastSeenMs - a.lastSeenMs);
}

function normalizeLabel(s) { return s.toLowerCase().trim().replace(/\s+/g, ' '); }

function fallbackPalace(dayKey, episodes) {
  const placesMap = new Map();
  const segments = [];
  let cur = null;
  for (const ep of episodes) {
    const key = normalizeLabel(ep.placeLabel);
    const node = placesMap.get(key);
    if (node) { node.episodeIds.push(ep.id); node.lastSeenMs = Math.max(node.lastSeenMs, ep.timestampMs); }
    else placesMap.set(key, { label: ep.placeLabel, episodeIds: [ep.id], firstSeenMs: ep.timestampMs, lastSeenMs: ep.timestampMs });
    if (!cur || normalizeLabel(cur.placeLabel) !== key) {
      if (cur) segments.push(cur);
      cur = { startMs: ep.timestampMs, endMs: ep.timestampMs, placeLabel: ep.placeLabel, activity: ep.activityHint || '' };
    } else { cur.endMs = ep.timestampMs; }
  }
  if (cur) segments.push(cur);
  return { dayKey, places: [...placesMap.values()], segments, objectLastSeen: buildObjectLastSeen(episodes), daySummary: '', episodeCount: episodes.length };
}

// ─── Tests ────────────────────────────────────────────────────────────────

section('Router heuristics');
assert(heuristicRoute('where did I leave my keys', false).route === 'memory_query', 'memory hint: "where did I leave my keys" → memory_query');
assert(heuristicRoute('what did I do today', false).route === 'memory_query', '"what did I do today" → memory_query');
assert(heuristicRoute('when did I last see my glasses', false).route === 'memory_query', '"when did I last see" → memory_query');
assert(heuristicRoute('where did I leave my glasses', true).route === 'memory_query', 'memory overrides image when both present');
assert(heuristicRoute('what is this', false).route === 'vision_query', '"what is this" → vision_query');
assert(heuristicRoute("what's this", true).route === 'vision_query', 'image + vision hint → vision_query');
assert(heuristicRoute('send an email to bob', false, true).route === 'desktop_action', 'desktop hint → desktop_action');
assert(heuristicRoute('tell me a joke', false, false).route === 'local_answer', 'no cloud → local_answer');
assert(heuristicRoute('hello', false, true) === null, 'plain chit-chat with cloud → null (defer to model router)');

section('dayKeyFromTimestamp');
const ts = new Date('2026-04-18T15:30:00').getTime();
assert(dayKeyFromTimestamp(ts) === '2026-04-18', 'formats YYYY-MM-DD');

section('extractJson + coerceEpisode');
const goodResp = '  some junk {"sceneSummary":"Kitchen counter with coffee maker","placeLabel":"home kitchen","objects":["coffee maker","mug"],"ocrText":[],"activityHint":"making coffee","salience":0.6}  trailing';
const parsed = extractJson(goodResp);
assert(parsed !== null, 'extracts JSON from response with prose around it');
const ep1 = coerceEpisode(parsed, 1700000000000);
assert(ep1 !== null && ep1.placeLabel === 'home kitchen', 'coerces to EpisodeRecord');
assert(ep1.objects.length === 2 && ep1.objects[0] === 'coffee maker', 'objects preserved');
assert(ep1.salience === 0.6, 'salience preserved');
assert(ep1.dayKey === dayKeyFromTimestamp(1700000000000), 'dayKey derived from timestamp');

const bad1 = coerceEpisode({}, Date.now());
assert(bad1 === null, 'rejects empty object (missing required fields)');
const bad2 = coerceEpisode({ sceneSummary: 'x', placeLabel: '' }, Date.now());
assert(bad2 === null, 'rejects empty placeLabel');
const bad3 = coerceEpisode({ sceneSummary: 'x', placeLabel: 'y' }, Date.now());
assert(bad3 !== null && bad3.salience === 0.5, 'defaults salience to 0.5');
assert(bad3.objects.length === 0, 'defaults missing objects to []');

const mangled = extractJson('the model went off and said some words with no json');
assert(mangled === null, 'returns null when no JSON found');

const dirtyArr = coerceEpisode({ sceneSummary: 'x', placeLabel: 'y', objects: ['a', 42, '', 'b'] }, Date.now());
assert(dirtyArr.objects.length === 2 && dirtyArr.objects[0] === 'a' && dirtyArr.objects[1] === 'b', 'filters non-strings/empty from objects');

section('tokenize + scoreEpisode');
assert(tokenize('where did I leave my keys').join(',') === 'leave,keys', 'strips stopwords');
assert(tokenize('What were the OCR values on my Receipt?').join(',') === 'ocr,values,receipt', 'case-insensitive, strips punctuation');

const testEps = [
  { id: 'e1', sceneSummary: 'Car keys on kitchen counter', placeLabel: 'home kitchen', objects: ['keys','counter'], ocrText: [], activityHint: 'arrived home', timestampMs: 100 },
  { id: 'e2', sceneSummary: 'Laptop open at desk', placeLabel: 'office desk', objects: ['laptop'], ocrText: [], activityHint: 'working', timestampMs: 200 },
  { id: 'e3', sceneSummary: 'Coffee mug on counter', placeLabel: 'home kitchen', objects: ['mug','counter'], ocrText: [], activityHint: 'drinking', timestampMs: 300 },
];
const toks = tokenize('where are my keys');
const scores = testEps.map(ep => scoreEpisode(ep, toks));
assert(scores[0] > scores[1] && scores[0] > scores[2], 'episode with "keys" scores highest');

section('buildObjectLastSeen');
const sight = buildObjectLastSeen(testEps);
const counter = sight.find(s => s.object.toLowerCase() === 'counter');
assert(counter && counter.lastSeenMs === 300, 'counter last seen at ep3 (ts=300)');
assert(counter.placeLabel === 'home kitchen', 'places tracked correctly');
const keys = sight.find(s => s.object.toLowerCase() === 'keys');
assert(keys && keys.episodeId === 'e1', 'keys last seen on ep1');

section('fallbackPalace');
const eps2 = [
  { id: 'a', timestampMs: 100, placeLabel: 'home kitchen', sceneSummary: 's1', activityHint: 'a1', objects: ['x'], ocrText: [] },
  { id: 'b', timestampMs: 200, placeLabel: 'Home Kitchen', sceneSummary: 's2', activityHint: 'a2', objects: ['y'], ocrText: [] },
  { id: 'c', timestampMs: 300, placeLabel: 'office desk', sceneSummary: 's3', activityHint: 'a3', objects: [], ocrText: [] },
  { id: 'd', timestampMs: 400, placeLabel: 'home kitchen', sceneSummary: 's4', activityHint: 'a4', objects: [], ocrText: [] },
];
const pal = fallbackPalace('2026-04-18', eps2);
assert(pal.places.length === 2, 'merges "home kitchen" and "Home Kitchen" into one place node');
assert(pal.segments.length === 3, 'creates 3 segments (kitchen → desk → kitchen)');
assert(pal.segments[0].placeLabel.toLowerCase().includes('kitchen'), 'seg 1 is kitchen');
assert(pal.segments[1].placeLabel === 'office desk', 'seg 2 is desk');
assert(pal.segments[2].placeLabel === 'home kitchen', 'seg 3 is kitchen again');
assert(pal.episodeCount === 4, 'episodeCount correct');

// ─── Mock CactusLM — mimic Gemma returning structured JSON ────────────────

section('End-to-end pipeline (mock CactusLM)');

const cannedResponses = [
  '{"sceneSummary":"A kitchen counter with car keys and a coffee mug","placeLabel":"home kitchen","objects":["car keys","coffee mug","counter"],"ocrText":[],"activityHint":"just got home","salience":0.7}',
  '{"sceneSummary":"A laptop displaying code in a text editor","placeLabel":"office desk","objects":["laptop","monitor"],"ocrText":["useJarvis.ts"],"activityHint":"coding","salience":0.5}',
  '{"sceneSummary":"Kitchen counter with only a coffee mug","placeLabel":"home kitchen","objects":["coffee mug"],"ocrText":[],"activityHint":"finishing coffee","salience":0.4}',
];
let callIdx = 0;
const mockLM = {
  async complete({ messages }) {
    const sys = messages.find(m => m.role === 'system')?.content || '';
    if (sys.includes('compress a day of episodic memory')) {
      // DailyPalaceBuilder prompt — return canonical palace JSON
      return { response: JSON.stringify({
        places: [
          { label: 'home kitchen', episodeIds: ['ep_100_xxx', 'ep_300_xxx'] },
          { label: 'office desk', episodeIds: ['ep_200_xxx'] },
        ],
        segments: [
          { startMs: 100, endMs: 100, placeLabel: 'home kitchen', activity: 'just got home' },
          { startMs: 200, endMs: 200, placeLabel: 'office desk', activity: 'coding' },
          { startMs: 300, endMs: 300, placeLabel: 'home kitchen', activity: 'finishing coffee' },
        ],
        daySummary: 'Split the day between home kitchen and office desk.',
      })};
    }
    if (sys.includes('answer spoken questions')) {
      return { response: 'Your keys are in the home kitchen — I saw them on the counter around the start of the day.' };
    }
    // Encoder
    return { response: cannedResponses[callIdx++ % cannedResponses.length] };
  },
};

async function encodeEpisodeMock(lm, imageBase64, timestampMs, prevPlaceLabel) {
  const sys = 'You are an on-device visual memory encoder' + (prevPlaceLabel ? `. prev=${prevPlaceLabel}` : '');
  const { response } = await lm.complete({
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: 'encode', images: [imageBase64] },
    ],
  });
  const parsed = extractJson(response);
  if (!parsed) return null;
  const ep = coerceEpisode(parsed, timestampMs);
  if (!ep) return null;
  return { ...ep, id: `ep_${timestampMs}_xxx` };
}

const ep1r = await encodeEpisodeMock(mockLM, 'BASE64DATA', 100, null);
assert(ep1r && ep1r.placeLabel === 'home kitchen', 'encode #1 → home kitchen');
const ep2r = await encodeEpisodeMock(mockLM, 'BASE64DATA', 200, ep1r.placeLabel);
assert(ep2r && ep2r.placeLabel === 'office desk', 'encode #2 → office desk');
const ep3r = await encodeEpisodeMock(mockLM, 'BASE64DATA', 300, ep2r.placeLabel);
assert(ep3r && ep3r.placeLabel === 'home kitchen', 'encode #3 → home kitchen again');

const encoded = [ep1r, ep2r, ep3r];
assert(encoded.every(e => e !== null), 'all encodes succeeded');

// Palace compression via mock LM
const palaceCompactInput = encoded.map(e => ({ id: e.id, t: e.timestampMs, place: e.placeLabel, scene: e.sceneSummary, activity: e.activityHint }));
const palaceResp = await mockLM.complete({
  messages: [
    { role: 'system', content: 'You compress a day of episodic memory from smart-glasses frames' },
    { role: 'user', content: JSON.stringify(palaceCompactInput) },
  ],
});
const palaceJson = extractJson(palaceResp.response);
assert(palaceJson && palaceJson.places.length === 2, 'palace compression returns 2 places');
assert(palaceJson.segments.length === 3, 'palace segments = 3');

// Query answering
const query = 'where did I leave my keys today';
const queryToks = tokenize(query);
const sorted = encoded.map(ep => ({ ep, s: scoreEpisode(ep, queryToks) })).sort((a,b) => b.s - a.s);
assert(sorted[0].ep.id === ep1r.id, 'top-scored episode is the one mentioning keys');

const answerResp = await mockLM.complete({
  messages: [
    { role: 'system', content: 'You answer spoken questions about the user\'s episodic memory' },
    { role: 'user', content: `Question: ${query}\nContext: ${JSON.stringify(sorted.slice(0,3).map(x => x.ep))}` },
  ],
});
assert(answerResp.response.toLowerCase().includes('kitchen'), 'synthesized answer mentions kitchen');

// ─── Live cloud Gemma test (only if GEMMA_API_KEY is set) ─────────────────

section('Live cloud Gemma encoder call');
const envKey = process.env.GEMMA_API_KEY;
if (!envKey) {
  console.log('  ⚠ skipped — set GEMMA_API_KEY to run real encoder against cloud Gemma');
} else {
  // Use a tiny 1x1 red PNG as the image payload (we're testing the call path,
  // not recognition quality — Gemma may refuse or hallucinate, which is fine).
  // Real test: does the prompt+parse pipeline work against a real model?
  const tinyJpegB64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAf/2gAMAwEAAhADEAAAABP/2gAIAQEAAT8Af//Z';
  const encoderPrompt = `You are an on-device visual memory encoder. You will be given a single frame.

Return a single line of strict minified JSON with these exact fields:
{"sceneSummary":"...","placeLabel":"...","objects":[...],"ocrText":[...],"activityHint":"...","salience":0.5}

Return ONLY the JSON object. No prose, no markdown.`;

  const model = process.env.GEMMA_CLOUD_MODEL || 'gemma-4-27b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${envKey}`;
  console.log(`  → POST ${model}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: encoderPrompt + '\n\nEncode this frame.' },
            { inline_data: { mime_type: 'image/jpeg', data: tinyJpegB64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 256, temperature: 0.3 },
      }),
    });
    assert(res.ok, `HTTP ${res.status} from Gemma`);
    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log(`  ← raw response: ${(text || '').slice(0, 200)}${(text || '').length > 200 ? '…' : ''}`);
      assert(typeof text === 'string', 'response contains text');
      const parsedReal = extractJson(text || '');
      assert(parsedReal !== null, 'real Gemma response contains parseable JSON');
      if (parsedReal) {
        const realEp = coerceEpisode(parsedReal, Date.now());
        assert(realEp !== null, 'parsed JSON coerces to valid EpisodeRecord');
        if (realEp) console.log(`  ← EpisodeRecord: place="${realEp.placeLabel}" objects=[${realEp.objects.slice(0,3).join(',')}]`);
      }
    } else {
      console.log(`  ← error body: ${(await res.text()).slice(0, 300)}`);
    }
  } catch (err) {
    fail++;
    failures.push(`live Gemma call threw: ${err.message}`);
    console.log(`  ✗ threw: ${err.message}`);
  }
}

// ─── sanitizeAnswer unit tests ────────────────────────────────────────────

section('sanitizeAnswer');
function stripWrappingT(s) { return s.replace(/^["'`*_]+|["'`*_]+$/g, '').trim(); }
function sanitizeAnswerT(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return trimmed;
  const tagged = trimmed.match(/(?:^|\n)\s*ANSWER\s*:\s*([^\n]+?)\s*$/i);
  if (tagged) return stripWrappingT(tagged[1]);
  const looksStructured = /^\s*[-*•]/m.test(trimmed) || /\bDraft \d/i.test(trimmed) || trimmed.length > 400;
  if (!looksStructured) return stripWrappingT(trimmed);
  const quoted = [...trimmed.matchAll(/"([^"\n]{12,400}[.!])"/g)];
  if (quoted.length > 0) return stripWrappingT(quoted[quoted.length - 1][1]);
  const META = /^(draft|check|constraint|rule|goal|result|role|context|user question|question|time conversion|output format|search for|evidence|episodes?:|palaces?:)\b/i;
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].replace(/^[-*•\s]+/, '').replace(/^\d+\.\s*/, '').trim();
    if (s.length < 12) continue;
    if (META.test(s)) continue;
    if (/^[`{\[]/.test(s)) continue;
    if (/\?$/.test(s)) continue;
    if (/[.!]$/.test(s)) return stripWrappingT(s);
  }
  return stripWrappingT(lines[0] || trimmed);
}

assert(sanitizeAnswerT('ANSWER: You left your keys on the kitchen counter around 3pm.') === 'You left your keys on the kitchen counter around 3pm.', 'ANSWER: tag extraction');
const taggedDump = `*   Let me think about this.
*   Drafting answer.
ANSWER: You left your bag at Blue Bottle around 2:30pm.`;
assert(sanitizeAnswerT(taggedDump) === 'You left your bag at Blue Bottle around 2:30pm.', 'ANSWER: tag wins over bullets');
assert(sanitizeAnswerT('You left your keys on the kitchen counter around 3pm.') === 'You left your keys on the kitchen counter around 3pm.', 'short clean answer pass-through');
assert(sanitizeAnswerT('"You left your keys on the counter."') === 'You left your keys on the counter.', 'strips surrounding quotes');
const geminiDump = `*   Draft 1: You left your shopping bag at Blue Bottle.
*   Check constraints: 1-2 sentences? Yes.
*   Final answer: "You left your shopping bag at Blue Bottle Coffee Omotesando around 2:30pm yesterday."
*   Check: Yes all rules satisfied.`;
const cleaned = sanitizeAnswerT(geminiDump);
assert(cleaned.includes('Blue Bottle') && cleaned.length < 150, `extracts final quoted answer from Gemma dump: "${cleaned}"`);
assert(sanitizeAnswerT('I\'m not sure.') === "I'm not sure.", 'short uncertainty answer');
assert(sanitizeAnswerT('') === '', 'empty input');
const bulletDump = `* Role: Smart glasses.
* User asked about keys.
* Evidence: keys on counter at 3pm.
* The final answer is: You left your keys on the kitchen counter around 3pm.`;
const bulletClean = sanitizeAnswerT(bulletDump);
assert(bulletClean.includes('kitchen counter') && !bulletClean.startsWith('Role'), `pulls last prose line from bullet dump: "${bulletClean}"`);

// ─── Realistic scenario: 4-day Tokyo→Kyoto trip ───────────────────────────
// 3 past-day palaces (compressed) + today's in-progress raw episodes.
// Runs two queries: one targeting past episodic memory, one targeting
// realtime (today). Uses real cloud Gemma for answer synthesis.

section('Realistic scenario — travel recall');

const GEMMA_KEY = process.env.GEMMA_API_KEY;
const GEMMA_MODEL = process.env.GEMMA_CLOUD_MODEL || 'gemma-4-31b-it';

if (!GEMMA_KEY) {
  console.log('  ⚠ skipped — set GEMMA_API_KEY to run the scenario');
} else {
  // Time helpers anchored to the repo's "today" (2026-04-18). Use noon anchors
  // so timezone wobble can't shift the dayKey.
  const hmDay = (dayOffset, h, m = 0) => {
    const d = new Date(2026, 3, 18); // 2026-04-18
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  // ─── Past palaces ──────────────────────────────────────────────────────
  const palaces = [
    {
      dayKey: '2026-04-15',
      daySummary: 'Arrived in Tokyo. Took the Narita Express into Shibuya, checked into the hotel, and had ramen for dinner at Ichiran.',
      places: [
        { label: 'Narita Airport', episodeIds: ['d1_a1','d1_a2'], firstSeenMs: hmDay(-3, 10), lastSeenMs: hmDay(-3, 11, 30) },
        { label: 'Narita Express train', episodeIds: ['d1_t1','d1_t2'], firstSeenMs: hmDay(-3, 12), lastSeenMs: hmDay(-3, 13, 15) },
        { label: 'Shibuya Excel Hotel lobby', episodeIds: ['d1_h1'], firstSeenMs: hmDay(-3, 14), lastSeenMs: hmDay(-3, 14, 30) },
        { label: 'Shibuya Excel Hotel room 1804', episodeIds: ['d1_h2','d1_h3'], firstSeenMs: hmDay(-3, 15), lastSeenMs: hmDay(-3, 18) },
        { label: 'Ichiran Ramen Shibuya', episodeIds: ['d1_r1','d1_r2'], firstSeenMs: hmDay(-3, 19), lastSeenMs: hmDay(-3, 20, 15) },
      ],
      segments: [
        { startMs: hmDay(-3,10), endMs: hmDay(-3,11,30), placeLabel: 'Narita Airport', activity: 'clearing customs and collecting luggage' },
        { startMs: hmDay(-3,12), endMs: hmDay(-3,13,15), placeLabel: 'Narita Express train', activity: 'riding into Tokyo with suitcase' },
        { startMs: hmDay(-3,14), endMs: hmDay(-3,18), placeLabel: 'Shibuya Excel Hotel', activity: 'checking in and resting' },
        { startMs: hmDay(-3,19), endMs: hmDay(-3,20,15), placeLabel: 'Ichiran Ramen Shibuya', activity: 'eating tonkotsu ramen' },
      ],
      objectLastSeen: [
        { object: 'suitcase', lastSeenMs: hmDay(-3,14,30), placeLabel: 'Shibuya Excel Hotel room 1804', episodeId: 'd1_h2' },
        { object: 'passport', lastSeenMs: hmDay(-3,14), placeLabel: 'Shibuya Excel Hotel lobby', episodeId: 'd1_h1' },
        { object: 'JR rail pass', lastSeenMs: hmDay(-3,13,15), placeLabel: 'Narita Express train', episodeId: 'd1_t2' },
      ],
      episodeCount: 9,
    },
    {
      dayKey: '2026-04-16',
      daySummary: 'Tourist day. Senso-ji temple in the morning, Akihabara electronics shopping in the afternoon, izakaya dinner in Shinjuku.',
      places: [
        { label: 'Senso-ji Temple', episodeIds: ['d2_t1','d2_t2'], firstSeenMs: hmDay(-2, 9), lastSeenMs: hmDay(-2, 11) },
        { label: 'Nakamise shopping street', episodeIds: ['d2_n1'], firstSeenMs: hmDay(-2, 11, 15), lastSeenMs: hmDay(-2, 12) },
        { label: 'Akihabara electronics arcade', episodeIds: ['d2_a1','d2_a2','d2_a3'], firstSeenMs: hmDay(-2, 14), lastSeenMs: hmDay(-2, 17) },
        { label: 'Omoide Yokocho izakaya (Shinjuku)', episodeIds: ['d2_s1'], firstSeenMs: hmDay(-2, 19), lastSeenMs: hmDay(-2, 21) },
      ],
      segments: [
        { startMs: hmDay(-2,9), endMs: hmDay(-2,12), placeLabel: 'Asakusa (Senso-ji / Nakamise)', activity: 'temple visit and souvenir browsing' },
        { startMs: hmDay(-2,14), endMs: hmDay(-2,17), placeLabel: 'Akihabara electronics arcade', activity: 'buying a mechanical keyboard' },
        { startMs: hmDay(-2,19), endMs: hmDay(-2,21), placeLabel: 'Omoide Yokocho izakaya', activity: 'yakitori and sake with locals' },
      ],
      objectLastSeen: [
        { object: 'camera', lastSeenMs: hmDay(-2,11), placeLabel: 'Senso-ji Temple', episodeId: 'd2_t2' },
        { object: 'omamori amulet', lastSeenMs: hmDay(-2,11,15), placeLabel: 'Nakamise shopping street', episodeId: 'd2_n1' },
        { object: 'HHKB keyboard box', lastSeenMs: hmDay(-2,17), placeLabel: 'Akihabara electronics arcade', episodeId: 'd2_a3' },
        { object: 'sake cup', lastSeenMs: hmDay(-2,21), placeLabel: 'Omoide Yokocho izakaya', episodeId: 'd2_s1' },
      ],
      episodeCount: 7,
    },
    {
      dayKey: '2026-04-17',
      daySummary: 'Harajuku and Omotesando. Met Hiro for coffee at Blue Bottle, then Meiji Shrine. Did some shopping on Takeshita Street.',
      places: [
        { label: 'Takeshita Street (Harajuku)', episodeIds: ['d3_h1','d3_h2'], firstSeenMs: hmDay(-1, 10), lastSeenMs: hmDay(-1, 12) },
        { label: 'Blue Bottle Coffee Omotesando', episodeIds: ['d3_c1','d3_c2'], firstSeenMs: hmDay(-1, 13), lastSeenMs: hmDay(-1, 14, 30) },
        { label: 'Meiji Shrine', episodeIds: ['d3_m1'], firstSeenMs: hmDay(-1, 15), lastSeenMs: hmDay(-1, 16, 30) },
        { label: 'Shibuya Excel Hotel room 1804', episodeIds: ['d3_r1'], firstSeenMs: hmDay(-1, 18), lastSeenMs: hmDay(-1, 22) },
      ],
      segments: [
        { startMs: hmDay(-1,10), endMs: hmDay(-1,12), placeLabel: 'Takeshita Street (Harajuku)', activity: 'shopping — bought a shirt and a canvas tote' },
        { startMs: hmDay(-1,13), endMs: hmDay(-1,14,30), placeLabel: 'Blue Bottle Coffee Omotesando', activity: 'catching up with Hiro over lattes' },
        { startMs: hmDay(-1,15), endMs: hmDay(-1,16,30), placeLabel: 'Meiji Shrine', activity: 'walking the forest path' },
        { startMs: hmDay(-1,18), endMs: hmDay(-1,22), placeLabel: 'Shibuya Excel Hotel room 1804', activity: 'back at hotel, packing for Kyoto' },
      ],
      objectLastSeen: [
        // Key piece of information for query #1:
        { object: 'Takeshita shopping bag', lastSeenMs: hmDay(-1,14,30), placeLabel: 'Blue Bottle Coffee Omotesando', episodeId: 'd3_c2' },
        { object: 'canvas tote', lastSeenMs: hmDay(-1,12), placeLabel: 'Takeshita Street (Harajuku)', episodeId: 'd3_h2' },
        { object: 'Hiro (friend)', lastSeenMs: hmDay(-1,14,30), placeLabel: 'Blue Bottle Coffee Omotesando', episodeId: 'd3_c2' },
        { object: 'shrine charm', lastSeenMs: hmDay(-1,16,30), placeLabel: 'Meiji Shrine', episodeId: 'd3_m1' },
      ],
      episodeCount: 6,
    },
  ];

  // ─── Today's raw episodes — realtime Kyoto morning ─────────────────────
  const todayEpisodes = [
    { id: 't01', timestampMs: hmDay(0, 7, 15), placeLabel: 'Shibuya Excel Hotel room 1804',
      sceneSummary: 'Hotel room with packed suitcase on the bed and passport on the desk.',
      objects: ['suitcase','passport','JR rail pass'], ocrText: [], activityHint: 'packing up to check out', salience: 0.6 },
    { id: 't02', timestampMs: hmDay(0, 7, 45), placeLabel: 'Shibuya Excel Hotel breakfast room',
      sceneSummary: 'Buffet breakfast, plate of rice and miso soup, coffee.',
      objects: ['rice bowl','miso soup','coffee cup'], ocrText: [], activityHint: 'eating breakfast', salience: 0.3 },
    { id: 't03', timestampMs: hmDay(0, 8, 30), placeLabel: 'Shibuya Station JR platform',
      sceneSummary: 'Crowded JR platform, signs for the Tokaido Shinkansen.',
      objects: ['suitcase','JR rail pass','station signage'], ocrText: ['のぞみ','Nozomi','14'], activityHint: 'waiting for the Shinkansen', salience: 0.5 },
    { id: 't04', timestampMs: hmDay(0, 9, 5), placeLabel: 'Tokaido Shinkansen Nozomi 14',
      sceneSummary: 'Inside the shinkansen, reserved seat, Mount Fuji visible out the window.',
      objects: ['train ticket','window view','Mount Fuji'], ocrText: ['Car 7','12A'], activityHint: 'riding to Kyoto', salience: 0.8 },
    { id: 't05', timestampMs: hmDay(0, 10, 0), placeLabel: 'Tokaido Shinkansen Nozomi 14',
      sceneSummary: 'Ekiben bento box on tray table, chopsticks.',
      objects: ['ekiben','chopsticks','green tea'], ocrText: [], activityHint: 'eating on the train', salience: 0.35 },
    { id: 't06', timestampMs: hmDay(0, 11, 15), placeLabel: 'Kyoto Station concourse',
      sceneSummary: 'Grand Kyoto Station atrium, light streaming through the roof.',
      objects: ['suitcase','station signage'], ocrText: ['Kyoto','京都','Exit'], activityHint: 'arriving in Kyoto', salience: 0.7 },
    { id: 't07', timestampMs: hmDay(0, 11, 40), placeLabel: 'Kyoto coin locker area',
      sceneSummary: 'Row of coin lockers, I used locker B-42 to stash my suitcase.',
      objects: ['suitcase','coin locker','locker key'], ocrText: ['B-42','¥700'], activityHint: 'storing suitcase', salience: 0.9 },
    { id: 't08', timestampMs: hmDay(0, 12, 5), placeLabel: 'Nara Line platform (Kyoto Station)',
      sceneSummary: 'Local train platform for JR Nara Line heading to Inari.',
      objects: ['JR rail pass'], ocrText: ['Inari','稲荷'], activityHint: 'waiting for Inari local', salience: 0.4 },
    { id: 't09', timestampMs: hmDay(0, 12, 30), placeLabel: 'Fushimi Inari Taisha entrance',
      sceneSummary: 'Large vermilion torii gate at the shrine entrance, crowds.',
      objects: ['torii gate','shrine map'], ocrText: ['Fushimi Inari'], activityHint: 'arriving at shrine', salience: 0.85 },
    { id: 't10', timestampMs: hmDay(0, 13, 10), placeLabel: 'Fushimi Inari torii tunnels',
      sceneSummary: 'Endless tunnel of small orange torii gates climbing the mountain.',
      objects: ['torii gates','stone fox statue'], ocrText: [], activityHint: 'climbing through senbon torii', salience: 0.95 },
    { id: 't11', timestampMs: hmDay(0, 13, 50), placeLabel: 'Fushimi Inari midway rest area',
      sceneSummary: 'Small teahouse halfway up, matcha soft-serve and bottle of water.',
      objects: ['matcha soft serve','water bottle'], ocrText: ['抹茶'], activityHint: 'resting with matcha ice cream', salience: 0.4 },
    { id: 't12', timestampMs: hmDay(0, 14, 20), placeLabel: 'Fushimi Inari summit (Yotsutsuji)',
      sceneSummary: 'Yotsutsuji intersection viewpoint overlooking Kyoto.',
      objects: ['city view','torii gate'], ocrText: [], activityHint: 'taking photos of the view', salience: 0.9 },
  ];

  // ─── Port retrieval helpers (copy from MemoryQueryEngine.ts) ──────────
  function parseQueryScope(query) {
    const q = query.toLowerCase();
    if (/\byesterday\b/.test(q)) return { focusDayKey: '2026-04-17', includeWindow: false };
    if (/\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b|\bearlier\b|\bjust now\b/.test(q))
      return { focusDayKey: '2026-04-18', includeWindow: false };
    return { focusDayKey: null, includeWindow: true };
  }

  function gatherEvidence(query) {
    const scope = parseQueryScope(query);
    const toks = tokenize(query);

    if (scope.focusDayKey === '2026-04-18') {
      // Today focus: return whole day time-sorted, no keyword filtering.
      const sorted = [...todayEpisodes].sort((a,b) => a.timestampMs - b.timestampMs).slice(0, 40);
      return {
        dayKey: '2026-04-18',
        episodes: sorted.map(ep => ({
          id: ep.id, time: formatTime(ep.timestampMs), placeLabel: ep.placeLabel,
          sceneSummary: ep.sceneSummary, activityHint: ep.activityHint, objects: ep.objects,
        })),
        palaces: [],
        confidence: sorted.length > 0 ? 'high' : 'none',
      };
    }
    if (scope.focusDayKey) {
      const pal = palaces.find(p => p.dayKey === scope.focusDayKey);
      return { dayKey: scope.focusDayKey, episodes: [], palaces: pal ? [pal] : [], confidence: pal ? 'high' : 'none' };
    }
    // window mode — today raw + all past palaces
    const scored = todayEpisodes.map(ep => ({ ep, s: scoreEpisode(ep, toks) })).sort((a,b) => b.s - a.s);
    const withHits = scored.filter(x => x.s > 0).slice(0, 10);
    return {
      dayKey: '2026-04-18',
      episodes: withHits.map(({ep}) => ({
        id: ep.id, time: formatTime(ep.timestampMs), placeLabel: ep.placeLabel,
        sceneSummary: ep.sceneSummary, activityHint: ep.activityHint, objects: ep.objects,
      })),
      palaces,
      confidence: withHits.length ? 'high' : 'low',
    };
  }

  function formatTime(ms) {
    const d = new Date(ms);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2,'0');
    const sfx = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m}${sfx}`;
  }

  const ANSWER_SYSTEM = `You answer spoken questions about the user's episodic memory from smart-glasses frames.

REQUIRED output format — your response MUST end with exactly one line:
ANSWER: <your final spoken reply in 1-2 short sentences>

Anything you write before that line is ignored. The ANSWER line is the only thing the user hears.

Rules for the ANSWER line:
- Use the pre-formatted "time" strings in the context (e.g. "2:30pm"). Never compute times from raw millisecond values.
- Cite approximate time and place when relevant.
- If the evidence is weak or missing, write "ANSWER: I'm not sure." — never invent a location or time.
- Do not list raw episode IDs. Do not wrap the answer in quotes or markdown.
- Do not contradict the JSON context.`;

  function formatClock(ms) {
    const d = new Date(ms);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2,'0');
    const sfx = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m}${sfx}`;
  }
  function annotatePalace(p) {
    return {
      dayKey: p.dayKey, daySummary: p.daySummary, episodeCount: p.episodeCount,
      places: p.places.map(pl => ({ label: pl.label, episodeIds: pl.episodeIds, firstSeenTime: formatClock(pl.firstSeenMs), lastSeenTime: formatClock(pl.lastSeenMs) })),
      segments: p.segments.map(s => ({ startTime: formatClock(s.startMs), endTime: formatClock(s.endMs), placeLabel: s.placeLabel, activity: s.activity })),
      objectLastSeen: p.objectLastSeen.map(o => ({ object: o.object, lastSeenTime: formatClock(o.lastSeenMs), placeLabel: o.placeLabel })),
    };
  }

  function stripWrapping(s) { return s.replace(/^["'`*_]+|["'`*_]+$/g, '').trim(); }
  function sanitizeAnswer(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return trimmed;
    const tagged = trimmed.match(/(?:^|\n)\s*ANSWER\s*:\s*([^\n]+?)\s*$/i);
    if (tagged) return stripWrapping(tagged[1]);
    const looksStructured = /^\s*[-*•]/m.test(trimmed) || /\bDraft \d/i.test(trimmed) || trimmed.length > 400;
    if (!looksStructured) return stripWrapping(trimmed);
    const quoted = [...trimmed.matchAll(/"([^"\n]{12,400}[.!])"/g)];
    if (quoted.length > 0) return stripWrapping(quoted[quoted.length - 1][1]);
    const META = /^(draft|check|constraint|rule|goal|result|role|context|user question|question|time conversion|output format|search for|evidence|episodes?:|palaces?:)\b/i;
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = lines[i].replace(/^[-*•\s]+/, '').replace(/^\d+\.\s*/, '').trim();
      if (s.length < 12) continue;
      if (META.test(s)) continue;
      if (/^[`{\[]/.test(s)) continue;
      if (/\?$/.test(s)) continue;
      if (/[.!]$/.test(s)) return stripWrapping(s);
    }
    return stripWrapping(lines[0] || trimmed);
  }

  async function askGemma(question, evidence) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent?key=${GEMMA_KEY}`;
    const annotated = { ...evidence, palaces: (evidence.palaces || []).map(annotatePalace) };
    const userText = `${ANSWER_SYSTEM}\n\nQuestion: ${question}\nContext JSON:\n${JSON.stringify(annotated)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
      }),
    });
    if (!res.ok) return { raw: `[HTTP ${res.status}]`, clean: `[HTTP ${res.status}] ${(await res.text()).slice(0,120)}` };
    const j = await res.json();
    const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[empty]';
    return { raw, clean: sanitizeAnswer(raw) };
  }

  const runQuery = async (label, q, evidence) => {
    console.log(`\n  ❓ ${label}: "${q}"`);
    console.log(`     scope: dayKey=${evidence.dayKey}  confidence=${evidence.confidence}  palaces=${evidence.palaces.length}  episodes=${evidence.episodes.length}`);
    const { raw, clean } = await askGemma(q, evidence);
    const compression = raw.length > 0 ? (1 - clean.length / raw.length) : 0;
    console.log(`     📝 raw (${raw.length} chars): ${raw.slice(0, 140).replace(/\n/g, ' ⏎ ')}${raw.length > 140 ? '…' : ''}`);
    console.log(`     💬 clean (${clean.length} chars, ${(compression*100).toFixed(0)}% trimmed): ${clean}`);
    return clean;
  };

  // Query 1 — past episodic memory
  const ev1 = gatherEvidence('Hey, where did I leave that shopping bag from Harajuku yesterday?');
  const a1 = await runQuery('QUERY 1 (past)', 'Hey, where did I leave that shopping bag from Harajuku yesterday?', ev1);
  assert(/blue bottle|omotesando|coffee/i.test(a1), 'Q1 answer references Blue Bottle / Omotesando / coffee');
  assert(a1.length < 250, 'Q1 answer is short (under 250 chars)');

  // Query 2 — realtime (today)
  const ev2 = gatherEvidence('What have I been up to this morning?');
  const a2 = await runQuery('QUERY 2 (realtime)', 'What have I been up to this morning?', ev2);
  assert(/kyoto|shinkansen|fushimi|inari|torii/i.test(a2), 'Q2 answer references Kyoto / Shinkansen / Fushimi Inari');
  assert(a2.length < 250, 'Q2 answer is short (under 250 chars)');

  // Query 3 — realtime lost-item
  const ev3 = gatherEvidence('Where did I put my suitcase?');
  const a3 = await runQuery('QUERY 3 (realtime lost-item)', 'Where did I put my suitcase?', ev3);
  assert(/locker|b-?42|kyoto station/i.test(a3), 'Q3 answer points to Kyoto Station locker B-42');

  // Query 4 — no evidence, should admit
  const ev4 = gatherEvidence('Did I see any red pandas today?');
  const a4 = await runQuery('QUERY 4 (no evidence)', 'Did I see any red pandas today?', ev4);
  assert(/not sure|no(?!\w)|didn'?t|haven'?t|no (record|memory|evidence|mention)/i.test(a4), 'Q4 admits no evidence of red pandas');

  // Query 5 — explicit time citation test
  const ev5 = gatherEvidence('When did I meet Hiro?');
  const a5 = await runQuery('QUERY 5 (time citation)', 'When did I meet Hiro?', ev5);
  assert(/1:00pm|1:15pm|1:30pm|2:00pm|2:30pm|blue bottle|omotesando|afternoon|lunch|yesterday/i.test(a5), 'Q5 cites a pre-formatted time or the Blue Bottle meet');
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n━━ Results ━━\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
