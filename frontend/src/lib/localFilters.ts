/**
 * خياراتُ فلترةٍ محسوبةٌ من صفوفٍ في الشاشة.
 *
 * ── لماذا محلّيًّا ────────────────────────────────────────────────────────────
 * شاشاتُ الموارد البشريّة الصغيرة (العقود، العهد، التراخيص، المخزون) تُحمَّل
 * كاملةً ثمّ تُفلتَر في المتصفّح. فنداءٌ إلى الخادم ليحسب أعدادَ قيمٍ بين يدي
 * الشاشة أصلًا عملٌ بلا فائدة — ويصنع فرصةً لأن يختلف العددُ عن الجدول، وهو
 * أسوأُ ما في لوحةِ فلترة.
 *
 * والقاعدةُ نفسُها: عددُ كلّ قيمةٍ يُحسب **بعد بقيّة الفلاتر**، فما يُرى هو ما
 * يُحصَّل عند الضغط.
 */
import type { FilterFieldDef, FilterValues } from '@/components/system/FilterPanel';

export interface LocalFieldDef<T> {
  key: string; ar: string; en: string;
  groupAr?: string; groupEn?: string;
  /** القيمةُ المعروضة لهذا الصفّ — والفلترةُ تُقارَن بها نفسِها. */
  get: (row: T) => string | number | boolean | null | undefined;
}

const show = (v: unknown) => (v === true ? 'نعم' : v === false ? 'لا'
  : (v === null || v === undefined || v === '' ? '—' : String(v)));

/** أيمرّ هذا الصفُّ من الفلاتر كلِّها؟ `skip` يُستثنى لحساب أعداد حقله. */
export function passes<T>(row: T, defs: LocalFieldDef<T>[], values: FilterValues, skip?: string) {
  return defs.every((d) => {
    if (d.key === skip) return true;
    const sel = String(values[d.key] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!sel.length) return true;
    return sel.includes(show(d.get(row)));
  });
}

/** الصفوفُ الباقية بعد الفلاتر. */
export const applyLocalFilters = <T>(rows: T[], defs: LocalFieldDef<T>[], values: FilterValues) =>
  rows.filter((r) => passes(r, defs, values));

/** خياراتُ اللوحة: كلُّ قيمةٍ وعددُها بعد بقيّة الفلاتر. */
export function localFilterFields<T>(rows: T[], defs: LocalFieldDef<T>[], values: FilterValues): FilterFieldDef[] {
  return defs.map((d) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!passes(r, defs, values, d.key)) continue;
      const v = show(d.get(r));
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return {
      key: d.key, ar: d.ar, en: d.en, groupAr: d.groupAr, groupEn: d.groupEn,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    };
  });
}
