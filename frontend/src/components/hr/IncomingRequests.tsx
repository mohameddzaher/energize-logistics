'use client';
// Employee requests that reach the reader: as a direct manager, as the department a request was sent to, or as top
// management. Whoever holds a request forwards it to another department, handles it, or rejects it
// (GET /api/hr/me/incoming-requests, POST /api/hr/me/requests/:id/action; backend utils/requestRouting).
// `target` narrows the list to one department's desk (HR, finance, top management).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, Send, Check, X, ArrowLeftRight, Play, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, Spinner, Badge, Modal, Field, TextInput, TextArea, Select, PrimaryButton, SearchInput } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import FilePicker, { AttachmentList, type PickedFile } from '@/components/system/FilePicker';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import RequestRoute, { whereNow, type Target } from '@/components/hr/RequestRoute';
import { HRRequest, REQUEST_STATUS, categoryLabel, userName, fmtDateTime } from '@/lib/hr';

type Row = HRRequest & { employee?: any };
const idOf = (e: any) => (e?.idType === 'national_id' ? (e?.nationalId || e?.iqamaNumber) : (e?.iqamaNumber || e?.nationalId)) || '';
const OPEN = ['open', 'in_progress', 'received'];

export default function IncomingRequests({ target, title, subtitle }: {
  target?: string; title?: { ar: string; en: string }; subtitle?: { ar: string; en: string };
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify } = useDialog();
  const [rows, setRows] = useState<Row[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'open' | 'done' | 'all'>('pending');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ requests: Row[]; targets: Target[] }>('/api/hr/me/incoming-requests');
      setRows(d.requests || []); setTargets(d.targets || []);
      setOpen((c) => (c ? (d.requests || []).find((r) => r._id === c._id) || c : c));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:request', useCallback(() => { load(); }, [load]));

  // A desk shows what is or was sent to its department.
  const scoped = useMemo(() => (target
    ? rows.filter((r) => r.targetSection === target || (r.history || []).some((h) => h.toSection === target))
    : rows), [rows, target]);
  const inTab = (r: Row) => (tab === 'pending' ? !!r.canAct : tab === 'open' ? OPEN.includes(r.status) : tab === 'done' ? !OPEN.includes(r.status) : true);
  const shown = scoped.filter((r) => inTab(r) && (!q.trim() || `${userName(r.requester)} ${r.subject} ${r.employee?.department || ''}`.includes(q.trim())));
  const counts = {
    pending: scoped.filter((r) => r.canAct).length,
    open: scoped.filter((r) => OPEN.includes(r.status)).length,
    done: scoped.filter((r) => !OPEN.includes(r.status)).length,
    all: scoped.length,
  };

  const cols: ExportColumn[] = [
    { header: t('الموظف', 'Employee'), key: 'requester', transform: (v) => userName(v), width: 24 },
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employee', transform: (v) => v?.employeeNumber || '', width: 14 },
    { header: t('رقم الهوية', 'ID number'), key: 'employee', transform: (v) => idOf(v), width: 16 },
    { header: t('القسم', 'Department'), key: 'employee', transform: (v) => v?.department || '', width: 20 },
    { header: t('النوع', 'Type'), key: 'category', transform: (v) => categoryLabel(v, lang), width: 18 },
    { header: t('الموضوع', 'Subject'), key: 'subject', width: 32 },
    { header: t('عند', 'With'), key: '_id', transform: (_v, r: any) => whereNow(r, targets, ar), width: 26 },
    { header: t('الحالة', 'Status'), key: 'status', transform: (v) => (ar ? REQUEST_STATUS[v]?.ar : REQUEST_STATUS[v]?.en) || v, width: 14 },
    { header: t('آخر تحديث', 'Updated'), key: 'updatedAt', transform: (v) => fmtDateTime(v), width: 20 },
  ];
  const scope = exportScopeLabels(ar);

  return (
    <div className="space-y-4">
      <PageHeader icon={<Inbox className="w-6 h-6" />}
        title={title ? t(title.ar, title.en) : t('الطلبات الواردة', 'Incoming Requests')}
        subtitle={subtitle ? t(subtitle.ar, subtitle.en) : t('طلبات الموظفين التي وصلتك بصفتك مديرًا مباشرًا أو لأنها حُوِّلت إلى قسمك. حوِّلها إلى قسم آخر، أو أنجزها، أو ارفضها.', 'Staff requests that reached you as a direct manager or because they were sent to your department. Forward, handle or reject them.')}>
        <ExportMenu fileName="incoming-requests" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export Excel')}
          options={[{ key: 'shown', label: scope.shown, sheets: [{ name: t('الطلبات', 'Requests'), rows: shown, columns: cols }] },
            { key: 'all', label: scope.all, sheets: [{ name: t('الطلبات', 'Requests'), rows: scoped, columns: cols }] }]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {([['pending', 'تنتظر إجراءك', 'Waiting on you'], ['open', 'مفتوحة', 'Open'], ['done', 'منتهية', 'Finished'], ['all', 'الكل', 'All']] as const).map(([k, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold ${tab === k ? 'bg-[#12325C] text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
            {t(a, e)} <span className="tabular-nums">{counts[k].toLocaleString('en-US')}</span>
          </button>
        ))}
        <div className="flex-1 min-w-[200px] max-w-sm ms-auto"><SearchInput value={q} onChange={setQ} placeholder={t('بحث بالاسم أو الموضوع أو القسم…', 'Name, subject or department…')} /></div>
      </div>

      {loading ? <Spinner /> : shown.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
          {tab === 'pending' ? t('لا شيء ينتظر إجراءك', 'Nothing waits on you') : t('لا توجد طلبات هنا', 'Nothing here')}
        </div>
      ) : (
        <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 text-slate-300 text-xs">
              {[t('الموظف', 'Employee'), t('الطلب', 'Request'), t('عند', 'With'), t('الحالة', 'Status'), t('آخر تحديث', 'Updated')]
                .map((h, i) => <th key={i} className="px-3 py-3 text-start font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-900">{userName(r.requester) || '—'}</p>
                    <p className="text-[11px] text-slate-500">{[r.employee?.employeeNumber && `#${r.employee.employeeNumber}`, idOf(r.employee), r.employee?.department, r.employee?.jobTitle].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-3 py-2.5 max-w-[320px]">
                    <p className="font-medium text-slate-800 truncate" title={r.subject}>{r.subject}</p>
                    <p className="text-[11px] text-slate-500">{categoryLabel(r.category, lang)}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                    {whereNow(r, targets, ar)}
                    {r.canAct && <span className="ms-2 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold">{t('عندك', 'Yours')}</span>}
                  </td>
                  <td className="px-3 py-2.5"><Badge style={REQUEST_STATUS[r.status]} lang={lang} /></td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap tabular-nums" dir="ltr">{fmtDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}

      <RequestDetail r={open} targets={targets} meId={user?._id} onClose={() => setOpen(null)} onChanged={(nr) => { setOpen((c) => (c ? { ...c, ...nr } : c)); load(); }} />
    </div>
  );
}

/** One request: who asked, its route and history, the conversation, and the holder's actions. */
export function RequestDetail({ r, targets, meId, onClose, onChanged }: {
  r: Row | null; targets: Target[]; meId?: string; onClose: () => void; onChanged: (r: Row) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [reply, setReply] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<null | 'forward' | 'resolve' | 'reject'>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { setReply(''); setLink(''); setFiles([]); setAct(null); setNote(''); setTo(''); }, [r?._id]);

  const send = async () => {
    if (!r || (!reply.trim() && !link.trim() && !files.length)) return;
    setBusy(true);
    try { const d = await api.post<{ request: Row }>(`/api/hr/requests/${r._id}/reply`, { body: reply, link, files }); setReply(''); setLink(''); setFiles([]); onChanged(d.request); }
    catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };
  const run = async (action: string, extra: Record<string, string> = {}) => {
    if (!r) return;
    setBusy(true);
    try {
      const d = await api.post<{ request: Row }>(`/api/hr/me/requests/${r._id}/action`, { action, note, ...extra });
      setAct(null); setNote(''); setTo(''); onChanged({ ...d.request, canAct: false });
      notify(t('تمّ', 'Done'), 'success');
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  const finished = !!r && !OPEN.includes(r.status);
  return (
    <Modal open={!!r} onClose={onClose} wide title={r?.subject || ''}>
      {r && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-2 text-sm">
            <p><span className="text-slate-500">{t('الموظف', 'Employee')}: </span><b>{userName(r.requester)}</b></p>
            <p><span className="text-slate-500">{t('القسم', 'Department')}: </span>{r.employee?.department || '—'}</p>
            <p><span className="text-slate-500">{t('النوع', 'Type')}: </span>{categoryLabel(r.category, lang)} · <Badge style={REQUEST_STATUS[r.status]} lang={lang} /></p>
          </div>
          <RequestRoute r={r} targets={targets} ar={ar} />

          <div className="space-y-3 max-h-64 overflow-y-auto">
            {r.thread.length === 0 && <p className="text-slate-500 text-sm">{t('لا رسائل بعد', 'No messages yet')}</p>}
            {r.thread.map((m, i) => {
              const mine = String(m.sender?._id || m.sender) === String(meId);
              return (
                <div key={m._id || i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${mine ? 'bg-orange-50 text-slate-900 border border-orange-200' : 'bg-slate-100 text-slate-900'}`}>
                    <p className="text-xs text-slate-500 mb-1">{userName(m.sender)} · <span dir="ltr" className="tabular-nums">{fmtDateTime(m.at)}</span></p>
                    {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                    {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="text-[#f37121] underline text-xs" dir="ltr">{m.link}</a>}
                    <AttachmentList items={(m as any).attachments} />
                  </div>
                </div>
              );
            })}
          </div>

          {!finished && (
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1"><TextInput placeholder={t('اكتب ردًّا للموظف…', 'Reply to the employee…')} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
                <PrimaryButton onClick={send} disabled={busy || (!reply.trim() && !link.trim() && !files.length)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</PrimaryButton>
              </div>
              <TextInput placeholder={t('رابط (اختياري)', 'Link (optional)')} value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" />
              <FilePicker files={files} onChange={setFiles} />
            </div>
          )}

          {r.canAct && !finished && (
            <div className="border-t border-slate-200 pt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAct('forward')} className={`px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${act === 'forward' ? 'bg-[#12325C] text-white' : 'bg-white border border-slate-300 text-slate-800'}`}><ArrowLeftRight className="w-4 h-4" />{t('تحويل إلى قسم', 'Forward to a department')}</button>
                {r.stage === 'department' && r.status === 'open' && (
                  <button type="button" disabled={busy} onClick={() => run('in_progress')} className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 bg-white border border-slate-300 text-slate-800"><Play className="w-4 h-4" />{t('بدء التنفيذ', 'Start')}</button>
                )}
                <button type="button" onClick={() => setAct('resolve')} className={`px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${act === 'resolve' ? 'bg-emerald-600 text-white' : 'bg-white border border-emerald-300 text-emerald-800'}`}><Check className="w-4 h-4" />{t('إنجاز الطلب', 'Mark handled')}</button>
                <button type="button" onClick={() => setAct('reject')} className={`px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${act === 'reject' ? 'bg-red-600 text-white' : 'bg-white border border-red-300 text-red-700'}`}><X className="w-4 h-4" />{t('رفض', 'Reject')}</button>
              </div>
              {act && (
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  {act === 'forward' && (
                    <Field label={t('القسم الذي يُحوَّل إليه', 'Send to')}>
                      <Select value={to} onChange={(e) => setTo(e.target.value)}>
                        <option value="">{t('اختر القسم…', 'Choose…')}</option>
                        {targets.filter((x) => !(r.stage === 'department' && x.key === r.targetSection)).map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Field label={act === 'reject' ? t('سبب الرفض (يصل إلى الموظف)', 'Reason (sent to the employee)') : t('ملاحظة (اختيارية، تصل إلى الموظف)', 'Note (optional, sent to the employee)')}>
                    <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <div className="flex justify-end">
                    <PrimaryButton disabled={busy || (act === 'forward' && !to) || (act === 'reject' && !note.trim())}
                      onClick={() => run(act, act === 'forward' ? { toSection: to } : {})}>
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {act === 'forward' ? t('تحويل', 'Forward') : act === 'resolve' ? t('تأكيد الإنجاز', 'Confirm') : t('تأكيد الرفض', 'Reject')}
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
