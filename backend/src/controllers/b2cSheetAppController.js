/**
 * Order sheets managed by a Google Apps Script, not a public link. The system owns the file: the script requests each month's layout, draws it, and sends every typed number back at once; the latest edit wins. Section managers' emails are protection editors.
 * GET /api/public/b2c-sheets/layout?project=Keeta&months=2026-10,2026-11|all&token=
 * POST /api/public/b2c-sheets/edit
 * Auth is a server-generated key (models/B2COrderSheet sheetsToken) embedded in the script, since Google carries no session.
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

/** Requested months: 'all' or a comma-separated list (YYYY-MM). */
function monthsOf(q) {
  const out = [];
  if (S(q) === 'all') {
    let [y, m] = FIRST_MONTH.split('-').map(Number);
    while (`${y}-${pad(m)}` <= LAST_MONTH) { out.push(`${y}-${pad(m)}`); m += 1; if (m > 12) { m = 1; y += 1; } }
    return out;
  }
  return S(q).split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}$/.test(x));
}

/** The rep's project on each day; see utils/b2cEntry.projectTimeline. */
const projectTimeline = E.projectTimeline;

// Rep order and section managers' emails

/** Saved order for the project: registry row ids in order. */
async function orderOf(projectId) {
  const { B2CSheetOrder } = require('../models/B2COrderSheet');
  return B2CSheetOrder.findById(projectId).lean();
}

/** Merges a partial order (reps of one month) into the whole project's order: the sent reps take the slots they held, in the new order; the others stay in place; new ones go last. */
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

/** Google emails of the section managers, protection editors on the sheets. */
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

/** Stamp per month; it changes if a number changes (in the system or from the sheet), the project order changes, or the managers' emails change. The script then redraws only the changed old months (last, current and next months are redrawn every time). */
async function monthStamps(project) {
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const agg = await B2CDailyOrder.aggregate([
    { $match: { dateKey: { $gte: `${FIRST_MONTH}-01`, $lte: `${LAST_MONTH}-31` } } },
    { $group: { _id: { $substrBytes: ['$dateKey', 0, 7] }, at: { $max: '$updatedAt' }, n: { $sum: 1 } } },
  ]);
  const by = new Map(agg.map((a) => [a._id, a]));
  const ord = await orderOf(project._id);
  const em = await headEmails();
  // `L4`: the 'actual driver residence' column was added, so all months are redrawn once.
  const tail = `L4.${ord?.updatedAt ? new Date(ord.updatedAt).getTime() : 0}.${em.at ? new Date(em.at).getTime() : 0}`;
  const out = {};
  for (const mk of monthsOf('all')) {
    const a = by.get(mk);
    out[mk] = `${a ? `${new Date(a.at || 0).getTime()}.${a.n}` : '0'}.${tail}`;
  }
  return { stamps: out, headEmails: em.emails };
}

/** All month data for one project. */
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
    .select('idNumber name projectAr supervisorName isActive workStatusAr employee hireDate history vehicle').lean())
    .filter((r) => !(r.employee && sets.archivedIds.has(String(r.employee._id))));
  const ltById = new Map(lts.map((l) => [String(l._id), l]));
  // Actual driver residence: the rider of the rep's vehicle. The account is in one man's name but another may ride the vehicle; the 'actual driver' in the vehicle registry (VehicleMaster.actualDriver) is who is accountable. A read-and-copy column in the sheet.
  const VM = require('../models/VehicleMaster').VehicleMaster;
  const vehIds = [...new Set(lts.map((l) => l.vehicle && String(l.vehicle)).filter(Boolean))];
  const actualByVeh = new Map((vehIds.length ? await VM.find({ _id: { $in: vehIds } }).select('actualDriver').lean() : [])
    .map((v) => [String(v._id), S(v.actualDriver && v.actualDriver.idNumber)]));
  const actualOf = (l) => (l && l.vehicle ? actualByVeh.get(String(l.vehicle)) || '' : '') || '—';
  const nameKey = (v) => E.fold(v);
  const ltByName = new Map();
  for (const l of lts) { const k = nameKey(l.name); ltByName.set(k, ltByName.has(k) ? null : l); }

  const reps = await B2CRep.find({}).select('arabicName englishName repId ltEmployee').lean();
  // In the old sheet the first name is `englishName` (the name column; see b2cExcelParser), and `arabicName` is a second name sometimes written in the account column. The second used to be read first, so names in the new sheet differed from the old.
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
    const person = (l) => rowFor(`lt:${l._id}`, { lt: String(l._id), id: S(l.idNumber), name: S(l.name), sup: S(l.supervisorName), actual: actualOf(l), editable: true });
    const inMonth = orders.filter((o) => o.dateKey.startsWith(mk));

    if (mk < SYNC_FROM) {
      // A reference month, exactly as in the old sheet: a row per account by its name there, not per man. Accounts used to be merged into their owner and summed, but one old-sheet account was worked by several drivers, so the numbers did not match the old. System data matches the old sheets account by account, so showing by account matches them. Locked.
      for (const o of inMonth) {
        if (String(o.project) !== pid) continue;
        const a = acc.get(String(o.rep)); if (!a) continue;
        const row = rowFor(`acc:${o.rep}`, {
          id: a.repId || '—', name: UNKNOWN_NAME.test(a.name) ? 'غير معروف — كان مكتوبًا «ترك العمل»' : a.name, sup: '',
          actual: actualOf(a.lt && ltById.get(a.lt)),
          pos: legacyPos.get(`${mk}|${o.rep}`) ?? Infinity,
        });
        row.editable = false;
        const d = Number(o.dateKey.slice(8, 10));
        row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
      }
    } else {
      // A writable month: everyone who was in this project on any day of the month, by transfer log.
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
        // Another project's order is not written in this project's sheet. It used to be added by the man's transport line alone, so his Keeta orders appeared inside the Ninja sheet.
        if (l && o.project && String(o.project) !== pid) continue;
        if (l) {
          const row = rows.get(`lt:${l._id}`);
          // A day in another project is not written; 'before assignment' is a truer order number than that.
          if (!row || (typeof row.cells[d] === 'string' && row.cells[d] !== 'قبل التعيين')) continue;
          if (row.cells[d] === 'قبل التعيين') row.cells[d] = 0;
          row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
        } else if (String(o.project) === pid) {
          // An old account with no owner in the registry is shown but not written.
          const row = rowFor(`acc:${o.rep}`, { id: '—', name: UNKNOWN_NAME.test(a.name) ? 'غير معروف — كان مكتوبًا «ترك العمل»' : a.name, sup: '', actual: '—', editable: false });
          row.cells[d] = (Number(row.cells[d]) || 0) + o.orders;
        }
      }
    }
    // Ordered by supervisor then name, old accounts with no owner last. A transferred rep keeps the 'in X' cells. (Saved rep order was dropped.) An old month follows the old sheet's own order (B2CLegacyRow), and anything whose place is unknown goes after it.
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

/** Numbers written in the sheet are written to the system at once (latest edit wins). */
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
      // Months before October 2026 are written only by section managers: the sheet protects those tabs for them alone (their emails in the Google sheets page), so what arrives here comes from them.
      if (!/^\d{4}-\d{2}$/.test(month) || month < FIRST_MONTH || month > LAST_MONTH || !(day >= 1 && day <= 31)) { r.reason = 'month'; continue; }
      const old = month < SYNC_FROM;
      if (dk > now) { r.reason = 'future'; continue; }
      const raw = e.value;
      const value = raw === '' || raw === null || raw === undefined ? null : Number(String(raw).replace(AR_DIGITS, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))));
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2000)) { r.reason = 'value'; continue; }
      if (old) {
        // Old months are shown account by account as in the old sheet, and the number column holds the app account number (`repId`), not the residence, so it is written to that same account.
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
      // A day when the rep was in another project is not written.
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
      // The periodic reader's snapshot (b2cOrderSheetSync) is updated too; otherwise the reader sees the cell as 'changed' a minute later and writes it again, over what was edited in the system in that minute.
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

/** The script reports where it created each project's file, to show in the system's Google sheets page. */
exports.register = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.body.project);
    if (!project) return res.status(404).json({ message: 'project' });
    const { B2COrderSheet } = require('../models/B2COrderSheet');
    const sheetId = S(req.body.spreadsheetId);
    if (!/^[a-zA-Z0-9_-]{20,}$/.test(sheetId)) return res.status(400).json({ message: 'id' });
    // The script writes numbers to the system itself, so there is no public-link reading (enabled: false).
    await B2COrderSheet.findOneAndUpdate({ sheetId },
      { $set: { projectAr: project.nameAr, url: S(req.body.url), enabled: false, lastOkAt: new Date(), lastError: '' } },
      { upsert: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

/** Stamps of all months, so the script redraws only what changed. */
exports.stamps = async (req, res) => {
  try {
    if (await guard(req, res)) return;
    const project = await projectOf(req.query.project);
    if (!project || !project.monthlyTarget) return res.status(404).json({ message: 'project' });
    res.json(await monthStamps(project));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

/**
 * New order from the sheet: a section manager dragged a month's rows. Only they can drag (the sheet is protected and its editors are their emails). The script sends residence numbers in order.
 * POST /api/public/b2c-sheets/order
 */
exports.order = async (req, res) => {
  // Rep ordering was removed. Scripts installed earlier still send the drag here: it is not saved, and the sheet is redrawn from the system in the next cycle.
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
