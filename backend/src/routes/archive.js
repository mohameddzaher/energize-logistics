/**
 * /api/customer-archive and /api/vendor-archive: customers and operations vendors deleted anywhere land here (services/customerArchive).
 * Restore brings them back everywhere; deleting here is permanent, so it is limited to managers and top roles and no matrix tick opens it.
 */
const express = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { TOP_ROLES } = require('../config/constants');
const svc = require('../services/customerArchive');
const logAudit = require('../utils/auditLogger');

const READ = [...TOP_ROLES, 'cfo', 'moderator', 'operations_manager', 'operations_team_leader', 'vendors_manager', 'vendors_team_leader', 'collections_manager', 'collections_team_leader'];
const PURGE = [...TOP_ROLES, 'cfo', 'moderator', 'operations_manager', 'operations_team_leader', 'vendors_manager', 'vendors_team_leader', 'collections_manager', 'collections_team_leader'];
const send = (res, fn) => fn.then((out) => (out ? res.json(out) : res.status(404).json({ message: 'غير موجود في الأرشيف' })))
  .catch((e) => { console.error('[archive]', e); res.status(500).json({ message: e.message || 'تعذّر التنفيذ' }); });
const target = (req) => (req.query.reg ? { reg: String(req.query.reg), id: req.params.id } : {});
const masterOf = (req) => (req.query.reg ? null : req.params.id);

const customers = express.Router();
customers.use(authenticate);
customers.get('/', authorize(...READ), (req, res) => send(res, svc.list().then((rows) => ({ rows }))));
customers.post('/:id/restore', authorize(...READ), (req, res) => send(res, svc.restore(masterOf(req), target(req)).then(async (out) => {
  if (out) await logAudit({ user: req.user, action: 'restore', entity: 'CustomerArchive', entityId: req.params.id, changes: out, ipAddress: req.ip });
  return out;
})));
customers.delete('/:id', authorize.strict(...PURGE), (req, res) => send(res, svc.purge(masterOf(req), target(req)).then(async (out) => {
  if (out) await logAudit({ user: req.user, action: 'purge', entity: 'CustomerArchive', entityId: req.params.id, changes: out, ipAddress: req.ip });
  return out;
})));

const vendors = express.Router();
vendors.use(authenticate);
vendors.get('/', authorize(...READ), (req, res) => send(res, svc.listVendors().then((rows) => ({ rows }))));
vendors.post('/:id/restore', authorize(...READ), (req, res) => send(res, svc.restoreVendor(req.params.id)));
vendors.delete('/:id', authorize.strict(...PURGE), (req, res) => send(res, svc.purgeVendor(req.params.id).then(async (out) => {
  if (out) await logAudit({ user: req.user, action: 'purge', entity: 'VendorArchive', entityId: req.params.id, changes: out, ipAddress: req.ip });
  return out;
})));

module.exports = { customers, vendors, READ, PURGE };
