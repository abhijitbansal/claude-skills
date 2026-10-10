// Preview chrome: scrubber, play/pause, mute, scene markers, shortcuts, live reload.
import { audioController } from './preview-audio.mjs';

const PLAY_ICON = '▶';
const PAUSE_ICON = '❚❚';
const MUTE_ICON = '♪';

const fmt = (sec) => `${sec.toFixed(2)}s`;
const motion = () => window.__motion;

export function initPreviewUI() {
  const ui = document.getElementById('ui');
  ui.innerHTML = `
    <button id="play" aria-label="Play">${PLAY_ICON}</button>
    <button id="mute" aria-label="Mute audio (M)" aria-pressed="false" title="Mute (M)" hidden>${MUTE_ICON}</button>
    <div id="track"><div id="marks"></div><input id="scrub" type="range" min="0" value="0" step="any" aria-label="Timeline"></div>
    <div id="readout"></div>`;
  const play = ui.querySelector('#play');
  const muteButton = ui.querySelector('#mute');
  const scrub = ui.querySelector('#scrub');
  const marks = ui.querySelector('#marks');
  const readout = ui.querySelector('#readout');

  let time = 0;
  let playing = false;
  let last = 0;
  const audio = audioController(() => motion().audio ?? []);

  const show = () => {
    scrub.value = String(time);
    readout.textContent = `${fmt(time)} / ${fmt(motion().duration)}  ${Math.round(time * motion().fps)}f`;
  };
  const seek = (sec) => {
    time = Math.min(Math.max(0, sec), motion().duration);
    motion().seek(time);
    audio.update(time, playing);
    show();
  };
  const setMuted = (on) => {
    audio.setMuted(on);
    muteButton.setAttribute('aria-pressed', String(on));
  };
  const setPlaying = (on) => {
    playing = on;
    play.textContent = on ? PAUSE_ICON : PLAY_ICON;
    play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) {
      if (time >= motion().duration) seek(0);
      last = performance.now();
      requestAnimationFrame(tick);
    }
    audio.update(time, on);
  };
  function tick(now) {
    if (!playing) return;
    seek(time + (now - last) / 1000);
    last = now;
    if (time >= motion().duration) { setPlaying(false); return; }
    requestAnimationFrame(tick);
  }
  const layout = () => {
    const m = motion();
    scrub.max = String(m.duration);
    muteButton.hidden = m.audio.length === 0;
    marks.innerHTML = '';
    m.sceneStarts.forEach((start, i) => {
      const tick = document.createElement('i');
      tick.style.left = `${(start / m.duration) * 100}%`;
      tick.textContent = m.sceneIds[i];
      marks.append(tick);
    });
    seek(time);
  };

  // rAF stops in a hidden tab but <audio> keeps going: pause there, resume when visible.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.update(time, false);
    else if (playing) { last = performance.now(); audio.update(time, true); }
  });
  play.addEventListener('click', () => setPlaying(!playing));
  muteButton.addEventListener('click', () => setMuted(!audio.muted));
  scrub.addEventListener('input', () => { setPlaying(false); seek(Number(scrub.value)); });
  window.addEventListener('keydown', (e) => {
    const frame = 1 / motion().fps;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    else if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey) setMuted(!audio.muted);
    else if (e.code === 'ArrowRight') { e.preventDefault(); setPlaying(false); seek(time + frame); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); setPlaying(false); seek(time - frame); }
  });

  const events = new EventSource('/events');
  events.onmessage = async (e) => {
    if (e.data !== 'reload') return;
    await window.__reload();
    layout();
  };
  // The server validates every change and sends the formatted errors when the spec is unusable.
  events.addEventListener('spec-error', (e) => {
    const lines = JSON.parse(e.data).map((err) => `${err.path}: ${err.message}`);
    window.__showError(`spec has ${lines.length} error${lines.length === 1 ? '' : 's'}:\n${lines.join('\n')}`);
  });

  layout();
}
