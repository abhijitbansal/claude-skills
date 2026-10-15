# make-dashboard v2 eval — 2026-10-12

14 prompts (the 10 earlier dashboard prompts + 4 new: `kinds-mix`, `views-pair`, `themed`, `edit-kind`).
Measured with `node eval/run-eval.mjs --skill dashboard --host <host> --model <model> --timeout 900`.

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **14/14** | 1 | 23 | `dashboard-v2-haiku-2026-10-12/` |
| claude / sonnet | **14/14** | 1 | 22 | `dashboard-v2-sonnet-2026-10-12/` |
| codex-oss / gemma4 (local) | **10/14** (7/10 on the original prompts, 3/4 on the new ones) | 1 | 110 | `dashboard-v2-nosysca-2026-10-12/` |
| codex-oss / gemma4, **main** skill, same conditions (A/B) | 6/10 | — | — | not committed (scratch run) |

## Gate

- Haiku ≥ 9/10 valid with median validate runs 1: **pass** (14/14, 1). SKILL.md now pins `model: haiku` and `effort: low`.
- gemma4: the recorded 10/10 from 2026-10-10 did not reproduce. `main`'s skill scored 6/10 on the same prompts under the same conditions, and this branch 7/10. So there is no regression. gemma4's failures are model behaviour:
  - it ended its turn before reading SKILL.md (13–49 s runs with no spec);
  - it could not repair a DuckDB "alias in GROUP BY" error in 5 validate rounds;
  - one edit prompt left the seed unchanged.

## Environment issue found (affects any Codex-sandboxed run on this machine)

The first gemma4 run (`dashboard-v2-2026-10-12/`, 3/14, zero validate runs) was invalid:
- `NODE_USE_SYSTEM_CA=1` is set machine-wide via `launchctl`. Node 24.7 then reads the macOS keychain at startup, the Codex 0.145 seatbelt sandbox denies it (`SecItemCopyMatching failed -50`), and every `node` process SIGSEGVs (exit 139). Even `node -e "console.log(1)"` crashes; `main` crashed in 5 of 5 runs.
- The eval harness now drops the variable from host environments (`eval/lib.mjs`), and `USAGE.md` has a troubleshooting row for users.
