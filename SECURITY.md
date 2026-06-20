# Security Policy

## Reporting a vulnerability

If you find a security issue — in a hook, a script, the machine-seed setup, or
anything that executes on a user's machine — **please do not open a public
issue.** Instead, email **contact@abhijitbansal.com** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- the affected file(s) / version.

You'll get an acknowledgement, and a fix or mitigation will be prioritized.

## Scope & what to look for

This repo ships code that agents and installers run locally. The highest-value
areas:

- **Hooks** (`plugins/*/hooks/`) — they run automatically during agent sessions.
- **Setup / installers** (`setup/`, `adapters/install.sh`, `tools/second-wind/install.sh`)
  — they modify `~/.claude`, PATH shims, and pull from the network.
- **Skill scripts** — anything invoked by a `/command` or SKILL.md.

## Notes for users

- The standalone installers are fetched over `curl | sh`. Prefer cloning the repo
  and running the local copy if you want to inspect first.
- `second-wind`'s dashboard is **localhost-only** and gates every action behind a
  per-run CSRF token; treat that token like a terminal session.
- The `setup/` machine seed and `templates/` are the owner's personal data —
  public users can ignore them; plugins never touch them.
