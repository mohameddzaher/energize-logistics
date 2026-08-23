'use client';
// سجلّات القسم — المُلّاك والمفوَّضون ومزوّدو التتبّع والأجهزة وشرائح الوقود.
//
// كلها مبنيّة من المركبات نفسها لا من جداول موازية: المالك ليس كيانًا مستقلًّا،
// هو اسمٌ على مركبات. ولو خُزِّن مرتين لاختلف عدد مركباته بين الشاشتين أول ما
// تُنقَل مركبة — والبناء من المصدر يجعل هذا مستحيلًا لا نادرًا.
//
// وكل صفّ مدخل: الضغط على عدد مركباته يفتحها مفلترةً عليه.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import { Boxes } from 'lucide-react';
import { getRegisters, fmtDate, daysText, money, STATE_META, stateLabel } from '@/lib/vehicleRegistry';

const TABS = ['owners', 'authorizedPersons', 'gpsProviders', 'gpsDevices', 'gpsUnits', 'fuelCards'] as const;
type Tab = typeof TABS[number];

export default function Page() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<Awaited<ReturnType<typeof getRegisters>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('owners');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try { setD(await getRegisters()); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const openVehicles = (f: Record<string, string>) => {
    const p = new URLSearchParams(f).toString();
    router.push(`/system/vehicles/registry${p ? `?${p}` : ''}`);
  };

  if (loading) return <Spinner />;
  const reg = d?.registers?.[tab];
  const rows: any[] = reg?.items || [];

  // الشرائح تختلف باختلاف السجلّ — لكل سؤاله.
  const CHIPS: Chip[] = tab === 'gpsUnits'
    ? [
      { key: '', label: t('الكل', 'All') },
      { key: 'expired', label: t('اشتراكه منتهٍ', 'Subscription expired'), tone: 'red', test: (x: any) => x.state === 'expired' },
      { key: 'soon', label: t('يقترب', 'Expiring'), tone: 'amber', test: (x: any) => ['critical', 'warning', 'upcoming'].includes(x.state) },
      { key: 'valid', label: t('ساري', 'Valid'), tone: 'green', test: (x: any) => x.state === 'valid' },
      { key: 'stolen', label: t('الجهاز مسروق', 'Device stolen'), tone: 'violet', test: (x: any) => /مسروق/.test(x.deviceStatusAr || '') },
    ]
    : tab === 'fuelCards'
      ? [
        { key: '', label: t('الكل', 'All') },
        { key: 'active', label: t('نشطة', 'Active'), tone: 'green', test: (x: any) => /نشط/.test(x.statusAr || '') && !/غير/.test(x.statusAr || '') },
        { key: 'inactive', label: t('غير نشطة', 'Inactive'), tone: 'amber', test: (x: any) => /غير نشط|موقوف/.test(x.statusAr || '') },
        { key: 'noLimit', label: t('بلا حدّ استهلاك', 'No limit'), tone: 'slate', test: (x: any) => x.limitSar == null },
      ]
      : [
        { key: '', label: t('الكل', 'All') },
        { key: 'many', label: t('أكثر من ٥ مركبات', 'More than 5 vehicles'), tone: 'blue', test: (x: any) => (x.vehicles || 0) > 5 },
        { key: 'withExpired', label: t('عليها مركبات منتهية', 'Has expired vehicles'), tone: 'red', test: (x: any) => (x.expired || 0) > 0 },
        { key: 'one', label: t('مركبة واحدة', 'Single vehicle'), tone: 'slate', test: (x: any) => (x.vehicles || 0) === 1 },
      ];

  const search = (x: any) => [x.value, x.plateNumber, x.iqamaNumber, x.jobTitleAr, x.deviceModel, x.provider, x.commercialRegistration, x.statusAr];
  const f = useChipFilter(rows, CHIPS, filter, q, search);

  const cols: ExportColumn[] = tab === 'gpsUnits'
    ? [
      { header: t('السيريال', 'Serial'), key: 'value', width: 22 },
      { header: t('اللوحة', 'Plate'), key: 'plateNumber', width: 16 },
      { header: t('الجهاز', 'Device'), key: 'deviceModel', width: 22 },
      { header: t('المزوّد', 'Provider'), key: 'provider', width: 16 },
      { header: t('ينتهي في', 'Expires'), key: 'expiryDate', transform: (v) => fmtDate(v), width: 14 },
    ]
    : tab === 'fuelCards'
      ? [
        { header: t('رقم الشريحة', 'Chip'), key: 'value', width: 14 },
        { header: t('اللوحة', 'Plate'), key: 'plateNumber', width: 16 },
        { header: t('اللوحة على الفاتورة', 'Plate on invoice'), key: 'plateOnInvoiceAr', width: 20 },
        { header: t('الحالة', 'Status'), key: 'statusAr', width: 12 },
        { header: t('الحدّ', 'Limit'), key: 'limitSar', width: 10 },
      ]
      : [
        { header: t('الاسم', 'Name'), key: 'value', width: 34 },
        { header: t('المركبات', 'Vehicles'), key: 'vehicles', width: 10 },
        { header: t('منها منتهية', 'Expired'), key: 'expired', width: 12 },
      ];

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />}
        title={t('سجلّات قسم المركبات', 'Vehicle registers')}
        subtitle={t('المُلّاك والمفوَّضون وأجهزة التتبّع وشرائح الوقود — كلها مبنيّة من المركبات نفسها',
                    'Owners, authorized persons, GPS units and fuel cards — all built from the vehicles themselves')}>
        <ExportMenu fileName={`vehicle-${tab}`} lang={lang as 'ar' | 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: reg?.ar || tab, rows: f.shown, columns: cols }] }]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((k) => (
          <button key={k} onClick={() => { setTab(k); setFilter(''); setQ(''); }}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border whitespace-nowrap ${
              tab === k ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
            {ar ? d?.registers?.[k]?.ar : d?.registers?.[k]?.en}
            <span className={`ms-1.5 px-1.5 py-0.5 rounded text-[10.5px] font-bold tabular-nums ${
              tab === k ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>{d?.totals?.[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <FilterBar chips={CHIPS} counts={f.counts} active={filter} onChange={setFilter}
        query={q} onQuery={setQ} placeholder={t('بحث…', 'Search…')}
        shown={f.shown.length} total={rows.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {(tab === 'gpsUnits'
                  ? [t('السيريال', 'Serial'), t('اللوحة', 'Plate'), t('الجهاز', 'Device'), t('المزوّد', 'Provider'), t('حالة الجهاز', 'Device status'), t('ينتهي في', 'Expires'), t('المتبقي', 'Left')]
                  : tab === 'fuelCards'
                    ? [t('رقم الشريحة', 'Chip'), t('اللوحة', 'Plate'), t('اللوحة على الفاتورة', 'On invoice'), t('الحالة', 'Status'), t('نوع الاستهلاك', 'Type'), t('الحدّ', 'Limit'), t('القطاع', 'Sector')]
                    : [t('الاسم', 'Name'), t('تفاصيل', 'Details'), t('المركبات', 'Vehicles'), t('منها منتهية', 'Expired')]
                ).map((h, i) => <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {f.shown.map((x: any, i: number) => {
                if (tab === 'gpsUnits') {
                  const m = STATE_META[x.state] || STATE_META.valid;
                  return (
                    <tr key={i} className="hover:bg-slate-50 text-center">
                      <td className="px-3 py-2.5 font-mono text-[12.5px] text-slate-900 whitespace-nowrap">{x.value}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => router.push(`/system/vehicles/registry/${x.vehicleId}`)}
                          className="font-semibold text-slate-900 hover:text-[#f37121] text-[13px] whitespace-nowrap">{x.plateNumber}</button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap">{x.deviceModel || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{x.provider || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700 text-[12.5px] whitespace-nowrap">{x.deviceStatusAr || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">{fmtDate(x.expiryDate)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${m.bg}`}>
                          {x.daysRemaining == null ? stateLabel(x.state, ar) : daysText(x.daysRemaining, ar)}
                        </span>
                      </td>
                    </tr>
                  );
                }
                if (tab === 'fuelCards') {
                  return (
                    <tr key={i} className="hover:bg-slate-50 text-center">
                      <td className="px-3 py-2.5 font-mono text-[12.5px] text-slate-900 whitespace-nowrap">{x.value}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => router.push(`/system/vehicles/registry/${x.vehicleId}`)}
                          className="font-semibold text-slate-900 hover:text-[#f37121] text-[13px] whitespace-nowrap">{x.plateNumber}</button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 text-[12.5px] whitespace-nowrap" dir="ltr">{x.plateOnInvoiceAr || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap">{x.statusAr || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{x.consumptionTypeAr || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">{x.limitSar != null ? money(x.limitSar) : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{x.sectorAr || '—'}</td>
                    </tr>
                  );
                }
                const details = [x.commercialRegistration, x.iqamaNumber, x.jobTitleAr,
                  ...(x.devices || []), ...(x.providers || [])].filter(Boolean).join(' · ');
                return (
                  <tr key={i} className="hover:bg-slate-50 text-center">
                    <td className="px-3 py-2.5 text-start text-slate-900 font-semibold text-[13px]">{x.value}</td>
                    <td className="px-3 py-2.5 text-start text-slate-700 text-[12px]">{details || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => openVehicles(x.filter)}
                        className="px-2 py-0.5 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 text-[12.5px] font-bold tabular-nums hover:bg-sky-100">
                        {x.vehicles}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {x.expired > 0
                        ? <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11.5px] font-bold tabular-nums">{x.expired}</span>
                        : <span className="text-slate-500">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!f.shown.length && (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-500">{t('لا نتائج', 'No results')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
