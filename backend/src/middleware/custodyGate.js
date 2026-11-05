/**
 * Custody ledger guard (light and heavy transport).
 * Custody is money, so a section's default roles never reach it: only the owner roles (`roles()`), the roles with super admin powers, or a role the system owner granted on the permissions screen.
 * That grant is the role's explicit level for the section (RolePermission, not the section default) with the custody page not unticked: view opens reads, edit opens adding entries too.
 * Editing or deleting a posted entry stays with the controller (system admin and finance).
 * Stamps `req.custodyAccess` ('full' | 'edit' | 'view') for the controller's response.
 */
const { isTopRole } = require('../config/constants');
const { getOverride, effectivePages } = require('../utils/permissions');

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The two custody ledgers. Owner lists live with their controllers; read lazily to avoid a require cycle. */
const DOORS = [
  { page: '/system/ls2/custody', section: 'Location Solutions', roles: () => require('../controllers/htCustodyController').CUSTODY_ROLES },
  { page: '/system/b2c/light-transport/custody', section: 'B2C', roles: () => require('../controllers/ltCustodyController').CUSTODY_ROLES },
];

/** 'full' | 'edit' | 'view' | null for one role at one door: the single rule shared by the guard and the menus. */
async function accessFor(role, { roles, section, page }) {
  if (!role) return null;
  if (roles().includes(role) || isTopRole(role)) return 'full';
  const level = await getOverride(role, section);
  if (!level || level === 'none') return null;
  if ((await effectivePages(role))[page] === false) return null;
  return level === 'edit' ? 'edit' : level === 'view' ? 'view' : null;
}

/** Custody pages this role opens, for the menus (login and /me); a link the server would refuse is never shown. */
async function custodyPagesFor(role) {
  const out = [];
  for (const d of DOORS) if (await accessFor(role, d)) out.push(d.page);
  return out;
}

function custodyGate({ roles, section, page }) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role || '';
      if (!role) return res.status(401).json({ message: 'Authentication required' });
      const access = await accessFor(role, { roles, section, page });
      if (access === 'full') { req.custodyAccess = 'full'; return next(); }
      const level = access;
      const pageOn = !!access;
      if (pageOn && (level === 'edit' || (level === 'view' && READ.has(req.method)))) {
        req.custodyAccess = level;
        return next();
      }
      return res.status(403).json({
        code: 'CUSTODY_FORBIDDEN',
        message: level === 'view' && pageOn ? 'صلاحيّتك على العهدة عرضٌ فقط' : 'العهدة خارج صلاحيّاتك — تُفتح من صفحة الصلاحيّات',
      });
    } catch (e) {
      return res.status(500).json({ message: 'تعذّر التحقق من الصلاحيّة' });
    }
  };
}

module.exports = custodyGate;
module.exports.custodyPagesFor = custodyPagesFor;
module.exports.DOORS = DOORS;
