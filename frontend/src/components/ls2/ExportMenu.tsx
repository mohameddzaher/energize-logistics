'use client';
// ExportMenu — زرّ التصدير الوحيد في المنصّة كلّها. كلّ صفحة تمرّر له «نطاقات»
// (المعروض بعد الفلتر، الكلّ، الصفحة الحالية…)؛ نطاقٌ واحد يظهر زرًّا عاديًّا،
// وأكثر يظهر قائمةً منسدلة بعدّاد صفوفٍ جنب كلّ نطاق. العدّاد هو بيت القصيد:
// من يصدّر وهو يظنّ أنّه أخذ مئتَي صفٍّ بينما أخذ عشرين يخرج بملفٍّ خاطئ صامت.
// كلّ نطاقٍ يحمل شيتاته، فيصحّ أن يكون النطاق مصنّفًا متعدّد الشيتات.
// أسماء الملفّات يُلحَق بها تاريخ التصدير.
import { useEffect, useRef, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { FileSpreadsheet, ChevronDown } from 'lucide-react';
import { exportMultiSheet } from '@/utils/exportExcel';

export type ExportColumn = { header: string; key: string; transform?: (value: any, row: any) => any; width?: number };
export interface ExportSheet { name: string; rows: Record<string, any>[]; columns: ExportColumn[] }
export interface ExportOption {
  key: string; label: string;
  sheets?: ExportSheet[];
  /**
   * بديل عن `sheets` لما البيانات ما تكونش محمّلة في الصفحة أصلاً — بتتجاب أول
   * ما المستخدم يختار الخيار ده. مفيدة لما جلب البيانات نفسه عملية حسّاسة
   * (مثلاً كلمات المرور) فما ينفعش تتحمّل مع كل فتح للصفحة.
   */
  resolve?: () => Promise<ExportSheet[]>;
  disabled?: boolean;
  /** يتعرض جنب الاسم بدل عدّاد الصفوف لما العدد مش معروف قبل الجلب. */
  hint?: string;
}

/**
 * أسماء النطاقات موحّدةً في مكانٍ واحد: أكثر من تسعين صفحةً تعرض هذه الخيارات،
 * ولو صاغت كلُّ صفحةٍ نصَّها بنفسها لاختلف معنى «الكلّ» من شاشةٍ إلى أخرى.
 * `page` تُستعمل حصرًا حين يكون الترقيم على الخادم ولا نملك إلّا صفوفَ الشاشة —
 * تسميتُها الصريحة هي التي تمنع الملفَّ من ادّعاء ما ليس فيه.
 */
export const exportScopeLabels = (ar: boolean) => ({
  shown: ar ? 'تصدير المعروض (بعد الفلتر)' : 'Export shown (filtered)',
  all: ar ? 'تصدير الكلّ' : 'Export everything',
  page: ar ? 'الصفحة الحالية فقط' : 'Current page only',
  matching: ar ? 'كلّ نتائج الفلتر' : 'All rows matching filter',
});

export default function ExportMenu({ fileName, options, lang = 'en', className = '', variant = 'primary', label }: {
  fileName: string;
  options: ExportOption[];
  lang?: 'en' | 'ar';
  className?: string;
  /**
   * الشكل: `primary` هو الأخضر الأصلي لصفحات الأسطول والـLS2، و`subtle` هو
   * الرمادي الذي كانت تستعمله بقيّة الصفحات قبل توحيدها على هذه القائمة —
   * بدونه كان تحويلُ تسعين صفحةً إلى القائمة يقلب لونَ زرٍّ في كلّ ترويسة.
   */
  variant?: 'primary' | 'subtle';
  /** نصّ الزرّ حين تكون الصفحة مترجِمةً له بنفسها؛ وإلّا فالنصّ الافتراضي. */
  label?: string;
}) {
  const { notify } = useDialog();
  const [openMenu, setOpenMenu] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ar = lang === 'ar';

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  const run = async (opt: ExportOption) => {
    let sheets = opt.sheets;
    if (opt.resolve) {
      setBusyKey(opt.key);
      try { sheets = await opt.resolve(); }
      catch (e: any) { notify(e?.message || (ar ? 'تعذّر تجهيز الملف' : 'Could not prepare the file'), 'error'); setBusyKey(null); return; }
      setBusyKey(null);
    }
    setOpenMenu(false);
    const total = (sheets || []).reduce((n, s) => n + (s.rows?.length || 0), 0);
    if (!total) { notify(ar ? 'لا توجد بيانات للتصدير' : 'No data to export'); return; }
    const date = new Date().toISOString().slice(0, 10);
    exportMultiSheet((sheets || []).map((s) => ({ name: s.name, data: s.rows, columns: s.columns })), `${fileName}-${date}`);
  };

  const skin = variant === 'subtle'
    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
    : 'bg-emerald-600 hover:bg-emerald-700 text-white';
  const btnCls = `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg ${skin} text-sm font-medium transition-colors disabled:opacity-60 ${className}`;
  const btnText = label || (ar ? 'تصدير Excel' : 'Export Excel');

  if (options.length === 1) {
    return (
      <button type="button" disabled={!!busyKey} onClick={() => run(options[0])} className={btnCls}>
        <FileSpreadsheet className="w-4 h-4" /> {busyKey ? (ar ? '…جارٍ' : '…') : btnText}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpenMenu((v) => !v)} className={btnCls}>
        <FileSpreadsheet className="w-4 h-4" /> {btnText} <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {openMenu && (
        <div className={`absolute z-30 mt-1 min-w-[230px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 ${ar ? 'left-0' : 'right-0'}`}>
          {options.map((opt) => {
            const count = (opt.sheets || []).reduce((n, s) => n + (s.rows?.length || 0), 0);
            const busy = busyKey === opt.key;
            return (
              <button
                key={opt.key} type="button" disabled={opt.disabled || !!busyKey}
                onClick={() => run(opt)}
                className="w-full text-start px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center justify-between gap-3"
              >
                <span>{opt.label}</span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {busy ? (ar ? '…جارٍ' : '…') : (opt.resolve ? (opt.hint || '') : count)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
