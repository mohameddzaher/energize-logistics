/**
 * استيرادُ الناقلين من منصّة الأوبريشن: الموردون وشاحناتُهم وسوّاقُهم.
 *
 * ── الحال قبل ──────────────────────────────────────────────────────────────
 * قيل إنّ الموردين والسائقين وسياراتهم لم تُجلَب من المنصّة، فقيست الأعداد:
 *
 *       المنصّة          عندنا        الفرق
 *   موردون   ٣٥١٠        ٣٣٧١        ١٣٩ ناقصًا
 *   مركبات  ١٣٤٣٣       ١٣١٠٤        ٣٢٩ ناقصةً
 *   سوّاق   ١٧٥٦٤           ٠        السجلُّ لم يكن موجودًا أصلًا
 *
 * والأخطرُ من النقص أنّ **الملكيّة كانت تُستنتَج**: سجلُّ المركبات في المنصّة
 * لا يحمل مالكَها، فكان مالكُ الشاحنة يُستخرَج من تاريخ الطلبات باللوحة —
 * فصحّ في سبعة آلافٍ وبقي خمسةُ آلافٍ وسبعُمئةٍ مجهولةَ المالك، ومئتان
 * وستّةٌ وستّون لوحةً ملتبسةً تُركت.
 *
 * ── والسائقُ هو الذي يحمل الربطَ موثَّقًا ────────────────────────────────────
 * صفُّ السائق في المنصّة يحمل سيّارتَه ومالكَها معًا (`car` و`carOwner`)، في
 * مئةٍ من مئةٍ في العيّنة. فالربطُ يُقرأ من مصدره لا يُخمَّن — ومَن لم يُذكَر
 * له سائقٌ تبقى ملكيّتُه كما استُنتجت أو مجهولةً، ولا يُكتَب ظنٌّ فوق علم.
 *
 * ── وأسطولُنا يبقى أسطولَنا ─────────────────────────────────────────────────
 * شاحناتُنا السبعَ عشرةَ بعد المئة مسجّلةٌ في المنصّة أيضًا، وقد يُنسَب بعضُها
 * إلى «مالك» فيها. ومعرفتُنا بشاحناتنا أوّليّةٌ من سجلّاتنا الثلاثة، فمن كانت
 * لوحتُه لنا بقي `ours` بلا مورّد — وقسمُ طلبات الشحنات عن حمولاتٍ تُسنَد إلى
 * ناقلين، وأسطولُنا يُدار في «إدارة الأسطول».
 *
 * الاستعمال:
 *   node src/scripts/importOpsCarriers.js            # عرضُ الخطّة فقط
 *   node src/scripts/importOpsCarriers.js --apply
 *   node src/scripts/importOpsCarriers.js --apply --only=owners,cars,drivers
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
/**
 * ── والسحبُ يُخزَّن: المنصّةُ ليست لنا ────────────────────────────────────────
 * السحبُ الكاملُ ثلاثُمئةٍ وستّون صفحةً في نحوِ عشرِ دقائق. ومن جرّب العرضَ
 * الجافَّ ثمّ أراد الكتابة سحبَها مرّتين بلا داعٍ — فمع `--cache=<ملفّ>` يُقرأ
 * المخزونُ إن وُجد ويُكتَب إن لم يوجد. ولا يُستعمَل في التشغيل الدوريّ.
 */
const cacheArg = (process.argv.find((a) => a.startsWith('--cache=')) || '').slice(8);
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;
const wants = (k) => !ONLY || ONLY.has(k);

/**
 * ── سحبُ سجلٍّ كاملًا: مئةٌ في الصفحة وهو أقصى ما تقبله المنصّة ──────────────
 * سبعةَ عشرَ ألفَ سائقٍ تعني مئةً وستًّا وسبعين صفحةً، وثلاثُ ثوانٍ للصفحة
 * تعني تسعَ دقائق لو طُلبت واحدةً بعد واحدة. فتُطلَب أربعٌ معًا — ولا أكثر،
 * فالمنصّةُ ليست لنا ولا يُثقَل عليها.
 */
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

/** نصٌّ من حقلٍ قد يكون كائنَ ترجمةٍ {ar,en} — العربيُّ أوّلًا. */
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

  // ── أسطولُنا بلوحاته: معرفةٌ أوّليّةٌ لا تُنسَخ فوقها ملكيّةٌ خارجيّة ──────
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

  // ════ ١. الموردون ════════════════════════════════════════════════════════
  // المعرّفُ الخارجيُّ هو المفتاح؛ ومَن سُجِّل عندنا بالاسم قبل أن يُستورَد
  // يُلحَق به معرّفُه بدل أن يُنشأ له صفٌّ ثانٍ (الاسمُ مطويٌّ عند المطابقة).
  const nameKey = (v) => String(v || '')
    .replace(/[ً-ْ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const supByExt = new Map();
  const supByName = new Map();
  for (const s of await ShipmentOrderSupplier.find({}).select('name externalId').lean()) {
    if (s.externalId) supByExt.set(s.externalId, s);
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
    // ── والمطابقةُ بالاسم لا تسرق ربطًا قائمًا ─────────────────────────────
    // صفٌّ له معرّفٌ خارجيٌّ آخرُ هو مورّدٌ آخرُ وإن تشابه الاسم، فلو كُتب عليه
    // معرّفُ هذا لصار صفًّا واحدًا لمورّدين — ويرِث أحدُهما شاحنات الآخر.
    const byName = supByName.get(nameKey(name));
    const existing = supByExt.get(o.id) || (byName && !byName.externalId ? byName : null);
    if (!existing) {
      supNew += 1;
      supOps.push({ insertOne: { document: fields } });
    } else {
      if (!existing.externalId) supLinked += 1; else supUpdated += 1;
      supOps.push({ updateOne: { filter: { _id: existing._id }, update: { $set: fields } } });
    }
  }
  console.log(`\n١) الموردون: من المنصّة ${owners.length} → جديدٌ ${supNew} · رُبط بمعرّفه ${supLinked} · حُدِّث ${supUpdated}`);

  if (APPLY && supOps.length) {
    for (let i = 0; i < supOps.length; i += 500) await ShipmentOrderSupplier.bulkWrite(supOps.slice(i, i + 500));
  }

  // خريطةُ المعرّف الخارجيّ → معرّفُنا، تُعاد قراءتُها بعد الكتابة.
  const supIdByExt = new Map();
  for (const s of await ShipmentOrderSupplier.find({ externalId: { $ne: '' } }).select('externalId').lean()) {
    supIdByExt.set(s.externalId, s._id);
  }

  // ════ ٢. المركبات ════════════════════════════════════════════════════════
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
  // قرارُ الإيقاف قرارُنا: ما أوقفناه من الشاشة يبقى موقوفًا، وما لم نوقفه
  // يبقى عاملًا مهما قالت المنصّة عن نفسها.
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
    // ── ولا تُخفى شاحنةٌ تعمل لنا ───────────────────────────────────────────
    //
    // كانت تُنسَخ حالةُ المنصّة كما هي (`active`/`deleted_at`)، فأُوقفت سبعُمئةٍ
    // وأربعُ وخمسون شاحنة — وسبعُمئةٍ وأربعون منها حملت لنا ألفين ومئتين وتسعًا
    // وستّين شحنة، وخمسُمئةٍ وأربعٌ وعشرون منها عملت في آخر ستّة أشهر، وبعضُها
    // حمل في اليوم نفسِه. فحالةُ المنصّة ليست خبرًا عن وجود الشاحنة: تُعلَّم فيها
    // المركبةُ محذوفةً لأسبابها هي — انتهاءُ ورقةٍ عندها أو تنظيفُ قوائمها —
    // والشاحنةُ تسير وتُحمَّل.
    //
    // فالإيقافُ لا يُستورَد. ومَن أراد إيقافَ شاحنةٍ عندنا يوقفها من الشاشة،
    // وهو قرارٌ يُتَّخذ هنا على بيّنةٍ من عملها معنا.
    if (!existingIsInactive(c.id)) fields.isActive = true;
    // أسطولُنا لا يُنسَب إلى مورّد — ومعرفتُنا بلوحاتنا أوّليّة.
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

  // ════ ٣. السوّاق — وبهم تُعرَف ملكيّةُ الشاحنات يقينًا ════════════════════
  const drvByExt = new Map();
  for (const d of await ShipmentOrderDriver.find({}).select('externalId').lean()) {
    if (d.externalId) drvByExt.set(d.externalId, d);
  }

  const drvOps = [];
  const ownerOfVehicle = new Map();   // معرّفُ المركبة الخارجيُّ → معرّفُ مورّدها عندنا
  const crewOfVehicle = new Map();    // معرّفُ المركبة الخارجيُّ → أوّلُ سائقٍ لها
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

  // ════ ٤. الملكيّةُ من المصدر، وسائقُ الشاحنة المعتاد ══════════════════════
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
