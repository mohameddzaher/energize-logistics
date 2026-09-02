/**
 * auditCollectionsLedger — دفترُ التحصيل، مقيسًا على الورقة التي جاء منها.
 *
 *   node src/scripts/auditCollectionsLedger.js
 *
 * لا يكتفي بأن تردّ النقاطُ ٢٠٠: يقرأ الورقةَ نفسَها ويقارن بها ما يخرج من
 * الخادم — عددَ الحسابات، ومجموعَ الحدود، وشرائحَ الأعمار، ومجموعَ الفواتير.
 * وما لا يُقاس على مصدره ليس مفحوصًا.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const ORIGIN = process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000';
const PW = 'Passenergize1!';
const FILE = path.join(__dirname, '../../..', 'collection files', 'Financial Collections    9-2026.xlsx');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 62 - s.length))}`);
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionTask = require('../models/CollectionTask');
  const CreditAlertAck = require('../models/CreditAlertAck');

  await User.deleteMany({ email: /^zz-ledger/ });
  const mgr = await User.create({ email: 'zz-ledger-mgr@example.invalid', password: PW, firstName: 'م', lastName: 'ت', role: 'collections_manager' });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: mgr.email, password: PW }),
  });
  const ck = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  ok('دخولُ مدير التحصيل', login.status === 200, `${login.status}`);
  if (login.status !== 200) { await User.deleteMany({ email: /^zz-ledger/ }); process.exit(1); }
  const call = async (m, p, b) => {
    const r = await fetch(`${BASE}${p}`, { method: m, headers: { Cookie: ck, Origin: ORIGIN, ...(b ? { 'Content-Type': 'application/json' } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, j };
  };

  // ── الورقةُ نفسُها ────────────────────────────────────────────────────────
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const all = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true });
  const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const S = (v) => (v == null ? '' : String(v).trim());
  const A = all('Aging'); const SH = all('Aging Shipment'); const DI = all('Daily Invoice Report');

  const madeTasks = [];
  try {
    head('سجلُّ الأعمار مقيسًا على ورقة Aging');
    const sheetTax = A.slice(5).filter((r) => S(r[0]) && S(r[1])).length;
    const sheetCash = SH.slice(5).filter((r) => S(r[0]) && S(r[1])).length;
    const sheetLimits = A.slice(5).reduce((s, r) => s + N(r[7]), 0);

    const ag = await call('GET', '/api/collections-dept/ledger/aging?limit=500');
    ok('تفتح الصفحة', ag.status === 200, `${ag.status}`);
    ok('عددُ الحسابات لا يقلّ عمّا في الورقة', (ag.j?.total || 0) >= sheetTax + sheetCash,
      `${ag.j?.total} — الورقة ${sheetTax + sheetCash}`);
    ok('مجموعُ الحدود الائتمانيّة يطابق الورقة', near(ag.j?.totals?.creditLimit, sheetLimits, 0.5),
      `${ag.j?.totals?.creditLimit} — الورقة ${sheetLimits}`);

    // ── الشرائحُ تجمع الإجماليَّ ────────────────────────────────────────
    // شرطٌ لا يجوز كسرُه: كلُّ ريالٍ في شريحةٍ واحدةٍ لا أكثرَ ولا أقلّ. كسرَه
    // إشعارُ خصمٍ بثلاثين ألفًا بلا تاريخ — دخل الإجماليَّ ولم يدخل شريحة،
    // فصار في السجلّ مالٌ لا يظهر في أيّ عمود.
    const bandSum = Object.values(ag.j?.totals?.bands || {}).reduce((a, b) => a + b, 0);
    ok('الشرائحُ تجمع الإجماليَّ (لا تداخلَ ولا ثغرة)', near(bandSum, ag.j?.totals?.outstanding, 1),
      `${bandSum.toFixed(2)} — الإجمالي ${Number(ag.j?.totals?.outstanding).toFixed(2)}`);

    head('الأعمار: الفلاترُ تعمل');
    const one = await call('GET', '/api/collections-dept/ledger/aging?officer=Hossam&limit=500');
    const dbHossam = await CollectionsParty.countDocuments({ kind: 'customer', code: { $gt: '' }, collectionOfficer: 'Hossam' });
    ok('فلترُ الموظّف المسؤول', one.j?.total === dbHossam, `${one.j?.total} — القاعدة ${dbHossam}`);
    const g = await call('GET', '/api/collections-dept/ledger/aging?grade=A1&limit=500');
    ok('فلترُ التقييم', (g.j?.rows || []).every((r) => r.grade === 'A1'), `${g.j?.total} حسابًا`);
    const d = await call('GET', '/api/collections-dept/ledger/aging?department=Fleet&limit=500');
    ok('فلترُ القسم', (d.j?.rows || []).every((r) => r.department === 'Fleet'), `${d.j?.total} حسابًا`);
    const cd = await call('GET', '/api/collections-dept/ledger/aging?creditDays=60&limit=500');
    ok('فلترُ مهلة السداد', (cd.j?.rows || []).every((r) => r.creditDays === 60), `${cd.j?.total} حسابًا`);
    const sr = await call('GET', `/api/collections-dept/ledger/aging?search=${encodeURIComponent('أركتيك')}`);
    ok('البحثُ بالاسم', (sr.j?.total || 0) >= 1, `${sr.j?.total}`);
    const bandQ = await call('GET', '/api/collections-dept/ledger/aging?band=120%2B&limit=500');
    // ولا يُشترَط أن يكون موجبًا: إشعارُ الخصم يجعل الشريحةَ سالبةً، وهو مالٌ
    // في تلك الشريحة يجب أن يُرى — لا أن يُفلتَر خارجَها.
    ok('فلترُ الشريحة', (bandQ.j?.rows || []).every((r) => r.bands['120+'] !== 0), `${bandQ.j?.total} حسابًا`);
    const noDate = await call('GET', '/api/collections-dept/ledger/aging?band=noDate&limit=500');
    ok('وشريحةُ «بلا تاريخ» تُعرَض وحدَها', (noDate.j?.rows || []).every((r) => r.bands.noDate !== 0), `${noDate.j?.total} حسابًا`);
    const fo = await call('GET', '/api/collections-dept/ledger/aging/filters');
    ok('قوائمُ الفلاتر كاملة',
      (fo.j?.officers?.length || 0) >= 4 && (fo.j?.grades?.length || 0) >= 8 && (fo.j?.creditDays?.length || 0) >= 5,
      `موظّفون ${fo.j?.officers?.length} · تقييمات ${fo.j?.grades?.length} · مُهَل ${fo.j?.creditDays?.length}`);

    head('دفترُ الفواتير مقيسًا على ورقة Daily Invoice Report');
    const inv = await call('GET', '/api/collections-dept/ledger/invoices?limit=1');
    ok('تفتح الصفحة', inv.status === 200, `${inv.status}`);
    const dbCount = await CollectionInvoice.countDocuments();
    ok('عددُ الفواتير', inv.j?.total === dbCount, `${inv.j?.total}`);
    // خليّةُ «Total» في الورقة = مجموعُ ما لا حالةَ له.
    const blank = await call('GET', '/api/collections-dept/ledger/invoices?status=&limit=1');
    const sheetTotalCell = N(DI[4][3]);
    const blankSum = (await CollectionInvoice.aggregate([{ $match: { status: '' } }, { $group: { _id: null, s: { $sum: '$total' } } }]))[0]?.s || 0;
    ok('خليّةُ «Total» في الورقة تُعاد كما هي', near(blankSum, sheetTotalCell, 0.01),
      `${blankSum.toFixed(2)} — الورقة ${sheetTotalCell.toFixed(2)}`);

    const openInv = await call('GET', '/api/collections-dept/ledger/invoices?open=true&limit=1');
    ok('فلترُ «غير محصَّل»', (openInv.j?.total || 0) > 0 && openInv.j.total < dbCount, `${openInv.j?.total}/${dbCount}`);
    const coll = await call('GET', '/api/collections-dept/ledger/invoices?status=Collected&limit=1');
    const dbColl = await CollectionInvoice.countDocuments({ status: 'Collected' });
    ok('فلترُ الحالة', coll.j?.total === dbColl, `${coll.j?.total} — القاعدة ${dbColl}`);
    const byOff = await call('GET', '/api/collections-dept/ledger/invoices?officer=Hossam&limit=1');
    ok('فلترُ الموظّف على الفواتير', (byOff.j?.total || 0) > 0, `${byOff.j?.total}`);
    const dated = await call('GET', '/api/collections-dept/ledger/invoices?from=2026-08-01&to=2026-08-31&limit=1');
    ok('فلترُ الفترة', (dated.j?.total || 0) > 0, `${dated.j?.total} فاتورةً في أغسطس`);

    head('الأيّامُ محسوبةٌ لا مخزَّنة');
    const sample = await call('GET', '/api/collections-dept/ledger/invoices?open=true&limit=5');
    const withDates = (sample.j?.rows || []).find((r) => r.invoiceDate && r.deliveryDate);
    ok('من الفوترة إلى التسليم', !withDates || typeof withDates.daysInvoiceToDelivery === 'number',
      withDates ? `${withDates.daysInvoiceToDelivery} يومًا` : '(لا عيّنة)');
    ok('وعمرُ الفاتورة وشريحتُها', (sample.j?.rows || []).every((r) => r.ageDays == null || typeof r.band === 'string'));
    const withDue = (sample.j?.rows || []).find((r) => r.dueDate);
    ok('والاستحقاقُ من تاريخ التسليم', !withDue || (() => {
      const exp = new Date(new Date(withDue.deliveryDate).getTime() + withDue.creditDays * 86400000);
      return Math.abs(new Date(withDue.dueDate) - exp) < 1000;
    })(), withDue ? `${String(withDue.dueDate).slice(0, 10)}` : '(لا عيّنة)');

    head('التنبيهات');
    const al = await call('GET', '/api/collections-dept/ledger/alerts');
    ok('تُحسب', al.status === 200, `${al.status}`);
    ok('حدُّ الائتمان يُقاس بنسبته', (al.j?.limit || []).every((a) => a.pct >= 80), `${al.j?.counts?.limitNear} قارب · ${al.j?.counts?.limitOver} تجاوز`);
    ok('والاستحقاقُ يُقاس بأيّامه', (al.j?.due || []).every((a) => a.daysToDue <= 3), `${al.j?.counts?.dueSoon} قريب · ${al.j?.counts?.overdue} متأخّر`);
    const first = (al.j?.limit || [])[0];
    if (first) {
      const before = al.j.limit.length;
      const ack = await call('POST', '/api/collections-dept/ledger/alerts/ack', { party: first.party, kind: 'limit' });
      ok('يُغلَق التنبيه', ack.status === 200, `${ack.status}`);
      const after = await call('GET', '/api/collections-dept/ledger/alerts');
      ok('فيختفي من القائمة', (after.j?.limit || []).length === before - 1, `${after.j?.limit?.length} بعد ${before}`);
      await CreditAlertAck.deleteMany({ party: first.party });
    }

    head('رفعُ الحدّ من ملفّ العميل');
    const target = await CollectionsParty.findOne({ kind: 'customer', code: { $gt: '' }, creditLimit: { $gt: 0 } }).lean();
    const upd = await call('PUT', `/api/collections-dept/parties/${target._id}`, { creditLimit: target.creditLimit + 12345 });
    ok('يُحفظ الحدُّ الجديد', upd.status === 200 && upd.j?.party?.creditLimit === target.creditLimit + 12345, `${upd.j?.party?.creditLimit}`);
    // ── والسجلُّ يقرؤه فورًا ────────────────────────────────────────────
    // الأعمارُ تُخزَّن دقيقةً لتخفيف الحمل. ورفعُ الحدّ هو الفعلُ الذي يُطفئ
    // التنبيه، فلو بقيت الذاكرةُ لظلّ معلَّقًا بعد معالجته — والموظّف يظنّ أنّه
    // لم يُحفظ. فالكتابةُ تُبطلها.
    const reread = await call('GET', `/api/collections-dept/ledger/aging?search=${encodeURIComponent(target.name)}&limit=5`);
    const seen = (reread.j?.rows || []).find((r) => String(r._id) === String(target._id));
    ok('ويظهر في سجلّ الأعمار فورًا بلا انتظار ذاكرة',
      !!seen && seen.creditLimit === target.creditLimit + 12345,
      `${seen?.creditLimit} — المنتظَر ${target.creditLimit + 12345}`);
    await CollectionsParty.updateOne({ _id: target._id }, { $set: { creditLimit: target.creditLimit } });
    try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) {}

    head('الفريق');
    const team = await call('GET', '/api/collections-dept/ledger/team');
    ok('يُقرأ الفريق', team.status === 200 && (team.j?.officers?.length || 0) >= 4, `${team.j?.officers?.length} موظّفين`);
    const totalAcc = (team.j?.officers || []).reduce((s, o) => s + o.accounts, 0);
    ok('ومجموعُ حساباتهم = حساباتُ السجلّ', totalAcc === await CollectionsParty.countDocuments({ kind: 'customer', code: { $gt: '' } }), `${totalAcc}`);
    const moveMe = await CollectionsParty.findOne({ kind: 'customer', code: { $gt: '' } }).lean();
    const was = moveMe.collectionOfficer;
    const asg = await call('PUT', '/api/collections-dept/ledger/team/assign', { parties: [String(moveMe._id)], officer: 'zz-فحص' });
    ok('يُسنَد الحسابُ إلى موظّف', asg.status === 200 && asg.j?.updated === 1, `${asg.j?.updated}`);
    const back = await CollectionsParty.findById(moveMe._id).select('collectionOfficer').lean();
    ok('ويُقرأ الإسنادُ من القاعدة', back.collectionOfficer === 'zz-فحص', back.collectionOfficer);
    await CollectionsParty.updateOne({ _id: moveMe._id }, { $set: { collectionOfficer: was } });

    head('الخطّةُ اليوميّة');
    const t0 = await call('GET', '/api/collections-dept/ledger/tasks?limit=5');
    ok('تُقرأ المهامّ', t0.status === 200 && (t0.j?.total || 0) >= 1, `${t0.j?.total}`);
    const mk = await call('POST', '/api/collections-dept/ledger/tasks', {
      party: String(moveMe._id), date: '2026-09-03', requestType: 'zz-Visit', action: 'zz-فحص',
    });
    ok('تُنشأ مهمّة', mk.status === 201, `${mk.status}`);
    if (mk.j?.task?._id) madeTasks.push(mk.j.task._id);
    ok('وتأخذ مسؤولَ الحساب من نفسِها', !!mk.j?.task?.officerName, mk.j?.task?.officerName || '(فارغ)');
    const up = await call('PUT', `/api/collections-dept/ledger/tasks/${mk.j?.task?._id}`, { status: 'Done', collected: 500 });
    ok('وتُحدَّث بنتيجتها', up.status === 200 && up.j?.task?.collected === 500, `${up.j?.task?.status} ${up.j?.task?.collected}`);
    const byDay = await call('GET', '/api/collections-dept/ledger/tasks?from=2026-09-03&to=2026-09-03');
    ok('وتُقرأ بيومها', (byDay.j?.rows || []).some((r) => String(r._id) === String(mk.j?.task?._id)), `${byDay.j?.total}`);

    head('تقييمُ الفريق');
    const perf = await call('GET', '/api/collections-dept/ledger/performance');
    ok('يُحسب', perf.status === 200 && (perf.j?.rows?.length || 0) >= 1, `${perf.j?.rows?.length} موظّفين`);
    const r0 = (perf.j?.rows || [])[0];
    ok('لكلٍّ ما حصّل وما بقي', r0 && typeof r0.collectedAmount === 'number' && typeof r0.openAmount === 'number',
      r0 ? `${r0.officer}: حصّل ${r0.collectedAmount.toFixed(0)} · باقٍ ${r0.openAmount.toFixed(0)}` : '');
    ok('ونسبةُ التحصيل بين صفرٍ ومئة', (perf.j?.rows || []).every((r) => r.collectionRate == null || (r.collectionRate >= 0 && r.collectionRate <= 100)));
    ok('ومتوسّطُ أيّام التحصيل', (perf.j?.rows || []).some((r) => typeof r.avgDaysToCollect === 'number'),
      `${r0?.avgDaysToCollect} يومًا`);
    const perfF = await call('GET', '/api/collections-dept/ledger/performance?officer=Hossam');
    ok('ويُفلتَر بموظّفٍ بعينه', (perfF.j?.rows || []).every((r) => r.officer === 'Hossam'), `${perfF.j?.rows?.length}`);
    const perfR = await call('GET', '/api/collections-dept/ledger/performance?from=2026-08-01&to=2026-08-31');
    ok('وبفترةٍ بعينها', perfR.status === 200, `${perfR.j?.totals?.collectedAmount?.toFixed(0)} في أغسطس`);

    head('مراجعةُ الربط');
    const sug = await call('GET', '/api/collections-dept/ledger/link-suggestions');
    ok('تُقرأ الاقتراحات', sug.status === 200, `${sug.j?.rows?.length} معروضة · ${JSON.stringify(sug.j?.counts)}`);
    ok('والمربوطُ تلقائيًّا مقيَّدٌ بأنّه تلقائيّ', (sug.j?.counts?.linked || 0) >= 1, `${sug.j?.counts?.linked}`);

    head('الكودُ يُولَّد على سياقة الدفتر');
    // ── ويُقرأ التاليَ من القاعدة لا من عدّادٍ محفوظ ────────────────────────
    // العدّادُ المنفصل يفترق عن الواقع عند أوّل استيرادٍ أو حذف، فيُعيد كودًا
    // مأخوذًا. وأكبرُ كودٍ موجودٍ فعلًا صحيحٌ دائمًا بلا صيانة.
    const codes = await CollectionsParty.distinct('code', { code: { $gt: '' } });
    const maxCash = Math.max(0, ...codes.filter((c) => /^C\d+$/i.test(c)).map((c) => Number(c.slice(1))));
    const maxTax = Math.max(0, ...codes.filter((c) => /^1104\d+$/.test(c)).map((c) => Number(c.slice(4))));
    const madeParties = [];
    const mkParty = async (name, paymentType) => {
      const r = await call('POST', '/api/collections-dept/parties', { kind: 'customer', name, paymentType });
      if (r.j?.party?._id) madeParties.push(r.j.party._id);
      return r;
    };
    const c1 = await mkParty(`zz-كاش-${Date.now()}`, 'cash');
    ok('النقديُّ يأخذ التاليَ في سلسلة C', c1.j?.party?.code === `C${String(maxCash + 1).padStart(4, '0')}`,
      `${c1.j?.party?.code} — المنتظَر C${String(maxCash + 1).padStart(4, '0')}`);
    const c2 = await mkParty(`zz-ضريبي-${Date.now()}`, 'tax');
    ok('والضريبيُّ في سلسلة 1104', c2.j?.party?.code === `1104${String(maxTax + 1).padStart(4, '0')}`,
      `${c2.j?.party?.code} — المنتظَر 1104${String(maxTax + 1).padStart(4, '0')}`);
    const c3 = await mkParty(`zz-كاش2-${Date.now()}`, 'cash');
    ok('ولا يتكرّر كودٌ', c3.j?.party?.code !== c1.j?.party?.code, `${c1.j?.party?.code} ثمّ ${c3.j?.party?.code}`);
    if (madeParties.length) await CollectionsParty.deleteMany({ _id: { $in: madeParties } });

    head('وقسمُ التحصيل لا يرى ما علينا');
    const dash = await call('GET', '/api/collections-dept/dashboard');
    ok('اللوحةُ تُفتح', dash.status === 200, `${dash.status}`);
    ok('ولا تحمل المستحقَّ علينا', !dash.j?.suppliers && !dash.j?.aging?.supplier,
      dash.j?.suppliers ? 'suppliers أُرسلت!' : 'محجوب');
  } finally {
    if (madeTasks.length) await CollectionTask.deleteMany({ _id: { $in: madeTasks } });
    await CollectionTask.deleteMany({ requestType: 'zz-Visit' });
    await User.deleteMany({ email: /^zz-ledger/ });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
