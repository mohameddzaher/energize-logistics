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

    const ops = users.filter((u) => u && u.id).map((u) => ({
      updateOne: {
        filter: { externalSource: SOURCE, externalId: String(u.id) },
        update: {
          $set: {
            name: (u.name && String(u.name).trim()) || u.phone || 'Customer',
            phone: u.phone || '',
            whatsapp: u.phone || '',
            email: u.email || '',
            externalSource: SOURCE,
            externalId: String(u.id),
            lastSyncedAt: new Date(),
          },
          $setOnInsert: {
            status: 'active',
            type: 'customer',
            tags: ['operations_staff', u.user_type].filter(Boolean),
          },
        },
        upsert: true,
      },
    }));

    let created = 0;
    let updated = 0;
    const CHUNK = 500;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const res = await CrmCompany.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
      created += res.upsertedCount || 0;
      updated += res.modifiedCount || 0;
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
