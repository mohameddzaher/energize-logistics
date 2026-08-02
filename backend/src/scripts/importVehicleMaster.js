/* eslint-disable no-console */
// استيراد ماستر المركبات 2026 — يمسح السجل القديم بالكامل ويُدخل الـ326 مركبة
// من الملف المسطّح (vehicles_2026_flat.json). شغّله مرة واحدة:
//   node src/scripts/importVehicleMaster.js
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const { VehicleMaster } = require('../models/VehicleMaster');

const d = (v) => (v ? new Date(v) : null);
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function mapRow(r) {
  return {
    source_row: r.source_row,
    plateNumber: r.plate_number,
    plateLettersAr: r.plate_letters_ar || '',
    plateDigits: r.plate_digits || '',
    chassisNumber: r.chassis_number || '',
    serialNumber: r.serial_number || '',
    sectorAr: r.sector_ar || '',
    sectorCode: r.sector_code || '',
    registrationTypeAr: r.registration_type_ar || '',
    registrationTypeCode: r.registration_type_code || '',
    brandAr: r.brand_ar || '',
    modelAr: r.model_ar || '',
    modelYear: n(r.model_year),
    colorAr: r.color_ar || '',
    colorCode: r.color_code || '',
    ownerNameAr: r.ownership_owner_name_ar || '',
    commercialRegistration: r.ownership_commercial_registration || '',
    tamStatusAr: r.ownership_tam_status_ar || '',
    tamStatusCode: r.ownership_tam_status_code || '',
    insurance: {
      policyNumber: r.insurance_policy_number || '',
      companyAr: r.insurance_company_ar || '',
      coverageTypeAr: r.insurance_coverage_type_ar || '',
      coverageTypeCode: r.insurance_coverage_type_code || '',
      expiryDate: d(r.insurance_expiry_date),
      premiumSar: n(r.insurance_premium_sar),
      status: r.insurance_policy_status || '',
    },
    fuelCard: {
      provider: r.fuel_card_provider || '',
      cardNumber: r.fuel_card_card_number || '',
      statusAr: r.fuel_card_status_ar || '',
      statusCode: r.fuel_card_status_code || '',
      consumptionTypeAr: r.fuel_card_consumption_type_ar || '',
      consumptionTypeCode: r.fuel_card_consumption_type_code || '',
      limitSar: n(r.fuel_card_limit_sar),
      limitStatus: r.fuel_card_limit_status || '',
    },
    gps: {
      deviceId: r.gps_device_id || '',
      simNumber: r.gps_sim_number || '',
      provider: r.gps_provider || '',
      status: r.gps_device_status || '',
      expiryDate: d(r.gps_expiry_date),
    },
    operatingCard: {
      cardNumber: r.operating_card_card_number || '',
      expiryDate: d(r.operating_card_expiry_date),
    },
    vehicleLicense: {
      expiryDate: d(r.vehicle_license_expiry_date_gregorian),
    },
    inspection: {
      statusAr: r.inspection_status_ar || '',
      statusCode: r.inspection_status_code || '',
      expiryDate: d(r.inspection_expiry_date_gregorian),
    },
    notesAr: r.notes_ar || '',
    isActive: true,
  };
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('No Mongo URI in env (MONGO_URI/MONGODB_URI/DATABASE_URL)');
  await mongoose.connect(uri);

  const file = path.join(__dirname, '..', 'data', 'masters', 'vehicles_2026_flat.json');
  const raw = require(file);
  const rows = Array.isArray(raw) ? raw : (raw.records || raw.rows || raw.data || []);
  console.log(`Loaded ${rows.length} rows from vehicles_2026_flat.json`);

  const docs = rows.filter((r) => r.plate_number).map(mapRow);
  const del = await VehicleMaster.deleteMany({});
  console.log(`Cleared ${del.deletedCount} existing vehicle-master docs`);

  const res = await VehicleMaster.insertMany(docs, { ordered: false });
  console.log(`Inserted ${res.length} vehicles`);

  // ملخّص سريع للتحقّق
  const bySector = {};
  for (const v of docs) bySector[v.sectorAr || '—'] = (bySector[v.sectorAr || '—'] || 0) + 1;
  console.log('By sector:', bySector);

  await mongoose.disconnect();
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
