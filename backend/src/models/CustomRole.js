const mongoose = require('mongoose');

/**
 * A user type created by the system owner: a role that does not exist in `config/roles.js`.
 * That file is the company's functional structure (manager and staff per section) and cannot cover needs like a reviewer who sees money but cannot write, or a supervisor for vehicles only, so roles can be made from the screen.
 * Coded keys remain the reference for logic that reads them by name (business review reads the `_manager` suffix; reports have their own list). A created role inherits nothing: no old `authorize` list knows it and it has no default section. Everything it has comes explicitly from the permission matrix, so a new role starts with nothing rather than everything.
 * The `_manager` suffix is therefore forbidden on the key: businessReview reads it literally and would seat the holder with the board. See config/roles.js.
 */
const customRoleSchema = new mongoose.Schema(
  {
    // Small Latin key: what is stored on the user and read in code.
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    // Optional description shown on the permissions screen: why this role was made.
    description: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CustomRole', customRoleSchema);
