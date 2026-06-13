---
name: alternate-app-icons
description: Adding user-selectable alternate app icons to an iOS app whose .xcodeproj is generated from XcodeGen project.yml, keeping a new icon as default. Covers the ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES build setting (actool emits CFBundleAlternateIcons even with GENERATE_INFOPLIST_FILE NO), the opaque-RGB requirement for App Store Connect (alpha → blank tile), separate downscaled imagesets for picker thumbnails (appiconset contents aren't loadable via Image/UIImage), setAlternateIconName usage, and OS-managed persistence. Trigger on "let users pick the app icon", "bring back the old icon", or alternate-icon setup.
---

# iOS Alternate App Icons (XcodeGen project)

## Why this skill exists

Letting users switch app icons in-app (e.g. restore a retired icon) while
keeping a new icon as the default — without hand-editing `Info.plist` or the
`pbxproj` — has several non-obvious gotchas around the asset catalog, App Store
opacity rules, and how thumbnails load.

## When to use

"Let users pick the app icon", "bring back the old icon", or alternate-icon
setup in any XcodeGen / actool-based iOS project.

## Steps

1. **Recover a retired icon from git** if needed:
   `git show '<swap-commit>^:path/to/icon.png' > new-set/icon.png`.
2. **New `AppIconClassic.appiconset`** with light/dark/tinted 1024s. The light
   variant MUST be opaque RGB — alpha becomes a blank tile in App Store Connect.
3. **project.yml**, app target settings:
   `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES: AppIconClassic`. actool emits
   `CFBundleAlternateIcons` into the built `Info.plist` even with
   `GENERATE_INFOPLIST_FILE: NO`.
4. **Picker thumbnails:** appiconset contents are NOT loadable via `Image(_:)` /
   `UIImage(named:)`. Add separate downscaled imagesets (`sips -Z 180`).
5. **Switch:** `try await UIApplication.shared.setAlternateIconName(name)`
   (`nil` = primary). Guard `supportsAlternateIcons`. iOS-only — wrap in
   `#if os(iOS)` for cross-platform source trees.
6. **No persistence code:** the OS stores the choice; read it back via
   `UIApplication.shared.alternateIconName` (`nil` = primary = your default).
7. **Optimistic UI:** flip the selection immediately, revert in `catch`.

## Example

```swift
enum AppIconOption: String, CaseIterable {
    case primary = "AppIcon"          // default
    case classic = "AppIconClassic"   // alternate

    var alternateIconName: String? { self == .primary ? nil : rawValue }

    static var current: AppIconOption {
        UIApplication.shared.alternateIconName
            .flatMap(AppIconOption.init(rawValue:)) ?? .primary
    }
}

// In the picker:
let previous = selection
selection = option
Task {
    do { try await UIApplication.shared.setAlternateIconName(option.alternateIconName) }
    catch { selection = previous; errorMessage = error.localizedDescription }
}
```

## Verification

- `/usr/libexec/PlistBuddy -c 'Print :CFBundleIcons' BuiltApp/Info.plist`
- Hosted unit tests: `Bundle.main` IS the host app — assert
  `CFBundleAlternateIcons` and `UIImage(named:)` for the thumbnails.
- Gotcha: after creating new source/test files, re-run `xcodegen generate`
  BEFORE testing — a stale pbxproj silently runs 0 tests with `TEST SUCCEEDED`.
