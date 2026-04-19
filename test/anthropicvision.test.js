const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVisionRequestBody,
  visionQueryWith,
  ANTHROPIC_ENDPOINT,
  ANTHROPIC_VERSION,
  VISION_SYSTEM_PROMPT,
} = require('../test-dist/modules/AnthropicVisionCore.js');

// ── fetch fakes ──────────────────────────────────────────────────────────────

function captureFetch(response) {
  const captured = {};
  const fetchFn = async (url, init) => {
    captured.url = url;
    captured.init = init;
    return response;
  };
  return { fetchFn, captured };
}

function okJson(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function errResponse(status, bodyText) {
  return {
    ok: false,
    status,
    async text() { return bodyText; },
  };
}

function validVisionPayload(text = 'a coffee mug') {
  return { content: [{ type: 'text', text }] };
}

// ── buildVisionRequestBody ───────────────────────────────────────────────────

test('buildVisionRequestBody: embeds model, system prompt, image, and text', () => {
  const body = buildVisionRequestBody('claude-sonnet-4-6', 'what is this?', 'BASE64IMG');
  assert.equal(body.model, 'claude-sonnet-4-6');
  assert.equal(body.max_tokens, 512);
  assert.equal(body.system, VISION_SYSTEM_PROMPT);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.type, 'base64');
  assert.equal(body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(body.messages[0].content[0].source.data, 'BASE64IMG');
  assert.equal(body.messages[0].content[1].type, 'text');
  assert.equal(body.messages[0].content[1].text, 'what is this?');
});

test('VISION_SYSTEM_PROMPT constrains output to 1-2 short sentences', () => {
  assert.match(VISION_SYSTEM_PROMPT, /1-2 short sentences/);
  assert.match(VISION_SYSTEM_PROMPT, /spoken aloud/);
});

// ── visionQueryWith ──────────────────────────────────────────────────────────

test('visionQueryWith: returns text from valid response', async () => {
  const { fetchFn } = captureFetch(okJson(validVisionPayload('a red cup')));
  const result = await visionQueryWith(
    { apiKey: 'K', model: 'claude-sonnet-4-6', fetchFn },
    'what is this?',
    'IMG',
  );
  assert.equal(result, 'a red cup');
});

test('visionQueryWith: POSTs to Anthropic endpoint with auth headers', async () => {
  const { fetchFn, captured } = captureFetch(okJson(validVisionPayload()));
  await visionQueryWith(
    { apiKey: 'sk-abc', model: 'claude-sonnet-4-6', fetchFn },
    'hi',
    'IMG',
  );
  assert.equal(captured.url, ANTHROPIC_ENDPOINT);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.equal(captured.init.headers['x-api-key'], 'sk-abc');
  assert.equal(captured.init.headers['anthropic-version'], ANTHROPIC_VERSION);
});

test('visionQueryWith: request body carries prompt + base64 image', async () => {
  const { fetchFn, captured } = captureFetch(okJson(validVisionPayload()));
  await visionQueryWith(
    { apiKey: 'K', model: 'claude-sonnet-4-6', fetchFn },
    'describe this',
    'BASE64DATA',
  );
  const body = JSON.parse(captured.init.body);
  assert.equal(body.messages[0].content[0].source.data, 'BASE64DATA');
  assert.equal(body.messages[0].content[1].text, 'describe this');
});

test('visionQueryWith: non-200 throws with status and body excerpt', async () => {
  const { fetchFn } = captureFetch(errResponse(401, 'invalid api key'));
  await assert.rejects(
    visionQueryWith({ apiKey: 'bad', model: 'm', fetchFn }, 'hi', 'IMG'),
    /Anthropic vision 401: invalid api key/,
  );
});

test('visionQueryWith: 529 overloaded surfaces in error', async () => {
  const { fetchFn } = captureFetch(errResponse(529, 'overloaded_error'));
  await assert.rejects(
    visionQueryWith({ apiKey: 'K', model: 'm', fetchFn }, 'hi', 'IMG'),
    /Anthropic vision 529/,
  );
});

test('visionQueryWith: missing content[0].text throws', async () => {
  const { fetchFn } = captureFetch(okJson({ content: [] }));
  await assert.rejects(
    visionQueryWith({ apiKey: 'K', model: 'm', fetchFn }, 'hi', 'IMG'),
    /No text in vision response/,
  );
});

test('visionQueryWith: text of wrong type throws', async () => {
  const { fetchFn } = captureFetch(okJson({ content: [{ type: 'text', text: null }] }));
  await assert.rejects(
    visionQueryWith({ apiKey: 'K', model: 'm', fetchFn }, 'hi', 'IMG'),
    /No text in vision response/,
  );
});

test('visionQueryWith: fetch rejection propagates', async () => {
  const fetchFn = async () => { throw new Error('dns failure'); };
  await assert.rejects(
    visionQueryWith({ apiKey: 'K', model: 'm', fetchFn }, 'hi', 'IMG'),
    /dns failure/,
  );
});
