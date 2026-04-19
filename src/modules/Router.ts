/**
 * Minimal shape Router depends on. Matches `RouterLM.complete` from
 * cactus-react-native but declared locally so the module compiles against
 * plain Node (for tests) without the bundler-conditional RN package entry.
 */
export interface RouterLM {
  complete(args: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  }): Promise<{ response: string }>;
}

export type Route =
  | 'local_answer'
  | 'cloud_answer'
  | 'vision_query'
  | 'desktop_action'
  | 'memory_query'
  | 'clarify';

export interface RouteDecision {
  route: Route;
  confidence: number;
  reason: string;
}

const CONFIDENCE_FLOOR = 0.55;

const ROUTER_SYSTEM_PROMPT = `You are Jarvis's on-device request router. Classify the user's spoken request into exactly one route.

Routes:
- local_answer: trivia, chit-chat, short factual Q&A, simple reasoning a small on-device model can handle.
- cloud_answer: long-context reasoning, multi-step plans, code generation, anything needing a larger model.
- vision_query: user is asking about what they're currently looking at (e.g. "what's this?", "read this", "what's on my desk?").
- memory_query: user is asking about the past — where they went, what they did, where they left something, when they last saw an object. Any reference to "today", "yesterday", "earlier", "last time", "where did I leave/put/go", "when did I".
- desktop_action: user wants their laptop to do something (send email, draft message, open app, find file, update spreadsheet).
- clarify: intent is genuinely ambiguous; a one-question follow-up would disambiguate.

Respond with a single line of strict minified JSON and nothing else:
{"route":"<route>","confidence":<0.0-1.0>,"reason":"<short phrase>"}`;

const DESKTOP_HINT = /\b(email|inbox|draft|reply|send|calendar|schedule|spreadsheet|file|pr\b|pull request|slack|open (gmail|chrome|safari)|my laptop|my (mac|computer))\b/i;
const MEMORY_HINT = /\b(today|yesterday|earlier|this morning|this afternoon|this evening|last (time|saw)|where did i (leave|put|go|last)|when did i|what did i do|have i (seen|been)|did i (see|go|leave|put))\b/i;
const VISION_HINT = /\b(what('s| is) this|what am i looking at|read this|on my desk|in front of me|describe (this|what))\b/i;
const CODE_HINT = /\b(code|write a (function|script|program)|regex|algorithm|implement|debug|stack trace|typescript|python|swift)\b/i;
const PLAN_HINT = /\b(plan|steps?|outline|compare|pros and cons|trade[- ]?offs?|strateg(y|ies)|break (this|it) down|analy[sz]e)\b/i;
const LONG_PROMPT_CHARS = 600;

/**
 * Cheap heuristic pass. Used as the first filter (so obvious cases skip the
 * model call) and as the fallback when the LM isn't loaded yet. Returns null
 * when no heuristic fires — caller should invoke the model-based router.
 */
export function heuristicRoute(prompt: string, hasImage: boolean): RouteDecision | null {
  // Memory takes precedence over vision when the prompt references the past —
  // an image of an empty desk doesn't answer "where did I leave my keys".
  if (MEMORY_HINT.test(prompt)) {
    return { route: 'memory_query', confidence: 0.9, reason: 'temporal-past hint' };
  }
  if (hasImage || VISION_HINT.test(prompt)) {
    return { route: 'vision_query', confidence: 0.95, reason: 'image or vision hint' };
  }
  if (DESKTOP_HINT.test(prompt)) {
    return { route: 'desktop_action', confidence: 0.8, reason: 'desktop verb detected' };
  }
  if (!cloudEnabled) {
    return { route: 'local_answer', confidence: 0.7, reason: 'cloud disabled' };
  }
  if (prompt.length >= LONG_PROMPT_CHARS || CODE_HINT.test(prompt) || PLAN_HINT.test(prompt)) {
    return { route: 'cloud_answer', confidence: 0.85, reason: 'high-complexity heuristic' };
  }
  return null;
}

/**
 * Ask Gemma 4 E4B (on-device) to classify the prompt. Returns null if the
 * model output can't be parsed — caller falls back to heuristic.
 */
export async function modelRoute(
  lm: RouterLM,
  prompt: string,
): Promise<RouteDecision | null> {
  try {
    const { response } = await lm.complete({
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<RouteDecision>;
    if (!parsed.route || typeof parsed.confidence !== 'number') return null;
    return {
      route: parsed.route as Route,
      confidence: parsed.confidence,
      reason: parsed.reason ?? 'model',
    };
  } catch (err) {
    console.warn('[Router] model route failed:', err);
    return null;
  }
}

/**
 * Full routing pipeline: heuristic fast-path → model classifier → clarify if
 * confidence under floor. `lm` is optional so the app can route before Cactus
 * finishes loading (uses heuristic only).
 */
export async function route(
  prompt: string,
  hasImage: boolean,
  lm: RouterLM | null,
  cloudEnabled: boolean,
): Promise<RouteDecision> {
  const fast = heuristicRoute(prompt, hasImage, cloudEnabled);
  if (fast) return fast;

  if (!lm) {
    return { route: 'local_answer', confidence: 0.5, reason: 'no model loaded — default local' };
  }

  const decision = await modelRoute(lm, prompt);
  if (!decision) {
    return { route: 'local_answer', confidence: 0.5, reason: 'router parse failed' };
  }

  if (decision.confidence < CONFIDENCE_FLOOR && decision.route !== 'clarify') {
    return { ...decision, route: 'clarify', reason: `low confidence (${decision.confidence.toFixed(2)})` };
  }

  // Re-escalate `local_answer` to cloud if cloud is configured and heuristic
  // signals complexity — the small router model tends to under-escalate.
  if (decision.route === 'local_answer' && cloudEnabled) {
    if (prompt.length >= LONG_PROMPT_CHARS || CODE_HINT.test(prompt) || PLAN_HINT.test(prompt)) {
      return { route: 'cloud_answer', confidence: decision.confidence, reason: 're-escalated by complexity' };
    }
  }

  return decision;
}
