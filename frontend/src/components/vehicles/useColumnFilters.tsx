'use client';
/**
 * فلترُ الأعمدة على طريقة إكسل — بثلاثة أسطرٍ في أيّ جدول.
 *
 * ── لماذا خُطّاف لا نسخٌ في كلّ صفحة ────────────────────────────────────────
 * جداولُ قسم المركبات تسعة، ولكلٍّ أعمدتُه ومصدرُ صفوفه. ونسخُ حالةِ الفلاتر
 * وتطبيقِها في كلٍّ منها يعني تسعَ نسخٍ تفترق: صفحةٌ تُطبّق الفلتر قبل الشريحة
 * وأخرى بعدها، وثالثةٌ ينساها صاحبُها في التصدير فيخرج الملفُّ بغير ما على
 * الشاشة. فالقاعدةُ مكتوبةٌ مرّةً هنا: الفلاتر آخرُ ما يُطبَّق — بعد البحث
 * والشرائح وكلّ شيء — كما يفعل إكسل بالضبط.
 *
 * الاستعمال:
 *   const cf = useColumnFilters<Row>();
 *   const shown = cf.apply(rows, { plate: (r) => r.plateNumber, state: (r) => label(r) });
 *   <th>الاسم {cf.header('plate', rows, (r) => r.plateNumber, ar)}</th>
 *
 * والقيمةُ تُقرأ بالدالّة نفسِها التي تُرسم بها الخليّةُ ويُكتب بها التصدير،
 * فما يُفلتَر عليه هو ما يُقرأ على الشاشة حرفًا بحرف.
 */
import { useState, useCallback, useMemo } from 'react';
import { ColumnFilter } from '@/components/ColumnFilter';

/** مجموعةٌ فارغةٌ ثابتة — لئلّا تُبنى واحدةٌ جديدة في كلّ رسمةٍ فتُعاد اللوحة. */
const EMPTY: Set<string> = new Set();

/** النصُّ الذي يُفلتَر عليه: فارغٌ يعني «(فارغ)» في القائمة. */
export const cellText = (v: any): string =>
  (v === null || v === undefined || v === '' ? '' : String(v));

export function useColumnFilters<T = any>() {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});

  const setFilter = useCallback((key: string, sel: Set<string>) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (sel.size) next[key] = sel; else delete next[key];
      return next;
    });
  }, []);

  const clear = useCallback(() => setFilters({}), []);
  const count = Object.keys(filters).length;

  /** يُطبَّق آخرًا: على ما تركته الشرائحُ والبحثُ لا على السجلّ الخام. */
  const apply = useCallback(
    (rows: T[], getters: Record<string, (r: T) => any>): T[] => {
      const keys = Object.keys(filters);
      if (!keys.length) return rows;
      return rows.filter((r) => keys.every((k) => {
        const g = getters[k];
        return !g || filters[k].has(cellText(g(r)));
      }));
    },
    [filters],
  );

  /**
   * القمعُ في رأس العمود. `rows` هي المعروضةُ قبل فلاتر الأعمدة.
   *
   * و`format` لعمودٍ قيمتُه رمزٌ ونصُّه غيرُه («valid» تُقرأ «ساري»): يُفلتَر
   * على الرمز ويُعرَض النصّ، وإلّا صارت القائمةُ رموزًا إنجليزيّةً لا يعرفها
   * من يقرأ الشاشة بالعربيّة.
   */
  const header = useCallback(
    (key: string, rows: T[], getter: (r: T) => any, ar: boolean, format?: (v: any) => string) => (
      <ColumnFilter
        rows={rows as any[]}
        field={key}
        valueOf={(r: any) => cellText(getter(r))}
        format={format}
        selected={filters[key] || EMPTY}
        onChange={(sel) => setFilter(key, sel)}
        lang={ar ? 'ar' : 'en'} />
    ),
    [filters, setFilter],
  );

  return useMemo(() => ({ filters, setFilter, clear, count, apply, header }),
    [filters, setFilter, clear, count, apply, header]);
}

/** زرُّ «امسح فلاتر الأعمدة» — يظهر حين يكون ثمّة ما يُمسَح. */
export function ClearColumnFilters({ count, onClear, ar }: { count: number; onClear: () => void; ar: boolean }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClear}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
      {ar ? `مسح فلاتر الأعمدة (${count})` : `Clear column filters (${count})`}
    </button>
  );
}
