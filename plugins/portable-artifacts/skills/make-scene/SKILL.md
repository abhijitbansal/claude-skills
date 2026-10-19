---
name: make-scene
description: Use when the user wants their data shown as an explorable 3D world (a city of towers, a forest, a galaxy or a terrain) or an existing diagram or dashboard chart lifted into 3D, as one offline HTML page with a camera tour; the agent writes a small JSON spec and scripts build the three.js page
argument-hint: what to show, e.g. "our commits per week per module as a city, with a tour of the busiest weeks"
model: haiku
effort: low
---

# make-scene

`<skill-dir>` is the folder containing this SKILL.md.

The full workflow is being built. Until it lands, this skill only ships its dependency check: `node <skill-dir>/scripts/doctor.mjs --json`.
