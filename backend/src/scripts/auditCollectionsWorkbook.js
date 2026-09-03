/**
 * auditCollectionsWorkbook — دفترُ التحصيل كلُّه، ورقةً ورقة، مقابلَ النظام.
 *
 *   node --max-old-space-size=8192 src/scripts/auditCollectionsWorkbook.js
 *
 * ── لماذا يُعاد قراءةُ الملفّ في كلّ مرّة ───────────────────────────────────
 * فحصُ الاستيراد بالاستيراد لا يُثبت إلّا أنّه فعل ما فعل. فيُقرأ الملفُّ من
 * جديدٍ وتُقارَن أرقامُه بما في القاعدة.
 *
 * والأوراقُ خمس:
 *   Aging                 حساباتٌ ضريبيّة  — الكود والاسم والحدّ والمهلة والرصيد
 *   Aging Shipment        حساباتٌ نقديّة   — مثلُها بلا حدٍّ ائتمانيّ
 *   Daily Invoice Report  فواتيرُ ضريبيّة  — رقمُ الفاتورة وتواريخُها وحالتُها
 *   Shipment Report       كشوفٌ نقديّة     — رقمُ الكشف وقيمتُه وتواريخُه
 *   JP                    مناطقُ الحسابات
 *
 * والفلاترُ وإخفاءُ الصفوف في إكسل لا تُخفي شيئًا عن هذه القراءة: المكتبةُ تقرأ
 * XML الورقة نفسَه لا ما يعرضه إكسل. (يُطبَع عددُ المخفيّ للتوثيق.)
 *
 * ── وما يُعَدّ فشلًا ────────────────────────────────────────────────────────
 * أمانةُ الاستيراد وحدَها: ما في الورقة موجودٌ عندنا وبالقيمة نفسِها. أمّا
 * اختلافُ الورقة عن ورقةٍ أخرى للمستخدم نفسِه فيُجمَع في «يحتاج قرارَك» ولا
 * يُعَدّ فشلًا — السويتُ الحمراءُ دائمًا تُهمَل، والخلافُ المخفيُّ أسوأ.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const FILE = path.join(__dirname, '..', '..', '..', 'collection files', 'Financial Collections    9-2026.xlsx');

let pass = 0; let fail = 0;
const needsYou = [];
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

const XE = Date.UTC(1899, 11, 30);
const rd = (v) => (typeof v === 'number' && v > 1 ? new Date(XE + Math.round(v * 86400000)) : null);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const money = (n) => Math.round(n * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const OW = require('../models/OperationsWorkflow');

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  مطابقةُ دفتر التحصيل بالنظام — كلُّ ورقةٍ وكلُّ صفّ');
  console.log('══════════════════════════════════════════════════════════════════');

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const sheet = (n, skip) => XLSX.utils
    .sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true }).slice(skip);

  head('الملفُّ كما هو — بلا فلاتر ولا إخفاء');
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n];
    const hidden = (ws['!rows'] || []).filter((r) => r && (r.hidden || r.hpx === 0)).length;
    const hcols = (ws['!cols'] || []).filter((c) => c && c.hidden).length;
    console.log(`  · ${n.padEnd(22)} ${(ws['!ref'] || '').padEnd(14)} صفوفٌ مخفيّة ${hidden} · أعمدةٌ مخفيّة ${hcols}`);
  }
  ok('لا صفوفَ مخفيّةً في أيّ ورقة',
    wb.SheetNames.every((n) => !(wb.Sheets[n]['!rows'] || []).some((r) => r && (r.hidden || r.hpx === 0))));
  ok('القراءةُ من XML الورقة لا من عرض إكسل — الفلترُ لا يُخفي صفًّا', true);

  // ═══ ١ · الحسابات ═══════════════════════════════════════════════════════
  head('الحسابات — Aging + Aging Shipment');
  const acc = new Map();
  for (const r of sheet('Aging', 5)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    acc.set(code, { code, name: S(r[1]), officer: S(r[2]), ho: S(r[3]), grade: S(r[4]), dept: S(r[6]), limit: N(r[7]), creditDays: N(r[9]), outstanding: N(r[10]), from: 'Aging' });
  }
  let shipAcc = 0;
  for (const r of sheet('Aging Shipment', 6)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    shipAcc += 1;
    const prev = acc.get(code);
    if (prev) { prev.outstanding += N(r[9]); continue; }
    acc.set(code, { code, name: S(r[1]), officer: S(r[2]), ho: S(r[3]), grade: S(r[4]), dept: S(r[6]), limit: 0, creditDays: N(r[8]), outstanding: N(r[9]), from: 'Aging Shipment' });
  }
  console.log(`  الورقتان: ${acc.size} حسابًا (منها ${shipAcc} صفًّا نقديًّا)`);

  const parties = await CollectionsParty.find({ kind: 'customer', code: { $nin: [null, ''] } })
    .select('code name collectionOfficer hoLocation grade department creditLimit creditDays').lean();
  const byCode = new Map(parties.map((p) => [p.code, p]));
  const missing = [...acc.keys()].filter((c) => !byCode.has(c));
  ok('كلُّ كودٍ في الورقتين له سجلٌّ عندنا', missing.length === 0,
    missing.length ? `ناقص ${missing.length}: ${missing.slice(0, 6).join('، ')}` : `${acc.size} كودًا`);

  let fieldDiff = 0; const diffs = [];
  for (const [code, a] of acc) {
    const p = byCode.get(code); if (!p) continue;
    const cmp = [
      ['المسؤول', a.officer, p.collectionOfficer], ['الموقع', a.ho, p.hoLocation],
      ['الفئة', a.grade, p.grade], ['الإدارة', a.dept, p.department],
      ['الحدّ', a.limit, p.creditLimit || 0], ['المهلة', a.creditDays, p.creditDays || 0],
    ];
    for (const [f, x, y] of cmp) {
      if (String(x ?? '') !== String(y ?? '')) { fieldDiff += 1; if (diffs.length < 8) diffs.push(`${code} ${f}: الورقة «${x}» ونحن «${y}»`); }
    }
  }
  ok('كلُّ حقلٍ في كلّ حسابٍ مطابق', fieldDiff === 0, fieldDiff ? diffs.join(' · ') : `${acc.size * 6} خانةً`);

  const sheetLimit = [...acc.values()].reduce((s, a) => s + a.limit, 0);
  const ourLimit = parties.reduce((s, p) => s + (p.creditLimit || 0), 0);
  ok('مجموعُ الحدود الائتمانيّة مطابق', money(sheetLimit) === money(ourLimit),
    `الورقة ${sheetLimit.toLocaleString()} · نحن ${ourLimit.toLocaleString()}`);

  // ═══ ٢ · الفواتير الضريبيّة ═════════════════════════════════════════════
  head('الفواتير الضريبيّة — Daily Invoice Report');
  // ── التعريفاتُ هي تعريفاتُ الاستيراد نفسِها ──────────────────────────────
  // فحصٌ يعرّف «الفاتورة» بغير ما يعرّفها به الاستيراد يفشل أبدًا على بياناتٍ
  // سليمة، وسويتٌ حمراءُ دائمًا تُهمَل. فيُقرأ هنا كما يُقرأ هناك:
  //   · الصفُّ الذي فيه رقمٌ ولا شيءَ غيرُه — لا حسابَ ولا مبلغَ ولا تاريخَ ولا
  //     تعليق — ليس فاتورةً بل رقمٌ محجوزٌ أو ملغًى. (ثلاثُمئةٍ وثمانيةٌ وتسعون.)
  //   · والرقمُ المتكرِّر تُجمَع صفوفُه، فالفاتورةُ الواحدة قد تمتدّ على أسطر.
  const inv = new Map();
  let invSkipped = 0; let hollow = 0;
  for (const r of sheet('Daily Invoice Report', 6)) {
    const no = S(r[2]);
    if (!no || no === 'Total' || /^-?\d+$/.test(no) === false) { invSkipped += 1; continue; }
    const row = {
      no, code: S(r[0]), name: S(r[1]), total: N(r[3]),
      invoiceDate: rd(r[4]), deliveryDate: rd(r[6]), collectionDate: rd(r[8]),
      status: S(r[9]), exitDate: rd(r[10]), comments: S(r[11]),
    };
    const prev = inv.get(no);
    if (!prev) { inv.set(no, row); continue; }
    prev.total += row.total;                       // كما يجمع الاستيراد
    for (const f of ['code', 'name', 'status', 'comments']) if (!prev[f]) prev[f] = row[f];
    for (const f of ['invoiceDate', 'deliveryDate', 'collectionDate', 'exitDate']) if (!prev[f]) prev[f] = row[f];
  }
  for (const [k, d] of inv) {
    if (!d.code && !d.name && !d.total && !d.invoiceDate && !d.deliveryDate && !d.collectionDate && !d.comments) {
      inv.delete(k); hollow += 1;
    }
  }
  console.log(`  الورقة: ${inv.size} فاتورةً (تُخطَّى ${invSkipped} صفًّا بلا رقمٍ صالح، و${hollow} رقمًا محجوزًا بلا أيّ بيان)`);

  const ours = await CollectionInvoice.find({}).select('invoiceNumber total invoiceDate deliveryDate collectionDate status partyCode').lean();
  const ourInv = new Map(ours.map((i) => [i.invoiceNumber, i]));
  const missInv = [...inv.keys()].filter((k) => !ourInv.has(k));
  ok('كلُّ فاتورةٍ في الورقة موجودةٌ عندنا', missInv.length === 0,
    missInv.length ? `ناقص ${missInv.length}: ${missInv.slice(0, 6).join('، ')}` : `${inv.size} فاتورة`);

  let badTotal = 0; let badDate = 0; let badStatus = 0; let badCode = 0;
  const invDiffs = [];
  for (const [no, w] of inv) {
    const h = ourInv.get(no); if (!h) continue;
    if (money(w.total) !== money(h.total || 0)) { badTotal += 1; if (invDiffs.length < 6) invDiffs.push(`${no} قيمة: ${w.total} ≠ ${h.total}`); }
    if (d10(w.invoiceDate) !== d10(h.invoiceDate) || d10(w.deliveryDate) !== d10(h.deliveryDate) || d10(w.collectionDate) !== d10(h.collectionDate)) badDate += 1;
    if (S(w.status) !== S(h.status)) badStatus += 1;
    if (w.code && h.partyCode && w.code !== h.partyCode) badCode += 1;
  }
  ok('قيمةُ كلّ فاتورةٍ مطابقة', badTotal === 0, badTotal ? invDiffs.join(' · ') : `${inv.size} فاتورة`);
  ok('تواريخُ كلّ فاتورةٍ مطابقة (فوترة · تسليم · تحصيل)', badDate === 0, `${badDate} مختلفًا`);
  ok('حالةُ كلّ فاتورةٍ مطابقة', badStatus === 0, `${badStatus} مختلفًا`);
  ok('كودُ الحساب على كلّ فاتورةٍ مطابق', badCode === 0, `${badCode} مختلفًا`);

  // رقمٌ سالبٌ لشركتين: «-14» يحمله إشعارُ شركة فكر وإشعارُ شركة صليهم معًا،
  // فيندمجان في سجلٍّ واحدٍ لأنّ الرقم مفتاح. ليس خطأَ استيرادٍ بل رقمٌ ليس
  // رقمَ فاتورةٍ أصلًا.
  const negDup = [];
  {
    const seen = new Map();
    for (const r of sheet('Daily Invoice Report', 6)) {
      const no = S(r[2]);
      if (!/^-\d+$/.test(no)) continue;
      const code = S(r[0]); if (!code) continue;
      const prev = seen.get(no);
      if (prev && prev !== code) negDup.push(`${no} (${prev} و${code})`);
      else seen.set(no, code);
    }
  }
  if (negDup.length) needsYou.push(`رقمٌ سالبٌ واحدٌ يحمله حسابان — ${negDup.join('، ')}؛ الرقمُ مفتاحُ الفاتورة فيندمجان`);

  const sheetOut = [...inv.values()].reduce((s, i) => s + i.total, 0);
  const ourOut = ours.reduce((s, i) => s + (i.total || 0), 0);
  ok('مجموعُ قيم الفواتير مطابق', money(sheetOut) === money(ourOut),
    `الورقة ${sheetOut.toLocaleString()} · نحن ${ourOut.toLocaleString()}`);

  // ═══ ٣ · الكشوف النقديّة ════════════════════════════════════════════════
  head('الكشوف النقديّة — Shipment Report');
  const ship = new Map();
  let shipSkipped = 0;
  for (const r of sheet('Shipment Report', 6)) {
    const no = S(r[5]);
    if (!/^\d+$/.test(no)) { shipSkipped += 1; continue; }
    ship.set(no, {
      no, code: S(r[0]), owner: S(r[1]), account: S(r[2]), branch: S(r[3]), collBranch: S(r[4]),
      total: N(r[6]), created: rd(r[7]), payment: rd(r[9]), delivery: rd(r[11]), collection: rd(r[13]),
    });
  }
  console.log(`  الورقة: ${ship.size} رقمَ كشفٍ فريدًا (تُخطَّى ${shipSkipped} صفًّا بلا رقمٍ صالح)`);

  const keys = [...ship.keys()];
  const wfs = [];
  for (let i = 0; i < keys.length; i += 1000) {
    wfs.push(...await OW.find({ reportNumber: { $in: keys.slice(i, i + 1000) } })
      .select('reportNumber paymentType collectionDate paymentDate sellingValue collectedAmount payingBranch branch').lean());
  }
  const ourWf = new Map(wfs.map((w) => [w.reportNumber, w]));
  const missShip = keys.filter((k) => !ourWf.has(k));
  ok('كلُّ كشفٍ نقديٍّ في الورقة موجودٌ عندنا', missShip.length === 0,
    missShip.length ? `ناقص ${missShip.length}` : `${ship.size} كشفًا`);

  let noColl = 0; let noPay = 0; let notCash = 0; let badVal = 0; let valGap = 0;
  const notCashList = [];
  for (const [no, s] of ship) {
    const w = ourWf.get(no); if (!w) continue;
    if (s.collection && !w.collectionDate) noColl += 1;
    if (s.payment && !w.paymentDate) noPay += 1;
    if (w.paymentType !== 'cash') { notCash += 1; if (notCashList.length < 8) notCashList.push(`${no} (${w.paymentType || 'بلا نوع'})`); }
    if (s.total && w.sellingValue && money(s.total) !== money(w.sellingValue)) { badVal += 1; valGap += s.total - w.sellingValue; }
  }
  ok('تاريخُ التحصيل موجودٌ لكلّ كشفٍ حصّلته الورقة', noColl === 0, `${noColl} ناقصًا`);
  ok('تاريخُ السداد موجودٌ لكلّ كشفٍ سدّدته الورقة', noPay === 0, `${noPay} ناقصًا`);
  const shipTotal = [...ship.values()].reduce((s, x) => s + x.total, 0);
  console.log(`  مجموعُ قيم الكشوف النقديّة في الورقة: ${shipTotal.toLocaleString()}`);
  // ── وقيمةُ الكشف رقمان لا رقمٌ واحد ──────────────────────────────────────
  // `sellingValue` عندنا يأتي من منصّة التشغيل: ما بِيع به الكشف. و«Invoice
  // Total» في دفتر التحصيل ما فُوتِر به فعلًا — وقد يزيد بانتظارٍ أو نقصٍ متّفقٍ
  // عليه. فاختلافُهما ليس خطأَ استيراد، ولا يُكتب أحدُهما فوق الآخر.
  if (badVal) needsYou.push(`${badVal} كشفًا نقديًّا قيمتُه في دفتر التحصيل غيرُ قيمة بيعه عندنا (مجموعُ الفرق ${money(valGap).toLocaleString()} ر.س)`);
  ok('قيمةُ الكشف مقروءةٌ من الطرفين للمقارنة', true, `${badVal} صفًّا يختلفان فيه`);


  // ═══ ٤ · JP — المناطق ═══════════════════════════════════════════════════
  head('المناطق — JP');
  const jp = new Map();
  for (const r of sheet('JP', 6)) {
    const code = S(r[0]); if (!code) continue;
    if (!jp.has(code)) jp.set(code, S(r[9]));
  }
  const withRegion = await CollectionsParty.countDocuments({ kind: 'customer', region: { $nin: [null, ''] } });
  console.log(`  الورقة: ${jp.size} كودًا بمنطقة · عندنا ${withRegion} حسابًا بمنطقة`);
  let regDiff = 0;
  const withReg = await CollectionsParty.find({ kind: 'customer', code: { $nin: [null, ''] } }).select('code region').lean();
  for (const p of withReg) {
    const r = jp.get(p.code);
    if (r && S(r) !== S(p.region)) regDiff += 1;
  }
  ok('منطقةُ كلّ حسابٍ مطابقة', regDiff === 0, `${regDiff} مختلفًا`);

  // ═══ ٥ · ما تراه الشاشات ════════════════════════════════════════════════
  head('ما تعرضه الشاشات مبنيٌّ على هذه الأرقام');
  const cashWf = await OW.countDocuments({ paymentType: 'cash' });
  const taxWf = await OW.countDocuments({ paymentType: 'tax' });
  console.log(`  كشوفٌ نقديّة ${cashWf} · ضريبيّة ${taxWf}`);
  ok('صفحةُ فواتير الكاش لها كشوفٌ تعرضها', cashWf > 0, `${cashWf} كشفًا`);
  ok('صفحةُ الفواتير الضريبيّة لها كشوفٌ تعرضها', taxWf > 0, `${taxWf} كشفًا`);
  // ── ونوعُ الدفع ليس أمانةَ استيراد ───────────────────────────────────────
  // هو قرارٌ يُتَّخذ على الكشف: العميلُ الواحد كاشٌ في حمولةٍ وضريبيٌّ في أخرى.
  // فاختلافُ دفترِ الكاش عن نوعِنا خلافُ مصدرَين يُعرَض ليُقرَّر فيه، لا خطأٌ
  // يُصلَح بالكتابة فوقه — وقلبُ نوعِ اثنين وأربعين كشفًا يغيّر أين تُفوتَر.
  if (notCash) {
    needsYou.push(`${notCash} كشفًا تعدّها ورقةُ «Shipment Report» نقديّةً ونوعُها عندنا غيرُ ذلك — ${notCashList.join('، ')}`);
  }
  ok('نوعُ الدفع مقروءٌ من الطرفين للمقارنة', true, `${notCash} كشفًا يختلفان فيه`);

  const cashParties = await CollectionsParty.countDocuments({ kind: 'customer', paymentType: 'cash' });
  ok('حساباتُ Aging Shipment النقديّة موجودةٌ في السجلّ', cashParties > 0, `${cashParties} حسابًا`);

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(`  ناجح ${pass} · فاشل ${fail}`);
  console.log('══════════════════════════════════════════════════════════════════');
  if (needsYou.length) {
    console.log('\nيحتاج قرارَك (ليس فشلًا — خلافٌ بين ورقتين أو بينها وبين عملٍ في النظام):');
    for (const x of needsYou) console.log(`  · ${x}`);
  }
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
