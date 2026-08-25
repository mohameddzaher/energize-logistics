'use client';
// تنبيهات المركبات — كل مستند منتهٍ أو قارب الانتهاء (حسب العتبات المضبوطة في
// الإعدادات)، مرتبة بالأقرب انتهاءً، وكل بند يفتح تفاصيل المركبة.
//
// وهي أول شاشة يفتحها المسؤول صباحًا، فكان غريبًا أن تُريه ما انتهى ثم تتركه
// يخرج إلى شاشة أخرى ليجدّده. التجديد — فرديًّا وجماعيًّا — صار هنا بنفس نوافذ
// شاشة «الانتهاءات» لأن الصف هنا يحمل المركبة ونوع المستند، وهما كل ما يطلبه
// الـ endpoint أصلًا.
import { useState, useEffect, useCallback, useMemo } from 'react';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import SelectionBar from '@/components/ls2/SelectionBar';
import { RenewModal, BulkRenewModal, type RenewTarget } from '@/components/vehicles/RenewModals';
import {
  AlertItem, statusColor, statusLabel, docLabel, DOC_TYPES, fmtDate, daysText, canEditVehicles,
} from '@/lib/vehicleRegistry';
import { BellRing, Settings, RefreshCw } from 'lucide-react';

export default function VehicleRegistryAlerts() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  const [data, setData] = useState<{ items: AlertItem[]; total: number; byStatus: Record<string, number>; byDoc: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  // المفتاح مركّب (مركبة+مستند) لأن نفس المركبة قد يكون لها أكثر من تنبيه —
  // تأمينها منتهٍ ورخصتها قاربت، وقد يُجدَّد أحدهما دون الآخر.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [renewing, setRenewing] = useState<AlertItem | null>(null);
  const rowKey = (i: AlertItem) => `${i.vehicleId}:${i.docType}`;
  // نوافذ التجديد لا تعرف تسمية هذه الشاشة (docType)، فالتحويل يتم عند الحدود.
  const target = (i: AlertItem): RenewTarget => ({
    vehicleId: i.vehicleId, plateNumber: i.plateNumber, docKey: i.docType,
    docAr: i.docAr || docLabel(i.docType, true), docEn: i.docEn || docLabel(i.docType, false),
    expiryDate: i.expiryDate,
  });

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
  // «اختيار الكل» يعني المعروض بعد الفلترة لا كل ما في القاعدة — وإلا جدّد
  // المستخدم بندًا لا يراه أمامه.
  const pickedRows = items.filter((i) => picked.has(rowKey(i)));

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BellRing className="w-5 h-5" />} title={ar ? 'تنبيهات المركبات' : 'Vehicle Alerts'} subtitle={ar ? `${data?.total || 0} تنبيه` : `${data?.total || 0} alerts`}>
        <Link href="/system/vehicles/registry/settings" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><Settings className="w-4 h-4" /> {ar ? 'إعدادات التنبيهات' : 'Alert settings'}</Link>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['expired', 'critical', 'warning', 'upcoming'] as const).map((s) => (
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
              <tr>
                {canEdit && (
                  <th className="px-3 py-2.5 w-9">
                    <input type="checkbox" className="accent-[#f37121]"
                      title={ar ? 'اختيار كل المعروض' : 'Select all shown'}
                      checked={items.length > 0 && items.every((i) => picked.has(rowKey(i)))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        items.forEach((i) => (e.target.checked ? n.add(rowKey(i)) : n.delete(rowKey(i))));
                        return n;
                      })} />
                  </th>
                )}
                {[ar ? 'اللوحة' : 'Plate', ar ? 'المركبة' : 'Vehicle', ar ? 'المستند' : 'Document', ar ? 'القطاع' : 'Sector', ar ? 'المالك' : 'Owner', ar ? 'تاريخ الانتهاء' : 'Expiry date', ar ? 'المتبقي' : 'Remaining', ar ? 'الحالة' : 'Status',
                  ...(canEdit ? [''] : [])].map((h, hi) => <th key={hi} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, idx) => (
                <tr key={idx} className={`cursor-pointer ${picked.has(rowKey(i)) ? 'bg-orange-50/70' : 'hover:bg-slate-50'}`}
                  onClick={() => router.push(`/system/vehicles/registry/${i.vehicleId}`)}>
                  {canEdit && (
                    // الصف كله يفتح المركبة، فبدون stopPropagation يكون كل اختيار
                    // خروجًا من الشاشة — والتحديد يضيع قبل أن يُستعمل.
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-[#f37121]"
                        checked={picked.has(rowKey(i))}
                        onChange={() => setPicked((p) => {
                          const n = new Set(p); const k = rowKey(i);
                          if (n.has(k)) n.delete(k); else n.add(k);
                          return n;
                        })} />
                    </td>
                  )}
                  <td className="px-3 py-2.5 font-mono font-semibold text-[#f37121] whitespace-nowrap">{i.plateNumber}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{[i.brandAr, i.modelAr].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{docLabel(i.docType, ar)}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{i.sectorAr || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 max-w-[180px] truncate" title={i.ownerNameAr}>{i.ownerNameAr || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-mono">{fmtDate(i.expiryDate)}</td>
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: statusColor(i.status) }}>{daysText(i.daysRemaining, ar)}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: `${statusColor(i.status)}1a`, color: statusColor(i.status) }}>{statusLabel(i.status, ar)}</span></td>
                  {canEdit && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setRenewing(i)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold whitespace-nowrap">
                        <RefreshCw className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={canEdit ? 10 : 8} className="px-4 py-10 text-center text-slate-400 text-sm">{ar ? 'لا توجد تنبيهات 🎉' : 'No alerts 🎉'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && (
        <SelectionBar
          count={pickedRows.length} ar={ar} tone="green"
          label={t(`${pickedRows.length} تنبيه محدَّد`, `${pickedRows.length} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${pickedRows.length})`, `Renew to one date (${pickedRows.length})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && (
        <BulkRenewModal
          rows={pickedRows.map(target)} ar={ar}
          onClose={() => setBulk(false)}
          onDone={() => { setBulk(false); setPicked(new Set()); load(); }}
        />
      )}

      {renewing && (
        <RenewModal row={target(renewing)} ar={ar}
          onClose={() => setRenewing(null)}
          // التنبيه المُجدَّد يجب أن يختفي من القائمة فورًا، وإلا بدا كأن شيئًا لم يحدث.
          onDone={() => { setRenewing(null); setPicked(new Set()); load(); }} />
      )}
    </div>
  );
}
