/**
 * Selling-price change requests.
 * REQUEST_ROLES see the selling price and write the purchase price directly, but a
 * selling-price edit from them becomes a pending request that an approver decides.
 * Approvers are named roles plus any user flagged as top management.
 */
const { TOP_ROLES } = require('./constants');

const REQUEST_ROLES = ['data_manager', 'data_analyst'];
const APPROVER_ROLES = [...TOP_ROLES, 'sales_manager'];

const sellingByRequest = (user) => !!user && REQUEST_ROLES.includes(user.role);
const canApproveSelling = (user) => !!user && (APPROVER_ROLES.includes(user.role) || user.isTopManagement === true);

// Approval list page; the nav badge is keyed by it.
const PAGE = '/system/selling-requests';
const EVENT = 'sellingRequests:changed';

module.exports = { REQUEST_ROLES, APPROVER_ROLES, sellingByRequest, canApproveSelling, PAGE, EVENT };
