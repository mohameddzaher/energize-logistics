// Frontend mirror of the backend managed permission sections
// (backend/src/config/sections.js). Keys match the sidebar `section` grouping
// strings so the nav can look them up directly. Sections NOT listed here (Main,
// Tools, Admin, Self Service, Portal) keep their legacy role-based gating.

export type Access = 'none' | 'view' | 'edit';

export const MANAGED_SECTIONS: string[] = [
  'Customers & Finance', 'Operations', 'Operations Platform', 'Customs', 'Vehicles',
  'Location Solutions', 'B2C', 'Workshop', 'Remote', 'HR', 'CRM', 'Sales',
  'Accounting', 'Procurement',
  'Marketing', 'Business Development', 'Software & IT',
  'Shipment Orders',
];

const managed = new Set(MANAGED_SECTIONS);
export const isManagedSection = (section?: string): boolean => !!section && managed.has(section);

type Perms = Record<string, Access> | undefined | null;

export const sectionAccess = (perms: Perms, section: string): Access =>
  (perms && (perms[section] as Access)) || 'none';

// Can the user see/open this section at all (view or edit).
export const canAccessSection = (perms: Perms, section: string): boolean => {
  const a = sectionAccess(perms, section);
  return a === 'view' || a === 'edit';
};

// Can the user create/update/delete in this section (edit).
export const canEditSection = (perms: Perms, section: string): boolean =>
  sectionAccess(perms, section) === 'edit';
