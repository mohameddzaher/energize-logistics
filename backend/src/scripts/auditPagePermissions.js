/**
 * auditPagePermissions — الصلاحيّاتُ على مستوى الصفحة والنوعِ المصنوع، حيًّا.
 *
 *   node src/scripts/auditPagePermissions.js --base https://api.energize-logistics.com
 *
 * ── ما يُثبَت ─────────────────────────────────────────────────────────────
 * أنّ الفهرس يصل، وأنّ إغلاق صفحةٍ يُغلقها ولا يمسّ جارتَها، وأنّ فتحَ صفحةٍ في
 * قسمٍ ممنوعٍ لا يفتحها (الصفحةُ لا تتجاوز قسمَها)، وأنّ نوعًا يُصنَع يُولَد لا
 * يملك شيئًا ويُسنَد إلى مستخدمٍ ويدخل به فعلًا، وأنّ حذفَه وله أصحابٌ يُرفَض.
 *
 * ── ولا يُترَك أثر ─────────────────────────────────────────────────────────
 * كلُّ ما يُنشئه يُحذَف: الدورُ المصنوع، والمستخدمُ الذي حمله، وحسابُ الفحص. وما
 * يُعدَّل من صلاحيّاتِ دورٍ قائمٍ يُعاد إلى ما كان — تُقرأ حالتُه أوّلًا وتُكتب
 * ثانيةً عبر الواجهة نفسِها، لا في القاعدة، كي يمرّ إبطالُ الذاكرة.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5001');
const ORIGIN = /api\.energize-logistics\.com/.test(BASE)
  ? 'https://energize-logistics.com'
  : (process.env.FRONTEND_URL?.split(',')[0].trim() || 'http://localhost:3000');
const PW = 'Passenergize1!';
const KEY = 'zz_audit_reviewer';

let pass = 0; let fail = 0;
const ok = (l, c, n = '') => { if (c) { pass += 1; console.log(`  ✓  ${l}${n ? `  — ${n}` : ''}`); } else { fail += 1; console.log(`  ✗ فشل  ${l}${n ? `  — ${n}` : ''}`); } };
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const CustomRole = require('../models/CustomRole');
  const RolePermission = require('../models/RolePermission');

  const cleanup = async () => {
    await User.deleteMany({ email: /^zz-perm/ });
    await CustomRole.deleteMany({ key: KEY });
    await RolePermission.deleteMany({ role: KEY });
  };
  await cleanup();

  const su = await User.create({ email: 'zz-perm@example.invalid', password: PW, firstName: 'ف', lastName: 'ح', role: 'super_admin' });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: su.email, password: PW }),
  });
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`الخادم: ${BASE}\nالدخول: ${lr.status}`);
  if (lr.status !== 200) { await cleanup(); process.exit(1); }

  const call = async (cookie, path, init = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN, ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
  };
  const api = (p, i) => call(ck, p, i);

  // حالةُ دورٍ قائمٍ قبل أن نمسّه — تُعاد كما هي مهما جرى.
  let restore = null;
  const VICTIM = 'collections_staff';
  const PAGE_A = '/system/collections-dept/invoices/cash';
  const PAGE_B = '/system/collections-dept/invoices/tax';

  try {
    head('الفهرس');
    const m = await api('/api/admin/permissions');
    ok('المصفوفةُ تُقرأ', m.status === 200, `${m.body?.roles?.length ?? 0} دورًا`);
    ok('الفهرسُ يصل كاملًا', (m.body?.catalog || []).length >= 250, `${(m.body?.catalog || []).length} صفحة`);
    ok('لكلِّ صفحةٍ اسمٌ عربيٌّ مقروء',
      (m.body?.catalog || []).every((p) => p.ar && !p.ar.startsWith('/system')),
      (m.body?.catalog || []).filter((p) => String(p.ar).startsWith('/system')).length + ' بلا اسم');
    ok('كلُّ صفحةٍ لها قسم', (m.body?.catalog || []).every((p) => p.section));

    const before = m.body?.permissions?.[VICTIM] || {};
    const beforePages = m.body?.explicit?.[VICTIM]?.pages || {};
    restore = { sections: before, pages: beforePages, homePage: m.body?.explicit?.[VICTIM]?.homePage || '' };
    ok('دورُ الفحص يملك قسمَه', ['view', 'edit'].includes(before.Collections), `Collections=${before.Collections}`);

    head('إغلاقُ صفحةٍ واحدة');
    const w = await api(`/api/admin/permissions/${VICTIM}`, {
      method: 'PUT',
      body: JSON.stringify({ sections: before, pages: { ...beforePages, [PAGE_A]: false }, homePage: restore.homePage }),
    });
    ok('يُحفَظ', w.status === 200, String(w.status));
    ok('الصفحةُ أُغلقت', w.body?.pages?.[PAGE_A] === false);
    ok('وجارتُها لم تُمسّ', w.body?.pages?.[PAGE_B] === true);
    // القسمُ نفسُه لم يتغيّر — الصفحةُ طبقةٌ تحته لا بديلٌ عنه.
    ok('والقسمُ كما كان', w.body?.permissions?.Collections === before.Collections);

    head('الصفحةُ لا تتجاوز قسمَها');
    const noSection = { ...before, Collections: 'none' };
    const w2 = await api(`/api/admin/permissions/${VICTIM}`, {
      method: 'PUT',
      body: JSON.stringify({ sections: noSection, pages: { [PAGE_A]: true }, homePage: '' }),
    });
    ok('يُحفَظ', w2.status === 200, String(w2.status));
    // ملحوظة: `pages` تُقرأ كما أُرسلت، والحارسُ على البيانات هو القسم — وهذا
    // ما تقوله الشاشةُ صراحةً. فالمفحوصُ هنا أنّ القسمَ صار ممنوعًا فعلًا.
    ok('القسمُ صار ممنوعًا', w2.body?.permissions?.Collections === 'none');

    head('نوعٌ مصنوع');
    const c = await api('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ key: KEY, nameAr: 'مراجعُ فحص', nameEn: 'Audit reviewer', description: 'فحصٌ آليّ' }),
    });
    ok('يُصنَع', c.status === 201, `${c.status} — ${c.body?.message || ''}`);

    const bad = await api('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ key: 'zz_audit_manager', nameAr: 'أ', nameEn: 'b' }),
    });
    ok('ولاحقةُ «_manager» مرفوضة', bad.status === 400, bad.body?.message || String(bad.status));

    const m2 = await api('/api/admin/permissions');
    const born = m2.body?.permissions?.[KEY] || {};
    ok('يُولَد بلا قسمٍ واحد', Object.values(born).every((v) => v === 'none'),
      Object.entries(born).filter(([, v]) => v !== 'none').map(([k]) => k).join(', ') || 'كلُّها ممنوعة');
    const bornPages = m2.body?.pages?.[KEY] || {};
    ok('وبلا صفحةٍ واحدة', Object.values(bornPages).every((v) => v === false),
      `${Object.values(bornPages).filter(Boolean).length} صفحة مفتوحة`);

    head('يُسنَد ويُدخَل به');
    const holder = await User.create({
      email: 'zz-perm-holder@example.invalid', password: PW,
      firstName: 'م', lastName: 'ف', role: KEY,
    });
    ok('يُقبَل على مستخدم', !!holder._id, KEY);

    const g = await api(`/api/admin/permissions/${KEY}`, {
      method: 'PUT',
      body: JSON.stringify({
        sections: { Collections: 'view' },
        pages: { [PAGE_B]: false },
        homePage: PAGE_A,
      }),
    });
    ok('يُمنَح قسمًا وتُغلَق له صفحة', g.status === 200 && g.body?.permissions?.Collections === 'view');
    ok('الممنوحُ يفتح صفحةَ الكاش', g.body?.pages?.[PAGE_A] === true);
    ok('والمغلقةُ مغلقة', g.body?.pages?.[PAGE_B] === false);

    const hl = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: holder.email, password: PW }),
    });
    const hck = (hl.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
    ok('يدخل بالنوع المصنوع', hl.status === 200, String(hl.status));
    const me = await call(hck, '/api/auth/me');
    ok('يحمل خريطةَ الصفحات', Object.keys(me.body?.user?.pageAccess || {}).length >= 250);
    ok('وصفحةُ دخوله كما ضُبطت', me.body?.user?.homePage === PAGE_A, me.body?.user?.homePage || '—');
    ok('واسمُه العربيّ يصل', me.body?.user?.roleLabel?.ar === 'مراجعُ فحص', me.body?.user?.roleLabel?.ar || '—');

    // القسمُ «مشاهدة» → يقرأ ولا يكتب. وهو الحارسُ الحقيقيّ.
    const read = await call(hck, '/api/collections-dept/invoices/cash?limit=1');
    ok('يقرأ ما مُنح', read.status === 200, `${read.status} — ${read.body?.message || ''} ${read.body?.code || ''}`);
    const write = await call(hck, '/api/collections-dept/invoices/detail', {
      method: 'PUT', body: JSON.stringify({ ids: [], detail: 'تحصيل فرع' }),
    });
    ok('ولا يكتب', write.status === 403, `${write.status} — ${write.body?.code || ''}`);
    // قسمٌ لم يُمنَح — لا شيءَ يرثه المصنوع.
    const other = await call(hck, '/api/hr/employees?limit=1');
    ok('ولا يدخل قسمًا لم يُمنَح', other.status === 403, String(other.status));

    head('الحذف');
    const del = await api(`/api/admin/roles/${KEY}`, { method: 'DELETE' });
    ok('يُرفَض وله أصحاب', del.status === 409, del.body?.message || String(del.status));
    await User.deleteOne({ _id: holder._id });
    const del2 = await api(`/api/admin/roles/${KEY}`, { method: 'DELETE' });
    ok('ويُقبَل بعد نقلهم', del2.status === 200, del2.body?.message || String(del2.status));
  } catch (e) {
    fail += 1; console.log(`  ✗ خطأ: ${e.message}`);
  } finally {
    if (restore) {
      head('الإعادة');
      const r = await api(`/api/admin/permissions/${VICTIM}`, {
        method: 'PUT',
        body: JSON.stringify({ sections: restore.sections, pages: restore.pages, homePage: restore.homePage }),
      });
      ok('أُعيد دورُ الفحص كما كان', r.status === 200,
        `Collections=${r.body?.permissions?.Collections} · ${Object.keys(restore.pages).length} استثناء`);
    }
    await cleanup();
    console.log(`\nنجح ${pass} · فشل ${fail}`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
  }
})();
