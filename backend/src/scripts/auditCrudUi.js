/* eslint-disable no-console */
/**
 * Finds screens that show a record but offer no create, edit or delete button.
 * The sibling auditCrudCoverage reads the server; this reads the UI. An API route with no button is effectively missing.
 * Dashboards and reports are excluded: an analytics screen without a create button is correct.
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

  // A screen shows a record only if it reads a list.
  const reads = /api\.get\s*(<[^>]*>)?\s*\(/.test(src);
  if (!reads) continue;

  // Counts what the screen does itself plus what the shared components it imports do. A screen using DocumentFamilyPage has full CRUD without a line of its own; counting it as incomplete floods the report.
  const own = src;
  const imported = [...src.matchAll(/from '@\/components\/([^']+)'/g)].map((m) => m[1]);
  let all = own;
  for (const im of imported) {
    for (const ext of ['.tsx', '.ts']) {
      const f2 = path.join(ROOT, '../../components', im + ext);
      if (fs.existsSync(f2)) { all += fs.readFileSync(f2, 'utf8'); break; }
    }
  }

  // Handles api.post<{shipment:any}>(...): the generic type sits between the name and the parenthesis; missing it showed a full create screen as having no create.
  const has = (verb) => new RegExp(`api\\.${verb}\\s*(<[^>]*>)?\\s*\\(`).test(all);
  const create = has('post');
  const update = has('put') || has('patch');
  const del = has('delete');
  const isDetail = /\[[^\]]+\]$/.test(rel);
  // A list page whose create lives on a separate screen (/new) is not incomplete.
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
