/**
 * ls2FleetRegister — كلُّ شاحنةٍ في لوكيشن سوليوشن لها سطحةٌ في سجلّ الأصول.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * صفحةُ «السطحات والكاوتشات» تعرض سجلَّ السطحات (`Ls2Flatbed`)، وكان يُملأ
 * باليد أو بالاستيراد. فشاحنةٌ تُضاف في لوكيشن سوليوشن تظهر في التتبّع خلال
 * ثوانٍ وتبقى غائبةً عن الأصول — لا موضعَ تُركَّب عليه فردة، ولا يُنقَل إليها
 * تيدر («مفيش سطحة باللوحة»). وقع مع 3965 DEA و3966 DEA (٢٠٢٦/١٠/١٨).
 *
 * فتُنشأ السطحةُ من الشاشة الحيّة نفسِها: لوحتُها ومفتاحُها (`vehiclePlateKey`،
 * المفتاحُ الذي يقرأ به سجلُّ الأصول الشاحنةَ الحيّة) والترقيمُ التالي والماركة.
 * ومواضعُ الكاوتش الأربعةَ عشرَ قياسيّةٌ في الصفحة فتظهر فارغةً تنتظر الورشة.
 *
 * ── وما لا يُنشأ: الفِرَد ─────────────────────────────────────────────────
 * الفردةُ أصلٌ برقمٍ تسلسليٍّ محفورٍ عليها، ولوكيشن سوليوشن لا تعرفه — حسّاسُ
 * الضغط يقول «الموضع ٣ ضغطُه كذا» لا «الفردة 6156868893». فصنعُ فِرَدٍ بأرقامٍ
 * مخترعة يملأ السجلَّ بأصولٍ لا وجودَ لها. تُسجَّل من الورشة كما تُسجَّل كلُّ فردة.
 *
 * يُنادى من المستطلِع (عند مزامنة الهويّة) ومن نظرة الصفحة العامّة. ولا يكتب
 * شيئًا إن لم يكن جديد؛ وسباقُ عاملين على الشاحنة نفسِها يحسمه الفهرسُ الفريد.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const Ls2AssetEvent = require('../models/Ls2AssetEvent');
const { vehiclePlateKey, formatPlate } = require('../utils/plateKey');

async function ensureFlatbeds() {
  const [vehicles, flatbeds] = await Promise.all([
    Ls2Vehicle.find({}).select('unitId name plate profile.registrationPlate profile.brand').sort({ unitId: 1 }).lean(),
    Ls2Flatbed.find({}).select('plateKey numbering').lean(),
  ]);
  const have = new Set(flatbeds.map((f) => f.plateKey));
  let next = flatbeds.reduce((m, f) => Math.max(m, Number(f.numbering) || 0), 0);
  const created = [];
  for (const v of vehicles) {
    const key = vehiclePlateKey(v);
    if (!key || have.has(key)) continue;
    const plate = formatPlate(v.plate || v.profile?.registrationPlate || '') || key;
    next += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const f = await Ls2Flatbed.create({
        plate, plateKey: key, numbering: next,
        brand: String(v.profile?.brand || '').trim(),
        notes: 'أُضيفت تلقائيًا من لوكيشن سوليوشن — الكاوتش يُسجَّل من الورشة',
      });
      have.add(key);
      created.push(f);
      // eslint-disable-next-line no-await-in-loop
      await Ls2AssetEvent.create({
        entityType: 'flatbed', refId: f._id, label: plate, action: 'registered',
        toPlate: plate, toPlateKey: key,
        reason: 'شاحنةٌ جديدة في لوكيشن سوليوشن — أُضيفت إلى سجلّ الأصول تلقائيًا',
        performedByName: 'النظام',
      });
    } catch (e) {
      if (e?.code !== 11000) throw e; // عاملٌ آخر سبق — السطحةُ موجودة
      next -= 1;
    }
  }
  if (created.length) {
    try { require('../utils/ttlCache').clear('ls2assets'); } catch (_) { /* */ }
    try { require('./ls2TireSensors').clearLayoutCache(); } catch (_) { /* */ }
    try { require('../utils/ls2Touch').clearLs2Derived(); } catch (_) { /* */ }
  }
  return created;
}

module.exports = { ensureFlatbeds };
