const mongoose = require('mongoose');

/** A request a customer sends from the portal, answered by Operations (customer communication) in the system or by email from a company mailbox. */
const itemSchema = new mongoose.Schema({
  text: { type: String, trim: true, default: '' },
  // Optional reference the point is about.
  refType: { type: String, enum: ['', 'invoice', 'shipment', 'date', 'other'], default: '' },
  ref: { type: String, trim: true, default: '' },
}, { _id: true });

const messageSchema = new mongoose.Schema({
  side: { type: String, enum: ['customer', 'staff'], required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  text: { type: String, default: '' },
  via: { type: String, enum: ['system', 'email'], default: 'system' },
  email: {
    from: { type: String, default: '' },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, default: '' },
    messageId: { type: String, default: '' },
  },
  at: { type: Date, default: Date.now },
}, { _id: true });

const customerRequestSchema = new mongoose.Schema({
  number: { type: Number, unique: true, index: true },
  // The partner account that sent it, and who that partner is.
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  accountEmail: { type: String, default: '' },
  accountName: { type: String, default: '' },
  customerName: { type: String, default: '', index: true },
  partnerSource: { type: String, default: '' },
  partnerRef: { type: String, default: '' },

  subject: { type: String, trim: true, required: true },
  items: { type: [itemSchema], default: [] },
  messages: { type: [messageSchema], default: [] },

  status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open', index: true },
  unreadStaff: { type: Boolean, default: true, index: true },
  unreadCustomer: { type: Boolean, default: false },
  lastActivityAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

customerRequestSchema.pre('save', async function (next) {
  if (this.isNew && this.number == null) {
    const last = await this.constructor.findOne({}).sort({ number: -1 }).select('number').lean();
    this.number = (last && last.number ? last.number : 1000) + 1;
  }
  next();
});

module.exports = mongoose.model('CustomerRequest', customerRequestSchema);
