/**
 * importVehiclesMaster — تحميل ماستر المركبات من data/masters/vehicles_full.json.
 *
 *   node src/scripts/importVehiclesMaster.js --dry     يعرض بس
 *   node src/scripts/importVehiclesMaster.js           ينفّذ
 *
 * ٣٣٢ مركبة + ٢٣ حادث/مطالبة + وثيقتين تأمين على مستوى الشركة.
 *
 * idempotent، واللي أهم منه: **مش بيمسح شغل الناس**. `renewals` (اللي المستخدم
 * بيسجّله لما يجدّد مستند) بتتساب زي ما هي — الاستيراد بيحدّث بيانات الماستر
 * الجاية من الإكسل بس. لو اتعامل معاها كـ overwrite كامل، أول إعادة استيراد كانت
 * هتمسح كل سجل تجديد اتكتب من الشاشة.
 *
 * `days_remaining` و`document_state` اللي في الملف **مش بتتخزّن**: دي محسوبة
 * لحظة تصدير الإكسل وبتبور بعد يوم. بنخزّن التاريخ بس ونحسبهم وقت العرض.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const d = (v) => (v ? new Date(v) : null);
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const s = (v) => (v === null || v === undefined ? '' : String(v).trim());

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster, CorporatePolicy } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');

  const src = require(path.join(__dirname, '..', 'data', 'masters', 'vehicles_full.json'));
  console.log(`المصدر: ${src.vehicles.length} مركبة · ${src.accidents.length} حادث · ${src.corporate_insurance_policies.length} وثيقة شركة${DRY ? '   (تجربة)' : ''}\n`);

  // ── المركبات ───────────────────────────────────────────────────────────────
  let created = 0; let updated = 0;
  const plateToId = new Map();
  const keyToId = new Map();

  for (const v of src.vehicles) {
    const doc = {
      source_row: v.source_row,
      plateNumber: s(v.plate_number),
      plateKey: s(v.plate_key),
      plateLettersAr: s(v.plate_letters_ar),
      plateDigits: s(v.plate_digits),
      chassisNumber: s(v.chassis_number),
      serialNumber: s(v.serial_number),

      sectorAr: s(v.sector?.ar), sectorCode: s(v.sector?.code),
      registrationTypeAr: s(v.registration_type?.ar), registrationTypeCode: s(v.registration_type?.code),
      brandAr: s(v.brand_ar), modelAr: s(v.model_ar), modelYear: n(v.model_year),
      colorAr: s(v.color?.ar), colorCode: s(v.color?.code),

      ownerNameAr: s(v.ownership?.owner_name_ar),
      commercialRegistration: s(v.ownership?.commercial_registration),
      tamStatusAr: s(v.ownership?.tam_status?.ar), tamStatusCode: s(v.ownership?.tam_status?.code),

      insurance: {
        policyNumber: s(v.insurance?.policy_number),
        companyAr: s(v.insurance?.company_ar),
        coverageTypeAr: s(v.insurance?.coverage_type?.ar),
        coverageTypeCode: s(v.insurance?.coverage_type?.code),
        expiryDate: d(v.insurance?.expiry_date),
        premiumSar: n(v.insurance?.premium_sar),
        statusCode: s(v.insurance?.expiry_status),
      },
      fuelCard: {
        provider: s(v.fuel_card?.provider),
        cardNumber: s(v.fuel_card?.card_number),
        statusAr: s(v.fuel_card?.status?.ar), statusCode: s(v.fuel_card?.status?.code),
        consumptionTypeAr: s(v.fuel_card?.consumption_type?.ar),
        consumptionTypeCode: s(v.fuel_card?.consumption_type?.code),
        limitSar: n(v.fuel_card?.limit_sar),
        limitStatus: v.fuel_card?.limit_is_open ? 'open' : s(v.fuel_card?.limit_status),
      },
      gps: {
        deviceModel: s(v.gps?.device_model),
        serialImei: s(v.gps?.serial_imei),
        provider: s(v.gps?.provider),
        status: s(v.gps?.device_status?.ar), statusCode: s(v.gps?.device_status?.code),
        expiryDate: d(v.gps?.subscription_expiry_date),
      },
      operatingCard: {
        cardNumber: s(v.operating_card?.card_number),
        expiryDate: d(v.operating_card?.expiry_date),
        statusCode: s(v.operating_card?.expiry_status),
      },
      vehicleLicense: {
        expiryDate: d(v.vehicle_license?.expiry_date_gregorian),
        statusCode: s(v.vehicle_license?.expiry_status),
      },
      inspection: {
        statusAr: s(v.inspection?.status?.ar), statusCode: s(v.inspection?.status?.code),
        expiryDate: d(v.inspection?.expiry_date_gregorian),
      },
      accidentCount: v.accident_count || 0,
      notesAr: s(v.notes_ar),
      isActive: true,
    };

    if (DRY) { created++; continue; }
    const existing = await VehicleMaster.findOne({ plateNumber: doc.plateNumber });
    if (existing) {
      // renewals مش في `doc` أصلاً، فـ Object.assign مش هيلمسها — وده المقصود.
      Object.assign(existing, doc);
      await existing.save();
      updated++;
      plateToId.set(doc.plateNumber, existing._id);
      keyToId.set(doc.plateKey, existing._id);
    } else {
      const made = await VehicleMaster.create(doc);
      created++;
      plateToId.set(doc.plateNumber, made._id);
      keyToId.set(doc.plateKey, made._id);
    }
  }
  console.log(`المركبات: ${created} جديدة · ${updated} محدَّثة`);

  // ── الحوادث/المطالبات ──────────────────────────────────────────────────────
  let cNew = 0; let cUpd = 0; let linked = 0;
  for (const a of src.accidents) {
    const vehId = keyToId.get(s(a.vehicle_plate_key)) || null;
    if (vehId) linked++;
    const doc = {
      claimId: s(a.accident_id), sourceRow: a.source_row,
      isVehicleIncident: a.is_vehicle_incident !== false,
      incidentSubjectAr: s(a.incident_subject_ar),
      vehiclePlate: s(a.vehicle_plate), vehiclePlateKey: s(a.vehicle_plate_key), vehicle: vehId,
      vehicleSectorAr: s(a.vehicle_sector_ar), vehicleTypeAr: s(a.vehicle_type_ar),
      vehicleCategoryAr: s(a.vehicle_category_ar), vehicleBrandAr: s(a.vehicle_brand_ar),
      ownerRegistrationAr: s(a.owner_registration_ar),
      counterpartyNameAr: s(a.counterparty?.name_ar),
      counterpartyNationalId: s(a.counterparty?.national_id),
      faultRatio: n(a.fault_ratio), faultPercent: n(a.fault_percent),
      accidentDate: d(a.accident_date),
      reportedViaAr: s(a.reported_via?.ar), reportedViaCode: s(a.reported_via?.code),
      accidentNumber: s(a.accident_number), reportOrEstimateNumber: s(a.report_or_estimate_number),
      claim: {
        insurerAr: s(a.claim?.insurer_ar),
        claimNumber: s(a.claim?.claim_number),
        claimNumberStatus: s(a.claim?.claim_number_status),
        notesAr: s(a.claim?.notes_ar),
        lastNoteDate: d(a.claim?.last_note_date),
        lastInsurerUpdateDate: d(a.claim?.last_insurer_update_date),
        estimatedAmountSar: n(a.claim?.estimated_amount_sar),
        expectedRecoverySar: n(a.claim?.expected_recovery_sar),
        recoveryGapSar: n(a.claim?.recovery_gap_sar),
      },
      statusAr: s(a.status?.ar), statusCode: s(a.status?.code),
      isActive: true,
    };
    if (DRY) { cNew++; continue; }
    const ex = await VehicleClaim.findOne({ claimId: doc.claimId });
    if (ex) { Object.assign(ex, doc); await ex.save(); cUpd++; } else { await VehicleClaim.create(doc); cNew++; }
  }
  console.log(`الحوادث: ${cNew} جديدة · ${cUpd} محدَّثة · ${linked} مربوطة بمركبة${DRY ? '' : ` (${src.accidents.length - linked} بلا مركبة مطابقة)`}`);

  // ── وثائق التأمين على مستوى الشركة ─────────────────────────────────────────
  let pNew = 0; let pUpd = 0;
  for (const p of src.corporate_insurance_policies) {
    const doc = {
      scopeAr: s(p.scope_ar), policyholderAr: s(p.policyholder_ar),
      policyNumbers: Array.isArray(p.policy_numbers) ? p.policy_numbers.map(s) : [],
      companyAr: s(p.company_ar), expiryDate: d(p.expiry_date), premiumSar: n(p.premium_sar),
      statusAr: s(p.status?.ar), statusCode: s(p.status?.code), notesAr: s(p.notes_ar), isActive: true,
    };
    if (DRY) { pNew++; continue; }
    const ex = await CorporatePolicy.findOne({ scopeAr: doc.scopeAr });
    if (ex) { Object.assign(ex, doc); await ex.save(); pUpd++; } else { await CorporatePolicy.create(doc); pNew++; }
  }
  console.log(`وثائق الشركة: ${pNew} جديدة · ${pUpd} محدَّثة`);

  // مركبات موجودة عندنا ومش في الملف الجديد. **مش بنمسحها** — الشيت ممكن يكون
  // ناقص، ومسح مركبة حقيقية أسوأ بكتير من إننا نقولها. بنطبعها عشان حد يقرّر.
  if (!DRY) {
    const inFile = new Set(src.vehicles.map((v) => s(v.plate_number)));
    const orphans = (await VehicleMaster.find({ isActive: true }).select('plateNumber sectorAr brandAr').lean())
      .filter((v) => !inFile.has(v.plateNumber));
    if (orphans.length) {
      console.log(`\n⚠ ${orphans.length} مركبة عندنا مش موجودة في الملف الجديد (اتسابت زي ما هي):`);
      orphans.forEach((o) => console.log(`    ${o.plateNumber}  ${o.sectorAr || '—'}  ${o.brandAr || '—'}`));
    }
  }

  if (!DRY) {
    const total = await VehicleMaster.countDocuments({});
    const withRenewals = await VehicleMaster.countDocuments({ 'renewals.0': { $exists: true } });
    console.log(`\nالإجمالي: ${total} مركبة · ${await VehicleClaim.countDocuments({})} حادث · ${await CorporatePolicy.countDocuments({})} وثيقة شركة`);
    console.log(`سجلات التجديد المحفوظة (لم تُمس): ${withRenewals} مركبة`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
