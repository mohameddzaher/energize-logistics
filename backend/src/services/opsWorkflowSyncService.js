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
    const out = await upl.get('/admin/shipments', { query: { page, limit, 'sort[updated_at]': 'desc' } });
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
async function upsertShipments(ships) {
  if (!ships || !ships.length) return { created: 0, updated: 0, removed: 0 };
  const live = ships.filter((s) => s && s.id && !s.deleted_at);
  const deletedIds = ships.filter((s) => s && s.id && s.deleted_at).map((s) => String(s.id));

  const ops = live.map((s) => {
    const { set, setOnInsert } = mapShipment(s);
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
            },
          },
          { $set: Object.fromEntries(Object.entries(setOnInsert).map(([k, v]) => [k, { $ifNull: [`$${k}`, v] }])) },
        ],
        upsert: true,
      },
    };
  });

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

module.exports = { startOpsWorkflowSync, syncOnce, upsertShipments };
