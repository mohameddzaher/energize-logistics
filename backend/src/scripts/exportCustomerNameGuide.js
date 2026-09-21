/**
 * دليلُ «الاسم القديم ← الاسم اليوم» — لمن يبحث عن عميلٍ باسمه السابق.
 *
 * بعد مطابقة الأسماء (scripts/renameOpsCustomersFromSheet) صار للعميل اسمٌ
 * واحدٌ مُعتمَد، وبقي في الأذهان اسمُه القديم — ويُبحَث به في منصّة التشغيل،
 * وهي تبحث بالحرف فتقول «لا نتائج». فيُصدَّر الدليلُ ورقةً تُفتَح جنبَ الشاشة.
 *
 * ولكلّ سطرٍ ما يهمّ القارئ: الاسمان، وكودُ الحساب في التحصيل، وعددُ كشوفه،
 * وهل الاسمُ القديم ما زال يجده عندنا (محفوظٌ لقبًا) — وأيُّ اسمٍ صحيحٍ جمع
 * أكثرَ من اسمٍ قديم، فذاك سببُ ظهور صفَّين متشابهين في المنصّة.
 *
 *   node src/scripts/exportCustomerNameGuide.js
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '../../..');
const FILE = path.join(ROOT, 'operation files/مطابقه اسماء العملاء.xlsx');
const OUT = path.join(ROOT, 'دليل أسماء العملاء (قديم ← جديد).xlsx');
const S = (v) => String(v ?? '').trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;
  const W = mongoose.connection.collection('operationsworkflows');

  const wb = XLSX.readFile(FILE, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['مطابقه'], { header: 1, defval: null, blankrows: false, raw: true }).slice(1);

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name code isActive aliases aliasKeys nameKey').lean();
  const byKey = new Map();
  for (const p of parties) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) {
      if (!k) continue;
      if (!byKey.has(k) || (p.isActive !== false && byKey.get(k).isActive === false)) byKey.set(k, p);
    }
  }

  // أيُّ اسمٍ صحيحٍ جمع أكثرَ من اسمٍ قديم — فصار في المنصّة صفّان باسمٍ واحد.
  const gathered = new Map();
  for (const [a, b] of rows) {
    const from = S(a); const to = S(b) || S(a);
    if (!from) continue;
    const k = fold(to);
    if (!gathered.has(k)) gathered.set(k, new Set());
    gathered.get(k).add(fold(from));
  }

  const out = [];
  for (const [a, b] of rows) {
    const from = S(a);
    if (!from) continue;
    // عمودُ الاسم الصحيح فارغٌ عند بعضهم — فاسمُه القديم هو اسمُه.
    const to = S(b) || from;
    const p = byKey.get(fold(to)) || byKey.get(fold(from));
    const sheets = p ? await W.countDocuments({ username: p.name }) : 0;
    const many = (gathered.get(fold(to)) || new Set()).size;
    out.push({
      'الاسم القديم': from,
      'الاسم الصحيح الآن': p ? p.name : to,
      // والفرقُ في الرسم فرقٌ يراه القارئ («العالميه» ← «العالمية»)، وإن كان
      // الطيُّ يسوّي بينهما. فيُقال له ما هو، لا «لا تغيير».
      'تغيّر؟': from === to ? 'لا — الاسم كما هو'
        : (fold(from) === fold(to) ? 'تصحيحُ رسمٍ فقط' : 'نعم'),
      'كود الحساب في التحصيل': p ? (p.code || '—') : '—',
      'عدد كشوفه': sheets,
      // ── والسؤالُ «هل يجده البحث؟» لا «هل هو على هذا الصفّ؟» ─────────────
      // للشركة حسابان أحيانًا (نقديٌّ وضريبيّ) واللقبُ على أحدهما، فالسؤالُ
      // عن الصفّ الذي اختاره هذا التقرير يقول «لا يجده» والبحثُ يجده.
      'البحث بالاسم القديم عندنا': byKey.has(fold(from)) ? (byKey.get(fold(from)).nameKey === fold(from) ? 'يجده' : 'يجده (محفوظٌ لقبًا)') : 'لا يجده',
      'ملاحظة': many > 1 ? `هذا الاسم الصحيح جُمع من ${many} أسماءٍ قديمة — فقد ترى صفّين متشابهين في المنصّة` : '',
    });
  }

  const ws = XLSX.utils.json_to_sheet(out);
  ws['!cols'] = [{ wch: 46 }, { wch: 52 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 22 }, { wch: 60 }];
  ws['!sheetViews'] = [{ RTL: true }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'دليل الأسماء');
  XLSX.writeFile(book, OUT);
  console.log({ rows: out.length, out: OUT });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
