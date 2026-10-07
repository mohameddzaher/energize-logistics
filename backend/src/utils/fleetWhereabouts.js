/**
 * أين هذه الشاحنةُ الآن، وإلى أين هي ذاهبة؟
 *
 * ── لماذا يحتاجها قسمٌ آخر ─────────────────────────────────────────────────
 * صفحةُ الصيانة في «لوكيشن سوليوشن» تقول إنّ صيانةَ شاحنةٍ تأخّرت أو قرُبت،
 * ثمّ تسكت عن السؤال الذي يليه في ذهن مسؤول الصيانة فورًا: **وأين هي؟** فإن
 * كانت في الطريق إلى الدمام فلا موعدَ لها اليوم، وإن كانت فرّغت ووصلت الرياض
 * فتُسحَب الآن قبل أن تُحمَّل من جديد. وبلا هذا العمود يُفتَح قسمُ إدارة
 * الأسطول في نافذةٍ ثانية ويُبحَث عن اللوحة واحدةً واحدة.
 *
 * ── والمصدرُ واحدٌ لا يُنسَخ ────────────────────────────────────────────────
 * الحقيقةُ في `FleetShipment`: حالةُ الحمولة وفروعُها ومدينتُها وآخرُ تواصلٍ
 * مع السائق والوصولُ المتوقّع. فلا يُخزَّن شيءٌ من ذلك في مرآة Wialon — يُقرأ
 * عند الطلب ويُجمَع على مفتاح اللوحة (`utils/plateKey`)، وهو نفسُ المفتاح الذي
 * يجمع عليه مخزنُ الورشة وسجلُّ الأصول (راجع ذلك الملفّ).
 *
 * والحالةُ تُترجَم إلى موضعٍ يُقرأ: «تُحمَّل في جدة» لا `loading`.
 */
const { plateKey } = require('./plateKey');

// الحمولةُ الحيّة: ما لم يُفوتَر ولم يُلغَ. والسندُ المُرسَل/المستلَم يعني أنّها
// فرّغت ووصلت — وهي حالةٌ تهمّ الصيانةَ أكثرَ من غيرها: الشاحنةُ فارغةٌ الآن.
const LIVE_STATUSES = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'late', 'bond_sent', 'bond_received'];

/**
 * موضعُ الشاحنة كما يُقرأ، مشتقًّا من حالة الحمولة.
 * `where` نصٌّ للعرض، و`phase` مفتاحٌ تُلوّن به الواجهةُ وتفلتر.
 */
const placeOf = (trip) => {
  const from = trip.fromCity || '';
  const to = trip.toCity || '';
  switch (trip.status) {
    case 'requesting':
      return { phase: 'preparing', ar: from ? `تُجهَّز في ${from}` : 'تُجهَّز', en: from ? `Preparing in ${from}` : 'Preparing' };
    case 'loading':
    case 'uploaded':
      return { phase: 'loading', ar: from ? `تُحمَّل في ${from}` : 'تُحمَّل', en: from ? `Loading in ${from}` : 'Loading' };
    case 'on_way':
      return { phase: 'moving', ar: to ? `في الطريق إلى ${to}` : 'في الطريق', en: to ? `On the way to ${to}` : 'On the way' };
    case 'late':
      return { phase: 'late', ar: to ? `متأخّرة — إلى ${to}` : 'متأخّرة', en: to ? `Late — to ${to}` : 'Late' };
    case 'arrived':
      return { phase: 'arrived', ar: to ? `وصلت ${to}` : 'وصلت', en: to ? `Arrived ${to}` : 'Arrived' };
    case 'bond_sent':
    case 'bond_received':
      return { phase: 'unloaded', ar: to ? `فرّغت في ${to}` : 'فرّغت', en: to ? `Unloaded in ${to}` : 'Unloaded' };
    default:
      return { phase: 'unknown', ar: 'غير معروف', en: 'Unknown' };
  }
};

/**
 * خريطةُ مفتاحِ اللوحة ← أحدثِ حمولةٍ حيّةٍ عليها.
 * شاحنةٌ لها حمولتان حيّتان (يحدث حين يُنسى إقفالُ السابقة) تُقرأ بأحدثهما،
 * ويُقال عددُ الأخريات كي لا يُخفى التعارض.
 */
const liveTripsByPlateKey = async () => {
  const FleetShipment = require('../models/FleetModels').FleetShipment;
  const trips = await FleetShipment.find({ status: { $in: LIVE_STATUSES } })
    .select('waybillNumber vehiclePlate driverName customerName fromCity toCity status loadDate lastContactAt expectedArrival')
    .sort({ loadDate: -1, createdAt: -1 })
    .lean();
  const map = new Map();
  for (const t of trips) {
    const k = plateKey(t.vehiclePlate);
    if (!k) continue;
    const prev = map.get(k);
    if (prev) { prev.others = (prev.others || 0) + 1; continue; }
    const place = placeOf(t);
    map.set(k, {
      waybillNumber: t.waybillNumber || null,
      status: t.status,
      phase: place.phase,
      whereAr: place.ar,
      whereEn: place.en,
      fromCity: t.fromCity || '',
      toCity: t.toCity || '',
      customerName: t.customerName || '',
      driverName: t.driverName || '',
      loadDate: t.loadDate || null,
      lastContactAt: t.lastContactAt || null,
      expectedArrival: t.expectedArrival || null,
      others: 0,
    });
  }
  return map;
};

/** حمولةٌ فارغة — تُستعمل لمن لا حمولةَ له، فتقرأ الواجهةُ شكلًا واحدًا. */
const IDLE = { status: 'idle', phase: 'idle', whereAr: 'في الفراغ — بلا حمولة', whereEn: 'Idle — no load' };

module.exports = { liveTripsByPlateKey, placeOf, LIVE_STATUSES, IDLE };
