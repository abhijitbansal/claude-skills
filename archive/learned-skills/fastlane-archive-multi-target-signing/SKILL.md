---
name: fastlane-archive-multi-target-signing
description: An app just gained its first Widget/Share/Notification-Service/other embedded extension target, and a fastlane archive+export that worked fine before now fails at export (after the archive itself succeeds) with something like "requires a provisioning profile with the App Groups feature" or "no provisioning profile mapping" for the extension's bundle id. Use this whenever adding, reviewing, or debugging a fastlane Fastfile `archive`/`gym` lane in a project with more than one signed target (main app + any .appex), or whenever a release fails specifically at the export step right after "ARCHIVE SUCCEEDED."
promotion_target: Patch the ios-dev plugin's release skill, Stage 5 "Cold-start signing" snippet and the Stage-6 recovery table — the existing snippet only maps a single APP_IDENTIFIER profile; it needs to loop every signed embedded target.
---

# Fastlane Archive Lane Must Sign *Every* Embedded Extension, Not Just the Main App

## Symptom

`fastlane archive` (or an equivalent `gym` call with manual signing) has
worked for every release so far. After adding a new embedded extension target
— a widget, a share extension, a notification service, anything that ships as
its own `.appex` with its own bundle id — the **archive itself still
succeeds** (`ARCHIVE SUCCEEDED`), but export fails:

```
error: exportArchive "CubbyWidget.appex" requires a provisioning profile
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

```ruby
APP_IDENTIFIER = "com.yourcompany.App"
# Every embedded extension added to the app needs its own entry here — see
# the archive lane, which loops this list for provisioning.
WIDGET_IDENTIFIER = "com.yourcompany.App.Widget"

lane :archive do
  c = asc_creds
  # Ensure an App Store distribution profile for the app AND every embedded
  # extension, capturing each profile name. gym's automatic export can't
  # resolve a sigh-created profile, so export with manual signing and map
  # each profile explicitly. Missing an extension here leaves it unsigned at
  # export — the failure only surfaces then, not at archive time.
  profiles = [APP_IDENTIFIER, WIDGET_IDENTIFIER].map do |identifier|
    name = get_provisioning_profile(
      api_key: asc_api_key,
      app_identifier: identifier,
      team_id: TEAM_ID,
      readonly: false,
      output_path: "build"
    )
    [identifier, name]
  end.to_h

  gym(
    scheme: "App",
    export_method: "app-store",
    export_options: {
      method: "app-store",
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

## Related note — verify the rendered version before archiving

A separate, smaller trap in the same release flow: if your version-bump step
supports multiple "kinds" (e.g. `build` vs `minor` vs `patch`), it's easy to
run the wrong one from muscle memory — especially right after a prior release
used a different kind. Before archiving, print and eyeball the **actual
rendered** version/build values from the project's single source of truth
(e.g. `project.yml`), not just the flag you think you passed — a build-only
bump that silently ran as a patch bump (or vice versa) is much cheaper to
catch at this print-and-confirm step than after upload.
