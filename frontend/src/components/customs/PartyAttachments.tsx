'use client';
/**
 * مرفقاتُ طرفٍ في التخليص — العميل أو الوكيل أو الناقل.
 *
 * سجلُّه التجاريّ وشهادتُه الضريبيّة وعقدُه وتفويضُه تُرفَق مرّةً في ملفّه، وتُقرأ
 * من كلّ معاملةٍ هو طرفٌ فيها (`ClearanceParties`) — لا تُعاد في كلّ معاملة.
 * والملفُّ يُفتَح في المتصفّح (صورةٌ أو PDF)، وما لا يُعرَض يُنزَّل.
 */
import { useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Paperclip, Eye, Trash2, Loader2, Upload } from 'lucide-react';

export interface PartyFile { _id: string; title?: string; fileUrl: string; fileName?: string; size?: number; uploadedByName?: string; uploadedAt?: string }

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('read')); r.readAsDataURL(file);
});

export default function PartyAttachments({ partyId, items, canEdit, ar, onChanged, compact }: {
  partyId: string; items: PartyFile[]; canEdit: boolean; ar: boolean; onChanged: (items: PartyFile[]) => void; compact?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');

  const upload = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const sent = await Promise.all(files.map(async (f) => ({
        fileName: f.name, dataUrl: await readAsDataUrl(f),
        title: (files.length === 1 && title.trim()) ? title.trim() : f.name.replace(/\.[^.]+$/, ''),
      })));
      const r = await api.post<{ party: { attachments: PartyFile[] } }>(`/api/customs-clearance/parties/${partyId}/attachments`, { files: sent });
      onChanged(r.party.attachments || []); setTitle('');
      notify(t('رُفع', 'Uploaded'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy(false);
  };
  const remove = async (a: PartyFile) => {
    if (!(await confirm({ title: t('حذف المرفق؟', 'Delete attachment?'), message: a.title || a.fileName || '', confirmLabel: t('حذف', 'Delete'), tone: 'danger' }))) return;
    try {
      const r = await api.delete<{ party: { attachments: PartyFile[] } }>(`/api/customs-clearance/parties/${partyId}/attachments/${a._id}`);
      onChanged(r.party.attachments || []);
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-[12.5px] text-slate-400">{t('لا مرفقات بعد.', 'No attachments yet.')}</p>}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a._id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" title={t('فتح الملف', 'Open file')}
                className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800 hover:text-[#12325c] hover:underline">{a.title || a.fileName}</a>
              {!compact && a.uploadedByName && <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">{a.uploadedByName}</span>}
              <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" title={t('فتح', 'Open')} className="shrink-0 rounded p-1 text-slate-500 hover:bg-white hover:text-[#12325c]"><Eye className="h-4 w-4" /></a>
              {canEdit && <button type="button" onClick={() => remove(a)} title={t('حذف', 'Delete')} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('اسم الملف (اختياري) — مثل: السجل التجاري', 'File name (optional) — e.g. CR')}
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#12325c] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d2646] ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{t('إرفاق ملفات', 'Attach files')}
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      )}
    </div>
  );
}
