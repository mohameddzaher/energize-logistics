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

// Any company write clears the cached companies list so edits show immediately.
const bustCompaniesList = () => { try { require('../utils/ttlCache').clear('crm:companies'); } catch (e) { /* noop */ } };
crmCompanySchema.post('save', bustCompaniesList);
crmCompanySchema.post(/^find.*[UD]/, bustCompaniesList);

// ── شركةُ العلاقات هي العميلُ الأمّ لكلّ الأقسام (services/customerHub) ─────────
// تحمل «بطاقةَ التواصل» كاملةً — أكثرُ من بريد، والمسؤول، والضريبيّ، والسجلّ —
// ومفتاحَ الاسم المطويّ نفسَه الذي يطوي به التحصيل (CollectionsParty.fold).
// و`uplSeen` آخرُ ما قرأناه من المنصّة: به يُعرف أنّ المنصّة غيّرت شيئًا فعلًا
// فلا تكتب مزامنتُها فوق ما عُدِّل عندنا.
crmCompanySchema.add({
  nameKey: { type: String, index: true, default: '' },
  emails: { type: [String], default: [] },
  contactPerson: { type: String, trim: true, default: '' },
  taxNumber: { type: String, trim: true, default: '' },
  commercialRegister: { type: String, trim: true, default: '' },
  uplSeen: { name: String, email: String, phone: String },
});
const crmFold = (s) => require('./CollectionsParty').fold(String(s || ''));
crmCompanySchema.pre('save', function keyName(next) { if (this.isModified('name') || !this.nameKey) this.nameKey = crmFold(this.name); next(); });
crmCompanySchema.pre('findOneAndUpdate', function keyNameUpd(next) {
  const u = this.getUpdate() || {}; const name = (u.$set && u.$set.name) || u.name;
  if (name) { this.set({ nameKey: crmFold(name) }); }
  next();
});
require('../services/customerHub').attach(crmCompanySchema, 'crm');

module.exports = mongoose.model('CrmCompany', crmCompanySchema);
