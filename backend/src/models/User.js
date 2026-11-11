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
    // Top management (الإدارة العليا): signs the last stage of leave and opens the top management section. A flag, not a role, so these accounts keep every super admin permission.
    isTopManagement: { type: Boolean, default: false, index: true },
    // Chairman of the board (رئيس مجلس الإدارة): a super admin account that signs the final leave stage, after top management. Only meaningful on role super_admin, so it carries exactly the super admin permissions.
    isChairman: { type: Boolean, default: false, index: true },
    // The person whose name and signature fill a leave sheet box once that stage approves, whoever clicked it (the finance manager, the HR manager). One account per box; userController clears the others.
    leaveSheetSigner: { type: String, enum: ['', 'finance', 'hr'], default: '' },
    // Display preferences in the user account.
    // Stored on the account, not in the browser, so they follow the user from mobile to site. Key to value: { 'shipmentOrders.view': 'cards' }.
    uiPrefs: { type: Map, of: String, default: {} },
    role: {
      type: String,
      required: true,
      // Hardcoded role keys and those created from the screen.
      // The first source is `config/roles.js` (a manager and staff per section, validated at load time), alongside roles the system owner creates on the permissions page (`models/CustomRole`).
      // An `enum` would not work: it is built once at load, so a role created after server start shows in the UI but is rejected when saving a user. Validation asks both sources on every save.
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
    // Extra branches this account works on; `branch` above is its assigned branch.
    // Previously existing, and the employee record has `branches`: this is the account's access permission and that is the person's actual work, so they may or may not match and were not merged.
    // Branches this user sees on the Shipments page (roles in config/shipmentBranchRoles). Empty means no limit has been set yet.
    shipmentBranches: { type: [String], default: undefined },
    assignedBranches: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    ],
    // Per-user exceptions on top of the role's permissions (utils/permissions *ForUser): section key → none|view|edit, page path → open/closed. Empty follows the role.
    accessSections: { type: Map, of: String, default: undefined },
    accessPages: { type: Map, of: Boolean, default: undefined },
    // Branches whose wallet this account works on; empty means its assigned branch plus its extra branches.
    walletBranches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
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
