'use client';
/**
 * عُدّةُ «المحتوى الإعلاني» — الأنواعُ والعارضُ والمصغّراتُ والكاميرا الحيّة،
 * تشترك فيها القائمةُ وصفحةُ الطلب (app/system/b2c/mediago-ads).
 */
import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Trash2, Camera, Check, Circle, Square } from 'lucide-react';

export const API = '/api/b2c/mediago-ads';
export type VocabItem = { key: string; ar: string; en: string };
export type Meta = { mediaType: VocabItem[]; location: VocabItem[]; status: VocabItem[]; companies: { key: string; nameAr: string; nameEn: string }[] };
export type Can = { partner: boolean; create: boolean; shoot: boolean; deliver: boolean; close: boolean; cancel: boolean; delete: boolean };
export type AdFile = { _id: string; fileUrl: string; fileName?: string; kind: 'image' | 'video'; durationSec?: number | null; uploadedByName?: string; uploadedAt?: string };
export type AdItem = { _id: string; vehicle: string | null; plateNumber: string; serialNumber: string; project: string; mediaType: 'photo' | 'video'; files: AdFile[]; ready: boolean; readyAt?: string | null; readyByName?: string; note?: string };
export type Row = {
  _id: string; ref: string; adName: string; company: string; companyKey: string; mediaType: 'photo' | 'video'; location: 'shelter' | 'road';
  note: string; neededBy: string; status: string; vehicles: string[]; vehicleCount: number; readyCount: number; fileCount: number;
  cover: string; replyCount: number; deliveredAt?: string | null; createdByName: string; createdAt: string;
};
export type Full = Row & { items: AdItem[]; files: AdFile[]; statusHistory: { status: string; note?: string; byName?: string; side: string; at: string }[]; replies: { _id: string; text: string; byName?: string; side: string; at: string }[] };
export type ListRes = { items: Row[]; total: number; grandTotal: number; counts: Record<string, Record<string, number>>; meta: Meta; can: Can };

export const MAX_VIDEO_SEC = 15;
export const STATUS_TONE: Record<string, string> = {
  new: 'bg-sky-50 text-sky-700 ring-sky-200', in_progress: 'bg-amber-50 text-amber-800 ring-amber-200',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200', closed: 'bg-slate-100 text-slate-600 ring-slate-200',
  cancelled: 'bg-red-50 text-red-700 ring-red-200',
};
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
export const fmtDT = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
export const videoDuration = (f: File) => new Promise<number>((res) => {
  const v = document.createElement('video'); v.preload = 'metadata';
  v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(Number.isFinite(v.duration) ? v.duration : 0); };
  v.onerror = () => res(0);
  v.src = URL.createObjectURL(f);
});

export function Lightbox({ files, index, onClose, onIndex }: { files: AdFile[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
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
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={f.fileUrl} alt={f.fileName || ''} className="max-h-[85vh] max-w-full rounded-lg object-contain" />}
        <p className="mt-2 text-center text-[12px] text-white/70">{index + 1} / {files.length}</p>
      </div>
    </div>
  );
}

export function Thumbs({ files, onOpen, onRemove }: { files: AdFile[]; onOpen: (i: number) => void; onRemove?: (f: AdFile) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
      {files.map((f, i) => (
        <div key={f._id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-900">
          <button type="button" onClick={() => onOpen(i)} className="block h-full w-full">
            {f.kind === 'video'
              ? <><video src={`${f.fileUrl}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover opacity-80" /><span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 p-1.5 text-white"><Play className="h-4 w-4" /></span></span>{f.durationSec ? <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1 text-[10px] text-white">{Math.round(f.durationSec)}s</span> : null}</>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={f.fileUrl} alt="" className="h-full w-full object-cover" />}
          </button>
          {onRemove && (
            <button type="button" onClick={() => onRemove(f)} className="absolute end-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-red-600 sm:hidden sm:group-hover:block" aria-label="Remove"><Trash2 className="h-3 w-3" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * ── الكاميرا الحيّة (٢٠٢٦/١٠/٢٢) ─────────────────────────────────────────────
 * تُصوَّر الصورُ أو الفيديو من الجهاز نفسِه بلا رفعِ ملفّ: صورةٌ بعد صورة، أو
 * فيديو يتوقّف وحدَه عند ١٥ ثانية. ويُردّ ما صُوِّر بصيغة الرفع نفسِها.
 */
export type Shot = { dataUrl: string; fileName: string; durationSec?: number };
export function LiveCamera({ mode, ar, onDone, onClose }: { mode: 'photo' | 'video'; ar: boolean; onDone: (shots: Shot[]) => void; onClose: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [err, setErr] = useState('');
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  // الأزرارُ مغلقةٌ حتى تعمل الكاميرا — ضغطةٌ قبلها كانت تضيع بلا أثر.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    setReady(false);
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 } }, audio: mode === 'video' })
      .then((s) => { if (dead) { s.getTracks().forEach((x) => x.stop()); return; } stream.current = s; setReady(true); if (vid.current) { vid.current.srcObject = s; vid.current.play().catch(() => {}); } })
      .catch((e) => setErr(e?.message || t('تعذّر فتح الكاميرا — اسمح للمتصفّح بالكاميرا', 'Could not open the camera — allow camera access')));
    return () => { dead = true; stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, mode]);
  useEffect(() => {
    if (!recording) return undefined;
    const h = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSecs(s);
      if (s >= MAX_VIDEO_SEC) stop();
    }, 200);
    return () => clearInterval(h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const snap = () => {
    const v = vid.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    setShots((p) => [...p, { dataUrl: c.toDataURL('image/jpeg', 0.88), fileName: `photo-${Date.now()}.jpg` }]);
  };
  const start = () => {
    if (!stream.current) return;
    const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((x) => (window as any).MediaRecorder?.isTypeSupported?.(x)) || '';
    // ٢٫٥ ميغابت: ١٥ ثانيةً ≈ ٥ ميغا — تحت حدّ الخادم بكثير.
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_500_000 });
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const dur = Math.min(MAX_VIDEO_SEC, (Date.now() - startedAt.current) / 1000);
      // الخادمُ يقرأ «data:video/webm;base64» — فلا يُترَك «;codecs=…» في النوع.
      const base = (r.mimeType || 'video/webm').split(';')[0];
      const blob = new Blob(chunks.current, { type: base });
      const fr = new FileReader();
      fr.onload = () => setShots((p) => [...p, { dataUrl: String(fr.result), fileName: `video-${Date.now()}.${base.includes('mp4') ? 'mp4' : 'webm'}`, durationSec: Math.round(dur * 10) / 10 }]);
      fr.readAsDataURL(blob);
    };
    rec.current = r; startedAt.current = Date.now(); setSecs(0); setRecording(true);
    r.start(250);
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); setRecording(false); };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 p-3 text-white">
        <span className="text-sm font-bold">{mode === 'video' ? t(`تصوير فيديو — ${MAX_VIDEO_SEC} ثانية على الأكثر`, `Record video — max ${MAX_VIDEO_SEC}s`) : t('تصوير صور', 'Take photos')}</span>
        <button type="button" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={recording} className="ms-auto rounded-lg bg-white/10 px-3 py-1.5 text-[12px] hover:bg-white/20 disabled:opacity-40">{t('تبديل الكاميرا', 'Switch camera')}</button>
        <button type="button" onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {err ? <p className="max-w-sm p-6 text-center text-sm text-red-300">{err}</p>
          : <video ref={vid} muted playsInline className="max-h-full max-w-full" />}
        {!ready && !err && <span className="absolute inset-0 flex items-center justify-center text-sm text-white/70">{t('جارٍ فتح الكاميرا…', 'Opening the camera…')}</span>}
        {recording && <span className="absolute top-3 rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white tabular-nums">● {Math.floor(secs)} / {MAX_VIDEO_SEC}s</span>}
      </div>
      {!!shots.length && (
        <div className="flex gap-2 overflow-x-auto bg-black/80 p-2">
          {shots.map((s, i) => (
            <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-800">
              {s.durationSec != null
                ? <><video src={s.dataUrl} muted className="h-full w-full object-cover" /><span className="absolute bottom-0.5 start-0.5 rounded bg-black/60 px-1 text-[10px] text-white">{Math.round(s.durationSec)}s</span></>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={s.dataUrl} alt="" className="h-full w-full object-cover" />}
              <button type="button" onClick={() => setShots((p) => p.filter((_, j) => j !== i))} className="absolute end-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-6 p-5">
        {mode === 'photo' ? (
          <button type="button" onClick={snap} disabled={!!err || !ready} className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 text-white hover:bg-white/30 disabled:opacity-40" aria-label="Shoot"><Camera className="h-6 w-6" /></button>
        ) : recording ? (
          <button type="button" onClick={stop} className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600 text-white" aria-label="Stop"><Square className="h-6 w-6" /></button>
        ) : (
          <button type="button" onClick={start} disabled={!!err || !ready} className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-500 text-white disabled:opacity-40" aria-label="Record"><Circle className="h-6 w-6 fill-white" /></button>
        )}
        <button type="button" onClick={() => onDone(shots)} disabled={!shots.length || recording}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
          <Check className="h-4 w-4" />{t(`حفظ (${shots.length})`, `Save (${shots.length})`)}
        </button>
      </div>
    </div>
  );
}
