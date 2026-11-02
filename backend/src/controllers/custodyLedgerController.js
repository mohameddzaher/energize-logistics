/**
 * Custody ledger (cash, purchase card, workshop), written once and used by light transport (ltCustodyController) and heavy transport (htCustodyController) so they cannot diverge.
 * Rules live here, not in the screen: valid sources per account, who may spend into cash, a transfer is two entries; the screen reads `rules`.
 * cfg per custody: Model, key ('lt'|'ht': cache prefix, attachment folder, audit names), event, roles, findRep (holder by ID number), repMissing, vehicles (true = optional fleet vehicle).
 */
const mongoose = require('mongoose');
const { ACCOUNTS, IN_SOURCES, TO_CASH } = require('../models/custodyLedger');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');
const { todayKey } = require('../utils/companyDay');
const { isFinanceFull } = require('../config/financeAuthority');
const { saveUploadFile } = require('../utils/fileStore');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const who = (req) => [req.user.firstName, req.user.lastName].filter(Boolean).join(' ').trim() || '';
/** Editing and deleting a recorded entry is for the system admin and finance only: an entry is money, and whoever enters it does not correct it themselves. */
const canManage = (user) => require('../config/constants').isTopRole(user?.role) || isFinanceFull(user?.role);

const ACC_AR = { cash: 'الكاش', card: 'الكارت', workshop: 'الورشة' };
// opening is an opening balance: written once by script, not chosen from the screen.
const SRC_AR = { card: 'الكارت', workshop: 'الورشة', bank: 'البنك', maintenance: 'الصيانة', rep: 'مندوب', opening: 'رصيد افتتاحي' };

function makeCustodyController(cfg) {
  const { Model, key, event, findRep } = cfg;
  const CACHE = `${key}custody:`;
  const repMissing = cfg.repMissing || 'لا أحدَ بهذا الرقم';
  const repWord = cfg.repWord || 'المندوب';
  const vehicles = !!cfg.vehicles;

  /** Saves the sent base64 files and returns their lines, or throws a message shown as is. */
  function saveFiles(req, files) {
    const out = [];
    for (const f of Array.isArray(files) ? files.slice(0, 10) : []) {
      if (!f?.dataUrl) continue;
      const stored = saveUploadFile(f.dataUrl, `${key}custody`, f.fileName || '');
      out.push({ ...stored, title: String(f.title || f.fileName || '').trim().slice(0, 150) || stored.fileName, uploadedByName: who(req), uploadedAt: new Date() });
    }
    return out;
  }
  const changed = () => {
    try { cache.clear(CACHE); } catch (_) { /* */ }
    try { emitToAll(event, { at: Date.now() }); } catch (_) { /* */ }
  };

  /**
   * Vehicle: from the Location Solutions fleet. Chosen by unit number (Ls2Vehicle.unitId); its plate and name are captured at entry time so the entry stays readable if the unit is renamed or leaves the fleet.
   * null = no vehicle, false = a number with no unit (returns 400).
   */
  async function findVehicle(unitId) {
    if (unitId === undefined || unitId === null || String(unitId).trim() === '') return null;
    const n = Number(unitId);
    if (!Number.isFinite(n)) return false;
    const Ls2Vehicle = require('../models/Ls2Vehicle');
    const v = await Ls2Vehicle.findOne({ unitId: n }).select('unitId plate name vehicleMaster').lean();
    if (!v) return false;
    // And its vehicle in the vehicle register: a reference, not a copy (services/ls2VehicleLink).
    return { vehicleUnitId: v.unitId, vehiclePlate: v.plate || '', vehicleName: v.name || '', vehicleMaster: v.vehicleMaster || null };
  }
  const NO_VEHICLE = { vehicleUnitId: null, vehiclePlate: '', vehicleName: '', vehicleMaster: null };

  // GET /custody/vehicles: vehicle list for the dropdown, the whole fleet ordered by plate.
  async function listVehicles(req, res) {
    try {
      const Ls2Vehicle = require('../models/Ls2Vehicle');
      const list = await cache.wrap(`${CACHE}vehicles`, 60000, () => Ls2Vehicle.find({})
        .select('unitId plate name driver').lean());
      const rows = list.map((v) => ({ unitId: v.unitId, plate: v.plate || '', name: v.name || '', driver: v.driver || '' }))
        .sort((a, b) => (a.plate || a.name).localeCompare(b.plate || b.name, 'ar'));
      res.json({ vehicles: rows });
    } catch (e) { res.status(500).json({ message: 'تعذّر تحميل السيّارات' }); }
  }

  // GET /custody/rep?id=<residence number>
  async function lookupRep(req, res) {
    try {
      const rep = await findRep(req.query.id);
      if (!rep) return res.status(404).json({ message: repMissing });
      res.json({ rep });
    } catch (e) { res.status(500).json({ message: 'تعذّر البحث برقم الهويّة' }); }
  }

  /** Balances of the three accounts, over all entries and not just what the filter selected. */
  async function balances() {
    const agg = await Model.aggregate([
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

  // GET /custody?account=&direction=&target=&source=&vehicle=&from=&to=&q=
  async function list(req, res) {
    try {
      const q = req.query || {};
      const f = {};
      if (ACCOUNTS.includes(q.account)) f.account = q.account;
      if (q.direction === 'in' || q.direction === 'out') f.direction = q.direction;
      if (['rep', 'company', 'cash'].includes(q.target)) f.target = q.target;
      if (['card', 'workshop', 'bank', 'maintenance', 'rep', 'opening'].includes(q.source)) f.source = q.source;
      if (vehicles && q.vehicle && Number.isFinite(Number(q.vehicle))) f.vehicleUnitId = Number(q.vehicle);
      // Also from the vehicle file and the employee file: a truck in fleet management is known by its register vehicle, not a Location Solutions unit number, and the employee by their HR file. Both are references kept on the entry.
      if (vehicles && mongoose.isValidObjectId(q.vehicleMaster)) f.vehicleMaster = new mongoose.Types.ObjectId(String(q.vehicleMaster));
      if (mongoose.isValidObjectId(q.employee)) f.employee = new mongoose.Types.ObjectId(String(q.employee));
      if (YMD.test(q.from || '') || YMD.test(q.to || '')) {
        f.date = {};
        if (YMD.test(q.from || '')) f.date.$gte = q.from;
        if (YMD.test(q.to || '')) f.date.$lte = q.to;
      }
      const s = String(q.q || '').trim().slice(0, 60);
      if (s) {
        const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        f.$or = [{ repName: rx }, { repIdNumber: rx }, { detail: rx }, { createdByName: rx },
          ...(vehicles ? [{ vehiclePlate: rx }, { vehicleName: rx }] : [])];
      }
      const [entries, bal] = await Promise.all([
        Model.find(f).sort({ date: -1, createdAt: -1 }).limit(2000).lean(),
        cache.wrap(`${CACHE}balances`, 15000, balances),
      ]);
      // Total of what is shown, under the filter.
      const shown = { in: 0, out: 0 };
      for (const e of entries) shown[e.direction] += e.amount;
      res.json({
        entries,
        balances: bal,
        shown: { in: r2(shown.in), out: r2(shown.out), net: r2(shown.in - shown.out), count: entries.length },
        rules: { accounts: ACCOUNTS, inSources: IN_SOURCES, toCash: TO_CASH, vehicles },
        canDelete: canManage(req.user), canEdit: canManage(req.user),
        today: todayKey(),
      });
    } catch (e) {
      console.error(`${key}Custody list:`, e);
      res.status(500).json({ message: 'تعذّر تحميل العهدة' });
    }
  }

  function describe(rows) {
    // Outgoing first, so 'from ... to ...' reads correctly whichever order the two sides arrive in.
    const entries = [...rows].sort((a, b) => (a.direction === 'out' ? -1 : 1) - (b.direction === 'out' ? -1 : 1));
    const e = entries[0];
    const car = e.vehiclePlate || e.vehicleName ? ` — السيّارة ${e.vehiclePlate || e.vehicleName}` : '';
    if (entries.length === 2) return `تحويل ${e.amount} من ${ACC_AR[entries[0].account]} إلى ${ACC_AR[entries[1].account]}`;
    if (e.direction === 'in') return `وارد ${e.amount} إلى ${ACC_AR[e.account]} من ${e.source === 'rep' ? `${repWord} ${e.repName} (${e.repIdNumber})` : (SRC_AR[e.source] || e.source)}${car}`;
    return `صادر ${e.amount} من ${ACC_AR[e.account]} — ${e.target === 'rep' ? `${repWord} ${e.repName} (${e.repIdNumber})` : `الشركة: ${e.detail}`}${car}`;
  }

  // POST /custody: one entry, or two if it is a transfer between accounts.
  async function create(req, res) {
    try {
      const b = req.body || {};
      const account = String(b.account || '');
      const direction = b.direction === 'in' ? 'in' : b.direction === 'out' ? 'out' : '';
      if (!ACCOUNTS.includes(account) || !direction) return res.status(400).json({ message: 'اختر الحسابَ ونوعَ الحركة' });
      const amount = r2(b.amount);
      if (!(amount > 0)) return res.status(400).json({ message: 'اكتب المبلغ', fields: { amount: 'مطلوب' } });
      const date = YMD.test(String(b.date || '')) ? String(b.date) : todayKey();
      const detail = String(b.detail || '').trim().slice(0, 500);
      // The vehicle is optional; a number with no unit is rejected, not silently dropped.
      let car = {};
      if (vehicles) {
        const v = await findVehicle(b.vehicleUnitId);
        if (v === false) return res.status(400).json({ message: 'السيّارةُ غير موجودة في أسطول لوكيشن سوليوشن', fields: { vehicleUnitId: 'غير معروفة' } });
        car = v || {};
      }
      let attachments = [];
      try { attachments = saveFiles(req, b.files); } catch (e) { return res.status(400).json({ message: e.message === 'File too large (max 20MB).' ? 'الملفّ أكبر من ٢٠ ميغابايت' : 'نوعُ الملفّ غير مدعوم — صورة أو PDF أو Word أو Excel' }); }
      const base = { amount, date, detail, createdBy: req.user._id, createdByName: who(req) };
      const docs = [];
      const transferId = new mongoose.Types.ObjectId();

      if (direction === 'in') {
        const source = String(b.source || '');
        if (!IN_SOURCES[account].includes(source)) return res.status(400).json({ message: 'مصدرُ الوارد لا يصحّ لهذا الحساب' });
        if (source === 'rep') {
          // A holder returns money to cash; identified by residence number as in outgoing.
          const r = await findRep(b.repIdNumber);
          if (!r) return res.status(400).json({ message: `اكتب رقمَ الإقامة — ${repMissing}`, fields: { repIdNumber: 'غير معروف' } });
          docs.push({
            ...base, ...car, account, direction: 'in', source: 'rep', attachments,
            repIdNumber: r.idNumber, repName: r.name, repNationality: r.nationality, repProject: r.project, employee: r.employee,
          });
        } else if (ACCOUNTS.includes(source)) {
          // Incoming from another account is a transfer: outgoing there and incoming here. Money that moved has no vehicle.
          docs.push({ ...base, account: source, direction: 'out', target: account, transferId });
          docs.push({ ...base, account, direction: 'in', source, transferId });
        } else {
          docs.push({ ...base, ...car, account, direction: 'in', source });
        }
      } else {
        const target = String(b.target || '');
        if (target === 'cash') {
          if (!TO_CASH.includes(account)) return res.status(400).json({ message: 'هذا الحسابُ لا يصرف إلى الكاش' });
          docs.push({ ...base, account, direction: 'out', target: 'cash', transferId, attachments });
          docs.push({ ...base, account: 'cash', direction: 'in', source: account, transferId });
        } else if (target === 'rep') {
          const rep = await findRep(b.repIdNumber);
          if (!rep) return res.status(400).json({ message: `اكتب رقمَ الإقامة — ${repMissing}`, fields: { repIdNumber: 'غير معروف' } });
          docs.push({
            ...base, ...car, account, direction: 'out', target: 'rep', attachments,
            repIdNumber: rep.idNumber, repName: rep.name, repNationality: rep.nationality, repProject: rep.project, employee: rep.employee,
          });
        } else if (target === 'company') {
          if (!detail) return res.status(400).json({ message: 'اكتب البيان: ما الصرف؟ (ماء، كهرباء، صيانة…)', fields: { detail: 'مطلوب' } });
          docs.push({ ...base, ...car, account, direction: 'out', target: 'company', attachments });
        } else {
          return res.status(400).json({ message: 'اختر المتحمِّل' });
        }
      }

      const created = await Model.insertMany(docs);
      changed();
      await logAudit({
        user: req.user, action: `${key}_custody_entry`, entity: Model.modelName, entityId: created[created.length - 1]._id,
        changes: { details: describe(created), after: created.map((e) => ({ account: e.account, direction: e.direction, amount: e.amount, date: e.date, ...(vehicles && e.vehiclePlate ? { vehicle: e.vehiclePlate } : {}) })) },
        ipAddress: req.ip,
      });
      res.status(201).json({ entries: created, balances: await balances() });
    } catch (e) {
      console.error(`${key}Custody create:`, e);
      res.status(500).json({ message: 'تعذّر تسجيل الحركة' });
    }
  }

  // DELETE /custody/:id; the other side of a transfer is deleted with it.
  async function remove(req, res) {
    try {
      if (!canManage(req.user)) return res.status(403).json({ message: 'حذفُ قيدِ العهدة لمدير النظام وأهل المال' });
      const e = await Model.findById(req.params.id).lean();
      if (!e) return res.status(404).json({ message: 'القيد غير موجود' });
      const group = e.transferId ? await Model.find({ transferId: e.transferId }).lean() : [e];
      await Model.deleteMany({ _id: { $in: group.map((x) => x._id) } });
      changed();
      await logAudit({
        user: req.user, action: `${key}_custody_delete`, entity: Model.modelName, entityId: e._id,
        changes: { details: `حذف: ${describe(group)}`, before: group }, ipAddress: req.ip,
      });
      res.json({ deleted: group.length, balances: await balances() });
    } catch (e) { res.status(500).json({ message: 'تعذّر حذف القيد' }); }
  }

  /**
   * PUT /custody/:id: correct a recorded entry: amount, day, detail, holder, vehicle and attachments.
   * The entry type does not change (account, direction, source): an entry in the wrong place is deleted and re-entered. A transfer has two sides, so its amount, day and detail are corrected on both, otherwise the balances break. A transfer has no vehicle.
   * body: { amount?, date?, detail?, repIdNumber?, vehicleUnitId? ('' removes it), files?: [{dataUrl,fileName,title}], removeAttachments?: [id] }
   */
  async function update(req, res) {
    try {
      if (!canManage(req.user)) return res.status(403).json({ message: 'تعديلُ قيدِ العهدة لمدير النظام وأهل المال' });
      const e = await Model.findById(req.params.id);
      if (!e) return res.status(404).json({ message: 'القيد غير موجود' });
      const b = req.body || {};
      const snap = () => ({ amount: e.amount, date: e.date, detail: e.detail, repIdNumber: e.repIdNumber, attachments: e.attachments.length, ...(vehicles ? { vehicle: e.vehiclePlate || '' } : {}) });
      const before = snap();
      const shared = {};
      if (b.amount !== undefined) {
        const amount = r2(b.amount);
        if (!(amount > 0)) return res.status(400).json({ message: 'اكتب المبلغ', fields: { amount: 'مطلوب' } });
        shared.amount = amount;
      }
      if (b.date !== undefined) {
        if (!YMD.test(String(b.date))) return res.status(400).json({ message: 'التاريخ غير صحيح' });
        shared.date = String(b.date);
      }
      if (b.detail !== undefined) {
        const detail = String(b.detail || '').trim().slice(0, 500);
        if (e.target === 'company' && !detail) return res.status(400).json({ message: 'اكتب البيان: ما الصرف؟ (ماء، كهرباء، صيانة…)', fields: { detail: 'مطلوب' } });
        shared.detail = detail;
      }
      const isRepEntry = e.target === 'rep' || e.source === 'rep';
      if (isRepEntry && b.repIdNumber !== undefined && String(b.repIdNumber).replace(/\s+/g, '') !== e.repIdNumber) {
        const r = await findRep(b.repIdNumber);
        if (!r) return res.status(400).json({ message: repMissing, fields: { repIdNumber: 'غير معروف' } });
        Object.assign(e, { repIdNumber: r.idNumber, repName: r.name, repNationality: r.nationality, repProject: r.project, employee: r.employee });
      }
      if (vehicles && !e.transferId && b.vehicleUnitId !== undefined) {
        const v = await findVehicle(b.vehicleUnitId);
        if (v === false) return res.status(400).json({ message: 'السيّارةُ غير موجودة في أسطول لوكيشن سوليوشن', fields: { vehicleUnitId: 'غير معروفة' } });
        Object.assign(e, v || NO_VEHICLE);
      }
      const drop = new Set((Array.isArray(b.removeAttachments) ? b.removeAttachments : []).map(String));
      if (drop.size) e.attachments = e.attachments.filter((a) => !drop.has(String(a._id)));
      try { e.attachments.push(...saveFiles(req, b.files)); } catch (err) { return res.status(400).json({ message: 'نوعُ الملفّ غير مدعوم أو حجمُه أكبر من ٢٠ ميغابايت' }); }
      Object.assign(e, shared, { editedByName: who(req), editedAt: new Date() });
      await e.save();
      if (e.transferId && Object.keys(shared).length) {
        await Model.updateMany({ transferId: e.transferId, _id: { $ne: e._id } }, { $set: { ...shared, editedByName: who(req), editedAt: new Date() } });
      }
      changed();
      await logAudit({
        user: req.user, action: `${key}_custody_update`, entity: Model.modelName, entityId: e._id,
        changes: { details: `تعديل: ${describe([e])}`, before, after: snap() },
        ipAddress: req.ip,
      });
      res.json({ entry: e, balances: await balances() });
    } catch (err) {
      console.error(`${key}Custody update:`, err);
      res.status(500).json({ message: 'تعذّر تعديل القيد' });
    }
  }

  return { list, create, update, remove, lookupRep, listVehicles, balances };
}

module.exports = { makeCustodyController, canManage };
