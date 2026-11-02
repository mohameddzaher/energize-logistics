/* eslint-disable no-console */
/**
 * Updates the vehicles section from the vehicles files folder.
 * Usage: node src/scripts/importVehiclesFolder.js --dry | --yes
 * Rules: (1) match by chassis first, since plates change; (2) the file never overwrites a date an employee renewed on screen after the snapshot; (3) status is computed at display time, only dates are stored.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const DIR = path.join(__dirname, '..', 'data', 'masters', 'vehicles files');
const S = (v) => (v === null || v === undefined ? '' : String(v).trim());
const D = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const N = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster, CorporatePolicy } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');
  const AuditLog = (() => { try { return require('../models/AuditLog'); } catch { return null; } })();
  // Registry key is letters plus digits, not digits only: digit-only keys collide in 11 cases across the many bikes. See utils/plateKey.
  const { registryPlateKey: plateKey } = require('../utils/plateKey');

  const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const manifest = read('fleet_manifest.json');
  const vehiclesFile = read('vehicles.json');
  const accidentsFile = read('accidents.json');
  const policiesFile = read('general_insurance.json');
  const snapshot = D(manifest.metadata?.snapshot_date) || new Date();

  console.log(`المصدر: ${manifest.metadata?.source_file} · لقطة ${manifest.metadata?.snapshot_date}`);
  console.log(`  ${vehiclesFile.vehicles.length} مركبة · ${accidentsFile.accidents.length} حادثًا · ${policiesFile.policies.length} وثيقة شركة${DRY ? '     (تجربة)' : ''}\n`);

  const sum = { created: 0, updated: 0, keptUserRenewals: 0, claims: 0, claimsUpdated: 0, policies: 0 };
  const kept = [];
  const idToPlate = new Map();

  // Vehicles.
  for (const v of vehiclesFile.vehicles) {
    const cls = v.classification || {}; const own = v.ownership || {}; const idn = v.identity || {};
    const sp = v.specs || {}; const ap = v.authorized_person || {}; const ins = v.insurance || {};
    const fc = v.fuel_card || {}; const gps = v.gps || {}; const oc = v.operating_card || {};
    const lic = v.vehicle_license || {}; const insp = v.periodic_inspection || {};

    const plate = S(idn.plate_number_ar) || S(idn.plate_normalized);
    const key = plateKey(plate);
    const chassis = S(idn.chassis_number);
    idToPlate.set(v.vehicle_id, { plate, key, chassis });

    const doc = {
      source_row: v.source_row ?? null,
      plateNumber: plate,
      plateKey: key,
      chassisNumber: chassis,
      serialNumber: S(idn.serial_number),
      sectorAr: S(cls.sector_ar),
      departmentAr: S(cls.department_ar),
      cityAr: S(cls.city_ar),
      registrationTypeAr: S(cls.registration_type_ar),
      ownerNameAr: S(own.owner_ar),
      possessionStatusAr: S(own.possession_status_ar),
      commercialRegistration: S(own.cr_number),
      brandAr: S(sp.make_ar),
      modelAr: S(sp.model_ar),
      modelYear: N(sp.year),
      colorAr: S(sp.color_ar),
      authorizedPerson: {
        name: S(ap.name), iqamaNumber: S(ap.iqama_number), jobTitleAr: S(ap.job_title_ar),
      },
      'insurance.policyNumber': S(ins.policy_number),
      'insurance.companyAr': S(ins.company_ar),
      'insurance.coverageTypeAr': S(ins.coverage_type_ar),
      'insurance.premiumSar': N(ins.premium_sar),
      'fuelCard.cardNumber': S(fc.chip_number),
      'fuelCard.plateOnInvoiceAr': S(fc.plate_on_invoice_ar),
      'fuelCard.statusAr': S(fc.chip_status_ar),
      'fuelCard.consumptionTypeAr': S(fc.consumption_type),
      'fuelCard.limitSar': N(fc.consumption_limit),
      'gps.deviceModel': S(gps.device_model),
      'gps.deviceStatusAr': S(gps.device_status_ar),
      'gps.provider': S(gps.provider),
      'gps.serialImei': S(gps.serial),
      'operatingCard.cardNumber': S(oc.card_number),
      'vehicleLicense.expiryDateHijri': S(lic.expiry_date_hijri),
      'inspection.statusAr': S(insp.status_ar) || S(insp.status_ar_note),
      'inspection.expiryDateHijri': S(insp.expiry_date_hijri),
      logistiGaps: Array.isArray(v.logisti_platform_missing_data) ? v.logisti_platform_missing_data : [],
      notesAr: S(v.notes_ar),
      isActive: true,
    };

    // Dates an employee may have renewed from the screen.
    const DATES = [
      ['insurance.expiryDate', D(ins.expiry_date), 'insurance'],
      ['gps.expiryDate', D(gps.subscription_expiry_date), 'gps'],
      ['operatingCard.expiryDate', D(oc.expiry_date), 'operatingCard'],
      ['vehicleLicense.expiryDate', D(lic.expiry_date_gregorian), 'vehicleLicense'],
      ['inspection.expiryDate', D(insp.expiry_date_gregorian), 'inspection'],
    ];

    // Chassis first, then plate.
    let existing = chassis ? await VehicleMaster.findOne({ chassisNumber: chassis }) : null;
    if (!existing && key) existing = await VehicleMaster.findOne({ plateKey: key });

    if (DRY) { existing ? sum.updated++ : sum.created++; continue; }

    if (!existing) {
      const made = new VehicleMaster(doc);
      for (const [p, d] of DATES) if (d) made.set(p, d);
      await made.save();
      sum.created++;
      continue;
    }

    for (const [p, val] of Object.entries(doc)) existing.set(p, val);
    for (const [p, d, docKey] of DATES) {
      // Renewed on screen after the file snapshot means its date is newer, so keep it.
      const userRenewal = (existing.renewals || [])
        .filter((r) => r.document === docKey && r.at && new Date(r.at) > snapshot)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      if (userRenewal) {
        kept.push(`${plate} · ${docKey}: الملف ${d ? d.toISOString().slice(0, 10) : '—'}`
          + ` · وجدَّده ${userRenewal.byName || 'موظف'} إلى ${new Date(userRenewal.newExpiry).toISOString().slice(0, 10)}`);
        sum.keptUserRenewals++;
        continue;
      }
      if (d) existing.set(p, d);
    }
    await existing.save();
    sum.updated++;
  }

  // Accidents.
  for (const a of accidentsFile.accidents) {
    const sub = a.subject || {}; const cp = a.counterparty || {}; const cl = a.claim || {};
    const link = idToPlate.get(sub.vehicle_id);
    const plate = S(sub.plate_normalized) || S(sub.label_ar);
    const key = link?.key || (plate ? plateKey(plate) : '');
    const est = N(cl.estimated_amount_sar); const rec = N(cl.expected_recovery_sar);
    const doc = {
      claimId: a.accident_id,
      sourceRow: a.source_row ?? null,
      isVehicleIncident: sub.is_vehicle !== false,
      incidentSubjectAr: S(sub.label_ar),
      vehiclePlate: plate,
      vehiclePlateKey: key,
      vehicleTypeAr: S(sub.vehicle_type_ar),
      ownerRegistrationAr: S(sub.owner_record_ar),
      counterpartyNameAr: S(cp.name),
      counterpartyNationalId: S(cp.id_number),
      faultRatio: N(a.fault_ratio),
      faultPercent: N(a.fault_ratio) != null ? Math.round(N(a.fault_ratio) * (N(a.fault_ratio) <= 1 ? 100 : 1)) : null,
      accidentDate: D(a.accident_date),
      reportedViaAr: S(a.reported_via),
      accidentNumber: S(a.accident_number),
      reportOrEstimateNumber: S(a.report_estimate_number),
      claim: {
        insurerAr: S(cl.insurer_ar),
        claimNumber: S(cl.claim_number),
        notesAr: S(cl.notes_ar),
        lastNoteDate: D(cl.last_note_date),
        lastInsurerUpdateDate: D(cl.last_insurer_update_date),
        estimatedAmountSar: est,
        expectedRecoverySar: rec,
        recoveryGapSar: est != null && rec != null ? Math.round(est - rec) : null,
      },
      statusAr: S(a.status_ar) || S(a.status),
      statusCode: S(a.status) === 'closed' ? 'closed' : S(a.status) === 'open' ? 'pending' : '',
      isActive: true,
    };
    if (DRY) { sum.claims++; continue; }
    const found = await VehicleClaim.findOne({ claimId: doc.claimId });
    if (found) { found.set(doc); await found.save(); sum.claimsUpdated++; }
    else { await VehicleClaim.create(doc); sum.claims++; }
  }

  // Per-vehicle accident counter equals its active claims count (computed, not typed).
  if (!DRY) {
    const keys = [...new Set((await VehicleClaim.find({ isActive: true }).select('vehiclePlateKey').lean())
      .map((c) => c.vehiclePlateKey).filter(Boolean))];
    await VehicleMaster.updateMany({}, { $set: { accidentCount: 0 } });
    for (const k of keys) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true });
      await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } });
    }
  }

  // Company-level insurance policies.
  for (const p of policiesFile.policies) {
    const doc = {
      scopeAr: S(p.coverage_ar),
      policyholderAr: S(p.owner_ar),
      policyNumbers: Array.isArray(p.policy_numbers) ? p.policy_numbers : [],
      companyAr: S(p.insurer_ar),
      expiryDate: D(p.expiry_date),
      premiumSar: N(p.premium_sar),
      statusAr: S(p.status_ar),
      notesAr: S(p.notes_ar),
      isActive: true,
    };
    if (DRY) { sum.policies++; continue; }
    const found = await CorporatePolicy.findOne({ scopeAr: doc.scopeAr });
    if (found) { found.set(doc); await found.save(); } else { await CorporatePolicy.create(doc); }
    sum.policies++;
  }

  console.log('النتيجة:', JSON.stringify(sum));
  if (kept.length) {
    console.log(`\nتواريخ تُركت كما هي — جدَّدها موظف بعد لقطة الملف (${kept.length}):`);
    kept.slice(0, 20).forEach((k) => console.log('   ' + k));
    if (kept.length > 20) console.log(`   … و${kept.length - 20} غيرها`);
  }

  if (!DRY) {
    const total = await VehicleMaster.countDocuments({});
    const gaps = await VehicleMaster.countDocuments({ 'logistiGaps.0': { $exists: true } });
    console.log(`\nفي النظام: ${total} مركبة · ${await VehicleClaim.countDocuments({ isActive: true })} حادثًا`
      + ` · ${await CorporatePolicy.countDocuments({ isActive: true })} وثيقة شركة`);
    console.log(`مركبات عليها نواقص منصّة لوجستي: ${gaps}`);
    console.log(`المتوقَّع من الملف: ${vehiclesFile.statistics.total_vehicles} مركبة`
      + ` · ${vehiclesFile.statistics.with_logisti_platform_gaps} بنواقص`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
