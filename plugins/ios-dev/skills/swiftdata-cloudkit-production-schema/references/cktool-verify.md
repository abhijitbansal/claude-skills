# Verifying the CloudKit Production schema with `cktool`

The two checks from rule 3 of `swiftdata-cloudkit-production-schema`, runnable
with Apple's own `cktool` (ships with Xcode) and no project-specific script. Both
are **read-only**: they export schema and compare. Deploying stays a deliberate
Console action ("Deploy Schema Changes to Production") or an add-only
`cktool import-schema`.

## One-time setup: a management token

1. CloudKit Console → Settings → Tokens → create a **CloudKit Management Token**.
2. `xcrun cktool save-token --type management` (secure prompt, stored in the
   keychain). `cktool` also reads `CLOUDKIT_MANAGEMENT_TOKEN` from the environment.

The token can modify and reset schema. Keep it in the keychain; never commit it or
pass it on a command line your shell logs. Prove it resolves with
`xcrun cktool get-teams`.

## Export both environments

```bash
xcrun cktool export-schema --team-id <TEAM_ID> --container-id <CONTAINER_ID> \
  --environment development --output-file .scratch/schema-development.ckdb
xcrun cktool export-schema --team-id <TEAM_ID> --container-id <CONTAINER_ID> \
  --environment production --output-file .scratch/schema-production.ckdb
```

`--team-id`, `--container-id`, `--environment` and `--output-file` are the flags
`cktool export-schema --help` lists. Keep the output under a gitignored directory.

**Ground-truth caveat:** Development only reflects the current model if a current
dev build has run against CloudKit Development with sync ON and materialized the
schema. Run the app once that way before trusting a "clean" result.

## Check 1 — model coverage (catches types that exist in neither environment)

Every `@Model` type the app registers must have a `CD_<TypeName>` record type in
**Production**. A type's schema is created lazily on first sync of that type, so
an unsynced type is absent from both environments and the Dev-vs-Prod diff reads
clean. Compare against the app's own type list instead:

```bash
for t in Item Photo Rack; do                  # your registered @Model type names
  grep -qE "RECORD TYPE CD_${t}([[:space:]]|\()" .scratch/schema-production.ckdb \
    || echo "MISSING in Production: CD_${t}"
done
```

## Check 2 — Production matches Development (catches deployed-but-not-promoted fields)

```bash
diff -u .scratch/schema-production.ckdb .scratch/schema-development.ckdb
```

Lines starting `+` exist in Development and not in Production: changes that were
never deployed. No output means no drift for the types Development knows about.
Check 1 still has to pass, since a never-materialized type is invisible here.

## What was and was not verified

- Verified against `cktool --help` and `export-schema --help` (Xcode 27): the
  subcommands and flags above exist. The Check 1 `grep` was run against a sample
  `.ckdb` fragment and flags a missing type.
- **Not verified:** a live export. It needs a CloudKit management token, so run it
  once against a real container (manual step) and confirm the `RECORD TYPE
  CD_<Name>` shape in your exported file before relying on the `grep` pattern.
