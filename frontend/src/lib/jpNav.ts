/**
 * من يرى صفحاتِ خطّة العمل في القائمة الجانبيّة.
 *
 * القاعدةُ من الهيكل الوظيفيّ نفسِه (`lib/roles`، المولَّد من الخادم) لا من
 * قائمةٍ تُكتب هنا: الخطّةُ لفريق القسم ومديره، ولوحتُها وخطّةُ الإدارة لمديره.
 * وهي مرآةُ `who()` في jpController — الخادمُ هو الحارس، وهذه تمنع رابطًا
 * يفتح صفحةً ترفض صاحبَها.
 */
import { SECTION_ROLES } from '@/lib/roles';

// من يدير القسمَ وليس دورُه دورَ مديره — مرآةُ `extraManagers` في config/jpSections.
const EXTRA_MANAGERS: Record<string, string[]> = { Accounting: ['cfo'] };
const TOP = ['super_admin'];

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
  return jpManager(u, section) || (!!d && d.staff.some((s) => s.key === (u?.role || '')));
};

export const jpTop = (u: U): boolean => TOP.includes(u?.role || '');
