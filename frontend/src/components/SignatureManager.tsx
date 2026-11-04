'use client';
// Personal signatures: drawn or uploaded, stored as PNG data-URLs and applied later to documents (e.g. leave sheets).
import { useState, useEffect, useRef, useCallback } from 'react';
import { PenTool, Upload, Trash2, Star, Pencil, Eraser, Loader2, Save } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { PrimaryButton, TextInput } from '@/components/hr/HRKit';

export interface Signature { _id: string; name: string; dataUrl: string; isDefault: boolean; createdAt?: string }

const PAD_HEIGHT = 200;
// Caps the bitmap so a wide retina pad stays far below the server's 400 KB data-URL limit.
const MAX_PAD_PX = 1200;

// Downscale an uploaded image to a max width and re-encode as PNG (keeps it small).
function downscale(dataUrl: string, maxW = 500): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// The pad is as wide as the screen; crop to the ink so a signature fills its slot on documents instead of shrinking with the empty margins.
function trimmedPng(c: HTMLCanvasElement, pad: number): string {
  const g = c.getContext('2d'); if (!g) return c.toDataURL('image/png');
  const { width: w, height: h } = c;
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return c.toDataURL('image/png');
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(w - 1, Math.ceil(x1 + pad)); y1 = Math.min(h - 1, Math.ceil(y1 + pad));
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function ModeTab({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${on ? 'bg-white text-[#12325C] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
      {icon} {label}
    </button>
  );
}

function SignatureCard({ s, ar, onDefault, onRename, onRemove }: {
  s: Signature; ar: boolean; onDefault: () => void; onRename: () => void; onRemove: () => void;
}) {
  const t = (en: string, a: string) => (ar ? a : en);
  return (
    <div className={`min-w-0 bg-white border rounded-xl shadow-sm overflow-hidden ${s.isDefault ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200'}`}>
      <div className="h-28 flex items-center justify-center p-3 bg-slate-50 border-b border-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.dataUrl} alt={s.name} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 min-h-[56px]">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate" title={s.name}>{s.name}</p>
          {s.isDefault && (
            <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-semibold text-[#f37121]">
              <Star className="w-3 h-3 fill-[#f37121]" /> {t('Default', 'الافتراضي')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!s.isDefault && (
            <button type="button" onClick={onDefault} title={t('Set default', 'اجعله الافتراضي')} aria-label={t('Set default', 'اجعله الافتراضي')}
              className="p-2 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-500"><Star className="w-4 h-4" /></button>
          )}
          <button type="button" onClick={onRename} title={t('Rename', 'إعادة تسمية')} aria-label={t('Rename', 'إعادة تسمية')}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
          <button type="button" onClick={onRemove} title={t('Delete', 'حذف')} aria-label={t('Delete', 'حذف')}
            className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}

export default function SignatureManager() {
  const { confirm, notify, prompt } = useDialog();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const [items, setItems] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const scaleRef = useRef(1);

  const load = useCallback(async () => {
    try { const res = await api.get<{ signatures: Signature[] }>('/api/auth/signatures'); setItems(res.signatures || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // A fixed 600px bitmap stretched to a phone-width box saved a squashed signature; size the bitmap to the box instead.
  useEffect(() => {
    if (mode !== 'draw') return;
    const c = canvasRef.current; if (!c) return;
    let lastW = 0;
    const fit = () => {
      const w = c.clientWidth; if (!w || w === lastW) return;
      lastW = w;
      const scale = Math.min(window.devicePixelRatio || 1, MAX_PAD_PX / w);
      scaleRef.current = scale;
      c.width = Math.round(w * scale);
      c.height = Math.round(PAD_HEIGHT * scale);
      setHasInk(false);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [mode]);

  const ctx = () => canvasRef.current?.getContext('2d') || null;
  const point = (e: React.PointerEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault(); drawing.current = true; const g = ctx(); if (!g) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    g.lineWidth = 3 * scaleRef.current; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827';
    const p = point(e); g.beginPath(); g.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const g = ctx(); if (!g) return; const p = point(e); g.lineTo(p.x, p.y); g.stroke(); setHasInk(true); };
  const end = () => { drawing.current = false; };
  const clearPad = () => { const c = canvasRef.current; if (c) ctx()?.clearRect(0, 0, c.width, c.height); setHasInk(false); };

  const saveDrawn = async () => {
    const c = canvasRef.current; if (!c || !hasInk) return;
    setSaving(true);
    try {
      await api.post('/api/auth/signatures', { name: name.trim() || undefined, dataUrl: trimmedPng(c, 8 * scaleRef.current) });
      clearPad(); setName(''); await load();
    } catch (e: any) { notify(e?.message || t('Failed to save', 'فشل الحفظ'), 'error'); }
    setSaving(false);
  };

  const onUpload = async (file?: File) => {
    if (!file) return;
    setSaving(true);
    try {
      const raw = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
      const dataUrl = await downscale(raw);
      await api.post('/api/auth/signatures', { name: name.trim() || file.name.replace(/\.[^.]+$/, ''), dataUrl });
      setName(''); await load();
    } catch (e: any) { notify(e?.message || t('Failed to upload', 'فشل الرفع'), 'error'); }
    setSaving(false);
  };

  const setDefault = async (id: string) => { try { await api.put(`/api/auth/signatures/${id}`, { isDefault: true }); await load(); } catch { /* */ } };
  const rename = async (id: string, current: string) => {
    const n = await prompt({ message: t('Signature name', 'اسم التوقيع'), defaultValue: current }); if (n == null) return;
    try { await api.put(`/api/auth/signatures/${id}`, { name: n }); await load(); } catch { /* */ }
  };
  const remove = async (id: string) => { if (!(await confirm(t('Delete this signature?', 'حذف هذا التوقيع؟')))) return; try { await api.delete(`/api/auth/signatures/${id}`); await load(); } catch { /* */ } };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex p-1 rounded-lg bg-slate-200/70 shrink-0" role="group">
            <ModeTab on={mode === 'draw'} onClick={() => setMode('draw')} icon={<PenTool className="w-4 h-4" />} label={t('Draw', 'ارسم')} />
            <ModeTab on={mode === 'upload'} onClick={() => setMode('upload')} icon={<Upload className="w-4 h-4" />} label={t('Upload image', 'ارفع صورة')} />
          </div>
          <div className="min-w-0 flex-1">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Signature name (optional)', 'اسم التوقيع (اختياري)')}
              placeholder={t('Signature name (optional)', 'اسم التوقيع (اختياري)')} />
          </div>
        </div>

        {mode === 'draw' ? (
          <div>
            <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-white overflow-hidden">
              <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
                className="block w-full touch-none cursor-crosshair" style={{ height: PAD_HEIGHT }} />
              {/* Baseline guide; pointer-events-none so it never blocks drawing. */}
              <div className="pointer-events-none absolute inset-x-6 bottom-12 border-b border-slate-200" />
              {!hasInk && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400 select-none">
                  {t('Sign here with your mouse or finger', 'وقّع هنا بالفأرة أو بإصبعك')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
              <button type="button" onClick={clearPad} disabled={!hasInk}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-sm font-medium disabled:opacity-50">
                <Eraser className="w-4 h-4" /> {t('Clear', 'مسح')}
              </button>
              <PrimaryButton onClick={saveDrawn} disabled={!hasInk || saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('Save signature', 'احفظ التوقيع')}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white cursor-pointer hover:border-[#f37121]/60 hover:bg-orange-50/30 text-center px-4"
            style={{ height: PAD_HEIGHT }}>
            {saving ? <Loader2 className="w-7 h-7 animate-spin text-[#f37121]" /> : <Upload className="w-7 h-7 text-slate-400" />}
            <span className="text-sm text-slate-600 font-medium">{t('Click to choose a signature image', 'اضغط لاختيار صورة توقيع')}</span>
            <span className="text-xs text-slate-400" dir="ltr">PNG / JPG</span>
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={saving}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onUpload(f); }} />
          </label>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-sm font-semibold text-slate-800">{t('Saved signatures', 'التوقيعات المحفوظة')}</p>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold tabular-nums">{items.length}</span>
        </div>
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : items.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center rounded-xl border border-dashed border-slate-200">
            {t('No signatures yet. Create one above.', 'لا توجد توقيعات بعد، أنشئ واحدًا بالأعلى.')}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((s) => (
              <SignatureCard key={s._id} s={s} ar={ar} onDefault={() => setDefault(s._id)} onRename={() => rename(s._id, s.name)} onRemove={() => remove(s._id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
