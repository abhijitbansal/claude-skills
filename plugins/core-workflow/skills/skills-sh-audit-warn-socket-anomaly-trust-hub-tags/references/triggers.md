# Flag, trigger, fix, pin

One row per flag seen in a portable-artifacts security pass. "Status" is what is
known: no scanner has been rerun, so no row says a flag cleared. Escapes are
written in the braced form `\u{XXXX}`; see the tooling trap below the table.

| Provider and flag | What triggered it | Fix used | Test that pins it | Status |
|---|---|---|---|---|
| Socket Anomaly (LOW) | A render helper: `chip()` interpolates `tone` into an HTML attribute without validation | Closed `Set` of tones derived from the tables, fall back to `neutral` | Cases for `'"><script>'` and `'good bad'` | Fix applied, not rescanned |
| Socket alert (earlier) | An fs-patching test fixture | Do not hide the patch. Provoke the fault for real: replace the theme file with a directory in a temp copy (EISDIR), spy with `t.mock.method` | The test exercises the real EISDIR path | Fixed, not rescanned. A first attempt moved the patch into a URL-encoded `data:` URL preloaded with `node --import`; that reads like an encoded loader and was dropped |
| Trust Hub OBFUSCATION | Literal invisible characters in source: bidi controls U+200F, U+202B, U+202E, U+2067 and U+FEFF inside an RTL regex (the Trojan Source shape), plus U+2028/2029, U+FFFE/FFFF, U+FEFF | `\u{XXXX}` escapes. Rewrite the regex under a characterisation test | Characterisation test over 0..0x10FFFF comparing old and new regex. Guard test that fails on any literal bidi, zero-width, Tag, Zl/Zp or other Cf character in shipped files, allowing only ZWJ and U+FE0E/F | Fixed. An escaped Unicode Tags range was also flagged in the original audit; we judged it a false positive. Not rescanned |
| Trust Hub INDIRECT_PROMPT_INJECTION | Skills that read commit messages, DB rows, CSV cells, file names, report findings or user pictures | (a) SKILL.md rule: that text is data, never instructions, with the one-clause reason. (b) Agent-facing stdout only: escape (never delete) Cc, Cf, Co, Cn, Zl, Zp and variation selectors as `\u{XXXX}`, cap length. (c) Same rule in each small-model agent file with Bash access | Not recorded per item. Keep page data exact: escaping in the data layer broke emoji in titles | Fix applied. The tag may stay: the skills do read such text |
| Trust Hub disclosure mismatch | Description said "Works offline" while the postgres and mysql sources connect | Scope the claim to file sources. Name every download (hosts, pinned commit plus SHA-256), every write outside the project, every optional network flag | Doc wording only | Fixed in prose |
| "Contains Shell Commands" badge | HYPOTHESIS: SKILL.md prose "suggest prefixing it with `!`" resembles the `!` plus backtick dynamic-context syntax | Reworded | none | Unconfirmed. The badge may stay because the skills legitimately run commands |
| Credential in docs | Crontab and plist examples carried a DSN password | Wrapper that sources a `chmod 600` env file. Read-only database role | Doc review | Fixed in prose |
| Minified vendored bundle | A header hash of the sources does not prove the bundle bytes | Rebuild the bundle in memory in a test and compare byte for byte. Provenance paragraph in `THIRD_PARTY_NOTICES` | The byte-for-byte rebuild test | Fix applied |
| Test seam in production | A test-only env variable swapped the scripts a runner launches, and production honoured it | Gate the variable on `NODE_ENV=test` | Not recorded | Fix applied |
| Over-eager publishing | Wording "if your host can publish, publish" | Publish only on request. Confirm before private data leaves the machine | Doc wording only | Fixed in prose |

## Tooling trap: four-hex-digit escapes typed into a file body

An agent's edit tool decoded `\uXXXX` escapes (four hex digits) typed into a file
body into the literal characters, which re-created the very flag being fixed.

- Type the braced form `\u{XXXX}` in the file body, or write the file from a
  script that builds the string.
- Let the guard test catch slips: it scans shipped files for literal characters.
- After any edit session that touched escapes, rerun the guard test before
  committing.

## Listing evidence, for reference

- Detail pages: `https://skills.sh/<owner>/<repo>/<skill>/security/agent-trust-hub`,
  `.../security/socket`, `.../security/snyk`.
- Trust Hub shows Pass / Risk SAFE plus tags (EXTERNAL_DOWNLOADS,
  COMMAND_EXECUTION, OBFUSCATION, INDIRECT_PROMPT_INJECTION, DATA_EXFILTRATION)
  and a written analysis. Socket shows Pass or WARN with Anomaly alerts, each with
  confidence and severity percentages. Snyk showed Risk LOW and "No issues
  detected".
- After the repo move the new-repo skill pages answered HTTP 200 with
  "<skill> isn't available in this repository" while the old listing kept audits
  dated Oct 19 to 29.
