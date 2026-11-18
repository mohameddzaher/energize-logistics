/**
 * Customer and vendor archive.
 * Deleting a customer from any section archives the whole customer (the CRM master and its row in every register) and it leaves every list and dropdown at once.
 * Restoring brings all rows back; deleting from the archive removes them for good. Transactions keep their snapshot names either way.
 * Vendors (operations carriers, ShipmentOrderSupplier) follow the same flow on their own.
 */
const mongoose = require('mongoose');
const hub = require('./customerHub');

const S = (v) => String(v == null ? '' : v).trim();
const W = { withArchived: true };
// Registers whose lists hide rows through isActive; the others hide archived rows by query middleware (utils/archiveFields).
const HAS_ACTIVE = new Set(['shipment', 'fleet', 'customs', 'collections']);

const REG_AR = {
  crm: 'إدارة العلاقات', shipment: 'طلبات الشحنات والعمليات والمبيعات', fleet: 'إدارة الأسطول',
  customs: 'التخليص الجمركي', collections: 'التحصيل', contracts: 'إدارة العقود',
};

function emitSections() {
  try {
    const cache = require('../utils/ttlCache');
    for (const p of ['so:registry:', 'opsprivate:routes', 'customs:', 'collections:', 'coll:', 'crm:companies', 'dash:crm:', 'wfparty:']) cache.clear(p);
  } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    for (const ev of ['customers:changed', 'shipmentOrders:customers', 'fleet:customers', 'customs:updated', 'collections:party', 'contracts:updated', 'crm:company']) emitToAll(ev, { archive: true });
  } catch (_) { /* */ }
}

const actor = (user) => ({
  archivedBy: user && user._id ? user._id : null,
  archivedByName: user ? S(`${user.firstName || ''} ${user.lastName || ''}`) || S(user.name) || S(user.email) : '',
});

async function rowOf(reg, id) {
  if (!hub.REG[reg] || !mongoose.isValidObjectId(id)) return null;
  return hub.REG[reg].model().findById(id).setOptions(W).lean();
}

async function setRowArchived(reg, doc, stamp) {
  const set = { ...stamp };
  if (HAS_ACTIVE.has(reg)) { set.archivePrevActive = doc.isActive !== false; set.isActive = false; }
  await hub.REG[reg].model().updateOne({ _id: doc._id }, { $set: set });
}

async function setRowRestored(reg, doc) {
  const set = { archivedAt: null, archivedBy: null, archivedByName: '', archivedFrom: '' };
  if (HAS_ACTIVE.has(reg)) set.isActive = doc.archivePrevActive !== false;
  await hub.REG[reg].model().updateOne({ _id: doc._id }, { $set: set, $unset: { archivePrevActive: 1 } });
}

/** Partner (portal) accounts of this customer: by master or by any of its register rows. */
async function partnerAccounts(masterId, rowIds) {
  const User = require('../models/User');
  const ids = [masterId, ...rowIds].filter(Boolean).map(String);
  return User.find({ role: 'client', $or: [{ 'partner.refId': { $in: ids } }, { 'partner.master': { $in: ids } }, { linkedCustomer: { $in: ids.filter(mongoose.isValidObjectId) } }] }).select('_id isActive partnerArchived').lean();
}

/** Archive a customer from section `reg`: the master and every linked row. Returns { masterId, rows }. */
async function archive(reg, id, user) {
  const doc = await rowOf(reg, id);
  if (!doc) return null;
  const stamp = { archivedAt: new Date(), ...actor(user), archivedFrom: reg };
  const masterId = reg === 'crm' ? doc._id : (doc.crmCompany || await hub.ensureMaster(reg, doc));
  if (!masterId) { await setRowArchived(reg, doc, stamp); emitSections(); return { masterId: null, rows: 1 }; }
  const Crm = hub.REG.crm.model();
  await Crm.updateOne({ _id: masterId }, { $set: stamp });
  const linked = await hub.linkedRows(masterId);
  for (const { reg: r, doc: d } of linked) if (!d.archivedAt) await setRowArchived(r, d, stamp);
  // An archived customer has no portal access; restoring gives it back.
  const User = require('../models/User');
  for (const a of await partnerAccounts(masterId, linked.map((x) => x.doc._id))) {
    if (a.isActive !== false) await User.updateOne({ _id: a._id }, { $set: { isActive: false, partnerArchived: true } });
  }
  emitSections();
  return { masterId: String(masterId), rows: linked.length + 1 };
}

/** Restore by master id (or an orphan row: reg + id). */
async function restore(masterId, { reg, id } = {}) {
  if (!masterId && reg && id) {
    const doc = await rowOf(reg, id);
    if (!doc) return null;
    await setRowRestored(reg, doc); emitSections(); return { rows: 1 };
  }
  const Crm = hub.REG.crm.model();
  const m = await Crm.findById(masterId).setOptions(W).lean();
  if (!m) return null;
  await Crm.updateOne({ _id: m._id }, { $set: { archivedAt: null, archivedBy: null, archivedByName: '', archivedFrom: '' } });
  const linked = await hub.linkedRows(m._id);
  for (const { reg: r, doc: d } of linked) if (d.archivedAt) await setRowRestored(r, d);
  const User = require('../models/User');
  for (const a of await partnerAccounts(m._id, linked.map((x) => x.doc._id))) {
    if (a.partnerArchived) await User.updateOne({ _id: a._id }, { $set: { isActive: true }, $unset: { partnerArchived: 1 } });
  }
  await hub.ensureEverywhere(m._id).catch(() => {});
  emitSections();
  return { rows: linked.length + 1 };
}

/** Delete for good: the master, every register row, CRM records and portal accounts. Only archived customers can be purged. */
async function purge(masterId, { reg, id } = {}) {
  if (!masterId && reg && id) {
    const doc = await rowOf(reg, id);
    if (!doc || !doc.archivedAt) return null;
    await hub.REG[reg].model().deleteOne({ _id: doc._id }); emitSections(); return { rows: 1 };
  }
  const Crm = hub.REG.crm.model();
  const m = await Crm.findById(masterId).setOptions(W).lean();
  if (!m || !m.archivedAt) return null;
  const linked = await hub.linkedRows(m._id);
  for (const { reg: r, doc: d } of linked) await hub.REG[r].model().deleteOne({ _id: d._id });
  const crmModels = ['CrmContact', 'CrmActivity', 'CrmTask', 'CrmDeal'];
  for (const name of crmModels) {
    try { await require(`../models/${name}`).deleteMany({ company: m._id }); } catch (_) { /* model absent */ }
  }
  const User = require('../models/User');
  const accounts = await partnerAccounts(m._id, linked.map((x) => x.doc._id));
  if (accounts.length) await User.deleteMany({ _id: { $in: accounts.map((a) => a._id) }, role: 'client' });
  await Crm.deleteOne({ _id: m._id });
  emitSections();
  return { rows: linked.length + 1, accounts: accounts.length };
}

/** A row linked to an archived master by the hourly sweep (created by a background sync) stays archived with it instead of reviving the customer. */
async function followMasterArchive(reg, rowId, masterId) {
  const m = await hub.REG.crm.model().findById(masterId).setOptions(W).select('archivedAt archivedBy archivedByName archivedFrom').lean();
  if (!m || !m.archivedAt) return;
  const doc = await rowOf(reg, rowId);
  if (doc && !doc.archivedAt) await setRowArchived(reg, doc, { archivedAt: m.archivedAt, archivedBy: m.archivedBy, archivedByName: m.archivedByName, archivedFrom: m.archivedFrom });
}

/** A person adding a customer that sits in the archive brings the archived customer back instead of creating a second one. */
async function reviveIfArchived(masterId) {
  const m = await hub.REG.crm.model().findById(masterId).setOptions(W).select('archivedAt').lean();
  if (m && m.archivedAt) await restore(masterId);
}

/** Archive list: archived masters plus archived rows that never had a master. */
async function list() {
  const Crm = hub.REG.crm.model();
  const masters = await Crm.find({ archivedAt: { $ne: null } }).setOptions(W)
    .select('name customerCode phone email archivedAt archivedByName archivedFrom').sort({ archivedAt: -1 }).lean();
  const ids = masters.map((m) => m._id);
  const out = masters.map((m) => ({
    _id: String(m._id), master: true, name: m.name, code: m.customerCode || '', phone: m.phone || '', email: m.email || '',
    archivedAt: m.archivedAt, archivedByName: m.archivedByName || '', archivedFrom: m.archivedFrom || '',
    archivedFromAr: REG_AR[m.archivedFrom] || '', sections: [], activity: {},
  }));
  const byId = new Map(out.map((r) => [r._id, r]));
  const rowIdsByReg = {};
  for (const reg of hub.REG_KEYS.filter((k) => k !== 'crm')) {
    const R = hub.REG[reg];
    const rows = await R.model().find({ ...R.base, $or: [{ crmCompany: { $in: ids } }, { crmCompany: null, archivedAt: { $ne: null } }] })
      .setOptions(W).select('name crmCompany archivedAt archivedByName archivedFrom').lean();
    rowIdsByReg[reg] = [];
    for (const d of rows) {
      const owner = d.crmCompany && byId.get(String(d.crmCompany));
      if (owner) { owner.sections.push({ reg, ar: REG_AR[reg] }); rowIdsByReg[reg].push({ id: d._id, owner }); continue; }
      if (!d.archivedAt) continue;
      const row = { _id: String(d._id), master: false, reg, name: d.name, code: '', archivedAt: d.archivedAt, archivedByName: d.archivedByName || '', archivedFrom: reg, archivedFromAr: REG_AR[reg], sections: [{ reg, ar: REG_AR[reg] }], activity: {} };
      out.push(row); rowIdsByReg[reg].push({ id: d._id, owner: row });
    }
  }
  // What the customer had, so the reader sees what a permanent delete would orphan.
  const count = async (label, Model, field, pairs) => {
    if (!pairs || !pairs.length || !Model) return;
    const agg = await Model.aggregate([{ $match: { [field]: { $in: pairs.map((p) => p.id) } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).catch(() => []);
    const n = new Map(agg.map((a) => [String(a._id), a.n]));
    for (const p of pairs) { const v = n.get(String(p.id)); if (v) p.owner.activity[label] = (p.owner.activity[label] || 0) + v; }
  };
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
  await count('orders', safe(() => require('../models/ShipmentOrder')), 'customer', rowIdsByReg.shipment);
  await count('loads', safe(() => require('../models/FleetModels').FleetShipment), 'customer', rowIdsByReg.fleet);
  await count('clearances', safe(() => require('../models/CustomsClearance')), 'customerParty', rowIdsByReg.customs);
  await count('invoices', safe(() => require('../models/CollectionInvoice')), 'party', rowIdsByReg.collections);
  out.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  return out;
}

/* Vendors (operations carriers) */
const Supplier = () => require('../models/ShipmentOrderSupplier');

async function archiveVendor(id, user) {
  const d = await Supplier().findById(id).lean();
  if (!d) return null;
  await Supplier().updateOne({ _id: d._id }, { $set: { archivedAt: new Date(), ...actor(user), archivedFrom: 'vendors', archivePrevActive: d.isActive !== false, isActive: false } });
  emitVendors();
  return { id: String(d._id) };
}
async function restoreVendor(id) {
  const d = await Supplier().findById(id).lean();
  if (!d || !d.archivedAt) return null;
  await Supplier().updateOne({ _id: d._id }, { $set: { archivedAt: null, archivedBy: null, archivedByName: '', archivedFrom: '', isActive: d.archivePrevActive !== false }, $unset: { archivePrevActive: 1 } });
  emitVendors();
  return { id: String(d._id) };
}
async function purgeVendor(id) {
  const d = await Supplier().findById(id).lean();
  if (!d || !d.archivedAt) return null;
  await Supplier().deleteOne({ _id: d._id });
  emitVendors();
  return { id: String(d._id) };
}
async function listVendors() {
  const rows = await Supplier().find({ archivedAt: { $ne: null } })
    .select('name code phone email archivedAt archivedByName').sort({ archivedAt: -1 }).lean();
  const ids = rows.map((r) => r._id);
  const n = new Map();
  try {
    const agg = await require('../models/ShipmentOrder').aggregate([{ $match: { supplier: { $in: ids } } }, { $group: { _id: '$supplier', n: { $sum: 1 } } }]);
    for (const a of agg) n.set(String(a._id), a.n);
  } catch (_) { /* */ }
  return rows.map((r) => ({ _id: String(r._id), name: r.name, code: r.code || '', phone: r.phone || '', email: r.email || '', archivedAt: r.archivedAt, archivedByName: r.archivedByName || '', orders: n.get(String(r._id)) || 0 }));
}
function emitVendors() {
  try { const cache = require('../utils/ttlCache'); cache.clear('so:'); cache.clear('vendors:'); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    for (const ev of ['shipmentOrders:fleet', 'vendors:changed', 'vendors:archive']) emitToAll(ev, { archive: true });
  } catch (_) { /* */ }
}

module.exports = {
  archive, restore, purge, list, followMasterArchive, reviveIfArchived, emitSections, REG_AR,
  archiveVendor, restoreVendor, purgeVendor, listVendors,
};
