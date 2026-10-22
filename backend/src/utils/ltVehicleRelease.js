/**
 * مركبةٌ مع مَن انتهت خدمتُه — تُعلَّق ويُنبَّه عليها، ولا تُلغى (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠).
 *
 * كان «DIPOK» منتهيَ الخدمة وما زال على الدبّاب «ل أ 4566» بأمرٍ سارٍ. والقرارُ
 * فيه للقسم لا للنظام: يستلم المركبةَ منه أو يسلّمها لغيره بأمر تشغيل. فالنظامُ:
 *   · يُبقي المركبةَ معه (هو القائدُ الفعليّ حتى تُستلم منه)،
 *   · يجعل أمرَ تشغيله «معلَّقًا» (`hold`) لا ساريًا ولا مُغلقًا،
 *   · ويُنبّه قسمَ B2C مرّةً واحدة ليُتَّخذ الإجراء.
 * ومَن عاد إلى العمل يُرفَع تعليقُه ويعود أمرُه ساريًا.
 *
 * والتفويضُ لا يقرّر هنا شيئًا: المركبةُ قد تكون مفوَّضةً لمندوبٍ ويقودها غيرُه،
 * والمعتبَر هو القائدُ الفعليّ.
 *
 * `run()` يُنادى بعد كلّ إنهاء خدمة أو تعديلٍ في السجلّ، وكلَّ ساعةٍ احتياطًا.
 */
const S = (v) => String(v ?? '').trim();
const HOLD_REASON = 'انتهت خدمتُه والمركبةُ ما زالت معه — بانتظار استلامها أو تسليمها لغيره';

async function run({ dry = false } = {}) {
  require('../models/Employee');
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const lts = await LightTransportEmployee.find({ isActive: { $ne: false }, vehicle: { $ne: null } })
    .populate('employee', 'employmentStatus');
  const ended = (l) => (l.employee && typeof l.employee === 'object'
    ? l.employee.employmentStatus === 'terminated'
    : /انهاء|إنهاء/.test(S(l.workStatusAr)));
  const out = { held: [], released: [] };

  for (const l of lts) {
    const onHold = !!l.vehicleHold?.at;
    if (ended(l) && !onHold) {
      out.held.push({ name: l.name, plate: l.vehiclePlate });
      if (dry) continue;
      l.vehicleHold = { at: new Date(), reason: HOLD_REASON };
      l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: S(l.vehiclePlate), toValue: S(l.vehiclePlate), note: `تعليق — ${HOLD_REASON}` });
      await l.save();
      await LightTransportOrder.updateMany({ ltEmployee: l._id, status: 'active' }, { $set: { status: 'hold' } });
      try {
        await require('../services/notificationService').notifySection('B2C', {
          type: 'system_alert',
          title: `مركبةٌ مع منتهي الخدمة: ${S(l.vehiclePlate)}`,
          message: `${l.name} — انتهت خدمتُه والمركبة ${S(l.vehiclePlate)} ما زالت معه. أمرُ تشغيله معلَّق: استلم المركبة منه أو سلّمها لغيره بأمر تشغيل.`,
          relatedEntity: 'LightTransportEmployee', relatedEntityId: l._id,
        });
      } catch (_) { /* التنبيهُ لا يُسقط التعليق */ }
    } else if (!ended(l) && onHold) {
      out.released.push({ name: l.name, plate: l.vehiclePlate });
      if (dry) continue;
      l.vehicleHold = { at: null, reason: '' };
      l.history.push({ kind: 'vehicle', byName: 'النظام', fromValue: S(l.vehiclePlate), toValue: S(l.vehiclePlate), note: 'رُفع التعليق — عاد إلى العمل' });
      await l.save();
      await LightTransportOrder.updateMany({ ltEmployee: l._id, status: 'hold' }, { $set: { status: 'active' } });
    }
  }
  // مَن نزل عن المركبة وهو معلَّق: لا تعليقَ بلا مركبة.
  if (!dry) {
    await LightTransportEmployee.updateMany({ vehicle: null, 'vehicleHold.at': { $ne: null } }, { $set: { 'vehicleHold.at': null, 'vehicleHold.reason': '' } });
  }

  if (!dry && (out.held.length || out.released.length)) {
    require('./vehicleAnnounce').announceVehicles({});
  }
  return out;
}

const after = () => { run().catch((e) => console.error('[lt-hold]', e.message)); };

function startHourly() {
  setTimeout(after, 60 * 1000);
  setInterval(after, 60 * 60 * 1000).unref();
}

module.exports = { run, after, startHourly, HOLD_REASON };
