/**
 * auditCollectionsCoverage — كلُّ صفٍّ في دفتر التحصيل: أفي القاعدة؟ وأيظهر في شاشة؟
 *
 *   node --max-old-space-size=8192 src/scripts/auditCollectionsCoverage.js --base https://api.energize-logistics.com
 *
 * ── لماذا سؤالان لا واحد ────────────────────────────────────────────────────
 * `auditCollectionsWorkbook` كان يقول «كلُّ فاتورةٍ في الورقة موجودةٌ عندنا»
 * وكان صادقًا — ثمانيةُ آلافٍ وتسعُمئةٍ وثمانٍ وسبعون فاتورةً في القاعدة. وفي
 * الوقت نفسِه كانت صفحةُ الفواتير الضريبيّة تعرض خمسَمئةٍ وثمانيًا وخمسين
 * منها، لأنّها تُجمِّع الكشوفَ لا تقرأ الدفتر. فُتِح البحثُ عن الفاتورة ١١٨٠٠
 * فلم تُوجد، وهي في النظام.
 *
 * «موجودةٌ في القاعدة» و«يراها المستخدم» سؤالان مختلفان، وهذا الفحصُ يسأل
 * الاثنين: يقرأ الورقةَ صفًّا صفًّا، ثمّ يسأل **الشاشة نفسَها** عبر ندائها.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';
const FILE = path.join(__dirname, '..', '..', '..', 'collection files', 'Financial Collections    9-2026.xlsx');

let pass = 0; let fail = 0; const notes = [];
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);
const S = (v) => (v == null ? '' : String(v).trim());
const N = (v) => { const n = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const CollectionInvoice = require('../models/CollectionInvoice');
  const CollectionsParty = require('../models/CollectionsParty');
  const OW = require('../models/OperationsWorkflow');

  await User.deleteMany({ email: /^zz-cov/ });
  const u = await User.create({ email: 'zz-cov@example.invalid', password: PW, firstName: 'ف', lastName: 'ت', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Cookie: ck, Origin: ORIGIN } });
    let j = null; try { j = JSON.parse(await r.text()); } catch (_) {}
    return { status: r.status, j };
  };

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  تغطيةُ دفتر التحصيل — في القاعدة، وعلى الشاشة');
  console.log('══════════════════════════════════════════════════════════════');

  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const sheet = (n, h) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false, raw: true }).slice(h + 1);

  // ═══ ١ · الفواتير ═══════════════════════════════════════════════════════
  head('الفواتير — كلُّ صفٍّ في Daily Invoice Report');
  const invRows = sheet('Daily Invoice Report', 5);
  const byKey = new Map();
  let skipped = 0; let hollow = 0;
  for (const r of invRows) {
    const no = S(r[2]);
    if (!/^-?\d+$/.test(no)) { skipped += 1; continue; }
    const key = `${no}::${S(r[0])}`;
    const row = { no, code: S(r[0]), name: S(r[1]), total: N(r[3]) };
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, row); else prev.total += row.total;
  }
  for (const [k, d] of byKey) if (!d.code && !d.name && !d.total) { byKey.delete(k); hollow += 1; }
  console.log(`  الورقة: ${invRows.length} صفًّا · ${byKey.size} فاتورةً (${skipped} بلا رقمٍ صالح، ${hollow} رقمًا محجوزًا)`);

  const ours = await CollectionInvoice.find({}).select('invoiceNumber sheetCode total').lean();
  const ourKeys = new Set(ours.map((i) => `${i.invoiceNumber}::${i.sheetCode || ''}`));
  const missingDb = [...byKey.keys()].filter((k) => !ourKeys.has(k));
  ok('كلُّ فاتورةٍ في الورقة موجودةٌ في القاعدة', missingDb.length === 0,
    missingDb.length ? `ناقص ${missingDb.length}: ${missingDb.slice(0, 5).join('، ')}` : `${byKey.size} فاتورة`);
  ok('ولا فاتورةَ في القاعدة ليست في الورقة', ours.length === byKey.size,
    `القاعدة ${ours.length} · الورقة ${byKey.size}`);

  const sheetSum = [...byKey.values()].reduce((a, b) => a + b.total, 0);
  const dbSum = ours.reduce((a, b) => a + (b.total || 0), 0);
  ok('ومجموعُ القيم مطابقٌ إلى الهللة', r2(sheetSum) === r2(dbSum),
    `الورقة ${sheetSum.toLocaleString()} · القاعدة ${dbSum.toLocaleString()}`);

  // ── وعلى الشاشة ─────────────────────────────────────────────────────────
  const page = await get('/api/collections-dept/invoices/tax?limit=1');
  ok('وصفحةُ الفواتير الضريبيّة تعرضها كلَّها', page.j?.total === byKey.size,
    `الصفحة ${page.j?.total} · الورقة ${byKey.size}`);
  ok('ومجموعُ الصفحة يساوي مجموعَ الورقة', r2(page.j?.totals?.value) === r2(sheetSum),
    `${page.j?.totals?.value?.toLocaleString()} · ${sheetSum.toLocaleString()}`);

  // كلُّ فاتورةٍ تُوجَد بالبحث — تُجرَّب عيّنةٌ عشوائيّةٌ واسعة
  const sample = [...byKey.values()].filter((x) => !x.no.startsWith('-')).sort(() => Math.random() - 0.5).slice(0, 25);
  let found = 0; const notFound = [];
  for (const x of sample) {
    const r = await get(`/api/collections-dept/invoices/tax?q=${encodeURIComponent(x.no)}`);
    if ((r.j?.invoices || []).some((i) => i.invoiceNumber === x.no)) found += 1; else notFound.push(x.no);
  }
  ok('وكلُّ فاتورةٍ تُوجَد بالبحث عن رقمها', notFound.length === 0,
    notFound.length ? `لم تُوجَد: ${notFound.join('، ')}` : `${found} عيّنةً عشوائيّة`);

  // ═══ ٢ · الحسابات ═══════════════════════════════════════════════════════
  head('الحسابات — Aging + Aging Shipment');
  const accKeys = new Set();
  for (const [name, h] of [['Aging', 4], ['Aging Shipment', 4]]) {
    for (const r of sheet(name, h)) {
      const code = S(r[0]);
      if (code && /^[\dC]/i.test(code)) accKeys.add(code);
    }
  }
  const parties = await CollectionsParty.find({ code: { $nin: [null, ''] } }).select('code name').lean();
  const pCodes = new Set(parties.map((p) => p.code));
  const missAcc = [...accKeys].filter((c) => !pCodes.has(c));
  ok('كلُّ حسابٍ في الورقتين موجودٌ في القاعدة', missAcc.length === 0,
    missAcc.length ? missAcc.slice(0, 8).join('، ') : `${accKeys.size} حسابًا`);

  const ag = await get('/api/collections-dept/ledger/aging?limit=500');
  const shown = new Set((ag.j?.rows || []).map((r) => r.code).filter(Boolean));
  const missShown = [...accKeys].filter((c) => !shown.has(c));
  ok('وسجلُّ الأعمار يعرضها كلَّها', missShown.length === 0,
    missShown.length ? `${missShown.length} لا تظهر: ${missShown.slice(0, 6).join('، ')}` : `${shown.size} حسابًا`);

  // ── والمستحقُّ النقديُّ لم يعد صفرًا ─────────────────────────────────────
  const cashOwed = sheet('Aging Shipment', 4)
    .filter((r) => S(r[0]) && /^[\dC]/i.test(S(r[0])) && N(r[9]) > 0)
    .map((r) => ({ code: S(r[0]), out: N(r[9]) }));
  const zeroed = cashOwed.filter((x) => {
    const row = (ag.j?.rows || []).find((r) => r.code === x.code);
    return !row || (Number(row.outstanding) || 0) === 0;
  });
  ok('ولا حسابَ نقديٍّ عليه مستحقٌّ ويظهر بصفر', zeroed.length === 0,
    zeroed.length ? `${zeroed.length}: ${zeroed.slice(0, 6).map((z) => z.code).join('، ')}` : `${cashOwed.length} حسابًا`);

  // ═══ ٣ · الكشوف النقديّة ════════════════════════════════════════════════
  head('الكشوف النقديّة — Shipment Report');
  const ships = new Set();
  for (const r of sheet('Shipment Report', 5)) { const n = S(r[5]); if (/^\d+$/.test(n)) ships.add(n); }
  const nums = [...ships];
  const have = new Set();
  for (let i = 0; i < nums.length; i += 1000) {
    for (const w of await OW.find({ reportNumber: { $in: nums.slice(i, i + 1000) } }).select('reportNumber').lean()) have.add(w.reportNumber);
  }
  const missShip = nums.filter((n) => !have.has(n));
  ok('كلُّ كشفٍ نقديٍّ في الورقة موجودٌ عندنا', missShip.length === 0,
    missShip.length ? `${missShip.length}` : `${ships.size} كشفًا`);
  const notCash = await OW.countDocuments({ reportNumber: { $in: nums }, paymentType: { $ne: 'cash' } });
  ok('وكلُّها نوعُها نقديّ', notCash === 0, `${notCash} مختلفًا`);
  const cashPage = await get('/api/collections-dept/invoices/cash?limit=1');
  ok('وصفحةُ فواتير الكاش تعرض الكشوف النقديّة', (cashPage.j?.total || 0) >= ships.size,
    `الصفحة ${cashPage.j?.total} · الورقة ${ships.size}`);

  // ═══ ٤ · JP ═════════════════════════════════════════════════════════════
  head('المناطق — JP');
  const jp = new Map();
  for (const r of sheet('JP', 6)) { const c = S(r[0]); if (c && !jp.has(c)) jp.set(c, S(r[9])); }
  let regDiff = 0;
  for (const p of await CollectionsParty.find({ code: { $in: [...jp.keys()] } }).select('code region').lean()) {
    if (S(jp.get(p.code)) !== S(p.region)) regDiff += 1;
  }
  ok('منطقةُ كلّ حسابٍ مطابقة', regDiff === 0, `${regDiff} مختلفًا`);

  await User.deleteMany({ email: /^zz-cov/ });
  console.log(`\n${'═'.repeat(62)}\n  ناجح ${pass} · فاشل ${fail}\n${'═'.repeat(62)}`);
  if (notes.length) { console.log('\nملاحظات:'); for (const n of notes) console.log(`  · ${n}`); }
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('FATAL', e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
