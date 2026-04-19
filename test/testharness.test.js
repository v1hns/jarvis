const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCases,
  serializeCases,
  insertCase,
  removeCase,
  buildCase,
  MAX_CASES,
} = require('../test-dist/modules/TestHarnessCore.js');

function fixture(id, transcript = 'hello world') {
  return {
    id,
    createdAt: '2026-04-18T00:00:00.000Z',
    label: transcript.slice(0, 80),
    audioSamples: [0.0, 0.1, 0.2],
    capturedTranscript: transcript,
    capturedRoute: 'local_answer',
    capturedResponse: 'hi',
  };
}

// ── parseCases ────────────────────────────────────────────────────────────────

test('parseCases: valid array JSON round-trips', () => {
  const cases = [fixture('a'), fixture('b')];
  const parsed = parseCases(JSON.stringify(cases));
  assert.deepEqual(parsed, cases);
});

test('parseCases: empty string → []', () => {
  assert.deepEqual(parseCases(''), []);
});

test('parseCases: malformed JSON → []', () => {
  assert.deepEqual(parseCases('{not valid'), []);
});

test('parseCases: JSON that is not an array → []', () => {
  assert.deepEqual(parseCases('{"foo":1}'), []);
  assert.deepEqual(parseCases('"just a string"'), []);
  assert.deepEqual(parseCases('null'), []);
});

// ── serializeCases ────────────────────────────────────────────────────────────

test('serializeCases: round-trips through parseCases', () => {
  const cases = [fixture('a'), fixture('b'), fixture('c')];
  assert.deepEqual(parseCases(serializeCases(cases)), cases);
});

// ── insertCase ────────────────────────────────────────────────────────────────

test('insertCase: prepends new case (most-recent-first)', () => {
  const existing = [fixture('a'), fixture('b')];
  const result = insertCase(existing, fixture('c'));
  assert.deepEqual(result.map(t => t.id), ['c', 'a', 'b']);
});

test('insertCase: caps list at MAX_CASES with FIFO eviction of oldest', () => {
  const existing = Array.from({ length: MAX_CASES }, (_, i) => fixture(`old_${i}`));
  const result = insertCase(existing, fixture('new'));
  assert.equal(result.length, MAX_CASES);
  assert.equal(result[0].id, 'new');
  // oldest ("old_9" — since existing is already ordered newest→oldest by index) gets evicted
  assert.equal(result[result.length - 1].id, `old_${MAX_CASES - 2}`);
});

test('insertCase: does not mutate input array', () => {
  const existing = [fixture('a')];
  const snapshot = JSON.stringify(existing);
  insertCase(existing, fixture('b'));
  assert.equal(JSON.stringify(existing), snapshot);
});

// ── removeCase ────────────────────────────────────────────────────────────────

test('removeCase: filters out matching id', () => {
  const existing = [fixture('a'), fixture('b'), fixture('c')];
  const result = removeCase(existing, 'b');
  assert.deepEqual(result.map(t => t.id), ['a', 'c']);
});

test('removeCase: unknown id → list unchanged', () => {
  const existing = [fixture('a'), fixture('b')];
  const result = removeCase(existing, 'zzz');
  assert.deepEqual(result.map(t => t.id), ['a', 'b']);
});

test('removeCase: empty input → empty output', () => {
  assert.deepEqual(removeCase([], 'a'), []);
});

// ── buildCase ─────────────────────────────────────────────────────────────────

test('buildCase: populates label from transcript (truncated to 80 chars)', () => {
  const long = 'x'.repeat(200);
  const tc = buildCase([0.1], long, 'local_answer', 'ok');
  assert.equal(tc.label.length, 80);
  assert.equal(tc.capturedTranscript, long);
});

test('buildCase: empty transcript + image → "(photo query)" label', () => {
  const tc = buildCase([0.1], '', 'vision_query', 'a cat', 'BASE64IMG');
  assert.equal(tc.label, '(photo query)');
  assert.equal(tc.imageBase64, 'BASE64IMG');
});

test('buildCase: empty transcript + no image → "(no speech)" label', () => {
  const tc = buildCase([], '', 'clarify', '');
  assert.equal(tc.label, '(no speech)');
});

test('buildCase: id is prefixed with tc_<ms>_<rand> and createdAt is ISO string', () => {
  const tc = buildCase([0.1], 'hi', 'local_answer', 'ok');
  assert.match(tc.id, /^tc_\d+_[a-z0-9]{1,4}$/);
  assert.match(tc.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildCase: back-to-back calls in the same ms still yield distinct ids', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    ids.add(buildCase([0.1], 'hi', 'local_answer', 'ok').id);
  }
  // With a 4-char base36 suffix, 200 draws should virtually never collide.
  assert.equal(ids.size, 200);
});

// ── end-to-end pipeline ───────────────────────────────────────────────────────

test('pipeline: build → insert → serialize → parse → remove', () => {
  let stored = '';
  const tc1 = buildCase([0.1], 'first', 'local_answer', 'ok');
  stored = serializeCases(insertCase(parseCases(stored), tc1));

  const tc2 = buildCase([0.2], 'second', 'cloud_answer', 'okey');
  stored = serializeCases(insertCase(parseCases(stored), tc2));
  assert.notEqual(tc1.id, tc2.id);

  const loaded = parseCases(stored);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, tc2.id);

  const afterDelete = removeCase(loaded, tc1.id);
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, tc2.id);
});
