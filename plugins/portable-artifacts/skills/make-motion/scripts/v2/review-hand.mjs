// The drawing hand's findings for a film review (looks-four Task 12, the carry-over from the spike): in a look with `hand`
// data every shot's stroke plan is judged where the real glyphs are measured, in the page: the hand drawing faster than
// look.hand.maxSpeed (creative), over a finished text for more than 0.3 s or crossing the frame's top or left edge
// (mechanical). The page rebuilds each shot's nodes as the stage does, then engine/hand/index.mjs handFindings judges
// them (engine/hand/index.mjs). Nothing for a look without a hand. Each finding takes the review's shape
// ({ kind, shot, path, t, rule, node, message }), t on the film's timeline.
import { registries } from '../../engine/registry.mjs';

const DEFAULT_MODE = 'pro';
const INK_UP = 0.74; // em above the baseline a written line's ink reaches (capitals)
const INK_DOWN = 0.22; // em below it (descenders)

const lookNameOf = (film) => film.look ?? registries.modes.get(film.mode ?? DEFAULT_MODE).defaultLook;

// Runs in the page: every shot's hand findings as [{ shot, kind, rule, node, t, message }], t in shot seconds.
async function inPage([film, inkUp, inkDown, pictures]) {
  const { buildTimeline } = await import('/engine/script/timing.mjs');
  const { shotContext } = await import('/engine/graph/film.mjs');
  const { registries: regs } = await import('/engine/registry.mjs');
  const { kindContext } = await import('/engine/captions/index.mjs');
  const { createMeasure } = await import('/engine/page/text-style.mjs');
  const { handPlan, handFindings } = await import('/engine/hand/index.mjs');
  const timeline = buildTimeline(film, { fps: film.fps });
  // what the stage built the film from: the loaded pictures' sizes and the film's prepared data (maps), which the stage
  // kept from its own load of the film (engine/page/stage.mjs window.__prepared), so this makes no request of its own
  const prepared = window.__prepared ?? {};
  const assets = new Map(Object.entries(pictures).map(([src, [width, height]]) => [src, { width, height }]));
  const measure = createMeasure(document.createElement('canvas').getContext('2d'));
  const stage = document.getElementById('stage');
  const canvas = { w: stage.width, h: stage.height };
  return film.shots.flatMap((shot, index) => {
    const ctx = shotContext({ film, index, timeline, canvas, measure, assets, prepared });
    if (!ctx.look.hand) return [];
    const kind = regs.kinds.get(shot.show);
    const raw = kind.expand(shot, kindContext(film, kind, ctx)).nodes;
    const { nodes, plan, set, rest } = handPlan(raw, timeline.shots[index], ctx);
    const writes = plan.filter((s) => s.kind === 'write');
    const setAt = new Map(set.map((s) => [s.node, s.at]));
    const texts = nodes.filter((n) => n.type === 'text' && n.props.layout).flatMap((n) => n.props.layout.lines.map((line, k) => {
      const size = n.props.font.size;
      const stroke = writes.find((s) => s.node === n.id && s.line === k) ?? writes.find((s) => s.node === n.id);
      return { id: n.id, box: [n.props.x + line.x, n.props.y + line.y - inkUp * size, line.width, (inkUp + inkDown) * size], done: stroke ? stroke.end : (setAt.get(n.id) ?? 0) };
    }));
    return handFindings(plan, ctx.look, texts, { canvas, unit: ctx.unit, duration: timeline.shots[index].duration, rest }).map((f) => ({ ...f, shot: shot.id, index }));
  });
}

/** The hand findings of a film in a hand look ([] for any other look), in the review's shape. `session`: { film, timeline, page }. */
export async function handReviewFindings(session) {
  const { film, timeline, page } = session;
  if (registries.looks.get(lookNameOf(film)).hand === undefined) return [];
  const found = await page.evaluate(inPage, [film, INK_UP, INK_DOWN, session.info?.pictures ?? {}]);
  return found.map((f) => ({ kind: f.kind, shot: f.shot, path: `shots[${f.index}]`, t: timeline.shots[f.index].start + f.t, rule: f.rule, node: f.node, message: f.message }));
}
