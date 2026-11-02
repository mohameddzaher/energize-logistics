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
    // Which pages of the section.
    // The section says what can be done and the page says where: the vehicles section has nineteen pages and an edit grant used to cover all of them (register, petro app, settings, performance review).
    // The key is the page path (`/system/vehicles/petro-app`), the value true or false. ABSENCE IS NOT A DENIAL: an unlisted page follows its section, so roles not given this level stay as before and a new page is allowed for the section's holders instead of vanishing silently.
    pages: { type: Map, of: Boolean, default: {} }, // pagePath -> allowed
    // Entry route: the first screen opened for this role. For a custom role unknown to `roleRoutes`, the dashboard may not be allowed at all.
    homePage: { type: String, trim: true, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
