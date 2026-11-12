/**
 * Selling-price change requests.
 * REQUEST_ROLES see the selling price and write the purchase price directly, but a
 * selling-price edit from them becomes a pending request that an approver decides.
 * Approvers are named roles plus any user flagged as top management.
 */
const { TOP_ROLES } = require('./constants');

const DATA_TEAM = ['data_manager', 'data_analyst', 'data_entry'];
/**
 * Owner, 2026-11-12: the data team writes the selling price directly, like the purchase price.
 * The approval path is kept for later: set SELLING_APPROVAL_DATA_TEAM=1 in the backend .env (and reload) to route
 * the data team's selling edits through the sales manager again. Sales reps always go through approval.
 */
const DATA_TEAM_NEEDS_APPROVAL = process.env.SELLING_APPROVAL_DATA_TEAM === '1';
const REQUEST_ROLES = ['sales_rep', ...(DATA_TEAM_NEEDS_APPROVAL ? DATA_TEAM : [])];
const APPROVER_ROLES = [...TOP_ROLES, 'sales_manager', 'sales_team_leader'];

const sellingByRequest = (user) => !!user && REQUEST_ROLES.includes(user.role);
const canApproveSelling = (user) => !!user && (APPROVER_ROLES.includes(user.role) || user.isTopManagement === true);

// Approval list page; the nav badge is keyed by it.
const PAGE = '/system/selling-requests';
const EVENT = 'sellingRequests:changed';

module.exports = { DATA_TEAM, DATA_TEAM_NEEDS_APPROVAL, REQUEST_ROLES, APPROVER_ROLES, sellingByRequest, canApproveSelling, PAGE, EVENT };
