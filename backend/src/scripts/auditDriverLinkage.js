/**
 * auditDriverLinkage — بطاقةُ السائق وتفاويضُه وخيانةُ أمانته شيءٌ واحد.
 *
 *   node src/scripts/auditDriverLinkage.js --base https://api.energize-logistics.com
 *
 * ── ما يفحصه ───────────────────────────────────────────────────────────────
 * ثلاثةُ أشياء تخصّ السائقَ نفسَه لا المركبة، وكانت في ثلاث شاشات لا يجمعها
 * اسمُه: بطاقتُه، وما هو مفوَّضٌ عليه، وهل تغطّيه وثيقةُ خيانة الأمانة.
 * يفحص هذا أنّ الثلاثة تُقرأ من الطرفين، وأنّ الأرقام تطابق الشيت والقاعدة.
 *
 * ويفحص معها ما جاء في الدفعة نفسها: الوثيقتين المكرَّرتين، وجهةَ الإبلاغ بعد
 * توحيدها، والبحثَ المتسامح مع المسافات، ورقمَ الهويّة في ماستر الموارد
 * البشريّة.
 *
 * لا يترك أثرًا: الحسابُ الذي يُنشئه يُحذف.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const ORIGIN = process.env.FRONTEND_URL?.split(',')[0].trim() || 'https://energize-logistics.com';
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ فشل'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 62 - s.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const DriverCard = require('../models/DriverCard');
  const { CorporatePolicy, VehicleMaster } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');
  const Employee = require('../models/Employee');

  await User.deleteMany({ email: /^zz-drv/ });
  const u = await User.create({ email: 'zz-drv@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'vehicles_manager' });
  const hr = await User.create({ email: 'zz-drv-hr@example.invalid', password: PW, firstName: 'م', lastName: 'ب', role: 'hr_manager' });

  const login = async (email) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: PW }),
    });
    return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  };
  const get = async (p, ck) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Cookie: ck, Origin: ORIGIN } });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, j };
  };

  try {
    const ck = await login(u.email);
    const hrCk = await login(hr.email);
    ok('دخول مدير المركبات ومدير الموارد البشريّة', !!ck && !!hrCk);

    // ── بطاقات السائقين ─────────────────────────────────────────────────────
    head('بطاقات السائقين — خيانة الأمانة');
    const dc = await get('/api/vehicle-registry/driver-cards', ck);
    ok('الصفحة تُحمَّل', dc.status === 200, `HTTP ${dc.status}`);
    const cards = dc.j?.cards || []; const tot = dc.j?.totals || {};
    const dbCards = await DriverCard.countDocuments({ isActive: { $ne: false } });
    ok('عدد البطاقات يطابق القاعدة', cards.length === dbCards, `${cards.length} / ${dbCards}`);
    ok('لكلّ بطاقةٍ حالةُ خيانة أمانة', cards.every((c) => c.fidelity && 'status' in c.fidelity));
    const cov = cards.filter((c) => c.fidelity?.status === 'covered').length;
    const req = cards.filter((c) => c.fidelity?.status === 'required').length;
    ok('المشمولون يطابقون العدّاد', tot.fidelityCovered === cov, `${tot.fidelityCovered} / ${cov}`);
    ok('المطلوب ضمُّهم يطابقون العدّاد', tot.fidelityRequired === req, `${tot.fidelityRequired} / ${req}`);
    ok('المجموع = مشمول + مطلوب + بلا جواب',
      cov + req + (tot.fidelityUnknown || 0) === cards.length, `${cov}+${req}+${tot.fidelityUnknown} = ${cards.length}`);
    // والشيتُ هو المرجع: ستّون مشمولًا وواحدٌ مطلوب.
    ok('الأرقام كما في شيت «بطاقات سائقين وخيانة الأمانة»', cov === 60 && req === 1, `مشمول ${cov} · مطلوب ${req}`);

    head('بطاقات السائقين — التفاويض');
    const withAuth = cards.filter((c) => (c.authorizations || []).length);
    ok('التفاويض تُقرأ من ناحية السائق', withAuth.length > 0, `${withAuth.length} سائقًا`);
    ok('كلُّ تفويضٍ يحمل لوحةً ومصدرًا',
      withAuth.every((c) => c.authorizations.every((a) => a.plateNumber && ['registry', 'assignment'].includes(a.source))));
    // ورقةُ السجلّ تفوز على سجلّ الإسناد ولا يُعرَضان معًا لسائقٍ واحد.
    const mixed = withAuth.filter((c) => new Set(c.authorizations.map((a) => a.source)).size > 1);
    ok('لا يُخلَط المصدران على سائقٍ واحد', mixed.length === 0, `${mixed.length}`);
    const flagged = cards.filter((c) => (c.staleAssignments || []).length);
    ok('الخلافُ مع السجلّ الأقدم معروضٌ لا مبتلَع', flagged.length > 0, `${flagged.length} صفًّا مُعلَّمًا`);

    // كلُّ تفويضٍ من السجلّ يوافق ما في قاعدة البيانات لصاحب رقم الإقامة نفسِه.
    let mismatched = 0;
    for (const c of cards.filter((x) => x.authorizations?.some((a) => a.source === 'registry'))) {
      const inDb = await VehicleMaster.countDocuments({ 'authorizedPerson.iqamaNumber': String(c.idNumber).trim() });
      const fromApi = c.authorizations.filter((a) => a.source === 'registry').length;
      if (inDb !== fromApi) mismatched += 1;
    }
    ok('عددُ تفاويض كلّ سائقٍ يطابق القاعدة', mismatched === 0, `${mismatched} مختلفًا`);

    head('التفاويض — بطاقةُ السائق تُقرأ من الطرف الآخر');
    const vl = await get('/api/vehicle-registry?limit=2000', ck);
    ok('سجلّ المركبات يُحمَّل', vl.status === 200, `HTTP ${vl.status}`);
    const vs = vl.j?.vehicles || [];
    const authed = vs.filter((v) => v.authorizedPerson?.iqamaNumber);
    const carded = authed.filter((v) => v.driverCard);
    ok('المفوَّضون الذين لهم بطاقةٌ ظاهرون', carded.length > 0, `${carded.length} من ${authed.length}`);
    ok('بطاقةُ الصفّ هي بطاقةُ صاحب رقم الإقامة نفسِه', await (async () => {
      for (const v of carded.slice(0, 25)) {
        const card = await DriverCard.findOne({ idNumber: String(v.authorizedPerson.iqamaNumber).trim() }).lean();
        if (!card || String(card._id) !== v.driverCard._id) return false;
      }
      return true;
    })());
    const uncovered = carded.filter((v) => v.driverCard.fidelityStatus !== 'covered');
    console.log(`      · مركباتٌ مفوَّضةٌ لسائقٍ غيرِ مشمولٍ بخيانة الأمانة: ${uncovered.length}`
      + (uncovered.length ? ` (${uncovered.map((v) => v.plateNumber).join(' · ')})` : ''));
    const expiringSoon = carded.filter((v) => ['expired', 'critical'].includes(v.driverCard.state));
    console.log(`      · مركباتٌ مفوَّضةٌ لسائقٍ بطاقتُه منتهيةٌ أو تنتهي خلال شهر: ${expiringSoon.length}`);

    // ── وثائق الشركة ────────────────────────────────────────────────────────
    head('وثائق تأمين الشركة — بلا مكرَّر');
    const cp = await get('/api/vehicle-registry/corporate-policies', ck);
    const pol = cp.j?.policies || [];
    ok('الصفحة تُحمَّل', cp.status === 200, `HTTP ${cp.status}`);
    ok('«تأمين البضائع + ملحق السيارات» لم تعد تظهر', !pol.some((p) => /ملحق السيارات/.test(p.scopeAr || '')));
    ok('«خيانة الأمانة ل 58 سائق» لم تعد تظهر', !pol.some((p) => /58/.test(p.scopeAr || '')));
    ok('وثيقةُ خيانة الأمانة الباقيةُ واحدة', pol.filter((p) => /خيانة/.test(p.scopeAr || '')).length === 1);
    ok('وثيقةُ تأمين البضائع الباقيةُ واحدة', pol.filter((p) => /البضائع/.test(p.scopeAr || '')).length === 1);
    ok('عددُ الوثائق النشطة يطابق القاعدة',
      pol.length === await CorporatePolicy.countDocuments({ isActive: true }), `${pol.length}`);

    // ── الحوادث ─────────────────────────────────────────────────────────────
    head('الحوادث — جهةُ الإبلاغ والملاحظات');
    const cl = await get('/api/vehicle-registry/claims', ck);
    const claims = cl.j?.claims || [];
    ok('الصفحة تُحمَّل', cl.status === 200, `HTTP ${cl.status}`);
    const vias = [...new Set(claims.map((c) => (c.reportedViaAr || '').trim()).filter(Boolean))];
    ok('جهةُ الإبلاغ من القائمة وحدها', vias.every((v) => ['نجم', 'المرور'].includes(v)), vias.join(' · ') || '—');
    ok('لم يبقَ «Najm» بحروفٍ لاتينيّة', await VehicleClaim.countDocuments({ reportedViaAr: /najm/i }) === 0);
    ok('الملاحظاتُ تصل مع الصفّ', claims.filter((c) => c.claim?.notesAr).length > 0,
      `${claims.filter((c) => c.claim?.notesAr).length} من ${claims.length}`);
    const lk = await get('/api/lookups?type=vehicle_reported_via&active=true', ck);
    const items = (lk.j?.items || []).map((i) => i.nameAr);
    ok('القائمة موجودةٌ في إعدادات القسم', items.includes('نجم') && items.includes('المرور'), items.join(' · '));
    const jt = await get('/api/lookups?type=vehicle_job_title&active=true', ck);
    const titles = (jt.j?.items || []).map((i) => i.nameAr);
    ok('مسمّى قائد المركبة قائمةٌ تُدار', titles.includes('سائق نقل ثقيل') && titles.includes('مندوب توصيل') && titles.includes('موظف'),
      titles.join(' · '));

    // ── البحث المتسامح ──────────────────────────────────────────────────────
    head('البحث باللوحة لا يبالي بالمسافات');
    const sample = vs.find((v) => /\s/.test(String(v.plateNumber || '')));
    if (!sample) ok('وُجدت لوحةٌ بمسافة', false);
    else {
      const plate = String(sample.plateNumber);
      const forms = [plate, plate.replace(/\s+/g, '  '), plate.replace(/\s+/g, ''), plate.replace(/ا/g, 'أ')];
      for (const f of forms) {
        const r = await get(`/api/vehicle-registry?limit=50&q=${encodeURIComponent(f)}`, ck);
        const found = (r.j?.vehicles || []).some((v) => v._id === sample._id);
        ok(`«${f}» تجد «${plate}»`, found);
      }
    }

    // ── الموارد البشريّة ────────────────────────────────────────────────────
    head('ماستر الموارد البشريّة — رقم الهويّة');
    const idg = await get('/api/hr/master/records/identity?limit=1000', hrCk);
    ok('صفحة الهويّة تُحمَّل', idg.status === 200, `HTTP ${idg.status}`);
    const rows = idg.j?.rows || [];
    const missing = rows.filter((r) => r.statuses?.iqamaNumber !== 'filled');
    ok('لا صفَّ يقول «لا يوجد» عن رقمٍ مكتوب', missing.length === 0,
      missing.slice(0, 5).map((r) => `${r.employeeNumber} ${r.name}`).join(' · '));
    const saudis = await Employee.find({ idType: 'national_id', nationalId: { $nin: ['', null] }, isHrRecord: { $ne: false } })
      .select('employeeNumber nationalId iqamaNumber').lean();
    const shown = new Map(rows.map((r) => [String(r.employeeNumber), r.values?.iqamaNumber]));
    const wrong = saudis.filter((e) => shown.has(String(e.employeeNumber)) && shown.get(String(e.employeeNumber)) !== e.nationalId);
    ok('رقمُ السعوديّ المعروض هو رقمُ هويّته', wrong.length === 0,
      wrong.slice(0, 4).map((e) => e.employeeNumber).join(' · '));
    ok('العمودان متطابقان بعد الإصلاح', saudis.every((e) => String(e.iqamaNumber || '') === String(e.nationalId)),
      `${saudis.filter((e) => String(e.iqamaNumber || '') !== String(e.nationalId)).length} مختلفًا`);
    const one = saudis[0];
    if (one) {
      const sr = await get(`/api/hr/master/records/identity?limit=50&q=${encodeURIComponent(one.nationalId)}`, hrCk);
      ok('البحثُ برقم الهويّة الوطنيّة يجد صاحبَه',
        (sr.j?.rows || []).some((r) => String(r.employeeNumber) === String(one.employeeNumber)));
    }
  } finally {
    await User.deleteMany({ email: /^zz-drv/ });
    console.log(`\n${'═'.repeat(66)}`);
    console.log(`  ناجح ${pass} · فاشل ${fail}`);
    console.log('═'.repeat(66) + '\n');
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
