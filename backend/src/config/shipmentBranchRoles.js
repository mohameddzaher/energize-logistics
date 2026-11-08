// Roles limited by branch on the Shipments page, and who sets those branches.
const SHIPMENT_BRANCH_ROLES = ['data_entry', 'data_analyst', 'shipment_orders_followup'];
const BRANCH_ACCESS_EDITORS = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'];
// The data team assigns branches to its own people on the permissions page only (not the user form), and never to itself.
const TEAM_BRANCH_EDITORS = ['data_manager', 'data_analyst'];
const BRANCH_PAGE_EDITORS = [...BRANCH_ACCESS_EDITORS, ...TEAM_BRANCH_EDITORS];

module.exports = { SHIPMENT_BRANCH_ROLES, BRANCH_ACCESS_EDITORS, TEAM_BRANCH_EDITORS, BRANCH_PAGE_EDITORS };
