// A leaf: no imports. Where the sentence-timing sidecar of a voiceover sits, kept out of voice.mjs (which pulls in the spec
// module, and through it the voice step that reads sidecars) so that reading one never loads, or cycles through, the model code.

// The sentence-timing sidecar sits beside the wav: voice/intro.wav -> voice/intro.json. A name that is not a .wav comes back as it is.
export function sidecarPath(out) {
  return out.replace(/\.wav$/i, '.json');
}
