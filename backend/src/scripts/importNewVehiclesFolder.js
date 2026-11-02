/* eslint-disable no-console */
/**
 * importNewVehiclesFolder: update the vehicles section from the new vehicles files folder.
 * Usage: --dry or --yes.
 * The folder is a set of linked files with a manifest describing the relations: 335 vehicles, 25 accidents, 49 insurance policies, 3 general documents, 240 tracking devices, 325 fuel chips, plus gap and alert lists.
 * Stored: the facts (vehicle, insurance policy as its own entity covering hundreds of vehicles, accident, general document, each document's status and reason). Derived and not stored: the 463 alerts and days remaining (measured against the snapshot date; stored they would show 136 days left two months later), and the owner, authorized-person and tracking-provider lists, which the screen aggregates from the vehicles. The file's own quality report is followed: the Hijri column is a formula mirroring the Gregorian one (313 vehicles for the license, 251 for inspection), so it is not stored and is computed at display if needed. Dates renewed from the screen after the snapshot are kept and the skipped ones are printed.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');
const DIR = path.join(__dirname, '..', 'data', 'masters', 'new vehicles files');
const S = (v) => (v === null || v === undefined ? '' : String(v).trim());
const D = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const N = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Gap item in the file to our document key
const ITEM_TO_DOC = {
  'التأمين': 'insurance',
  'بطاقة التشغيل': 'operatingCard',
  'رخصة السير': 'vehicleLicense',
  'الفحص الدوري': 'inspection',
  'اشتراك GPS': 'gps',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster, CorporatePolicy, VehicleInsurancePolicy } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');
  const VDOC = require('../config/vehicleDocuments');
  const { registryPlateKey: plateKey } = require('../utils/plateKey');

  const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const list = (f, key) => { const d = read(f); return Array.isArray(d) ? d : (d[key] || d.records || []); };

  const manifest = read('_manifest.json');
  const vehicles = list('vehicles.json');
  const accidents = list('accidents.json');
  const policies = list('insurance_policies.json');
  const generalDocs = list('general_documents.json');
  const missing = list('missing_data.json');
  const snapshot = D(manifest.snapshot_date) || new Date();

  console.log(`المصدر: ${manifest.source_file} · لقطة ${manifest.snapshot_date}`);
  console.log(`  ${vehicles.length} مركبة · ${accidents.length} حادثًا · ${policies.length} وثيقة تأمين`
    + ` · ${generalDocs.length} وثيقة عامة · ${missing.length} مركبة بنواقص${DRY ? '     (تجربة)' : ''}\n`);

  const sum = {
    vehiclesCreated: 0, vehiclesUpdated: 0, keptUserRenewals: 0,
    policies: 0, claims: 0, claimsUpdated: 0, generalDocs: 0,
    missingItems: 0, linkedToPolicy: 0,
  };
  const kept = [];
  const notes = [];

  // 1. Insurance policies
  const policyByNumber = new Map();   // Policy number to _id
  for (const p of policies) {
    const num = S(p.policy_number);
    if (!num) { notes.push(`${p.id}: وثيقة بلا رقم — تُخطَّت`); continue; }
    const doc = {
      policyNumber: num,
      companyAr: S(p.company),
      coverageTypeAr: S(p.type),
      expiryDate: D(p.expiry_date),
      totalPremiumSar: N(p.total_premium_sar),
      vehicleCount: Array.isArray(p.vehicle_ids) ? p.vehicle_ids.length : 0,
      isActive: true,
    };
    if (DRY) {
      // Dry-run also builds the map (with a fake id) so the link report is honest; otherwise every vehicle looks like its policy is missing.
      policyByNumber.set(num, 'dry');
      sum.policies++;
      continue;
    }
    let found = await VehicleInsurancePolicy.findOne({ policyNumber: num });
    if (found) {
      // A date renewed by staff after the snapshot is not overwritten
      const userRenewal = (found.renewals || [])
        .filter((r) => r.at && new Date(r.at) > snapshot)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const { expiryDate, ...rest } = doc;
      found.set(rest);
      if (userRenewal) {
        kept.push(`وثيقة ${num}: الملف ${doc.expiryDate ? doc.expiryDate.toISOString().slice(0, 10) : '—'}`
          + ` · وجدَّدها ${userRenewal.byName || 'موظف'} إلى ${new Date(userRenewal.newExpiry).toISOString().slice(0, 10)}`);
        sum.keptUserRenewals++;
      } else if (doc.expiryDate) found.expiryDate = doc.expiryDate;
      await found.save();
    } else {
      found = await VehicleInsurancePolicy.create(doc);
    }
    policyByNumber.set(num, found._id);
    sum.policies++;
  }

  // 2. Data gaps: vehicle to its items with reasons
  const missingByVehicle = new Map();
  for (const m of missing) {
    const items = (m.missing || []).map((x) => ({
      item: S(x.item),
      docKey: ITEM_TO_DOC[S(x.item)] || '',
      reason: VDOC.mapSentinel(x.reason),
    }));
    missingByVehicle.set(m.vehicle_id, items);
    sum.missingItems += items.length;
  }

  // 3. Vehicles
  const idToVehicle = new Map();
  for (const v of vehicles) {
    const idn = v.identity || {}; const asg = v.assignment || {}; const own = v.ownership || {};
    const ap = v.authorized_person || {}; const ins = v.insurance || {}; const fc = v.fuel_card_petroapp || {};
    const gps = v.gps || {}; const oc = v.operating_card || {}; const lic = v.vehicle_license || {};
    const insp = v.inspection || {}; const links = v.links || {};

    const plate = S(idn.plate_number);
    const key = plateKey(plate) || S(idn.plate_number_normalized);
    const vin = S(idn.vin);
    idToVehicle.set(v.id, { plate, key, vin });

    const st = (x) => VDOC.mapSentinel(x);
    // Semantic text is not stored as a value. The file leaves the required and not-required words in the value cell and puts their code in the adjacent field. Copying them would show required as a tracking company with 45 vehicles and not-required as a device model with 50. The value is cleared and the code kept.
    const val = (v, status) => (status ? '' : S(v));
    const doc = {
      source_row: v.source_row ?? null,
      plateNumber: plate,
      plateKey: key,
      chassisNumber: vin,
      serialNumber: val(idn.serial_number, idn.serial_number_status),
      registrationTypeAr: S(idn.registration_type),
      brandAr: S(idn.brand),
      modelAr: S(idn.model_name),
      modelYear: N(idn.model_year),
      colorAr: val(idn.color, idn.color_status),
      // Trailing spaces in department names make two values for one department; the file's quality report warns about it, and the cleanup is done here, not on screen.
      sectorAr: S(asg.sector),
      departmentAr: val(asg.department, asg.department_status),
      cityAr: val(asg.city, asg.city_status),
      ownerNameAr: S(own.owner_name),
      commercialRegistration: val(own.commercial_register, own.commercial_register_status),
      possessionStatusAr: S(own.possession_status),
      authorizedPerson: {
        name: val(ap.name, ap.name_status), iqamaNumber: val(ap.iqama_number, ap.iqama_status), jobTitleAr: val(ap.job_title, ap.job_title_status),
      },
      'insurance.policyNumber': val(ins.policy_number, ins.policy_status),
      'insurance.companyAr': val(ins.company, ins.company_status),
      'insurance.coverageTypeAr': val(ins.type, ins.type_status),
      'insurance.premiumSar': N(ins.premium_sar),
      'insurance.statusCode': st(ins.expiry_status),
      'fuelCard.cardNumber': val(fc.chip_number, fc.chip_status),
      'fuelCard.plateOnInvoiceAr': val(fc.plate_on_invoice, fc.plate_on_invoice_status),
      'fuelCard.statusAr': val(fc.card_status, fc.card_status_code),
      'fuelCard.consumptionTypeAr': val(fc.consumption_type, fc.consumption_type_status),
      'fuelCard.limitSar': N(fc.consumption_limit),
      'gps.deviceModel': val(gps.device_model, gps.device_model_status),
      'gps.deviceStatusAr': val(gps.device_status, gps.device_status_code),
      'gps.provider': val(gps.provider, gps.provider_status),
      'gps.serialImei': val(gps.serial, gps.serial_status),
      'gps.statusCode': st(gps.subscription_expiry_status),
      'operatingCard.cardNumber': val(oc.number, oc.number_status),
      'operatingCard.statusCode': st(oc.expiry_status),
      'vehicleLicense.statusCode': st(lic.expiry_gregorian_status),
      'inspection.statusAr': val(insp.status, insp.status_code),
      'inspection.statusCode': st(insp.expiry_gregorian_status),
      // The file's Hijri date is a formula mirroring the Gregorian one; not stored (quality report).
      'vehicleLicense.expiryDateHijri': '',
      'inspection.expiryDateHijri': '',
      missingItems: missingByVehicle.get(v.id) || [],
      notesAr: S(v.notes),
      isActive: true,
    };

    const polId = S(links.insurance_policy_id);
    const polNum = S(ins.policy_number);
    if (polNum && policyByNumber.has(polNum)) { doc.insurancePolicy = policyByNumber.get(polNum); sum.linkedToPolicy++; }
    else if (polId) notes.push(`${plate}: وثيقة ${polId} غير موجودة في ملف الوثائق`);

    const DATES = [
      ['insurance.expiryDate', D(ins.expiry_date), 'insurance'],
      ['gps.expiryDate', D(gps.subscription_expiry), 'gps'],
      ['operatingCard.expiryDate', D(oc.expiry_date), 'operatingCard'],
      ['vehicleLicense.expiryDate', D(lic.expiry_gregorian), 'vehicleLicense'],
      ['inspection.expiryDate', D(insp.expiry_gregorian), 'inspection'],
    ];

    let existing = vin ? await VehicleMaster.findOne({ chassisNumber: vin }) : null;
    if (!existing && key) existing = await VehicleMaster.findOne({ plateKey: key });

    if (DRY) { existing ? sum.vehiclesUpdated++ : sum.vehiclesCreated++; continue; }

    if (!existing) {
      const made = new VehicleMaster(doc);
      for (const [p, d] of DATES) if (d) made.set(p, d);
      await made.save();
      sum.vehiclesCreated++;
      continue;
    }
    for (const [p, val] of Object.entries(doc)) existing.set(p, val);
    for (const [p, d, docKey] of DATES) {
      const userRenewal = (existing.renewals || [])
        .filter((r) => r.document === docKey && r.at && new Date(r.at) > snapshot)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      if (userRenewal) {
        kept.push(`${plate} · ${docKey}: الملف ${d ? d.toISOString().slice(0, 10) : '—'}`
          + ` · وجدَّده ${userRenewal.byName || 'موظف'} إلى ${new Date(userRenewal.newExpiry).toISOString().slice(0, 10)}`);
        sum.keptUserRenewals++;
        continue;
      }
      existing.set(p, d);
    }
    await existing.save();
    sum.vehiclesUpdated++;
  }

  // 4. Accidents
  for (const a of accidents) {
    const sub = a.subject || a.vehicle || {};
    const cp = a.counterparty || {}; const cl = a.claim || {};
    const linked = a.vehicle_id ? idToVehicle.get(a.vehicle_id) : null;
    const plate = S(linked?.plate) || S(sub.plate_number) || S(a.plate_number) || S(a.vehicle_label);
    const label = S(a.subject_label) || S(sub.label) || plate;
    const est = N(cl.estimated_amount_sar ?? a.estimated_amount_sar);
    const rec = N(cl.expected_recovery_sar ?? a.expected_recovery_sar);
    const fault = N(a.fault_ratio ?? a.fault_percent);
    const doc = {
      claimId: S(a.id) || S(a.accident_id),
      sourceRow: a.source_row ?? null,
      // One row is the goods-damage claim, a cargo claim and not a vehicle accident (flagged by the quality report); the flag separates it instead of showing it as an unknown vehicle.
      isVehicleIncident: !!linked,
      incidentSubjectAr: label,
      vehiclePlate: linked ? plate : '',
      vehiclePlateKey: linked ? linked.key : '',
      counterpartyNameAr: S(cp.name ?? a.counterparty_name),
      counterpartyNationalId: S(cp.id_number ?? a.counterparty_id),
      faultRatio: fault,
      faultPercent: fault != null ? Math.round(fault <= 1 ? fault * 100 : fault) : null,
      accidentDate: D(a.accident_date),
      reportedViaAr: S(a.reported_via),
      accidentNumber: S(a.accident_number),
      reportOrEstimateNumber: S(a.report_estimate_number ?? a.estimate_number),
      claim: {
        insurerAr: S(cl.insurer ?? cl.insurer_ar ?? a.insurer),
        claimNumber: S(cl.claim_number ?? a.claim_number),
        notesAr: S(cl.notes ?? cl.notes_ar ?? a.notes),
        lastNoteDate: D(cl.last_note_date ?? a.last_note_date),
        lastInsurerUpdateDate: D(cl.last_insurer_update_date ?? a.last_insurer_update_date),
        estimatedAmountSar: est,
        expectedRecoverySar: rec,
        recoveryGapSar: est != null && rec != null ? Math.round(est - rec) : null,
      },
      statusAr: S(a.status_ar ?? a.status_label),
      statusCode: S(a.status) === 'closed' ? 'closed' : S(a.status) === 'open' ? 'pending' : '',
      isActive: true,
    };
    if (!doc.claimId) { notes.push('حادث بلا معرّف — تُخطّي'); continue; }
    if (DRY) { sum.claims++; continue; }
    const found = await VehicleClaim.findOne({ claimId: doc.claimId });
    if (found) { found.set(doc); await found.save(); sum.claimsUpdated++; }
    else { await VehicleClaim.create(doc); sum.claims++; }
  }

  // Vehicle accident counter is computed from its effective claims
  if (!DRY) {
    await VehicleMaster.updateMany({}, { $set: { accidentCount: 0 } });
    const keys = [...new Set((await VehicleClaim.find({ isActive: true }).select('vehiclePlateKey').lean())
      .map((c) => c.vehiclePlateKey).filter(Boolean))];
    for (const k of keys) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true });
      await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } });
    }
  }

  // 5. General documents
  for (const g of generalDocs) {
    const doc = {
      scopeAr: S(g.document_name),
      policyholderAr: S(g.owner),
      policyNumbers: Array.isArray(g.document_numbers) ? g.document_numbers : [],
      companyAr: S(g.counterparty),
      expiryDate: D(g.expiry_date),
      premiumSar: N(g.value_sar),
      statusAr: S(g.status),
      notesAr: S(g.value_text),
      isActive: true,
    };
    if (DRY) { sum.generalDocs++; continue; }
    const found = await CorporatePolicy.findOne({ scopeAr: doc.scopeAr });
    if (found) { found.set(doc); await found.save(); } else { await CorporatePolicy.create(doc); }
    sum.generalDocs++;
  }

  console.log('النتيجة:', JSON.stringify(sum, null, 1));
  if (kept.length) {
    console.log(`\nتواريخ تُركت كما هي — جدَّدها موظف بعد لقطة الملف (${kept.length}):`);
    kept.slice(0, 15).forEach((k) => console.log('   ' + k));
  }
  if (notes.length) {
    console.log(`\nملاحظات (${notes.length}):`);
    [...new Set(notes)].slice(0, 10).forEach((n) => console.log('   ' + n));
  }

  if (!DRY) {
    const total = await VehicleMaster.countDocuments({});
    const withMissing = await VehicleMaster.countDocuments({ 'missingItems.0': { $exists: true } });
    const linked = await VehicleMaster.countDocuments({ insurancePolicy: { $ne: null } });
    console.log(`\nفي النظام: ${total} مركبة · ${await VehicleInsurancePolicy.countDocuments({})} وثيقة تأمين`
      + ` · ${await VehicleClaim.countDocuments({ isActive: true })} حادثًا`
      + ` · ${await CorporatePolicy.countDocuments({ isActive: true })} وثيقة عامة`);
    console.log(`مركبات عليها نواقص: ${withMissing} · مربوطة بوثيقة تأمين: ${linked}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
