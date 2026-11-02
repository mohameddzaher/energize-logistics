/**
 * Import of carriers from the operations platform: suppliers, their trucks and drivers.
 * Counts were measured against the platform: suppliers 3510 vs 3371 (139 missing), vehicles 13433 vs 13104 (329 missing), drivers 17564 vs 0 (the register did not exist).
 * Worse than the gaps, ownership was inferred: the platform vehicle record has no owner, so it was derived from order history by plate, correct for about 7000 and unknown for 5700, with 266 ambiguous plates left.
 * The driver row carries both car and carOwner (100 of 100 in a sample), so the link is read from the source, not guessed. A vehicle with no driver keeps its inferred or unknown ownership; a guess is never written over knowledge. Our fleet stays ours: our 117 trucks are also in the platform and may be attributed to an owner there. Our knowledge from our three registers is primary, so a truck with our plate stays ours with no supplier, since shipment orders concern carriers' loads and our fleet is run in fleet management. Usage: no flag shows the plan, --apply writes, --apply --only=owners,cars,drivers limits it.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const upl = require(`${ROOT}/services/uplClient`);
const ShipmentOrderSupplier = require(`${ROOT}/models/ShipmentOrderSupplier`);
const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
const ShipmentOrderDriver = require(`${ROOT}/models/ShipmentOrderDriver`);
const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);
const { FleetVehicle } = require(`${ROOT}/models/FleetModels`);
const Ls2Vehicle = require(`${ROOT}/models/Ls2Vehicle`);
const { registryPlateKey } = require(`${ROOT}/utils/plateKey`);

const APPLY = process.argv.includes('--apply');
/** The pull is cached because the platform is not ours. A full pull is 360 pages and about ten minutes; with --cache=<file> the cache is read if present and written if not, so a dry run followed by a write does not pull twice. Not used in periodic runs. */
const cacheArg = (process.argv.find((a) => a.startsWith('--cache=')) || '').slice(8);
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;
const wants = (k) => !ONLY || ONLY.has(k);

/** Pulling a whole register: 100 per page is the platform maximum. 17k drivers is 176 pages, about nine minutes at 3 s each sequentially, so four are requested at once and no more, to avoid loading a platform we do not own. */
const PAGE = 100;
const CONCURRENCY = 4;

const fetchAll = async (resource, label) => {
  const first = await upl.get(resource, { query: { limit: PAGE, page: 1 } });
  const meta = first?.data?.meta || {};
  const pages = meta.totalPages || 1;
  const rows = [...(first?.data?.items || [])];
  process.stdout.write(`  ${label}: ${rows.length}/${meta.totalItems || '?'}`);
  for (let p = 2; p <= pages; p += CONCURRENCY) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY && p + i <= pages; i += 1) {
      batch.push(upl.get(resource, { query: { limit: PAGE, page: p + i } })
        .catch((e) => { console.error(`\n  ! صفحة ${p + i} من ${resource}: ${e.message}`); return null; }));
    }
    for (const r of await Promise.all(batch)) rows.push(...(r?.data?.items || []));
    process.stdout.write(`\r  ${label}: ${rows.length}/${meta.totalItems || '?'}   `);
  }
  console.log('');
  return rows;
};

/** Text from a field that may be a translation object {ar,en}; Arabic first. */
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.ar || v.en || '').trim();
  return String(v).trim();
};
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

(async () => {
  if (!upl.isConfigured()) {
    console.error('منصّةُ الأوبريشن غيرُ مهيّأةٍ في هذه البيئة (UPL_*) — لا يمكن السحب.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  // Our fleet by plate: primary knowledge that external ownership must not overwrite.
  const oursKeys = new Set();
  for (const rows of [
    await VehicleMaster.find({}).select('plateNumber').lean(),
    await FleetVehicle.find({}).select('plate').lean(),
    await Ls2Vehicle.find({}).select('plate').lean(),
  ]) for (const r of rows) { const k = registryPlateKey(r.plateNumber || r.plate); if (k) oursKeys.add(k); }

  let owners = []; let cars = []; let drivers = [];
  const fs = require('fs');
  if (cacheArg && fs.existsSync(cacheArg)) {
    console.log(`قراءةُ المخزون: ${cacheArg}`);
    ({ owners = [], cars = [], drivers = [] } = JSON.parse(fs.readFileSync(cacheArg, 'utf8')));
    console.log(`  الموردون=${owners.length} · المركبات=${cars.length} · السوّاق=${drivers.length}`);
  } else {
    console.log('السحبُ من المنصّة:');
    [owners, cars, drivers] = await Promise.all([
      wants('owners') ? fetchAll('/admin/car-owners', 'الموردون') : [],
      wants('cars') ? fetchAll('/admin/cars', 'المركبات') : [],
      wants('drivers') ? fetchAll('/admin/drivers', 'السوّاق') : [],
    ]);
    if (cacheArg) {
      fs.writeFileSync(cacheArg, JSON.stringify({ owners, cars, drivers }));
      console.log(`  خُزِّن في ${cacheArg}`);
    }
  }

  // 1. Suppliers
  // The external id is the key. One registered by name before import gets the id attached instead of a second row (name is folded when matching).
  const nameKey = (v) => String(v || '')
    .replace(/[ً-ْ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const supByExt = new Map();
  const supByName = new Map();
  // Merged records are not matched; the rest match by their id and by the ids of those merged into them (externalIds).
  for (const s of await ShipmentOrderSupplier.find({ mergedInto: null }).select('name externalId externalIds').lean()) {
    if (s.externalId) supByExt.set(s.externalId, s);
    (s.externalIds || []).forEach((x) => { if (!supByExt.has(x)) supByExt.set(x, { ...s, alias: true }); });
    const k = nameKey(s.name);
    if (k && !supByName.has(k)) supByName.set(k, s);
  }

  const supOps = [];
  let supNew = 0; let supLinked = 0; let supUpdated = 0;
  for (const o of owners) {
    const name = txt(o.owner_name) || txt(o.owner?.name);
    if (!name) continue;
    const fields = {
      name,
      phone: txt(o.owner_phone) || txt(o.owner?.phone) || '',
      email: txt(o.owner?.email) || '',
      commercialRegister: txt(o.commercial_register),
      taxCard: txt(o.tax_card),
      nationalAddress: txt(o.national_address),
      bankName: txt(o.bank_name),
      iban: txt(o.iban),
      ownerName: txt(o.owner_name),
      ownerPhone: txt(o.owner_phone),
      managerName: txt(o.manager_name),
      managerPhone: txt(o.manager_phone),
      accountantName: txt(o.accountant_name),
      accountantPhone: txt(o.accountant_phone),
      paymentTerms: txt(o.payment_terms),
      agreedPriceStatement: txt(o.agreed_price_statement),
      contractFile: txt(o.contract_file),
      externalId: o.id,
      isActive: !o.deleted_at,
    };
    // Name matching must not steal an existing link: a row with another external id is a different supplier despite a similar name. Writing this id onto it would make one row for two suppliers, and one would inherit the other's trucks.
    const byName = supByName.get(nameKey(name));
    const existing = supByExt.get(o.id) || (byName && !byName.externalId ? byName : null);
    if (!existing) {
      supNew += 1;
      supOps.push({ insertOne: { document: fields } });
    } else {
      if (!existing.externalId) supLinked += 1; else supUpdated += 1;
      // A second platform record for a merged supplier: do not overwrite its primary name and id.
      const set = existing.alias ? (({ externalId, name: _n, isActive, ...rest }) => rest)(fields) : fields;
      supOps.push({ updateOne: { filter: { _id: existing._id }, update: { $set: set } } });
    }
  }
  console.log(`\n١) الموردون: من المنصّة ${owners.length} → جديدٌ ${supNew} · رُبط بمعرّفه ${supLinked} · حُدِّث ${supUpdated}`);

  if (APPLY && supOps.length) {
    for (let i = 0; i < supOps.length; i += 500) await ShipmentOrderSupplier.bulkWrite(supOps.slice(i, i + 500));
  }

  // Map of external id to our id, re-read after writing.
  const supIdByExt = new Map();
  for (const s of await ShipmentOrderSupplier.find({ mergedInto: null }).select('externalId externalIds').lean()) {
    if (s.externalId) supIdByExt.set(s.externalId, s._id);
    (s.externalIds || []).forEach((x) => { if (!supIdByExt.has(x)) supIdByExt.set(x, s._id); });
  }

  // 2. Vehicles
  const vehByExt = new Map();
  const vehByPlate = new Map();
  const existing = await ShipmentOrderVehicle.find({}).select('plate externalId supplier ownership isActive').lean();
  for (const v of existing) {
    if (v.externalId) vehByExt.set(v.externalId, v);
    const k = registryPlateKey(v.plate);
    if (k && !vehByPlate.has(k)) vehByPlate.set(k, v);
  }

  const vehOps = [];
  let vehNew = 0; let vehLinked = 0; let vehUpdated = 0; let plateTaken = 0;
  // Suspension is our decision: what we stopped from the screen stays stopped, and what we did not stop stays active, whatever the platform says about itself.
  const stoppedHere = new Set(existing.filter((v) => v.isActive === false).map((v) => v.externalId).filter(Boolean));
  const existingIsInactive = (extId) => stoppedHere.has(extId);
  for (const c of cars) {
    const plate = txt(c.plate_number) || txt(c.car_number) || txt(c.name);
    if (!plate) continue;
    const key = registryPlateKey(plate);
    const isOurs = key && oursKeys.has(key);
    const fields = {
      plate,
      name: txt(c.name),
      modelYear: c.car_model_year ? String(c.car_model_year) : '',
      recordNumber: txt(c.car_record_number),
      operationCardNumber: txt(c.operation_card_number),
      operationCardExpiry: dateOnly(c.operation_card_expiry),
      insuranceDetails: txt(c.insurance_details),
      externalId: c.id,
    };
    // Do not hide a truck that works for us. Copying platform state (active/deleted_at) suspended 754 trucks, of which 740 carried 2,269 shipments for us and 524 worked in the last six months, some on the same day. Platform state says nothing about whether a truck exists: it marks vehicles deleted for its own reasons (an expired paper, list cleanup) while the truck runs and loads.
    // So suspension is not imported. To suspend a truck, do it from the screen, a decision made knowing its work with us.
    if (!existingIsInactive(c.id)) fields.isActive = true;
    // Our fleet is not attributed to a supplier; our plate knowledge is primary.
    if (isOurs) { fields.ownership = 'ours'; fields.supplier = null; }
    const plateRow = vehByPlate.get(key);
    const existing = vehByExt.get(c.id) || (plateRow && !plateRow.externalId ? plateRow : null);
    if (!existing && plateRow) plateTaken += 1;
    if (!existing) {
      vehNew += 1;
      vehOps.push({ insertOne: { document: { ...fields, ownership: fields.ownership || 'unknown' } } });
    } else {
      if (!existing.externalId) vehLinked += 1; else vehUpdated += 1;
      vehOps.push({ updateOne: { filter: { _id: existing._id }, update: { $set: fields } } });
    }
  }
  console.log(`٢) المركبات: من المنصّة ${cars.length} → جديدٌ ${vehNew} · رُبط بمعرّفه ${vehLinked} · حُدِّث ${vehUpdated}`);
  if (plateTaken) console.log(`   (${plateTaken} لوحةً يطابق مفتاحُها صفًّا مربوطًا بمركبةٍ أخرى — فأُنشئ لها صفُّها ولم يُسرَق ربطُه)`);

  if (APPLY && vehOps.length) {
    for (let i = 0; i < vehOps.length; i += 500) await ShipmentOrderVehicle.bulkWrite(vehOps.slice(i, i + 500));
  }

  const vehIdByExt = new Map();
  const vehOursByExt = new Map();
  for (const v of await ShipmentOrderVehicle.find({ externalId: { $ne: '' } }).select('externalId ownership').lean()) {
    vehIdByExt.set(v.externalId, v._id);
    vehOursByExt.set(v.externalId, v.ownership === 'ours');
  }

  // 3. Drivers, from whom truck ownership is known with certainty
  const drvByExt = new Map();
  for (const d of await ShipmentOrderDriver.find({}).select('externalId').lean()) {
    if (d.externalId) drvByExt.set(d.externalId, d);
  }

  const drvOps = [];
  const ownerOfVehicle = new Map();   // Vehicle external id to its supplier's id in our system
  const crewOfVehicle = new Map();    // Vehicle external id to its first driver
  let drvNew = 0; let drvUpdated = 0; let drvNoName = 0;
  for (const d of drivers) {
    const name = txt(d.name);
    if (!name) { drvNoName += 1; continue; }
    const extSup = d.carOwner?.id || '';
    const extVeh = d.car?.id || '';
    const supplier = extSup ? (supIdByExt.get(extSup) || null) : null;
    const vehicle = extVeh ? (vehIdByExt.get(extVeh) || null) : null;
    if (extVeh && supplier && !ownerOfVehicle.has(extVeh)) ownerOfVehicle.set(extVeh, supplier);
    if (extVeh && !crewOfVehicle.has(extVeh)) crewOfVehicle.set(extVeh, { name, phone: txt(d.phone) });
    const fields = {
      name,
      phone: txt(d.phone),
      email: txt(d.email),
      nationality: txt(d.nationality),
      residenceNumber: txt(d.residence_number),
      driverCardNumber: txt(d.driver_card_number),
      driverCardExpiry: dateOnly(d.driver_card_expiry),
      companyName: txt(d.company_name),
      sponsorName: txt(d.sponsor_name),
      residenceImage: txt(d.residence_image),
      licenseImage: txt(d.license_image),
      absherImage: txt(d.absher_image),
      supplier,
      vehicle,
      externalId: d.id,
      isActive: !d.deleted_at,
    };
    const existing = drvByExt.get(d.id);
    if (!existing) { drvNew += 1; drvOps.push({ insertOne: { document: fields } }); } else {
      drvUpdated += 1;
      drvOps.push({ updateOne: { filter: { _id: existing._id }, update: { $set: fields } } });
    }
  }
  console.log(`٣) السوّاق: من المنصّة ${drivers.length} → جديدٌ ${drvNew} · حُدِّث ${drvUpdated}${drvNoName ? ` · بلا اسمٍ فتُركوا ${drvNoName}` : ''}`);
  console.log(`   وبهم يُعرَف مالكُ ${ownerOfVehicle.size} شاحنةً يقينًا (كان يُستنتَج باللوحة)`);

  if (APPLY && drvOps.length) {
    for (let i = 0; i < drvOps.length; i += 500) await ShipmentOrderDriver.bulkWrite(drvOps.slice(i, i + 500));
  }

  // 4. Ownership from the source, and the truck's usual driver
  const ownOps = [];
  let setOwner = 0; let keptOurs = 0;
  for (const [extVeh, supplier] of ownerOfVehicle) {
    const id = vehIdByExt.get(extVeh);
    if (!id) continue;
    if (vehOursByExt.get(extVeh)) { keptOurs += 1; continue; }
    const crew = crewOfVehicle.get(extVeh) || {};
    setOwner += 1;
    ownOps.push({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            supplier,
            ownership: 'supplier',
            ...(crew.name ? { defaultDriverName: crew.name, defaultDriverPhone: crew.phone || '' } : {}),
          },
        },
      },
    });
  }
  console.log(`٤) الملكيّة: تُكتب من المنصّة على ${setOwner} شاحنة · وشاحناتُنا تبقى لنا ${keptOurs}`);

  if (APPLY && ownOps.length) {
    for (let i = 0; i < ownOps.length; i += 500) await ShipmentOrderVehicle.bulkWrite(ownOps.slice(i, i + 500));
  }

  if (APPLY) {
    const live = { isActive: { $ne: false } };
    const [s, v, d, byOwn] = await Promise.all([
      ShipmentOrderSupplier.countDocuments(live),
      ShipmentOrderVehicle.countDocuments(live),
      ShipmentOrderDriver.countDocuments(live),
      ShipmentOrderVehicle.aggregate([
        { $match: live },
        {
          $group: {
            _id: { $cond: [{ $ne: ['$supplier', null] }, 'supplier', { $cond: [{ $eq: ['$ownership', 'ours'] }, 'ours', 'unknown'] }] },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);
    const n = {}; byOwn.forEach((r) => { n[r._id] = r.n; });
    console.log(`\nبعد الكتابة: موردون=${s} · مركبات=${v} · سوّاق=${d}`);
    console.log(`   ومنها: لموردين=${n.supplier || 0} · أسطولُنا=${n.ours || 0} · مجهولُ المالك=${n.unknown || 0}`);
    try { require(`${ROOT}/utils/ttlCache`).clear('so:registry:'); } catch (_) { /* */ }
  } else {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
