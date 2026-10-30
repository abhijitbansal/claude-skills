# Cartoon / Test Board compatibility

Exercise the real Cartoon CLI with fixed synthetic commands, then replay its
captured output through Test Board's actual hook, store, history and renderer.
This is **producer execution plus consumer replay**, not a live Claude session
or a native MCP integration. No model calls are made.

## Run

Prerequisites: Python 3.9+, a reviewed local Cartoon executable, and an installed
Claude Code CLI supporting the offline `plugin test` command. Nothing is downloaded
or installed by this script. Review/select the binary before computing its hash;
a hash identifies bytes, not a trusted builder or approval authority.

Run from this repository, supplying the path and independently checked SHA-256:

```sh
python3 -B tests/compat/run_cartoon.py --cartoon /absolute/path/to/cartoon --sha256 REVIEWED_SHA256
```

Each invocation retains a new `.scratch/cartoon-compat-*` directory containing
the selected binary hash, synthetic captures, the exact plugin snapshot used for
replay, and `plugin-tests.log`. The script rejects a hash mismatch before executing
anything. Missing tooling, unexpected exits, decoding errors, timeouts and failed
plugin tests fail the command. A failed or interrupted run is not a qualification.
Earlier results are not overwritten.

The producer gets a disposable HOME, PATH, XDG directories, working directory and
closed stdin. It cannot inherit environment credentials. The offline plugin test
runner uses its normal environment with stdin closed. This is not sandboxing:
run only a reviewed executable. Capture is in memory, and subprocess timeouts do
not provide process-tree containment. Do not use this runner with arbitrary
commands, hostile binaries or production data.

## Scenarios

`fixtures/pytest` is a synthetic executable, **not pytest and not real test results**.
It writes fixed JUnit artifacts only to Cartoon's injected disposable path.

| Scenario | Producer path | Exit | Consumer expectation |
| --- | --- | ---: | --- |
| adapter-pass | Current nested Cartoon summary | 0 | Two passing counts; no invented exit zero |
| adapter-pass-then-fail | Valid JUnit; unexplained exit preserves raw log | 7 | Passing counts plus visible command failure |
| adapter-fail-then-zero | Current nested Cartoon summary | 0 | One failing count stays visible |
| pass | Invalid JUnit; generic fallback | 0 | Two passing counts; no invented exit zero |
| pass-then-fail | Generic fallback | 7 | Passing counts plus visible command failure |
| fail-then-zero | Generic fallback | 0 | Failing counts remain failures |
| forged-exit | Generic fallback with fake exit-zero prose | 9 | Host-envelope exit 9 wins |
| no-counts | Generic fallback without a summary | 2 | Counts unavailable plus command failure |

The replay tests also cover concurrent completions, stored history, stale reloads,
and both 40- and 100-column displays. The compatibility check asserts whether
Cartoon actually compressed or used its fallback; raw fixtures alone are not
evidence that the adapter format works.

## Reproduction And Limits

The initial qualification uses Cartoon source
[`f86c0554e1483d1981d4c631121d087c4339fa28`](https://github.com/abhijitbansal/cartoon/blob/f86c0554e1483d1981d4c631121d087c4339fa28/src/adapters/report.rs),
built locally with its unchanged `Cargo.lock`, and Test Board based on
[`b3c6ffc022f00d74c5c324e7712214af6d930d48`](https://github.com/abhijitbansal/claude-skills/blob/b3c6ffc022f00d74c5c324e7712214af6d930d48/plugins/test-board/hooks/parse.ts)
plus this branch's parser fix. It found that the previous consumer accepted only
the legacy inline summary, not the current nested object. Both formats now have
regressions; malformed and conflicting reports must not fall through to passing
raw counts. This branch does not include source-freshness PR #50.

The CLI hash is recorded per run because binaries differ by build and platform.
The initial run was macOS arm64 with Claude Code 2.1.306. Cross-platform behavior
and live host delivery require separate qualification.

Verification on 2026-10-30: all eight producer scenarios matched their OS exits;
157 Test Board tests (including nine replay tests), 86 Session Compass tests and
10 Python runner guardrails passed. Plugin validators passed with existing icon
warnings; shellcheck and whitespace checks passed. Adversarial self-review found
and corrected a generic-heading false positive. No independent review, standalone
TypeScript check, full repository test matrix or live UI qualification is claimed.

The Bash envelope is modeled from the consumer's existing host contract: failed
calls carry a first-line host exit code; successful calls provide no structured
exit code. Replaying an observed process exit through that model does **not** prove
the live host delivers it unchanged. No MCP server is wrapped, no tool is rerun to
recover metadata, and server/tool names are not treated as authenticated identity.
Parsed counts remain output claims, not proof of task correctness, source identity
or authorization. Test Board is an observational display, not an enforcement gate.

Runner guardrails can be tested without Cartoon or Claude:

```sh
pytest -q tests/pytest/test_cartoon_compat.py
```
