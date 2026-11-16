# Engine font sources

Variable display faces for the version 2 engine, from `@fontsource-variable/*` (npm), each licensed OFL-1.1;
the licence text for each family is in `LICENSES/`. Bundled faces for text and mono use stay in
`../../shared/fonts/` (see its own SOURCES.md).

| File | Package | Version | Source file in package | SHA-256 | Licence |
|---|---|---|---|---|---|
| fraunces-latin-full-normal.woff2 | @fontsource-variable/fraunces | 5.3.0 | files/fraunces-latin-full-normal.woff2 | `7e744849028e2219e2aa1bc467dc4032980dc4487c9c3da3010081cd72d3b103` | OFL-1.1 |
| archivo-latin-standard-normal.woff2 | @fontsource-variable/archivo | 5.3.0 | files/archivo-latin-standard-normal.woff2 | `e3a28eade21a900c7155a247757f4b2834c07bb7ef07ad7efa55cebaac1e8f5e` | OFL-1.1 |
| nunito-latin-wght-normal.woff2 | @fontsource-variable/nunito | 5.3.0 | files/nunito-latin-wght-normal.woff2 | `ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793` | OFL-1.1 |

## What each file carries

- **Fraunces** (`full`, Latin, upright): axes `wght` 100-900, `opsz` 9-144, `SOFT` 0-100 and `WONK` 0-1. The page
  does not use `WONK`. The italic is not bundled.
- **Archivo** (`standard`, Latin, upright): axes `wght` 100-900 and `wdth` 62-125. The italic is not bundled.
- **Nunito** (`wght`, Latin, upright; the `cosmos` look's rounded sans): axis `wght` 200-1000, 39128 bytes. The
  package has no other axis; the italic is not bundled. Source:
  `https://registry.npmjs.org/@fontsource-variable/nunito/-/nunito-5.3.0.tgz` (tarball SHA-256
  `be290c38a2fa3422e2b51c0c4992511a9483d6f6e0074fc24eb8968e6ac67330`); package licence `OFL-1.1`, Fontsource
  metadata `v32`, last modified 2025-09-16.

The Fraunces and Archivo Latin files came from the smallest variant that carries every axis a look needs, so no
trade-off was made: the two files total 211120 bytes (206 KiB). With Nunito the three total 250248 bytes (244 KiB),
against the 600 KB budget (`test/v2/fonts.test.mjs`, `test/v2/cosmos-fonts.test.mjs`). The smaller `wght`-only and
`wdth`-only variants of Fraunces and Archivo exist but would give up `opsz`, `SOFT` and `wdth`.

## Verify

`shasum -a 256 <file>` for each file above. To refetch: `npm pack @fontsource-variable/<name>@5.3.0` and take
the file named in "Source file in package"; the licence text is the package's `LICENSE`.
