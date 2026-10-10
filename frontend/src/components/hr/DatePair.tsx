'use client';
/**
 * DatePair — تاريخٌ واحدٌ بخانتين متجاورتين: الميلاديّةُ ثمّ الهجريّةُ مباشرةً.
 *
 * ── خانتان لقيمةٍ واحدة ─────────────────────────────────────────────────────
 * قاعدةُ القسم: لكلّ تاريخٍ وجهان، ومن كتب في أحدهما تبعه الآخرُ في الحال.
 * والمحفوظُ واحدٌ — الميلاديُّ «yyyy-mm-dd» كما يُرسَل للخادم اليوم — والهجريُّ
 * عرضٌ له يُحسَب بـ`lib/hijri` (أمّ القرى). فلا حقلَ ثانيًا في النموذج ولا في
 * الطلب: `onChange` يُعطي الميلاديَّ وحدَه.
 *
 * ── والهجريُّ الخاطئ لا يمحو الميلاديّ ──────────────────────────────────────
 * «30-02-1448» ناقصٌ أو غيرُ موجود: تُلوَّن الخانةُ ويبقى آخرُ تاريخٍ صحيح.
 * لو مُحي الميلاديُّ مع كلّ حرفٍ ناقصٍ لضاع تاريخُ الانتهاء بضغطةٍ خاطئة،
 * ولحُفظ النموذجُ بلا تاريخ. أمّا إفراغُ الخانة كلِّها فمسحٌ مقصود.
 *
 * ── ولماذا مكوّنٌ واحد ──────────────────────────────────────────────────────
 * يُستعمل في كلّ نماذج القسم، ومعرَّفٌ على مستوى الملفّ لا داخل دالّةِ عرض —
 * وإلّا أُعيد بناءُ الخانة مع كلّ حرفٍ فضاع التركيز.
 *
 * وخانةُ الميلاديّ `<input type="date">` عاديّة، فيتولّى `DateFieldLocale`
 * تلميحَها الفارغ كبقيّة خانات التاريخ. والهجريّةُ نصٌّ `dir="ltr"` لأنّ
 * المتصفّح لا يملك خانةَ تاريخٍ للتقويم الهجريّ.
 */
import { useState } from 'react';
import { gregorianToHijri, hijriToGregorian } from '@/lib/hijri';
import { pairLabels } from '@/lib/hrDates';

const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60';
const labelCls = 'text-slate-500 text-xs mb-1 block';

// الأرقامُ الهنديّة (٠-٩) والفارسيّة تُكتب من لوحة المفاتيح العربيّة — تُقرأ كاللاتينيّة.
const latinDigits = (s: string) => s
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
  .replace(/[.\s]+/g, '-');

type Draft = { text: string; forValue: string } | null;

export default function DatePair({
  label, value, onChange, ar, min, max, disabled, autoFocus, inputClassName,
}: {
  /** الاسمُ الأساسيّ — يُشتقّ منه «… الميلادي» و«… الهجري». بدونه تُكتب «ميلادي»/«هجري». */
  label?: string;
  /** الميلاديّ «yyyy-mm-dd» — وهو وحدَه ما يُحفَظ ويُرسَل. */
  value: string;
  onChange: (gregorian: string) => void;
  ar: boolean;
  /** حدودُ التاريخ الميلاديّ — تُطبَّق على الخانتين معًا. */
  min?: string; max?: string;
  disabled?: boolean; autoFocus?: boolean;
  inputClassName?: string;
}) {
  const g = (value || '').slice(0, 10);
  // ما يكتبه المستخدمُ في الهجريّ الآن. `forValue` يربطه بالميلاديّ الذي كُتب
  // عليه: فإن تغيّر الميلاديُّ من خارج الخانة (صفٌّ آخر، زرُّ تجديد) سقطت
  // المسوّدةُ وتبع الهجريُّ القيمةَ — بلا `useEffect` يُعيد الصياغةَ تحت الأصابع.
  const [draft, setDraft] = useState<Draft>(null);
  const live = draft && draft.forValue === g ? draft : null;
  const text = live ? live.text : gregorianToHijri(g);

  const parsed = live && live.text.trim() ? hijriToGregorian(latinDigits(live.text.trim())) : '';
  const outOfRange = !!parsed && ((!!min && parsed < min) || (!!max && parsed > max));
  const invalid = !!live && !!live.text.trim() && (!parsed || outOfRange);

  const onHijri = (raw: string) => {
    const t = raw.trim();
    if (!t) { setDraft(null); if (g) onChange(''); return; }
    const next = hijriToGregorian(latinDigits(t));
    const ok = !!next && !(min && next < min) && !(max && next > max);
    // لا يُترجَم إلّا تاريخٌ تامٌّ صحيح — وما دونه يبقى الميلاديُّ على حاله.
    setDraft({ text: raw, forValue: ok ? next : g });
    if (ok && next !== g) onChange(next);
  };

  const [gl, hl] = label ? pairLabels(label, ar) : [ar ? 'ميلادي' : 'Gregorian', ar ? 'هجري' : 'Hijri'];
  const message = invalid
    ? (outOfRange
      ? (ar ? 'التاريخ خارج المدّة المسموح بها' : 'Date is out of the allowed range')
      : (ar ? 'تاريخ هجري غير صحيح — بقي التاريخ السابق كما هو' : 'Not a valid Hijri date — the previous date was kept'))
    : '';

  const gregorian = (
    <div>
      <label className={labelCls}>{gl}</label>
      <input type="date" value={g} min={min} max={max} disabled={disabled} autoFocus={autoFocus}
        onChange={(e) => { setDraft(null); onChange(e.target.value); }}
        className={`${inputCls} border-slate-200 ${inputClassName || ''}`} />
    </div>
  );
  const hijri = (
    <div>
      <label className={labelCls}>{hl}</label>
      <input type="text" dir="ltr" inputMode="numeric" placeholder="1448-05-01" value={text} disabled={disabled}
        aria-invalid={invalid || undefined}
        title={ar ? 'اكتب التاريخ الهجري (سنة-شهر-يوم) — يُحوَّل إلى الميلادي في الحال' : 'Type the Hijri date (year-month-day) — the Gregorian follows at once'}
        onChange={(e) => onHijri(e.target.value)}
        // عند الخروج تُعاد الصياغةُ القياسيّة إن صحّ المكتوب؛ والخاطئُ يبقى ظاهرًا ليُصحَّح.
        onBlur={() => { if (!invalid) setDraft(null); }}
        className={`${inputCls} tabular-nums text-start ${invalid ? 'border-red-400 bg-red-50' : 'border-slate-200'} ${inputClassName || ''}`} />
      {message && <p className="text-[11px] text-red-600 mt-1">{message}</p>}
    </div>
  );

  // ── صفٌّ كاملٌ بخانتين ───────────────────────────────────────────────────
  // في شبكة النموذج يأخذ الزوجُ الصفَّ كلَّه (`col-span-full`) أيًّا كان موضعُه
  // وعددُ الأعمدة — فلا تنزل الهجريّةُ إلى سطرٍ وحدَها تحت حقلٍ لا يخصّها.
  return <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-3">{gregorian}{hijri}</div>;
}
