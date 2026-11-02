const mongoose = require('mongoose');

// Main vehicle registry, sourced from the Vehicles_2026 master: identity, classification and every dated document (insurance, operating card, registration, inspection, fuel chip, GPS). Days left and document state are computed at runtime, never stored, since they go stale.
const vehicleMasterSchema = new mongoose.Schema({
  source_row: Number,

  // Identity
  /** The plate is normalized on save, not only on display, so stored values match what is shown, searched and exported (`formatPlate`: single space, Western digits, uppercase Latin, order kept). */
  plateNumber: {
    type: String, required: true, unique: true, trim: true, index: true,
    set: (v) => require('../utils/plateKey').formatPlate(v),
  },
  // Plate with hamzas unified and spaces removed; key for linking to accidents, since the same plate is written differently across files.
  plateKey: { type: String, default: '', index: true },
  // Plate key in Arabic or Latin form, used to match the vehicle across fleet, Location Solutions and shipment orders. Derived on every save (see canonicalPlateKey).
  canonKey: { type: String, default: '', index: true },
  plateLettersAr: { type: String, default: '' },
  plateDigits: { type: String, default: '' },
  chassisNumber: { type: String, trim: true, index: true },
  serialNumber: { type: String, default: '' },

  // Classification
  sectorAr: { type: String, default: '' },
  sectorCode: { type: String, default: '', index: true }, // heavy_transport / light_transport / …
  registrationTypeAr: { type: String, default: '' },
  registrationTypeCode: { type: String, default: '', index: true },
  /** Which group company the vehicle belongs to. The fleet is shared operationally but owned separately, so licences, insurance and fines belong to one company. Stored as Arabic text so exports and filters read it directly, like `sectorAr` and `registrationTypeAr`. */
  ownerCompanyAr: { type: String, default: '', index: true },
  brandAr: { type: String, default: '', index: true },
  modelAr: { type: String, default: '' },
  modelYear: { type: Number, default: null, index: true },
  colorAr: { type: String, default: '' },
  colorCode: { type: String, default: '' },

  // Ownership
  ownerNameAr: { type: String, default: '', index: true },
  commercialRegistration: { type: String, default: '' },
  // Fields added with the section files update: department and city, since sector alone was too coarse for queries such as vehicles of one department in one city.
  departmentAr: { type: String, default: '', index: true },
  cityAr: { type: String, default: '', index: true },
  // Possession status: owner or user. A platform requirement, so it is a field rather than free text.
  possessionStatusAr: { type: String, default: '', index: true },
  // Whether the vehicle operates at all. The master encodes unused and stolen in different columns (in place of department and sector), so the answer is stored explicitly to count idle vehicles without reading a text column.
  serviceStatusAr: { type: String, default: '', index: true },
  serviceStatusCode: { type: String, default: '', index: true }, // in_service / idle / stolen
  // Authorized driver as in the vehicles file. Separate from section authorizations on employees: those are a movement log, this is a snapshot of the file.
  authorizedPerson: {
    name: { type: String, default: '' },
    iqamaNumber: { type: String, default: '' },
    jobTitleAr: { type: String, default: '' },
    // The authorization is a paper with a number and term, not just a name. Its expiry is a full document in config/vehicleDocuments, with alert threshold, expiry screen and renewal, because after expiry the driver operates without standing and insurers may dispute coverage.
    authorizationNumber: { type: String, default: '' },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null, index: true },
    // Reason the authorization has no date: required / not required / none.
    statusCode: { type: String, default: '', index: true },
    // Authorized person's phone, from the authorization paper; needed first when an incident occurs.
    phone: { type: String, default: '' },
  },

  /** The authorized person is not always the actual driver. The section sheet keeps actual-driver ID and name in separate columns and they differ for several vehicles; incidents and fines concern the actual driver. */
  actualDriver: {
    name: { type: String, default: '' },
    idNumber: { type: String, default: '', index: true },
  },
  // Platform shortcomings: what keeps this vehicle from meeting platform conditions, one item per line, as an actionable list.
  logistiGaps: { type: [String], default: [], index: true },
  // Missing-data items, each with its reason. 'None', 'required' and 'held by bank' are different states (a gap, work to do, not a gap), so mixing them into one 'missing' count makes the figure meaningless.
  missingItems: [{
    item: { type: String, default: '' },      // Operating card
    docKey: { type: String, default: '' },    // operatingCard
    reason: { type: String, default: '' },    // none | required | with_bank | …
  }],
  // The insurance policy covering this vehicle: one record referenced by many vehicles.
  insurancePolicy: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleInsurancePolicy', default: null, index: true },
  tamStatusAr: { type: String, default: '' },
  tamStatusCode: { type: String, default: '' }, // owner / user / none

  // Dated documents carry two distinct things. `statusCode` says why there is no date (none | required | not_required | unknown | held_by_third_party), set manually. `documentState` says what the date means now (valid | warning | critical | expired | missing | not_applicable), computed from the date and alert threshold, not stored, since it changes daily. 'Not required' is a healthy state and is counted separately.
  insurance: {
    policyNumber: { type: String, default: '' },
    companyAr: { type: String, default: '', index: true },
    coverageTypeAr: { type: String, default: '' },
    coverageTypeCode: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    premiumSar: { type: Number, default: null },
    // Premium may be text such as ownership by a bank or finance company: the premium exists and the financier pays it. Blanking the field would count the vehicle as uninsured, so the text is kept.
    premiumStatusAr: { type: String, default: '', index: true },
    status: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true },
  },

  // Fuel chip (Petro App).
  fuelCard: {
    // Plate as printed on the fuel invoice. It is spelled differently from the vehicle plate and is the only key for matching invoices to vehicles.
    plateOnInvoiceAr: { type: String, default: '' },
    provider: { type: String, default: '' },
    cardNumber: { type: String, default: '' },
    statusAr: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // active / inactive / …
    consumptionTypeAr: { type: String, default: '' },
    consumptionTypeCode: { type: String, default: '' },
    limitSar: { type: Number, default: null },
    limitStatus: { type: String, default: '' }, // open = no cap.
    // Chip history: when installed, when removed and by whom. Removal is a condition of employee clearance and is asked about months later; blanking the field would erase both question and answer.
    history: [{
      action: { type: String, enum: ['assigned', 'removed'], required: true },
      cardNumber: { type: String, default: '' },
      // Who held the chip at that time; read in his file and clearance.
      holderName: { type: String, default: '' },
      holderIqama: { type: String, default: '' },
      note: { type: String, default: '' },
      at: { type: Date, default: Date.now },
      byName: { type: String, default: '' },
    }],
  },

  // GPS (structure exists, data mostly empty).
  gps: {
    // Device status itself (active / inactive / stolen), distinct from subscription status.
    deviceStatusAr: { type: String, default: '', index: true },
    deviceId: { type: String, default: '' },
    deviceModel: { type: String, default: '' },
    simNumber: { type: String, default: '' },
    serialImei: { type: String, default: '' },
    provider: { type: String, default: '', index: true },
    status: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // active/inactive/required/not_required/stolen
    expiryDate: { type: Date, default: null, index: true }, // Subscription expiry.
  },

  // Operating card
  operatingCard: {
    cardNumber: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    statusCode: { type: String, default: '', index: true },
  },

  // Registration (vehicle licence)
  vehicleLicense: {
    expiryDateHijri: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    statusCode: { type: String, default: '', index: true },
  },

  // Periodic inspection
  inspection: {
    expiryDateHijri: { type: String, default: '' },
    statusAr: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // passed / none / with_bank / …
    expiryDate: { type: Date, default: null, index: true },
  },

  // Renewal history. Every renewal is recorded with old and new dates and who did it, so the answer to 'renewed until when and for how much' survives the next renewal.
  renewals: [{
    document: { type: String, required: true },   // insurance | operatingCard | …
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    // The document number before and after renewal. A renewed card may get a new number, and replacing it in place would leave fines and invoices issued against the old number with no vehicle; recording it keeps the chain readable backwards.
    previousNumber: { type: String, default: '' },
    newNumber: { type: String, default: '' },
    // Start date for documents that have one (authorization); renewed together, and the record holds old and new like the two expiry dates.
    previousStart: { type: Date, default: null },
    newStart: { type: Date, default: null },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },     // Receipt / payment voucher number.
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],

  accidentCount: { type: Number, default: 0, index: true },

  notesAr: { type: String, default: '' },
  // When the import last touched the record. `updatedAt` newer than this means a person edited it after the last import, so an empty sheet cell must not erase manual input.
  lastImportAt: { type: Date, default: null },
  sourceFile: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  // The vehicle's light-transport rider and his status today, a read-only snapshot. Written only by the light-transport employee register (models/LightTransport post-save) so the vehicles section sees leave, suspension or accident. It does not touch the authorization or actual driver, and is written without `timestamps` so it is not counted as a manual edit.
  b2cRider: {
    lt: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, default: '' },
    opStatus: { type: String, default: '' },
  },
}, { timestamps: true });

// Document expiry dates are indexed through index:true on their fields above.

// Unique numbers. Operating card, chassis, serial, tracker serial, fuel chip and authorization numbers belong to one vehicle each, so a duplicate is an error (copied row or double entry) that otherwise surfaces only as alerts on the wrong vehicle. The insurance policy number is excluded because one policy legitimately covers a whole fleet. Indexes are partial (`$gt: ''`) so empty values do not collide.
const NON_EMPTY = (field) => ({ [field]: { $gt: '' } });
for (const f of [
  'chassisNumber', 'serialNumber',
  'operatingCard.cardNumber', 'gps.serialImei',
  'fuelCard.cardNumber', 'authorizedPerson.authorizationNumber',
]) {
  vehicleMasterSchema.index({ [f]: 1 }, { unique: true, partialFilterExpression: NON_EMPTY(f) });
}

// Section settings: per-document alert thresholds (e.g. insurance 60 days, operating card 30).
const vehicleRegistryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'vehicle-registry', unique: true },
  // Alert threshold per document, set from the settings page; `critical` is the red threshold after which it is urgent rather than a warning.
  alerts: {
    insurance: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 15 }, soonDays: { type: Number, default: 90 } },
    operatingCard: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    vehicleLicense: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    inspection: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    gps: { enabled: { type: Boolean, default: false }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    // Authorization lapses suddenly and a replacement takes time, so its threshold is wider than the operating card's.
    authorization: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 45 }, criticalDays: { type: Number, default: 15 }, soonDays: { type: Number, default: 90 } },
    corporatePolicy: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 30 }, soonDays: { type: Number, default: 90 } },
    // The driver card is a document like the others. Settings accepted an edit for it but the value was dropped because no key existed here or in the accepted keys list, and its state was computed from hard-coded thresholds (30/60/90) that disagreed with the expiry screen.
    driverCard: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 30 }, soonDays: { type: Number, default: 90 } },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Company-level insurance documents not tied to a vehicle (goods insurance, fidelity). They have an expiry like any document and appear on the same expiry screen, since lapse stops all work rather than one vehicle.
// One policy can cover many vehicles; it is stored once and vehicles reference it, so renewal touches all at once, while each vehicle keeps its date because screens and alerts read from the vehicle.
const vehicleInsurancePolicySchema = new mongoose.Schema({
  policyNumber: { type: String, required: true, unique: true, trim: true, index: true },
  companyAr: { type: String, default: '', index: true },
  coverageTypeAr: { type: String, default: '' },
  expiryDate: { type: Date, default: null, index: true },
  // Total premium of the policy as in the file, not the sum of vehicle premiums, which may differ.
  totalPremiumSar: { type: Number, default: null },
  vehicleCount: { type: Number, default: 0 },
  notesAr: { type: String, default: '' },
  renewals: [{
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    vehiclesUpdated: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

const corporatePolicySchema = new mongoose.Schema({
  scopeAr: { type: String, default: '', index: true },
  policyholderAr: { type: String, default: '' },
  policyNumbers: { type: [String], default: [] },
  companyAr: { type: String, default: '' },
  startDate: { type: Date, default: null },
  expiryDate: { type: Date, default: null, index: true },
  premiumSar: { type: Number, default: null },

  // A policy priced per head. Fidelity cover is priced per driver per year, so a stored total goes stale as drivers join or leave. The per-head price is stored and the total computed from covered count; a fixed total can be set in `premiumSar` and is shown instead.
  premiumPerPersonSar: { type: Number, default: null },

  // Covered drivers are not copied here; they live in `DriverCard.fidelity.status` to avoid two diverging records. This flag only tells the screen to show the covered-drivers panel; add and remove write to the card.
  coversDrivers: { type: Boolean, default: false },

  /** A policy can end other than by renewal, for example a terminated contract. Termination is recorded with date and reason in the policy history like a renewal, so it stops raising expiry alerts and the reason stays readable. */
  endedAt: { type: Date, default: null },
  endReasonAr: { type: String, trim: true, default: '' },

  // What the policy covers decides its pricing: drivers per head, vehicles per vehicle, goods as a lump sum. The old per-individual-or-lump choice made vehicle and goods policies look like they concerned individuals.
  coverageSubject: { type: String, enum: ['drivers', 'vehicles', 'goods', 'other', ''], default: '' },
  premiumPerVehicleSar: { type: Number, default: null },
  vehicleCount: { type: Number, default: null },
  notesAr2: { type: String, default: '' },
  statusAr: { type: String, default: '' },
  statusCode: { type: String, default: '' },
  notesAr: { type: String, default: '' },
  renewals: [{
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Vehicle-derived values are recomputed on every save, not only in import. `plateKey` and `missingItems` used to be written only by import scripts, so vehicles added in the system had no plate key and completed documents stayed 'missing'. Missing items are recomputed per dated document (config/vehicleDocuments): a date present means not missing, otherwise its absence reason if that is a gap. Fuel chip and commercial register have no status in the record, so they keep their imported values until filled.
function deriveVehicle(v) {
  const { registryPlateKey } = require('../utils/plateKey');
  const VDOC = require('../config/vehicleDocuments');
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), v);
  const out = {};
  const key = registryPlateKey(v.plateNumber) || '';
  if (key && key !== v.plateKey) out.plateKey = key;
  const canon = require('../utils/plateKey').canonicalPlateKey(v.plateNumber) || '';
  if (canon && canon !== v.canonKey) out.canonKey = canon;

  const prev = (v.missingItems || []).map((m) => ({ item: m.item, docKey: m.docKey, reason: m.reason }));
  // Same names as the import wrote, or the item filter splits across two names.
  const LABELS = { insurance: 'التأمين', operatingCard: 'بطاقة التشغيل', vehicleLicense: 'رخصة السير',
    inspection: 'الفحص الدوري', gps: 'اشتراك GPS', authorization: 'التفويض' };
  const labelOf = (docKey) => LABELS[docKey] || (prev.find((m) => m.docKey === docKey) || {}).item
    || (VDOC.getDoc(docKey) || {}).ar || docKey;
  const next = [];
  for (const d of VDOC.DOCUMENTS) {
    if (!d.path || !d.statusPath) continue;
    if (get(d.path)) continue;
    const code = get(d.statusPath) || '';
    if (VDOC.isGap(code)) next.push({ item: labelOf(d.key), docKey: d.key, reason: code });
  }
  const dated = new Set(VDOC.DOCUMENTS.filter((d) => d.path && d.statusPath).map((d) => d.key));
  for (const m of prev) {
    if (dated.has(m.docKey)) continue;
    if (m.item === 'شريحة الوقود' && get('fuelCard.cardNumber')) continue;
    if (m.item === 'السجل التجاري' && v.commercialRegistration) continue;
    next.push(m);
  }
  const sig = (a) => JSON.stringify(a.map((m) => [m.item, m.docKey, m.reason]));
  if (sig(next) !== sig(prev)) out.missingItems = next;

  // Platform shortcomings: a condition the system has satisfied drops off. The list came from the platform file and persisted after inspection or insurance was renewed here. Conditions readable from the record are checked now; the ownership condition is not readable and stays.
  const now = Date.now();
  const valid = (path) => { const d = get(path); return !!d && new Date(d).getTime() > now; };
  const MET = {
    'فحص دوري ساري المفعول': () => valid('inspection.expiryDate'),
    'تأمين المركبة ساري المفعول': () => valid('insurance.expiryDate'),
    'رخصة سير المركبة سارية المفعول': () => valid('vehicleLicense.expiryDate'),
    'يوجد جهاز ملاحة للتتبع والتوجيه': () => !!(get('gps.deviceId') || /نشط|active/i.test(String(get('gps.deviceStatusAr') || '')) && !/غير/.test(String(get('gps.deviceStatusAr') || ''))),
    'نوع اللوحة: نقل عام': () => /نقل\s*عام/.test(String(v.registrationTypeAr || '')),
  };
  const gaps = (v.logistiGaps || []).filter((g) => !(MET[g] && MET[g]()));
  if (gaps.length !== (v.logistiGaps || []).length) out.logistiGaps = gaps;
  return out;
}
vehicleMasterSchema.pre('save', function (next) {
  try { Object.assign(this, deriveVehicle(this)); } catch (_) { /* Must not fail the save. */ }
  next();
});
// Screen edits go through findByIdAndUpdate, which bypasses pre('save').
vehicleMasterSchema.post('findOneAndUpdate', async function (doc) {
  if (!doc) return;
  try {
    const set = deriveVehicle(doc.toObject ? doc.toObject() : doc);
    if (Object.keys(set).length) {
      await doc.constructor.updateOne({ _id: doc._id }, { $set: set });
      Object.assign(doc, set);
    }
  } catch (_) { /* */ }
});
vehicleMasterSchema.statics.deriveVehicle = deriveVehicle;

// The authorization follows the assignment log from any write path. The paper (`authorizedPerson`) is the reference and the old assignment log read by the employee file and clearance mirrors it. Several paths wrote the paper without the mirror, leaving employees authorized with no vehicle authorized, so sync lives in the model and new paths need not remember it. See utils/vehicleAuthorization; `$locals.skipAuthSync` is for callers that sync explicitly.
const touchesAuth = (update) => {
  if (!update) return false;
  const keys = [];
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$') && v && typeof v === 'object') keys.push(...Object.keys(v));
    else keys.push(k);
  }
  return keys.some((k) => k === 'authorizedPerson' || k.startsWith('authorizedPerson.'));
};
const syncAuth = (id, ctx) => require('../utils/vehicleAuthorization').afterMasterWrite(id, ctx || {});

vehicleMasterSchema.pre('save', function (next) {
  this.$locals.authChanged = this.isNew
    ? !!(this.authorizedPerson?.name || this.authorizedPerson?.iqamaNumber)
    : this.isModified('authorizedPerson');
  next();
});
vehicleMasterSchema.post('save', async function (doc) {
  if (doc.$locals?.authChanged && !doc.$locals?.skipAuthSync) await syncAuth(doc._id, doc.$locals.authCtx);
  if (doc.$locals) doc.$locals.skipAuthSync = false;
});
vehicleMasterSchema.post('findOneAndUpdate', async function (doc) {
  if (!doc || this.getOptions().skipAuthSync || !touchesAuth(this.getUpdate())) return;
  await syncAuth(doc._id, this.getOptions().authCtx);
});
// `updateOne`/`updateMany` do not return the document, so identifiers are saved before the write.
for (const op of ['updateOne', 'updateMany']) {
  vehicleMasterSchema.pre(op, async function () {
    if (this.getOptions().skipAuthSync || !touchesAuth(this.getUpdate())) return;
    this._authIds = await this.model.find(this.getFilter()).distinct('_id');
  });
  vehicleMasterSchema.post(op, async function () {
    for (const id of this._authIds || []) await syncAuth(id, this.getOptions().authCtx);
  });
}
// A vehicle deleted from the registry must not leave an active assignment in anyone's file.
vehicleMasterSchema.post('findOneAndDelete', async function (doc) {
  if (!doc) return;
  try {
    const VA = require('../utils/vehicleAuthorization');
    const r = await VA.syncLegacyFromMaster({ ...(doc.toObject ? doc.toObject() : doc), authorizedPerson: {} },
      { reason: 'حُذفت المركبة من سجل المركبات' });
    VA.announce(r);
  } catch (e) { console.error('[vehicle-auth] delete sync:', e.message); }
});

// Plate and registration type propagate to their copies. The light-transport row, active operating order, accident and employee-file snapshot all carry the plate as text for search and history, so a correction here is written there from any write path. See utils/vehicleRef.pushVehicleChange.
const IDENT = ['plateNumber', 'registrationTypeAr'];
const touchesIdent = (update) => {
  if (!update) return false;
  const keys = [];
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$') && v && typeof v === 'object') keys.push(...Object.keys(v));
    else keys.push(k);
  }
  return keys.some((k) => IDENT.includes(k));
};
const pushIdent = async (id, before) => {
  try { await require('../utils/vehicleRef').pushVehicleChange(id, before); }
  catch (e) { console.error('[vehicle-ref] push:', e.message); }
};
vehicleMasterSchema.post('init', function () {
  this.$locals.identAtLoad = { plateNumber: this.plateNumber, registrationTypeAr: this.registrationTypeAr };
});
vehicleMasterSchema.pre('save', function (next) {
  this.$locals.identBefore = !this.isNew && IDENT.some((k) => this.isModified(k)) ? this.$locals.identAtLoad : null;
  next();
});
vehicleMasterSchema.post('save', async function (doc) {
  const before = doc.$locals && doc.$locals.identBefore;
  if (doc.$locals) {
    doc.$locals.identBefore = null;
    doc.$locals.identAtLoad = { plateNumber: doc.plateNumber, registrationTypeAr: doc.registrationTypeAr };
  }
  if (before) await pushIdent(doc._id, before);
});
for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
  vehicleMasterSchema.pre(op, async function () {
    if (!touchesIdent(this.getUpdate())) return;
    this._identBefore = await this.model.find(this.getFilter()).select('plateNumber registrationTypeAr').lean();
  });
  vehicleMasterSchema.post(op, async function () {
    for (const v of this._identBefore || []) await pushIdent(v._id, { plateNumber: v.plateNumber, registrationTypeAr: v.registrationTypeAr }); // eslint-disable-line no-await-in-loop
  });
}

module.exports = {
  VehicleMaster: mongoose.models.VehicleMaster || mongoose.model('VehicleMaster', vehicleMasterSchema),
  VehicleRegistryConfig: mongoose.models.VehicleRegistryConfig || mongoose.model('VehicleRegistryConfig', vehicleRegistryConfigSchema),
  CorporatePolicy: mongoose.models.CorporatePolicy || mongoose.model('CorporatePolicy', corporatePolicySchema),
  VehicleInsurancePolicy: mongoose.models.VehicleInsurancePolicy
    || mongoose.model('VehicleInsurancePolicy', vehicleInsurancePolicySchema),
};
