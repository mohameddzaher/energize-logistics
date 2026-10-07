'use client';
/**
 * النماذجُ والخطاباتُ الرسميّة — مكتبةُ أوراق الموارد البشريّة.
 *
 * كانت هذه الأوراقُ في محادثاتِ واتساب ومجلّداتٍ على أجهزةٍ شخصيّة: من يحتاج
 * «نموذج طلب إجازة» يسأل عنه، ومن أرسله يرسل آخرَ نسخةٍ عنده — فتُوقَّع نسخةٌ
 * قديمةٌ وتُعاد. فصار لها مكانٌ واحد، ولكلّ نموذجٍ رقمُ نسخةٍ يرتفع عند
 * استبداله: من يسأل «أهذه الأحدث؟» يقرأ الجواب.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { isHRStaff } from '@/lib/hr';
import {
  FileText, Upload, Download, Pencil, Trash2, Search, X, Archive, Plus, FolderOpen,
} from 'lucide-react';
import {
  Spinner, PageHeader, Modal, Field, TextInput, TextArea, PrimaryButton, SearchableSelect,
} from '@/components/hr/HRKit';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';

interface FormItem {
  _id: string; title: string; titleEn?: string; category: string; description?: string;
  fileUrl: string; fileName?: string; mimeType?: string; size?: number;
  version: number; isActive: boolean; downloads: number; lastDownloadAt?: string | null;
  uploadedByName?: string; createdAt: string; updatedAt: string;
}
interface Cat { key: string; ar: string; en: string }

const fmtSize = (n?: number) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function HrFormsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const staff = isHRStaff(user);

  const [items, setItems] = useState<FormItem[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);

  const [edit, setEdit] = useState<FormItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', titleEn: '', category: 'forms', description: '' });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (cat) p.set('category', cat);
      if (q.trim()) p.set('q', q.trim());
      if (archived) p.set('includeArchived', '1');
      const d = await api.get<{ items: FormItem[]; categories: Cat[]; counts: Record<string, number> }>(
        `/api/hr/forms${p.toString() ? `?${p}` : ''}`);
      setItems(d.items || []);
      setCats(d.categories || []);
      setCounts(d.counts || {});
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, q, archived]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:forms', useCallback(() => { load(); }, [load]));

  const startNew = () => {
    setEdit(null);
    setForm({ title: '', titleEn: '', category: cat || 'forms', description: '' });
    setFiles([]); setOpen(true);
  };
  const startEdit = (it: FormItem) => {
    setEdit(it);
    setForm({ title: it.title, titleEn: it.titleEn || '', category: it.category, description: it.description || '' });
    setFiles([]); setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { notify(t('اكتب اسمَ النموذج', 'Give it a name'), 'error'); return; }
    if (!edit && !files.length) { notify(t('اختر الملفّ', 'Pick the file'), 'error'); return; }
    setSaving(true);
    try {
      const body: any = { ...form };
      if (files[0]) { body.file = files[0].dataUrl; body.fileName = files[0].fileName; }
      if (edit) {
        await api.put(`/api/hr/forms/${edit._id}`, body);
        notify(files[0]
          ? t('استُبدل الملفُّ — ورقمُ النسخة ارتفع', 'File replaced — version bumped')
          : t('حُفظ', 'Saved'), 'success');
      } else {
        await api.post('/api/hr/forms', body);
        notify(t('أُضيف النموذج', 'Added'), 'success');
      }
      setOpen(false); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const archive = async (it: FormItem) => {
    if (!(await confirm(t(`أرشفةُ «${it.title}»؟ تبقى محفوظةً ويمكن إظهارُها.`, `Archive “${it.title}”? It stays stored.`)))) return;
    try { await api.delete(`/api/hr/forms/${it._id}`); notify(t('أُرشِف', 'Archived'), 'success'); load(); }
    catch (e: any) { notify(e?.message || 'Error', 'error'); }
  };
  const restore = async (it: FormItem) => {
    try { await api.put(`/api/hr/forms/${it._id}`, { isActive: true }); load(); }
    catch (e: any) { notify(e?.message || 'Error', 'error'); }
  };

  // التنزيلُ يُعَدّ: النموذجُ الذي لا يُنزَّل إمّا لا يحتاجه أحدٌ أو لا يعرف
  // أحدٌ أنّه هنا — والرقمُ يفرّق بينهما مع الزمن.
  const download = (it: FormItem) => {
    api.post(`/api/hr/forms/${it._id}/downloaded`, {}).catch(() => {});
    window.open(it.fileUrl, '_blank');
  };

  const byCat = useMemo(() => {
    const m = new Map<string, FormItem[]>();
    for (const it of items) { const k = it.category || 'other'; (m.get(k) || m.set(k, []).get(k))!.push(it); }
    return m;
  }, [items]);

  const catLabel = (k: string) => {
    const c = cats.find((x) => x.key === k);
    return c ? (ar ? c.ar : c.en) : k;
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />}
        title={t('النماذج والخطابات الرسمية', 'Forms & official letters')}
        subtitle={t('مكانٌ واحدٌ لأوراق القسم — ولكلّ ورقةٍ رقمُ نسخةٍ يقول إن كانت الأحدث',
                    'One place for the department’s paperwork — each carries a version number')}>
        {staff && (
          <PrimaryButton onClick={startNew}><Plus className="w-4 h-4" /> {t('نموذج جديد', 'New document')}</PrimaryButton>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('ابحث باسم النموذج أو وصفه…', 'Search by name or description…')}
            className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#f37121]" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <button type="button" onClick={() => setCat('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${!cat ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          {t('الكل', 'All')} <span className="opacity-70">{items.length}</span>
        </button>
        {cats.map((c) => (
          <button key={c.key} type="button" onClick={() => setCat(c.key === cat ? '' : c.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${cat === c.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {ar ? c.ar : c.en} <span className="opacity-70">{counts[c.key] ?? 0}</span>
          </button>
        ))}
        <label className="ms-auto flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" className="w-3.5 h-3.5 accent-[#f37121]" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          {t('أظهر المؤرشف', 'Show archived')}
        </label>
      </div>

      {!items.length && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
          <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{t('لا أوراقَ هنا بعد', 'Nothing here yet')}</p>
          {staff && <button type="button" onClick={startNew} className="mt-3 text-sm text-[#f37121] font-medium hover:underline">{t('أضِف أوّلَ نموذج', 'Add the first one')}</button>}
        </div>
      )}

      {[...byCat.entries()].map(([k, list]) => (
        <section key={k} className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">{catLabel(k)} <span className="text-slate-400 font-normal">({list.length})</span></h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {list.map((it) => (
              <div key={it._id} className={`bg-white border rounded-xl p-3.5 shadow-sm flex flex-col gap-2 ${it.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                <div className="flex items-start gap-2">
                  <span className="w-9 h-9 rounded-lg bg-[#f37121]/10 text-[#f37121] grid place-items-center shrink-0">
                    <FileText className="w-4.5 h-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 text-sm truncate" title={it.title}>{it.title}</p>
                    {it.titleEn ? <p className="text-[11px] text-slate-400 truncate">{it.titleEn}</p> : null}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                    {t('نسخة', 'v')} {it.version}
                  </span>
                </div>
                {it.description ? <p className="text-xs text-slate-500 line-clamp-2">{it.description}</p> : null}
                <p className="text-[11px] text-slate-400">
                  {fmtSize(it.size)} · {it.downloads || 0} {t('تنزيل', 'downloads')}
                  {it.uploadedByName ? ` · ${it.uploadedByName}` : ''}
                </p>
                <div className="flex items-center gap-1.5 mt-auto pt-1">
                  <button type="button" onClick={() => download(it)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800">
                    <Download className="w-3.5 h-3.5" /> {t('تنزيل', 'Download')}
                  </button>
                  {staff && (
                    <>
                      <button type="button" onClick={() => startEdit(it)} title={t('تعديل أو استبدال الملفّ', 'Edit or replace')}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#f37121] hover:text-[#f37121]">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {it.isActive ? (
                        <button type="button" onClick={() => archive(it)} title={t('أرشفة', 'Archive')}
                          className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => restore(it)} title={t('إرجاع', 'Restore')}
                          className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600">
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <Modal open={open} onClose={() => setOpen(false)}
        title={edit ? t('تعديل النموذج', 'Edit document') : t('نموذج جديد', 'New document')}
        footer={<>
          <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}><Upload className="w-4 h-4" /> {t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={t('اسم النموذج', 'Name')}>
            <TextInput value={form.title} onChange={(e: any) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t('نموذج طلب إجازة', 'Leave request form')} />
          </Field>
          <Field label={t('بالإنجليزية (اختياري)', 'English (optional)')}>
            <TextInput value={form.titleEn} onChange={(e: any) => setForm((f) => ({ ...f, titleEn: e.target.value }))} />
          </Field>
          <Field label={t('التصنيف', 'Category')}>
            <SearchableSelect value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              options={cats.map((c) => ({ value: c.key, label: ar ? c.ar : c.en }))}
              placeholder={t('— اختر —', '— pick —')} searchPlaceholder={t('ابحث…', 'search…')} />
          </Field>
          <Field label={t('وصف / متى تُستعمل', 'Description / when to use it')}>
            <TextArea rows={2} value={form.description} onChange={(e: any) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label={edit ? t('استبدال الملفّ (اختياري)', 'Replace the file (optional)') : t('الملفّ', 'File')}>
            <FilePicker files={files} onChange={setFiles} max={1} />
          </Field>
          {edit ? (
            <p className="text-[11px] text-slate-400">
              {t(`الملفُّ الحاليُّ «${edit.fileName || '—'}» — نسخة ${edit.version}. استبدالُه يرفع الرقم إلى ${edit.version + 1}.`,
                 `Current file “${edit.fileName || '—'}” — version ${edit.version}. Replacing bumps it to ${edit.version + 1}.`)}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
