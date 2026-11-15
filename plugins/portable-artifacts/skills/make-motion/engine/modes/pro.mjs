// The `pro` mode: professional explainers. Behaviour only; the look decides appearance.
// wpm: speaking pace; tail: seconds of room after the last word; maxStillSeconds: longest a frame may sit still.
export const pro = {
  name: 'pro',
  summary: 'Professional explainers: 16:9, a calm pace of 150 words a minute, a picture may sit still for 6 s.',
  defaultLook: 'desk',
  defaultFormat: '16:9',
  wpm: 150,
  tail: 0.6,
  maxStillSeconds: 6,
  captions: false,
};
