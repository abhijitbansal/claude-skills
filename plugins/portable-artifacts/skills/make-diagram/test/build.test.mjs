import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { MAX_PAGE_BYTES } from '../scripts/lib/viewer.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { LIMITS } from '../scripts/lib/schema.mjs';
import { nearLimitGraph, nearLimitStories, withIcons, withText, largestBrands } from './helpers/limit-specs.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const example = (name) => fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url));
const NAMES = ['architecture', 'flow', 'state', 'sequence'];
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
const MAX = MAX_PAGE_BYTES;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-build-'));
// Every run gets its own PA_OUTPUT_DIR and HOME, so nothing is ever written to the real home.
function run(args, { env = {} } = {}) {
  const dir = tmp();
  const r = spawnSync(process.execPath, [BUILD, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PA_OUTPUT_DIR: path.join(dir, 'default'), HOME: path.join(dir, 'home'), ...env },
  });
  return { ...r, dir };
}
const writeSpec = (obj) => {
  const dir = tmp();
  const file = path.join(dir, 'spec.diagram.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
};
const readOut = (r) => fs.readFileSync(r.stdout.match(/^wrote (.+)$/m)[1], 'utf8');

test('--out file.html writes that file and prints the wrote line, then the file:// URL alone on its own line', () => {
  const dir = tmp();
  const out = path.join(dir, 'nested', 'a.html');
  const r = run([example('flow'), '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `wrote ${out}\n${pathToFileURL(out).href}\n`);
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!doctype html>'));
});

test('--out dir writes <dir>/<slug-of-title>.html', () => {
  const dir = tmp();
  const r = run([example('flow'), '--out', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'password-reset.html')));
});

test('without --out the page goes to $PA_OUTPUT_DIR/<slug>.html, never the real home', () => {
  const r = run([example('state')]);
  assert.equal(r.status, 0, r.stderr);
  const target = path.join(r.dir, 'default', 'order-lifecycle.html');
  assert.ok(fs.existsSync(target));
  assert.equal(r.stdout.match(/^wrote (.+)$/m)[1], target);
  assert.ok(!fs.existsSync(path.join(r.dir, 'home')), 'the fake home stays empty');
});

// A spec copied under the OS temp dir sits outside any git repo, so the default is the home folder (a temp dir here).
const outsideRepo = (name = 'flow') => {
  const file = path.join(tmp(), 'spec.diagram.json');
  fs.copyFileSync(example(name), file);
  return file;
};

test('without --out or PA_OUTPUT_DIR, a spec outside any repo goes to <home>/.agent/diagrams (home is a temp dir here)', () => {
  const dir = tmp();
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };
  delete env.PA_OUTPUT_DIR;
  const r = spawnSync(process.execPath, [BUILD, outsideRepo()], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.agent', 'diagrams', 'password-reset.html')));
});

test('without --out or PA_OUTPUT_DIR, a spec inside a git repo goes to <git root>/.scratch/<slug>.html (PA-07)', () => {
  const home = tmp();
  const repo = tmp();
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'docs'));
  const spec = path.join(repo, 'docs', 'spec.diagram.json');
  fs.copyFileSync(example('flow'), spec);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.PA_OUTPUT_DIR;
  const r = spawnSync(process.execPath, [BUILD, spec], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const target = path.join(repo, '.scratch', 'password-reset.html');
  assert.ok(fs.existsSync(target), r.stdout);
  assert.equal(r.stdout.match(/^wrote (.+)$/m)[1], target);
  assert.ok(!fs.existsSync(path.join(home, '.agent')), 'the home folder stays untouched');
});

test('--json prints { ok, out } on one line', () => {
  const dir = tmp();
  const out = path.join(dir, 'j.html');
  const r = run([example('flow'), '--out', out, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, out });
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
});

test('--theme overrides the spec theme', () => {
  const dir = tmp();
  const r = run([example('flow'), '--out', path.join(dir, 'e.html'), '--theme', 'ink']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'e.html'), 'utf8'), /--font-display:"Bricolage Grotesque"/);
});

test('the default theme is blueprint: Geist display and the kind hues on :root; --theme editorial brings Newsreader back', () => {
  const html = readOut(run([example('flow')]));
  assert.match(html, /--font-display:"Geist"/);
  assert.ok(!html.includes('Newsreader'));
  assert.match(html, /--k-service:#0e7490/);
  const dir = tmp();
  const r = run([example('flow'), '--out', path.join(dir, 'p.html'), '--theme', 'editorial']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'p.html'), 'utf8'), /--font-display:"Newsreader"/);
});

test('an unknown --theme is a spec error (exit 1) with a did-you-mean', () => {
  const r = run([example('flow'), '--theme', 'papr']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^theme: unknown theme "papr"; did you mean "paper"\?/m);
});

test('an invalid spec exits 1, prints path: message lines and writes nothing', () => {
  const file = writeSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'zz' }] });
  const r = run([file]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^edges\[0\]\.to: "zz" not found/m);
  assert.ok(!fs.existsSync(path.join(r.dir, 'default')));
  const j = run([file, '--json']);
  assert.equal(j.status, 1);
  assert.equal(JSON.parse(j.stdout).ok, false);
});

test('usage problems exit 2: no spec, extra spec, unknown flag, missing file, bad JSON', () => {
  for (const args of [[], [example('flow'), example('state')], [example('flow'), '--bogus'], ['/nonexistent/x.json']]) {
    const r = run(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.notEqual(r.stderr, '');
  }
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.json'), '{nope');
  assert.equal(run([path.join(dir, 'bad.json')]).status, 2);
  assert.equal(JSON.parse(run(['--json']).stdout).ok, false);
});

// "A spec that passes is buildable" (schema.md): validateSpec lays out and lints, so a spec
// at every validation limit must also fit the page budget. The worst cases: 60 nodes with
// brand icons and 25 long steps; 60 nodes with emoji or icons, 400-char details and 8 stories;
// the largest icons on every node; and the costliest text characters everywhere.
const [LARGEST] = largestBrands();
const NEAR_LIMIT = [
  ['steps', nearLimitGraph],
  ['stories', nearLimitStories],
  // Brand icons are the page's biggest per-node cost: one icon repeated on every node, and the 60 largest distinct ones.
  ['steps with the largest brand icon on every node', () => withIcons(nearLimitGraph(), [LARGEST])],
  ['stories with the largest brand icon on every node', () => withIcons(nearLimitStories(), [LARGEST])],
  ['steps with the 60 largest distinct brand icons', () => withIcons(nearLimitGraph(), largestBrands().slice(0, LIMITS.nodes))],
  ['stories with the 60 largest distinct brand icons', () => withIcons(nearLimitStories(), largestBrands().slice(0, LIMITS.nodes))],
  // The costliest text: "&" is 5 bytes escaped in the markup and 6 in the data block.
  ['steps with "&" in every text field', () => withText(withIcons(nearLimitGraph(), largestBrands().slice(0, LIMITS.nodes)), '&')],
  ['stories with "&" in every text field', () => withText(withIcons(nearLimitStories(), largestBrands().slice(0, LIMITS.nodes)), '&')],
];
for (const [name, make] of NEAR_LIMIT) {
  test(`a ${name} spec at its validation limits builds within the page budget`, async () => {
    const spec = make();
    assert.deepEqual((await validateSpec(spec, { layout: true })).errors, [], 'the spec passes validation');
    const file = writeSpec(spec);
    const out = path.join(tmp(), 'near-limit.html');
    const result = await build(file, { out });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(Buffer.byteLength(fs.readFileSync(out)) <= MAX, 'within the budget');
  });
}

test('a page over the size limit is an error and writes nothing', async () => {
  const dir = tmp();
  const result = await build(example('flow'), { out: path.join(dir, 'big.html'), maxBytes: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /the page is \d+ KB; the limit is 1 KB/);
  assert.ok(!fs.existsSync(path.join(dir, 'big.html')));
});

for (const name of NAMES) {
  test(`${name}: the page has the exact CSP, stays under the page limit and loads nothing from the network`, () => {
    const r = run([example(name)]);
    assert.equal(r.status, 0, r.stderr);
    const html = readOut(r);
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
    assert.ok(Buffer.byteLength(html) <= MAX, `${Buffer.byteLength(html)} bytes`);
    assert.ok(!/https?:\/\//.test(html.replaceAll('xmlns="http://www.w3.org/2000/svg"', '')), 'the SVG namespace is the only URL');
    assert.ok(!/<link (?!rel="icon" type="image\/svg\+xml" href="data:)|<img |<iframe|src=|@import|url\((?!data:|#)/.test(html));
  });

  test(`${name}: two builds are byte-identical`, () => {
    const env = { SOURCE_DATE_EPOCH: '1792000000' };
    const a = readOut(run([example(name)], { env }));
    assert.equal(readOut(run([example(name)], { env })), a);
  });
}

test('page parts: toolbar, SVG, text alternative, data block and runtime', () => {
  const html = readOut(run([example('architecture')]));
  assert.ok(html.includes('role="group" aria-label="Diagram controls"') && !html.includes('role="toolbar"'), 'a plain group: no roving-tabindex promise');
  for (const hook of ['data-act="fit"', 'data-act="zoom-in"', 'data-act="zoom-out"', 'data-pa-mode="play"', 'data-pa-mode="explore"', 'data-pa-chapters', 'data-pa-line', 'data-pa-scrub', 'data-act="animate"', 'data-export="svg"', 'data-export="png"', 'data-theme-toggle data-mode="auto"', 'data-pa-caption', 'id="pa-stage"', /data-pa-panel[\s>]/, 'data-pa-panel-title', 'data-pa-panel-close', 'data-pa-panel-body', 'data-pa-tip', 'data-pa-find', 'data-pa-found']) {
    assert.ok(typeof hook === 'string' ? html.includes(hook) : hook.test(html), String(hook));
  }
  // W2P-M03: the panel is hidden until something is selected, so an empty state inside it (count chips and the
  // hint) could never be seen. It is gone; the hint rides on the Explore button's title instead.
  assert.doesNotMatch(html, /<[a-z]+ [^>]*data-pa-(empty|tally)/, 'no empty state inside the hidden panel (the runtime still looks the holders up, so test the markup, not the string)');
  assert.match(html, /data-pa-mode="explore"[^>]*title="[^"]*Click a node or edge[^"]*Shift-click a second node[^"]*"/);
  assert.match(html, /<svg [^>]*role="graphics-document"/);
  assert.equal(html.match(/role="graphics-document"/g).length, 1);
  assert.ok(!/role="img"/.test(html.replace(/<section class="sr-only"[\s\S]*?<\/section>/, '')), 'no nested img roles');
  assert.ok(html.includes('window.PADiagram'));
  assert.ok(html.includes('window.paReady = true'));
  const data = JSON.parse(html.match(/<script type="application\/json" id="pa-data">([^<]*)<\/script>/)[1]);
  assert.deepEqual(Object.keys(data).sort(), ['adjacency', 'animate', 'autoplay', 'beats', 'boxes', 'chapters', 'directed', 'drawing', 'edges', 'frames', 'height', 'ids', 'info', 'parents', 'stem', 'steps', 'title', 'type', 'width']);
  assert.deepEqual(data.parents, { vpc: 'aws', api: 'vpc', db: 'vpc' });
  assert.deepEqual(data.adjacency.api.nodes.sort(), ['db', 'pay', 'web']);
  assert.deepEqual(data.edges['edge-0'], ['web', 'api']);
  assert.equal(data.boxes.aws.length, 4);
  assert.equal(data.animate, false);
  assert.equal(data.steps.at(-1).title, 'Everything');
});

test('the data block is exactly buildDiagram().data, and its stem matches the .html slug', async () => {
  const dir = tmp();
  const r = run([example('architecture'), '--out', dir]);
  const html = fs.readFileSync(path.join(dir, 'checkout-request-path.html'), 'utf8');
  const data = JSON.parse(html.match(/id="pa-data">([^<]*)<\/script>/)[1]);
  const { buildDiagram } = await import('../scripts/lib/api.mjs');
  const expected = JSON.parse(JSON.stringify((await buildDiagram(JSON.parse(fs.readFileSync(example('architecture'), 'utf8')))).data));
  assert.deepEqual(data, expected);
  assert.equal(r.status, 0);
  const long = writeSpec({ title: 'A very long title that goes on and on and on and on and on and on past sixty chars', type: 'state', nodes: [{ id: 'a', label: 'A' }] });
  const d2 = tmp();
  run([long, '--out', d2]);
  const [file] = fs.readdirSync(d2);
  const data2 = JSON.parse(fs.readFileSync(path.join(d2, file), 'utf8').match(/id="pa-data">([^<]*)<\/script>/)[1]);
  assert.equal(`${data2.stem}.html`, file);
  assert.ok(data2.stem.length <= 60);
});

test('the text alternative lists nodes by group, edges as "A -> B: label"', () => {
  const html = readOut(run([example('architecture')]));
  const text = html.match(/<section class="sr-only" aria-label="Diagram as text">([\s\S]*?)<\/section>/)[1];
  assert.match(text, /<li>Web app \(client\)<\/li>/);
  assert.match(text, /<li>Group AWS us-east-1<ul><li>Group Private VPC<ul><li>Checkout API \(service\)<\/li><li>Orders DB \(database\): primary \+ replica<\/li><\/ul><\/li><\/ul><\/li>/);
  assert.match(text, /<li>Web app → Checkout API: POST \/checkout<\/li>/);
  assert.match(text, /<li>Web app ↔ Private VPC<\/li>/);
});

test('the text alternative of a sequence lists the messages in order', () => {
  const html = readOut(run([example('sequence')]));
  const text = html.match(/<section class="sr-only" aria-label="Diagram as text">([\s\S]*?)<\/section>/)[1];
  assert.match(text, /<h3>Participants<\/h3><ul><li>Shopper \(actor\)/);
  const order = [...text.matchAll(/<li>([^<]* → [^<]*)<\/li>/g)].map((m) => m[1]);
  assert.equal(order[0], 'Shopper → Web app: press Pay');
  assert.ok(order.length >= 8);
  assert.match(text, /<h3>Frames<\/h3><ul><li>loop until approved: messages 4 to 8<\/li>/);
  const notes = text.match(/<h3>Notes<\/h3><ul>(.*?)<\/ul>/)[1];
  assert.match(notes, /<li>idempotency key sent on every charge \(over [^<]+ and [^<]+, after message 4\)<\/li>/);
  assert.match(notes, /<li>order stays pending until the provider answers \(over [^<]+, after message 3\)<\/li>/);
});

test('hostile text in every field is escaped in the whole page (Review Focus 1)', () => {
  const evil = '<b>&"x"';
  const file = writeSpec({
    title: `T ${evil}`, subtitle: `S ${evil}`, type: 'architecture',
    groups: [{ id: 'g', label: evil }],
    nodes: [{ id: 'a', label: evil, group: 'g', note: evil }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', label: evil }],
    steps: [{ title: evil, note: evil, show: ['a'] }],
  });
  const html = readOut(run([file]));
  assert.ok(!html.includes('<b>'), 'no markup from text');
  assert.ok(html.includes('&lt;b&gt;&amp;&quot;x&quot;'));
  assert.ok(html.includes('<title>T &lt;b&gt;'));
  const data = html.match(/id="pa-data">([^<]*)<\/script>/)[1];
  assert.ok(data.includes('\\u003cb\\u003e'), 'the data block escapes < and >');
  assert.ok(!/<\/script/i.test(data));
});

test('a script-closing sequence in a title cannot end the data block', () => {
  const file = writeSpec({ title: 'x</script><script>alert(1)</script>', type: 'state', nodes: [{ id: 'a', label: 'A' }] });
  const html = readOut(run([file]));
  assert.equal(html.match(/<script/g).length, html.match(/<\/script>/g).length);
  assert.ok(!html.includes('alert(1)</script>'));
});

// ---- PA-26: a built page can be rebuilt, and exported without a browser -----------------------------------------------

const metaOf = (html, name) => (new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html) ?? [])[1];

test('the page records its spec file name, theme and flags in a pa-build meta, so a rebuild command can be derived', () => {
  const file = writeSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] });
  const dir = tmp();
  const r = run([file, '--out', path.join(dir, 'page.html'), '--theme', 'ink']);
  assert.equal(r.status, 0, r.stderr);
  const meta = metaOf(fs.readFileSync(path.join(dir, 'page.html'), 'utf8'), 'pa-build');
  assert.equal(meta, 'spec=spec.diagram.json; theme=ink; out=page.html; flags=--theme ink');
  const plain = run([file]);
  assert.equal(metaOf(readOut(plain), 'pa-build'), 'spec=spec.diagram.json; theme=blueprint; out=t.html; flags=none');
});

test('the build meta carries file names only, never a folder', () => {
  const file = writeSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] });
  const html = readOut(run([file]));
  assert.ok(!metaOf(html, 'pa-build').includes('/'), metaOf(html, 'pa-build'));
});

test('--format svg writes one standalone .svg: theme variables, fonts, the diagram CSS, a surface background and no script', () => {
  const dir = tmp();
  const out = path.join(dir, 'flow.svg');
  const r = run([example('flow'), '--format', 'svg', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `wrote ${out}\n${pathToFileURL(out).href}\n`);
  const svg = fs.readFileSync(out, 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" class="pa-diagram pa-type-flow" viewBox="0 0 686 1106"[^>]* width="686" height="1106">/);
  assert.match(svg, /<style>[^]*@font-face\{font-family:"Geist"/);
  assert.match(svg, /\.pa-diagram\{--page:#[0-9a-f]+;/i);
  assert.match(svg, /<rect width="100%" height="100%" fill="#[0-9a-f]+"\/>/i);
  assert.ok(!/<script|data-pa-legend|href="http/i.test(svg));
  assert.ok(svg.includes('Password reset'));
  assert.ok(Buffer.byteLength(svg) < MAX, 'within the page limit');
});

test('--format svg carries the light palette of ONE theme (the documented limit): the dark values are not in it', () => {
  const dir = tmp();
  const out = path.join(dir, 'ink.svg');
  assert.equal(run([example('flow'), '--format', 'svg', '--theme', 'ink', '--out', out]).status, 0);
  const svg = fs.readFileSync(out, 'utf8');
  const ink = JSON.parse(fs.readFileSync(new URL('../shared/themes/ink.json', import.meta.url), 'utf8'));
  assert.ok(svg.includes(`--page:${ink.light.page}`));
  assert.ok(!svg.includes(`--page:${ink.dark.page}`));
  assert.ok(!/prefers-color-scheme/.test(svg));
});

test('--format svg without --out writes <slug>.svg in the default folder; --out dir gets <slug>.svg', () => {
  const r = run([example('state'), '--format', 'svg']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(r.dir, 'default', 'order-lifecycle.svg')));
  const dir = tmp();
  assert.equal(run([example('state'), '--format', 'svg', '--out', dir]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'order-lifecycle.svg')));
});

test('--format svg --json prints { ok, out } and an unknown format is a usage error listing the accepted ones', () => {
  const dir = tmp();
  const out = path.join(dir, 'j.svg');
  const r = run([example('flow'), '--format', 'svg', '--out', out, '--json']);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, out });
  const bad = run([example('flow'), '--format', 'png']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--format must be one of: html, svg/);
});

test('--format svg: a spec file name with runs of hyphens cannot put "--" inside the XML comment', () => {
  const dir = tmp();
  const file = path.join(dir, 'a---b-.diagram.json');
  fs.copyFileSync(example('flow'), file);
  const out = path.join(dir, 'h.svg');
  const r = run([file, '--format', 'svg', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const svg = fs.readFileSync(out, 'utf8');
  const comments = [...svg.matchAll(/<!--([^]*?)-->/g)].map((m) => m[1]);
  assert.ok(comments.length > 0, 'the build note is there');
  for (const body of comments) assert.ok(!body.includes('--'), `a comment body may not contain "--": ${body}`);
});

test('--format svg still refuses an invalid spec (exit 1) and writes nothing', () => {
  const file = writeSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'zz' }] });
  const r = run([file, '--format', 'svg']);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(path.join(r.dir, 'default')));
});

// ---- warnings reach the builder too (PA-24) -----------------------------------------------------------------------------

test('build prints a spec warning on stderr and still writes the page (exit 0)', () => {
  const file = writeSpec({ title: 'T', type: 'architecture', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }] });
  const r = run([file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^nodes\[2\]: warning: node "c" has no edges/m);
  assert.match(r.stdout, /^wrote /m);
});

test('build --json carries warnings next to ok and out', () => {
  const dir = tmp();
  const file = writeSpec({ title: 'T', type: 'architecture', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }] });
  const out = path.join(dir, 'w.html');
  const body = JSON.parse(run([file, '--json', '--out', out]).stdout);
  assert.equal(body.ok, true);
  assert.equal(body.out, out);
  assert.equal(body.warnings.length, 1);
  assert.equal(body.warnings[0].path, 'nodes[2]');
});

// ---- PA-59: only the font weights the theme has ------------------------------------------------------------------------

const THEME_NAMES = fs.readdirSync(new URL('../shared/themes', import.meta.url)).map((f) => f.replace(/\.json$/, ''));
const weightsOf = (name) => {
  const html = readOut(run([example('flow'), '--theme', name]));
  return { display: Number(/--display-weight:(\d+)/.exec(html)?.[1]), strong: Number(/--strong-weight:(\d+)/.exec(html)?.[1]) };
};

test('the viewer template asks for no literal font weight: every weight comes from a theme-derived token', () => {
  const html = fs.readFileSync(new URL('../template/viewer.html', import.meta.url), 'utf8');
  const literal = [...html.matchAll(/font(?:-weight)?:\s*(\d{3})\b/g)].map((m) => m[0]);
  assert.deepEqual(literal, [], 'a literal weight is requested whether or not the theme has it');
});

for (const name of THEME_NAMES) {
  test(`theme ${name}: the display and strong weights the page asks for exist in the theme's font map`, () => {
    const theme = JSON.parse(fs.readFileSync(new URL(`../shared/themes/${name}.json`, import.meta.url), 'utf8'));
    const { display, strong } = weightsOf(name);
    assert.ok(Object.keys(theme.fonts.display.weights).map(Number).includes(display), `${name}: display weight ${display}`);
    assert.ok(Object.keys(theme.fonts.body.weights).map(Number).includes(strong), `${name}: strong weight ${strong}`);
  });
}

test('press draws its Young Serif display at 400, the only weight it ships (no synthesised bold)', () => {
  assert.equal(weightsOf('press').display, 400);
  assert.equal(weightsOf('blueprint').display, 600);
});
