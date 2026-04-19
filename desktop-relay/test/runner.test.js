const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMessage,
  extractTextFromLine,
  runOpenClawTask,
} = require('../dist/runner.js');
const {
  FakeChildProcess,
  flush,
  silentLogger,
} = require('./helpers.js');

test('buildMessage includes confirmation rules, context, and task body', () => {
  const message = buildMessage({
    task: 'Draft the email',
    confirm_before: ['send', 'delete'],
    context: [
      { role: 'user', content: 'We are planning the launch.' },
      { role: 'assistant', content: 'I can draft that.' },
    ],
  });

  assert.match(message, /Before any action matching: "send", "delete"/);
  assert.match(message, /User: We are planning the launch\./);
  assert.match(message, /Jarvis: I can draft that\./);
  assert.match(message, /Task: Draft the email/);
});

test('extractTextFromLine handles plain text and openclaw JSON shapes', () => {
  assert.equal(extractTextFromLine('hello'), 'hello');
  assert.equal(extractTextFromLine('{"text":"hi"}'), 'hi');
  assert.equal(extractTextFromLine('{"response":"done"}'), 'done');
  assert.equal(extractTextFromLine('{"delta":{"text":"partial"}}'), 'partial');
  assert.equal(extractTextFromLine('{"bad json"'), '{"bad json"');
});

test('runOpenClawTask parses progress and confirmation markers and forwards confirmation input', async () => {
  const child = new FakeChildProcess();
  let spawnCall = null;
  const events = [];

  const handle = runOpenClawTask(
    {
      task: 'Send the email',
      session_id: 'sess-1',
      context: [{ role: 'user', content: 'Tell the team we shipped.' }],
    },
    event => events.push(event),
    'gemini-test-key',
    {
      spawnImpl: (...args) => {
        spawnCall = args;
        return child;
      },
      logger: silentLogger(),
    },
  );

  child.stdout.write('{"text":"PROGRESS: opening mail"}\n');
  child.stdout.write('{"text":"CONFIRM_REQUIRED: About to send the email."}\n');
  handle.sendConfirmation('CONFIRMED');
  child.stdout.write('{"text":"Sent successfully."}\n');
  child.emit('close', 0);
  await flush();

  assert.ok(spawnCall, 'expected the injected spawn to be called');
  assert.equal(spawnCall[0], 'openclaw');
  assert.deepEqual(spawnCall[1].slice(0, 4), ['agent', '--agent', 'jarvis', '--local']);
  assert.equal(spawnCall[2].env.GEMINI_API_KEY, 'gemini-test-key');
  assert.equal(spawnCall[2].env.GOOGLE_API_KEY, 'gemini-test-key');
  assert.deepEqual(events, [
    { type: 'progress', payload: 'opening mail' },
    { type: 'needs_confirmation', payload: 'About to send the email.' },
    { type: 'progress', payload: 'Sent successfully.' },
    { type: 'result', payload: 'Sent successfully.' },
  ]);
  assert.deepEqual(child.stdinWrites, ['CONFIRMED\n']);
});

test('runOpenClawTask surfaces a readable error when openclaw is missing', async () => {
  const child = new FakeChildProcess();
  const events = [];

  runOpenClawTask(
    { task: 'Open the file', session_id: 'sess-enoent' },
    event => events.push(event),
    'gemini-test-key',
    {
      spawnImpl: () => child,
      logger: silentLogger(),
    },
  );

  child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
  await flush();

  assert.deepEqual(events, [
    {
      type: 'error',
      payload: 'openclaw CLI not found — run: npm install -g openclaw  OR  check your PATH',
    },
  ]);
});
