const mongoose = require('mongoose');

// Every record taken from the operations platform, kept as it arrived. Screens of
// the Operations Platform section read from here once the link is switched off.
const opsArchiveSchema = new mongoose.Schema({
  resource: { type: String, required: true },
  externalId: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed },
  searchText: { type: String, default: '' },
  status: { type: String, default: '' },
  externalCreatedAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

opsArchiveSchema.index({ resource: 1, externalId: 1 }, { unique: true });
opsArchiveSchema.index({ resource: 1, externalCreatedAt: -1 });

module.exports = mongoose.models.OpsArchive || mongoose.model('OpsArchive', opsArchiveSchema);
