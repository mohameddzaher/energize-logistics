'use client';
// مرفقاتُ معاملة التخليص — ورقُ الإجراء يعيش مع الإجراء.
//
// كلُّ مرحلةٍ في دورة التخليص تُخرج ورقًا: البيانُ المسدَّد، فاتورةُ إذن
// التسليم، إيصالُ الموانى، تصريحُ الخروج، الفاتورةُ الضريبيّة. كانت تُتداول
// على الإيميل والواتساب، فإذا سُئل عنها بعد شهرٍ لم تُوجد.
//
// فتُرفَع هنا موسومةً بالمرحلة التي أُنتجت فيها، وتُعرض مجمَّعةً عليها: يفتح
// القارئُ «سداد الموانى» فيرى إيصالَها، لا كومةً من أربعين ملفًّا اسمُ أوّلها
// IMG_0421.
import { useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Paperclip, FileText, Image as ImageIcon, Trash2, Download, Loader2 } from 'lucide-react';

export interface ClearanceAttachment {
  _id?: string;
  title?: string;
  stage?: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedByName?: string;
  uploadedAt?: string;
}

const MAX_BYTES = 20 * 1024 * 1024;
const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

export default function ClearanceAttachments({
  clearanceId, items, stages, stageLabel, canEdit, onChange,
}: {
  clearanceId: string;
  items: ClearanceAttachment[];
  stages: string[];
  stageLabel: (s: string) => string;
  canEdit: boolean;
  onChange: (clearance: any) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');

  const list = Array.isArray(items) ? items : [];

  // المجموعاتُ مرتّبةٌ بترتيب الدورة نفسِه، والعامُّ آخرًا.
  const groups: [string, ClearanceAttachment[]][] = [
    ...stages.map((s) => [s, list.filter((a) => a.stage === s)] as [string, ClearanceAttachment[]]),
    ['', list.filter((a) => !a.stage || !stages.includes(a.stage))] as [string, ClearanceAttachment[]],
  ].filter(([, arr]) => arr.length);

  const upload = async (fl: FileList | null) => {
    if (!fl?.length) return;
    setBusy(true);
    const files: any[] = [];
    for (const f of Array.from(fl)) {
      if (f.size > MAX_BYTES) { notify(t(`«${f.name}» أكبر من ٢٠ ميغا`, `“${f.name}” is larger than 20MB`), 'error'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => res('');
        r.readAsDataURL(f);
      });
      if (dataUrl) files.push({ dataUrl, fileName: f.name, title: f.name.replace(/\.[^.]+$/, ''), stage });
    }
    if (files.length) {
      try {
        const d = await api.post<any>(`/api/customs-clearance/${clearanceId}/attachments`, { files });
        if (d?.clearance) onChange(d.clearance);
      } catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    }
    setBusy(false);
    if (ref.current) ref.current.value = '';
  };

  const rename = async (att: ClearanceAttachment, title: string) => {
    if (title === (att.title || '')) return;
    try {
      const d = await api.put<any>(`/api/customs-clearance/${clearanceId}/attachments/${att._id}`, { title });
      if (d?.clearance) onChange(d.clearance);
    } catch (e: any) { notify(e?.message || t('لم يُحفَظ الاسم', 'Rename failed'), 'error'); }
  };

  const move = async (att: ClearanceAttachment, next: string) => {
    try {
      const d = await api.put<any>(`/api/customs-clearance/${clearanceId}/attachments/${att._id}`, { stage: next });
      if (d?.clearance) onChange(d.clearance);
    } catch (e: any) { notify(e?.message || t('لم يُنقَل الملفّ', 'Move failed'), 'error'); }
  };

  const remove = async (att: ClearanceAttachment) => {
    if (!window.confirm(t(`حذف «${att.title || att.fileName}» نهائيًّا؟`, `Delete “${att.title || att.fileName}” permanently?`))) return;
    try {
      const d = await api.delete<any>(`/api/customs-clearance/${clearanceId}/attachments/${att._id}`);
      if (d?.clearance) onChange(d.clearance);
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold">
          {t('مرفقات المعاملة', 'Transaction attachments')}
          <span className="ms-2 text-slate-400 text-xs font-normal">{list.length}</span>
        </h3>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select value={stage} onChange={(e) => setStage(e.target.value)}
              className="px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
              <option value="">{t('مرفق عامّ', 'General')}</option>
              {stages.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
            <input ref={ref} type="file" multiple hidden onChange={(e) => upload(e.target.files)}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
            <button type="button" onClick={() => ref.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              {busy ? t('جارٍ الرفع…', 'Uploading…') : t('إرفاق ملفّات', 'Attach files')}
            </button>
          </div>
        )}
      </div>

      {!list.length ? (
        <p className="text-slate-500 text-sm py-6 text-center">
          {t('لا مرفقات بعد. اختر المرحلة ثمّ أرفق ورقَها.', 'No attachments yet. Pick a stage, then attach its paperwork.')}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([g, arr]) => (
            <div key={g || '__general'}>
              <p className="text-slate-500 text-xs font-semibold mb-1.5">
                {g ? stageLabel(g) : t('مرفقات عامّة', 'General')}
                <span className="ms-1.5 text-slate-400 font-normal">{arr.length}</span>
              </p>
              <ul className="space-y-1.5">
                {arr.map((a) => (
                  <li key={a._id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <span className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${String(a.mimeType || '').startsWith('image/') ? 'bg-sky-50 text-sky-600' : 'bg-white text-slate-500'}`}>
                      {String(a.mimeType || '').startsWith('image/') ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                    </span>
                    {canEdit ? (
                      <input defaultValue={a.title || a.fileName || ''} onBlur={(e) => rename(a, e.target.value)}
                        className="flex-1 min-w-0 bg-transparent text-[13px] font-semibold text-slate-800 focus:outline-none" />
                    ) : (
                      <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-slate-800">{a.title || a.fileName}</span>
                    )}
                    <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">{kb(a.size)}</span>
                    {a.uploadedByName ? <span className="text-[11px] text-slate-400 shrink-0 hidden md:inline">{a.uploadedByName}</span> : null}
                    {canEdit && (
                      <select value={a.stage || ''} onChange={(e) => move(a, e.target.value)}
                        className="shrink-0 max-w-[9rem] px-1.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] text-slate-600 focus:outline-none">
                        <option value="">{t('عامّ', 'General')}</option>
                        {stages.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                      </select>
                    )}
                    <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download={a.fileName || undefined}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-white shrink-0" title={t('تنزيل', 'Download')}>
                      <Download className="w-4 h-4" />
                    </a>
                    {canEdit && (
                      <button type="button" onClick={() => remove(a)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-white shrink-0" title={t('حذف', 'Delete')}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
