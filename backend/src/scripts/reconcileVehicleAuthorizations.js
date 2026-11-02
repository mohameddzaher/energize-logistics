/**
 * reconcileVehicleAuthorizations: reconcile the two authorization registers once. Usage: node src/scripts/reconcileVehicleAuthorizations.js [--apply] [--json <file>] (ENV_FILE=<path to .env>); dry run by default. Why: authorization lived in two diverging registers: the paper on the vehicle (`VehicleMaster.authorizedPerson`) and the older assignment
 * log (`VehicleAuthorization` + `Vehicle` pointers + `Employee.vehiclePlate`). Writes now go through one source (utils/vehicleAuthorization); this fixes what diverged before. Rule: the most recent action wins. Per vehicle, the last action date is read from each register. - Paper: last audit entry touching authorization (revoke, authorize, B2C
 * edit, general edit with the authorization field) or last 'authorization' entry in `renewals`; otherwise `lastImportAt` or creation date. - Assignment: last open (`createdAt`) or close (`updatedAt`) of any assignment on it. If the assignment is newer the paper is written from it, otherwise the assignment follows the paper. Reported but not counted
 * as a conflict: - paper names someone with no HR file: no assignment can be opened. - paper with no mirror in the old log: mirror is created with --apply. - old vehicle with no paper in the log: left as is (the log is its only record). With --apply, 'imported from the sheet' phrases are removed from notes (utils/importLabels).
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '../../.env') });
const fs = require('fs');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();
const S = (v) => (v == null ? '' : String(v).trim());
const d10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const dt = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
const AUTH_AUDIT = new Set(['revoke_vehicle_authorization', 'assign_vehicle_authorization', 'move_lt_authorization']);

async function main() {
  // No indexes or collections are created here; the dry run writes nothing to the database.
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, autoIndex: false, autoCreate: false });
  const Vehicle = require('../models/Vehicle');
  const VehicleAuthorization = require('../models/VehicleAuthorization');
  const Employee = require('../models/Employee');
  const AuditLog = require('../models/AuditLog');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const { orderlessPlateKey } = require('../utils/plateKey');
  const VA = require('../utils/vehicleAuthorization');
  const { isImportNote, stripImportNote, IMPORT_ACTORS } = require('../utils/importLabels');

  const [vms, vehicles, auths, emps, audits] = await Promise.all([
    VehicleMaster.find({}).select('plateNumber authorizedPerson renewals lastImportAt createdAt').lean(),
    Vehicle.find({}).lean(),
    VehicleAuthorization.find({}).lean(),
    Employee.find({}).select('firstName lastName arabicName iqamaNumber nationalId vehiclePlate isHrRecord employmentStatus').lean(),
    AuditLog.find({ entity: 'VehicleMaster' }).select('action entityId changes createdAt').lean(),
  ]);

  const empById = new Map(emps.map((e) => [String(e._id), e]));
  const empByIdNo = new Map();
  for (const e of emps) for (const k of [S(e.iqamaNumber), S(e.nationalId)]) if (k && (!empByIdNo.has(k) || e.isHrRecord !== false)) empByIdNo.set(k, e);
  const nameOf = (e) => (e ? S(`${e.firstName || ''} ${e.lastName || ''}`) || S(e.arabicName) : '');

  const legacyByKey = new Map(); const legacyByMaster = new Map();
  for (const v of vehicles) {
    const k = orderlessPlateKey(v.plateNumber);
    if (!legacyByKey.has(k)) legacyByKey.set(k, []);
    legacyByKey.get(k).push(v);
    if (v.master) legacyByMaster.set(String(v.master), v);
  }
  const authsByVehicle = new Map();
  for (const a of auths) {
    const k = String(a.vehicle);
    if (!authsByVehicle.has(k)) authsByVehicle.set(k, []);
    authsByVehicle.get(k).push(a);
  }
  const vmAuditAt = new Map();
  for (const a of audits) {
    const c = JSON.stringify(a.changes || {});
    const touches = AUTH_AUDIT.has(a.action) || /authori[sz]|المفوَّض|رقم التفويض|authNumber|authorizedName|authorizedId/i.test(c);
    if (!touches) continue;
    const k = String(a.entityId);
    if (!vmAuditAt.has(k) || vmAuditAt.get(k) < a.createdAt) vmAuditAt.set(k, a.createdAt);
  }

  const rows = []; const linkedLegacy = new Set();
  const counts = { vehicles: vms.length, agree: 0, holderDisagree: 0, registryWins: 0, legacyWins: 0, missingMirror: 0,
    holderNotInHr: 0, metadataOnly: 0, pointerFix: 0, plateFix: 0, legacyOnlyVehicles: 0, legacyOnlyActive: 0 };

  for (const vm of vms) {
    const key = orderlessPlateKey(vm.plateNumber);
    const legacy = [...new Set([...(legacyByKey.get(key) || []), ...(legacyByMaster.has(String(vm._id)) ? [legacyByMaster.get(String(vm._id))] : [])])];
    legacy.forEach((v) => linkedLegacy.add(String(v._id)));
    const all = legacy.flatMap((v) => authsByVehicle.get(String(v._id)) || []);
    const actives = all.filter((a) => a.status === 'active');
    const holder = VA.holderOf(vm);
    const emp = holder?.idNumber ? empByIdNo.get(holder.idNumber) : null;
    const nameMatch = (a) => holder && !holder.idNumber && holder.name
      && [VA.fold(nameOf(empById.get(String(a.employee)))), VA.fold(empById.get(String(a.employee))?.arabicName)].includes(VA.fold(holder.name));
    const isHolder = (a) => (emp ? String(a.employee) === String(emp._id) : nameMatch(a));

    // When was the last action on each register?
    const renewAt = (vm.renewals || []).filter((r) => r.document === 'authorization').map((r) => r.at).filter(Boolean);
    const vmAt = [vmAuditAt.get(String(vm._id)), ...renewAt].filter(Boolean).sort((a, b) => b - a)[0]
      || vm.lastImportAt || vm.createdAt;
    const legacyEvents = all.map((a) => (a.status === 'active' ? a.createdAt : a.updatedAt)).filter(Boolean).sort((a, b) => b - a);
    const legacyAt = legacyEvents[0] || null;
    const latestLegacy = all.slice().sort((a, b) => (b.status === 'active' ? b.createdAt : b.updatedAt) - (a.status === 'active' ? a.createdAt : a.updatedAt))[0];

    let kind = 'agree';
    if (holder && actives.length === 1 && isHolder(actives[0])) kind = 'agree';
    else if (!holder && !actives.length) kind = 'agree';
    else if (holder && !actives.length && !emp && !all.length) kind = 'holder_not_in_hr';
    else if (holder && !actives.length && emp && !legacy.length) kind = 'missing_mirror';
    else kind = 'disagree';

    // When both agree: paper number and term, pointers, and the plate snapshot on the file.
    const notes = [];
    if (kind === 'agree' && holder && actives[0]) {
      const a = actives[0];
      if ((holder.authorizationNumber && S(a.documentNumber) !== holder.authorizationNumber)
        || (d10(holder.expiryDate) && S(a.documentExpiry) !== d10(holder.expiryDate))) { notes.push('metadata'); counts.metadataOnly += 1; }
    }
    for (const v of legacy) {
      const act = (authsByVehicle.get(String(v._id)) || []).find((a) => a.status === 'active');
      const ptrOk = act ? (String(v.currentAuthorization || '') === String(act._id) && v.status === 'authorized')
        : (!v.currentAuthorization && v.status !== 'authorized');
      if (!ptrOk) { notes.push(`pointers:${v.plateNumber}`); }
    }
    if (notes.some((n) => n.startsWith('pointers'))) counts.pointerFix += 1;
    // All of the holder's plates, not just this vehicle's: someone holding two vehicles has both in the field.
    if (emp && !(await VA.plateSnapshotOk(emp))) { notes.push(`vehiclePlate:${S(emp.vehiclePlate) || '∅'}`); counts.plateFix += 1; }

    if (kind === 'agree') { counts.agree += 1; if (!notes.length) continue; }
    if (kind === 'holder_not_in_hr') counts.holderNotInHr += 1;
    if (kind === 'missing_mirror') counts.missingMirror += 1;

    let winner = 'registry';
    if (kind === 'disagree') {
      counts.holderDisagree += 1;
      winner = legacyAt && vmAt && legacyAt > vmAt ? 'legacy' : 'registry';
      counts[winner === 'legacy' ? 'legacyWins' : 'registryWins'] += 1;
    }
    const legacyHolder = actives.map((a) => {
      const e = empById.get(String(a.employee));
      return `${nameOf(e) || String(a.employee)} (${S(e?.iqamaNumber || e?.nationalId) || '—'}) منذ ${S(a.startDate)}`;
    }).join(' + ');
    let action = '';
    if (kind === 'disagree') {
      if (winner === 'registry') action = holder ? (emp ? `يُغلَق الإسنادُ ويُفتح لـ${nameOf(emp)}` : 'يُغلَق الإسناد (المفوَّض ليس في الموارد البشرية)') : 'يُغلَق الإسناد — المركبة غير مفوَّضة';
      else if (latestLegacy?.status === 'active') action = `تُكتب الورقة لـ${nameOf(empById.get(String(latestLegacy.employee)))} (الإسناد أحدث)`;
      else action = 'تُفرَّغ الورقة (آخرُ فعلٍ إغلاقُ الإسناد)';
    } else if (kind === 'missing_mirror') action = `تُنشأ مرآةٌ قديمة ويُفتح إسنادٌ لـ${nameOf(emp)}`;
    else if (kind === 'holder_not_in_hr') action = 'لا شيء — لا ملفّ للمفوَّض في الموارد البشرية';
    else action = `تصحيح: ${notes.join('، ')}`;

    rows.push({
      plate: vm.plateNumber, kind, winner: kind === 'disagree' ? winner : '',
      registryHolder: holder ? `${holder.name || '—'} (${holder.idNumber || '—'})` : '—',
      legacyHolder: legacyHolder || '—',
      registryAt: dt(vmAt), legacyAt: dt(legacyAt), action, notes,
      _vm: vm._id, _latestLegacy: latestLegacy, _emp: emp,
    });
  }

  // Old vehicles with no paper: reported, not touched.
  const legacyOnly = vehicles.filter((v) => !linkedLegacy.has(String(v._id)));
  counts.legacyOnlyVehicles = legacyOnly.length;
  const legacyOnlyActive = legacyOnly.filter((v) => (authsByVehicle.get(String(v._id)) || []).some((a) => a.status === 'active'));
  counts.legacyOnlyActive = legacyOnlyActive.length;

  // Import phrases in notes.
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const [ltEmps, ltOrders] = await Promise.all([
    LightTransportEmployee.find({}).select('notesAr history').lean(),
    LightTransportOrder.find({}).select('notesAr createdByName').lean(),
  ]);
  const labelAuths = auths.filter((a) => isImportNote(a.notes));
  const labelLtEmps = ltEmps.filter((e) => isImportNote(e.notesAr)
    || (e.history || []).some((h) => isImportNote(h.note) || IMPORT_ACTORS.includes(S(h.byName))));
  const labelLtOrders = ltOrders.filter((o) => isImportNote(o.notesAr) || IMPORT_ACTORS.includes(S(o.createdByName)));
  counts.importLabels = { vehicleAuthorizations: labelAuths.length, lightTransportEmployees: labelLtEmps.length, lightTransportOrders: labelLtOrders.length };

  // Report
  const order = { disagree: 0, missing_mirror: 1, agree: 2, holder_not_in_hr: 3 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || a.plate.localeCompare(b.plate, 'ar'));
  console.log(APPLY ? '── تطبيق ──' : '── عرضٌ فقط (أضِف --apply للكتابة) ──');
  console.log(JSON.stringify(counts, null, 2));
  console.log('\n| اللوحة | النوع | الغالب | المفوَّض في السجلّ | الإسناد الساري | آخر فعل (السجلّ) | آخر فعل (الإسناد) | الإجراء |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.plate} | ${r.kind} | ${r.winner || ''} | ${r.registryHolder} | ${r.legacyHolder} | ${r.registryAt} | ${r.legacyAt} | ${r.action} |`);
  }
  if (legacyOnlyActive.length) {
    console.log('\nمركباتٌ قديمةٌ لا ورقةَ لها وعليها إسنادٌ ساري (تبقى كما هي):');
    for (const v of legacyOnlyActive) {
      const a = (authsByVehicle.get(String(v._id)) || []).find((x) => x.status === 'active');
      console.log(`  ${v.plateNumber} — ${nameOf(empById.get(String(a.employee)))} منذ ${S(a.startDate)}`);
    }
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ counts, rows: rows.map(({ _vm, _latestLegacy, _emp, ...r }) => r),
      legacyOnlyActive: legacyOnlyActive.map((v) => v.plateNumber) }, null, 2));
  }

  if (!APPLY) { await mongoose.disconnect(); return { counts, rows }; }

  // Write
  let done = 0;
  for (const r of rows) {
    if (r.kind === 'holder_not_in_hr') continue;
    const vm = await VehicleMaster.findById(r._vm);
    if (r.kind === 'disagree' && r.winner === 'legacy') {
      const a = r._latestLegacy;
      if (a.status === 'active') {
        await VA.setHolder(vm, {
          employee: a.employee, authorizationNumber: a.documentNumber || '',
          startDate: a.startDate ? new Date(`${a.startDate}T00:00:00.000Z`) : null,
          expiryDate: a.documentExpiry ? new Date(`${a.documentExpiry}T00:00:00.000Z`) : null,
        }, { byName: 'مطابقة السجلّين', note: 'مطابقة السجلّين — الإسنادُ أحدثُ من الورقة' });
      } else {
        await VA.setHolder(vm, null, { byName: 'مطابقة السجلّين', reason: 'مطابقة السجلّين — آخرُ فعلٍ إغلاقُ الإسناد' });
      }
    } else {
      const res = await VA.syncLegacyFromMaster(vm.toObject(), { reason: 'مطابقة السجلّين — سجلُّ المركبات هو المرجع' });
      VA.announce(res);
    }
    done += 1;
  }
  // Only the old mirror: its pointers are repaired.
  for (const v of legacyOnly) await VA.syncPointers(v._id, null);

  for (const a of labelAuths) {
    const n = stripImportNote(a.notes);
    await VehicleAuthorization.updateOne({ _id: a._id }, n ? { $set: { notes: n } } : { $unset: { notes: 1 } }, { timestamps: false });
  }
  for (const e of labelLtEmps) {
    const history = (e.history || []).map((h) => ({ ...h, note: stripImportNote(h.note), byName: IMPORT_ACTORS.includes(S(h.byName)) ? 'النظام' : h.byName }));
    await LightTransportEmployee.updateOne({ _id: e._id }, { $set: { notesAr: stripImportNote(e.notesAr) || '', history } }, { timestamps: false });
  }
  for (const o of labelLtOrders) {
    await LightTransportOrder.updateOne({ _id: o._id }, { $set: {
      notesAr: stripImportNote(o.notesAr) || '',
      ...(IMPORT_ACTORS.includes(S(o.createdByName)) ? { createdByName: 'النظام' } : {}),
    } }, { timestamps: false });
  }
  console.log(`\nطُبِّق على ${done} مركبة، و${labelAuths.length + labelLtEmps.length + labelLtOrders.length} ملاحظةَ استيراد.`);
  await mongoose.disconnect();
  return { counts, rows };
}

if (require.main === module) {
  main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) { /* */ } process.exit(1); });
}
module.exports = { main };
