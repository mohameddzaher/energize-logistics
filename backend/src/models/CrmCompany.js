const mongoose = require('mongoose');

// A CRM company/account. The CRM keeps its OWN customer base (leads, prospects,
// partners…) separate from the logistics `Customer` collection, but can be
// linked to an existing logistics customer via `linkedCustomer` (hybrid model).
const crmCompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    arabicName: { type: String, trim: true },
    // Where this account sits in its lifecycle.
    status: {
      type: String,
      enum: ['lead', 'prospect', 'active', 'inactive', 'churned'],
      default: 'lead',
    },
    // Relationship nature. No enum: the keys come from the editable
    // crm_company_type lookup — an enum here would reject every option the
    // admin adds through Reference Data / the inline "+ Add".
    type: { type: String, trim: true, default: 'customer' },
    // 0–5 star rating of the relationship/value.
    rating: { type: Number, default: 0, min: 0, max: 5 },
    // 0–100 health/priority score (manual or computed).
    score: { type: Number, default: 0, min: 0, max: 100 },

    industry: { type: String, trim: true },
    // Keys from the editable crm_company_size lookup — no enum (see `type`).
    size: { type: String, trim: true, default: '' },
    website: { type: String, trim: true },

    // Contact channels (drive the WhatsApp / call / email quick-action icons).
    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },

    address: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },

    // Keys from the editable crm_source lookup — no enum (see `type`).
    source: { type: String, trim: true, default: '' },
    tags: { type: [String], default: [] },

    // Account manager / owner.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Optional link to an existing logistics customer (hybrid).
    linkedCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Provenance for records auto-synced from an external system (the UPL
    // operations platform). `externalId` is that system's stable id; the unique
    // partial index dedups so re-syncs update in place instead of duplicating.
    // Records created manually in the CRM leave these unset and are untouched.
    externalSource: { type: String, trim: true },
    externalId: { type: String, trim: true },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

crmCompanySchema.index({ name: 1 });
crmCompanySchema.index({ status: 1 });
crmCompanySchema.index({ owner: 1 });
crmCompanySchema.index({ rating: -1 });
crmCompanySchema.index({ tags: 1 });
// Dedup key for synced records only (manual records have no externalId).
crmCompanySchema.index(
  { externalSource: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $exists: true } } }
);

module.exports = mongoose.model('CrmCompany', crmCompanySchema);
