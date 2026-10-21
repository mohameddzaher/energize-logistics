'use client';
/**
 * «كشوف التشغيل المرتبطة» في صفحة معاملة التخليص.
 *
 * كلُّ كشف تخريجٍ نقل حاويةً من هذه المعاملة — من خانات النقل هنا، أو سندُه
 * بوليصتُها أو حاويتُها، أو ربطه التشغيلُ بيده — ومعه أين وصل: فُوتر؟ حُصِّل؟
 * والأرقامُ المكتوبةُ في خانات النقل ولم يصل كشفُها بعدُ تُذكر وحدَها.
 *
 * ويتحدّث وحدَه: `customs:opsLinks` حين يتغيّر ربطٌ، و`collections:changed`
 * حين تُفوتَر الكشوفُ أو تُحصَّل. راجع backend/src/services/customsOpsLink.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { canAccessSection } from '@/lib/sections';
import { money, dt } from '@/lib/collections';
import { viaLabel } from '@/components/customs/CustomsLinkBadge';

type Billing = 'collected' | 'invoiced' | 'cash_pending' | 'not_invoiced';
type Rep = {
  _id: string; reportNumber: string; reportDate: string | null; route: string; carNumber: string; driverName: string;
  paymentType: string; invoiceNumber: string; invoiceDate: string | null; collectionDate: string | null;
  billing: Billing; via: string; containers: string[]; sellingValue?: number;
};
type Resp = {
  reports: Rep[];
  pendingRefs: { reportNumber: string; state: 'not_arrived' | 'linked_elsewhere'; otherRef?: string }[];
  summary: { total: number; collected: number; invoiced: number; cashPending: number; notInvoiced: number; selling?: number };
};

const BILLING: Record<Billing, [string, string, string]> = {
  collected: ['محصَّل', 'Collected', 'bg-emerald-50 text-emerald-700'],
  invoiced: ['مفوتر — لم يُحصَّل', 'Invoiced — open', 'bg-amber-50 text-amber-700'],
  cash_pending: ['نقديّ — لم يُحصَّل', 'Cash — open', 'bg-amber-50 text-amber-700'],
  not_invoiced: ['لم يُفوتَر', 'Not invoiced', 'bg-slate-100 text-slate-600'],
};

export default function LinkedOpsReports({ clearanceId, ar }: { clearanceId: string; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const canOpenOps = user?.role === 'super_admin' || canAccessSection(user?.permissions, 'Operations');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState('');
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<Resp>(`/api/customs-clearance/${clearanceId}/ops-reports`);
      if (guard.isCurrent(mine)) { setData(d); setError(''); }
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || t('تعذّر التحميل', 'Could not load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearanceId, guard]);
  useEffect(() => { load(); }, [load]);

  useSocket('customs:opsLinks', useCallback((d: any) => {
    if (!d || !Array.isArray(d.clearanceIds) || d.clearanceIds.includes(clearanceId)) load();
  }, [clearanceId, load]));
  useSocket('collections:changed', useCallback(() => { load(); }, [load]));
  useSocket('customs:updated', useCallback((d: any) => {
    const id = d?.clearance?._id || d?.id;
    if (!id || String(id) === clearanceId) load();
  }, [clearanceId, load]));

  const s = data?.summary;
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-500" /> {t('كشوف التشغيل المرتبطة', 'Linked operations reports')}
          {s ? <span className="text-slate-400 font-normal">({s.total})</span> : null}
        </h2>
        {s && s.total > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {s.collected > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.collected[2]}`}>{t('محصَّل', 'Collected')} {s.collected}</span>}
            {s.invoiced + s.cashPending > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.invoiced[2]}`}>{t('لم يُحصَّل', 'Open')} {s.invoiced + s.cashPending}</span>}
            {s.notInvoiced > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.not_invoiced[2]}`}>{t('لم يُفوتَر', 'Not invoiced')} {s.notInvoiced}</span>}
            {typeof s.selling === 'number' && <span className="rounded px-1.5 py-0.5 bg-slate-50 text-slate-600">{t('قيمة البيع', 'Selling')} {money(s.selling)}</span>}
            {canOpenOps && (
              <Link href={`/system/operations?customs=${clearanceId}`} className="text-[#f37121] hover:underline ms-1">
                {t('عرضها في سير العمل', 'Open in the workflow')}
              </Link>
            )}
          </div>
        )}
      </div>

      {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}
      {!error && !data && <p className="px-5 py-4 text-sm text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {data && !data.reports.length && !data.pendingRefs.length && (
        <p className="px-5 py-4 text-sm text-slate-500">
          {t('لا كشوفَ تشغيلٍ مرتبطة. يُربط الكشفُ حين يُكتب رقمُه في خانة نقل الحاوية بسيّارة الشركة، أو حين يكون «رقم السند» فيه رقمَ البوليصة.',
            'No linked reports. A report links when its number is written in a container transport entry, or when its document number is this B/L.')}
        </p>
      )}

      {data && data.reports.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {[t('رقم الكشف', 'Report'), t('التاريخ', 'Date'), t('المسار', 'Route'), t('السيارة', 'Vehicle'),
                  t('الحاويات', 'Containers'), t('الفاتورة', 'Invoice'), t('حالة التحصيل', 'Collection'),
                  ...(typeof s?.selling === 'number' ? [t('قيمة البيع', 'Selling')] : []), t('مصدر الربط', 'Source')].map((h) => (
                  <th key={h} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {canOpenOps
                      ? <Link href={`/system/operations/${r._id}`} className="text-[#f37121] hover:underline">{r.reportNumber}</Link>
                      : <span className="text-slate-900">{r.reportNumber}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.reportDate)}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.route || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.carNumber || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.containers.length
                      ? <span dir="ltr" className="font-mono text-xs text-slate-700">{r.containers.join(', ')}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {r.paymentType === 'cash' ? t('نقديّ', 'Cash') : (r.invoiceNumber || <span className="text-slate-300">—</span>)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BILLING[r.billing][2]}`}>{ar ? BILLING[r.billing][0] : BILLING[r.billing][1]}</span>
                    {r.collectionDate && <span className="ms-1.5 text-[11px] text-slate-400">{dt(r.collectionDate)}</span>}
                  </td>
                  {typeof s?.selling === 'number' && <td className="px-3 py-2 tabular-nums text-slate-900">{money(r.sellingValue)}</td>}
                  <td className="px-3 py-2 text-[11px] text-slate-500">{viaLabel(r.via, ar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pendingRefs.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
          {data.pendingRefs.map((p) => (
            <p key={p.reportNumber}>
              <span className="font-semibold text-slate-800">{p.reportNumber}</span>{' — '}
              {p.state === 'not_arrived'
                ? t('مكتوبٌ في خانة النقل ولم يصل كشفُه من منصّة التشغيل بعد؛ يُربط حين يصل.', 'Written in a transport entry; the report has not arrived from the platform yet.')
                : t(`ربطه التشغيلُ يدويًّا بالمعاملة ${p.otherRef || ''}.`, `Linked by hand to ${p.otherRef || 'another clearance'}.`)}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
