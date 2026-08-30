/**
 * تثبيتُ شحنات المنصّة في قسم طلبات الشحنات.
 *
 * ── لماذا تُثبَّت ولا تُقرأ ─────────────────────────────────────────────────
 * قسمُ «منصّة الأوبريشن» يقرأ من نظامٍ خارجيّ لحظةً بلحظة: إن انقطع انقطع
 * القسم، ولا تُحلَّل بياناتُه ولا تُفلتَر إلّا بما يسمح به. وقسمُ طلبات الشحنات
 * نظامُنا: يُحلِّل ويُفلتِر ويُصدِّر ويطبع البوليصة. فالشحنةُ تُنسخ إليه ساعةَ
 * تُنشأ هناك، فيبقى نظامُنا كاملًا حتى لو توقّفت المنصّة.
 *
 * ── ورقمُ كشف التخريج يبقى رقمَهم ──────────────────────────────────────────
 * لا يُعاد ترقيمُ المنقول: يبقى رقمُ كشف التخريج كما هو فيكمل الفريقُ عليه حين
 * ينتقل. وشحناتُنا يسبقها حرفٌ («E-500») فلا يلتبس رقمٌ برقم.
 *
 * ويُستدعى من `opsPoll` كلَّ دورة — كلُّ ما وصل من المنصّة يُثبَّت عندنا فورًا.
 */
const n = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
// المنصّةُ تكتب الاسمَ بشكلين: `{ar,en}` مباشرةً، و`{name:{ar,en}}` للمراجع
// (النوع، الفرع، الحمولة). قراءةُ الشكل الأوّل وحدَه كانت تُفرغ كلَّ عمودٍ
// مرجعيّ — وهي أعمدةٌ تُفلتَر وتُجمَّع بها التحليلات.
const label = (v) => {
  if (!v) return '';
  if (typeof v !== 'object') return n(v);
  const t = v.name && typeof v.name === 'object' ? v.name : v;
  return n(t.ar) || n(t.en) || n(v.name);
};

const STATUS = {
  requesting: 'requesting', loading: 'loading', uploaded: 'uploaded', on_way: 'on_way',
  arrived: 'arrived', bond_sent: 'bond_sent', bond_received: 'bond_received',
  late: 'late', invoiced: 'invoiced', cancelled: 'cancelled', canceled: 'cancelled',
};

/** صفُّ المنصّة → مستندُ قسمنا. */
function mapShipment(x) {
  const car = x.car || {};
  const owner = car.owner || {};
  const user = x.user || {};
  return {
    externalId: n(x.id),
    source: 'platform',
    graduationNumber: num(x.graduation_statement_num),
    reference: n(x.graduation_statement_num),
    fromCity: label(x.address_from),
    toCity: label(x.address_to),
    quantity: num(x.qty),
    customerName: n(user.name),
    // ── اسمُ السائق ورقمُه ────────────────────────────────────────────────
    // صفُّ السائق في المنصّة لا يحمل `name`: يحمل جنسيّتَه ورقمَ إقامته
    // و`company_name` — وهو الاسمُ المعروض. ورقمُه في حساب المستخدم المرتبط
    // به إن وُجد، وإلّا فهو بلا رقمٍ ولا يُخترَع له واحد.
    driverName: n(x.driver && (x.driver.company_name || x.driver.sponsor_name))
      || n(x.driver && x.driver.user && x.driver.user.name)
      || n(x.driver && x.driver.admin && x.driver.admin.name),
    driverPhone: n(x.driver && x.driver.user && x.driver.user.phone)
      || n(x.driver && x.driver.admin && x.driver.admin.phone),
    vehicleName: label(car.name) || n(car.plate_number),
    vehiclePlate: n(car.plate_number) || n(car.car_number),
    // المورّدُ في هذا النموذج ليس حقلًا: هو مالكُ الشاحنة — الشركةُ التي
    // نشتري منها النقلة، بسجلّها التجاريّ وشروط سدادها.
    supplierName: n(owner.owner_name),
    // المندوبُ هو `delegate`، لا `reference_num`. الأخيرُ رقمُ مرجعٍ عندهم،
    // وكان يُكتب في خانة الاسم فيُقرأ «١٢٣٤» مندوبًا.
    agentName: n(x.delegate && x.delegate.name),
    externalRef: n(x.reference_num),
    // ── ما كانت التحليلاتُ تجمّع به ولا يُنقَل ──────────────────────────────
    // النوعُ والفرعُ والحمولةُ والطول: أعمدةٌ تُفلتَر وتُجمَّع في صفحاتنا، وكانت
    // فارغةً في كلّ صفٍّ منقول لأنّها ببساطة لم تُقرأ من الحمولة.
    truckType: label(x.truck_type),
    truckLength: label(x.truck_size),
    cargoType: label(x.load_type),
    branch: label(x.branch),
    addressFrom: label(x.address_from),
    addressTo: label(x.address_to),
    pickupTime: date(x.pick_time),
    startTime: date(x.starting_time),
    arrivalTime: date(x.access_time),
    sellPrice: num(x.selling_price),
    buyPrice: num(x.purchase_price),
    driverRentType: n(x.driver_rental_type),
    driverRentPrice: num(x.driver_rental_price),
    paymentMethod: n(x.payment_method),
    status: STATUS[n(x.status)] || 'requesting',
    notes: n(x.notes),
  };
}

/**
 * يثبّت دفعةً من شحنات المنصّة. لا يلمس شحناتِنا أبدًا — المطابقةُ بمعرّف
 * المنصّة، وشحناتُنا لا معرّفَ خارجيًّا لها.
 */
async function upsertPlatformShipments(items) {
  if (!Array.isArray(items) || !items.length) return { created: 0, updated: 0 };
  const ShipmentOrder = require('../models/ShipmentOrder');
  const mapped = items.map(mapShipment).filter((m) => m.externalId);
  if (!mapped.length) return { created: 0, updated: 0 };

  const ids = mapped.map((m) => m.externalId);
  const have = new Set(
    (await ShipmentOrder.find({ externalId: { $in: ids } }).select('externalId').lean())
      .map((d) => String(d.externalId)),
  );

  const ops = mapped.map((m) => ({
    updateOne: {
      filter: { externalId: m.externalId },
      // `$setOnInsert` على createdAt وحدَه: الشحنةُ المنقولة تحتفظ بتاريخ
      // إنشائها عندهم، ولا يُعاد كتابتُه في كلّ مزامنة فتبدو جديدةً كلَّ مرّة.
      update: { $set: m, $setOnInsert: { createdAt: new Date() } },
      upsert: true,
    },
  }));
  const r = await ShipmentOrder.bulkWrite(ops, { ordered: false });
  return {
    created: r.upsertedCount || 0,
    updated: (r.modifiedCount || 0),
    seen: mapped.length,
    known: have.size,
  };
}

module.exports = { upsertPlatformShipments, mapShipment };
