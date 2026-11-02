/**
 * Effective collections officer: no customer is left without one.
 * It is the name in `CollectionsParty.collectionOfficer` (set by the ledger import, team page and customer file), else the department manager. Legacy `assignedTo` and `officer` are unused.
 * Derived at read time and never stored, so a manager change applies immediately (one-minute cache).
 * Manager = active `collections_manager` who is a real person (not `.invalid` or `example.*` emails); with several, `COLLECTIONS_MANAGER_EMAIL` if it matches, else earliest `createdAt` then `_id`; none means the account stays unnamed.
 */
const cache = require('./ttlCache');

const MGR_KEY = 'cdr:mgr';
const MGR_TTL = 60 * 1000;

/** Email of a test account, not a person. */
const isTestEmail = (email) => {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e.endsWith('.invalid')) return true;
  const domain = e.split('@')[1] || '';
  return /^example\./.test(domain) || /\.example\./.test(`.${domain}`);
};

const fullName = (u) => [u?.firstName, u?.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
  || String(u?.email || '').trim();

/** Picks the manager from a list of users; separated so the choice is testable alone. */
function pickManager(users = [], preferredEmail = process.env.COLLECTIONS_MANAGER_EMAIL) {
  const real = users.filter((u) => u && u.isActive !== false && !isTestEmail(u.email));
  if (!real.length) return null;
  const pref = String(preferredEmail || '').trim().toLowerCase();
  const chosen = (pref && real.find((u) => String(u.email || '').trim().toLowerCase() === pref))
    || [...real].sort((a, b) => (new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      || String(a._id).localeCompare(String(b._id)))[0];
  return { _id: chosen._id, name: fullName(chosen), email: chosen.email || '' };
}

/** Collections department manager: `{ _id, name, email }` or `null`. */
async function collectionsManager() {
  return cache.wrap(MGR_KEY, MGR_TTL, async () => {
    const User = require('../models/User');
    const users = await User.find({ role: 'collections_manager', isActive: { $ne: false } })
      .select('firstName lastName email isActive createdAt').lean();
    return pickManager(users);
  });
}

const clean = (v) => String(v == null ? '' : v).trim();

/**
 * Assignment is a user reference and the written name is its nickname.
 * `CollectionsParty.collectionOfficerUser` is the assignment and `collectionOfficer` stays as text for display and filters ('Orabi' is the nickname of 'ahmed orabi' in the ledger); replacing it with the full name would change names in every board and saved link.
 * Staff directory: every active user in the department (staff or manager, no test accounts); nickname = the text most written on their accounts, otherwise their first name.
 */
const DIR_KEY = 'cdr:dir';
const ROLES = ['collections_staff', 'collections_manager'];
const lower = (v) => clean(v).toLowerCase();
const cap = (v) => { const x = clean(v); return x ? x[0].toUpperCase() + x.slice(1) : ''; };

async function officerDirectory() {
  return cache.wrap(DIR_KEY, MGR_TTL, async () => {
    const User = require('../models/User');
    const CollectionsParty = require('../models/CollectionsParty');
    const [users, aliasRows] = await Promise.all([
      User.find({ role: { $in: ROLES }, isActive: { $ne: false } }).select('firstName lastName email role').lean(),
      CollectionsParty.aggregate([
        { $match: { collectionOfficerUser: { $ne: null }, collectionOfficer: { $gt: '' } } },
        { $group: { _id: { u: '$collectionOfficerUser', t: '$collectionOfficer' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);
    const alias = new Map();
    for (const r of aliasRows) { const k = String(r._id.u); if (!alias.has(k)) alias.set(k, r._id.t); }
    return users.filter((u) => !isTestEmail(u.email)).map((u) => ({
      _id: String(u._id), name: fullName(u), email: u.email || '', role: u.role,
      firstName: clean(u.firstName), lastName: clean(u.lastName),
      label: alias.get(String(u._id)) || cap(u.firstName) || fullName(u),
    })).sort((a, b) => a.label.localeCompare(b.label));
  });
}

/** Which user does this written name mean? Nickname, full name, or first or last name when no two users share it. An ambiguous name is not guessed: `null`. */
function userForName(name, dir = []) {
  const n = lower(name);
  if (!n) return null;
  const hit = (pred) => { const xs = dir.filter(pred); return xs.length === 1 ? xs[0] : (xs.length > 1 ? 'ambiguous' : null); };
  for (const pred of [
    (u) => lower(u.label) === n,
    (u) => lower(u.name) === n,
    (u) => lower(u.firstName) === n || lower(u.lastName) === n,
  ]) {
    const r = hit(pred);
    if (r === 'ambiguous') return null;
    if (r) return r;
  }
  return null;
}

/** Owner of the reference in the directory, or null. */
const userById = (id, dir = []) => (id ? dir.find((u) => u._id === String(id)) || null : null);

/**
 * Effective officer: the reference owner if any (with the written nickname if it is theirs, otherwise their directory nickname), then the written name, then the department manager.
 * `ref` and `dir` are optional: callers that omit them read the text as before.
 */
const effectiveOfficer = (raw, mgr, ref, dir) => {
  const u = userById(ref, dir);
  if (u) {
    const t = clean(raw);
    return t && userForName(t, dir)?._id === u._id ? t : u.label;
  }
  return clean(raw) || (mgr?.name || '');
};
/** Does this effective name come from the manager rather than a written assignment? */
const isDefaultOfficer = (raw, ref) => !ref && !clean(raw);

/**
 * Resolves what is sent in an assignment to `{ user, text }`: a user id from the directory, or a written name (old clients) matched by `userForName`. Empty lifts the assignment.
 * A name matching nobody is accepted as text without a reference, as before references existed.
 */
async function resolveAssignment({ userId, name } = {}) {
  const dir = await officerDirectory();
  const byId = userById(userId, dir);
  if (byId) return { user: byId._id, text: byId.label };
  const t = clean(name);
  if (!t) return { user: null, text: '' };
  const u = userForName(t, dir);
  return { user: u ? u._id : null, text: u ? (lower(u.label) === lower(t) ? u.label : t) : t };
}

/** The directory is cleared after every assignment so a new staff nickname shows immediately. */
const invalidateDirectory = () => { try { cache.clear(DIR_KEY); } catch (_) { /* */ } };

/**
 * `CollectionsParty` condition for a filter by effective officer names.
 * The manager's name means their written accounts plus every unnamed account; `none` (the old 'no officer' link) is read as the manager too, so a saved link opens nothing else.
 */
function officerCondition(values, mgr, dir) {
  const list = [].concat(values || []).flatMap((v) => String(v || '').split(',')).map(clean).filter(Boolean);
  if (!list.length) return null;
  const mgrName = clean(mgr?.name).toLowerCase();
  const wantsDefault = list.some((v) => v === 'none' || (mgrName && v.toLowerCase() === mgrName));
  const named = list.filter((v) => v !== 'none');
  const or = [];
  if (named.length) or.push({ collectionOfficer: { $in: named } });
  // The reference is filtered by too: an account assigned to 'Orabi' shows under their nickname even if its text is written differently. (The caller passes the directory so this is computed; otherwise only the text is used.)
  const ids = dir ? named.map((n) => userForName(n, dir)?._id).filter(Boolean) : [];
  if (ids.length) {
    const mongoose = require('mongoose');
    or.push({ collectionOfficerUser: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
  }
  // 'Unassigned' = no text and no reference (`null` in Mongo also matches missing).
  if (wantsDefault) or.push({ collectionOfficer: { $in: ['', null] }, collectionOfficerUser: null });
  return or.length === 1 ? or[0] : { $or: or };
}

/** Adds the manager's name to the list of officer names (for filter lists). */
const withManager = (names, mgr) => {
  const set = new Set((names || []).map(clean).filter(Boolean));
  if (mgr?.name) set.add(mgr.name);
  return [...set].sort((a, b) => a.localeCompare(b));
};

module.exports = {
  collectionsManager, pickManager, isTestEmail, effectiveOfficer, isDefaultOfficer,
  officerCondition, withManager, MGR_KEY,
  officerDirectory, userForName, userById, resolveAssignment, invalidateDirectory, DIR_KEY,
};
