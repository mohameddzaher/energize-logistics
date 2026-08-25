/**
 * Ls2TireAsset — فردة كاوتش: one physical tire tracked by its SERIAL for life.
 * Where it is mounted right now (which flatbed, which of the 14 positions, which
 * section: الرأس / المحور الخلفي للرأس / التيدر / الاستبن) lives here; every
 * mount/removal/transfer is an Ls2AssetEvent. `sensor` is what the workshop
 * registered (يوجد/لايوجد) — the sensor-check endpoint compares it against what
 * the live Wialon feed actually reports.
 *
 * NOT the live pressure/temperature readings — those stay on Ls2Vehicle.tires.
 */
const mongoose = require('mongoose');

const ls2TireAssetSchema = new mongoose.Schema({
  tireNumber: { type: String, default: '' },          // workshop tag number (may repeat)
  serial: { type: String, required: true, unique: true, trim: true },
  type: { type: String, default: '' },                // Michelin / Bridgestone / Conti / China
  size: { type: String, default: '' },                // e.g. 315/80 R22.5
  sensor: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  // The tire's LIFECYCLE, exactly as the workshop runs it:
  //   spare(new)        ← purchases register a fresh tire
  //   mounted           ← installed; installing where another tire sits FORCES
  //                       declaring where the displaced one goes (in ⇒ out)
  //   in_repair         ← في المصنع: نزلت من العربية وراحت مصنع التجديد — مش
  //                       مخزون متاح؛ عدّها ضمن الرف هو اللي بيخلي المخزن
  //                       يوعد بفردة مش قادر يسلّمها. الدرجة بتبقى at_factory
  //                       معاها عشان شاشة المخزن تعرض الخانة من غير ما تقرأ
  //                       الحالة والدرجة من مصدرين مختلفين
  //   spare             ← renewal succeeded: عادت من المصنع صالحة، ترجع الرف
  //                       كأي فردة مستعملة — تُركَّب في أي موضع، رأس أو تيدر
  //   scrap             ← سكراب: renewal failed; unusable, kept in store to sell
  //   damaged           ← تالف: blew out / worn beyond existence; terminal
  //   retired           ← legacy value from before scrap/damaged were separated
  status: { type: String, enum: ['mounted', 'spare', 'in_repair', 'scrap', 'damaged', 'retired', 'sold'], default: 'mounted', index: true },
  // درجة الفردة، مستقلة عن مكانها:
  //   new         جديدة من الشراء
  //   used        مستعملة — وتشمل المجدَّدة. كانت «مجدد» درجة مستقلة، والورشة
  //               بتتعامل مع الاتنين نفس المعاملة على الرف: نفس الرفّ ونفس
  //               مواضع التركيب. فصلهم كان بيقسم مخزون واحد على خانتين، وكان
  //               بيغذّي قاعدة «المجدد للتيدر بس» اللي الورشة بتخالفها فعليًا
  //               (بتركّبه في الأربعة اللي ورا الرأس). دمجهم يخلي كل صفّ
  //               وصفه صحيح: المجدَّدة مستعملة فعلًا، والعكس مش صحيح.
  //   at_factory  في المصنع — الفردة برّه عند مصنع التجديد دلوقتي، مش على الرف
  //               ولا على عربية. لازم تكون درجة عشان المخزن يعدّها خانة لوحدها
  //               من غير ما تتحسب مخزون متاح.
  condition: { type: String, enum: ['new', 'used', 'at_factory'], default: 'used' },
  // كام في المية — recorded when a tire goes back to the shelf so the workshop
  // can pick the right tire for the right slot later (تسكين). Null = never rated.
  conditionPercent: { type: Number, min: 0, max: 100, default: null },
  // Current mount (null while spare/retired)
  plate: { type: String, default: null },
  plateKey: { type: String, default: null, index: true },
  positionNumber: { type: Number, default: null },    // 1..14
  positionLabel: { type: String, default: '' },       // "اطار 3 خارجي يمين"
  section: { type: String, default: '' },             // الرأس / المحور الخلفي للرأس / التيدر / الاستبن
  // أي تيدر الفردة دي عليه — لإطارات قسم التيدر بس.
  //
  // الفردة اللي على التيدر بتمشي مع **التيدر**، مش مع العربية. من غير الحقل ده
  // كانت متخزّنة بلوحة العربية وبس، فأول ما التيدر ينتقل لعربية تانية كاوتشه
  // يفضل مسجّل على العربية القديمة: القديمة تبقى ١٤ إطار وفيهم ٦ مش عليها،
  // والجديدة ٨ — والاتنين غلط ومحدش واخد باله. ٣٤٢ إطار كانوا كده.
  //
  // ولما التيدر يبقى واقف لوحده (مش مركّب على عربية)، الفردة تفضل `mounted`
  // ومعاها رقم التيدر و plate فاضية — هي فعلًا مركّبة، بس على حاجة مش مجرورة.
  trailerNumber: { type: String, default: null, index: true },
  // Is this mounted tire serving as the truck's SPARE (الاستبن)? A first-class
  // flag (not just text) so the workshop can see at a glance which tire is the
  // spare — surfaced everywhere. Cleared automatically when the tire leaves a truck.
  isSpare: { type: Boolean, default: false, index: true },
  notes: { type: String, default: '' },
}, { timestamps: true });

ls2TireAssetSchema.index({ plateKey: 1, positionNumber: 1 });

// `isSpare` and `section` must never disagree: the section text comes from the
// workshop sheet, the flag is what every screen filters and counts on. They
// drifted once — 47 tires sat in section «الاستبن» with the flag unset, so a
// vehicle whose real layout is 6 head / 6 trailer / 2 spare rendered as
// «رأس ٧ · استبن ١». Deriving the flag here means no caller can reintroduce it:
// mount, swap, import and manual edit all go through save().
//
// Only a MOUNTED tire can be the spare — a tire on the shelf is not «الاستبن»
// of anything, it is stock.
ls2TireAssetSchema.pre('save', function deriveIsSpare(next) {
  this.isSpare = this.status === 'mounted' && /استبن/.test(String(this.section || ''));
  next();
});

module.exports = mongoose.models.Ls2TireAsset || mongoose.model('Ls2TireAsset', ls2TireAssetSchema);
