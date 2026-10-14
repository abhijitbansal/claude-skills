// make-diagram viewer, panel: paints the Explore side panel, the hover tooltip
// and the Find results from what the trace (explore.js) holds. Every holder is
// optional (make-explainer passes none yet). Text goes in as textContent,
// never markup. Registered as PADiagram.panel and composed by viewer.js.
//
//   var panel = PADiagram.panel({ panel, tip, found }, data, els, trace, { isOff, onPick, onBeat, onClose });
//
// panel   aside[data-pa-panel] with data-pa-panel-title, data-pa-panel-close,
//         data-pa-empty (holding data-pa-tally) and data-pa-panel-body inside it.
// tip     [data-pa-tip], positioned inside the stage.
// found   the row the Find matches go in (buttons that pick a node).
// isOff() true hides the panel and the tooltip (the story is on).
// onPick(id) selects and shows a node named in a row; onBeat(i) enters Play at
// beat i; onClose(byKeyboard) runs when the close button is pressed.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var TIP_GAP = 12; // px between the pointer and the tooltip
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  PADiagram.panel = function (holders, data, els, trace, hooks) {
    hooks = hooks || {};
    var doc = global.document;
    var panelEl = holders.panel || null;
    var tip = holders.tip || null;
    var foundEl = holders.found || null;
    var info = PADiagram.dict(data.info);
    var edgeEnds = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var beats = data.beats || [];
    var isSequence = data.type === 'sequence';
    var part = function (name) { return panelEl ? panelEl.querySelector('[' + name + ']') : null; };
    var titleEl = part('data-pa-panel-title');
    var closeEl = part('data-pa-panel-close');
    var emptyEl = part('data-pa-empty');
    var bodyEl = part('data-pa-panel-body');
    var countsEl = part('data-pa-tally');
    var off = function () { return !!(hooks.isOff && hooks.isOff()); };
    var labelOf = function (id) { return info[id] ? info[id].label : id; };

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    // A button row: `attr` names what it stands for (a node id, a beat index).
    function row(text, attr, value, onClick) {
      var b = el('button', 'pa-row', text);
      b.type = 'button';
      b.setAttribute(attr, String(value));
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
      return b;
    }
    function section(heading, attr, items, none) {
      bodyEl.appendChild(el('h3', null, heading));
      var ul = el('ul');
      ul.setAttribute(attr, '');
      if (!items.length) ul.appendChild(el('li', 'panel-none', none));
      items.forEach(function (item) { var li = el('li'); li.appendChild(item); ul.appendChild(li); });
      bodyEl.appendChild(ul);
    }
    var edgeText = function (e) { var it = info[e]; return it && it.label ? ' · ' + it.label : ''; };
    var pickRow = function (prefix, id, edge) { return row(prefix + labelOf(id) + edgeText(edge), 'data-pa-go', id, function () { hooks.onPick(id); }); };

    // ---- the views ---------------------------------------------------------------------------
    // A node: its emoji (else a copy of the icon drawn in the diagram), kind, note, detail, and who it talks to.
    function paintNode(id) {
      var it = info[id] || { label: id, kind: '' };
      titleEl.textContent = it.label;
      var glyph = el('div', 'panel-icon');
      if (it.emoji) glyph.textContent = it.emoji;
      else {
        var icon = els.nodes[id] ? els.nodes[id].querySelector('.pa-icon') : null;
        if (icon) {
          var s = doc.createElementNS(icon.namespaceURI, 'svg');
          s.setAttribute('class', 'panel-glyph');
          s.setAttribute('viewBox', '0 0 24 24');
          s.setAttribute('aria-hidden', 'true');
          var copy = icon.cloneNode(true);
          copy.removeAttribute('transform');
          s.appendChild(copy);
          glyph.appendChild(s);
        }
      }
      bodyEl.appendChild(glyph);
      bodyEl.appendChild(el('p', 'panel-kind', it.kind || ''));
      if (it.note) bodyEl.appendChild(el('p', 'panel-note', it.note));
      if (it.detail) bodyEl.appendChild(el('p', 'panel-detail', it.detail));
      var l = trace.links(id);
      section('Sends to', 'data-pa-sends', l.sends.map(function (x) { return pickRow('→ ', x.other, x.edge); }), 'nothing');
      section('Receives from', 'data-pa-receives', l.receives.map(function (x) { return pickRow('← ', x.other, x.edge); }), 'nothing');
    }
    // An edge or message: label, style, both ends, and the beats that travel it.
    function paintEdge(id) {
      var it = info[id] || {};
      var ends = edgeEnds[id];
      var both = !isSequence && ends[0] !== ends[1] && (directed[ends[1]] || []).indexOf(id) >= 0;
      titleEl.textContent = it.label || (isSequence ? 'Message' : 'Edge');
      bodyEl.appendChild(el('p', 'panel-kind', it.style || ''));
      section('Between', 'data-pa-ends', [pickRow('', ends[0]), el('span', 'panel-arrow', both ? '↔' : '→'), pickRow('', ends[1])], 'nothing');
      var used = [];
      beats.forEach(function (b, i) {
        if (b.edge === id) used.push(row(pad2(i + 1) + ' ' + b.title, 'data-pa-beat-go', i, function () { hooks.onBeat(i); }));
      });
      section('Used in', 'data-pa-used', used, 'no beat');
    }
    // A route: both ends, each hop in order, and whether the arrows were ignored.
    function paintRoute(r) {
      titleEl.textContent = 'Route';
      bodyEl.appendChild(el('p', 'panel-kind', labelOf(r.from) + ' → ' + labelOf(r.to)));
      if (!r.hops.length) {
        bodyEl.appendChild(el('p', 'panel-note', 'No route between ' + labelOf(r.from) + ' and ' + labelOf(r.to) + '.'));
        return;
      }
      if (!r.directed) bodyEl.appendChild(el('p', 'panel-note', 'ignores arrow direction'));
      var ol = el('ol');
      ol.setAttribute('data-pa-hops', '');
      r.hops.forEach(function (h) { ol.appendChild(el('li', null, labelOf(h.from) + ' → ' + labelOf(h.to) + edgeText(h.edge))); });
      bodyEl.appendChild(ol);
    }

    // ---- painting -----------------------------------------------------------------------------
    if (countsEl) {
      trace.counts().forEach(function (text) {
        var chip = el('span', 'pa-chip', text);
        chip.setAttribute('role', 'listitem');
        countsEl.appendChild(chip);
      });
    }
    // A click's detail is 0 when a key (Enter, Space) pressed the button: then focus should go back to the node.
    if (closeEl) closeEl.addEventListener('click', function (e) { e.stopPropagation(); if (hooks.onClose) hooks.onClose(e.detail === 0); });

    // Repaint from the trace: a route, a selected edge or node, or the empty
    // state. Focus inside the panel moves to the close button, so a repaint
    // under the keyboard never drops focus to the page.
    function paint() {
      if (!panelEl) return;
      panelEl.hidden = off();
      if (off() && tip) tip.hidden = true; // the hover tooltip never rides over the Play stage
      if (!bodyEl || !titleEl) return;
      var hadFocus = panelEl.contains(doc.activeElement);
      var r = trace.routed();
      var id = trace.selected();
      var something = !!(r || id);
      empty(bodyEl);
      bodyEl.hidden = !something;
      if (emptyEl) emptyEl.hidden = something;
      if (closeEl) closeEl.hidden = !something;
      if (r) paintRoute(r);
      else if (id && edgeEnds[id]) paintEdge(id);
      else if (id) paintNode(id);
      else titleEl.textContent = 'Map';
      if (hadFocus && something && closeEl) closeEl.focus();
    }

    // ---- the tooltip ----------------------------------------------------------------------------
    function tipText(id) {
      var it = info[id];
      if (!it) return id;
      if (edgeEnds[id]) return it.label || (labelOf(edgeEnds[id][0]) + ' → ' + labelOf(edgeEnds[id][1]));
      return it.note ? it.label + ' — ' + it.note : it.label;
    }
    // Keep the tip inside its host (the stage): flip to the other side of the pointer when it would overflow.
    function tipMove(x, y) {
      if (!tip || tip.hidden || off()) return;
      var host = tip.parentNode;
      var left = x + TIP_GAP;
      var top = y + TIP_GAP;
      if (host && left + tip.offsetWidth > host.clientWidth) left = Math.max(0, x - tip.offsetWidth - TIP_GAP);
      if (host && top + tip.offsetHeight > host.clientHeight) top = Math.max(0, y - tip.offsetHeight - TIP_GAP);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function tipFor(id, x, y) {
      if (!tip) return;
      if (!id || off()) { tip.hidden = true; return; }
      tip.textContent = tipText(id);
      tip.hidden = false;
      tipMove(x, y);
    }

    // ---- the Find matches -----------------------------------------------------------------------
    function found(hits, query) {
      if (!foundEl) return;
      empty(foundEl);
      foundEl.hidden = !String(query || '').trim();
      if (foundEl.hidden) return;
      if (!hits.length) { foundEl.appendChild(el('span', 'panel-none', 'No node matches')); return; }
      hits.forEach(function (h) {
        var b = el('button', 'pa-chip', h.label);
        b.type = 'button';
        b.setAttribute('data-pa-pick', h.id);
        b.addEventListener('click', function () { hooks.onPick(h.id); });
        foundEl.appendChild(b);
      });
    }

    paint();
    return { paint: paint, tipFor: tipFor, tipMove: tipMove, found: found };
  };
})(window);
