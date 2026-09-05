/**
 * أنواعُ الدفع — صفةُ كلّ عميلٍ في مكانٍ واحد، ومنها يُشتقُّ نوعُ كلّ كشف.
 *
 * ── لماذا صفحةٌ بذاتها ─────────────────────────────────────────────────────
 * كان نوعُ الدفع يُكتب على كلّ كشفٍ على حدة. وأكثرُ العملاء صفتُهم ثابتة —
 * عميلُ الكاش يدفع في يده دائمًا، والضريبيُّ يُفوتَر دائمًا — فكتابةُ ذلك على
 * أربعةٍ وثلاثين ألفَ كشفٍ عملٌ مكرَّرٌ يُنسى ويُخطأ، وخطأٌ واحدٌ يُرسل كشفَ
 * عميلٍ ضريبيّ إلى فواتير الكاش.
 *
 * فيُكتب على العميل مرّةً، ويُقرأ منه عند كلّ كشف. والاستثناءُ الوحيد أن تقول
 * منصّةُ التشغيل عن حمولةٍ بعينها إنّها نقديّة، فتغلب صفةَ العميل — راجع
 * utils/paymentType.
 */
const CollectionsParty = require('../models/CollectionsParty');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { derivePaymentType } = require('../utils/paymentType');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');

const { fold } = CollectionsParty;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** GET /api/workflows/payment-types — العملاءُ وأنواعُهم وكم كشفًا لكلٍّ. */
exports.list = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || '');
    const filter = { kind: 'customer' };
    if (q) filter.$or = [{ name: flexSpaceRegex(q) }, { code: flexSpaceRegex(q) }];
    if (type === 'cash' || type === 'tax') filter.paymentType = type;
    else if (type === 'none') filter.$and = [...(filter.$and || []), { $or: [{ paymentType: null }, { paymentType: '' }] }];

    const parties = await CollectionsParty.find(filter)
      .select('name nameKey code paymentType collectionOfficer department').sort({ name: 1 }).lean();

    // ── وعددُ كشوف كلّ عميلٍ يُحسب مرّةً واحدةً للجميع ──────────────────────
    // استعلامٌ لكلّ عميلٍ يعني سبعَمئةِ رحلةٍ إلى القاعدة في فتحةٍ واحدة.
    const counts = await OperationsWorkflow.aggregate([
      { $match: { username: { $nin: [null, ''] } } },
      { $group: {
        _id: '$username',
        reports: { $sum: 1 },
        cash: { $sum: { $cond: [{ $eq: ['$paymentType', 'cash'] }, 1, 0] } },
        tax: { $sum: { $cond: [{ $eq: ['$paymentType', 'tax'] }, 1, 0] } },
        manual: { $sum: { $cond: [{ $eq: ['$paymentTypeSource', 'manual'] }, 1, 0] } },
        methodCash: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$paymentMethod', ''] }, regex: /^cash$/i } }, 1, 0] } },
        value: { $sum: { $ifNull: ['$sellingValue', 0] } },
      } },
    ]);
    const byKey = new Map();
    for (const c of counts) {
      const k = fold(c._id || '');
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, c);
      else {
        prev.reports += c.reports; prev.cash += c.cash; prev.tax += c.tax;
        prev.manual += c.manual; prev.methodCash += c.methodCash; prev.value += c.value;
      }
    }

    const rows = parties.map((p) => {
      const c = byKey.get(p.nameKey || fold(p.name)) || { reports: 0, cash: 0, tax: 0, manual: 0, methodCash: 0, value: 0 };
      return {
        _id: p._id, name: p.name, code: p.code || '',
        paymentType: p.paymentType || '',
        officer: p.collectionOfficer || '', department: p.department || '',
        reports: c.reports, cashReports: c.cash, taxReports: c.tax,
        manualReports: c.manual, methodCashReports: c.methodCash,
        value: r2(c.value),
      };
    });

    const totals = {
      customers: rows.length,
      cash: rows.filter((r) => r.paymentType === 'cash').length,
      tax: rows.filter((r) => r.paymentType === 'tax').length,
      none: rows.filter((r) => !r.paymentType).length,
      reports: rows.reduce((a, b) => a + b.reports, 0),
    };
    res.json({ rows, totals });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل أنواع الدفع', error: e.message });
  }
};

/**
 * PUT /api/workflows/payment-types/:id — صفةُ عميلٍ تُكتب، وتسري على كشوفه.
 *
 * ولا تمسّ كشفًا اختار موظّفٌ نوعَه بيده: ذلك قرارٌ على حمولةٍ بعينها، وهذه
 * صفةٌ عامّة. والفرقُ بينهما هو كلُّ الفرق — راجع paymentTypeSource.
 */
exports.update = async (req, res) => {
  try {
    const type = String(req.body.paymentType || '');
    if (!['', 'cash', 'tax'].includes(type)) {
      return res.status(400).json({ message: 'نوعُ الدفع إمّا «cash» أو «tax» أو فارغ' });
    }
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'العميل غير موجود' });

    const before = party.paymentType || '';
    party.paymentType = type;
    await party.save();

    // ── ثمّ تسري على كشوفه ─────────────────────────────────────────────────
    const applied = await applyToCustomer(party, { onlyEmpty: req.body.onlyEmpty !== false });

    logAudit({
      user: req.user, action: 'set_customer_payment_type', entity: 'CollectionsParty', entityId: party._id,
      changes: { before: { paymentType: before }, after: { paymentType: type }, reportsChanged: applied.changed },
      ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('wf:');
    cache.clear('colledger:');
    try { require('../websocket/socketManager').emitToAll('workflow:updated', { bulk: true, paymentType: true }); } catch (_) {}

    res.json({ party: { _id: party._id, name: party.name, paymentType: party.paymentType }, ...applied });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حفظ نوع الدفع', error: e.message });
  }
};

/**
 * يُطبِّق صفةَ العميل على كشوفه.
 *
 * `onlyEmpty` هو الافتراض: يُملأ ما لا نوعَ له ولا يُبدَّل ما له نوع. ومَن أراد
 * إعادةَ تصنيف تاريخِ عميلٍ كلِّه يطلبها صراحةً — فقلبُ نوعِ كشوفٍ قديمةٍ يغيّر
 * أين تُفوتَر وأين تُحصَّل، وهو قرارٌ لا أثرٌ جانبيّ.
 */
async function applyToCustomer(party, { onlyEmpty = true } = {}) {
  const key = party.nameKey || fold(party.name || '');
  if (!key) return { changed: 0, skippedManual: 0 };

  // الأسماءُ الخامّةُ التي تطوي إلى مفتاح هذا العميل.
  const names = await OperationsWorkflow.distinct('username', { username: { $nin: [null, ''] } });
  const mine = names.filter((n) => fold(n) === key);
  if (!mine.length) return { changed: 0, skippedManual: 0 };

  const rows = await OperationsWorkflow.find({ username: { $in: mine } })
    .select('paymentType paymentTypeSource paymentMethod').lean();

  const ops = []; let skippedManual = 0;
  for (const w of rows) {
    if (String(w.paymentTypeSource || '') === 'manual') { skippedManual += 1; continue; }
    if (onlyEmpty && w.paymentType) continue;
    const next = derivePaymentType(w.paymentMethod, party.paymentType);
    if (next === (w.paymentType || '')) continue;
    ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: next, paymentTypeSource: 'auto' } } } });
  }
  let changed = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    changed += r.modifiedCount || 0;
  }
  return { changed, skippedManual, reports: rows.length };
}

/**
 * POST /api/workflows/payment-types/apply — تمرير القاعدة على الجميع.
 *
 * يُعرَض أثرُه قبل تنفيذه (`preview: true`): قلبُ نوعِ كشفٍ يغيّر أين يُفوتَر
 * وأين يُحصَّل، فلا يُنفَّذ على آلافٍ بضغطةٍ بلا أن يُرى العدد أوّلًا.
 */
exports.applyAll = async (req, res) => {
  try {
    const onlyEmpty = req.body.onlyEmpty !== false;
    const preview = req.body.preview === true;

    const parties = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey paymentType').lean();
    const typeByKey = new Map();
    for (const p of parties) {
      const k = p.nameKey || fold(p.name || '');
      if (k) typeByKey.set(k, p.paymentType || '');
    }

    const rows = await OperationsWorkflow.find({})
      .select('username paymentType paymentTypeSource paymentMethod').lean();

    const ops = []; let skippedManual = 0; let unknown = 0;
    const moves = {};
    for (const w of rows) {
      if (String(w.paymentTypeSource || '') === 'manual') { skippedManual += 1; continue; }
      const t = typeByKey.get(fold(w.username || ''));
      if (t === undefined) { unknown += 1; continue; }
      if (onlyEmpty && w.paymentType) continue;
      const next = derivePaymentType(w.paymentMethod, t);
      const cur = w.paymentType || '';
      if (next === cur) continue;
      moves[`${cur || 'فارغ'} → ${next || 'فارغ'}`] = (moves[`${cur || 'فارغ'} → ${next || 'فارغ'}`] || 0) + 1;
      ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: next, paymentTypeSource: 'auto' } } } });
    }

    if (preview) return res.json({ preview: true, wouldChange: ops.length, skippedManual, unknown, moves });

    let changed = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      changed += r.modifiedCount || 0;
    }
    logAudit({
      user: req.user, action: 'apply_payment_types', entity: 'OperationsWorkflow',
      changes: { after: { changed, onlyEmpty, moves } }, ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('wf:'); cache.clear('colledger:');
    try { require('../websocket/socketManager').emitToAll('workflow:updated', { bulk: true, paymentType: true }); } catch (_) {}
    res.json({ changed, skippedManual, unknown, moves });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تطبيق أنواع الدفع', error: e.message });
  }
};

exports.applyToCustomer = applyToCustomer;
