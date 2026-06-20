---
name: xcode-cloud-validate
description: Diagnosing an opaque Xcode Cloud archive failure — the "Archive" action fails at "Prepare Build for App Store Connect" with only a generic message, all sub-steps green, and no build in TestFlight. The real ITMS rejection is buried; reproduce it locally by downloading the ARCHIVE_EXPORT artifact (.ipa) and running xcrun altool --validate-app, which prints the exact ITMS error codes. Includes the ES256 JWT shape for the ASC API (Node crypto when pyjwt is unavailable) and where the deep distribution logs live. Trigger when Xcode Cloud archive fails with no detailed error or TestFlight shows no builds despite successful-looking CI.
---

# Xcode Cloud Opaque Archive Failure → Validate Exported .ipa with altool

## Why this skill exists

Xcode Cloud's UI — and even the `ciBuildActions/{id}/issues` API endpoint —
only surfaces a generic "Preparing build for App Store Connect failed". The
real App Store Connect rejection (`ITMS-xxxxx`) is buried, or faster:
reproducible locally. Without it you're guessing, and build-log warnings
(Swift 6 actor warnings, transient "Unable to authenticate with App Store
Connect" export lines) are usually red herrings that don't actually block.

## When to use

- Xcode Cloud archive fails at "Prepare Build for App Store Connect" with no
  detailed error
- TestFlight shows no builds despite "successful-looking" CI logs
- Any need to test ASC upload validation without waiting for a full CI round-trip

## Solution — validate the exact binary locally

1. Xcode Cloud uploads an `ARCHIVE_EXPORT` artifact named like
   `<App> <version> app-store.zip`. Download it (App Store Connect web UI →
   build → Artifacts, or ASC API `/v1/ciArtifacts/{id}` → `downloadUrl`).
2. Unzip → it contains the `.ipa`.
3. Validate against the real ASC pipeline:

   ```bash
   xcrun altool --validate-app -f App.ipa -t ios \
     --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
   ```

   altool auto-finds the `.p8` at
   `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` (also `./private_keys`,
   `~/private_keys`, `~/.private_keys`).
4. The output contains the exact ITMS error codes + descriptions ASC used to
   reject the upload.

If no Python `pyjwt` / `cryptography` is available for ASC API JWT generation,
Node's built-in crypto works:

```js
const signer = createSign('SHA256')
signer.update(`${headerB64url}.${payloadB64url}`)
const sig = signer.sign({ key: p8Contents, dsaEncoding: 'ieee-p1363' }) // ES256 raw r||s
```

Payload: `{ iss: ISSUER_ID, iat, exp: iat+900, aud: 'appstoreconnect-v1' }`;
header: `{ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }`.

Deep logs (if needed) are in the `LOG_BUNDLE` artifact under
`*-export-archive-logs/*.xcdistributionlogs/` (`IDEDistribution.critical.log`).

## Worked example

A real failure: every upload failed with `ITMS-90098` —
`UIRequiredDeviceCapabilities` contained `lidar-depth-camera`, which is **not a
valid capability value at any MinimumOSVersion** (the "incompatible with
MinimumOSVersion X" wording is misleading; the string is simply unrecognized).
There is no install-time LiDAR gate — use a runtime check like
`RoomCaptureSession.isSupported`. Distinguish severities: `ITMS` errors block;
`server_warning` entries (e.g. `ITMS-90984`) do not.
