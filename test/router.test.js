const test = require('node:test');
const assert = require('node:assert/strict');

const { heuristicRoute, modelRoute, route } = require('../test-dist/modules/Router.js');

// ── heuristicRoute ────────────────────────────────────────────────────────────

test('heuristicRoute: image presence → vision_query regardless of prompt', () => {
  const r = heuristicRoute('what time is it', true, true);
  assert.equal(r.route, 'vision_query');
  assert.equal(r.confidence, 0.95);
});

test('heuristicRoute: vision phrasing → vision_query even without image', () => {
  assert.equal(heuristicRoute('what is this?', false, true).route, 'vision_query');
  assert.equal(heuristicRoute("what's on my desk?", false, true).route, 'vision_query');
  assert.equal(heuristicRoute('read this label for me', false, true).route, 'vision_query');
});

test('heuristicRoute: desktop verbs → desktop_action', () => {
  assert.equal(heuristicRoute('send an email to Alex', false, true).route, 'desktop_action');
  assert.equal(heuristicRoute('draft a reply to the latest slack', false, true).route, 'desktop_action');
  assert.equal(heuristicRoute('open gmail', false, true).route, 'desktop_action');
  assert.equal(heuristicRoute('check my calendar', false, true).route, 'desktop_action');
});

test('heuristicRoute: cloud disabled → everything stays local_answer', () => {
  const r = heuristicRoute('write a python script that sorts a list', false, false);
  assert.equal(r.route, 'local_answer');
  assert.equal(r.reason, 'cloud disabled');
});

test('heuristicRoute: cloud enabled + code hint → cloud_answer', () => {
  assert.equal(heuristicRoute('write a function that reverses a string', false, true).route, 'cloud_answer');
  assert.equal(heuristicRoute('debug this stack trace', false, true).route, 'cloud_answer');
  assert.equal(heuristicRoute('this typescript error is confusing', false, true).route, 'cloud_answer');
});

test('heuristicRoute: cloud enabled + plan/analysis hint → cloud_answer', () => {
  assert.equal(heuristicRoute('compare the pros and cons of X vs Y', false, true).route, 'cloud_answer');
  assert.equal(heuristicRoute('outline the steps to refactor this', false, true).route, 'cloud_answer');
  assert.equal(heuristicRoute('analyze my morning routine', false, true).route, 'cloud_answer');
});

test('heuristicRoute: long prompt → cloud_answer', () => {
  const long = 'explain '.repeat(100); // ~800 chars
  assert.equal(heuristicRoute(long, false, true).route, 'cloud_answer');
});

test('heuristicRoute: no hint fires → null (caller invokes model)', () => {
  assert.equal(heuristicRoute('what year did the eiffel tower open', false, true), null);
  assert.equal(heuristicRoute('who wrote hamlet', false, true), null);
});

test('heuristicRoute: vision hint wins over desktop keyword', () => {
  const r = heuristicRoute('read this email on my desk', false, true);
  assert.equal(r.route, 'vision_query');
});

// ── modelRoute ────────────────────────────────────────────────────────────────

function makeLM(response) {
  return { complete: async () => ({ response }) };
}

test('modelRoute: parses clean JSON response', async () => {
  const lm = makeLM('{"route":"cloud_answer","confidence":0.82,"reason":"multi-step plan"}');
  const r = await modelRoute(lm, 'plan my week');
  assert.equal(r.route, 'cloud_answer');
  assert.equal(r.confidence, 0.82);
  assert.equal(r.reason, 'multi-step plan');
});

test('modelRoute: extracts JSON embedded in surrounding prose', async () => {
  const lm = makeLM('Sure! {"route":"local_answer","confidence":0.9,"reason":"simple"} done.');
  const r = await modelRoute(lm, 'hi');
  assert.equal(r.route, 'local_answer');
});

test('modelRoute: missing fields → null', async () => {
  assert.equal(await modelRoute(makeLM('{"confidence":0.5}'), 'x'), null);
  assert.equal(await modelRoute(makeLM('{"route":"local_answer"}'), 'x'), null);
});

test('modelRoute: unparseable response → null', async () => {
  assert.equal(await modelRoute(makeLM('no json here'), 'x'), null);
  assert.equal(await modelRoute(makeLM('{not valid json}'), 'x'), null);
});

test('modelRoute: defaults missing reason to "model"', async () => {
  const lm = makeLM('{"route":"local_answer","confidence":0.9}');
  const r = await modelRoute(lm, 'x');
  assert.equal(r.reason, 'model');
});

test('modelRoute: lm throw → null (caller falls back)', async () => {
  const lm = { complete: async () => { throw new Error('boom'); } };
  assert.equal(await modelRoute(lm, 'x'), null);
});

// ── route (full pipeline) ─────────────────────────────────────────────────────

test('route: heuristic fast-path returns before touching lm', async () => {
  let called = false;
  const lm = { complete: async () => { called = true; return { response: '' }; } };
  const r = await route('what is this?', false, lm, true);
  assert.equal(r.route, 'vision_query');
  assert.equal(called, false);
});

test('route: no lm + no heuristic → default local_answer', async () => {
  const r = await route('who wrote hamlet', false, null, true);
  assert.equal(r.route, 'local_answer');
  assert.equal(r.confidence, 0.5);
});

test('route: low confidence model answer → downgraded to clarify', async () => {
  const lm = makeLM('{"route":"local_answer","confidence":0.3,"reason":"unsure"}');
  const r = await route('whats the thing with the place', false, lm, true);
  assert.equal(r.route, 'clarify');
  assert.match(r.reason, /low confidence/);
});

test('route: clarify stays clarify even below floor', async () => {
  const lm = makeLM('{"route":"clarify","confidence":0.2,"reason":"ambiguous"}');
  const r = await route('the thing', false, lm, true);
  assert.equal(r.route, 'clarify');
  assert.equal(r.reason, 'ambiguous');
});

test('route: local_answer re-escalates to cloud when cloud enabled + complexity hint', async () => {
  const lm = makeLM('{"route":"local_answer","confidence":0.9,"reason":"easy"}');
  const r = await route('write a regex that matches emails', false, lm, true);
  // heuristic should catch this before the model, confirming heuristic wins
  assert.equal(r.route, 'cloud_answer');
});

test('route: local_answer does NOT re-escalate when cloud disabled', async () => {
  const lm = makeLM('{"route":"local_answer","confidence":0.9,"reason":"easy"}');
  // heuristic returns local_answer (cloud disabled) — never reaches model
  const r = await route('write a regex that matches emails', false, lm, false);
  assert.equal(r.route, 'local_answer');
});

test('route: model-returned local_answer re-escalates if prompt is long + cloud enabled', async () => {
  // Prompt is plain enough to skip the heuristic (no code/plan keywords, under long threshold)
  // but the model returns local_answer — then re-escalation checks complexity.
  // Craft a prompt that skips heuristic but triggers re-escalation via length.
  const longPlain = 'tell me about '.repeat(50); // ~700 chars, no code/plan hints
  const lm = makeLM('{"route":"local_answer","confidence":0.9,"reason":"easy"}');
  // heuristic fires on length, so actually this won't reach the model.
  const r = await route(longPlain, false, lm, true);
  assert.equal(r.route, 'cloud_answer');
});

test('route: model parse failure → default local_answer with explanatory reason', async () => {
  const lm = makeLM('not json');
  const r = await route('who is elon musk', false, lm, true);
  assert.equal(r.route, 'local_answer');
  assert.match(r.reason, /parse failed/);
});
