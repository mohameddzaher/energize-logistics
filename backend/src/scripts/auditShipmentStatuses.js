/**
 * auditShipmentStatuses — حالاتُ الشحنة على البرودكشن.
 *
 *   node src/scripts/auditShipmentStatuses.js --base https://api.energize-logistics.com
 *
 * يفحص أنّ المفردات تُقرأ، وأنّ الفلترَ يقبل أكثرَ من حالة، وأنّ أعدادَ البطاقات
 * لا تنهار حين تُنتقى واحدة (وهو العطبُ الذي يجعل الانتقاءَ المتراكم بلا معنى)،
 * وأنّ التسميةَ المضبوطةَ من الإعدادات تصل، وأنّ ما ليس حالةً يُرفَض.
 *
 * ولا يمسّ شحنةً: الحالةُ تُقرأ ولا تُكتب، والتسميةُ تُعدَّل ثمّ تُعاد.
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
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  await User.deleteMany({ email: /^zz-sostat/ });
  const u = await User.create({ email: 'zz-sostat@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: u.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await User.deleteMany({ email: /^zz-sostat/ }); process.exit(1); }

  const api = async (path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: ck, Origin: ORIGIN, ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };

  let lookupId = null; let originalName = null;
  try {
    head('المفردات');
    const v = await api('/api/shipment-orders/statuses');
    const st = v.body?.statuses || [];
    ok('تُقرأ', st.length >= 10, `${st.length} حالة`);
    ok('العشرةُ الأساسيّة أساسيّة', st.filter((x) => x.isCore).length === 10);
    ok('لكلٍّ لونٌ واسم', st.every((x) => x.key && x.ar && /^#/.test(x.color || '')));

    head('الفلتر');
    const one = await api('/api/shipment-orders/orders?limit=1&status=on_way');
    const two = await api('/api/shipment-orders/orders?limit=1&status=on_way,late');
    const all = await api('/api/shipment-orders/orders?limit=1');
    ok('حالةٌ واحدة', one.status === 200, `${one.body?.total ?? '—'}`);
    ok('حالتان معًا', two.status === 200 && (two.body?.total || 0) >= (one.body?.total || 0),
      `${one.body?.total ?? 0} → ${two.body?.total ?? 0}`);
    // ── البطاقاتُ لا تنهار عند الانتقاء ──────────────────────────────────
    // هذا هو العطبُ الذي يجعل الانتقاءَ المتراكم بلا معنى: تُضغَط «في الطريق»
    // فتصير كلُّ بطاقةٍ سواها صفرًا، فلا يُعرف ما الذي يمكن ضمُّه.
    const others = Object.entries(one.body?.stats?.byStatus || {}).filter(([k]) => k !== 'on_way');
    ok('بطاقاتُ البقيّة تبقى معدودة', others.some(([, n]) => n > 0),
      others.slice(0, 4).map(([k, n]) => `${k}:${n}`).join(' · '));
    // والمقارنةُ بالمفاتيح مرتَّبةً: ترتيبُ `$group` غيرُ مضمون، فمقارنةُ النصّ
    // تُخرج فشلًا كاذبًا على أعدادٍ متطابقة.
    const norm = (o) => Object.entries(o || {}).sort(([a2], [b2]) => a2.localeCompare(b2)).map(([k, n]) => `${k}:${n}`).join(',');
    ok('وهي نفسُها بلا فلتر', norm(one.body?.stats?.byStatus) === norm(all.body?.stats?.byStatus),
      norm(one.body?.stats?.byStatus).slice(0, 70));

    head('التسميةُ من الإعدادات');
    const Lookup = require('../models/Lookup');
    const row = await Lookup.findOne({ type: 'so_status', key: 'on_way' }).lean();
    ok('القائمةُ مبذورة', !!row, row ? `«${row.nameAr}»` : 'غير موجودة');
    if (row) {
      lookupId = row._id; originalName = row.nameAr;
      const upd = await api(`/api/lookups/${row._id}`, {
        method: 'PUT', body: JSON.stringify({ nameAr: 'في الطريق (فحص)', nameEn: row.nameEn, color: row.color, isActive: true }),
      });
      ok('تُعدَّل من الواجهة', upd.status === 200, String(upd.status));
      // ستُّ قراءات: البرودكشن عاملان.
      const reads = [];
      for (let i = 0; i < 6; i += 1) {
        const r = await api('/api/shipment-orders/statuses');
        reads.push((r.body?.statuses || []).find((x) => x.key === 'on_way')?.ar || '');
      }
      ok('تصل الشاشاتِ فورًا من العاملَين', reads.every((x) => x === 'في الطريق (فحص)'), reads.join(' | '));
    }

    head('ما ليس حالة');
    const bad = await api('/api/shipment-orders/orders?limit=1');
    const anyOrder = (bad.body?.orders || [])[0];
    if (anyOrder) {
      const r = await api(`/api/shipment-orders/orders/${anyOrder._id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: 'zzz_not_a_status' }),
      });
      ok('تُرفَض كلمةٌ ليست حالة', r.status === 400, `${r.status} — ${r.body?.message || ''}`);
    }
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    if (lookupId && originalName) {
      const Lookup = require('../models/Lookup');
      const row = await Lookup.findById(lookupId).lean();
      const r = await api(`/api/lookups/${lookupId}`, {
        method: 'PUT', body: JSON.stringify({ nameAr: originalName, nameEn: row.nameEn, color: row.color, isActive: true }),
      });
      head('الإعادة');
      ok('أُعيدت التسمية', r.status === 200, `«${originalName}»`);
    }
    await User.deleteMany({ email: /^zz-sostat/ });
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
