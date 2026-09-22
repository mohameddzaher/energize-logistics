/**
 * ختمُ التغيير — «هل تغيّر شيءٌ في هذه المجموعات؟» بسؤالٍ واحدٍ صغير.
 *
 * عنقودُ Atlas بطيءُ النقل لا بطيءُ الحساب: التنفيذ في القاعدة جزءٌ من المِلّي
 * ثانية، ونقلُ كلّ مئة كيلوبايت يكلّف قرابةَ ثانية. فالقائمةُ الكبيرة تُدفَع
 * مرّةً ثم تُحفَظ، ويُسأل قبل كلّ قراءةٍ عن ختمٍ لا يتجاوز بضعةَ بايتات: العددُ،
 * ومجموعُ `updatedAt`، وأكبرُه. أيُّ إضافةٍ أو حذفٍ أو تعديلٍ يمرّ بـ mongoose
 * يُغيّر المجموع — حتى لو كانت ساعةُ الكاتب متأخّرةً فلم يتغيّر الأكبر.
 *
 * وبذلك لا يعتمد صدقُ الذاكرة على أن يتذكّر كلُّ مسارِ كتابةٍ مسحَها؛ والمدّةُ
 * القصوى شبكةُ أمانٍ لكتابةٍ خامٍ لا تلمس `updatedAt` (سكربت استيراد مثلًا).
 */
const cache = require('./ttlCache');

const group = (tag) => [{
  $group: {
    _id: tag,
    n: { $sum: 1 },
    s: { $sum: { $toLong: { $ifNull: ['$updatedAt', new Date(0)] } } },
    u: { $max: '$updatedAt' },
  },
}];

/** ختمُ عدّة مجموعاتٍ في رحلةٍ واحدة إلى القاعدة ($unionWith). */
async function stampOf(models) {
  const [first, ...rest] = models;
  const pipeline = [...group(first.collection.name)];
  for (const m of rest) pipeline.push({ $unionWith: { coll: m.collection.name, pipeline: group(m.collection.name) } });
  const rows = await first.aggregate(pipeline);
  return rows.map((r) => `${r._id}:${r.n}:${r.s}`).sort().join('|');
}

const inflight = new Map();

/**
 * مثل `cache.wrap` لكنّ الصلاحيةَ بالختم لا بالساعة: القيمةُ تُخدَم ما دام ختمُ
 * المجموعات هو هو، وتُعاد حين يتغيّر. والمسحُ بالبادئة (`cache.clear`) يبقى
 * يعمل كما كان لأنّ القيمة في الذاكرة نفسها.
 */
async function freshWrap(key, maxTtlMs, models, producer) {
  const stamp = await stampOf(models);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.val;
  const ik = `${key}@${stamp}`;
  if (inflight.has(ik)) return inflight.get(ik);
  const p = (async () => {
    const val = await producer();
    cache.set(key, { stamp, val }, maxTtlMs);
    return val;
  })();
  inflight.set(ik, p);
  try { return await p; } finally { inflight.delete(ik); }
}

/**
 * مرآةٌ لمجموعةٍ كاملة بحقولٍ محدّدة، تُحدَّث بالفرق لا بإعادة النقل.
 *
 * `rowsFor(filter)` يسأل القاعدةَ عن معرّفات المطابِق فقط (بضعةُ كيلوبايتات،
 * وبالترتيب الذي كانت ستعيده القاعدة) ويأخذ الصفوفَ من المرآة. وتعديلُ مركبةٍ
 * واحدة يجلب تلك المركبة وحدها لا الأسطولَ كلّه.
 */
function mirror(Model, fields, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  const sel = [...new Set([...String(fields).split(/\s+/).filter(Boolean), 'updatedAt'])].join(' ');
  let state = null;
  let loading = null;

  const serverStamp = async () => {
    const [r] = await Model.aggregate(group(null));
    return r ? { n: r.n, s: Number(r.s) } : { n: 0, s: 0 };
  };
  const build = (byId) => {
    let s = 0; let u = null;
    for (const d of byId.values()) {
      const t = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
      s += t;
      if (d.updatedAt && (!u || t > u.getTime())) u = new Date(t);
    }
    return { byId, n: byId.size, s, u, at: Date.now() };
  };
  const full = async () => {
    const all = await Model.find({}).select(sel).lean();
    return build(new Map(all.map((d) => [String(d._id), d])));
  };

  async function sync(force = false) {
    const st = await serverStamp();
    const young = state && Date.now() - state.at < maxAgeMs;
    if (!force && young && state.n === st.n && state.s === st.s) return state;
    const lk = `${force}:${st.n}:${st.s}`;
    if (loading && loading.key === lk) return loading.p;
    const p = (async () => {
      let next = null;
      if (!force && young && state.u) {
        // الفرقُ وحده: ما عُدِّل منذ آخر ختم. و«>=» لا «>» كي لا يفوت تعديلٌ في
        // المِلّي ثانية نفسها.
        const changed = await Model.find({ updatedAt: { $gte: state.u } }).select(sel).lean();
        const byId = new Map(state.byId);
        for (const d of changed) byId.set(String(d._id), d);
        const cand = build(byId);
        cand.at = state.at; // الفرقُ لا يجدّد عمرَ المرآة — شبكةُ الأمان تبقى
        // حذفٌ أو ساعةٌ متأخّرة لا يلتقطهما الفرق — فيظهران في الختم ونعيد كلّ شيء.
        if (cand.n === st.n && cand.s === st.s) next = cand;
      }
      state = next || await full();
      return state;
    })();
    loading = { key: lk, p };
    try { return await p; } finally { if (loading && loading.p === p) loading = null; }
  }

  async function rowsFor(filter) {
    const [ids, s] = await Promise.all([Model.find(filter).select('_id').lean(), sync()]);
    let rows = ids.map((x) => s.byId.get(String(x._id)));
    if (rows.some((r) => !r)) {
      // أُضيفت مركبةٌ بين السؤالين — نعيد التحميل مرّةً ونأخذ الصفوف منه.
      const f = await sync(true);
      rows = ids.map((x) => f.byId.get(String(x._id))).filter(Boolean);
    }
    return rows;
  }

  return { rowsFor, sync, reset: () => { state = null; } };
}

module.exports = { stampOf, freshWrap, mirror };
