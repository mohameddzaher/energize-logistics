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
// المصدرُ يتبع الخادمَ الذي نفحصه لا ملفَّ البيئة المحلّيّ: حارسُ CSRF يقبل
// مصادرَ البرودكشن وحدها، فإرسالُ `localhost` إليه يردّ ٤٠٣ على كلّ POST —
// وهو ما يبدو عطبًا في الميزة وهو عطبٌ في الفحص.
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
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

    // ── التجديد الجماعيّ للورقة المشتركة ────────────────────────────────────
    head('تجديد وثيقة كاملة');
    const post = async (p, body, ckk) => {
      const r = await fetch(`${BASE}${p}`, {
        method: 'POST',
        headers: { Cookie: ckk, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let j = null; try { j = await r.json(); } catch (_) {}
      return { status: r.status, j };
    };
    const dt = await get('/api/vehicle-registry/document-types', ck);
    const docs = dt.j?.documents || [];
    const sharedDocs = docs.filter((d) => d.sharedNumber).map((d) => d.key);
    ok('التأمين وحدَه ورقةٌ مشتركة', sharedDocs.length === 1 && sharedDocs[0] === 'insurance', sharedDocs.join(' · ') || '—');

    // الوثيقةُ الأكبر: كم مركبةً تحتها؟
    const byPolicy = new Map();
    for (const v of vs) {
      const n = String(v.insurance?.policyNumber || '').trim();
      if (n) byPolicy.set(n, (byPolicy.get(n) || 0) + 1);
    }
    const biggest = [...byPolicy.entries()].sort((a, b) => b[1] - a[1])[0];
    ok('وثيقةٌ واحدة تغطّي عشراتِ المركبات', !!biggest && biggest[1] > 50, biggest ? `${biggest[0]} → ${biggest[1]} مركبة` : '—');
    ok('العدد يطابق القاعدة',
      !!biggest && await VehicleMaster.countDocuments({ 'insurance.policyNumber': biggest[0] }) === biggest[1]);

    // ولا يُجدَّد جماعةً ما ورقتُه لكلّ مركبة — ولا برقمٍ مجهول ولا بتاريخٍ ماضٍ.
    const nextYear = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
    const r1 = await post('/api/vehicle-registry/renew-shared',
      { document: 'operatingCard', number: 'x', newExpiry: nextYear }, ck);
    ok('بطاقةُ التشغيل تُرفض — ورقتُها لكلّ مركبة', r1.status === 400, `HTTP ${r1.status}`);
    const r2 = await post('/api/vehicle-registry/renew-shared',
      { document: 'insurance', number: 'zz-لا-وجود-له', newExpiry: nextYear }, ck);
    ok('رقمُ وثيقةٍ لا وجودَ له يُرفض', r2.status === 404, `HTTP ${r2.status}`);
    const r3 = await post('/api/vehicle-registry/renew-shared',
      { document: 'insurance', number: biggest?.[0] || 'x', newExpiry: '2020-01-01' }, ck);
    ok('تاريخٌ في الماضي يُرفض', r3.status === 400, `HTTP ${r3.status}`);
    const r4 = await post('/api/vehicle-registry/renew-shared',
      { document: 'insurance', number: biggest?.[0] || 'x' }, ck);
    ok('بلا تاريخٍ يُرفض', r4.status === 400, `HTTP ${r4.status}`);

    head('رسائلُ الخطأ تصل بدل أن تنهار');
    const dupChassis = vs.find((v) => v.chassisNumber)?.chassisNumber;
    const cr = await post('/api/vehicle-registry', { plateNumber: `zz-تجربة-${Date.now()}`, chassisNumber: dupChassis }, ck);
    ok('رقمُ هيكلٍ مكرَّر يردّ برسالةٍ تسمّي المركبة الأخرى',
      cr.status === 400 && /مسجَّلٌ على المركبة/.test(cr.j?.message || ''), cr.j?.message || `HTTP ${cr.status}`);
    const cr2 = await post('/api/vehicle-registry', {}, ck);
    ok('مركبةٌ بلا لوحةٍ تردّ برسالة', cr2.status === 400 && !!cr2.j?.message, cr2.j?.message || `HTTP ${cr2.status}`);
    ok('لم تُنشَأ مركبةُ تجربة', await VehicleMaster.countDocuments({ plateNumber: /^zz-تجربة-/ }) === 0);

    head('دفترُ المحفظة متسلسل');
    const DailyWallet = require('../models/DailyWallet');
    const Branch = require('../models/Branch');
    const riyadh = await Branch.findOne({ name: /^riyadh$/i }).lean();
    const book = await DailyWallet.find({ branch: riyadh._id }).sort({ date: 1 }).lean();
    const r2n = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const sept = book.find((w) => w.date === '2026-09-01');
    ok('افتتاحيُّ الرياض ١ سبتمبر كما طُلب', sept && r2n(sept.openingBalance) === 9580.96, String(sept?.openingBalance));
    const unbalanced = book.filter((w) => r2n(w.openingBalance + (w.totalCollections || 0) - (w.totalExpenses || 0) - (w.totalPurchases || 0)) !== r2n(w.closingBalance));
    ok('كلُّ ختاميٍّ = افتتاحيُّه + حركاتُه', unbalanced.length === 0, unbalanced.map((w) => w.date).join(' · '));
    const after = book.filter((w) => w.date > '2026-09-01');
    const broken = after.filter((w, i) => {
      const prev = book[book.indexOf(w) - 1];
      return prev && r2n(w.openingBalance) !== r2n(prev.closingBalance);
    });
    ok('الأيّامُ بعده تحمل ختاميَّ ما قبلها', broken.length === 0, broken.map((w) => w.date).join(' · '));

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
