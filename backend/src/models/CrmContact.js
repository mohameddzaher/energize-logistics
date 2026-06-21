const mongoose = require('mongoose');

// An individual person inside (or independent of) a CRM company.
const crmContactSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany' },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    arabicName: { type: String, trim: true },
    title: { type: String, trim: true },
    department: { type: String, trim: true },

    // Contact channels (drive the WhatsApp / call / email quick-action icons).
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    mobile: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    linkedinUrl: { type: String, trim: true },

    // The main point of contact for the company.
    isPrimary: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    tags: { type: [String], default: [] },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

crmContactSchema.index({ company: 1 });
crmContactSchema.index({ firstName: 1, lastName: 1 });
crmContactSchema.index({ owner: 1 });

module.exports = mongoose.model('CrmContact', crmContactSchema);
