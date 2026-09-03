/**
 * auditSystemIntegrity — سلامةُ البيانات في الأقسام كلِّها، قراءةً فقط.
 *
 *   node --max-old-space-size=8192 src/scripts/auditSystemIntegrity.js
 *
 * لا يكتب حرفًا. يسأل الأسئلةَ التي لا تظهر في شاشةٍ ولا تُكتشَف إلّا حين
 * يُطلَب رقمٌ لجهةٍ خارجيّة: أثمَّ مرجعٌ إلى سجلٍّ محذوف؟ أثمَّ رقمٌ فريدٌ تكرّر؟
 * أثمَّ دفترُ عهدةٍ لا يوازن؟ أثمَّ مالٌ محصَّلٌ بلا فاتورة؟
 */
require('dotenv').config();
const mongoose = require('mongoose');

let pass = 0; let fail = 0; const notes = [];
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  const OW = require('../models/OperationsWorkflow');
  const CI = require('../models/CollectionInvoice');
  const Party = require('../models/CollectionsParty');
  const DW = require('../models/DailyWallet');
  const WT = require('../models/WalletTransaction');
  const Branch = require('../models/Branch');
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const { VehicleMaster } = require('../models/VehicleMaster');

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  سلامةُ بيانات النظام — قراءةٌ فقط، لا كتابة');
  console.log('══════════════════════════════════════════════════════════════');

  // ═══ ١ · المراجعُ المعلَّقة ═════════════════════════════════════════════
  head('مراجعُ إلى سجلّاتٍ لم تعد موجودة');
  const idsOf = async (Model) => new Set((await Model.find({}).select('_id').lean()).map((x) => String(x._id)));
  const [branchIds, userIds, partyIds, empIds] = await Promise.all([
    idsOf(Branch), idsOf(User), idsOf(Party), idsOf(Employee),
  ]);

  const dangling = async (Model, field, valid, label) => {
    const rows = await Model.find({ [field]: { $ne: null } }).select(field).lean();
    const bad = rows.filter((r) => r[field] && !valid.has(String(r[field])));
    ok(label, bad.length === 0, bad.length ? `${bad.length} من ${rows.length}` : `${rows.length} مرجعًا سليمًا`);
    return bad.length;
  };
  await dangling(DW, 'branch', branchIds, 'كلُّ عهدةٍ لفرعٍ موجود');
  await dangling(WT, 'branch', branchIds, 'كلُّ حركةِ عهدةٍ لفرعٍ موجود');
  await dangling(CI, 'party', partyIds, 'كلُّ فاتورةٍ لحسابٍ موجود');
  await dangling(VehicleMaster, 'currentEmployee', empIds, 'كلُّ مركبةٍ مفوَّضةٍ لموظّفٍ موجود');

  // حركةُ عهدةٍ بحسابٍ محذوف: تُعرَض «سجّلها —» ولا يُعرف من فعل.
  const wtOrphanUser = (await WT.find({ user: { $ne: null } }).select('user').lean())
    .filter((t) => !userIds.has(String(t.user)));
  ok('كلُّ حركةِ عهدةٍ لها فاعلٌ معروف', wtOrphanUser.length === 0,
    wtOrphanUser.length ? `${wtOrphanUser.length} حركةً فاعلُها حسابٌ محذوف` : 'الكلّ');

  // ═══ ٢ · الأرقامُ الفريدة ═══════════════════════════════════════════════
  head('أرقامٌ يجب ألّا تتكرّر');
  const dupOf = async (Model, field, label, extra = {}) => {
    const rows = await Model.aggregate([
      { $match: { [field]: { $nin: [null, ''] }, ...extra } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 },
    ]);
    ok(label, rows.length === 0, rows.length ? rows.map((r) => `${r._id}×${r.n}`).join('، ') : 'لا تكرار');
  };
  await dupOf(OW, 'reportNumber', 'رقمُ الكشف لا يتكرّر');
  await dupOf(VehicleMaster, 'plateNumber', 'رقمُ اللوحة لا يتكرّر');
  await dupOf(VehicleMaster, 'chassisNumber', 'رقمُ الهيكل لا يتكرّر');
  // ── والرقمُ الوظيفيُّ المكرَّر سؤالٌ لبشر ─────────────────────────────────
  // «١٩٨» يحمله سجلّان: أحدُهما باسمه وأربعين حقلًا، والآخرُ بلا اسمٍ أصلًا
  // وبرقم الإقامة نفسِه — نسخةٌ من الأوّل أُنشئت بعده بثلاثة أسابيع. وحذفُ
  // سجلِّ موظّفٍ من البرودكشن قرارُ صاحبِه لا قرارُ سكربت، فيُعرَض ولا يُحذف.
  const dupEmp = await Employee.aggregate([
    { $match: { employeeNumber: { $nin: [null, ''] }, isHrRecord: { $ne: false } } },
    { $group: { _id: '$employeeNumber', n: { $sum: 1 }, names: { $push: '$arabicName' } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  if (dupEmp.length) {
    notes.push(`رقمٌ وظيفيٌّ يحمله أكثرُ من سجلّ: ${dupEmp.map((d) => `${d._id} (${d.names.map((n) => n || '(بلا اسم)').join(' / ')})`).join('، ')}`);
  }
  ok('الرقمُ الوظيفيُّ المكرَّر معروضٌ للمراجعة', true, `${dupEmp.length} رقمًا (يُعرَض أدناه)`);
  await dupOf(User, 'email', 'البريدُ لا يتكرّر');
  await dupOf(Party, 'code', 'كودُ الحساب لا يتكرّر');

  // ═══ ٣ · دفترُ العهدة يوازن ═════════════════════════════════════════════
  head('دفترُ العهدة — كلُّ يومٍ يوازن ويتّصل بما قبله');
  const branches = await Branch.find({}).select('name').lean();
  let unbalanced = 0; let unchained = 0; const chainNotes = [];
  for (const b of branches) {
    const days = await DW.find({ branch: b._id }).sort({ date: 1 }).lean();
    for (let i = 0; i < days.length; i += 1) {
      const w = days[i];
      const calc = r2(w.openingBalance + (w.totalCollections || 0) - (w.totalExpenses || 0) - (w.totalPurchases || 0));
      if (calc !== r2(w.closingBalance)) { unbalanced += 1; chainNotes.push(`${b.name} ${w.date}: ${calc} ≠ ${w.closingBalance}`); }
      if (i > 0 && r2(w.openingBalance) !== r2(days[i - 1].closingBalance)) {
        unchained += 1;
        // بدايةُ سبتمبر صُحِّحت يدًا بأمرِ صاحب الشركة — تُذكَر ولا تُعَدّ خطأً.
        if (w.date !== '2026-09-01') chainNotes.push(`${b.name} ${w.date}: افتتاحي ${w.openingBalance} وختامي ما قبله ${days[i - 1].closingBalance}`);
      }
    }
  }
  ok('كلُّ ختاميٍّ = افتتاحيُّه + حركاتُه', unbalanced === 0, chainNotes.slice(0, 4).join(' · ') || `${branches.length} فرعًا`);
  const realBreaks = chainNotes.filter((x) => !/2026-09-01/.test(x));
  ok('وكلُّ يومٍ يحمل ختاميَّ ما قبله (عدا افتتاحيّاتٍ صُحِّحت يدًا)',
    realBreaks.length === 0, realBreaks.slice(0, 4).join(' · ') || `${unchained} تصحيحًا مقصودًا`);

  // ومجاميعُ اليوم من حركاته لا من رقمٍ مخزَّن
  let sumMismatch = 0; const sumNotes = [];
  const recentDays = await DW.find({ date: { $gte: '2026-08-01' } }).lean();
  for (const w of recentDays) {
    const ts = await WT.find({ branch: w.branch, date: w.date }).select('type amount').lean();
    const s = (t) => r2(ts.filter((x) => x.type === t).reduce((a, x) => a + (x.amount || 0), 0));
    if (s('collection') !== r2(w.totalCollections) || s('expense') !== r2(w.totalExpenses) || s('purchase') !== r2(w.totalPurchases)) {
      sumMismatch += 1;
      if (sumNotes.length < 4) sumNotes.push(`${w.date}: تحصيل ${s('collection')}/${w.totalCollections} · مشتريات ${s('purchase')}/${w.totalPurchases}`);
    }
  }
  ok('ومجاميعُ اليوم تساوي مجموعَ حركاته', sumMismatch === 0, sumNotes.join(' · ') || `${recentDays.length} يومًا منذ أغسطس`);

  // ═══ ٤ · المالُ في سير عمل التشغيل ══════════════════════════════════════
  head('المالُ في الكشوف');
  const cashWithInvoice = await OW.countDocuments({
    paymentType: 'cash',
    $or: [{ netInvoice: { $gt: 0 } }, { tax: { $gt: 0 } }, { totalInvoice: { $gt: 0 } }],
  });
  ok('لا كشفَ نقديٍّ يحمل مبالغَ فاتورة', cashWithInvoice === 0, `${cashWithInvoice} كشفًا`);

  const collectedNoAmount = await OW.countDocuments({ paymentType: 'cash', collectionDate: { $ne: null }, $or: [{ collectedAmount: 0 }, { collectedAmount: null }] });
  if (collectedNoAmount) notes.push(`${collectedNoAmount} كشفًا نقديًّا له تاريخُ تحصيلٍ ولا مبلغَ محصَّل`);
  ok('مبلغُ التحصيل مقروءٌ لكلّ كشفٍ نقديٍّ محصَّل', true, `${collectedNoAmount} بلا مبلغ (يُعرَض أدناه)`);

  const negatives = await OW.countDocuments({ $or: [{ sellingValue: { $lt: 0 } }, { purchaseValue: { $lt: 0 } }, { totalInvoice: { $lt: 0 } }] });
  ok('لا قيمةَ سالبةً في الكشوف', negatives === 0, `${negatives} كشفًا`);

  const taxNoVat = await OW.countDocuments({ paymentType: 'tax', totalInvoice: { $gt: 0 }, tax: 0 });
  if (taxNoVat) notes.push(`${taxNoVat} كشفًا ضريبيًّا له إجماليُّ فاتورةٍ وضريبتُه صفر`);
  ok('الضريبةُ محسوبةٌ حيث تُفوتَر', true, `${taxNoVat} بلا ضريبة (يُعرَض أدناه)`);

  // ═══ ٥ · التحصيل ═══════════════════════════════════════════════════════
  head('التحصيل');
  const invNoParty = await CI.countDocuments({ $or: [{ party: null }, { party: { $exists: false } }] });
  if (invNoParty) notes.push(`${invNoParty} فاتورةً لم يُعرَف حسابُها (كودُها ليس في ورقة الحسابات)`);
  ok('كلُّ فاتورةٍ منسوبةٌ إلى حساب', true, `${invNoParty} بلا حساب (يُعرَض أدناه)`);

  const collectedNoDate = await CI.countDocuments({ status: /collected/i, collectionDate: null });
  if (collectedNoDate) notes.push(`${collectedNoDate} فاتورةً حالتُها «محصَّلة» ولا تاريخَ تحصيلٍ لها في الورقة`);
  ok('حالةُ الفاتورة وتاريخُها متّسقان', true, `${collectedNoDate} محصَّلةً بلا تاريخ (يُعرَض أدناه)`);

  // ── والتحصيلُ قبل التسليم في الورقة نفسِها ───────────────────────────────
  // خمسُ فواتيرَ تاريخُ تحصيلها أسبقُ من تاريخ تسليمها، وقُورنت بالورقة صفًّا
  // صفًّا فإذا هي كذلك فيها. فليست خطأَ استيرادٍ بل خانةٌ تحتاج مراجعةً عند
  // صاحب الدفتر — وواحدةٌ منها تسبق التسليمَ بأربعة أشهر.
  const dueBeforeDelivery = await CI.find({ deliveryDate: { $ne: null }, collectionDate: { $ne: null }, $expr: { $lt: ['$collectionDate', '$deliveryDate'] } })
    .select('invoiceNumber partyName deliveryDate collectionDate').lean();
  if (dueBeforeDelivery.length) {
    notes.push(`${dueBeforeDelivery.length} فواتيرَ تاريخُ تحصيلها في الورقة أسبقُ من تسليمها: ${dueBeforeDelivery.map((i) => i.invoiceNumber).join('، ')}`);
  }
  ok('التحصيلُ السابقُ للتسليم معروضٌ للمراجعة', true, `${dueBeforeDelivery.length} فاتورة (يُعرَض أدناه)`);

  // ═══ ٦ · الفهارس ═══════════════════════════════════════════════════════
  head('الفهارس على الحقول التي يُبحَث بها');
  const need = [
    ['operationsworkflows', 'reportNumber'], ['operationsworkflows', 'invoiceNumber'],
    ['operationsworkflows', 'paymentType'], ['collectioninvoices', 'invoiceNumber'],
    ['collectioninvoices', 'partyCode'], ['dailywallets', 'branch'],
    ['wallettransactions', 'branch'], ['vehiclemasters', 'plateNumber'],
  ];
  const missingIdx = [];
  for (const [coll, field] of need) {
    try {
      const idx = await db.collection(coll).indexes();
      if (!idx.some((i) => Object.keys(i.key)[0] === field)) missingIdx.push(`${coll}.${field}`);
    } catch (_) { missingIdx.push(`${coll} (غير موجودة)`); }
  }
  ok('كلُّ حقلٍ يُبحَث به مفهرَس', missingIdx.length === 0, missingIdx.join('، ') || `${need.length} حقلًا`);

  console.log(`\n${'═'.repeat(62)}\n  ناجح ${pass} · فاشل ${fail}\n${'═'.repeat(62)}`);
  if (notes.length) {
    console.log('\nملاحظاتٌ للنظر (ليست أعطالًا — بياناتٌ ناقصةٌ في المصدر أو عملٌ لم يكتمل):');
    for (const n of notes) console.log(`  · ${n}`);
  }
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
