/**
 * عهدةُ النقل الخفيف — الكاش وكارت المشتريات والورشة. راجع models/LtCustody.
 *
 * القواعدُ هنا لا في الشاشة: أيُّ مصدرٍ يصحّ لأيّ حساب، ومَن يصرف إلى الكاش،
 * وأنّ التحويلَ قيدان. والشاشةُ تقرأ `rules` من الجواب وترسم ما يُسمَح به.
 */
const mongoose = require('mongoose');
const LtCustodyEntry = require('../models/LtCustody');
const { ACCOUNTS, IN_SOURCES, TO_CASH } = require('../models/LtCustody');
const { LightTransportEmployee } = require('../models/LightTransport');
const Employee = require('../models/Employee');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const { todayKey } = require('../utils/companyDay');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const who = (req) => [req.user.firstName, req.user.lastName].filter(Boolean).join(' ').trim() || '';
// الحذفُ لمدير القسم ومَن فوقه — القيدُ مالٌ، وحذفُه ليس عملَ كلّ من يُدخِل.
const DELETE_ROLES = ['super_admin', 'admin', 'b2c_manager'];
const changed = () => {
  try { cache.clear('ltcustody:'); } catch (_) { /* */ }
  try { emitToAll('lt:custody', { at: Date.now() }); } catch (_) { /* */ }
};

/**
 * المندوبُ برقم هويّته: من سجلّ النقل الخفيف أوّلًا (فيه الفري لانسر الذين لا
 * ملفَّ لهم في الموارد البشريّة)، ثمّ من الموارد البشريّة بعمودَي الهويّة معًا
 * (راجع identity-number-two-columns). يردّ `null` إن لم يُعرَف.
 */
async function findRep(idNumber) {
  const id = String(idNumber || '').replace(/\s+/g, '').trim();
  if (!id) return null;
  const lt = await LightTransportEmployee.findOne({ idNumber: id })
    .select('idNumber name nationalityAr projectAr jobTitleAr employee').lean();
  const hr = await Employee.findOne(lt && lt.employee ? { _id: lt.employee } : { $or: [{ iqamaNumber: id }, { nationalId: id }] })
    .select('firstName lastName arabicName nationality employeeNumber employmentStatus project department').lean();
  if (!lt && !hr) return null;
  const hrName = hr ? (hr.arabicName || [hr.firstName, hr.lastName].filter(Boolean).join(' ').trim()) : '';
  return {
    idNumber: id,
    name: hrName || (lt && lt.name) || '',
    nationality: (hr && hr.nationality) || (lt && lt.nationalityAr) || '',
    project: (lt && lt.projectAr) || (hr && hr.project) || '',
    jobTitle: (lt && lt.jobTitleAr) || '',
    employeeNumber: (hr && hr.employeeNumber) || '',
    status: (hr && hr.employmentStatus) || '',
    employee: hr ? hr._id : null,
    inHr: !!hr, inLightTransport: !!lt,
  };
}

// GET /custody/rep?id=<رقم الإقامة>
exports.lookupRep = async (req, res) => {
  try {
    const rep = await findRep(req.query.id);
    if (!rep) return res.status(404).json({ message: 'لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف' });
    res.json({ rep });
  } catch (e) { res.status(500).json({ message: 'تعذّر البحث عن المندوب' }); }
};

/** أرصدةُ الحسابات الثلاثة — على كلّ القيود، لا على ما صفّاه الفلتر. */
async function balances() {
  const agg = await LtCustodyEntry.aggregate([
    { $group: { _id: { a: '$account', d: '$direction' }, total: { $sum: '$amount' }, n: { $sum: 1 } } },
  ]);
  const out = Object.fromEntries(ACCOUNTS.map((a) => [a, { in: 0, out: 0, balance: 0, count: 0 }]));
  for (const x of agg) {
    const acc = out[x._id.a]; if (!acc) continue;
    acc[x._id.d] = r2(x.total); acc.count += x.n;
  }
  for (const a of ACCOUNTS) out[a].balance = r2(out[a].in - out[a].out);
  return out;
}

// GET /custody?account=&direction=&target=&from=&to=&q=
exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const f = {};
    if (ACCOUNTS.includes(q.account)) f.account = q.account;
    if (q.direction === 'in' || q.direction === 'out') f.direction = q.direction;
    if (['rep', 'company', 'cash'].includes(q.target)) f.target = q.target;
    if (['card', 'workshop', 'bank', 'maintenance', 'opening'].includes(q.source)) f.source = q.source;
    if (YMD.test(q.from || '') || YMD.test(q.to || '')) {
      f.date = {};
      if (YMD.test(q.from || '')) f.date.$gte = q.from;
      if (YMD.test(q.to || '')) f.date.$lte = q.to;
    }
    const s = String(q.q || '').trim().slice(0, 60);
    if (s) {
      const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$or = [{ repName: rx }, { repIdNumber: rx }, { detail: rx }, { createdByName: rx }];
    }
    const [entries, bal] = await Promise.all([
      LtCustodyEntry.find(f).sort({ date: -1, createdAt: -1 }).limit(2000).lean(),
      cache.wrap('ltcustody:balances', 15000, balances),
    ]);
    // مجموعُ المعروض — تحت الفلتر.
    const shown = { in: 0, out: 0 };
    for (const e of entries) shown[e.direction] += e.amount;
    res.json({
      entries,
      balances: bal,
      shown: { in: r2(shown.in), out: r2(shown.out), net: r2(shown.in - shown.out), count: entries.length },
      rules: { accounts: ACCOUNTS, inSources: IN_SOURCES, toCash: TO_CASH },
      canDelete: DELETE_ROLES.includes(req.user.role),
      today: todayKey(),
    });
  } catch (e) {
    console.error('ltCustody list:', e);
    res.status(500).json({ message: 'تعذّر تحميل العهدة' });
  }
};

// POST /custody — قيدٌ واحد، أو قيدان إن كان تحويلًا بين حسابين.
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const account = String(b.account || '');
    const direction = b.direction === 'in' ? 'in' : b.direction === 'out' ? 'out' : '';
    if (!ACCOUNTS.includes(account) || !direction) return res.status(400).json({ message: 'اختر الحسابَ ونوعَ الحركة' });
    const amount = r2(b.amount);
    if (!(amount > 0)) return res.status(400).json({ message: 'اكتب المبلغ', fields: { amount: 'مطلوب' } });
    const date = YMD.test(String(b.date || '')) ? String(b.date) : todayKey();
    const detail = String(b.detail || '').trim().slice(0, 500);
    const base = { amount, date, detail, createdBy: req.user._id, createdByName: who(req) };
    const docs = [];
    const transferId = new mongoose.Types.ObjectId();

    if (direction === 'in') {
      const source = String(b.source || '');
      if (!IN_SOURCES[account].includes(source)) return res.status(400).json({ message: 'مصدرُ الوارد لا يصحّ لهذا الحساب' });
      if (ACCOUNTS.includes(source)) {
        // واردٌ من حسابٍ آخر = تحويل: صادرٌ هناك وواردٌ هنا.
        docs.push({ ...base, account: source, direction: 'out', target: account, transferId });
        docs.push({ ...base, account, direction: 'in', source, transferId });
      } else {
        docs.push({ ...base, account, direction: 'in', source });
      }
    } else {
      const target = String(b.target || '');
      if (target === 'cash') {
        if (!TO_CASH.includes(account)) return res.status(400).json({ message: 'هذا الحسابُ لا يصرف إلى الكاش' });
        docs.push({ ...base, account, direction: 'out', target: 'cash', transferId });
        docs.push({ ...base, account: 'cash', direction: 'in', source: account, transferId });
      } else if (target === 'rep') {
        const rep = await findRep(b.repIdNumber);
        if (!rep) return res.status(400).json({ message: 'اكتب رقمَ إقامة المندوب — لا مندوبَ بهذا الرقم', fields: { repIdNumber: 'غير معروف' } });
        docs.push({
          ...base, account, direction: 'out', target: 'rep',
          repIdNumber: rep.idNumber, repName: rep.name, repNationality: rep.nationality, repProject: rep.project, employee: rep.employee,
        });
      } else if (target === 'company') {
        if (!detail) return res.status(400).json({ message: 'اكتب البيان: ما الصرف؟ (ماء، كهرباء، صيانة…)', fields: { detail: 'مطلوب' } });
        docs.push({ ...base, account, direction: 'out', target: 'company' });
      } else {
        return res.status(400).json({ message: 'اختر المتحمِّل: مندوب أو الشركة' });
      }
    }

    const created = await LtCustodyEntry.insertMany(docs);
    changed();
    await logAudit({
      user: req.user, action: 'lt_custody_entry', entity: 'LtCustodyEntry', entityId: created[created.length - 1]._id,
      changes: { details: describe(created), after: created.map((e) => ({ account: e.account, direction: e.direction, amount: e.amount, date: e.date })) },
      ipAddress: req.ip,
    });
    res.status(201).json({ entries: created, balances: await balances() });
  } catch (e) {
    console.error('ltCustody create:', e);
    res.status(500).json({ message: 'تعذّر تسجيل الحركة' });
  }
};

const ACC_AR = { cash: 'الكاش', card: 'الكارت', workshop: 'الورشة' };
// «opening» رصيدٌ افتتاحيّ: يُكتب بالسكربت مرّةً (setLtCustodyOpening) ولا يُختار من الشاشة.
const SRC_AR = { card: 'الكارت', workshop: 'الورشة', bank: 'البنك', maintenance: 'الصيانة', opening: 'رصيد افتتاحي' };
function describe(list) {
  // الصادرُ أوّلًا: «من … إلى …» تُقرأ صحيحةً بأيّ ترتيبٍ جاء به الطرفان.
  const entries = [...list].sort((a, b) => (a.direction === 'out' ? -1 : 1) - (b.direction === 'out' ? -1 : 1));
  const e = entries[0];
  if (entries.length === 2) return `تحويل ${e.amount} من ${ACC_AR[entries[0].account]} إلى ${ACC_AR[entries[1].account]}`;
  if (e.direction === 'in') return `وارد ${e.amount} إلى ${ACC_AR[e.account]} من ${SRC_AR[e.source] || e.source}`;
  return `صادر ${e.amount} من ${ACC_AR[e.account]} — ${e.target === 'rep' ? `المندوب ${e.repName} (${e.repIdNumber})` : `الشركة: ${e.detail}`}`;
}

// DELETE /custody/:id — وطرفُ التحويل الآخر يُحذَف معه.
exports.remove = async (req, res) => {
  try {
    if (!DELETE_ROLES.includes(req.user.role)) return res.status(403).json({ message: 'حذفُ قيدِ العهدة لمدير القسم' });
    const e = await LtCustodyEntry.findById(req.params.id).lean();
    if (!e) return res.status(404).json({ message: 'القيد غير موجود' });
    const group = e.transferId ? await LtCustodyEntry.find({ transferId: e.transferId }).lean() : [e];
    await LtCustodyEntry.deleteMany({ _id: { $in: group.map((x) => x._id) } });
    changed();
    await logAudit({
      user: req.user, action: 'lt_custody_delete', entity: 'LtCustodyEntry', entityId: e._id,
      changes: { details: `حذف: ${describe(group)}`, before: group }, ipAddress: req.ip,
    });
    res.json({ deleted: group.length, balances: await balances() });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذف القيد' }); }
};

exports._findRep = findRep;
