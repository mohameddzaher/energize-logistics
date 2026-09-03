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
  maybePoll();                 // ما أبطله عاملٌ آخر يُمسَح هنا — راجع syncStamps
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
function clearLocal(prefix) {
  if (!prefix) { store.clear(); inflight.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  // الوعود الجارية تُسقَط معها: وعدٌ بدأ قبل الكتابة سيكتب نتيجته القديمة فوق
  // ذاكرةٍ أُبطلت للتوّ، فتعود الشاشة إلى ما قبل التعديل بلا سبب ظاهر.
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
}

// ── والإبطالُ يعبر إلى العامل الآخر ──────────────────────────────────────────
//
// البرودكشن يعمل بعاملَين (PM2 cluster)، ولكلٍّ ذاكرتُه. فمن أغلق تنبيهًا أصاب
// نداؤه عاملًا واحدًا فمسح ذاكرته وحدَه، والقراءةُ التالية توزَّع بالتناوب —
// فيرى المستخدم التنبيهَ يختفي ويعود ويختفي. قِيس ذلك: اثنتا عشرة قراءةً بعد
// إغلاق تنبيهٍ واحد أعطت ٤٣ و٤٢ بالتناوب اثنتَي عشرةَ مرّةً بلا استثناء.
//
// وهذا يمسّ كلَّ إبطالٍ في المنصّة لا التنبيهاتِ وحدها: سجلُّ المركبات وفلاترُ
// الكشوف واللوحاتُ كلُّها — أيُّ كتابةٍ يتلوها قراءةٌ تقع على العامل الآخر
// تُرجع ما قبل الكتابة.
//
// فيُقيَّد الإبطالُ في القاعدة المشتركة (ختمٌ لكلّ بادئة)، ويقرأ كلُّ عاملٍ
// الأختامَ مرّةً في الثانية على الأكثر فيمسح عنده ما مُسح عند غيره. استعلامٌ
// صغيرٌ واحدٌ في الثانية لكلّ عامل، وحدُّ التأخّر ثانيةٌ واحدة — بدل صفحةٍ
// تكذب نصفَ المرّات.
const STAMP_COLL = 'cachestamps';
const POLL_MS = 1000;
const seen = new Map();          // البادئة → آخرُ ختمٍ عرفناه
let lastPoll = 0;
let polling = false;

const db = () => {
  try {
    const mongoose = require('mongoose');
    return mongoose.connection?.readyState === 1 ? mongoose.connection.db : null;
  } catch (_) { return null; }
};

/** يُقرأ الأختامُ ويُمسَح محلّيًّا ما أبطله عاملٌ آخر. لا يرمي أبدًا. */
async function syncStamps() {
  const d = db();
  if (!d) return;
  try {
    const rows = await d.collection(STAMP_COLL).find({}).toArray();
    for (const r of rows) {
      const prev = seen.get(r._id);
      const at = r.at ? new Date(r.at).getTime() : 0;
      if (prev === undefined) { seen.set(r._id, at); continue; }   // أوّلُ مرّةٍ: يُسجَّل ولا يُمسَح
      if (at > prev) { seen.set(r._id, at); clearLocal(r._id === '*' ? undefined : r._id); }
    }
  } catch (_) { /* الذاكرةُ تحسينٌ لا شرط */ }
}

/** يُنادى من `get`: يستدعي المزامنة في الخلفيّة مرّةً في الثانية على الأكثر. */
function maybePoll() {
  const now = Date.now();
  if (polling || now - lastPoll < POLL_MS) return;
  lastPoll = now;
  polling = true;
  syncStamps().finally(() => { polling = false; });
}

function clear(prefix) {
  clearLocal(prefix);
  const d = db();
  if (!d) return;
  const key = prefix || '*';
  const at = Date.now();
  seen.set(key, at);            // ختمُنا نحن — لئلّا نمسح مرّةً ثانيةً بسببه
  d.collection(STAMP_COLL)
    .updateOne({ _id: key }, { $set: { at: new Date(at) } }, { upsert: true })
    .catch(() => { /* الإبطالُ المحلّيُّ تمّ، والعبورُ تحسين */ });
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

module.exports = { get, set, clear, wrap, syncStamps };
