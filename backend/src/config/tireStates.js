/**
 * حالات فردة الكاوتش — تعريفٌ واحد يقرأ منه الخادمُ والشاشةُ والجوّال.
 *
 * ── لماذا محورٌ واحد ─────────────────────────────────────────────────────────
 * كانت الحالة على محورين: `status` (مركّبة/على الرفّ/في المصنع…) و`condition`
 * (جديدة/مستعملة). فخانة «في المصنع» كانت تُعَدّ بالدرجة وخانة «تحت التجديد»
 * بالحالة، والاثنتان تصفان مكانًا واحدًا — فاختلطتا، وصارت الفردة التي عند
 * مصنع التجديد تُقرأ «في المصنع» وهي لم تصل إليه بعد.
 *
 * فالمكان الآن على محورٍ واحد (`status`)، والدرجة (`condition`) وصفٌ للفردة
 * لا لمكانها: جديدةٌ أو مستعملة، لا ثالث لهما.
 *
 * ── والفرق بين «تحت التجديد» و«في المصنع» ────────────────────────────────────
 * «تحت التجديد» قرارٌ اتُّخذ: نزلت الفردة وتقرّر تجديدها، وهي في عهدة الورشة.
 * «في المصنع» موضعٌ فعليّ: خرجت من الشركة وصارت عند المصنع. والفرق ليس لفظيًّا —
 * الأولى يمكن استردادها اليوم، والثانية لا تُعرف عودتُها. ودمجُهما كان يجعل
 * الورشة تعِد بفردةٍ ليست عندها.
 */

/**
 * كلُّ حالةٍ: مفتاحُها، واسمُها، وهل هي «في المخزن»، ولونُها.
 * والترتيب هنا هو ترتيب البطاقات على الشاشة — سُلَّمٌ يُقرأ من المركَّب إلى
 * المنتهي، لا فرزٌ بالعدد يتغيّر كلَّ يوم.
 */
const TIRE_STATES = [
  { key: 'mounted', ar: 'مركَّبة', en: 'Mounted', inStore: false, tone: 'emerald' },
  { key: 'new', ar: 'الجديد', en: 'New', inStore: true, tone: 'sky', grade: 'new' },
  { key: 'used', ar: 'المستعمل', en: 'Used', inStore: true, tone: 'slate', grade: 'used' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal', inStore: true, tone: 'amber' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory', inStore: true, tone: 'violet' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap', inStore: true, tone: 'orange' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged', inStore: false, tone: 'red' },
  { key: 'sold', ar: 'المباع', en: 'Sold', inStore: false, tone: 'zinc' },
];

/** قيم `status` المسموح بها في النموذج (تشمل الموروثة كي لا يُرفض صفٌّ قديم). */
const STATUS_ENUM = ['mounted', 'spare', 'under_renewal', 'at_factory', 'scrap', 'damaged', 'sold', 'retired', 'in_repair'];

/**
 * الخانة التي تقع فيها الفردة — تعريفٌ واحد يستعمله العدّاد والفلتر معًا.
 * «على الرفّ» تنقسم بالدرجة: جديدة أو مستعملة، فلا خانةَ اسمُها «spare» تُعرَض.
 */
function tireState(tire) {
  const s = String(tire?.status || '');
  if (s === 'mounted') return 'mounted';
  if (s === 'in_repair') return 'under_renewal';          // الاسم القديم
  if (['under_renewal', 'at_factory', 'scrap', 'damaged', 'sold'].includes(s)) return s;
  if (s === 'retired') return 'scrap';                     // موروث
  return tire?.condition === 'new' ? 'new' : 'used';       // spare
}

/** هل تُعَدّ ضمن «في المخزن»؟ */
const IN_STORE = new Set(TIRE_STATES.filter((x) => x.inStore).map((x) => x.key));
const isInStore = (tire) => IN_STORE.has(tireState(tire));

/**
 * وجهاتُ النزول من العربية — ستٌّ، لا أربع.
 * كانت «سليمة/مخزن» وجهةً واحدة، فلا يُعرف أنزلت جديدةً أم مستعملة؛ وكانت
 * «في المصنع» و«تحت التجديد» شيئًا واحدًا. وكلُّ وجهةٍ هنا تصف حالةً مختلفة
 * فعلًا، ومن يُنزل الفردة هو وحده من يعرف أيَّها.
 */
const DISMOUNT_DESTINATIONS = [
  { key: 'new', ar: 'الجديد (على الرفّ)', en: 'New (shelf)', status: 'spare', condition: 'new', action: 'removed' },
  { key: 'used', ar: 'المستعمل (على الرفّ)', en: 'Used (shelf)', status: 'spare', condition: 'used', action: 'removed' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal', status: 'under_renewal', action: 'to_repair' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory', status: 'at_factory', action: 'to_repair' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap', status: 'scrap', action: 'scrapped' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged', status: 'damaged', action: 'damaged' },
];

/** الفعل المسجَّل في سجلّ الحركة لكلّ حالةٍ يُنقل إليها يدويًّا. */
const STATUS_ACTION = {
  spare: 'to_store',
  under_renewal: 'to_repair',
  at_factory: 'to_repair',
  scrap: 'scrapped',
  damaged: 'damaged',
  sold: 'sold',
  retired: 'retired',
};

module.exports = { TIRE_STATES, STATUS_ENUM, tireState, isInStore, DISMOUNT_DESTINATIONS, STATUS_ACTION, IN_STORE };
