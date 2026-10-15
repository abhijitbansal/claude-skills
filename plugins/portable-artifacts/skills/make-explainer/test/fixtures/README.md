# Test fixtures: where the binaries came from

Generated locally; no third-party media. ffmpeg 8.1.1 (libx264), run from this folder:

```
ffmpeg -y -f lavfi -i testsrc=size=160x90:rate=10:duration=1 -c:v libx264 -crf 35 -pix_fmt yuv420p -movflags +faststart demo.mp4
ffmpeg -y -i demo.mp4 -frames:v 1 -ss 0.5 poster.png
```

`motion.json` is hand-written (one text scene, 160x90).

`../../references/examples/clip.mp4` (the motion slide in `slides.explainer.json`) is rendered by make-motion from `clip.motion.json` next to it, from `plugins/portable-artifacts/skills/make-explainer/references/examples`:

```
node ../../../make-motion/scripts/render.mjs clip.motion.json --out clip.mp4
```

`../../references/examples/clip-poster.png` is the poster for that slide: a frame from `clip.mp4` taken after the fade-in (the first frame is black), with ffmpeg, from the same folder:

```
ffmpeg -y -ss 1.2 -i clip.mp4 -frames:v 1 clip-poster.png
```

`pixel.png` is a one-pixel PNG, `chart/` is a dashboard and its CSV, both hand-written.
