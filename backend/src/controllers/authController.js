const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { invalidateUserCache, revokeAccessToken } = require('../middleware/auth');
const { COOKIE_OPTIONS } = require('../config/constants');

// How many devices or browsers a user can stay logged in on at once.
const MAX_SESSIONS = 8;

// Sliding session. The refresh token used to expire 7 days after login, not after last use, so a daily user was logged out on day 8 for no visible reason. Now a token past half its life is replaced at refresh and the old one stays valid for a short grace period. The grace is needed because a user may have ten tabs refreshing at the same moment; revoking the old token immediately would log nine of them out.
const REFRESH_DAYS = Number(process.env.JWT_REFRESH_DAYS || 30);
const REFRESH_MS = REFRESH_DAYS * 24 * 60 * 60 * 1000;
// How long the old token stays valid after its replacement is issued; enough for tabs refreshing together.
const GRACE_MS = 5 * 60 * 1000;

// A token in its grace period lives here, not in the user's sessions array. It used to share the array with its replacement, so one session took two slots, the array reached nine and slice(-8) evicted another device; with eight devices every refresh logged out an unrelated person. Age is measured by time, not a deferred delete: a deferred delete invalidated the old token after five minutes even if the response carrying the new one was lost in the network, leaving the device on an unknown token, and a restart before the delete kept the old token valid forever.
const grace = new Map(); // token to grace-expiry time
const graceHas = (t) => {
  const exp = grace.get(t);
  if (!exp) return false;
  if (exp <= Date.now()) { grace.delete(t); return false; }
  return true;
};
// Light sweep: without it the map grows with every refresh while the server runs.
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of grace) if (exp <= now) grace.delete(t);
}, 60000).unref?.();

const generateAccessToken = (userId, role) => {
  // Random id per access token. Without it two devices logging in within the same second produce byte-identical tokens (the payload is {userId, role} plus a seconds-resolution timestamp), so both share one token and revoking one at logout logs out the other. The refresh token was already fixed this way.
  return jwt.sign(
    { userId, role, jti: require('crypto').randomBytes(9).toString('base64url') },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' },
  );
};

const generateRefreshToken = (userId) => {
  // Random session id: without it two logins in the same second produce identical tokens (payload {userId} plus a seconds timestamp), so logging out of one logs out the other.
  return jwt.sign(
    { userId, sid: require('crypto').randomBytes(9).toString('base64url') },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || `${REFRESH_DAYS}d` },
  );
};

/** Has the token passed half its life? If so it is renewed instead of being left to expire suddenly. */
const isStale = (decoded) => {
  if (!decoded?.exp || !decoded?.iat) return false;
  const life = (decoded.exp - decoded.iat) * 1000;
  const age = Date.now() - decoded.iat * 1000;
  return age > life / 2;
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // refreshTokens is select:false, so without requesting it explicitly it arrives undefined here; the saved sessions would then contain only the new one and wipe every other device's session. This caused second-device login logging out the first: the first stays visible for the access-token lifetime (15 minutes), then its refresh fails.
    const user = await User.findOne({ email }).select('+password +refreshTokens');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    if (user.isLocked) {
      return res.status(403).json({ message: 'Account is locked. Contact your administrator.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    // Keep this device's session alongside existing ones (phone, desktop and other browsers stay logged in); capped to the most recent MAX_SESSIONS.
    // Atomic update, not user.save(): two simultaneous logins of one user (mobile and web) read and saved the same version, so the second hit VersionError and returned 500. Pushing in the DB does not conflict.
    await User.updateOne({ _id: user._id }, {
      $push: { refreshTokens: { $each: [refreshToken], $slice: -MAX_SESSIONS } },
      $set: { refreshToken, lastLogin: new Date() }, // refreshToken: legacy field, kept in sync
    });
    // A cached (pre-login) copy may be stale now that we've updated the user.
    invalidateUserCache(user._id);

    res.cookie('accessToken', accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_MS,
    });

    // Audit is a side-effect — don't make the user wait a full DB round-trip
    // for it before the login response returns.
    logAudit({
      user: user._id,
      action: 'login',
      entity: 'User',
      entityId: user._id,
      ipAddress: req.ip,
    }).catch((e) => console.error('Audit log (login) failed:', e.message));

    // Include effective section permissions so the sidebar renders correctly on
    // the first paint after login (without them, managed sections stay hidden
    // until a refresh re-fetches /api/auth/me).
    const { effectivePermissions, effectivePages, homePageFor, explicitlyGrantedPages } = require('../utils/permissions');
    const P = require('../utils/permissions');
    const permissions = await P.effectivePermissionsForUser(user);
    const pageAccess = await P.effectivePagesForUser(user);
    const pagesGranted = await P.explicitlyGrantedPagesForUser(user);
    const homePage = await homePageFor(user.role);
    const { hasSuperAdminPowers } = require('../utils/permissions');
    const superAdminPowers = await hasSuperAdminPowers(user.role);

    res.json({
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        // Top management opens its section from the first render, not only after /me.
        isTopManagement: user.isTopManagement === true,
        isChairman: user.isChairman === true,
        // Whether the leave-approvals page is shown: a stage owner or someone's direct manager.
        approvesLeaves: await require('../utils/leaveTeam').approvesLeaves(user).catch(() => false),
        permissions,
        // Which screens open; the sidebar reads it from the first render.
        pageAccess,
        // Explicit ticks take precedence over the hand-written role lists in the sidebar.
        pagesGranted,
        // Custody ledgers this account opens (middleware/custodyGate), so a menu never links to a refused page.
        custodyPages: await require('../middleware/custodyGate').custodyPagesFor(user.role).catch(() => []),
        homePage,
        superAdminPowers,
        // Without this the HR self-service pages think the account is not
        // linked to an employee until the next /auth/me refresh.
        linkedEmployee: user.linkedEmployee || null,
      },
      // For the mobile app (no cookie jar): the same tokens the cookies carry.
      // The web client ignores these fields.
      accessToken,
      refreshToken,
    });
  } catch (error) {
    // Log the real reason — a bare "Failed to process login" leaves nothing to go
    // on when this fires (a Mongo timeout and a bad JWT secret look identical).
    console.error('Login error:', error.name, '-', error.message, '\n', error.stack);
    res.status(500).json({
      message: 'Failed to process login',
      ...(process.env.NODE_ENV !== 'production' && { reason: `${error.name}: ${error.message}` }),
    });
  }
};

exports.refresh = async (req, res) => {
  try {
    // Browsers refresh via the httpOnly cookie; the mobile app keeps its
    // refresh token in secure storage and sends it in the body instead.
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId).select('+refreshToken +refreshTokens');

    // Valid if this token belongs to ANY of the user's active sessions. The
    // legacy single-token field is still honoured so sessions that were alive
    // before this change keep working.
    const sessions = Array.isArray(user && user.refreshTokens) ? user.refreshTokens : [];
    const known = !!user && (sessions.includes(token) || user.refreshToken === token || graceHas(token));
    if (!user || !known) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    // Migrate a legacy-only session into the sessions array.
    if (!sessions.includes(token)) {
      await User.updateOne({ _id: user._id }, { $push: { refreshTokens: { $each: [token], $slice: -MAX_SESSIONS } } });
    }

    if (!user.isActive || user.isLocked) {
      return res.status(403).json({ message: 'Account is not accessible' });
    }

    const newAccessToken = generateAccessToken(user._id, user.role);

    res.cookie('accessToken', newAccessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });

    // Past half its life: issue a replacement and keep the old one in a grace period, so the user is not logged out on day 8 and tabs that refreshed together are not cut off.
    let outgoing = token;
    if (isStale(decoded)) {
      outgoing = generateRefreshToken(user._id);
      // Atomic in the DB, not read-modify-write. Two tabs refreshing at once carry the same token and each reads and writes the whole array, so the second write erases the first's replacement and the last response to reach the browser wins; if the loser holds the last cookie the user is logged out. $pull then $push with $slice makes it one DB operation.
      await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: token } });
      await User.updateOne({ _id: user._id }, {
        $push: { refreshTokens: { $each: [outgoing], $slice: -MAX_SESSIONS } },
        $set: { refreshToken: outgoing },
      });
      // The old token stays accepted during the grace period, in memory, not in the array.
      grace.set(token, Date.now() + GRACE_MS);
    }

    res.cookie('refreshToken', outgoing, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_MS,
    });

    // The mobile app reads the new access token from the body (it cannot see
    // httpOnly cookies); the web client ignores this field.
    res.json({ message: 'Token refreshed', accessToken: newAccessToken, refreshToken: outgoing });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.user) {
      // Log out one device only; the others stay logged in. The phone has no cookies and sends its token in the body as it does for refresh. Reading only the cookie left thisToken undefined and fell through to clearing the whole array, so one phone logout logged out every desktop and device of that user.
      const thisToken = req.cookies?.refreshToken || req.body?.refreshToken;
      const update = thisToken
        ? { $pull: { refreshTokens: thisToken }, $set: { refreshToken: null } }
        : { $set: { refreshToken: null, refreshTokens: [] } };
      await User.findByIdAndUpdate(req.user._id, update);
      // The current access token is revoked with it; otherwise it stays accepted until it expires.
      revokeAccessToken(req.cookies?.accessToken
        || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      invalidateUserCache(req.user._id);
      logAudit({
        user: req.user._id,
        action: 'logout',
        entity: 'User',
        entityId: req.user._id,
        ipAddress: req.ip,
      }).catch((e) => console.error('Audit log (logout) failed:', e.message));
    }

    res.clearCookie('accessToken', COOKIE_OPTIONS);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to process logout' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    // Guard here as well as in the route: a length rule that lives in only one
    // place drifts, and when it drifts the user gets a 500 instead of an answer.
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: 'كلمة المرور 8 أحرف على الأقل | New password must be at least 8 characters' });
    }
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة | Current password is incorrect' });
    }
    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة مطابقة للحالية | The new password is the same as the current one' });
    }

    user.password = newPassword;
    // Changing your own password signs out your OTHER devices but keeps you
    // signed in here — that is the point of changing it when you fear it leaked.
    const current = req.cookies?.refreshToken;
    user.refreshTokens = current ? [current] : [];
    if (!current) user.refreshToken = undefined;
    await user.save();
    invalidateUserCache(user._id);

    await logAudit({
      user: req.user._id,
      action: 'change_password',
      entity: 'User',
      entityId: req.user._id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
};

// Self-service profile update — a user editing their OWN name/email. Role and
// permissions are NOT touchable here (only the admin users page does that).
exports.updateMyProfile = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (email !== undefined && String(email).trim().toLowerCase() !== (user.email || '').toLowerCase()) {
      const clean = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return res.status(400).json({ message: 'بريد إلكتروني غير صالح' });
      const exists = await User.findOne({ email: clean, _id: { $ne: user._id } });
      if (exists) return res.status(400).json({ message: 'هذا البريد الإلكتروني مستخدم بالفعل' });
      user.email = clean;
    }
    if (firstName !== undefined && String(firstName).trim()) user.firstName = String(firstName).trim();
    if (lastName !== undefined && String(lastName).trim()) user.lastName = String(lastName).trim();
    await user.save();
    invalidateUserCache(user._id); // so /me returns the new name/email immediately

    await logAudit({ user: req.user._id, action: 'update_profile', entity: 'User', entityId: user._id, ipAddress: req.ip });
    res.json({ user: { _id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
};

// PATCH /api/auth/me/prefs { key, value } - one display preference on the user's account. The key is short with dots (screen.option) and the value short text; nothing else is stored here.
const PREF_KEY = /^[A-Za-z][\w-]{0,40}(\.[A-Za-z][\w-]{0,40}){0,3}$/;
exports.setMyPref = async (req, res) => {
  try {
    const key = String(req.body?.key || '');
    const value = String(req.body?.value ?? '').slice(0, 80);
    if (!PREF_KEY.test(key)) return res.status(400).json({ message: 'مفتاحٌ غير صالح' });
    // A dot in a Map key is stored as a colon: Mongo does not accept dots in document keys.
    const field = `uiPrefs.${key.replace(/\./g, ':')}`;
    await User.updateOne({ _id: req.user._id }, value ? { $set: { [field]: value } } : { $unset: { [field]: 1 } });
    invalidateUserCache(req.user._id);
    res.json({ ok: true, key, value });
  } catch (error) {
    console.error('setMyPref:', error);
    res.status(500).json({ message: 'تعذّر حفظ التفضيل' });
  }
};

exports.getMe = async (req, res) => {
  try {
    // Ensure staff logins (incl. the super admin / demo accounts) always have a
    // linked employee profile so the HR self-service features are usable.
    try { await require('../utils/ensureSelfEmployee')(req.user); } catch (e) {}
    const user = await User.findById(req.user._id)
      .populate('linkedCustomer', 'companyName creditTerm')
      .populate('assignedCustomers', 'companyName')
      .populate('manager', 'firstName lastName email role')
      .populate('linkedEmployee', 'firstName lastName employeeNumber jobTitle');

    // Effective per-section access (drives the sidebar and client-side edit gating), and per-page access beneath it: section says what can be done, page says where. See config/pages.js.
    const { effectivePermissions, effectivePages, homePageFor, explicitlyGrantedPages } = require('../utils/permissions');
    const P = require('../utils/permissions');
    const permissions = user ? await P.effectivePermissionsForUser(user) : {};
    const pageAccess = user ? await P.effectivePagesForUser(user) : {};
    const pagesGranted = user ? await P.explicitlyGrantedPagesForUser(user) : [];
    const homePage = user ? await homePageFor(user.role) : '';
    // Custom role name included. Screens translate roles from a front-end table that does not know roles created after the build, so a financial reviewer showed as the raw English key under the user's name on every screen.
    const roleLabel = user ? await customRoleLabel(user.role) : null;
    // The UI hides super-admin actions from those without them and must know that a custom or fully granted role has them. The real guard is on the server regardless.
    const { hasSuperAdminPowers } = require('../utils/permissions');
    const superAdminPowers = user ? await hasSuperAdminPowers(user.role) : false;
    const approvesLeaves = user ? await require('../utils/leaveTeam').approvesLeaves(user).catch(() => false) : false;
    const custodyPages = user ? await require('../middleware/custodyGate').custodyPagesFor(user.role).catch(() => []) : [];
    const out = user ? { ...user.toObject({ flattenMaps: true }), permissions, pageAccess, pagesGranted, custodyPages, homePage, superAdminPowers, approvesLeaves, ...(roleLabel ? { roleLabel } : {}) } : user;

    res.json({ user: out });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve user profile' });
  }
};

/** Name of a custom role in both languages, or null if the role is defined in code. */
async function customRoleLabel(role) {
  try {
    const CustomRole = require('../models/CustomRole');
    const r = await CustomRole.findOne({ key: role, isActive: true }).select('nameAr nameEn').lean();
    return r ? { ar: r.nameAr, en: r.nameEn } : null;
  } catch (_) { return null; }
}

// ── Personal signatures ─────────────────────────────────────────────────────
// Signatures are `select: false` (heavy base64), so we fetch them explicitly.
const SIG_RX = /^data:image\/(png|jpeg|jpg);base64,/;

exports.getMySignatures = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+signatures');
    res.json({ signatures: user?.signatures || [] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load signatures' });
  }
};

exports.addSignature = async (req, res) => {
  try {
    const { name, dataUrl, isDefault } = req.body || {};
    if (!dataUrl || !SIG_RX.test(dataUrl)) return res.status(400).json({ message: 'A valid signature image is required' });
    if (dataUrl.length > 400000) return res.status(400).json({ message: 'Signature image too large (max ~300KB)' });
    const user = await User.findById(req.user._id).select('+signatures');
    const makeDefault = !user.signatures.length || !!isDefault;
    if (makeDefault) user.signatures.forEach((s) => { s.isDefault = false; });
    user.signatures.push({ name: (name || 'توقيعي').trim(), dataUrl, isDefault: makeDefault });
    await user.save();
    res.status(201).json({ signatures: user.signatures });
  } catch (error) {
    res.status(500).json({ message: 'Failed to add signature' });
  }
};

exports.updateSignature = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+signatures');
    const sig = user.signatures.id(req.params.id);
    if (!sig) return res.status(404).json({ message: 'Signature not found' });
    if (req.body.name !== undefined) sig.name = String(req.body.name).trim();
    if (req.body.isDefault) { user.signatures.forEach((s) => { s.isDefault = false; }); sig.isDefault = true; }
    await user.save();
    res.json({ signatures: user.signatures });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update signature' });
  }
};

exports.deleteSignature = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+signatures');
    const sig = user.signatures.id(req.params.id);
    if (!sig) return res.status(404).json({ message: 'Signature not found' });
    const wasDefault = sig.isDefault;
    sig.deleteOne();
    if (wasDefault && user.signatures.length) user.signatures[0].isDefault = true;
    await user.save();
    res.json({ signatures: user.signatures });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete signature' });
  }
};
