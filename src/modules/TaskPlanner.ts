import type { RouterLM, Route } from './Router';

export interface SubTask {
  id: string;
  description: string;
  route: Route;
}

export interface TaskPlan {
  summary: string;
  steps: SubTask[];
  raw: string;
}

const PLANNER_SYSTEM_PROMPT = `You are Jarvis's on-device task planner.
Given the user's spoken request, decide if it is a single-step ask or a multi-step task.

If it is multi-step, break it into 2–5 ordered sub-steps. Each step must be assigned one route:
- local_answer: simple knowledge, chit-chat, or reasoning the on-device Gemma can handle.
- cloud_answer: long-context, multi-step reasoning, code generation — hand to cloud Gemma.
- vision_query: needs the glasses camera.
- memory_query: needs recall of past episodes (today, yesterday, "where did I...").
- desktop_action: needs the user's laptop (email, files, apps, browser).

Respond with STRICT minified JSON on a single line, no prose, no code fences:
{"summary":"<one short phrase>","steps":[{"description":"<imperative step>","route":"<route>"}]}

If the request is a single step, return exactly one step.`;

/**
 * Ask on-device Gemma to decompose the request into an ordered plan. Returns
 * null if the model output can't be parsed; caller should fall back to a
 * single-step plan built from the router's decision.
 */
export async function planTask(
  lm: RouterLM,
  userText: string,
): Promise<TaskPlan | null> {
  try {
    const result = await lm.completion([
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ]);
    const response = result.content ?? result.text ?? '';
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      summary?: string;
      steps?: Array<{ description?: string; route?: string }>;
    };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;

    const steps: SubTask[] = parsed.steps
      .filter(s => s.description && s.route)
      .map((s, i) => ({
        id: `step-${i}`,
        description: String(s.description),
        route: normalizeRoute(s.route!),
      }));

    if (steps.length === 0) return null;

    return {
      summary: parsed.summary ?? userText.slice(0, 80),
      steps,
      raw: response,
    };
  } catch (err) {
    console.warn('[TaskPlanner] plan failed:', err);
    return null;
  }
}

function normalizeRoute(route: string): Route {
  const r = route.toLowerCase().replace(/[^a-z_]/g, '');
  const known: Route[] = [
    'local_answer', 'cloud_answer', 'vision_query',
    'memory_query', 'desktop_action', 'clarify',
  ];
  return (known as string[]).includes(r) ? (r as Route) : 'local_answer';
}

export function singleStepPlan(userText: string, route: Route): TaskPlan {
  return {
    summary: userText.slice(0, 80),
    steps: [{ id: 'step-0', description: userText, route }],
    raw: '',
  };
}
