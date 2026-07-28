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
      enum: ['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator', 'client', 'workshop_manager', 'workshop_employee', 'purchasing', 'b2c_head', 'b2c_project_manager', 'remote_employee', 'remote_manager', 'hr_manager', 'hr_specialist', 'crm_manager', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'finance_manager', 'accountant', 'sales_manager', 'sales_rep', 'procurement_manager', 'customs_manager', 'customs_officer', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager', 'bd_specialist', 'fleet_manager', 'fleet_supervisor', 'administrator', 'contracts_manager'],
      required: true,
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
