/**
 * Customs parties: customers and shipping agents.
 * A registry, not free text, so one name is one party in analytics and its history is countable. The agent email lives on the agent file and prefills on selection.
 * One collection with a `kind` field: same structure, only the role differs.
 */
const mongoose = require('mongoose');

const customsPartySchema = new mongoose.Schema({
  // The carrier is a third party kind: it moves goods from the port to the yard or customer. Same structure, so a `kind` value, not a third collection.
  kind: { type: String, enum: ['customer', 'agent', 'carrier'], required: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  // Folded name used for matching so spelling variants do not create two parties.
  nameKey: { type: String, index: true },
  email: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  contactPerson: { type: String, trim: true, default: '' },
  // Several contacts per party, each with email and phone and an optional email purpose label.
  // The first is mirrored into `email`/`phone`/`contactPerson` above because email templates read them; see mirrorContacts in the controller.
  contacts: {
    type: [{
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      description: { type: String, trim: true, default: '' },
    }],
    default: [],
  },
  // Carrier only: yard location as a maps link.
  yardLocationUrl: { type: String, trim: true, default: '' },
  // Customer only: commercial registration and tax number, required on every customs declaration.
  commercialRegister: { type: String, trim: true, default: '' },
  taxNumber: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  // Party attachments (registration, tax certificate, contract, authorization), attached once on the party and read from every transaction it is in.
  attachments: {
    type: [{
      title: { type: String, trim: true, default: '' },
      fileUrl: { type: String, required: true },
      fileName: { type: String, default: '' },
      mimeType: { type: String, default: '' },
      size: { type: Number, default: 0 },
      uploadedByName: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const fold = (v) => String(v || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

customsPartySchema.pre('save', function preSave(next) { this.nameKey = fold(this.name); next(); });
customsPartySchema.pre('findOneAndUpdate', function preUpd(next) {
  const u = this.getUpdate() || {};
  const name = (u.$set && u.$set.name) || u.name;
  if (name) { u.$set = u.$set || {}; u.$set.nameKey = fold(name); this.setUpdate(u); }
  next();
});

// One party per name per role.
customsPartySchema.index({ kind: 1, nameKey: 1 }, { unique: true });

// One customer across all sections: link to the parent CRM company (services/customerHub).
customsPartySchema.add({ crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany', default: null, index: true } });
// Copy of the master's customer code (utils/customerCode).
customsPartySchema.add({ customerCode: require('../utils/customerCode').codeField() });
require('../services/customerHub').attach(customsPartySchema, 'customs');
module.exports = mongoose.models.CustomsParty || mongoose.model('CustomsParty', customsPartySchema);
module.exports.fold = fold;
