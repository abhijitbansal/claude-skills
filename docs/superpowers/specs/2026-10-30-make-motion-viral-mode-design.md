# make-motion: better sound effects, an intake round and a viral mode

Date: 2026-10-30. Branch: `worktree-skills-improvement`. This is the fifth item on
the shared branch. It is folded into the make-motion parity plan
(`2026-10-30-make-motion-hyperframes-parity-design.md`) rather than planned on its
own.

## Intent

The owner watched the teaser this branch produced and found the sound effects
weak. Today `scripts/lib/cues.mjs` synthesises five cues (pop, click, whoosh,
chime, impact), each from a single short oscillator or noise burst. The owner also
wants short-form social videos (Reels, TikTok, Shorts) to work well. And people
should learn up front what they can bring, such as their own clips, photos, music,
voice and logo, instead of finding out after the build.

## Goals

1. **Better synthesised cues.** Each cue is rebuilt as layers:
   - a transient (a 5–20 ms attack, an FM or noise click);
   - a body (a filtered sweep or a pitched tone with a pitch envelope);
   - a tail (a short reverb under 0.5 s, low wet).

   Whooshes start from pink-ish noise, not white, and get a band-pass sweep of
   about 200 Hz to 10 kHz, a swell-then-fade envelope and stereo width above about
   120 Hz (mono below). Impacts drop pitch 1–2 octaves over 50–150 ms.

   New cue types: `riser`, `swoosh` (a short whoosh for transitions), `typing`
   (key clicks that follow a typing text), `drop` (a sub hit) and `ding`
   (notification).

   Determinism stays: the same spec gives the same samples (seeded noise), and a
   cue's `volume` stays a literal gain on a known peak.
2. **A bundled CC0 sample pack.** A small set of recorded UI, interface and impact
   sounds from Kenney (CC0), chosen in the spec as `"cue": "kenney:<name>"` or in a
   `sfx` field. CC0 only, with a `LICENSES/` note listing the source URL of each
   file. Size is kept small (a curated subset, measured at add time). Synthesis
   stays the default for whooshes and risers, because the CC0 packs are clicks and
   hits.
3. **One intake round.** Before writing the spec, the skill asks one round of
   questions, with sensible defaults already picked, covering every option that is
   feasible today:
   - platform and format (16:9, 9:16, 1:1, 4:5);
   - length;
   - the user's own assets: clips, photos, a logo, brand colours, music, a voice
     file;
   - voiceover (Kokoro, with its install size), captions and caption style;
   - sound (cues, sample pack or none);
   - theme and CTA.

   When it cannot ask (a non-interactive run, or the eval), it uses the defaults
   and lists the options it skipped in its report.
4. **Viral mode** (`"mode": "viral"` in the spec, or picked when the prompt says
   Reels, TikTok, Shorts or viral). It sets defaults and adds checks:
   - 9:16 at 1080x1920;
   - a platform safe-zone union of top 290, bottom 675, left 120 and right 195 px
     at 1080x1920, as default margins, with per-platform overrides;
   - burned-in captions on;
   - a text hook of 3–7 words on screen at frame 0;
   - a visual change at least every 3 s;
   - cues auto-placed on cuts, reveals and counters;
   - loudness normalised to -14 LUFS integrated and -1 dBTP true peak;
   - a soft CTA block (save, send, follow for part 2);
   - an optional loop ending.

   Each rule is a default or a `check.mjs` warning, never a hard failure.
5. **A viral structure set.** Blocks or templates for the common shapes: hook,
   problem, reveal, proof, CTA; listicle ("3 things"); before/after; and a
   loopable ending.

## Evidence and its quality

The research is in this session's research report and is summarised here:
- The hook-window and "first 3 seconds" guidance traces to TikTok's Creative
  Codes, which was seen through secondary summaries. Most other numbers are
  practitioner folklore.
- The safe-zone pixels come from Socialync's conversion of the platforms' ad-spec
  margins. Organic UI may differ.
- -14 LUFS is the defensible default. No platform publishes one for Reels or
  TikTok.

Viral mode therefore treats these as tunable defaults and warnings, not rules,
and the docs say so.

## Non-goals

- Trending or licensed music. The tool is offline, so audio is the user's own
  file, the voiceover or cues.
- Posting to platforms, analytics or A/B testing.
- Any network fetch at render. Sample-pack files are bundled.

## Decided (owner, 2026-10-30)

- Sound effects get both better synthesis and a bundled CC0 pack.
- Viral mode is a mode inside make-motion, not a separate skill.
- Intake is one question round with defaults, then the build. A non-interactive
  run uses the defaults and lists what it skipped.
- Order: the cue upgrade and intake land first (Phase 0b, before Gate 1, because
  they need no roadmap features). Viral mode lands after Gate 1, which brings
  captions and 9:16 formats, and before Gate 2 completes. Loudness normalisation
  comes from Phase 3.

## Left to the builder

- The exact synthesis parameters per cue, chosen by listening and checked with a
  rendered A/B sample.
- The Kenney subset and its file format (wav or ogg).
- How auto-placed cues avoid clutter (a minimum gap, and at most one per cut).
- Wording of the intake question round in SKILL.md.
