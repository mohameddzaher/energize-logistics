'use client';
// وثائق التأمين على مستوى الشركة — مش مربوطة بعربية.
//
// تأمين البضائع وخيانة الأمانة. انتهاء واحدة منها بيوقّف الشغل كله، مش عربية
// واحدة — عشان كده لها صفحتها وبتظهر في النظرة الشاملة جنب مستندات المركبات.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ShieldCheck, RefreshCw, X, Check, ArrowRight } from 'lucide-react';
import {
  getCorporatePolicies, renewCorporatePolicy, STATE_META, stateLabel, money, fmtDate, daysText,
} from '@/lib/vehicleRegistry';

export default function CorporatePoliciesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState<any | null>(null);

  const load = useCallback(async () => {
    try { setRows((await getCorporatePolicies()).policies || []); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('vreg:updated', useCallback(() => { load(); }, [load]));

  if (loading) return <Spinner />;

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
            <div key={p._id} className="bg-white border rounded-xl p-5 shadow-sm"
              style={{ borderColor: p.state === 'valid' ? '#e2e8f0' : m.color }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900">{p.scopeAr}</h3>
                  <p className="text-[12px] text-slate-500 mt-1">{p.policyholderAr}</p>
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

              <button onClick={() => setRenewing(p)}
                className="w-full mt-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" />{t('تجديد الوثيقة', 'Renew policy')}
              </button>
            </div>
          );
        })}
        {!rows.length && <p className="text-slate-400 text-sm">{t('لا توجد وثائق', 'No policies')}</p>}
      </div>

      {renewing && <RenewModal p={renewing} ar={ar} t={t} notify={notify}
        onClose={() => setRenewing(null)} onDone={() => { setRenewing(null); load(); }} />}
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
