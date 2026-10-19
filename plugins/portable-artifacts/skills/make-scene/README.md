# make-scene

**Prompt → JSON spec → one offline 3D page.** Your rows become a city of
towers, a forest, a galaxy or a terrain, or an existing make-diagram diagram or
make-dashboard chart is lifted into 3D, drawn with a pinned, bundled
[three.js](https://threejs.org/) and guided by a camera tour. The agent writes
only JSON; scripts build the page. Works with any agent that can run shell
commands, and nothing leaves your machine. The workflow is under construction:
this folder currently holds the scaffold and the dependency doctor
(`scripts/doctor.mjs`).
