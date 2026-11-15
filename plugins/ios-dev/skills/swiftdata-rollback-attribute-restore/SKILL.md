---
name: swiftdata-rollback-attribute-restore
description: "A multi-object SwiftData save fails partway, the code calls context.rollback() expecting the batch to be undone, and the objects keep their new values anyway — because rollback() discards pending INSERTS and DELETES but does not revert attribute mutations on already-fetched @Model objects. Symptom: a failed batch edit leaves the UI showing values that were never persisted, and a later unrelated save flushes them. Use whenever writing a save path that mutates attributes on more than one fetched model before a single save(), or when an existing rollback-based error path is being reviewed or copied from an insert-shaped precedent."
---

# `ModelContext.rollback()` Does Not Restore Mutated Attributes

## Status of this claim (re-tested 2026-11-15)

Apple documents `rollback()` as restoring the context to its last committed
state, which contradicts the thesis below taken as a blanket rule. A two-context
test on macOS (iOS 27.2 SDK, on-disk store, objects fetched in the context and
mutated, then `rollback()`) found attributes **restored in every case tried**:
fresh context with autosave off and on, `mainContext`, and a failed save through
a `ModelConfiguration(allowsSave: false)` container. So the "never restores"
mechanism is **not reproduced**. Whether the original bug was `mainContext`
autosave flushing the mutations before `rollback()` ran could not be tested
headlessly: autosave never fired in a command-line test run, even after spinning
the run loop. Treat the explanation below as what one app observed, not as a
confirmed framework behaviour.

What the test did confirm: after a failed `save()` with **no** `rollback()`, the
context stays dirty (`hasChanges == true`) and the objects keep the new values
(`[101, 102]` from `[1, 2]`). That is the residue the failed-save contract below
guards against. Capture-and-restore stays as cheap defensive advice either way.

## Symptom

A batch edit mutates attributes across several fetched `@Model` objects, then
saves. The save throws. The error path calls `context.rollback()` and reports
failure to the user. But:

- the in-memory objects — and therefore the UI bound to them — still show the
  new values;
- nothing was persisted, so a relaunch shows the old values (the UI and the
  store disagree);
- worse, a later unrelated `save()` on the same context can flush those
  lingering mutations, persisting a batch the user was told had failed.

## Root cause (as observed in one app; see Status above)

`rollback()` resets the context's **pending changes graph** — inserted objects
are discarded, deleted objects are restored. It is *not* an undo log for
attribute writes on objects that were already fetched and registered. Those
mutations happened on live model instances; there is no recorded prior value
to restore, so nothing is restored.

This is precisely why an insert-shaped precedent does not transfer. Code like a
batch-import flush works correctly with `rollback()` because everything it
touches is a **pending insert** — discarding the graph genuinely undoes it.
Copying that error-handling shape into an **attribute-mutation** batch produces
a rollback that reads correct and does nothing.

## The fix: capture before mutating, restore explicitly on failure

```swift
func applyBatch(_ edits: [Edit]) throws {
    // 1. Capture previous values BEFORE the first mutation.
    var previous: [PersistentIdentifier: Snapshot] = [:]
    for edit in edits {
        guard let object = fetch(edit.id) else { continue }
        previous[edit.id] = Snapshot(name: object.name, quantity: object.quantity)
    }

    do {
        for edit in edits { apply(edit) }
        try context.save()
    } catch {
        // 2. Restore explicitly. rollback() alone will NOT do this.
        for (id, snapshot) in previous {
            guard let object = fetch(id) else { continue }
            object.name = snapshot.name
            object.quantity = snapshot.quantity
        }
        context.rollback()   // still worth calling — it handles pending inserts/deletes
        throw error
    }
}
```

The snapshot is a plain value type holding only the attributes this batch
touches. Don't snapshot the whole model; restore only what you mutated.

## The failed-save contract (observed in one app, not yet reproduced)

The failure that matters is wider than one rollback corner: a failed save that
the caller treats as "handled". These rules came out of one app's tech-debt
waves, found by whole-repo review rather than by user reports. The residue
rule's second half (a later good save rewriting the leftovers) has **not** been
reproduced in a test; the first half is (see Status).

- **Consume residue.** A failed save leaves the context dirty. Fetch before and
  after every save you care about, and either restore or discard the leftovers,
  or the next unrelated `save()` on that context persists them. In the observed
  case a failed "Delete All Data" deleted everything on the next unrelated save.
- **Side effects wait for the commit.** Sidecar files, reminders, diagnostics and
  index writes run only after `save()` returns, never before it. A side effect
  that ran before a failed save has nothing to undo it.
- **Report the commit, not the setter.** A mutator returns the outcome of the
  save, not of the property assignment, so callers cannot treat success as given.
- **No success feedback on failure.** Haptic, notice and copy fire from the
  outcome, never unconditionally after the call.
- **Make create-retry idempotent.** A retry after a partially applied create must
  not duplicate; key the create on a stable id and look it up first.

To confirm the residue half, write the failing test: make the first `save()` of
a delete-all throw (a seam whose save closure the test controls), then make an
unrelated edit and `save()` on the same context, and assert the rows the user was
told were not deleted are still there. Ship the claim only when that test fails
on the naive store and passes on the contract.

## Testing it — the part that usually gets skipped

A test that saves successfully proves nothing. You need a **mid-batch failure**,
which means making the save fail on demand:

- reopen the same store through a second `ModelConfiguration(allowsSave: false)`
  and mutate via that context — `save()` then throws for real, with no
  production seam to build or maintain. Wrap the container in
  `withExtendedLifetime`: a `ModelContext` does not retain its `ModelContainer`,
  and a deallocated container fails the test for the wrong reason. This is
  usually the cheapest option and the one to try first;
- inject a validation-violating value partway through the batch, or
- run against a context configured so the Nth write fails, or
- extract the mutate-and-restore logic behind a seam whose `save` closure the
  test controls.

Then assert on **every** object in the batch, not just the first — the failure
mode is partial, so a test checking only object 0 passes against the broken
version.

Verify the test fails against the pre-fix code. A rollback-based error path that
never worked will still pass a test that only inspects the store rather than the
in-memory objects.

## Checklist

- [ ] Prior values captured **before** the first mutation, not derived after
- [ ] Restore loop covers every attribute the batch writes
- [ ] `rollback()` still called for pending inserts/deletes — additive here, not the fix
- [ ] A mid-batch failure test exists, asserts on all objects, and fails against pre-fix code
- [ ] The assertions target the UI's bound objects, not just a re-fetch from the store

## Evidence

Cubby iOS, session 0062 (tech-debt wave, 2026-07-22): "`ModelContext.rollback()`
does NOT reset attribute mutations on fetched `@Model` objects — it only
discards pending inserts; explicit previous-value capture/restore required."

The trigger was precedent transfer, exactly as described above: "impl attempt 1
failed on the `flushImportBatch` precedent transferring wrongly." The import
path's `rollback()` is correct — everything it touches is a pending insert — and
copying its error-handling shape into an attribute-mutation batch produced a
rollback that read correct and did nothing.

Two process facts worth carrying over:

- The missing restore was caught by an **adversarial verify round**, logged as "a
  real silent-persistence bug", not by the implementing phase's own tests. A
  rollback path that never worked passes any test that inspects only the store.
- Coverage landed as a dedicated rollback test suite using the read-only-container
  technique above; "no production seam" was needed.

The failed-save rules were learned in the same app after the fact, each written
into its `AGENTS.md` by a separate commit: the rollback rule (`db83143`,
2026-07-22), side effects after the commit (`25cf5ee`, 2026-10-02) and failed-save
residue (`1348bf3`, 2026-10-05). The residue commit's trigger, `89642e2`, came from
a code review rather than a user report: its body says a failed save's changes
were rewritten on the next good save, so a failed Delete All Data deleted
everything on the next unrelated save. Until now the plugin carried only the first.

The same wave also wrote the rule into that app's own `AGENTS.md`. That is the
right split, not a duplication: the repo rule is local enforcement on a specific
save path, and this skill is the portable form. An app with an attribute-mutating
batch save should end up with both.

## Related skills

- `swiftdata-inmemory-test-harness` — the harness the mid-batch-failure test runs
  inside: runner crashes, cross-suite races, and store-reset traps that will
  otherwise be blamed on this test.
- `swiftdata-cloudkit-model-rules` — model-level rules for the same store;
  consult before adding or changing the attributes a batch edit mutates.
- `ios-photo-sidecar-store` — where the rollback question gets genuinely harder.
  A mutator that only reassigns references has nothing on disk to undo and can
  legitimately keep-and-retry; one that wrote a sidecar file first must roll
  back. Decide per mutator, and record which one it is.
