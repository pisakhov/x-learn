import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LearningEngine, adaptiveDifficulty, validateQuestion } from '../src/engine.mjs';

const source = 'An idempotency key lets retries reuse the stored result instead of charging twice.';
const question = { topic: 'Retries', question: 'Why keep the same key?', hint: 'Think retries.', explanation: source, rubric: 'Reuse the previous result.', evidence: source };
async function fixture(t, model) {
  const dir = mkdtempSync(join(tmpdir(), 'x-learn-test-'));
  const options = { path: join(dir, 'state.sqlite'), session: 'test', model: model || (async (_s, input) => ({ model: 'fixture', text: JSON.stringify('answer' in JSON.parse(input) ? { verdict: 'correct', feedback: 'Reuses the result.' } : question) })) };
  const engine = new LearningEngine(options);
  t.after(async () => { if (!engine.closed) await engine.close(); rmSync(dir, { recursive: true, force: true }); });
  engine.observe({ label: 'Payments', topicKey: 'payments', source });
  return { engine, options };
}
const command = (engine, action, fields = {}) => engine.command({ id: randomUUID(), action, ...fields });
async function next(engine) { await command(engine, 'next'); return (await engine.wait()).practice.attempts.at(-1); }

test('grounding rejects fabricated evidence', () => {
  assert.throws(() => validateQuestion({ ...question, evidence: 'This quotation is not in the source.' }, source));
  assert.deepEqual(validateQuestion(question, source), question);
});
test('answer persists XP across reopen; duplicate submission cannot award twice', async t => {
  const { engine, options } = await fixture(t);
  const card = await next(engine);
  assert.equal(card.rubric, undefined);
  assert.equal(card.evidence, undefined);
  await command(engine, 'answer', { attemptId: card.id, answer: 'Reuse the result.' });
  assert.equal((await engine.wait()).xp, 10);
  await assert.rejects(command(engine, 'answer', { attemptId: card.id, answer: 'Again' }));
  await engine.close();
  const reopened = new LearningEngine(options);
  try { assert.equal(reopened.snapshot().xp, 10); } finally { await reopened.close(); }
});
test('hint marks assistance; dispute excludes earned XP', async t => {
  const { engine } = await fixture(t);
  const card = await next(engine);
  await command(engine, 'hint', { attemptId: card.id });
  await command(engine, 'answer', { attemptId: card.id, answer: 'Reuse the result.' });
  assert.equal((await engine.wait()).xp, 3);
  await command(engine, 'dispute', { attemptId: card.id });
  assert.equal(engine.snapshot().xp, 0);
});
test('unknown explains without negative XP', async t => {
  const { engine } = await fixture(t);
  const card = await next(engine);
  const view = await command(engine, 'unknown', { attemptId: card.id });
  assert.equal(view.xp, 0);
  assert.equal(view.practice.attempts.at(-1).explanation, source);
});
test('skip closes card and backs off without negative XP', async t => {
  const { engine } = await fixture(t);
  const card = await next(engine);
  const view = await command(engine, 'skip', { attemptId: card.id });
  assert.equal(view.practice.attempts.at(-1).status, 'skipped');
  assert.ok(view.settings.snoozedUntil > Date.now());
  assert.equal(view.xp, 0);
});
test('request deduplication, changed payload rejection, one open card', async t => {
  const { engine } = await fixture(t);
  const request = { action: 'next', id: randomUUID() };
  await engine.command(request); await engine.wait();
  await engine.command(request);
  assert.equal(engine.load().attempts.length, 1);
  await assert.rejects(engine.command({ ...request, action: 'skip' }));
  await assert.rejects(command(engine, 'next'));
});
test('provider failure produces failed job, no score and no retry', async t => {
  let calls = 0;
  const { engine } = await fixture(t, async () => { calls++; throw new Error('unavailable'); });
  await command(engine, 'next');
  const view = await engine.wait();
  assert.equal(view.jobs.at(-1).status, 'failed');
  assert.equal(view.xp, 0);
  assert.equal(view.practice.attempts.length, 0);
  assert.equal(calls, 1);
});
test('disabled learning makes no model call', async t => {
  const { engine } = await fixture(t, async () => { assert.fail('must not call model'); });
  await command(engine, 'settings', { enabled: false });
  await assert.rejects(command(engine, 'next'));
  await engine.tick();
  assert.equal(engine.snapshot().jobs.length, 0);
});
test('two unaided correct advance; incorrect drops; unknown resets', () => {
  const correct = i => ({ created: i, status: 'graded', grade: { verdict: 'correct' }, assisted: false });
  const history = [1, 2, 3, 4].map(correct);
  assert.equal(adaptiveDifficulty(history).level, 2);
  history.push({ created: 5, status: 'graded', grade: { verdict: 'incorrect' } });
  assert.equal(adaptiveDifficulty(history).level, 1);
  history.push({ created: 6, status: 'unknown' });
  assert.equal(adaptiveDifficulty(history).level, 0);
});
