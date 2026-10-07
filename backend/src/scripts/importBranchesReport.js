/**
 * تقريرُ الفروع يدخل النظامَ — ورقةُ `Data` كما هي.
 *
 *   node --max-old-space-size=8192 src/scripts/importBranchesReport.js --dry
 *   node --max-old-space-size=8192 src/scripts/importBranchesReport.js --apply
 *   … --file "update of branches report 2026.xlsx"
 *
 * راجع models/BranchReportRow: لماذا يدخل سجلًّا، ولماذا صفُّه ليس حمولةً
 * واحدة، ولماذا يُستبدَل كاملًا.
 *
 * ولا يمسّ هذا السكربتُ أسعارَ البيع في «التشغيل — خاصّ»: لذاك سكربتُه
 * (`importBranchesSellingPrices.js`) لأنّه يُطابِق صفَّ الورقة بكشفٍ بعينه
 * بأربعة شروط، وهو قرارٌ آخر. هذا يُدخِل التقريرَ ليُحلَّل.
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
const BOOK = arg('file', 'update of branches report 2026.xlsx');
const FILE = path.join(__dirname, '../../..', 'operation files', BOOK);

const S = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
// التواريخُ أرقامٌ تسلسليّة — `cellDates` تُسقط يومًا على هذا الجهاز.
const serialToISO = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + x * 86400000).toISOString().slice(0, 10);
};

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ باسم «${BOOK}» في مجلّد operation files`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const BranchReportRow = require('../models/BranchReportRow');

  console.log(`\n  الملفّ: ${BOOK}\n  ${APPLY ? '— تنفيذ —' : '— تجربة، بلا كتابة —'}\n`);
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets.Data, { header: 1, defval: null, blankrows: false, raw: true });
  // الصفُّ الأوّل أرقامٌ مجمّعة، والثاني هو العناوين — يُبحَث عنه ولا يُفترَض.
  const head = raw.findIndex((r) => (r || []).some((c) => S(c) === 'اسم العميل'));
  if (head < 0) { console.error('لم يُعثَر على صفّ العناوين في ورقة Data'); process.exit(1); }
  const H = {};
  (raw[head] || []).forEach((c, i) => { H[S(c)] = i; });
  const col = (r, ...names) => {
    for (const n of names) if (H[n] != null) return r[H[n]];
    return null;
  };

  const rows = [];
  let skipped = 0;
  for (const r of raw.slice(head + 1)) {
    const day = serialToISO(col(r, 'التاريخ'));
    const clientName = S(col(r, 'اسم العميل'));
    if (!day || !clientName) { skipped += 1; continue; }
    const trips = num(col(r, 'عدد الطلبات ', 'عدد الطلبات')) || 0;
    rows.push({
      day,
      date: new Date(`${day}T00:00:00.000Z`),
      month: day.slice(0, 7),
      branch: S(col(r, 'الفرع')),
      clientName,
      vendorName: S(col(r, 'اسم المورد')),
      vendorType: S(col(r, 'نوع المورد')),
      opsRep: S(col(r, 'مندوب التشغيل')),
      salesRep: S(col(r, 'مندوب المبيعات')),
      rentType: S(col(r, 'نوع الايجار')),
      payType: S(col(r, 'دفع العميل')),
      fromCity: S(col(r, 'من')),
      toCity: S(col(r, 'الى ', 'الى')),
      trips,
      achieved: num(col(r, 'عدد المحقق')),
      failed: num(col(r, 'عدد غير المحقق')),
      failReason: S(col(r, 'اسباب الغير محقق')),
      sell: num(col(r, 'سعر البيع')),
      buy: num(col(r, 'سعر الشراء')),
      sellTotal: num(col(r, 'اجمالي البيع')),
      buyTotal: num(col(r, 'اجمالي الشراء ', 'اجمالي الشراء')),
      gp: num(col(r, 'gp')),
      seq: num(col(r, 'تسلسل')),
      sourceFile: BOOK,
      importedAt: new Date(),
    });
  }

  const sum = (k) => Math.round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;
  const months = [...new Set(rows.map((r) => r.month))].sort();
  console.log(`  صفوف: ${rows.length}  (تُخطّى ${skipped} صفًّا بلا تاريخٍ أو عميل)`);
  console.log(`  المدّة: ${months[0]} → ${months[months.length - 1]}  (${months.length} شهرًا)`);
  console.log(`  الرحلات: طلبات ${sum('trips')} · محقق ${sum('achieved')} · غير محقق ${sum('failed')}`);
  console.log(`  المال: بيع ${sum('sellTotal').toLocaleString('en-US')} · شراء ${sum('buyTotal').toLocaleString('en-US')} · هامش ${sum('gp').toLocaleString('en-US')}`);
  // ── والتحقّقُ من الورقة نفسِها ─────────────────────────────────────────────
  // «اجمالي البيع» يجب أن يكون سعرَ العربة × عددَ الطلبات. فإن خالف فالورقةُ
  // فيها صفٌّ محسوبٌ بيدٍ — يُقال عددُه ولا يُصلَّح.
  const bad = rows.filter((r) => r.trips > 0 && Math.abs(r.sell * r.trips - r.sellTotal) > 1);
  console.log(`  صفوفٌ إجماليُّها لا يساوي السعر × العدد: ${bad.length}`);
  const dist = (k) => {
    const m = new Map();
    rows.forEach((r) => { const v = r[k] || '—'; m.set(v, (m.get(v) || 0) + (r.trips || 0)); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v}=${n}`).join(' · ');
  };
  console.log(`  الفروع: ${dist('branch')}`);
  console.log(`  نوع الإيجار: ${dist('rentType')}`);
  console.log(`  نوع المورد: ${dist('vendorType')}`);
  console.log(`  أسبابُ عدم التحقيق: ${dist('failReason')}`);

  if (!APPLY) { console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n'); await mongoose.disconnect(); process.exit(0); }

  const del = await BranchReportRow.deleteMany({});
  const CHUNK = 2000;
  let wrote = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const r = await BranchReportRow.insertMany(rows.slice(i, i + CHUNK), { ordered: false });
    wrote += r.length;
  }
  console.log(`\n  ✔ مُسح ${del.deletedCount} · كُتب ${wrote} صفًّا`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
