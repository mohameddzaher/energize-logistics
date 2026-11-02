/**
 * Paying branch: from branch id to the name written on the manifest.
 * The paying-branch column holds Arabic names in 24,000 rows, while branch records are English (`Jeddah`, `Riyadh`, `Al Dammam`). Writing `Branch.name` would put two values for one branch in the column, splitting every filter and report by branch, noticed only when totals stop adding up.
 * The `workflow_paying_branch` lookup fills the field when picked by hand and holds both names, so it is the reference: the English name is matched and the Arabic one written, so wallet writes agree with manual entry.
 * Unmatched branches are left empty, never guessed: empty reads as not recorded and gets filled, while a name in another language reads as a different branch and corrupts what is built on it.
 */

/** Folds the English name: case, spaces and the 'Al ' article. */
const foldEn = (v) => String(v || '')
  .toLowerCase()
  .replace(/^al[\s-]+/, '')
  .replace(/[^a-z0-9]/g, '');

/**
 * @param {*} branchId branch id (from custody or movement).
 * @returns {Promise<string>} the Arabic name as written in the column, or '' if unknown.
 */
async function arabicBranchName(branchId) {
  if (!branchId) return '';
  const Branch = require('../models/Branch');
  const Lookup = require('../models/Lookup');

  const b = await Branch.findById(branchId).select('name').lean();
  if (!b?.name) return '';

  const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true } }).select('key nameEn nameAr').lean();
  return matchPayingBranch(b.name, rows);
}

/** Folds the Arabic name: diacritics, ta marbuta, alef forms and spaces. */
const foldAr = (v) => String(v || '')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/\s+/g, '');

/** Heavy transport is a branch like any other. Wallet entries by heavy-transport users left the paying branch unwritten because the lookup had no equivalent, and its record may be 'Heavy Trucks', 'Heavy Transport' or Arabic, so any of them matches to the `heavy_trucks` row. */
const isHeavy = (name) => /heavy|fleet/i.test(String(name || ''))
  || foldAr(name).includes('ثقيل') || foldAr(name).includes('اسطول');

/** Branch name (English or Arabic) to the Arabic name in the list, or ''. */
function matchPayingBranch(branchName, rows) {
  const key = foldEn(branchName);
  const ar = foldAr(branchName);
  const hit = (key && rows.find((r) => foldEn(r.nameEn) === key))
    || (ar && rows.find((r) => foldAr(r.nameAr) === ar))
    || (isHeavy(branchName) && rows.find((r) => r.key === 'heavy_trucks' || isHeavy(r.nameEn) || isHeavy(r.nameAr)));
  return hit?.nameAr || '';
}

// Who pays for heavy transport: their purchases belong to that branch whichever wallet they used.
const HEAVY_RECORDER_ROLES = ['fleet_manager', 'fleet_supervisor', 'location_manager'];

/**
 * Paying branch of one purchase. The recorder's section decides first, then the wallet's
 * branch; a fleet row catches a wallet whose branch record has no match in the list.
 */
function resolvePayingBranch({ branchName, role, workflow }, rows) {
  const heavy = () => matchPayingBranch('Heavy Trucks', rows);
  if (HEAVY_RECORDER_ROLES.includes(role)) return heavy();
  return matchPayingBranch(branchName, rows)
    || (workflow?.fleetShipment || isHeavy(workflow?.branch) ? heavy() : '');
}

/** Same as `resolvePayingBranch`, reading the branch name and the list from the database. */
async function payingBranchOf({ branchId, role, workflow }) {
  const Branch = require('../models/Branch');
  const Lookup = require('../models/Lookup');
  const b = branchId ? await Branch.findById(branchId).select('name').lean() : null;
  const rows = await Lookup.find({ type: 'workflow_paying_branch', deleted: { $ne: true } }).select('key nameEn nameAr').lean();
  return resolvePayingBranch({ branchName: b?.name, role, workflow }, rows);
}

module.exports = { arabicBranchName, matchPayingBranch, resolvePayingBranch, payingBranchOf, foldEn, foldAr };
