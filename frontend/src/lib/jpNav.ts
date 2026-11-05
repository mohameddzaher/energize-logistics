/** Who sees the work-plan pages in the sidebar. The rule comes from the org structure (lib/roles, generated from the server), not a hand-written list: the plan is for the section team and its manager, and its board and the management plan are for the manager. Mirrors who() in jpController; the server is the guard and this only avoids a link to a page that refuses its owner. */
import { SECTION_ROLES } from '@/lib/roles';

// Who manages the section without having the manager role; mirrors `extraManagers` in config/jpSections.
const EXTRA_MANAGERS: Record<string, string[]> = { Accounting: ['cfo'] };
// Super admin and admin see everything; mirrors TOP_ROLES in jpController.
const TOP = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

type U = { role?: string | null };
const def = (section: string) => SECTION_ROLES.find((s) => s.section === section);

export const jpManager = (u: U, section: string): boolean => {
  const r = u?.role || '';
  if (TOP.includes(r)) return true;
  const d = def(section);
  return !!d && (d.manager.key === r || (EXTRA_MANAGERS[section] || []).includes(r));
};

export const jpMember = (u: U, section: string): boolean => {
  const d = def(section);
  // A trainee counts as team once the section and the plan page are granted in permissions.
  return jpManager(u, section) || (!!d && (d.trainee.key === (u?.role || '') || d.staff.some((s) => s.key === (u?.role || ''))));
};

export const jpTop = (u: U): boolean => TOP.includes(u?.role || '');
