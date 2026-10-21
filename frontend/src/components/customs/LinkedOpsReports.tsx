'use client';
/**
 * «كشوف التشغيل المرتبطة» في صفحة معاملة التخليص.
 *
 * كلُّ كشف تخريجٍ نقل حاويةً من هذه المعاملة — من خانات النقل هنا، أو سندُه
 * بوليصتُها أو حاويتُها، أو ربطه التشغيلُ بيده — ومعه أين وصل: فُوتر؟ حُصِّل؟
 * والأرقامُ المكتوبةُ في خانات النقل ولم يصل كشفُها بعدُ تُذكر وحدَها.
 *
 * ── والصفُّ يُفتَح على الكشف كلِّه ──────────────────────────────────────────
 * طلبُ صاحب الشركة: «اعرض كلَّ شيءٍ عن الكشف هنا، ودع المستخدمَ يتابع ويعدّل من
 * المكان نفسِه». فالصفُّ المفتوح يعرض الكشفَ بحقوله كلِّها **كما يراها هذا الدورُ
 * في سير العمل** — الخادمُ يحجب قيمةَ البيع وأعمدةَ المال بالقاعدة نفسِها
 * (`stripRowFor`)، فلا تُحجب هنا بقائمةٍ ثانية. والتعديلُ يُحفظ من النقطة نفسِها
 * التي تحفظ منها صفحةُ الكشف (`PUT /api/workflows/:id`) بقفلها وقواعد فوترتها
 * ودفعِ قيمة البيع إلى المنصّة — لا طريقَ كتابةٍ ثانٍ. وما يُعرض قابلًا للتعديل
 * هو ما يقول الخادمُ إنّه سيقبله (`access.fields`).
 *
 * ويتحدّث وحدَه: `customs:opsLinks` حين يتغيّر ربطٌ أو يُعدَّل كشفٌ مربوط،
 * و`collections:changed` حين تُفوتَر الكشوفُ أو تُحصَّل، و`workflow:followUps`
 * حين تُكتب متابعة. راجع backend/src/services/customsOpsLink.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck, ChevronDown, Edit, Save, Loader2, Lock, MessageSquareText, Paperclip, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { canAccessSection } from '@/lib/sections';
import { money, dt } from '@/lib/collections';
import { PAYMENT_CHOICES, paymentKindLabel, paymentKindOf } from '@/lib/paymentKind';
import { WORKFLOW_SECTIONS, type WorkflowField } from '@/lib/workflowFields';
import { viaLabel } from '@/components/customs/CustomsLinkBadge';
import ReportFollowUps from '@/components/operations/ReportFollowUps';

type Billing = 'collected' | 'invoiced' | 'cash_pending' | 'not_invoiced';
type Rep = {
  _id: string; reportNumber: string; reportDate: string | null; route: string; carNumber: string; driverName: string;
  customer?: string; applicationStatus?: string; executionStatus?: string; documentNumber?: string;
  paymentType: string; paymentSubtype?: string; invoiceNumber: string; invoiceDate: string | null; deliveryDate?: string | null;
  collectionDate: string | null; billing: Billing; via: string; containers: string[]; sellingValue?: number; totalInvoice?: number;
  followUps?: number; attachments?: number;
  /** الكشفُ كلُّه كما يراه هذا الدورُ في سير العمل (محجوبًا على الخادم). */
  detail?: Record<string, any>;
};
type Access = { canEdit: boolean; fields: string[]; money: boolean; selling: boolean };
type Resp = {
  reports: Rep[];
  pendingRefs: { reportNumber: string; state: 'not_arrived' | 'linked_elsewhere'; otherRef?: string }[];
  summary: { total: number; collected: number; invoiced: number; cashPending: number; notInvoiced: number; selling?: number };
  access?: Access;
};

const BILLING: Record<Billing, [string, string, string]> = {
  collected: ['محصَّل', 'Collected', 'bg-emerald-50 text-emerald-700'],
  invoiced: ['مفوتر — لم يُحصَّل', 'Invoiced — open', 'bg-amber-50 text-amber-700'],
  cash_pending: ['نقديّ — لم يُحصَّل', 'Cash — open', 'bg-amber-50 text-amber-700'],
  not_invoiced: ['لم يُفوتَر', 'Not invoiced', 'bg-slate-100 text-slate-600'],
};

const LOCK_MS = 5 * 60 * 1000;
const dayOf = (v: any) => (v ? String(v).split('T')[0] : '');
/** قيمةُ الخانة في نموذج التعديل — كما تكتبها صفحةُ الكشف. */
const formValue = (f: WorkflowField, d: Record<string, any>) => (
  f.type === 'ptype' ? paymentKindOf(d as any) : f.type === 'date' ? dayOf(d[f.key]) : (d[f.key] ?? '')
);

/** خانةٌ واحدة: تُقرأ، أو تُكتب إن كانت للدور. */
function FieldCell({ f, d, editing, editable, value, onChange, ar }: {
  f: WorkflowField; d: Record<string, any>; editing: boolean; editable: boolean;
  value: any; onChange: (v: any) => void; ar: boolean;
}) {
  const label = (
    <label className="block text-[11px] text-slate-500 mb-1">{ar ? f.label : f.labelEn}</label>
  );
  const input = 'w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40 [color-scheme:light]';
  if (editing && editable && f.type === 'ptype') {
    return (
      <div>
        {label}
        <select value={value || ''} title={f.label} onChange={(e) => onChange(e.target.value)} className={input}>
          <option value="" disabled>{ar ? '— اختر —' : '— select —'}</option>
          {(value === 'cash' || value === 'tax') && <option value={value} disabled>{paymentKindLabel(value, ar)}</option>}
          {PAYMENT_CHOICES.map((k) => <option key={k} value={k}>{paymentKindLabel(k, ar)}</option>)}
        </select>
      </div>
    );
  }
  if (editing && editable) {
    return (
      <div>
        {label}
        <input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={value ?? ''} title={f.label}
          onChange={(e) => onChange(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          className={input} />
      </div>
    );
  }
  const v = d[f.key];
  const shown = f.type === 'ptype' ? paymentKindLabel(paymentKindOf(d as any), ar)
    : f.type === 'date' ? (v ? dt(v) : '')
      : f.type === 'number' ? (v || v === 0 ? money(v) : '')
        : (v == null ? '' : String(v));
  return (
    <div>
      {label}
      <p className={`text-sm py-1 break-words ${editing ? 'text-slate-400' : 'text-slate-900'}`}>
        {shown || <span className="text-slate-300">—</span>}
        {editing && !editable && <Lock className="inline w-3 h-3 ms-1 text-slate-300" />}
      </p>
    </div>
  );
}

/** الصفُّ المفتوح: الكشفُ كلُّه، وتعديلُه، ومتابعاتُه. */
function ReportDetail({ r, access, clearanceId, ar, canOpenOps, userId, onSaved }: {
  r: Rep; access: Access; clearanceId: string; ar: boolean; canOpenOps: boolean; userId: string;
  onSaved: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const d = r.detail || {};
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [orig, setOrig] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const can = new Set(access.fields);
  // ما يصل من الخادم هو ما يحقّ للدور أن يراه — فالقسمُ الذي لا خانةَ فيه لا يُعرض.
  const sections = WORKFLOW_SECTIONS
    .map((s) => ({ ...s, fields: s.fields.filter((f) => f.key in d || (f.type === 'ptype' && 'paymentType' in d)) }))
    .filter((s) => s.fields.length);
  const lockedByOther = !!d.lockedBy && d.lockedBy !== userId && (!d.lockedAt || Date.now() - new Date(d.lockedAt).getTime() < LOCK_MS);
  const editableKeys = sections.flatMap((s) => s.fields).filter((f) => can.has(f.key)).map((f) => f.key);

  const start = async () => {
    setError(''); setNote(''); setBusy(true);
    try {
      // القفلُ نفسُه الذي تأخذه صفحةُ الكشف — فلا يكتب اثنان على كشفٍ واحد.
      await api.post(`/api/workflows/${r._id}/lock`);
      const fd: Record<string, any> = {};
      for (const s of sections) for (const f of s.fields) fd[f.key] = formValue(f, d);
      setForm(fd); setOrig(fd); setEditing(true);
    } catch (e: any) {
      setError(e?.message || t('تعذّر فتح الكشف للتعديل', 'Could not open the report for editing'));
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    try { await api.post(`/api/workflows/${r._id}/unlock`); } catch { /* القفلُ ينتهي وحدَه */ }
    setEditing(false); setError('');
  };

  const save = async () => {
    // ما تغيّر وحدَه يُرسَل: إرسالُ نوع الدفع كما هو يختمه «اختيارَ يد».
    const payload: Record<string, any> = {};
    for (const k of editableKeys) if (String(form[k] ?? '') !== String(orig[k] ?? '')) payload[k] = form[k];
    if (!Object.keys(payload).length) { await cancel(); return; }
    setBusy(true); setError('');
    try {
      const out = await api.put<any>(`/api/workflows/${r._id}`, payload);
      try { await api.post(`/api/workflows/${r._id}/unlock`); } catch { /* */ }
      setEditing(false);
      setNote(out?.refusedMessage || t('حُفظ التعديل.', 'Saved.'));
      onSaved();
    } catch (e: any) {
      // رسالةُ الخادم كما هي: «لا يُسجَّل تاريخ السداد إلا بعد…»، «الكشف نقديّ…».
      setError(e?.message || t('تعذّر الحفظ', 'Could not save'));
    } finally { setBusy(false); }
  };

  const b = BILLING[r.billing];
  return (
    <div className="bg-slate-50/70 px-4 py-4 space-y-4">
      {/* الحالُ بكلمة: الفوترةُ والتحصيلُ والتسليمُ والمرفقات. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-medium ${b[2]}`}>{ar ? b[0] : b[1]}</span>
        {r.paymentType && <span className="rounded px-1.5 py-0.5 bg-white border border-slate-200 text-slate-700">{paymentKindLabel(paymentKindOf(r as any), ar)}</span>}
        {r.invoiceNumber && <span className="text-slate-600">{t('فاتورة', 'Invoice')} <span className="font-semibold text-slate-900">{r.invoiceNumber}</span>{r.invoiceDate ? ` · ${dt(r.invoiceDate)}` : ''}</span>}
        {r.deliveryDate && <span className="text-slate-600">{t('سُلِّمت للعميل', 'Delivered')} {dt(r.deliveryDate)}</span>}
        {r.collectionDate && <span className="text-emerald-700">{t('حُصِّل', 'Collected')} {dt(r.collectionDate)}</span>}
        <span className="inline-flex items-center gap-1 text-slate-500"><Paperclip className="w-3 h-3" />{t('مرفقات الفاتورة', 'Invoice attachments')} {r.attachments || 0}</span>
        {lockedByOther && <span className="inline-flex items-center gap-1 text-red-600"><Lock className="w-3 h-3" />{t(`يعدّله ${d.lockedByName || 'مستخدمٌ آخر'}`, `Being edited by ${d.lockedByName || 'another user'}`)}</span>}
        <span className="ms-auto flex items-center gap-2">
          {canOpenOps && (
            <Link href={`/system/operations/${r._id}`} className="inline-flex items-center gap-1 text-[#f37121] hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />{t('صفحة الكشف', 'Report page')}
            </Link>
          )}
          {access.canEdit && editableKeys.length > 0 && !editing && !lockedByOther && (
            <button type="button" onClick={start} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-slate-700 hover:text-slate-900 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Edit className="w-3.5 h-3.5" />}{t('تعديل', 'Edit')}
            </button>
          )}
          {editing && (
            <>
              <button type="button" onClick={cancel} disabled={busy} className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-slate-600">{t('إلغاء', 'Cancel')}</button>
              <button type="button" onClick={save} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-2.5 py-1 font-medium text-white disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{t('حفظ', 'Save')}
              </button>
            </>
          )}
        </span>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {note && !error && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{note}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((s) => (
          <div key={s.group} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-semibold text-slate-700">{ar ? s.titleAr : s.title}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {s.fields.map((f) => (
                <FieldCell key={f.key} f={f} d={d} ar={ar} editing={editing} editable={can.has(f.key)}
                  value={form[f.key]} onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <MessageSquareText className="w-3.5 h-3.5 text-slate-500" />{t('المتابعة', 'Follow-up')}
        </p>
        <ReportFollowUps compact ar={ar} workflowId={r._id}
          basePath={`/api/customs-clearance/${clearanceId}/ops-reports/${r._id}/follow-ups`} />
      </div>
    </div>
  );
}

export default function LinkedOpsReports({ clearanceId, ar }: { clearanceId: string; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const canOpenOps = user?.role === 'super_admin' || canAccessSection(user?.permissions, 'Operations');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<Resp>(`/api/customs-clearance/${clearanceId}/ops-reports`);
      if (guard.isCurrent(mine)) { setData(d); setError(''); }
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || t('تعذّر التحميل', 'Could not load'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearanceId, guard]);
  useEffect(() => { load(); }, [load]);

  useSocket('customs:opsLinks', useCallback((d: any) => {
    if (!d || !Array.isArray(d.clearanceIds) || d.clearanceIds.includes(clearanceId)) load();
  }, [clearanceId, load]));
  useSocket('collections:changed', useCallback(() => { load(); }, [load]));
  useSocket('customs:updated', useCallback((d: any) => {
    const id = d?.clearance?._id || d?.id;
    if (!id || String(id) === clearanceId) load();
  }, [clearanceId, load]));
  // عددُ المتابعات في الصفّ المطويّ — المتابعةُ تُكتب من التشغيل والتحصيل أيضًا.
  useSocket('workflow:followUps', useCallback((d: any) => {
    if (!d || d.clearanceId === clearanceId) load();
  }, [clearanceId, load]));

  const toggle = (id: string) => setOpen((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const s = data?.summary;
  const access: Access = data?.access || { canEdit: false, fields: [], money: false, selling: false };
  const showSelling = typeof s?.selling === 'number';
  const heads = [
    '', t('رقم الكشف', 'Report'), t('التاريخ', 'Date'), t('المسار', 'Route'), t('السيارة', 'Vehicle'),
    t('الحاويات', 'Containers'), t('الفاتورة', 'Invoice'), t('حالة التحصيل', 'Collection'),
    ...(showSelling ? [t('قيمة البيع', 'Selling')] : []), t('المتابعة', 'Follow-up'), t('مصدر الربط', 'Source'),
  ];
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-500" /> {t('كشوف التشغيل المرتبطة', 'Linked operations reports')}
          {s ? <span className="text-slate-400 font-normal">({s.total})</span> : null}
        </h2>
        {s && s.total > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {s.collected > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.collected[2]}`}>{t('محصَّل', 'Collected')} {s.collected}</span>}
            {s.invoiced + s.cashPending > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.invoiced[2]}`}>{t('لم يُحصَّل', 'Open')} {s.invoiced + s.cashPending}</span>}
            {s.notInvoiced > 0 && <span className={`rounded px-1.5 py-0.5 ${BILLING.not_invoiced[2]}`}>{t('لم يُفوتَر', 'Not invoiced')} {s.notInvoiced}</span>}
            {showSelling && <span className="rounded px-1.5 py-0.5 bg-slate-50 text-slate-600">{t('قيمة البيع', 'Selling')} {money(s.selling)}</span>}
            {canOpenOps && (
              <Link href={`/system/operations?customs=${clearanceId}`} className="text-[#f37121] hover:underline ms-1">
                {t('عرضها في سير العمل', 'Open in the workflow')}
              </Link>
            )}
          </div>
        )}
      </div>

      {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}
      {!error && !data && <p className="px-5 py-4 text-sm text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {data && !data.reports.length && !data.pendingRefs.length && (
        <p className="px-5 py-4 text-sm text-slate-500">
          {t('لا كشوفَ تشغيلٍ مرتبطة. يُربط الكشفُ حين يُكتب رقمُه في خانة نقل الحاوية بسيّارة الشركة، أو حين يكون «رقم السند» فيه رقمَ البوليصة.',
            'No linked reports. A report links when its number is written in a container transport entry, or when its document number is this B/L.')}
        </p>
      )}

      {data && data.reports.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {heads.map((h, i) => <th key={`${i}-${h}`} className="px-3 py-2 text-start font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => {
                const isOpen = open.has(r._id);
                return (
                  <Fragment key={r._id}>
                    <tr className={`border-b border-slate-100 cursor-pointer ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`} onClick={() => toggle(r._id)}>
                      <td className="ps-3 pe-1 py-2 w-6">
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-900">{r.reportNumber}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{dt(r.reportDate)}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.route || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.carNumber || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.containers.length
                          ? <span dir="ltr" className="font-mono text-xs text-slate-700">{r.containers.join(', ')}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {r.paymentType === 'cash' ? t('نقديّ', 'Cash') : (r.invoiceNumber || <span className="text-slate-300">—</span>)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BILLING[r.billing][2]}`}>{ar ? BILLING[r.billing][0] : BILLING[r.billing][1]}</span>
                        {r.collectionDate && <span className="ms-1.5 text-[11px] text-slate-400">{dt(r.collectionDate)}</span>}
                      </td>
                      {showSelling && <td className="px-3 py-2 tabular-nums text-slate-900">{money(r.sellingValue)}</td>}
                      <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-500">
                        {r.followUps ? <span className="inline-flex items-center gap-1 text-slate-700"><MessageSquareText className="w-3.5 h-3.5" />{r.followUps}</span> : '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{viaLabel(r.via, ar)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-200">
                        <td colSpan={heads.length} className="p-0">
                          <ReportDetail r={r} access={access} clearanceId={clearanceId} ar={ar}
                            canOpenOps={canOpenOps} userId={String(user?._id || '')} onSaved={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pendingRefs.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
          {data.pendingRefs.map((p) => (
            <p key={p.reportNumber}>
              <span className="font-semibold text-slate-800">{p.reportNumber}</span>{' — '}
              {p.state === 'not_arrived'
                ? t('مكتوبٌ في خانة النقل ولم يصل كشفُه من منصّة التشغيل بعد؛ يُربط حين يصل.', 'Written in a transport entry; the report has not arrived from the platform yet.')
                : t(`ربطه التشغيلُ يدويًّا بالمعاملة ${p.otherRef || ''}.`, `Linked by hand to ${p.otherRef || 'another clearance'}.`)}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
