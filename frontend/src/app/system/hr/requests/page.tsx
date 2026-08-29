'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import FilePicker, { AttachmentList, type PickedFile } from '@/components/system/FilePicker';
import { MessageSquare, Send, Link2 } from 'lucide-react';
import { isHRStaff, HRRequest, REQUEST_STATUS, categoryLabel, userName, fmtDateTime } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, Badge, Modal, TextInput, Select, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import { getHrRequestsTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

export default function HRRequestsPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrRequestsTranslations(lang);
  const staff = isHRStaff(user);

  const [requests, setRequests] = useState<HRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState<HRRequest | null>(null);
  const [reply, setReply] = useState('');
  const [link, setLink] = useState('');
  // المرفقات تعيش مع الطلب لا خارجه: الرابط يُحذف من درايف فيبقى في السجلّ سطرٌ
  // يقول «أُرسلت الشهادة» ورابطٌ لا يفتح.
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ requests: HRRequest[] }>(`/api/hr/requests${qs}`);
      setRequests(d.requests || []);
      setOpen((cur) => (cur ? d.requests.find((r) => r._id === cur._id) || cur : cur));
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:request', useCallback(() => load(), [load]));

  const sendReply = async () => {
    if (!open || (!reply.trim() && !link.trim() && !files.length)) return;
    setBusy(true);
    try {
      const d = await api.post<{ request: HRRequest }>(`/api/hr/requests/${open._id}/reply`, { body: reply, link, files });
      setOpen(d.request); setReply(''); setLink(''); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  const setStatus = async (status: string) => {
    if (!open) return;
    try { const d = await api.patch<{ request: HRRequest }>(`/api/hr/requests/${open._id}/status`, { status }); setOpen(d.request); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = requests.filter((r) => !search.trim() || r.subject.toLowerCase().includes(search.toLowerCase()) || userName(r.requester).toLowerCase().includes(search.toLowerCase()));
  const openCount = requests.filter((r) => r.status === 'open' || r.status === 'in_progress').length;

  const exportColumns: ExportColumn[] = [
    { header: tx.colEmployee, key: 'requester', transform: (v) => userName(v), width: 22 },
    { header: tx.colCategory, key: 'category', transform: (v) => categoryLabel(v, lang), width: 18 },
    { header: tx.colSubject, key: 'subject', width: 32 },
    { header: tx.colStatus, key: 'status', transform: (v) => (REQUEST_STATUS[v] ? (ar ? REQUEST_STATUS[v].ar : REQUEST_STATUS[v].en) : v), width: 16 },
    { header: tx.colUpdated, key: 'updatedAt', transform: (v) => fmtDateTime(v), width: 20 },
  ];
  // فلتر الحالة يُطبَّق على الخادم: حين يكون «مغلق» لا تعرف الذاكرة بالطلبات
  // المفتوحة شيئًا، فـ«الكلّ» يجب أن يعيد النداء بلا حالة. والبحث في الذاكرة،
  // فـ«المعروض» صادقٌ كما هو.
  const fetchAllRequests = async () => {
    const d = await api.get<{ requests: HRRequest[] }>('/api/hr/requests');
    return [{ name: tx.pageTitle, rows: d.requests || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: tx.pageTitle, rows: filtered, columns: exportColumns }] },
    statusFilter
      ? { key: 'all', label: scope.all, resolve: fetchAllRequests }
      : { key: 'all', label: scope.all, sheets: [{ name: tx.pageTitle, rows: requests, columns: exportColumns }] },
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<MessageSquare className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${openCount} ${tx.openCountSuffix}`} />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select>
        <div className="w-full sm:w-auto shrink-0">
          <ExportMenu fileName="hr-requests" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colCategory}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSubject}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colUpdated}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-slate-800 py-12">{tx.noRequests}</td></tr>
            ) : filtered.map((r) => (
              <tr key={r._id} className="border-b border-slate-200/70 hover:bg-slate-100 cursor-pointer" onClick={() => setOpen(r)}>
                <td className="px-4 py-3 text-slate-900 font-medium">{userName(r.requester)} {!r.readByHR && <span className="ms-1 inline-block w-2 h-2 rounded-full bg-[#f37121]" />}</td>
                <td className="px-4 py-3 text-slate-700">{categoryLabel(r.category, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{r.subject}</td>
                <td className="px-4 py-3"><Badge style={REQUEST_STATUS[r.status]} lang={lang} /></td>
                <td className="px-4 py-3 text-slate-800 text-xs">{fmtDateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open?.subject || ''}
        footer={<div className="flex items-center gap-2 w-full">
          <Select value={open?.status || 'open'} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
          </Select>
          <div className="flex-1" />
        </div>}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>{userName(open.requester)}</span> · <span>{categoryLabel(open.category, lang)}</span> · <Badge style={REQUEST_STATUS[open.status]} lang={lang} />
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {open.thread.length === 0 && <p className="text-slate-500 text-sm">{tx.noMessagesYet}</p>}
              {open.thread.map((m, i) => {
                const mine = String(m.sender?._id || m.sender) === String(user?._id);
                const fromStaff = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].includes(m.sender?.role);
                return (
                  <div key={m._id || i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${fromStaff ? 'bg-[#f37121]/20 text-white' : 'bg-slate-100 text-slate-900'}`}>
                      <p className="text-xs text-slate-500 mb-1">{userName(m.sender)} · {fmtDateTime(m.at)}</p>
                      {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                      {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="text-[#f37121] underline flex items-center gap-1 mt-1"><Link2 className="w-3 h-3" /> {tx.openLink}</a>}
                      <AttachmentList items={(m as any).attachments} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <TextInput placeholder={tx.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} />
              <TextInput placeholder={tx.linkPlaceholder} value={link} onChange={(e) => setLink(e.target.value)} />
              <FilePicker files={files} onChange={setFiles} />
              <div className="flex justify-end"><PrimaryButton onClick={sendReply} disabled={busy || (!reply.trim() && !link.trim() && !files.length)}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {tx.send}</PrimaryButton></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
