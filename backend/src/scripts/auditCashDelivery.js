/**
 * auditCashDelivery — التسليمُ والتفصيل في صفحة الكاش، على البرودكشن.
 *
 *   node src/scripts/auditCashDelivery.js --base https://api.energize-logistics.com
 *
 * ── ما يُفحَص ──────────────────────────────────────────────────────────────
 * أنّ القائمةَ المُدارة بُذرت، وأنّ صفَّ الكاش يحمل حقلَيه الجديدين، وأنّ
 * الكتابةَ تصل — من الشاشة (`/invoices/detail`) ومن التطبيق (`PUT /invoices/
 * cash/:id`) معًا، فذاك هو الطريقُ الذي كان مفقودًا.
 *
 * ── ولا يُترَك أثر ─────────────────────────────────────────────────────────
 * البياناتُ حيّةٌ يعمل عليها فريق. فيُقرأ صفٌّ حقيقيٌّ ويُحفَظ ما كان فيه، ثمّ
 * تُكتَب القيمُ وتُقرأ، ثمّ يُعاد ما كان — عبر الواجهة نفسِها لا بكتابةٍ في
 * القاعدة، فما تفعله الواجهةُ من إبطالِ ذاكرةٍ وتحديثٍ للدفتر يجري كذلك.
 *
 * والقراءةُ تُكرَّر ستًّا: البرودكشن عاملان ولكلٍّ ذاكرتُه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';

let pass = 0; let fail = 0;
const ok = (label, cond, note = '') => {
  if (cond) { pass += 1; console.log(`  ✓  ${label}${note ? `  — ${note}` : ''}`); }
  else { fail += 1; console.log(`  ✗ فشل  ${label}${note ? `  — ${note}` : ''}`); }
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  await User.deleteMany({ email: /^zz-cashaudit/ });
  const u = await User.create({ email: 'zz-cashaudit@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });

  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await User.deleteMany({ email: /^zz-cashaudit/ }); process.exit(1); }

  const api = async (path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: ck, Origin: ORIGIN, ...(init.headers || {}) },
    });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };

  let restore = null;
  try {
    head('القائمةُ المُدارة');
    const lk = await api('/api/lookups?type=collections_detail&active=true');
    const items = lk.body?.items || [];
    const names = items.map((i) => i.nameAr);
    ok('بُذرت `collections_detail`', items.length >= 3, `${items.length} قيمة: ${names.join('، ')}`);
    ok('القيمُ الثلاث موجودة', ['تحصيل فرع', 'تحصيل كاش', 'تحصيل عميل'].every((n) => names.includes(n)));

    head('صفُّ الكاش');
    const list = await api('/api/collections-dept/invoices/cash?page=1&limit=5');
    const row = (list.body?.invoices || [])[0];
    ok('الصفحةُ تردّ صفوفًا', !!row, `${list.body?.total ?? 0} كشفًا نقديًّا`);
    if (!row) throw new Error('لا صفوف');
    ok('الصفُّ يحمل `deliveryDate`', 'deliveryDate' in row);
    ok('الصفُّ يحمل `collectionDetail`', 'collectionDetail' in row);

    // ما كان في الصفّ — يُعاد كما هو مهما جرى بعده.
    restore = { id: row._id, detail: row.collectionDetail || '', delivery: row.deliveryDate || null };
    console.log(`  · صفُّ الفحص: كشف ${row.reportNumber} — التفصيل «${restore.detail || 'فارغ'}»، التسليم ${restore.delivery ? String(restore.delivery).slice(0, 10) : 'فارغ'}`);

    head('الكتابةُ من الشاشة');
    const w1 = await api('/api/collections-dept/invoices/detail', {
      method: 'PUT', body: JSON.stringify({ ids: [row._id], detail: 'تحصيل فرع' }),
    });
    ok('`PUT /invoices/detail` تقبل', w1.status === 200, `${w1.status} — ${w1.body?.message || ''}`);

    // ستُّ قراءات: عاملان، ولكلٍّ ذاكرتُه.
    const reads = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await api(`/api/collections-dept/invoices/cash?q=${encodeURIComponent(row.reportNumber)}&limit=5`);
      reads.push((r.body?.invoices || []).find((x) => x._id === row._id)?.collectionDetail || '');
    }
    ok('تُقرأ من العاملَين معًا', reads.every((v) => v === 'تحصيل فرع'), `${reads.join(' | ')}`);

    head('الكتابةُ من التطبيق');
    const w2 = await api(`/api/collections-dept/invoices/cash/${row._id}`, {
      method: 'PUT', body: JSON.stringify({ deliveryDate: '2026-09-01', collectionDetail: 'تحصيل عميل' }),
    });
    ok('`PUT /invoices/cash/:id` موجود ويقبل', w2.status === 200, `${w2.status} — ${w2.body?.message || w2.body?.error || ''}`);

    const after = await api(`/api/collections-dept/invoices/cash?q=${encodeURIComponent(row.reportNumber)}&limit=5`);
    const a = (after.body?.invoices || []).find((x) => x._id === row._id);
    ok('التسليمُ للعميل كُتب', String(a?.deliveryDate || '').slice(0, 10) === '2026-09-01', String(a?.deliveryDate || '—'));
    ok('التفصيلُ تغيّر', a?.collectionDetail === 'تحصيل عميل', a?.collectionDetail || '—');

    head('الفلترُ بالتفصيل');
    const f = await api('/api/collections-dept/invoices/cash?detail=' + encodeURIComponent('تحصيل عميل') + '&limit=5');
    ok('`?detail=` يُصفّي', f.status === 200 && (f.body?.invoices || []).every((x) => x.collectionDetail === 'تحصيل عميل'),
      `${f.body?.total ?? 0} كشفًا`);
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    // ── الإعادةُ عبر الواجهة ────────────────────────────────────────────────
    // لا بكتابةٍ في القاعدة: ما تفعله الواجهةُ من إبطالِ ذاكرةٍ وتحديثٍ للدفتر
    // يجب أن يجري في الإعادة كما جرى في الكتابة، وإلّا بقيت شاشةٌ تقول غيرَ ما
    // في القاعدة.
    if (restore) {
      const r = await api(`/api/collections-dept/invoices/cash/${restore.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          deliveryDate: restore.delivery ? String(restore.delivery).slice(0, 10) : null,
          collectionDetail: restore.detail,
        }),
      });
      head('الإعادة');
      ok('أُعيد الصفُّ كما كان', r.status === 200,
        `التفصيل «${restore.detail || 'فارغ'}»، التسليم ${restore.delivery ? String(restore.delivery).slice(0, 10) : 'فارغ'}`);
    }
    await User.deleteMany({ email: /^zz-cashaudit/ });
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
