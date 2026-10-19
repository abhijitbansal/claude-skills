// The tour's transport bar: caption, Prev / Play / Next, "Beat 2 of 5". Drives a createTour() state machine.
import { h } from './dom.js';

/** createTransport({ parent, beats, tour }) -> { el, render(state), show(), hide(), isShown(), destroy() } */
export function createTransport({ parent, beats, tour }) {
  const title = h('strong', { class: 'sc-cap-title' });
  const caption = h('span', { class: 'sc-cap-text' });
  const count = h('span', { class: 'sc-cap-count' });
  const prev = h('button', { type: 'button', class: 'sc-btn', title: 'Previous beat (Left)', text: 'Prev' });
  const play = h('button', { type: 'button', class: 'sc-btn', 'aria-keyshortcuts': 'Space', title: 'Play or pause (Space)', text: 'Play' });
  const next = h('button', { type: 'button', class: 'sc-btn', title: 'Next beat (Right)', text: 'Next' });
  const close = h('button', { type: 'button', class: 'sc-btn', title: 'Leave the tour', text: 'Close' });
  const line = h('p', { class: 'sc-cap-line', 'aria-live': 'polite' }, [title, caption]);
  const el = h('div', { class: 'sc-tour', role: 'group', 'aria-label': 'Tour', hidden: true }, [
    line,
    h('div', { class: 'sc-transport' }, [prev, play, next, count, close]),
  ]);
  parent.append(el);

  prev.addEventListener('click', () => tour.prev());
  next.addEventListener('click', () => tour.next());
  play.addEventListener('click', () => tour.toggle());

  return {
    el,
    closeButton: close,
    render(state) {
      const beat = beats[state.index];
      title.textContent = beat?.title ?? '';
      caption.textContent = beat?.caption ? ` ${beat.caption}` : '';
      count.textContent = state.index < 0 ? '' : `${state.index + 1} / ${state.count}`;
      play.textContent = state.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-pressed', String(state.playing));
      prev.disabled = state.index <= 0;
      next.disabled = state.index >= state.count - 1;
    },
    show: () => {
      el.hidden = false;
    },
    hide: () => {
      el.hidden = true;
    },
    isShown: () => !el.hidden,
    destroy() {
      el.remove();
    },
  };
}
