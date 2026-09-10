/** صفحةُ مصاريف السوّاق: الأعمدةُ والبطاقاتُ والفلاتر وتعليمُ السداد. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const fleet = require('../controllers/fleetController');
  const { FleetShipment, FleetDriver } = require('../models/FleetModels');
  const User = require('../models/User');
  const boss = await User.findOne({ role: 'super_admin' }).lean();
  const call = (fn, req) => new Promise((r) => {
    const res = { statusCode: 200, status(s){this.statusCode=s;return this;}, json(b){ r({code:this.statusCode, body:b}); } };
    fn({ query:{}, params:{}, body:{}, ip:'', user: boss, ...req }, res).catch((e)=>r({code:500,body:{err:e.message, stack:e.stack}}));
  });
  const m = (n) => (n||0).toLocaleString('en-US',{maximumFractionDigits:0});

  const all = await call(fleet.getDriverExpenses, {});
  if (all.code !== 200) { console.log('✗', JSON.stringify(all.body).slice(0,400)); process.exit(1); }
  const S = all.body.summary;
  console.log(`\n  ── بلا فلتر ──`);
  console.log(`    حمولات=${S.loads} · سوّاق=${S.driverCount} · الإجمالي=${m(S.total)} · مسدَّد=${m(S.paid)} · غير مسدَّد=${m(S.unpaid)} · جُمَع=${S.fridays}`);
  console.log(`    صفوف مُحمَّلة=${all.body.rows.length}${all.body.capped ? ' (بلغت السقف)' : ''}`);

  const r0 = all.body.rows[0];
  if (r0) {
    console.log(`\n  ── أوّلُ صفّ: كلُّ عمودٍ طلبه المستخدم ──`);
    const cols = [
      ['رقم الكشف', r0.waybillNumber], ['رقم السيارة', r0.vehiclePlate],
      ['تاريخ بداية الحمولة', r0.loadDate ? new Date(r0.loadDate).toISOString().slice(0,10) : '—'],
      ['مصروف السائق الفعلي', m(r0.driverExpense)],
      ['السائق', r0.driverName], ['السائق الثاني', r0.secondDriverName || '(لا يوجد)'],
      ['إيبان السائق', r0.driverIban || '(غير مسجَّل في ملفّه)'],
      ['بونص الجمعة', r0.fridayBonus ? 'نعم' : 'لا'],
      ['حالة الدفع', r0.driverExpensePaid ? 'تم السداد' : 'لم يتم السداد'],
    ];
    for (const [k, v] of cols) console.log(`    ${String(k).padEnd(22)} ${v}`);
  }

  // الإيبان: كم سائقًا مسجَّلٌ إيبانُه
  const drivers = await FleetDriver.countDocuments({ isActive: { $ne: false } });
  const withIban = await FleetDriver.countDocuments({ isActive: { $ne: false }, iban: { $nin: ['', null] } });
  console.log(`\n  الإيبان في ملفّات السوّاق: ${withIban} من ${drivers} ${withIban ? '' : '← يُملأ من صفحة السوّاق'}`);

  console.log(`\n  ── الفلاتر ──`);
  const month = new Date().toISOString().slice(0, 7);
  for (const [lbl, q] of [
    ['شهر ' + month, { month }],
    ['مدى 2026-08-01→2026-08-31', { from: '2026-08-01', to: '2026-08-31' }],
    ['غير المسدَّد فقط', { paid: '0' }],
    ['المسدَّد فقط', { paid: '1' }],
  ]) {
    const r = await call(fleet.getDriverExpenses, { query: q });
    console.log(`    ${lbl.padEnd(28)} حمولات=${String(r.body.summary.loads).padStart(5)} · الإجمالي=${m(r.body.summary.total).padStart(12)}`);
  }

  // ── تعليمُ السداد ثمّ رفعُه ────────────────────────────────────────────
  const target = await FleetShipment.findOne({ driverExpense: { $gt: 0 }, driverExpensePaid: { $ne: true } }).lean();
  if (target) {
    console.log(`\n  ── تعليمُ السداد (كشف ${target.waybillNumber}) ──`);
    const on = await call(fleet.setDriverExpensePaid, { body: { ids: [String(target._id)], paid: true } });
    const after = await FleetShipment.findById(target._id).select('driverExpensePaid driverExpensePaidByName driverExpensePaidAt').lean();
    console.log(`    تعليم → ${on.code} · مسدَّد=${after.driverExpensePaid} · بواسطة=${after.driverExpensePaidByName || '—'} ${after.driverExpensePaid ? '✓' : '✗'}`);
    const unpaidNow = await call(fleet.getDriverExpenses, { query: { paid: '0' } });
    console.log(`    اختفى من فلتر «غير المسدَّد»؟ ${!(unpaidNow.body.rows || []).some((x) => String(x._id) === String(target._id)) ? 'نعم ✓' : 'لا ✗'}`);
    const off = await call(fleet.setDriverExpensePaid, { body: { ids: [String(target._id)], paid: false } });
    const back = await FleetShipment.findById(target._id).select('driverExpensePaid driverExpensePaidByName').lean();
    console.log(`    رفع → ${off.code} · مسدَّد=${back.driverExpensePaid} · أثرُ المُسدِّد مُحي=${back.driverExpensePaidByName === '' ? 'نعم ✓' : 'لا ✗'}`);
  }

  const t0 = Date.now(); await call(fleet.getDriverExpenses, {}); 
  console.log(`\n  زمنُ النداء بلا فلتر: ${Date.now() - t0} ms\n`);
  await mongoose.disconnect();
})();
