# claude-skills

Seeding repo for Abhijit's Claude Code dev environment. Cloned on each machine, drives a reproducible install of marketplaces, plugins, npx-skills, custom skills, agents, hooks, and commands.

## Bootstrap a fresh machine

```bash
git clone https://github.com/<owner>/claude-skills ~/projects/claude-skills
bash ~/projects/claude-skills/setup/setup.sh
```

## Snapshot a machine's current state back into the repo

```bash
bash setup/capture.sh
git diff   # review
```

## Contribute from any repo or machine

```bash
claude-skills-contribute --message "..." [--skill <new-skill-name>]
```

## Layout

See `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md` for the design.
