'use client';
// ملفّات المركبة — صور الرخصة والتأمين وبطاقة التشغيل والفحص.
//
// المركبة تحمل **تواريخ** مستنداتها وأرقامَها؛ وهذه تحمل **صورَها**. ومن دونها
// يُسأل «فين صورة الرخصة؟» فيُبحث عنها في واتساب — وهذا هو الفرق بين سجلٍّ
// ومجلَّد.
//
// والاسم يُكتب بيد الرافع ولا يُشتقّ من اسم الملفّ: «IMG_20260829.jpg» لا يقول
// شيئًا لمن يفتحه بعد سنة، و«صورة الرخصة» تقول كلَّ شيء.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { DOC_TYPES, fmtDate } from '@/lib/vehicleRegistry';
import {
  Paperclip, Upload, Trash2, Pencil, ExternalLink, Loader2, X, Check, FileText, Image as ImageIcon,
} from 'lucide-react';

export interface VehicleDoc {
  _id: string; title: string; category: string;
  fileUrl: string; fileName?: string; mimeType?: string; size?: number;
  expiryDate?: string; notes?: string; uploadedByName?: string; createdAt: string;
}

const CATS = (ar: boolean) => [
  ...DOC_TYPES.map((d) => ({ key: d.key, label: ar ? d.ar : d.en })),
  { key: 'other', label: ar ? 'أخرى' : 'Other' },
];

const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

export default function VehicleDocuments({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();

  const [docs, setDocs] = useState<VehicleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'other', expiryDate: '', notes: '' });
  const [file, setFile] = useState<{ dataUrl: string; name: string; size: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ documents: VehicleDoc[] }>(`/api/vehicle-registry/${vehicleId}/documents`);
      setDocs(d.documents || []);
    } catch { /* keep */ } finally { setLoading(false); }
  }, [vehicleId]);
  useEffect(() => { load(); }, [load]);

  const pick = (f: File | null) => {
    if (!f) { setFile(null); return; }
    // عشرون ميغا هو حدُّ الخادم — يُقال هنا قبل الرفع لا بعده.
    if (f.size > 20 * 1024 * 1024) { notify(t('الملفّ أكبر من ٢٠ ميغا', 'File is larger than 20MB'), 'error'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ dataUrl: String(r.result), name: f.name, size: f.size });
    r.readAsDataURL(f);
    // الاسم يُقترَح من اسم الملفّ ثم يُصحَّح — أفضل من خانةٍ فارغة.
    if (!form.title.trim()) setForm((p) => ({ ...p, title: f.name.replace(/\.[^.]+$/, '') }));
  };

  const openNew = () => { setEditing(null); setForm({ title: '', category: 'other', expiryDate: '', notes: '' }); setFile(null); setOpen(true); };
  const openEdit = (d: VehicleDoc) => {
    setEditing(d);
    setForm({ title: d.title, category: d.category || 'other', expiryDate: d.expiryDate || '', notes: d.notes || '' });
    setFile(null); setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { notify(t('اكتب اسمًا للملفّ', 'Give the file a name'), 'error'); return; }
    if (!editing && !file) { notify(t('اختر ملفًّا', 'Pick a file'), 'error'); return; }
    setBusy(true);
    try {
      if (editing) await api.put(`/api/vehicle-registry/documents/${editing._id}`, form);
      else await api.post(`/api/vehicle-registry/${vehicleId}/documents`, { ...form, dataUrl: file!.dataUrl, fileName: file!.name });
      setOpen(false); load();
      notify(t('حُفظ', 'Saved'), 'success');
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const remove = async (d: VehicleDoc) => {
    if (!(await confirm(t(`حذف «${d.title}» نهائيًّا؟ يُمسح الملفّ نفسه من الخادم.`,
      `Delete “${d.title}” permanently? The file itself is removed from the server.`)))) return;
    try { await api.delete(`/api/vehicle-registry/documents/${d._id}`); load(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  const catLabel = (k: string) => CATS(ar).find((c) => c.key === k)?.label || k;
  const isImg = (d: VehicleDoc) => String(d.mimeType || '').startsWith('image/');

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
          <Paperclip className="w-4 h-4 text-slate-400" />{t('ملفّات المركبة', 'Vehicle files')}
          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{docs.length}</span>
        </p>
        {canEdit && (
          <button type="button" onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-[12.5px] font-bold">
            <Upload className="w-3.5 h-3.5" /> {t('رفع ملفّ', 'Upload file')}
          </button>
        )}
      </div>

      {loading ? (
        <p className="px-4 py-8 text-center text-slate-400 text-sm">{t('جارٍ التحميل…', 'Loading…')}</p>
      ) : !docs.length ? (
        <p className="px-4 py-10 text-center text-slate-400 text-sm">
          {t('لا ملفّات مرفوعة على هذه المركبة بعد.', 'No files uploaded for this vehicle yet.')}
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d._id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isImg(d) ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                {isImg(d) ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900 text-[13.5px] truncate">{d.title}</p>
                <p className="text-[11.5px] text-slate-500 truncate">
                  {[catLabel(d.category), d.expiryDate && `${t('ينتهي', 'expires')} ${d.expiryDate}`, kb(d.size),
                    d.uploadedByName, fmtDate(d.createdAt)].filter(Boolean).join(' · ')}
                </p>
                {!!d.notes && <p className="text-[11.5px] text-slate-400 truncate">{d.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                  title={t('فتح', 'Open')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100">
                  <ExternalLink className="w-4 h-4" />
                </a>
                {canEdit && (
                  <>
                    <button type="button" onClick={() => openEdit(d)} title={t('تعديل الاسم', 'Rename')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(d)} title={t('حذف', 'Delete')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">{editing ? t('تعديل الملفّ', 'Edit file') : t('رفع ملفّ', 'Upload file')}</h3>
              <button type="button" onClick={() => setOpen(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>

            <div className="space-y-3">
              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الملفّ *', 'File *')}</label>
                  <input ref={fileRef} type="file" onChange={(e) => pick(e.target.files?.[0] || null)}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                    className="w-full text-sm file:me-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:font-semibold" />
                  {file && <p className="text-[11.5px] text-emerald-700 mt-1 font-semibold">{file.name} · {kb(file.size)}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">{t('صور، PDF، Word أو Excel — حتى ٢٠ ميغا', 'Images, PDF, Word or Excel — up to 20MB')}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('اسم الملفّ *', 'File name *')}</label>
                <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder={t('مثال: صورة رخصة السير', 'e.g. Vehicle licence scan')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('يخصّ مستند', 'Belongs to')}</label>
                  <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                    {CATS(ar).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ينتهي في (اختياري)', 'Expires (optional)')}</label>
                  <input type="date" value={form.expiryDate} onChange={(e) => setForm((p) => ({ ...p, expiryDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ملاحظات', 'Notes')}</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{t('إلغاء', 'Cancel')}</button>
              <button type="button" onClick={save} disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('حفظ', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
