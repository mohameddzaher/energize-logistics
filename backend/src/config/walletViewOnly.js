/** Collections see the wallet but cannot change it: the two wallet pages are in the operations section, and opening the section would open all of operations. So a narrow rule: these roles read only the two wallet pages (effectivePages), their GET calls on /api/wallet pass the section and page guards, and every write is rejected at the gate whatever the matrix grants. Hiding in the web and mobile UI follows this; it is not the guard. */
// The whole collections team (manager, staff, trainee) is read from the role structure (config/roles), not a hand-written list, so future members get it automatically.
const collections = require('./roles').SECTION_ROLES.find((x) => x.section === 'Collections');
const WALLET_VIEW_ONLY_ROLES = collections
  ? [collections.manager.key, ...collections.staff.map((r) => r.key), collections.trainee.key]
  : ['collections_manager', 'collections_staff', 'collections_trainee'];
const WALLET_VIEW_PAGES = ['/system/wallet', '/system/wallet-dashboard'];
const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

const isWalletViewOnly = (role) => WALLET_VIEW_ONLY_ROLES.includes(String(role || ''));

/** Guard for /api/wallet for the collections roles instead of the section guard: reads pass, writes are rejected. */
function walletViewOnlyGate(req, res, next) {
  if (!READ.has(req.method)) {
    return res.status(403).json({ message: 'المحفظة لقسم التحصيل عرضٌ فقط — لا تسجيل ولا تعديل', code: 'WALLET_VIEW_ONLY' });
  }
  req.sectionAccess = 'view';
  return next();
}

module.exports = { WALLET_VIEW_ONLY_ROLES, WALLET_VIEW_PAGES, isWalletViewOnly, walletViewOnlyGate };
