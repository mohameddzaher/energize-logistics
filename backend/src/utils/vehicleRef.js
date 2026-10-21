/**
 * vehicleRef — أيُّ مركبةٍ في سجلّ المركبات هذه؟ من أيّ قسمٍ جاء السؤال.
 *
 * المركبةُ سجلٌّ واحد (VehicleMaster)، وكلُّ قسمٍ يحمل إليه مرجعًا لا نسخة
 * (صاحبُ الشركة، ٢٠٢٦/١٠/٢١: «المركبة مرتبطة بحاجتها في أي قسم مهما كانت،
 * وحتى لو أضفت قسمًا جديدًا»). وهذا بابُ الربط الواحد: لوحةٌ عربيّةٌ أو
 * لاتينيّة ← معرّفُ المركبة، بالمفتاح الموحَّد (utils/plateKey canonicalPlateKey).
 *
 * قسمٌ جديد: يخزّن `vehicleMaster: ObjectId` ويحلّه من هنا عند الإنشاء، ويقرأ
 * الهويّةَ والمستندات من السجلّ، ويسمع `vreg:updated`.
 */
const { canonicalPlateKey } = require('./plateKey');

/** معرّفُ المركبة في السجلّ للّوحة، أو null. يُرجع المستندَ إن طُلبت حقول. */
async function resolve(plate, select = '_id') {
  const key = canonicalPlateKey(plate);
  if (!key) return null;
  const { VehicleMaster } = require('../models/VehicleMaster');
  return VehicleMaster.findOne({ canonKey: key }).select(select).lean();
}

/** حلٌّ دفعةً واحدة: Map من المفتاح الموحَّد إلى المركبة. */
async function resolveMany(plates, select = '_id plateNumber canonKey') {
  const keys = [...new Set((plates || []).map(canonicalPlateKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const { VehicleMaster } = require('../models/VehicleMaster');
  const rows = await VehicleMaster.find({ canonKey: { $in: keys } }).select(select).lean();
  return new Map(rows.map((r) => [r.canonKey, r]));
}

module.exports = { resolve, resolveMany, canonicalPlateKey };
