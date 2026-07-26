'use client';
// بطاقة بند مؤجّل — التصميم الموحّد أينما ظهرت البنود المؤجلة (لوحة الأسطول
// وملف المركبة): سطر العنوان (البند + اللوحة + شارة المتبقي)، ثم ثلاث خانات
// أرقام واضحة (العداد الحالي / الاستحقاق عند / الاستحقاق خلال)، ثم تذييل فيه
// بيانات التأجيل وزر التسوية.
import { fmtNum, fmtDate, checklistLabel, type Lang, type Deferral } from '@/lib/ls2';

function MiniCell({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'amber' | 'red' }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 text-center ${accent === 'red' ? 'bg-red-50' : accent === 'amber' ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className={`text-xs font-bold tabular-nums mt-0.5 ${accent === 'red' ? 'text-red-700' : accent === 'amber' ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function DeferralCard({ d, lang, admin, plate, currentOdoFallback, onPlateClick, onSettle }: {
  d: Deferral;
  lang: Lang;
  admin: boolean;
  plate?: string;                  // shown as a chip on the fleet-wide list
  currentOdoFallback?: number | null;
  onPlateClick?: () => void;
  onSettle?: () => void;
}) {
  const ar = lang === 'ar';
  const km = ar ? 'كم' : 'km';
  const over = d.remainingKm != null && d.remainingKm < 0;
  const odoNow = d.currentOdometerKm ?? currentOdoFallback ?? null;

  // «الاستحقاق خلال» — بحسب معدل مشي الشاحنة الفعلي.
  const n = d.estimatedDaysLeft;
  const dueIn = over
    ? (ar ? 'مستحق الآن' : 'due now')
    : n == null
      ? '—'
      : ar
        ? (n === 0 ? '≈ أقل من يوم' : n === 1 ? '≈ يوم تقريبًا' : n === 2 ? '≈ يومين تقريبًا' : `≈ ${n} يومًا تقريبًا`)
        : (n === 0 ? '≈ under a day' : `≈ ~${n} day${n === 1 ? '' : 's'}`);
  const dueInSub = !over && n != null && d.estimatedDueDate ? fmtDate(d.estimatedDueDate, lang) : undefined;

  return (
    <div className={`rounded-xl border bg-white p-3.5 shadow-sm ${over ? 'border-red-200' : 'border-amber-200/80'}`}>
      {/* البند + اللوحة + شارة المتبقي */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
            <span className="truncate">{checklistLabel(d, lang)}</span>
            {plate && (
              <button type="button" onClick={onPlateClick}
                className="shrink-0 px-2 py-0.5 rounded-full bg-[#f37121]/10 hover:bg-[#f37121]/20 text-[#f37121] text-[11px] font-bold">
                {plate}
              </button>
            )}
          </p>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{d.intervalName}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tabular-nums whitespace-nowrap ${over ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
          {d.remainingKm == null
            ? '—'
            : over
              ? (ar ? `متأخر ${fmtNum(Math.abs(d.remainingKm))} ${km}` : `${fmtNum(Math.abs(d.remainingKm))} ${km} overdue`)
              : (ar ? `متبقٍّ ${fmtNum(d.remainingKm)} ${km}` : `${fmtNum(d.remainingKm)} ${km} left`)}
        </span>
      </div>

      {/* ثلاث خانات أرقام */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <MiniCell label={ar ? 'العداد الحالي' : 'Odometer now'} value={odoNow != null ? `${fmtNum(odoNow)} ${km}` : '—'} />
        <MiniCell label={ar ? 'الاستحقاق عند' : 'Due at'} value={`${fmtNum(d.dueAtOdometerKm)} ${km}`} />
        <MiniCell label={ar ? 'الاستحقاق خلال' : 'Due in'} value={dueIn} sub={dueInSub} accent={over ? 'red' : 'amber'} />
      </div>

      {/* بيانات التأجيل + زر التسوية */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-slate-100">
        <p className="text-[11px] text-slate-500 truncate">
          {ar ? 'أُجِّل بتاريخ' : 'Deferred on'} {fmtDate(d.deferredAt, lang)}
          {d.deferKm != null && <> · +{fmtNum(d.deferKm)} {km}</>}
          {d.note && <> · {d.note}</>}
        </p>
        {admin && onSettle && (
          <button type="button" onClick={onSettle}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-xs font-medium">
            {ar ? 'تسوية البند' : 'Settle'}
          </button>
        )}
      </div>
    </div>
  );
}
