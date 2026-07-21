'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, LifeBuoy, History, Check, AlertTriangle } from 'lucide-react';
import {
  Spinner, PageHeader, PrimaryButton, SmallBadge, Field, TextArea, Select, Loader2,
} from '@/components/hr/HRKit';
import {
  canViewIt, Ticket, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES,
  categoryLabel, priorityLabel, ticketStatusLabel, optionsOf, empName, userName,
  fmtDate, fmtDateTime, fmtDuration,
} from '@/lib/it';

interface Sibling {
  _id: string;
  ticketNumber?: string;
  title: string;
  status: string;
  priority: string;
  reportedAt?: string;
  resolvedAt?: string;
  resolutionMinutes?: number;
  resolution?: string;
  rootCause?: string;
  requesterName?: string;
  requesterDepartment?: string;
}

export default function TicketDetailPage() {
  const { notify } = useDialog();
  const routeParams = useParams<{ id: string }>();
  const id = String(routeParams?.id || '');
  const router = useRouter();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ status: '', resolution: '', rootCause: '', preventiveAction: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ ticket: Ticket; siblings: Sibling[] }>(`/api/it/tickets/${id}`);
      setTicket(d.ticket);
      setSiblings(d.siblings || []);
      setDraft({
        status: d.ticket.status,
        resolution: d.ticket.resolution || '',
        rootCause: d.ticket.rootCause || '',
        preventiveAction: d.ticket.preventiveAction || '',
        notes: d.ticket.notes || '',
      });
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));

  const save = async () => {
    setSaving(true);
    try { await api.put(`/api/it/tickets/${id}`, draft); await load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;
  if (!ticket) return <div className="text-slate-500 p-8">{ar ? 'البلاغ غير موجود.' : 'Ticket not found.'}</div>;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-1 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{value || '—'}</span>
    </div>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.push('/system/it/tickets')} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {ar ? 'رجوع للبلاغات' : 'Back to tickets'}
      </button>

      <PageHeader
        icon={<LifeBuoy className="w-5 h-5" />}
        title={ticket.title}
        subtitle={`${ticket.ticketNumber || ''} · ${fmtDate(ticket.reportedAt)}`}
      >
        <div className="flex items-center gap-2">
          <SmallBadge bg={TICKET_STATUSES[ticket.status]?.bg || 'bg-slate-500/15'} text={TICKET_STATUSES[ticket.status]?.text || 'text-slate-700'} label={ticketStatusLabel(ticket.status, lang)} />
          <SmallBadge bg={TICKET_PRIORITIES[ticket.priority]?.bg || 'bg-slate-500/15'} text={TICKET_PRIORITIES[ticket.priority]?.text || 'text-slate-700'} label={priorityLabel(ticket.priority, lang)} />
        </div>
      </PageHeader>

      {ticket.isRecurring && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-red-800">{ar ? 'مشكلة متكررة' : 'Recurring problem'}</div>
            <p className="text-xs text-red-700/90 mt-1">
              {ar
                ? `تكررت هذه المشكلة ${siblings.length + 1} مرات. الحل المؤقت لن يكفي — يجب معالجة السبب الجذري.`
                : `This problem has now occurred ${siblings.length + 1} times. Patching it again won't hold — the root cause needs a permanent fix.`}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">{ar ? 'تفاصيل البلاغ' : 'Ticket details'}</h3>
          <Row label={ar ? 'التصنيف' : 'Category'} value={<SmallBadge bg={TICKET_CATEGORIES[ticket.category]?.bg || 'bg-slate-500/15'} text={TICKET_CATEGORIES[ticket.category]?.text || 'text-slate-700'} label={categoryLabel(ticket.category, lang)} />} />
          <Row label={ar ? 'مقدم البلاغ' : 'Requester'} value={ticket.requesterName || empName(ticket.requester, lang)} />
          <Row label={ar ? 'القسم' : 'Department'} value={ticket.requesterDepartment} />
          <Row label={ar ? 'المسؤول' : 'Assigned to'} value={ticket.assignedToName || userName(ticket.assignedTo)} />
          <Row label={ar ? 'الجهاز' : 'Device'} value={ticket.device} />
          <Row label={ar ? 'تاريخ البلاغ' : 'Reported at'} value={fmtDate(ticket.reportedAt)} />
          <Row label={ar ? 'تاريخ الحل' : 'Resolved at'} value={ticket.resolvedAt ? fmtDateTime(ticket.resolvedAt) : '—'} />
          <Row label={ar ? 'زمن الحل' : 'Resolution time'} value={fmtDuration(ticket.resolutionMinutes, lang)} />
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">{ar ? 'وصف المشكلة' : 'Description'}</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.description || (ar ? 'لا يوجد وصف.' : 'No description.')}</p>
          </div>

          {/* Inline edit — IT works the ticket from this page, not a modal. */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">{ar ? 'تحديث الحالة والحل' : 'Update status & resolution'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={ar ? 'الحالة' : 'Status'}>
                <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  {optionsOf(TICKET_STATUSES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
                </Select>
              </Field>
            </div>
            <Field label={ar ? 'ما تم عمله لحل المشكلة' : 'Resolution — what IT did'} span2>
              <TextArea rows={3} value={draft.resolution} onChange={(e) => setDraft({ ...draft, resolution: e.target.value })} />
            </Field>
            <Field label={ar ? 'السبب الجذري' : 'Root cause'} span2>
              <TextArea rows={2} value={draft.rootCause} onChange={(e) => setDraft({ ...draft, rootCause: e.target.value })} />
            </Field>
            <Field label={ar ? 'الإجراء الوقائي لمنع التكرار' : 'Preventive action'} span2>
              <TextArea rows={2} value={draft.preventiveAction} onChange={(e) => setDraft({ ...draft, preventiveAction: e.target.value })} />
            </Field>
            <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
              <TextArea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <PrimaryButton onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>

      {/* The repeat history — every earlier occurrence of this same problem,
          with what was tried each time. Reading it top-to-bottom is how you spot
          that the same workaround has been applied four times running. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-[#f37121]" />
          {ar ? 'مرات حدوث نفس المشكلة سابقاً' : 'Previous occurrences of this same problem'}
          <span className="text-xs font-normal text-slate-500">({siblings.length})</span>
        </h3>
        {siblings.length === 0 ? (
          <p className="text-sm text-slate-500">{ar ? 'هذه أول مرة تُسجَّل فيها هذه المشكلة.' : 'This is the first time this problem has been logged.'}</p>
        ) : (
          <ol className="relative space-y-4 ps-6">
            <span className="absolute top-1 bottom-1 start-[7px] w-px bg-slate-200" aria-hidden />
            {siblings.map((s) => (
              <li key={s._id} className="relative">
                <span className="absolute -start-6 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white bg-[#f37121] shadow" aria-hidden />
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/system/it/tickets/${s._id}`} className="text-sm font-medium text-slate-900 hover:text-[#f37121]">
                      {s.ticketNumber} · {s.title}
                    </Link>
                    <div className="flex items-center gap-2">
                      <SmallBadge bg={TICKET_STATUSES[s.status]?.bg || 'bg-slate-500/15'} text={TICKET_STATUSES[s.status]?.text || 'text-slate-700'} label={ticketStatusLabel(s.status, lang)} />
                      <span className="text-xs text-slate-500">{fmtDate(s.reportedAt)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {[s.requesterName, s.requesterDepartment].filter(Boolean).join(' · ')}
                    {typeof s.resolutionMinutes === 'number' && ` · ${ar ? 'زمن الحل' : 'resolved in'} ${fmtDuration(s.resolutionMinutes, lang)}`}
                  </div>
                  {s.resolution && (
                    <p className="text-xs text-slate-700 mt-2">
                      <span className="text-slate-500">{ar ? 'ما تم عمله: ' : 'What was done: '}</span>{s.resolution}
                    </p>
                  )}
                  {s.rootCause && (
                    <p className="text-xs text-slate-700 mt-1">
                      <span className="text-slate-500">{ar ? 'السبب الجذري: ' : 'Root cause: '}</span>{s.rootCause}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
