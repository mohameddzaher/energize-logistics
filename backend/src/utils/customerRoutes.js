/**
 * مساراتُ العميل وأسعارُها — يتعلّمها النظامُ من العمل، ولا تُكتب في جدول.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * سعرُ البيع الحقيقيّ لا يعرفه أحدٌ إلّا من كتبه: منصّةُ التشغيل تحمل سعرًا
 * مساويًا لسعر الشراء (فريقُ العمليّات هناك لا يرى ربحَنا)، وورقةُ الاتّفاق في
 * بريدٍ أو في رأس مندوب. فكان مَن ينشئ شحنةً يسأل زميلَه «كم أخذنا منهم آخر
 * مرّة من جدة للدمام؟».
 *
 * والجوابُ في العمل نفسِه: كلُّ شحنةٍ سُعِّرت هي اتّفاقٌ على مسارٍ بتاريخ. فتُقيَّد
 * في ملفّ العميل: مسارٌ واحدٌ بآخر سعر. ومن أيّ بابٍ جاءت الشحنةُ — أُنشئت
 * عندنا، أو جاءت من المنصّة، أو صُحِّح سعرُها في تقرير التشغيل الخاصّ — يتعلّم
 * الملفُّ منها.
 *
 * ── والأحدثُ يغلب ────────────────────────────────────────────────────────────
 * المسارُ الواحد يتكرّر بأسعارٍ تتغيّر؛ والمطلوبُ دائمًا آخرُ ما عُمل به. فيُقاس
 * بتاريخ **العمل** لا بلحظة الكتابة: استيرادٌ يجري اليوم عن شحنةٍ في مارس لا
 * يُسقط سعرًا اتُّفق عليه في أغسطس.
 *
 * ── والمدنُ تُطوى ───────────────────────────────────────────────────────────
 * «جدة» و«جده» و«جدة ‏» مدينةٌ واحدة، وثلاثةُ صفوفٍ لمسارٍ واحدٍ يجعل السعرَ
 * ثلاثةَ أسعار. فالمطابقةُ بالمفتاح المطويّ نفسِه الذي يطابق به بقيّةُ النظام.
 */
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');

const S = (v) => String(v ?? '').trim();

/** مفتاحُ المدينة: يطوي الهمزةَ والتاءَ والمسافات — راجع CollectionsParty.fold. */
const cityKey = (v) => require('../models/CollectionsParty').fold(v);

/** مفتاحُ المسار — الاتّجاه يهمّ: جدة←الرياض ليست الرياض←جدة. */
const routeKey = (from, to) => `${cityKey(from)}→${cityKey(to)}`;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * يُسجّل مسارًا في ملفّ العميل — ويُحدِّث سعرَه إن كان هذا أحدثَ.
 *
 * @param {object} customer مستندُ العميل (mongoose) — يُحفَظ هنا
 * @param {object} o { fromCity, toCity, price, at, source }
 * @returns {'created'|'priced'|'seen'|'skipped'} ما الذي حدث
 */
function applyRoute(customer, { fromCity, toCity, price, at, source = '' }) {
  const from = S(fromCity);
  const to = S(toCity);
  if (!from || !to) return 'skipped';
  const p = num(price);
  const when = at ? new Date(at) : new Date();

  customer.routes = customer.routes || [];
  const k = routeKey(from, to);
  const found = customer.routes.find((r) => routeKey(r.fromCity, r.toCity) === k);

  if (!found) {
    customer.routes.push({
      fromCity: from, toCity: to, price: p, at: p ? when : null, source: p ? source : '', hits: 1,
    });
    return p ? 'created' : 'seen';
  }

  found.hits = (found.hits || 1) + 1;
  // بلا سعرٍ: المسارُ يُعرَف وقد رأيناه ثانيةً، ولا يُمسّ سعرُه.
  if (!p) return 'seen';
  // ── وسعرٌ بلا تاريخٍ سابقٍ يُقبَل، والأحدثُ يغلب ────────────────────────
  const prev = found.at ? new Date(found.at) : null;
  if (found.price != null && prev && when < prev) return 'seen';
  found.price = p;
  found.at = when;
  found.source = source;
  return 'priced';
}

/**
 * يجد عميلًا بالاسم (أو يُنشئه) ثمّ يُسجّل المسار. يُستعمَل من المزامنة
 * والاستيراد حيث لا يكون بين يدينا إلّا اسمٌ.
 */
async function learnRouteByName(customerName, route) {
  const name = S(customerName);
  if (!name) return null;
  const { fold } = require('../models/CollectionsParty');
  const key = fold(name);

  // ── ولا تُقرأ القائمةُ كلُّها لكلّ شحنة ──────────────────────────────────
  // المزامنةُ تنادي هذه الدالّة مئةَ مرّةٍ في الدورة الواحدة. وقراءةُ سجلّ
  // العملاء في كلّ مرّةٍ قراءةُ الشيء نفسِه مئةَ مرّة. فيُحفَظ فهرسُ
  // الأسماء المطويّة دقيقةً، ويُقرأ مستندُ العميل وحدَه بمعرّفه.
  const cache = require('./ttlCache');
  const index = await cache.wrap('so:customerNameIndex', 60000, async () => {
    const rows = await ShipmentOrderCustomer.find({ isActive: { $ne: false } }).select('name').lean();
    const out = {};
    for (const c of rows) { const k = fold(c.name); if (k && !out[k]) out[k] = String(c._id); }
    return out;
  });

  let customer = index[key] ? await ShipmentOrderCustomer.findById(index[key]) : null;
  if (!customer) {
    customer = await ShipmentOrderCustomer.create({ name, routes: [] });
    try { cache.clear('so:customerNameIndex'); } catch (_) { /* */ }
  }
  const res = applyRoute(customer, route);
  if (res !== 'skipped') await customer.save();
  return res;
}

/** سعرُ المسار كما في ملفّ العميل — `null` إن لم يُسعَّر بعد. */
function priceFor(customer, fromCity, toCity) {
  if (!customer) return null;
  const k = routeKey(fromCity, toCity);
  const r = (customer.routes || []).find((x) => routeKey(x.fromCity, x.toCity) === k);
  return r && r.price != null ? Number(r.price) : null;
}

/**
 * ── شرائحُ السعر بعدد السيارات ──────────────────────────────────────────────
 *
 * `cleanTiers` تقرأ ما كُتب في الشاشة وتردّه مرتَّبًا، أو ترمي برسالةٍ تُعرَض:
 * عددٌ صحيحٌ من واحد، ونهايةٌ لا تسبق بدايتَها، وسعرٌ موجب، ولا شريحتان على
 * عددٍ واحد — فسعران لخمس سياراتٍ ليسا سعرًا. والشريحةُ الأخيرةُ وحدَها يجوز
 * أن تُترك بلا نهاية («فما فوق»).
 */
function cleanTiers(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const rows = (Array.isArray(input) ? input : []).map((t) => ({
    minTrucks: Number(t && t.minTrucks),
    maxTrucks: t && t.maxTrucks !== null && t.maxTrucks !== undefined && t.maxTrucks !== '' ? Number(t.maxTrucks) : null,
    price: Number(t && t.price),
  }));
  for (const t of rows) {
    if (!Number.isInteger(t.minTrucks) || t.minTrucks < 1) throw bad('بدايةُ الشريحة عددٌ صحيحٌ من ١ فأكثر');
    if (t.maxTrucks !== null && (!Number.isInteger(t.maxTrucks) || t.maxTrucks < t.minTrucks)) throw bad('نهايةُ الشريحة لا تسبق بدايتَها');
    if (!Number.isFinite(t.price) || t.price <= 0) throw bad('اكتب سعرَ السيارة في كلّ شريحة');
  }
  rows.sort((a, b) => a.minTrucks - b.minTrucks);
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    if (prev.maxTrucks === null) throw bad('الشريحةُ المفتوحةُ («فما فوق») تكون الأخيرة');
    if (rows[i].minTrucks <= prev.maxTrucks) throw bad(`شريحتان على العدد ${rows[i].minTrucks} — لكلّ عددٍ سعرٌ واحد`);
  }
  return rows;
}

/** سعرُ السيارة لعددٍ من السيارات — `null` إن لم تشمله شريحة. */
function tierPriceFor(tiers, trucks) {
  const n = Math.max(1, Number(trucks) || 1);
  for (const t of tiers || []) {
    if (n >= t.minTrucks && (t.maxTrucks == null || n <= t.maxTrucks)) return Number(t.price);
  }
  return null;
}

/**
 * ── من يكتب سعرَ مسار ──────────────────────────────────────────────────────
 * أسعارُ الوجهات — السعرُ المتّفقُ عليه وشرائحُ عدد السيارات — يكتبها **مديرُ
 * العمليّات ومديرُ النظام وحدَهما** (قرارُ صاحب الشركة). غيرُهما يعدّل بياناتِ
 * العميل (الاسم والهاتف والتفضيلات) ولا يمسّ سعرًا. والسؤالُ هنا في موضعٍ واحدٍ
 * يقرؤه كلُّ بابٍ يصل إلى السعر.
 */
const PRICE_EDITORS = ['super_admin', 'operations_manager'];
const canEditPrices = (role) => PRICE_EDITORS.includes(role);

module.exports = {
  cityKey, routeKey, applyRoute, learnRouteByName, priceFor, cleanTiers, tierPriceFor,
  PRICE_EDITORS, canEditPrices,
};
