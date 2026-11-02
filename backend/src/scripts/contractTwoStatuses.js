/**
 * contractTwoStatuses: contract status is only active or expired.
 * Dry run by default; --apply writes.
 * terminated becomes expired (reason and date stay in terminationReason and terminatedAt); renewed becomes expired when a successor exists, otherwise active if not yet past its end, so an employee never has two active contracts.
 * Affected employees' contract-status field is re-read from the contract; employees without a contract get unified wording; the terminated option in hr_contract_status is marked deleted with a tombstone so seeding does not restore it. Safe to rerun.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Contract = require('../models/Contract');
  const Employee = require('../models/Employee');
  const Lookup = require('../models/Lookup');
  const { NORMALISE, isLapsed, syncEmployeeContractStatus } = require('../utils/contractStatus');
  // Write through the collection directly: the schema no longer accepts the two old values.
  const col = Contract.collection;

  // 1) terminated to expired
  const terminated = await col.find({ status: 'terminated' }).project({ employee: 1, endDate: 1, terminatedAt: 1, terminationReason: 1 }).toArray();

  // 2) renewed to expired, or active if nothing succeeded it
  const renewed = await col.find({ status: 'renewed' }).project({ employee: 1, endDate: 1 }).toArray();
  const toExpired = terminated.map((c) => c._id);
  const toActive = [];
  for (const c of renewed) {
    // eslint-disable-next-line no-await-in-loop
    const successor = await col.findOne({ $or: [{ renewedFrom: c._id }, { employee: c.employee, status: 'active', _id: { $ne: c._id } }] }, { projection: { _id: 1 } });
    if (successor || isLapsed(c.endDate) || toActive.some((x) => String(x.employee) === String(c.employee))) toExpired.push(c._id);
    else toActive.push(c);
  }

  // 3) employee fields
  const touched = new Set([...terminated, ...renewed].map((c) => String(c.employee)));
  const withContract = new Set((await col.distinct('employee')).map(String));
  const oldWords = Object.keys(NORMALISE).filter((k) => NORMALISE[k] !== k);
  const textRows = await Employee.find({ contractStatusText: { $in: oldWords } }).select('_id employeeNumber contractStatusText').lean();
  // Employees with a contract re-read the field from it; those without get unified wording.
  const textOnly = textRows.filter((e) => !withContract.has(String(e._id)));
  for (const e of textRows) if (withContract.has(String(e._id))) touched.add(String(e._id));

  // 4) the terminated option in the lookup list
  const lookups = await Lookup.find({ type: 'hr_contract_status', deleted: { $ne: true }, $or: [{ key: { $in: ['terminated', 'renewed'] } }, { nameAr: { $in: ['مفسوخ', 'مجدَّد', 'مجدد'] } }] }).select('_id key nameAr').lean();

  console.log(`terminated → expired: ${terminated.length}`);
  for (const c of terminated.slice(0, 50)) console.log(`  ${c._id}  emp ${c.employee}  end ${c.endDate || '—'}  reason «${c.terminationReason || ''}»`);
  console.log(`renewed → expired: ${renewed.length - toActive.length}   renewed → active: ${toActive.length}`);
  console.log(`employees to re-sync from their contract: ${touched.size}`);
  console.log(`employees without a contract, text normalised: ${textOnly.length}`);
  for (const e of textOnly.slice(0, 20)) console.log(`  #${e.employeeNumber || e._id}  «${e.contractStatusText}» → «${NORMALISE[e.contractStatusText]}»`);
  console.log(`lookup options retired: ${lookups.map((l) => `${l.key}/${l.nameAr}`).join(', ') || 'none'}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    await mongoose.disconnect();
    return;
  }

  if (toExpired.length) await col.updateMany({ _id: { $in: toExpired } }, { $set: { status: 'expired' } });
  if (toActive.length) await col.updateMany({ _id: { $in: toActive.map((c) => c._id) } }, { $set: { status: 'active' } });
  for (const e of textOnly) {
    // eslint-disable-next-line no-await-in-loop
    await Employee.updateOne({ _id: e._id }, { $set: { contractStatusText: NORMALISE[e.contractStatusText] } });
  }
  for (const id of touched) {
    // eslint-disable-next-line no-await-in-loop
    await syncEmployeeContractStatus(id);
  }
  if (lookups.length) await Lookup.updateMany({ _id: { $in: lookups.map((l) => l._id) } }, { $set: { deleted: true, isActive: false } });

  const left = await col.countDocuments({ status: { $nin: ['active', 'expired'] } });
  console.log(`\nApplied. Contracts with a status other than active/expired: ${left}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
