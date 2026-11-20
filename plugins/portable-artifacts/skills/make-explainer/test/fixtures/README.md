# Test fixtures: where the binaries came from

Generated locally; no third-party media. ffmpeg 8.1.1 (libx264), run from this folder:

```
ffmpeg -y -f lavfi -i testsrc=size=160x90:rate=10:duration=1 -c:v libx264 -crf 35 -pix_fmt yuv420p -movflags +faststart demo.mp4
ffmpeg -y -i demo.mp4 -frames:v 1 -ss 0.5 poster.png
```

`motion.json` is a hand-written version 2 film (one statement shot). Its name stays from version 1, when it held a spec of one text scene.

`../../references/examples/clip.mp4` (the motion slide in `slides.explainer.json`) is a 480x270 clip rendered by make-motion 1.x (committed before the cut-over, 22 KB; a version 2 render of the same length is 1080p and 3.5 MB, so it was not replaced). `clip.motion.json` next to it is a valid version 2 film that tests keep valid; it is not what `clip.mp4` was rendered from.

`../../references/examples/clip-poster.png` is the poster for that slide: a frame from `clip.mp4` taken after the fade-in (the first frame is black), with ffmpeg, from the same folder:

```
ffmpeg -y -ss 1.2 -i clip.mp4 -frames:v 1 clip-poster.png
```

`pixel.png` is a one-pixel PNG, `chart/` is a dashboard and its CSV, both hand-written.

`legacy-kpi-wide-wrap.html` is one KPI section and the CSS it needs, trimmed by hand from a dusk page built by portable-artifacts 0.8.0 on 2026-10-26; its values wrap only in a window wider than 1280 px, which the check must catch.
