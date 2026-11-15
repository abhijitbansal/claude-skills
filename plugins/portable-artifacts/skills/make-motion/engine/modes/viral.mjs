// The `viral` mode: short-form vertical video. Behaviour only; the look decides appearance.
// wpm: speaking pace; tail: seconds of room after the last word; maxStillSeconds: longest a frame may sit still.
const WPM = 175;
const MAX_STILL_SECONDS = 3;

export const viral = {
  name: 'viral',
  summary: `Short-form vertical video: 9:16, a fast pace of ${WPM} words a minute, the first shot reads from frame 0, a picture may sit still for ${MAX_STILL_SECONDS} s.`,
  defaultLook: 'pop',
  defaultFormat: '9:16',
  wpm: WPM,
  tail: 0.3,
  maxStillSeconds: MAX_STILL_SECONDS,
  hookFromFrameZero: true, // the first shot reads from frame 0: all its words on screen, each taking its colour when spoken
  maxHookWords: 7, // the review: an opening statement of more words is a creative finding (absent: no limit)
  platformSafeZone: true, // a look serving this mode composes inside the platform safe zone on 9:16 (kinds/shared.mjs)
  captions: true, // reserved: no caption track is drawn yet
  voiceSpeed: 1.1, // Kokoro speed of the narration (0.8 to 1.25, checked by validateMode)
  emphasisPause: 0, // seconds of silence before an emphasised word; 0: emphasis neither splits a call nor pauses
  loudness: Object.freeze({ lufs: -14, truePeakDb: -1, lra: 9 }), // the voice master's targets (scripts/v2/voice/master.mjs)
};
