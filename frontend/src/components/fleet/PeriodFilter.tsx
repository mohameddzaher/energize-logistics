'use client';
// فلتر الفترة الزمنية — عنصرٌ واحد لكل صفحات إدارة الأسطول.
//
// كل شاشةٍ كانت تحسب مداها بنفسها، فيسأل المستخدم عن «هذا الشهر» في القائمة
// وعن «هذا الشهر» في التحليلات فيأخذ رقمين لا يتّفقان. الحلّ أن الواجهة لا
// ترسل حدودًا أصلًا: ترسل **اسم الفترة** (`preset`) والخادم يحسمها وحده
// (resolvePeriod في fleetController)، فيستحيل أن تختلف شاشتان في معنى «أمس».
//
// ولذلك أيضًا لا يوجد هنا حسابُ تواريخ: أيّ سطرٍ يحسب بداية الشهر في المتصفّح
// يفتح البابَ لعودة الاختلاف نفسه من حيث أُغلق.
import { CalendarRange } from 'lucide-react';

export type Period = { preset: string; from: string; to: string; day: string };

export const EMPTY_PERIOD: Period = { preset: '', from: '', to: '', day: '' };

type PresetDef = { key: string; ar: string; en: string; future?: boolean };

// نفس المفاتيح المعرَّفة في الخادم حرفيًّا — أيّ مفتاحٍ لا يعرفه يسقط إلى
// الافتراضي بصمت، فالتطابق هنا شرطٌ لا تجميل.
export const PERIOD_PRESETS: PresetDef[] = [
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: 'yesterday', ar: 'أمس', en: 'Yesterday' },
  { key: 'last_7', ar: 'آخر ٧ أيام', en: 'Last 7 days' },
  { key: 'this_month', ar: 'هذا الشهر', en: 'This month' },
  { key: 'last_month', ar: 'الشهر الماضي', en: 'Last month' },
  { key: 'tomorrow', ar: 'غدًا', en: 'Tomorrow', future: true },
  { key: 'next_7', ar: 'الأيام ٧ القادمة', en: 'Next 7 days', future: true },
  { key: 'next_30', ar: 'الـ٣٠ يومًا القادمة', en: 'Next 30 days', future: true },
  { key: 'all', ar: 'كل الفترات', en: 'All time' },
];

export const presetLabel = (key: string, ar: boolean) => {
  const p = PERIOD_PRESETS.find((x) => x.key === key);
  if (p) return ar ? p.ar : p.en;
  if (key === 'day') return ar ? 'يوم محدَّد' : 'Specific day';
  if (key === 'range' || key === 'month') return ar ? 'مدى مخصَّص' : 'Custom range';
  return ar ? 'الفترة' : 'Period';
};

/** ما يُرسَل إلى الخادم — القيم الفارغة تُحذف كي لا تلوّث عنوان الصفحة. */
export const periodParams = (p: Period): Record<string, string> => {
  const out: Record<string, string> = {};
  if (p.day) { out.day = p.day; return out; }
  if (p.from || p.to) { if (p.from) out.from = p.from; if (p.to) out.to = p.to; return out; }
  if (p.preset) out.preset = p.preset;
  return out;
};

/** يُقرأ من عنوان الصفحة، فيعود الرجوع بزرّ المتصفّح إلى الفترة نفسها. */
export const periodFromParams = (sp: URLSearchParams | null): Period => ({
  preset: sp?.get('preset') || '',
  from: sp?.get('from') || '',
  to: sp?.get('to') || '',
  day: sp?.get('day') || '',
});

export const periodIsSet = (p: Period) => !!(p.preset || p.from || p.to || p.day);

export default function PeriodFilter({
  value, onChange, lang = 'ar', showFuture = false, className = '',
}: {
  value: Period;
  onChange: (p: Period) => void;
  lang?: 'en' | 'ar';
  /** شاشة «المتوقع للوصول» تسأل عن الآتي لا الماضي، فتحتاج فتراتٍ مستقبلية. */
  showFuture?: boolean;
  className?: string;
}) {
  const ar = lang === 'ar';
  // الفترات المستقبلية تُخفى افتراضيًّا: «غدًا» بلا معنًى في شاشةٍ تحلّل ما مضى.
  const presets = PERIOD_PRESETS.filter((p) => showFuture || !p.future);

  // اختيار زرٍّ يمسح المدى واليوم، واختيار يومٍ أو مدًى يمسح الزرّ — ثلاثتها
  // تعني الفترة نفسها، فبقاؤها معًا يترك المستخدم لا يدري أيَّها الفاعل.
  const pickPreset = (key: string) =>
    onChange(value.preset === key ? EMPTY_PERIOD : { preset: key, from: '', to: '', day: '' });
  const pickDay = (day: string) => onChange({ preset: '', from: '', to: '', day });
  const pickRange = (patch: Partial<Period>) =>
    onChange({ preset: '', day: '', from: value.from, to: value.to, ...patch });

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
      active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`;

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 self-center">
        <CalendarRange className="w-3.5 h-3.5" /> {ar ? 'الفترة:' : 'Period:'}
      </span>
      {presets.map((p) => (
        <button key={p.key} type="button" onClick={() => pickPreset(p.key)} className={chip(value.preset === p.key)}>
          {ar ? p.ar : p.en}
        </button>
      ))}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'يوم بعينه' : 'A day'}</label>
        <input type="date" value={value.day} onChange={(e) => pickDay(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'من' : 'From'}</label>
        <input type="date" value={value.from} onChange={(e) => pickRange({ from: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">{ar ? 'إلى' : 'To'}</label>
        <input type="date" value={value.to} onChange={(e) => pickRange({ to: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900" />
      </div>
      {periodIsSet(value) && (
        <button type="button" onClick={() => onChange(EMPTY_PERIOD)}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold self-end">
          {ar ? 'مسح الفترة' : 'Clear'}
        </button>
      )}
    </div>
  );
}

/**
 * شريطٌ يُظهر الفترة التي حسمها **الخادم** لا التي ظنّتها الواجهة.
 * وجوده ليس تزيينًا: حين تفتح شاشة التحليلات على «الشهر الحالي» ضمنًا وتبحث عن
 * حمولةٍ من الشهر الماضي، تخرج الأرقام أصفارًا ولا شيء على الشاشة يقول لماذا.
 */
export function PeriodBanner({ period, lang = 'ar', count }: {
  period?: { from?: string; to?: string; preset?: string } | null;
  lang?: 'en' | 'ar';
  count?: number;
}) {
  const ar = lang === 'ar';
  if (!period?.from) return null;
  const d = (v?: string) => (v ? new Date(v).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  // نهاية المدى حصرية في الخادم، فيُطرح منها يومٌ عند العرض وإلا بدا المدى
  // أطول بيومٍ ممّا يُحسب به فعلًا.
  const toShown = period.to ? new Date(new Date(period.to).getTime() - 1) : null;
  const isAll = period.preset === 'all';
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
      <CalendarRange className="w-3.5 h-3.5 text-amber-600" />
      <span className="font-semibold text-slate-700">{presetLabel(period.preset || '', ar)}</span>
      {!isAll && <span className="tabular-nums">{d(period.from)} → {toShown ? d(toShown.toISOString()) : ''}</span>}
      {typeof count === 'number' && (
        <span className="ms-auto font-semibold text-slate-700">
          {ar ? `${count} نتيجة داخل هذه الفترة` : `${count} results in this period`}
        </span>
      )}
    </div>
  );
}
