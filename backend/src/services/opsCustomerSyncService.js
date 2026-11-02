/**
 * opsCustomerSyncService — continuously mirrors the UPL operations platform's
 * customers (the `users` endpoint: the businesses/individuals who request
 * shipments) into our CRM as CrmCompany records.
 *
 * Dedup is by (externalSource, externalId) so re-runs UPDATE in place — never
 * duplicate. Contact fields (name/phone/email) are kept in sync from UPL on
 * every run; CRM-only fields a salesperson edits (owner, rating, score, notes,
 * status) are written ONLY on first insert and then left alone.
 */
const upl = require('./uplClient');
const CrmCompany = require('../models/CrmCompany');
const { emitToAll } = require('../websocket/socketManager');

const SOURCE = 'ops_upl';
let running = false;
let timer = null;

// Pull every UPL customer (paginated).
async function fetchAllUsers() {
  const all = [];
  const limit = 100; // UPL caps page size at 100
  let page = 1;
  for (let i = 0; i < 200; i++) {
    const out = await upl.get('/admin/users', { query: { page, limit } });
    const items = (out.data && out.data.items) || [];
    all.push(...items);
    const meta = out.data && out.data.meta;
    if (!meta || !meta.hasNextPage) break;
    page += 1;
  }
  return all;
}

async function syncOnce() {
  if (running) return { skipped: 'already-running' };
  if (!upl.isConfigured()) return { skipped: 'not-configured' };
  running = true;
  try {
    const users = await fetchAllUsers();
    if (!users.length) return { total: 0 };

    // Do not overwrite what was edited here, and do not rewrite what did not change. Every cycle wrote all companies (name, phone, email), so an email corrected in CRM or collections reverted half an hour later. Now compared with what was last seen (`uplSeen`): what the platform actually changed is written and distributed to all of the customer's sections (services/customerHub); what did not change there is untouched.
    const hub = require('./customerHub');
    const fold = require('../models/CollectionsParty').fold;
    const existing = new Map((await CrmCompany.find({ externalSource: SOURCE }).select('externalId name email phone emails uplSeen').lean())
      .map((c) => [String(c.externalId), c]));
    let created = 0;
    let updated = 0;
    for (const u of users.filter((x) => x && x.id)) {
      const id = String(u.id);
      const now = { name: (u.name && String(u.name).trim()) || u.phone || 'Customer', email: String(u.email || '').trim().toLowerCase(), phone: String(u.phone || '').trim() };
      const cur = existing.get(id);
      if (!cur) {
        const doc = await CrmCompany.create({
          name: now.name, nameKey: fold(now.name), phone: now.phone, whatsapp: now.phone, email: now.email, emails: now.email ? [now.email] : [],
          externalSource: SOURCE, externalId: id, lastSyncedAt: new Date(), uplSeen: now,
          status: 'active', type: 'customer', tags: ['operations_staff', u.user_type].filter(Boolean),
        });
        created += 1;
        void doc;
        continue;
      }
      const seen = cur.uplSeen || {};
      const set = {};
      if (now.name !== (seen.name ?? cur.name)) { set.name = now.name; set.nameKey = fold(now.name); }
      if (now.phone !== (seen.phone ?? cur.phone)) { set.phone = now.phone; set.whatsapp = now.phone; }
      if (now.email !== (seen.email ?? cur.email)) {
        const others = (cur.emails || []).filter((e) => e !== (seen.email ?? cur.email) && e !== now.email);
        set.emails = [now.email, ...others].filter(Boolean);
        set.email = set.emails[0] || '';
      }
      if (!Object.keys(set).length) continue;
      await CrmCompany.updateOne({ _id: cur._id }, { $set: { ...set, uplSeen: now, lastSyncedAt: new Date() } });
      updated += 1;
      // What the platform changed reaches all this customer's sections, and is not echoed back to it.
      const after = await CrmCompany.findById(cur._id).lean();
      await hub.onChange('crm', cur, after, 'platform');
    }
    try { emitToAll('crm:company', { synced: true, source: SOURCE }); } catch (e) {}
    console.log(`[opsCustomerSync] ${users.length} customers -> created ${created}, updated ${updated}`);
    return { total: users.length, created, updated };
  } catch (e) {
    console.error('[opsCustomerSync] error:', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startOpsCustomerSync() {
  if (timer) return;
  if (!upl.isConfigured()) {
    console.log('[opsCustomerSync] UPL not configured — customer sync disabled');
    return;
  }
  const minutes = Math.max(5, parseInt(process.env.OPS_CUSTOMER_SYNC_MIN || '30', 10));
  timer = setInterval(() => { syncOnce().catch(() => {}); }, minutes * 60 * 1000);
  setTimeout(() => { syncOnce().catch(() => {}); }, 15000); // initial run after boot
  console.log(`[opsCustomerSync] scheduled every ${minutes} min`);
}

module.exports = { startOpsCustomerSync, syncOnce };
