/* eslint-disable no-console */
/**
 * auditCrudUi — أيُّ شاشةٍ تعرض سجلًّا ولا تعطي زرّ إنشاءٍ أو تعديلٍ أو حذف؟
 *
 *   node src/scripts/auditCrudUi.js
 *
 * الفحص الأخُ (auditCrudCoverage) يقرأ الخادم؛ وهذا يقرأ الواجهة. والفرق
 * جوهريّ: مسارٌ موجودٌ في الـAPI ولا زرَّ له في الشاشة غيرُ موجودٍ عمليًّا —
 * والمستخدم يشتكي ممّا لا يراه لا ممّا لا يوجد.
 *
 * ويُستبعد ما هو لوحةٌ أو تقريرٌ بطبعه: شاشةُ تحليلاتٍ بلا زرّ إنشاء صحيحةٌ لا
 * ناقصة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../../frontend/src/app/system');
const READ_ONLY_PAGE = /(dashboard|analytics|kpis|overview|report|board|arrivals|pipeline|calendar|live|scorecard|executive|loads-analysis|driver-kpis|expiring|alerts|history|audit|my-tasks|profile|guide|search|^portal|chat|attendance|analysis)/i;

const pages = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (e.name === 'page.tsx') pages.push(full);
  }
};
walk(ROOT);

const rows = [];
for (const f of pages) {
  const rel = path.relative(ROOT, f).replace(/\/page\.tsx$/, '') || '/';
  if (READ_ONLY_PAGE.test(rel)) continue;
  const src = fs.readFileSync(f, 'utf8');

  // الشاشة تعرض سجلًّا؟ إن لم تقرأ قائمةً فليست شاشةَ سجلّ.
  const reads = /api\.get\s*(<[^>]*>)?\s*\(/.test(src);
  if (!reads) continue;

  // ما تفعله الشاشةُ نفسها، وما تفعله المكوّنات المشتركة التي تستوردها.
  // شاشةٌ تستعمل DocumentFamilyPage لها CRUD كامل وإن لم تكتب سطرًا واحدًا،
  // وعدُّها ناقصةً يُغرق التقرير بما لا عمل فيه.
  const own = src;
  const imported = [...src.matchAll(/from '@\/components\/([^']+)'/g)].map((m) => m[1]);
  let all = own;
  for (const im of imported) {
    for (const ext of ['.tsx', '.ts']) {
      const f2 = path.join(ROOT, '../../components', im + ext);
      if (fs.existsSync(f2)) { all += fs.readFileSync(f2, 'utf8'); break; }
    }
  }

  // `api.post<{shipment:any}>(…)` — النوع العامّ بين الاسم والقوس، وإغفالُه
  // كان يُظهر شاشةَ إنشاءٍ كاملةً على أنّها بلا إنشاء.
  const has = (verb) => new RegExp(`api\\.${verb}\\s*(<[^>]*>)?\\s*\\(`).test(all);
  const create = has('post');
  const update = has('put') || has('patch');
  const del = has('delete');
  const isDetail = /\[[^\]]+\]$/.test(rel);
  // صفحةُ قائمةٍ يكون إنشاؤها في شاشةٍ مستقلّة (`/new`) ليست ناقصة.
  const hasNewPage = fs.existsSync(path.join(ROOT, rel, 'new', 'page.tsx'));

  const missing = [];
  if (!create && !isDetail && !hasNewPage) missing.push('إنشاء');
  if (!update) missing.push('تعديل');
  if (!del) missing.push('حذف');
  if (missing.length) rows.push({ rel, missing, n: missing.length });
}

rows.sort((a, b) => b.n - a.n || a.rel.localeCompare(b.rel));
console.log('\n  الشاشة                                            الناقص');
console.log('  ' + '─'.repeat(74));
for (const r of rows) console.log('  ' + r.rel.padEnd(50) + r.missing.join(' · '));
console.log(`\n  فُحصت ${pages.length} شاشة · ${rows.length} ناقصةُ أفعال · ${rows.filter((r) => r.n === 3).length} بلا أيّ فعل.\n`);
