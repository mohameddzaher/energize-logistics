'use client';
// شريط الإجراء الجماعي — يظهر بمجرد اختيار أول عنصر.
//
// كان موضوعًا بعد الجدول بخاصية sticky، ومع جدول من مئات الصفوف يعني أن المستخدم
// يختار صفًّا في الأعلى ثم لا يجد الزر إلا بعد النزول إلى آخر الصفحة. الشريط
// الآن ثابت في أسفل الشاشة (fixed)، فيظهر فورًا في أي موضع من الصفحة.
//
// ويترك مساحة أسفله عبر عنصر فارغ في تدفّق الصفحة، حتى لا يحجب آخر صف.
import { X } from 'lucide-react';

export default function SelectionBar({
  count, label, hint, actionLabel, onAction, onClear, ar, disabled, tone = 'orange', children,
}: {
  count: number;
  /** «٣ أصناف مختارة» — يُكتب كاملاً لأن صيغة الجمع تختلف بين الشاشات. */
  label: string;
  /** سطر توضيحي صغير: ماذا سيحدث بالضبط عند التنفيذ. */
  hint?: string;
  actionLabel: string;
  onAction: () => void;
  onClear: () => void;
  ar: boolean;
  disabled?: boolean;
  tone?: 'orange' | 'green';
  children?: React.ReactNode;
}) {
  if (count < 1) return null;
  const t = (a: string, e: string) => (ar ? a : e);
  const btn = tone === 'green'
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-[#f37121] hover:bg-[#d95f13]';

  return (
    <>
      {/* يمنع الشريط من تغطية آخر صف في الجدول */}
      <div aria-hidden className="h-20" />
      <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pointer-events-none">
        <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white shadow-2xl px-4 py-3
                        flex flex-wrap items-center gap-3 pointer-events-auto">
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap">{label}</span>
          {hint && <span className="text-[12px] text-slate-600">{hint}</span>}
          <button type="button" onClick={onClear}
            className="inline-flex items-center gap-1 text-[12.5px] text-slate-600 hover:text-slate-900">
            <X className="w-3.5 h-3.5" />{t('إلغاء التحديد', 'Clear')}
          </button>
          {children}
          <button type="button" onClick={onAction} disabled={disabled}
            className={`ms-auto px-4 py-2 rounded-lg ${btn} text-white text-sm font-semibold disabled:opacity-40 whitespace-nowrap`}>
            {actionLabel}
          </button>
        </div>
      </div>
    </>
  );
}
