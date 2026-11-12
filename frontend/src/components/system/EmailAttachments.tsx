'use client';
/**
 * Attachments for an outgoing email: pick several files or drag them onto the box; each can be removed before sending.
 * Files are read as data URLs (images shrunk by readUploadFiles) and sent with the message; the server re-checks the caps.
 */
import { useRef, useState } from 'react';
import { Paperclip, X, UploadCloud, Loader2, FileText } from 'lucide-react';
import { readUploadFiles, type UploadFile } from '@/lib/uploadFiles';

const MAX_TOTAL = 20 * 1024 * 1024;
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function EmailAttachments({ ar, value, onChange }: { ar: boolean; value: UploadFile[]; onChange: (v: UploadFile[]) => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = value.reduce((n, f) => n + f.size, 0);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setErr('');
    try {
      const read = await readUploadFiles(files, ar);
      const next = [...value, ...read];
      if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) setErr(t('حجم المرفقات أكبر من 20 ميجابايت — لم تُضَف الملفات الأخيرة.', 'Attachments exceed 20 MB — the last files were not added.'));
      else onChange(next);
    } catch (e: any) { setErr(e?.message || t('تعذّرت قراءة الملف', 'Could not read the file')); }
    setBusy(false);
  };

  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">{t('المرفقات — اختياري', 'Attachments — optional')}</span>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files || [])); }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-[13px] transition ${over ? 'border-[#f37121] bg-orange-50 text-[#f37121]' : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-slate-400'}`}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
        <span>{t('اسحب الملفات وأفلتها هنا، أو اضغط لاختيار أكثر من ملف', 'Drop files here, or click to pick several')}</span>
        <input ref={input} type="file" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; add(f); }} />
      </div>
      {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
      {value.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.map((f, i) => (
            <li key={`${f.fileName}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px]">
              {/^data:image\//.test(f.dataUrl) ? <Paperclip className="h-4 w-4 text-slate-400" /> : <FileText className="h-4 w-4 text-slate-400" />}
              <span className="min-w-0 flex-1 truncate" dir="auto">{f.fileName}</span>
              <span className="tabular-nums text-slate-400">{fmtSize(f.size)}</span>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label={t('إزالة', 'Remove')}><X className="h-4 w-4" /></button>
            </li>
          ))}
          <li className="text-end text-[11.5px] text-slate-400 tabular-nums">{t(`${value.length} ملف · ${fmtSize(total)} من 20 MB`, `${value.length} files · ${fmtSize(total)} of 20 MB`)}</li>
        </ul>
      )}
    </div>
  );
}
