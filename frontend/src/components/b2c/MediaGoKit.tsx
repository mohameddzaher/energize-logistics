'use client';
/**
 * شكاوى Media Go — مكوّناتُ الشاشة: النموذج، ومنتقي الدبّاب، والمرفقات،
 * ولوحةُ التفصيل. كلُّها في مستوى الملفّ لا داخل جسم الصفحة (راجع
 * inline-components-remount: مكوّنٌ يُعرَّف داخل الرسم يُعيد بناءَ كلّ خانةٍ مع
 * كلّ حرف).
 *
 * والشاشةُ لطرفين: قسمُ الأفراد بلغته، وحسابُ Media Go باللغتين معًا — شريكٌ
 * خارجيٌّ قد لا يقرأ العربيّة. فكلُّ نصٍّ يمرّ بـ`Tx` الذي يعرف الوضع.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  MEDIAGO_API, MG_LIMITS, STATUS_TONE, availabilityText, fmtDateTime, issueText, vocabLabel,
  type Can, type MgFull, type Vocab,
} from '@/lib/mediago';
import {
  X, Loader2, ImagePlus, Film, Image as ImageIcon, Trash2, Send, Bike, MonitorPlay,
  MapPin, Clock, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Paperclip, User as UserIcon,
} from 'lucide-react';

// ── اللغة: لغةُ القارئ، أو اللغتان للشريك ──────────────────────────────────
export type Mode = 'ar' | 'en' | 'partner';
export type Tx = (ar: string, en: string) => string;
export const makeTx = (mode: Mode): Tx => (ar, en) => (mode === 'partner' ? `${ar} / ${en}` : mode === 'ar' ? ar : en);
const vLang = (mode: Mode) => (mode === 'partner' ? 'both' : mode);

/** عنوانٌ بلغتين: العربيّةُ ظاهرةً والإنجليزيّةُ تحتها — للشريك وحدَه. */
export function Bi({ ar, en, mode, className = '', sub = 'text-[11px] font-medium text-slate-400' }: { ar: string; en: string; mode: Mode; className?: string; sub?: string }) {
  if (mode !== 'partner') return <span className={className}>{mode === 'ar' ? ar : en}</span>;
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span>{ar}</span>
      <span className={sub} dir="ltr">{en}</span>
    </span>
  );
}

export function StatusPill({ status, meta, mode }: { status: string; meta: Vocab | null; mode: Mode }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.closed;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold ring-1 ${tone.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {vocabLabel(meta, 'status', status, vLang(mode))}
    </span>
  );
}

// ── منتقي الدبّاب ─────────────────────────────────────────────────────────
export type MotoValue = { vehicle: string; motorcycleNumber: string; hint: string };
type MotoOpt = { _id: string; plateNumber: string; serialNumber: string; project: string; city: string; driverName: string };

export function MotorcyclePicker({ value, onChange, tx }: { value: MotoValue; onChange: (v: MotoValue) => void; tx: Tx }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<MotoOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const mine = ++seq.current;
    setBusy(true);
    const h = setTimeout(() => {
      api.get<{ items: MotoOpt[] }>(`${MEDIAGO_API}/motorcycles?q=${encodeURIComponent(value.motorcycleNumber)}`)
        .then((d) => { if (mine === seq.current) setOpts(d.items || []); })
        .catch(() => { if (mine === seq.current) setOpts([]); })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(h);
  }, [open, value.motorcycleNumber]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Bike className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={value.motorcycleNumber}
          onFocus={() => setOpen(true)}
          // الكتابةُ تفكّ الربطَ بالسجلّ: ما يُكتب يُحفظ نصًّا كما هو.
          onChange={(e) => { onChange({ vehicle: '', motorcycleNumber: e.target.value, hint: '' }); setOpen(true); }}
          placeholder={tx('ابحث باللوحة أو التسلسلي أو اكتب الرقم', 'Search plate / serial, or type the number')}
          className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
        />
      </div>
      {value.vehicle ? (
        <p className="mt-1 text-[11.5px] font-semibold text-emerald-700">✓ {tx('من سجلّ المركبات', 'From the vehicle register')}{value.hint ? ` — ${value.hint}` : ''}</p>
      ) : value.motorcycleNumber ? (
        <p className="mt-1 text-[11.5px] text-slate-500">{tx('سيُحفظ كما كُتب (غير مربوط بالسجلّ)', 'Saved as typed (not linked to the register)')}</p>
      ) : null}
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {busy && <div className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tx('جارٍ البحث…', 'Searching…')}</div>}
          {!busy && !opts.length && <div className="px-3 py-2 text-[12.5px] text-slate-500">{tx('لا نتائج في السجلّ — يُحفظ ما كتبته', 'No match in the register — your text will be saved')}</div>}
          {opts.map((o) => (
            <button key={o._id} type="button"
              onClick={() => { onChange({ vehicle: o._id, motorcycleNumber: o.plateNumber || o.serialNumber, hint: [o.serialNumber && `#${o.serialNumber}`, o.project, o.driverName].filter(Boolean).join(' · ') }); setOpen(false); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-orange-50">
              <span className="font-bold text-slate-900">{o.plateNumber || '—'}</span>
              <span className="truncate text-[11.5px] text-slate-500">{[o.serialNumber && `#${o.serialNumber}`, o.project, o.city, o.driverName].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── المرفقات قبل الإرسال ────────────────────────────────────────────────────
export type LocalFile = { dataUrl: string; fileName: string; size: number; mimeType: string; kind: 'image' | 'video' };
const MB = 1024 * 1024;

export function MediaPicker({ files, onChange, tx, room = MG_LIMITS.maxFiles }: { files: LocalFile[]; onChange: (f: LocalFile[]) => void; tx: Tx; room?: number }) {
  const { notify } = useDialog();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const total = files.reduce((n, f) => n + f.size, 0);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const next: LocalFile[] = [];
    let sum = total;
    setBusy(true);
    for (const f of Array.from(list)) {
      if (files.length + next.length >= room) { notify(tx(`الحدّ ${room} ملفّات`, `At most ${room} files`), 'error'); break; }
      const kind: 'image' | 'video' | null = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : null;
      if (!kind) { notify(tx(`«${f.name}» ليس صورة ولا فيديو`, `“${f.name}” is not an image or video`), 'error'); continue; }
      const cap = kind === 'video' ? MG_LIMITS.videoMB : MG_LIMITS.imageMB;
      if (f.size > cap * MB) { notify(tx(`«${f.name}» أكبر من ${cap} ميغا`, `“${f.name}” is larger than ${cap} MB`), 'error'); continue; }
      if (sum + f.size > MG_LIMITS.requestMB * MB) { notify(tx(`مجموع المرفقات يتجاوز ${MG_LIMITS.requestMB} ميغا — أرفق الباقي بعد الحفظ`, `Attachments exceed ${MG_LIMITS.requestMB} MB — add the rest after saving`), 'error'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => res('');
        r.readAsDataURL(f);
      });
      if (dataUrl) { next.push({ dataUrl, fileName: f.name, size: f.size, mimeType: f.type, kind }); sum += f.size; }
    }
    onChange([...files, ...next]);
    setBusy(false);
    if (ref.current) ref.current.value = '';
  };

  return (
    <div>
      <input ref={ref} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => add(e.target.files)} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {files.map((f, i) => (
          <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {f.kind === 'image'
              ? <img src={f.dataUrl} alt={f.fileName} className="h-full w-full object-cover" />
              : <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500"><Film className="h-6 w-6" /><span className="px-1 text-center text-[10px]">{Math.max(1, Math.round(f.size / MB))} MB</span></div>}
            <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute end-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-90 hover:bg-red-600" aria-label="remove"><X className="h-3 w-3" /></button>
          </div>
        ))}
        {files.length < room && (
          <button type="button" disabled={busy} onClick={() => ref.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 hover:border-[#f37121] hover:text-[#f37121] disabled:opacity-50">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            <span className="text-[10.5px] font-semibold">{tx('إضافة', 'Add')}</span>
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {tx(`حتى ${room} ملفّات — صورة حتى ${MG_LIMITS.imageMB} ميغا، فيديو حتى ${MG_LIMITS.videoMB} ميغا (مقطع قصير)، والمجموع ${MG_LIMITS.requestMB} ميغا في المرّة الواحدة`,
          `Up to ${room} files — image ≤ ${MG_LIMITS.imageMB} MB, video ≤ ${MG_LIMITS.videoMB} MB (short clip), ${MG_LIMITS.requestMB} MB per upload`)}
      </p>
    </div>
  );
}

// ── خيارٌ واحدٌ من قائمة، ببطاقات ─────────────────────────────────────────
function ChoiceGrid({ items, value, onChange, cols = 'sm:grid-cols-2' }: { items: { key: string; ar: string; en: string }[]; value: string; onChange: (k: string) => void; cols?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${cols}`}>
      {items.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-start transition ${on ? 'border-[#f37121] bg-orange-50 ring-1 ring-[#f37121]/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
            <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${on ? 'border-[#f37121] bg-[#f37121] shadow-[inset_0_0_0_2px_#fff]' : 'border-slate-300'}`} />
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-slate-800">{o.ar}</span>
              <span className="text-[11px] text-slate-500" dir="ltr">{o.en}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Q({ ar, en, required, children }: { ar: string; en: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-bold text-slate-800">
        <span>{ar}{required && <span className="text-red-600"> *</span>}</span>
        <span className="text-[11.5px] font-medium text-slate-400" dir="ltr">{en}</span>
      </label>
      {children}
    </div>
  );
}

// ── نموذجُ رفع البلاغ — أسئلةُ نموذج Media Go نفسُها ─────────────────────
const EMPTY = { moto: { vehicle: '', motorcycleNumber: '', hint: '' } as MotoValue, screenNumber: '', issue: '', issueOther: '', location: '', availability: '', availabilityOther: '' };

export function CreateComplaintModal({ open, onClose, meta, onCreated, tx }: {
  open: boolean; onClose: () => void; meta: Vocab | null; onCreated: (id: string) => void; tx: Tx;
}) {
  const { notify } = useDialog();
  const [f, setF] = useState(EMPTY);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setF(EMPTY); setFiles([]); } }, [open]);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((o) => ({ ...o, [k]: v }));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!f.moto.motorcycleNumber.trim()) m.push(tx('رقم الدبّاب', 'Motorcycle number'));
    if (!f.issue) m.push(tx('المشكلة', 'Issue'));
    if (f.issue === 'other' && !f.issueOther.trim()) m.push(tx('وصف المشكلة', 'Issue description'));
    if (!f.location) m.push(tx('موقع الصيانة', 'Maintenance location'));
    if (!f.availability) m.push(tx('وقت التوفّر', 'Availability'));
    if (f.availability === 'other' && !f.availabilityOther.trim()) m.push(tx('الوقت المناسب', 'Preferred time'));
    return m;
  }, [f, tx]);

  const submit = async () => {
    if (missing.length) { notify(`${tx('أكمل', 'Complete')}: ${missing.join('، ')}`, 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post<{ item: { _id: string; ref: string } }>(MEDIAGO_API, {
        vehicle: f.moto.vehicle || undefined, motorcycleNumber: f.moto.motorcycleNumber.trim(),
        screenNumber: f.screenNumber.trim(),
        issue: f.issue, issueOther: f.issueOther.trim(),
        location: f.location,
        availability: f.availability, availabilityOther: f.availabilityOther.trim(),
        files: files.map((x) => ({ dataUrl: x.dataUrl, fileName: x.fileName })),
      });
      notify(tx(`رُفع البلاغ ${r.item.ref}`, `Complaint ${r.item.ref} submitted`), 'success');
      onCreated(r.item._id);
    } catch (e: any) {
      notify(e?.message || tx('تعذّر الحفظ', 'Save failed'), 'error');
    }
    setSaving(false);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-l from-[#12325c] to-[#1d4f8f] px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white/15 p-2"><MonitorPlay className="h-5 w-5" /></span>
            <span className="flex flex-col leading-tight">
              <span className="text-[16px] font-bold">بلاغ عطل شاشة — Media Go</span>
              <span className="text-[11.5px] text-white/70" dir="ltr">Screen fault report</span>
            </span>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Q ar="رقم الدبّاب" en="Motorcycle Number" required>
              <MotorcyclePicker value={f.moto} onChange={(v) => set('moto', v)} tx={tx} />
            </Q>
            <Q ar="رقم الشاشة" en="Screen Number">
              <input value={f.screenNumber} onChange={(e) => set('screenNumber', e.target.value)} maxLength={60}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </Q>
          </div>
          <Q ar="صورة العطل" en="Photo of the Fault">
            <MediaPicker files={files} onChange={setFiles} tx={tx} />
          </Q>
          <Q ar="المشكلة" en="Issue" required>
            <ChoiceGrid items={meta?.issue || []} value={f.issue} onChange={(k) => set('issue', k)} />
            {f.issue === 'other' && (
              <input autoFocus value={f.issueOther} onChange={(e) => set('issueOther', e.target.value)} maxLength={500}
                placeholder={tx('صف المشكلة', 'Describe the issue')}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            )}
          </Q>
          <Q ar="موقع الصيانة" en="Maintenance Location" required>
            <ChoiceGrid items={meta?.location || []} value={f.location} onChange={(k) => set('location', k)} />
          </Q>
          <Q ar="وقت توفّر الدبّاب في المقر" en="Time the Motorcycle Will Be Available" required>
            <ChoiceGrid items={meta?.availability || []} value={f.availability} onChange={(k) => set('availability', k)} />
            {f.availability === 'other' && (
              <input value={f.availabilityOther} onChange={(e) => set('availabilityOther', e.target.value)} maxLength={200}
                placeholder={tx('اكتب الوقت المناسب', 'Write the preferred time')}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            )}
          </Q>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <span className="text-[11.5px] text-slate-500">{missing.length ? `${tx('ناقص', 'Missing')}: ${missing.join('، ')}` : tx('جاهز للإرسال', 'Ready to submit')}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{tx('إلغاء', 'Cancel')}</button>
            <button type="button" onClick={submit} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#e0621a] disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? tx('جارٍ الرفع…', 'Uploading…') : tx('رفع البلاغ', 'Submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── عارضُ الصور والمقاطع ────────────────────────────────────────────────────
function Lightbox({ files, index, onClose, onIndex }: { files: MgFull['files']; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const f = files[index];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % files.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + files.length) % files.length);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, files.length, onClose, onIndex]);
  if (!f) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
      {files.length > 1 && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + files.length) % files.length); }} className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Previous"><ChevronLeft className="h-6 w-6 rtl:rotate-180" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % files.length); }} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Next"><ChevronRight className="h-6 w-6 rtl:rotate-180" /></button>
        </>
      )}
      <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        {f.kind === 'video'
          ? <video key={f.fileUrl} src={f.fileUrl} controls autoPlay playsInline className="max-h-[85vh] max-w-full rounded-lg" />
          : <img src={f.fileUrl} alt={f.fileName || ''} className="max-h-[85vh] max-w-full rounded-lg object-contain" />}
        <p className="mt-2 text-center text-[12px] text-white/70">{index + 1} / {files.length}{f.fileName ? ` — ${f.fileName}` : ''}</p>
      </div>
    </div>
  );
}

// ── لوحةُ التفصيل ─────────────────────────────────────────────────────────
function InfoCell({ icon, ar, en, mode, children }: { icon: ReactNode; ar: string; en: string; mode: Mode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">{icon}<Bi ar={ar} en={en} mode={mode} sub="text-[10px] font-medium text-slate-400" /></div>
      <div className="text-[13.5px] font-bold text-slate-900">{children}</div>
    </div>
  );
}

export function ComplaintDrawer({ id, onClose, mode, onChanged }: { id: string; onClose: () => void; mode: Mode; onChanged: () => void }) {
  const tx = useMemo(() => makeTx(mode), [mode]);
  const ar = mode !== 'en';
  const { notify, confirm, prompt } = useDialog();
  const [d, setD] = useState<MgFull | null>(null);
  const [meta, setMeta] = useState<Vocab | null>(null);
  const [can, setCan] = useState<Can | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [more, setMore] = useState<LocalFile[]>([]);
  const [view, setView] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ item: MgFull; meta: Vocab; can: Can }>(`${MEDIAGO_API}/${id}`);
      setD(r.item); setMeta(r.meta); setCan(r.can); setErr('');
    } catch (e: any) { setErr(e?.message || 'Failed'); }
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);
  useSocket('mediago:complaint', useCallback((p: { id?: string }) => { if (!p?.id || p.id === id) load(); }, [id, load]));
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [d?.replies?.length]);

  const after = (item: MgFull) => { setD(item); onChanged(); };

  const setStatus = async (status: string) => {
    if (!d) return;
    const note = await prompt({
      title: vocabLabel(meta, 'status', status, vLang(mode)),
      message: tx('ملاحظة مع الحالة (اختياري)', 'A note with the status (optional)'),
      confirmLabel: tx('تأكيد', 'Confirm'),
    });
    if (note === null) return;
    setBusy(`s:${status}`);
    try { after((await api.patch<{ item: MgFull }>(`${MEDIAGO_API}/${d._id}/status`, { status, note })).item); }
    catch (e: any) { notify(e?.message || tx('تعذّر الحفظ', 'Save failed'), 'error'); }
    setBusy('');
  };
  const sendReply = async () => {
    if (!d || !reply.trim()) return;
    setBusy('reply');
    try { after((await api.post<{ item: MgFull }>(`${MEDIAGO_API}/${d._id}/replies`, { text: reply.trim() })).item); setReply(''); }
    catch (e: any) { notify(e?.message || tx('تعذّر الإرسال', 'Send failed'), 'error'); }
    setBusy('');
  };
  const upload = async () => {
    if (!d || !more.length) return;
    setBusy('files');
    try { after((await api.post<{ item: MgFull }>(`${MEDIAGO_API}/${d._id}/files`, { files: more.map((x) => ({ dataUrl: x.dataUrl, fileName: x.fileName })) })).item); setMore([]); }
    catch (e: any) { notify(e?.message || tx('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy('');
  };
  const remove = async () => {
    if (!d) return;
    const ok = await confirm({ title: tx('حذف البلاغ', 'Delete complaint'), message: tx(`حذف ${d.ref} نهائيًّا مع مرفقاته؟`, `Delete ${d.ref} and its files permanently?`), tone: 'danger', confirmLabel: tx('حذف', 'Delete') });
    if (!ok) return;
    try { await api.delete(`${MEDIAGO_API}/${d._id}`); onChanged(); onClose(); }
    catch (e: any) { notify(e?.message || tx('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  const partner = mode === 'partner';
  const statusButtons = (can?.statuses || []).filter((s) => s !== d?.status && !(partner && d?.status === 'closed'));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="flex h-full w-full max-w-xl flex-col bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex items-start justify-between gap-3 bg-gradient-to-l from-[#12325c] to-[#1d4f8f] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[12px] text-white/70">{d ? fmtDateTime(d.createdAt, ar) : ''}</p>
            <h2 className="flex items-center gap-2 text-[19px] font-extrabold tracking-wide">
              <span dir="ltr">{d?.ref || '…'}</span>
              {d && <StatusPill status={d.status} meta={meta} mode={mode} />}
            </h2>
            {d?.createdByName && <p className="mt-0.5 text-[11.5px] text-white/70">{tx('رُفع بواسطة', 'Reported by')}: {d.createdByName}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {!d ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">{err || <Loader2 className="h-6 w-6 animate-spin" />}</div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-2.5">
              <InfoCell icon={<Bike className="h-3.5 w-3.5" />} ar="رقم الدبّاب" en="Motorcycle" mode={mode}>
                <span dir="auto">{d.motorcycleNumber}</span>
                {(d.serialNumber || d.project) && <span className="block text-[11px] font-medium text-slate-500">{[d.serialNumber && `#${d.serialNumber}`, d.project].filter(Boolean).join(' · ')}</span>}
              </InfoCell>
              <InfoCell icon={<MonitorPlay className="h-3.5 w-3.5" />} ar="رقم الشاشة" en="Screen" mode={mode}>{d.screenNumber || '—'}</InfoCell>
              <div className="col-span-2">
                <InfoCell icon={<AlertTriangle className="h-3.5 w-3.5" />} ar="المشكلة" en="Issue" mode={mode}>
                  {d.issue === 'other' ? <>{vocabLabel(meta, 'issue', 'other', vLang(mode))}: <span className="font-semibold">{d.issueOther}</span></> : issueText(meta, d, vLang(mode))}
                </InfoCell>
              </div>
              <InfoCell icon={<MapPin className="h-3.5 w-3.5" />} ar="موقع الصيانة" en="Location" mode={mode}>{vocabLabel(meta, 'location', d.location, vLang(mode))}</InfoCell>
              <InfoCell icon={<Clock className="h-3.5 w-3.5" />} ar="وقت التوفّر" en="Available" mode={mode}>{availabilityText(meta, d, vLang(mode))}</InfoCell>
            </div>

            {/* الصورُ والمقاطع */}
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-slate-800"><ImageIcon className="h-4 w-4 text-[#f37121]" /><Bi ar={`صور العطل (${d.files.length})`} en={`Fault media (${d.files.length})`} mode={mode} /></h3>
              {d.files.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {d.files.map((f, i) => (
                    <button key={f._id || i} type="button" onClick={() => setView(i)} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-900">
                      {f.kind === 'video'
                        ? <><video src={`${f.fileUrl}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover opacity-80" /><span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 p-2 text-white"><Film className="h-5 w-5" /></span></span></>
                        : <img src={f.fileUrl} alt={f.fileName || ''} className="h-full w-full object-cover transition group-hover:scale-105" />}
                    </button>
                  ))}
                </div>
              ) : <p className="text-[12.5px] text-slate-500">{tx('لا مرفقات', 'No attachments')}</p>}
              {can?.create && d.files.length < MG_LIMITS.maxFiles && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <MediaPicker files={more} onChange={setMore} tx={tx} room={MG_LIMITS.maxFiles - d.files.length} />
                  {!!more.length && (
                    <button type="button" onClick={upload} disabled={busy === 'files'} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#12325c] px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60">
                      {busy === 'files' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}{tx('رفع المرفقات', 'Upload files')}
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* الحالة */}
            {!!statusButtons.length && (
              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-[13px] font-bold text-slate-800"><Bi ar="تحديث الحالة" en="Update status" mode={mode} /></h3>
                <div className="flex flex-wrap gap-2">
                  {statusButtons.map((s) => (
                    <button key={s} type="button" disabled={!!busy} onClick={() => setStatus(s)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-bold ring-1 transition hover:brightness-95 disabled:opacity-60 ${(STATUS_TONE[s] || STATUS_TONE.closed).pill}`}>
                      {busy === `s:${s}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s === 'fixed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className={`h-2 w-2 rounded-full ${(STATUS_TONE[s] || STATUS_TONE.closed).dot}`} />}
                      {vocabLabel(meta, 'status', s, vLang(mode))}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* السجلّ */}
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-[13px] font-bold text-slate-800"><Bi ar="مسار البلاغ" en="Timeline" mode={mode} /></h3>
              <ol className="space-y-2 border-s-2 border-slate-100 ps-3">
                {d.statusHistory.map((h, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -start-[19px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${(STATUS_TONE[h.status] || STATUS_TONE.closed).dot}`} />
                    <p className="text-[12.5px] font-bold text-slate-800">{vocabLabel(meta, 'status', h.status, vLang(mode))}</p>
                    <p className="text-[11px] text-slate-500">{h.side === 'mediago' ? 'Media Go' : 'Energize'}{h.byName ? ` · ${h.byName}` : ''} · {fmtDateTime(h.at, ar)}</p>
                    {h.note && <p className="mt-0.5 text-[12px] text-slate-600">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </section>

            {/* المحادثة */}
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-[13px] font-bold text-slate-800"><Bi ar={`الردود (${d.replies.length})`} en={`Replies (${d.replies.length})`} mode={mode} /></h3>
              <div className="space-y-2">
                {d.replies.map((r, i) => {
                  const mine = (r.side === 'mediago') === partner;
                  return (
                    <div key={r._id || i} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${r.side === 'mediago' ? 'bg-violet-50 text-violet-950 ring-1 ring-violet-100' : 'bg-orange-50 text-slate-900 ring-1 ring-orange-100'}`}>
                        <p className="mb-0.5 flex items-center gap-1 text-[10.5px] font-bold text-slate-500"><UserIcon className="h-3 w-3" />{r.side === 'mediago' ? 'Media Go' : 'Energize'}{r.byName ? ` · ${r.byName}` : ''}</p>
                        <p className="whitespace-pre-wrap text-[13px]" dir="auto">{r.text}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(r.at, ar)}</p>
                      </div>
                    </div>
                  );
                })}
                {!d.replies.length && <p className="text-[12.5px] text-slate-500">{tx('لا ردود بعد', 'No replies yet')}</p>}
                <div ref={endRef} />
              </div>
            </section>
          </div>
        )}

        {d && (
          <div className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={2000} dir="auto"
                placeholder={tx('اكتب ردًّا…', 'Write a reply…')}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
              <button type="button" onClick={sendReply} disabled={!reply.trim() || busy === 'reply'}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#f37121] px-4 text-sm font-bold text-white hover:bg-[#e0621a] disabled:opacity-50">
                {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
              </button>
            </div>
            {can?.delete && (
              <button type="button" onClick={remove} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 hover:underline">
                <Trash2 className="h-3.5 w-3.5" />{tx('حذف البلاغ', 'Delete complaint')}
              </button>
            )}
          </div>
        )}
        {d && view !== null && <Lightbox files={d.files} index={view} onClose={() => setView(null)} onIndex={setView} />}
      </aside>
    </div>
  );
}

