// The preview page's controls (engine/page/viewer.html), over the render page's stage (stage.mjs: window.__ready,
// __seek, __snapshot), which draws every frame exactly as a render does. A scrubber over frames, play and pause, shot
// markers, Space and the arrow keys (one frame), M to mute, click-to-copy (hit.mjs), the provenance footer, and the
// validator's lines in place of the film when an edit does not validate. It polls /preview/state and reloads on a new
// version. Playback follows the audio clock when the film has sound, else a frame timer; both are approximate.
// Every URL here is same-origin.
import { hitTest, copyLine } from './hit.mjs';

const POLL_MS = 1000;
const TOAST_MS = 2000;
const MS_PER_SECOND = 1000;
const $ = (id) => document.getElementById(id);

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function showErrors(lines) {
  document.body.classList.add('invalid');
  $('errors').textContent = lines.join('\n');
}

// Reload when the server says a new version is up (a new film, or an edit that failed: its lines are then shown).
function poll(version) {
  setInterval(async () => {
    try {
      const state = await getJson('/preview/state');
      if (state.version !== version) location.reload();
    } catch {
      // the preview was stopped; nothing to reload from
    }
  }, POLL_MS);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('on'), TOAST_MS);
}

function markers(film, timeline) {
  const box = $('markers');
  timeline.shots.forEach((shot, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = film.shots[i].id;
    b.style.left = `${(shot.start / timeline.duration) * 100}%`;
    b.dataset.frame = String(Math.round(shot.start * timeline.fps));
    box.append(b);
  });
}

// The player: one frame on screen at a time, drawn through the stage; play follows the audio or a timer.
// No clock is read (the engine's purity rule): a silent film steps one frame per interval tick, a film with sound
// follows the audio element's own position.
function player({ frameCount, fps, audio }) {
  const p = { frame: 0, playing: false, busy: false, want: 0, timer: null };
  const label = () => { $('time').textContent = `${p.frame} / ${frameCount - 1}  ${(p.frame / fps).toFixed(2)} s`; };
  const draw = async (i) => {
    p.want = Math.max(0, Math.min(frameCount - 1, i));
    if (p.busy) return;
    p.busy = true;
    try {
      while (p.frame !== p.want || !p.drawn) {
        p.frame = p.want;
        await window.__seek(p.frame);
        p.drawn = true;
      }
    } finally {
      p.busy = false;
    }
    $('scrub').value = String(p.frame);
    label();
  };
  const tick = () => {
    if (!p.playing) return;
    const i = audio ? Math.floor(audio.currentTime * fps) : p.want + 1;
    if (i >= frameCount - 1) pause();
    draw(i);
  };
  const play = () => {
    if (p.frame >= frameCount - 1) draw(0);
    p.playing = true;
    if (audio) {
      audio.currentTime = p.frame / fps; // the sound starts where the scrubber is
      audio.play().catch(() => {});
    }
    $('play').textContent = 'Pause';
    p.timer = setInterval(tick, MS_PER_SECOND / fps);
  };
  function pause() {
    p.playing = false;
    clearInterval(p.timer);
    audio?.pause();
    $('play').textContent = 'Play';
  }
  const seek = (i) => { pause(); return draw(i); };
  return { p, draw, seek, toggle: () => (p.playing ? pause() : play()) };
}

// The index of the shot on screen at frame i: the last one that has started.
const shotAt = (timeline, i) => timeline.shots.reduce((at, shot, k) => (shot.start <= i / timeline.fps ? k : at), 0);

function wire({ film, timeline, frameCount, controls, audio }) {
  $('scrub').max = String(frameCount - 1);
  $('scrub').addEventListener('input', (e) => controls.seek(Number(e.target.value)));
  $('play').addEventListener('click', () => controls.toggle());
  $('markers').addEventListener('click', (e) => { if (e.target.dataset.frame) controls.seek(Number(e.target.dataset.frame)); });
  const mute = () => { if (audio) audio.muted = !audio.muted; $('mute').textContent = audio?.muted ? 'Unmute' : 'Mute'; };
  $('mute').addEventListener('click', mute);
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); controls.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); controls.seek(controls.p.frame + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); controls.seek(controls.p.frame - 1); }
    else if (e.key === 'm' || e.key === 'M') mute();
  });
  const canvas = $('stage');
  canvas.addEventListener('click', async (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width, y = ((e.clientY - rect.top) * canvas.height) / rect.height;
    const hit = hitTest(window.__snapshot(controls.p.frame), x, y, film.shots.map((s) => s.id), { current: shotAt(timeline, controls.p.frame) });
    if (hit === null) return;
    const line = copyLine(hit);
    try {
      await navigator.clipboard.writeText(line);
      toast(line);
    } catch {
      toast(`${line}  (copy it by hand: the browser refused the clipboard)`);
    }
  });
}

async function main() {
  const state = await getJson('/preview/state');
  $('provenance').textContent = state.provenance ?? '';
  poll(state.version);
  if (state.errors.length > 0) return showErrors(state.errors);
  const info = await window.__ready;
  const { film, timeline } = await getJson('/film.json');
  const notes = [state.notice, info.post === '2d' ? 'this browser has no WebGL2: shader cuts show their stand-ins, as a render without it would' : null].filter(Boolean);
  $('notice').textContent = notes.join(' · ');
  const audio = state.audio ? new Audio('/preview/audio') : null;
  const controls = player({ frameCount: info.frameCount, fps: info.fps, audio });
  markers(film, timeline);
  wire({ film, timeline, frameCount: info.frameCount, controls, audio });
  window.__viewer = controls; // for tests: the frame on screen
  await controls.draw(0);
  document.body.dataset.ready = 'true';
}

main().catch((err) => showErrors([`the preview could not start: ${err.message}`]));
