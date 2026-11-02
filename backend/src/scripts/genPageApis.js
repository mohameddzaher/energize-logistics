/**
 * genPageApis: which API endpoints each page calls. --check verifies without writing.
 * A page permission hid the screen but did not guard data. The map is built from the code (each route's page, its local imports, its /api/ calls) since a hand-written one goes stale silently; an endpoint is closed to a role only if every page calling it is closed to it.
 * Doubt widens, never narrows: anything not statically readable opens the page to its whole section.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const APP = path.join(SRC, 'app', 'system');
const OUT = path.join(__dirname, '..', 'config', 'pageApis.json');
const CHECK = process.argv.includes('--check');

const { PAGES } = require('../config/pages');
const { SECTIONS } = require('../config/sections');

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Resolves an import to a real file path (@/x, ./x or ../x). */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // External package
  const tries = ['.tsx', '.ts', '/index.tsx', '/index.ts', ''];
  for (const t of tries) {
    const p = base + t;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Names imported from each file in the tree.
 * Names, not files: a page importing money from lib/vehicleRegistry does not call every endpoint in that file. Taking the whole file makes every page in a section call everything, so closing a page would affect no endpoint and the guard would mean nothing.
 * lib/ files are limited to the names imported; components and hooks are taken whole, since importing them imports all their behavior.
 */
function fileClosure(entry) {
  const seen = new Map(); // file to the set of names imported from it (null means the whole file)
  const stack = [[entry, null]];
  while (stack.length) {
    const [f, names] = stack.pop();
    if (!f) continue;
    const prev = seen.get(f);
    if (prev === null) { /* Already taken whole */ }
    else if (names === null) seen.set(f, null);
    else {
      const merged = new Set(prev || []);
      names.forEach((n) => merged.add(n));
      if (prev && [...merged].length === prev.size) continue; // Nothing new
      seen.set(f, merged);
    }
    if (prev !== undefined && prev === null) continue;

    const src = read(f);
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const clause = m[1];
      const r = resolveImport(m[2], f);
      if (!r) continue;
      // import { a, b as c } gives names; import X or * as X gives the whole file.
      const braced = clause.match(/\{([^}]*)\}/);
      const hasDefaultOrStar = /^[^{]*[A-Za-z_$]/.test(clause.split('{')[0].trim()) || clause.includes('* as');
      const named = braced
        ? braced[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim()).filter(Boolean)
        : [];
      stack.push([r, hasDefaultOrStar || !braced ? null : named]);
    }
    for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)) {
      const r = resolveImport(m[1], f);
      if (r) stack.push([r, null]);
    }
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
      const r = resolveImport(m[1], f);
      if (r) stack.push([r, null]);
    }
  }
  return seen;
}

/**
 * Source text of the names requested from a lib file, plus whatever sits outside any export.
 * Code outside exports runs on import, so it is always taken.
 */
function scopedSource(file, names) {
  const src = read(file);
  if (!names || !/\/lib\//.test(file.replace(/\\/g, '/'))) return src;

  const rx = /export\s+(?:const|let|var|function|async function)\s+([A-Za-z0-9_$]+)/g;
  const marks = [];
  for (const m of rx.exec.length ? src.matchAll(rx) : []) marks.push({ name: m[1], at: m.index });
  if (!marks.length) return src;

  let outside = '';
  let prevEnd = 0;
  const wanted = [];
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    outside += src.slice(prevEnd, mk.at);
    prevEnd = end;
    if (names.has(mk.name)) wanted.push(src.slice(mk.at, end));
  });
  outside += src.slice(prevEnd);
  return outside + wanted.join('\n');
}

/**
 * API endpoints in a file's text.
 * Cut at the first part not statically known: ?, ${ or end of text. A template ending in an id variable reads as the endpoint base, which is the correct prefix because the guard matches by prefix.
 */
function apisIn(src) {
  const out = new Set();
  let wildcard = false;
  for (const m of src.matchAll(/['"`]\/api\/([^'"`]*)/g)) {
    const rest = m[1];
    // An API call whose destination is a variable is unknown: the page is widened to its section.
    if (rest.startsWith('$')) { wildcard = true; continue; }
    const cut = rest.split(/[?#]/)[0].split('${')[0];
    const clean = cut.replace(/\/+$/, '');
    if (!clean) { wildcard = true; continue; }
    out.add(`/api/${clean}`);
  }
  return { apis: [...out], wildcard };
}

// Endpoints the frame itself calls, not any specific page.
// The sidebar and header run on every screen: login, notifications and reference lists read in every form. Closing them by closing one page would stop the whole system.
const SHELL_ENTRIES = [
  path.join(APP, 'layout.tsx'),
  path.join(SRC, 'context', 'AuthContext.tsx'),
  path.join(SRC, 'components', 'system', 'DialogProvider.tsx'),
];

function build() {
  // The frame counts only its own files, not everything it imports.
  // The sidebar imports lib/businessReview and lib/fleet to decide who sees which link. Taking its whole tree made business-review and fleet endpoints frame endpoints, open to everyone without a guard.
  const shell = new Set(['/api/auth', '/api/notifications', '/api/lookups', '/api/uploads', '/api/portal/me']);
  for (const e of SHELL_ENTRIES) {
    apisIn(read(e)).apis.forEach((a) => shell.add(a));
  }

  const sectionPrefixes = Object.fromEntries(SECTIONS.map((s) => [s.key, s.apiPrefixes]));
  const pages = {};
  let unresolved = 0;

  // A screen opened by a button is a page too.
  // The sidebar lists only clickable entries, but create-shipment and vehicle details are full screens opened from inside their page by a button. Their calls were attributed to no page, and an endpoint the map attributes to no page the role owns returns 403.
  // This happened: a fleet supervisor opening create-shipment got an empty branch list, because the branches endpoint was attributed to pages he does not own while his own page calls it.
  // So sub-screens join their parent page: every page.tsx under its folder that is not itself a catalogue page. Whoever opens the parent opens what opens from it.
  const pageKeys = new Set(PAGES.map((x) => x.key));
  const subPages = (dir) => {
    const out = [];
    const walk = (d, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const childRel = `${rel}/${e.name}`;
        const childFile = path.join(d, e.name, 'page.tsx');
        // A screen with its own catalogue entry counts for itself, not its parent.
        if (!pageKeys.has(`/system${childRel}`) && fs.existsSync(childFile)) out.push(childFile);
        walk(path.join(d, e.name), childRel);
      }
    };
    walk(dir, dir.slice(APP.length).replace(/\\/g, '/'));
    return out;
  };

  // A screen opened from a page that is not above its folder.
  // The customer/supplier file (collections-dept/parties/[id]) opens from the customers and suppliers pages, but its folder is under neither, so subPages does not include it. Its calls (including invoice attachments) returned 403 for a role owning only those two pages.
  const OPENED_FROM = {
    '/system/collections-dept/customers': ['collections-dept/parties'],
    '/system/collections-dept/suppliers': ['collections-dept/parties'],
    // Receivables details is a sub-screen of the dashboard (dashboard/receivables) and also opens from the cases page, so a role owning only cases can read its rows without a 403.
    '/system/collections-dept/cases': ['collections-dept/dashboard'],
  };

  for (const p of PAGES) {
    // Page path to its file. A parametrized path (such as [id]) maps to the folder with that name.
    const rel = p.key.replace(/^\/system\/?/, '');
    const file = path.join(APP, rel, 'page.tsx');
    if (!fs.existsSync(file)) { pages[p.key] = { apis: [], wildcard: true }; unresolved += 1; continue; }

    const apis = new Set();
    let wildcard = false;
    const entries = [file, ...subPages(path.join(APP, rel)), ...(OPENED_FROM[p.key] || []).flatMap((d) => subPages(path.join(APP, d)))];
    for (const entry of entries) {
      for (const [f, names] of fileClosure(entry)) {
        const got = apisIn(scopedSource(f, names));
        got.apis.forEach((a) => apis.add(a));
        if (got.wildcard) wildcard = true;
      }
    }
    // Frame endpoints are not attributed to the page, otherwise every page would open everything.
    const own = [...apis].filter((a) => !shell.has(a));
    // Doubt widens: a call not statically readable opens the page to its section's prefixes.
    if (wildcard) (sectionPrefixes[p.section] || []).forEach((x) => own.push(x));
    pages[p.key] = { apis: [...new Set(own)].sort(), wildcard };
  }

  return { shell: [...shell].sort(), pages, unresolved };
}

const built = build();
const payload = `${JSON.stringify({
  generatedFrom: 'frontend/src/app/system/**/page.tsx (+ its local imports)',
  shell: built.shell,
  pages: built.pages,
}, null, 2)}\n`;

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== payload) {
    console.error('خريطةُ نقاط الصفحات متأخّرة — شغّل: node backend/src/scripts/genPageApis.js');
    process.exit(1);
  }
  console.log('خريطةُ نقاط الصفحات محدَّثة.');
  process.exit(0);
}

fs.writeFileSync(OUT, payload);
const withApis = Object.values(built.pages).filter((v) => v.apis.length).length;
const wild = Object.values(built.pages).filter((v) => v.wildcard).length;
console.log(`كُتب ${OUT}`);
console.log(`${Object.keys(built.pages).length} صفحة · ${withApis} لها نقاطٌ معروفة · ${wild} موسَّعةٌ إلى قسمها · ${built.shell.length} نقطةَ إطار`);
if (built.unresolved) console.log(`لم يُعثر على ملفّ ${built.unresolved} صفحة (وُسِّعت إلى قسمها)`);
