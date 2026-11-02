'use client';
/**
 * Claim attachments: the paperwork, each with a name typed by its owner.
 * Claims are managed by numbers, but the papers behind them (Najm report, damage photos, workshop quote, insurer letter) stayed in the follower's email or phone, so a year later the system had none of it. The name is typed rather than derived from the file (`IMG_20260114` is unreadable, a descriptive name is not); the filename is suggested, corrected by the owner, and editable in place after upload.
 */
import { useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import {
  addClaimAttachments, renameClaimAttachment, deleteClaimAttachment, fmtDate,
} from '@/lib/vehicleRegistry';
import { Paperclip, Upload, Trash2, Loader2, FileText } from 'lucide-react';

export interface ClaimAttachment {
  _id: string; title?: string; fileUrl: string; fileName?: string;
  mimeType?: string; size?: number; uploadedByName?: string; uploadedAt?: string;
}

// Same limit as the server (utils/fileStore), checked before upload so a too-large file is not sent and rejected.
const MAX_BYTES = 20 * 1024 * 1024;

const sizeText = (n?: number) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default function ClaimAttachments({ claimId, attachments, canEdit, canManage = canEdit, onChange }: {
  claimId: string;
  attachments: ClaimAttachment[];
  canEdit: boolean;
  /** Rename and delete attachments: management and finance only (canEditClaims). */
  canManage?: boolean;
  onChange: (claim: any) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (fl: FileList | null) => {
    if (!fl || !fl.length) return;
    setBusy(true);
    try {
      const files: { dataUrl: string; fileName: string; title: string }[] = [];
      for (const f of Array.from(fl)) {
        if (f.size > MAX_BYTES) {
          notify(t(`«${f.name}» أكبر من 20 ميجابايت`, `"${f.name}" exceeds 20 MB`), 'error');
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const dataUrl = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => res('');
          r.readAsDataURL(f);
        });
        // Suggested name: the file name without its extension; corrected after upload.
        if (dataUrl) files.push({ dataUrl, fileName: f.name, title: f.name.replace(/\.[^.]+$/, '') });
      }
      if (!files.length) { setBusy(false); return; }
      const d = await addClaimAttachments(claimId, files);
      if (d?.claim) onChange(d.claim);
      notify(t(`أُرفق ${files.length} ملفًّا`, `${files.length} file(s) attached`), 'success');
    } catch (e: any) {
      notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error');
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const rename = async (a: ClaimAttachment, title: string) => {
    const next = title.trim();
    if (next === (a.title || '')) return;
    try {
      const d = await renameClaimAttachment(claimId, a._id, next);
      if (d?.claim) onChange(d.claim);
    } catch (e: any) { notify(e?.message || t('تعذّر التعديل', 'Rename failed'), 'error'); }
  };

  const remove = async (a: ClaimAttachment) => {
    const ok = await confirm({
      message: t(`يُحذف «${a.title || a.fileName}» نهائيًّا؟`, `Delete "${a.title || a.fileName}" permanently?`),
      tone: 'error',
      confirmLabel: t('حذف', 'Delete'),
    });
    if (!ok) return;
    try {
      const d = await deleteClaimAttachment(claimId, a._id);
      if (d?.claim) onChange(d.claim);
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="h-1 bg-slate-400" />
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
            <Paperclip className="w-4 h-4 text-slate-400" />
            {t('المرفقات', 'Attachments')}
            {!!attachments.length && (
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">
                {attachments.length}
              </span>
            )}
          </h2>
          {canEdit && (
            <>
              {/* More than one file at a time: one incident has several pages. */}
              <input ref={inputRef} type="file" multiple hidden
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={(e) => pick(e.target.files)} aria-label={t('إرفاق ملفات', 'Attach files')} />
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-semibold hover:bg-[#e06010] disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {t('إرفاق ملفات', 'Attach files')}
              </button>
            </>
          )}
        </div>

        {!attachments.length ? (
          <p className="text-[12.5px] text-slate-400 py-3">
            {canEdit
              ? t('لا مرفقات — أرفق تقرير نجم وصور الضرر وعرض الورشة وخطابات الشركة.',
                  'No attachments yet — attach the Najm report, damage photos, the workshop quote and insurer letters.')
              : t('لا مرفقات', 'No attachments')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...attachments]
              .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
              .map((a) => (
                <li key={a._id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {canManage ? (
                      // The name is edited in place, no dialog for fixing a word.
                      <input defaultValue={a.title || a.fileName || ''}
                        onBlur={(e) => rename(a, e.target.value)}
                        aria-label={t('اسم المرفق', 'Attachment name')}
                        className="w-full bg-transparent text-[13px] font-semibold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-[#f37121] focus:outline-none" />
                    ) : (
                      <p className="text-[13px] font-semibold text-slate-900 truncate">{a.title || a.fileName}</p>
                    )}
                    <p className="text-[11px] text-slate-500 truncate">
                      {[a.fileName, sizeText(a.size), a.uploadedByName, a.uploadedAt ? fmtDate(a.uploadedAt) : '']
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download={a.fileName}
                    className="px-2 py-1 rounded-lg text-[11.5px] font-bold text-slate-500 hover:text-[#f37121] hover:bg-white shrink-0">
                    {t('فتح', 'Open')}
                  </a>
                  {canManage && (
                    <button type="button" onClick={() => remove(a)} title={t('حذف', 'Delete')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
