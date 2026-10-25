/**
 * حقولُ كلّ مسارٍ في التوثيق — تُقرأ من الكود نفسِه لحظةَ فتحِ الوثيقة.
 *
 * ── لماذا (صاحبُ الشركة، ٢٠٢٦/١٠/٢٥) ────────────────────────────────────────
 * «أيُّ تعديلٍ أو إضافةٍ أو حذفٍ في السيستم يسمع فورًا في الدوكيومنتيشن».
 * المساراتُ كانت تُقرأ من الراوتر (services/apiDocs)، أمّا ما يُرسَل فيها —
 * فلاترُ القائمة وحقولُ الحفظ — فلم يكن مكتوبًا. وكتابتُه بيدٍ تشيخ في أسبوع.
 *
 * ── من أين تُقرأ، بالترتيب ──────────────────────────────────────────────────
 *  ① قواعدُ express-validator على المسار — حقلٌ وموضعُه وهل هو اختياريّ.
 *     هي أدقُّ ما يُقرأ: كتبها صاحبُها شرطًا لا وصفًا.
 *  ② نصُّ الدالّة التي تخدم المسار (`fn.toString()` — الكودُ المُشغَّل فعلًا):
 *       req.query.x · req.body?.x · req.query['x']
 *       const { a, b: c = 1 } = req.query
 *       const q = req.query || {}  ثمّ  q.x  أو  const { a } = q
 *       pick(req.body, EDITABLE)  ← تُقرأ القائمةُ من ملفّ المتحكِّم
 *       resolvePeriod(req.query)  ← تُقرأ الدالّةُ المساعدةُ من الملفّ، مستوىً واحدًا
 *
 * وما لا يُقرأ هكذا (حقلٌ يُمرَّر بعيدًا عبر طبقاتٍ كثيرة) لا يُخمَّن: الوثيقةُ
 * تقول ما رأته في الكود، ولا تقول ما لم تره.
 */
const fs = require('fs');

const IDENT = '[A-Za-z_$][\\w$]*';
// أسماءٌ تُقرأ بعد النقطة وليست حقولًا.
const NOT_FIELDS = new Set(['hasOwnProperty', 'toString', 'length', 'constructor', 'valueOf', 'keys', 'map', 'filter', 'forEach']);

// ── نصُّ ملفّ كلّ دالّةٍ مُصدَّرة — لقراءة القوائم والدوالّ المساعدة ────────────
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

/** نصوصُ ملفّات المتحكِّمات كلّها — احتياطًا لقائمةٍ عُرِّفت في ملفٍّ آخر. */
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

/** جسمُ دالّةٍ معرَّفةٍ في الملفّ باسمها، ومعه اسمُ معاملها الأوّل. */
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

/** أسماءُ المفاتيح في `{ a, b: c, d = 1, ...rest }`. */
function destructuredKeys(inner) {
  return inner.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('...'))
    .map((s) => s.split(/[:=]/)[0].trim())
    .filter((s) => new RegExp(`^${IDENT}$`).test(s));
}

/** قائمةٌ حرفيّةٌ `['a','b']` أو اسمُ قائمةٍ يُحَلّ من النصوص. */
//  اسمٌ بحروفٍ كبيرة (ثابتٌ مثل SHIPMENT_EDITABLE) يُبحث عنه في الملفّات؛ واسمٌ صغيرٌ
//  متغيّرٌ أو معاملٌ محلّيّ — يُحَلّ في نصّه وحدَه، وإلّا قرأ `keys` في معالِجٍ
//  قائمةً بالاسم نفسِه في متحكِّمٍ آخر.
const listOf = (arg, texts) => {
  if (arg.startsWith('[')) return [...arg.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  return resolveList(arg, /^[A-Z][A-Z0-9_]*$/.test(arg) ? texts : texts.slice(0, 1));
};

/** الحقولُ المقروءةُ من `root` (مثل `req.query`) أو من أسمائه البديلة في نصٍّ واحد. */
function fieldsIn(src, root, texts = []) {
  const out = new Set();
  const roots = [root.replace('.', '\\.')];
  // أسماءٌ بديلة: const q = req.query || {}
  for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*\\(?\\s*${roots[0]}\\b(?![.\\[?])`, 'g'))) roots.push(m[1]);
  for (const r of roots) {
    for (const m of src.matchAll(new RegExp(`\\b${r}\\??\\.(${IDENT})`, 'g'))) if (!NOT_FIELDS.has(m[1])) out.add(m[1]);
    for (const m of src.matchAll(new RegExp(`\\b${r}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'))) out.add(m[1]);
    for (const m of src.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*\\(?\\s*${r}\\b(?![.\\[])`, 'g'))) destructuredKeys(m[1]).forEach((k) => out.add(k));
  }
  // ── حلقةٌ على قائمة أسماء: for (const f of FIELDS) … req.body[f] ──────────
  //    وكذلك  ['a','b'].forEach((f) => … req.body[f])
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

/**
 * كلُّ نداءٍ يُمرَّر فيه `root` معاملًا: [{ 1: اسمُ الدالّة, argIndex }].
 * من موضع الاسم إلى الخلف حتى القوس المفتوح غيرِ المغلق — خطّيًّا.
 */
function enclosingCalls(src, roots) {
  const out = [];
  const rx = new RegExp(`\\b(?:${roots.join('|')})\\b(?![.\\[?\\w$])`, 'g');
  for (const m of src.matchAll(rx)) {
    // ما بعده: نهايةُ المعامل («,» أو «)» أو «|| {}»)
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

/**
 * الحقولُ التي يقرؤها معالِجٌ واحد: { query: [...], body: [...] }.
 */
function scanHandler(fn) {
  const res = { query: new Set(), body: new Set(), whole: false };
  if (typeof fn !== 'function') return res;
  // ── ومعالِجٌ يمرّر الجسمَ إلى مُرشِّحٍ بقائمة (filterFieldsByRole(req.body, …)) ──
  // لا يُتتبَّع نصًّا؛ فيُعلِّق على نفسه القائمةَ التي يقبلها **بعينها** (المصفوفةُ
  // التي يقرؤها الكود، لا نسخةٌ منها): `handler.__docFields = { body: ALL_FIELDS }`.
  const declared = fn.__docFields || {};
  for (const loc of ['query', 'body']) (declared[loc] || []).forEach((f) => res[loc].add(String(f)));
  let src = '';
  try { src = Function.prototype.toString.call(fn); } catch (_) { return res; }
  // يأخذ الجسمَ كلَّه كما جاء (‎...req.body · $set: req.body · يمرّره إلى منصّةٍ أخرى).
  res.whole = /\.\.\.\s*req\.body|\$set:\s*req\.body|\(\s*req\.body\s*\)|body:\s*req\.body|form:\s*req\.body/.test(src);
  const file = buildFileIndex().get(fn);
  const text = textOf(file);
  const texts = text ? [text, ...allControllerTexts()] : allControllerTexts();

  for (const [loc, root] of [['query', 'req.query'], ['body', 'req.body']]) {
    const { fields, roots } = fieldsIn(src, root, texts);
    fields.forEach((f) => res[loc].add(f));

    const rootAlt = roots.map((r) => r.replace('\\.', '\\.')).join('|');
    // pick(req.body, LIST) / pick(b, ['a','b'])
    // نداءٌ يأخذ الجسمَ وقائمةً بعده: pick(req.body, LIST) · applyFields(doc, req.body, LIST)
    for (const m of src.matchAll(new RegExp(`(?:${rootAlt})\\s*,\\s*([A-Z][A-Z0-9_]*|\\[[^\\]]*\\])\\s*[,)]`, 'g'))) {
      listOf(m[1], [src, ...texts]).forEach((f) => res[loc].add(f));
    }
    // helper(req.query) — دالّةٌ مساعدةٌ في الملفّ نفسِه، مستوىً واحدًا.
    if (text) {
      // helper(req.body) · helper(req.body || {}) · helper(req, req.body) — والجسمُ في أيّ موضعٍ بين
      // المعاملات. يُمشى من موضع الجسم إلى الخلف حتى قوسِ النداء (بلا تعبيرٍ نمطيٍّ متداخل).
      for (const m of enclosingCalls(src, roots)) {
        const argIndex = m.argIndex;
        if (['Object', 'JSON', 'String', 'Number', 'require'].includes(m[1])) continue;
        const h = helperSource(m[1], text);
        if (!h) {
          // دالّةٌ مبنيّةٌ من قائمة: const pickCampaign = pickFrom(CAMPAIGN_EDITABLE)
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
        // والمساعدُ نفسُه قد يمرّر معاملَه إلى قائمة: pick(b, LIST)
        for (const mm of h.body.matchAll(new RegExp(`\\b${pname}\\s*,\\s*([A-Z][A-Z0-9_]*|\\[[^\\]]*\\])\\s*[,)]`, 'g'))) {
          listOf(mm[1], [h.body, ...texts]).forEach((f) => res[loc].add(f));
        }
      }
    }
  }
  return res;
}

/** قواعدُ express-validator في طبقات المسار: [{ name, in, required }]. */
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
    } catch (_) { /* قاعدةٌ لا تُبنى — تُتجاوز */ }
  }
  return out;
}

const memo = new WeakMap();
/**
 * حقولُ مسارٍ واحد من طبقاته: { query: [{name, required}], body: [{name, required}] }.
 * المعالِجُ هو آخرُ طبقة؛ وما قبله حرّاسٌ وقواعد.
 */
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

/** يُفرَّغ عند إعادة التحميل — والعمليّةُ نفسُها تبدأ نظيفةً مع كلّ نشر. */
function resetCaches() { textCache.clear(); fileIndex = null; fileIndexSize = -1; }

module.exports = { routeFields, scanHandler, resetCaches };
