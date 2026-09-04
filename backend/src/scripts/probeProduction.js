/**
 * probeProduction — قياسٌ للبرودكشن بلا لمسِ بياناته.
 *
 *   node src/scripts/probeProduction.js --base https://api.energize-logistics.com
 *
 * ── ما يفعله ───────────────────────────────────────────────────────────────
 * يقرأ الشاشاتِ الثقيلة كما يقرؤها الموظّفون — قراءةً فقط، ولا كتابةَ إلّا حسابَ
 * فحصٍ يُنشئه ويحذفه — ويقيس: زمنَ الاستجابة عند الوسيط وعند ٩٥٪، والأخطاء،
 * وثباتَ الجواب عبر العاملَين، وما يحدث حين يفتحها عشرون موظّفًا في الثانية
 * نفسِها.
 *
 * ── لماذا ٩٥٪ لا المتوسّط ──────────────────────────────────────────────────
 * المتوسّطُ يخفي الطرف: عشرُ قراءاتٍ في ٢٠٠ ملّي وواحدةٌ في ثمانِ ثوانٍ متوسّطُها
 * ثمانمئة — رقمٌ يبدو مقبولًا، والموظّفُ الذي وقعت عليه الثامنة يقول «النظام
 * واقف». الطرفُ هو ما يُشتكى منه.
 *
 * ── وثباتُ الجواب ─────────────────────────────────────────────────────────
 * البرودكشن عاملان ولكلٍّ ذاكرتُه، فيُقرأ كلُّ مسارٍ ستَّ مرّاتٍ ويُقارَن العدد:
 * اختلافُه بين قراءتين متتاليتين يعني ذاكرتين تفترقان — وهو عطبٌ رأيناه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0; const warn = [];
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };

// الشاشاتُ الثقيلة — ماليّةٌ في معظمها، وهي التي لا يُحتمل أن تسقط.
const PAGES = [
  ['سير عمل التشغيل', '/api/workflows?page=1&limit=50'],
  // `filters` تحتاج اسمَ العمود — بلا اسمٍ تردّ ٤٠٠ وهو صواب.
  ['فلاتر التشغيل', '/api/workflows/filters?field=payingBranch'],
  ['إحصاءات التشغيل', '/api/workflows/stats'],
  ['فواتير ضريبيّة', '/api/collections-dept/invoices/tax?page=1&limit=50'],
  ['فواتير كاش', '/api/collections-dept/invoices/cash?page=1&limit=50'],
  ['أعمار الديون', '/api/collections-dept/ledger/aging?page=1&limit=50'],
  ['دفتر الفواتير', '/api/collections-dept/ledger/invoices?page=1&limit=50'],
  ['تنبيهات الائتمان', '/api/collections-dept/ledger/alerts'],
  ['لوحة التحصيل', '/api/collections-dept/dashboard'],
  // العهدةُ للفرع، فحسابُ الفحص بلا فرعٍ يجب أن يُسأل عن الفرع — يُمرَّر صراحةً.
  ['المحفظة اليوميّة', `/api/wallet/daily?date=${new Date().toISOString().slice(0, 10)}&branchId=__BRANCH__`],
  ['لوحة المحافظ', '/api/wallet/dashboard'],
  ['سجل المركبات', '/api/vehicle-registry?limit=50'],
  ['فلاتر المركبات', '/api/vehicle-registry/filters'],
  ['انتهاءات المركبات', '/api/vehicle-registry/expiring'],
  ['الموظفون', '/api/hr/employees?limit=50'],
  ['لوحة الموارد البشريّة', '/api/hr/dashboard'],
  ['تحليلات', '/api/analytics/dashboard'],
  ['المركبات (القسم)', '/api/vehicles?limit=50'],
  ['الإشعارات', '/api/notifications?limit=20'],
  // ── وبقيّةُ الأقسام ────────────────────────────────────────────────────────
  // أُضيفت بعد أن فُحصت بياناتُها: الشاشةُ التي تُقرأ صحيحةً وتُفتَح ببطءٍ لم
  // تُفحَص كاملةً. وهذه أثقلُها بيانًا — B2C خمسةٌ وأربعون ألفَ طلب، وطلباتُ
  // الشحنات أربعةٌ وثلاثون ألفًا، وتنبيهاتُ LS2 ستّةٌ وخمسون ألفًا.
  ['B2C — الطلبات', '/api/b2c/daily-orders?limit=50'],
  ['B2C — اللوحة', '/api/b2c/dashboard'],
  ['طلبات الشحنات', '/api/shipment-orders/orders?limit=50'],
  ['LS2 — اللوحة', '/api/ls2/dashboard'],
  ['LS2 — التنبيهات', '/api/ls2/alerts?limit=50'],
  ['العقود — اللوحة', '/api/contracts/dashboard'],
  ['العقود — الاستغلال', '/api/contracts/utilisation'],
  ['التخليص الجمركي', '/api/customs-clearance?limit=50'],
  ['إدارة الأسطول', '/api/fleet/dashboard'],
  ['CRM — الشركات', '/api/crm/companies?limit=50'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  await User.deleteMany({ email: /^zz-probe/ });
  const u = await User.create({ email: 'zz-probe@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });

  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await User.deleteMany({ email: /^zz-probe/ }); process.exit(1); }

  // فرعٌ حقيقيٌّ لقراءة العهدة — قراءةً فقط.
  const Branch = require('../models/Branch');
  const branch = await Branch.findOne({}).select('_id').lean();
  const withBranch = (p) => p.replace('__BRANCH__', String(branch?._id || ''));

  const call = async (p0) => {
    const p = withBranch(p0);
    const t = Date.now();
    try {
      const r = await fetch(`${BASE}${p}`, { headers: { Cookie: ck, Origin: ORIGIN } });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch (_) {}
      return { ms: Date.now() - t, status: r.status, j, bytes: txt.length };
    } catch (e) { return { ms: Date.now() - t, status: 0, err: e.message }; }
  };

  // ── ① كلُّ شاشةٍ تُفتَح، وكم تأخذ ─────────────────────────────────────────
  head('كلُّ شاشةٍ تُفتَح — وكم تأخذ');
  const slow = []; const broken = [];
  for (const [name, path] of PAGES) {
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push(await call(path));
    const bad = runs.find((r) => r.status !== 200);
    const ms = runs.map((r) => r.ms);
    const p95 = pct(ms, 0.95);
    const kb = Math.round((runs[0].bytes || 0) / 1024);
    if (bad) broken.push(`${name} (${bad.status}${bad.err ? ' ' + bad.err : ''})`);
    else if (p95 > 2000) slow.push(`${name} ${p95}ms`);
    console.log(`  ${bad ? '✗' : p95 > 2000 ? '⚠' : '·'} ${name.padEnd(24)} ${String(pct(ms, 0.5)).padStart(5)}ms وسيط · ${String(p95).padStart(5)}ms عند ٩٥٪ · ${String(kb).padStart(5)}ك.ب${bad ? `  ← ${bad.status}` : ''}`);
  }
  ok('كلُّ الشاشات تُجيب ٢٠٠', broken.length === 0, broken.join('، ') || `${PAGES.length} شاشة`);
  ok('ولا شاشةَ تتجاوز ثانيتين عند ٩٥٪', slow.length === 0, slow.join('، ') || 'الكلّ دون ثانيتين');

  // ── ② ثباتُ الجواب عبر العاملَين ─────────────────────────────────────────
  head('ثباتُ الجواب — العاملان يقولان الشيءَ نفسَه');
  const unstable = []; const drifting = [];
  for (const [name, path] of PAGES) {
    const counts = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await call(path);
      const j = r.j || {};
      counts.push(j.total ?? j.count ?? (Array.isArray(j.rows) ? j.rows.length : null)
        ?? (Array.isArray(j.vehicles) ? j.vehicles.length : null) ?? (Array.isArray(j.invoices) ? j.invoices.length : null) ?? -1);
    }
    // ── والاختلافُ نوعان ────────────────────────────────────────────────────
    // ذاكرتان تفترقان تُعطيان تناوبًا: أ ب أ ب أ ب — أوّلُ مرّةٍ ظهر هذا العطبُ
    // كان ٤٣ و٤٢ اثنتَي عشرةَ مرّةً بلا استثناء. أمّا البياناتُ الحيّة (تنبيهاتُ
    // التتبّع تُضاف وتُغلَق كلَّ دقائق) فتتحرّك في اتّجاهٍ واحدٍ ولا تعود.
    // فاشتراطُ ثباتِ العدد يجعل الشاشةَ الحيّةَ تفشل أبدًا بلا عطب.
    const alternating = counts.length >= 4
      && new Set(counts).size === 2
      && counts.every((c, i) => i < 2 || c === counts[i - 2])
      && counts[0] !== counts[1];
    if (alternating) unstable.push(`${name}: ${counts.join(' ')} (تناوبٌ — ذاكرتان)`);
    else if (new Set(counts).size > 1) drifting.push(`${name}: ${counts.join(' ')}`);
  }
  ok('لا شاشةَ تتناوب بين عاملَين', unstable.length === 0, unstable.join(' · ') || `${PAGES.length} شاشة`);
  if (drifting.length) console.log(`  · بياناتٌ حيّةٌ تتحرّك أثناء القراءة (طبيعيّ): ${drifting.join(' · ')}`);

  // ── ③ عشرون موظّفًا في الثانية نفسِها ────────────────────────────────────
  head('الضغط — عشرون طلبًا متزامنًا على الشاشات الماليّة');
  const heavy = PAGES.filter(([n]) => /تشغيل|فواتير|أعمار|محفظة|تحصيل|دفتر|B2C|شحنات|LS2/.test(n));
  for (const [name, path] of heavy) {
    const t = Date.now();
    const res = await Promise.all(Array.from({ length: 20 }, () => call(path)));
    const wall = Date.now() - t;
    const errs = res.filter((r) => r.status !== 200);
    const ms = res.map((r) => r.ms);
    const sizes = new Set(res.filter((r) => r.status === 200).map((r) => r.bytes));
    console.log(`  ${errs.length ? '✗' : '·'} ${name.padEnd(24)} ${String(pct(ms, 0.5)).padStart(5)}ms وسيط · ${String(pct(ms, 0.95)).padStart(5)}ms عند ٩٥٪ · الكلّ في ${wall}ms · أخطاء ${errs.length} · أجوبةٌ مختلفة ${sizes.size}`);
    if (errs.length) warn.push(`${name}: ${errs.length}/٢٠ فشلت (${[...new Set(errs.map((e) => e.status))].join('،')})`);
  }
  ok('لا طلبَ يسقط تحت عشرين متزامنًا', warn.length === 0, warn.join(' · ') || 'صفرُ أخطاء');

  await User.deleteMany({ email: /^zz-probe/ });
  console.log(`\n${'═'.repeat(62)}\n  ناجح ${pass} · فاشل ${fail}\n${'═'.repeat(62)}`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('FATAL', e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
