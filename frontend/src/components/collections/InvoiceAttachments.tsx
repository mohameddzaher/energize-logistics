'use client';
/**
 * مرفقاتُ فاتورة التحصيل — ورقُ الفاتورة يعيش مع الفاتورة.
 *
 * النسخةُ الموقَّعة، وإيصالُ الاستلام، وصورةُ الشيك، وكشفُ حساب العميل: كانت
 * تُتداول على الواتساب والإيميل، فإذا سُئل عنها عند المطالبة لم تُوجد. فتُرفَق
 * من صفّ الفاتورة نفسِه، وتُفتَح وتُنزَّل من هناك.
 *
 * ── الوجهان ─────────────────────────────────────────────────────────────────
 * الضريبيّةُ (`tax`) تُعرَف برقمها في الدفتر، والنقديّةُ (`cash`) بمعرّف كشفها
 * في سير العمل — كما يحدّدها `rowKey` في صفحة الفواتير. راجع
 * backend/src/controllers/collectionsAttachmentsController.
 *
 * ── والعددُ حيّ ──────────────────────────────────────────────────────────────
 * الخادمُ يبثّ `collections:attachments` بعد كلّ رفعٍ وحذف، ومعه العددُ الجديد،
 * فيتحدّث مشبكُ الصفّ عند كلّ من فتح الصفحة بلا إعادة تحميل.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Modal } from '@/components/hr/HRKit';
import { Paperclip, FileText, Image as ImageIcon, FileSpreadsheet, Trash2, Download, Loader2, Eye, UploadCloud } from 'lucide-react';

export type AttachKind = 'tax' | 'cash';

export interface InvoiceAttachment {
  _id: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedByName?: string;
  uploadedAt?: string;
  canDelete?: boolean;
}

/** ما يقبله الخادم — يُفحَص هنا أوّلًا كي لا يُرسَل ملفٌّ سيُردّ. */
const MAX_FILE = 10 * 1024 * 1024;
/** دفعةُ الطلب الواحد: حدُّ الخادم ١٨ ميغا وعشرة ملفّات — نترك هامشًا. */
const BATCH_BYTES = 15 * 1024 * 1024;
const BATCH_FILES = 10;
const EXT_OK = /\.(jpe?g|png|webp|gif|heic|pdf|docx?|xlsx?)$/i;
export const ATTACH_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx';

const base = (kind: AttachKind, key: string) => `/api/collections-dept/attachments/${kind}/${encodeURIComponent(key)}`;

const sizeText = (n?: number) => {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const when = (v?: string) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
/** رابطُ التنزيل باسم الملفّ الأصليّ — الخادمُ يقرأ `?dl=` (راجع server.js). */
export const downloadHref = (a: InvoiceAttachment) =>
  `${a.fileUrl}?dl=${encodeURIComponent(a.fileName || 'attachment')}`;

const readAsDataUrl = (f: File) => new Promise<string>((res) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ''));
  r.onerror = () => res('');
  r.readAsDataURL(f);
});

/**
 * أعدادُ المرفقات لصفوفٍ لا تحملها في ردّها (صفحةُ الطرف، الدفتر، تفصيلُ
 * المديونيّة): نداءٌ واحدٌ للصفوف المعروضة كلِّها، ويتحدّث حيًّا.
 */
export function useAttachmentCounts(kind: AttachKind, keys: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const sig = keys.filter(Boolean).join('\u0001');
  const seq = useRef(0);
  useEffect(() => {
    const list = sig ? sig.split('\u0001') : [];
    if (!list.length) { setCounts({}); return; }
    const mine = ++seq.current;
    const p = new URLSearchParams();
    list.slice(0, 500).forEach((k) => p.append('keys', k));
    api.get<{ counts: Record<string, number> }>(`/api/collections-dept/attachments/${kind}/counts?${p.toString()}`)
      .then((d) => { if (seq.current === mine) setCounts(d?.counts || {}); })
      .catch(() => {});
  }, [kind, sig]);
  useSocket('collections:attachments', useCallback((d: any) => {
    if (d?.kind !== kind || !d?.key) return;
    setCounts((prev) => ({ ...prev, [String(d.key)]: Number(d.count) || 0 }));
  }, [kind]));
  const setOne = useCallback((key: string, n: number) => setCounts((prev) => ({ ...prev, [key]: n })), []);
  return { counts, setOne };
}

/**
 * مشبكُ الصفّ: العددُ، والضغطُ يفتح نافذةَ الملفّات. لا يمرّ الضغطُ إلى الصفّ
 * (تحديدٌ أو فتح) — الخليّةُ بابُ المرفقات وحدَها.
 */
export function AttachmentsButton({ kind, invKey, label, count, onCount }: {
  kind: AttachKind;
  invKey: string;
  /** رقمُ الفاتورة أو الكشف — عنوانُ النافذة. */
  label: string;
  count: number;
  onCount?: (n: number) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const n = Number(count) || 0;
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(true)}
        title={ar ? (n ? `${n} مرفقات — فتح` : 'إرفاق ملف') : (n ? `${n} attachments — open` : 'Attach a file')}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
          n ? 'bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'}`}>
        <Paperclip className="w-3.5 h-3.5" />
        <span className="tabular-nums">{n || ''}</span>
      </button>
      {open && (
        <AttachmentsModal kind={kind} invKey={invKey} label={label} open={open}
          onClose={() => setOpen(false)} onCount={onCount} />
      )}
    </span>
  );
}

export function AttachmentsModal({ kind, invKey, label, open, onClose, onCount }: {
  kind: AttachKind; invKey: string; label: string; open: boolean; onClose: () => void; onCount?: (n: number) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return (
    <Modal open={open} onClose={onClose}
      title={ar ? `مرفقات ${kind === 'cash' ? 'الكشف' : 'الفاتورة'} ${label}` : `Attachments — ${label}`}>
      <AttachmentsBody kind={kind} invKey={invKey} onCount={onCount} />
    </Modal>
  );
}

/** بطاقةٌ في صفحة تفصيل الفاتورة — القائمةُ نفسُها بلا نافذة. */
export function AttachmentsPanel({ kind, invKey }: { kind: AttachKind; invKey: string }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [n, setN] = useState<number | null>(null);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2 mb-4">
        <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><Paperclip className="w-4 h-4" /></span>
        {ar ? 'مرفقات الفاتورة' : 'Invoice attachments'}
        {n != null && <span className="text-slate-400 text-xs font-normal tabular-nums">{n}</span>}
      </h3>
      <AttachmentsBody kind={kind} invKey={invKey} onCount={setN} />
    </div>
  );
}

function AttachmentsBody({ kind, invKey, onCount }: { kind: AttachKind; invKey: string; onCount?: (n: number) => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<InvoiceAttachment[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ files: InvoiceAttachment[]; abilities: { upload: boolean } }>(base(kind, invKey));
      setFiles(d?.files || []);
      setCanUpload(!!d?.abilities?.upload);
      onCountRef.current?.((d?.files || []).length);
    } catch (e: any) {
      notify(e?.message || t('تعذّر تحميل المرفقات', 'Could not load attachments'), 'error');
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, invKey]);
  useEffect(() => { load(); }, [load]);

  // زميلٌ رفع أو حذف على الفاتورة نفسِها → تُعاد القائمة.
  useSocket('collections:attachments', useCallback((d: any) => {
    if (d?.kind === kind && String(d?.key) === String(invKey)) load();
  }, [kind, invKey, load]));

  const upload = async (list: FileList | File[] | null) => {
    const picked = Array.from(list || []);
    if (!picked.length || progress) return;
    const ok: File[] = [];
    for (const f of picked) {
      if (!EXT_OK.test(f.name) && !/^image\//.test(f.type)) {
        notify(t(`«${f.name}» نوعٌ غير مدعوم — صور وPDF وWord وExcel فقط`, `“${f.name}” is not supported — images, PDF, Word or Excel only`), 'error');
        continue;
      }
      if (f.size > MAX_FILE) { notify(t(`«${f.name}» أكبر من ١٠ ميغا`, `“${f.name}” is larger than 10 MB`), 'error'); continue; }
      ok.push(f);
    }
    if (!ok.length) { if (input.current) input.current.value = ''; return; }

    // ── دفعاتٌ بحدّ الطلب ────────────────────────────────────────────────
    // عشرون صورةً من الهاتف تتجاوز حدَّ الطلب الواحد؛ فتُقسَم ويُرسَل كلُّ قسمٍ
    // على حدة، والعدّادُ يقول أين وصل.
    const batches: File[][] = [];
    let cur: File[] = [];
    let bytes = 0;
    for (const f of ok) {
      if (cur.length && (bytes + f.size > BATCH_BYTES || cur.length >= BATCH_FILES)) { batches.push(cur); cur = []; bytes = 0; }
      cur.push(f); bytes += f.size;
    }
    if (cur.length) batches.push(cur);

    setProgress({ done: 0, total: ok.length });
    let done = 0;
    let count: number | null = null;
    try {
      for (const b of batches) {
        // eslint-disable-next-line no-await-in-loop
        const payload = await Promise.all(b.map(async (f) => ({ fileName: f.name, dataUrl: await readAsDataUrl(f) })));
        // eslint-disable-next-line no-await-in-loop
        const r = await api.post<{ count: number }>(base(kind, invKey), { files: payload.filter((x) => x.dataUrl) });
        done += b.length;
        count = r?.count ?? count;
        setProgress({ done, total: ok.length });
      }
      notify(ok.length > 1 ? t(`أُرفق ${ok.length} ملفّات`, `${ok.length} files attached`) : t('أُرفق الملف', 'File attached'));
    } catch (e: any) {
      notify(e?.message || t('تعذّر رفع الملفات', 'Upload failed'), 'error');
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (count != null) onCountRef.current?.(count);
    load();
  };

  const remove = async (a: InvoiceAttachment) => {
    if (!(await confirm({
      title: t(`حذف «${a.fileName || ''}»؟`, `Delete “${a.fileName || ''}”?`),
      message: t('يُحذَف الملفُّ من الفاتورة ولا يُستعاد.', 'The file is removed from the invoice and cannot be restored.'),
      confirmLabel: t('حذف', 'Delete'), tone: 'danger',
    } as any))) return;
    setRemoving(a._id);
    try {
      const r = await api.delete<{ count: number }>(`${base(kind, invKey)}/${a._id}`);
      setFiles((prev) => prev.filter((x) => x._id !== a._id));
      if (r?.count != null) onCountRef.current?.(r.count);
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
    setRemoving(null);
  };

  const iconOf = (a: InvoiceAttachment) => {
    const m = String(a.mimeType || '');
    if (m.startsWith('image/')) return <ImageIcon className="w-3.5 h-3.5" />;
    if (/sheet|excel/.test(m)) return <FileSpreadsheet className="w-3.5 h-3.5" />;
    return <FileText className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-3">
      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer?.files || null); }}
          className={`rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${
            drag ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 bg-white'}`}>
          <input ref={input} type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={(e) => upload(e.target.files)} />
          <button type="button" onClick={() => input.current?.click()} disabled={!!progress}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold hover:bg-[#e06010] disabled:opacity-60">
            {progress ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {progress
              ? t(`جارٍ الرفع… ${progress.done}/${progress.total}`, `Uploading… ${progress.done}/${progress.total}`)
              : t('إرفاق ملف', 'Attach files')}
          </button>
          <p className="text-[11.5px] text-slate-400 mt-2">
            {t('اختر ملفًّا أو أكثر أو اسحبها إلى هنا — صور وPDF وWord وExcel، حتى ١٠ ميغا للملف.',
               'Pick one or more files or drop them here — images, PDF, Word or Excel, up to 10 MB each.')}
          </p>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : !files.length ? (
        <p className="text-slate-500 text-sm py-6 text-center">{t('لا مرفقات بعد.', 'No attachments yet.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((a) => (
            <li key={a._id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <span className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${String(a.mimeType || '').startsWith('image/') ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                {iconOf(a)}
              </span>
              <div className="flex-1 min-w-0">
                <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" title={a.fileName}
                  className="block truncate text-[13px] font-semibold text-slate-800 hover:text-[#f37121] hover:underline">
                  {a.fileName || t('مرفق', 'Attachment')}
                </a>
                <p className="text-[11px] text-slate-400 truncate">
                  {[sizeText(a.size), a.uploadedByName, when(a.uploadedAt)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <a href={a.fileUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0" title={t('فتح', 'Open')}>
                <Eye className="w-4 h-4" />
              </a>
              <a href={downloadHref(a)} download={a.fileName || true}
                className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 shrink-0" title={t('تنزيل', 'Download')}>
                <Download className="w-4 h-4" />
              </a>
              {a.canDelete && canUpload && (
                <button type="button" onClick={() => remove(a)} disabled={removing === a._id}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 shrink-0 disabled:opacity-50" title={t('حذف', 'Delete')}>
                  {removing === a._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
