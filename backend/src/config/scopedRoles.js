/**
 * Scoped roles: an external account that sees one screen of our system and nothing else.
 * Not a portal partner account: the portal is for registered customers or vendors, and Media Go is neither; its screen belongs to the individuals section, shared with us.
 * Enforced on the server, not in the menu: many endpoints only require authenticate, so a scoped account passes middleware/scopedRoleFence first and anything not in `api` below gets 403 (allow list). Section permissions are all none, its pages are `pages` only, and its home is `home`. It does not receive the general section broadcast (see websocket/socketManager). The key does not end in _manager on purpose (config/roles.js rule 2). This file imports only roles, sections and permissions.
 */
const MEDIAGO_ROLE = 'mediago_account';
const MEDIAGO_PAGE = '/system/b2c/mediago-complaints';
const MEDIAGO_API = '/api/b2c/mediago-complaints';
// Advertising content: Media Go requests ad filming on our vehicles.
const MEDIAGO_ADS_PAGE = '/system/b2c/mediago-ads';
const MEDIAGO_ADS_API = '/api/b2c/mediago-ads';

const SCOPED_ROLES = {
  [MEDIAGO_ROLE]: {
    home: MEDIAGO_PAGE,
    pages: [MEDIAGO_PAGE, MEDIAGO_ADS_PAGE],
    // Allowed prefixes: login, logout, profile and password (/api/auth), the notification bell (shows only items addressed to it, see notificationController), and its screen. Attachments are served before this fence (/api/uploads, random names).
    api: ['/api/auth', '/api/notifications', MEDIAGO_API, MEDIAGO_ADS_API, '/api/health'],
  },
};

const isScopedRole = (role) => Object.prototype.hasOwnProperty.call(SCOPED_ROLES, String(role || ''));
const scopeOf = (role) => (isScopedRole(role) ? SCOPED_ROLES[role] : null);

/** Every account from outside the company: portal partners and scoped roles. */
const EXTERNAL_ROLES = ['client', ...Object.keys(SCOPED_ROLES)];
const isExternalRole = (role) => EXTERNAL_ROLES.includes(String(role || ''));

module.exports = {
  MEDIAGO_ROLE, MEDIAGO_PAGE, MEDIAGO_API, MEDIAGO_ADS_PAGE, MEDIAGO_ADS_API,
  SCOPED_ROLES, isScopedRole, scopeOf, EXTERNAL_ROLES, isExternalRole,
};
