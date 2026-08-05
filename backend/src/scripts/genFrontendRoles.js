/**
 * genFrontendRoles — يولّد frontend/src/lib/roles.ts من config/roles.js.
 *
 *   node src/scripts/genFrontendRoles.js
 *   node src/scripts/genFrontendRoles.js --check    يتأكد إنه محدَّث، من غير كتابة
 *
 * الواجهة محتاجة نفس الهيكل الوظيفي عشان القوائم المنسدلة والأسماء المعروضة.
 * نسخه بالإيد كان هيتفرّق عن الباك إند أول ما حد يضيف دور — فبيتولّد.
 * `--check` بيرجّع كود غير صفري لو الملفين اختلفوا، فينفع يتحط في أي فحص قبل
 * الديبلوي.
 */
const fs = require('fs');
const path = require('path');
const R = require('../config/roles');

const OUT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'lib', 'roles.ts');
const CHECK = process.argv.includes('--check');

const HEAD = `// ⚠️ مولَّد من backend/src/config/roles.js — متعدّلش الملف ده بالإيد.
// عشان تحدّثه:  node backend/src/scripts/genFrontendRoles.js
//
// الهيكل الوظيفي: كل قسم له مدير وموظف. المديرين بينتهوا بـ \`_manager\`
// والموظفين لأ — القاعدة دي هي اللي بيتحدد بيها مين يقعد في اجتماعات الإدارة.

export interface RoleDef { key: string; ar: string; en: string }
export interface SectionRoles { section: string; manager: RoleDef; staff: RoleDef[] }

export const GLOBAL_ROLES: RoleDef[] = ${JSON.stringify(R.GLOBAL_ROLES, null, 2)};

export const SECTION_ROLES: SectionRoles[] = ${JSON.stringify(R.SECTION_ROLES, null, 2)};
`;

const TAIL = `
export const ALL_ROLE_DEFS: RoleDef[] = [
  ...GLOBAL_ROLES,
  ...SECTION_ROLES.flatMap((s) => [s.manager, ...s.staff]),
];
export const ALL_ROLES: string[] = ALL_ROLE_DEFS.map((r) => r.key);
export const MANAGER_ROLES: string[] = SECTION_ROLES.map((s) => s.manager.key);
export const STAFF_ROLES: string[] = SECTION_ROLES.flatMap((s) => s.staff.map((x) => x.key));

const AR: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const EN: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** اسم الدور للعرض. مفتاح مش معروف بيترجع مقروء بدل ما يظهر snake_case. */
export const roleLabel = (key?: string | null, lang: 'ar' | 'en' = 'ar'): string => {
  if (!key) return '';
  const m = lang === 'en' ? EN : AR;
  return m[key] || key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

/** الأدوار مرتّبة حسب القسم — للقوائم المنسدلة، عشان المستخدم يلاقي دوره جنب قسمه. */
export const rolesGroupedBySection = (lang: 'ar' | 'en' = 'ar') => [
  { section: lang === 'ar' ? 'أدوار عامة' : 'General', roles: GLOBAL_ROLES.filter((r) => r.key !== 'client') },
  ...SECTION_ROLES.map((s) => ({ section: s.section, roles: [s.manager, ...s.staff] })),
];

export const sectionOfRole = (role?: string | null): string | null => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.staff.some((y) => y.key === role));
  return s ? s.section : null;
};
export const isManagerRole = (role?: string | null): boolean => !!role && MANAGER_ROLES.includes(role);
`;

const content = HEAD + TAIL;

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current === content) { console.log('✓ frontend/src/lib/roles.ts محدَّث'); process.exit(0); }
  console.error('✗ frontend/src/lib/roles.ts مختلف عن config/roles.js — شغّل: node src/scripts/genFrontendRoles.js');
  process.exit(1);
}

fs.writeFileSync(OUT, content);
console.log(`✓ اتكتب ${OUT}`);
console.log(`  ${R.ALL_ROLES.length} دور · ${R.MANAGER_ROLES.length} مدير · ${R.STAFF_ROLES.length} موظف`);
