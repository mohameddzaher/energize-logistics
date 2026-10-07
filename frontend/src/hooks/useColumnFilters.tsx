'use client';
/**
 * قمعُ الأعمدة على طريقة إكسل — لأيّ جدولٍ في النظام بثلاثة أسطر.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * في النظام مئةٌ وواحدُ جدولٍ لا قمعَ فيها. والمستخدمُ تعلَّم في الورقة أن
 * يضغط رأسَ العمود ويختار قيمةً، فيفتح الجدولَ عندنا فيبحث عن الزرّ فلا يجده
 * — فيصدّر إلى إكسل ويفلتر هناك. والسببُ أنّ إضافةَ القمع كانت تعني في كلّ
 * صفحةٍ: حالةً، ودالّةَ تصفية، وقراءةَ قيمةٍ لكلّ عمود، وتعديلَ كلّ `th`.
 *
 * فصار ذلك كلُّه هنا:
 *
 *     const cf = useColumnFilters<Row>({
 *       branch: (r) => r.branch || '',
 *       status: (r) => statusLabel(r.status, lang),
 *     }, rows, lang);
 *     const shown = cf.apply(rows);
 *     …
 *     <th>{cf.head('branch', 'الفرع')}</th>
 *
 * ── وقاعدتان تجعلانه يعمل «كويس» ────────────────────────────────────────────
 *   ١. **القيمةُ المقروءةُ هي المفلترة**: تُمرَّر دالّةُ القراءة نفسُها التي
 *      يُرسَم بها العمود. وبغير ذلك تُقرأ القائمةُ كلُّها «(فارغ)» على جدولٍ
 *      أعمدتُه محسوبة — وهو أوّلُ ما يُفسِد القمعَ في هذا النظام.
 *   ٢. **يعمل مع فلاتر الصفحة لا ضدَّها**: القائمةُ تُبنى من الصفوف التي وصلت
 *      **بعد** فلتر الصفحة (أو الخادم)، فلا تُعرَض قيمةٌ لا تُرى في الجدول،
 *      ولا يُلغي أحدُهما الآخر.
 *
 * والحالةُ تعيش في الصفحة لا في العنوان: اختيارُ قيمةٍ في عمودٍ ضيقٌ لحظيٌّ
 * لا يُشارَك برابط، وفلترُ الصفحة هو الذي يُشارَك (راجع syncUrl).
 */
import { useMemo, useState, useCallback } from 'react';
import { ColumnFilter, type ColumnFilterOption } from '@/components/ColumnFilter';

export type ValueReaders<T> = Record<string, (row: T) => any>;

export interface ColumnFiltersApi<T> {
  /** ما اختاره المستخدمُ لكلّ عمود. */
  selected: Record<string, Set<string>>;
  /** عددُ الأعمدة التي فيها اختيار. */
  activeCount: number;
  /** يُصفّي الصفوفَ بما اختير. */
  apply: (rows: T[]) => T[];
  /** رأسُ العمود: العنوانُ ومعه القمع. */
  head: (key: string, label: React.ReactNode) => React.ReactNode;
  /** القمعُ وحدَه — لرأسٍ مبنيٍّ بيدٍ. */
  filterFor: (key: string) => React.ReactNode;
  clear: () => void;
  clearOne: (key: string) => void;
}

export function useColumnFilters<T>(
  readers: ValueReaders<T>,
  rows: T[],
  lang: 'ar' | 'en',
  opts?: { options?: Record<string, ColumnFilterOption[]> },
): ColumnFiltersApi<T> {
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const set = useCallback((key: string, v: Set<string>) => {
    setSelected((p) => {
      const n = { ...p };
      if (v.size) n[key] = v; else delete n[key];
      return n;
    });
  }, []);

  const keys = Object.keys(selected);
  const sig = JSON.stringify(keys.map((k) => [k, [...selected[k]].sort()]));

  const apply = useCallback((list: T[]) => {
    if (!keys.length) return list;
    return list.filter((r) => keys.every((k) => {
      const read = readers[k];
      const v = read ? read(r) : (r as any)?.[k];
      return selected[k].has(v == null ? '' : String(v));
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, readers]);

  // ── والقائمةُ تُبنى من الصفوف **غيرِ** المصفّاة بهذا العمود ──────────────
  // لو بُنيت من المعروض لاختفت القيمُ الأخرى أوّلَ ما تُختار واحدةٌ، فلا
  // يستطيع المستخدمُ أن يضيف قيمةً ثانيةً إلى اختياره — وهو ما تفعله الورقة.
  const rowsFor = useMemo(() => {
    const out: Record<string, T[]> = {};
    for (const k of Object.keys(readers)) {
      const others = keys.filter((x) => x !== k);
      out[k] = others.length
        ? rows.filter((r) => others.every((o) => {
          const read = readers[o];
          const v = read ? read(r) : (r as any)?.[o];
          return selected[o].has(v == null ? '' : String(v));
        }))
        : rows;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sig, readers]);

  const filterFor = useCallback((key: string) => (
    <ColumnFilter
      rows={rowsFor[key] || rows}
      field={key}
      valueOf={readers[key]}
      options={opts?.options?.[key]}
      selected={selected[key] || new Set()}
      onChange={(v) => set(key, v)}
      lang={lang}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [rowsFor, rows, selected, lang, set, opts?.options]);

  const head = useCallback((key: string, label: React.ReactNode) => (
    <span className="inline-flex items-center gap-1">{label}{filterFor(key)}</span>
  ), [filterFor]);

  return {
    selected,
    activeCount: keys.length,
    apply,
    head,
    filterFor,
    clear: () => setSelected({}),
    clearOne: (key: string) => set(key, new Set()),
  };
}

export default useColumnFilters;
