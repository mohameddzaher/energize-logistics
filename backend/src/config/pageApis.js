/**
 * Map of which pages call each endpoint; turns page permission into a guard, since hiding a screen did not protect the data. The question is reversed: which pages call this endpoint? If all are closed for the role, the endpoint is closed.
 * Rules: 1) longest matching prefix wins; 2) allow if any page at that length is open; 3) allow if the role has an open broad page its section covers (doubt widens); 4) unknown endpoints pass.
 * The guard only narrows within what the section granted.
 */
const { shell, pages } = require('./pageApis.json');
const { SECTIONS } = require('./sections');
const { getPage } = require('./pages');

const SHELL = shell.slice().sort((a, b) => b.length - a.length);

/** Endpoint called by the shell on every screen; not attributed to a page and not closed with it. */
const isShell = (path) => SHELL.some((p) => path === p || path.startsWith(`${p}/`));

// Prefix to the pages that call it, ordered longest to shortest.
const index = new Map();
for (const [key, def] of Object.entries(pages)) {
  for (const api of def.apis || []) {
    if (!index.has(api)) index.set(api, new Set());
    index.get(api).add(key);
  }
}
const PREFIXES = [...index.keys()].sort((a, b) => b.length - a.length);

// Broad pages and their sections; for rule 3.
const sectionPrefixes = Object.fromEntries(SECTIONS.map((s) => [s.key, s.apiPrefixes]));
const WILDCARD_PAGES = Object.entries(pages)
  .filter(([, d]) => d.wildcard)
  .map(([key]) => ({ key, prefixes: sectionPrefixes[getPage(key)?.section] || [] }));

const matches = (prefix, path) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);

/**
 * The guard's decision for this endpoint.
 * `allowed(pageKey)` answers whether that page is open for this role.
 * Returns `null` when the map has no opinion (passes as before), or `{ ok, pages }`.
 */
function decide(path, allowed) {
  if (isShell(path)) return null;

  const longest = PREFIXES.find((p) => matches(p, path));
  if (!longest) return null;

  const owners = [...index.get(longest)];
  if (owners.some((k) => allowed(k))) return { ok: true, prefix: longest, pages: owners };

  // A broad page open in a section that covers this endpoint: its calls were not read, so it is not blocked.
  const wide = WILDCARD_PAGES.find((w) => allowed(w.key) && w.prefixes.some((p) => matches(p, path)));
  if (wide) return { ok: true, prefix: longest, pages: [wide.key], widened: true };

  return { ok: false, prefix: longest, pages: owners };
}

module.exports = { decide, isShell, SHELL, PREFIXES };
