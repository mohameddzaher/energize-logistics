/**
 * تواريخُ الموارد البشريّة — كلُّ تاريخٍ عمودان: ميلاديٌّ ثمّ هجريُّه مباشرةً.
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * «تاريخ انتهاء الإقامة الميلادي» ثمّ «تاريخ انتهاء الإقامة الهجري»، في كلّ
 * شاشةٍ من القسم: الجداول، وبطاقاتُ التفاصيل، والتصدير. والهجريُّ **مشتقٌّ**
 * من الميلاديّ بالمحوّل المشترك (`lib/hijri`، أمّ القرى) — لا يُخزَّن ولا
 * يُحسَب بخوارزميّةٍ ثانية، فلا يفترق الوجهان.
 *
 * ── واليومُ يُقرأ مرّةً واحدة ───────────────────────────────────────────────
 * الميلاديُّ المعروضُ والهجريُّ بجانبه يُشتقّان من **اليوم نفسِه**: يومُ
 * الشركة (`dayKey`، الرياض). فلو حُسب الهجريُّ من اللحظة بغرينتش والميلاديُّ
 * بالتوقيت المحلّيّ لاختلفا بيومٍ في كلّ تاريخٍ حُفظ بعد التاسعة مساءً
 * بغرينتش — عمودان متجاوران يقولان يومين.
 */
import { dayKey } from './companyDay';
import { toHijri, toHijriParts } from './hijri';

type DateLike = string | number | Date | null | undefined;

const PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** اليومُ الميلاديُّ «yyyy-mm-dd» كما تعرضه الشاشة — أو '' لما ليس تاريخًا. */
export const gregDay = (v: DateLike): string => {
  if (v === null || v === undefined || v === '') return '';
  // النصُّ «yyyy-mm-dd» يومٌ بلا ساعة: يُؤخَذ كما هو، بلا منطقةٍ زمنيّةٍ في الطريق.
  if (typeof v === 'string' && PLAIN.test(v.trim())) return v.trim();
  return dayKey(v);
};

/** هجريُّ التاريخ «yyyy-mm-dd» — أو '' إن لم يُقرأ تاريخًا. */
export const hijriDay = (v: DateLike): string => {
  const g = gregDay(v);
  return g ? toHijri(g) : '';
};

/** للخانة في الجدول: الهجريُّ أو «—». */
export const hijriCell = (v: DateLike): string => hijriDay(v) || '—';

/** الميلاديُّ «dd/mm/yyyy» — صيغةُ جداول القسم — من اليوم نفسِه الذي يُحسَب منه الهجريّ. */
export const gregCell = (v: DateLike): string => {
  const g = gregDay(v);
  if (!g) return '—';
  const [y, m, d] = g.split('-');
  return `${d}/${m}/${y}`;
};

// أسماءُ الأشهر الهجريّة — نظيرُ `HIJRI_MONTHS_AR` في backend/src/utils/hijri.js.
const HIJRI_MONTHS_AR = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const HIJRI_MONTHS_EN = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'];

const G_AR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const G_EN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** «12 أكتوبر 2026» */
export const gregLong = (v: DateLike, ar: boolean): string => {
  const g = gregDay(v);
  return g ? (ar ? G_AR : G_EN).format(new Date(`${g}T00:00:00Z`)) : '';
};

/** «1 جمادى الأولى 1448» */
export const hijriLong = (v: DateLike, ar: boolean): string => {
  const g = gregDay(v);
  const h = g ? toHijriParts(`${g}T00:00:00Z`) : null;
  if (!h) return '';
  return `${h.d} ${(ar ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN)[h.m - 1]} ${h.y}`;
};

/**
 * سطرُ التفاصيل: التقويمان معًا، الميلاديُّ أوّلًا —
 * «12 أكتوبر 2026 · 1 جمادى الأولى 1448».
 */
export const bothDates = (v: DateLike, ar: boolean, empty = '—'): string => {
  const g = gregLong(v, ar);
  if (!g) return empty;
  const h = hijriLong(v, ar);
  return h ? `${g} · ${h}${ar ? ' هـ' : ' AH'}` : g;
};

/** النسخةُ المختصرةُ للأماكن الضيّقة: «12/10/2026 · 1448-05-01 هـ». */
export const bothDatesShort = (v: DateLike, ar: boolean, empty = '—'): string => {
  const g = gregDay(v);
  if (!g) return empty;
  const h = toHijri(g);
  return h ? `${gregCell(g)} · ${h}${ar ? ' هـ' : ' AH'}` : gregCell(g);
};

/**
 * اسما العمودين من اسمٍ واحد: [الميلاديّ، الهجريّ].
 *
 * «تاريخ الميلاد الميلادي» لا يُقرأ — فحيث يتكرّر الجذرُ تُكتَب الصفةُ بين
 * قوسين، كما في `config/hrFields` على الخادم.
 */
export const pairLabels = (base: string, ar: boolean): [string, string] => {
  // علامةُ الإلزام تبقى في آخر الاسم لا في وسطه.
  const star = /\s*\*\s*$/.test(base) ? ' *' : '';
  let b = base.replace(/\s*\*\s*$/, '').trim()
    // الخادمُ يسمّي حقولَ الماستر «… الميلادي» أصلًا (config/hrFields) — فلا تُكرَّر الصفة.
    .replace(/\s*(الميلادي|\(ميلادي\)|\(Gregorian\))$/, '').trim();
  // «انتهاء الإقامة الميلادي» تُقرأ صفةً للانتهاء — فيُسبَق الاسمُ بـ«تاريخ».
  if (ar && /^انتهاء/.test(b)) b = `تاريخ ${b}`;
  if (!ar) return [`${b} (Gregorian)${star}`, `${b} (Hijri)`];
  if (/ميلاد/.test(b)) return [`${b} (ميلادي)${star}`, `${b} (هجري)`];
  return [`${b} الميلادي${star}`, `${b} الهجري`];
};

export type HrExportColumn = {
  header: string; key: string; width?: number;
  transform?: (value: any, row: any) => any;
  type?: 'text' | 'date' | 'number' | 'hijri';
};

/**
 * عمودا التصدير لتاريخٍ واحد — متجاوران، من القيمة نفسِها.
 *
 * الميلاديُّ خانةُ تاريخٍ حقيقيّةٌ (`type: 'date'`) لا نصٌّ يبدو تاريخًا،
 * والهجريُّ نصُّ أمّ القرى كما على الشاشة (`type: 'hijri'` في exportExcel).
 * وكلاهما يمرّ بـ`gregDay`، فما في الملفّ هو ما في الصفحة.
 */
export const exportDatePair = (
  base: string, key: string, ar: boolean,
  // `empty`: ما يُكتَب في العمودين معًا حين لا تاريخ («حتى الآن» لتفويضٍ قائم).
  opts: { width?: number; get?: (row: any) => DateLike; empty?: string } = {},
): HrExportColumn[] => {
  const [g, h] = pairLabels(base, ar);
  const read = (raw: any, row: any) => gregDay(opts.get ? opts.get(row) : raw) || opts.empty || '';
  return [
    { header: g, key, width: opts.width ?? 16, type: 'date', transform: read },
    { header: h, key, width: opts.width ?? 16, type: 'hijri', transform: read },
  ];
};

/**
 * فحصُ «لا تكرار»: عمودان بالعنوان نفسِه في جدولٍ واحدٍ خطأٌ في البناء — وقد
 * ظهر العمودُ الهجريُّ مرّتين في الماستر مرّةً (واحدٌ من الخادم وآخرُ من
 * المتصفّح). يُنادى في التطوير عند بناء أعمدة التصدير.
 */
export const duplicateHeaders = (columns: { header: string }[]): string[] => {
  const seen = new Set<string>(); const dup = new Set<string>();
  for (const c of columns) { if (seen.has(c.header)) dup.add(c.header); seen.add(c.header); }
  return [...dup];
};

/** فترةٌ في سطر تفاصيل: كلُّ طرفٍ بتقويميه — «… · … هـ → … · … هـ». */
export const bothPeriod = (from: DateLike, to: DateLike, ar: boolean): string =>
  `${bothDates(from, ar)} → ${bothDates(to, ar)}`;
