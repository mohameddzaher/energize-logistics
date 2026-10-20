/**
 * revertLtAutoRelease — يعيد ما فعله الإصدارُ السابق من utils/ltVehicleRelease
 * (٢٠٢٦/١٠/٢٠): أنزل المركبةَ عن ١٤ منتهي الخدمة وأغلق أوامرَهم، وأسند «ل أ 4566»
 * إلى مفوَّضها. والقاعدةُ صارت: لا إنزال بل تعليقٌ وتنبيه، والقائدُ الفعليُّ لا
 * يُشتقّ من التفويض. فيُعاد كلُّ مندوبٍ إلى مركبته وأمرُه (معلَّقًا)، ويُرفَع
 * الإسنادُ الآليّ.
 *
 *   node src/scripts/revertLtAutoRelease.js           يقول ولا يكتب
 *   node src/scripts/revertLtAutoRelease.js --apply   ينفّذ
 */
require('dotenv').config();
const mongoose = require('mongoose');
const APPLY = process.argv.includes('--apply');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  require('../models/Employee');
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const AUTO_ORDER_REASON = 'انتهت خدمةُ الموظّف — أُنزلت المركبة تلقائيًّا';
  const touched = await LightTransportEmployee.find({ 'history.note': { $in: ['إنزالٌ تلقائيّ — انتهت خدمتُه', 'إسنادٌ تلقائيّ — هو المفوَّضُ على المركبة'] } });
  for (const l of touched) {
    const released = [...l.history].reverse().find((h) => h.note === 'إنزالٌ تلقائيّ — انتهت خدمتُه');
    const assigned = [...l.history].reverse().find((h) => h.note === 'إسنادٌ تلقائيّ — هو المفوَّضُ على المركبة');
    if (assigned && S(l.vehiclePlate) === S(assigned.toValue)) {
      console.log(`↩︎ يُرفَع الإسناد: ${l.name} عن ${l.vehiclePlate}`);
      if (APPLY) {
        l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: l.vehiclePlate, toValue: '', note: 'تراجعٌ عن إسنادٍ آليّ — القائدُ الفعليّ لا يُشتقّ من التفويض' });
        l.vehicle = null; l.vehiclePlate = '';
        await l.save();
      }
      continue;
    }
    if (released && !l.vehicle) {
      const v = await VehicleMaster.findOne({ plateNumber: released.fromValue }).select('_id plateNumber').lean();
      if (!v) { console.log(`؟ لم تُوجد المركبة ${released.fromValue} لـ${l.name}`); continue; }
      const taken = await LightTransportEmployee.findOne({ vehicle: v._id, _id: { $ne: l._id } }).select('name').lean();
      if (taken) { console.log(`⚠︎ ${released.fromValue} صارت مع ${taken.name} — لا تُعاد لـ${l.name}`); continue; }
      console.log(`↩︎ تُعاد ${released.fromValue} إلى ${l.name} (أمرُه معلَّق)`);
      if (APPLY) {
        l.vehicle = v._id; l.vehiclePlate = v.plateNumber;
        l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: '', toValue: v.plateNumber, note: 'تراجعٌ عن إنزالٍ آليّ — المركبةُ معه حتى تُستلم' });
        await l.save();
        await LightTransportOrder.updateMany({ ltEmployee: l._id, status: 'ended', endReasonAr: AUTO_ORDER_REASON },
          { $set: { status: 'active', endDate: null, endReasonAr: '' } });
      }
    }
  }
  if (APPLY) {
    // ثمّ القاعدةُ الجديدة: التعليقُ والتنبيه.
    const r = await require('../utils/ltVehicleRelease').run();
    console.log(`عُلِّق: ${r.held.length}`);
  } else console.log('\nللتنفيذ: --apply');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
function S(v) { return String(v ?? '').trim(); }
