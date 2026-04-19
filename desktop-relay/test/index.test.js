const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRelayHandler,
  loadRelayOptionsFromEnv,
} = require('../dist/index.js');
const {
  FakeChildProcess,
  flush,
  invokeHandler,
  silentLogger,
} = require('./helpers.js');

test('loadRelayOptionsFromEnv reads secret and gemini key aliases', () => {
  const options = loadRelayOptionsFromEnv({
    RELAY_PORT: '9001',
    RELAY_SECRET: 'secret-1',
    GEMMA_API_KEY: 'gemma-fallback',
  });

  assert.deepEqual(options, {
    port: 9001,
    secret: 'secret-1',
    geminiApiKey: 'gemma-fallback',
  });
});

test('task endpoint rejects unauthorized requests', async () => {
  const handler = createRelayHandler({
    port: 7878,
    secret: 'shh',
    geminiApiKey: 'gemini-test-key',
    logger: silentLogger(),
  });

  const { res } = await invokeHandler(handler, {
    method: 'POST',
    url: '/task',
    body: { task: 'Send the email' },
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body()), { error: 'Unauthorized' });
});

test('task endpoint rejects missing task payloads', async () => {
  const handler = createRelayHandler({
    port: 7878,
    secret: 'shh',
    geminiApiKey: 'gemini-test-key',
    logger: silentLogger(),
  });

  const { res } = await invokeHandler(handler, {
    method: 'POST',
    url: '/task',
    headers: { 'x-relay-secret': 'shh' },
    body: { nope: true },
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body()), { error: '`task` string required' });
});

test('task and confirm endpoints round-trip confirmation through the session registry', async () => {
  const child = new FakeChildProcess();
  let taskCallback = null;
  let confirmationAnswer = null;

  const handler = createRelayHandler({
    port: 7878,
    secret: 'shh',
    geminiApiKey: 'gemini-test-key',
    logger: silentLogger(),
    runTask: (payload, onEvent) => {
      taskCallback = onEvent;
      assert.equal(payload.session_id, 'sess-confirm');
      return {
        child,
        sendConfirmation: answer => {
          confirmationAnswer = answer;
        },
      };
    },
  });

  const taskRequest = await invokeHandler(handler, {
    method: 'POST',
    url: '/task',
    headers: { 'x-relay-secret': 'shh' },
    body: { task: 'Send the message', session_id: 'sess-confirm' },
  });

  assert.equal(taskRequest.res.statusCode, 200);
  assert.match(taskRequest.res.body(), /Dispatching to OpenClaw \+ Gemma 4/);

  taskCallback({ type: 'needs_confirmation', payload: 'Ready to send.' });
  await flush();
  assert.match(taskRequest.res.body(), /"type":"needs_confirmation"/);
  assert.match(taskRequest.res.body(), /Ready to send\./);

  const confirmRequest = await invokeHandler(handler, {
    method: 'POST',
    url: '/confirm',
    headers: { 'x-relay-secret': 'shh' },
    body: { session_id: 'sess-confirm', answer: 'CONFIRMED' },
  });

  assert.equal(confirmRequest.res.statusCode, 200);
  assert.deepEqual(JSON.parse(confirmRequest.res.body()), { ok: true });
  assert.equal(confirmationAnswer, 'CONFIRMED');

  taskCallback({ type: 'result', payload: 'Sent successfully.' });
  await flush();
  assert.equal(taskRequest.res.ended, true);
  assert.match(taskRequest.res.body(), /Sent successfully\./);
});

test('task handler cleans up the child process when the client disconnects', async () => {
  const child = new FakeChildProcess();

  const handler = createRelayHandler({
    port: 7878,
    secret: 'shh',
    geminiApiKey: 'gemini-test-key',
    logger: silentLogger(),
    runTask: () => ({
      child,
      sendConfirmation: () => {},
    }),
  });

  const taskRequest = await invokeHandler(handler, {
    method: 'POST',
    url: '/task',
    headers: { 'x-relay-secret': 'shh' },
    body: { task: 'Delete the draft', session_id: 'sess-close' },
  });

  taskRequest.res.emit('close');
  assert.equal(child.killed, true);

  const confirmAfterClose = await invokeHandler(handler, {
    method: 'POST',
    url: '/confirm',
    headers: { 'x-relay-secret': 'shh' },
    body: { session_id: 'sess-close', answer: 'CANCELLED' },
  });

  assert.equal(confirmAfterClose.res.statusCode, 404);
  assert.deepEqual(JSON.parse(confirmAfterClose.res.body()), { error: 'Session not found' });
});
