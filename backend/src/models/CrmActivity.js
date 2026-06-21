const mongoose = require('mongoose');

// A logged interaction with a company/contact/deal: call, meeting, email,
// WhatsApp message, site visit or a free-form note. Powers the timeline and
// the calendar (activities with a future `date` show as scheduled events).
const crmActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['call', 'meeting', 'email', 'whatsapp', 'visit', 'note'],
      default: 'note',
    },
    subject: { type: String, required: true, trim: true },
    body: { type: String, trim: true },

    company: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany' },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmContact' },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmDeal' },

    direction: { type: String, enum: ['inbound', 'outbound', ''], default: '' },
    outcome: {
      type: String,
      enum: ['connected', 'no_answer', 'voicemail', 'positive', 'negative', 'neutral', ''],
      default: '',
    },
    // When the interaction happened / is scheduled for.
    date: { type: Date, default: Date.now },
    durationMinutes: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

crmActivitySchema.index({ company: 1, date: -1 });
crmActivitySchema.index({ contact: 1, date: -1 });
crmActivitySchema.index({ deal: 1, date: -1 });
crmActivitySchema.index({ date: -1 });
crmActivitySchema.index({ createdBy: 1, date: -1 });

module.exports = mongoose.model('CrmActivity', crmActivitySchema);
