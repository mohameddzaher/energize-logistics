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
    // ── وأيُّ صفحاتِ القسم ────────────────────────────────────────────────────
    // القسمُ يقول ماذا يُفعَل، والصفحةُ تقول أين: قسمُ المركبات تسعَ عشرةَ صفحة،
    // ومن مُنح «تعديل» كان يأخذها كلَّها — سجلَّ المركبات وبترو آب والإعدادات
    // وتقييمَ الأداء معًا.
    //
    // المفتاحُ مسارُ الصفحة (`/system/vehicles/petro-app`) والقيمةُ صواب أو خطأ.
    // و**الغيابُ ليس منعًا**: صفحةٌ لا ذكرَ لها تتبع قسمَها — فالدورُ الذي لم
    // يُفتَح له هذا الباب أصلًا يبقى كما كان، وصفحةٌ جديدةٌ تُولَد مسموحةً لمن
    // يملك قسمَها بدل أن تختفي عن الجميع صامتةً.
    pages: { type: Map, of: Boolean, default: {} }, // pagePath -> allowed
    // مسارُ الدخول: أوّلُ شاشةٍ تُفتَح لصاحب هذا الدور. لدورٍ مصنوعٍ لا يعرفه
    // `roleRoutes` قد تكون لوحةُ التحكّم غيرَ مسموحةٍ له أصلًا.
    homePage: { type: String, trim: true, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
