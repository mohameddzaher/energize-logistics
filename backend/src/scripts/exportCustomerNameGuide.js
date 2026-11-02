/**
 * Guide from old customer name to current name, for people searching by a former name.
 * After name reconciliation (scripts/renameOpsCustomersFromSheet) each customer has one approved name, but the operations platform searches literally by the old one and finds nothing. The sheet lists both names, the collections account code, statement count and whether the old name is still found here (kept as an alias); a correct name that merged several old names explains duplicate-looking rows on the platform.
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

  // A correct name that merged several old names, hence two rows with one name on the platform.
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
    // The correct-name column is empty for some; their old name is their name.
    const to = S(b) || from;
    const p = byKey.get(fold(to)) || byKey.get(fold(from));
    const sheets = p ? await W.countDocuments({ username: p.name }) : 0;
    const many = (gathered.get(fold(to)) || new Set()).size;
    out.push({
      'الاسم القديم': from,
      'الاسم الصحيح الآن': p ? p.name : to,
      // A spelling difference visible to readers is reported as such, even though folding treats the two as equal, rather than as no change.
      'تغيّر؟': from === to ? 'لا — الاسم كما هو'
        : (fold(from) === fold(to) ? 'تصحيحُ رسمٍ فقط' : 'نعم'),
      'كود الحساب في التحصيل': p ? (p.code || '—') : '—',
      'عدد كشوفه': sheets,
      // The question is whether search finds it, not whether it is on this row: a company may have two accounts (cash and tax) with the alias on one, so the row this report picked can say not found while search finds it.
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
