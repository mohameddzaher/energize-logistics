'use client';
/**
 * A tire's status history (backend tireStatusHistory): who changed its state or condition %, when, from what to what, why,
 * and the vehicle it was on at the time (head or trailer, trailer number). Used by the tire profile and the vehicle profile.
 */
import { ArrowLeft, ArrowRight, Activity } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu from '@/components/ls2/ExportMenu';

export interface StatusRow {
  _id: string; date: string; recordedAt?: string; by: string; action: string;
  fromAr: string; fromEn: string; toAr: string; toEn: string; percentFrom: number | null; percentTo: number | null;
  reason: string; notes: string; vehiclePlate: string; vehicleSideAr: string; vehicleSideEn: string; trailerNumber: string;
  serial?: string;
}

const when = (v?: string) => (v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const pct = (v: number | null) => (v == null ? '' : `${v}%`);

export default function TireStatusHistory({ rows, ar, title, showSerial }: { rows: StatusRow[]; ar: boolean; title?: string; showSerial?: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const Arrow = ar ? ArrowLeft : ArrowRight;
  const state = (s: string, p: number | null) => [s, pct(p)].filter(Boolean).join(' · ') || '—';
  const head = [
    ...(showSerial ? [t('الكاوتش', 'Tire')] : []),
    t('الوقت', 'When'), t('من', 'From'), '', t('إلى', 'To'), t('السيارة وقتها', 'Vehicle then'), t('السبب', 'Reason'), t('بواسطة', 'By'),
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <p className="flex items-center gap-1.5 text-[14.5px] font-extrabold text-slate-900">
          <Activity className="h-4 w-4 text-[#f37121]" />{title || t('سجلّ حالة الكاوتش', 'Tire status history')}
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11.5px] font-bold text-slate-700">{rows.length}</span>
        </p>
        {rows.length > 0 && (
          <ExportMenu fileName={title || 'tire-status-history'} lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('تصدير', 'Export'), sheets: [{ name: t('سجل الحالة', 'Status history'), rows, columns: [
            ...(showSerial ? [{ header: t('السيريال', 'Serial'), key: 'serial', width: 16 }] : []),
            { header: t('تاريخ العملية', 'Operation date'), key: 'date', transform: (v: string) => when(v), width: 18 },
            { header: t('وقت التسجيل', 'Recorded at'), key: 'recordedAt', transform: (v: string) => when(v), width: 18 },
            { header: t('الحالة قبل', 'From'), key: 'fromAr', transform: (_: any, r: StatusRow) => state(ar ? r.fromAr : r.fromEn, r.percentFrom), width: 18 },
            { header: t('الحالة بعد', 'To'), key: 'toAr', transform: (_: any, r: StatusRow) => state(ar ? r.toAr : r.toEn, r.percentTo), width: 18 },
            { header: t('السيارة', 'Vehicle'), key: 'vehiclePlate', width: 14 },
            { header: t('الموضع', 'Side'), key: 'vehicleSideAr', transform: (_: any, r: StatusRow) => (ar ? r.vehicleSideAr : r.vehicleSideEn), width: 10 },
            { header: t('رقم التيدر', 'Trailer no.'), key: 'trailerNumber', width: 10 },
            { header: t('السبب', 'Reason'), key: 'reason', width: 24 },
            { header: t('ملاحظات', 'Notes'), key: 'notes', width: 24 },
            { header: t('بواسطة', 'By'), key: 'by', width: 18 },
          ] }] }]} />
        )}
      </div>
      <ScrollX className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0"><tr>{head.map((h, i) => <th key={`${h}${i}`} className="whitespace-nowrap px-3 py-2.5 text-start text-[11.5px] font-bold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50">
                {showSerial && <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-slate-700">{r.serial}</td>}
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-slate-600">{when(r.date)}</td>
                <td className="px-3 py-2.5 text-slate-600">{state(ar ? r.fromAr : r.fromEn, r.percentFrom)}</td>
                <td className="px-1 py-2.5 text-slate-300"><Arrow className="h-3.5 w-3.5" /></td>
                <td className="px-3 py-2.5 font-semibold text-slate-900">{state(ar ? r.toAr : r.toEn, r.percentTo)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-slate-700">
                  {r.vehiclePlate ? <>{r.vehiclePlate}{r.vehicleSideAr && <span className="ms-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{ar ? r.vehicleSideAr : r.vehicleSideEn}{r.trailerNumber ? ` ${r.trailerNumber}` : ''}</span>}</> : '—'}
                </td>
                <td className="max-w-[240px] truncate px-3 py-2.5 text-[12px] text-slate-600" title={[r.reason, r.notes].filter(Boolean).join(' · ')}>{r.reason || r.notes || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-slate-600">{r.by || '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={head.length} className="py-10 text-center text-slate-400">{t('لم تتغيّر حالة الكاوتش بعد', 'No status change yet')}</td></tr>}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}
