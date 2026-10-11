# Integration contract

## Four host responsibilities

```text
completed exchange ──► collect safe context ──► engine.observe(context)
human asks         ──► command(next)         ──► wait() ──► render card
human answers      ──► command(answer)       ──► wait() ──► render feedback
shutdown           ──► close()
```

1. **Context:** recent human/assistant text + a few relevant safe files. No history sweep.
2. **Model:** a separate, tool-free call. Return `{text, model, usage?}`. Honor abort; enforce a timeout and token cap. Reject error/truncated responses.
3. **Storage:** a private database per authenticated account; a stable session ID. Call `recover()` once when restoring that session, never while another process owns its live jobs.
4. **UI:** show only public snapshots. Keep rubrics hidden. Hide skipped cards. Expose On/Off, Model, Frequency and Pause.

“Separate tutor” means a separate call/context, not necessarily a different model or vendor. It is not an independent factual authority.

## Commands

Every mutation requires a fresh request `id` (UUID works). A same-ID/same-payload replay is deduplicated within the stored request window; changing its payload is rejected. Do not treat this as permanent exactly-once delivery.

| Action | Additional fields | Behavior |
| --- | --- | --- |
| `list` | none; no request ID needed | Current public view |
| `next` | none | Generate one question from last observation |
| `answer` | `attemptId`, `answer`, optional `assisted` | Save verbatim answer; grade asynchronously |
| `hint` | `attemptId` | Reveal hint; mark assisted |
| `unknown` | `attemptId` | Reveal explanation; no penalty |
| `skip` | `attemptId` | Close card; snooze automatic offers |
| `dispute` | `attemptId` | Exclude grade from XP/adaptation |
| `settings` | `enabled`, `model`, `frequency` | Host-authorized preference changes |
| `snooze` / `resume` | none | Pause offers for a day / resume |

Use `await engine.wait()` after `next` or `answer`; inspect job status, not just promise completion. Provider/validation failures are captured as failed jobs. Never invent a grade when a call fails.

```js
await engine.command({
  id: crypto.randomUUID(), action: 'answer',
  attemptId: card.id, answer: exactHumanText,
});
const view = await engine.wait();
const result = view.practice.attempts.at(-1);
// render result.grade?.feedback or result.error; render view.xp
```

The main coding agent must not answer for the learner, rewrite their answer, or choose its own grade. Mark outside assistance with `assisted: true`.

## Automatic offers are optional

No scheduler starts inside the constructor. A manual-only adapter simply never calls `tick()`.

```text
Host calls tick() after a completed exchange / on a bounded timer
    │
    ├─ enabled? not snoozed? interval elapsed?
    ├─ changed context? no open practice card or running job?
    └─ yes → one question job
```

Intervals: 15 / 30 / 60 minutes; default 30. Startup does not scan history. Engine defaults to enabled; obtain user consent before wiring automatic calls. Explicit `next` bypasses the offer interval/pause, but not the enabled flag or daily budget.

The practice budget is **20 model jobs per rolling 24 hours**, shared by question generation and grading, including failed jobs. One ordinary question + answer consumes two jobs. It is not a dollar cap; reserve a grading call in your host UX if needed. There is also a 50-job overall limit covering legacy operations.

## Context and privacy boundary

| Keep | Exclude |
| --- | --- |
| Recent active conversation | Other users, other sessions, full history |
| A few relevant text snippets | Credentials, environment files, private keys |
| Stable opaque project key | Tool-result dumps, memory databases, binary files |

The original adapter bounded the source to 12,000 characters, recent text to six human/assistant messages, and files to three. The published engine accepts supplied text; **it does not read files or redact secrets for you**. Invalid observations are ignored, so validate before calling `observe()` and do not reuse stale context accidentally.

Prefer allowlisted content. Regex redaction is only a backstop, not a guarantee. Resolve paths within the workspace, reject sensitive paths, symlink escapes and oversized/binary files. Treat both source and answers as untrusted data. Tool-free calls limit capability; they do not eliminate prompt injection or grading errors.

**Data flow:** selected text goes to your configured model provider. SQLite stores questions, evidence, rubrics, answers, grades, model metadata and settings; it is not encrypted. The engine creates restrictive file permissions, but the host owns directory access, backups, retention, deletion, and provider-policy disclosure. Do not commit databases.

## Production checklist

- Authenticate every operation; derive account/session identity server-side.
- Restrict the public API to the intended commands. Never expose raw `export` or legacy administrative actions to the coding agent.
- Treat model feedback as untrusted UI text; escape HTML.
- Set provider timeout, usage/cost controls and cancellation.
- Coordinate session ownership and crash recovery; do not retry ambiguous mutations blindly.
- Hide skipped cards even though audit history retains them.
- Test the adapter against your harness. This repository's tests use a scripted provider.
