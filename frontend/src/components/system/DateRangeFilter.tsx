'use client';
// فلترُ مدًى زمنيّ موحَّد — يُفتح بالضغط، و«إلى» الفارغة تعني «حتى اليوم».
//
// ثلاث عللٍ كانت فيه:
//
// ١) أيقونةُ التقويم مقلوبة اللون (`invert`) على خلفيةٍ بيضاء، فتصير بيضاء على
//    بيضاء — موجودةً وغيرَ مرئيّة. فيظنّ المستخدم أنّ الحقل نصٌّ يُكتب بالإصبع.
//
// ٢) والضغط على الحقل نفسه لا يفتح التقويم في متصفّحات كثيرة — يفتحه الضغط على
//    الأيقونة وحدها، وهي غير مرئيّة. و`showPicker()` يفتحه من أيّ موضع.
//
// ٣) و«من» وحدها بلا «إلى» كانت تُقرأ مدًى مفتوحًا بلا نهاية، والمقصود دائمًا
//    «حتى اليوم». فصار المكتوب في الشاشة هو المعنى: تظهر «حتى اليوم» مكان
//    الفراغ، ولا يُترك للمستخدم أن يخمّن.
import { useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';

/** يفتح التقويم الأصليّ من أيّ موضعٍ في الحقل، لا من الأيقونة وحدها. */
function openPicker(el: HTMLInputElement | null) {
  if (!el) return;
  try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); }
  catch { el.focus(); }
}

export function DateField({ value, onChange, label, max, min, ar, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  max?: string;
  min?: string;
  ar: boolean;
  /** ما يُكتب حين تكون الخانة فارغة — «حتى اليوم» مثلًا. */
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <input
        ref={ref}
        type="date"
        title={label}
        aria-label={label}
        value={value}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => openPicker(ref.current)}
        className="peer w-[168px] ps-9 pe-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-[13px] font-semibold cursor-pointer
                   focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 focus:border-[#f37121]
                   [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => openPicker(ref.current)}
        aria-label={label}
        className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400 peer-focus:text-[#f37121] hover:text-[#f37121] transition-colors"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      {!value && placeholder && (
        <span
          onClick={() => openPicker(ref.current)}
          className="absolute inset-y-0 start-9 flex items-center text-[13px] text-slate-400 pointer-events-none"
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}

/**
 * مدًى كامل: «من» و«إلى» وزرُّ مسحٍ يظهر حين يكون فيه ما يُمسح.
 * و«إلى» الفارغة تُعرَض «حتى اليوم» — وهو ما يفعله الخادم فعلًا.
 */
export default function DateRangeFilter({ from, to, onFrom, onTo, ar, className = '' }: {
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  ar: boolean; className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <DateField ar={ar} value={from} onChange={onFrom} max={to || undefined}
        label={ar ? 'من تاريخ' : 'From date'} placeholder={ar ? 'من البداية' : 'From the start'} />
      <span className="text-slate-400 text-[13px] font-semibold">{ar ? '←' : '→'}</span>
      {/* ولا يُقيَّد «إلى» باليوم: مَن يكتب تاريخًا أبعد يُقصَر عليه صامتًا
          فيقرأ عددًا غير الذي طلبه ولا يعرف لماذا. الخادمُ يقف عند اللحظة
          حين تكون الخانة فارغة، وهذا يكفي. */}
      <DateField ar={ar} value={to} onChange={onTo} min={from || undefined}
        label={ar ? 'إلى تاريخ' : 'To date'} placeholder={ar ? 'حتى اليوم' : 'Until today'} />
      {(from || to) && (
        <button type="button" onClick={() => { onFrom(''); onTo(''); }}
          title={ar ? 'مسح المدى' : 'Clear range'}
          className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
