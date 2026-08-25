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
import { ShieldCheck, RefreshCw, X, Check, ArrowRight } from 'lucide-react';
import {
  getCorporatePolicies, renewCorporatePolicy, canEditVehicles, STATE_META, stateLabel, money, fmtDate, daysText,
} from '@/lib/vehicleRegistry';

export default function CorporatePoliciesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();
  // كان زر التجديد ظاهرًا لكل من يفتح الصفحة، والسيرفر وحده يرفض — فيُقال للمستخدم
  // «ممنوع» بعد أن ملأ النموذج. البوابة نفسها المستعملة في بقية شاشات القسم.
  const { user } = useAuth();
  const canEdit = canEditVehicles(user);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState<any | null>(null);
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
      />

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
                <Fact label={t('القسط (ر.س)', 'Premium (SAR)')} value={p.premiumSar ? money(p.premiumSar) : '—'} />
              </div>

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
                <button onClick={() => setRenewing(p)}
                  className="w-full mt-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" />{t('تجديد الوثيقة', 'Renew policy')}
                </button>
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
