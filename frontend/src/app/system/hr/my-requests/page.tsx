'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ClipboardList, Plus, Send, Link2, Check } from 'lucide-react';
import { HRRequest, REQUEST_STATUS, REQUEST_CATEGORIES, categoryLabel, userName, fmtDateTime } from '@/lib/hr';
import { Spinner, PageHeader, PrimaryButton, Badge, Modal, Field, TextInput, Select, TextArea, Loader2, ExportButton } from '@/components/hr/HRKit';
import { getHrMyRequestsTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

export default function MyRequestsPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrMyRequestsTranslations(lang);

  const [requests, setRequests] = useState<HRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'salary_certificate', subject: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<HRRequest | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api.get<{ requests: HRRequest[] }>('/api/hr/me/requests'); setRequests(d.requests || []); setOpen((c) => (c ? d.requests.find((r) => r._id === c._id) || c : c)); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:request', useCallback(() => load(), [load]));

  const submit = async () => {
    if (!form.subject.trim()) return;
    setSaving(true);
    try { await api.post('/api/hr/me/requests', form); setShowForm(false); setForm({ category: 'salary_certificate', subject: '', body: '' }); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const sendReply = async () => {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try { const d = await api.post<{ request: HRRequest }>(`/api/hr/requests/${open._id}/reply`, { body: reply }); setOpen(d.request); setReply(''); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  const exportRows = () => {
    exportToExcel(requests, [
      { header: tx.colCategory, key: 'category', transform: (v) => categoryLabel(v, lang), width: 22 },
      { header: tx.colSubject, key: 'subject', width: 32 },
      { header: tx.colStatus, key: 'status', transform: (v) => (ar ? REQUEST_STATUS[v]?.ar : REQUEST_STATUS[v]?.en) || v, width: 16 },
      { header: tx.colUpdated, key: 'updatedAt', transform: (v) => fmtDateTime(v), width: 20 },
    ], 'my-requests', tx.pageTitle);
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ClipboardList className="w-5 h-5" />} title={tx.pageTitle}>
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={exportRows} />
        <PrimaryButton onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> {tx.newRequest}</PrimaryButton>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colCategory}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSubject}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colUpdated}</th>
          </tr></thead>
          <tbody>
            {requests.length === 0 ? <tr><td colSpan={4} className="text-center text-slate-800 py-10">{tx.noRequests}</td></tr> :
              requests.map((r) => (
                <tr key={r._id} className="border-b border-slate-200/70 hover:bg-slate-100 cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="px-4 py-3 text-slate-700">{categoryLabel(r.category, lang)}</td>
                  <td className="px-4 py-3 text-slate-900 font-medium">{r.subject} {!r.readByRequester && <span className="ms-1 inline-block w-2 h-2 rounded-full bg-[#f37121]" />}</td>
                  <td className="px-4 py-3"><Badge style={REQUEST_STATUS[r.status]} lang={lang} /></td>
                  <td className="px-4 py-3 text-slate-800 text-xs">{fmtDateTime(r.updatedAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* New request */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={tx.newHrRequest}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={submit} disabled={saving || !form.subject.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.submit}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={tx.categoryLabel}><Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{REQUEST_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}</Select></Field>
          <Field label={tx.subjectLabel}><TextInput value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></Field>
          <Field label={tx.detailsLabel}><TextArea rows={4} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder={tx.detailsPlaceholder} /></Field>
        </div>
      </Modal>

      {/* Thread */}
      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open?.subject || ''}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">{categoryLabel(open.category, lang)} · <Badge style={REQUEST_STATUS[open.status]} lang={lang} /></div>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {open.thread.length === 0 && <p className="text-slate-500 text-sm">{tx.noMessagesYet}</p>}
              {open.thread.map((m, i) => {
                const mine = String(m.sender?._id || m.sender) === String(user?._id);
                return (
                  <div key={m._id || i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${mine ? 'bg-[#f37121]/20 text-white' : 'bg-slate-100 text-slate-900'}`}>
                      <p className="text-xs text-slate-500 mb-1">{userName(m.sender)} · {fmtDateTime(m.at)}</p>
                      {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                      {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="text-[#f37121] underline flex items-center gap-1 mt-1"><Link2 className="w-3 h-3" /> {tx.openLink}</a>}
                    </div>
                  </div>
                );
              })}
            </div>
            {!['resolved', 'closed'].includes(open.status) && (
              <div className="border-t border-slate-200 pt-3 flex items-center gap-2">
                <div className="flex-1"><TextInput placeholder={tx.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
                <PrimaryButton onClick={sendReply} disabled={busy || !reply.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</PrimaryButton>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
