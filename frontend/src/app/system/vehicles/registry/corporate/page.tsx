'use client';
// وثائق التأمين على مستوى الشركة — مش مربوطة بعربية.
//
// تأمين البضائع وخيانة الأمانة. انتهاء واحدة منها بيوقّف الشغل كله، مش عربية
// واحدة — عشان كده لها صفحتها وبتظهر في النظرة الشاملة جنب مستندات المركبات.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import SelectionBar from '@/components/ls2/SelectionBar';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ShieldCheck, RefreshCw, X, Check, ArrowRight, Pencil, Plus, Users, Trash2, Search } from 'lucide-react';
import {
  getCorporatePolicies, renewCorporatePolicy, createCorporatePolicy, updateCorporatePolicy,
  deleteCorporatePolicy, setPolicyDriver, canEditVehicles, canAdminVehicles,
  STATE_META, stateLabel, money, fmtDate, daysText,
} from '@/lib/vehicleRegistry';

export default function CorporatePoliciesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify, confirm } = useDialog();
  // كان زر التجديد ظاهرًا لكل من يفتح الصفحة، والسيرفر وحده يرفض — فيُقال للمستخدم
  // «ممنوع» بعد أن ملأ النموذج. البوابة نفسها المستعملة في بقية شاشات القسم.
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);
  const canDelete = canAdminVehicles(user);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState<any | null>(null);
  // الوثيقةُ تُكتب: `{}` وثيقةٌ جديدة، وسجلٌّ تعديل.
  const [editing, setEditing] = useState<any | null>(null);
  // ولوحةُ المشمولين لوثيقةٍ تغطّي أشخاصًا لا مركبات.
  const [roster, setRoster] = useState<any | null>(null);
  // وثائق الشركة قليلة لكنها تُجدَّد معًا عادةً — من نفس الوسيط وفي نفس اليوم.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await getCorporatePolicies()).policies || []); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  if (loading) return <Spinner />;
  const chosen = rows.filter((p) => picked.has(p._id));

  // أعمدةُ الملفّ هي ما تعرضه البطاقة — ومعها ما لا يتّسع لها: أرقامُ الوثيقة
  // كلُّها، والإجماليُّ المحسوب، وأسماءُ المشمولين.
  const cols: ExportColumn[] = [
    { header: t('الوثيقة', 'Policy'), key: 'scopeAr', width: 30 },
    { header: t('المؤمَّن له', 'Policyholder'), key: 'policyholderAr', width: 26 },
    { header: t('شركة التأمين', 'Insurer'), key: 'companyAr', width: 24 },
    { header: t('أرقام الوثيقة', 'Policy numbers'), key: 'policyNumbers', transform: (v: any) => (v || []).join(' · '), width: 34 },
    { header: t('تاريخ البداية', 'Start'), key: 'startDate', transform: (v: any) => fmtDate(v), width: 14 },
    { header: t('تاريخ الانتهاء', 'Expiry'), key: 'expiryDate', transform: (v: any) => fmtDate(v), width: 14 },
    { header: t('المتبقي (يوم)', 'Days left'), key: 'daysRemaining', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', transform: (v: any) => stateLabel(v, ar), width: 16 },
    { header: t('القسط للفرد سنويًّا', 'Per person / yr'), key: 'premiumPerPersonSar', transform: (v: any) => (v == null ? '' : money(v)), width: 16 },
    { header: t('عدد المشمولين', 'Covered'), key: 'drivers', transform: (v: any) => (v ? v.coveredCount : ''), width: 12 },
    { header: t('القسط الإجمالي', 'Total premium'), key: '_total', transform: (_: any, r: any) => money(r.computedPremiumSar ?? r.premiumSar ?? 0), width: 16 },
    { header: t('المشمولون', 'Covered names'), key: 'drivers', transform: (v: any) => (v ? v.covered.map((d: any) => d.name || d.idNumber).join(' · ') : ''), width: 60 },
    { header: t('مطلوب ضمُّهم', 'To be added'), key: 'drivers', transform: (v: any) => (v ? v.pending.map((d: any) => d.name || d.idNumber).join(' · ') : ''), width: 30 },
    { header: t('ملاحظات', 'Notes'), key: 'notesAr', width: 30 },
  ];

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={() => router.push('/system/vehicles/registry/overview')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('النظرة الشاملة', 'Overview')}
      </button>

      <PageHeader
        icon={<ShieldCheck className="w-5 h-5" />}
        title={t('وثائق التأمين على مستوى الشركة', 'Company-level Insurance')}
        subtitle={t('وثائق غير مرتبطة بمركبة بعينها — انتهاؤها يوقف العمل كله', 'Not tied to any vehicle — their expiry stops everything')}
      >
        <ExportMenu fileName="company-policies" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'all', label: t('تصدير الكلّ', 'Export everything'),
            sheets: [{ name: t('وثائق الشركة', 'Company policies'), rows, columns: cols }] }]} />
        {canEdit && (
          <button onClick={() => setEditing({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" />{t('وثيقة جديدة', 'New policy')}
          </button>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((p) => {
          const m = STATE_META[p.state] || STATE_META.valid;
          return (
            <div key={p._id} className={`bg-white border rounded-xl p-5 shadow-sm ${picked.has(p._id) ? 'ring-2 ring-[#f37121]/50' : ''}`}
              style={{ borderColor: p.state === 'valid' ? '#e2e8f0' : m.color }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {canEdit && (
                    <input type="checkbox" className="accent-[#f37121] mt-1 shrink-0"
                      title={t('اختيار للتجديد الجماعي', 'Select for bulk renewal')}
                      checked={picked.has(p._id)}
                      onChange={() => setPicked((prev) => {
                        const n = new Set(prev);
                        if (n.has(p._id)) n.delete(p._id); else n.add(p._id);
                        return n;
                      })} />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{p.scopeAr}</h3>
                    <p className="text-[12px] text-slate-500 mt-1">{p.policyholderAr}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${m.bg}`}>{stateLabel(p.state, ar)}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4">
                <Fact label={t('شركة التأمين', 'Insurer')} value={p.companyAr} />
                <Fact label={t('ينتهي في', 'Expires')} value={fmtDate(p.expiryDate)} />
                <Fact label={t('المتبقي', 'Remaining')} value={daysText(p.daysRemaining, ar)} color={m.color} />
                {/* ── القسطُ يُقرأ كما يُشترى ────────────────────────────────
                    وثيقةُ خيانة الأمانة تُسعَّر لكلّ سائقٍ سنويًّا، والإجماليُّ
                    مشتقٌّ من عدد المشمولين — يزيد بمن يدخل وينقص بمن يخرج. أمّا
                    إجماليٌّ مكتوبٌ يدًا فيصدق يومَ كُتب ويكذب في اليوم التالي. */}
                <Fact
                  label={p.premiumPerPersonSar != null
                    ? t('القسط للفرد سنويًّا (ر.س)', 'Premium per person / yr')
                    : t('القسط (ر.س)', 'Premium (SAR)')}
                  value={p.premiumPerPersonSar != null ? money(p.premiumPerPersonSar)
                    : (p.premiumSar ? money(p.premiumSar) : '—')} />
              </div>

              {p.premiumPerPersonSar != null && (
                <p className="mt-2 text-[11.5px] text-slate-500">
                  {t(`الإجمالي: ${money(p.computedPremiumSar ?? 0)} ر.س — ${p.drivers?.coveredCount ?? 0} مشمولًا × ${money(p.premiumPerPersonSar)}`,
                     `Total ${money(p.computedPremiumSar ?? 0)} SAR — ${p.drivers?.coveredCount ?? 0} covered × ${money(p.premiumPerPersonSar)}`)}
                </p>
              )}

              {p.coversDrivers && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#f37121]" />
                      {t('المشمولون بالوثيقة', 'People covered')}:
                      <b className="text-slate-800">{p.drivers?.coveredCount ?? 0}</b>
                      {!!p.drivers?.pending?.length && (
                        <span className="text-red-600 font-semibold">
                          · {t(`${p.drivers.pending.length} مطلوب ضمُّه`, `${p.drivers.pending.length} to add`)}
                        </span>
                      )}
                    </p>
                    <button onClick={() => setRoster(p)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11.5px] font-semibold">
                      {canEdit ? t('عرض وتعديل', 'View & edit') : t('عرض', 'View')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(p.drivers?.covered || []).slice(0, 8).map((d: any) => (
                      <span key={d._id} className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-100 text-emerald-800 text-[10.5px]">{d.name || d.idNumber}</span>
                    ))}
                    {(p.drivers?.coveredCount || 0) > 8 && (
                      <span className="px-1.5 py-0.5 text-[10.5px] text-slate-400">+{(p.drivers.coveredCount - 8)}</span>
                    )}
                  </div>
                </div>
              )}

              {!!p.policyNumbers?.length && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 mb-1">{t('أرقام الوثيقة', 'Policy numbers')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.policyNumbers.map((x: string) => (
                      <code key={x} className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100 text-[11px] text-slate-600" dir="ltr">{x}</code>
                    ))}
                  </div>
                </div>
              )}

              {!!p.renewals?.length && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 mb-1">{t('سجل التجديد', 'Renewal history')}</p>
                  {p.renewals.slice().reverse().map((r: any, i: number) => (
                    <p key={i} className="text-[11px] text-slate-500">
                      {fmtDate(r.previousExpiry)} → <b className="text-slate-700">{fmtDate(r.newExpiry)}</b>
                      {r.cost ? ` · ${money(r.cost)} ${t('ر.س', 'SAR')}` : ''}{r.byName ? ` · ${r.byName}` : ''}
                    </p>
                  ))}
                </div>
              )}

              {canEdit && (
                <div className="flex items-center gap-2 mt-4">
                  <button onClick={() => setRenewing(p)}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4" />{t('تجديد', 'Renew')}
                  </button>
                  <button onClick={() => setEditing(p)} title={t('تعديل بيانات الوثيقة', 'Edit policy')}
                    className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
                    <Pencil className="w-4 h-4" />
                  </button>
                  {canDelete && (
                    <button title={t('حذف', 'Delete')}
                      onClick={async () => {
                        if (!(await confirm(t(`حذف «${p.scopeAr}»؟ تبقى في السجلّ ولا تظهر في الشاشات.`, `Delete “${p.scopeAr}”?`)))) return;
                        try { await deleteCorporatePolicy(p._id); notify(t('حُذفت', 'Deleted'), 'success'); load(); }
                        catch (e: any) { notify(e?.message || 'Failed', 'error'); }
                      }}
                      className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!rows.length && <p className="text-slate-400 text-sm">{t('لا توجد وثائق', 'No policies')}</p>}
      </div>

      {canEdit && (
        <SelectionBar
          count={chosen.length} ar={ar} tone="green"
          label={t(`${chosen.length} وثيقة محدَّدة`, `${chosen.length} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${chosen.length})`, `Renew to one date (${chosen.length})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && <BulkRenewModal policies={chosen} ar={ar} onClose={() => setBulk(false)}
        onReload={load} onDone={() => { setBulk(false); setPicked(new Set()); load(); }} />}

      {renewing && <RenewModal p={renewing} ar={ar} t={t} notify={notify}
        onClose={() => setRenewing(null)} onDone={() => { setRenewing(null); setPicked(new Set()); load(); }} />}

      {editing && <PolicyForm p={editing} ar={ar} t={t} notify={notify}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}

      {roster && <DriverRoster p={roster} ar={ar} t={t} notify={notify} canEdit={canEdit}
        onClose={() => setRoster(null)} onChanged={load} />}
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="text-[13px] font-semibold mt-0.5" style={{ color: color || '#0f172a' }}>{value || '—'}</p>
    </div>
  );
}

function RenewModal({ p, ar, t, onClose, onDone, notify }: any) {
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const base = p.expiryDate && new Date(p.expiryDate) > new Date() ? new Date(p.expiryDate) : new Date();
    const y = new Date(base); y.setFullYear(y.getFullYear() + 1);
    setNewExpiry(y.toISOString().slice(0, 10));
  }, [p]);

  const save = async () => {
    if (!newExpiry) { notify(ar ? 'اختر التاريخ الجديد' : 'Pick a date', 'error'); return; }
    setBusy(true);
    try {
      await renewCorporatePolicy(p._id, { newExpiry, cost: cost === '' ? null : Number(cost), reference: reference.trim() });
      notify(ar ? `تم التجديد حتى ${newExpiry}` : `Renewed until ${newExpiry}`, 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-emerald-700">{t('تجديد الوثيقة', 'Renew policy')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">{p.scopeAr} · {t('تنتهي', 'expires')} {fmtDate(p.expiryDate)}</p>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
            <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('القسط (ر.س)', 'Premium (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">{t('رقم الوثيقة الجديد', 'New policy no.')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} dir="ltr" /></div>
          </div>
        </div>
        <button onClick={save} disabled={busy}
          className="w-full mt-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />{busy ? t('جارٍ الحفظ…', 'Saving…') : t('تأكيد التجديد', 'Confirm')}
        </button>
      </div>
    </div>
  );
}

// ── تجديد عدة وثائق شركة بتاريخ واحد ─────────────────────────────────────────
// لا يوجد endpoint جماعي لهذه الوثائق، فالتنفيذ نداءات متتابعة. والمتتابع يعني
// أن الفشل قد يقع في المنتصف، وقول «تم» عندها يترك وثيقة منتهية يظنّها صاحبها
// مجدَّدة — وانتهاء واحدة من هذه يوقف العمل كله. لذلك: عدّاد أثناء التنفيذ،
// وأسماء صريحة لما لم يُجدَّد، وإعادة المحاولة تمسّ ما فشل وحده.
function BulkRenewModal({ policies, ar, onClose, onDone, onReload }: {
  policies: any[]; ar: boolean; onClose: () => void; onDone: () => void; onReload: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [newExpiry, setNewExpiry] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ label: string; message: string }[]>([]);
  const [succeeded, setSucceeded] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const past = !!newExpiry && newExpiry < today;
  const pending = policies.filter((p) => !succeeded.has(p._id));

  const save = async () => {
    const run = pending;
    setBusy(true); setDone(0); setFailed([]);
    let ok = 0; const bad: { label: string; message: string }[] = [];
    const won = new Set(succeeded);
    for (const p of run) {
      try {
        await renewCorporatePolicy(p._id, {
          newExpiry, cost: cost === '' ? null : Number(cost), reference: reference.trim(),
        });
        ok += 1; won.add(p._id); setDone(ok);
      } catch (e: any) {
        bad.push({ label: p.scopeAr || p._id, message: e?.message || t('فشل', 'failed') });
        setFailed([...bad]);
      }
    }
    setSucceeded(won); setBusy(false);
    if (!bad.length) {
      notify(t(`تم تجديد ${won.size} وثيقة حتى ${newExpiry}`, `Renewed ${won.size} policies until ${newExpiry}`), 'success');
      onDone();
      return;
    }
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
          <h3 className="font-bold text-slate-900">{t('تجديد جماعي', 'Bulk renewal')}</h3>
          <button onClick={onClose} disabled={busy} className="text-slate-500 hover:text-slate-900 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-[12.5px] text-slate-700">
            {t(`${policies.length} وثيقة هتتجدّد لنفس التاريخ`, `${policies.length} policies will get the same date`)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {policies.map((p) => (
              <span key={p._id} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11.5px] font-semibold">{p.scopeAr}</span>
            ))}
          </div>
          <div>
            <label className={lbl}>{t('تاريخ الانتهاء الجديد', 'New expiry date')} *</label>
            <input type="date" min={today} value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className={inp} autoFocus />
            {past && <p className="text-[11.5px] text-rose-700 font-semibold mt-1">
              {t('التاريخ في الماضي — راجعه', 'That date is in the past')}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>{t('القسط لكل وثيقة (ر.س)', 'Premium per policy (SAR)')}</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></div>
            <div><label className={lbl}>{t('رقم الوثيقة الجديد', 'New policy no.')}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} dir="ltr" /></div>
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
              {failed.map((x, i) => <p key={i} className="text-[11.5px] text-rose-800">{x.label} — {x.message}</p>)}
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

// ── استمارةُ الوثيقة ─────────────────────────────────────────────────────────
//
// كانت الصفحةُ تعرض وتجدّد ولا تكتب. فرقمُ وثيقةٍ خطأٌ أو شركةُ تأمينٍ تغيّرت
// أو قسطٌ صحيحٌ يحتاج فتحَ قاعدة البيانات — وهذا ليس ما تُبنى له شاشة.
function PolicyForm({ p, ar, t, onClose, onDone, notify }: any) {
  const isNew = !p?._id;
  const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const [f, setF] = useState({
    scopeAr: p?.scopeAr || '',
    policyholderAr: p?.policyholderAr || '',
    companyAr: p?.companyAr || '',
    policyNumbers: (p?.policyNumbers || []).join('، '),
    startDate: d(p?.startDate),
    expiryDate: d(p?.expiryDate),
    // ── القسطُ: للرأس أو مقطوعًا، لا الاثنان ────────────────────────────────
    // وثيقةٌ تُشترى بالرأس يُكتب سعرُ رأسها ويُحسب إجماليُّها؛ وكتابةُ الاثنين
    // تجعل الشاشةَ تعرض رقمين لا يُعرف أيُّهما الصحيح.
    perHead: p?.premiumPerPersonSar != null,
    premiumPerPersonSar: p?.premiumPerPersonSar ?? '',
    premiumSar: p?.premiumSar ?? '',
    coversDrivers: !!p?.coversDrivers,
    statusAr: p?.statusAr || '',
    notesAr: p?.notesAr || '',
  });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.scopeAr.trim()) { notify(t('اكتب اسم الوثيقة', 'Enter the policy name'), 'error'); return; }
    setBusy(true);
    try {
      const body: any = {
        scopeAr: f.scopeAr.trim(), policyholderAr: f.policyholderAr.trim(), companyAr: f.companyAr.trim(),
        policyNumbers: f.policyNumbers, startDate: f.startDate || null, expiryDate: f.expiryDate || null,
        statusAr: f.statusAr.trim(), notesAr: f.notesAr.trim(), coversDrivers: f.coversDrivers,
        premiumPerPersonSar: f.perHead ? (f.premiumPerPersonSar === '' ? null : Number(f.premiumPerPersonSar)) : null,
        premiumSar: f.perHead ? null : (f.premiumSar === '' ? null : Number(f.premiumSar)),
      };
      if (isNew) await createCorporatePolicy(body); else await updateCorporatePolicy(p._id, body);
      notify(t(isNew ? 'أُضيفت الوثيقة' : 'حُفظت', isNew ? 'Policy added' : 'Saved'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#f37121]';
  const lbl = 'block text-[11.5px] font-semibold text-slate-700 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{isNew ? t('وثيقة جديدة', 'New policy') : t('تعديل الوثيقة', 'Edit policy')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className={lbl}>{t('اسم الوثيقة', 'Policy name')} *</label>
            <input value={f.scopeAr} onChange={(e) => set('scopeAr', e.target.value)} className={inp} autoFocus /></div>
          <div><label className={lbl}>{t('المؤمَّن له', 'Policyholder')}</label>
            <input value={f.policyholderAr} onChange={(e) => set('policyholderAr', e.target.value)} className={inp} /></div>
          <div><label className={lbl}>{t('شركة التأمين', 'Insurer')}</label>
            <input value={f.companyAr} onChange={(e) => set('companyAr', e.target.value)} className={inp} /></div>
          <div className="sm:col-span-2"><label className={lbl}>{t('أرقام الوثيقة (تُفصَل بفاصلة)', 'Policy numbers (comma separated)')}</label>
            <input value={f.policyNumbers} onChange={(e) => set('policyNumbers', e.target.value)} className={`${inp} font-mono`} dir="ltr" /></div>
          <div><label className={lbl}>{t('تاريخ البداية', 'Start date')}</label>
            <input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} className={inp} /></div>
          <div><label className={lbl}>{t('تاريخ الانتهاء', 'Expiry date')}</label>
            <input type="date" value={f.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} className={inp} /></div>

          <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-800 cursor-pointer">
              <input type="checkbox" className="accent-[#f37121]" checked={f.perHead}
                onChange={(e) => set('perHead', e.target.checked)} />
              {t('القسط يُحسب لكل فرد', 'Premium is priced per person')}
            </label>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              {t('وثيقةٌ كخيانة الأمانة تُسعَّر لكلّ سائقٍ سنويًّا، فيُكتب سعرُ الفرد ويُحسب الإجماليُّ من عدد المشمولين — يزيد بمن يدخل وينقص بمن يخرج.',
                 'A policy like fidelity is priced per driver per year: enter the per-head rate and the total follows the number covered.')}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {f.perHead ? (
                <div><label className={lbl}>{t('القسط للفرد سنويًّا (ر.س)', 'Per person / year (SAR)')}</label>
                  <input type="number" step="0.01" value={f.premiumPerPersonSar}
                    onChange={(e) => set('premiumPerPersonSar', e.target.value)} className={inp} /></div>
              ) : (
                <div><label className={lbl}>{t('القسط الإجمالي (ر.س)', 'Total premium (SAR)')}</label>
                  <input type="number" step="0.01" value={f.premiumSar}
                    onChange={(e) => set('premiumSar', e.target.value)} className={inp} /></div>
              )}
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer pb-2">
                  <input type="checkbox" className="accent-[#f37121]" checked={f.coversDrivers}
                    onChange={(e) => set('coversDrivers', e.target.checked)} />
                  {t('تغطّي سائقين بأسمائهم', 'Covers named drivers')}
                </label>
              </div>
            </div>
          </div>

          <div><label className={lbl}>{t('الحالة', 'Status')}</label>
            <input value={f.statusAr} onChange={(e) => set('statusAr', e.target.value)} className={inp} /></div>
          <div><label className={lbl}>{t('ملاحظات', 'Notes')}</label>
            <input value={f.notesAr} onChange={(e) => set('notesAr', e.target.value)} className={inp} /></div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200">
          <button onClick={save} disabled={busy}
            className="w-full py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold disabled:opacity-40">
            {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── قائمةُ المشمولين ─────────────────────────────────────────────────────────
//
// «تأمين خيانة الأمانة ل 58 سائق» — عددٌ في اسمٍ لا يُسأل: أيُّ ثمانيةٍ وخمسين؟
// ومَن دخل الشهرَ الماضي وليس فيهم؟ فالأسماءُ هنا، والضمُّ والإخراجُ بضغطة.
//
// ولا تُنسَخ القائمةُ على الوثيقة: تُكتب في `DriverCard.fidelity` — سجلٌّ واحدٌ
// تقرؤه صفحةُ بطاقات السائقين وشاشةُ التفاويض معًا، فلا يفترق ثلاثةُ سجلّات.
function DriverRoster({ p, ar, t, onClose, onChanged, notify, canEdit }: any) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const covered = p.drivers?.covered || [];
  const pending = p.drivers?.pending || [];
  const fold = (v: any) => String(v ?? '').replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي').replace(/\s+/g, '').toLowerCase();
  const match = (d: any) => !q.trim() || [d.name, d.idNumber, d.employeeNumber].some((x) => fold(x).includes(fold(q)));

  const toggle = async (d: any, next: boolean) => {
    setBusyId(d._id);
    try {
      await setPolicyDriver(p._id, { cardId: d._id, covered: next });
      notify(next ? t(`ضُمَّ ${d.name || d.idNumber}`, 'Added') : t(`أُخرِج ${d.name || d.idNumber}`, 'Removed'), 'success');
      onChanged();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusyId(null); }
  };

  const Row = ({ d, on }: { d: any; on: boolean }) => (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{d.name || '—'}</p>
        <p className="text-[11px] text-slate-400 font-mono" dir="ltr">
          {d.idNumber}{d.employeeNumber ? ` · ${d.employeeNumber}` : ''}{d.addedDate ? ` · ${d.addedDate}` : ''}
        </p>
      </div>
      {canEdit && (
        <button disabled={busyId === d._id} onClick={() => toggle(d, !on)}
          className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold shrink-0 disabled:opacity-40 ${
            on ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          {on ? t('إخراج', 'Remove') : t('ضمّ', 'Add')}
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl my-4 max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">{t('المشمولون بالوثيقة', 'People covered')}</h3>
            <p className="text-[12px] text-slate-500">{p.scopeAr}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث بالاسم أو الهوية أو الرقم الوظيفي…', 'Name, ID or employee no…')}
              className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
          {p.premiumPerPersonSar != null && (
            <p className="text-[11.5px] text-slate-500 mt-2">
              {t(`القسط للفرد ${money(p.premiumPerPersonSar)} ر.س سنويًّا — الإجمالي الآن ${money((p.premiumPerPersonSar || 0) * covered.length)} ر.س`,
                 `${money(p.premiumPerPersonSar)} SAR per person — total now ${money((p.premiumPerPersonSar || 0) * covered.length)} SAR`)}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {!!pending.length && (
            <div>
              <p className="text-[12px] font-bold text-rose-700 mb-1.5">
                {t(`مطلوب ضمُّهم (${pending.length})`, `To be added (${pending.length})`)}
              </p>
              <div className="rounded-xl border border-rose-200 bg-rose-50/40">
                {pending.filter(match).map((d: any) => <Row key={d._id} d={d} on={false} />)}
                {!pending.filter(match).length && <p className="px-3 py-3 text-[12px] text-slate-400">{t('لا نتائج', 'No results')}</p>}
              </div>
            </div>
          )}
          <div>
            <p className="text-[12px] font-bold text-emerald-700 mb-1.5">
              {t(`مشمولون (${covered.length})`, `Covered (${covered.length})`)}
            </p>
            <div className="rounded-xl border border-slate-200">
              {covered.filter(match).map((d: any) => <Row key={d._id} d={d} on />)}
              {!covered.filter(match).length && <p className="px-3 py-3 text-[12px] text-slate-400">{t('لا نتائج', 'No results')}</p>}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('الأسماءُ من سجلّ بطاقات السائقين، والضمُّ والإخراج يُكتبان فيه — فلا تفترق هذه الشاشة عن صفحة البطاقات ولا عن شاشة التفاويض.',
               'Names come from the driver-card register and changes are written there, so this screen cannot drift from the cards page or the authorisations tab.')}
          </p>
        </div>
      </div>
    </div>
  );
}
