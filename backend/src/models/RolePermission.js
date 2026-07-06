const mongoose = require('mongoose');

// One document per role holding the super_admin's per-section access overrides.
// `sections` maps a section key (see config/sections.js) → 'none' | 'view' |
// 'edit'. A role with NO document behaves exactly as the legacy role-based
// authorize lists (no override). super_admin is never stored here — it always
// has full access.
const rolePermissionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, unique: true, trim: true },
    sections: { type: Map, of: String, default: {} }, // sectionKey -> access level
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
