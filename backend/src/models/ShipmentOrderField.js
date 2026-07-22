const mongoose = require('mongoose');

// The create-shipment form, as data. Each row is one input: what it is called,
// which group it renders under, HOW it renders (dropdown / cards / typed), its
// options when it has any, and whether it is required.
//
// This exists because the section owner wants to decide per input — "ده دروب
// ليست ولا كروت ولا خانة كتابة" — and to add brand-new questions later, all
// from a settings page instead of a deploy. The form page renders whatever is
// here, in order.
//
// System fields (isSystem) are the ones wired to real logic — prices, times,
// route cities. Their look, label, options, order and required flag are all
// editable; only their existence is not, because deleting `sellPrice` would
// not remove a question, it would break invoicing. User-added fields are fully
// deletable and their answers live in ShipmentOrder.customFields.
const shipmentOrderFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    labelAr: { type: String, required: true, trim: true },
    labelEn: { type: String, trim: true, default: '' },

    group: {
      type: String,
      enum: ['pickup_delivery', 'shipment', 'pricing_time', 'payment'],
      default: 'shipment',
    },

    // 'cards' renders the options as tappable tiles — the phone-friendly answer
    // for short lists (truck types); 'select' for long ones (cities).
    inputType: {
      type: String,
      enum: ['select', 'cards', 'text', 'number', 'datetime', 'textarea'],
      default: 'text',
    },
    options: [{
      key: { type: String, trim: true },
      ar: { type: String, trim: true },
      en: { type: String, trim: true },
    }],

    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    // Soft-delete FOR SYSTEM FIELDS ONLY. The boot seed re-creates any missing
    // system key, so hard-deleting one would resurrect it on the next restart;
    // a tombstoned row keeps the key "existing" and therefore stays gone.
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

shipmentOrderFieldSchema.index({ group: 1, order: 1 });

module.exports = mongoose.models.ShipmentOrderField
  || mongoose.model('ShipmentOrderField', shipmentOrderFieldSchema);
