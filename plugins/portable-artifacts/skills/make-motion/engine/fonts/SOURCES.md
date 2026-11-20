# Engine font sources

Variable display faces for the version 2 engine, from `@fontsource-variable/*` (npm), each licensed OFL-1.1;
the licence text for each family is in `LICENSES/`. Bundled faces for text and mono use stay in
`../../shared/fonts/` (see its own SOURCES.md).

| File | Package | Version | Source file in package | SHA-256 | Licence |
|---|---|---|---|---|---|
| fraunces-latin-full-normal.woff2 | @fontsource-variable/fraunces | 5.3.0 | files/fraunces-latin-full-normal.woff2 | `7e744849028e2219e2aa1bc467dc4032980dc4487c9c3da3010081cd72d3b103` | OFL-1.1 |
| archivo-latin-standard-normal.woff2 | @fontsource-variable/archivo | 5.3.0 | files/archivo-latin-standard-normal.woff2 | `e3a28eade21a900c7155a247757f4b2834c07bb7ef07ad7efa55cebaac1e8f5e` | OFL-1.1 |
| nunito-latin-wght-normal.woff2 | @fontsource-variable/nunito | 5.3.0 | files/nunito-latin-wght-normal.woff2 | `ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793` | OFL-1.1 |
| geist-latin-wght-normal.woff2 | @fontsource-variable/geist | 5.3.0 | files/geist-latin-wght-normal.woff2 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` | OFL-1.1 |
| caveat-latin-wght-normal.woff2 | @fontsource-variable/caveat | 5.3.0 | files/caveat-latin-wght-normal.woff2 | `891951df5e8b5b0f0bc760d31375405e795c666b5add70437de12d4a6482b33f` | OFL-1.1 |

## What each file carries

- **Fraunces** (`full`, Latin, upright): axes `wght` 100-900, `opsz` 9-144, `SOFT` 0-100 and `WONK` 0-1. The page
  does not use `WONK`. The italic is not bundled.
- **Archivo** (`standard`, Latin, upright): axes `wght` 100-900 and `wdth` 62-125. The italic is not bundled.
- **Nunito** (`wght`, Latin, upright; the `cosmos` look's rounded sans): axis `wght` 200-1000, 39128 bytes. The
  package has no other axis; the italic is not bundled. Source:
  `https://registry.npmjs.org/@fontsource-variable/nunito/-/nunito-5.3.0.tgz` (tarball SHA-256
  `be290c38a2fa3422e2b51c0c4992511a9483d6f6e0074fc24eb8968e6ac67330`); package licence `OFL-1.1`, Fontsource
  metadata `v32`, last modified 2025-09-16.

- **Geist** (`wght`, Latin, upright; the `keynote` look's neutral sans, registered as the family `Geist Variable` so
  it does not collide with the static shared `Geist` 400 and 600): axis `wght` 100-900, 29400 bytes. Source:
  `https://registry.npmjs.org/@fontsource-variable/geist/-/geist-5.3.0.tgz` (tarball SHA-256
  `533dd66117795ac12316fb05fce27736c4bc63c31613b302d0a5285ca3a291d7`); package licence `OFL-1.1`, Fontsource
  metadata `v5`, last modified 2026-05-13. The package's `ital` axis lives in separate italic files, not bundled.

- **Caveat** (`wght`, Latin, upright; the `marker` look's handwriting, in every role): axis `wght` 400-700, 74932
  bytes (the variable file fits the budget, so the static 700 fallback was not needed). Source:
  `https://registry.npmjs.org/@fontsource-variable/caveat/-/caveat-5.3.0.tgz` (tarball SHA-256
  `2f50d55732648330ec8dcb4eef79666ef1131a57e7f0441975657a4b2ff20ba9`); package licence `OFL-1.1`. It replaces
  version 1's `template/sketch/caveat-700.woff2` (deleted at cut-over).

The Fraunces and Archivo Latin files came from the smallest variant that carries every axis a look needs, so no
trade-off was made: the two files total 211120 bytes (206 KiB). With Nunito the three total 250248 bytes (244 KiB),
and with Geist the four total 279648 bytes (273 KiB, measured with `stat`); with Caveat the five total 354580 bytes
(346 KiB, measured with `stat`: 279648 + 74932), against the 600 KB budget (`test/v2/fonts.test.mjs`, `test/v2/cosmos-fonts.test.mjs`). The smaller `wght`-only and
`wdth`-only variants of Fraunces and Archivo exist but would give up `opsz`, `SOFT` and `wdth`.

## Final byte total (2026-11-18)

Five files, sizes from `ls -l` on each file: Fraunces 121016, Archivo 90104, Nunito 39128, Geist 29400, Caveat 74932.
Sum 354580 bytes (346 KiB). The budget in `test/v2/fonts.test.mjs` and `test/v2/cosmos-fonts.test.mjs` is
`600 * 1024` = 614400 bytes, so 259820 bytes are left. This matches the total recorded above.

## Verify

`shasum -a 256 <file>` for each file above. To refetch: `npm pack @fontsource-variable/<name>@5.3.0` and take
the file named in "Source file in package"; the licence text is the package's `LICENSE`.
