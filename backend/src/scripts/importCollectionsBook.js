/**
 * importCollectionsBook — دفترُ التحصيل كلُّه، من ملفٍّ واحدٍ إلى القاعدة.
 *
 *   node --max-old-space-size=8192 src/scripts/importCollectionsBook.js --dry
 *   node --max-old-space-size=8192 src/scripts/importCollectionsBook.js --apply
 *   node --max-old-space-size=8192 src/scripts/importCollectionsBook.js --apply --file "اسم آخر.xlsx"
 *
 * ── لماذا سكربتٌ واحدٌ محلَّ ثلاثة ──────────────────────────────────────────
 * كان الدفترُ يدخل على ثلاث مرّات: الحساباتُ في سكربت، والفواتيرُ في آخر،
 * وورقةُ الشحنات النقديّة لا تدخل أصلًا. ومن يشغّل واحدًا وينسى الآخر يترك
 * القاعدةَ نصفَ محدَّثة: حساباتٌ من ملفٍّ وفواتيرُ من ملفٍّ قبله. والملفُّ
 * يُحدَّث كاملًا فيدخل كاملًا.
 *
 * ── الأوراقُ الخمس وما فيها ────────────────────────────────────────────────
 *   Aging                 حساباتٌ ضريبيّة — أعمارُ الدين وحدودُ الائتمان
 *   Aging Shipment        حساباتٌ نقديّة
 *   Daily Invoice Report  فواتيرُ الحساب الضريبيّ
 *   Shipment Report       شحناتُ الحساب النقديّ — دفترُ فواتيره
 *   JP                    خطّةُ الزيارات وما تمّ منها
 *
 * وورقةُ الشحنات كانت تُترك. وهي دفترُ النقديّ كلُّه: أحدَ عشرَ ألفًا وثمانمئةٍ
 * وتسعةٌ وسبعون شحنةً بمبالغها وتواريخ تحصيلها. فبقي النقديُّ في النظام
 * حساباتٍ بلا فواتير — أرصدةٌ تُقرأ ولا يُعرَف ممّ تكوّنت.
 *
 * ── وما يُمسح وما لا يُمسح ─────────────────────────────────────────────────
 * يُمسح ما مصدرُه الدفتر وحدَه: الفواتيرُ والمهامُّ واقتراحاتُ الربط، وخاناتُ
 * الدفتر على الأطراف (الكود والموظّف والحدّ والأعمار).
 *
 * ولا تُمسح الأطرافُ نفسُها. في السجلّ أربعةُ آلافٍ وثلاثمئةٍ وعشرون طرفًا،
 * منها مئةٌ وخمسةٌ وتسعون من الدفتر — والباقي سجلُّ عملاء الشركة الذي تقرؤه
 * إدارةُ العلاقات وطلباتُ الشحنات والعقودُ والأسطول. حذفُه لأجل إعادة استيراد
 * دفترٍ يهدم أربعةَ أقسامٍ لا شأنَ لها بالدفتر.
 *
 * فالطرفُ الذي أنشأه الدفترُ ولم يعد فيه يُعطَّل ولا يُحذَف: قد تكون عليه
 * فواتيرُ قديمةٌ أو إحالاتٌ من قسمٍ آخر، والتعطيلُ يخرجه من القوائم ويبقي أثره.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const BOOK = arg('file', 'Updated Financial Collections    9-2026.xlsx');
const FILE = path.join(__dirname, '../../..', 'collection files', BOOK);

const XLS_EPOCH = Date.UTC(1899, 11, 30);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
/**
 * التاريخُ يُقرأ رقمًا تسلسليًّا لا نصًّا.
 *
 * قراءتُه بـ`cellDates` تُنقص يومًا على هذا الجهاز — راجع ملاحظةَ فخِّ تقويم
 * إكسل. فالملفُّ يُقرأ خامًا ويُحوَّل الرقمُ هنا بالمنطقة الصفريّة.
 */
const D = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return new Date(XLS_EPOCH + Math.round(v * 86400000));
  const s = S(v);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m.map(Number); if (y < 100) y += 2000; const dt = new Date(Date.UTC(y, mo - 1, d)); return Number.isNaN(dt.getTime()) ? null : dt; }
  return null;
};
const splitList = (v) => S(v).split(/[/,؛;+&]|\s+و\s+/).map((x) => x.trim()).filter(Boolean);

/** صفُّ مجموعٍ في الورقة ليس عميلًا — ولو أُنشئ لحمل مديونيّةَ الجميع. */
const TOTALS_ROW = /^\s*(?:الإجمالي|الاجمالي|المجموع|total|grand\s*total)\s*$/i;
/** ما يعني «لا فاتورة» ليس رقمَ فاتورة. */
const NO_INVOICE = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|0|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ باسم «${BOOK}» في مجلّد collection files`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionTask = require('../models/CollectionTask');
  const { fold } = CollectionsParty;
  let PartyLinkSuggestion = null;
  try { PartyLinkSuggestion = require('../models/PartyLinkSuggestion'); } catch (_) { /* اختياريّ */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n  الملفّ: ${BOOK}${APPLY ? '' : '\n  — تجربة، بلا كتابة —'}\n`);

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = (n) => (wb.Sheets[n]
    ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true })
    : []);
  const body = (n, headerRow) => raw(n).slice(headerRow + 1);

  // ═══ ١ · الحسابات ═══════════════════════════════════════════════════════
  // Aging          0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 limit
  //                8 Status 9 CreditDays 10 Outstanding 11..20 أعمار 21 Contracts
  //                22 Reconciliation 23 ReconDate 24 Comments
  // Aging Shipment 0 Code 1 Name 2 Officer 3 HO 4 Grade 5 Sales 6 Dept 7 Status
  //                8 CreditDays 9 Outstanding 10 15+ 11 15- 12 Contracts
  //                13 Reconciliation 14 ReconDate 15 Comments
  const accounts = new Map();
  const nameless = [];
  const addAccount = (a) => {
    if (!a.code) return;
    // كودٌ بلا اسمٍ لا يُهمَل ولا يُخترَع له اسم — يُطابَق بالكود، واسمُه يأتي
    // من دفتر الفواتير حيث هو مكتوبٌ على فواتيره.
    if (!a.name) { nameless.push(a.code); a.codeOnly = true; }
    const prev = accounts.get(a.code);
    // الحسابُ في الورقتين: تُجمَع أرصدتُه ولا تُكتب إحداهما فوق الأخرى.
    if (prev) { prev.ledger.outstanding += a.ledger.outstanding; return; }
    accounts.set(a.code, a);
  };

  for (const r of body('Aging', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({
      code, name: S(r[1]), kind: 'tax', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: N(r[7]), status: S(r[8]), creditDays: N(r[9]),
      ledger: {
        outstanding: N(r[10]), total60to1y: N(r[11]), total30to1y: N(r[12]), y1plus: N(r[13]),
        d120: N(r[14]), d90: N(r[15]), d60: N(r[16]), d60minus: N(r[17]), d45: N(r[18]),
        d30: N(r[19]), d15: N(r[20]),
        contracts: S(r[21]), reconciliation: S(r[22]), reconciliationDate: D(r[23]), comments: S(r[24]),
      },
    });
  }
  for (const r of body('Aging Shipment', 4)) {
    const code = S(r[0]); if (!code || !/^[\dC]/i.test(code)) continue;
    addAccount({
      code, name: S(r[1]), kind: 'cash', officer: S(r[2]), ho: S(r[3]), grade: S(r[4]),
      sales: splitList(r[5]), dept: S(r[6]), limit: 0, status: S(r[7]), creditDays: N(r[8]),
      ledger: {
        outstanding: N(r[9]), d15plus: N(r[10]), d15minus: N(r[11]),
        contracts: S(r[12]), reconciliation: S(r[13]), reconciliationDate: D(r[14]), comments: S(r[15]),
      },
    });
  }
  // JP يزيد المنطقة.
  for (const r of body('JP', 6)) {
    const a = accounts.get(S(r[0])); if (a && !a.region) a.region = S(r[9]);
  }

  const tax = [...accounts.values()].filter((a) => a.kind === 'tax').length;
  const cash = [...accounts.values()].filter((a) => a.kind === 'cash').length;
  console.log(`  ① الحسابات        ${accounts.size}  (ضريبي ${tax} · نقدي ${cash})`);
  if (nameless.length) console.log(`     أكوادٌ بلا اسمٍ في الورقة: ${nameless.join('، ')}`);

  // ═══ ٢ · الفواتير ═══════════════════════════════════════════════════════
  // Daily Invoice Report 0 Code 1 Name 2 InvoiceNo 3 Total 4 InvoiceDate 5 Days
  //                      6 DeliveryDate 7 DaysD 8 CollectionDate 9 Status
  //                      10 ExitDate 11 Comments 12 DaysTTL
  const invoices = [];
  let skippedNoInv = 0; let skippedTotals = 0;
  for (const r of body('Daily Invoice Report', 6)) {
    const name = S(r[1]);
    if (name && TOTALS_ROW.test(name)) { skippedTotals += 1; continue; }
    const num = S(r[2]);
    if (!num || NO_INVOICE.test(num)) { if (num || name) skippedNoInv += 1; continue; }
    invoices.push({
      kind: 'tax', sheetCode: S(r[0]), partyName: name, invoiceNumber: num, total: N(r[3]),
      invoiceDate: D(r[4]), deliveryDate: D(r[6]), collectionDate: D(r[8]),
      status: S(r[9]), exitDate: D(r[10]), comments: S(r[11]),
    });
  }

  // Shipment Report 0 Code 1 Owner 2 Account 3 Branch 4 CollecteBranch 5 ShipmentNo
  //                 6 InvoiceTotal 7 CreationDate 8 Days 9 PaymentDate 10 DaysP
  //                 11 DeliveryDate 12 DaysD 13 CollectionDate 14 Status 15 Comments
  let shipSkipped = 0;
  for (const r of body('Shipment Report', 4)) {
    const name = S(r[2]);
    if (name && TOTALS_ROW.test(name)) { shipSkipped += 1; continue; }
    const num = S(r[5]);
    if (!num || NO_INVOICE.test(num)) { if (num || name) shipSkipped += 1; continue; }
    invoices.push({
      kind: 'cash', sheetCode: S(r[0]), partyName: name, invoiceNumber: num, total: N(r[6]),
      ownerName: S(r[1]), branch: S(r[3]), collectionBranch: S(r[4]),
      invoiceDate: D(r[7]), paymentDate: D(r[9]), deliveryDate: D(r[11]), collectionDate: D(r[13]),
      status: S(r[14]), comments: S(r[15]),
    });
  }
  const nTax = invoices.filter((i) => i.kind === 'tax').length;
  const nCash = invoices.length - nTax;
  console.log(`  ② الفواتير        ${invoices.length}  (ضريبي ${nTax} · نقدي ${nCash})`);
  console.log(`     صفوفٌ بلا رقم فاتورة: ${skippedNoInv + shipSkipped} · صفوفُ مجاميع: ${skippedTotals}`);

  // ═══ ٣ · خطّةُ الزيارات ═════════════════════════════════════════════════
  // JP: 0 Code … والأيّامُ أعمدةٌ متكرّرةٌ بعد العمود العاشر. تُقرأ كما تُقرأ
  // الورقة: لكلّ عميلٍ عمودٌ لكلّ يوم.
  // ── وخطّةُ الزيارات تُقرأ لتُكتب، لا لتُعَدّ ─────────────────────────────
  // كان هنا عدٌّ يُطبَع ثمّ يُنسى، والمسحُ أدناه يمحو `CollectionTask` — فكانت
  // كلُّ إعادةِ استيرادٍ تمحو تاريخَ الزيارات ولا تُعيده. راجع utils/journeyPlan.
  const { parseJourneyPlan } = require('../utils/journeyPlan');
  const jp = parseJourneyPlan(raw('JP'));
  const jpCollected = jp.tasks.reduce((a, t) => a + (t.collected || 0), 0);
  console.log(`  ③ خطّةُ الزيارات   ${jp.tasks.length} مهمّةً في ${new Set(jp.tasks.map((t) => t.date)).size} يومًا  (محصَّلٌ فيها ${jpCollected.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);

  if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n');
    await mongoose.disconnect(); return;
  }

  // ═══ ٤ · النسخةُ الاحتياطيّة قبل أيّ مسح ════════════════════════════════
  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `collections-before-reimport-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    takenAt: new Date().toISOString(), replacedWith: BOOK,
    parties: await CollectionsParty.find({}).lean(),
    invoices: await CollectionInvoice.find({}).lean(),
    tasks: await CollectionTask.find({}).lean(),
    suggestions: PartyLinkSuggestion ? await PartyLinkSuggestion.find({}).lean() : [],
  }));
  console.log(`\n  ✔ نسخةٌ احتياطيّة: ${backup}`);

  // ═══ ٥ · المسح — ما مصدرُه الدفترُ وحدَه ════════════════════════════════
  const delInv = await CollectionInvoice.deleteMany({});
  const delTask = await CollectionTask.deleteMany({});
  const delSug = PartyLinkSuggestion ? await PartyLinkSuggestion.deleteMany({}) : { deletedCount: 0 };
  // وخاناتُ الدفتر تُفرَّغ من الأطراف كلِّها: ما لا يعود في الملفّ الجديد لا
  // يبقى منه أثرٌ قديمٌ يُقرأ على أنّه حاليّ.
  const cleared = await CollectionsParty.updateMany({}, {
    $set: {
      collectionOfficer: '', hoLocation: '', grade: '', salesManagers: [],
      department: '', region: '', creditLimit: 0, creditDays: 0, ledger: {},
    },
  });

  // ── والكودُ يُفرَّغ وحدَه، ولمن لم يعد له كودٌ في الملفّ ───────────────────
  //
  // تفريغُه من الجميع دفعةً واحدةً يصطدم بفهرسٍ فريدٍ على (النوع + الاسم +
  // الكود): طرفان بالاسم نفسِه — أحدُهما بكودٍ والآخرُ بلا — يصيران بعد
  // التفريغ صفَّين متطابقين، فتُردّ العمليّةُ كلُّها ولا يُكتب شيء.
  //
  // والمقصودُ أضيقُ من ذلك أصلًا: كودٌ قديمٌ لم يعد في الملفّ الجديد. فيُفرَّغ
  // هو وحدَه، صفًّا صفًّا. وما تعذّر تفريغُه لوجود شبيهٍ بلا كود فذاك تكرارٌ في
  // السجلّ لا شأنَ للدفتر به — يُعطَّل الطرفُ القديم ويُقال.
  // ── أوّلًا: الشركةُ الواحدةُ مسجَّلةٌ مرّتين ────────────────────────────────
  //
  // خمسُ شركاتٍ في السجلّ لكلٍّ منها نسختان: نسخةٌ أنشأتها العمليّاتُ من كشفٍ
  // أو طلبِ شحن — عليها إحالاتٌ من أربعة أقسام — ونسخةٌ أنشأها استيرادُ الدفتر
  // السابق بكودها. والاسمان واحدٌ بعد الطيّ («شركة مجال البيئة» و«شركه مجال
  // البيئه»)، فهما شركةٌ واحدة لا شركتان.
  //
  // وبقاؤهما يمنع كلَّ شيء: الفهرسُ الفريد على (النوع + الاسم المطويّ + الكود)
  // يردّ تفريغَ كود إحداهما لأنّها تصير نسخةً من الأخرى، فيقف الاستيراد.
  //
  // فتُدمَجان: تبقى نسخةُ العمليّات لأنّها المشارُ إليها، ويُنقَل إليها اسمُ
  // الدفتر اسمًا بديلًا (فيجدها من يبحث بأيّ الرسمين)، وتُحذَف نسخةُ الدفتر —
  // وهي لا يشير إليها شيءٌ إلّا فواتيرُ أُعيد بناؤها في هذا التشغيل نفسِه.
  const dupGroups = await CollectionsParty.aggregate([
    { $group: { _id: { kind: '$kind', nameKey: '$nameKey' }, n: { $sum: 1 }, docs: { $push: { id: '$_id', code: '$code', name: '$name', source: '$source' } } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  let merged = 0;
  for (const g of dupGroups) {
    const book = g.docs.find((d) => d.code && /^(collections[-_]workbook|invoice_ledger)$/.test(d.source || ''));
    const keep = g.docs.find((d) => d.id !== (book || {}).id && !/^(collections[-_]workbook|invoice_ledger)$/.test(d.source || ''));
    if (!book || !keep) continue;
    await CollectionsParty.updateOne({ _id: keep.id }, {
      $addToSet: { aliases: book.name, aliasKeys: fold(book.name) },
      $set: { isActive: true },
    });
    await CollectionsParty.deleteOne({ _id: book.id });
    merged += 1;
    console.log(`  ⇄ دُمج «${book.name}» (${book.code}) في «${keep.name}»`);
  }
  if (merged) console.log(`  ✔ نسخٌ مكرّرةٌ دُمجت: ${merged}`);

  // وتُفرَّغ الأكوادُ كلُّها لا الزائلةُ وحدَها: الملفُّ الجديد قد ينقل كودًا
  // من حسابٍ إلى آخر، فلو بقي على صاحبه القديم ارتطم الإسنادُ بالفهرس الفريد
  // ووقف الاستيرادُ في منتصفه.
  const stale = await CollectionsParty.find({ code: { $gt: '' } }).select('code name kind nameKey').lean();
  let dropped = 0; const stuck = [];
  for (const p of stale) {
    try {
      await CollectionsParty.updateOne({ _id: p._id }, { $set: { code: '' } });
      dropped += 1;
    } catch (e) {
      if (!e || e.code !== 11000) throw e;
      // ── تكرارٌ في السجلّ لا في الدفتر ──────────────────────────────────
      // طرفان بالاسم نفسِه: هذا بكودٍ من دفتر المحاسبة، وذاك بلا كودٍ أنشأه
      // قسمٌ آخر من كشفٍ أو طلبِ شحن. وتفريغُ الكود يجعلهما صفَّين متطابقين
      // فيردّهما الفهرس.
      //
      // والذي يبقى هو صاحبُ الكود: هو المعروفُ في دفتر الحسابات وعليه
      // المديونيّة. والنسخةُ التي لا كودَ لها تُعطَّل — لا تُحذَف، فقد تكون
      // مشارًا إليها من عقدٍ أو كشف.
      // بعد الدمج أعلاه لا ينبغي أن يقع هذا. فإن وقع فهو تكرارٌ من نوعٍ آخر
      // لم يُتوقَّع — يُقال باسمه ولا يُمَسّ، ويقف الاستيرادُ عنده لا يخمّن.
      stuck.push(`${p.code} ${p.name} — تعذّر تفريغُ كوده (تكرارٌ لم يُدمَج)`);
    }
  }
  console.log(`  ✔ مُسح: ${delInv.deletedCount} فاتورة · ${delTask.deletedCount} مهمّة · ${delSug.deletedCount} اقتراح`);
  console.log(`  ✔ فُرّغت خاناتُ الدفتر من ${cleared.modifiedCount} طرفًا`);
  console.log(`  ✔ أكوادٌ فُرِّغت قبل إعادة الإسناد: ${dropped}`);
  if (stuck.length) {
    console.log(`  ⚠ تكرارٌ في السجلّ عولج (${stuck.length}):`);
    for (const x of stuck) console.log(`      ${x}`);
  }

  // ═══ ٦ · الحسابات تدخل ══════════════════════════════════════════════════
  // المطابقةُ بالكود أوّلًا ثمّ بالاسم المطويّ. ولا يُخترَع ربطٌ بالتشابه هنا:
  // الملفُّ الجديد يحمل الأكواد التي رُبطت في الاستيراد السابق، فما طابق طابق
  // وما لم يطابق يُنشأ بكوده — والربطُ بالتشابه قرارُ مديرِ التحصيل من شاشته.
  const ours = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey aliasKeys').lean();
  const byKey = new Map();
  for (const p of ours) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byKey.has(k)) byKey.set(k, p);
  }
  const claimed = new Set();
  const partyOfCode = new Map();
  let linked = 0; let created = 0;

  for (const a of [...accounts.values()].sort((x, y) => String(x.code).localeCompare(String(y.code)))) {
    const ledger = { ...a.ledger, sourceFile: BOOK, importedAt: new Date() };
    const set = {
      code: a.code, kind: 'customer', paymentType: a.kind,
      collectionOfficer: a.officer, hoLocation: a.ho, grade: a.grade,
      salesManagers: a.sales, department: a.dept, region: a.region || '',
      creditLimit: a.limit || 0, creditDays: a.creditDays || 0, ledger,
      ...(a.status ? { status: a.status } : {}),
    };
    const match = a.codeOnly ? null : byKey.get(fold(a.name));
    if (match && !claimed.has(String(match._id))) {
      claimed.add(String(match._id));
      await CollectionsParty.updateOne({ _id: match._id }, {
        $set: set, $addToSet: { aliases: a.name, aliasKeys: fold(a.name) },
      });
      partyOfCode.set(a.code, match._id);
      linked += 1;
    } else if (!a.codeOnly) {
      const doc = await CollectionsParty.findOneAndUpdate({ code: a.code }, {
        $set: { ...set, name: a.name, nameKey: fold(a.name), source: 'collections_workbook', isActive: true },
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
      partyOfCode.set(a.code, doc._id);
      created += 1;
    }
  }
  console.log(`  ✔ حسابات: رُبطت بسجلٍّ قائم ${linked} · أُنشئت ${created}`);

  // ═══ ٧ · الفواتير تدخل ══════════════════════════════════════════════════
  // ــ والحسابُ الذي تعرفه الفواتيرُ ولا تعرفه ورقةُ الأعمار يُنشأ هنا ــــــ
  const { nextPartyCode } = require('../utils/partyCode');
  const byName2 = new Map();
  for (const p of await CollectionsParty.find({ kind: 'customer' }).select('name nameKey aliasKeys code').lean()) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !byName2.has(k)) byName2.set(k, p);
    if (p.code) partyOfCode.set(p.code, p._id);
  }
  let extraParties = 0;
  for (const inv of invoices) {
    if (inv.sheetCode && partyOfCode.has(inv.sheetCode)) continue;
    if (!inv.partyName) continue;
    const hit = byName2.get(fold(inv.partyName));
    if (hit) { if (inv.sheetCode) partyOfCode.set(inv.sheetCode, hit._id); continue; }
    const code = inv.sheetCode || await nextPartyCode(inv.kind);
    const doc = await CollectionsParty.findOneAndUpdate({ kind: 'customer', code }, {
      $set: {
        kind: 'customer', code, name: inv.partyName, nameKey: fold(inv.partyName),
        paymentType: inv.kind, source: 'invoice_ledger', isActive: true,
      },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    partyOfCode.set(code, doc._id); byName2.set(fold(inv.partyName), doc);
    extraParties += 1;
  }
  if (extraParties) console.log(`  ✔ حساباتٌ عرفتها الفواتيرُ ولم تعرفها ورقةُ الأعمار: ${extraParties}`);

  // رقمٌ في التسلسل بلا حسابٍ ولا مبلغٍ ولا تاريخ — يدخل ويُعلَّم. راجع
  // models/CollectionInvoice.unused.
  for (const inv of invoices) {
    inv.unused = !inv.partyName && !inv.total && !inv.invoiceDate && !inv.deliveryDate && !inv.collectionDate;
  }
  const nUnused = invoices.filter((i) => i.unused).length;

  const ops = invoices.map((inv) => {
    const pid = inv.sheetCode ? partyOfCode.get(inv.sheetCode)
      : (byName2.get(fold(inv.partyName)) || {})._id;
    return {
      updateOne: {
        filter: { kind: inv.kind, invoiceNumber: inv.invoiceNumber, sheetCode: inv.sheetCode },
        update: { $set: { ...inv, party: pid || null, partyCode: inv.sheetCode, source: 'collections_workbook' } },
        upsert: true,
      },
    };
  });
  let wrote = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const r = await CollectionInvoice.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    wrote += (r.upsertedCount || 0) + (r.modifiedCount || 0) + (r.matchedCount || 0);
  }
  console.log(`  ✔ فواتير كُتبت: ${wrote}`);

  // ═══ ٧ب · خطّةُ الزيارات تعود ═══════════════════════════════════════════
  // المفتاحُ (عميل × يوم × نوعُ الطلب) كما في فهرس النموذج.
  const jpByCode = new Map();
  for (const p of await CollectionsParty.find({ kind: 'customer' }).select('code name nameKey aliasKeys').lean()) {
    if (p.code) jpByCode.set(String(p.code).trim(), p);
  }
  const taskOps = jp.tasks.map((t) => {
    const party = jpByCode.get(t.partyCode) || byName2.get(fold(t.partyName || '')) || null;
    return {
      updateOne: {
        filter: { party: party ? party._id : null, date: t.date, requestType: t.requestType },
        update: { $set: { ...t, party: party ? party._id : null, source: 'collections_workbook' } },
        upsert: true,
      },
    };
  });
  let taskWrote = 0;
  for (let i = 0; i < taskOps.length; i += 500) {
    const r = await CollectionTask.bulkWrite(taskOps.slice(i, i + 500), { ordered: false });
    taskWrote += (r.upsertedCount || 0) + (r.modifiedCount || 0);
  }
  console.log(`  ✔ مهامُّ زيارةٍ كُتبت: ${taskWrote}`);

  // ═══ ٧ج · وكشوفُ التشغيل تعود تحت فواتيرها ══════════════════════════════
  // الورقةُ لا تعرف كشوفَنا، فتُكتب `reportNumbers` فارغةً فوق ما كان. تُعاد
  // من كشوف التشغيل نفسِها — راجع scripts/linkInvoiceReports.
  const { invoiceNumberKey } = require('../utils/invoiceNumberKey');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const invByKey = new Map();
  for (const i of await CollectionInvoice.find({ unused: { $ne: true } }).select('invoiceNumber').lean()) {
    const k = invoiceNumberKey(i.invoiceNumber);
    if (!k) continue;
    if (!invByKey.has(k)) invByKey.set(k, []);
    invByKey.get(k).push(i._id);
  }
  const wantRn = new Map();
  for (const w of await OperationsWorkflow.find({ invoiceNumber: { $nin: [null, ''] } }).select('reportNumber invoiceNumber').lean()) {
    const k = invoiceNumberKey(w.invoiceNumber);
    const rn = S(w.reportNumber);
    if (!k || !rn) continue;
    for (const id of (invByKey.get(k) || [])) {
      const key = String(id);
      if (!wantRn.has(key)) wantRn.set(key, new Set());
      wantRn.get(key).add(rn);
    }
  }
  const rnOps = [...wantRn].map(([id, set]) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { reportNumbers: [...set].sort() } } },
  }));
  let rnWrote = 0;
  for (let i = 0; i < rnOps.length; i += 1000) {
    const r = await CollectionInvoice.bulkWrite(rnOps.slice(i, i + 1000), { ordered: false });
    rnWrote += r.modifiedCount || 0;
  }
  console.log(`  ✔ فواتيرُ رُبطت بكشوفها: ${rnWrote} (بمجموع ${[...wantRn.values()].reduce((a, s) => a + s.size, 0)} كشفًا)`);

  // ═══ ٨ · التحقّق — لا صفَّ ضاع ═════════════════════════════════════════
  const dbTax = await CollectionInvoice.countDocuments({ kind: 'tax' });
  const dbCash = await CollectionInvoice.countDocuments({ kind: 'cash' });
  const dbParties = await CollectionsParty.countDocuments({ code: { $gt: '' } });
  const sumSheet = invoices.reduce((a, i) => a + i.total, 0);
  const sumDb = (await CollectionInvoice.aggregate([{ $group: { _id: null, t: { $sum: '$total' } } }]))[0]?.t || 0;
  const orphan = await CollectionInvoice.countDocuments({ party: null });

  const line = (label, sheet, db) => console.log(
    `  ${db === sheet ? '✔' : '✘'} ${label.padEnd(26)} الورقة ${String(sheet).padStart(7)}  القاعدة ${String(db).padStart(7)}`,
  );
  console.log('\n  ── التحقّق ──');
  line('فواتير ضريبيّة', nTax, dbTax);
  line('فواتير نقديّة', nCash, dbCash);
  // والفواتيرُ قد تعرف حسابًا لا تعرفه ورقةُ الأعمار — فيُضاف إلى المتوقَّع.
  line('حساباتٌ بكود', accounts.size + extraParties, dbParties);
  console.log(`  ${Math.abs(sumSheet - sumDb) < 1 ? '✔' : '✘'} ${'مجموع المبالغ'.padEnd(26)} الورقة ${sumSheet.toFixed(2)}  القاعدة ${sumDb.toFixed(2)}`);
  const dbUnused = await CollectionInvoice.countDocuments({ unused: true });
  const realOrphans = await CollectionInvoice.countDocuments({ party: null, unused: { $ne: true } });
  console.log(`  ${dbUnused === nUnused ? '✔' : '✘'} ${'أرقامٌ محجوزةٌ بلا فاتورة'.padEnd(26)} الورقة ${String(nUnused).padStart(7)}  القاعدة ${String(dbUnused).padStart(7)}`);
  console.log(`  ${realOrphans ? '⚠' : '✔'} فواتيرُ حقيقيّةٌ بلا حسابٍ مربوط: ${realOrphans}`);
  const dbTasks = await CollectionTask.countDocuments({});
  line('مهامُّ الزيارات', jp.tasks.length, dbTasks);
  console.log(`  (وبلا حسابٍ إجمالًا ${orphan} — منها ${dbUnused} أرقامٌ محجوزة)`);
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
