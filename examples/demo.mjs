import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LearningEngine } from '../src/engine.mjs';

const directory = mkdtempSync(join(tmpdir(), 'x-learn-demo-'));
const evidence = 'An idempotency key lets retries reuse the stored result instead of charging twice.';
const engine = new LearningEngine({
  path: join(directory, 'demo.sqlite'),
  session: 'demo',
  // SCRIPTED fixture: replace this callback with your tool-free provider call.
  model: async (_system, input) => ({
    model: 'scripted-demo',
    text: JSON.stringify('answer' in JSON.parse(input)
      ? { verdict: 'correct', feedback: 'The retry reuses the stored outcome. This demo verdict is scripted, not evaluated.' }
      : { topic: 'Idempotency', question: 'A client retries a payment request. What prevents a second charge?',
          hint: 'Think about request identity.', explanation: evidence,
          rubric: 'Mention the same key and reuse of the stored result.', evidence }),
  }),
});
try {
  console.log('X Learn — SCRIPTED DEMO · no model call or API key\n');
  engine.observe({ label: 'Payments', topicKey: 'payments', source: evidence });
  await engine.command({ action: 'next', id: randomUUID() });
  const card = (await engine.wait()).practice.attempts.at(-1);
  if (!card) throw new Error('Question generation failed');
  console.log('LEARN:', card.question);
  const answer = 'Use the same idempotency key and return its stored result.';
  console.log('YOU:  ', answer);
  await engine.command({ action: 'answer', id: randomUUID(), attemptId: card.id, answer });
  const view = await engine.wait();
  console.log('LEARN:', view.practice.attempts.at(-1).grade.feedback);
  console.log('XP:   ', view.xp);
} finally {
  await engine.close();
  rmSync(directory, { recursive: true, force: true });
}
