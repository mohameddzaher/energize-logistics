/**
 * ls2TireSensors — كم فردةً من كاوتش الشاحنة عليها حسّاسٌ **يبثّ فعلًا**.
 *
 * الورشة تُركّب الحسّاسات على دفعات، فالأسطول اليوم خليطٌ: شاحنةٌ اكتمل تسليحها
 * وأخرى نصفها. ولم يكن ثمّة رقمٌ واحد يقول للإدارة أين وصلت الحملة، فكان
 * المتابع يفتح تبويب «الحسّاسات» شاحنةً شاحنة ويجمع بنفسه.
 *
 * والحساب هنا في الخادم لا في المتصفّح عمدًا: الشاشتان (الأسطول المباشر وسجل
 * الأسطول) وتطبيق الهاتف تعرض الرقم نفسه، ولو اشتقّته كلُّ واحدةٍ وحدها لاختلفت
 * أرقامها عند أوّل تعديلٍ في قاعدة الاشتقاق، وصار الرقم موضع جدلٍ بدل أن يكون
 * جوابًا.
 *
 * ولمَ مصدران للحقيقة؟ لأن كلًّا منهما يعرف ما يجهله الآخر:
 *   • سجل الأصول (Ls2TireAsset) يعرف **المواضع**: أين كلُّ فردة، وأيّها سُجّل
 *     لها حسّاس. لكنّه ورقٌ: قد يُسجَّل حسّاسٌ ثم يتلف ولا يُحدَّث السطر.
 *   • البثّ الحيّ (Ls2Vehicle.tires) يعرف **العمل**: أي القنوات تُرسل حرارةً
 *     وضغطًا الآن. لكنّه لا يعرف موضع الفردة في تسمية الورشة.
 * فالأخضر يُحسب من البثّ لا من السجل — لأن السؤال «عليها حسّاس؟» جوابه عمليًّا
 * «هل يعطي قراءة؟» — والسجل يُستعمل لمعرفة عدد المواضع وتسميتها، ولكشف
 * المُركَّب الصامت.
 */
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const cache = require('../utils/ttlCache');
const { vehiclePlateKey } = require('../utils/plateKey');

// المخطط الرسمي لمواضع الكاوتش كما تكتبه الورشة في كشوفها. مكانه الخادم لا
// الشاشة: منه تُشتقّ أعداد المواضع (الأرض/الاستبن) للشاحنة التي لم تُجرَد بعد،
// فلو بقي في الواجهة وحدها لَما استطاع الخادم أن يحسب رقمًا صحيحًا لها.
const TIRE_POSITIONS = [
  { n: 1, label: 'اطار 1 يسار', section: 'الرأس' },
  { n: 2, label: 'اطار 2 يمين', section: 'الرأس' },
  { n: 3, label: 'اطار 3 خارجي يمين', section: 'المحور الخلفي للرأس' },
  { n: 4, label: 'اطار 4 داخلي يمين', section: 'المحور الخلفي للرأس' },
  { n: 5, label: 'اطار 5 داخلي يسار', section: 'المحور الخلفي للرأس' },
  { n: 6, label: 'اطار 6 خارجي يسار', section: 'المحور الخلفي للرأس' },
  { n: 7, label: 'اطار 7 يسار', section: 'التيدر' },
  { n: 8, label: 'اطار 8 يسار', section: 'التيدر' },
  { n: 9, label: 'اطار 9 يسار', section: 'التيدر' },
  { n: 10, label: 'اطار 10 يمين', section: 'التيدر' },
  { n: 11, label: 'اطار 11 يمين', section: 'التيدر' },
  { n: 12, label: 'اطار 12 يمين', section: 'التيدر' },
  { n: 13, label: 'اطار 13', section: 'الاستبن' },
  { n: 14, label: 'اطار 14', section: 'الاستبن' },
];

// القسم يُقرأ بالتطابق النمطي لا بالمساواة النصّية: نصّ القسم يأتي من كشف
// الورشة بصيغٍ متعدّدة («الاستبن» و«استبن» و«التيدر» و«تريلا»)، والمساواة
// الحرفية كانت تُسقط الفردة إلى قسم الرأس بلا أن يشتكي أحد.
const isSpareSection = (s) => /استبن/.test(String(s || ''));
const isTrailerSection = (s) => /تيدر|تريل/.test(String(s || ''));

// أعداد المخطط القياسي، مشتقّةً من الجدول أعلاه لا مكتوبةً بالأرقام: لو زِيد
// موضعٌ أو نُقص في الجدول تَبِعه الحساب من تلقاء نفسه.
const STD = (() => {
  const spare = TIRE_POSITIONS.filter((p) => isSpareSection(p.section)).length;
  const trailer = TIRE_POSITIONS.filter((p) => isTrailerSection(p.section)).length;
  const head = TIRE_POSITIONS.length - spare - trailer;
  return { spare, trailer, head, ground: head + trailer };
})();

// «قناةٌ تبثّ» — بالتعريف نفسه الذي يستعمله كاشف تغيّر الحسّاسات في ls2Poll.
// توحيد التعريف مقصود: لو اختلفا لأنذر الكاشف بتغيّرٍ لا يظهر في العمود، أو
// أظهر العمود أخضرَ لا يراه الكاشف.
const isReporting = (t) => t.tempC != null || (t.pressurePsi != null && t.pressurePsi > 10);

const LAYOUT_KEY = 'ls2:tireSensorLayout';
const LAYOUT_TTL = 60000; // سجل الأصول يتغيّر بفعل الورشة (مرّات في اليوم)، لا بالثواني

const EMPTY_ENTRY = { known: false, hasTrailer: false, ground: [], spares: [] };

/**
 * خريطة plateKey ← مواضع الشاحنة المسجّلة. استعلامٌ واحد لكل الأسطول بدل
 * استعلامٍ لكل صفٍّ في الجدول: الشاشة تعرض سبعًا وخمسين شاحنة، والقراءة
 * الواحدة على Atlas تكلّف نحو ٩٠ مللي ثانية ذهابًا وإيابًا.
 */
async function loadLayoutMap() {
  return cache.wrap(LAYOUT_KEY, LAYOUT_TTL, async () => {
    const [tires, flatbeds] = await Promise.all([
      Ls2TireAsset.find({ status: 'mounted' }, {
        plateKey: 1, section: 1, isSpare: 1, sensor: 1, positionNumber: 1, positionLabel: 1, serial: 1,
      }).lean(),
      Ls2Flatbed.find({}, { plateKey: 1, currentTrailerNumber: 1 }).lean(),
    ]);
    const map = new Map();
    const entryFor = (key) => {
      if (!map.has(key)) map.set(key, { known: false, hasTrailer: false, ground: [], spares: [] });
      return map.get(key);
    };
    for (const t of tires) {
      if (!t.plateKey) continue; // فردةٌ على تيدرٍ واقفٍ وحده — ليست على شاحنة الآن
      const e = entryFor(t.plateKey);
      e.known = true;
      if (t.isSpare || isSpareSection(t.section)) e.spares.push(t);
      else e.ground.push(t);
    }
    for (const f of flatbeds) {
      if (!f.plateKey) continue;
      const e = entryFor(f.plateKey);
      e.hasTrailer = !!f.currentTrailerNumber;
    }
    return map;
  });
}

// تُستدعى من ls2AssetsController عند أي حركة أصول: تركيبُ فردةٍ بحسّاس يجب أن
// يظهر في العمود فورًا، لا بعد دقيقةٍ يظنّ فيها الفنيّ أن تسجيله ضاع.
function clearLayoutCache() {
  cache.clear(LAYOUT_KEY);
}

/**
 * حصّة شاحنةٍ واحدة: «٧ / ٥ / ٢» = مركَّبٌ عليه حسّاسٌ يعمل / باقي مواضع الأرض
 * بلا حسّاس / عدد الاستبن.
 *
 * اشتقاق عدد المواضع (ولمَ لا يُكتب ١٢ و٢ رقمين ثابتين): الشاحنات ليست سواء —
 * الرأس وحده ستّ فردات، وبتيدرٍ اثنتا عشرة، وقد يأتي تيدرٌ بمحاورَ أكثر. فالعدد
 * يُؤخذ من السجل حين يشهد بأكثر من القياسي، ويُهبَط إلى مواضع الرأس وحدها حين
 * يشهد السجل شهادةً موجبة أن لا تيدر (سطحةٌ مسجَّلة، بلا رقم تيدر، ولها فردات
 * مسجَّلة ليس فيها فردةُ تيدرٍ واحدة). وما عدا ذلك فالقياسي — لأن الشاحنة التي
 * لم تُجرَد بعدُ مواضعها موجودةٌ على الأرض وإن خلا منها الورق، وإسقاطها يجعل
 * العمود يقول «٧ / ٠ / ٠» عن شاحنةٍ ينقصها خمسة حسّاسات.
 */
function summarize(reg, liveTires) {
  const e = reg || EMPTY_ENTRY;
  const ground = e.ground || [];
  const spares = e.spares || [];

  const hasTrailer = e.hasTrailer || ground.some((t) => isTrailerSection(t.section));
  const headOnly = e.known && !hasTrailer && ground.length > 0;
  const groundCount = ground.length > STD.ground ? ground.length : (headOnly ? STD.head : STD.ground);
  const spareCount = Math.max(spares.length, STD.spare);

  const live = Array.isArray(liveTires) ? liveTires : [];
  const reporting = live.filter(isReporting).length;
  // قناةٌ موجودةٌ على الناقل لكنّها تُرسل هراءً (حرارة ١٧٧٤°، أو راية عطلٍ
  // كهربائي): حسّاسٌ **مركَّب وصامت** — وهذا بالضبط ما لا يجوز عدّه أخضر.
  const faulty = live.filter((t) => t.fault).length;

  const withSensor = Math.min(reporting, groundCount);
  const withoutSensor = Math.max(0, groundCount - withSensor);

  const fitted = ground.filter((t) => t.sensor === 'yes').length;
  const spareFitted = spares.filter((t) => t.sensor === 'yes').length;
  // البثّ الزائد عن مواضع الأرض لا يكون إلا من استبنٍ مسلَّح — فالقنوات لا تزيد
  // على المركَّب على الأرض إلا بذلك.
  const spareReporting = Math.max(0, Math.min(spareCount, reporting - groundCount));

  // الصامت = ما شهد له أحد المصدرين بوجود حسّاسٍ ولم يعطِ قراءة: قناةٌ معطوبة
  // في البثّ، أو فردةٌ سجّلت الورشةُ لها حسّاسًا ولا أثر لقناتها أصلًا. ويُحدّ
  // بعدد المواضع الحمراء لأنه تفسيرٌ لجزءٍ منها لا رقمٌ مستقل عنها.
  const unseenFitted = Math.max(0, fitted - (reporting + faulty));
  const silent = Math.min(withoutSensor, faulty + unseenFitted);

  return {
    // الأرقام الثلاثة كما يقرؤها المالك: أخضر / أحمر / استبن.
    withSensor,
    withoutSensor,
    spare: spareCount,
    spareWithSensor: Math.max(spareFitted, spareReporting),
    // الصامت: حسّاسٌ مركَّبٌ لا يبثّ — جزءٌ من الأحمر، ويُعرض بالكهرماني حتى
    // لا يُخلَط «ما رُكِّب» بـ«رُكِّب وتعطّل»، فعلاجهما مختلف: الأول تركيبٌ
    // والثاني استبدالٌ أو فحص.
    silent,
    // سياق التدقيق — منه تُبنى نافذة التفصيل، وبه يُعرف مصدر كل رقم.
    ground: groundCount,
    registered: ground.length,
    unregistered: Math.max(0, groundCount - ground.length),
    fitted,
    reporting,
    faulty,
    layout: ground.length > STD.ground ? 'registry' : headOnly ? 'head' : 'standard',
    // مواضع الأرض التي لم يُسجَّل لها حسّاس — هذه هي إجابة «مين الناقص بالضبط».
    positionsWithoutSensor: ground
      .filter((t) => t.sensor !== 'yes')
      .map((t) => ({ positionNumber: t.positionNumber ?? null, positionLabel: t.positionLabel || '', section: t.section || '', serial: t.serial || '', sensor: t.sensor || 'unknown' }))
      .sort((a, b) => (a.positionNumber ?? 99) - (b.positionNumber ?? 99)),
    // القنوات المعطوبة بترقيم Wialon (محور/فردة). لا تُترجَم إلى مواضع الورشة
    // عمدًا: الترقيمان لا يتطابقان واحدًا لواحد، وتخمينُ الموضع هنا يرسل الفنيّ
    // إلى الفردة الخطأ — والاسم الصريح كما يبثّه الجهاز أصدق من ترجمةٍ ظنّية.
    faultyChannels: live.filter((t) => t.fault).map((t) => ({ axle: t.axle ?? null, position: t.position ?? null })),
    label: `${withSensor} / ${withoutSensor} / ${spareCount}`,
  };
}

/** يُلحق `tireSensors` بكل مركبةٍ في القائمة — استعلامُ سجلٍّ واحدٌ للكل. */
async function attachToVehicles(vehicles) {
  const map = await loadLayoutMap();
  return vehicles.map((v) => ({ ...v, tireSensors: summarize(map.get(vehiclePlateKey(v)), v.tires) }));
}

/** النسخة المفردة — لصفحة المركبة الواحدة. */
async function attachToVehicle(vehicle) {
  if (!vehicle) return vehicle;
  const map = await loadLayoutMap();
  return { ...vehicle, tireSensors: summarize(map.get(vehiclePlateKey(vehicle)), vehicle.tires) };
}

module.exports = {
  TIRE_POSITIONS, STD, isSpareSection, isTrailerSection, isReporting,
  loadLayoutMap, clearLayoutCache, summarize, attachToVehicles, attachToVehicle,
};
