/* eslint-disable no-console */
/**
 * Final vehicles master import (Aug 2026): vehicles, company-wide documents and accidents from final-vehicles.xlsx.
 * Usage: --dry plans without writing, --yes applies, --replace deactivates vehicles missing from the file, --hard deletes them.
 * Repeatable: re-running changes nothing. Days-remaining columns and the fake Hijri columns are not stored. Human edits are kept, and a reason written in place of a value becomes statusCode/missingItems.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry') || !ARGV.includes('--yes');
const REPLACE = ARGV.includes('--replace');
const HARD = ARGV.includes('--hard');
const FILE = path.join(__dirname, '..', 'seeds', 'data', 'vehicles-2026-08', 'final-vehicles.xlsx');

// Cell readers
const S = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const AR_DIGITS = (t) => String(t).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** A real number or null; text that is not a number is null, not zero. */
const N = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = AR_DIGITS(String(v)).replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// Excel serial dates count from 1899-12-30 (not 1900-01-01) because of the phantom 1900 leap year; the wrong epoch shifts every date by a day.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
// Sanity range: 20000 is about 1954 and 75000 about 2105. Iqama or plate numbers landing in a date cell fall outside it.
const serialToDate = (n) => {
  if (!Number.isFinite(n) || n < 20000 || n > 75000) return null;
  const d = new Date(EXCEL_EPOCH + Math.round(n) * DAY);
  return Number.isNaN(d.getTime()) ? null : d;
};
const D = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const n = N(v);
  if (n !== null) return serialToDate(n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const get = (o, p) => p.split('.').reduce((c, k) => (c == null ? c : c[k]), o);
const filled = (v) => !(v === '' || v === null || v === undefined);

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`الملف غير موجود: ${FILE}`); process.exit(1); }

  const VDOC = require('../config/vehicleDocuments');
  // Key on the vehicle register (letters plus digits), not digits alone: digits collide between plates (a motorbike and a trailer both ending in 1080). See utils/plateKey.js.
  const { registryPlateKey: plateKey } = require('../utils/plateKey');

  const wb = XLSX.readFile(FILE);
  const sheet = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) { console.error(`الصفحة «${name}» غير موجودة في الملف`); process.exit(1); }
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  };
  const VEH = sheet('Vehicles');
  const GEN = sheet('وثائق عامة');
  const ACC = sheet('Accidents');

  // Headers are on the second row; the first row holds counters the file wrote for itself.
  const HEAD = (VEH[1] || []).map((h) => S(h));
  const C = {}; HEAD.forEach((h, i) => { if (h && C[h] === undefined) C[h] = i; });
  const need = ['رقم اللوحة', 'رقم الهيكل', 'تاريخ انتهاء التأمين'];
  const absent = need.filter((h) => C[h] === undefined);
  if (absent.length) { console.error(`أعمدة مفقودة في صفحة Vehicles: ${absent.join(' · ')}`); process.exit(1); }
  const col = (row, name) => (C[name] === undefined ? null : row[C[name]]);

  // File date derived from the file itself: each (expiry, days remaining) pair gives it by subtraction. Consensus wins and any disagreement is printed, since stale formulas would break the human-renewal rule.
  const PAIRS = [
    ['تاريخ نهاية التفويض', 'الايام المتبقية علي نهاية التفويض'],
    ['تاريخ انتهاء التأمين', 'الايام المتبقية علي انتهاء التأمين'],
    ['تاريخ انتهاء ال GPS', 'الايام المتبقية علي انتهاء ال GPS'],
    ['تاريخ انتهاء بطاقة التشغيل', 'الايام المتبقية علي انتهاء بطاقة التشغيل'],
    ['تاريخ انتهاء رخصة السير ميلادي', 'الايام المتبقية علي انتهاء رخصة السير'],
    ['تاريخ انتهاء الفحص ميلادي', 'الايام المتبقية علي انتهاء الفحص'],
  ];
  const votes = new Map();
  for (const row of VEH.slice(2)) {
    if (!row) continue;
    for (const [dh, nh] of PAIRS) {
      const d = N(col(row, dh)); const k = N(col(row, nh));
      if (d === null || k === null || d < 20000) continue;
      votes.set(d - k, (votes.get(d - k) || 0) + 1);
    }
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const SNAPSHOT = (ranked.length && serialToDate(ranked[0][0])) || new Date(fs.statSync(FILE).mtime);
  const agree = ranked.length ? ranked[0][1] : 0;
  const disagree = ranked.slice(1).reduce((t, [, c]) => t + c, 0);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster, CorporatePolicy, VehicleInsurancePolicy } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');

  console.log(`المصدر: ${path.basename(FILE)}`);
  console.log(`لقطة الملف: ${iso(SNAPSHOT)}  (${agree} زوجًا متّفقًا${disagree ? ` · ${disagree} مخالفًا` : ''})`);
  console.log(DRY ? '\n═══ تجربة — لن يُكتب شيء ═══\n' : `\n═══ تنفيذ${REPLACE ? (HARD ? ' + محو ما ليس في الملف' : ' + تعطيل ما ليس في الملف') : ''} ═══\n`);

  const sum = {
    vehiclesCreated: 0, vehiclesUpdated: 0, vehiclesUnchanged: 0,
    keptUserRenewals: 0, keptUserFields: 0,
    policiesCreated: 0, policiesUpdated: 0, linkedToPolicy: 0,
    corporateCreated: 0, corporateUpdated: 0,
    claimsCreated: 0, claimsUpdated: 0,
    missingItems: 0, hijriKept: 0,
    staleVehicles: 0, stalePolicies: 0, staleClaims: 0, staleCorporate: 0, removed: 0,
  };
  const skipped = [];   // Rows not read, and why
  const kept = [];      // Values kept because a person wrote them
  const notes = [];

  // Cell text is either a real value or a reason for its absence, never both.
  const cell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    return { raw, code, value: code ? '' : S(raw) };
  };
  // Date cell: the date if present, otherwise the reason it is missing.
  const dcell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    return { date: code ? null : D(raw), code };
  };
  // Number cell: the number if present, otherwise the reason; free text is not a known reason.
  const ncell = (row, name) => {
    const raw = col(row, name);
    const code = VDOC.mapSentinelAr(raw);
    if (code) return { num: null, code, text: '' };
    const n = N(raw);
    return { num: n, code: '', text: n === null ? S(raw) : '' };
  };

  // 1. Read the vehicles sheet
  const parsed = [];
  const seenKeys = new Map();
  VEH.slice(2).forEach((row, i) => {
    const sheetRow = i + 3;                     // Row number as seen in Excel
    if (!row || !row.some((c) => c !== null && c !== '')) return;   // Completely empty row
    const plate = S(col(row, 'رقم اللوحة'));
    if (!plate) {
      // Row with data but no plate: reported, never given an invented key.
      const junk = row.map((c) => S(c)).filter(Boolean).join(' | ').slice(0, 60);
      skipped.push(`صف ${sheetRow}: بلا رقم لوحة${junk ? ` (${junk})` : ''} — لا مفتاح للمركبة`);
      return;
    }
    const key = plateKey(plate);
    if (!key) { skipped.push(`صف ${sheetRow}: اللوحة «${plate}» لا تُنتِج مفتاحًا`); return; }
    if (seenKeys.has(key)) {
      skipped.push(`صف ${sheetRow}: اللوحة «${plate}» تكرّرت (الصف ${seenKeys.get(key)}) — الأولى هي المعتمدة`);
      return;
    }
    seenKeys.set(key, sheetRow);

    const ins = dcell(row, 'تاريخ انتهاء التأمين');
    const gpsX = dcell(row, 'تاريخ انتهاء ال GPS');
    const opX = dcell(row, 'تاريخ انتهاء بطاقة التشغيل');
    const licX = dcell(row, 'تاريخ انتهاء رخصة السير ميلادي');
    const insX = dcell(row, 'تاريخ انتهاء الفحص ميلادي');
    const authX = dcell(row, 'تاريخ نهاية التفويض');
    const authS = dcell(row, 'تاريخ بداية التفويض');

    // Hijri value is stored only when it really differs from the Gregorian one; otherwise it is just a mirror of it.
    const hijri = (gregName, hijriName) => {
      const g = N(col(row, gregName)); const h = N(col(row, hijriName));
      if (g === null || h === null || g === h) return '';
      sum.hijriKept++;
      notes.push(`${plate}: «${hijriName}» يخالف الميلاديّ (${iso(serialToDate(h))} مقابل ${iso(serialToDate(g))}) — حُفِظ كما هو`);
      return iso(serialToDate(h));
    };

    const consType = cell(row, 'نوع الاستهلاك');
    const consLimit = ncell(row, 'حد الاستهلاك');
    const fuelStatus = cell(row, 'حالة الشريحة');
    const premium = ncell(row, 'قيمة التأمين');
    const open = /^opened?$/i.test(S(consType.raw)) || /^opened?$/i.test(S(consLimit.text));

    // A reason for absence becomes a work item. The not-required status is a healthy state, not a gap (isGap excludes it).
    const missingItems = [];
    const gap = (item, docKey, code) => {
      if (VDOC.isGap(code)) { missingItems.push({ item, docKey, reason: code }); sum.missingItems++; }
    };
    gap('التأمين', 'insurance', ins.code);
    gap('بطاقة التشغيل', 'operatingCard', opX.code);
    gap('رخصة السير', 'vehicleLicense', licX.code);
    gap('الفحص الدوري', 'inspection', insX.code);
    gap('اشتراك GPS', 'gps', gpsX.code);
    gap('التفويض', 'authorization', authX.code);
    gap('شريحة الوقود', 'fuelCard', VDOC.mapSentinelAr(col(row, 'شريحة بترو اب')));
    gap('السجل التجاري', '', VDOC.mapSentinelAr(col(row, 'السجل')));

    // Operating state: the stolen value is written in the sector cell and the unused value in the department or city cell. Both are states, not names, so they are read from their position and stored in their own field.
    const sectorRaw = S(col(row, 'القطاع'));
    const idle = [cell(row, 'القسم').code, cell(row, 'المدينة').code].includes('not_in_use');
    const service = sectorRaw === 'مسروق'
      ? { ar: 'مسروقة', code: 'stolen' }
      : idle ? { ar: 'غير مستخدمة', code: 'idle' }
        : { ar: 'في الخدمة', code: 'in_service' };

    const tam = cell(row, 'حالة تم');
    const TAM_CODE = { 'مالك': 'owner', 'مستخدم': 'user' };
    const FUEL_CODE = { 'نشط': 'active', 'غير نشط': 'inactive' };
    const CONS_CODE = { 'monthly': 'monthly', 'opened': 'open' };

    parsed.push({
      sheetRow, plate, key,
      chassis: cell(row, 'رقم الهيكل').value,
      dates: {
        'insurance.expiryDate': { d: ins.date, doc: 'insurance' },
        'gps.expiryDate': { d: gpsX.date, doc: 'gps' },
        'operatingCard.expiryDate': { d: opX.date, doc: 'operatingCard' },
        'vehicleLicense.expiryDate': { d: licX.date, doc: 'vehicleLicense' },
        'inspection.expiryDate': { d: insX.date, doc: 'inspection' },
        'authorizedPerson.expiryDate': { d: authX.date, doc: 'authorization' },
        // Authorization start is not a renewable document, so no renewal record is measured against it.
        'authorizedPerson.startDate': { d: authS.date, doc: null },
      },
      fields: {
        source_row: sheetRow,
        plateNumber: plate,
        plateKey: key,
        chassisNumber: cell(row, 'رقم الهيكل').value,
        serialNumber: cell(row, 'الرقم التسلسلي').value,

        sectorAr: cell(row, 'القطاع').value,
        departmentAr: cell(row, 'القسم').value,
        cityAr: cell(row, 'المدينة').value,
        registrationTypeAr: cell(row, 'نوع التسجيل').value,
        brandAr: cell(row, 'ماركة المركبة').value,
        modelAr: cell(row, 'طراز المركبة').value,
        modelYear: N(col(row, 'الموديل')),
        colorAr: cell(row, 'اللون').value,

        serviceStatusAr: service.ar,
        serviceStatusCode: service.code,

        ownerNameAr: cell(row, 'المالك').value,
        commercialRegistration: cell(row, 'السجل').value,
        // The file has one column for the TAM and possession status, but the app has two fields: tamStatusAr (vehicle page) and possessionStatusAr (possession filter and overview card). Fill both from the same column.
        tamStatusAr: tam.value,
        tamStatusCode: TAM_CODE[tam.value] || (tam.code === 'not_required' ? 'none' : ''),
        possessionStatusAr: tam.value,

        'authorizedPerson.name': cell(row, 'اسم المفوض').value,
        'authorizedPerson.iqamaNumber': cell(row, 'رقم الاقامة').value,
        'authorizedPerson.authorizationNumber': cell(row, 'رقم التفويض').value,
        'authorizedPerson.statusCode': authX.code,

        'insurance.policyNumber': cell(row, 'رقم وثيقة التأمين').value,
        'insurance.companyAr': cell(row, 'شركة التأمين').value,
        'insurance.coverageTypeAr': cell(row, 'نوع التأمين').value,
        'insurance.premiumSar': premium.num,
        // Write the financed-by-bank text, not the required text, into the value cell. The former means the financier pays the installment, so the vehicle is insured; the latter is a work item that belongs in missingItems.
        'insurance.premiumStatusAr': ['with_bank', 'with_aljabr'].includes(premium.code)
          ? S(col(row, 'قيمة التأمين')) : premium.text,
        'insurance.statusCode': ins.code,

        'fuelCard.provider': 'بترو اب',
        'fuelCard.cardNumber': cell(row, 'شريحة بترو اب').value,
        'fuelCard.plateOnInvoiceAr': cell(row, 'رقم اللوحة في فاتورة بترو اب').value,
        // Status column: the not-required value is a real state, not an empty-cell reason, so it stays as text.
        'fuelCard.statusAr': S(fuelStatus.raw),
        'fuelCard.statusCode': FUEL_CODE[S(fuelStatus.raw)] || fuelStatus.code,
        'fuelCard.consumptionTypeAr': consType.value,
        'fuelCard.consumptionTypeCode': CONS_CODE[S(consType.value).toLowerCase()] || '',
        'fuelCard.limitSar': consLimit.num,
        'fuelCard.limitStatus': open ? 'open' : '',

        'gps.deviceModel': cell(row, 'جهاز GPS').value,
        'gps.deviceStatusAr': S(col(row, 'حالة جهاز GPS')),
        'gps.provider': cell(row, 'شركة ال GPS').value,
        'gps.serialImei': cell(row, 'سريال GPS').value,
        'gps.statusCode': gpsX.code,

        'operatingCard.cardNumber': cell(row, 'بطاقة التشغيل').value,
        'operatingCard.statusCode': opX.code,

        'vehicleLicense.expiryDateHijri': hijri('تاريخ انتهاء رخصة السير ميلادي', 'تاريخ انتهاء رخصة السير هجري'),
        'vehicleLicense.statusCode': licX.code,

        'inspection.expiryDateHijri': hijri('تاريخ انتهاء الفحص ميلادي', 'تاريخ انتهاء الفحص هجري'),
        'inspection.statusCode': insX.code,

        notesAr: cell(row, 'الملاحظات').value,
        missingItems,
        isActive: true,
        sourceFile: path.basename(FILE),
      },
    });
  });

  console.log(`صفحة Vehicles: ${parsed.length} مركبة مقروءة`
    + `${skipped.length ? ` · ${skipped.length} صفًّا لم يُقرأ` : ''}`);

  // 2. Insurance policies: one policy is a single entity shared by hundreds of vehicles.
  // There is no policies sheet, so each policy is derived from its vehicles (number, company, type, expiry, covered count). If vehicles disagree on a date, the most common one wins and the conflict is reported as an entry error.
  const byPolicy = new Map();
  for (const v of parsed) {
    const num = v.fields['insurance.policyNumber'];
    if (!num) continue;
    if (!byPolicy.has(num)) byPolicy.set(num, { num, vehicles: [], expiries: new Map(), companies: new Map(), types: new Map(), premium: 0 });
    const p = byPolicy.get(num);
    p.vehicles.push(v.plate);
    const e = v.dates['insurance.expiryDate'].d;
    if (e) p.expiries.set(+e, (p.expiries.get(+e) || 0) + 1);
    const c = v.fields['insurance.companyAr']; if (c) p.companies.set(c, (p.companies.get(c) || 0) + 1);
    const t = v.fields['insurance.coverageTypeAr']; if (t) p.types.set(t, (p.types.get(t) || 0) + 1);
    p.premium += Number(v.fields['insurance.premiumSar']) || 0;
  }
  const top = (m) => (m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null);
  const policyByNumber = new Map();
  for (const p of byPolicy.values()) {
    if (p.expiries.size > 1) {
      notes.push(`وثيقة ${p.num}: ${p.expiries.size} تواريخ انتهاء مختلفة على ${p.vehicles.length} مركبة — أُخذ الأكثر شيوعًا`);
    }
    const doc = {
      policyNumber: p.num,
      companyAr: top(p.companies) || '',
      coverageTypeAr: top(p.types) || '',
      expiryDate: top(p.expiries) ? new Date(top(p.expiries)) : null,
      totalPremiumSar: Math.round(p.premium) || null,
      vehicleCount: p.vehicles.length,
      isActive: true,
    };
    const found = await VehicleInsurancePolicy.findOne({ policyNumber: p.num });
    if (DRY) {
      // In dry-run the map is built with fake ids, otherwise every vehicle looks policy-less and the link report is wrong.
      policyByNumber.set(p.num, found ? found._id : 'dry');
      found ? sum.policiesUpdated++ : sum.policiesCreated++;
      continue;
    }
    if (found) {
      // A date renewed by staff after the file snapshot is not overwritten; a policy renewal touches hundreds of vehicles at once.
      const renewal = (found.renewals || [])
        .filter((r) => r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const { expiryDate, ...rest } = doc;
      found.set(rest);
      if (renewal) {
        kept.push(`وثيقة ${p.num}: الملف ${iso(expiryDate)} · جدَّدها ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
      } else if (expiryDate) found.expiryDate = expiryDate;
      await found.save();
      sum.policiesUpdated++;
      policyByNumber.set(p.num, found._id);
    } else {
      const made = await VehicleInsurancePolicy.create(doc);
      sum.policiesCreated++;
      policyByNumber.set(p.num, made._id);
    }
  }

  // 3. Vehicles
  const liveIds = [];
  for (const v of parsed) {
    // Match by plate key first (the department key). Chassis is a fallback for a replaced plate: update the existing vehicle's plate instead of creating a second one, and report the swap.
    let existing = await VehicleMaster.findOne({ plateKey: v.key });
    if (!existing && v.chassis) {
      existing = await VehicleMaster.findOne({ chassisNumber: v.chassis });
      if (existing) notes.push(`${v.plate}: نفس الهيكل ${v.chassis} مسجَّل باللوحة «${existing.plateNumber}» — حُدِّثت اللوحة`);
    }

    const polNum = v.fields['insurance.policyNumber'];
    if (polNum && policyByNumber.has(polNum)) { v.fields.insurancePolicy = policyByNumber.get(polNum); sum.linkedToPolicy++; }

    if (!existing) {
      if (!DRY) {
        const made = new VehicleMaster({ ...v.fields, lastImportAt: new Date() });
        for (const [p, { d }] of Object.entries(v.dates)) if (d) made.set(p, d);
        await made.save();
        liveIds.push(String(made._id));
      }
      sum.vehiclesCreated++;
      continue;
    }
    liveIds.push(String(existing._id));

    // Touched by a person since the last import: then an empty sheet cell must not erase a value.
    const touched = existing.lastImportAt
      ? new Date(existing.updatedAt) > new Date(existing.lastImportAt)
      : false;

    const before = JSON.stringify(existing.toObject());
    for (const [p, val] of Object.entries(v.fields)) {
      if (touched && !filled(val) && filled(get(existing.toObject(), p))) {
        kept.push(`${v.plate} · ${p}: الشيت فارغ · وعندنا «${get(existing.toObject(), p)}»`);
        sum.keptUserFields++;
        continue;
      }
      existing.set(p, val);
    }
    for (const [p, { d, doc }] of Object.entries(v.dates)) {
      const renewal = doc ? (existing.renewals || [])
        .filter((r) => r.document === doc && r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0] : null;
      if (renewal) {
        kept.push(`${v.plate} · ${doc}: الملف ${iso(d)} · جدَّده ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
        continue;
      }
      if (touched && !d && get(existing.toObject(), p)) {
        kept.push(`${v.plate} · ${p}: الشيت بلا تاريخ · وعندنا ${iso(get(existing.toObject(), p))}`);
        sum.keptUserFields++;
        continue;
      }
      existing.set(p, d);
    }
    const changed = JSON.stringify(existing.toObject()) !== before;
    if (changed) sum.vehiclesUpdated++; else sum.vehiclesUnchanged++;
    if (!DRY && changed) { existing.lastImportAt = new Date(); await existing.save(); }
  }

  // 4. General documents: company-level, not per vehicle
  const gHead = (GEN[0] || []).map((h) => S(h));
  const gi = (name) => gHead.indexOf(name);
  const G = {
    doc: gi('الوثيقة'), owner: gi('المالك'), num: gi('رقم الوثيقة'), exp: gi('تاريخ الانتهاء'),
    party: gi('الطرف الاخر'), status: gi('الحالة'), value: gi('القيمة'),
  };
  const genScopes = [];
  for (let i = 1; i < GEN.length; i++) {
    const row = GEN[i];
    if (!row || !row.some((c) => c !== null && c !== '')) continue;
    const scope = S(row[G.doc]);
    if (!scope) { skipped.push(`وثائق عامة صف ${i + 1}: بلا اسم وثيقة`); continue; }
    genScopes.push(scope);
    // The value is sometimes a number and sometimes text (monthly rent). Text is not zero; putting it in the amount field would make an active contract cost zero in reports.
    const val = row[G.value];
    const num = N(val);
    const doc = {
      scopeAr: scope,
      policyholderAr: S(row[G.owner]),
      policyNumbers: S(row[G.num]) ? [S(row[G.num])] : [],
      companyAr: S(row[G.party]),
      expiryDate: D(row[G.exp]),
      premiumSar: num,
      statusAr: S(row[G.status]),
      notesAr: num === null ? S(val) : '',
      isActive: true,
    };
    const found = await CorporatePolicy.findOne({ scopeAr: scope });
    if (DRY) { found ? sum.corporateUpdated++ : sum.corporateCreated++; continue; }
    if (found) {
      const renewal = (found.renewals || [])
        .filter((r) => r.at && new Date(r.at) > SNAPSHOT)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const { expiryDate, ...rest } = doc;
      found.set(rest);
      if (renewal) {
        kept.push(`وثيقة عامة «${scope}»: الملف ${iso(expiryDate)} · جدَّدها ${renewal.byName || 'موظف'} إلى ${iso(renewal.newExpiry)}`);
        sum.keptUserRenewals++;
      } else found.expiryDate = expiryDate;
      await found.save();
      sum.corporateUpdated++;
    } else { await CorporatePolicy.create(doc); sum.corporateCreated++; }
  }

  // 5. Accidents and claims
  const aHead = (ACC[0] || []).map((h) => S(h));
  const ai = (name) => aHead.indexOf(name);
  const A = {
    plate: ai('رقم السيارة'), type: ai('النوع'), owner: ai('سجل المالك'),
    party: ai('اسم طرف الحادث'), partyId: ai('رقم الهوية'), fault: ai('نسبة الخطأ'),
    date: ai('تاريخ الحادث'), via: ai('مباشرة الحادث'), num: ai('رقم الحادث'),
    report: ai('رقم التقرير / التقدير'), insurer: ai('الشركة المطالبة'), claimNum: ai('رقم المطالبة'),
    notes: ai('ملاحظات المطالبة'), lastNote: ai('تاريخ اخر ملاحظة'), lastInsurer: ai('تاريخ اخر موقف مع شركة التامين'),
    estimate: ai('قيمة التقدير'), expected: ai('المتوقع تحصيلة'), status: ai('الحالة'),
  };
  // A dash on this sheet means nothing, not text. Copying it would name the insurer a dash in several records and add a dash option to the insurer filter.
  const dash = (v) => { const t = S(v); return (!t || t === '-' || t === '—') ? '' : t; };
  const dashN = (v) => { const t = S(v); if (!t || t === '-' || t === '—') return null; if (/^zero$/i.test(t)) return 0; return N(v); };
  const plateByKey = new Map(parsed.map((v) => [v.key, v]));
  const seenClaims = [];

  for (let i = 1; i < ACC.length; i++) {
    const row = ACC[i];
    if (!row || !row.some((c) => c !== null && c !== '')) continue;
    const sheetRow = i + 1;
    const subject = S(row[A.plate]);
    if (!subject) { skipped.push(`Accidents صف ${sheetRow}: بلا رقم سيارة ولا موضوع`); continue; }
    const key = plateKey(subject);
    const veh = key ? plateByKey.get(key) : null;
    const accDate = D(row[A.date]);
    const accNum = dash(row[A.num]);
    if (!accDate && !accNum) { skipped.push(`Accidents صف ${sheetRow} («${subject}»): بلا تاريخ ولا رقم حادث — لا مفتاح ثابت له`); continue; }

    // Stable accident key derived from the accident itself. The file has no id, and a row-number key would change on any middle insertion and duplicate all accidents. The accident number (or plate plus date) is order-independent.
    const claimId = accNum ? `FV26-${accNum.replace(/\s+/g, '')}` : `FV26-${key || 'X'}-${iso(accDate)}`;
    const est = dashN(row[A.estimate]);
    const rec = dashN(row[A.expected]);
    const fault = dashN(row[A.fault]);
    const statusRaw = S(row[A.status]);
    const doc = {
      claimId,
      sourceRow: sheetRow,
      // An incident not tied to a vehicle (goods damage is a cargo claim). Without this split it inflates the fleet accident counter and the per-vehicle accident rate.
      isVehicleIncident: !!veh,
      incidentSubjectAr: subject,
      vehiclePlate: veh ? veh.plate : '',
      vehiclePlateKey: veh ? veh.key : '',
      vehicleTypeAr: dash(row[A.type]),
      ownerRegistrationAr: dash(row[A.owner]),
      counterpartyNameAr: dash(row[A.party]).replace(/[\r\n]+/g, ' '),
      counterpartyNationalId: dash(row[A.partyId]),
      // The file writes a fraction (0, 0.5, 1); screens read a percentage.
      faultRatio: fault,
      faultPercent: fault === null ? null : Math.round(fault <= 1 ? fault * 100 : fault),
      accidentDate: accDate,
      reportedViaAr: dash(row[A.via]),
      reportedViaCode: /najm/i.test(S(row[A.via])) ? 'najm' : '',
      accidentNumber: accNum,
      reportOrEstimateNumber: dash(row[A.report]),
      claim: {
        insurerAr: dash(row[A.insurer]),
        claimNumber: dash(row[A.claimNum]),
        notesAr: dash(row[A.notes]).replace(/[\r\n]+/g, ' '),
        lastNoteDate: D(row[A.lastNote]),
        lastInsurerUpdateDate: D(row[A.lastInsurer]),
        estimatedAmountSar: est,
        expectedRecoverySar: rec,
        // Gap between estimated and expected recovery is the expected net loss.
        recoveryGapSar: est !== null && rec !== null ? Math.round(est - rec) : null,
      },
      statusAr: statusRaw,
      statusCode: /wait|انتظار|قيد/i.test(statusRaw) ? 'pending' : /قفل|مغلق|closed/i.test(statusRaw) ? 'closed' : '',
      isActive: true,
    };
    if (!veh && key) notes.push(`حادث ${claimId}: «${subject}» لا تطابق أيّ مركبة في الملف`);

    // Match existing records by natural key, not only our id: an earlier import stored it under another id (ACC-001) and would otherwise duplicate the accident.
    // Prefer live over retired records: the search would hit a retired record first and revive it, leaving the live one unmatched, abandoned, and deleted by --replace.
    const live = { isActive: { $ne: false } };
    const pick = async (q) => (await VehicleClaim.findOne({ ...q, ...live }))
      || (await VehicleClaim.findOne(q));
    let found = await pick({ claimId });
    if (!found && accNum) found = await pick({ accidentNumber: accNum });
    // Use veh, not key: the plate cell can hold a non-plate value (goods damage), whose derived text key matches a retired record with the same key. Plate matching is valid only for a known vehicle's plate.
    if (!found && veh && accDate) found = await pick({ vehiclePlateKey: key, accidentDate: accDate });
    // Claim not about a vehicle: the plate cell holds the goods-damage text, giving a text key while the stored record has an empty key, so they never meet. Match by date and amount, otherwise the existing record is treated as abandoned and a duplicate is created.
    if (!found && !veh && accDate) {
      // No key condition: the same accident has a retired copy with the text key and a live copy with no key. Requiring either form would exclude the live copy and hit the retired one. Date and amount suffice, and pick prefers the live copy.
      found = await pick({
        accidentDate: accDate,
        'claim.estimatedAmountSar': doc.claim?.estimatedAmountSar,
      });
    }
    seenClaims.push(found ? String(found._id) : claimId);
    if (DRY) { found ? sum.claimsUpdated++ : sum.claimsCreated++; continue; }
    if (found) {
      // Keep the old accident id; changing it breaks any external link to it.
      const { claimId: _drop, ...rest } = doc;
      found.set(rest);
      await found.save();
      sum.claimsUpdated++;
    } else { await VehicleClaim.create(doc); sum.claimsCreated++; }
  }

  // Vehicle accident counter is computed from its effective claims, not stored by hand.
  if (!DRY) {
    await VehicleMaster.updateMany({}, { $set: { accidentCount: 0 } });
    const keys = [...new Set((await VehicleClaim.find({ isActive: true }).select('vehiclePlateKey').lean())
      .map((c) => c.vehiclePlateKey).filter(Boolean))];
    for (const k of keys) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: k, isActive: true });
      await VehicleMaster.updateMany({ plateKey: k }, { $set: { accidentCount: n } });
    }
  }

  // 6. In the system but not in the file
  const sheetKeys = new Set(parsed.map((v) => v.key));
  const staleVehicles = (await VehicleMaster.find({ isActive: { $ne: false } })
    .select('plateNumber plateKey chassisNumber renewals accidentCount').lean())
    .filter((v) => !sheetKeys.has(v.plateKey));
  sum.staleVehicles = staleVehicles.length;

  const sheetPolicies = new Set(byPolicy.keys());
  const stalePolicies = (await VehicleInsurancePolicy.find({ isActive: { $ne: false } }).select('policyNumber').lean())
    .filter((p) => !sheetPolicies.has(p.policyNumber));
  sum.stalePolicies = stalePolicies.length;

  const genSet = new Set(genScopes);
  const staleCorporate = (await CorporatePolicy.find({ isActive: { $ne: false } }).select('scopeAr').lean())
    .filter((c) => !genSet.has(c.scopeAr));
  sum.staleCorporate = staleCorporate.length;

  const seenClaimSet = new Set(seenClaims);
  const staleClaims = (await VehicleClaim.find({ isActive: { $ne: false } }).select('claimId incidentSubjectAr').lean())
    .filter((c) => !seenClaimSet.has(String(c._id)) && !seenClaimSet.has(c.claimId));
  sum.staleClaims = staleClaims.length;

  if (REPLACE && !DRY) {
    const ids = staleVehicles.map((v) => v._id);
    if (HARD) {
      await VehicleMaster.deleteMany({ _id: { $in: ids } });
      await VehicleInsurancePolicy.deleteMany({ _id: { $in: stalePolicies.map((p) => p._id) } });
      await CorporatePolicy.deleteMany({ _id: { $in: staleCorporate.map((c) => c._id) } });
      await VehicleClaim.deleteMany({ _id: { $in: staleClaims.map((c) => c._id) } });
    } else {
      await VehicleMaster.updateMany({ _id: { $in: ids } }, { $set: { isActive: false } });
      await VehicleInsurancePolicy.updateMany({ _id: { $in: stalePolicies.map((p) => p._id) } }, { $set: { isActive: false } });
      await CorporatePolicy.updateMany({ _id: { $in: staleCorporate.map((c) => c._id) } }, { $set: { isActive: false } });
      await VehicleClaim.updateMany({ _id: { $in: staleClaims.map((c) => c._id) } }, { $set: { isActive: false } });
    }
    sum.removed = ids.length + stalePolicies.length + staleCorporate.length + staleClaims.length;
  }

  // Report
  console.log('\nالنتيجة:', JSON.stringify(sum, null, 1));

  if (skipped.length) {
    console.log(`\nصفوف لم تُقرأ (${skipped.length}) — ولماذا:`);
    skipped.forEach((s) => console.log('   ' + s));
  }
  if (kept.length) {
    console.log(`\nتُرك كما هو — شغل موظف أحدث من الملف (${kept.length}):`);
    kept.slice(0, 25).forEach((k) => console.log('   ' + k));
    if (kept.length > 25) console.log(`   … و${kept.length - 25} غيرها`);
  }
  if (staleVehicles.length) {
    console.log(`\nفي النظام وليست في الملف — ${staleVehicles.length} مركبة`
      + `${REPLACE ? (HARD ? ' · ستُمحى نهائيًّا' : ' · ستُعطَّل') : ' · لن تُمسّ (أضف --replace)'}:`);
    staleVehicles.slice(0, 40).forEach((v) => console.log(`   ${v.plateNumber || '—'} (${v.plateKey})`
      + `${v.renewals?.length ? ` · ${v.renewals.length} تجديدًا في سجلّها` : ''}`
      + `${v.accidentCount ? ` · ${v.accidentCount} حادثًا` : ''}`));
    if (staleVehicles.length > 40) console.log(`   … و${staleVehicles.length - 40} غيرها`);
  }
  if (stalePolicies.length) console.log(`\nوثائق تأمين ليست في الملف (${stalePolicies.length}): ${stalePolicies.map((p) => p.policyNumber).slice(0, 20).join(' · ')}`);
  if (staleCorporate.length) console.log(`\nوثائق عامة ليست في الملف (${staleCorporate.length}): ${staleCorporate.map((c) => c.scopeAr).join(' · ')}`);
  if (staleClaims.length) console.log(`\nحوادث ليست في الملف (${staleClaims.length}): ${staleClaims.map((c) => c.claimId).slice(0, 20).join(' · ')}`);
  if (notes.length) {
    console.log(`\nملاحظات (${notes.length}):`);
    [...new Set(notes)].slice(0, 25).forEach((n) => console.log('   ' + n));
  }

  if (DRY) {
    console.log('\nلم يُكتب شيء. للتنفيذ:');
    console.log('   node src/scripts/importFinalVehicles2026.js --yes');
    if (staleVehicles.length) console.log('   node src/scripts/importFinalVehicles2026.js --yes --replace   (لإخراج ما ليس في الملف)');
  } else {
    console.log(`\nفي النظام الآن: ${await VehicleMaster.countDocuments({ isActive: { $ne: false } })} مركبة`
      + ` · ${await VehicleInsurancePolicy.countDocuments({ isActive: { $ne: false } })} وثيقة تأمين`
      + ` · ${await VehicleClaim.countDocuments({ isActive: true })} حادثًا`
      + ` · ${await CorporatePolicy.countDocuments({ isActive: true })} وثيقة عامة`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
