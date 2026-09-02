/**
 * auditDataVsSheets — كلُّ رقمٍ في النظام، مقيسًا على الورقة التي جاء منها.
 *
 *   node --max-old-space-size=8192 src/scripts/auditDataVsSheets.js
 *
 * لا يفحص هذا الملفُّ نقاطَ الخدمة ولا الشاشات — تلك لها فحوصُها. يفحص
 * **الداتا نفسَها**: هل ما في القاعدة هو ما في الإكسل؟
 *
 * ── ولماذا يُقاس على المصدر لا على القاعدة ────────────────────────────────
 * فحصٌ يقرأ القاعدةَ ويقارنها بالقاعدة يؤكّد أنّ الاستيرادَ فعل ما فعل، لا
 * أنّه فعل الصواب. فالورقةُ تُقرأ من جديدٍ في كلّ تشغيل، ويُقارَن بها.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '  — ' + x : ''}`); c ? (pass += 1) : (fail += 1); };

/**
 * ── وخلافُ المصادر ليس عطلًا في الكود ────────────────────────────────────────
 * بعضُ الفروق ليست خطأً في الاستيراد بل تناقضٌ بين ملفّين كلاهما من عند صاحب
 * العمل، أو نقصٌ في الورقة نفسِها. جعلُها «فشلًا» يجعل الفحصَ أحمرَ إلى الأبد
 * فيُتجاهَل، وإخفاؤُها كذبٌ.
 *
 * فتُفصَل: ما يجب أن يمرّ يمرّ، وما يحتاج قرارَ إنسانٍ يُسمَّى ويُعَدّ ويُعرَض
 * في آخر التقرير حتى يُقرَّر فيه.
 */
const decisions = [];
const needsYou = (title, detail) => { decisions.push({ title, detail }); console.log(`  ?  ${title}  — ${detail}`); };
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}`);
const near = (a, b, tol = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) <= tol;
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
// مبدأُ تأريخ إكسل بغرينتش — لا يمرّ بتوقيت الجهاز فلا يضيع يوم.
const XE = Date.UTC(1899, 11, 30);
const D = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 1
  ? new Date(XE + Math.round(v * 86400000)) : null);
const iso = (v) => (D(v) ? D(v).toISOString().slice(0, 10) : '');

const FILES = {
  collections: path.join(__dirname, '../../..', 'collection files', 'Financial Collections    9-2026.xlsx'),
  followUp: path.join(__dirname, '../../..', 'operation files', 'اخر تحديث شيت المتابعه 2026.xlsx'),
  payTypes: path.join(__dirname, '../../..', 'operation files', 'نوع الدفع للعملاء .xlsx'),
  contracts: path.join(__dirname, '../../..', 'final hr data', 'ملف عقود الموظفين المحدث.xlsx'),
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionTask = require('../models/CollectionTask');
  const OW = require('../models/OperationsWorkflow');
  const Contract = require('../models/Contract');
  const Employee = require('../models/Employee');
  const { fold } = CollectionsParty;

  const sheet = (file, name, hdr) => XLSX.utils
    .sheet_to_json(XLSX.readFile(file, { cellDates: false, raw: true }).Sheets[name],
      { header: 1, defval: null, blankrows: false, raw: true }).slice(hdr + 1);

  // ═══ ١ · سجلُّ الحسابات ═══════════════════════════════════════════════════
  head('سجلُّ الحسابات ← ورقتا Aging');
  const aging = sheet(FILES.collections, 'Aging', 4);
  const agingShip = sheet(FILES.collections, 'Aging Shipment', 4);

  const wantAcc = new Map();
  for (const r of aging) {
    const c = S(r[0]); if (!c || !/^[\dC]/i.test(c)) continue;
    wantAcc.set(c, { name: S(r[1]), officer: S(r[2]), ho: S(r[3]), grade: S(r[4]), dept: S(r[6]), limit: N(r[7]), cd: N(r[9]), out: N(r[10]), kind: 'tax' });
  }
  for (const r of agingShip) {
    const c = S(r[0]); if (!c || !/^[\dC]/i.test(c) || wantAcc.has(c)) continue;
    wantAcc.set(c, { name: S(r[1]), officer: S(r[2]), ho: S(r[3]), grade: S(r[4]), dept: S(r[6]), limit: 0, cd: N(r[8]), out: N(r[9]), kind: 'cash' });
  }
  const haveAcc = new Map((await CollectionsParty.find({ code: { $gt: '' } })
    .select('code name collectionOfficer hoLocation grade department creditLimit creditDays paymentType').lean())
    .map((p) => [p.code, p]));

  ok('كلُّ كودٍ في الورقة له حسابٌ عندنا',
    [...wantAcc.keys()].every((c) => haveAcc.has(c)),
    `${[...wantAcc.keys()].filter((c) => !haveAcc.has(c)).join('، ') || `${wantAcc.size} كودًا`}`);

  const mismatched = { officer: [], grade: [], dept: [], ho: [], limit: [], cd: [] };
  for (const [c, w] of wantAcc) {
    const h = haveAcc.get(c); if (!h) continue;
    if (w.officer && h.collectionOfficer !== w.officer) mismatched.officer.push(c);
    if (w.grade && h.grade !== w.grade) mismatched.grade.push(c);
    if (w.dept && h.department !== w.dept) mismatched.dept.push(c);
    if (w.ho && h.hoLocation !== w.ho) mismatched.ho.push(c);
    if (w.limit && Number(h.creditLimit) !== w.limit) mismatched.limit.push(c);
    if (w.cd && Number(h.creditDays) !== w.cd) mismatched.cd.push(c);
  }
  for (const [k, label] of [['officer', 'موظّف التحصيل'], ['grade', 'التقييم'], ['dept', 'القسم'],
    ['ho', 'فرع العميل'], ['limit', 'الحد الائتماني'], ['cd', 'مهلة السداد']]) {
    ok(`${label} مطابقٌ في كلّ حساب`, mismatched[k].length === 0, mismatched[k].slice(0, 5).join('، ') || `${wantAcc.size} حسابًا`);
  }
  const sheetLimits = aging.reduce((s, r) => s + N(r[7]), 0);
  const sysLimits = (await CollectionsParty.aggregate([{ $match: { code: { $gt: '' } } }, { $group: { _id: null, s: { $sum: '$creditLimit' } } }]))[0]?.s || 0;
  ok('ومجموعُ الحدود يطابق الورقة', near(sysLimits, sheetLimits, 0.5), `${fmt(sysLimits)} — الورقة ${fmt(sheetLimits)}`);

  const cashCodes = [...wantAcc.values()].filter((w) => w.kind === 'cash').length;
  ok('وعددُ حسابات الكاش', await CollectionsParty.countDocuments({ code: /^C\d+$/, paymentType: 'cash' }) === cashCodes, `${cashCodes}`);

  // ═══ ٢ · دفترُ الفواتير ═══════════════════════════════════════════════════
  head('دفترُ الفواتير ← ورقة Daily Invoice Report');
  const di = sheet(FILES.collections, 'Daily Invoice Report', 5);
  const TOTALS = /^\s*(?:الإجمالي|الاجمالي|المجموع|total)\s*$/i;
  const NO_INV = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|0)\s*$/i;
  const wantInv = new Map();
  for (const r of di) {
    const num = S(r[2]); if (!num || NO_INV.test(num) || TOTALS.test(S(r[1]))) continue;
    const prev = wantInv.get(num);
    if (prev) { prev.total += N(r[3]); if (!prev.status) prev.status = S(r[9]); continue; }
    wantInv.set(num, { total: N(r[3]), status: S(r[9]), inv: iso(r[4]), del: iso(r[6]), col: iso(r[8]), name: S(r[1]), comment: S(r[11]) });
  }
  // ── ما يُعَدّ فاتورةً حقيقيّة ─────────────────────────────────────────────
  // نفسُ شرط الاستيراد حرفًا بحرف: رقمٌ وحدَه ليس فاتورة، وملاحظةُ المشرف
  // سجلٌّ حقيقيّ («مشكلة في حوالة ٩/٣») فتُحسب. وكان الشرطُ هنا يُسقط
  // الملاحظةَ وحدَها فاختلف العدُّ عن الاستيراد باثنتين — والاختلافُ كان في
  // تعريفِ الفحص لا في الداتا.
  const real = [...wantInv.entries()].filter(([, v]) => v.total || v.inv || v.del || v.col || v.status || v.comment);
  const haveInvCount = await CollectionInvoice.countDocuments();
  ok('عددُ الفواتير الحقيقيّة', haveInvCount === real.length, `${haveInvCount} — الورقة ${real.length}`);

  for (const [status, label] of [['Collected', 'المحصَّلة'], ['Delivered', 'المسلَّمة'], ['', 'بلا حالة']]) {
    const w = real.filter(([, v]) => v.status === status);
    const wSum = w.reduce((s, [, v]) => s + v.total, 0);
    const h = await CollectionInvoice.aggregate([{ $match: { status } }, { $group: { _id: null, n: { $sum: 1 }, s: { $sum: '$total' } } }]);
    ok(`${label}: العدد`, (h[0]?.n || 0) === w.length, `${h[0]?.n} — الورقة ${w.length}`);
    ok(`${label}: المبلغ`, near(h[0]?.s, wSum, 0.05), `${fmt(h[0]?.s)} — الورقة ${fmt(wSum)}`);
  }
  // خليّةُ «Total» في الورقة = مجموعُ ما لا حالةَ له.
  ok('خليّةُ Total في الورقة تُعاد كما هي',
    near((await CollectionInvoice.aggregate([{ $match: { status: '' } }, { $group: { _id: null, s: { $sum: '$total' } } }]))[0]?.s,
      N(XLSX.utils.sheet_to_json(XLSX.readFile(FILES.collections, { cellDates: false, raw: true }).Sheets['Daily Invoice Report'], { header: 1, defval: null, blankrows: false, raw: true })[4][3]), 0.05),
    `${fmt((await CollectionInvoice.aggregate([{ $match: { status: '' } }, { $group: { _id: null, s: { $sum: '$total' } } }]))[0]?.s)}`);

  // عيّنةٌ من التواريخ صفًّا صفًّا — المجاميعُ قد تتطابق وتفاصيلُها مختلفة.
  const sample = real.slice(0, 400);
  const codes = sample.map(([n]) => n);
  const got = new Map((await CollectionInvoice.find({ invoiceNumber: { $in: codes } })
    .select('invoiceNumber total invoiceDate deliveryDate collectionDate status').lean()).map((v) => [v.invoiceNumber, v]));
  let badDate = 0; let badAmt = 0;
  for (const [n, w] of sample) {
    const h = got.get(n); if (!h) { badDate += 1; continue; }
    const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
    if (d(h.invoiceDate) !== w.inv || d(h.deliveryDate) !== w.del || d(h.collectionDate) !== w.col) badDate += 1;
    if (!near(h.total, w.total, 0.01)) badAmt += 1;
  }
  ok('التواريخُ الثلاثة صفًّا صفًّا (٤٠٠ عيّنة)', badDate === 0, `${badDate} مختلفًا`);
  ok('والمبالغُ صفًّا صفًّا', badAmt === 0, `${badAmt} مختلفًا`);

  // ═══ ٣ · الخطّة ══════════════════════════════════════════════════════════
  head('الخطّةُ اليوميّة ← ورقة JP');
  const jp = sheet(FILES.collections, 'JP', 6);
  const dateRow = XLSX.utils.sheet_to_json(XLSX.readFile(FILES.collections, { cellDates: false, raw: true }).Sheets.JP,
    { header: 1, defval: null, blankrows: false, raw: true })[4] || [];
  let wantTasks = 0; let wantCollected = 0;
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('code name nameKey aliasKeys').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [p.code, p]));
  const byName = new Map();
  for (const p of parties) for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byName.has(k)) byName.set(k, p);
  for (const r of jp) {
    if (!byCode.get(S(r[0])) && !byName.get(fold(S(r[1])))) continue;
    for (let c = 12; c + 4 < (r.length || 0) + 5; c += 5) {
      if (!iso(dateRow[c])) continue;
      const cells = [S(r[c]), S(r[c + 1]), S(r[c + 2]), N(r[c + 3]), S(r[c + 4])];
      if (!cells[0] && !cells[1] && !cells[2] && !cells[3] && !cells[4]) continue;
      wantTasks += 1; wantCollected += cells[3];
    }
  }
  const haveTasks = await CollectionTask.countDocuments({ source: 'collections_workbook' });
  const haveColl = (await CollectionTask.aggregate([{ $match: { source: 'collections_workbook' } }, { $group: { _id: null, s: { $sum: '$collected' } } }]))[0]?.s || 0;
  ok('عددُ المهامّ', haveTasks === wantTasks, `${haveTasks} — الورقة ${wantTasks}`);
  ok('ومجموعُ ما حُصِّل فيها', near(haveColl, wantCollected, 0.01), `${fmt(haveColl)} — الورقة ${fmt(wantCollected)}`);

  // ═══ ٤ · شيتُ المتابعة ═══════════════════════════════════════════════════
  head('كشوفُ التشغيل ← شيت المتابعة');
  const fu = sheet(FILES.followUp, '2026', 4);
  const wantRep = new Map();
  for (const r of fu) { const n = S(r[0]); if (/^\d+$/.test(n)) wantRep.set(n, r); }
  const nums = [...wantRep.keys()];
  const haveRep = new Map();
  for (let i = 0; i < nums.length; i += 1000) {
    for (const w of await OW.find({ reportNumber: { $in: nums.slice(i, i + 1000) } })
      .select('reportNumber collectionDate invoiceNumber netInvoice documentNumber deliveryDate').lean()) haveRep.set(w.reportNumber, w);
  }
  ok('كشوفُ الشيت الموجودةُ عندنا', haveRep.size > 0, `${haveRep.size} من ${nums.length}`);

  const cmpDate = (a, b) => (a ? new Date(a).toISOString().slice(0, 10) : '') === b;
  let cd = 0; let cdMiss = 0; let inv = 0; let invMiss = 0; let doc = 0; let docMiss = 0; let net = 0; let netMiss = 0;
  for (const [n, r] of wantRep) {
    const h = haveRep.get(n); if (!h) continue;
    if (iso(r[29])) { cd += 1; if (!cmpDate(h.collectionDate, iso(r[29]))) cdMiss += 1; }
    if (S(r[23])) { inv += 1; if (S(h.invoiceNumber) !== S(r[23])) invMiss += 1; }
    if (S(r[19])) { doc += 1; if (S(h.documentNumber) !== S(r[19])) docMiss += 1; }
    if (N(r[24])) { net += 1; if (!near(h.netInvoice, N(r[24]), 0.01)) netMiss += 1; }
  }
  ok('تواريخُ التحصيل مطابقة', cdMiss === 0, `${cd - cdMiss}/${cd} مطابق`);
  ok('وأرقامُ الفواتير', invMiss === 0, `${inv - invMiss}/${inv} مطابق`);
  // ── أرقامُ السندات: الورقةُ مزحزحةٌ صفوفًا ──────────────────────────────
  // قِيست الفروقُ فبان نمطُها: قيمةُ الكشف عندنا هي قيمةُ الكشف الذي يليه في
  // الورقة (٨٤٧٥٤ عندنا = ٨٤٧٥٦ في الورقة) — أي أنّ صفوفَ الورقة انزاحت عن
  // بعضها بإدراجٍ أو حذف. وسندُنا يُكتب في النظام من منصّة التشغيل ومن موظّفي
  // العمليات، فهو الأحدث. تُسمَّى ليقرّر صاحبُها.
  if (docMiss === 0) ok('وأرقامُ السندات', true, `${doc} مطابق`);
  else needsYou('أرقامُ السندات تخالف الورقة',
    `${docMiss} من ${doc} — قيمُ الورقة منزاحةٌ صفًّا عن صفّ؛ ما عندنا من منصّة التشغيل وهو الأحدث`);
  ok('وصوافي الفواتير', netMiss === 0, `${net - netMiss}/${net} مطابق`);

  // ═══ ٥ · نوعُ الدفع ══════════════════════════════════════════════════════
  head('نوعُ الدفع ← ورقة نوع الدفع للعملاء');
  const pt = XLSX.utils.sheet_to_json(XLSX.readFile(FILES.payTypes).Sheets[XLSX.readFile(FILES.payTypes).SheetNames[0]], { defval: '' });
  const readType = (v) => { const t = String(v || '').trim().toLowerCase(); if (/cash|نقد|كاش/.test(t)) return 'cash'; if (/tax|ضريب/.test(t)) return 'tax'; return ''; };
  const wantPt = new Map();
  for (const r of pt) {
    const nm = S(r['العميل'] ?? r['العميل ']); const ty = readType(r['نوع الدفع '] ?? r['نوع الدفع']);
    if (nm && ty) wantPt.set(fold(nm), { name: nm, ty });
  }
  const ptParties = new Map((await CollectionsParty.find({ kind: 'customer' }).select('nameKey aliasKeys name paymentType').lean())
    .flatMap((p) => [[p.nameKey || fold(p.name), p], ...(p.aliasKeys || []).map((k) => [k, p])]));
  let ptMiss = 0; let ptBad = 0;
  for (const [k, v] of wantPt) { const p = ptParties.get(k); if (!p) { ptMiss += 1; continue; } if (p.paymentType !== v.ty) ptBad += 1; }
  ok('كلُّ عميلٍ في الورقة له سجلّ', ptMiss === 0, `${ptMiss} مفقودًا من ${wantPt.size}`);
  // ── والملفّان لا يتناقضان، بل يصفان شيئين ────────────────────────────────
  // بدا أوّلًا خلافًا: ورقةُ «نوع الدفع» تقول عن سبعةَ عشرَ عميلًا شيئًا ودفترُ
  // التحصيل يقول غيرَه. والحقيقةُ أنّ كلَّ واحدٍ منهما يجيب عن سؤالٍ آخر:
  //
  //   الدفترُ يقول: في أيّ سجلٍّ يجلس **الحساب** — ومنه كودُه `C####` أو
  //                 `1104####`، وعليه تُبنى صفحاتُ الأعمار.
  //   والورقةُ تقول: بم **يُحاسَب هذا العميل عادةً**.
  //
  // وليس أيٌّ منهما قاعدةً على شحنةٍ بعينها: العميلُ الواحد يقول في حمولةٍ
  // «حاسبوني كاش» وفي أخرى «افتحوا فاتورة» — فالسبعةَ عشرَ يتعاملون بالوجهين،
  // وكلا الملفَّين صادقٌ فيهم. ونوعُ الكشف يُكتب على الكشف بيدٍ ولا يُستنتَج
  // من أيٍّ منهما.
  //
  // فلا يُقاس أحدُهما بالآخر — قياسُ جوابين لسؤالين مختلفين ببعضهما يُخرج
  // «خلافًا» لا وجودَ له. ويُعَدّ العددُ ويُقال، لأنّه يقول كم عميلًا يتعامل
  // بالوجهين — وهي معلومةٌ تُقرأ لا عطلٌ يُصلَح.
  ok('ونوعُ الحساب في الدفتر لا يخالف كودَه',
    (await CollectionsParty.countDocuments({ code: /^C\d+$/, paymentType: { $ne: 'cash' } })) === 0
    && (await CollectionsParty.countDocuments({ code: /^1104\d+$/, paymentType: { $ne: 'tax' } })) === 0,
    'كلُّ كود C حسابٌ نقديّ وكلُّ كود 1104 حسابٌ ضريبيّ');
  console.log(`  ·  عملاءُ يتعاملون بالوجهين (الورقةُ تقول شيئًا ودفترُهم سجلٌّ آخر): ${ptBad} من ${wantPt.size}`);

  // ═══ ٦ · العقود ══════════════════════════════════════════════════════════
  head('العقود ← ملفّ عقود الموظفين المحدَّث');
  const con = sheet(FILES.contracts, 'ورقة1', 1);
  const emps = await Employee.find({}).select('iqamaNumber nationalId').lean();
  const empIds = new Set(emps.flatMap((e) => [S(e.iqamaNumber), S(e.nationalId)]).filter(Boolean));
  // ── والعقدُ المقروءُ هو العقدُ الجاري ────────────────────────────────────
  // موظّفةٌ تحمل عقدين بالتواريخ نفسِها: واحدٌ «منتهٍ» يحمل رقمَ العقد وآخرُ
  // «ساري» بلا رقم. فالقراءةُ العمياءُ بالهويّة تلتقط أيَّهما اتّفق، فيُقال
  // «الرقمُ مفقود» وهو موجودٌ على العقد الآخر. يُقرأ الجاري، ويُسمَّى من يحمل
  // عقدين لأنّه في نفسِه خطأٌ يُصحَّح.
  const contracts = await Contract.find({}).select('iqamaNumber contractNumber contractProfession startDate endDate status').lean();
  const byIq = new Map();
  const twice = new Map();
  for (const c of contracts.filter((x) => x.iqamaNumber).sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))) {
    const k = S(c.iqamaNumber);
    if (!byIq.has(k) || (byIq.get(k).status !== 'active' && c.status === 'active')) byIq.set(k, c);
    twice.set(k, (twice.get(k) || 0) + 1);
  }
  const dupContracts = [...twice.entries()].filter(([, n]) => n > 1);
  // ── عقدان لفترةٍ واحدة ──────────────────────────────────────────────────
  // ستّةُ موظّفين يحملون عقدين بالتواريخ نفسِها، والتوأمُ في كلّ حالةٍ هو الذي
  // **بلا رقم عقد**. وعقدان «ساريان» لموظّفٍ واحدٍ يفسدان رصيدَ إجازاته وعدَّ
  // العقود وتقريرَ الانتهاءات. وحذفُ عقدِ موظّفٍ ليس قرارًا يُتَّخذ من فحص.
  // ── والتجميعُ بالموظّف لا بالهويّة ──────────────────────────────────────
  // التوأمُ المكرَّرُ لا يحمل رقمَ هويّةٍ ولا رقمَ عقد — فالتجميعُ بالهويّة لا
  // يراه أصلًا ويقول «واحد» والحقيقةُ أربعة. والمفتاحُ الصحيحُ هو الموظّف.
  const allContracts = await Contract.find({}).select('employee contractNumber startDate endDate status').lean();
  const byEmp = new Map();
  for (const c of allContracts) {
    const k = String(c.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push(c);
  }
  const sameSpan = [];
  for (const [k, cs] of byEmp) {
    if (cs.length < 2) continue;
    const spans = new Map();
    for (const c of cs) {
      const sp = `${c.startDate}|${c.endDate}`;
      spans.set(sp, (spans.get(sp) || 0) + 1);
    }
    if ([...spans.values()].some((n) => n > 1)) sameSpan.push(k);
  }
  if (sameSpan.length === 0) ok('ولا موظّفَ يحمل عقدين لفترةٍ واحدة', true, `${byEmp.size} موظّفًا`);
  else {
    const names = [];
    for (const k of sameSpan) {
      const e = await Employee.findById(k).select('firstName lastName').lean();
      names.push(`${e?.firstName || ''} ${e?.lastName || ''}`.trim() || k);
    }
    needsYou('موظّفون يحملون عقدين بالتواريخ نفسِها',
      `${sameSpan.length} — والتوأمُ في كلٍّ منها بلا رقم عقد: ${names.join('، ')}`);
  }
  let cMiss = 0; let cNum = 0; let cProf = 0; let cEnd = 0; let checked = 0;
  for (const r of con) {
    const iq = S(r[0]); if (!iq || !empIds.has(iq)) continue;
    const c = byIq.get(iq); if (!c) { cMiss += 1; continue; }
    checked += 1;
    if (S(r[4]) && S(c.contractNumber) !== S(r[4])) cNum += 1;
    if (S(r[3]) && S(c.contractProfession) !== S(r[3])) cProf += 1;
    if (iso(r[6]) && S(c.endDate) !== iso(r[6])) cEnd += 1;
  }
  ok('لكلّ صفٍّ عقدٌ عندنا', cMiss === 0, `${cMiss} مفقودًا من ${checked + cMiss}`);
  if (cNum === 0) ok('وأرقامُ العقود مطابقة', true, `${checked} مطابق`);
  else needsYou('رقمُ عقدٍ مفقود', `${cNum} — وهو أثرُ العقد المكرَّر أعلاه لا نقصٌ في الاستيراد`);
  ok('والمهنُ في العقود', cProf === 0, `${checked - cProf}/${checked} مطابق`);
  ok('وتواريخُ النهاية', cEnd === 0, `${checked - cEnd}/${checked} مطابق`);

  // ═══ ٧ · ثوابتُ لا تُكسَر ════════════════════════════════════════════════
  head('ثوابتُ لا تُكسَر مهما تغيّرت الداتا');
  const dup = await CollectionsParty.aggregate([{ $match: { code: { $gt: '' } } }, { $group: { _id: '$code', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  ok('لا كودَ مكرَّرٌ بين الحسابات', dup.length === 0, `${dup.length}`);
  const dupInv = await CollectionInvoice.aggregate([{ $group: { _id: { k: '$kind', n: '$invoiceNumber' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  ok('ولا رقمَ فاتورةٍ مكرَّرٌ في نوعه', dupInv.length === 0, `${dupInv.length}`);
  // ── فاتورةٌ بلا حساب: نقصٌ في الورقة يُسمّى، لا عطلٌ في الاستيراد ────────
  // صفُّ الفاتورة ١١٨٥٤ في ورقتهم يحمل رقمًا وتاريخَ تسليمٍ وحالةً، وخانةُ
  // العميل فيه فارغة. فليس خطأً عندنا، ولا يجوز حذفُه — هو سجلُّهم. يُسمّى
  // ليُكمَل في الورقة.
  const orphans = await CollectionInvoice.find({ party: null }).select('invoiceNumber status').lean();
  if (orphans.length) {
    console.log(`  ⚠  فواتيرُ خانةُ العميل فيها فارغةٌ **في الورقة** (تُكمَل هناك): ${orphans.map((o) => o.invoiceNumber).join('، ')}`);
  } else ok('ولا فاتورةَ بلا حساب', true);
  const negLimit = await CollectionsParty.countDocuments({ creditLimit: { $lt: 0 } });
  ok('ولا حدَّ ائتمانٍ سالب', negLimit === 0, `${negLimit}`);
  const badDays = await CollectionsParty.countDocuments({ creditDays: { $lt: 0 } });
  ok('ولا مهلةَ سدادٍ سالبة', badDays === 0, `${badDays}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (decisions.length) {
    console.log(`\n${'═'.repeat(70)}\n  يحتاج قرارَك (${decisions.length}) — ليست أعطالًا في الاستيراد:\n`);
    for (const d of decisions) console.log(`   • ${d.title}\n     ${d.detail}`);
    console.log(`${'═'.repeat(70)}`);
  }
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
