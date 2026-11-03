# shared/

Code and assets used by more than one portable-artifacts skill: error helpers,
themes, fonts and contrast checks. Edit files **here only**, then run, from
`plugins/portable-artifacts`:

    node bin/sync-shared.mjs

That copies this folder (minus `test/` and this README) into
`skills/<skill>/shared/`. Every install path copies whole skill folders,
including `npx skills add … --skill <name>`, so each skill must carry its own
copy. CI runs `node bin/sync-shared.mjs --check` and fails on any drift.

`art.mjs` draws seeded procedural art (`artSvg({ theme, seed, width, height, mode })`) as an inline SVG in the theme's own tokens: no script, no external references, the same arguments give the same bytes.

`stale-copy.mjs` warns once on stderr when a build or render runs from an old copy under `~/.claude/plugins/cache/`: it compares the running script's folder with the `installPath` that `~/.claude/plugins/installed_plugins.json` lists for `portable-artifacts@claude-skills`, and stays silent outside that cache, when the file is missing or unreadable, or when the script sits inside the installed copy. It never throws and never changes an exit code.

Rules: no npm dependencies (skills have separate lockfiles); tests live in
`shared/test/` and run with `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (quote the glob so Node expands it, which needs Node >= 21; CI uses Node 24. The directory form fails on Node 24.7).
