'use client';
// أزرار التحكم في فردة الكاوتش — **تعريف واحد** بيتستعمل في كل مكان بيعرض فردة.
//
// كانت مكتوبة جوّه جدول صفحة الأصول. أول ما بقى فيه مكان تاني بيعرض نفس الفردة
// (ملف أصول العربية اللي بيتفتح من رقم الـ ١٤)، النسخ كان معناه إن أي قاعدة
// تتعدّل في مكان تفضل قديمة في التاني — والقواعد دي مش تجميلية: «نتيجة التجديد»
// بتظهر للفردة اللي تحت التجديد بس، و«بيع كخردة» للسكراب والتالف بس، والفردة
// النهائية (مباعة/معدومة) ما بيتعملهاش نقل ولا تعديل.
//
// فالمكوّن ده هو القاعدة نفسها. الصفحة بتبعت الأفعال، وهو بيقرّر مين يبان.
import { ArrowLeftRight, ArrowDownToLine, Pencil, Trash2, Repeat, Boxes } from 'lucide-react';

export type TireLike = {
  _id: string; serial: string; status: string; condition?: string;
  plate?: string | null; positionLabel?: string; section?: string;
};

export type TireActionHandlers = {
  onMove: (t: TireLike) => void;        // تركيب على شاحنة / نقل وتبديل
  onDismount: (t: TireLike) => void;    // إنزال بكل وجهاته + بديل
  onRenewal: (t: TireLike) => void;     // نتيجة التجديد: مجدد أو سكراب
  onStatus: (t: TireLike) => void;      // نقل الحالة
  onEdit: (t: TireLike) => void;
  onRetire: (t: TireLike) => void;      // تالفة / سكراب
  onSell: (t: TireLike) => void;        // بيع كخردة
};

// الحالات النهائية: الفردة خرجت من الدورة خلاص، فمفيش تركيب ولا إنزال ولا تعديل.
export const isTerminalTire = (status: string) => status === 'retired' || status === 'sold';

export default function TireActions({ tire, ar, busy, admin, on, compact = false }: {
  tire: TireLike; ar: boolean; busy?: boolean; admin: boolean;
  on: TireActionHandlers; compact?: boolean;
}) {
  if (!admin) return null;
  const t = tire;
  const terminal = isTerminalTire(t.status);
  const icon = compact ? 'p-1 rounded-md' : 'p-1.5 rounded-md';

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {/* المخزن/الجديد/المجدّد: فردة غير مركّبة ⇐ زرّ تركيب واضح (مش أيقونة مبهمة) */}
      {!terminal && t.status === 'spare' && (
        <button type="button" onClick={() => on.onMove(t)}
          className="px-2.5 py-1 rounded-md bg-orange-50 hover:bg-orange-100 text-[#f37121] text-[11px] font-semibold inline-flex items-center gap-1">
          <ArrowDownToLine className="w-3.5 h-3.5" />{ar ? 'تركيب على شاحنة' : 'Mount on truck'}
        </button>
      )}
      {/* المركّبة: نقل/تبديل مع فردة تانية */}
      {!terminal && t.status === 'mounted' && (
        <button type="button" title={ar ? 'نقل / تبديل' : 'Move / swap'} onClick={() => on.onMove(t)}
          className={`${icon} hover:bg-blue-50 text-slate-500 hover:text-blue-600`}>
          <ArrowLeftRight className="w-4 h-4" />
        </button>
      )}
      {/* الإنزال بكل وجهاته (مخزن بنسبة٪ / تجديد / تالفة / سكراب) + بديل مكانها */}
      {!terminal && t.status === 'mounted' && (
        <button type="button" disabled={busy} onClick={() => on.onDismount(t)}
          title={ar ? 'إنزال (مخزن / تجديد / تالفة / سكراب) + بديل' : 'Dismount + optional replacement'}
          className={`${icon} hover:bg-amber-50 text-slate-500 hover:text-amber-600`}>
          <ArrowDownToLine className="w-4 h-4" />
        </button>
      )}
      {!terminal && t.status === 'in_repair' && (
        <button type="button" disabled={busy} onClick={() => on.onRenewal(t)}
          title={ar ? 'نتيجة التجديد: مجدد أو سكراب' : 'Renewal result'}
          className="px-2 py-1 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-medium">
          {ar ? 'نتيجة التجديد' : 'Result'}
        </button>
      )}
      {/* نقل الحالة — متاح دائمًا لكل الحالات (بما فيها النهائية، مثلًا رجوع للمخزن) */}
      <button type="button" disabled={busy} onClick={() => on.onStatus(t)}
        title={ar ? 'نقل الحالة (مخزن / تجديد / سكراب / تالف / معدوم / مباع)' : 'Change status'}
        className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1">
        <Repeat className="w-3.5 h-3.5" />{ar ? 'نقل الحالة' : 'Status'}
      </button>
      {/* بيع كخردة — لأي فردة سكراب أو تالفة (مركّبة كانت أو نهائية) */}
      {(t.status === 'scrap' || t.status === 'damaged') && (
        <button type="button" disabled={busy} onClick={() => on.onSell(t)}
          className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold inline-flex items-center gap-1">
          <Boxes className="w-3.5 h-3.5" />{ar ? 'بيع كخردة' : 'Sell'}
        </button>
      )}
      {!terminal && (
        <button type="button" title={ar ? 'تعديل' : 'Edit'} onClick={() => on.onEdit(t)}
          className={`${icon} hover:bg-slate-100 text-slate-500 hover:text-slate-800`}>
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {!terminal && t.status !== 'in_repair' && t.status !== 'scrap' && (
        <button type="button" disabled={busy} onClick={() => on.onRetire(t)}
          title={ar ? 'تالفة / سكراب' : 'Damaged / scrap'}
          className={`${icon} hover:bg-red-50 text-slate-500 hover:text-red-600`}>
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
