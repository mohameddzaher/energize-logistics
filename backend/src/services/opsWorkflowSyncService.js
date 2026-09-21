/**
 * opsWorkflowSyncService — mirrors UPL shipments into the internal Operations
 * workflow (dispatch-sheet) list, mapping each shipment onto the OperationsWorkflow
 * columns. The UPL-derived columns are refreshed every run; the manually-entered
 * columns (operations/accounting/invoice review, etc.) are written ONLY on first
 * insert and then left alone for the other roles to fill in.
 *
 * Deduped by (externalSource, externalId = UPL shipment id) so re-runs update in
 * place. New rows land at stage 'draft'.
 */
const upl = require('./uplClient');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const { derivePaymentTypeFor } = require('../utils/paymentType');


const SOURCE = 'ops_upl';
let running = false;
let timer = null;

// Localized relation label ({ name: { ar, en } } | { name: '...' } | '...').
const loc = (v) => {
  const n = v && v.name;
  if (n && typeof n === 'object') return n.ar || n.en || '';
  if (typeof n === 'string') return n;
  return typeof v === 'string' ? v : '';
};


async function fetchAllShipments() {
  const all = [];
  const limit = 100; // UPL page cap
  let page = 1;
  for (let i = 0; i < 1000; i++) {
    // المسحُ كاملٌ صفحةً صفحة، فالترتيبُ لا يعنيه. (و`sort` مُهمَلٌ في المنصّة
    // على أيّ حال — تردّ دائمًا بترتيب الإنشاء؛ راجع jobs/opsPoll.)
    const out = await upl.get('/admin/shipments', { query: { page, limit } });
    const items = (out.data && out.data.items) || [];
    all.push(...items);
    const meta = out.data && out.data.meta;
    if (!meta || !meta.hasNextPage) break;
    page += 1;
  }
  return all;
}

function mapShipment(s) {
  const set = {
    // ── تاريخُ الكشف هو `pick_time` لا `created_at` ────────────────────────
    // `created_at` لحظةُ كتابة الصفّ في المنصّة، و`pick_time` تاريخُ الكشف
    // نفسِه. وهما يفترقان في ثمانيةِ آلافٍ وسبعِمئةٍ وثمانٍ وعشرين شحنةً من
    // ثلاثةٍ وثلاثين ألفًا — كشفٌ عُمل في نوفمبر ٢٠٢٥ ثمّ أُدخل في فبراير ٢٠٢٦
    // كان يُقرأ كشفَ فبراير، فيدخل تقاريرَ شهرٍ لم يحدث فيه ويخرج من شهره.
    // وشيتُ المتابعة يحمل `pick_time` — فكان الرقمان يختلفان بلا سبب.
    reportDate: s.pick_time ? new Date(s.pick_time)
      : (s.created_at ? new Date(s.created_at) : undefined),
    fromLocation: s.address_from || '',
    toLocation: s.address_to || '',
    branch: loc(s.branch),
    carOwner: s.car?.owner?.owner_name || '',
    carNumber: s.car?.car_number || '',
    ownerType: s.creator_type || '',
    // Store the RAW values from UPL — translation happens in the UI (so new
    // statuses the vendor adds never break / show blank).
    applicationStatus: s.status || '',
    executionStatus: s.status || '',
    paymentMethod: s.payment_method || '',
    username: s.user?.name || '',
    userPhone: s.user?.phone || '',
    purchaseValue: Number(s.purchase_price) || 0,
    sellingValue: Number(s.selling_price) || 0,
    loadingTime: s.pick_time || '',
    driverName: s.driver?.admin?.name || '',
    driverPhone: s.driver?.admin?.phone || '',
    carName: loc(s.car),
    plateNumber: s.car?.plate_number || '',
    truckType: loc(s.truck_type),
    truckSize: loc(s.truck_size),
    loadType: loc(s.load_type),
    quantity: s.qty != null ? String(s.qty) : '',
    goodsValue: Number(s.goods_value_price) || 0,
    reference: s.reference_num || '',
    representativeName: s.delegate?.name || '',
    country: loc(s.country),
    driverRentalType: s.driver_rental_type || '',
    driverCost: Number(s.driver_rental_price) || 0,
    ownerName: s.car?.owner?.owner_name || '',
    ownerPhone: s.car?.owner?.owner_phone || '',
    externalSource: SOURCE,
    externalId: String(s.id),
    externalUpdatedAt: s.updated_at ? String(s.updated_at) : '',
    lastSyncedAt: new Date(),
  };
  const setOnInsert = {
    reportNumber: s.graduation_statement_num != null ? String(s.graduation_statement_num) : `UPL-${s.id}`,
    stage: 'draft',
  };
  return { set, setOnInsert };
}

// ── ولا يُختَم المنقولُ باسمِ إنسان ─────────────────────────────────────────
// كانت هنا `getSysUserId` تأخذ أوّلَ `super_admin` تجده في القاعدة وتضعه
// `createdBy` على كلّ صفٍّ تنشئه المزامنة. فظهر أربعةٌ وثلاثون ألفَ كشفٍ
// «أنشأتها فتون» — وهي لم تفتح واحدًا منها. والمنقولُ من المنصّة لا مُنشئَ له
// عندنا، وقولُ «لا أحد» أصدقُ من تسمية من لم يفعل.
//
// وشاشةُ التفاصيل تقرأ `externalSource` فتقول «منصّة التشغيل (تلقائي)» — فلا
// تبقى الخانةُ فارغةً بلا تفسير.

// Upsert a batch of shipments into OperationsWorkflow (used by both the full sync
// and the live poll). Soft-deleted shipments (deleted_at set) are removed instead.
// Refreshes only the UPL-derived columns; manual columns are $setOnInsert-only.
/**
 * صفةُ كلّ عميلٍ من صفحة «أنواع الدفع» — مفتاحُ الاسم المطويّ ← cash | tax.
 *
 * تُقرأ مرّةً لكلّ دفعةٍ لا مرّةً لكلّ شحنة، وتُحفَظ تحت بادئة `wf:` — وهي التي
 * تُمسَح حين يُغيَّر نوعُ عميلٍ من تلك الصفحة، فتسري الصفةُ الجديدة على أوّل
 * مزامنةٍ بعدها بلا انتظار.
 */
/**
 * ── والاسمُ الوارد يُردّ إلى اسمِ العميل المعتمَد ──────────────────────────
 *
 * اسمُ العميل يُصحَّح في المنصّة (أو من شاشة العملاء عندنا)، ويبقى في حمولاتٍ
 * قديمةٍ بصيغته الأولى — فتأتي المزامنةُ بالقديم وتكتبه فوق الصحيح. وقد وقع:
 * أربعةُ آلافٍ وثلاثُمئةٍ وستّةٌ وتسعون كشفًا عادت إلى أسمائها القديمة بعد
 * مطابقة الأسماء.
 *
 * فكلُّ اسمٍ يمرّ على أسماء أطراف التحصيل وصيغِها البديلة (`aliasKeys` — وفيها
 * الاسمُ القديم لكلّ من أُعيدت تسميتُه، راجع utils/renameOpsCustomer): إن عُرف
 * كُتب الاسمُ المعتمَد، وإلّا بقي كما جاء. فالتصحيحُ يثبت ولا يُدهَس، وصيغُ
 * الاسم الواحد تجتمع على صفٍّ واحدٍ في كلّ شاشة.
 */
/**
 * ── وخريطتا العملاء لا تُمسحان مع فلاتر الجدول ──────────────────────────────
 * كانتا تحت بادئة `wf:` — وهي البادئةُ التي تُمسَح عند **كلّ** كتابةٍ على كشف،
 * وفي آخر هذه الدالّة نفسِها. فكلُّ مزامنةٍ كانت تُبطل خريطتَي نفسِها، وتُقرأ
 * في التي تليها من القاعدة من جديد: قُيس ذلك — ٢٫٣ ثانيةٍ للأسماء و١٫٢ للأنواع،
 * أي أربعُ ثوانٍ لمزامنةِ **شحنةٍ واحدة**، وهي ثوانٍ ينتظرها مَن غيّر الحالة.
 *
 * وهما لا تتبعان الكشوفَ أصلًا بل أطرافَ التحصيل، فلهما بادئتُهما: تُمسَح حين
 * يُعاد تسميةُ عميلٍ أو يُغيَّر نوعُه (renameOpsCustomer · paymentTypesController)
 * لا حين تُكتب خانةٌ في كشف.
 */
async function canonicalNameMap() {
  return cache.wrap('wfparty:canonicalCustomerName', 60000, async () => {
    const CollectionsParty = require('../models/CollectionsParty');
    const rows = await CollectionsParty.find({ kind: 'customer', isActive: { $ne: false } })
      .select('name nameKey aliasKeys').lean();
    const out = {};
    for (const p of rows) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const keys = [p.nameKey || CollectionsParty.fold(name), ...(p.aliasKeys || [])];
      for (const k of keys) if (k && !out[k]) out[k] = name;
    }
    return out;
  });
}

async function customerTypeMap() {
  return cache.wrap('wfparty:paymentTypeByCustomer', 60000, async () => {
    const CollectionsParty = require('../models/CollectionsParty');
    const rows = await CollectionsParty.find({ kind: 'customer', paymentType: { $in: ['cash', 'tax'] } })
      .select('name nameKey paymentType').lean();
    const out = {};
    for (const p of rows) {
      const k = p.nameKey || CollectionsParty.fold(p.name || '');
      if (k) out[k] = p.paymentType;
    }
    return out;
  });
}

async function upsertShipments(ships) {
  if (!ships || !ships.length) return { created: 0, updated: 0, removed: 0 };
  const live = ships.filter((s) => s && s.id && !s.deleted_at);
  const deletedIds = ships.filter((s) => s && s.id && s.deleted_at).map((s) => String(s.id));

  // ── ونوعُ الدفع يُكتب مع الكشف لا بعده بأسبوع ─────────────────────────────
  // كانت المزامنةُ لا تمسّ `paymentType` أصلًا، فيولد الكشفُ بلا نوعٍ ويبقى
  // فارغًا حتى يفتح أحدٌ صفحةَ «أنواع الدفع» ويضغط زرًّا. وأثرُه أنّ أربعةَ
  // آلافٍ وستَّمئةٍ وأربعةً وأربعين كشفًا لها تاريخُ سدادٍ ولا نوعَ لها — أي
  // أنّها مستحقّةٌ للتحصيل ولا تظهر في شاشةِ تحصيلٍ أصلًا، لا في الكاش ولا في
  // الضريبيّ.
  //
  // فصار يُشتقّ في المزامنة نفسِها: صفةُ العميل، وتغلبها طريقةُ الدفع النقديّة
  // إن قالتها المنصّةُ عن هذه الحمولة (وهو الاستثناءُ الوحيد). راجع
  // utils/paymentType.
  const typeByCustomer = await customerTypeMap();
  const canonicalName = await canonicalNameMap();
  const { fold } = require('../models/CollectionsParty');

  const ops = live.map((s) => {
    const { set, setOnInsert } = mapShipment(s);
    // الاسمُ المعتمَد لا الوارد — راجع canonicalNameMap.
    const canon = canonicalName[fold(set.username || '')];
    if (canon) set.username = canon;
    // ── النوعُ يُشتقّ بالقاعدة كاملةً ────────────────────────────────────────
    // صفةُ العميل، وتنقضها طريقةُ الدفع النقديّة للكشوف الجديدة وحدَها، وتعلوهما
    // فاتورةٌ صادرة. راجع utils/paymentType — والقياسُ على `reportDate` لأنّ
    // القاعدة تسري من أوّل سبتمبر.
    const custType = typeByCustomer[fold(s.user?.name || '')] || '';
    const shipDate = s.pick_time ? new Date(s.pick_time) : (s.created_at ? new Date(s.created_at) : null);
    const derived = derivePaymentTypeFor(
      { reportDate: shipDate, paymentMethod: s.payment_method },
      custType,
    );
    return {
      updateOne: {
        filter: { externalSource: SOURCE, externalId: String(s.id) },
        // ── إلّا قيمةَ بيعٍ صُحِّحت من دفتر التحصيل ────────────────────────
        // تُكتب الحقولُ كلُّها من المنصّة إلّا `sellingValue` متى كان مصدرُها
        // الدفتر: هو المرجعُ في الكشف النقديّ، وبدون هذا الشرط تعود القيمةُ
        // القديمة في أوّل مزامنةٍ بعد التصحيح — وقد عادت.
        // (خطُّ تجميعٍ لا `$set` عاديّ، فالشرطُ يحتاج قراءةَ الصفّ نفسِه.)
        update: [
          {
            $set: {
              ...set,
              sellingValue: {
                $cond: [
                  { $eq: [{ $ifNull: ['$sellingValueSource', ''] }, 'collections_book'] },
                  { $ifNull: ['$sellingValue', 0] },
                  set.sellingValue,
                ],
              },
              // ── ولا يُبدَّل نوعٌ مكتوبٌ أصلًا ────────────────────────────
              // يُملأ الفارغُ وحدَه. واختيارُ اليد لا يُمسّ أبدًا (`manual`)،
              // والمشتقُّ سابقًا يبقى كما هو: قلبُ نوعِ كشفٍ قديمٍ يغيّر أين
              // يُفوتَر وأين يُحصَّل، وذلك قرارٌ يُتّخذ من صفحة «أنواع الدفع»
              // بعددٍ معروضٍ قبله، لا أثرٌ جانبيٌّ لمزامنةٍ تجري كلَّ دقيقة.
              // ── صفةُ العميل تحكم، وتعلوها فاتورةٌ صادرةٌ واختيارُ يد ────────
              // كشفٌ يحمل رقمَ فاتورةٍ أو ضريبةً محسوبة فقد فُوتِر ضريبيًّا فعلًا،
              // والورقةُ التي خرجت للعميل أقوى من صفةٍ عامّة.
              paymentType: derived ? {
                $cond: [
                  { $eq: [{ $ifNull: ['$paymentTypeSource', ''] }, 'manual'] },
                  { $ifNull: ['$paymentType', ''] },
                  {
                    $cond: [
                      {
                        $or: [
                          { $gt: [{ $ifNull: ['$tax', 0] }, 0] },
                          { $gt: [{ $ifNull: ['$netInvoice', 0] }, 0] },
                          {
                            $and: [
                              { $ne: [{ $ifNull: ['$invoiceNumber', ''] }, ''] },
                              { $not: [{ $regexMatch: { input: { $toString: { $ifNull: ['$invoiceNumber', ''] } }, regex: '^\\s*(no\\s*inv|بدون|لا\\s*يوجد|-|—|ىى)\\s*$', options: 'i' } }] },
                            ],
                          },
                        ],
                      },
                      'tax',
                      derived,
                    ],
                  },
                ],
              } : { $ifNull: ['$paymentType', ''] },
              paymentTypeSource: derived ? {
                $cond: [
                  { $eq: [{ $ifNull: ['$paymentTypeSource', ''] }, 'manual'] },
                  'manual',
                  'auto',
                ],
              } : { $ifNull: ['$paymentTypeSource', ''] },
            },
          },
          { $set: Object.fromEntries(Object.entries(setOnInsert).map(([k, v]) => [k, { $ifNull: [`$${k}`, v] }])) },
        ],
        upsert: true,
      },
    };
  });

  // ── والعميلُ الجديد يدخل قسمَ التحصيل بكوده ────────────────────────────────
  //
  // كان سجلُّ أطراف التحصيل يُملأ بسكربتٍ يُشغَّل باليد، فمن أنشأت له العمليّاتُ
  // كشفًا اليومَ لا يظهر في القسم حتّى يتذكّر أحدٌ تشغيلَه. والقسمُ يعمل بالكود:
  // به تُنسَب الفاتورة، وبه يُطابَق الدفتر، وبه تُقرأ المديونيّة — فالعميلُ بلا
  // كودٍ عميلٌ يُشحَن له ولا يُحصَّل منه.
  //
  // فيُنشأ مع أوّل كشف. ونوعُه يُشتقّ بالقاعدة نفسِها التي تُشتقّ بها صفةُ
  // الكشف أعلاه، لا بقاعدةٍ ثانيةٍ تفترق عنها.
  const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
  const seenNames = new Map();
  for (const s of live) {
    const nm = String(s.user?.name || '').trim();
    if (!nm || seenNames.has(fold(nm))) continue;
    const custType = typeByCustomer[fold(nm)] || '';
    const shipDate = s.pick_time ? new Date(s.pick_time) : (s.created_at ? new Date(s.created_at) : null);
    seenNames.set(fold(nm), {
      name: nm,
      paymentType: custType || derivePaymentTypeFor({ reportDate: shipDate, paymentMethod: s.payment_method }, '') || '',
    });
  }
  // ── ولا يُسأل عن العميل نفسِه في كلّ دورة ──────────────────────────────
  // العميلُ بلا كودٍ كان يُصنَّف من جديد في كلّ مزامنة — وهي قراءاتٌ وكتابةٌ
  // تكلّف نحوَ ثانيةٍ ونصفٍ لكلّ اسم، تتكرّر كلَّ خمسَ عشرةَ ثانيةً بلا جديد
  // (التصنيفُ لا يتغيّر من تلقائه). فمَن سُئل عنه يُسجَّل عشرَ دقائق.
  //
  // والذاكرةُ لا تُخفي عميلًا جديدًا: اسمٌ لم يُسأل عنه قطُّ ليس فيها.
  const ASKED_TTL = 10 * 60 * 1000;
  let newParties = 0;
  for (const { name, paymentType } of seenNames.values()) {
    const askedKey = `wfparty:ensured:${fold(name)}`;
    if (cache.get(askedKey)) continue;
    try {
      const CP = require('../models/CollectionsParty');
      const before = await CP
        // طرفٌ قائمٌ **بكود** لا يُعاد إليه؛ أمّا القائمُ بلا كود فيُمرَّر ليأخذه.
        .countDocuments({ kind: 'customer', code: { $gt: '' }, $or: [{ nameKey: CP.fold(name) }, { aliasKeys: CP.fold(name) }] });
      if (before) { cache.set(askedKey, 1, ASKED_TTL); continue; }
      const p = await ensureCollectionsParty(name, { paymentType, source: 'operations_workflow' });
      cache.set(askedKey, 1, ASKED_TTL);
      // ── ويُعَدُّ الجديدُ وحدَه ──────────────────────────────────────────
      // كان يُعَدُّ كلُّ ما رجعت به الدالّة — وهي ترجع القائمَ كما ترجع
      // المُنشأ. فكان السجلُّ يقول «عميلٌ جديد» في كلّ دورةٍ عن عميلٍ قديم.
      if (p && p.createdAt && Date.now() - new Date(p.createdAt).getTime() < 60000) newParties += 1;
    } catch (e) {
      // عميلٌ لم يُنشأ لا يوقف مزامنةَ الشحنات: الكشفُ يدخل، والطرفُ يُنشأ في
      // المزامنة التالية أو بيد القسم.
      console.error('[ops-sync] تعذّر إنشاء طرف التحصيل:', name, e.message);
    }
  }
  if (newParties) console.log(`[ops-sync] عملاءُ جددٌ دخلوا قسمَ التحصيل بأكوادهم: ${newParties}`);

  let created = 0; let updated = 0; let removed = 0;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const res = await OperationsWorkflow.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    created += res.upsertedCount || 0;
    updated += res.modifiedCount || 0;
  }
  if (deletedIds.length) {
    const r = await OperationsWorkflow.deleteMany({ externalSource: SOURCE, externalId: { $in: deletedIds } });
    removed = r.deletedCount || 0;
  }
  // المزامنة تُدخل حالاتٍ وفروعًا جديدة، وقوائم قيم الفلتر مخزَّنة مؤقّتًا؛ فبغير
  // إبطالها يفلتر المستخدم على قائمةٍ تسبق آخر مزامنة فلا يرى الكشوف الجديدة.
  if (created || updated || removed) { try { cache.clear('wf:'); } catch (e) {} }
  return { created, updated, removed };
}

/**
 * ── وما كتبناه نحن لا يُنتظَر فيه دورُ الاستطلاع ────────────────────────────
 *
 * حين تُغيَّر حالةُ شحنةٍ من شاشاتنا نحن (صفحة الطلبات أو جدول سير العمل)،
 * كانت الكتابةُ تذهب إلى المنصّة وحدَها، ويبقى صفُّنا على حالته القديمة حتى
 * يمرّ الاستطلاعُ عليه. فيرى مَن غيّرها بيده أنّ شيئًا لم يحدث — فيغيّرها
 * ثانيةً. والمنصّةُ هي المرجع، لكنّ ما كتبناه إليها نعرفه لحظةَ كتابته: فتُقرأ
 * الشحنةُ منها بعد الكتابة مباشرةً ويُكتب صفُّها عندنا ويُبَثّ.
 *
 * وتُقرأ من المنصّة ولا يُفترَض جوابُها: قد تردّ الحالةَ مختلفةً (قيدٌ في
 * تسلسل الحالات عندهم)، والصحيحُ أن نعرض ما استقرّ هناك لا ما طلبناه.
 *
 * @param {string[]} ids معرّفاتُ الشحنات في المنصّة
 */
async function syncShipmentsById(ids) {
  const list = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!list.length) return { rows: [], created: 0, updated: 0, removed: 0 };
  const ships = [];
  await Promise.all(list.slice(0, 50).map(async (id) => {
    try {
      const out = await upl.get(`/admin/shipments/${encodeURIComponent(id)}`);
      const d = out?.data ?? out;
      if (d && d.id) ships.push(d);
    } catch (_) { /* شحنةٌ تعذّرت قراءتُها — الاستطلاعُ يلحقها */ }
  }));
  if (!ships.length) return { rows: [], created: 0, updated: 0, removed: 0 };
  const res = await upsertShipments(ships);

  // وقسمُ طلبات الشحنات يتبع كذلك — هو نظامُنا لا مرآة.
  try {
    const { upsertPlatformShipments } = require('./shipmentOrderSyncService');
    const r = await upsertPlatformShipments(ships);
    if (r.created || r.updated) emitToAll('shipmentOrders:updated', { source: 'platform', ...r });
  } catch (_) { /* */ }

  const rows = await OperationsWorkflow.find({
    externalSource: SOURCE, externalId: { $in: ships.map((s) => String(s.id)) },
  }).lean();

  // ── والخبرُ يُبَثّ إلى العاملَين لا إلى واحد ────────────────────────────
  // `workflow:updated` يُرسَل بـ`emitPerRole` — حلقةٌ على مقابس هذا العامل
  // وحدَه، لأنّ الصفَّ يُحجَب بحسب الدور قبل إرساله. فالنصفُ المتّصلُ بالعامل
  // الآخر لا يسمع شيئًا. وهذا الخبرُ لا يحمل صفًّا أصلًا — أرقامَ الشحنات
  // وحالاتِها — فيُبَثّ للجميع عبر المحوّل، وكلُّ شاشةٍ تُعيد جلبَ صفوفها
  // بحجبها المعتاد.
  try {
    emitToAll('workflow:bulkImported', {
      source: SOURCE, live: true, write: true,
      statuses: ships.map((s) => ({ id: String(s.id), status: String(s.status || '') })),
    });
  } catch (_) { /* */ }
  return { rows, ...res };
}

// Full reconciliation pass: pull every shipment and upsert. Heavy — runs on a
// long interval; the live poll keeps things current in between.
async function syncOnce() {
  if (running) return { skipped: 'running' };
  if (!upl.isConfigured()) return { skipped: 'not-configured' };
  running = true;
  try {
    const ships = await fetchAllShipments();
    if (!ships.length) return { total: 0 };
    const res = await upsertShipments(ships);
    try { emitToAll('workflow:bulkImported', { source: SOURCE, count: ships.length }); } catch (e) {}
    console.log(`[opsWorkflowSync] full sync: ${ships.length} shipments -> created ${res.created}, updated ${res.updated}, removed ${res.removed}`);
    return { total: ships.length, ...res };
  } catch (e) {
    console.error('[opsWorkflowSync] error:', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startOpsWorkflowSync() {
  if (timer) return;
  if (!upl.isConfigured()) {
    console.log('[opsWorkflowSync] UPL not configured — disabled');
    return;
  }
  // Full reconciliation is the safety net; the live poll (opsPoll) keeps the rows
  // current within seconds, so the full pass can run infrequently.
  const minutes = Math.max(30, parseInt(process.env.UPL_WORKFLOW_SYNC_MIN || '360', 10));
  timer = setInterval(() => { syncOnce().catch(() => {}); }, minutes * 60 * 1000);
  setTimeout(() => { syncOnce().catch(() => {}); }, 25000); // initial run after boot
  console.log(`[opsWorkflowSync] full sync scheduled every ${minutes} min (live updates via poll)`);
}

module.exports = {
  startOpsWorkflowSync, syncOnce, upsertShipments, syncShipmentsById,
};
