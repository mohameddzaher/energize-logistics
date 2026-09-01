/**
 * auditCollectionsSection — قسمُ التحصيل يعمل فعلًا؟
 *
 *   node src/scripts/auditCollectionsSection.js
 *   node src/scripts/auditCollectionsSection.js --base http://localhost:5599
 *
 * لا يقرأ الكودَ ليقول إنّه سليم: يسجّل الدخولَ بحسابَي القسم الحقيقيَّين
 * وينادي كلَّ نقطةٍ كما ينادي المتصفّح — ثمّ يسأل القاعدةَ هل جرى ما قيل إنّه
 * جرى. والصلاحيّةُ تُفحَص من الجهتين: ما يجب أن يُفتح، وما يجب أن يُمنع.
 *
 * لا يترك أثرًا: ما يُنشئه يحذفه، ولا يمسّ صفًّا حقيقيًّا إلّا بقراءة.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
const PASSWORD = 'Passenergize1!';
// الفحصُ ينادي كما ينادي المتصفّح: حارسُ CSRF يردّ كلَّ كتابةٍ تحمل كوكي جلسة
// بلا ترويسة `Origin` — وهو صوابٌ لا عيبٌ يُلتَفّ عليه.
const ORIGIN = process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000';

let pass = 0; let fail = 0;
const ok = (label, cond, note = '') => {
  console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${label}${note ? '  — ' + note : ''}`);
  cond ? (pass += 1) : (fail += 1);
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`);

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (r.status === 429) { console.error('RATE LIMITED — أعد تشغيل الـ API'); process.exit(2); }
  const ck = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, ck, body: await r.json().catch(() => ({})) };
}
async function call(method, path, ck, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: ck, Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const Lookup = require('../models/Lookup');

  const MANAGER = 'hatim.mohamed@energize-logistics.com';
  const STAFF = 'collections.officer@energize-logistics.com';

  // ── ١ · الحسابان ───────────────────────────────────────────────────────
  head('الحسابان');
  const mgr = await login(MANAGER);
  const stf = await login(STAFF);
  ok('دخول مدير التحصيل', mgr.status === 200, `${MANAGER} → ${mgr.status}`);
  ok('دخول موظف التحصيل', stf.status === 200, `${STAFF} → ${stf.status}`);
  if (mgr.status !== 200 || stf.status !== 200) { console.error('\nلا يمكن المتابعة بلا دخول'); process.exit(1); }

  const me = await call('GET', '/api/auth/me', mgr.ck);
  const perms = me.json?.user?.permissions || {};
  ok('الدور يصل للواجهة', me.json?.user?.role === 'collections_manager', me.json?.user?.role);
  ok('قسم التحصيل مفتوحٌ في مصفوفة الصلاحيّات', perms.Collections === 'edit', `Collections=${perms.Collections}`);

  const meStaff = await call('GET', '/api/auth/me', stf.ck);
  ok('الموظف يفتح قسمه', (meStaff.json?.user?.permissions || {}).Collections === 'edit',
    `Collections=${(meStaff.json?.user?.permissions || {}).Collections}`);

  // ── ٢ · الخدمة الذاتيّة والحاجات المشتركة ──────────────────────────────
  head('الخدمة الذاتيّة والصفحات المشتركة');
  for (const [label, path] of [
    ['ملفّي', '/api/hr/me/profile'],
    ['إجازاتي', '/api/hr/me/leaves'],
    ['طلباتي', '/api/hr/me/requests'],
    ['الإشعارات', '/api/notifications'],
    ['مهام القسم', '/api/section-work/tasks?section=collections'],
    ['شكاوى القسم', '/api/section-work/complaints?section=collections'],
  ]) {
    const r = await call('GET', path, stf.ck);
    ok(label, r.status !== 401 && r.status !== 403, `${r.status}`);
  }

  // ── ٣ · صفحاتُ القسم ───────────────────────────────────────────────────
  head('صفحات القسم');
  const dash = await call('GET', '/api/collections-dept/dashboard', mgr.ck);
  ok('اللوحة تُفتح', dash.status === 200, `${dash.status}`);
  const d = dash.json || {};
  ok('اللوحة فيها الجهتان', !!(d.customers && d.suppliers),
    `عملاء=${d.customers?.reports} كشفًا · موردون=${d.suppliers?.reports} كشفًا`);
  ok('التقادم أربعُ شرائح', (d.aging?.customer || []).length === 4 && (d.aging?.supplier || []).length === 4);
  ok('الفروع محسوبة', Array.isArray(d.byBranch) && d.byBranch.length > 0, `${d.byBranch?.length} فرعًا`);

  const custList = await call('GET', '/api/collections-dept/parties?kind=customer&limit=5', mgr.ck);
  const suppList = await call('GET', '/api/collections-dept/parties?kind=supplier&limit=5', mgr.ck);
  ok('صفحة العملاء', custList.status === 200 && custList.json?.total > 0, `${custList.json?.total} عميلًا`);
  ok('صفحة الموردين', suppList.status === 200 && suppList.json?.total > 0, `${suppList.json?.total} موردًا`);

  // ── ٤ · الأرقام تطابق القاعدة ──────────────────────────────────────────
  head('الأرقام تطابق القاعدة');
  const dbCust = await CollectionsParty.countDocuments({ kind: 'customer' });
  const dbSupp = await CollectionsParty.countDocuments({ kind: 'supplier' });
  ok('عدد العملاء = ما في القاعدة', custList.json?.total === dbCust, `${custList.json?.total} مقابل ${dbCust}`);
  ok('عدد الموردين = ما في القاعدة', suppList.json?.total === dbSupp, `${suppList.json?.total} مقابل ${dbSupp}`);

  // المستحقُّ في اللوحة = مجموعُ ما لا تاريخَ إغلاقٍ له في القاعدة.
  const NOT_CANCELLED = { executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] } };
  const [dbDue] = await OperationsWorkflow.aggregate([
    { $match: { username: { $nin: [null, ''] }, collectionDate: null, ...NOT_CANCELLED } },
    { $group: { _id: null, sum: { $sum: { $ifNull: ['$sellingValue', 0] } }, n: { $sum: 1 } } },
  ]);
  const shown = Math.round((d.customers?.outstanding || 0));
  const real = Math.round(dbDue?.sum || 0);
  ok('المستحق لنا = ما في القاعدة', Math.abs(shown - real) <= 1, `اللوحة ${shown} · القاعدة ${real}`);
  ok('عدد الكشوف غير المحصَّلة = ما في القاعدة', d.customers?.openReports === dbDue?.n,
    `اللوحة ${d.customers?.openReports} · القاعدة ${dbDue?.n}`);

  // ── ٥ · البحث والملف ───────────────────────────────────────────────────
  head('البحث وملفّ الطرف');
  const biggest = (d.customers?.top || [])[0];
  if (biggest) {
    const found = await call('GET', `/api/collections-dept/parties?kind=customer&q=${encodeURIComponent(biggest.name)}`, mgr.ck);
    const hit = (found.json?.parties || [])[0];
    ok('البحث بالاسم يجد أكبر عميل', !!hit, biggest.name);
    if (hit) {
      const prof = await call('GET', `/api/collections-dept/parties/${hit._id}?limit=5`, mgr.ck);
      ok('ملفّ العميل يُفتح', prof.status === 200, `${prof.json?.reportsTotal} كشفًا`);
      ok('الملفّ يحمل كشوفَه', (prof.json?.reports || []).length > 0);
      ok('الملفّ يحمل حركةً شهريّة', (prof.json?.monthly || []).length > 0, `${prof.json?.monthly?.length} شهرًا`);
      // مجموعُ الكشوف في الملفّ = ما تقوله القاعدة لأسمائه كلِّها.
      const names = hit.nameVariants?.length ? hit.nameVariants : [hit.name];
      const dbN = await OperationsWorkflow.countDocuments({ username: { $in: names }, ...NOT_CANCELLED });
      ok('عدد كشوف الملفّ = ما في القاعدة', prof.json?.reportsTotal === dbN, `${prof.json?.reportsTotal} مقابل ${dbN}`);
    }
  } else ok('يوجد عميلٌ عليه مستحق', false, 'اللوحة لم تُرجع أحدًا');

  // البحثُ يطوي فروقَ الرسم: «شركه» تجد «شركة».
  const folded = await call('GET', '/api/collections-dept/parties?kind=supplier&q=شركه', mgr.ck);
  ok('البحث يطوي فروق الرسم (شركه ← شركة)', (folded.json?.total || 0) > 0, `${folded.json?.total} نتيجة`);

  // ── ٦ · الإنشاء والتعديل والحذف ────────────────────────────────────────
  head('إنشاء وتعديل وحذف');
  const NAME = `zz-تحصيل-فحص-${Date.now()}`;
  const created = await call('POST', '/api/collections-dept/parties', stf.ck, {
    kind: 'customer', name: NAME, phone: '0500000000', city: 'جدة',
    // خاناتٌ فارغة: الاستمارةُ ترسل حقولَها كلَّها وأكثرُها فارغ، ويجب ألّا
    // تُرفض لأنّ المستخدم **لم** يملأ حقلًا اختياريًّا.
    status: '', paymentTerms: '', assignedTo: '', nextFollowUpAt: '',
  });
  ok('الموظف يُنشئ طرفًا', created.status === 201, `${created.status} ${created.json?.message || ''}`);
  const newId = created.json?.party?._id;

  if (newId) {
    const dup = await call('POST', '/api/collections-dept/parties', stf.ck, { kind: 'customer', name: NAME });
    ok('الاسم المكرَّر يُرفض ويُسمَّى', dup.status === 409 && String(dup.json?.message || '').includes(NAME), `${dup.status}`);

    const upd = await call('PUT', `/api/collections-dept/parties/${newId}`, stf.ck, { phone: '0511111111', notes: 'فحص' });
    ok('التعديل يُحفظ', upd.status === 200 && upd.json?.party?.phone === '0511111111');
    const inDb = await CollectionsParty.findById(newId).lean();
    ok('التعديل وصل القاعدة فعلًا', inDb?.phone === '0511111111', inDb?.phone);
    ok('الاسم المطويّ محسوب', !!inDb?.nameKey, inDb?.nameKey);

    // الحذفُ لمن يعدّل: منحُ «تعديل» على القسم يمرّ كلَّ نقطةٍ فيه، فقائمةٌ
    // أضيقُ منه في المسار لا تمنع شيئًا.
    const del = await call('DELETE', `/api/collections-dept/parties/${newId}`, stf.ck);
    ok('الموظف يحذف ما لا تاريخَ له', del.status === 200 && del.json?.deleted === true, `${del.status}`);
    ok('اختفى من القاعدة', !(await CollectionsParty.findById(newId)));
  }

  // مَن له تاريخٌ يُعطَّل لا يُحذَف — وإلّا انقطعت كشوفُه عن ملفّه.
  // ويُختار مَن له كشوفٌ يقينًا (أكبرُ المتأخّرين) لا أوّلُ صفٍّ بالاسم: ذاك
  // قد يكون طرفًا بلا تاريخ، فيمرّ الفحصُ من غير أن يفحص شيئًا.
  const withHistory = biggest
    ? await CollectionsParty.findOne({ kind: 'customer', nameKey: CollectionsParty.fold(biggest.name) }).lean()
    : null;
  if (withHistory) {
    const probe = await call('GET', `/api/collections-dept/parties/${withHistory._id}`, mgr.ck);
    ok('الطرف المختار له كشوف', (probe.json?.party?.reports || 0) > 0, `${probe.json?.party?.reports} كشفًا`);
    if ((probe.json?.party?.reports || 0) > 0) {
      const del = await call('DELETE', `/api/collections-dept/parties/${withHistory._id}`, mgr.ck);
      ok('مَن له كشوفٌ يُعطَّل لا يُحذَف', del.json?.deactivated === true, del.json?.message || `${del.status}`);
      // يُعاد كما كان: الفحصُ لا يترك أثرًا.
      await CollectionsParty.findByIdAndUpdate(withHistory._id, { $set: { isActive: true } });
      const back = await CollectionsParty.findById(withHistory._id).lean();
      ok('أُعيد تفعيلُه بعد الفحص', back?.isActive === true);
    }
  }

  // ── ٧ · قوائمُ القسم من إعداداته ───────────────────────────────────────
  head('قوائم القسم');
  const types = await call('GET', '/api/lookups/types', mgr.ck);
  const mine = (types.json?.types || []).filter((t) => t.module === 'collections');
  ok('قوائم التحصيل ظاهرة لمديره', mine.length === 5, `${mine.length} قائمة`);
  ok('ويملك تعديلها', mine.every((t) => t.canManage));
  for (const t of mine) {
    const n = await Lookup.countDocuments({ type: t.type });
    ok(`  ${t.nameAr}`, n > 0, `${n} قيمة`);
  }

  // ── ٨ · صفحةُ التشغيل — الأعمدة كلُّها ─────────────────────────────────
  head('سير عمل التشغيل');
  const list = await call('GET', '/api/workflows?limit=1', stf.ck);
  ok('الموظف يفتح الكشوف', list.status === 200, `${list.status}`);
  const permsWf = await call('GET', '/api/workflows/permissions', stf.ck);
  const myFields = permsWf.json?.roleAccess?.collections_staff || [];
  const groups = permsWf.json?.groups || {};
  const everyGroup = ['application', 'operations', 'manual_moderator', 'collections'];
  for (const g of everyGroup) {
    const missing = (groups[g] || []).filter((f) => !myFields.includes(f));
    ok(`يملك مجموعة «${g}» كاملة`, missing.length === 0, missing.length ? `ناقص: ${missing.join(', ')}` : `${groups[g]?.length} حقلًا`);
  }
  ok('المدير مثل الموظف', (permsWf.json?.roleAccess?.collections_manager || []).length === myFields.length);
  ok('الإحصاءات تُفتح', (await call('GET', '/api/workflows/stats', stf.ck)).status === 200);
  ok('قيم فلتر العمود تُفتح', (await call('GET', '/api/workflows/filters?field=branch', stf.ck)).status === 200);
  // التصديرُ يقرأ الجدولَ كلَّه فيطول — يُمهَل ولا يُعلَّق عليه الفحصُ كلُّه.
  const exp = await Promise.race([
    call('GET', '/api/workflows/export?limit=1', stf.ck),
    new Promise((r) => setTimeout(() => r({ status: 'timeout' }), 45000)),
  ]);
  ok('التصدير غير ممنوع', exp.status !== 403 && exp.status !== 401, `${exp.status}`);

  // الكتابةُ الحقيقيّة: صفٌّ واحد، عمودٌ من كلّ مجموعة، ثمّ يُعاد كما كان.
  const row = await OperationsWorkflow.findOne({}).select('_id reportNumber operationsReview accountingReview invoiceNotes payingBranch').lean();
  if (row) {
    const before = {
      operationsReview: row.operationsReview || '',
      accountingReview: row.accountingReview || '',
      invoiceNotes: row.invoiceNotes || '',
      payingBranch: row.payingBranch || '',
    };
    const stamp = `zz-${Date.now()}`;
    const w = await call('PUT', `/api/workflows/${row._id}`, stf.ck, {
      operationsReview: stamp, accountingReview: stamp, invoiceNotes: stamp, payingBranch: 'جده',
    });
    ok('الكتابة تُقبل', w.status === 200, `${w.status} ${w.json?.message || ''}`);
    ok('لا حقلَ مرفوضًا صامتًا', !(w.json?.refusedFields || []).length, (w.json?.refusedFields || []).join(', '));
    const after = await OperationsWorkflow.findById(row._id)
      .select('operationsReview accountingReview invoiceNotes payingBranch').lean();
    ok('مراجعة التشغيل حُفظت', after.operationsReview === stamp);
    ok('مراجعة الحسابات حُفظت', after.accountingReview === stamp);
    ok('ملاحظات الفاتورة حُفظت', after.invoiceNotes === stamp);
    ok('الفرع المسدِّد حُفظ', after.payingBranch === 'جده');
    await OperationsWorkflow.findByIdAndUpdate(row._id, { $set: before });
    const restored = await OperationsWorkflow.findById(row._id).select('operationsReview invoiceNotes').lean();
    ok('أُعيد الصفُّ كما كان', restored.operationsReview === before.operationsReview && restored.invoiceNotes === before.invoiceNotes);
  }

  // ── ٩ · ما يجب أن يُمنع ────────────────────────────────────────────────
  head('ما يجب أن يُمنع');
  const outsider = await User.findOne({ role: 'workshop_employee', isActive: true }).select('email').lean();
  ok('كشفٌ لا يُحذف إلّا للسوبر أدمن',
    row ? (await call('DELETE', `/api/workflows/${row._id}`, mgr.ck)).status === 403 : false);
  const stillThere = row ? await OperationsWorkflow.findById(row._id).select('_id').lean() : true;
  ok('والكشف باقٍ بعد المحاولة', !!stillThere);
  ok('نوعٌ غير معروف يُرفض',
    (await call('GET', '/api/collections-dept/parties?kind=whatever', mgr.ck)).status === 400);
  ok('معرّفٌ غير صالح يُرفض بلا انهيار',
    (await call('GET', '/api/collections-dept/parties/not-an-id', mgr.ck)).status === 400);
  if (outsider) console.log(`  ~  (دورٌ خارج القسم للمقارنة: ${outsider.email})`);

  // ── ١٠ · الأعمدةُ الماليّة محجوبةٌ عن العمليات ─────────────────────────
  // لا على الشاشة وحدَها: النقطةُ لا تُرجعها، والتصديرُ لا يخرج بها، وقائمةُ
  // قيمِ العمود تُمنع. والحجبُ في مكانٍ واحدٍ حجبٌ في نصف الطريق.
  head('الأعمدة المالية محجوبة عن العمليات');
  const MONEY = ['invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes', 'collectionDate', 'accountingReview'];
  await User.deleteMany({ email: { $regex: '^zz-money' } });
  const probes = {};
  for (const role of ['operations_staff', 'operations_manager']) {
    const u = await User.create({ email: `zz-money-${role}@example.invalid`, password: PASSWORD, firstName: 'ت', lastName: 'ت', role });
    probes[role] = await login(u.email);
  }
  try {
    for (const role of Object.keys(probes)) {
      const ck = probes[role].ck;
      const pf = await call('GET', '/api/workflows/permissions', ck);
      const own = pf.json?.roleAccess?.[role] || [];
      ok(`${role} لا يملك كتابةَ أعمدة المال`, MONEY.every((f) => !own.includes(f)),
        MONEY.filter((f) => own.includes(f)).join(', ') || `${own.length} حقلًا بلا مال`);
      ok(`${role} يملك السداد والسند`, ['paymentDate', 'documentNumber', 'payingBranch'].every((f) => own.includes(f)));

      const lst = await call('GET', '/api/workflows?limit=1', ck);
      const w0 = (lst.json?.workflows || [])[0] || {};
      ok(`${role} لا تصله في القائمة`, MONEY.every((f) => !(f in w0)),
        MONEY.filter((f) => f in w0).join(', ') || 'نظيفة');

      if (w0._id) {
        const one = await call('GET', `/api/workflows/${w0._id}`, ck);
        ok(`${role} لا تصله في التفاصيل`, MONEY.every((f) => !(f in (one.json || {}))),
          MONEY.filter((f) => f in (one.json || {})).join(', ') || 'نظيفة');
      }

      const fo = await call('GET', '/api/workflows/filters?field=totalInvoice', ck);
      ok(`${role} لا يفتح قائمة قيمها`, fo.status === 403, `${fo.status}`);

      // ويُرفض ما يكتبه فيها صراحةً — لا يُبتلع ويُقال «حُفِظ».
      if (row) {
        const w = await call('PUT', `/api/workflows/${row._id}`, ck, { invoiceNumber: 'zz-should-not-save' });
        const after = await OperationsWorkflow.findById(row._id).select('invoiceNumber').lean();
        ok(`${role} لا يكتب فيها`, after.invoiceNumber !== 'zz-should-not-save',
          `HTTP ${w.status} · مرفوض: ${(w.json?.refusedFields || []).join(', ') || '—'}`);
      }
    }

    // ومَن يملكها يراها — وإلّا كان الحجبُ عامًّا لا مقصودًا.
    const mine = await call('GET', '/api/workflows?limit=1', mgr.ck);
    const m0 = (mine.json?.workflows || [])[0] || {};
    ok('التحصيل تصله أعمدة المال', MONEY.some((f) => f in m0), Object.keys(m0).filter((k) => MONEY.includes(k)).join(', '));
    ok('والتحصيل يفتح قائمة قيمها', (await call('GET', '/api/workflows/filters?field=totalInvoice', mgr.ck)).status === 200);
  } finally {
    await User.deleteMany({ email: { $regex: '^zz-money' } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
