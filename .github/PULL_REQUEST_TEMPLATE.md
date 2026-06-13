<!-- Thanks for contributing! Keep PRs focused. -->

## What & why

<!-- One or two sentences: what does this change and why? -->

## Type

- [ ] Bug fix
- [ ] New skill / command / hook
- [ ] New or updated tool
- [ ] Docs
- [ ] Setup / CI

## How I tested

<!-- Commands you ran. -->

```
bats tests/bats/
uv tool run pytest tests/pytest -q
shellcheck setup/*.sh adapters/*.sh
```

## Manual verification still needed?

<!-- Anything CI/tests can't cover (device-only iOS flows, etc.). Say "none" if so. -->

## Checklist

- [ ] Skills are tool-agnostic (read config, no hardcoded project names/paths)
- [ ] Shell scripts are `set -euo pipefail` and pass `bash -n` + `shellcheck`
- [ ] No secrets, tokens, or personal paths committed
- [ ] Docs/README updated if behavior or install steps changed
