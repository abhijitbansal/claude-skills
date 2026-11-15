// The `viral` mode: short-form vertical video. Behaviour only; the look decides appearance.
// wpm: speaking pace; tail: seconds of room after the last word; maxStillSeconds: longest a frame may sit still.
export const viral = {
  name: 'viral',
  summary: 'Short-form vertical video: 9:16, a fast pace of 175 words a minute, captions on, a picture may sit still for 3 s.',
  defaultLook: 'pop',
  defaultFormat: '9:16',
  wpm: 175,
  tail: 0.3,
  maxStillSeconds: 3,
  hookFromFrameZero: true, // the first shot reads from frame 0: all its words on screen, each taking its colour when spoken
  captions: true,
};
