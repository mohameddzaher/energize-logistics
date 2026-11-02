/**
 * Import the light-transport vehicles sheet columns that were not imported: authorized person's mobile and the actual driver.
 * The sheet has thirteen columns; authorization (name, number, period), project and city were imported. Three had no place in the register and were dropped: the authorized person's mobile (first thing needed when something happens on the road), and the actual driver's name and ID (the authorized person is not always the rider; the paper says who may drive, reality says who does).
 * Absent values are written as words in the sheet (not authorized, not used), not blank, so they are read as absence and not stored as text that later looks like a person's name.
 * Usage: node src/scripts/importB2cVehicleAuth.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);

const APPLY = process.argv.includes('--apply');
const FILE = path.join(__dirname, '../../../b2c files/المركبات تحديث 27-سبتمبر 2026 (1).xlsx');

/** Absence markers in the sheet, read as empty rather than as values. */
const ABSENT = ['غير مفوض', 'غير مستخدم', 'لا يوجد', 'غير متوفر', '-', '—', 'غير مفوضة'];
const real = (v) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return ABSENT.some((a) => s === a || s.startsWith(a)) ? '' : s;
};
/** Plate key: the digits and the letters in sorted order, the same folding used in the section. */
const plateKey = (v) => {
  const s = String(v || '');
  const digits = (s.match(/\d/g) || []).join('');
  const letters = (s.match(/[ء-ي]/g) || []).sort().join('');
  return digits && letters ? `${letters}${digits}` : (digits || '');
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' }).slice(2);

  const vehicles = await VehicleMaster.find({}).select('plateNumber serialNumber authorizedPerson actualDriver').lean();
  const byKey = new Map();
  const bySerial = new Map();
  for (const v of vehicles) {
    const k = plateKey(v.plateNumber);
    if (k) byKey.set(k, v);
    if (v.serialNumber) bySerial.set(String(v.serialNumber).trim(), v);
  }

  let matched = 0; let miss = 0; const plan = [];
  for (const r of rows) {
    const [serial, , , plate, actualId, actualName, , , authPhone] = r;
    if (!plate && !serial) continue;
    const v = bySerial.get(String(serial).trim()) || byKey.get(plateKey(plate));
    if (!v) { miss += 1; continue; }
    matched += 1;
    const set = {};
    const ph = real(authPhone);
    const an = real(actualName);
    const ai = real(actualId);
    if (ph && ph !== (v.authorizedPerson?.phone || '')) set['authorizedPerson.phone'] = ph;
    if (an && an !== (v.actualDriver?.name || '')) set['actualDriver.name'] = an;
    if (ai && ai !== (v.actualDriver?.idNumber || '')) set['actualDriver.idNumber'] = ai;
    if (Object.keys(set).length) plan.push({ id: v._id, plate: v.plateNumber, set });
  }

  console.log(`صفوفُ الشيت=${rows.filter((r) => r[3] || r[0]).length} · طوبقت=${matched} · بلا مطابقة=${miss}`);
  console.log(`صفوفٌ ستُحدَّث: ${plan.length}`);
  const c = (k) => plan.filter((p) => p.set[k] !== undefined).length;
  console.log(`  جوال المفوَّض=${c('authorizedPerson.phone')} · اسم القائد الفعليّ=${c('actualDriver.name')} · هويّته=${c('actualDriver.idNumber')}`);
  plan.slice(0, 6).forEach((p) => console.log(`  ${String(p.plate).padEnd(14)} ${JSON.stringify(p.set)}`));

  if (!APPLY) { console.log('\n(عرضٌ فقط — --apply)'); await mongoose.disconnect(); return; }
  for (const p of plan) await VehicleMaster.updateOne({ _id: p.id }, { $set: p.set });
  console.log(`\nكُتب ${plan.length} صفًّا.`);

  // The authorized person differs from the rider: how many vehicles? A number people ask about.
  const all = await VehicleMaster.find({ 'actualDriver.idNumber': { $nin: ['', null] } })
    .select('plateNumber authorizedPerson actualDriver').lean();
  const diff = all.filter((v) => String(v.actualDriver.idNumber) !== String(v.authorizedPerson?.iqamaNumber || ''));
  console.log(`مركباتٌ قائدُها الفعليُّ غيرُ المفوَّض: ${diff.length} من ${all.length}`);
  diff.slice(0, 5).forEach((v) => console.log(`  ${v.plateNumber} · مفوَّض=${v.authorizedPerson?.name || '—'} · القائد=${v.actualDriver.name}`));
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
