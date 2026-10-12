#!/usr/bin/env node
// Dev only. Regenerates icons/lucide.json and icons/brands.json from the pinned
// devDependencies lucide-static and simple-icons. Run from skills/make-diagram
// after `npm install`:
//   node scripts/dev/build-icons.mjs
// Outputs are committed; nothing at run time needs either package.
//   - A curated Lucide name missing from the installed version fails the run
//     (exit 1) and lists every missing name: Lucide renames icons across versions.
//   - A curated Simple Icons slug missing upstream is reported and skipped
//     (brands get removed over time), so the catalog is whatever exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const words = (s) => s.split(/\s+/).filter(Boolean);

export const LUCIDE_NAMES = words(`
  server server-cog database database-zap database-backup hard-drive hard-drive-download hard-drive-upload cloud cloud-cog cloud-off
  cloud-upload cloud-download cpu memory-stick network router globe globe-lock shield shield-check shield-alert shield-half lock lock-open
  lock-keyhole key key-round users users-round user user-round user-check user-cog circle-user id-card monitor monitor-smartphone smartphone
  laptop tablet tv watch headphones keyboard mouse usb bluetooth wifi ethernet-port cable plug power battery satellite radio-tower antenna
  table file files file-text file-code file-braces file-input file-output file-lock folder folder-open folder-tree archive layers list
  list-ordered list-checks list-tree funnel search git-branch git-commit-horizontal git-merge git-pull-request git-fork git-compare
  clipboard clipboard-list book book-open notebook sheet columns-3 rows-3 grid-3x3 layout-dashboard tag tags hash binary regex
  mail mails message-square message-circle messages-square bell bell-ring inbox send rss radio megaphone phone at-sign webhook
  box boxes package container square-function terminal square-terminal code code-xml braces bot brain brain-circuit sparkles cog settings-2
  workflow blocks puzzle component bug rocket hammer wand-sparkles variable
  play pause square circle check x triangle-alert octagon-alert circle-check circle-x circle-question-mark circle-dot circle-play circle-pause
  circle-stop info clock timer hourglass alarm-clock repeat repeat-2 refresh-cw rotate-ccw undo-2 redo-2 arrow-right arrow-left arrow-up
  arrow-down arrow-right-left arrow-left-right corner-down-right split merge shuffle route signpost milestone flag ban diamond hexagon
  triangle toggle-left toggle-right step-forward skip-forward
  credit-card wallet receipt shopping-cart shopping-bag store banknote coins dollar-sign circle-dollar-sign piggy-bank landmark percent
  hand-coins handshake
  settings wrench gauge chart-bar chart-line chart-pie chart-area activity trending-up trending-down map map-pin compass calendar
  calendar-clock image video mic camera zap bookmark link external-link eye eye-off download upload printer scan scan-line qr-code
  fingerprint-pattern building building-complex factory warehouse school hospital house truck plane car bus train-front ship bike leaf sun moon flame
  droplet snowflake wind umbrella star heart thumbs-up award trophy gift lightbulb magnet microscope flask-conical test-tube
  graduation-cap newspaper clapperboard music film gamepad-2 palette pen pencil trash copy scissors paperclip save share-2 log-in
  log-out rotate-ccw-clock languages badge-check scale gavel siren radar vote ticket mouse-pointer-click hand maximize minimize expand zoom-in
  door-open sliders-horizontal bolt cctv anchor cookie crown dices
`);

export const BRAND_SLUGS = words(`
  postgresql mysql sqlite mongodb redis mariadb clickhouse neo4j influxdb apachecassandra elasticsearch snowflake duckdb databricks
  apachespark apacheairflow apachekafka rabbitmq apachepulsar mqtt temporal
  docker kubernetes helm githubactions github gitlab bitbucket git jenkins circleci argo
  nginx caddy envoyproxy istio cloudflare cloudflareworkers cloudflarepages fastly
  vercel netlify googlecloud googlecloudstorage googlebigquery firebase supabase digitalocean hetzner flydotio railway render
  stripe discord telegram whatsapp mailgun resend
  anthropic huggingface pytorch tensorflow googlegemini
  nodedotjs deno bun python go rust swift kotlin typescript javascript ruby php cplusplus c dotnet openjdk
  react nextdotjs vuedotjs svelte angular vite webpack esbuild babel
  express fastapi django flask spring springboot rubyonrails laravel nestjs graphql prisma
  apple android ios linux ubuntu flutter electron
  grafana prometheus datadog sentry newrelic splunk opentelemetry jaeger pagerduty
  terraform ansible pulumi vault consul
  auth0 okta clerk keycloak
  notion linear jira confluence figma postman swagger
  npm yarn pnpm eslint prettier jest vitest cypress
  wireguard openvpn tailscale minio traefikproxy
  google meta
`);

// Lucide ships only these geometric tags / attributes. Anything else is dropped,
// so a hostile or surprising upstream release can never smuggle markup in.
const ALLOWED_TAGS = new Set(['path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'ellipse']);
const ALLOWED_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points']);

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// [[tag, attrs], ...] (lucide-static icon-nodes.json) -> inner SVG markup.
// `fill` survives only as "currentColor" (Lucide's filled dots); class, style,
// id, href, xlink:href, key and every on* handler are never copied.
export function sanitizeNodes(nodes) {
  let out = '';
  for (const [tag, attrs] of nodes) {
    if (!ALLOWED_TAGS.has(tag)) continue;
    let el = `<${tag}`;
    for (const [name, value] of Object.entries(attrs)) {
      if (ALLOWED_ATTRS.has(name) || (name === 'fill' && value === 'currentColor')) el += ` ${name}="${escapeAttr(value)}"`;
    }
    out += `${el}/>`;
  }
  return out;
}

// Split curated names into those the installed version has and those it lost.
export function resolveCurated(curated, available) {
  const seen = new Set();
  const found = [];
  const missing = [];
  for (const name of curated) {
    if (seen.has(name)) continue;
    seen.add(name);
    (name in available ? found : missing).push(name);
  }
  return { found, missing };
}

const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// One Simple Icons SVG -> { title, path }, or null when it is not a single plain path.
export function brandEntry(svg) {
  const title = /<title>([^<]*)<\/title>/.exec(svg);
  const paths = [...svg.matchAll(/<path\s+d="([^"]+)"\s*\/>/g)];
  if (!title || paths.length !== 1) return null;
  return { title: decodeEntities(title[1]), path: paths[0][1] };
}

// One entry per line keeps diffs reviewable.
function serialize(version, entries) {
  const body = Object.keys(entries).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(entries[k])}`);
  return `{"version":${JSON.stringify(version)},"icons":{\n${body.join(',\n')}\n}}\n`;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function buildLucide() {
  const dir = path.join(ROOT, 'node_modules/lucide-static');
  const version = readJson(path.join(dir, 'package.json')).version;
  const nodes = readJson(path.join(dir, 'icon-nodes.json'));
  const { found, missing } = resolveCurated(LUCIDE_NAMES, nodes);
  if (missing.length) {
    process.stderr.write(`lucide-static ${version} has no icon named: ${missing.join(', ')}\nFix the names in LUCIDE_NAMES (Lucide renames icons between versions).\n`);
    return false;
  }
  const entries = Object.fromEntries(found.map((n) => [n, sanitizeNodes(nodes[n])]));
  fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'icons/lucide.json'), serialize(version, entries));
  process.stdout.write(`lucide ${version}: ${found.length} icons\n`);
  return true;
}

function buildBrands() {
  const dir = path.join(ROOT, 'node_modules/simple-icons');
  const version = readJson(path.join(dir, 'package.json')).version;
  const entries = {};
  const skipped = [];
  for (const slug of new Set(BRAND_SLUGS)) {
    const file = path.join(dir, 'icons', `${slug}.svg`);
    const entry = fs.existsSync(file) ? brandEntry(fs.readFileSync(file, 'utf8')) : null;
    if (entry) entries[slug] = entry;
    else skipped.push(slug);
  }
  fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'icons/brands.json'), serialize(version, entries));
  process.stdout.write(`simple-icons ${version}: ${Object.keys(entries).length} brands\n`);
  if (skipped.length) process.stdout.write(`skipped (missing upstream): ${skipped.join(', ')}\n`);
}

function main() {
  const ok = buildLucide();
  buildBrands();
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
