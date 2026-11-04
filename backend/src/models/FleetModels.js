const mongoose = require('mongoose');

// Fleet management: the section that runs our own trucks, as opposed to the shipment-orders trial which books supplier trucks. One file for the four models because they change together: a shipment snapshots the vehicle and drivers it was booked with, and driver assignment moves between vehicles as part of booking.

// ── Vehicles: the 57 trucks (seeded from Location Solutions) ────────────────
const fleetVehicleSchema = new mongoose.Schema({
  plate: { type: String, required: true, unique: true, trim: true ,
    // One plate format system-wide; see `formatPlate`.
    set: (v) => require('../utils/plateKey').formatPlate(v),
  },
  name: { type: String, trim: true, default: '' },
  trailerType: { type: String, trim: true, default: 'سطحة' }, // Flatbed / curtain-side / ...
  gpsType: { type: String, trim: true, default: 'LS' },       // LS / EX
  brand: { type: String, trim: true, default: '' },           // Vehicle make, for the waybill.
  color: { type: String, trim: true, default: '' },           // Vehicle color, for the waybill.
  // Monthly income target for this vehicle (SAR), compared with the achieved in analytics. Empty follows the section default (FleetConfig.defaultMonthlyTarget) and changes with it; a number here is a vehicle-specific target.
  monthlyTarget: { type: Number, default: null },
  // Supervisor responsible for this vehicle, assigned by the department manager; everything the supervisor sees in the section (loads, drivers, dashboard, analytics) is limited to his vehicles.
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  /** The truck is one record in the vehicle registry. Identity (official plate, make, model, year, chassis, color), documents and expiries are read from `VehicleMaster` via this reference, not from a copy here. `brand`/`color` above are a fallback for unlinked trucks. Resolved at creation by the unified plate key (utils/vehicleRef); see utils/fleetIdentity. */
  vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null },
}, { timestamps: true });
// A registry vehicle cannot be two fleet trucks; that is how the 3965/3966 duplicate arose.
fleetVehicleSchema.index(
  { vehicleMaster: 1 },
  { unique: true, partialFilterExpression: { vehicleMaster: { $type: 'objectId' } } },
);

// ── Drivers: ~70 people across the 57 trucks — one or two per vehicle ───────
const fleetDriverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  iqama: { type: String, trim: true, default: '' },
  nationality: { type: String, trim: true, default: '' }, // Nationality, for the waybill.
  /** IBAN: written once on the driver file and read from it at every payout. Typing it per payout statement risked one wrong digit sending money to another account; the source is the driver's file, not the load row. */
  iban: { type: String, trim: true, default: '' },
  // Driver status: does he work at the moment (sick / on leave means false)?
  working: { type: Boolean, default: true },
  // Why he is off (sick / leave / other), so the dashboard can show who is sick and who is on leave instead of one flat off count.
  offReason: { type: String, enum: ['', 'sick', 'leave', 'other'], default: '' },
  offNote: { type: String, trim: true, default: '' },
  // On our sponsorship or not.
  onSponsorship: { type: Boolean, default: true },
  // The truck he is currently on. Reassigning him — including implicitly, by
  // picking him on a shipment for another truck — just moves this pointer;
  // the shipment events keep the story.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', default: null, index: true },
  /**
   * First or second: the seat is a rank, not mere presence.
   * A truck has at most two drivers, but rank was never stored, so order was arbitrary and the shipment form could seat the second driver as primary, printing the waybill in his name.
   * Rank is stored on the driver, not the vehicle: the `vehicle` pointer is the only link, and a driver list on the vehicle would be a second record of one fact that diverges when a driver moves.
   * A seat is meaningless without a truck: a driver who leaves resets to first. A truck cannot have a second without a first: if the first leaves, the second is promoted (see `seatDriver`).
   */
  seat: { type: Number, enum: [1, 2], default: 1 },
  // His monthly target if specific, otherwise the section default. `null` means use the default; `0` means no target. They differ.
  monthlyLoadsTarget: { type: Number, default: null },
  monthlyKmTarget: { type: Number, default: null },
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  /** The driver is one HR file. Name, phone, identity number, nationality and IBAN are read from `Employee` once linked, and work status follows his leave and termination there. The text fields above are a fallback for the unlinked (first names such as from Location Solutions). See utils/fleetIdentity and the link-to-employee action on the drivers page. */
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });
fleetDriverSchema.index({ name: 1 });
// One employee is one fleet driver among the active; a removed one keeps its reference for history.
fleetDriverSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { employee: { $type: 'objectId' }, isActive: true } },
);
fleetDriverSchema.index({ vehicle: 1, seat: 1 }); // every board/list joins drivers by seat

// ── Customers of the fleet section (separate register from the trial's) ─────
const fleetCustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  // Customer kind: heavy transport customers (fleet section) or branch customers.
  customerType: { type: String, enum: ['heavy', 'branch'], default: 'heavy', index: true },
  // Our rating of the customer (0 to 5), shown in the analytics customer ranking.
  rating: { type: Number, default: 0, min: 0, max: 5 },
  // Agreed payment type, a key from the fleet_payment_type list (cash/tax). Prefilled on the load when the customer is picked and editable there: a tax customer may pay one load in cash, so the agreement is a default, not a constraint.
  paymentType: { type: String, trim: true, default: '' },
  // Tax number and address, shown on the invoice; come from the CRM if present.
  taxNumber: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  // Link to the CRM company record. The two records were created independently in their own sections and join only by the normalized name, so the key is stored and indexed.
  crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany', default: null, index: true },
  nameKey: { type: String, trim: true, default: '', index: true },
  // Copy of the master's customer code (utils/customerCode).
  customerCode: require('../utils/customerCode').codeField(),
  routes: [{
    fromCity: { type: String, trim: true, default: '' },
    toCity: { type: String, trim: true, default: '' },
    price: { type: Number, default: null },
  }],
  notes: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
fleetCustomerSchema.index({ name: 1 });

// Shipments (loads).
const fleetShipmentSchema = new mongoose.Schema({
  // Waybill number. Its own series starting at 100001, six digits, visibly different from the shipment-orders 500-series so the two cannot be confused or collide.
  waybillNumber: { type: Number, unique: true, index: true },

  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetCustomer', default: null, index: true },
  customerName: { type: String, trim: true, default: '', index: true },

  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', default: null },
  // Snapshots: the waybill must read the same forever, whatever later happens to the vehicle row.
  vehiclePlate: { type: String, trim: true, default: '' },
  trailerType: { type: String, trim: true, default: '' },
  gpsType: { type: String, trim: true, default: '' },
  vehicleBrand: { type: String, trim: true, default: '' }, // Snapshot for the waybill.
  vehicleColor: { type: String, trim: true, default: '' }, // Snapshot for the waybill.

  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetDriver', default: null },
  driverName: { type: String, trim: true, default: '' },
  driverPhone: { type: String, trim: true, default: '' },
  driverIqama: { type: String, trim: true, default: '' },       // Snapshot for the waybill.
  driverNationality: { type: String, trim: true, default: '' }, // Snapshot for the waybill.
  // Waybill/load fields, entered at creation.
  rentType: { type: String, trim: true, default: '' },      // Rental type (forward / return ...), an editable list.
  paymentType: { type: String, trim: true, default: '' },   // Payment type (cash / tax), an editable list.
  // One of the four workflow payment types, as on shipment orders; the form asks this, and paymentType follows its family.
  paymentSubtype: {
    type: String, trim: true, default: '',
    enum: ['', ...require('../utils/paymentType').SUBTYPE_KEYS],
  },
  loadType: { type: String, trim: true, default: '' },      // Load type: from a list or typed manually.
  // B/L and container, as on shipment orders: they link the load to its customs transaction (services/customsOpsLink) and print on the transport order.
  blNumber: { type: String, trim: true, default: '', index: true },
  containerNumber: { type: String, trim: true, default: '', index: true },
  // Vehicle rent: the fleet section's actual income from this load (basis of analytics).
  price: { type: Number, default: 0, index: true },
  // Full rent (optional): the amount the driver collects from the customer, usually with forward rental. The difference (fullRent - price) is the branches section's share (3PL scenario). Zero means none.
  fullRent: { type: Number, default: 0 },
  // Customer kind for this load (snapshot): heavy transport or branch, for reports even if the customer changes later.
  customerType: { type: String, enum: ['heavy', 'branch', ''], default: '', index: true },
  driverExpense: { type: Number, default: 0 },              // Driver expense (formerly the driver advance).
  driverAdvance: { type: String, trim: true, default: '' }, // Legacy: read for old waybills only.
  // Friday bonus: when enabled, a fixed amount (FleetConfig.fridayBonusAmount) is added to the driver expense.
  fridayBonus: { type: Boolean, default: false },
  /** Driver expense payment. Accounting marks the row when it transfers the amount. This field separates due but not paid from paid; without it the expenses page is one undifferentiated claim and money is paid twice or not at all. */
  driverExpensePaid: { type: Boolean, default: false, index: true },
  driverExpensePaidAt: { type: Date, default: null },
  driverExpensePaidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  driverExpensePaidByName: { type: String, trim: true, default: '' },
  branch: { type: String, trim: true, default: '' },        // Branch, one of the company branches.
  // Second driver: for loads that must arrive fast, two drivers share the wheel.
  secondDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetDriver', default: null },
  secondDriverName: { type: String, trim: true, default: '' },

  // Supervisor: stamped from the creating account, and a first-class filter.
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },

  loadDate: { type: Date, default: null }, // Loading date.
  fromCity: { type: String, trim: true, default: '' },
  toCity: { type: String, trim: true, default: '' },

  status: {
    type: String,
    enum: [
      'requesting', 'loading', 'uploaded', 'on_way', 'arrived',
      'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled',
    ],
    default: 'requesting',
    index: true,
  },

  // Follow-up state, denormalized for the list: the details live in the events.
  lastContactAt: { type: Date, default: null },   // Last contact with the driver.
  expectedArrival: { type: Date, default: null }, // Expected arrival, optional.

  notes: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
fleetShipmentSchema.index({ createdAt: -1 });
// The board and the vehicle picker resolve each truck's active trip; the list
// filters by status + sorts by recency; the follow-up sweep scans in-flight
// loads by last contact.
fleetShipmentSchema.index({ vehicle: 1, status: 1 });
fleetShipmentSchema.index({ status: 1, createdAt: -1 });
fleetShipmentSchema.index({ status: 1, lastContactAt: 1 });
// Analytics filters/sorts by the effective load date (loadDate else createdAt);
// a loadDate index keeps the income/target aggregation off a collection scan.
fleetShipmentSchema.index({ loadDate: -1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
// One customer across all sections: link to the parent CRM company (services/customerHub).
require('../services/customerHub').attach(fleetCustomerSchema, 'fleet');
const FleetCounter = mongoose.models.FleetCounter || mongoose.model('FleetCounter', counterSchema);

fleetShipmentSchema.pre('save', async function (next) {
  if (this.isNew && this.waybillNumber == null) {
    try {
      this.waybillNumber = await require('../utils/transportOrderNumber').nextTransportNumber();
    } catch (e) { return next(e); }
  }
  next();
});

// Numbers held before this save: a load whose B/L and container are both cleared releases the row that took its number.
fleetShipmentSchema.post('init', function () {
  this.$locals.docAtLoad = String(this.blNumber || '').trim() || String(this.containerNumber || '').trim();
});

// Every saved load has its row in the operations workflow.
fleetShipmentSchema.post('save', async (doc) => {
  const before = doc.$locals && doc.$locals.docAtLoad;
  const now = String(doc.blNumber || '').trim() || String(doc.containerNumber || '').trim();
  if (doc.$locals) doc.$locals.docAtLoad = now;
  if (before && !now) {
    try {
      const OperationsWorkflow = require('./OperationsWorkflow');
      const r = await OperationsWorkflow.updateOne({ fleetShipment: doc._id, documentNumber: before }, { $set: { documentNumber: '' } });
      if (r.modifiedCount) await require('../services/customsOpsLink').resolveReports({ fleetShipment: doc._id });
    } catch (e) { console.error('[fleet-link] clear number:', e.message); }
  }
  require('../services/shipmentOrderWorkflowLink').mirrorFleetSoon(doc._id);
});

// Events: the append-only story of each shipment. Everything that happened (creation, edits, status flips, driver moves, follow-up calls) with who and when. Nothing is updated or deleted; corrections are new events. The shipment details view reads from this.
const fleetEventSchema = new mongoose.Schema({
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', required: true, index: true },
  type: {
    type: String,
    required: true,
    // maintenance_override: loaded with overdue maintenance under a recorded permission. The trace stays in the load's log, not another table, so a reader knows it left under permission and who approved. See controllers/fleetRequestController.
    enum: ['created', 'updated', 'status', 'driver_change', 'followup', 'maintenance_override'],
  },
  // followup: { contactTime, currentLocation, note, expectedArrival }
  // status:   { from, to } · updated: { fields } · driver_change: { text }
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });
fleetEventSchema.index({ shipment: 1, createdAt: -1 });

// ── Section-wide settings (singleton) ───────────────────────────────────────
// One editable row that holds the fleet section's tunable numbers. Dropdown
// option lists (rent type / payment type / load type) live in the shared Lookup
// system, not here.
const fleetConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'fleet', unique: true },
  fridayBonusAmount: { type: Number, default: 50 },      // Riyals added to the driver expense on Friday.
  defaultMonthlyTarget: { type: Number, default: 27000 }, // Default monthly target for a vehicle.
  // Driver target is loads and distance. A vehicle is measured by income, but a driver does not control price; he controls hauling and driving. So the questions are how many loads and how many km. The default is here and any driver may have his own (FleetDriver.monthlyLoadsTarget / monthlyKmTarget).
  defaultDriverMonthlyLoads: { type: Number, default: 8 },
  defaultDriverMonthlyKm: { type: Number, default: 8000 },

  // What the target is measured against. A monthly target of thirty thousand is ambiguous: income, or income after driver expense? The difference is thousands per vehicle, so a vehicle could meet one measure and miss the other.
  // gross: compared with income as is (including driver expenses)
  // net: compared with income after driver expense
  // The screen states the measure beside the number.
  targetBasis: { type: String, enum: ['gross', 'net'], default: 'gross' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  FleetVehicle: mongoose.models.FleetVehicle || mongoose.model('FleetVehicle', fleetVehicleSchema),
  FleetDriver: mongoose.models.FleetDriver || mongoose.model('FleetDriver', fleetDriverSchema),
  FleetCustomer: mongoose.models.FleetCustomer || mongoose.model('FleetCustomer', fleetCustomerSchema),
  FleetShipment: mongoose.models.FleetShipment || mongoose.model('FleetShipment', fleetShipmentSchema),
  FleetEvent: mongoose.models.FleetEvent || mongoose.model('FleetEvent', fleetEventSchema),
  FleetConfig: mongoose.models.FleetConfig || mongoose.model('FleetConfig', fleetConfigSchema),
};
