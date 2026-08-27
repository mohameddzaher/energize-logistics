'use client';
// وثائق تأمين المركبات — وثيقة واحدة تغطّي حتى مئتَي مركبة.
//
// كان التأمين مخزَّنًا نسخةً على كل مركبة، فتجديد وثيقة يعني فتح ١٩٨ مركبة
// واحدةً واحدة — وأي مركبة تُنسى تبقى في الشاشة «منتهية» وهي مؤمَّنة فعلًا.
// هنا الوثيقة صفّ واحد، وتجديدها يسري على كل مركباتها ويُقيَّد في سجل تجديدات
// كلٍّ منها كما لو جُدِّدت وحدها.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import SelectionBar from '@/components/ls2/SelectionBar';
import Link from 'next/link';
import { ShieldCheck, CalendarCheck, X, Car } from 'lucide-react';
import {
  getInsurancePolicies, renewInsurancePolicy, type InsurancePolicy,
  money, fmtDate, daysText, STATE_META, stateLabel, canEditVehicles,
} from '@/lib/vehicleRegistry';

export default function Page() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);

  const [d, setD] = useState<Awaited<ReturnType<typeof getInsurancePolicies>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [renewing, setRenewing] = useState<InsurancePolicy | null>(null);
  // موسم التجديد يأتي دفعةً واحدة: عشرون وثيقة لدى نفس الشركة تنتهي في اليوم
  // نفسه. فتحُها واحدةً واحدة هو بالضبط ما جاءت هذه الشاشة لتُنهيه.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try { setD(await getInsurancePolicies()); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  const rows = d?.policies || [];
  const CHIPS: Chip[] = [
    { key: '', label: t('الكل', 'All') },
    { key: 'expired', label: t('منتهية', 'Expired'), tone: 'red', test: (p: any) => p.state === 'expired' },
    { key: 'soon', label: t('تقترب', 'Expiring soon'), tone: 'amber', test: (p: any) => p.state === 'critical' || p.state === 'warning' },
    { key: 'valid', label: t('سارية', 'Valid'), tone: 'green', test: (p: any) => p.state === 'valid' },
    { key: 'big', label: t('تغطّي أكثر من ١٠ مركبات', 'Covers 10+ vehicles'), tone: 'violet', test: (p: any) => (p.vehicles || 0) > 10 },
  ];
  const search = useCallback((p: any) => [p.policyNumber, p.companyAr, p.coverageTypeAr], []);
  const f = useChipFilter(rows, CHIPS, filter, q, search);

  const cols: ExportColumn[] = [
    { header: t('رقم الوثيقة', 'Policy no.'), key: 'policyNumber', width: 28 },
    { header: t('شركة التأمين', 'Insurer'), key: 'companyAr', width: 18 },
    { header: t('نوع التغطية', 'Coverage'), key: 'coverageTypeAr', width: 22 },
    { header: t('المركبات', 'Vehicles'), key: 'vehicles', width: 10 },
    { header: t('ينتهي في', 'Expires'), key: 'expiryDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('القسط (ر.س)', 'Premium'), key: 'totalPremiumSar', width: 14 },
  ];

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShieldCheck className="w-5 h-5" />}
        title={t('وثائق تأمين المركبات', 'Vehicle insurance policies')}
        subtitle={t('الوثيقة الواحدة تغطّي عدة مركبات — وتجديدها يسري عليها كلها',
                    'One policy covers many vehicles — renewing it applies to all of them')}>
        {/* السؤال يأتي بالاتجاهين: «ما الذي تغطّيه هذه الوثيقة؟» تجيب عنه هذه
            الشاشة، و«بأيّ وثيقةٍ هذه المركبة مؤمَّنة وبكم؟» تجيب عنه تلك. ومن
            يقف هنا باحثًا عن الثانية لم يكن يجد إليها سبيلًا. */}
        <Link href="/system/vehicles/registry/insurance/vehicles"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
          <Car className="w-4 h-4" /> {t('عرض مركبةً مركبة', 'Per-vehicle view')}
        </Link>
        <ExportMenu fileName="vehicle-insurance-policies" lang={lang as 'ar' | 'en'}
          options={[{ key: 'all', label: t('تصدير', 'Export'), sheets: [{ name: t('الوثائق', 'Policies'), rows, columns: cols }] }]} />
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={t('الوثائق', 'Policies')} value={d?.totals.total ?? 0} c="#0f172a" />
        <Stat label={t('مركبات مغطّاة', 'Vehicles covered')} value={d?.totals.vehiclesCovered ?? 0} c="#0ea5e9" />
        <Stat label={t('إجمالي الأقساط (ر.س)', 'Premiums (SAR)')} value={money(d?.totals.premiumSar ?? 0)} c="#16a34a" />
        <Stat label={t('منتهية', 'Expired')} value={d?.totals.expired ?? 0} c="#dc2626" />
        <Stat label={t('تقترب', 'Expiring soon')} value={d?.totals.soon ?? 0} c="#ea580c" />
      </div>

      <FilterBar chips={CHIPS} counts={f.counts} active={filter} onChange={setFilter}
        query={q} onQuery={setQ} placeholder={t('رقم الوثيقة · شركة التأمين…', 'Policy no. · insurer…')}
        shown={f.shown.length} total={rows.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{canEdit && (
                <th className="px-3 py-3 w-9">
                  <input type="checkbox" className="accent-[#f37121]"
                    title={t('اختيار كل المعروض', 'Select all shown')}
                    checked={f.shown.length > 0 && f.shown.every((p: InsurancePolicy) => picked.has(p._id))}
                    onChange={(e) => setPicked((prev) => {
                      const n = new Set(prev);
                      f.shown.forEach((p: InsurancePolicy) => (e.target.checked ? n.add(p._id) : n.delete(p._id)));
                      return n;
                    })} />
                </th>
              )}{[t('رقم الوثيقة', 'Policy no.'), t('شركة التأمين', 'Insurer'), t('نوع التغطية', 'Coverage'),
                t('المركبات', 'Vehicles'), t('ينتهي في', 'Expires'), t('المتبقي', 'Left'),
                t('القسط', 'Premium'), ...(canEdit ? [t('إجراءات', 'Actions')] : [])].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {f.shown.map((p: InsurancePolicy) => {
                const m = STATE_META[p.state] || STATE_META.valid;
                return (
                  <tr key={p._id} className={picked.has(p._id) ? 'bg-orange-50/70 text-center' : 'hover:bg-slate-50 text-center'}>
                    {canEdit && (
                      <td className="px-3 py-2.5">
                        <input type="checkbox" className="accent-[#f37121]"
                          checked={picked.has(p._id)}
                          onChange={() => setPicked((prev) => {
                            const n = new Set(prev);
                            if (n.has(p._id)) n.delete(p._id); else n.add(p._id);
                            return n;
                          })} />
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-mono text-[12.5px] text-slate-900 whitespace-nowrap">{p.policyNumber}</td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap">{p.companyAr || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700 text-[12.5px]">{p.coverageTypeAr || '—'}</td>
                    <td className="px-3 py-2.5">
                      {/* الرقم مدخل: يفتح مركبات هذه الوثيقة بعينها */}
                      <button onClick={() => router.push(`/system/vehicles/registry?insurancePolicy=${p._id}`)}
                        className="px-2 py-0.5 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 text-[12.5px] font-bold tabular-nums hover:bg-sky-100">
                        {p.vehicles}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">{fmtDate(p.expiryDate)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${m.bg}`}>
                        {p.daysRemaining == null ? stateLabel(p.state, ar) : daysText(p.daysRemaining, ar)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">
                      {p.totalPremiumSar ? money(p.totalPremiumSar) : '—'}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button onClick={() => setRenewing(p)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[12px] font-semibold inline-flex items-center gap-1">
                          <CalendarCheck className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!f.shown.length && (
                <tr><td colSpan={canEdit ? 9 : 7} className="px-3 py-12 text-center text-slate-500">
                  {t('لا توجد وثائق مطابقة', 'No matching policies')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && (() => {
        const chosen = f.shown.filter((p: InsurancePolicy) => picked.has(p._id));
        const vehicles = chosen.reduce((n: number, p: InsurancePolicy) => n + (p.vehicles || 0), 0);
        return (
          <>
            <SelectionBar
              count={chosen.length} ar={ar} tone="green"
              label={t(`${chosen.length} وثيقة محدَّدة`, `${chosen.length} selected`)}
              hint={t(`تغطّي ${vehicles} مركبة — سيسري عليها كلها التاريخ نفسه`,
                      `Covering ${vehicles} vehicles — all get the same date`)}
              actionLabel={t(`تجديدها بتاريخ واحد (${chosen.length})`, `Renew to one date (${chosen.length})`)}
              onAction={() => setBulk(true)}
              onClear={() => setPicked(new Set())} />
            {bulk && (
              <BulkRenewPoliciesModal policies={chosen} ar={ar}
                onClose={() => setBulk(false)}
                onReload={load}
                onDone={() => { setBulk(false); setPicked(new Set()); load(); }} />
            )}
          </>
        );
      })()}

      {renewing && (
        <RenewPolicyModal policy={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); setPicked(new Set()); load(); }} notify={notify} />
      )}
    </div>
  );
}

function Stat({ label, value, c }: { label: string; value: any; c: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: c }}>{value}</p>
      <p className="text-[11.5px] text-slate-600 mt-1.5 font-medium">{label}</p>
    </div>
  );
}

function RenewPolicyModal({ policy, ar, onClose, onDone, notify }: {
  policy: InsurancePolicy; ar: boolean; onClose: () => void; onDone: () => void;
  notify: (m: string, t?: 'success' | 'error') => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [newExpiry, setNewExpiry] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!newExpiry) { notify(t('أدخل تاريخ الانتهاء الجديد', 'Enter the new expiry date'), 'error'); return; }
    setBusy(true);
    try {
      const r = await renewInsurancePolicy(policy._id, {
        newExpiry, policyNumber: policyNumber.trim() || undefined,
        cost: cost === '' ? null : Number(cost), reference: reference.trim(),
      });
      notify(t(`تم التجديد — سرى على ${r.vehiclesUpdated} مركبة`, `Renewed — applied to ${r.vehiclesUpdated} vehicles`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{t('تجديد وثيقة تأمين', 'Renew insurance policy')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[12.5px] text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium">
            {t(`سيسري التاريخ الجديد على ${policy.vehicles} مركبة تغطّيها هذه الوثيقة، ويُقيَّد في سجل تجديدات كل واحدة.`,
               `The new date applies to all ${policy.vehicles} vehicles on this policy, and is logged on each.`)}
          </p>
          <div><label className={lbl}>{t('الوثيقة الحالية', 'Current policy')}</label>
            <div className={`${inp} bg-slate-50 font-mono text-[12.5px]`}>{policy.policyNumber}</div></div>
          <div><label className={lbl}>{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
            <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus /></div>
          <div><label className={lbl}>{t('رقم وثيقة جديد (إن تغيّر)', 'New policy number (if changed)')}</label>
            <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} className={inp}
              placeholder={policy.policyNumber} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>{t('التكلفة (ر.س)', 'Cost (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('المرجع', 'Reference')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></div>
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy || !newExpiry}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ التجديد…', 'Renewing…') : t(`تجديد وسريانه على ${policy.vehicles} مركبة`, `Renew for ${policy.vehicles} vehicles`)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── تجديد عدة وثائق بتاريخ واحد ──────────────────────────────────────────────
// لا يوجد endpoint جماعي للوثائق، فالتنفيذ نداءات متتابعة — واحدة تلو الأخرى لا
// دفعةً واحدة، حتى لا نُغرق السيرفر بعشرين طلبًا كلٌّ منها يكتب على مئتَي مركبة.
//
// والمتتابع يعني أن الفشل قد يقع في المنتصف: عشر وثائق جُدِّدت وعاشرة رُفضت.
// إخفاء ذلك خلف «تم بنجاح» أسوأ من الفشل نفسه — لأن أحدًا لن يعود إلى المرفوضة.
// لذلك نعرض العدّاد أثناء التنفيذ، ونُبقي النافذة مفتوحة بأسماء ما فشل.
function BulkRenewPoliciesModal({ policies, ar, onClose, onDone, onReload }: {
  policies: InsurancePolicy[]; ar: boolean;
  onClose: () => void; onDone: () => void; onReload: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ policyNumber: string; message: string }[]>([]);
  // إعادة المحاولة يجب أن تمسّ ما فشل فقط: تكرارُ ما نجح يكتب في سجل كل مركبة
  // تجديدًا ثانيًا لم يحدث.
  const [succeeded, setSucceeded] = useState<Set<string>>(new Set());
  const pending = policies.filter((p) => !succeeded.has(p._id));

  const today = new Date().toISOString().slice(0, 10);
  const past = !!newExpiry && newExpiry < today;
  const vehicles = policies.reduce((n, p) => n + (p.vehicles || 0), 0);

  const save = async () => {
    const run = pending;
    setBusy(true); setDone(0); setFailed([]);
    let ok = 0; const bad: { policyNumber: string; message: string }[] = [];
    const won = new Set(succeeded);
    for (const p of run) {
      try {
        await renewInsurancePolicy(p._id, {
          newExpiry, cost: cost === '' ? null : Number(cost), reference: reference.trim(),
        });
        ok += 1; won.add(p._id); setDone(ok);
      } catch (e: any) {
        bad.push({ policyNumber: p.policyNumber, message: e?.message || t('فشل', 'failed') });
        setFailed([...bad]);
      }
    }
    setSucceeded(won); setBusy(false);
    if (!bad.length) {
      notify(t(`تم تجديد ${won.size} وثيقة على ${vehicles} مركبة`, `Renewed ${won.size} policies across ${vehicles} vehicles`), 'success');
      onDone();
      return;
    }
    // نجاح جزئي: نحدّث القائمة ليظهر ما جُدِّد فعلًا، والنافذة تبقى بما فشل.
    notify(t(`جُدِّدت ${won.size} من ${policies.length} — وفشلت ${bad.length}`,
             `Renewed ${won.size} of ${policies.length} — ${bad.length} failed`), 'error');
    onReload();
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3"
      onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{t('تجديد جماعي للوثائق', 'Bulk policy renewal')}</h3>
          <button onClick={onClose} disabled={busy} className="text-slate-500 hover:text-slate-900 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-[12.5px] text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium">
            {t(`${policies.length} وثيقة تغطّي ${vehicles} مركبة — سيسري التاريخ الجديد عليها كلها ويُقيَّد في سجل كل مركبة.`,
               `${policies.length} policies covering ${vehicles} vehicles — the new date applies to all and is logged on each vehicle.`)}
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {policies.map((p) => (
              <span key={p._id} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] font-mono" dir="ltr">
                {p.policyNumber}
              </span>
            ))}
          </div>
          <div>
            <label className={lbl}>{t('تاريخ الانتهاء الجديد', 'New expiry date')} *</label>
            <input type="date" min={today} value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus />
            {past && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">
              {t('التاريخ في الماضي — راجعه', 'That date is in the past')}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>{t('التكلفة لكل وثيقة (ر.س)', 'Cost per policy (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('المرجع', 'Reference')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></div>
          </div>

          {busy && (
            <p className="text-[12.5px] font-semibold text-slate-700 tabular-nums">
              {t(`جارٍ التجديد… ${done}/${pending.length}`, `Renewing… ${done}/${pending.length}`)}
            </p>
          )}
          {failed.length > 0 && !busy && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 max-h-36 overflow-y-auto">
              <p className="text-[11.5px] font-bold text-rose-900 mb-1">
                {t(`جُدِّدت ${succeeded.size} — ولم تُجدَّد هذه:`, `Renewed ${succeeded.size} — these were not renewed:`)}
              </p>
              {failed.map((x, i) => (
                <p key={i} className="text-[11.5px] text-rose-800"><span dir="ltr">{x.policyNumber}</span> — {x.message}</p>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy || !newExpiry || past}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t(`جارٍ التجديد… ${done}/${pending.length}`, `Renewing… ${done}/${pending.length}`)
              : !newExpiry ? t('اختر التاريخ أولًا', 'Pick the date first')
              : failed.length ? t(`إعادة المحاولة على ${pending.length} وثيقة`, `Retry ${pending.length} policies`)
              : t(`تجديد ${policies.length} وثيقة`, `Renew ${policies.length} policies`)}
          </button>
        </div>
      </div>
    </div>
  );
}
