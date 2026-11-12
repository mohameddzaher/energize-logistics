'use client';
// Archive: vehicles whose service ended. They keep every field and their full history and open read-only in the vehicle file; permitted roles restore them to the registry.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Archive, Search, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { useVehicleLifecycle, RestoreButton } from '@/components/vehicles/VehicleLifecycle';
import { fmtDate, canEditVehicles, type VReg } from '@/lib/vehicleRegistry';

type ArchivedRow = VReg & { authorizationEntries?: number; renewalEntries?: number; accidentCount?: number; brandAr?: string; modelAr?: string; ownerNameAr?: string };

export default function VehicleArchivePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify } = useDialog();
  const canEdit = canEditVehicles(user);
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [q, setQ] = useState('');

  const guard = useLatestRequest();
  const load = useCallback(() => {
    const token = guard.begin();
    api.get<{ vehicles: ArchivedRow[] }>('/api/vehicle-registry/archive')
      .then((r) => { if (guard.isCurrent(token)) setRows(r.vehicles || []); })
      .catch((e: any) => { if (guard.isCurrent(token)) { setRows([]); notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', load);
  const lc = useVehicleLifecycle({ ar, onChanged: load });

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows || []).filter((v) => !k || [v.plateNumber, v.serialNumber, v.chassisNumber, v.brandAr, v.modelAr, v.sectorAr, v.ownerNameAr, v.archive?.reason, v.archive?.byName]
      .some((x) => String(x || '').toLowerCase().includes(k)));
  }, [rows, q]);

  if (!rows) return <Spinner />;

  const cols: ExportColumn[] = [
    { header: t('رقم اللوحة', 'Plate'), key: 'plateNumber', width: 14 },
    { header: t('الرقم التسلسلي', 'Serial'), key: 'serialNumber', width: 16 },
    { header: t('الماركة', 'Brand'), key: 'brandAr', width: 14 },
    { header: t('القطاع', 'Sector'), key: 'sectorAr', width: 14 },
    { header: t('المالك', 'Owner'), key: 'ownerNameAr', width: 24 },
    { header: t('تاريخ إنهاء الخدمة', 'End date'), key: 'archive', transform: (a) => (a?.endDate ? String(a.endDate).slice(0, 10) : ''), width: 14 },
    { header: t('السبب', 'Reason'), key: 'archive', transform: (a) => a?.reason || '', width: 30 },
    { header: t('بواسطة', 'By'), key: 'archive', transform: (a) => a?.byName || '', width: 18 },
  ];

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Archive className="w-5 h-5" />} title={t('الأرشيف', 'Archive')}
        subtitle={t(`${rows.length} مركبة انتهت خدمتها — محفوظة بكلّ بياناتها وسجلّها`, `${rows.length} vehicles out of service — kept with all their data and history`)}>
        <ExportMenu fileName="vehicles-archive" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الأرشيف', 'Archive'), rows: shown, columns: cols }] }]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('اللوحة / الماركة / السبب…', 'plate / brand / reason…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-80 max-w-full" />
        </div>
        <span className="ms-auto text-xs text-slate-400">{shown.length} {t('مركبة', 'vehicles')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full min-w-[1100px] text-[13px]">
            <thead className="bg-slate-900 text-slate-300 text-xs"><tr>
              {[t('رقم اللوحة', 'Plate'), t('المركبة', 'Vehicle'), t('القطاع', 'Sector'), t('المالك', 'Owner'),
                t('تاريخ إنهاء الخدمة', 'End date'), t('السبب', 'Reason'), t('بواسطة', 'By'), t('السجلّ', 'History'), '']
                .map((h, i) => <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((v) => (
                <tr key={v._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                    <Link href={`/system/vehicles/registry/${v._id}`} className="inline-flex items-center gap-1 hover:text-[#f37121]"><bdi>{v.plateNumber}</bdi><ExternalLink className="w-3 h-3 opacity-50" /></Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{[v.brandAr, v.modelAr, v.modelYear].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.sectorAr || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.ownerNameAr || '—'}</td>
                  <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{v.archive?.endDate ? fmtDate(v.archive.endDate) : '—'}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-[280px] truncate" title={v.archive?.reason || ''}>{v.archive?.reason || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{v.archive?.byName || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-[12px]">
                    {t(`${v.authorizationEntries || 0} تفويض · ${v.renewalEntries || 0} تجديد · ${v.accidentCount || 0} حادث`,
                      `${v.authorizationEntries || 0} auth. · ${v.renewalEntries || 0} renewals · ${v.accidentCount || 0} accidents`)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {canEdit && <RestoreButton ar={ar} onClick={() => lc.restore(v)} />}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">{t('لا مركباتَ في الأرشيف', 'No archived vehicles')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>
      {lc.element}
    </div>
  );
}
