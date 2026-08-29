'use client';
// الحوادث والمطالبات التأمينية — السؤال هنا فلوس: صرفنا كام وهنسترد كام.
//
// ⚠️ الصفحة دي غير «حوادث التفاويض» في نفس القسم. تلك بتسجّل الحادث من ناحية
// التشغيل (أي سائق، بأي تفويض). دي بتتابع **المطالبة**: نسبة الخطأ، رقم نجم،
// شركة التأمين، المقدَّر، والمتوقع استرداده.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { TriangleAlert, Search, ArrowRight, Clock, Plus, Pencil, Trash2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getClaims, money, fmtDate, canEditVehicles, canAdminVehicles,
  createClaim, updateClaim, deleteClaim,
} from '@/lib/vehicleRegistry';

function ClaimsInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify, confirm } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  const canDelete = canAdminVehicles(user);
  // null = مقفول · {} = حادث جديد · سجل = تعديل
  const [form, setForm] = useState<any | null>(null);

  // البحث يُقرأ من العنوان: ملفُّ المركبة يرسل لوحتَها في الرابط، فالضغط على
  // «الحوادث والمطالبات» يفتح مطالباتِ هذه المركبة لا السجلَّ كلَّه.
  const [q, setQ] = useState(sp?.get('q') || '');
  const [status, setStatus] = useState(sp?.get('status') || '');
  const [d, setD] = useState<Awaited<ReturnType<typeof getClaims>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await getClaims({ q: q.trim(), status })); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [q, status, notify]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const rows = d?.claims || [];
  const cols: ExportColumn[] = [
    { header: t('رقم الحادث', 'Accident no.'), key: 'accidentNumber', width: 18 },
    { header: t('اللوحة', 'Plate'), key: 'vehiclePlate', width: 16 },
    { header: t('التاريخ', 'Date'), key: 'accidentDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('نسبة الخطأ %', 'Fault %'), key: 'faultPercent', width: 12 },
    { header: t('شركة التأمين', 'Insurer'), key: 'claim', transform: (v: any) => v?.insurerAr || '', width: 20 },
    { header: t('المبلغ المقدَّر', 'Estimated'), key: 'claim', transform: (v: any) => v?.estimatedAmountSar ?? '', width: 16 },
    { header: t('متوقع استرداده', 'Expected recovery'), key: 'claim', transform: (v: any) => v?.expectedRecoverySar ?? '', width: 18 },
    { header: t('الحالة', 'Status'), key: 'statusAr', width: 14 },
    { header: t('الطرف الآخر', 'Counterparty'), key: 'counterpartyNameAr', width: 24 },
  ];

  // البحث والحالة يُنفَّذان على الخادم، فالمصفوفة التي في اليد نتائجُ الفلتر لا
  // سجلّ المطالبات؛ ومن غير نداءٍ ثانٍ بلا معاملات لا يوجد «كلّ» أصلًا.
  const hasActiveFilters = !!(q.trim() || status);
  const fetchAllForExport = async () => {
    const all = await getClaims();
    return [{ name: t('الحوادث', 'Claims'), rows: all.claims || [], columns: cols }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: t('الحوادث', 'Claims'), rows, columns: cols }] },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: fetchAllForExport }] : []),
  ];

  if (loading && !d) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={() => router.push('/system/vehicles/registry/overview')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('النظرة الشاملة', 'Overview')}
      </button>

      <PageHeader
        icon={<TriangleAlert className="w-5 h-5" />}
        title={t('الحوادث والمطالبات التأمينية', 'Accidents & Insurance Claims')}
        subtitle={t('متابعة المطالبة من الحادث لحد الاسترداد', 'From the accident to the money back')}
      >
        <div className="flex items-center gap-2">
          {canEdit && (
            <button onClick={() => setForm({})}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold">
              <Plus className="w-4 h-4" />{t('تسجيل حادث', 'New accident')}
            </button>
          )}
          <ExportMenu fileName="vehicle-claims" lang={lang as 'ar' | 'en'} options={exportOptions} />
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={t('إجمالي الحوادث', 'Total')} value={d?.totals.total ?? 0} c="#0f172a" />
        <Stat label={t('مفتوحة', 'Open')} value={d?.totals.open ?? 0} c="#f59e0b" />
        <Stat label={t('المبلغ المقدَّر (ر.س)', 'Estimated (SAR)')} value={money(d?.totals.estimatedSar)} c="#0ea5e9" />
        <Stat label={t('متوقع استرداده (ر.س)', 'Expected recovery')} value={money(d?.totals.expectedRecoverySar)} c="#16a34a" />
        <Stat label={t('الفجوة (ر.س)', 'Gap (SAR)')} value={money(d?.totals.gapSar)} c="#dc2626" />
        {/* «نايمة» = مفتوحة وعدّى عليها ٣٠ يوم من غير أي رد من التأمين. */}
        <Stat label={t('بدون رد من التأمين +٣٠ يوم', 'No insurer reply 30d+')} value={d?.totals.stale ?? 0} c="#ea580c" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('لوحة / رقم حادث / شركة تأمين / الطرف الآخر…', 'plate / accident no / insurer…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-80 max-w-full" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          <option value="pending">{t('قيد المتابعة', 'Pending')}</option>
          <option value="closed">{t('مقفولة', 'Closed')}</option>
        </select>
        <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('حادث', 'claims')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{[t('اللوحة', 'Plate'), t('التاريخ', 'Date'), t('نسبة الخطأ', 'Fault'), t('شركة التأمين', 'Insurer'),
                t('المقدَّر', 'Estimated'), t('متوقع استرداده', 'Recovery'), t('الحالة', 'Status'), t('آخر رد', 'Last reply'),
                ...(canEdit ? [t('إجراءات', 'Actions')] : [])].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                // مطالبة مفتوحة وعدّى عليها شهر من غير رد — دي اللي بتضيع.
                const staleDays = r.claim?.lastInsurerUpdateDate
                  ? Math.floor((Date.now() - new Date(r.claim.lastInsurerUpdateDate).getTime()) / 86400000) : null;
                const stale = r.statusCode !== 'closed' && staleDays != null && staleDays > 30;
                return (
                  <tr key={r._id} className="hover:bg-slate-50 text-center align-middle">
                    <td className="px-3 py-2.5">
                      {r.vehicle
                        ? <button onClick={() => router.push(`/system/vehicles/registry/${r.vehicle}`)}
                            className="font-semibold text-slate-800 hover:text-[#f37121]">{r.vehiclePlate || r.incidentSubjectAr}</button>
                        : <span className="text-slate-600">{r.vehiclePlate || r.incidentSubjectAr || '—'}</span>}
                      {r.accidentNumber && <p className="text-[10px] text-slate-400">{r.accidentNumber}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.accidentDate)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        (r.faultPercent || 0) >= 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {r.faultPercent ?? 0}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-[12px]">{r.claim?.insurerAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-semibold whitespace-nowrap">{r.claim?.estimatedAmountSar ? money(r.claim.estimatedAmountSar) : '—'}</td>
                    <td className="px-3 py-2.5 text-emerald-700 font-semibold whitespace-nowrap">{r.claim?.expectedRecoverySar ? money(r.claim.expectedRecoverySar) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        r.statusCode === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                        {r.statusAr || (r.statusCode === 'closed' ? t('مقفولة', 'Closed') : t('قيد المتابعة', 'Pending'))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {staleDays == null ? <span className="text-slate-300">—</span> : (
                        <span className={`inline-flex items-center gap-1 text-[12px] ${stale ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {stale && <Clock className="w-3.5 h-3.5" />}{staleDays} {t('يوم', 'd')}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setForm(r)} title={t('تعديل', 'Edit')}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canDelete && (
                            <button title={t('حذف', 'Delete')}
                              onClick={async () => {
                                if (!(await confirm(t(
                                  `حذف الحادث ${r.accidentNumber || r.claimId || ''}؟ هيتشال من القوايم والتقارير.`,
                                  `Delete accident ${r.accidentNumber || r.claimId || ''}?`)))) return;
                                try { await deleteClaim(r._id); notify(t('اتشال', 'Deleted'), 'success'); load(); }
                                catch (e: any) { notify(e?.message || 'Failed', 'error'); }
                              }}
                              className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={canEdit ? 9 : 8} className="px-3 py-12 text-center text-slate-500">{t('لا توجد حوادث', 'No claims')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {form && <ClaimForm claim={form} ar={ar} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

function Stat({ label, value, c }: { label: string; value: any; c: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
      <p className="text-2xl font-extrabold leading-none" style={{ color: c }}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </div>
  );
}

// ── تسجيل / تعديل حادث ───────────────────────────────────────────────────────
// الحقول اللي بتتكتب بالإيد بس. فجوة الاسترداد محسوبة على السيرفر (المقدَّر ناقص
// المتوقع)، فما بتتكتبش هنا — عشان الشاشة والتقرير ما يقولوش حاجتين مختلفتين.
function ClaimForm({ claim, ar, onClose, onSaved }: {
  claim: any; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const isNew = !claim?._id;
  const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const [f, setF] = useState({
    vehiclePlate: claim?.vehiclePlate || '',
    incidentSubjectAr: claim?.incidentSubjectAr || '',
    accidentDate: d(claim?.accidentDate),
    accidentNumber: claim?.accidentNumber || '',
    counterpartyNameAr: claim?.counterpartyNameAr || '',
    faultPercent: claim?.faultPercent ?? '',
    reportedViaAr: claim?.reportedViaAr || '',
    statusCode: claim?.statusCode || 'pending',
    statusAr: claim?.statusAr || '',
    insurerAr: claim?.claim?.insurerAr || '',
    claimNumber: claim?.claim?.claimNumber || '',
    estimatedAmountSar: claim?.claim?.estimatedAmountSar ?? '',
    expectedRecoverySar: claim?.claim?.expectedRecoverySar ?? '',
    lastInsurerUpdateDate: d(claim?.claim?.lastInsurerUpdateDate),
    notesAr: claim?.claim?.notesAr || '',
  });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const num = (v: any) => (v === '' || v == null ? null : Number(v));
  const gap = num(f.estimatedAmountSar) != null && num(f.expectedRecoverySar) != null
    ? Number(f.estimatedAmountSar) - Number(f.expectedRecoverySar) : null;

  const save = async () => {
    if (!f.vehiclePlate.trim() && !f.incidentSubjectAr.trim()) {
      notify(t('اكتب اللوحة أو موضوع الواقعة', 'Enter the plate or the subject'), 'error'); return;
    }
    setBusy(true);
    try {
      const body = {
        vehiclePlate: f.vehiclePlate.trim(),
        incidentSubjectAr: f.incidentSubjectAr.trim(),
        isVehicleIncident: !!f.vehiclePlate.trim(),
        accidentDate: f.accidentDate || null,
        accidentNumber: f.accidentNumber.trim(),
        counterpartyNameAr: f.counterpartyNameAr.trim(),
        faultPercent: num(f.faultPercent),
        reportedViaAr: f.reportedViaAr.trim(),
        statusCode: f.statusCode,
        statusAr: f.statusAr.trim() || (f.statusCode === 'closed' ? 'مقفولة' : 'قيد المتابعة'),
        claim: {
          insurerAr: f.insurerAr.trim(),
          claimNumber: f.claimNumber.trim(),
          estimatedAmountSar: num(f.estimatedAmountSar),
          expectedRecoverySar: num(f.expectedRecoverySar),
          lastInsurerUpdateDate: f.lastInsurerUpdateDate || null,
          notesAr: f.notesAr.trim(),
        },
      };
      if (isNew) await createClaim(body); else await updateClaim(claim._id, body);
      notify(t(isNew ? 'اتسجّل الحادث' : 'اتعدّل', isNew ? 'Accident recorded' : 'Updated'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">
            {isNew ? t('تسجيل حادث جديد', 'New accident') : t(`تعديل ${claim.accidentNumber || claim.claimId}`, `Edit ${claim.accidentNumber || claim.claimId}`)}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className={lbl}>{t('لوحة المركبة', 'Plate')}</label>
              <input value={f.vehiclePlate} onChange={(e) => set('vehiclePlate', e.target.value)} className={inp} placeholder="5010" /></div>
            <div><label className={lbl}>{t('موضوع الواقعة (إن لم تكن مركبة)', 'Subject (if not a vehicle)')}</label>
              <input value={f.incidentSubjectAr} onChange={(e) => set('incidentSubjectAr', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('تاريخ الحادث', 'Accident date')}</label>
              <input type="date" value={f.accidentDate} onChange={(e) => set('accidentDate', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('رقم الحادث', 'Accident no.')}</label>
              <input value={f.accidentNumber} onChange={(e) => set('accidentNumber', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('الطرف الآخر', 'Counterparty')}</label>
              <input value={f.counterpartyNameAr} onChange={(e) => set('counterpartyNameAr', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('نسبة الخطأ علينا %', 'Our fault %')}</label>
              <input type="number" min={0} max={100} value={f.faultPercent} onChange={(e) => set('faultPercent', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('تم الإبلاغ عبر', 'Reported via')}</label>
              <input value={f.reportedViaAr} onChange={(e) => set('reportedViaAr', e.target.value)} className={inp} placeholder="نجم" /></div>
            <div><label className={lbl}>{t('الحالة', 'Status')}</label>
              <select value={f.statusCode} onChange={(e) => set('statusCode', e.target.value)} className={inp}>
                <option value="pending">{t('قيد المتابعة', 'Pending')}</option>
                <option value="closed">{t('مقفولة', 'Closed')}</option>
              </select></div>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[12.5px] font-bold text-slate-800 mb-2">{t('المطالبة التأمينية', 'Insurance claim')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><label className={lbl}>{t('شركة التأمين', 'Insurer')}</label>
                <input value={f.insurerAr} onChange={(e) => set('insurerAr', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('رقم المطالبة', 'Claim no.')}</label>
                <input value={f.claimNumber} onChange={(e) => set('claimNumber', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('آخر رد من التأمين', 'Last insurer reply')}</label>
                <input type="date" value={f.lastInsurerUpdateDate} onChange={(e) => set('lastInsurerUpdateDate', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('المبلغ المقدَّر', 'Estimated (SAR)')}</label>
                <input type="number" value={f.estimatedAmountSar} onChange={(e) => set('estimatedAmountSar', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>{t('المتوقع استرداده', 'Expected recovery')}</label>
                <input type="number" value={f.expectedRecoverySar} onChange={(e) => set('expectedRecoverySar', e.target.value)} className={inp} /></div>
              <div>
                <label className={lbl}>{t('الفجوة (محسوبة)', 'Gap (computed)')}</label>
                <div className={`${inp} bg-slate-50 font-bold ${gap && gap > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                  {gap == null ? '—' : money(gap)}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className={lbl}>{t('ملاحظات', 'Notes')}</label>
              <textarea rows={2} value={f.notesAr} onChange={(e) => set('notesAr', e.target.value)} className={inp} />
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy}
            className="w-full py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ الحفظ…', 'Saving…') : isNew ? t('تسجيل الحادث', 'Record accident') : t('حفظ التعديل', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ClaimsInner /></Suspense>;
}
