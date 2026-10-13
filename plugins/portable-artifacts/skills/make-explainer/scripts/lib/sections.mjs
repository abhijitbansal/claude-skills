// The section registry: type -> { render(section, ctx) -> string, ownHeading?,
// assets?(section, ctx) -> Promise<{ from, to }[]>, prepare?(section, ctx, i) -> Promise<void>, page?(ctx) -> { css, js: string[] }, check? }.
// `page` is called once when the type is present and its css/scripts are shipped once for the whole page. A section type
// with no entry has no renderer yet; buildPage reports it as an error.
// ctx = { theme, dir, outDir, assetsDir, slug, mode, idFor(section, i), icons }.
import * as tldr from './render/tldr.mjs';
import * as text from './render/text.mjs';
import * as kpis from './render/kpis.mjs';
import * as cards from './render/cards.mjs';
import * as table from './render/table.mjs';
import * as risks from './render/risks.mjs';
import * as files from './render/files.mjs';
import * as steps from './render/steps.mjs';
import * as timeline from './render/timeline.mjs';
import * as compare from './render/compare.mjs';
import * as callout from './render/callout.mjs';
import * as code from './render/code.mjs';
import * as details from './render/details.mjs';
import * as image from './render/image.mjs';
import * as checklist from './render/checklist.mjs';
import * as diagram from './render/diagram.mjs';
import * as chart from './render/chart.mjs';

const MODULES = { tldr, text, kpis, cards, table, risks, files, steps, timeline, compare, callout, code, details, image, checklist, diagram, chart };

export const SECTIONS = Object.freeze(Object.fromEntries(
  Object.entries(MODULES).map(([type, m]) => [type, Object.freeze({ render: m.render, ownHeading: m.ownHeading === true, assets: m.assets, prepare: m.prepare, page: m.page, check: m.check })]),
));
