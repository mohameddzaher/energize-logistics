const mongoose = require('mongoose');

// A file attached to an employee profile (iqama scan, license photo, contract
// PDF ...). The bytes live on disk under /uploads/employees and `fileUrl` is the
// public path served statically. `title` is the free-text label the user types
// when uploading ("صورة الإقامة"). Optional `category` lets the renewal actions
// link a renewal to the matching document type, and `expiryDate` lets a document
// itself drive expiry alerts.
const employeeDocumentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    title: { type: String, required: true, trim: true },          // ما كتبه المستخدم
    category: { type: String, trim: true, default: 'other' },      // iqama / passport / license / contract / other ...
    fileUrl: { type: String, required: true },                     // /uploads/employees/xxxx.pdf
    fileName: { type: String, trim: true },                        // original name
    mimeType: { type: String, trim: true },
    size: { type: Number, default: 0 },
    expiryDate: { type: String },                                  // optional YYYY-MM-DD
    notes: { type: String, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmployeeDocument', employeeDocumentSchema);
