const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { invalidateUserCache } = require('../middleware/auth');
const { COOKIE_OPTIONS } = require('../config/constants');

// How many concurrent devices/browsers a user can stay logged in on.
const MAX_SESSIONS = 8;

const generateAccessToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
  });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
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

    // Keep this device's session ALONGSIDE any existing ones (phone + desktop +
    // other browsers all stay logged in). Cap to the most recent MAX_SESSIONS.
    const existing = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
    user.refreshTokens = [...existing, refreshToken].slice(-MAX_SESSIONS);
    user.refreshToken = refreshToken; // legacy field, kept in sync
    user.lastLogin = new Date();
    await user.save();
    // A cached (pre-login) copy may be stale now that we've updated the user.
    invalidateUserCache(user._id);

    res.cookie('accessToken', accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
    const { effectivePermissions } = require('../utils/permissions');
    const permissions = await effectivePermissions(user.role);

    res.json({
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        permissions,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Failed to process login' });
  }
};

exports.refresh = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId).select('+refreshToken +refreshTokens');

    // Valid if this token belongs to ANY of the user's active sessions. The
    // legacy single-token field is still honoured so sessions that were alive
    // before this change keep working.
    const sessions = Array.isArray(user && user.refreshTokens) ? user.refreshTokens : [];
    const known = !!user && (sessions.includes(token) || user.refreshToken === token);
    if (!user || !known) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    // Migrate a legacy-only session into the sessions array.
    if (!sessions.includes(token)) {
      user.refreshTokens = [...sessions, token].slice(-MAX_SESSIONS);
      await user.save();
    }

    if (!user.isActive || user.isLocked) {
      return res.status(403).json({ message: 'Account is not accessible' });
    }

    const newAccessToken = generateAccessToken(user._id, user.role);

    res.cookie('accessToken', newAccessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });

    // Re-set the same refresh token cookie to extend its maxAge
    res.cookie('refreshToken', token, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'Token refreshed' });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.user) {
      // Sign out THIS device only — other devices stay logged in.
      const thisToken = req.cookies?.refreshToken;
      const update = thisToken
        ? { $pull: { refreshTokens: thisToken }, $set: { refreshToken: null } }
        : { $set: { refreshToken: null, refreshTokens: [] } };
      await User.findByIdAndUpdate(req.user._id, update);
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
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

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

    // Effective per-section access (drives the sidebar + client-side edit gating).
    const { effectivePermissions } = require('../utils/permissions');
    const permissions = user ? await effectivePermissions(user.role) : {};
    const out = user ? { ...user.toObject(), permissions } : user;

    res.json({ user: out });
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve user profile' });
  }
};

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
