/**
 * Request context for the audit log: was anything recorded in this request?
 * `logAudit` is called from inside controllers without `req`. The safety net (middleware/auditTrail) needs to know after the request ends whether the controller wrote its own entry, so a flag travels with the request in AsyncLocalStorage: `logAudit` sets it and the net reads it.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  run: (fn) => als.run({ audited: false }, fn),
  mark: () => { const s = als.getStore(); if (s) s.audited = true; },
  store: () => als.getStore(),
};
