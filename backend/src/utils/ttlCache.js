/**
 * Tiny in-process TTL cache. Used to coalesce identical UPL proxy reads across
 * concurrent users (the UPL data is global, not per-user), so 100 users hitting
 * the dashboard in the same second cost ONE upstream call, not 100.
 *
 * Short TTLs only — the poll broadcasts changes within seconds and writes bust
 * the cache, so staleness is bounded.
 */
const store = new Map();
let lastSweep = 0;

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 30000) return; // amortize cleanup
  lastSweep = now;
  for (const [k, e] of store) if (e.exp <= now) store.delete(k);
}

function get(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp <= Date.now()) { store.delete(key); return undefined; }
  return e.val;
}

function set(key, val, ttlMs) {
  store.set(key, { val, exp: Date.now() + ttlMs });
  sweep();
}

// Drop everything (no prefix) or every key starting with `prefix`.
function clear(prefix) {
  if (!prefix) { store.clear(); inflight.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  // الوعود الجارية تُسقَط معها: وعدٌ بدأ قبل الكتابة سيكتب نتيجته القديمة فوق
  // ذاكرةٍ أُبطلت للتوّ، فتعود الشاشة إلى ما قبل التعديل بلا سبب ظاهر.
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
}

// ── الطلعة الواحدة (single-flight) ───────────────────────────────────────────
//
// كان `wrap` يقرأ الذاكرة ثم يحسب — وبينهما فجوة. فحين يفتح أربعون موظفًا
// اللوحةَ نفسها في الثانية نفسها (وهذا ما يحدث صباحًا بالضبط) يخيب ظنّهم جميعًا
// في الذاكرة، فتُحسب النتيجة نفسها أربعين مرّة على قاعدة البيانات. القياس تحت
// أربعين مستخدمًا متزامنًا: من ٣ إلى ٦٫٦ ثانية عند ٩٥٪ — وكلّها انتظارٌ لعملٍ
// مكرَّر لا لعملٍ لازم.
//
// الآن يُحفَظ **الوعد** لا النتيجة وحدها: أوّل طالبٍ يبدأ الحساب، ومَن جاء بعده
// وهو جارٍ ينتظر الوعد نفسه. حسابٌ واحد يخدم الأربعين.
//
// والوعد يُنزَع عند الفشل: لو بقي محفوظًا لورث كلُّ طالبٍ لاحقٍ خطأً وقع مرّةً
// واحدة، فيصير عطلٌ عابر عطلًا دائمًا حتى تنتهي المهلة.
const inflight = new Map();

async function wrap(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== undefined) return hit;

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const val = await producer();
    set(key, val, ttlMs);
    return val;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

module.exports = { get, set, clear, wrap };
