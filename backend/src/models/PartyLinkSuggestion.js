/**
 * Linking an account to another name: a suggestion that is shown, never a merge that happens.
 * Why: customer names came from operations reports, typed quickly, so one ledger account appears under two names, and few of the ledger accounts matched our names.
 * Why not merge by similarity: merging moves debt between accounts and similar names can be unrelated entities; a mistake surfaces only when a customer is billed for someone else's debt. Above a very high similarity it links; below, it goes to the collections manager to decide one by one. The decision is stored so it is not asked twice.
 */
const mongoose = require('mongoose');

const partyLinkSuggestionSchema = new mongoose.Schema({
  // The account as it came from the ledger.
  code: { type: String, trim: true, required: true },
  accountName: { type: String, trim: true, required: true },
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax' },

  // Our candidate, and the similarity score it was suggested with.
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
  candidateName: { type: String, trim: true, default: '' },
  score: { type: Number, default: 0 },

  // 'pending' awaiting, 'linked' linked, 'separate' independent account
  decision: { type: String, enum: ['pending', 'linked', 'separate'], default: 'pending', index: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: { type: Date },
  // 'auto' linked automatically on high similarity, 'manual' a human decision
  decidedHow: { type: String, trim: true, default: '' },
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
}, { timestamps: true });

// One suggestion per (account, candidate), not per account: one account can be written in operations under several names, and an index on the code alone dropped the second from the queue, leaving it with no code and no question.
partyLinkSuggestionSchema.index({ code: 1, candidate: 1 }, { unique: true });
partyLinkSuggestionSchema.index({ code: 1 });

module.exports = mongoose.models.PartyLinkSuggestion
  || mongoose.model('PartyLinkSuggestion', partyLinkSuggestionSchema);
