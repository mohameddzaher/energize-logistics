const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { invalidateUserCache, revokeAccessToken } = require('../middleware/auth');
const { COOKIE_OPTIONS } = require('../config/constants');

// كم جهازًا/متصفّحًا يبقى المستخدم داخلًا عليها في وقت واحد.
const MAX_SESSIONS = 8;

// ── الجلسة المنزلقة ─────────────────────────────────────────────────────────
// كان توكن التجديد ينتهي بعد سبعة أيام **من لحظة الدخول**، لا من آخر استعمال.
// فالموظّف الذي يعمل على النظام كل يوم يُخرَج منه فجأةً في اليوم الثامن بلا
// سبب ظاهر — وهذا ما كان يبدو «انتهت البيانات، اعمل خروج ودخول».
//
// الآن: إذا تجاوز التوكن نصف عمره عند التجديد، يُصدَر بديلٌ جديد ويُترك القديم
// صالحًا لفترة سماح قصيرة. فترة السماح ليست ترفًا: المستخدم يفتح عشرة تبويبات،
// وكلها قد تُجدِّد في اللحظة نفسها — ولو أُبطِل القديم فورًا لخرج تسعة منها.
const REFRESH_DAYS = Number(process.env.JWT_REFRESH_DAYS || 30);
const REFRESH_MS = REFRESH_DAYS * 24 * 60 * 60 * 1000;
// مهلة بقاء التوكن القديم بعد إصدار بديله — تكفي لتبويبات تُجدِّد معًا.
const GRACE_MS = 5 * 60 * 1000;

// ── التوكن في فترة السماح يعيش هنا، لا في مصفوفة جلسات المستخدم ──────────────
//
// كان يُحشر في المصفوفة مع بديله، فيشغل الجلسةُ الواحدة خانتين وتبلغ المصفوفة
// تسعًا، فيقصّها `slice(-8)` — **فيُطرَد جهازٌ آخر**. ومع ثمانية أجهزة عاملة صار
// كل تجديدٍ يُخرِج شخصًا لا علاقة له بالتجديد، ثم يتكرّر: سلسلةُ خروجٍ لا يفهم
// أحدٌ سببها.
//
// وهنا يُقاس عمره بوقتٍ لا بحذفٍ مؤجَّل: الحذف المؤجَّل كان يُلغي القديم بعد خمس
// دقائق حتى لو ضاع الردّ الحامل للبديل في الشبكة — فيبقى الجهاز على توكنٍ لم
// يعد معروفًا ويُطلَب منه كلمة السرّ بلا سبب. ولو أُعيد تشغيل الخادم قبل موعد
// الحذف بقي القديم صالحًا إلى الأبد.
const grace = new Map(); // token → وقت انتهاء السماح
const graceHas = (t) => {
  const exp = grace.get(t);
  if (!exp) return false;
  if (exp <= Date.now()) { grace.delete(t); return false; }
  return true;
};
// كنسٌ خفيف: بلا هذا تنمو الخريطة بعدد التجديدات ما دام الخادم يعمل.
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of grace) if (exp <= now) grace.delete(t);
}, 60000).unref?.();

const generateAccessToken = (userId, role) => {
  // ── معرّف عشوائيّ لكل توكن وصول ─────────────────────────────────────────────
  // بدونه يُنتج جهازان يدخلان في الثانية نفسها توكنًا **متطابقًا حرفيًّا**:
  // الحمولة {userId, role} والطابع الزمنيّ بالثواني، فلا شيء يفرّق بينهما.
  // فيصير للجهازين توكنٌ واحد — وإبطالُ أحدهما عند الخروج يُخرج الآخر معه.
  // توكن التجديد عولج بهذا من قبل، وبقي هذا بلا علاج.
  return jwt.sign(
    { userId, role, jti: require('crypto').randomBytes(9).toString('base64url') },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' },
  );
};

const generateRefreshToken = (userId) => {
  // معرّف جلسة عشوائي: بدونه يُنتج تسجيلا دخول في الثانية نفسها **توكنًا
  // متطابقًا** (الحمولة {userId} والطابع الزمني بالثواني)، فيصير للجهازين توكن
  // واحد — والخروج من أحدهما يُخرج الآخر بلا سبب ظاهر.
  return jwt.sign(
    { userId, sid: require('crypto').randomBytes(9).toString('base64url') },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || `${REFRESH_DAYS}d` },
  );
};

/** هل تجاوز التوكن نصف عمره؟ عندها يُجدَّد بدل أن يُترك حتى ينتهي فجأة. */
const isStale = (decoded) => {
  if (!decoded?.exp || !decoded?.iat) return false;
  const life = (decoded.exp - decoded.iat) * 1000;
  const age = Date.now() - decoded.iat * 1000;
  return age > life / 2;
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // `refreshTokens` معرَّف select:false، فبدون طلبه صراحةً يصل هنا undefined —
    // فتُحفَظ الجلسات وفيها الجديدة وحدها، وتُمحى كل جلسات الأجهزة الأخرى.
    // كان هذا سبب «الدخول من جهاز ثانٍ يُخرج الأول»: الأول يبقى ظاهرًا ربع ساعة
    // (عمر توكن الوصول) ثم يفشل تجديده فيُخرَج بلا سبب مفهوم.
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

    // تجاوز نصف عمره؟ يُصدَر بديلٌ ويُترك القديم في فترة سماح — فلا يُخرَج
    // المستخدم في اليوم الثامن، ولا تُقطَع التبويبات التي جدَّدت في اللحظة نفسها.
    let outgoing = token;
    if (isStale(decoded)) {
      outgoing = generateRefreshToken(user._id);
      // ذرّيّ عبر القاعدة، لا قراءةً وتعديلًا وكتابة.
      //
      // تبويبان يُجدِّدان في اللحظة نفسها يحملان التوكن نفسه، فكلاهما يقرأ
      // المصفوفة ويكتبها كاملة — فتمحو كتابةُ الثاني بديلَ الأوّل، ويربح آخرُ
      // ردٍّ يصل المتصفّح. لو كان الخاسر هو صاحب الكوكي الأخير خرج المستخدم.
      // `$pull` ثم `$push` بـ`$slice` يجعلان الأمر عمليةً واحدة في القاعدة.
      await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: token } });
      await User.updateOne({ _id: user._id }, {
        $push: { refreshTokens: { $each: [outgoing], $slice: -MAX_SESSIONS } },
        $set: { refreshToken: outgoing },
      });
      // القديم يبقى مقبولًا فترةَ السماح — في الذاكرة، لا في المصفوفة.
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
      // جهازٌ واحد يخرج، والباقي يبقى داخلًا.
      //
      // الهاتف لا كوكيز له، فيرسل توكنه في الجسم كما يفعل في التجديد. وبقراءة
      // الكوكي وحده كان `thisToken` غير معرَّف فيسقط الأمر إلى تفريغ المصفوفة —
      // فخروجُ هاتفٍ واحد كان يُخرج كلّ مكتبٍ وكلّ جهازٍ للمستخدم نفسه.
      const thisToken = req.cookies?.refreshToken || req.body?.refreshToken;
      const update = thisToken
        ? { $pull: { refreshTokens: thisToken }, $set: { refreshToken: null } }
        : { $set: { refreshToken: null, refreshTokens: [] } };
      await User.findByIdAndUpdate(req.user._id, update);
      // توكن الوصول الحاليّ يُبطَل معه: بدونه يبقى مقبولًا حتى ينتهي عمره.
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
