// Roles limited by branch on the Shipments page, and who sets those branches.
const SHIPMENT_BRANCH_ROLES = ['data_entry', 'data_analyst', 'shipment_orders_followup'];
const BRANCH_ACCESS_EDITORS = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'];

module.exports = { SHIPMENT_BRANCH_ROLES, BRANCH_ACCESS_EDITORS };
