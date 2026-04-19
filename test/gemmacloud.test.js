const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGemmaRequestBody,
  buildGemmaUrl,
  cloudCompleteWith,
  GEMMA_ENDPOINT,
} = require('../test-dist/modules/GemmaCloudCore.js');

// ── fetch fakes ──────────────────────────────────────────────────────────────

/** Returns both the fetch fn and a captured { url, init } object. */
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
    async json() { return JSON.parse(bodyText); },
  };
}

function validGemmaPayload(text = 'hello from gemma') {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── buildGemmaUrl ────────────────────────────────────────────────────────────

test('buildGemmaUrl: embeds model and key in endpoint', () => {
  const url = buildGemmaUrl({ apiKey: 'KEY123', model: 'gemma-4-27b-it' });
  assert.equal(url, `${GEMMA_ENDPOINT}/gemma-4-27b-it:generateContent?key=KEY123`);
});

// ── buildGemmaRequestBody ────────────────────────────────────────────────────

test('buildGemmaRequestBody: folds system into first user turn', () => {
  const body = buildGemmaRequestBody({
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(body.contents[0].role, 'user');
  assert.equal(body.contents[0].parts[0].text, 'You are helpful.\n\nhi');
});

test('buildGemmaRequestBody: no system → first user message untouched', () => {
  const body = buildGemmaRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(body.contents[0].parts[0].text, 'hi');
});

test('buildGemmaRequestBody: maps assistant → model role', () => {
  const body = buildGemmaRequestBody({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
      { role: 'user', content: 'more' },
    ],
  });
  assert.equal(body.contents[0].role, 'user');
  assert.equal(body.contents[1].role, 'model');
  assert.equal(body.contents[2].role, 'user');
});

test('buildGemmaRequestBody: system is only folded into index 0, not later turns', () => {
  const body = buildGemmaRequestBody({
    system: 'SYS',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ],
  });
  assert.match(body.contents[0].parts[0].text, /^SYS\n\nfirst$/);
  assert.equal(body.contents[1].parts[0].text, 'second');
});

test('buildGemmaRequestBody: applies default generationConfig', () => {
  const body = buildGemmaRequestBody({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(body.generationConfig.maxOutputTokens, 512);
  assert.equal(body.generationConfig.temperature, 0.7);
});

test('buildGemmaRequestBody: caller-provided generationConfig overrides defaults', () => {
  const body = buildGemmaRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    maxOutputTokens: 1024,
    temperature: 0.2,
  });
  assert.equal(body.generationConfig.maxOutputTokens, 1024);
  assert.equal(body.generationConfig.temperature, 0.2);
});

// ── cloudCompleteWith ────────────────────────────────────────────────────────

test('cloudCompleteWith: returns text from valid response', async () => {
  const { fetchFn } = captureFetch(okJson(validGemmaPayload('the answer')));
  const result = await cloudCompleteWith(
    { apiKey: 'K', model: 'gemma-4-27b-it', fetchFn },
    { messages: [{ role: 'user', content: 'hi' }] },
  );
  assert.equal(result, 'the answer');
});

test('cloudCompleteWith: issues POST with JSON content-type and body', async () => {
  const { fetchFn, captured } = captureFetch(okJson(validGemmaPayload()));
  await cloudCompleteWith(
    { apiKey: 'K', model: 'gemma-4-27b-it', fetchFn },
    { system: 'SYS', messages: [{ role: 'user', content: 'hi' }] },
  );
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.match(body.contents[0].parts[0].text, /^SYS\n\nhi$/);
});

test('cloudCompleteWith: URL contains model + key', async () => {
  const { fetchFn, captured } = captureFetch(okJson(validGemmaPayload()));
  await cloudCompleteWith(
    { apiKey: 'SECRET', model: 'gemma-custom', fetchFn },
    { messages: [{ role: 'user', content: 'hi' }] },
  );
  assert.match(captured.url, /gemma-custom:generateContent/);
  assert.match(captured.url, /key=SECRET/);
});

test('cloudCompleteWith: non-200 throws with status and body excerpt', async () => {
  const { fetchFn } = captureFetch(errResponse(429, 'rate limited: too many requests'));
  await assert.rejects(
    cloudCompleteWith(
      { apiKey: 'K', model: 'm', fetchFn },
      { messages: [{ role: 'user', content: 'hi' }] },
    ),
    /Cloud Gemma 429: rate limited/,
  );
});

test('cloudCompleteWith: long error body is truncated to ~200 chars', async () => {
  const big = 'x'.repeat(500);
  const { fetchFn } = captureFetch(errResponse(500, big));
  await assert.rejects(
    cloudCompleteWith(
      { apiKey: 'K', model: 'm', fetchFn },
      { messages: [{ role: 'user', content: 'hi' }] },
    ),
    err => {
      // "Cloud Gemma 500: " prefix is 17 chars, excerpt capped at 200
      assert.ok(err.message.length <= 17 + 200 + 5);
      return true;
    },
  );
});

test('cloudCompleteWith: missing candidates[0].content.parts[0].text throws', async () => {
  const { fetchFn } = captureFetch(okJson({ candidates: [] }));
  await assert.rejects(
    cloudCompleteWith(
      { apiKey: 'K', model: 'm', fetchFn },
      { messages: [{ role: 'user', content: 'hi' }] },
    ),
    /no text/,
  );
});

test('cloudCompleteWith: text field of wrong type throws', async () => {
  const { fetchFn } = captureFetch(
    okJson({ candidates: [{ content: { parts: [{ text: 42 }] } }] }),
  );
  await assert.rejects(
    cloudCompleteWith(
      { apiKey: 'K', model: 'm', fetchFn },
      { messages: [{ role: 'user', content: 'hi' }] },
    ),
    /no text/,
  );
});

test('cloudCompleteWith: fetch rejection propagates to caller', async () => {
  const fetchFn = async () => { throw new Error('network down'); };
  await assert.rejects(
    cloudCompleteWith(
      { apiKey: 'K', model: 'm', fetchFn },
      { messages: [{ role: 'user', content: 'hi' }] },
    ),
    /network down/,
  );
});
