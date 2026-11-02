const mongoose = require('mongoose');

// The create-shipment form, as data. Each row is one input: its name, group, HOW it renders (dropdown / cards / typed), options if any, and whether it is required.
// This lets the section owner decide per input and add new questions from a settings page instead of a deploy. The form page renders whatever is here, in order.
// System fields (isSystem) are wired to real logic (prices, times, route cities): look, label, options, order and required flag are editable, but not their existence, since deleting `sellPrice` would break invoicing. User-added fields are fully deletable and their answers live in ShipmentOrder.customFields.
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

    // 'cards' renders the options as tappable tiles, the phone-friendly choice for short lists (truck types); 'select' for long ones (cities).
    // `date` asks for the day only: shipment times are recorded by day, since nobody knows the pickup was at 7:42 and an hour typed just to proceed becomes precise-looking but false data.
    inputType: {
      type: String,
      enum: ['select', 'cards', 'text', 'number', 'date', 'datetime', 'textarea'],
      default: 'text',
    },
    options: [{
      key: { type: String, trim: true },
      ar: { type: String, trim: true },
      en: { type: String, trim: true },
      // What follows from the option.
      // Driver rental type decides the payment method (return trip => deferred, outbound => cash). The method used to be picked by hand beside it and could contradict it, so the option now carries its consequence, configurable for any new option from section settings. The rule stays with the section and is not buried in code.
      paymentMethod: { type: String, trim: true, default: '' },
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
