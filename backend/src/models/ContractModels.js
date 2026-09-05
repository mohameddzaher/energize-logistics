const mongoose = require('mongoose');

// إدارة العقود — the contracts department's own registry, SEPARATE from HR
// contracts (those are employment contracts). Four collections:
//
//   ContractVendor     — the 3PL supplier master list (the ماستر شيت): one row
//                        per vendor with its contract state, fleet, rep, docs,
//                        deep profile tables and the attached contract files.
//   VendorUtilisation  — one row per vendor per MONTH: orders executed, fleet
//                        capacity, utilisation %, share of Energize volume.
//                        The analysis screens are computed from these rows, so
//                        importing/entering a new month updates every ranking
//                        automatically.
//   ContractProspect   — cold-outreach log: companies contacted but not yet
//                        contracted (تنشيط الموردين).
//   DeptContract       — contracts of OTHER departments (fleet customers, B2C
//                        customers, 3PL customers…): a generic register with
//                        attachments, so every company contract lives here.
//
// Vendor names are Arabic free text and spelling differs between sources, so
// every collection carries nameKey — the folded/normalised join key.

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  title: { type: String, default: '' },       // "عقد موقع" / "سجل تجاري" …
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

// ---- ContractVendor ---------------------------------------------------------
const contractVendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true, index: true },
  energizeRep: { type: String, default: '' },       // مندوب التنشيط
  operationsRep: { type: String, default: '' },     // مندوب التشغيل
  vendorType: { type: String, default: '' },        // ضريبي / آجل / كاش …
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  destinations: { type: String, default: '' },
  coverage: { type: String, default: '' },          // شاملة / جزئية (derived or manual)
  fleetSize: { type: Number, default: 0 },
  vehicleTypes: { type: String, default: '' },
  avgMonthlyLoadsPerVehicle: { type: Number, default: 15 },
  monthlyCapacity: { type: Number, default: 0 },    // fleetSize × avgLoads unless overridden
  crNumber: { type: String, default: '' },
  // Contract state — the two signatures + the paper trail.
  vendorSideContract: { type: Boolean, default: false },
  ourSideContract: { type: Boolean, default: false },
  documentsReceived: { type: Boolean, default: false },
  missingDocuments: { type: String, default: '' },  // "السجل ورقم الايبان" …
  contractDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: 'تلقائي ما لم يصدر إشعار بعدم الرغبة' },
  paymentTermDays: { type: Number, default: 30 },
  pricingNotes: { type: String, default: '' },
  operationalStatus: { type: String, default: '' }, // نشط / متوقف …
  followUpNotes: { type: String, default: '' },
  notes: { type: String, default: '' },
  // تقييم يدوي من مدير القسم (1..5) فوق الترتيب المحسوب من التشغيل.
  rating: { type: Number, min: 1, max: 5, default: null },
  ratingNotes: { type: String, default: '' },
  attachments: [attachmentSchema],
  // Deep per-vendor profile tables imported from the hand-built Excel profiles
  // (branch/monthly/destination distributions, trip pricing logs, KPIs).
  // Layouts differ per vendor, so they are stored as-is and rendered generically.
  profileTables: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

contractVendorSchema.index({ energizeRep: 1 });
contractVendorSchema.index({ headquarters: 1 });

// ---- VendorUtilisation ------------------------------------------------------
const vendorUtilisationSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractVendor', default: null },
  vendorName: { type: String, required: true },
  nameKey: { type: String, required: true, index: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true },          // 1..12
  orders: { type: Number, default: 0 },
  fleetSize: { type: Number, default: 0 },
  expectedMonthlyCapacity: { type: Number, default: 0 },
  hasContract: { type: Boolean, default: false },
  vendorType: { type: String, default: '' },        // آجل / كاش / خارجي …
  operationsRep: { type: String, default: '' },
  // «أفراد خارجية» — the no-contract individuals bucket rides in this table as
  // one special row per month (isExternal) so shares always add up to 100%.
  isExternal: { type: Boolean, default: false },
}, { timestamps: true });

vendorUtilisationSchema.index({ nameKey: 1, year: 1, month: 1 }, { unique: true });
vendorUtilisationSchema.index({ year: 1, month: 1 });

// ---- ContractProspect -------------------------------------------------------
const contractProspectSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, index: true },
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  destinations: { type: String, default: '' },
  vehicleType: { type: String, default: '' },
  interestStatus: { type: String, default: '' },    // مهتم / غير مهتم / متابعة …
  isInterested: { type: Boolean, default: null },
  contactDate: { type: Date, default: null },
  assignedTo: { type: String, default: '' },        // من يتابعها
  notes: { type: String, default: '' },
  // متى تحوّلت لمورد فعلي — يُختم عند الترقية فيختفي من قائمة التنشيط.
  convertedVendor: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractVendor', default: null },
}, { timestamps: true });

// ---- DeptContract -----------------------------------------------------------
// ---- ContractCustomer -------------------------------------------------------
//
// ── ولماذا سجلٌّ للعملاء في قسم العقود ────────────────────────────────────────
// القسمُ كان يعرف نصفَ عمله: سجلُّ المورّدين كاملٌ بعقودهم ووثائقهم وحصصهم، وأمّا
// العملاءُ — الطرفُ الآخر من كلّ صفقة — فلا سجلَّ لهم إلّا صفوفًا في «عقود
// الأقسام» يبحث عنها بالاسم. فسؤالٌ يُسأل كلَّ أسبوع، «فلانٌ عقدُه موقَّعٌ وإلى
// متى؟»، لا جوابَ له إلّا في ورقة.
//
// والعميلُ موجودٌ في النظام في أكثرَ من مكان (العلاقات، التحصيل، الكشوف)، ولكلّ
// موضعٍ سؤالُه. وسؤالُ العقود واحد: **أموقَّعٌ عقدُه، وبأيّ شروط، وإلى متى، وماذا
// يشحن معنا فعلًا؟** فالسجلُّ هنا يجيب عن الأوّلَين ويقرأ الأخيرَين من مصدرهما —
// لا يُنسخ رقمٌ يشيخ.
//
// والربطُ بالاسم المطويّ (`nameKey`) كما في المورّدين: الاسمُ يُكتب بأشكالٍ في
// الشيتات، وهو ما يجعل الصفَّ الواحد واحدًا.
const contractCustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true, index: true },
  sector: { type: String, default: '' },            // القطاع: مقاولات، أغذية…
  customerType: { type: String, default: '' },      // ضريبي / كاش / آجل
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  energizeRep: { type: String, default: '' },       // مندوبُنا لديه
  crNumber: { type: String, default: '' },
  taxNumber: { type: String, default: '' },

  // حالةُ العقد — توقيعان ووثائق، كما في المورّدين تمامًا. والتماثلُ مقصود: من
  // يقرأ الشاشتين يقرأ الشيءَ نفسَه في الموضعين.
  customerSideContract: { type: Boolean, default: false },
  ourSideContract: { type: Boolean, default: false },
  documentsReceived: { type: Boolean, default: false },
  missingDocuments: { type: String, default: '' },
  contractDate: { type: Date, default: null },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: 'تلقائي ما لم يصدر إشعار بعدم الرغبة' },
  paymentTermDays: { type: Number, default: 30 },
  pricingNotes: { type: String, default: '' },
  operationalStatus: { type: String, default: '' }, // نشط / متوقف …
  followUpNotes: { type: String, default: '' },
  notes: { type: String, default: '' },
  attachments: [attachmentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

contractCustomerSchema.index({ name: 1 });

const deptContractSchema = new mongoose.Schema({
  department: { type: String, required: true },     // '3pl' | 'fleet' | 'b2c' | 'other'
  partyType: { type: String, enum: ['vendor', 'customer'], required: true },
  partyName: { type: String, required: true, trim: true },
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  subject: { type: String, default: '' },           // موضوع العقد / الخدمة
  contractDate: { type: Date, default: null },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: '' },
  paymentTermDays: { type: Number, default: null },
  value: { type: Number, default: null },           // القيمة إن وُجدت
  status: { type: String, enum: ['draft', 'active', 'expired', 'terminated'], default: 'active' },
  notes: { type: String, default: '' },
  attachments: [attachmentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

deptContractSchema.index({ department: 1, status: 1 });

module.exports = {
  ContractVendor: mongoose.models.ContractVendor || mongoose.model('ContractVendor', contractVendorSchema),
  VendorUtilisation: mongoose.models.VendorUtilisation || mongoose.model('VendorUtilisation', vendorUtilisationSchema),
  ContractProspect: mongoose.models.ContractProspect || mongoose.model('ContractProspect', contractProspectSchema),
  ContractCustomer: mongoose.models.ContractCustomer || mongoose.model('ContractCustomer', contractCustomerSchema),
  DeptContract: mongoose.models.DeptContract || mongoose.model('DeptContract', deptContractSchema),
};
