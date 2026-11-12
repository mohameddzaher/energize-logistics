/**
 * Loads & shipments board: the operations workflow without invoicing, collection, customs and selling columns.
 * Open by default to the roles below; anyone else reaches it only when the page is ticked for their role on the permissions page.
 * The page decides access (not the Operations section), so sales can open it without the rest of Operations.
 */
const PAGE = '/system/operations/loads';

const DEFAULT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist',
  'operations_manager', 'operations_team_leader', 'operations_staff',
  'sales_manager', 'sales_team_leader', 'sales_rep',
  'data_manager', 'data_analyst',
];

/** Workflow fields never sent to this page. */
const HIDDEN_FIELDS = [
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes',
  'deliveryDate', 'collectedAmount', 'collectionDate', 'customsLink', 'paymentAmount', 'truckSize', 'sellingValue',
];

/** Fields the board reads; everything else on the workflow row stays on the server. */
const FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'ownerName', 'ownerPhone', 'carName',
  'applicationStatus', 'paymentMethod', 'paymentType', 'paymentSubtype',
  'username', 'userPhone', 'purchaseValue', 'loadingTime', 'driverRentalType', 'reference',
  'driverName', 'driverPhone', 'plateNumber', 'truckType', 'loadType', 'quantity',
  'representativeName', 'operationsReview', 'paymentDate', 'payingBranch',
  'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate',
  'lockedBy', 'lockedByName', 'shipmentOrder', 'fleetShipment', 'externalSource', 'createdAt', 'updatedAt',
];

/** Columns with an Excel-style filter: the board's columns the workflow filter understands. Purchase value is left out because the list ignores money filters. */
const FILTER_FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner', 'carNumber',
  'applicationStatus', 'username', 'userPhone', 'driverName', 'truckType', 'representativeName',
  'operationsReview', 'paymentDate', 'payingBranch', 'paymentType', 'finalReportDestination',
  'documentNumber', 'sendingDate', 'branchDeliveryDate',
];

module.exports = { PAGE, DEFAULT_ROLES, HIDDEN_FIELDS, FIELDS, FILTER_FIELDS };
