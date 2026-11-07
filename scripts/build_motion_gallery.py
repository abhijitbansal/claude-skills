#!/usr/bin/env python3
"""Build complete, reproducible source downloads for the motion launch gallery."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / "docs/features/showcase/portable-artifacts/gallery/motion-1-4"
SKILL = ROOT / "plugins/portable-artifacts/skills/make-motion"
# Archive path -> canonical example input. Keep specs byte-for-byte as published.
ASSETS = {
    "beats": {"data/on-the-beat.wav": "data/on-the-beat.wav",
              "data/on-the-beat.beats.json": "data/on-the-beat.beats.json"},
    "blocks-tour": {"avatar.svg": "blocks/avatar.svg"},
    "gl-transitions": {},
    "grade": {"photo.png": "photo.png"},
    "lottie": {"data/badge.lottie.json": "data/badge.lottie.json"},
    "loudness": {"data/on-the-beat.wav": "data/on-the-beat.wav"},
    "maps": {},
    "pick-and-storyboard": {},
    "race": {},
    "text-behind-subject": {"portrait.jpg": "blocks/portrait.jpg",
                            "portrait-cutout.png": "blocks/portrait-cutout.png"},
}
# references/schema.md documents these as CC0; other inputs have no notice of their own.
CC0_INPUTS = {"data/badge.lottie.json", "photo.png"}


def references(value):
    """Local file inputs used by these ten specs; production validation runs in CI."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"src", "beats", "cutout", "avatar"} and isinstance(child, str):
                yield child
            yield from references(child)
    elif isinstance(value, list):
        for child in value:
            yield from references(child)


def contents_note(slug):
    if not ASSETS[slug]:
        return "This pack contains the published motion.json. The spec uses no local input files."
    return ("This pack contains the published motion.json and every local input it uses: "
            f"{', '.join(sorted(ASSETS[slug]))}.\nKeep the folder structure when extracting.")


def license_note(slug):
    cc0 = sorted(CC0_INPUTS & ASSETS[slug].keys())
    if not cc0:
        return "This pack uses the repository's MIT license (LICENSE)."
    return f"{', '.join(cc0)} is CC0. The rest of this pack uses the repository's MIT license (LICENSE)."


def readme(slug):
    render_flags = " --loudness -16" if slug == "loudness" else ""
    keep_inputs = ("\n    Keep the included input files and resolve their paths relative to motion.json."
                   if ASSETS[slug] else "")
    cutout_note = "\nThe portrait is already cut out." if slug == "text-behind-subject" else ""
    gl_note = ("\nGL transitions use the documented fallback in preview and WebGL in the rendered MP4."
               if slug == "gl-transitions" else "")
    return f"""# make-motion: {slug}

{contents_note(slug)}
Edit motion.json to make it your own.
{license_note(slug)}

Install make-motion in your agent from https://github.com/abhijitbansal/claude-skills:

    npx skills add abhijitbansal/claude-skills --skill make-motion

Open this extracted folder in your agent and ask:

    Use make-motion to validate motion.json, preview it, then render video.mp4{render_flags}.{keep_inputs}

Or run the commands below from this folder. Replace <skill-dir> with the installed
make-motion directory (the folder containing SKILL.md and scripts/).
Use the current release; these examples require portable-artifacts 1.1.0 or newer.

    node "<skill-dir>/scripts/doctor.mjs" --for motion.json
    node "<skill-dir>/scripts/validate.mjs" motion.json
    node "<skill-dir>/scripts/preview.mjs" motion.json --open
    node "<skill-dir>/scripts/render.mjs" motion.json --out video.mp4{render_flags}

The doctor reports missing Node packages, Chromium and ffmpeg with install commands.
After that one-time setup, this example needs no network, voice model or cutout model.{cutout_note}
The preview command runs until stopped; run the render command in a second terminal.{gl_note}
The specs render at their own resolution; the gallery videos may use a smaller export.

Gallery: https://abhijitbansal.github.io/claude-skills/features/portable-artifacts.html#gallery-motion-1-4
"""


def pack_example(slug, out, *, examples=SKILL / "references/examples"):
    spec = (GALLERY / slug / "motion.json").read_bytes()
    files = {"motion.json": spec, "README.md": readme(slug).encode(),
             "LICENSE": (ROOT / "LICENSE").read_bytes()}
    for target, source in ASSETS[slug].items():
        files[target] = (examples / source).read_bytes()
    for ref in references(json.loads(spec)):
        if ref not in files:
            raise ValueError(f"{slug}: source download is missing input {ref}")
    target = out / slug / "source.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return target


def validate_pack(archive):
    # Exercise exactly what the visitor downloads, outside the repository.
    with tempfile.TemporaryDirectory(prefix="motion-gallery-") as temp:
        with zipfile.ZipFile(archive) as source:
            source.extractall(temp)
        subprocess.run(["node", str(SKILL / "scripts/validate.mjs"),
                        str(Path(temp) / "motion.json")], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="staged motion-1-4 gallery directory")
    parser.add_argument("--validate", action="store_true", help="validate extracted packs (requires make-motion npm ci)")
    args = parser.parse_args()
    for slug in ASSETS:
        archive = pack_example(slug, args.out)
        if args.validate:
            validate_pack(archive)
        print(f"{slug}: {archive.stat().st_size} bytes")
    print(f"Built {len(ASSETS)} complete motion source packs")


if __name__ == "__main__":
    main()
