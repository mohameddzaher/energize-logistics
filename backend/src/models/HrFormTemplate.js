const mongoose = require('mongoose');

/**
 * A company form or official letter: HR's print-ready file.
 * A registry, not an attachment on an employee: `EmployeeDocument` belongs to one employee, while these belong to no one (leave request form, salary letter, custody receipt, clearance form), written once and printed for anyone. They lived in WhatsApp chats and personal folders, so an old copy got signed and returned.
 * One slot per form: current file, who uploaded and when, and version number. Old versions are not deleted but marked `isActive: false`, since whoever signed an old copy needs to find it.
 */
const hrFormTemplateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    titleEn: { type: String, trim: true, default: '' },
    // Category is an open list: departments ask for unforeseen types. Known values: forms | letters | policies | contracts | hse | other
    category: { type: String, trim: true, default: 'forms', index: true },
    description: { type: String, trim: true, default: '' },

    fileUrl: { type: String, required: true },          // /uploads/hr-forms/xxxx.pdf
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },

    // Version number rises on each file replacement, so whether this is the latest is readable.
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },

    // Download count: forms never downloaded are either not needed or unknown, and the number tells them apart over time.
    downloads: { type: Number, default: 0 },
    lastDownloadAt: { type: Date, default: null },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

hrFormTemplateSchema.index({ category: 1, title: 1 });

module.exports = mongoose.models.HrFormTemplate
  || mongoose.model('HrFormTemplate', hrFormTemplateSchema);
