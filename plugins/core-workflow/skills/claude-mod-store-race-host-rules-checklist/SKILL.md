---
name: claude-mod-store-race-host-rules-checklist
description: "Claude Code mod reviews keep finding the same defects: lost updates when two Bash calls finish together because $.store read-modify-write has no compare-and-swap and is shared across sessions, a status tool answering ok after a failed write, quota retry before freeing space, next(e) awaited after store work in session.start, and the host refusing $ or $.store passed into imported files. Use when planning, implementing or reviewing a Claude Code mod that writes $.store or registers tools."
---

# Claude Code mod authoring: $.store race and host-rule checklist

Use alongside the bundled `plugin-authoring` skill, which does not cover
these rules.

## Symptom

Review rounds on store-writing mods rediscover the same data-loss bugs:

- A read-modify-write of `index` and `runs:<key>` loses updates when two
  Bash calls finish together.
- A status tool called while a capture is in flight drops the captured
  artifact, or answers ok after the write failed.
- Concurrent sessions race on a shared `index` (last write wins): a session
  id is lost while its own record stays.
- A helper that was passed `$` or `$.store` in an imported file is refused
  by the host.
- Tests silently skip a hook because an op was not stubbed with `{ value }`.

## Root cause

`$.store` has no compare-and-swap and is shared across sessions. Hooks run
concurrently. The host only follows `$` inside `register.tsx`. None of this
is in the authoring docs, so each task rediscovers it in review.

## Fix: checklist for mod briefs and reviews

1. Every record write is a transform of the CURRENT value, run on one
   serial promise chain. Wrap each link in `.catch`, but RETURN the promise
   so tool answers can deny on failure.
2. Decide whether a call captures anything BEFORE awaiting the chain.
3. In `session.start`, call `next(e)` first; read `cwd` before it. Never
   await store work ahead of `next(e)`.
4. Keep every function that touches `$` in `register.tsx`. Imported files
   get plain values, never `$` or `$.store`.
5. On every write, merge ids from `store.keys()` that are missing from a
   shared index (repairs lost updates from other sessions).
6. On quota failure free space FIRST, then retry; never retry first.
7. Gating tool hooks get a `.catch` that denies (fail closed).
8. Register tools as `mcp__<plugin>__<name>` with `isDeferred: false`.
9. Tests stub every op with `{ value }` and assert an observable effect, so
   a skipped hook fails the test.

Serial-chain shape:

```ts
let chain: Promise<unknown> = Promise.resolve();
const update = <T,>(key: string, fn: (cur: T | undefined) => T): Promise<unknown> => {
  const p = chain.then(async () => $.store.set(key, fn(await $.store.get(key) as T | undefined)));
  chain = p.catch(() => {});   // chain survives a failure
  return p;                    // caller still sees the failure
};
```

## Evidence

Mined from private-project worktree sessions; 8 sessions with the same defects
across review rounds, e.g. `35a0da7e` (lost updates on parallel Bash
completion), `52489a82` (shared index race), `8edde5a5` (host refused
`$.store` in an imported file).

## Related skills

- `plugin-authoring` (bundled with Claude Code) — hook budget, naming, state.
- `core-workflow:subagent-report-truncation-delivery-contract` — for the
  review rounds that surface these defects.
