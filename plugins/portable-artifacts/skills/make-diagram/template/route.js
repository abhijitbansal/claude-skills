// make-diagram viewer, route: the shortest path between two ids over the page
// data, for Explore's shift-click. Pure (no DOM), so a Node test can load it
// with a bare `window`. Registered as PADiagram.route; camera.js, which defines
// PADiagram.dict, comes before it in the bundle (scripts/lib/runtime.mjs).
//
//   var r = PADiagram.route(data, from, to);
//   // -> { from, to, hops: [{ edge, from, to }], directed }; hops is [] when nothing joins them
//
// The first pass walks data.directed (the edges leaving an id along the arrow;
// a two-headed edge leaves both ends). When that reaches nothing, a second pass
// walks data.adjacency ignoring direction and reports directed: false. Groups
// are vertices like nodes: an edge ending at a group reaches the group, and the
// group's own edges carry on from there. A self edge never counts as a hop.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  // Breadth-first from `from` to `to`; next(id) lists the edge ids that may be
  // walked from id. Returns the hops in order, or null when `to` is unreachable.
  function search(from, to, edges, next) {
    var prev = PADiagram.dict(); // id -> { at, edge } that reached it first
    var seen = PADiagram.dict();
    seen[from] = true;
    var queue = [from];
    while (queue.length) {
      var at = queue.shift();
      if (at === to) break;
      var out = next(at);
      for (var i = 0; i < out.length; i++) {
        var ends = edges[out[i]];
        if (!ends) continue;
        var other = ends[0] === at ? ends[1] : ends[0];
        if (seen[other]) continue;
        seen[other] = true;
        prev[other] = { at: at, edge: out[i] };
        queue.push(other);
      }
    }
    if (!seen[to]) return null;
    var hops = [];
    for (var id = to; id !== from; id = prev[id].at) hops.unshift({ edge: prev[id].edge, from: prev[id].at, to: id });
    return hops;
  }

  PADiagram.route = function (data, from, to) {
    var edges = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var adjacency = PADiagram.dict(data.adjacency);
    var along = function (id) { return directed[id] || []; };
    var any = function (id) { return adjacency[id] ? adjacency[id].edges : []; };
    var hops = search(from, to, edges, along);
    if (hops) return { from: from, to: to, hops: hops, directed: true };
    hops = search(from, to, edges, any);
    return { from: from, to: to, hops: hops || [], directed: false };
  };
})(window);
