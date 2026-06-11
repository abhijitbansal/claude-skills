<!-- Personal seed file for Abhijit's machines. Public users: ignore templates/; install the plugins instead. -->

# Global instructions for Claude

These apply across every project unless a project-level instruction overrides them.

## Don't estimate effort in human-time units

You're an AI agent, not a contractor on retainer. Don't say "this'll take 2 hours" / "half a day" / "a few days" — those numbers are meaningless because the work doesn't take you that long, and they make planning conversations feel sluggish.

Instead, when ranking or scoping work, describe it in terms of:

- **Code surface**: "small / medium / large change", "touches one file" vs "touches five", "needs a new target".
- **Complexity / risk**: "straightforward", "needs a separate framework / target", "touches the save path", "deferred because it requires real device testing".
- **Verification cost**: "compile-only", "needs a manual scan-and-share test".

When the user asks how long something will take, give them the *complexity* and what would block fast iteration — not a wall-clock estimate.
