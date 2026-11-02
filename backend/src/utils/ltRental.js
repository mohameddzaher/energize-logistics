/**
 * ltRental: one definition of a rented user, and its link to the rider row.
 * A rented user is an active rental (`LtUserRental.status = active`) linked to its row (`ltEmployee`). The row's contract type 'users' is a mirror of that, written here and read alone only as a fallback for unlinked rows.
 * Registering a rental sets the contract type to 'users' (saving the previous one); ending it restores it. Moving the rider to another project moves their active rental (model hook).
 */
const S = (v) => String(v == null ? '' : v).trim();
const USERS_AR = 'يوزرات';
const isUsersText = (v) => /يوزر/.test(S(v));

/** Marks rows with their rental: `r._rented` is true (active), false (had a rental that ended and none active) or undefined (no linked rental; contract type is read as a fallback). `r.rental` is the active summary for display. One query for all rows. */
async function markRentals(rows) {
  const ids = rows.map((r) => r._id).filter(Boolean);
  if (!ids.length) return rows;
  const LtUserRental = require('../models/LtUserRental');
  const rentals = await LtUserRental.find({ ltEmployee: { $in: ids } })
    .select('ltEmployee status renterName renterType projectAr startDate endDate').sort({ createdAt: -1 }).lean();
  const by = new Map();
  for (const x of rentals) {
    const k = String(x.ltEmployee);
    const cur = by.get(k);
    if (!cur || (x.status === 'active' && cur.status !== 'active')) by.set(k, x);
  }
  for (const r of rows) {
    const x = by.get(String(r._id));
    if (!x) continue;
    r._rented = x.status === 'active';
    if (r._rented) r.rental = { _id: String(x._id), renterName: x.renterName, renterType: x.renterType, startDate: x.startDate };
  }
  return rows;
}

/** Is it a rented user? Linked rental first, contract type as fallback. */
const isRented = (r) => (r && r._rented !== undefined ? r._rented === true : isUsersText(r?.contractTypeAr));

function announce() {
  try { const cache = require('./ttlCache'); for (const k of ['lt:', 'b2c:', 'dash:']) cache.clear(k); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('lt:updated', { rentals: true });
  } catch (_) { /* */ }
}

/**
 * After every rental write: makes the linked row's contract type match it.
 * @param rental  the rental document after saving (or null after delete, with `removed`)
 * @param opts.previousLt  a row that was linked before the edit (now unlinked)
 */
async function syncEmployee(rental, { previousLt = null, removed = false, user = null } = {}) {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const LtUserRental = require('../models/LtUserRental');
  const by = user ? { by: user._id, byName: [user.firstName, user.lastName].filter(Boolean).join(' ') } : { byName: 'النظام' };
  const touched = new Set([previousLt, rental?.ltEmployee].filter(Boolean).map(String));
  for (const id of touched) {
    const lt = await LightTransportEmployee.findById(id);
    if (!lt) continue;
    const active = await LtUserRental.findOne({ ltEmployee: lt._id, status: 'active' }).sort({ createdAt: -1 });
    const want = active ? USERS_AR : null;
    if (want) {
      if (!isUsersText(lt.contractTypeAr)) {
        // Keep the previous type on the rental so it can be restored when the rental ends.
        if (!active.prevContractTypeAr) { active.prevContractTypeAr = S(lt.contractTypeAr); await active.save(); }
        lt.history.push({ kind: 'contract', ...by, fromValue: S(lt.contractTypeAr), toValue: USERS_AR, note: 'تأجير يوزر' });
        lt.contractTypeAr = USERS_AR;
        await lt.save();
      }
    } else if (isUsersText(lt.contractTypeAr)) {
      const last = removed && rental && String(rental.ltEmployee) === id ? rental
        : await LtUserRental.findOne({ ltEmployee: lt._id }).sort({ updatedAt: -1 }).lean();
      const back = S(last?.prevContractTypeAr);
      lt.history.push({ kind: 'contract', ...by, fromValue: S(lt.contractTypeAr), toValue: back || 'غير محدد', note: removed ? 'حُذف تأجير اليوزر' : 'انتهى تأجير اليوزر' });
      lt.contractTypeAr = isUsersText(back) ? '' : back;
      await lt.save();
    }
  }
  announce();
}

/** Moving the rider to another project moves their active rental along; called by the model hook. */
async function followProject(lt) {
  const LtUserRental = require('../models/LtUserRental');
  const r = await LtUserRental.updateMany({ ltEmployee: lt._id, status: 'active', projectAr: { $ne: S(lt.projectAr) } },
    { $set: { projectAr: S(lt.projectAr) } });
  if (r.modifiedCount) announce();
  return r.modifiedCount || 0;
}

module.exports = { markRentals, isRented, isUsersText, syncEmployee, followProject, announce, USERS_AR };
