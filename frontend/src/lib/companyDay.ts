/**
 * يومُ الشركة في الواجهة — نظيرُ `backend/src/utils/companyDay.js`.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * `new Date().toISOString().slice(0, 10)` كان مكتوبًا في ستّ مكتباتٍ وثلاثٍ
 * وستّين موضعًا. و`toISOString()` تحوّل إلى **غرينتش** قبل أن تقصّ: فبين منتصف
 * الليل والثالثة فجرًا بتوقيت الرياض تعطي تاريخَ **أمس**. فمَن فتح شاشةً في
 * تلك الساعات وجد «اليوم» أمسَ، وحقلَ تاريخٍ افتراضيًّا خاطئًا، وفلترًا يبدأ
 * قبل ما طلب بيوم.
 *
 * والأسوأُ `toDateInput`: تحويلُ وقتٍ مخزَّنٍ إلى خانةِ تاريخٍ عبر `toISOString`
 * يزيحه بمقدار الإزاحة — فتاريخٌ حُفظ ليلةَ الثاني من يناير يُعرض «١ يناير»،
 * فيُحفظ كما عُرض، فينقص يومًا في كلّ مرّةٍ يُفتح فيها النموذجُ ويُحفظ.
 *
 * ── والحلّ ──────────────────────────────────────────────────────────────────
 * `Intl` بلغةٍ تكتب التاريخ `YYYY-MM-DD` أصلًا (`en-CA`)، فيُقرأ اليومُ في
 * المنطقة المطلوبة بلا تحويلٍ ولا حساب.
 */

export const COMPANY_TZ = 'Asia/Riyadh';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** يومُ تاريخٍ بتوقيت الشركة، `YYYY-MM-DD` — أو `''` لتاريخٍ غير صالح. */
export function dayKey(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

/** اليومُ الحاليّ بتوقيت الشركة. */
export const today = (): string => fmt.format(new Date());

/** اليومُ قبل/بعد `n` يومًا من اليوم — سالبٌ للماضي. */
export const dayOffset = (n: number): string => fmt.format(new Date(Date.now() + n * 86400000));

/** أوّلُ يومٍ من الشهر الحاليّ. */
export const monthStart = (): string => `${today().slice(0, 7)}-01`;

/**
 * قيمةٌ صالحةٌ لـ`<input type="date">` من أيّ تاريخٍ مخزَّن.
 * تُستعمل بدل `new Date(v).toISOString().slice(0, 10)` في كلّ نموذج.
 */
export const toDateInput = (v?: string | number | Date | null): string => dayKey(v);

/** قيمةٌ صالحةٌ لـ`<input type="datetime-local">` بتوقيت الشركة. */
export function toDateTimeInput(v?: string | number | Date | null): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: COMPANY_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce<Record<string, string>>((o, x) => { o[x.type] = x.value; return o; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
