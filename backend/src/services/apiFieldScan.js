/**
 * Fields of every route in the docs, read from the code itself when the document is opened.
 * Routes were read from the router (services/apiDocs) but what is sent to them, list filters and save fields, was not documented, and hand-writing it ages within a week.
 * Sources, in order: 1) express-validator rules on the route (field, location, optional), the most precise since they are written as conditions; 2) the source of the handler function (fn.toString(), the code actually running): req.query.x, req.body?.x, req.query['x'], destructuring from req.query, aliases like const q = req.query || {}, pick(req.body, EDITABLE) with the list read from the controller file, and helper functions like resolvePeriod(req.query) read from the file, one level deep.
 * What cannot be read this way (a field passed through many layers) is not guessed: the document states what the code shows.
 */
const fs = require('fs');

const IDENT = '[A-Za-z_$][\\w$]*';
// Names read after the dot that are not fields.
const NOT_FIELDS = new Set(['hasOwnProperty', 'toString', 'length', 'constructor', 'valueOf', 'keys', 'map', 'filter', 'forEach']);

// Source text of each exported function's file, to read lists and helper functions.
let fileIndex = null;
let fileIndexSize = -1;
const textCache = new Map();

function buildFileIndex() {
  const keys = Object.keys(require.cache);
  if (fileIndex && keys.length === fileIndexSize) return fileIndex;
  fileIndex = new Map();
  fileIndexSize = keys.length;
  for (const filename of keys) {
    if (!/\/src\/(controllers|routes|services)\//.test(filename)) continue;
    const ex = require.cache[filename] && require.cache[filename].exports;
    if (!ex) continue;
    const visit = (v) => { if (typeof v === 'function' && !fileIndex.has(v)) fileIndex.set(v, filename); };
    visit(ex);
    if (typeof ex === 'object' || typeof ex === 'function') {
      for (const k of Object.keys(ex)) { try { visit(ex[k]); } catch (_) { /* getter */ } }
    }
  }
  return fileIndex;
}

function textOf(filename) {
  if (!filename) return '';
  if (textCache.has(filename)) return textCache.get(filename);
  let t = '';
  try { t = fs.readFileSync(filename, 'utf8'); } catch (_) { /* */ }
  textCache.set(filename, t);
  return t;
}

/** Text of all controller files, in case a list is defined in another file. */
function allControllerTexts() {
  return Object.keys(require.cache)
    .filter((f) => /\/src\/controllers\//.test(f))
    .map(textOf);
}

/** `const NAME = ['a', 'b', …]` → ['a','b',…] */
function resolveList(name, texts) {
  const rx = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  for (const t of texts) {
    const m = rx.exec(t);
    if (m) return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  }
  return [];
}

/** Body of a function defined in the file by name, with its first parameter name. */
function helperSource(name, text) {
  const defs = [
    new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`),
    new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>\\s*\\{`),
    new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?function\\s*\\(([^)]*)\\)\\s*\\{`),
  ];
  for (const rx of defs) {
    const m = rx.exec(text);
    if (!m) continue;
    let i = m.index + m[0].length; let depth = 1;
    while (i < text.length && depth > 0) { const ch = text[i]; if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; i += 1; }
    return { params: m[1], body: text.slice(m.index, i) };
  }
  return null;
}

/** Key names in { a, b: c, d = 1, ...rest }. */
function destructuredKeys(inner) {
  return inner.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('...'))
    .map((s) => s.split(/[:=]/)[0].trim())
    .filter((s) => new RegExp(`^${IDENT}$`).test(s));
}

/** A literal list ['a','b'] or the name of a list resolved from the file texts. */
// An uppercase name (a constant like SHIPMENT_EDITABLE) is searched across files; a lowercase name is a variable or local parameter, resolved within its own text only, otherwise a keys list in one handler would read a same-named list in another controller.
const listOf = (arg, texts) => {
  if (arg.startsWith('[')) return [...arg.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  return resolveList(arg, /^[A-Z][A-Z0-9_]*$/.test(arg) ? texts : texts.slice(0, 1));
};

/** Fields read from root (such as req.query) or its aliases within one text. */
function fieldsIn(src, root, texts = []) {
  const out = new Set();
  const roots = [root.replace('.', '\\.')];
  // Aliases: const q = req.query || {}
  for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*\\(?\\s*${roots[0]}\\b(?![.\\[?])`, 'g'))) roots.push(m[1]);
  for (const r of roots) {
    for (const m of src.matchAll(new RegExp(`\\b${r}\\??\\.(${IDENT})`, 'g'))) if (!NOT_FIELDS.has(m[1])) out.add(m[1]);
    for (const m of src.matchAll(new RegExp(`\\b${r}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'))) out.add(m[1]);
    for (const m of src.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*\\(?\\s*${r}\\b(?![.\\[])`, 'g'))) destructuredKeys(m[1]).forEach((k) => out.add(k));
  }
  // Loop over a list of names: for (const f of FIELDS) ... req.body[f], and likewise ['a','b'].forEach((f) => ... req.body[f])
  const loops = [
    ...[...src.matchAll(new RegExp(`for\\s*\\(\\s*(?:const|let)\\s+(${IDENT})\\s+of\\s+(${IDENT}|\\[[^\\]]*\\])\\s*\\)`, 'g'))].map((m) => [m[1], m[2]]),
    ...[...src.matchAll(new RegExp(`(${IDENT}|\\[[^\\]]*\\])\\.forEach\\(\\s*\\(?\\s*(${IDENT})`, 'g'))].map((m) => [m[2], m[1]]),
  ];
  for (const [v, list] of loops) {
    const used = roots.some((r) => new RegExp(`\\b${r}\\??\\.?\\[\\s*${v}\\s*\\]`).test(src));
    if (used) listOf(list, [src, ...texts]).forEach((f) => out.add(f));
  }
  return { fields: out, roots };
}

/** Every call that passes root as an argument: [{ 1: function name, argIndex }]. Scans backward from the name position to the unclosed open parenthesis, linearly. */
function enclosingCalls(src, roots) {
  const out = [];
  const rx = new RegExp(`\\b(?:${roots.join('|')})\\b(?![.\\[?\\w$])`, 'g');
  for (const m of src.matchAll(rx)) {
    // What follows: end of the argument (a comma, a closing parenthesis, or || {})
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (!/^\s*(?:\|\|\s*\{\s*\}\s*)?[,)]/.test(after)) continue;
    let depth = 0; let commas = 0; let i = m.index - 1;
    for (; i >= 0 && m.index - i < 400; i -= 1) {
      const ch = src[i];
      if (ch === ')' || ch === ']' || ch === '}') depth += 1;
      else if (ch === '(' || ch === '[' || ch === '{') { if (depth === 0) break; depth -= 1; } else if (ch === ',' && depth === 0) commas += 1;
    }
    if (i < 0 || src[i] !== '(') continue;
    const name = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 60), i));
    if (name) out.push({ 1: name[1], argIndex: commas });
  }
  return out;
}

/** Fields read by a single handler: { query: [...], body: [...] }. */
function scanHandler(fn) {
  const res = { query: new Set(), body: new Set(), whole: false };
  if (typeof fn !== 'function') return res;
  // A handler that passes the body to a list-based filter (filterFieldsByRole(req.body, ...)) cannot be traced in text, so it tags itself with the exact list it accepts (the array the code reads, not a copy): handler.__docFields = { body: ALL_FIELDS }.
  const declared = fn.__docFields || {};
  for (const loc of ['query', 'body']) (declared[loc] || []).forEach((f) => res[loc].add(String(f)));
  let src = '';
  try { src = Function.prototype.toString.call(fn); } catch (_) { return res; }
  // Takes the whole body as is (...req.body, $set: req.body, or forwards it to another platform).
  res.whole = /\.\.\.\s*req\.body|\$set:\s*req\.body|\(\s*req\.body\s*\)|body:\s*req\.body|form:\s*req\.body/.test(src);
  const file = buildFileIndex().get(fn);
  const text = textOf(file);
  const texts = text ? [text, ...allControllerTexts()] : allControllerTexts();

  for (const [loc, root] of [['query', 'req.query'], ['body', 'req.body']]) {
    const { fields, roots } = fieldsIn(src, root, texts);
    fields.forEach((f) => res[loc].add(f));

    const rootAlt = roots.map((r) => r.replace('\\.', '\\.')).join('|');
    // pick(req.body, LIST) / pick(b, ['a','b'])
    // A call taking the body and then a list: pick(req.body, LIST), applyFields(doc, req.body, LIST)
    for (const m of src.matchAll(new RegExp(`(?:${rootAlt})\\s*,\\s*([A-Z][A-Z0-9_]*|\\[[^\\]]*\\])\\s*[,)]`, 'g'))) {
      listOf(m[1], [src, ...texts]).forEach((f) => res[loc].add(f));
    }
    // helper(req.query): a helper function in the same file, one level deep.
    if (text) {
      // helper(req.body), helper(req.body || {}) or helper(req, req.body), with the body at any argument position. Walks backward from the body position to the call parenthesis (no nested regular expression).
      for (const m of enclosingCalls(src, roots)) {
        const argIndex = m.argIndex;
        if (['Object', 'JSON', 'String', 'Number', 'require'].includes(m[1])) continue;
        const h = helperSource(m[1], text);
        if (!h) {
          // A function built from a list: const pickCampaign = pickFrom(CAMPAIGN_EDITABLE)
          const built = new RegExp(`(?:const|let)\\s+${m[1]}\\s*=\\s*${IDENT}\\(\\s*([A-Z][A-Z0-9_]*|\\[[^\\]]*\\])\\s*\\)`).exec(text);
          if (built) listOf(built[1], texts).forEach((f) => res[loc].add(f));
          continue;
        }
        const first = (h.params.split(',')[argIndex] || '').trim();
        const dm = /^\{([^}]*)\}/.exec(first);
        if (dm) { destructuredKeys(dm[1]).forEach((k) => res[loc].add(k)); continue; }
        const pname = first.split('=')[0].trim();
        if (!new RegExp(`^${IDENT}$`).test(pname)) continue;
        fieldsIn(h.body, pname, texts).fields.forEach((f) => res[loc].add(f));
        // The helper itself may pass its parameter on to a list: pick(b, LIST)
        for (const mm of h.body.matchAll(new RegExp(`\\b${pname}\\s*,\\s*([A-Z][A-Z0-9_]*|\\[[^\\]]*\\])\\s*[,)]`, 'g'))) {
          listOf(mm[1], [h.body, ...texts]).forEach((f) => res[loc].add(f));
        }
      }
    }
  }
  return res;
}

/** express-validator rules in the route layers: [{ name, in, required }]. */
function validatorFields(stack) {
  const out = [];
  for (const l of stack || []) {
    const b = l.handle && l.handle.builder;
    if (!b || typeof b.build !== 'function') continue;
    try {
      const ctx = b.build();
      for (const field of ctx.fields || []) {
        for (const loc of ctx.locations || []) {
          if (loc === 'query' || loc === 'body') out.push({ name: field, in: loc, required: !ctx.optional });
        }
      }
    } catch (_) { /* A rule that cannot be built is skipped */ }
  }
  return out;
}

const memo = new WeakMap();
/** Fields of one route from its layers: { query: [{name, required}], body: [{name, required}] }. The handler is the last layer; earlier ones are guards and rules. */
function routeFields(routeStack) {
  const handler = routeStack && routeStack.length ? routeStack[routeStack.length - 1].handle : null;
  let scanned = handler && memo.get(handler);
  if (!scanned && handler) { scanned = scanHandler(handler); memo.set(handler, scanned); }
  const out = { query: new Map(), body: new Map() };
  for (const v of validatorFields(routeStack)) out[v.in].set(v.name, { name: v.name, required: v.required });
  if (scanned) {
    for (const loc of ['query', 'body']) {
      for (const f of scanned[loc]) if (!out[loc].has(f)) out[loc].set(f, { name: f, required: false });
    }
  }
  return {
    wholeBody: !!(scanned && scanned.whole),
    query: [...out.query.values()].sort((a, b) => a.name.localeCompare(b.name)),
    body: [...out.body.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Cleared on reload; the process itself starts clean with every deploy. */
function resetCaches() { textCache.clear(); fileIndex = null; fileIndexSize = -1; }

module.exports = { routeFields, scanHandler, resetCaches };
