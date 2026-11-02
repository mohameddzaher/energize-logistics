/**
 * What blocks an employee from leaving: one rule for both termination and deletion.
 * A record named after a company, not an employee, was added in HR to register a device handed to one of its members. The record was then deleted as not HR's, so the employee vanished while his custody stayed registered and showed in the IT register under a deleted name nobody can read.
 * Termination was guarded by custody while deletion had no guard at all, and deletion is worse: termination keeps the record and the trace stays readable, deletion erases it and custody loses its owner.
 * Two guards in two places drift: vehicle authorization was added to one and forgotten in the other, so someone was blocked from termination but allowed to be deleted. The question is answered once and both read it.
 */

/**
 * What blocks this employee from leaving today.
 * @returns {Promise<{blocked:boolean, assets:number, authorizations:number, reasons:string[]}>}
 */
async function employeeExitBlockers(employeeId) {
  const Asset = require('../models/Asset');
  // Authorization from its single source (utils/vehicleAuthorization): the vehicle sheet, and the legacy assignment only for a vehicle with no sheet. Only the 'active' assignment used to be counted, so someone whose authorization was cancelled from vehicles or B2C was blocked from termination while his assignment stayed open.
  const { currentFor } = require('./vehicleAuthorization');

  const [assets, held] = await Promise.all([
    Asset.countDocuments({ employee: employeeId, status: 'assigned' }),
    currentFor(employeeId),
  ]);
  const authorizations = held.length;

  const reasons = [];
  if (assets) reasons.push(`${assets} عهدة لم تُسلَّم`);
  if (authorizations) reasons.push(`${authorizations} تفويض مركبة ما زال ساريًا`);
  return { blocked: reasons.length > 0, assets, authorizations, reasons };
}

/**
 * Returning custody to the store.
 * Called once deletion is decided. Custody is never deleted: it is a company asset and its record is read a year later. It returns to the store as `in_stock` and the reason is noted, so it does not stay 'with someone' who no longer exists.
 */
async function returnEmployeeAssetsToStore(employeeId, { note } = {}) {
  const Asset = require('../models/Asset');
  const r = await Asset.updateMany(
    { employee: employeeId, status: 'assigned' },
    {
      $set: {
        status: 'in_stock',
        employee: null,
        returnedDate: new Date().toISOString().slice(0, 10),
        ...(note ? { notes: note } : {}),
      },
    },
  );
  return r.modifiedCount || 0;
}

module.exports = { employeeExitBlockers, returnEmployeeAssetsToStore };
