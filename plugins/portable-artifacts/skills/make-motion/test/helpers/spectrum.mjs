// Small acoustic measures for the cue tests (not a test file). A direct DFT over one Hann-windowed 4096-sample
// window: slow next to an FFT, but a test measures a handful of windows and needs no dependency.
const WINDOW = 4096;

// The middle WINDOW samples of `samples` (all of them when shorter), Hann-windowed.
function windowed(samples) {
  const n = Math.min(WINDOW, samples.length);
  const from = Math.floor((samples.length - n) / 2);
  return Float64Array.from({ length: n }, (_, i) => samples[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
}

// |X_k|^2 of bin k of `x`.
function binPower(x, k) {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * k) / x.length;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return re * re + im * im;
}

/** Spectral energy between `loHz` and `hiHz` (bins whose centre lies in [loHz, hiHz)). */
export function bandEnergy(samples, rate, loHz, hiHz) {
  const x = windowed(samples);
  const hz = rate / x.length;
  let sum = 0;
  for (let k = Math.ceil(loHz / hz); k * hz < hiHz && k <= x.length / 2; k++) sum += binPower(x, k);
  return sum;
}

/** The power-weighted mean frequency in Hz, from DC to Nyquist. */
export function spectralCentroid(samples, rate) {
  const x = windowed(samples);
  const hz = rate / x.length;
  let weighted = 0;
  let total = 0;
  for (let k = 1; k <= x.length / 2; k++) {
    const p = binPower(x, k);
    weighted += p * k * hz;
    total += p;
  }
  return total === 0 ? 0 : weighted / total;
}

/** Sign changes per second. */
export function zeroCrossingRate(samples, rate) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
  return (crossings * rate) / samples.length;
}

/**
 * The pitch in Hz of the cycle that contains `seconds`: the signal is low-passed (four one-pole stages at `maxHz`, so
 * noise and partials above a low tone barely move the zero crossings), then the cycle is the span between two
 * upward zero crossings, interpolated to a fraction of a sample. NaN when no whole cycle contains `seconds`.
 */
export function pitchAt(samples, rate, seconds, { maxHz = 1000 } = {}) {
  const a = 1 - Math.exp((-2 * Math.PI * maxHz) / rate);
  const stages = [0, 0, 0, 0];
  const low = Array.from(samples, (x) => stages.reduce((input, _, s) => (stages[s] += a * (input - stages[s])), x));
  const ups = [];
  for (let i = 1; i < low.length; i++) {
    if (low[i - 1] < 0 && low[i] >= 0) ups.push((i - 1 + low[i - 1] / (low[i - 1] - low[i])) / rate);
  }
  const k = ups.findIndex((t, j) => t <= seconds && ups[j + 1] > seconds);
  return k < 0 ? Number.NaN : 1 / (ups[k + 1] - ups[k]);
}

/** Root mean square. */
export function rms(samples) {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.sqrt(sum / samples.length);
}
