/**
 * auditVehiclesBatch — شريحةُ بترو اب وإخلاءُ الطرف، على البرودكشن.
 *
 *   node src/scripts/auditVehiclesBatch.js --base https://api.energize-logistics.com
 *
 * ── ما يُثبَت ─────────────────────────────────────────────────────────────
 * أنّ المركبات التي لا شريحةَ لها تُوجَد فعلًا (وهي التي كانت تختفي من قائمة
 * الإضافة)، وأنّ نزعَ الشريحة يُقيَّد ولا يُفرِّغ خانةً صامتًا، وأنّ حاملَ الشريحة
 * لا تُنهى خدمتُه حتى تُنزَع — ولو كانت المركبةُ ملكه.
 *
 * ولا يُترَك أثر: الشريحةُ تُنزَع من مركبةٍ حقيقيّةٍ ثمّ تُعاد بنفس رقمها وحالتها
 * عبر الواجهة نفسِها، وسجلُّ الفعلين يبقى — وهو الصواب: نزعٌ جرى فعلًا وإعادةٌ
 * جرت فعلًا.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const { VehicleMaster } = require('../models/VehicleMaster');
  await User.deleteMany({ email: /^zz-veh/ });
  const u = await User.create({ email: 'zz-veh@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await User.deleteMany({ email: /^zz-veh/ }); process.exit(1); }

  const api = async (path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: ck, Origin: ORIGIN, ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };

  let restore = null;
  try {
    head('المركباتُ بلا شريحة');
    const total = await VehicleMaster.countDocuments();
    const noCard = await VehicleMaster.countDocuments({ $or: [{ 'fuelCard.cardNumber': '' }, { 'fuelCard.cardNumber': null }, { 'fuelCard.cardNumber': { $exists: false } }] });
    // ── وهذه هي التي كانت تختفي ────────────────────────────────────────────
    // مكتوبٌ عندها حالةُ شريحةٍ ولا شريحةَ لها، فكانت تُحسَب «عليها شريحة».
    const statusNoCard = await VehicleMaster.countDocuments({
      'fuelCard.statusAr': { $nin: ['', null] },
      $or: [{ 'fuelCard.cardNumber': '' }, { 'fuelCard.cardNumber': null }, { 'fuelCard.cardNumber': { $exists: false } }],
    });
    ok('السجلُّ يقرأ', total > 0, `${total} مركبة`);
    ok('ثمّة مركباتٌ بلا شريحة', noCard > 0, `${noCard} مركبة`);
    console.log(`  · منها ${statusNoCard} كانت تختفي من قائمة الإضافة (حالةُ شريحةٍ بلا رقم)`);

    head('نزعُ الشريحة يُقيَّد');
    const victim = await VehicleMaster.findOne({ 'fuelCard.cardNumber': { $nin: ['', null] } })
      .select('plateNumber fuelCard authorizedPerson').lean();
    ok('وُجدت مركبةٌ عليها شريحة', !!victim, victim?.plateNumber || '—');
    if (!victim) throw new Error('لا مركبةَ عليها شريحة');
    restore = {
      id: victim._id,
      cardNumber: victim.fuelCard.cardNumber,
      statusAr: victim.fuelCard.statusAr || '',
      plateOnInvoiceAr: victim.fuelCard.plateOnInvoiceAr || '',
      consumptionTypeAr: victim.fuelCard.consumptionTypeAr || '',
      limitSar: victim.fuelCard.limitSar ?? null,
      limitStatus: victim.fuelCard.limitStatus || '',
    };
    console.log(`  · مركبةُ الفحص: ${victim.plateNumber} — شريحة ${restore.cardNumber}`);

    const rm = await api(`/api/vehicle-registry/${victim._id}/fuel-card`, {
      method: 'POST', body: JSON.stringify({ action: 'remove', note: 'فحصٌ آليّ' }),
    });
    ok('النزعُ يُقبَل', rm.status === 200, rm.body?.message || String(rm.status));

    const after = await VehicleMaster.findById(victim._id).select('fuelCard').lean();
    ok('الرقمُ فُرِّغ', !String(after.fuelCard.cardNumber || '').trim());
    ok('والحالةُ فُرِّغت معه', !String(after.fuelCard.statusAr || '').trim());
    const last = (after.fuelCard.history || []).slice(-1)[0];
    ok('والفعلُ قُيِّد', last?.action === 'removed' && last?.cardNumber === restore.cardNumber,
      last ? `${last.action} · ${last.cardNumber} · ${last.byName}` : 'لا قيد');

    const again = await api(`/api/vehicle-registry/${victim._id}/fuel-card`, {
      method: 'POST', body: JSON.stringify({ action: 'remove' }),
    });
    ok('ولا تُنزَع مرّتين', again.status === 409, again.body?.message || String(again.status));

    head('إخلاءُ الطرف');
    // موظّفٌ يحمل شريحةً فعلًا — يُبحَث عنه بالإقامة المكتوبة على المركبة.
    const Employee = require('../models/Employee');
    const holderVehicle = await VehicleMaster.findOne({
      'fuelCard.cardNumber': { $nin: ['', null] },
      'authorizedPerson.iqamaNumber': { $nin: ['', null] },
    }).select('plateNumber fuelCard.cardNumber authorizedPerson').lean();
    if (holderVehicle) {
      const iq = holderVehicle.authorizedPerson.iqamaNumber;
      const emp = await Employee.findOne({ $or: [{ iqamaNumber: iq }, { nationalId: iq }] }).select('_id firstName lastName').lean();
      if (emp) {
        const cl = await api(`/api/hr/employees/${emp._id}/clearance`);
        const kinds = (cl.body?.blockers || []).map((b) => b.kind);
        ok('حاملُ الشريحة لا يُخلى طرفُه', cl.body?.clear === false && kinds.includes('fuel_card'),
          `${`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} · ${kinds.join(', ') || 'بلا موانع'}`);
      } else {
        console.log(`  · لا موظّفَ بإقامة ${iq} — تُخطّى هذه الحالة`);
      }
    }

    head('ملفُّ الموظّف');
    const anyAuth = await VehicleMaster.findOne({ 'authorizedPerson.iqamaNumber': { $nin: ['', null] } })
      .select('authorizedPerson.iqamaNumber').lean();
    const emp2 = anyAuth ? await Employee.findOne({
      $or: [{ iqamaNumber: anyAuth.authorizedPerson.iqamaNumber }, { nationalId: anyAuth.authorizedPerson.iqamaNumber }],
    }).select('_id').lean() : null;
    if (emp2) {
      const h = await api(`/api/vehicles/by-employee/${emp2._id}`);
      ok('يعرض ما هو مقيَّدٌ عليه في السجلّ', h.status === 200 && Array.isArray(h.body?.registry) && h.body.registry.length > 0,
        `${h.body?.registry?.length ?? 0} مركبة`);
    }
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    if (restore) {
      head('الإعادة');
      const r = await api(`/api/vehicle-registry/${restore.id}/fuel-card`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'assign', cardNumber: restore.cardNumber, statusAr: restore.statusAr,
          plateOnInvoiceAr: restore.plateOnInvoiceAr, consumptionTypeAr: restore.consumptionTypeAr,
          limitSar: restore.limitSar, note: 'إعادةُ ما نزعه الفحص',
        }),
      });
      // سقفُ الصرف يُعاد كما كان: `assign` لا تمسّه إن لم يُرسَل.
      if (restore.limitStatus) {
        await VehicleMaster.updateOne({ _id: restore.id }, { $set: { 'fuelCard.limitStatus': restore.limitStatus } });
      }
      const back = await VehicleMaster.findById(restore.id).select('fuelCard').lean();
      ok('أُعيدت الشريحةُ كما كانت', r.status === 200 && back.fuelCard.cardNumber === restore.cardNumber,
        `${back.fuelCard.cardNumber} · ${back.fuelCard.statusAr || 'بلا حالة'}`);
    }
    await User.deleteMany({ email: /^zz-veh/ });
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
