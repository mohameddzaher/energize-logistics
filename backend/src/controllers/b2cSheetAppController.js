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

/**
 * مشروعُ المندوب في كلّ يوم — من سجلّ نقله (`history` بـ kind: project).
 * يُرجع دالّةً: dateKey → اسمُ المشروع في ذلك اليوم.
 */
function projectTimeline(lt) {
  const moves = (lt.history || []).filter((h) => h.kind === 'project' && h.at)
    .map((h) => ({ day: riyadhDay(h.at), from: S(h.fromValue), to: S(h.toValue) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return (dk) => {
    if (!moves.length) return S(lt.projectAr);
    // النقلُ نافذٌ من يومه: يومُ النقل في المشروع الجديد.
    let cur = moves[0].from || S(lt.projectAr);
    for (const mv of moves) { if (mv.day <= dk) cur = mv.to; else break; }
    return cur;
  };
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

  const lts = (await LightTransportEmployee.find({ $or: [{ staffKind: 'rep' }, { contractTypeAr: /يوزر/ }] })
    .populate('employee', 'employmentStatus')
    .select('idNumber name projectAr supervisorName isActive workStatusAr employee hireDate history').lean())
    .filter((r) => !(r.employee && sets.archivedIds.has(String(r.employee._id))));
  const ltById = new Map(lts.map((l) => [String(l._id), l]));
  const nameKey = (v) => E.fold(v);
  const ltByName = new Map();
  for (const l of lts) { const k = nameKey(l.name); ltByName.set(k, ltByName.has(k) ? null : l); }

  const reps = await B2CRep.find({}).select('arabicName englishName ltEmployee').lean();
  const acc = new Map(reps.map((r) => [String(r._id), { name: S(r.arabicName || r.englishName), lt: r.ltEmployee ? String(r.ltEmployee) : null }]));
  const first = months[0]; const last = months[months.length - 1];
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
    const person = (l) => rowFor(`lt:${l._id}`, { id: S(l.idNumber), name: S(l.name), sup: S(l.supervisorName), editable: true });
    const inMonth = orders.filter((o) => o.dateKey.startsWith(mk));

    if (mk < SYNC_FROM) {
      // شهرٌ للرجوع إليه: كلُّ حسابٍ إلى صاحبه إن عُرف، والأرقامُ تُجمَع. مقفولٌ كلُّه.
      for (const o of inMonth) {
        if (String(o.project) !== pid) continue;
        const a = acc.get(String(o.rep)); if (!a) continue;
        const l = (a.lt && ltById.get(a.lt)) || (UNKNOWN_NAME.test(a.name) ? null : ltByName.get(nameKey(a.name))) || null;
        const row = l ? person(l) : rowFor(`acc:${o.rep}`, {
          id: '—', name: UNKNOWN_NAME.test(a.name) ? 'غير معروف — كان مكتوبًا «ترك العمل»' : a.name, sup: '',
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
    const list = [...rows.values()].sort((a, b) => (a.id === '—') - (b.id === '—') || a.sup.localeCompare(b.sup, 'ar') || a.name.localeCompare(b.name, 'ar'));
    out[mk] = { days, editable: mk >= SYNC_FROM, rows: list };
  }
  const daily = Number(project.dailyTarget) || Math.round((Number(project.monthlyTarget) || 0) / 30);
  return { project: project.nameAr, key: project.name, dailyTarget: daily, today: now, months: out };
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
    const now = today();
    const results = [];
    let written = 0;
    const allLts = await LightTransportEmployee.find({ idNumber: { $nin: ['', null] } })
      .select('idNumber name projectAr cityAr phone supervisorUser history').lean();
    const ltByKey = new Map(allLts.map((l) => [idKey(l.idNumber), l]));
    for (const e of (Array.isArray(req.body.edits) ? req.body.edits : []).slice(0, 500)) {
      const month = S(e.month); const day = Number(e.day);
      const dk = `${month}-${pad(day)}`;
      const r = { month, day, id: S(e.id), ok: false };
      results.push(r);
      if (!/^\d{4}-\d{2}$/.test(month) || month < SYNC_FROM || !(day >= 1 && day <= 31)) { r.reason = 'month'; continue; }
      if (dk > now) { r.reason = 'future'; continue; }
      const raw = e.value;
      const value = raw === '' || raw === null || raw === undefined ? null : Number(String(raw).replace(AR_DIGITS, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))));
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2000)) { r.reason = 'value'; continue; }
      const lt = ltByKey.get(idKey(e.id));
      if (!lt) { r.reason = 'rep'; continue; }
      // لا يُكتب يومٌ كان فيه المندوبُ في مشروعٍ آخر.
      if (E.fold(projectTimeline(lt)(dk)) !== E.fold(project.nameAr)) { r.reason = 'other-project'; continue; }
      const rep = await E.ensureRep(lt, null);
      const [y, m, d] = dk.split('-').map(Number);
      await B2CDailyOrder.findOneAndUpdate(
        { rep: rep._id, dateKey: dk },
        {
          $set: { orders: value, worked: value !== null && value > 0, source: 'sheet', enteredBy: null, project: project._id, branch: rep.branch, sourceSheet: project.nameAr },
          $setOnInsert: { date: new Date(`${dk}T00:00:00.000Z`), year: y, month: m, day: d },
        },
        { upsert: true },
      );
      r.ok = true; written += 1;
    }
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

exports._buildLayout = buildLayout;
exports._projectTimeline = projectTimeline;
