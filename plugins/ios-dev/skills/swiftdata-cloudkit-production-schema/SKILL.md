---
name: swiftdata-cloudkit-production-schema
description: A SwiftData+CloudKit app is preparing or debugging its CloudKit SCHEMA lifecycle — deploying to Production, a record type or field missing from the Console, a mystery CD_-prefixed field nobody defined (CD_moveReceipt, CD_entityName), a "clean" Dev/Prod diff that still loses data on TestFlight, renaming a synced @Model property, or a SwiftDataError/CKError that only reproduces on device. Use whenever the work touches CloudKit Console schema state, initializeCloudKitSchema, a release that includes @Model changes, or a rename/migration on a store already shipped to users. Prerequisite: read ios-dev:swiftdata-cloudkit-model-rules first — it owns the modeling basics (explicit cloudKitDatabase with .none for tests/previews, optional/defaulted properties, externalStorage photo bridge, shared schema type, single-mirror CKShare rule); this skill adds only the schema-lifecycle sharp edges it lacks.
promotion_target: Fold into ios-dev:swiftdata-cloudkit-model-rules as new rule groups (schema lifecycle + rename safety + framework-injected fields) — this file carries only the delta.
---

# SwiftData + CloudKit: the schema-lifecycle sharp edges

Evidence base: Cubby BUG-039/BUG-040 production incidents, sessions 0017/0052/0053,
`docs/CLOUDKIT_CONSOLE_VERIFICATION.md`, binary-forensics-verified. Every rule below
was learned by losing time to it.

## 1. Rename-safety boundary (shipped stores)

The computed-wrapper rename (`x` → stored `xStorage` + computed `x`) used to satisfy
CloudKit's "all relationships must be Optional" requirement is migration-safe **only**
when an unchanged to-one FK on the child side anchors reconstruction of the renamed
to-many side during lightweight migration.

**A many-to-many with BOTH ends renamed has no unchanged anchor** — join rows can
silently orphan with nothing to reconstruct from. On a store already shipped to users,
keep the original stored property name (add Optional in place instead). In Cubby this
was caught independently twice (advisor + a swift reviewer, CRITICAL/BLOCK) before it
could ship.

## 2. Framework-injected CD_ fields — do not chase as orphans

After any `initializeCloudKitSchema` export, **every** record type carries fields you
never defined:

- `CD_entityName` — entity-name discriminator (documented).
- `CD_moveReceipt` + `CD_moveReceipt_ckAsset` — `NSCKRecordZoneMoveReceipt`, Core
  Data's record-zone-move bookkeeping.

Both are injected by `PFCloudKitSerializer` at CKRecord-generation time — they are
**invisible at the NSManagedObjectModel stage**, so a model-completeness unit test
shows clean while the schema export still shows them. Expected, safe to deploy.

Consequently: never name a `@Model` property `moveReceipt`, `moveReceipts`, or
`entityName` (collision with the injected fields). `isDeleted` is separately reserved
by NSManagedObject.

**Verification method for any mystery CD_ field:** run `strings` (and `nm` /
`swift-demangle`) against the real CoreData framework binary — the device build AND
the Simulator-runtime copy (which carries symbols the public stub lacks). Cubby's
`CD_moveReceipt` mystery resolved decisively this way (`NSCKRecordZoneMoveReceipt` and
its source path appear in both binaries) after "orphan Dev record" and "stale model"
theories were each refuted by cheaper checks first: (1) `cktool reset-schema` + reinit
to rule out a stale Dev artifact, (2) a model-completeness unit test to rule out an
app-model source, (3) only then binary forensics — and independently re-verify before
any irreversible Production deploy.

## 3. Lazy JIT materialization — the false-clean diff

A record type's CloudKit schema materializes **on first sync of that type**. If no dev
build ever created + synced an instance of a type, that type is absent from **both**
Development and Production — so a Dev↔Prod diff reads CLEAN while the type is silently
undeployed (Cubby: only 6 of 10 registered types existed in Production; TestFlight
users' records of the other 4 silently failed to sync).

**Schema verification must therefore run two checks:**
1. **Model-coverage check** — diff the deployed schema against the app's own
   source-of-truth model-type list (the shared schema type). This is the check that
   actually catches undeployed types.
2. Dev↔Prod diff — catches deployed-but-not-promoted fields.

## 4. DEBUG SchemaInitializer — force-materialize everything

The durable fix for rule 3: a DEBUG-only initializer that materializes the full
Development schema without needing real usage traffic:

- Bridge the SwiftData types: `NSManagedObjectModel.makeManagedObjectModel(for:)`.
- Stand up a **transient** `NSPersistentCloudKitContainer` over a throwaway scratch
  store directory (never the app's real store).
- Call `initializeCloudKitSchema(options:)` — every entity/field materializes in
  Development.
- Tear down and delete the scratch store.

Run it (DEBUG menu / maintenance screen) before a human deploys schema to Production.

## 5. Release-preflight gate — automate the manual deploy step

Production schema deploy is a manual Console step ("Deploy Schema Changes to
Production") that gets silently forgotten (it shipped broken twice in Cubby before
automation; a hand-maintained "fields to deploy" checklist item drifted 8→10→11 across
sessions). Wire a preflight gate into the release pipeline:

- A verify script implementing both checks from rule 3 (via `cktool`).
- The release hook runs it **only when** the diff since the last `v*` tag touches
  model files / the schema type — non-model releases skip automatically.
- An explicit `SKIP_…=1` env escape hatch for machines without the CloudKit
  management token, so the gate can't hard-strand a release.

Reference implementation: Cubby `scripts/verify-cloudkit-schema.sh` +
`scripts/release-hooks/s1-pre.sh`.

## 6. Diagnosis flags — the error message lies

`SwiftDataError` code 1 (and most sync failures) surface as a generic wrapper. The
real diagnostics:

```
xcrun devicectl device process launch --console <device> <bundle-id> -- \
  -com.apple.CoreData.CloudKitDebug 3 -com.apple.CoreData.Logging.stderr 1
```

Note the `--` separator — without it devicectl's own ArgumentParser swallows the
`-`-prefixed app arguments.

## 7. Production is add-only

Never rename/delete/retype a live Production field. Design additive; a "wrong" field
stays forever (harmless) — plan names carefully before first deploy.
