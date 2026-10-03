'use client';
/**
 * طلبات الأسطول — «أحتاج هذه الشاحنةَ وصيانتُها متأخّرة».
 *
 * ── ما تجيب عنه هذه الشاشة ──────────────────────────────────────────────────
 * مرآةُ لوكيشن سوليوشن تقول عن شاحنةٍ إنّ موعدَ صيانتها فات. وصار ذلك مانعًا
 * من التحميل في إدارة الأسطول — لا شارةً حمراءَ تُقرأ وتُهمَل. ومن احتاجها
 * رفع طلبًا، فهذه هي الطلبات: ما فات، ومن طلب، وما الحمولةُ المنتظرة، ولماذا.
 *
 * والقرارُ هنا لا هناك: من يملك الصيانةَ هو من يأذن بتأجيلها، ويُسجَّل اسمُه
 * مع القرار وسببِه. وموافقةٌ واحدةٌ لحمولةٍ واحدة — ثمّ تُستهلَك.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice, PrimaryButton, StatCard, TextArea } from '@/components/hr/HRKit';
import { ShieldQuestion, Check, X, Truck, Clock, AlertTriangle, User as UserIcon } from 'lucide-react';

interface FleetRequest {
  _id: string;
  vehicle: string;
  plate: string;
  service: string;
  kmToService: number | null;
  odometerKm: number | null;
  reason: string;
  load?: { customerName?: string; fromCity?: string; toCity?: string; loadDate?: string };
  requestedByName: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  usedBy?: string | null;
  usedAt?: string | null;
}

const DECIDE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'location_manager'];

export default function Ls2FleetRequestsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [rows, setRows] = useState<FleetRequest[]>([]);
  const [summary, setSummary] = useState<{ pending: number; approved: number; rejected: number; openApprovals: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const canDecide = !!user && DECIDE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ requests: FleetRequest[]; summary: any }>(`/api/ls2/fleet-requests?status=${status}`);
      setRows(d.requests || []);
      setSummary(d.summary || null);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:requests', useCallback(() => load(), [load]));

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusy(id);
    try {
      await api.post(`/api/ls2/fleet-requests/${id}/decide`, { decision, note: note[id] || '' });
      notify(decision === 'approved' ? t('سُجِّلت الموافقة', 'Approved') : t('سُجِّل الرفض', 'Rejected'), 'success');
      setNote((p) => ({ ...p, [id]: '' }));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر تسجيل القرار', 'Could not record'), 'error'); }
    setBusy('');
  };

  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const tone = useMemo(() => ({
    pending: 'border-amber-300 bg-amber-50',
    approved: 'border-emerald-300 bg-emerald-50',
    rejected: 'border-red-300 bg-red-50',
  }), []);

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShieldQuestion className="w-5 h-5" />}
        title={t('طلبات الأسطول', 'Fleet requests')}
        subtitle={t('تحميلٌ على شاحنةٍ فات موعدُ صيانتها — يُوافَق أو يُرفَض بالاسم',
                    'Loading a truck whose service is overdue — approved or refused, by name')} />

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* والبطاقةُ تُفتَح على صفوفها: ضغطةٌ تُبدّل الحالةَ المعروضة. */}
          <StatCard label={t('معلّقة', 'Pending')} value={summary.pending} accent={summary.pending ? 'text-amber-600' : undefined}
            onClick={() => setStatus('pending')} active={status === 'pending'} hint={t('اضغط لعرضها', 'tap to open')} />
          <StatCard label={t('مُوافَق عليها', 'Approved')} value={summary.approved} accent="text-emerald-600"
            onClick={() => setStatus('approved')} active={status === 'approved'} hint={t('اضغط لعرضها', 'tap to open')} />
          <StatCard label={t('مرفوضة', 'Rejected')} value={summary.rejected} accent="text-red-600"
            onClick={() => setStatus('rejected')} active={status === 'rejected'} hint={t('اضغط لعرضها', 'tap to open')} />
          {/* موافقةٌ لم تُستعمَل بعد = شاحنةٌ مفتوحةٌ لحمولةٍ واحدة. */}
          <StatCard label={t('موافقات لم تُستعمَل', 'Unused approvals')} value={summary.openApprovals} accent="text-slate-900"
            onClick={() => setStatus('approved')} active={status === 'approved'}
            hint={t('من المُوافَق عليها', 'within approved')} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([['pending', 'المعلّقة', 'Pending'], ['approved', 'المُوافَق عليها', 'Approved'],
           ['rejected', 'المرفوضة', 'Rejected'], ['all', 'الكل', 'All']] as const).map(([k, a, e]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${status === k
              ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]'}`}>
            {t(a, e)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">
          {status === 'pending' ? t('لا طلبَ معلّقًا — لا شاحنةَ تنتظر إذنًا.', 'Nothing pending.') : t('لا طلبات.', 'No requests.')}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r._id} className={`rounded-2xl border p-4 shadow-sm ${tone[r.status]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Truck className="w-4 h-4 text-slate-600" />
                <Link href={`/system/fleet/vehicles?q=${encodeURIComponent(r.plate)}`}
                  className="font-mono font-bold text-slate-900 hover:underline" dir="ltr">{r.plate}</Link>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  {r.service || t('صيانة دوريّة', 'Scheduled service')}
                  {r.kmToService != null ? ` · ${Math.abs(r.kmToService).toLocaleString('en-US')} ${t('كم', 'km')}` : ''}
                </span>
                {r.odometerKm != null && (
                  <span className="text-[11px] text-slate-500">{t('العدّاد', 'Odometer')}: {r.odometerKm.toLocaleString('en-US')}</span>
                )}
                <span className="ms-auto text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {fmt(r.createdAt)}
                </span>
              </div>

              <p className="mt-2 text-sm text-slate-800 inline-flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                <b>{r.requestedByName || '—'}</b>
                <span className="text-slate-600">{r.reason || t('بلا سبب مكتوب', 'no reason given')}</span>
              </p>

              {/* ما الحمولةُ المنتظرة: «ساعتان إلى جدّة» ليست «١٤٠٠ كم إلى جيزان». */}
              {(r.load?.toCity || r.load?.customerName) && (
                <p className="mt-1 text-xs text-slate-600">
                  {t('الحمولة', 'Load')}: {[r.load?.customerName, [r.load?.fromCity, r.load?.toCity].filter(Boolean).join(' ← '), r.load?.loadDate]
                    .filter(Boolean).join(' · ')}
                </p>
              )}

              {r.status === 'pending' ? (
                canDecide ? (
                  <div className="mt-3 space-y-2">
                    <TextArea value={note[r._id] || ''} onChange={(e: any) => setNote((p) => ({ ...p, [r._id]: e.target.value }))}
                      rows={2} placeholder={t('سببُ القرار — «امشِ بها وأحضِرها الخميس»', 'Decision note')} />
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton onClick={() => decide(r._id, 'approved')} disabled={busy === r._id}>
                        <Check className="w-4 h-4" /> {t('موافقة — تُحمَّل مرّةً واحدة', 'Approve — one load')}
                      </PrimaryButton>
                      <button type="button" onClick={() => decide(r._id, 'rejected')} disabled={busy === r._id}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-300 text-red-700 font-semibold text-sm hover:bg-red-50">
                        <X className="w-4 h-4" /> {t('رفض — تدخل الورشة', 'Refuse — workshop first')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-amber-700 font-semibold">
                    {t('بانتظار قرار مدير لوكيشن سوليوشن.', 'Awaiting the Location Solutions manager.')}
                  </p>
                )
              ) : (
                <div className="mt-2 text-xs">
                  <p className={r.status === 'approved' ? 'text-emerald-800 font-semibold' : 'text-red-800 font-semibold'}>
                    {r.status === 'approved' ? t('وُوفق عليه', 'Approved') : t('مرفوض', 'Rejected')} — {r.decidedByName || '—'} · {fmt(r.decidedAt)}
                  </p>
                  {r.decisionNote && <p className="text-slate-700 mt-0.5">{r.decisionNote}</p>}
                  {r.status === 'approved' && (
                    <p className="text-slate-600 mt-0.5">
                      {r.usedBy
                        ? `${t('استُعملت في حمولةٍ', 'used on a load')} · ${fmt(r.usedAt)}`
                        : t('لم تُستعمَل بعد — تصلح لحمولةٍ واحدة', 'not used yet — good for one load')}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
