/**
 * bondStatus: asks the platform live whether the bond was received.
 * Purchase registration is blocked until the status is the bond-received state, read from our mirror (`OperationsWorkflow.applicationStatus`). The mirror lags: the platform ignores `sort` and returns by creation date, so a statement created days ago and updated today falls outside the polled page until the full sync.
 * Before blocking, and only then, this single statement is queried; if the platform says bond received the mirror is corrected and the purchase proceeds. The happy path costs no extra call.
 * It is a safety net, not a replacement for sync; see jobs/opsPoll.pollMovingShipments.
 */
const upl = require('../services/uplClient');

/**
 * Returns the live status of the statement and writes it to the mirror if different.
 * Returns `null` when the query fails, so the decision falls back to the mirror.
 */
async function refreshApplicationStatus(workflow) {
  if (!workflow || !workflow.externalId) return null;
  if (String(workflow.externalSource || '') !== 'ops_upl') return null;
  if (!upl.isConfigured()) return null;
  try {
    const out = await upl.get(`/admin/shipments/${workflow.externalId}`);
    const live = String((out && out.data && out.data.status) || '').trim();
    if (!live || live === String(workflow.applicationStatus || '').trim()) return live || null;
    // Only the status is written here. The other columns belong to sync; touching them in a user request path would tie wallet saving to an external call.
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    await OperationsWorkflow.updateOne(
      { _id: workflow._id },
      { $set: { applicationStatus: live, executionStatus: live, lastSyncedAt: new Date() } },
    );
    workflow.applicationStatus = live;
    workflow.executionStatus = live;
    return live;
  } catch (e) {
    // The platform is not answering: do not open the condition on doubt, and do not block saving either.
    return null;
  }
}

/** Whether the statement is now in the bond-received state; the platform is asked only if the mirror says no. */
async function isBondReceived(workflow) {
  if (String(workflow?.applicationStatus || '').trim() === 'bond_received') return true;
  return (await refreshApplicationStatus(workflow)) === 'bond_received';
}

module.exports = { refreshApplicationStatus, isBondReceived };
