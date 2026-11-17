// The voices `voice.mjs --list-voices` prints, as a plain table, so listing them loads no model and downloads nothing (the model
// is about 90 MB and used to be fetched first). Copied from the VOICES table of kokoro-js 1.2.1 (pinned in optional/voice/package.json),
// the one version the install step pins: [language, gender, overall grade]. The synth step still checks a --voice name
// against the loaded model's own list, so a voice a later kokoro-js adds is not refused here.
export const VOICES = Object.freeze({
  af_heart: ['en-us', 'Female', 'A'],
  af_alloy: ['en-us', 'Female', 'C'],
  af_aoede: ['en-us', 'Female', 'C+'],
  af_bella: ['en-us', 'Female', 'A-'],
  af_jessica: ['en-us', 'Female', 'D'],
  af_kore: ['en-us', 'Female', 'C+'],
  af_nicole: ['en-us', 'Female', 'B-'],
  af_nova: ['en-us', 'Female', 'C'],
  af_river: ['en-us', 'Female', 'D'],
  af_sarah: ['en-us', 'Female', 'C+'],
  af_sky: ['en-us', 'Female', 'C-'],
  am_adam: ['en-us', 'Male', 'F+'],
  am_echo: ['en-us', 'Male', 'D'],
  am_eric: ['en-us', 'Male', 'D'],
  am_fenrir: ['en-us', 'Male', 'C+'],
  am_liam: ['en-us', 'Male', 'D'],
  am_michael: ['en-us', 'Male', 'C+'],
  am_onyx: ['en-us', 'Male', 'D'],
  am_puck: ['en-us', 'Male', 'C+'],
  am_santa: ['en-us', 'Male', 'D-'],
  bf_emma: ['en-gb', 'Female', 'B-'],
  bf_isabella: ['en-gb', 'Female', 'C'],
  bm_george: ['en-gb', 'Male', 'C'],
  bm_lewis: ['en-gb', 'Male', 'D+'],
  bf_alice: ['en-gb', 'Female', 'D'],
  bf_lily: ['en-gb', 'Female', 'D'],
  bm_daniel: ['en-gb', 'Male', 'D'],
  bm_fable: ['en-gb', 'Male', 'C'],
});

/** One `name<TAB>language<TAB>gender<TAB>grade` line per voice: the columns `--list-voices` always printed. */
export const voiceListText = () => Object.entries(VOICES).map(([name, [language, gender, grade]]) => `${name}\t${language}\t${gender}\t${grade}\n`).join('');
