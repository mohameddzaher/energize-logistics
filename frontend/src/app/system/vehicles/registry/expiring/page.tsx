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
import { CalendarClock, RefreshCw, X, Check, ArrowRight } from 'lucide-react';
import {
  getExpiring, renewDocument, STATE_META, stateLabel, fmtDate, daysText,
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
        subtitle={t('كل مستند له تاريخ — اختر المدة اللي تهمّك', 'Every dated document — pick the window that matters to you')}
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
            {['expired', 'critical', 'warning', 'valid'].map((s) => (
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
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => {
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
              <tr>{[t('اللوحة', 'Plate'), t('المستند', 'Document'), t('ينتهي في', 'Expires'),
                t('المتبقي', 'Left'), t('الحالة', 'State'), t('القطاع', 'Sector'), t('المالك', 'Owner'), ''].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const m = STATE_META[r.state] || STATE_META.valid;
                return (
                  <tr key={`${r.vehicleId}-${r.docKey}`} className="hover:bg-slate-50 text-center">
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
                <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">
                  {t('مفيش حاجة هتنتهي في المدة دي', 'Nothing expires in this window')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {renewing && (
        <RenewModal row={renewing} ar={ar} t={t} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} notify={notify} />
      )}
    </div>
  );
}

// ── تجديد ────────────────────────────────────────────────────────────────────
// خطوة واحدة: التاريخ الجديد. الباقي اختياري. السيرفر بيقيّد القديم والجديد في
// سجل المركبة، فـ«جدّدناها امتى وبكام» بيفضل له إجابة.
function RenewModal({ row, ar, t, onClose, onDone, notify }: any) {
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // اقتراح: سنة من تاريخ الانتهاء الحالي لو لسه ساري، وإلا سنة من النهاردة.
  useEffect(() => {
    const base = row.expiryDate && new Date(row.expiryDate) > new Date() ? new Date(row.expiryDate) : new Date();
    const y = new Date(base); y.setFullYear(y.getFullYear() + 1);
    setNewExpiry(y.toISOString().slice(0, 10));
  }, [row]);

  const save = async () => {
    if (!newExpiry) { notify(ar ? 'اختر تاريخ الانتهاء الجديد' : 'Pick the new expiry', 'error'); return; }
    setBusy(true);
    try {
      await renewDocument(row.vehicleId, {
        document: row.docKey, newExpiry,
        cost: cost === '' ? null : Number(cost),
        reference: reference.trim(), note: note.trim(),
      });
      notify(ar ? `تم التجديد حتى ${newExpiry}` : `Renewed until ${newExpiry}`, 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-emerald-700">{t('تجديد المستند', 'Renew document')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {row.plateNumber} · <b>{ar ? row.docAr : row.docEn}</b> · {t('ينتهي', 'expires')} {fmtDate(row.expiryDate)}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
            <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('التكلفة (ر.س)', 'Cost (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('رقم الوثيقة/الإيصال', 'Reference')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
          {t('هيتسجّل في سجل المركبة: التاريخ القديم والجديد وباسمك — عشان «جدّدناها امتى وبكام» يفضل ليها إجابة.',
             'Recorded on the vehicle: old date, new date and your name — so "when did we renew, and for how much" keeps an answer.')}
        </p>

        <button onClick={save} disabled={busy}
          className="w-full mt-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />{busy ? t('جارٍ الحفظ…', 'Saving…') : t('تأكيد التجديد', 'Confirm renewal')}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ExpiringInner /></Suspense>;
}
