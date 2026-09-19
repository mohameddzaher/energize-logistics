/**
 * syncDriverCardsToHr — يطابق لقطةَ بطاقة السائق على ملفّ كلّ موظّف مع سجلّ
 * بطاقات السائقين في المركبات (المرجع). راجع utils/driverCardSync.
 *
 *   node src/scripts/syncDriverCardsToHr.js          يعرض الفروق
 *   node src/scripts/syncDriverCardsToHr.js --apply  يكتبها
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const DriverCard = require('../models/DriverCard');
  const Employee = require('../models/Employee');
  const { pushCardToEmployee } = require('../utils/driverCardSync');
  const cards = await DriverCard.find({ isActive: { $ne: false } });
  let diffs = 0; let fixed = 0; let orphan = 0;
  for (const c of cards) {
    const id = String(c.idNumber || '').trim();
    const emp = (c.employee && await Employee.findById(c.employee).lean())
      || await Employee.findOne({ isHrRecord: { $ne: false }, $or: [{ iqamaNumber: id }, { nationalId: id }] }).lean();
    if (!emp) { orphan += 1; console.log(`  بلا موظّف: ${c.name} ${id}`); continue; }
    const same = String(emp.driverCardNumber || '') === String(c.cardNumber || '')
      && String(emp.driverCardExpiry || '').slice(0, 10) === String(c.expiryDate || '')
      && String(emp.driverCardType || '') === String(c.cardType || '');
    if (!same) {
      diffs += 1;
      console.log(`  ${c.name}: الموارد البشرية ${emp.driverCardNumber || '—'} / ${String(emp.driverCardExpiry || '—').slice(0, 10)} ← المركبات ${c.cardNumber || '—'} / ${c.expiryDate || '—'}`);
    }
    if (APPLY && await pushCardToEmployee(c, { emit: false })) fixed += 1;
  }
  console.log(`بطاقات: ${cards.length} · مختلفة: ${diffs} · بلا موظّف: ${orphan}${APPLY ? ` · حُدِّث: ${fixed}` : ''}`);
  if (APPLY) { try { require('../utils/ttlCache').clear('hrm:'); } catch (_) { /* */ } }
  process.exit(0);
})();
