/**
 * شيتاتُ الأوردرات — يديرها سكربتُ جوجل (Apps Script) لا رابطٌ عامّ.
 *
 * طلبُ صاحب الشركة (٢٠٢٦/١٠/٢٠): الملفُّ ملكُ النظام. المناديبُ وأسماؤهم
 * ومشرفوهم ومشاريعُهم تأتي من النظام وحدَه، والمشرفُ لا يكتب في الشيت إلّا أرقامَ
 * الأوردرات في خانات الأيّام — والباقي مقفول. ومن نُقل إلى مشروعٍ آخر ظهر في
 * ملفّ مشروعه الجديد، وكُتب في خانات الأيّام التي لم يكن فيها هنا «في <المشروع>».
 *
 * فالسكربتُ (في حساب جوجل صاحب الملفّات) يطلب من هنا «تخطيطَ» كلّ شهر —
 * الصفوفَ والأرقامَ والتسميات — ويرسمه، ويرسل كلَّ رقمٍ يُكتب في خانةٍ إلى هنا في
 * لحظته. فالأرقامُ في الاتّجاهين، والآخرُ هو المعتمد.
 *
 *   GET  /api/public/b2c-sheets/layout?project=Keeta&months=2026-10,2026-11|all&token=
 *   POST /api/public/b2c-sheets/edit      { token, project, edits: [{ month, id, day, value }] }
 *   POST /api/public/b2c-sheets/register  { token, project, spreadsheetId, url }
 *   GET  /api/public/b2c-sheets/stamps?project=&token=   بصمةُ كلّ شهر (ما تغيّر يُعاد رسمُه)
 *   POST /api/public/b2c-sheets/order     { token, project, month, ids: [iqama] }
 *
 * ومسؤولو القسم (٢٠٢٦/١٠/٢١): بريدُ جوجل لهم يُحفظ هنا ويصل السكربتَ مع التخطيط،
 * فيُضافون محرّرين لحماية كلّ ورقة — يكتبون في أيّ يومٍ من أيّ شهر (والقديمةُ لهم
 * وحدَهم)، ويسحبون الصفوفَ فيُحفظ ترتيبُ المناديب (B2CSheetOrder) ويسري على النظام كلِّه.
 *
 * والمصادقةُ بمفتاحٍ يولّده الخادم (models/B2COrderSheet ← sheetsToken) ويصل السكربتَ
 * مضمَّنًا فيه حين يُحمَّل من النظام — جوجل لا يحمل جلسة.
 */
const crypto = require('crypto');
const E = require('../utils/b2cEntry');
const cache = require('../utils/ttlCache');

const S = (v) => String(v ?? '').trim();
const pad = (n) => String(n).padStart(2, '0');
const riyadhDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(d));
const today = () => riyadhDay(new Date());
const SYNC_FROM = '2026-10';
const FIRST_MONTH = '2026-01';
const LAST_MONTH = '2027-12';
const AR_DIGITS = /[٠-٩]/g;
const idKey = (v) => S(v).replace(AR_DIGITS, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\s+/g, '').toUpperCase();
const UNKNOWN_NAME = /^ترك\s*العمل$/;

async function tokenOk(t) {
  const want = String(await require('../models/B2COrderSheet').sheetsToken());
  const got = String(t || '');
  if (!want || want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
const guard = async (req, res) => {
  if (await tokenOk(req.query.token || req.body?.token)) return false;
  res.status(401).json({ message: 'token' });
  return true;
};

async function projectOf(name) {
  const P = await E.projects();
  return P.rows.find((x) => [x.name, x.nameAr, x.code].some((n) => n && E.fold(n) === E.fold(name))) || null;
}

/** الشهورُ المطلوبة: «all» أو قائمةٌ مفصولةٌ بفاصلة (YYYY-MM). */
function monthsOf(q) {
  const out = [];
  if (S(q) === 'all') {
    let [y, m] = FIRST_MONTH.split('-').map(Number);
    while (`${y}-${pad(m)}` <= LAST_MONTH) { out.push(`${y}-${pad(m)}`); m += 1; if (m > 12) { m = 1; y += 1; } }
    return out;
  }
  return S(q).split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}$/.test(x));
}

/** مشروعُ المندوب في كلّ يوم — utils/b2cEntry.projectTimeline. */
const projectTimeline = E.projectTimeline;

// ═══════════════════════════════════════════════════════════════════════════
//  ترتيبُ المناديب وبريدُ مسؤولي القسم (صاحبُ الشركة، ٢٠٢٦/١٠/٢١)
// ═══════════════════════════════════════════════════════════════════════════

/** الترتيبُ المحفوظ للمشروع — معرّفاتُ صفوف السجلّ بالترتيب. */
async function orderOf(projectId) {
  const { B2CSheetOrder } = require('../models/B2COrderSheet');
  return B2CSheetOrder.findById(projectId).lean();
}

/**
 * دمجُ ترتيبٍ جزئيّ (مناديبُ شهرٍ واحد) في ترتيب المشروع كلِّه: مَن أُرسلوا يأخذون
 * الخاناتِ التي كانوا فيها بالترتيب الجديد، والباقون في أماكنهم، والجددُ في الآخر.
 */
function mergeOrder(global, part) {
  const seen = new Set();
  const P = part.map(String).filter((id) => id && !seen.has(id) && seen.add(id));
  const G = (global || []).map(String);
  const has = new Set(G);
  for (const id of P) if (!has.has(id)) { G.push(id); has.add(id); }
  const inP = new Set(P);
  let k = 0;
  return G.map((id) => (inP.has(id) ? P[k++] : id));
}

async function saveOrder(project, ltIds, { user = null, source = '' } = {}) {
  const { B2CSheetOrder } = require('../models/B2COrderSheet');
  const cur = await orderOf(project._id);
  const order = mergeOrder(cur?.order, ltIds);
  await B2CSheetOrder.updateOne({ _id: project._id }, { $set: { order, updatedBy: user, source } }, { upsert: true });
  cache.clear('b2c:');
  try { require('../websocket/socketManager').emitToAll('b2c:sheet-order', { project: project.nameAr, source }); } catch (_) { /* */ }
  return order;
}

/** بريدُ جوجل لمسؤولي القسم — محرّرو الحماية في الشيتات. */
async function headEmails() {
  const { B2CSheetsKey, sheetsToken } = require('../models/B2COrderSheet');
  await sheetsToken();
  const doc = await B2CSheetsKey.findById('main').select('headEmails headEmailsAt').lean();
  return { emails: (doc?.headEmails || []).filter(Boolean), at: doc?.headEmailsAt || null };
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function setHeadEmails(list) {
  const { B2CSheetsKey, sheetsToken } = require('../models/B2COrderSheet');
  await sheetsToken();
  const emails = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,،;]+/))
    .map((x) => S(x).toLowerCase()).filter(Boolean))];
  const bad = emails.filter((x) => !EMAIL.test(x));
  if (bad.length) { const e = new Error(`بريدٌ غير صحيح: ${bad.join('، ')}`); e.status = 400; throw e; }
  await B2CSheetsKey.updateOne({ _id: 'main' }, { $set: { headEmails: emails, headEmailsAt: new Date() } });
  return emails;
}

/**
 * بصمةُ كلّ شهر — تتغيّر إذا تغيّر فيه رقمٌ (على النظام أو من الشيت)، أو تغيّر ترتيبُ
 * المشروع، أو بريدُ المسؤولين. فيعيد السكربتُ رسمَ الشهور القديمة التي تغيّرت وحدَها
 * (والشهرُ الماضي والحاليّ والقادم يُرسَم كلَّ مرّة).
 */
async function monthStamps(project) {
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const agg = await B2CDailyOrder.aggregate([
    { $match: { dateKey: { $gte: `${FIRST_MONTH}-01`, $lte: `${LAST_MONTH}-31` } } },
    { $group: { _id: { $substrBytes: ['$dateKey', 0, 7] }, at: { $max: '$updatedAt' }, n: { $sum: 1 } } },
  ]);
  const by = new Map(agg.map((a) => [a._id, a]));
  const ord = await orderOf(project._id);
  const em = await headEmails();
  // `L3`: الشهورُ القديمةُ بالحساب وبترتيب الشيت القديم — فتُعاد رسمُها كلُّها مرّة.
  const tail = `L3.${ord?.updatedAt ? new Date(ord.updatedAt).getTime() : 0}.${em.at ? new Date(em.at).getTime() : 0}`;
  const out = {};
  for (const mk of monthsOf('all')) {
    const a = by.get(mk);
    out[mk] = `${a ? `${new Date(a.at || 0).getTime()}.${a.n}` : '0'}.${tail}`;
  }
  return { stamps: out, headEmails: em.emails };
}

/** بياناتُ الشهور كلُّها لمشروعٍ واحد. */
async function buildLayout(project, months) {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const B2CRep = require('../models/B2CRep');
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const P = await E.projects();
  const pid = String(project._id);
  const now = today();
  const { stamps, headEmails } = await monthStamps(project);

  const lts = (await LightTransportEmployee.find({ $or: [{ staffKind: 'rep' }, { contractTypeAr: /يوزر/ }] })
    .populate('employee', 'employmentStatus')
    .select('idNumber name projectAr supervisorName isActive workStatusAr employee hireDate history').lean())
    .filter((r) => !(r.employee && sets.archivedIds.has(String(r.employee._id))));
  const ltById = new Map(lts.map((l) => [String(l._id), l]));
  const nameKey = (v) => E.fold(v);
  const ltByName = new Map();
  for (const l of lts) { const k = nameKey(l.name); ltByName.set(k, ltByName.has(k) ? null : l); }

  const reps = await B2CRep.find({}).select('arabicName englishName repId ltEmployee').lean();
  // الاسمُ الأوّلُ في الشيت القديم هو `englishName` (عمود الاسم — راجع b2cExcelParser)،
  // و`arabicName` اسمٌ ثانٍ كُتب أحيانًا في عمود الحساب. كان يُقرأ الثاني أوّلًا،
  // فخرجت الأسماءُ في الشيت الجديد غيرَ أسمائها في القديم.
  const acc = new Map(reps.map((r) => [String(r._id), {
    name: S(r.englishName || r.arabicName), repId: S(r.repId), lt: r.ltEmployee ? String(r.ltEmployee) : null,
  }]));
  const first = months[0]; const last = months[months.length - 1];
  const { B2CLegacyRow } = require('../models/B2COrderSheet');
  const oldMonths = months.filter((mk) => mk < SYNC_FROM);
  const legacyPos = new Map(oldMonths.length
    ? (await B2CLegacyRow.find({ project: project._id, month: { $in: oldMonths } }).select('month rep pos').lean()).map((x) => [`${x.month}|${x.rep}`, x.pos])
    : []);
  const orders = first ? await B2CDailyOrder.find({ dateKey: { $gte: `${first}-01`, $lte: `${last}-31` }, orders: { $ne: null } })
    .select('rep dateKey orders project').lean() : [];

  const ended = (l) => (l.employee ? l.employee.employmentStatus === 'terminated' : /انهاء|إنهاء/.test(S(l.workStatusAr))) || l.isActive === false;
  const isHere = (p) => !!p && E.fold(p) === E.fold(project.nameAr);

  const out = {};
  for (const mk of months) {
    const [y, m] = mk.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rows = new Map();
    const rowFor = (key, base) => { if (!rows.has(key)) rows.set(key, { ...base, cells: {} }); return rows.get(key); };
    const person = (l) => rowFor(`lt:${l._id}`, { lt: String(l._id), id: S(l.idNumber), name: S(l.name), sup: S(l.supervisorName), editable: true });
    const inMonth = orders.filter((o) => o.dateKey.startsWith(mk));

    if (mk < SYNC_FROM) {
      // ── شهرٌ للرجوع إليه: كما كان في الشيت القديم تمامًا ──────────────────
      // صفٌّ لكلّ حسابٍ باسمه هناك، لا لكلّ رجل. كان كلُّ حسابٍ يُضمّ إلى صاحبه
      // ويُجمع — والحسابُ الواحدُ في الشيتات القديمة كان يعمل عليه أكثرُ من سائق،
      // فخرجت أرقامٌ لا تطابق القديمَ (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢). وبياناتُ النظام
      // تطابق الشيتاتِ القديمةَ حسابًا حسابًا — فالعرضُ بالحساب يطابقها. مقفول.
      for (const o of inMonth) {
        if (String(o.project) !== pid) continue;
        const a = acc.get(String(o.rep)); if (!a) continue;
        const row = rowFor(`acc:${o.rep}`, {
          id: a.repId || '—', name: UNKNOWN_NAME.test(a.name) ? 'غير معروف — كان مكتوبًا «ترك العمل»' : a.name, sup: '',
          pos: legacyPos.get(`${mk}|${o.rep}`) ?? Infinity,
        });
        row.editable = false;
        const d = Number(o.dateKey.slice(8, 10));
        row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
      }
    } else {
      // شهرٌ يُكتب فيه: كلُّ مَن كان في هذا المشروع يومًا من الشهر، بحسب سجلّ نقله.
      for (const l of lts) {
        const at = projectTimeline(l);
        const hired = l.hireDate ? riyadhDay(l.hireDate) : '';
        let here = 0;
        for (let d = 1; d <= days; d++) if (isHere(at(`${mk}-${pad(d)}`))) here += 1;
        if (!here) continue;
        const hasOrders = inMonth.some((o) => acc.get(String(o.rep))?.lt === String(l._id));
        if (ended(l) && !hasOrders && mk >= now.slice(0, 7)) continue;
        if (ended(l) && !hasOrders && mk < now.slice(0, 7)) continue;
        const row = person(l);
        for (let d = 1; d <= days; d++) {
          const dk = `${mk}-${pad(d)}`;
          const p = at(dk);
          if (!isHere(p)) row.cells[d] = p ? `في ${p}` : '—';
          else if (hired && dk < hired) row.cells[d] = 'قبل التعيين';
        }
      }
      for (const o of inMonth) {
        const a = acc.get(String(o.rep)); if (!a) continue;
        const d = Number(o.dateKey.slice(8, 10));
        const l = a.lt && ltById.get(a.lt);
        // أوردرُ مشروعٍ آخر لا يُكتب في شيت هذا المشروع — كان يُضاف بحسب خطّ نقل
        // الرجل وحده، فتظهر أوردراتُه في كيتا داخل شيت نينجا.
        if (l && o.project && String(o.project) !== pid) continue;
        if (l) {
          const row = rows.get(`lt:${l._id}`);
          // يومٌ في مشروعٍ آخر لا يُكتب فيه — أمّا «قبل التعيين» فرقمُ أوردراتٍ أصدقُ منه.
          if (!row || (typeof row.cells[d] === 'string' && row.cells[d] !== 'قبل التعيين')) continue;
          if (row.cells[d] === 'قبل التعيين') row.cells[d] = 0;
          row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
        } else if (String(o.project) === pid) {
          // حسابٌ قديمٌ بلا صاحبٍ في السجلّ — يُعرض ولا يُكتب فيه.
          const row = rowFor(`acc:${o.rep}`, { id: '—', name: UNKNOWN_NAME.test(a.name) ? 'غير معروف — كان مكتوبًا «ترك العمل»' : a.name, sup: '', editable: false });
          row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
        }
      }
    }
    // بالمشرف فالاسم، والحساباتُ القديمةُ بلا صاحبٍ في الآخر. ومَن نُقل يبقى بخانات «في X».
    // (ترتيبُ المناديب المحفوظ أُلغي — صاحبُ الشركة، ٢٠٢٦/١٠/٢٢.)
    // والشهرُ القديمُ بترتيب الشيت القديم نفسِه (B2CLegacyRow)، وما لم يُعرف موضعُه بعده.
    const list = mk < SYNC_FROM
      ? [...rows.values()].sort((a, b) => (a.pos === b.pos ? 0 : a.pos < b.pos ? -1 : 1) || a.name.localeCompare(b.name, 'ar'))
      : [...rows.values()].sort((a, b) => (a.id === '—') - (b.id === '—')
        || a.sup.localeCompare(b.sup, 'ar') || a.name.localeCompare(b.name, 'ar'));
    for (const r of list) delete r.pos;
    out[mk] = { days, editable: mk >= SYNC_FROM, stamp: stamps[mk] || '', rows: list };
  }
  const daily = Number(project.dailyTarget) || Math.round((Number(project.monthlyTarget) || 0) / 30);
  return { project: project.nameAr, key: project.name, dailyTarget: daily, today: now, headEmails, months: out };
}

exports.layout = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.query.project);
    if (!project || !project.monthlyTarget) return res.status(404).json({ message: 'project' });
    res.json(await buildLayout(project, monthsOf(req.query.months)));
  } catch (e) {
    console.error('b2c sheets layout', e);
    res.status(500).json({ message: e.message });
  }
};

/** أرقامٌ كُتبت في الشيت — تُكتب في النظام في لحظتها (آخرُ تعديلٍ هو المعتمد). */
exports.edit = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.body.project);
    if (!project) return res.status(404).json({ message: 'project' });
    const { LightTransportEmployee } = require('../models/LightTransport');
    const B2CDailyOrder = require('../models/B2CDailyOrder');
    const B2CRep = require('../models/B2CRep');
    const now = today();
    const results = [];
    let written = 0;
    const allLts = await LightTransportEmployee.find({ idNumber: { $nin: ['', null] } })
      .select('idNumber name projectAr cityAr phone supervisorUser history').lean();
    const ltByKey = new Map(allLts.map((l) => [idKey(l.idNumber), l]));
    const { B2COrderSheet, B2COrderSheetCell } = require('../models/B2COrderSheet');
    const sheetDoc = await B2COrderSheet.findOne({ projectAr: project.nameAr, enabled: true }).select('_id').lean();
    for (const e of (Array.isArray(req.body.edits) ? req.body.edits : []).slice(0, 500)) {
      const month = S(e.month); const day = Number(e.day);
      const dk = `${month}-${pad(day)}`;
      const r = { month, day, id: S(e.id), ok: false };
      results.push(r);
      // الشهورُ قبل أكتوبر 2026 لا يكتب فيها إلّا مسؤولو القسم — حمايةُ أوراقها في
      // الشيت لهم وحدَهم (بريدُهم في «شيتات جوجل»)، فما يصل منها هنا منهم.
      if (!/^\d{4}-\d{2}$/.test(month) || month < FIRST_MONTH || month > LAST_MONTH || !(day >= 1 && day <= 31)) { r.reason = 'month'; continue; }
      const old = month < SYNC_FROM;
      if (dk > now) { r.reason = 'future'; continue; }
      const raw = e.value;
      const value = raw === '' || raw === null || raw === undefined ? null : Number(String(raw).replace(AR_DIGITS, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))));
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2000)) { r.reason = 'value'; continue; }
      if (old) {
        // الشهورُ القديمة تُعرض حسابًا حسابًا كما في الشيت القديم، وعمودُ الرقم فيها رقمُ
        // الحساب على التطبيق (`repId`) لا الإقامة — فيُكتب في ذلك الحساب نفسِه.
        const accs = await B2CRep.find({ repId: S(e.id) }).select('_id branch').lean();
        const inProj = accs.length > 1
          ? await B2CDailyOrder.distinct('rep', { rep: { $in: accs.map((a) => a._id) }, project: project._id, dateKey: { $regex: `^${month}` } })
          : accs.map((a) => a._id);
        if (inProj.length !== 1) { r.reason = accs.length ? 'ambiguous' : 'rep'; continue; }
        const acc = accs.find((a) => String(a._id) === String(inProj[0]));
        const [y, m, d] = dk.split('-').map(Number);
        await B2CDailyOrder.findOneAndUpdate(
          { rep: acc._id, dateKey: dk },
          {
            $set: { orders: value, worked: value !== null && value > 0, source: 'sheet', enteredBy: null, project: project._id, branch: acc.branch, sourceSheet: project.nameAr },
            $setOnInsert: { date: new Date(`${dk}T00:00:00.000Z`), year: y, month: m, day: d },
          },
          { upsert: true },
        );
        r.ok = true; written += 1;
        continue;
      }
      const lt = ltByKey.get(idKey(e.id));
      if (!lt) { r.reason = 'rep'; continue; }
      // لا يُكتب يومٌ كان فيه المندوبُ في مشروعٍ آخر.
      if (E.fold(projectTimeline(lt)(dk)) !== E.fold(project.nameAr)) { r.reason = 'other-project'; continue; }
      const rep = await E.ensureRep(lt, null);
      await E.clearOtherAccounts(lt, rep._id, dk);
      const [y, m, d] = dk.split('-').map(Number);
      await B2CDailyOrder.findOneAndUpdate(
        { rep: rep._id, dateKey: dk },
        {
          $set: { orders: value, worked: value !== null && value > 0, source: 'sheet', enteredBy: null, project: project._id, branch: rep.branch, sourceSheet: project.nameAr },
          $setOnInsert: { date: new Date(`${dk}T00:00:00.000Z`), year: y, month: m, day: d },
        },
        { upsert: true },
      );
      // ولقطةُ القارئ الدوريّ (b2cOrderSheetSync) تُحدَّث معه: وإلّا رأى القارئُ الخانةَ
      // «تغيّرت» بعد دقيقة فكتبها ثانيةً — فوق ما عُدّل على النظام في تلك الدقيقة.
      if (sheetDoc) {
        if (value === null) await B2COrderSheetCell.deleteOne({ sheet: sheetDoc._id, lt: lt._id, dateKey: dk });
        else await B2COrderSheetCell.updateOne({ sheet: sheetDoc._id, lt: lt._id, dateKey: dk }, { $set: { value } }, { upsert: true });
      }
      r.ok = true; written += 1;
    }
    const bad = results.filter((x) => !x.ok);
    if (bad.length) console.warn(`[b2c-sheets] ${project.nameAr}: لم يُحفظ ${bad.length} — ${bad.slice(0, 5).map((x) => `${x.id} ${x.month}-${x.day} ${x.reason}`).join(' · ')}`);
    if (written) {
      cache.clear('b2c:');
      try { require('../websocket/socketManager').emitToAll('b2c:order:upserted', { bulk: true, source: 'sheet', count: written }); } catch (_) { /* */ }
    }
    res.json({ written, results });
  } catch (e) {
    console.error('b2c sheets edit', e);
    res.status(500).json({ message: e.message });
  }
};

/** السكربتُ يقول أين أنشأ ملفَّ كلّ مشروع — ليُعرض في «شيتات جوجل» بالنظام. */
exports.register = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.body.project);
    if (!project) return res.status(404).json({ message: 'project' });
    const { B2COrderSheet } = require('../models/B2COrderSheet');
    const sheetId = S(req.body.spreadsheetId);
    if (!/^[a-zA-Z0-9_-]{20,}$/.test(sheetId)) return res.status(400).json({ message: 'id' });
    // يكتب السكربتُ الأرقامَ إلى النظام بنفسه — فلا قراءةَ بالرابط العامّ (enabled: false).
    await B2COrderSheet.findOneAndUpdate({ sheetId },
      { $set: { projectAr: project.nameAr, url: S(req.body.url), enabled: false, lastOkAt: new Date(), lastError: '' } },
      { upsert: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

/** بصماتُ الشهور كلِّها — ليعيد السكربتُ رسمَ ما تغيّر منها وحدَه. */
exports.stamps = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.query.project);
    if (!project || !project.monthlyTarget) return res.status(404).json({ message: 'project' });
    res.json(await monthStamps(project));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

/**
 * ترتيبٌ جديدٌ من الشيت — سحبَ أحدُ مسؤولي القسم صفوفَ شهرٍ فيه. والسحبُ لا يقدر عليه
 * غيرُهم: الورقةُ محميّةٌ ومحرّروها بريدُهم وحدَه. يُرسل السكربتُ أرقامَ الإقامة بترتيبها.
 *   POST /api/public/b2c-sheets/order  { token, project, month, ids: [iqama] }
 */
exports.order = async (req, res) => {
  // أُلغي ترتيبُ المناديب (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢). السكربتاتُ المثبَّتة قبلُ ما زالت
  // ترسل السحبَ هنا: لا يُحفظ، والشيتُ يُعاد رسمُه من النظام في الدورة التالية.
  if (await guard(req, res)) return;
  return res.json({ ok: false, disabled: true });
  // eslint-disable-next-line no-unreachable
  try {
    const project = await projectOf(req.body.project);
    if (!project) return res.status(404).json({ message: 'project' });
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(idKey).filter((x) => x && x !== '—');
    if (!ids.length) return res.status(400).json({ message: 'ids' });
    const { LightTransportEmployee } = require('../models/LightTransport');
    const lts = await LightTransportEmployee.find({ idNumber: { $nin: ['', null] } }).select('idNumber').lean();
    const byKey = new Map(lts.map((l) => [idKey(l.idNumber), String(l._id)]));
    const ltIds = ids.map((k) => byKey.get(k)).filter(Boolean);
    const order = await saveOrder(project, ltIds, { source: 'sheet' });
    res.json({ ok: true, matched: ltIds.length, unknown: ids.length - ltIds.length, size: order.length });
  } catch (e) {
    console.error('b2c sheets order', e);
    res.status(500).json({ message: e.message });
  }
};

exports._buildLayout = buildLayout;
exports._projectTimeline = projectTimeline;
exports._mergeOrder = mergeOrder;
exports.projectOf = projectOf;
exports.orderOf = orderOf;
exports.saveOrder = saveOrder;
exports.headEmails = headEmails;
exports.setHeadEmails = setHeadEmails;
exports.today = today;
