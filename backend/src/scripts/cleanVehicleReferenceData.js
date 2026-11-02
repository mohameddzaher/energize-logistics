/* eslint-disable no-console */
/**
 * cleanVehicleReferenceData: unify value spellings in the vehicle fields that have choice lists.
 * Usage: node src/scripts/cleanVehicleReferenceData.js --dry | --yes
 * A free-text field is written a thousand ways: three Arabic and Latin spellings of Mercedes make three filter options and three brands in analytics, with no one seeing they are one. This unifies them to the approved value in config/vehicleDefaults.js, then reports what remains outside the list for a decision.
 * Invents nothing: matching is by name after light normalization (lowercase, no spaces or dashes), or by a synonym table written out below. Unmatched values are left and reported, since guessing is worse than leaving.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const V = require('../config/vehicleDefaults');

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');

/** Field -> its approved list. */
const FIELDS = [
  ['insurance.coverageTypeAr', V.coverageTypes, 'نوع التغطية'],
  ['insurance.companyAr', V.insuranceCompanies, 'شركة التأمين'],
  ['insurance.premiumStatusAr', V.premiumStatuses, 'حالة القسط'],
  ['sectorAr', V.sectors, 'القطاع'],
  ['registrationTypeAr', V.registrationTypes, 'نوع التسجيل'],
  ['possessionStatusAr', V.possessionStatuses, 'حالة الحيازة'],
  ['tamStatusAr', V.possessionStatuses, 'حالة تم'],
  ['serviceStatusAr', V.serviceStatuses, 'حالة التشغيل'],
  ['colorAr', V.colors, 'اللون'],
  ['brandAr', V.brands, 'الماركة'],
  ['fuelCard.provider', V.fuelProviders, 'مزوّد الوقود'],
  ['fuelCard.statusAr', V.fuelCardStatuses, 'حالة شريحة الوقود'],
  ['fuelCard.consumptionTypeAr', V.consumptionTypes, 'نوع الاستهلاك'],
  ['gps.provider', V.gpsProviders, 'شركة الـGPS'],
  ['gps.deviceModel', V.gpsDevices, 'جهاز GPS'],
  ['gps.deviceStatusAr', V.gpsDeviceStatuses, 'حالة جهاز GPS'],
  ['inspection.statusAr', V.inspectionStatuses, 'حالة الفحص'],
  ['authorizedPerson.jobTitleAr', V.jobTitles, 'وظيفة المفوَّض'],
];

/** Synonyms normalization alone does not catch: the Latin name of an Arabic brand and the reverse. Written explicitly, not guessed: "MG" is not its Arabic spelling by normalization, but it is by knowledge. */
const SYNONYMS = {
  brandAr: {
    mercedesbenz: 'مرسيدس', mercedes: 'مرسيدس', 'mercedes-benz': 'مرسيدس',
    kia: 'كيا', toyota: 'تويوتا', mazda: 'مازدا', honda: 'هوندا', dodge: 'دودج',
    bmw: 'بي ام دبليو', chevrolet: 'شيفروليه', شيفورلية: 'شيفروليه',
    porsche: 'بورش', mg: 'ام جي', volkswagen: 'فولكسفاجن', landrover: 'لاند روفر',
    haval: 'هافال', isuzu: 'ايسوزو', suzuki: 'سوزوكي', renault: 'رينو', fiat: 'فيات',
    man: 'مان', maxus: 'ماكسوس', bajaj: 'بجي', sinotruk: 'سينو',
  },
};

/**
 * Values that are emptied, not unified: a status written in the field of something else.
 * "Stolen" in the authorized person's job field is not a job; the fourteen vehicles all have operating status stolen in its proper place, so the word here is a duplicate in the wrong place that pollutes the job list and makes the filter show "stolen" as a job. Emptying it loses nothing, since what it says is written in its own field.
 */
const CLEAR_VALUES = {
  'authorizedPerson.jobTitleAr': ['مسروق', 'مسروقة'],
};

/** Light normalization: lowercase, no spaces, dashes or diacritics. */
const norm = (s) => String(s || '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\s\-_/]/g, '')
  .toLowerCase().trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { VehicleMaster } = require('../models/VehicleMaster');

  const plan = [];
  const unknown = [];

  for (const [field, list, label] of FIELDS) {
    const canonicalByNorm = new Map();
    for (const r of list) {
      canonicalByNorm.set(norm(r.nameAr), r.nameAr);
      if (r.nameEn) canonicalByNorm.set(norm(r.nameEn), r.nameAr);
    }
    for (const [alias, canon] of Object.entries(SYNONYMS[field] || {})) canonicalByNorm.set(norm(alias), canon);

    const distinct = await VehicleMaster.aggregate([
      { $match: { [field]: { $nin: ['', null] } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);

    const clearList = (CLEAR_VALUES[field] || []).map(norm);
    for (const d of distinct) {
      const current = d._id;
      if (clearList.includes(norm(current))) { plan.push({ field, label, from: current, to: '', n: d.n, clear: true }); continue; }
      const canon = canonicalByNorm.get(norm(current));
      if (!canon) { unknown.push({ field, label, value: current, n: d.n }); continue; }
      if (canon !== current) plan.push({ field, label, from: current, to: canon, n: d.n });
    }
  }

  console.log('\n  ما سيُوحَّد:');
  if (!plan.length) console.log('    (لا شيء — كلُّ القيم مطابقة)');
  for (const p of plan) console.log(`    ${p.label.padEnd(18)} «${p.from}» → ${p.clear ? '(تُفرَّغ)' : `«${p.to}»`}  (${p.n} مركبة)`);

  if (unknown.length) {
    console.log('\n  خارج القائمة — لن تُمسّ، تُراجَع يدويًّا أو تُضاف من إعدادات القسم:');
    for (const u of unknown) console.log(`    ${u.label.padEnd(18)} «${u.value}»  (${u.n} مركبة)`);
  }

  const rows = plan.reduce((a, p) => a + p.n, 0);
  console.log(`\n  ${plan.length} قيمةً تُوحَّد على ${rows} مركبة · ${unknown.length} قيمةً خارج القائمة.`);

  if (DRY || !YES) { console.log(`\n  ${DRY ? '— تجربةٌ فقط، لم يُكتب شيء.' : '— لم يُمرَّر --yes.'}\n`); process.exit(0); }

  for (const p of plan) {
    const r = await VehicleMaster.updateMany({ [p.field]: p.from }, { $set: { [p.field]: p.to } });
    console.log(`  ✓ ${p.label}: «${p.from}» → ${p.clear ? '(فُرِّغت)' : `«${p.to}»`} — ${r.modifiedCount} مركبة`);
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
