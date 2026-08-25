'use client';
// الانتهاءات — «وريني اللي هينتهي خلال كام يوم».
//
// المدة **رقم يكتبه المستخدم**، مش قايمة ثابتة. الأزرار الجاهزة (٣٠/٦٠/٩٠)
// اختصار للشائع بس، واللي عايز ٤٧ يوم يكتب ٤٧. الفلترة كلها بتحصل على السيرفر
// عشان الملخّص اللي فوق يفضل بيوصف نفس الصفوف اللي تحت بالظبط.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { CalendarClock, RefreshCw, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import SelectionBar from '@/components/ls2/SelectionBar';
import { RenewModal, BulkRenewModal } from '@/components/vehicles/RenewModals';
import {
  getExpiring, canEditVehicles, STATE_META, stateLabel, fmtDate, daysText,
  type ExpiringRow,
} from '@/lib/vehicleRegistry';

const QUICK = [7, 15, 30, 60, 90, 180];

function ExpiringInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify } = useDialog();

  const [within, setWithin] = useState<string>(sp?.get('withinDays') || '60');
  const [doc, setDoc] = useState(sp?.get('doc') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('includeExpired') !== '0');
  const [d, setD] = useState<Awaited<ReturnType<typeof getExpiring>> | null>(null);
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  // تجديد أكتر من مستند بنفس التاريخ. المفتاح مركّب (مركبة+مستند) لأن نفس
  // المركبة ممكن يكون عندها أكتر من مستند بينتهي — واحد يتجدّد والتاني لأ.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const rowKey = (r: any) => `${r.vehicleId}:${r.docKey}`;
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState<ExpiringRow | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await getExpiring({
        withinDays: within === '' ? undefined : within,
        doc, state, includeExpired: includeExpired ? '1' : '0',
      }));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [within, doc, state, includeExpired, notify]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const cols: ExportColumn[] = [
    { header: t('اللوحة', 'Plate'), key: 'plateNumber', width: 16 },
    { header: t('المستند', 'Document'), key: 'docAr', width: 18 },
    { header: t('ينتهي في', 'Expires'), key: 'expiryDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('الأيام المتبقية', 'Days left'), key: 'daysRemaining', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', transform: (v) => stateLabel(v, ar), width: 16 },
    { header: t('القطاع', 'Sector'), key: 'sectorAr', width: 16 },
    { header: t('الماركة', 'Brand'), key: 'brandAr', width: 16 },
    { header: t('المالك', 'Owner'), key: 'ownerNameAr', width: 26 },
    { header: t('المرجع', 'Reference'), key: 'reference', width: 22 },
  ];

  if (loading && !d) return <Spinner />;
  const rows = d?.rows || [];

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={() => router.push('/system/vehicles/registry/overview')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('النظرة الشاملة', 'Overview')}
      </button>

      <PageHeader
        icon={<CalendarClock className="w-5 h-5" />}
        title={t('الانتهاءات', 'Expiries')}
        subtitle={t('كل مستند له تاريخ — اختر المدة التي تهمّك', 'Every dated document — pick the window that matters to you')}
      >
        <ExportMenu fileName="vehicle-expiries" lang={lang as 'ar' | 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: t('الانتهاءات', 'Expiries'), rows, columns: cols }] }]} />
      </PageHeader>

      {/* المدة — الجزء اللي المستخدم بيتحكّم فيه */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} max={3650} value={within}
              onChange={(e) => setWithin(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm text-center font-bold" />
            <span className="text-sm text-slate-500">{t('يوم', 'days')}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setWithin(String(q))}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  within === String(q) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}>{q}</button>
            ))}
            <button onClick={() => setWithin('')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
              {t('الكل', 'All')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <select value={doc} onChange={(e) => setDoc(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{t('كل المستندات', 'All documents')}</option>
            {(d?.docs || []).map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="">{t('كل الحالات', 'All states')}</option>
            {['expired', 'critical', 'warning', 'upcoming', 'valid'].map((s) => (
              <option key={s} value={s}>{stateLabel(s, ar)}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
            {t('اعرض المنتهي بالفعل', 'Include already expired')}
          </label>
          <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('صف', 'rows')}</span>
        </div>
      </div>

      {/* ملخّص — بيتحسب على نفس الصفوف المعروضة */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {(['expired', 'critical', 'warning', 'upcoming', 'valid'] as const).map((k) => {
          const m = STATE_META[k];
          return (
            <button key={k} onClick={() => setState(state === k ? '' : k)}
              className={`text-start bg-white border rounded-xl p-3 shadow-sm transition-colors ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-2xl font-extrabold leading-none" style={{ color: m.color }}>{d?.summary?.[k] ?? 0}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">{ar ? m.ar : m.en}</p>
            </button>
          );
        })}
        <div className="bg-slate-900 rounded-xl p-3 text-white">
          <p className="text-2xl font-extrabold leading-none">{d?.summary?.total ?? 0}</p>
          <p className="text-[11px] text-slate-300 mt-1.5">{t('الإجمالي', 'Total')}</p>
        </div>
      </div>

      {/* توزيع على المستندات */}
      <div className="flex flex-wrap gap-1.5">
        {(d?.byDoc || []).map((x) => (
          <button key={x.key} onClick={() => setDoc(doc === x.key ? '' : x.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              doc === x.key ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {ar ? x.ar : x.en} <b>{x.count}</b>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {canEdit && (
                  <th className="px-3 py-3 w-9">
                    <input type="checkbox" className="accent-[#f37121]"
                      title={t('اختيار كل المعروض', 'Select all shown')}
                      checked={rows.length > 0 && rows.every((x) => picked.has(rowKey(x)))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        rows.forEach((x) => (e.target.checked ? n.add(rowKey(x)) : n.delete(rowKey(x))));
                        return n;
                      })} />
                  </th>
                )}
                {[t('اللوحة', 'Plate'), t('المستند', 'Document'), t('ينتهي في', 'Expires'),
                t('المتبقي', 'Left'), t('الحالة', 'State'), t('القطاع', 'Sector'), t('المالك', 'Owner'), ''].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const m = STATE_META[r.state] || STATE_META.valid;
                return (
                  <tr key={`${r.vehicleId}-${r.docKey}`}
                    className={picked.has(rowKey(r)) ? 'bg-orange-50/70 text-center' : 'hover:bg-slate-50 text-center'}>
                    {canEdit && (
                      <td className="px-3 py-2.5">
                        <input type="checkbox" className="accent-[#f37121]"
                          checked={picked.has(rowKey(r))}
                          onChange={() => setPicked((p) => {
                            const n = new Set(p); const k = rowKey(r);
                            if (n.has(k)) n.delete(k); else n.add(k);
                            return n;
                          })} />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <button onClick={() => router.push(`/system/vehicles/registry/${r.vehicleId}`)}
                        className="font-semibold text-slate-800 hover:text-[#f37121]">{r.plateNumber}</button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{ar ? r.docAr : r.docEn}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: m.color }}>{daysText(r.daysRemaining, ar)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg}`}>{stateLabel(r.state, ar)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-[12px]">{r.sectorAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-[12px] max-w-[220px] truncate">{r.ownerNameAr || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setRenewing(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                        <RefreshCw className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={canEdit ? 9 : 8} className="px-3 py-12 text-center text-slate-500">
                  {t('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* شريط الإجراء الجماعي — ثابت أسفل الشاشة، يظهر فور اختيار أول مستند.
          كان sticky وموضعه بعد الجدول، فمع مئات الصفوف لا يظهر إلا بعد النزول
          إلى آخر الصفحة — واختيار صف في الأعلى يبدو بلا زر. */}
      {canEdit && (
        <SelectionBar
          count={picked.size} ar={ar} tone="green"
          label={t(`${picked.size} مستند محدَّد`, `${picked.size} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${picked.size})`, `Renew to one date (${picked.size})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && (
        <BulkRenewModal
          rows={rows.filter((r) => picked.has(rowKey(r)))} ar={ar}
          onClose={() => setBulk(false)}
          onDone={() => { setBulk(false); setPicked(new Set()); load(); }}
        />
      )}

      {renewing && (
        <RenewModal row={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ExpiringInner /></Suspense>;
}
