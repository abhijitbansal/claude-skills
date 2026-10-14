// make-diagram viewer, trace: hover, keyboard focus and a pinning click light a
// node (or an edge) and what it touches; the rest dims (pa-dim / pa-on, styled
// by diagramCss()). Registered as PADiagram.trace and composed by viewer.js.
// Phase 2 grows this file into Explore (panel, route, find).
//
//   var trace = PADiagram.trace(svg, data, els, { isOff });
//
// isOff() true (the story is on) leaves the diagram untouched, since the beat's
// own dimming would otherwise fight the trace's.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.trace = function (svg, data, els, hooks) {
    hooks = hooks || {};
    var adjacency = PADiagram.dict(data.adjacency);
    var edgeEnds = PADiagram.dict(data.edges);
    var hoverId = null;
    var focusId = null;
    var pinId = null;
    var traced = []; // elements carrying pa-dim / pa-on, to reset cheaply

    function relation(id) {
      if (edgeEnds[id]) return { nodes: edgeEnds[id].slice(), edges: [id], on: [] };
      var a = adjacency[id] || { nodes: [], edges: [] };
      return { nodes: [id].concat(a.nodes), edges: a.edges, on: [id] };
    }
    function paint(el, dim, on) {
      el.classList.toggle('pa-dim', dim);
      el.classList.toggle('pa-on', on);
      traced.push(el);
    }
    function refresh() {
      traced.forEach(function (el) { el.classList.remove('pa-dim', 'pa-on'); });
      traced = [];
      var id = hooks.isOff && hooks.isOff() ? null : (pinId || hoverId || focusId);
      svg.classList.toggle('pa-tracing', !!id);
      if (!id) return;
      var rel = relation(id);
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], rel.nodes.indexOf(n) < 0, rel.on.indexOf(n) >= 0); });
      Object.keys(els.edges).forEach(function (e) {
        var incident = rel.edges.indexOf(e) >= 0;
        paint(els.edges[e], !incident, incident);
        if (els.labels[e]) paint(els.labels[e], !incident, false);
      });
    }
    // The node or edge id under a pointer or focus target, or null.
    function idAt(target) {
      var el = target && target.closest ? target.closest('.pa-node,.pa-edge,.pa-edge-label') : null;
      if (!el) return null;
      return el.getAttribute('data-id') || el.getAttribute('data-edge');
    }

    return {
      refresh: refresh,
      idAt: idAt,
      hover: function (id) { if (id === hoverId) return; hoverId = id; refresh(); },
      focus: function (id) { focusId = id; refresh(); },
      pin: function (id) { pinId = id && id !== pinId ? id : null; refresh(); },
      pinned: function () { return pinId; },
      active: function () { return pinId || hoverId || focusId; },
      hasFocus: function () { return !!focusId; },
      clear: function () { pinId = null; hoverId = null; refresh(); },
    };
  };
})(window);
