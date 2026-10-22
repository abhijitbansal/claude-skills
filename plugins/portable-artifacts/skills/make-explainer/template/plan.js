// plan.js: the plan-mode answer runtime. Reads the answers from the form controls the renderers wrote
// (radios, textareas, the reviewer name), saves them in this browser, and exports the plan-answers/1 file by
// Copy or Download. Nothing is fetched and nothing is re-rendered: it only sets `checked` and `value`.
//
// Saved answers (localStorage "pa-plan:<key>"):
// - Radios save at once, typing after a short pause (and when the page is hidden or left).
// - Several tabs: a write merges only the items this tab changed into the newest stored entry, so two tabs
//   answering different items keep both. When another tab saves, its answers are put on this page (stored wins),
//   except for an item being typed in right now.
// - A stored entry for a different plan hash is not applied and is not wiped on load: a notice says the plan
//   changed, and the reader's first change replaces the old entry.
// - Storage that is missing or refuses writes: answering works for this visit and a note says it is not saved.
(function () {
  var PA = window.PA;
  var root = document.documentElement;
  var items = [].slice.call(document.querySelectorAll('[data-plan-item]'));
  var verdictBox = items.filter(function (el) { return el.getAttribute('data-kind') === 'verdict'; })[0] || null;
  var asks = items.filter(function (el) { return el !== verdictBox; });
  var planKey = root.getAttribute('data-plan-key') || '';
  var planHash = root.getAttribute('data-plan-hash') || '';
  var storeKey = 'pa-plan:' + planKey;
  var local = PA.safeStorage('localStorage');
  var STATUS_MS = 4000;
  var TEXT_SAVE_MS = 250; // typing is saved this long after the last key
  var REVOKE_MS = 1000; // a download's object URL is released this long after the click
  var statusTimer = 0;
  var speakTimer = 0;
  var frame = 0;

  function part(box, name) { return box ? box.querySelector('[' + name + ']') : null; }
  function radios(box) { return [].slice.call(box.querySelectorAll('input[type=radio]')); }
  function chosen(box) {
    var on = radios(box).filter(function (r) { return r.checked; })[0];
    return on || null;
  }
  function setChoice(box, value) {
    radios(box).forEach(function (r) { r.checked = r.value === value; });
  }
  function has(box, value) {
    return radios(box).some(function (r) { return r.value === value; });
  }
  function textOf(box, name) {
    var el = part(box, name);
    return el ? el.value : '';
  }

  // ---- what the reader has answered, read from the form --------------------------
  // The decision/approval/question rows, in page order, as the file holds them.
  function answerRow(box) {
    var kind = box.getAttribute('data-kind');
    var fallback = box.getAttribute('data-default') || '';
    var on = chosen(box);
    var text = textOf(box, 'data-answer');
    var comment = textOf(box, 'data-comment');
    var row = {
      id: box.getAttribute('data-id'),
      kind: kind,
      question: box.getAttribute('data-question'),
      answered: false,
      choice: null,
      isRecommended: null,
      text: null,
      comment: comment === '' ? null : comment,
    };
    if (kind === 'question') {
      row.answered = text.trim() !== '';
      row.text = row.answered ? text : (fallback === '' ? null : fallback);
      return row;
    }
    if (on) {
      row.answered = true;
      row.choice = on.value;
      if (kind === 'decision') row.isRecommended = on.getAttribute('data-recommended') === 'true';
    } else if (kind === 'decision' && fallback !== '') {
      row.choice = fallback;
    }
    return row;
  }
  function verdictValue() {
    var on = verdictBox ? chosen(verdictBox) : null;
    return on ? on.value : null;
  }
  function reviewer() { return textOf(verdictBox, 'data-reviewer').trim(); }

  PA.planExport = function () {
    return {
      schema: 'plan-answers/1',
      planKey: planKey,
      planHash: planHash,
      reviewer: reviewer(),
      verdict: verdictValue(),
      answers: asks.map(answerRow),
    };
  };


  // ---- saved answers ------------------------------------------------------------
  // { hash, answers: { [id]: { choice?, text?, comment? } }, verdict, reviewer }. Storage can be missing or
  // refuse writes; then answering still works for this visit and a note says so.
  var unsaved = part(verdictBox, 'data-plan-unsaved');
  var stale = part(verdictBox, 'data-plan-stale');
  function show(note) { if (note) note.hidden = false; }
  function hide(note) { if (note) note.hidden = true; }
  function isText(value) { return typeof value === 'string'; }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function ownEntry(map, id) { return isObject(map) && Object.prototype.hasOwnProperty.call(map, id) && isObject(map[id]) ? map[id] : null; }

  // One item as it is saved: only the parts the reader filled in, or null for an untouched item.
  function savedItem(box) {
    var saved = {};
    var on = chosen(box);
    var text = textOf(box, 'data-answer');
    var comment = textOf(box, 'data-comment');
    if (on) saved.choice = on.value;
    if (text !== '') saved.text = text;
    if (comment !== '') saved.comment = comment;
    return on || text !== '' || comment !== '' ? saved : null;
  }
  function parseStored(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      var data = JSON.parse(raw);
      return isObject(data) ? data : null;
    } catch (e) { return null; }
  }
  // The entry in storage right now, if it belongs to this plan (same hash).
  function freshEntry() {
    var data = parseStored(PA.readStore(local, storeKey));
    return data && data.hash === planHash ? data : null;
  }

  // What this tab changed since its last write. A write merges only these into the freshest stored entry, so two
  // tabs answering different items never erase each other.
  var dirtyIds = Object.create(null);
  var dirtyVerdict = false;
  var saveTimer = 0;
  var canSave = false;
  // Answers put on the form from a saved page are not written to storage until the reader changes something (their
  // earlier answers here are never replaced just by opening a file), and that first write carries the whole form.
  var adoptPending = false;
  // A saved page's savedAt comes from another clock. Writes are stamped at least this late, so the reader's own
  // later edits are never older than the file they started from.
  var stampFloor = 0;
  function markDirty(target) {
    var box = target.closest ? target.closest('[data-plan-item]') : null;
    if (!box) return false;
    if (box === verdictBox) dirtyVerdict = true; else dirtyIds[box.getAttribute('data-id')] = true;
    return true;
  }
  function merged(base) {
    var answers = {};
    asks.forEach(function (box) {
      var id = box.getAttribute('data-id');
      var saved = dirtyIds[id] ? savedItem(box) : ownEntry(base.answers, id);
      if (saved) answers[id] = saved;
    });
    return {
      hash: planHash,
      updatedAt: Math.max(Date.now(), stampFloor),
      answers: answers,
      verdict: dirtyVerdict ? verdictValue() : (isText(base.verdict) ? base.verdict : null),
      reviewer: dirtyVerdict ? textOf(verdictBox, 'data-reviewer') : (isText(base.reviewer) ? base.reviewer : ''),
    };
  }
  function everything() {
    // No usable stored entry (none, or another plan's): this page's whole state is the entry.
    var all = {};
    asks.forEach(function (box) { all[box.getAttribute('data-id')] = true; });
    dirtyIds = all;
    dirtyVerdict = true;
    return merged({});
  }
  function persist() {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    var base = freshEntry();
    var entry = base && !adoptPending ? merged(base) : everything();
    // What failed to save stays dirty, so the next write carries it and the note stays until one holds.
    if (PA.saveStore(local, storeKey, JSON.stringify(entry))) {
      adoptPending = false;
      dirtyIds = Object.create(null);
      dirtyVerdict = false;
      if (canSave) hide(unsaved);
    } else {
      show(unsaved);
    }
  }
  function flush() { if (saveTimer) persist(); }

  // Put a stored entry on the form (stored wins). Items this tab is in the middle of changing are left alone.
  function apply(data) {
    asks.forEach(function (box) {
      var id = box.getAttribute('data-id');
      if (dirtyIds[id]) return;
      var saved = ownEntry(data.answers, id) || {};
      setChoice(box, isText(saved.choice) && has(box, saved.choice) ? saved.choice : null);
      var answer = part(box, 'data-answer');
      var comment = part(box, 'data-comment');
      if (answer) answer.value = isText(saved.text) ? saved.text : '';
      if (comment) comment.value = isText(saved.comment) ? saved.comment : '';
    });
    if (!verdictBox || dirtyVerdict) return;
    setChoice(verdictBox, isText(data.verdict) && has(verdictBox, data.verdict) ? data.verdict : null);
    var name = part(verdictBox, 'data-reviewer');
    if (name) name.value = isText(data.reviewer) ? data.reviewer : '';
  }

  // A page saved with "Save as HTML" carries the reader's answers in a data block (#pa-plan-saved):
  // { schema: 'plan-saved/1', savedAt, entry: <a stored entry>, export: <the plan-answers/1 file> }.
  // It is the page's starting answers unless this browser holds a newer entry for the same plan (by updatedAt),
  // and it applies even when storage is blocked, so a saved file works anywhere.
  var slot = document.getElementById('pa-plan-saved');
  function shippedAnswers() {
    var payload = slot ? parseStored(slot.textContent) : null;
    if (!payload || payload.schema !== 'plan-saved/1' || typeof payload.savedAt !== 'number') return null;
    return isObject(payload.entry) && payload.entry.hash === planHash ? payload : null;
  }
  canSave = PA.saveStore(local, 'pa-probe', '1') && PA.saveStore(local, 'pa-probe', null);
  var data = canSave ? parseStored(PA.readStore(local, storeKey)) : null;
  var current = data && data.hash === planHash ? data : null;
  var shipped = shippedAnswers();
  if (!canSave) show(unsaved);
  // This browser's own entry wins when it is newer than the file, or older but unstamped (written before saved
  // pages existed: it is the reader's own work, so it is never replaced just by opening a file).
  var ownIsNewer = !!current && (typeof current.updatedAt !== 'number' || current.updatedAt >= (shipped ? shipped.savedAt : 0));
  if (shipped) stampFloor = shipped.savedAt;
  if (shipped && !ownIsNewer) {
    apply(shipped.entry);
    adoptPending = true;
  } else if (current) {
    apply(current);
  } else if (data) {
    // The plan was edited since these answers were saved: they do not fit it, so they are not applied. Nothing is
    // written until the reader changes something; that first write replaces the old entry.
    show(stale);
  }

  document.addEventListener('change', function (event) {
    var target = event.target;
    if (!target || target.type !== 'radio' || !markDirty(target)) return;
    persist();
  });
  document.addEventListener('input', function (event) {
    var target = event.target;
    if (!target || target.type === 'radio' || !markDirty(target)) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, TEXT_SAVE_MS);
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  // Another tab (or page) saved this plan's answers: take them.
  window.addEventListener('storage', function (event) {
    if (!canSave || event.storageArea !== local || (event.key !== null && event.key !== storeKey)) return;
    var entry = freshEntry();
    if (entry) apply(entry);
  });

  // ---- export: copy and download ---------------------------------------------------
  // Two status lines: the one by the verdict's buttons (Copy, Download) and the one under the Save button (Save as
  // HTML). A message goes to one of them, so a screen reader announces it once.
  var verdictLine = part(verdictBox, 'data-plan-status');
  var saveLine = document.querySelector('[data-plan-save-status]');
  var lines = [verdictLine, saveLine].filter(Boolean);
  function setLines(text) { lines.forEach(function (el) { el.textContent = text; }); }
  // Cleared first, then set on the next frame, so the same message said twice is announced twice. One pending
  // frame and one clear timer at a time: a later call cancels the earlier ones. A hidden tab never runs frames,
  // so there (or with no requestAnimationFrame) it is set on a zero timer instead.
  function say(message, line) {
    var target = line || verdictLine || saveLine;
    if (!target) return;
    window.clearTimeout(statusTimer);
    window.clearTimeout(speakTimer);
    if (frame && window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
    frame = 0;
    setLines('');
    var speak = function () {
      frame = 0;
      target.textContent = message;
      statusTimer = window.setTimeout(function () { setLines(''); }, STATUS_MS);
    };
    if (window.requestAnimationFrame && !document.hidden) frame = window.requestAnimationFrame(speak);
    else speakTimer = window.setTimeout(speak, 0);
  }
  // Copy: one line, easy to paste into a chat. Download: the same data, pretty-printed.
  function copyText() { return JSON.stringify(PA.planExport()); }
  function downloadText() { return JSON.stringify(PA.planExport(), null, 2) + '\n'; }

  function copyViaSelection(text) {
    var area = document.createElement('textarea');
    area.readOnly = true;
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function copyDone(ok, button) {
    say(ok ? 'Answers copied to the clipboard' : 'Could not copy; use Download plan-answers.json instead');
    if (button) button.focus();
  }
  function copyAnswers(button) {
    var text = copyText();
    var writer = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard : null;
    // No clipboard API: select and copy right here, inside the click.
    if (!writer) { copyDone(copyViaSelection(text), button); return; }
    var viaClipboard;
    try { viaClipboard = writer.writeText(text); } catch (e) { viaClipboard = Promise.reject(e); }
    viaClipboard.then(
      function () { copyDone(true, null); },
      function () { copyDone(copyViaSelection(text), button); }
    );
  }
  function downloadAnswers() {
    var blob = new Blob([downloadText()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'plan-answers.json';
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, REVOKE_MS);
    say('Download started');
  }
  // Save as HTML: this very page with the answers put in its #pa-plan-saved block. The copy is made from the DOM
  // with what the runtimes added undone (the reader's own theme choice, shown notices, status text, scroll-spy
  // marks), so opening it starts like a fresh page plus the answers. The form's live state is not read from the
  // copy: the answers travel in the block and are put back on load (above).
  function wholeEntry() {
    var answers = {};
    asks.forEach(function (box) {
      var saved = savedItem(box);
      if (saved) answers[box.getAttribute('data-id')] = saved;
    });
    return { hash: planHash, answers: answers, verdict: verdictValue(), reviewer: textOf(verdictBox, 'data-reviewer') };
  }
  // JSON that cannot end its <script> block or be cut by a line separator: every "<" and U+2028/2029 is escaped.
  var LINE_SEPARATORS = new RegExp(String.fromCharCode(91, 8232, 8233, 93), 'g'); // [U+2028 U+2029]
  function blockJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, function (c) { return '\\u' + c.charCodeAt(0).toString(16); });
  }
  function savedPage() {
    var copy = root.cloneNode(true);
    var block = copy.querySelector('#pa-plan-saved');
    if (!block) return null;
    block.textContent = blockJson({ schema: 'plan-saved/1', savedAt: Date.now(), entry: wholeEntry(), export: PA.planExport() });
    copy.removeAttribute('data-theme');
    copy.classList.remove('rise-ready');
    [].forEach.call(copy.querySelectorAll('[data-plan-unsaved], [data-plan-stale], [data-unsaved]'), function (note) { note.hidden = true; });
    [].forEach.call(copy.querySelectorAll('[data-plan-status], [data-plan-save-status]'), function (line) { line.textContent = ''; });
    // The theme toggle shows the reader's own choice (data-mode, label); the copy starts on Auto like a fresh page.
    [].forEach.call(copy.querySelectorAll('[data-theme-toggle]'), function (toggle) {
      toggle.setAttribute('data-mode', 'auto');
      toggle.setAttribute('aria-label', 'Theme: Auto. Switch to Light');
      toggle.setAttribute('title', 'Theme: Auto. Switch to Light');
    });
    [].forEach.call(copy.querySelectorAll('[aria-current]'), function (el) { el.removeAttribute('aria-current'); });
    return '<!doctype html>\n' + copy.outerHTML + '\n';
  }
  function saveAsHtml() {
    var html = savedPage();
    if (html === null) { say('Could not save: this page has no place for the answers', saveLine); return; }
    var name = (planKey.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan') + '-answered.html';
    var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, REVOKE_MS);
    say('Saved ' + name + ' with your answers inside', saveLine);
  }

  var copy = part(verdictBox, 'data-plan-copy');
  var download = part(verdictBox, 'data-plan-download');
  var saveHtml = document.querySelector('[data-plan-save-html]');
  if (copy) copy.addEventListener('click', function () { copyAnswers(copy); });
  if (download) download.addEventListener('click', downloadAnswers);
  if (saveHtml) saveHtml.addEventListener('click', saveAsHtml);
})();
