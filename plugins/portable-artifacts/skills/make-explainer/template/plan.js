// plan.js: the plan-mode answer runtime. Reads the answers from the form controls the renderers wrote
// (radios, textareas, the reviewer name), saves them in this browser, and exports the plan-answers/1 file by
// Copy or Download. Nothing is fetched and nothing is re-rendered: it only sets `checked` and `value`.
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
  var statusTimer = 0;

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
  function snapshot() {
    var answers = {};
    asks.forEach(function (box) {
      var saved = {};
      var on = chosen(box);
      var text = textOf(box, 'data-answer');
      var comment = textOf(box, 'data-comment');
      if (on) saved.choice = on.value;
      if (text !== '') saved.text = text;
      if (comment !== '') saved.comment = comment;
      if (on || text !== '' || comment !== '') answers[box.getAttribute('data-id')] = saved;
    });
    return { hash: planHash, answers: answers, verdict: verdictValue(), reviewer: textOf(verdictBox, 'data-reviewer') };
  }
  var unsaved = part(verdictBox, 'data-plan-unsaved');
  var stale = part(verdictBox, 'data-plan-stale');
  function show(note) { if (note) note.hidden = false; }
  function persist() {
    if (!PA.saveStore(local, storeKey, JSON.stringify(snapshot()))) show(unsaved);
  }
  function parseStored(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      var data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch (e) { return null; }
  }
  function isText(value) { return typeof value === 'string'; }
  function restore(data) {
    var answers = data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : {};
    asks.forEach(function (box) {
      var id = box.getAttribute('data-id');
      var saved = Object.prototype.hasOwnProperty.call(answers, id) ? answers[id] : null;
      if (!saved || typeof saved !== 'object') return;
      if (isText(saved.choice) && has(box, saved.choice)) setChoice(box, saved.choice);
      var answer = part(box, 'data-answer');
      var comment = part(box, 'data-comment');
      if (answer && isText(saved.text)) answer.value = saved.text;
      if (comment && isText(saved.comment)) comment.value = saved.comment;
    });
    if (!verdictBox) return;
    if (isText(data.verdict) && has(verdictBox, data.verdict)) setChoice(verdictBox, data.verdict);
    var name = part(verdictBox, 'data-reviewer');
    if (name && isText(data.reviewer)) name.value = data.reviewer;
  }

  var canSave = PA.saveStore(local, 'pa-probe', '1') && PA.saveStore(local, 'pa-probe', null);
  if (!canSave) {
    show(unsaved);
  } else {
    var data = parseStored(PA.readStore(local, storeKey));
    if (data && data.hash === planHash) {
      restore(data);
    } else if (data) {
      // The plan was edited since these answers were saved: they no longer fit it. Start over, and say so.
      show(stale);
      persist();
    }
  }

  function onAnswer(event) {
    var target = event.target;
    if (!target || !target.closest || !target.closest('[data-plan-item]')) return;
    persist();
  }
  document.addEventListener('change', onAnswer);
  document.addEventListener('input', onAnswer);

  // ---- export: copy and download ---------------------------------------------------
  var status = part(verdictBox, 'data-plan-status');
  function say(message) {
    if (!status) return;
    status.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () { status.textContent = ''; }, STATUS_MS);
  }
  function exportText() { return JSON.stringify(PA.planExport(), null, 2) + '\n'; }

  function copyViaSelection(text) {
    var area = document.createElement('textarea');
    area.readOnly = true;
    area.value = text;
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function copyAnswers(button) {
    var text = exportText();
    var viaClipboard;
    try {
      viaClipboard = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error('no clipboard'));
    } catch (e) { viaClipboard = Promise.reject(e); }
    viaClipboard.then(
      function () { say('Answers copied to the clipboard'); },
      function () {
        if (copyViaSelection(text)) say('Answers copied to the clipboard');
        else say('Could not copy; use Download plan-answers.json instead');
        if (button) button.focus();
      }
    );
  }
  function downloadAnswers() {
    var blob = new Blob([exportText()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'plan-answers.json';
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    say('plan-answers.json downloaded');
  }
  var copy = part(verdictBox, 'data-plan-copy');
  var download = part(verdictBox, 'data-plan-download');
  if (copy) copy.addEventListener('click', function () { copyAnswers(copy); });
  if (download) download.addEventListener('click', downloadAnswers);
})();
