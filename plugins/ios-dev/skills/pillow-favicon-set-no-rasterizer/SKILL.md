---
name: pillow-favicon-set-no-rasterizer
description: >-
  "rsvg-convert: command not found", "convert: command not found"
  (ImageMagick), "No module named 'cairosvg'", or no Inkscape on PATH when
  trying to turn an SVG mark into favicon.ico / apple-touch-icon.png /
  og-card.png. Use when a site needs a raster favicon set
  (site-og-favicon-verify's checklist) and installing a full SVG rasterizer
  is unavailable, heavy, or blocked, and the mark is a simple geometric
  shape + letter/glyph (most lettermark logos qualify).
---

# Generate a raster favicon set without an SVG rasterizer

## Symptom
You have an SVG logo/mark and need the raster fallback set — `favicon.ico`,
`apple-touch-icon.png`, maybe `og-card.png` — but every standard SVG→PNG path
is unavailable on the machine:

```
$ rsvg-convert -w 512 -h 512 logo.svg -o logo.png
zsh: command not found: rsvg-convert

$ convert logo.svg -resize 512x512 logo.png
zsh: command not found: convert

$ python -c "import cairosvg"
ModuleNotFoundError: No module named 'cairosvg'
```

Inkscape isn't installed either, and pulling in a full SVG renderer (system
package or a heavy Python wheel) just to emit a handful of static PNGs once
feels disproportionate — especially in CI or a sandboxed dev container where
you can't `brew install` anything.

## Root cause
SVG rasterization needs a real rendering engine (librsvg, ImageMagick's
delegate, a cairo build, Inkscape) — none of which ship by default on macOS
or a minimal Linux image, and installing one is a system-level dependency
just to produce icons that, once generated, never need to change again.

But most favicon marks aren't complex vector art — they're a filled shape
(rounded rect, circle) plus one or two characters of text. That's exactly
what Pillow's `ImageDraw` primitives + `ImageFont` can render directly,
with zero SVG parsing involved.

## Fix
Don't rasterize the SVG — **redraw the mark directly in Pillow** at a large
master size, then downscale/save every target format from that one master.
This only works when the mark is geometric-shape + text; a hand-drawn or
gradient-rich SVG still needs a real rasterizer.

```python
from PIL import Image, ImageDraw, ImageFont

# 1. Draw at a large master size (512) so downscaling stays crisp.
img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, 511, 511], radius=112, fill=(180, 84, 46))

font = ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Georgia.ttf", 358
)
bb = d.textbbox((0, 0), "S", font=font)
w, h = bb[2] - bb[0], bb[3] - bb[1]
d.text(((512 - w) / 2 - bb[0], (512 - h) / 2 - bb[1]), "S",
        font=font, fill=(253, 253, 251))

# 2. favicon.ico: Pillow downscales one master into the multi-res ICO.
img.resize((32, 32)).save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# 3. apple-touch-icon.png: 180x180, FULL-BLEED + OPAQUE.
#    iOS applies its own rounded-corner mask — a transparent or
#    already-rounded source shows as a square-with-a-hole on the home screen.
touch = Image.new("RGB", (512, 512), (180, 84, 46))
touch.paste(img, (0, 0), img)  # composite over opaque background, drop alpha
touch.resize((180, 180)).save("apple-touch-icon.png")
```

Then wire the full set into the page head (root vs nested pages need the
relative prefix adjusted):

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#b4542e">
```

Keep the generator as a **dev-only script** (`uv add --dev pillow` or
equivalent), not a runtime dependency, and **commit the generated raster
files** — they're build artifacts of a one-off, not something regenerated on
every deploy. Re-running the script is how you handle a rebrand.

## Evidence
Used on a static marketing site (doc-scan/Paperix-style site skeleton) whose
favicon was a single letter on a rounded-square tile — SVG existed, but the
dev container had no `rsvg-convert`/ImageMagick/cairosvg/Inkscape and
installing one wasn't worth it for a handful of PNGs. Same pattern applies
to any lettermark or simple-geometric favicon across the portfolio's site
skeletons.

## Related skills
- `site-og-favicon-verify` — the checklist/lint for what a *correct* favicon
  + og:image + CSP setup looks like (sizes, absolute URLs, opaque
  apple-touch-icon). This skill is the how-to for actually producing the
  raster files that checklist expects, specifically when no SVG rasterizer
  is on hand.
- `site-pages-deploy-kit` — the site skeleton and `verify-site.sh` that
  checks the favicon set this skill generates; also references an idempotent
  "generate everything from one master image" script pattern this skill
  implements without a rasterizer dependency.
- `alternate-app-icons` — iOS *app* icon (Home Screen, asset catalog,
  `CFBundleAlternateIcons`) generation and switching; unrelated to web
  favicons despite the naming overlap — don't conflate the two icon systems.
