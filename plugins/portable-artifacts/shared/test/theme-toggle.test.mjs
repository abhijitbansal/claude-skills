// plugins/portable-artifacts/shared/test/theme-toggle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MODES, THEME_KEY, nextMode, toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../theme-toggle.mjs';

test('nextMode cycles auto → light → dark → auto; junk counts as auto', () => {
  assert.deepEqual(MODES, ['auto', 'light', 'dark']);
  assert.equal(nextMode('auto'), 'light');
  assert.equal(nextMode('light'), 'dark');
  assert.equal(nextMode('dark'), 'auto');
  assert.equal(nextMode('weird'), 'light');
  assert.equal(THEME_KEY, 'pa-theme');
});

test('icons and css cover all three modes', () => {
  for (const m of MODES) {
    assert.match(toggleIcons(), new RegExp(`class="pa-ti pa-ti-${m}"`));
    assert.match(TOGGLE_CSS, new RegExp(`\\[data-mode="${m}"\\] \\.pa-ti-${m}`));
  }
});

// Minimal DOM: enough for TOGGLE_JS (attributes, querySelectorAll, one delegated click listener).
function fakeDom(storage, { readyState = 'complete', htmlTheme, runs = 1 } = {}) {
  const attrs = (init = {}) => {
    const a = { ...init };
    return {
      getAttribute: (k) => (k in a ? a[k] : null),
      setAttribute: (k, v) => { a[k] = String(v); },
      removeAttribute: (k) => { delete a[k]; },
      attrs: a,
    };
  };
  const root = attrs(htmlTheme ? { 'data-theme': htmlTheme } : {});
  const icon = { closest: (sel) => (sel === '[data-theme-toggle]' ? button : null) };
  const button = { ...attrs({ 'data-mode': 'auto' }), closest: (sel) => (sel === '[data-theme-toggle]' ? button : null) };
  const events = [];
  let clickHandler;
  let ready;
  const document = {
    documentElement: root,
    readyState,
    querySelectorAll: () => [button],
    addEventListener: (type, fn) => { if (type === 'click') (clickHandler = clickHandler ? ((a, b) => (e) => { a(e); b(e); })(clickHandler, fn) : fn); if (type === 'DOMContentLoaded') ready = fn; },
    dispatchEvent: (e) => events.push(e),
  };
  const window = {};
  Object.defineProperty(window, 'localStorage', { get: () => { if (storage === 'throws') throw new Error('blocked'); return storage; } });
  const context = { document, window, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };
  vm.createContext(context);
  for (let i = 0; i < runs; i++) vm.runInContext(TOGGLE_JS, context);
  return { root, button, events, ready: () => ready && ready(), click: () => clickHandler({ target: button }), clickIcon: () => clickHandler({ target: icon }) };
}

test('clicking cycles data-theme, stores the mode, relabels and fires pa:theme', () => {
  const saved = {};
  const dom = fakeDom({ setItem: (k, v) => { saved[k] = v; } });
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Auto. Switch to Light');
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'light');
  assert.equal(dom.button.attrs['data-mode'], 'light');
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Light. Switch to Dark');
  assert.equal(dom.button.attrs.title, 'Theme: Light. Switch to Dark');
  assert.equal(saved['pa-theme'], 'light');
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'dark');
  dom.click();
  assert.equal('data-theme' in dom.root.attrs, false);
  assert.deepEqual(dom.events.map((e) => e.detail.mode), ['light', 'dark', 'auto']);
});

test('blocked storage: toggle still cycles without throwing', () => {
  const dom = fakeDom('throws');
  dom.click();
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'dark');
  assert.equal(dom.button.attrs['data-mode'], 'dark');
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Dark. Switch to Auto');
  assert.equal(dom.button.attrs.title, 'Theme: Dark. Switch to Auto');
});

test('running the script twice adds one listener: one click advances one mode', () => {
  const dom = fakeDom({ setItem() {} }, { runs: 2 });
  dom.click();
  assert.equal(dom.root.attrs['data-theme'], 'light');
  assert.deepEqual(dom.events.map((e) => e.detail.mode), ['light']);
});

test('initial paint waits for DOMContentLoaded while loading, runs at once otherwise', () => {
  const loading = fakeDom({ setItem() {} }, { readyState: 'loading', htmlTheme: 'dark' });
  assert.equal(loading.button.attrs['aria-label'], undefined);
  loading.ready();
  assert.equal(loading.button.attrs['aria-label'], 'Theme: Dark. Switch to Auto');
  const done = fakeDom({ setItem() {} }, { readyState: 'complete' });
  assert.equal(done.button.attrs['aria-label'], 'Theme: Auto. Switch to Light');
});

test('html starting at data-theme=dark paints dark and a click goes to auto', () => {
  const dom = fakeDom({ setItem() {} }, { htmlTheme: 'dark' });
  assert.equal(dom.button.attrs['data-mode'], 'dark');
  assert.equal(dom.button.attrs['aria-label'], 'Theme: Dark. Switch to Auto');
  dom.click();
  assert.equal('data-theme' in dom.root.attrs, false);
});

test('a click on a child icon resolves to the toggle button', () => {
  const dom = fakeDom({ setItem() {} });
  dom.clickIcon();
  assert.equal(dom.root.attrs['data-theme'], 'light');
});
