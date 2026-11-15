// The `viral` mode: short-form vertical video. Behaviour only; the look decides appearance.
// wpm: speaking pace; tail: seconds of room after the last word; maxStillSeconds: longest a frame may sit still.
export const viral = {
  name: 'viral',
  defaultLook: 'pop',
  defaultFormat: '9:16',
  wpm: 175,
  tail: 0.3,
  maxStillSeconds: 3,
  captions: true,
};
