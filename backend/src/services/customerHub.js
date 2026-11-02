/**
 * customerHub: one customer across all sections. The CRM company (CrmCompany) is the parent record; every other section's record links to it via `crmCompany`, and the contact card is written to the parent then copied to all linked records.
 * Hooks live in the model (save, findOneAndUpdate), so new screens are covered; the copy uses updateOne (no hook) so it cannot loop. The name is not copied here: it has its own path (utils/renameOpsCustomer).
 */
const mongoose = require('mongoose');

/** Contact-card fields shared across all registers. */
// `code` is the customer's code (utils/customerCode): master `customerCode`, collections `code`.
const CARD = ['emails', 'phone', 'contactPerson', 'taxNumber', 'commercialRegister', 'address', 'city', 'code'];

const S = (v) => String(v == null ? '' : v).trim();
const { normalizeEmails } = require('../utils/partyEmails');
const foldName = (s) => require('../models/CollectionsParty').fold(String(s || ''));

/** Registers: how each reads its card from a row and writes it back. `single` means the record holds one email only (first in the list is written). */
const REG = {
  crm: {
    model: () => require('../models/CrmCompany'), base: {}, master: true,
    ar: 'إدارة العلاقات', href: (id) => `/system/crm/companies/${id}`,
    read: (d) => ({ emails: normalizeEmails([...(d.emails || []), d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    write: (c) => ({ emails: c.emails, email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, commercialRegister: c.commercialRegister, address: c.address, city: c.city, customerCode: c.code || '' }),
  },
  collections: {
    model: () => require('../models/CollectionsParty'), base: { kind: 'customer' },
    ar: 'التحصيل', href: (id) => `/system/collections-dept/parties/${id}`,
    read: (d) => ({ emails: normalizeEmails([...(d.emails || []), d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.code) }),
    write: (c) => ({ emails: c.emails, email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, commercialRegister: c.commercialRegister, address: c.address, city: c.city, code: c.code || '' }),
  },
  shipment: {
    model: () => require('../models/ShipmentOrderCustomer'), base: {}, single: true,
    ar: 'طلبات الشحنات والعمليات والمبيعات', href: (id) => `/system/shipment-orders/customers/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, address: c.address, city: c.city, customerCode: c.code || '' }),
  },
  fleet: {
    model: () => require('../models/FleetModels').FleetCustomer, base: {}, single: true,
    ar: 'إدارة الأسطول', href: (id) => `/system/fleet/customers/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), taxNumber: S(d.taxNumber), address: S(d.address), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, taxNumber: c.taxNumber, address: c.address, customerCode: c.code || '' }),
  },
  customs: {
    model: () => require('../models/CustomsParty'), base: { kind: 'customer' }, single: true,
    ar: 'التخليص الجمركي', href: (id) => `/system/customs/parties/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    // The first contact mirrors the flat customs fields (mirrorContacts); write both or the first save restores the old value.
    write: (c, d) => ({
      email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber,
      commercialRegister: c.commercialRegister, address: c.address, city: c.city, customerCode: c.code || '',
      ...(d && Array.isArray(d.contacts) && d.contacts.length
        ? { 'contacts.0.email': c.emails[0] || '', 'contacts.0.phone': c.phone, 'contacts.0.name': c.contactPerson || (d.contacts[0] && d.contacts[0].name) || '' }
        : {}),
    }),
  },
  contracts: {
    model: () => require('../models/ContractModels').ContractCustomer, base: {}, single: true,
    ar: 'إدارة العقود', href: () => '/system/contracts/customers',
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.crNumber), address: S(d.headquarters), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, crNumber: c.commercialRegister, headquarters: c.address, customerCode: c.code || '' }),
  },
};
const REG_KEYS = Object.keys(REG);

/** What changed in the card between two reads. */
function cardDiff(a, b) {
  const out = [];
  for (const f of CARD) {
    const x = a[f]; const y = b[f];
    if (x === undefined && y === undefined) continue;
    if (JSON.stringify(x ?? (f === 'emails' ? [] : '')) !== JSON.stringify(y ?? (f === 'emails' ? [] : ''))) out.push(f);
  }
  return out;
}

/** New card for the parent after an edit on a `reg` record. */
function mergeCard(master, before, after, changed, reg) {
  const card = { ...master };
  for (const f of changed) {
    if (f !== 'emails') { card[f] = after[f] ?? ''; continue; }
    if (!REG[reg].single) { card.emails = after.emails || []; continue; }
    // Single-email record: replaces its own email, other parent addresses stay.
    const oldE = (before.emails || [])[0]; const newE = (after.emails || [])[0];
    card.emails = normalizeEmails([newE || '', ...(master.emails || []).filter((e) => e !== oldE && e !== newE)]);
  }
  return card;
}

const emitChanged = (payload) => { try { require('../websocket/socketManager').emitToAll('customers:changed', payload); } catch (_) { /* */ } };

/** Parent for this row: its link if set, else a CRM company with the same name, else create one. The link is written to the row. (Not called for the parent itself.) */
async function ensureMaster(reg, doc) {
  const R = REG[reg];
  if (doc.crmCompany) return doc.crmCompany;
  const Crm = REG.crm.model();
  const key = foldName(doc.name);
  // The code identifies the customer: a row carrying one joins the master with that code.
  const code = S(R.read(doc).code);
  let master = code ? await Crm.findOne({ customerCode: code }).select('_id').lean() : null;
  if (!key && !master) return null;
  if (!master) master = await Crm.findOne({ nameKey: key }).select('_id').lean();
  if (!master) {
    // Another record with the same name is already linked, so its parent is this one's parent.
    for (const other of REG_KEYS.filter((k) => k !== 'crm' && k !== reg)) {
      const M = REG[other].model();
      const hit = await M.findOne({ ...REG[other].base, crmCompany: { $ne: null }, name: doc.name }).select('crmCompany').lean().catch(() => null);
      if (hit && hit.crmCompany) { master = { _id: hit.crmCompany }; break; }
    }
  }
  if (!master) {
    const card = R.read(doc);
    const created = await Crm.collection.insertOne({
      name: S(doc.name), nameKey: key, status: 'active', type: 'customer', source: `hub:${reg}`,
      ...REG.crm.write({ emails: card.emails || [], phone: card.phone || '', contactPerson: card.contactPerson || '', taxNumber: card.taxNumber || '', commercialRegister: card.commercialRegister || '', address: card.address || '', city: card.city || '' }),
      tags: [], rating: 0, score: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    master = { _id: created.insertedId };
  }
  await R.model().updateOne({ _id: doc._id }, { $set: { crmCompany: master._id } });
  return master._id;
}

/** Contracts has a row per parent, created when the parent is first known. The contracts key folds the Arabic definite article, so two names can collide; then the existing row is linked, not duplicated. */
async function ensureContract(masterId) {
  try {
    const C = REG.contracts.model();
    if (await C.exists({ crmCompany: masterId })) return false;
    const m = await REG.crm.model().findById(masterId).lean();
    if (!m) return false;
    const key = require('../controllers/contractsController').nameKey(m.name);
    if (!key) return false;
    const hit = await C.findOne({ nameKey: key }).select('_id crmCompany').lean();
    // Name matches a contracts row of another parent (two CRM companies with the same name); one row serves both.
    if (hit) { if (!hit.crmCompany) { await C.updateOne({ _id: hit._id }, { $set: { crmCompany: masterId } }); return true; } return false; }
    await C.collection.insertOne({
      name: S(m.name), nameKey: key, crmCompany: masterId, ...REG.contracts.write(REG.crm.read(m)),
      sector: '', customerType: '', energizeRep: '', customerSideContract: false, ourSideContract: false,
      documentsReceived: [], missingDocuments: [], attachments: [], createdByName: 'الربط الموحّد', createdAt: new Date(), updatedAt: new Date(),
    });
    return true;
  } catch (e) { if (e.code !== 11000) console.error('[customerHub] contract row:', e.message); return false; }
}

/** Every row linked to this parent in every register, except the parent itself. */
async function linkedRows(masterId) {
  const out = [];
  for (const reg of REG_KEYS.filter((k) => k !== 'crm')) {
    const R = REG[reg];
    const rows = await R.model().find({ ...R.base, crmCompany: masterId }).lean().catch(() => []);
    for (const d of rows) out.push({ reg, doc: d });
  }
  return out;
}

/** Writes a card to the parent and distributes it to linked records: the given fields, or all except `except`. */
async function fanOut(masterId, card, fieldsIn, except = null, origin = '') {
  let fields = fieldsIn;
  const Crm = REG.crm.model();
  const pick = (w) => {
    const out = {};
    for (const [k, v] of Object.entries(w)) {
      const base = k.startsWith('contacts.0.') ? (k.endsWith('email') ? 'emails' : k.endsWith('phone') ? 'phone' : 'contactPerson') : k;
      const f = base === 'email' ? 'emails' : base === 'crNumber' ? 'commercialRegister' : base === 'headquarters' ? 'address' : base === 'customerCode' ? 'code' : base;
      if (fields.includes(f)) out[k] = v;
    }
    return out;
  };
  const mset = pick(REG.crm.write(card));
  if (Object.keys(mset).length) {
    // A code already held by another customer is refused (unique): the rest of the card still goes through.
    try { await Crm.updateOne({ _id: masterId }, { $set: { ...mset, updatedAt: new Date() } }); }
    catch (e) {
      if (e.code !== 11000 || !('customerCode' in mset)) throw e;
      console.error('[customerHub] code taken:', mset.customerCode);
      delete mset.customerCode; fields = fields.filter((f) => f !== 'code');
      if (Object.keys(mset).length) await Crm.updateOne({ _id: masterId }, { $set: { ...mset, updatedAt: new Date() } });
    }
  }
  let n = 0;
  for (const { reg, doc } of await linkedRows(masterId)) {
    if (except && except.reg === reg && String(except.id) === String(doc._id)) continue;
    const set = pick(REG[reg].write(card, doc));
    if (!Object.keys(set).length) continue;
    try { await REG[reg].model().updateOne({ _id: doc._id }, { $set: set }); n += 1; }
    catch (e) { console.error(`[customerHub] fan-out ${reg} ${doc._id}:`, e.message); }
  }
  // The platform (UPL) knows the customer's email and phone, so local edits are written back to it.
  if (origin !== 'platform' && (fields.includes('emails') || fields.includes('phone'))) pushToPlatform(masterId, card).catch(() => {});
  return n;
}

async function pushToPlatform(masterId, card) {
  const Crm = REG.crm.model();
  const m = await Crm.findById(masterId).select('externalSource externalId').lean();
  if (!m || m.externalSource !== 'ops_upl' || !m.externalId) return;
  const upl = require('./uplClient');
  if (!upl.isConfigured || !upl.isConfigured()) return;
  const body = { email: card.emails[0] || undefined, phone: card.phone || undefined };
  try {
    await upl.patch(`/admin/users/${encodeURIComponent(m.externalId)}`, { body });
    await Crm.updateOne({ _id: masterId }, { $set: { 'uplSeen.email': body.email || '', 'uplSeen.phone': body.phone || '' } });
  } catch (e) { console.error('[customerHub] platform push:', e.message); }
}

/**
 * Captures an edit on a `reg` record, before and after.
 * @param origin 'platform' when the change came from the platform (so it is not echoed back)
 */
async function onChange(reg, before, after, origin = '') {
  try {
    if (!after || !REG[reg]) return;
    const R = REG[reg];
    if (R.base.kind && after.kind !== R.base.kind) return;
    const isNew = !before;
    // New CRM company: no linked records yet, so only announce (and do not echo to the platform).
    if (isNew && R.master) { await ensureContract(after._id); emitChanged({ master: String(after._id), origin: reg, created: true }); return; }
    const masterId = R.master ? after._id : await ensureMaster(reg, after);
    if (!masterId) return;
    const Crm = REG.crm.model();
    const master = await Crm.findById(masterId).lean();
    if (!master) return;
    const mCard = REG.crm.read(master);
    const aCard = R.read(after);

    if (isNew && !R.master) {
      // New row: takes missing fields from the parent and gives it the ones the parent lacks.
      const fillDoc = {}; const fillMaster = {};
      for (const f of CARD) {
        if (aCard[f] === undefined) continue;
        const empty = (v) => (Array.isArray(v) ? !v.length : !S(v));
        if (empty(aCard[f]) && !empty(mCard[f])) fillDoc[f] = mCard[f];
        if (!empty(aCard[f]) && empty(mCard[f])) fillMaster[f] = aCard[f];
      }
      const card = { ...mCard, ...fillMaster };
      if (Object.keys(fillMaster).length) await fanOut(masterId, card, Object.keys(fillMaster), { reg, id: after._id }, origin);
      if (Object.keys(fillDoc).length) {
        const set = {}; const w = R.write({ ...card }, after);
        for (const [k, v] of Object.entries(w)) {
          const f = k === 'email' ? 'emails' : k === 'crNumber' ? 'commercialRegister' : k === 'headquarters' ? 'address' : k === 'customerCode' ? 'code' : k.startsWith('contacts.0.') ? null : k;
          if (f && fillDoc[f] !== undefined) set[k] = v;
        }
        if (Object.keys(set).length) await R.model().updateOne({ _id: after._id }, { $set: set });
      }
      await ensureContract(masterId);
      emitChanged({ master: String(masterId), origin: reg, created: true });
      return;
    }
    const changed = cardDiff(before ? R.read(before) : {}, aCard).filter((f) => aCard[f] !== undefined);
    if (!changed.length) return;
    const card = mergeCard(mCard, before ? R.read(before) : {}, aCard, changed, reg);
    await fanOut(masterId, card, changed, R.master ? null : { reg, id: after._id }, origin);
    emitChanged({ master: String(masterId), origin: reg, fields: changed });
  } catch (e) {
    console.error(`[customerHub] ${reg}:`, e.message);
  }
}

/** Attached to each register schema: `save` (create or save) and `findOneAndUpdate` (edit). Reads the pre-edit row when the edit touches the card, and fires distribution after the response (setImmediate) so the screen save is not delayed. */
const WATCH = [...CARD, 'email', 'crNumber', 'headquarters', 'contacts', 'customerCode'];
function attach(schema, reg) {
  schema.pre('save', async function rememberBefore() {
    this.$locals.hubNew = this.isNew;
    if (this.isNew || !WATCH.some((f) => this.isModified(f))) return;
    try { this.$locals.hubBefore = await this.constructor.findById(this._id).lean(); } catch (_) { /* */ }
  });
  schema.post('save', function afterSave(doc) {
    const wasNew = doc.$locals && doc.$locals.hubNew;
    const before = doc.$locals && doc.$locals.hubBefore;
    if (!wasNew && !before) return;
    const after = doc.toObject();
    setImmediate(() => onChange(reg, wasNew ? null : before, after));
  });
  schema.pre('findOneAndUpdate', async function captureBefore() {
    try {
      const u = this.getUpdate() || {};
      const keys = [...Object.keys(u.$set || {}), ...Object.keys(u).filter((k) => !k.startsWith('$'))];
      if (!keys.some((k) => WATCH.includes(k.split('.')[0]))) return;
      this._hubBefore = await this.model.findOne(this.getQuery()).lean();
    } catch (_) { /* */ }
  });
  schema.post('findOneAndUpdate', function afterUpdate(doc) {
    if (!this._hubBefore) return;
    const before = this._hubBefore;
    const M = this.model;
    setImmediate(async () => {
      try { const after = await M.findById(doc ? doc._id : before._id).lean(); await onChange(reg, before, after); }
      catch (e) { console.error('[customerHub] update:', e.message); }
    });
  });
}

/** Where this customer exists; each customer file shows "same customer in" chips. */
async function presence(reg, id) {
  if (!REG[reg] || !mongoose.isValidObjectId(id)) return null;
  const d = await REG[reg].model().findById(id).select('crmCompany name').lean();
  if (!d) return null;
  const masterId = reg === 'crm' ? d._id : d.crmCompany;
  if (!masterId) return { master: null, places: [] };
  const master = await REG.crm.model().findById(masterId).select('name').lean();
  const places = [{ reg: 'crm', ar: REG.crm.ar, id: String(masterId), href: REG.crm.href(masterId), name: master ? master.name : '' }];
  for (const { reg: r, doc } of await linkedRows(masterId)) {
    places.push({ reg: r, ar: REG[r].ar, id: String(doc._id), href: REG[r].href(doc._id), name: doc.name });
  }
  return { master: String(masterId), places };
}

/** Hourly sweep: rows created by direct writes (updateOne/bulkWrite syncs) bypass model hooks, so they are linked here as if new (onChange with no "before"). */
async function sweepUnlinked(limit = 500) {
  let n = 0;
  for (const reg of REG_KEYS.filter((k) => k !== 'crm')) {
    const R = REG[reg];
    const rows = await R.model().find({ ...R.base, $or: [{ crmCompany: null }, { crmCompany: { $exists: false } }] }).limit(limit).lean().catch(() => []);
    for (const d of rows) { if (!S(d.name)) continue; await onChange(reg, null, d); n += 1; }
  }
  // Every CRM company also has a contracts row.
  const C = REG.contracts.model();
  const linked = new Set((await C.find({ crmCompany: { $ne: null } }).select('crmCompany').lean()).map((x) => String(x.crmCompany)));
  for (const m of await REG.crm.model().find({}).select('_id').lean()) {
    if (!linked.has(String(m._id)) && await ensureContract(m._id)) n += 1;
  }
  if (n) console.log(`[customerHub] sweep linked ${n}`);
  return n;
}
function startSweep() {
  const run = () => sweepUnlinked().catch((e) => console.error('[customerHub] sweep:', e.message));
  // Runs half an hour after boot; the first linking is done by the linkCustomerHub script with its full rules.
  setTimeout(run, 30 * 60 * 1000);
  setInterval(run, 60 * 60 * 1000).unref();
}

/**
 * Give a master customer its code and copy it to every linked record.
 * Refuses a code another customer already holds. Returns { ok, reason?, rows }.
 */
async function setMasterCode(masterId, rawCode) {
  const { normCode } = require('../utils/customerCode');
  const code = normCode(rawCode);
  const Crm = REG.crm.model();
  const master = await Crm.findById(masterId).lean();
  if (!master) return { ok: false, reason: 'master_missing' };
  if (code) {
    const other = await Crm.findOne({ customerCode: code, _id: { $ne: master._id } }).select('name').lean();
    if (other) return { ok: false, reason: 'code_taken', by: other.name };
  }
  const rows = await fanOut(master._id, { ...REG.crm.read(master), code }, ['code']);
  emitChanged({ master: String(master._id), origin: 'code', fields: ['code'] });
  return { ok: true, rows };
}

module.exports = { setMasterCode, sweepUnlinked, startSweep, CARD, REG, REG_KEYS, attach, onChange, ensureMaster, ensureContract, fanOut, presence, linkedRows, foldName, cardDiff };
