'use client';
// شريط فلاتر واحد لكل الشاشات.
//
// كل صفحة كانت بتخترع فلاترها: واحدة كروت كبيرة، واحدة سلكت، وتالتة بحث نصّي
// وبس — فاللي اتعوّد على شاشة يلاقي التانية مختلفة، وفيه شاشات (زي التيدرات)
// ما كانش فيها فلتر أصلاً رغم إن اللي بيدوّر على «التيدرات الواقفة» بيسأل عليها
// كل يوم.
//
// ── تلات قواعد ورا التصميم ──────────────────────────────────────────────────
//
// ١) **العدد على الشريحة نفسها.** الفلتر اللي ما بيقولش هيرجّع كام بيخلّي
//    المستخدم يجرّب ويرجع. والشريحة اللي عددها صفر بتبان مطفية بدل ما تختفي —
//    «مفيش تيدر واقف» معلومة، والاختفاء بيخلّيها سؤال.
//
// ٢) **الفلترة على العميل من نفس الليستة المعروضة.** الأعداد والنتيجة بيتحسبوا
//    من نفس المصفوفة، فمستحيل الرقم على الشريحة يختلف عن عدد الصفوف اللي
//    بتتفتح — وده أكتر تناقض بيوقّع الثقة في الشاشة.
//
// ٣) **الفلاتر بتتجمّع، والإلغاء بيبان.** لما يبقى فيه فلتر شغّال بيظهر زرار
//    «إلغاء الفلترة» وعدد المعروض جنبه، فمحدش يقعد يدوّر على صف مخفي بفلتر نسيه.
import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { flexNormalize } from '@/lib/flexMatch';

export type Chip = {
  key: string;
  label: string;
  /** الشرط. لو مش موجود، الشريحة دي «الكل». */
  test?: (row: any) => boolean;
  /** لون التمييز — بيتاخد من نفس لوحة القسم. */
  tone?: 'slate' | 'green' | 'amber' | 'blue' | 'violet' | 'red' | 'sky';
};

const TONES: Record<string, { on: string; off: string; dot: string }> = {
  slate: { on: 'bg-slate-900 text-white border-slate-900', off: 'bg-white text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  green: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'bg-white text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  amber: { on: 'bg-amber-500 text-white border-amber-500', off: 'bg-white text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  blue: { on: 'bg-[#12325c] text-white border-[#12325c]', off: 'bg-white text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  violet: { on: 'bg-violet-600 text-white border-violet-600', off: 'bg-white text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  red: { on: 'bg-rose-600 text-white border-rose-600', off: 'bg-white text-rose-800 border-rose-200', dot: 'bg-rose-500' },
  sky: { on: 'bg-sky-600 text-white border-sky-600', off: 'bg-white text-sky-800 border-sky-200', dot: 'bg-sky-500' },
};

/**
 * بيرجّع الصفوف بعد الفلترة + الأعداد لكل شريحة.
 * الأعداد بتتحسب على الليستة **قبل** الفلترة بالشرايح وبعد البحث — فالرقم
 * بيفضل معناه «لو دست هنا هتلاقي كام».
 */
export function useChipFilter<T>(rows: T[], chips: Chip[], active: string, query: string, searchIn: (r: T) => (string | number | null | undefined)[]) {
  // الطيُّ الموحَّد — راجع lib/flexMatch. كان هذا يطوي الهمزةَ والتاءَ ولا
  // يطوي المسافة، فاللوحةُ المنسوخة من أبشر بمسافتين لا تجد نفسَها المخزَّنة
  // بمسافةٍ واحدة: الخادمُ يُرجعها ثم يحذفها هذا السطر.
  const norm = flexNormalize;

  return useMemo(() => {
    const q = norm(query);
    const searched = !q ? rows : rows.filter((r) => searchIn(r).some((x) => norm(x).includes(q)));
    const counts: Record<string, number> = {};
    for (const c of chips) counts[c.key] = c.test ? searched.filter(c.test).length : searched.length;
    const chip = chips.find((c) => c.key === active);
    const shown = chip?.test ? searched.filter(chip.test) : searched;
    return { shown, counts, total: rows.length, searched: searched.length };
  }, [rows, chips, active, query, searchIn]);
}

export default function FilterBar({
  chips, counts, active, onChange, query, onQuery, placeholder, shown, total, ar, children,
}: {
  chips: Chip[];
  counts: Record<string, number>;
  active: string;
  onChange: (key: string) => void;
  query?: string;
  onQuery?: (v: string) => void;
  placeholder?: string;
  shown: number;
  total: number;
  ar: boolean;
  /** فلاتر إضافية خاصة بالصفحة (سلكت، مدة…) */
  children?: React.ReactNode;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const filtered = active !== chips[0]?.key || !!query?.trim();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const on = active === c.key;
          const n = counts[c.key] ?? 0;
          const tone = TONES[c.tone || 'slate'];
          const empty = n === 0 && !!c.test;
          return (
            <button key={c.key} type="button"
              onClick={() => onChange(on && c.test ? chips[0].key : c.key)}
              disabled={empty}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold border transition
                ${on ? tone.on : tone.off} ${empty ? 'opacity-45 cursor-default' : 'hover:border-slate-400'}`}>
              {!on && c.test && <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />}
              {c.label}
              <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {(onQuery || children) && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          {onQuery && (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={query || ''} onChange={(e) => onQuery(e.target.value)}
                placeholder={placeholder || t('بحث…', 'Search…')}
                className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-[13px] w-64 max-w-full" />
            </div>
          )}
          {children}
          {filtered && (
            <button type="button"
              onClick={() => { onChange(chips[0].key); onQuery?.(''); }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 text-[12.5px] text-slate-700 hover:text-slate-900 hover:border-slate-400">
              <X className="w-3.5 h-3.5" />{t('إلغاء الفلترة', 'Clear')}
            </button>
          )}
          <span className="ms-auto text-[12.5px] font-semibold text-slate-700 whitespace-nowrap">
            {shown === total
              ? t(`${total}`, `${total}`)
              : t(`${shown} من ${total}`, `${shown} of ${total}`)}
          </span>
        </div>
      )}
    </div>
  );
}
