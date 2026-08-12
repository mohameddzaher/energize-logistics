'use client';
// تنبيهات المركبات — كل مستند منتهٍ أو قارب الانتهاء (حسب العتبات المضبوطة في
// الإعدادات)، مرتبة بالأقرب انتهاءً، وكل بند يفتح تفاصيل المركبة.
import { useState, useEffect, useCallback, useMemo } from 'react';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { AlertItem, statusColor, statusLabel, docLabel, DOC_TYPES, fmtDate, daysText } from '@/lib/vehicleRegistry';
import { BellRing, Settings } from 'lucide-react';

export default function VehicleRegistryAlerts() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const [data, setData] = useState<{ items: AlertItem[]; total: number; byStatus: Record<string, number>; byDoc: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/vehicle-registry/alerts')); } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // الحالة (منتهي/حرج/تحذير) بتتفلتر من الكروت الكبيرة فوق. الشرايح دي لنوع
  // المستند + البحث + «تنبيهه متقفول» — دي الفئة اللي كانت بتختفي في صمت.
  const byStatus = useMemo(() => (data?.items || []).filter((i) => (!status || i.status === status)), [data, status]);
  const DOC_CHIPS: Chip[] = useMemo(() => [
    { key: '', label: ar ? 'كل المستندات' : 'All documents' },
    ...DOC_TYPES.map((d) => ({
      key: d.key, label: ar ? d.ar : d.en, tone: 'blue' as const,
      test: (i: any) => i.docType === d.key,
    })),
    { key: 'muted', label: ar ? 'تنبيهه متقفول' : 'Alert muted', tone: 'slate' as const,
      test: (i: any) => i.alertEnabled === false },
  ], [ar]);
  const aSearch = useCallback((i: any) => [i.plateNumber, i.brandAr, i.modelAr, i.sectorAr, i.ownerNameAr, i.docAr], []);
  const aF = useChipFilter(byStatus, DOC_CHIPS, doc, q, aSearch);
  const items = aF.shown;

  if (loading) return <Spinner />;
  const bs = data?.byStatus || {};

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BellRing className="w-5 h-5" />} title={ar ? 'تنبيهات المركبات' : 'Vehicle Alerts'} subtitle={ar ? `${data?.total || 0} تنبيه` : `${data?.total || 0} alerts`}>
        <Link href="/system/vehicles/registry/settings" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><Settings className="w-4 h-4" /> {ar ? 'إعدادات التنبيهات' : 'Alert settings'}</Link>
      </PageHeader>

      <div className="grid grid-cols-3 gap-3">
        {(['expired', 'critical', 'warning'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(status === s ? '' : s)} className={`rounded-2xl border p-4 text-start transition ${status === s ? 'border-current shadow' : 'border-slate-200'}`} style={{ color: statusColor(s) }}>
            <p className="text-3xl font-bold">{bs[s] || 0}</p>
            <p className="text-xs mt-1 font-semibold">{statusLabel(s, ar)}</p>
          </button>
        ))}
      </div>

      <FilterBar
        chips={DOC_CHIPS} counts={aF.counts} active={doc} onChange={setDoc}
        query={q} onQuery={setQ} placeholder={ar ? 'لوحة · مالك · قطاع…' : 'Plate · owner · sector…'}
        shown={items.length} total={byStatus.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>{[ar ? 'اللوحة' : 'Plate', ar ? 'المركبة' : 'Vehicle', ar ? 'المستند' : 'Document', ar ? 'القطاع' : 'Sector', ar ? 'المالك' : 'Owner', ar ? 'تاريخ الانتهاء' : 'Expiry date', ar ? 'المتبقي' : 'Remaining', ar ? 'الحالة' : 'Status'].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, idx) => (
                <tr key={idx} className="hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/system/vehicles/registry/${i.vehicleId}`)}>
                  <td className="px-3 py-2.5 font-mono font-semibold text-[#f37121] whitespace-nowrap">{i.plateNumber}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{[i.brandAr, i.modelAr].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{docLabel(i.docType, ar)}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{i.sectorAr || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 max-w-[180px] truncate" title={i.ownerNameAr}>{i.ownerNameAr || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-mono">{fmtDate(i.expiryDate)}</td>
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: statusColor(i.status) }}>{daysText(i.daysRemaining, ar)}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: `${statusColor(i.status)}1a`, color: statusColor(i.status) }}>{statusLabel(i.status, ar)}</span></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">{ar ? 'لا توجد تنبيهات 🎉' : 'No alerts 🎉'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
