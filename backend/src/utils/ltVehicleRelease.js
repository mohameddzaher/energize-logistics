/**
 * مركباتُ النقل الخفيف تتبع الناسَ لا العكس — قاعدتان (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠):
 *
 *  ① مَن انتهت خدمتُه لا يبقى راكبًا: تُنزَل عنه المركبةُ ويُغلَق أمرُ تشغيله.
 *     كان «DIPOK» منتهيَ الخدمة وما زال على الدبّاب «ل أ 4566» بأمرٍ سارٍ، والتفويضُ
 *     باسم غيره — فقرأت شاشةُ الموظّفين اسمًا وتفقّدُ بداية اليوم اسمًا آخر.
 *     والتفويضُ (ورقةٌ رسميّة) لا يُمسّ هنا: رفعُه فعلٌ في قسم المركبات.
 *
 *  ② مركبةٌ بلا راكبٍ ومفوَّضُها موظّفٌ في القسم بلا مركبة: تُسنَد إليه. فيظهر في
 *     قائمة المناديب على المركبة التي يقرؤها التفقّدُ باسمه.
 *
 * وما سوى ذلك (راكبٌ غيرُ المفوَّض، أو مفوَّضٌ على مركبتين) لا يُحسم آليًّا —
 * يبقى في كارت «تفويض باسم غير الراكب» ليُقرَّر فيه.
 *
 * `run({ dry })` يُنادى بعد كلّ إنهاء خدمة، وكلَّ ساعةٍ احتياطًا.
 */
const S = (v) => String(v ?? '').trim();
const idKey = (v) => S(v).replace(/\s+/g, '');

async function run({ dry = false, byName = 'النظام' } = {}) {
  require('../models/Employee');
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const lts = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .populate('employee', 'employmentStatus');
  const ended = (l) => (l.employee && typeof l.employee === 'object'
    ? l.employee.employmentStatus === 'terminated'
    : /انهاء|إنهاء/.test(S(l.workStatusAr)));
  const out = { released: [], assigned: [] };

  // ① المنتهون الراكبون
  for (const l of lts) {
    if (!l.vehicle || !ended(l)) continue;
    out.released.push({ name: l.name, plate: l.vehiclePlate });
    if (dry) continue;
    const orders = await LightTransportOrder.find({ ltEmployee: l._id, status: 'active' });
    for (const o of orders) {
      o.status = 'ended'; o.endDate = new Date(); o.endReasonAr = 'انتهت خدمةُ الموظّف — أُنزلت المركبة تلقائيًّا';
      await o.save();
    }
    l.history.push({ kind: 'vehicle', byName, fromValue: S(l.vehiclePlate), toValue: '', note: 'إنزالٌ تلقائيّ — انتهت خدمتُه' });
    l.vehicle = null; l.vehiclePlate = '';
    await l.save();
  }

  // ② مركبةٌ بلا راكبٍ ومفوَّضُها في القسم بلا مركبة
  const riding = new Set(lts.filter((l) => l.vehicle && !(dry && ended(l))).map((l) => String(l.vehicle?._id || l.vehicle)));
  const byIq = new Map(lts.filter((l) => !ended(l)).map((l) => [idKey(l.idNumber), l]));
  const vs = await VehicleMaster.find({ sectorAr: 'النقل الخفيف', isActive: { $ne: false }, 'authorizedPerson.iqamaNumber': { $nin: ['', null] } })
    .select('plateNumber authorizedPerson').lean();
  // مَن فُوِّض على أكثر من مركبةٍ بلا راكب لا يُسنَد إليه شيءٌ آليًّا — يُختار يدويًّا.
  const candidates = new Map();
  for (const v of vs) {
    if (riding.has(String(v._id))) continue;
    const l = byIq.get(idKey(v.authorizedPerson.iqamaNumber));
    if (!l || l.vehicle) continue;
    const k = String(l._id);
    (candidates.get(k) || candidates.set(k, { l, vs: [] }).get(k)).vs.push(v);
  }
  for (const { l, vs: list } of candidates.values()) {
    if (list.length !== 1) continue;
    const v = list[0];
    out.assigned.push({ name: l.name, plate: v.plateNumber });
    if (dry) continue;
    l.history.push({ kind: 'vehicle', byName, fromValue: '', toValue: S(v.plateNumber), note: 'إسنادٌ تلقائيّ — هو المفوَّضُ على المركبة' });
    l.vehicle = v._id; l.vehiclePlate = S(v.plateNumber);
    await l.save();
  }

  if (!dry && (out.released.length || out.assigned.length)) {
    const cache = require('./ttlCache');
    cache.clear('lt:'); cache.clear('vreg:');
    try {
      const { emitToAll } = require('../websocket/socketManager');
      emitToAll('lt:updated', {}); emitToAll('vreg:updated', {});
    } catch (_) { /* */ }
  }
  return out;
}

/** بعد إنهاء خدمةٍ أو تغيير حالة — لا يُنتظَر ولا يُفشِل الطلبَ الذي ناداه. */
const after = () => { run().catch((e) => console.error('[lt-release]', e.message)); };

function startHourly() {
  setTimeout(after, 60 * 1000);
  setInterval(after, 60 * 60 * 1000).unref();
}

module.exports = { run, after, startHourly };
