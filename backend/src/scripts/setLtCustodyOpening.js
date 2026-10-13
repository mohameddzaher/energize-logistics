/**
 * الرصيدُ الافتتاحيّ لعهدة النقل الخفيف — قيدُ واردٍ واحدٌ لكلّ حساب، مصدرُه
 * «رصيد افتتاحي». يُعاد تشغيلُه بأمان: يعدّل القيدَ الموجود ولا يضيف ثانيًا.
 *
 *   node src/scripts/setLtCustodyOpening.js cash=697.93 card=48.66 workshop=715            ← عرضٌ فقط
 *   node src/scripts/setLtCustodyOpening.js cash=697.93 card=48.66 workshop=715 --apply
 *   … date=2026-10-13   (اختياري؛ الافتراضيّ يومُ الشركة)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const LtCustodyEntry = require('../models/LtCustody');
const { ACCOUNTS } = require('../models/LtCustody');
const { todayKey } = require('../utils/companyDay');

const APPLY = process.argv.includes('--apply');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date || '') ? args.date : todayKey();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const account of ACCOUNTS) {
    if (args[account] == null) continue;
    const amount = Math.round(Number(args[account]) * 100) / 100;
    if (!(amount >= 0)) { console.log(`  ${account}: مبلغٌ غير صالح (${args[account]})`); continue; }
    // eslint-disable-next-line no-await-in-loop
    const cur = await LtCustodyEntry.findOne({ account, source: 'opening' });
    // eslint-disable-next-line no-await-in-loop
    const others = await LtCustodyEntry.countDocuments({ account, source: { $ne: 'opening' } });
    console.log(`  ${account}: ${cur ? `افتتاحيٌّ موجود ${cur.amount} →` : 'لا افتتاحيّ →'} ${amount} · بتاريخ ${cur ? cur.date : date} · قيودٌ أخرى في الحساب: ${others}`);
    if (!APPLY) continue;
    if (cur) { cur.amount = amount; await cur.save(); } // eslint-disable-line no-await-in-loop
    else await LtCustodyEntry.create({ account, direction: 'in', amount, date, source: 'opening', detail: 'رصيد افتتاحي', createdByName: 'رصيد افتتاحي' }); // eslint-disable-line no-await-in-loop
  }
  if (APPLY) { try { require('../utils/ttlCache').clear('ltcustody:'); } catch (_) { /* */ } }
  console.log(APPLY ? 'كُتب.' : 'عرضٌ فقط (--apply للكتابة).');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
