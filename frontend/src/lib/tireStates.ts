/**
 * حالات فردة الكاوتش — صورةُ config/tireStates.js في الخادم.
 *
 * المكانُ على محورٍ واحد (`status`)، والدرجة (`condition`) وصفٌ للفردة لا
 * لمكانها. وكانت خانة «في المصنع» تُعَدّ بالدرجة وخانة «تحت التجديد» بالحالة —
 * وصفان لموضعٍ واحد من مصدرين، فاختلطا.
 *
 * و«تحت التجديد» غير «في المصنع»: الأولى قرارٌ اتُّخذ والفردة في عهدة الورشة،
 * والثانية موضعٌ فعليّ خارج الشركة. ودمجُهما كان يجعل الورشة تعِد بفردةٍ ليست
 * عندها.
 */
export type TireStateKey =
  | 'mounted' | 'new' | 'used' | 'under_renewal' | 'at_factory' | 'scrap' | 'damaged' | 'sold';

export interface TireStateDef {
  key: TireStateKey;
  ar: string; en: string;
  /** تُعَدّ ضمن «في المخزن»؟ */
  inStore: boolean;
  /** لونُ النقطة في البطاقة ولون الرقم. */
  dot: string; text: string; chip: string;
}

/** الترتيب هنا هو ترتيب البطاقات: سُلَّمٌ من المركَّب إلى المنتهي، لا فرزٌ بالعدد. */
export const TIRE_STATES: TireStateDef[] = [
  { key: 'mounted', ar: 'مركّبة', en: 'Mounted', inStore: false, dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-700' },
  { key: 'new', ar: 'الجديد', en: 'New', inStore: true, dot: 'bg-sky-500', text: 'text-sky-700', chip: 'bg-sky-100 text-sky-700' },
  { key: 'used', ar: 'المستعمل', en: 'Used', inStore: true, dot: 'bg-indigo-500', text: 'text-indigo-700', chip: 'bg-indigo-100 text-indigo-700' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal', inStore: true, dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-100 text-amber-700' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory', inStore: true, dot: 'bg-violet-500', text: 'text-violet-700', chip: 'bg-violet-100 text-violet-700' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap', inStore: true, dot: 'bg-orange-500', text: 'text-orange-700', chip: 'bg-orange-100 text-orange-700' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged', inStore: false, dot: 'bg-red-500', text: 'text-red-700', chip: 'bg-red-100 text-red-700' },
  { key: 'sold', ar: 'المباع', en: 'Sold', inStore: false, dot: 'bg-zinc-500', text: 'text-zinc-700', chip: 'bg-zinc-200 text-zinc-700' },
];

const BY_KEY = new Map(TIRE_STATES.map((s) => [s.key, s]));

/** الخانةُ التي تقع فيها الفردة — تعريفٌ واحد للعدّاد والفلتر والشارة. */
export function tireState(t: { status?: string; condition?: string } | null | undefined): TireStateKey {
  const s = String(t?.status || '');
  if (s === 'mounted') return 'mounted';
  if (s === 'in_repair') return 'under_renewal';                       // الاسم القديم
  if (s === 'retired') return 'scrap';                                  // موروث
  if (['under_renewal', 'at_factory', 'scrap', 'damaged', 'sold'].includes(s)) return s as TireStateKey;
  return (t?.condition === 'new' ? 'new' : 'used');                     // spare
}

export const tireStateDef = (t: { status?: string; condition?: string }) => BY_KEY.get(tireState(t)) || TIRE_STATES[2];
export const tireStateLabel = (t: { status?: string; condition?: string }, ar: boolean) => {
  const d = tireStateDef(t);
  return ar ? d.ar : d.en;
};

/** «في المخزن» = كلُّ ما هو عندنا وغيرُ مركَّب. والتالف والمباع خرجا من العهدة. */
export const isInStore = (t: { status?: string; condition?: string }) => !!tireStateDef(t).inStore;

/**
 * وجهاتُ النزول من العربية — ستٌّ، لا أربع.
 * كانت «سليمة/مخزن» وجهةً واحدة لا يُعرف منها أنزلت الفردة جديدةً أم مستعملة،
 * وكانت «في المصنع» و«تحت التجديد» شيئًا واحدًا. ومن يُنزل الفردة هو وحده من
 * يعرف أيَّها.
 */
export const DISMOUNT_DESTINATIONS: { key: string; ar: string; en: string }[] = [
  { key: 'new', ar: 'الجديد (على الرفّ)', en: 'New (shelf)' },
  { key: 'used', ar: 'المستعمل (على الرفّ)', en: 'Used (shelf)' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged' },
];

/** الحالات التي يُنقل إليها يدويًّا من شاشة المخزن (تشمل البيع). */
export const MANUAL_STATES = [...DISMOUNT_DESTINATIONS, { key: 'sold', ar: 'المباع', en: 'Sold' }];
