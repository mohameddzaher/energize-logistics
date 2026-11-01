/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ربطُ كشوف التشغيل بمعاملات التخليص
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * كشفُ التخريج (`OperationsWorkflow`) قد يكون نقلةً لحاويةٍ من معاملة تخليص:
 * من الميناء إلى الساحة، أو إلى العميل، أو إرجاعَها إلى الوكيل. وكان ذلك لا
 * يُعرف من الكشف نفسِه — يُسأل قسمُ التخليص فيبحث في أوراقه. فيُكتب الربطُ على
 * الكشف (`customsLink`) نسخةً مقروءةً: المعاملةُ ورقمُها والبوليصةُ والحاويات،
 * فيعرضها جدولُ التشغيل وشاشاتُ التحصيل بلا استعلامٍ ثانٍ.
 *
 * ── من أين يأتي الربط (بترتيب القوّة) ──────────────────────────────────────
 *
 *   `move`      رقمُ الكشف مكتوبٌ في معاملة التخليص نفسِها: خانةُ نقل الحاوية
 *               بسيّارة الشركة (`containers[].moves[].ref`) أو إرجاعِها
 *               (`returnRef`). قولُ قسم التخليص صراحةً — أقوى الأدلّة.
 *   `bl`        «رقم السند» في الكشف هو رقمُ البوليصة نفسُه. يُطابَق بعد نزع
 *               المسافات والشرطات، وبحرف الناقل الأربعة أو بدونها
 *               (COSU6444523620 = 6444523620). وبأيّ طول، ولا تُقبل بوليصةٌ
 *               تحملها أكثرُ من معاملة.
 *   `container` «رقم السند» هو رقمُ حاويةٍ مسجّلةٍ في معاملةٍ واحدة.
 *   `manual`    ربطه موظّفٌ بيده من صفحة الكشف — لا يغيّره دليلٌ آليّ.
 *   `unlinked`  فكّه موظّفٌ بيده — فلا يعيده دليلٌ آليّ ضعيف (`bl`/`container`).
 *               أمّا `move` فيعيده: قسمُ التخليص كتب الرقمَ في معاملته بعد ذلك.
 *
 * والمطابقةُ تامّةٌ لا احتواء: «يحتوي» يصطاد رقمَ سندٍ قصيرًا داخل بوليصةٍ طويلة.
 *
 * ── متى يُعاد الحساب ───────────────────────────────────────────────────────
 *   • كلُّ حفظٍ لمعاملة تخليص (خطّافُ النموذج) ← `queueClearance`.
 *   • تعديلُ «رقم السند» في كشف ← `resolveReports`.
 *   • دخولُ كشوفٍ جديدةٍ من منصّة التشغيل ← `linkPendingMoveRefs`: قد يكتب
 *     التخليصُ رقمَ الكشف قبل أن يصلنا.
 *
 * وكلُّ كتابةٍ تمسح ذاكرةَ الشاشات أوّلًا ثمّ تبثّ (راجع announce-before-invalidate).
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');
const { westernDigits } = require('../utils/arabicSearch');

const INDEX_KEY = 'customslink:index';
const INDEX_TTL = 60 * 1000;
const VIA = ['move', 'bl', 'container', 'manual', 'unlinked'];
const AUTO_VIA = ['move', 'bl', 'container'];

// ── التطبيع ─────────────────────────────────────────────────────────────────
/** حروفٌ لاتينيّةٌ كبيرةٌ وأرقامٌ غربيّة فقط — «MRKU 701-6023» = «MRKU7016023». */
const normKey = (s) => westernDigits(String(s == null ? '' : s)).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * مفاتيحُ البوليصة: الرقمُ كاملًا، ومعه بلا بادئة الناقل (أربعةُ حروفٍ يليها
 * رقم) — فالسندُ يُكتب بها أحيانًا وبدونها أحيانًا. Any length: match is exact.
 */
function blKeysOf(bl) {
  const k = normKey(bl);
  if (!k) return [];
  const out = [k];
  const m = k.match(/^[A-Z]{4}(\d[A-Z0-9]{7,})$/);
  if (m) out.push(m[1]);
  return out;
}

/** Container (or chassis) key, any length: staff write these numbers as they come. */
const unitKeyOf = (s) => normKey(s);

const idOf = (v) => (v ? String(v._id || v) : '');

// ── فهرسُ المعاملات ────────────────────────────────────────────────────────
/**
 * المعاملاتُ مئاتٌ لا آلاف، فتُقرأ كلُّها مرّةً وتُحفظ دقيقة: ما يحتاجه الربطُ
 * منها أرقامٌ قليلة. ويُمسح الفهرسُ مع كلّ حفظِ معاملة (`queueClearance`).
 */
async function loadIndex() {
  return cache.wrap(INDEX_KEY, INDEX_TTL, async () => {
    const CustomsClearance = require('../models/CustomsClearance');
    // الملغاةُ تُقرأ لاسمها وحده (ربطٌ يدويٌّ إليها يبقى) ولا يُطابَق عليها شيء.
    const rows = await CustomsClearance.find({})
      .select('refNumber blNumber customerName cancelled containers.containerNumber containers.moves containers.returnRef containers.returnVehicleKind')
      .lean();
    const meta = new Map();
    const byReport = new Map();   // رقمُ الكشف ← { id, units:Set }
    const byBl = new Map();       // مفتاحُ البوليصة ← Set(معرّفات)
    const byUnit = new Map();     // مفتاحُ الحاوية ← { ids:Set, raw }
    const byShortUnit = new Map(); // Container without its last check digit, as people often type it.
    const add = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    for (const c of rows) {
      const id = String(c._id);
      meta.set(id, {
        refNumber: c.refNumber || '', blNumber: c.blNumber || '', customerName: c.customerName || '',
        units: (c.containers || []).map((u) => String(u.containerNumber || '').trim()).filter(Boolean),
      });
      if (c.cancelled) continue;
      for (const k of blKeysOf(c.blNumber)) add(byBl, k, id);
      for (const u of c.containers || []) {
        const unit = String(u.containerNumber || '').trim();
        const uk = unitKeyOf(unit);
        if (uk) {
          if (!byUnit.has(uk)) byUnit.set(uk, { ids: new Set(), raw: unit });
          byUnit.get(uk).ids.add(id);
          if (uk.length === 11) {
            const short = uk.slice(0, 10);
            if (!byShortUnit.has(short)) byShortUnit.set(short, { ids: new Set(), raw: unit });
            byShortUnit.get(short).ids.add(id);
          }
        }
        // Any vehicle kind: the screen takes a number for both, and only an exact report number ever matches.
        const refs = (u.moves || []).filter((m) => m && String(m.ref || '').trim())
          .map((m) => String(m.ref).trim());
        if (String(u.returnRef || '').trim()) refs.push(String(u.returnRef).trim());
        for (const r of refs) {
          if (!byReport.has(r)) byReport.set(r, new Map());
          const per = byReport.get(r);
          if (!per.has(id)) per.set(id, new Set());
          if (unit) per.get(id).add(unit);
        }
      }
    }
    return { meta, byReport, byBl, byUnit, byShortUnit };
  });
}

const unitHit = (idx, uk) => idx.byUnit.get(uk) || (uk.length === 10 ? idx.byShortUnit.get(uk) : null);

/**
 * الربطُ الآليّ لكشفٍ واحد — أو `null`. لا يقرأ القاعدة: الفهرسُ محمَّلٌ سلفًا.
 * كشفٌ تذكره معاملتان في خانات النقل لا يُربط بإحداهما (لا تخمين).
 */
function autoLinkFor(report, idx) {
  const rn = String(report.reportNumber || '').trim();
  const per = rn ? idx.byReport.get(rn) : null;
  if (per && per.size === 1) {
    const [[id, units]] = [...per.entries()];
    return { id, via: 'move', containers: [...units] };
  }
  // A row of a shipment made here is read with both of the shipment's numbers: documentNumber
  // keeps only one of them, so a B/L with no match would hide a container that has one.
  const unit = String(report.shipmentContainer || '').trim();
  const docs = [...new Set([report.documentNumber, report.shipmentBl, unit].map((d) => String(d || '').trim()).filter(Boolean))];
  for (const doc of docs) {
    const ids = new Set();
    for (const key of [normKey(doc), ...blKeysOf(doc)]) for (const id of idx.byBl.get(key) || []) ids.add(id);
    if (ids.size === 1) return { id: [...ids][0], via: 'bl', containers: unit ? [unit] : [] };
  }
  for (const doc of docs) {
    const uk = unitKeyOf(doc);
    const u = uk ? unitHit(idx, uk) : null;
    if (u && u.ids.size === 1) return { id: [...u.ids][0], via: 'container', containers: [u.raw] };
  }
  return null;
}

/** النسخةُ التي تُكتب على الكشف. */
function snapshot(idx, id, via, containers, extra = {}) {
  const m = idx.meta.get(String(id)) || {};
  return {
    clearance: new mongoose.Types.ObjectId(String(id)),
    refNumber: m.refNumber || '',
    blNumber: m.blNumber || '',
    customerName: m.customerName || '',
    containers: [...new Set((containers || []).filter(Boolean))].sort(),
    via,
    ...extra,
  };
}

const sameLink = (a, b) => {
  const x = a || {}; const y = b || {};
  return idOf(x.clearance) === idOf(y.clearance)
    && (x.via || '') === (y.via || '')
    && (x.refNumber || '') === (y.refNumber || '')
    && (x.blNumber || '') === (y.blNumber || '')
    && (x.customerName || '') === (y.customerName || '')
    && (x.containers || []).join('|') === (y.containers || []).join('|');
};

/**
 * ما يجب أن يكون عليه ربطُ الكشف الآن — بحسب ما هو عليه وما تقوله الأدلّة.
 * يُرجع `undefined` = لا تغيير.
 */
function decide(report, idx) {
  const cur = report.customsLink || null;
  const via = cur && cur.via;
  const auto = autoLinkFor(report, idx);
  if (via === 'manual') {
    // اليدويُّ باقٍ، وتُحدَّث نسختُه وحدها (رقمٌ أو بوليصةٌ تغيّرت في المعاملة).
    const id = idOf(cur.clearance);
    if (!idx.meta.has(id)) return null; // معاملةٌ حُذفت — لا شيءَ يُربط به
    const next = snapshot(idx, id, 'manual', cur.containers, { at: cur.at, byName: cur.byName });
    return sameLink(cur, next) ? undefined : next;
  }
  if (via === 'unlinked' && !(auto && auto.via === 'move')) return undefined;
  if (!auto) {
    if (via && AUTO_VIA.includes(via)) return null; // زال الدليل — يُفكّ
    return undefined;
  }
  const next = snapshot(idx, auto.id, auto.via, auto.containers, { at: (cur && idOf(cur.clearance) === auto.id && cur.at) || new Date(), byName: '' });
  return sameLink(cur, next) ? undefined : next;
}

const REPORT_FIELDS = '_id reportNumber documentNumber customsLink shipmentOrder';

/** Adds each row's shipment numbers, which `autoLinkFor` reads alongside documentNumber. */
async function withShipmentNumbers(rows) {
  const ids = rows.map((r) => r.shipmentOrder).filter(Boolean);
  if (!ids.length) return rows;
  const ShipmentOrder = require('../models/ShipmentOrder');
  const orders = new Map((await ShipmentOrder.find({ _id: { $in: ids } }).select('blNumber containerNumber').lean()).map((o) => [String(o._id), o]));
  return rows.map((r) => {
    const o = orders.get(String(r.shipmentOrder));
    return o ? { ...r, shipmentBl: o.blNumber, shipmentContainer: o.containerNumber } : r;
  });
}

/**
 * يعيد حسابَ ربط كشوفٍ بعينها ويكتب ما تغيّر. `rows` صفوفٌ خفيفة أو شرطُ بحث.
 * @returns {{changed:number, reportNumbers:string[], clearanceIds:string[]}}
 */
async function resolveReports(rowsOrFilter, { emit = true, dryRun = false } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const rows = await withShipmentNumbers(Array.isArray(rowsOrFilter)
    ? rowsOrFilter
    : await OperationsWorkflow.find(rowsOrFilter).select(REPORT_FIELDS).lean());
  if (!rows.length) return { changed: 0, reportNumbers: [], clearanceIds: [], changes: [] };
  const idx = await loadIndex();
  const ops = []; const changes = []; const clearanceIds = new Set();
  for (const r of rows) {
    const next = decide(r, idx);
    // A row with no number of its own shows the clearance's. Rows of shipments made here
    // get theirs from the shipment, and fleet loads have nowhere else to hold it.
    const link = next === undefined ? r.customsLink : next;
    const fill = link && link.clearance && !r.shipmentOrder && !String(r.documentNumber || '').trim()
      ? ((link.containers || []).length === 1 ? link.containers[0] : link.blNumber) : '';
    if (next === undefined && !fill) continue;
    if (next !== undefined) {
      if (r.customsLink && r.customsLink.clearance) clearanceIds.add(idOf(r.customsLink.clearance));
      if (next && next.clearance) clearanceIds.add(idOf(next.clearance));
      changes.push({ _id: r._id, reportNumber: r.reportNumber, from: r.customsLink || null, to: next });
    }
    const set = { ...(next ? { customsLink: next } : {}), ...(fill ? { documentNumber: fill } : {}) };
    const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(next === null ? { $unset: { customsLink: 1 } } : {}) };
    ops.push({ updateOne: { filter: { _id: r._id }, update } });
  }
  if (ops.length && !dryRun) {
    for (let i = 0; i < ops.length; i += 500) await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    if (emit) announce({ reportNumbers: changes.map((c) => c.reportNumber), clearanceIds: [...clearanceIds] });
  }
  return { changed: ops.length, reportNumbers: changes.map((c) => c.reportNumber), clearanceIds: [...clearanceIds], changes };
}

/** نمطٌ يطابق المفتاحَ مكتوبًا بأيّ مسافاتٍ أو شرطاتٍ أو حالةِ أحرف، كاملًا لا جزءًا. */
const looseRx = (key) => `^[\\s\\-/._]*${key.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-/._]*')}[\\s\\-/._]*$`;

/**
 * يعيد حسابَ كلِّ كشفٍ يمكن أن يتأثّر بمعاملةٍ واحدة: المربوطُ بها الآن،
 * والمذكورُ رقمُه في خاناتها، ومَن «رقم سنده» بوليصتُها أو إحدى حاوياتها.
 */
async function syncClearance(clearanceId, opts = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const CustomsClearance = require('../models/CustomsClearance');
  const id = String(clearanceId);
  const c = await CustomsClearance.findById(id).select('blNumber containers.containerNumber containers.moves containers.returnRef containers.returnVehicleKind').lean();
  const or = [{ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }];
  if (c) {
    const refs = new Set();
    const keys = new Set(blKeysOf(c.blNumber));
    for (const u of c.containers || []) {
      for (const m of u.moves || []) if (m && String(m.ref || '').trim()) refs.add(String(m.ref).trim());
      if (String(u.returnRef || '').trim()) refs.add(String(u.returnRef).trim());
      const uk = unitKeyOf(u.containerNumber);
      if (uk) keys.add(uk);
      if (uk.length === 11) keys.add(uk.slice(0, 10));
    }
    if (refs.size) or.push({ reportNumber: { $in: [...refs] } });
    if (keys.size) or.push({ documentNumber: { $regex: [...keys].map(looseRx).join('|'), $options: 'i' } });
    // وطلباتُ الشحن معها — راجع resolveShipments.
    try {
      const filter = shipmentFilterFor(id, c, refs, keys);
      await resolveShipments(filter, opts);
      // Their rows too: a row whose documentNumber is the shipment's other number is not reached above.
      const ShipmentOrder = require('../models/ShipmentOrder');
      const orders = await ShipmentOrder.find(filter).select('_id').lean();
      if (orders.length) or.push({ shipmentOrder: { $in: orders.map((o) => o._id) } });
    } catch (e) { console.error('[customs-link] طلبات الشحن:', e.message); }
  } else {
    try { await resolveShipments({ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }, opts); } catch (_) { /* */ }
  }
  return resolveReports({ $or: or }, opts);
}

/**
 * كشوفٌ ذكرها التخليصُ في خاناته ولم تُربط بعد — تصل من المنصّة بعد أن يُكتب
 * رقمُها هناك. تُسأل بعد كلّ مزامنةٍ أدخلت كشوفًا جديدة؛ والسؤالُ على الفهرس.
 */
async function linkPendingMoveRefs(opts = {}) {
  const idx = await loadIndex();
  const nums = [...idx.byReport.keys()];
  if (!nums.length) return { changed: 0, reportNumbers: [], clearanceIds: [] };
  try {
    const n = nums.map(Number).filter((x) => Number.isFinite(x));
    await resolveShipments({ 'customsLink.via': { $nin: ['move', 'manual'] }, $or: [{ reference: { $in: nums } }, ...(n.length ? [{ graduationNumber: { $in: n } }, { waybillNumber: { $in: n } }] : [])] }, opts);
  } catch (e) { console.error('[customs-link] طلبات الشحن:', e.message); }
  return resolveReports({ reportNumber: { $in: nums }, 'customsLink.via': { $nin: ['move', 'manual'] } }, opts);
}

// ═══ ربطُ طلبات الشحن (٢٠٢٦/١٠/٢٦) ═══════════════════════════════════════════
// صاحبُ الشركة: «رقم البوليصة ورقم الحاوية في إنشاء الشحنة… مربوطين بالتخليص؛ لو
// اتعملت من هنا تسمع في التخليص، ولو اتعملت من التخليص تتربط معانا هنا». فطلبُ
// الشحن يُربط بالأدلّة نفسِها التي يُربط بها كشفُ التشغيل:
//   `move`      رقمُه (كشفُ التخريج أو البوليصةُ عندنا) مكتوبٌ في خانة نقل حاويةٍ
//               في المعاملة.
//   `bl`        «رقم البوليصة» في الشحنة بوليصةُ معاملةٍ واحدة.
//   `container` «رقم الحاوية» في الشحنة حاويةٌ في معاملةٍ واحدة.
// وحين يأتي الربطُ من المعاملة تُملأ خانتا الشحنة الفارغتان منها — فيرى مَن
// يفتح الشحنة البوليصةَ وحاويتَها بلا أن يكتبهما.
const refsOfShipment = (o) => [o.graduationNumber, o.waybillNumber, o.reference]
  .map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);

function autoLinkForShipment(o, idx) {
  const hits = new Map();
  for (const r of refsOfShipment(o)) {
    const per = idx.byReport.get(r);
    if (per) for (const [id, units] of per) hits.set(id, new Set([...(hits.get(id) || []), ...units]));
  }
  if (hits.size === 1) { const [[id, units]] = [...hits.entries()]; return { id, via: 'move', containers: [...units] }; }
  if (hits.size > 1) return null;
  const ids = new Set();
  for (const key of blKeysOf(o.blNumber)) for (const id of idx.byBl.get(key) || []) ids.add(id);
  if (ids.size === 1) return { id: [...ids][0], via: 'bl', containers: o.containerNumber ? [String(o.containerNumber).trim()] : [] };
  if (ids.size > 1) return null;
  const uk = unitKeyOf(o.containerNumber);
  const u = uk ? unitHit(idx, uk) : null;
  if (u && u.ids.size === 1) return { id: [...u.ids][0], via: 'container', containers: [u.raw] };
  return null;
}

function decideShipment(o, idx) {
  const cur = o.customsLink || null;
  const via = cur && cur.via;
  const auto = autoLinkForShipment(o, idx);
  if (via === 'manual') {
    const id = idOf(cur.clearance);
    if (!idx.meta.has(id)) return null;
    const next = snapshot(idx, id, 'manual', cur.containers, { at: cur.at, byName: cur.byName });
    return sameLink(cur, next) ? undefined : next;
  }
  if (via === 'unlinked' && !(auto && auto.via === 'move')) return undefined;
  if (!auto) return via && AUTO_VIA.includes(via) ? null : undefined;
  const next = snapshot(idx, auto.id, auto.via, auto.containers, { at: (cur && idOf(cur.clearance) === auto.id && cur.at) || new Date(), byName: '' });
  return sameLink(cur, next) ? undefined : next;
}

const SHIPMENT_FIELDS = '_id graduationNumber waybillNumber reference blNumber containerNumber customsLink source externalId';

/** يعيد حسابَ ربط طلبات شحنٍ بعينها، ويملأ بوليصتَها وحاويتَها الفارغتين من المعاملة. */
async function resolveShipments(rowsOrFilter, { emit = true } = {}) {
  const ShipmentOrder = require('../models/ShipmentOrder');
  const rows = Array.isArray(rowsOrFilter)
    ? rowsOrFilter
    : await ShipmentOrder.find(rowsOrFilter).select(SHIPMENT_FIELDS).lean();
  if (!rows.length) return { changed: 0, clearanceIds: [] };
  const idx = await loadIndex();
  const ops = []; const clearanceIds = new Set();
  for (const o of rows) {
    const next = decideShipment(o, idx);
    const link = next === undefined ? o.customsLink : next;
    const set = {};
    if (next !== undefined) {
      if (o.customsLink && o.customsLink.clearance) clearanceIds.add(idOf(o.customsLink.clearance));
      if (next && next.clearance) clearanceIds.add(idOf(next.clearance));
    }
    // تُملأ الفارغتان من المعاملة المربوطة — ولا يُكتب فوق ما كتبه أحد.
    if (link && link.clearance) {
      if (!String(o.blNumber || '').trim() && link.blNumber) set.blNumber = link.blNumber;
      // A clearance with one container names it even when the link came by B/L.
      const units = (link.containers || []).length ? link.containers : (idx.meta.get(idOf(link.clearance))?.units || []);
      if (!String(o.containerNumber || '').trim() && units.length === 1) set.containerNumber = units[0];
    }
    if (next === undefined && !Object.keys(set).length) continue;
    const update = {};
    if (next !== undefined) { if (next) set.customsLink = next; else update.$unset = { customsLink: 1 }; }
    if (Object.keys(set).length) update.$set = set;
    ops.push({ updateOne: { filter: { _id: o._id }, update } });
  }
  if (ops.length) {
    for (let i = 0; i < ops.length; i += 500) await ShipmentOrder.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    if (emit) {
      try { cache.clear('so:'); } catch (_) { /* */ }
      try {
        const { emitToAll } = require('../websocket/socketManager');
        emitToAll('shipmentOrders:updated', { customsLink: true });
        if (clearanceIds.size) emitToAll('customs:opsLinks', { clearanceIds: [...clearanceIds], shipments: true });
      } catch (_) { /* لا مقابس في السكربت */ }
    }
  }
  return { changed: ops.length, clearanceIds: [...clearanceIds] };
}

/**
 * طلبُ شحنٍ حُفظ: يُربط، وكشفُ تشغيله (لشحنات المنصّة) يأخذ البوليصةَ أو الحاويةَ
 * «رقمَ سندٍ» إن كان فارغًا — فيُربط هو أيضًا من سير عمل التشغيل.
 */
async function afterShipmentSaved(orderId) {
  const ShipmentOrder = require('../models/ShipmentOrder');
  const before = await ShipmentOrder.findById(orderId).select(SHIPMENT_FIELDS).lean();
  if (!before) return;
  await resolveShipments([before]);
  // Re-read: the link may have just filled the B/L or container the row takes its number from.
  const o = await ShipmentOrder.findById(orderId).select(SHIPMENT_FIELDS).lean();
  const doc = String(o.blNumber || '').trim() || String(o.containerNumber || '').trim();
  const native = !(o.source === 'platform' && o.externalId);
  if (doc || native) {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const wf = await OperationsWorkflow.findOne(native ? { shipmentOrder: o._id } : { externalId: String(o.externalId) }).select(REPORT_FIELDS).lean();
    // A shipment made here owns the number, so its row follows an edit or a clear.
    const stale = wf && (native ? String(wf.documentNumber || '').trim() !== doc : !String(wf.documentNumber || '').trim());
    if (stale) await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: { documentNumber: doc } });
    // Always for a shipment made here: its link can lag the number the mirror already wrote.
    if (stale || (wf && native)) await resolveReports([{ ...wf, documentNumber: stale ? doc : wf.documentNumber }]);
  }
}

/** شروطُ طلبات الشحن التي قد تمسّها معاملةٌ واحدة. */
function shipmentFilterFor(id, c, refs, keys) {
  const or = [{ 'customsLink.clearance': new mongoose.Types.ObjectId(id) }];
  if (refs.size) {
    const list = [...refs];
    const nums = list.map(Number).filter((n) => Number.isFinite(n));
    or.push({ reference: { $in: list } });
    if (nums.length) { or.push({ graduationNumber: { $in: nums } }); or.push({ waybillNumber: { $in: nums } }); }
  }
  if (keys.size) {
    const rx = { $regex: [...keys].map(looseRx).join('|'), $options: 'i' };
    or.push({ blNumber: rx }); or.push({ containerNumber: rx });
  }
  return { $or: or };
}

// ── الطابور: حفظُ المعاملة لا ينتظر الربط ──────────────────────────────────
// الخطّافُ يُستدعى بعد كلّ حفظ، والمعاملةُ قد تُحفظ مرّتين في طلبٍ واحد. فيُجمَع
// ما وصل في ربع ثانيةٍ ويُحسب مرّةً. والخطأُ هنا لا يُفشل حفظَ المعاملة.
const pending = new Set();
let timer = null;
let running = Promise.resolve();
function queueClearance(id) {
  if (!id) return;
  try { cache.clear('customslink:'); } catch (_) { /* */ }
  pending.add(String(id));
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const ids = [...pending]; pending.clear();
    running = running.then(async () => {
      for (const one of ids) {
        try { await syncClearance(one); } catch (e) { console.error('[customs-link] تعذّر ربطُ كشوف المعاملة', one, e.message); }
      }
    });
  }, 250);
}
/** للاختبارات والسكربتات: ينتظر حتى يفرغ الطابور. */
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; const ids = [...pending]; pending.clear(); running = running.then(async () => { for (const one of ids) await syncClearance(one).catch(() => {}); }); }
  await running;
}

/**
 * الذاكرةُ تُمسح ثمّ يُبَثّ — الترتيبُ مقصود: مَن يسمع الخبر يجلب فيجد جديدًا.
 * والشاشاتُ التي تسمع: جدولُ التشغيل (`workflow:bulkImported`)، وشاشاتُ التحصيل
 * (`collections:changed`)، وصفحةُ المعاملة (`customs:opsLinks`).
 */
function announce({ reportNumbers = [], clearanceIds = [] } = {}) {
  for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'customslink:']) {
    try { cache.clear(p); } catch (_) { /* */ }
  }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('workflow:bulkImported', { customsLink: true, reportNumbers: reportNumbers.slice(0, 200) });
    emitToAll('collections:changed', { source: 'customs-link', reportNumbers: reportNumbers.slice(0, 200) });
    emitToAll('customs:opsLinks', { clearanceIds, reportNumbers: reportNumbers.slice(0, 200) });
  } catch (_) { /* لا مقابس في السكربت */ }
}

/** الشكلُ الذي تقرؤه الشاشات — بلا ما لا يلزمها. */
function linkView(l) {
  if (!l || !l.clearance) return null;
  return {
    clearanceId: idOf(l.clearance),
    refNumber: l.refNumber || '',
    blNumber: l.blNumber || '',
    customerName: l.customerName || '',
    containers: l.containers || [],
    via: l.via || '',
  };
}

/**
 * الكشوفُ المربوطةُ كلُّها مفهرسةً برقم الكشف وبرقم الفاتورة — لشاشات التحصيل
 * التي وحدتُها الفاتورة (والفاتورةُ قد تضمّ كشوفًا من معاملاتٍ شتّى). وهي قليلةٌ
 * من أربعين ألفًا فتُقرأ مرّةً وتُحفظ دقيقة؛ و`announce` يمسحها مع كلّ ربط.
 */
async function linkedIndex() {
  return cache.wrap('customslink:linked', INDEX_TTL, async () => {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const rows = await OperationsWorkflow.find({ 'customsLink.clearance': { $type: 'objectId' } })
      .select('reportNumber invoiceNumber customsLink').lean();
    const byReport = new Map(); const byInvoice = new Map();
    for (const r of rows) {
      const v = linkView(r.customsLink);
      if (!v) continue;
      byReport.set(String(r.reportNumber || '').trim(), v);
      const no = String(r.invoiceNumber || '').trim();
      if (no) {
        if (!byInvoice.has(no)) byInvoice.set(no, new Map());
        const per = byInvoice.get(no);
        const prev = per.get(v.clearanceId);
        // الفاتورةُ تُظهر المعاملةَ مرّةً، وحاوياتُ كشوفها مجموعة.
        per.set(v.clearanceId, prev
          ? { ...prev, containers: [...new Set([...prev.containers, ...v.containers])].sort(), reports: prev.reports + 1 }
          : { ...v, reports: 1 });
      }
    }
    return { byReport, byInvoice };
  });
}

/** معاملاتُ فاتورةٍ واحدة — مصفوفةٌ (فارغةٌ إن لم يُربط شيء). */
const customsOfInvoice = (idx, no) => [...((idx.byInvoice.get(String(no || '').trim()) || new Map()).values())];
/** معاملةُ كشفٍ واحد أو `null`. */
const customsOfReport = (idx, rn) => idx.byReport.get(String(rn || '').trim()) || null;

module.exports = {
  linkedIndex, customsOfInvoice, customsOfReport,
  VIA, AUTO_VIA,
  normKey, blKeysOf, unitKeyOf,
  loadIndex, autoLinkFor, decide, snapshot,
  resolveReports, syncClearance, linkPendingMoveRefs,
  resolveShipments, afterShipmentSaved, autoLinkForShipment,
  queueClearance, flush, announce, linkView,
};
