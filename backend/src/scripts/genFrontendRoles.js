/**
 * genFrontendRoles: generates frontend/src/lib/roles.ts from config/roles.js.
 * --check verifies it is current without writing.
 * The frontend needs the same role structure for dropdowns and display names; a hand copy would drift from the backend when a role is added, so it is generated. --check exits non-zero if the files differ, so it can sit in any pre-deploy check.
 */
const fs = require('fs');
const path = require('path');
const R = require('../config/roles');

const OUT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'lib', 'roles.ts');
const CHECK = process.argv.includes('--check');

const HEAD = `// Generated from backend/src/config/roles.js; do not edit by hand.
// Regenerate: node backend/src/scripts/genFrontendRoles.js
//
// Each section has a manager, a team leader with the manager's rights, staff and a trainee. Managers end in \`_manager\`
// and nobody else does: that suffix decides who sits in management meetings.

export interface RoleDef { key: string; ar: string; en: string; distinct?: string }
export interface SectionRoles { section: string; manager: RoleDef; staff: RoleDef[]; trainee: RoleDef; teamLeader: RoleDef }

export const GLOBAL_ROLES: RoleDef[] = ${JSON.stringify(R.GLOBAL_ROLES, null, 2)};

export const SECTION_ROLES: SectionRoles[] = ${JSON.stringify(R.SECTION_ROLES, null, 2)};
`;

const TAIL = `
export const ALL_ROLE_DEFS: RoleDef[] = [
  ...GLOBAL_ROLES,
  ...SECTION_ROLES.flatMap((s) => [s.manager, ...s.staff, s.trainee]),
];
export const ALL_ROLES: string[] = ALL_ROLE_DEFS.map((r) => r.key);
export const MANAGER_ROLES: string[] = SECTION_ROLES.map((s) => s.manager.key);
export const STAFF_ROLES: string[] = SECTION_ROLES.flatMap((s) => s.staff.map((x) => x.key));
// A section trainee inherits nothing: it sees only what the permissions page opens for it.
export const TRAINEE_ROLES: string[] = SECTION_ROLES.map((s) => s.trainee.key);
export const TEAM_LEADER_ROLES: string[] = SECTION_ROLES.map((s) => s.teamLeader.key);

/** Team leader to the manager whose rights it holds (backend config/roles RIGHTS_OF). */
export const RIGHTS_OF: Record<string, string> = Object.fromEntries(SECTION_ROLES.map((s) => [s.teamLeader.key, s.manager.key]));
export const rightsRoleOf = (role?: string | null): string => (role && RIGHTS_OF[role]) || role || '';
export const isTeamLeader = (role?: string | null): boolean => !!role && role in RIGHTS_OF;
/** Does this role (or a user's role) pass a role list? Also true when the list names the role whose rights it holds. */
export const roleIn = (roleOrUser: string | { role?: string | null } | null | undefined, list: readonly string[] | ReadonlySet<string>): boolean => {
  const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser?.role;
  if (!role) return false;
  const has = (r: string) => ('has' in list ? (list as ReadonlySet<string>).has(r) : (list as readonly string[]).includes(r));
  return has(role) || has(rightsRoleOf(role));
};

const AR: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const EN: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** Display name of a role; an unknown key is returned readable instead of snake_case. */
export const roleLabel = (key?: string | null, lang: 'ar' | 'en' = 'ar'): string => {
  if (!key) return '';
  const m = lang === 'en' ? EN : AR;
  return m[key] || key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

/** Roles grouped by section, for dropdowns. */
export const rolesGroupedBySection = (lang: 'ar' | 'en' = 'ar') => [
  { section: lang === 'ar' ? 'أدوار عامة' : 'General', roles: GLOBAL_ROLES.filter((r) => r.key !== 'client') },
  ...SECTION_ROLES.map((s) => ({ section: s.section, roles: [s.manager, ...s.staff, s.trainee] })),
];

export const sectionOfRole = (role?: string | null): string | null => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.trainee.key === role || x.staff.some((y) => y.key === role));
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
console.log(`  ${R.ALL_ROLES.length} roles · ${R.MANAGER_ROLES.length} managers · ${R.TEAM_LEADER_ROLES.length} team leaders · ${R.STAFF_ROLES.length} staff`);
