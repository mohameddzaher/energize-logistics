/**
 * أهلُ المال يملكون في دفاتره ما يملكه مديرُ النظام — مرآةُ
 * backend/src/config/financeAuthority.js. يُسأل في المحفظة والتشغيل والتشغيل
 * الخاصّ ومخزن النقل الثقيل والنقل الخفيف وحدَها؛ والخادمُ هو الحارس.
 */
export const FINANCE_FULL_ROLES = ['cfo', 'accounting_manager', 'accountant'];

type U = { role?: string | null; superAdminPowers?: boolean } | null | undefined;

export const hasFinancePowers = (u: U): boolean =>
  !!u && (u.role === 'super_admin' || !!u.superAdminPowers || FINANCE_FULL_ROLES.includes(u.role || ''));
