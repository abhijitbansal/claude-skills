// make-diagram viewer, explore: what the reader is looking at. Hover, keyboard
// focus and a click light a node (or an edge) and what it touches, the rest
// dims (pa-dim / pa-on); the clicked one is the selection (pa-selected) the
// panel describes; a shift-click on a second node asks route.js for the way
// between them (pa-route); the Find box filters nodes by label. Registered as
// PADiagram.trace and composed by viewer.js; panel.js paints what this holds.
//
//   var trace = PADiagram.trace(svg, data, els, { isOff });
//
// isOff() true (the story is on) leaves the diagram untouched, since the beat's
// own dimming would otherwise fight the trace's. Painting precedence: a route,
// else the selected / hovered / focused id, else the Find filter.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var FIND_MAX = 8; // matches listed under the Find box

  PADiagram.trace = function (svg, data, els, hooks) {
    hooks = hooks || {};
    var adjacency = PADiagram.dict(data.adjacency);
    var edgeEnds = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var parents = PADiagram.dict(data.parents);
    var info = PADiagram.dict(data.info);
    var hoverId = null;
    var focusId = null;
    var selectId = null;
    var routeState = null; // PADiagram.route's answer while a route shows
    var findIds = null; // node ids matching the Find text, or null for no filter
    var traced = []; // elements carrying state classes, to reset cheaply

    var otherEnd = function (e, id) { var ends = edgeEnds[e] || []; return ends[0] === id ? ends[1] : ends[0]; };
    var isNode = function (id) { return !!(els.nodes[id] && info[id] && info[id].kind && info[id].kind !== 'group'); };

    function relation(id) {
      if (edgeEnds[id]) return { nodes: edgeEnds[id].slice(), edges: [id], on: [] };
      var a = adjacency[id] || { nodes: [], edges: [] };
      var rel = { nodes: [id].concat(a.nodes), edges: a.edges, on: [id] };
      if (!els.groups[id]) return rel;
      // a group also keeps what it holds lit (story.js light() walks parents the same way)
      var inside = function (at) { for (at = parents[at]; at !== undefined; at = parents[at]) if (at === id) return true; return false; };
      rel.nodes = rel.nodes.concat(Object.keys(els.nodes).filter(inside));
      rel.edges = rel.edges.concat(Object.keys(edgeEnds).filter(function (e) { return inside(edgeEnds[e][0]) && inside(edgeEnds[e][1]); }));
      return rel;
    }
    function paint(el, dim, on, cls) {
      el.classList.toggle('pa-dim', dim);
      el.classList.toggle('pa-on', on);
      if (cls) el.classList.add(cls);
      traced.push(el);
    }
    function reset() {
      traced.forEach(function (el) { el.classList.remove('pa-dim', 'pa-on', 'pa-selected', 'pa-route'); });
      traced = [];
    }
    // The id and what touches it stay lit; the selected one is also marked.
    function paintRelation(id) {
      var rel = relation(id);
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], rel.nodes.indexOf(n) < 0, rel.on.indexOf(n) >= 0, n === selectId ? 'pa-selected' : null); });
      if (selectId && els.groups[selectId]) paint(els.groups[selectId], false, false, 'pa-selected');
      Object.keys(els.edges).forEach(function (e) {
        var incident = rel.edges.indexOf(e) >= 0;
        paint(els.edges[e], !incident, incident, e === selectId ? 'pa-selected' : null);
        if (els.labels[e]) paint(els.labels[e], !incident, false, null);
      });
    }
    // Both ends and every hop stay lit (a group among them too); the rest dims.
    function paintRoute(r) {
      var on = PADiagram.dict();
      var via = PADiagram.dict();
      on[r.from] = true;
      on[r.to] = true;
      r.hops.forEach(function (h) { on[h.from] = true; on[h.to] = true; via[h.edge] = true; });
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], !on[n], false, on[n] ? 'pa-route' : null); });
      Object.keys(els.groups).forEach(function (g) { if (on[g]) paint(els.groups[g], false, false, 'pa-route'); });
      Object.keys(els.edges).forEach(function (e) {
        paint(els.edges[e], !via[e], false, via[e] ? 'pa-route' : null);
        if (els.labels[e]) paint(els.labels[e], !via[e], false, null);
      });
    }
    // Nodes whose label matches stay lit, with the edges between two of them.
    function paintFind(ids) {
      var hit = PADiagram.dict();
      ids.forEach(function (id) { hit[id] = true; });
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], !hit[n], false, null); });
      Object.keys(els.edges).forEach(function (e) {
        var ends = edgeEnds[e] || [];
        var on = !!hit[ends[0]] && !!hit[ends[1]];
        paint(els.edges[e], !on, false, null);
        if (els.labels[e]) paint(els.labels[e], !on, false, null);
      });
    }
    function refresh() {
      reset();
      var off = hooks.isOff && hooks.isOff();
      var id = off ? null : (selectId || hoverId || focusId);
      var route = off ? null : routeState;
      var found = off ? null : findIds;
      svg.classList.toggle('pa-tracing', !!(id || route || found));
      if (route) paintRoute(route);
      else if (id) paintRelation(id);
      else if (found) paintFind(found);
    }
    // The node or edge id under a pointer or focus target, or null.
    function idAt(target) {
      var el = target && target.closest ? target.closest('.pa-node,.pa-edge,.pa-edge-label') : null;
      if (!el) return null;
      return el.getAttribute('data-id') || el.getAttribute('data-edge');
    }

    // ---- selection, route, find ---------------------------------------------------------------
    function select(id) { selectId = id || null; routeState = null; refresh(); }
    function toggle(id) { select(id && id !== selectId ? id : null); }
    function route(from, to) {
      routeState = PADiagram.route(data, from, to);
      selectId = null;
      refresh();
      return routeState;
    }
    // Node ids whose label holds `text` (case-insensitive), as [{ id, label }]
    // for the Find list (FIND_MAX at most). Sets the filter the canvas shows;
    // empty text, or no match, clears it.
    function find(text) {
      var q = String(text || '').trim().toLowerCase();
      var hits = [];
      if (q) {
        Object.keys(info).forEach(function (id) {
          if (isNode(id) && info[id].label.toLowerCase().indexOf(q) >= 0) hits.push({ id: id, label: info[id].label });
        });
      }
      findIds = hits.length ? hits.map(function (h) { return h.id; }) : null;
      refresh();
      return hits.slice(0, FIND_MAX);
    }
    function findCount() { return findIds ? findIds.length : 0; }
    // What leaves `id` along the arrows and what arrives, as [{ edge, other }]
    // (a two-headed or self edge appears in both lists).
    function links(id) {
      var sends = (directed[id] || []).map(function (e) { return { edge: e, other: otherEnd(e, id) }; });
      var incident = adjacency[id] ? adjacency[id].edges : [];
      var receives = incident.filter(function (e) { return (directed[otherEnd(e, id)] || []).indexOf(e) >= 0; })
        .map(function (e) { return { edge: e, other: otherEnd(e, id) }; });
      return { sends: sends, receives: receives };
    }
    // "1 user", "5 service", ... in order of first appearance, then the stories
    // (when authored) and the beats: what the panel shows while nothing is selected.
    function counts() {
      var order = [];
      var n = PADiagram.dict();
      Object.keys(info).forEach(function (id) {
        if (!isNode(id)) return;
        var k = info[id].kind;
        if (!n[k]) { n[k] = 0; order.push(k); }
        n[k] += 1;
      });
      var out = order.map(function (k) { return n[k] + ' ' + k; });
      var beats = data.beats || [];
      var chapters = data.chapters || [];
      if (beats.length && beats[0].kind !== 'step') out.push(chapters.length + (chapters.length === 1 ? ' story' : ' stories'));
      out.push(beats.length + (beats.length === 1 ? ' beat' : ' beats'));
      return out;
    }

    return {
      refresh: refresh,
      idAt: idAt,
      hover: function (id) { if (id === hoverId) return; hoverId = id; refresh(); },
      focus: function (id) { focusId = id; refresh(); },
      select: select,
      toggle: toggle,
      route: route,
      find: find,
      findCount: findCount,
      links: links,
      counts: counts,
      selected: function () { return selectId; },
      routed: function () { return routeState; },
      active: function () { return selectId || hoverId || focusId; },
      hasFocus: function () { return !!focusId; },
      clear: function () { selectId = null; routeState = null; hoverId = null; refresh(); },
    };
  };
})(window);
