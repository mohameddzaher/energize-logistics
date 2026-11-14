/**
 * Links carrier trucks and drivers to the suppliers they actually worked for, read from shipment history.
 * Evidence per order: its supplier (reference, else the supplier name, which matches the register exactly) and its
 * truck (reference, else the plate by the Arabic/Latin-independent key) and driver (iqama, else a phone that belongs to
 * one registered driver only). Names alone are never used to identify a driver.
 *
 * Written on --apply (backup first), additive only:
 *  - a truck/driver with a primary supplier gets every other supplier it worked for added to `suppliers`;
 *  - one with no primary that worked for exactly one supplier takes it as primary.
 * Left for the team, in the Excel report only:
 *  - no primary and several suppliers (whose it is cannot be read from history);
 *  - a plate that matches more than one registered truck, or a phone shared by several drivers.
 * Our own trucks (ownership 'ours') are never linked. Usage: node src/scripts/inferSupplierLinks.js [--apply] [--only=primary] [--out=report.xlsx]
 * --only=primary writes just the rows with no supplier yet. Extra links wait for the team: many are one carrier under two
 * names in the supplier register, which a merge fixes, not a link.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { canonicalPlateKey } = require('../utils/plateKey');

const APPLY = process.argv.includes('--apply');
const ONLY_PRIMARY = process.argv.includes('--only=primary');
const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
const BACKUP_DIR = fs.existsSync('/opt/energize/backups') ? '/opt/energize/backups' : path.join(process.cwd(), 'backups');
const S = (v) => String(v == null ? '' : v).trim();
const digits = (v) => S(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
// Saudi mobile in its three written forms (05.., 5.., 9665..) reduces to the last nine digits.
const phoneKey = (v) => { const d = digits(v).replace(/^(00)?966/, '').replace(/^0/, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const iqamaKey = (v) => { const d = digits(v); return /^[12]\d{9}$/.test(d) ? d : ''; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const ShipmentOrder = require('../models/ShipmentOrder');
  const Supplier = require('../models/ShipmentOrderSupplier');
  const Vehicle = require('../models/ShipmentOrderVehicle');
  const Driver = require('../models/ShipmentOrderDriver');

  // Suppliers: by id and by exact name; a merged supplier counts as its survivor.
  const sups = await Supplier.find({}).select('name mergedInto').lean();
  const supById = new Map(sups.map((s) => [String(s._id), s]));
  const live = (id) => { let s = supById.get(String(id)); let n = 0; while (s && s.mergedInto && n++ < 5) s = supById.get(String(s.mergedInto)); return s || null; };
  const byName = new Map();
  for (const s of sups) { if (!s.mergedInto) { const k = S(s.name); if (k && !byName.has(k)) byName.set(k, s); } }
  for (const s of sups) { const k = S(s.name); if (k && !byName.has(k)) { const l = live(s._id); if (l) byName.set(k, l); } }
  const supName = (id) => S(supById.get(String(id))?.name);

  const vehicles = await Vehicle.find({}).select('plate supplier suppliers ownership isActive').lean();
  const vById = new Map(vehicles.map((v) => [String(v._id), v]));
  const vByKey = new Map();
  for (const v of vehicles) { const k = canonicalPlateKey(v.plate); if (!k) continue; if (!vByKey.has(k)) vByKey.set(k, []); vByKey.get(k).push(v); }

  const drivers = await Driver.find({}).select('name phone residenceNumber supplier suppliers isActive').lean();
  const dById = new Map(drivers.map((d) => [String(d._id), d]));
  const dByIqama = new Map(); const dByPhone = new Map();
  for (const d of drivers) {
    const iq = iqamaKey(d.residenceNumber); if (iq) { if (!dByIqama.has(iq)) dByIqama.set(iq, []); dByIqama.get(iq).push(d); }
    const ph = phoneKey(d.phone); if (ph) { if (!dByPhone.has(ph)) dByPhone.set(ph, []); dByPhone.get(ph).push(d); }
  }

  const vSeen = new Map(); const dSeen = new Map(); // id -> Map(supplierId -> { n, last })
  const plateClash = new Map(); const phoneClash = new Map();
  const unresolvedPlates = new Map();
  let orders = 0; let noSupplier = 0;
  const note = (m, id, sid, date) => {
    if (!m.has(id)) m.set(id, new Map());
    const x = m.get(id).get(sid) || { n: 0, last: '' };
    x.n += 1; const day = date ? new Date(date).toISOString().slice(0, 10) : '';
    if (day > x.last) x.last = day;
    m.get(id).set(sid, x);
  };

  const cur = ShipmentOrder.find({}).select('supplier supplierName vehicle vehiclePlate driverIqama driverPhone driverName createdAt').lean().cursor();
  for await (const o of cur) {
    orders += 1;
    const sup = (o.supplier && live(o.supplier)) || byName.get(S(o.supplierName)) || null;
    if (!sup) { noSupplier += 1; continue; }
    const sid = String(sup._id);
    // Truck.
    let v = o.vehicle ? vById.get(String(o.vehicle)) : null;
    if (!v && S(o.vehiclePlate)) {
      const k = canonicalPlateKey(o.vehiclePlate);
      const hits = k ? (vByKey.get(k) || []) : [];
      if (hits.length === 1) [v] = hits;
      else if (hits.length > 1) plateClash.set(k, { plate: S(o.vehiclePlate), trucks: hits.map((h) => h.plate).join(' | '), n: (plateClash.get(k)?.n || 0) + 1 });
      else if (k) unresolvedPlates.set(S(o.vehiclePlate), (unresolvedPlates.get(S(o.vehiclePlate)) || 0) + 1);
    }
    if (v && v.ownership !== 'ours') note(vSeen, String(v._id), sid, o.createdAt);
    // Driver: iqama, else a phone owned by one driver only.
    let d = null;
    const iq = iqamaKey(o.driverIqama);
    if (iq && (dByIqama.get(iq) || []).length === 1) [d] = dByIqama.get(iq);
    if (!d) {
      const ph = phoneKey(o.driverPhone);
      const hits = ph ? (dByPhone.get(ph) || []) : [];
      if (hits.length === 1) [d] = hits;
      else if (hits.length > 1) phoneClash.set(ph, { phone: S(o.driverPhone), drivers: hits.map((h) => h.name).join(' | '), n: (phoneClash.get(ph)?.n || 0) + 1 });
    }
    if (d) note(dSeen, String(d._id), sid, o.createdAt);
  }

  // Decide.
  const plan = { vehicles: [], drivers: [] }; const ambiguous = [];
  const decide = (kind, seen, byId) => {
    for (const [id, m] of seen) {
      const row = byId.get(id);
      if (!row) continue;
      const have = new Set([row.supplier, ...(row.suppliers || [])].filter(Boolean).map(String));
      const observed = [...m.entries()].sort((a, b) => b[1].n - a[1].n);
      const label = kind === 'vehicle' ? row.plate : row.name;
      const fmt = (list) => list.map(([s, x]) => `${supName(s)} (${x.n}، آخرها ${x.last || '—'})`).join(' | ');
      if (!row.supplier) {
        if (observed.length === 1) {
          plan[`${kind}s`].push({ id, label, action: 'primary', primary: observed[0][0], add: [observed[0][0]], evidence: fmt(observed) });
        } else {
          ambiguous.push({ kind, label, reason: 'بلا مورد أساسي وعمل مع أكثر من مورد', evidence: fmt(observed) });
        }
        continue;
      }
      const add = observed.map(([s]) => s).filter((s) => !have.has(s));
      if (add.length) plan[`${kind}s`].push({ id, label, action: 'add', primary: null, add, current: supName(row.supplier), evidence: fmt(observed.filter(([s]) => add.includes(s))) });
    }
  };
  decide('vehicle', vSeen, vById);
  decide('driver', dSeen, dById);

  const sum = {
    orders, noSupplier,
    trucksSeen: vSeen.size, trucksPrimary: plan.vehicles.filter((p) => p.action === 'primary').length, trucksAdd: plan.vehicles.filter((p) => p.action === 'add').length,
    driversSeen: dSeen.size, driversPrimary: plan.drivers.filter((p) => p.action === 'primary').length, driversAdd: plan.drivers.filter((p) => p.action === 'add').length,
    linksAdded: [...plan.vehicles, ...plan.drivers].reduce((a, p) => a + p.add.length, 0),
    ambiguous: ambiguous.length, plateClashes: plateClash.size, phoneClashes: phoneClash.size, unresolvedPlates: unresolvedPlates.size,
  };
  console.log(JSON.stringify(sum, null, 1));

  // Report.
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '—': 'لا شيء' }]), name);
  sheet('الملخص', Object.entries({
    'طلبات مقروءة': sum.orders, 'طلبات بلا مورد معروف': sum.noSupplier,
    'شاحنات تُعيَّن لها مورد أساسي': sum.trucksPrimary, 'شاحنات تُضاف لها موردون آخرون': sum.trucksAdd,
    'سائقون يُعيَّن لهم مورد أساسي': sum.driversPrimary, 'سائقون يُضاف لهم موردون آخرون': sum.driversAdd,
    'إجمالي الروابط الجديدة': sum.linksAdded, 'حالات للفريق (غير محسومة)': sum.ambiguous,
    'لوحات تطابق أكثر من شاحنة': sum.plateClashes, 'جوالات لأكثر من سائق': sum.phoneClashes, 'لوحات غير مسجَّلة': sum.unresolvedPlates,
  }).map(([k, v]) => ({ البند: k, العدد: v })));
  const planRows = (list, what) => list.map((p) => ({
    [what]: p.label, 'الإجراء': p.action === 'primary' ? 'تعيين مورد أساسي' : 'إضافة مورد', 'المورد الحالي': p.current || '—',
    'الموردون المضافون': p.add.map(supName).join(' | '), 'الدليل (عدد الشحنات، آخرها)': p.evidence,
  }));
  sheet('شاحنات تُربط', planRows(plan.vehicles, 'اللوحة'));
  sheet('سائقون يُربطون', planRows(plan.drivers, 'السائق'));
  sheet('للفريق — غير محسومة', ambiguous.map((a) => ({ النوع: a.kind === 'vehicle' ? 'شاحنة' : 'سائق', الاسم: a.label, السبب: a.reason, 'الموردون (عدد الشحنات، آخرها)': a.evidence })));
  sheet('لوحات لأكثر من شاحنة', [...plateClash.values()].map((x) => ({ 'اللوحة في الشحنة': x.plate, 'الشاحنات المطابقة': x.trucks, الشحنات: x.n })));
  sheet('جوالات لأكثر من سائق', [...phoneClash.values()].map((x) => ({ الجوال: x.phone, السائقون: x.drivers, الشحنات: x.n })));
  sheet('لوحات غير مسجلة', [...unresolvedPlates.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ اللوحة: p, الشحنات: n })));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const out = outArg || path.join(BACKUP_DIR, `supplier-links-report-${Date.now()}.xlsx`);
  XLSX.writeFile(wb, out);
  console.log(`report: ${out}`);

  if (!APPLY) { console.log('Dry run (pass --apply to write).'); process.exit(0); }

  // Backup the rows about to change, then write additively.
  if (ONLY_PRIMARY) { plan.vehicles = plan.vehicles.filter((p) => p.action === 'primary'); plan.drivers = plan.drivers.filter((p) => p.action === 'primary'); }
  const vIds = plan.vehicles.map((p) => p.id); const dIds = plan.drivers.map((p) => p.id);
  const bk = path.join(BACKUP_DIR, `supplier-links-before-${Date.now()}.json`);
  fs.writeFileSync(bk, JSON.stringify({
    vehicles: await Vehicle.find({ _id: { $in: vIds } }).select('supplier suppliers ownership').lean(),
    drivers: await Driver.find({ _id: { $in: dIds } }).select('supplier suppliers').lean(),
  }));
  const oid = (x) => new mongoose.Types.ObjectId(String(x));
  // bulkWrite skips update hooks, so the primary is put into `suppliers` here explicitly; the guards keep a row edited meanwhile untouched.
  const ops = (list, kind) => list.map((p) => {
    const row = (kind === 'vehicle' ? vById : dById).get(p.id);
    const each = [...new Set([...(row.supplier ? [String(row.supplier)] : []), ...p.add])].map(oid);
    if (p.action === 'primary') {
      return { updateOne: { filter: { _id: oid(p.id), supplier: null, ...(kind === 'vehicle' ? { ownership: { $ne: 'ours' } } : {}) }, update: { $set: { supplier: oid(p.primary), ...(kind === 'vehicle' ? { ownership: 'supplier' } : {}) }, $addToSet: { suppliers: { $each: each } } } } };
    }
    return { updateOne: { filter: { _id: oid(p.id), ...(kind === 'vehicle' ? { ownership: { $ne: 'ours' } } : {}) }, update: { $addToSet: { suppliers: { $each: each } } } } };
  });
  const rv = plan.vehicles.length ? await Vehicle.bulkWrite(ops(plan.vehicles, 'vehicle'), { ordered: false }) : { modifiedCount: 0 };
  const rd = plan.drivers.length ? await Driver.bulkWrite(ops(plan.drivers, 'driver'), { ordered: false }) : { modifiedCount: 0 };
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* the TTL is enough */ }
  console.log(`Applied: trucks ${rv.modifiedCount}, drivers ${rd.modifiedCount} · backup: ${bk}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
