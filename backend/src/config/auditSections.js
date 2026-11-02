/**
 * auditSections: maps each audit-log entity to its section.
 * The log records the database model name, which users do not recognize, and the filter list had many unordered raw names. The real question is which section, so section is the first filter and entity the detail.
 * Section keys are the SECTIONS keys of sectionWorkController, so there is no second list to drift.
 * An unlisted entity falls into `other` rather than vanishing; a silently hidden action is worse than a misclassified one.
 */

const { SECTION_LABELS_AR, SECTION_KEYS: SYSTEM_SECTION_KEYS } = require('./sections');

/**
 * Section to display name; `other` is always last (unclassified).
 * Every system section has a row. `sys` is the key in config/sections, used for the Arabic name shown in the sidebar.
 * Three have no counterpart there: cash custody (a screen inside operations), users and system, and other.
 */
const SECTIONS = [
  { key: 'operations', sys: 'Operations', en: 'Operations' },
  { key: 'wallet', ar: 'العهدة النقدية', en: 'Cash Wallet' },
  { key: 'collections', sys: 'Collections', en: 'Collections' },
  { key: 'ops', sys: 'Operations Platform', en: 'Operations Platform' },
  { key: 'shipment-orders', sys: 'Shipment Orders', en: 'Shipment Orders' },
  { key: 'fleet', sys: 'Fleet Management', en: 'Fleet Management' },
  { key: 'customs', sys: 'Customs', en: 'Customs Clearance' },
  { key: 'vehicles', sys: 'Vehicles', en: 'Vehicles' },
  { key: 'ls2', sys: 'Location Solutions', en: 'Location Solutions' },
  { key: 'marketing', sys: 'Marketing', en: 'Marketing' },
  { key: 'bd', sys: 'Business Development', en: 'Business Development' },
  { key: 'it', sys: 'Software & IT', en: 'Software & IT' },
  { key: 'business-review', sys: 'Business Review', en: 'Business Review' },
  { key: 'administration', sys: 'Administration', en: 'Administration' },
  { key: 'contracts', sys: 'Contracts', en: 'Contracts' },
  { key: 'b2c', sys: 'B2C', en: 'B2C' },
  { key: 'remote', sys: 'Remote', en: 'Remote' },
  { key: 'hr', sys: 'HR', en: 'HR' },
  { key: 'crm', sys: 'CRM', en: 'CRM' },
  { key: 'sales', sys: 'Sales', en: 'Sales' },
  { key: 'accounting', sys: 'Accounting', en: 'Accounting' },
  { key: 'procurement', sys: 'Procurement', en: 'Procurement' },
  { key: 'system', ar: 'المستخدمون والنظام', en: 'Users & System' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
].map((s) => ({ ...s, ar: s.ar || SECTION_LABELS_AR[s.sys] || s.en }));

// A section added to the system but not here would silently disappear from the log filter, so it is appended before system and other: shown unordered, not missing.
{
  const covered = new Set(SECTIONS.map((s) => s.sys).filter(Boolean));
  const missing = SYSTEM_SECTION_KEYS.filter((k) => !covered.has(k));
  const at = SECTIONS.findIndex((s) => s.key === 'system');
  SECTIONS.splice(at, 0, ...missing.map((k) => ({
    key: k.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sys: k, ar: SECTION_LABELS_AR[k] || k, en: k,
  })));
}

/**
 * Entity to section.
 * Covers every name passed to `logAudit` on the server, not only those already in the database; an entity logged tomorrow needs its section ready.
 */
const ENTITY_SECTION = {
  // Cash custody
  WalletTransaction: 'wallet', DailyWallet: 'wallet',
  // Human resources
  Employee: 'hr', CompanyLicense: 'hr', LeaveRequest: 'hr',
  HrFormTemplate: 'hr', StaffStatusRequest: 'hr',
  // Operations; private price is a column of the operations sheet and drivers are its register.
  OperationsWorkflow: 'operations', PrivateSellingPrice: 'operations', Driver: 'operations',
  // Collections
  CollectionsParty: 'collections', CollectionsFollowUp: 'collections', CollectionAttachment: 'collections',
  // Vehicles: register, documents, driver cards and company insurance documents.
  VehicleMaster: 'vehicles', VehicleInsurancePolicy: 'vehicles',
  VehicleRegistryConfig: 'vehicles', DriverCard: 'vehicles', CorporatePolicy: 'vehicles',
  VehicleAuthorization: 'vehicles', VehicleAccident: 'vehicles', VehicleClaim: 'vehicles',
  // Fleet management
  FleetShipment: 'fleet', FleetVehicle: 'fleet', FleetVehicleLog: 'fleet',
  FleetDriver: 'fleet', FleetDriverExpense: 'fleet', FleetCustomer: 'fleet', FleetRequest: 'fleet',
  // Shipment orders
  ShipmentOrder: 'shipment-orders',
  // Customs clearance
  CustomsClearance: 'customs', CustomsContract: 'customs', CustomsParty: 'customs',
  // Individuals sector, including light transport: its screen lives inside the section and shares its permission.
  B2C: 'b2c', B2CRep: 'b2c', B2CProject: 'b2c', B2CDutyCheck: 'b2c', B2CWalletEntry: 'b2c',
  LightTransportEmployee: 'b2c', LightTransportOrder: 'b2c', LtCustodyEntry: 'b2c', LtUserRental: 'b2c',
  // Location Solutions: workshop and warehouse
  WorkshopPurchaseRequest: 'ls2', WorkshopTask: 'ls2', MaintenanceRequest: 'ls2',
  InventoryItem: 'ls2', Ls2StoreMovement: 'ls2', HtCustodyEntry: 'ls2', Ls2Asset: 'ls2', Ls2StoreItem: 'ls2', Ls2Supplier: 'ls2',
  // Contracts
  Contract: 'contracts',
  // Relations management
  Customer: 'crm', Vendor: 'crm', CrmVendor: 'crm', Dispute: 'crm', Complaint: 'crm',
  // Finance management
  Payment: 'accounting', Invoice: 'accounting', JournalEntry: 'accounting',
  // Business development; names are lowercase as recorded in `bdController`.
  tender: 'bd', partner: 'bd', opportunity: 'bd', activity: 'bd',
  // Business review
  BrMeeting: 'business-review', BrAction: 'business-review', BrAssignment: 'business-review',
  // Information technology
  CompanyEmail: 'it', Asset: 'it', CollectionsEmailTemplate: 'collections',
  // Users and system
  User: 'system', RolePermission: 'system', CustomRole: 'system',
  Branch: 'system', Lookup: 'system', System: 'system', PartnerAccount: 'system',
};

/** Safety-net entries (middleware/auditTrail) use entity `Api:<system section name>`, so they map to their section without a row per section. */
const apiEntityOf = (key) => { const s = SECTIONS.find((x) => x.key === key); return s && s.sys ? `Api:${s.sys}` : null; };
const sectionOfApiEntity = (entity) => {
  if (!String(entity || '').startsWith('Api:')) return null;
  const s = SECTIONS.find((x) => x.sys === String(entity).slice(4));
  return s ? s.key : null;
};

const sectionOf = (entity) => ENTITY_SECTION[entity] || sectionOfApiEntity(entity) || 'other';

/** All entities of a section; used to build the `$in` condition in queries. */
const entitiesOfSection = (key) => [
  ...Object.keys(ENTITY_SECTION).filter((e) => ENTITY_SECTION[e] === key),
  ...(apiEntityOf(key) ? [apiEntityOf(key)] : []),
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

module.exports = { SECTIONS, SECTION_KEYS, ENTITY_SECTION, sectionOf, entitiesOfSection };
