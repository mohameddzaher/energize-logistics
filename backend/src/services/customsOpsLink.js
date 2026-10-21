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
 *               (COSU6444523620 = 6444523620). ولا يُقبل رقمٌ أقصرُ من ثمانية،
 *               ولا بوليصةٌ تحملها أكثرُ من معاملة.
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
 * رقم) — فالسندُ يُكتب بها أحيانًا وبدونها أحيانًا. ولا مفتاحَ أقصرُ من ثمانية.
 */
function blKeysOf(bl) {
  const k = normKey(bl);
  if (k.length < 8) return [];
  const out = [k];
  const m = k.match(/^[A-Z]{4}(\d[A-Z0-9]{7,})$/);
  if (m) out.push(m[1]);
  return out;
}

/** مفتاحُ الحاوية (أو هيكلِ السيّارة): عشرُ خاناتٍ فأكثر، فيها حرفٌ ورقم. */
function unitKeyOf(s) {
  const k = normKey(s);
  return k.length >= 10 && /[A-Z]/.test(k) && /\d/.test(k) ? k : '';
}

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
    const add = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    for (const c of rows) {
      const id = String(c._id);
      meta.set(id, { refNumber: c.refNumber || '', blNumber: c.blNumber || '', customerName: c.customerName || '' });
      if (c.cancelled) continue;
      for (const k of blKeysOf(c.blNumber)) add(byBl, k, id);
      for (const u of c.containers || []) {
        const unit = String(u.containerNumber || '').trim();
        const uk = unitKeyOf(unit);
        if (uk) {
          if (!byUnit.has(uk)) byUnit.set(uk, { ids: new Set(), raw: unit });
          byUnit.get(uk).ids.add(id);
        }
        const refs = (u.moves || []).filter((m) => m && m.vehicleKind === 'energize' && String(m.ref || '').trim())
          .map((m) => String(m.ref).trim());
        if (u.returnVehicleKind === 'energize' && String(u.returnRef || '').trim()) refs.push(String(u.returnRef).trim());
        for (const r of refs) {
          if (!byReport.has(r)) byReport.set(r, new Map());
          const per = byReport.get(r);
          if (!per.has(id)) per.set(id, new Set());
          if (unit) per.get(id).add(unit);
        }
      }
    }
    return { meta, byReport, byBl, byUnit };
  });
}

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
  const doc = report.documentNumber;
  const k = normKey(doc);
  if (k) {
    const ids = new Set();
    for (const key of [k, ...blKeysOf(doc)]) for (const id of idx.byBl.get(key) || []) ids.add(id);
    if (ids.size === 1) return { id: [...ids][0], via: 'bl', containers: [] };
    if (ids.size > 1) return null;
    const uk = unitKeyOf(doc);
    const u = uk ? idx.byUnit.get(uk) : null;
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

const REPORT_FIELDS = '_id reportNumber documentNumber customsLink';

/**
 * يعيد حسابَ ربط كشوفٍ بعينها ويكتب ما تغيّر. `rows` صفوفٌ خفيفة أو شرطُ بحث.
 * @returns {{changed:number, reportNumbers:string[], clearanceIds:string[]}}
 */
async function resolveReports(rowsOrFilter, { emit = true, dryRun = false } = {}) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const rows = Array.isArray(rowsOrFilter)
    ? rowsOrFilter
    : await OperationsWorkflow.find(rowsOrFilter).select(REPORT_FIELDS).lean();
  if (!rows.length) return { changed: 0, reportNumbers: [], clearanceIds: [], changes: [] };
  const idx = await loadIndex();
  const ops = []; const changes = []; const clearanceIds = new Set();
  for (const r of rows) {
    const next = decide(r, idx);
    if (next === undefined) continue;
    if (r.customsLink && r.customsLink.clearance) clearanceIds.add(idOf(r.customsLink.clearance));
    if (next && next.clearance) clearanceIds.add(idOf(next.clearance));
    changes.push({ _id: r._id, reportNumber: r.reportNumber, from: r.customsLink || null, to: next });
    ops.push({ updateOne: { filter: { _id: r._id }, update: next ? { $set: { customsLink: next } } : { $unset: { customsLink: 1 } } } });
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
    }
    if (refs.size) or.push({ reportNumber: { $in: [...refs] } });
    if (keys.size) or.push({ documentNumber: { $regex: [...keys].map(looseRx).join('|'), $options: 'i' } });
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
  return resolveReports({ reportNumber: { $in: nums }, 'customsLink.via': { $nin: ['move', 'manual'] } }, opts);
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
  queueClearance, flush, announce, linkView,
};
