/**
 * auditCollectionsSheetVsDb — الشيتُ هو المرجع، والقاعدةُ تُقاس عليه.
 *
 * لا يكتب شيئًا. يقرأ ورقتَي «Daily Invoice Report» و«Aging» ويقارنهما
 * بمجموعتَي CollectionInvoice و CollectionsParty: كم فاتورةً في الورقة، وكم
 * منها عندنا، وما الذي يختلف في التواريخ والحالة والمبلغ ومسؤول التحصيل.
 *
 * والتواريخُ تُقرأ أرقامًا خامًّا (مسلسلَ إكسل) لا كائناتِ تاريخ: قراءتُها
 * تواريخَ تُنقص يومًا على هذا الجهاز — راجع xlsx-date-epoch-trap.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');

const FILE = path.join(__dirname, '../../../collection files/Financial Collections    9-2026.xlsx');
// مسلسلُ إكسل ← تاريخ (نظام 1900، مع خطأ الكبيسة المعروف).
const serialToDate = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return new Date(Math.round((v - 25569) * 86400 * 1000));
};
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionsParty = require('../models/CollectionsParty');

  const wb = XLSX.readFile(FILE);

  // ── ١) الفواتير ──────────────────────────────────────────────────────────
  const inv = XLSX.utils.sheet_to_json(wb.Sheets['Daily Invoice Report'], { header: 1, defval: '', blankrows: false });
  const H = inv[5].map((h) => String(h).trim());
  const col = (name) => H.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cCode = col('Code'), cName = col('Account name'), cNo = col('Invoice No'),
    cTotal = col('Total Outstanding'), cInvD = col('Invoice Date'),
    cDelD = col('Delivery Date'), cColD = col('Collection Date'), cStatus = col('Status');
  console.log('أعمدةُ ورقة الفواتير:', { cCode, cName, cNo, cTotal, cInvD, cDelD, cColD, cStatus });

  const sheetRows = [];
  for (let i = 6; i < inv.length; i += 1) {
    const r = inv[i];
    if (!r) continue;
    const no = String(r[cNo] ?? '').trim();
    if (!no) continue;
    sheetRows.push({
      row: i + 1,
      code: String(r[cCode] ?? '').trim(),
      name: String(r[cName] ?? '').trim(),
      no,
      total: Number(r[cTotal]) || 0,
      invoiceDate: serialToDate(r[cInvD]),
      deliveryDate: serialToDate(r[cDelD]),
      collectionDate: serialToDate(r[cColD]),
      status: String(r[cStatus] ?? '').trim(),
    });
  }
  console.log(`\n══ ورقةُ الفواتير: ${sheetRows.length} صفًّا برقم فاتورة`);

  const db = await CollectionInvoice.find({}).select('invoiceNumber total invoiceDate deliveryDate collectionDate status partyName').lean();
  console.log(`   وفي القاعدة: ${db.length} فاتورة`);
  const byNo = new Map();
  for (const d of db) byNo.set(String(d.invoiceNumber).trim(), d);

  const missing = [];
  const diffDelivery = [];
  const diffCollection = [];
  const diffTotal = [];
  for (const s of sheetRows) {
    const d = byNo.get(s.no);
    if (!d) { missing.push(s); continue; }
    if (ymd(s.deliveryDate) !== ymd(d.deliveryDate ? new Date(d.deliveryDate) : null)) diffDelivery.push({ s, d });
    if (ymd(s.collectionDate) !== ymd(d.collectionDate ? new Date(d.collectionDate) : null)) diffCollection.push({ s, d });
    if (Math.abs((Number(d.total) || 0) - s.total) > 0.5) diffTotal.push({ s, d });
  }
  console.log(`   ✗ في الورقة وليست عندنا: ${missing.length}`);
  missing.slice(0, 15).forEach((m) => console.log(`      «${m.no}» ${m.name} · ${m.total} · صفّ ${m.row}`));
  console.log(`   ≠ تاريخُ تسليمٍ مختلف: ${diffDelivery.length}`);
  diffDelivery.slice(0, 8).forEach(({ s, d }) => console.log(`      «${s.no}» ورقة=${ymd(s.deliveryDate) || '—'} قاعدة=${ymd(d.deliveryDate ? new Date(d.deliveryDate) : null) || '—'}`));
  console.log(`   ≠ تاريخُ تحصيلٍ مختلف: ${diffCollection.length}`);
  diffCollection.slice(0, 8).forEach(({ s, d }) => console.log(`      «${s.no}» ورقة=${ymd(s.collectionDate) || '—'} قاعدة=${ymd(d.collectionDate ? new Date(d.collectionDate) : null) || '—'}`));
  console.log(`   ≠ مبلغٌ مختلف: ${diffTotal.length}`);

  // فاتورةٌ بعينها سأل عنها
  const t = sheetRows.find((x) => x.no === '11855');
  console.log(`\n   الفاتورة 11855 في الورقة: ${t ? `نعم — ${t.name} · ${t.total} · فوترة ${ymd(t.invoiceDate)} · تسليم ${ymd(t.deliveryDate) || '—'} · تحصيل ${ymd(t.collectionDate) || '—'}` : 'لا'}`);
  console.log(`   وفي القاعدة: ${byNo.has('11855') ? 'نعم' : 'لا'}`);

  // ── ٢) مسؤولو التحصيل ────────────────────────────────────────────────────
  const ag = XLSX.utils.sheet_to_json(wb.Sheets['Aging'], { header: 1, defval: '', blankrows: false });
  const AH = ag[4].map((h) => String(h).trim());
  const aCode = AH.indexOf('Code'), aName = AH.indexOf('Account name'), aOff = AH.indexOf('Collection Officer');
  const sheetOff = new Map();
  for (let i = 5; i < ag.length; i += 1) {
    const r = ag[i]; if (!r) continue;
    const code = String(r[aCode] ?? '').trim();
    const off = String(r[aOff] ?? '').trim();
    if (code && off) sheetOff.set(code, { officer: off, name: String(r[aName] ?? '').trim() });
  }
  console.log(`\n══ ورقةُ الأعمار: ${sheetOff.size} حسابًا له مسؤول`);
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('code name collectionOfficer').lean();
  const byCode = new Map(parties.filter((p) => p.code).map((p) => [String(p.code).trim(), p]));
  let same = 0; const wrong = []; const notFound = [];
  for (const [code, v] of sheetOff) {
    const p = byCode.get(code);
    if (!p) { notFound.push({ code, ...v }); continue; }
    if (String(p.collectionOfficer || '').trim() === v.officer) same += 1;
    else wrong.push({ code, name: v.name, sheet: v.officer, db: p.collectionOfficer || '(فارغ)' });
  }
  console.log(`   ✓ متطابق: ${same}`);
  console.log(`   ✗ مختلف: ${wrong.length}`);
  wrong.slice(0, 20).forEach((w) => console.log(`      ${w.code} ${w.name.slice(0, 28).padEnd(28)} ورقة=${w.sheet.padEnd(10)} قاعدة=${w.db}`));
  console.log(`   ? حسابٌ في الورقة بلا سجلٍّ عندنا: ${notFound.length}`);

  await mongoose.disconnect();
})();
