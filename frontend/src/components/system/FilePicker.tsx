'use client';
// اختيارُ ملفّاتٍ للإرفاق — مكوّنٌ واحد لكلّ موضعٍ يُرفَق فيه شيء.
//
// ── لماذا الملفّ لا الرابط ───────────────────────────────────────────────────
// الرابط يعيش خارج النظام: يُحذف من درايف أو تُسحب صلاحيتُه، فيبقى في السجلّ
// سطرٌ يقول «أُرسلت الشهادة» ورابطٌ لا يفتح. والمرفق يعيش مع السجلّ نفسِه:
// يُنسخ معه احتياطيًّا، ويبقى مقروءًا بعد سنة.
//
// والرابط يبقى مقبولًا حيث يُستعمل — بعضُ ما يُشارَك رابطٌ بطبعه — لكنّه لم يعد
// الخيار الوحيد.
//
// ويُقرأ الملفّ إلى data URL في المتصفّح ويُرسَل في نفس الطلب: النظام كلُّه بلا
// multer، والمسار الواحد أبسط من مسارين.
import { useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react';

export interface PickedFile { dataUrl: string; fileName: string; title: string; size: number; mimeType: string }

const MAX_BYTES = 20 * 1024 * 1024;
export const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

export default function FilePicker({ files, onChange, max = 10, label }: {
  files: PickedFile[];
  onChange: (f: PickedFile[]) => void;
  max?: number;
  label?: string;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = max - files.length;
    if (room <= 0) { notify(t(`لا يُرفَق أكثر من ${max} ملفّات`, `At most ${max} files`), 'error'); return; }
    setBusy(true);
    const next: PickedFile[] = [];
    for (const f of Array.from(list).slice(0, room)) {
      if (f.size > MAX_BYTES) { notify(t(`«${f.name}» أكبر من ٢٠ ميغا`, `“${f.name}” is larger than 20MB`), 'error'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(f);
      }).catch(() => '');
      if (dataUrl) next.push({ dataUrl, fileName: f.name, title: f.name.replace(/\.[^.]+$/, ''), size: f.size, mimeType: f.type });
    }
    onChange([...files, ...next]);
    setBusy(false);
    if (ref.current) ref.current.value = '';
  };

  return (
    <div>
      <input ref={ref} type="file" multiple hidden onChange={(e) => add(e.target.files)}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy || files.length >= max}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-semibold disabled:opacity-50">
        <Paperclip className="w-3.5 h-3.5" />
        {busy ? t('جارٍ القراءة…', 'Reading…') : (label || t('إرفاق ملفّات', 'Attach files'))}
      </button>

      {!!files.length && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <span className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${f.mimeType.startsWith('image/') ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                {f.mimeType.startsWith('image/') ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              </span>
              {/* الاسم يُكتب باليد: «IMG_2026.jpg» لا يقول شيئًا لمن يفتحه بعد
                  شهر، و«صورة الإقامة» تقول كلَّ شيء. */}
              <input
                value={f.title}
                onChange={(e) => onChange(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                placeholder={t('اسم الملفّ', 'File name')}
                className="flex-1 min-w-0 bg-transparent text-[12.5px] font-semibold text-slate-800 focus:outline-none"
              />
              <span className="text-[11px] text-slate-400 shrink-0">{kb(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="p-1 text-slate-400 hover:text-red-600 shrink-0" aria-label="remove"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** عرضُ المرفقات المحفوظة على رسالةٍ أو سجلّ. */
export function AttachmentList({ items }: { items?: { title?: string; fileUrl: string; fileName?: string; size?: number; mimeType?: string }[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {items.map((a, i) => (
        <a key={i} href={a.fileUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]">
          {String(a.mimeType || '').startsWith('image/') ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
          {a.title || a.fileName || 'ملفّ'}
          {a.size ? <span className="text-slate-400 font-normal">{kb(a.size)}</span> : null}
        </a>
      ))}
    </div>
  );
}
