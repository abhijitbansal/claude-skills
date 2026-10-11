---
name: fastlane-archive-multi-target-signing
description: An app just gained its first Widget/Share/Notification-Service/other embedded extension target, and a fastlane archive+export that worked fine before now fails at export (after the archive itself succeeds) with something like "requires a provisioning profile with the App Groups feature" or "no provisioning profile mapping" for the extension's bundle id. Use this whenever adding, reviewing, or debugging a fastlane Fastfile `archive`/`gym` lane in a project with more than one signed target (main app + any .appex), or whenever a release fails specifically at the export step right after "ARCHIVE SUCCEEDED."
---

# Fastlane Archive Lane Must Sign *Every* Embedded Extension, Not Just the Main App

## Symptom

`fastlane archive` (or an equivalent `gym` call with manual signing) has
worked for every release so far. After adding a new embedded extension target
— a widget, a share extension, a notification service, anything that ships as
its own `.appex` with its own bundle id — the **archive itself still
succeeds** (`ARCHIVE SUCCEEDED`), but export fails:

```
error: exportArchive "<App>Widget.appex" requires a provisioning profile
with the App Groups feature
```

This is easy to misdiagnose as an entitlement problem, because the message
mentions the specific capability (App Groups here) the extension declares.
The entitlement itself is usually fine — the actual gap is that **no profile
was ever fetched or mapped for the extension's bundle id at all.**

## Root cause

The archive lane predates the new target. It was written when there was only
one signed thing to worry about — the main app — so it fetches/ensures
**one** App Store distribution profile (for `APP_IDENTIFIER`) and maps
**one** entry in `export_options.provisioningProfiles`. A newly added
embedded extension is a **second signed target with its own bundle id**
(`com.yourcompany.App.Widget`, or `.Share`, `.NotificationService`, etc.) and,
often, its own entitlement (App Groups is the common one, since that's usually
*why* the extension needs to talk to the main app). `gym`'s manual-signing
export maps profiles by bundle id — an identifier with no entry in that map
gets no profile, and export fails specifically for that target, while the
main app's profile is perfectly fine.

**This only surfaces at export, one command after the archive already
succeeded** — so it costs a build number (build numbers can't be reused) every
time it's hit for the first time on a new extension, unless caught before
archiving.

## Fix

Loop the profile fetch/ensure step over **every** signed embedded target, not
just the main app, and map all of them into `export_options`:

The canonical lane is `ios-scaffold`'s `templates/Fastfile`; this is its
signing core:

```ruby
APP_IDENTIFIER = "com.yourcompany.App"   # rendered from app.bundle_id
TEAM_ID = ENV.fetch("APP_TEAM_ID")       # exported by load_app_config.sh
# gym rejects "app-store-connect"; map the app.yml value to gym's name.
RELEASE_EXPORT_METHOD = ENV.fetch("RELEASE_EXPORT_METHOD", "app-store-connect")
GYM_EXPORT_METHOD = {
  "app-store-connect" => "app-store",
  "release-testing" => "ad-hoc",
  "debugging" => "development"
}.fetch(RELEASE_EXPORT_METHOD, RELEASE_EXPORT_METHOD)
# Every embedded extension needs a profile. Derive the ids from
# TARGETS_EXTENSIONS (targets.extensions in .claude/app.yml: target NAMES,
# space-separated) as "<app bundle id>.<rfc1034-sanitised name>" (runs of
# spaces/underscores become '-'). A target whose bundle id deviates sets
# APP_EXTENSION_BUNDLE_IDS (space-separated bundle ids) to override.
APP_EXTENSION_IDENTIFIERS =
  if ENV["APP_EXTENSION_BUNDLE_IDS"].to_s.strip.empty?
    ENV.fetch("TARGETS_EXTENSIONS", "").split.map do |name|
      "#{APP_IDENTIFIER}.#{name.gsub(/[ _]+/, '-')}"
    end
  else
    ENV["APP_EXTENSION_BUNDLE_IDS"].split
  end

lane :archive do
  api_key = app_store_connect_api_key(
    key_id: ENV.fetch("ASC_KEY_ID"),
    issuer_id: ENV.fetch("ASC_ISSUER_ID"),
    key_filepath: ENV.fetch("ASC_KEY_PATH")   # path to the AuthKey_*.p8
  )
  # Ensure an App Store distribution profile for the app AND every embedded
  # extension, capturing each profile name. gym's automatic export can't
  # resolve a sigh-created profile, so export with manual signing and map
  # each profile explicitly. Missing an extension here leaves it unsigned at
  # export — the failure only surfaces then, not at archive time.
  # (get_provisioning_profile returns the profile UUID; the profile NAME —
  # what exportOptions maps by, though either works — is in SIGH_NAME.)
  profiles = ([APP_IDENTIFIER] + APP_EXTENSION_IDENTIFIERS).map do |identifier|
    get_provisioning_profile(
      api_key: api_key,
      app_identifier: identifier,
      team_id: TEAM_ID,
      readonly: false,
      output_path: "build"
    )
    [identifier, lane_context[SharedValues::SIGH_NAME]]
  end.to_h

  gym(
    scheme: "App",
    export_method: GYM_EXPORT_METHOD,
    export_options: {
      method: GYM_EXPORT_METHOD,
      signingStyle: "manual",
      teamID: TEAM_ID,
      provisioningProfiles: profiles   # every signed target, not just the app
    }
  )
end
```

## The rule to carry forward

**Every embedded extension added to the app must be added to the archive
lane's identifier list at the same time it's added to the Xcode project** — it
is not a release-time task, it's part of "add a new extension target." Treat
it the same way as entitlement parity (App Group identical across app +
extensions) — both are "every signed target needs matching setup," just for
different concerns (entitlement content vs. provisioning profile mapping).
If a release preflight already has an entitlement-parity check, this is the
natural place to add a sibling check: assert that every bundle id under
`targets.extensions` (or your project's equivalent list of embedded targets)
has a corresponding entry in the archive lane's profile-fetch loop, and fail
the preflight if one is missing — catching the gap before archiving, not after.

## When to use

- Adding a widget, share extension, notification service extension, or any
  other `.appex` to an app that already has a working fastlane release lane.
- Debugging a release that fails at export (not archive) mentioning a missing
  provisioning profile or missing entitlement feature for a *specific*
  bundle id that isn't the main app's.
- Writing or reviewing a release preflight script for a multi-target app —
  add the profile-mapping check alongside any existing entitlement-parity
  check.

## Evidence

Adding the first widget extension to an app whose `archive` lane already
shipped releases: `ARCHIVE SUCCEEDED`, then export failed with
`exportArchive "<App>Widget.appex" requires a provisioning profile with the
App Groups feature`. The lane fetched and mapped one profile (the main app's
`APP_IDENTIFIER`); the extension's bundle id had no profile at all. Looping
the profile fetch over every signed target fixed it. The failure surfaces
only at export, so each first hit burns a build number.

## Related skills

- `release` — Stage 5 "Cold-start signing" carries the same
  every-signed-target profile loop (ids derived from `targets.extensions`, as
  in the snippet above), and Stage 6 the validate/upload step after it.
- `xcode-cloud-validate` — when the hosted Xcode Cloud archive fails at
  "Prepare Build for App Store Connect", validate the exported `.ipa` locally
  with `altool`.
