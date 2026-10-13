#!/usr/bin/env node
/**
 * حارسُ بوّابات الأزرار — صلاحيّةٌ ممنوحةٌ يجب أن تُرى في الشاشة.
 *
 * ── العلّة التي تكرّرت ──────────────────────────────────────────────────────
 * الخادمُ يفتح القسمَ لمن مُنح «تعديل» في مصفوفة الصلاحيّات (sectionGate ثمّ
 * authorize). والشاشةُ تُخفي أزرارَها بقائمةِ أدوارٍ مكتوبةٍ بيد:
 *   const canEdit = ['super_admin', 'x_manager'].includes(user?.role)
 * فمَن مُنح القسمَ يفتح الصفحةَ ولا يجد زرَّ الحفظ — «عملت حاجة ومسمعتش»، أو
 * «مش لاقي الزرار»، وكلُّ مرّةٍ تُصلَح شاشةٌ واحدة. فهذا يمنع عودتَها: البناءُ
 * يفشل إن وُجدت بوّابةٌ بأسماء الأدوار وحدَها.
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * بوّابةٌ تُقرأ من دور المستخدم يجب أن تقرأ معه منحَ القسم
 * (`canEditSection` / `canAccessSection` / `permissions` أو مساعدًا يفعل ذلك)،
 * أو أن تقول صراحةً إنّها بالدور وحدَه عن قصد:
 *   // role-only: <السبب>
 * (مالٌ، حذفٌ لا يُستعاد، شاشةُ مدير النظام). فالقصدُ يُكتب، والسهوُ يُمسَك.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const DIRS = ['app/system', 'components'];
const GATE = /\b(?:const|let)\s+(can[A-Z]\w*|is[A-Z]\w*|may[A-Z]\w*|allowed)\b[^;\n]*\.includes\(\s*(?:user\??\.role|role|String\([^)]*role[^)]*\))/;
const HONOURS = /canEditSection|canAccessSection|permissions|isLs2(?:Admin|Staff)|isFinance\w*|isSales\w*|jp(?:Member|Manager)|sectionAccess/;
const MARK = /role-only\s*:/;

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
DIRS.forEach((d) => walk(path.join(ROOT, d)));

const bad = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!GATE.test(line)) return;
    // العبارةُ قد تمتدّ على أسطر: تُقرأ حتى الفاصلة المنقوطة.
    let stmt = line; let j = i;
    while (!/;\s*(\/\/.*)?$/.test(lines[j]) && j < i + 6 && j + 1 < lines.length) { j += 1; stmt += `\n${lines[j]}`; }
    const around = `${lines[i - 3] || ''}\n${lines[i - 2] || ''}\n${lines[i - 1] || ''}\n${stmt}`;
    if (HONOURS.test(stmt) || MARK.test(around)) return;
    bad.push(`${path.relative(path.join(ROOT, '..'), file)}:${i + 1}  ${line.trim().slice(0, 150)}`);
  });
}

if (bad.length) {
  console.error(`\n✗ بوّاباتٌ بأسماء الأدوار وحدَها (${bad.length}) — تتجاهل منحَ القسم من مصفوفة الصلاحيّات:\n`);
  bad.forEach((b) => console.error(`  ${b}`));
  console.error('\n  أضِف `|| canEditSection(user?.permissions, \'<القسم>\')`، أو علّق فوقها `// role-only: <السبب>` إن كانت عن قصد.\n');
  process.exit(1);
}
console.log(`✓ بوّاباتُ الأزرار تحترم منحَ الأقسام (${files.length} ملفًّا)`);
