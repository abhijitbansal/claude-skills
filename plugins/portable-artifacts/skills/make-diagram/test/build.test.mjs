import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const example = (name) => fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url));
const NAMES = ['architecture', 'flow', 'state', 'sequence'];
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
const MAX = 400 * 1024;

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

test('--out file.html writes that file and prints wrote + open lines', () => {
  const dir = tmp();
  const out = path.join(dir, 'nested', 'a.html');
  const r = run([example('flow'), '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `wrote ${out}\nopen: ${pathToFileURL(out).href}\n`);
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

test('without --out or PA_OUTPUT_DIR the default is <home>/.agent/diagrams (home is a temp dir here)', () => {
  const dir = tmp();
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };
  delete env.PA_OUTPUT_DIR;
  const r = spawnSync(process.execPath, [BUILD, example('flow')], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.agent', 'diagrams', 'password-reset.html')));
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
  const r = run([example('flow'), '--out', path.join(dir, 'e.html'), '--theme', 'editorial']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'e.html'), 'utf8'), /--font-display:"Bricolage Grotesque"/);
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

test('a page over the size limit is an error and writes nothing', async () => {
  const dir = tmp();
  const result = await build(example('flow'), { out: path.join(dir, 'big.html'), maxBytes: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /the page is \d+ KB; the limit is 1 KB/);
  assert.ok(!fs.existsSync(path.join(dir, 'big.html')));
});

for (const name of NAMES) {
  test(`${name}: the page has the exact CSP, stays under 400 KB and loads nothing from the network`, () => {
    const r = run([example(name)]);
    assert.equal(r.status, 0, r.stderr);
    const html = readOut(r);
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
    assert.ok(Buffer.byteLength(html) <= MAX, `${Buffer.byteLength(html)} bytes`);
    assert.ok(!/https?:\/\//.test(html.replace('xmlns="http://www.w3.org/2000/svg"', '')), 'the SVG namespace is the only URL');
    assert.ok(!/<link |<img |<iframe|src=|@import|url\((?!data:|#)/.test(html));
  });

  test(`${name}: two builds are byte-identical`, () => {
    const a = readOut(run([example(name)]));
    assert.equal(readOut(run([example(name)])), a);
  });
}

test('page parts: toolbar, SVG, text alternative, data block and runtime', () => {
  const html = readOut(run([example('architecture')]));
  assert.ok(html.includes('role="group" aria-label="Diagram controls"') && !html.includes('role="toolbar"'), 'a plain group: no roving-tabindex promise');
  for (const hook of ['data-act="fit"', 'data-act="zoom-in"', 'data-act="zoom-out"', 'data-act="present"', 'data-act="animate"', 'data-export="svg"', 'data-export="png"', 'data-theme-toggle aria-label="Theme: Auto. Change theme">Theme: Auto</button>', 'data-pa-caption', 'id="pa-stage"']) {
    assert.ok(html.includes(hook), hook);
  }
  assert.match(html, /<svg [^>]*role="graphics-document"/);
  assert.equal(html.match(/role="graphics-document"/g).length, 1);
  assert.ok(!/role="img"/.test(html.replace(/<section class="sr-only"[\s\S]*?<\/section>/, '')), 'no nested img roles');
  assert.ok(html.includes('window.PADiagram'));
  assert.ok(html.includes('window.paReady = true'));
  const data = JSON.parse(html.match(/<script type="application\/json" id="pa-data">([^<]*)<\/script>/)[1]);
  assert.deepEqual(Object.keys(data).sort(), ['adjacency', 'animate', 'boxes', 'edges', 'frames', 'height', 'ids', 'parents', 'stem', 'steps', 'title', 'type', 'width']);
  assert.deepEqual(data.parents, { vpc: 'aws', api: 'vpc', db: 'vpc' });
  assert.deepEqual(data.adjacency.api.nodes.sort(), ['db', 'pay', 'web']);
  assert.deepEqual(data.edges.e0, ['web', 'api']);
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
