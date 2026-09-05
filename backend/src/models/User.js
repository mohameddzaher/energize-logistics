const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    role: {
      type: String,
      required: true,
      // ── المفاتيحُ المكتوبة، وما صُنع من الشاشة ────────────────────────────
      // مصدرُها الأوّل `config/roles.js`: لكلّ قسمٍ مديرٌ وموظّف، والملفُّ يتحقّق
      // من القاعدة وقتَ التحميل. وإلى جانبها ما يصنعه صاحبُ النظام من صفحة
      // الصلاحيّات (`models/CustomRole`).
      //
      // ولا تصلح `enum` هنا: تُبنى مرّةً عند التحميل، فالدورُ الذي يُصنَع بعد
      // إقلاع الخادم يظهر في الشاشة ويُرفَض عند حفظ المستخدم — إعدادٌ يكذب على
      // من ضبطه. فالتحقّقُ يسأل المصدرين معًا في كلّ حفظ.
      validate: {
        validator: async function roleExists(v) {
          const { ALL_ROLES } = require('../config/roles');
          if (ALL_ROLES.includes(v)) return true;
          const { customRoleKeys } = require('../utils/permissions');
          return (await customRoleKeys()).has(String(v));
        },
        message: (p) => `دورٌ غير معروف: ${p.value}`,
      },
    },
    // Is this login one of OUR PEOPLE, or an outside partner (customer/supplier)?
    // Employees are the default and behave exactly as before. A partner account
    // carries `role: 'client'` for RBAC (it is the existing external-user role)
    // and this field is what tells a customer portal apart from a vendor portal.
    accountType: {
      type: String,
      enum: ['employee', 'customer', 'vendor'],
      default: 'employee',
    },
    // Which register row this partner login represents. `source` is a key from
    // config/partnerRegisters.js; `refId` is that row's _id — except for virtual
    // registers (customs customers exist only as typed names) where it is the
    // folded name. `nameKey` is stored so every section's data can be joined to
    // this partner by name without recomputing it on each portal request.
    partner: {
      source: { type: String, trim: true, default: '' },
      refId: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      nameKey: { type: String, trim: true, default: '', index: true },
      kind: { type: String, enum: ['customer', 'vendor', ''], default: '' },
    },
    // Remote (work-from-home) section: which pages a remote_employee can open.
    // Subset of REMOTE_PAGES. Ignored for every other role (managers see all).
    remoteAccess: {
      type: [String],
      default: [],
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    assignedCustomers: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    ],
    linkedCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },
    // B2C-specific assignments
    assignedProjects: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' },
    ],
    // فروع إضافية يعمل عليها هذا الحساب — و`branch` أعلاه هو فرعه المنسوب.
    // موجودة من قبل، ويقابلها `branches` على سجلّ الموظف: هذه صلاحية وصول
    // الحساب، وتلك واقعُ عمل الشخص. قد يتطابقان وقد لا — ولذلك لم تُدمجا.
    assignedBranches: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    ],
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // When true, this user is the company's DEFAULT manager: the org-chart
    // auto-suggest prefers them as the manager for department-head roles
    // (overridable per user). Typically a single super_admin/admin.
    isDefaultManager: { type: Boolean, default: false },
    // HR section: optional link to the employee record (HR profile) this login
    // account belongs to. Set by super_admin when creating/editing a user.
    linkedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    isActive: { type: Boolean, default: true },
    isLocked: { type: Boolean, default: false },
    lastLogin: { type: Date },
    // Legacy single-session token (kept so sessions alive at deploy time survive).
    refreshToken: { type: String, select: false },
    // Concurrent sessions: one refresh token per device/browser. Storing only ONE
    // meant a login on a 2nd device invalidated the 1st → users were constantly
    // logged out. Capped (oldest dropped) so it can't grow unbounded.
    refreshTokens: { type: [String], select: false, default: [] },
    collectionTarget: { type: Number, default: 0 },
    // Personal signatures (base64 PNG) the user applies to documents (leave
    // approvals etc.). `select: false` so the heavy data URLs don't bloat every
    // /me response — fetched on demand via /api/auth/signatures.
    signatures: {
      type: [{
        name: { type: String, default: 'توقيعي', trim: true },
        dataUrl: { type: String, required: true }, // data:image/png;base64,...
        isDefault: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      }],
      select: false,
      default: [],
    },
  },
  { timestamps: true }
);

// email already has a unique index from `unique: true`. These back the
// getUsers filters (role / isActive / branch) which otherwise full-scan.
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1, role: 1 });
userSchema.index({ branch: 1 });
// "Does this customer already have a login?" is asked once per row on the
// partner picker and once per profile page — both resolve through this.
userSchema.index({ 'partner.source': 1, 'partner.refId': 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.refreshTokens;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
