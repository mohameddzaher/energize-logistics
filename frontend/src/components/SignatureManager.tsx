'use client';
// SignatureManager — lets a user create and manage their personal signatures
// (draw with mouse/finger OR upload an image). Signatures are stored as
// transparent PNG data-URLs and applied later to documents (e.g. leave sheets).
import { useState, useEffect, useRef, useCallback } from 'react';
import { PenTool, Upload, Trash2, Star, Check, Eraser, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { PrimaryButton } from '@/components/hr/HRKit';

export interface Signature { _id: string; name: string; dataUrl: string; isDefault: boolean; createdAt?: string }

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

export default function SignatureManager() {
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

  const load = useCallback(async () => {
    try { const res = await api.get<{ signatures: Signature[] }>('/api/auth/signatures'); setItems(res.signatures || []); } catch { /* keep */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- Drawing pad ----
  const ctx = () => canvasRef.current?.getContext('2d') || null;
  const point = (e: React.PointerEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault(); drawing.current = true; const g = ctx(); if (!g) return;
    g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827';
    const p = point(e); g.beginPath(); g.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const g = ctx(); if (!g) return; const p = point(e); g.lineTo(p.x, p.y); g.stroke(); setHasInk(true); };
  const end = () => { drawing.current = false; };
  const clearPad = () => { const c = canvasRef.current; if (c) ctx()?.clearRect(0, 0, c.width, c.height); setHasInk(false); };

  const saveDrawn = async () => {
    const c = canvasRef.current; if (!c || !hasInk) return;
    setSaving(true);
    try {
      await api.post('/api/auth/signatures', { name: name.trim() || undefined, dataUrl: c.toDataURL('image/png') });
      clearPad(); setName(''); await load();
    } catch (e: any) { alert(e?.message || t('Failed to save', 'فشل الحفظ')); }
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
    } catch (e: any) { alert(e?.message || t('Failed to upload', 'فشل الرفع')); }
    setSaving(false);
  };

  const setDefault = async (id: string) => { try { await api.put(`/api/auth/signatures/${id}`, { isDefault: true }); await load(); } catch { /* */ } };
  const rename = async (id: string, current: string) => {
    const n = window.prompt(t('Signature name', 'اسم التوقيع'), current); if (n == null) return;
    try { await api.put(`/api/auth/signatures/${id}`, { name: n }); await load(); } catch { /* */ }
  };
  const remove = async (id: string) => { if (!window.confirm(t('Delete this signature?', 'تمسح التوقيع ده؟'))) return; try { await api.delete(`/api/auth/signatures/${id}`); await load(); } catch { /* */ } };

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Create */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <button type="button" onClick={() => setMode('draw')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'draw' ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-600'}`}><PenTool className="w-4 h-4" /> {t('Draw', 'ارسم')}</button>
          <button type="button" onClick={() => setMode('upload')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'upload' ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-600'}`}><Upload className="w-4 h-4" /> {t('Upload image', 'ارفع صورة')}</button>
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Signature name (optional)', 'اسم التوقيع (اختياري)')} className="w-full mb-3 px-3 py-2 rounded-lg border border-slate-200 text-sm" />

        {mode === 'draw' ? (
          <div>
            <div className="rounded-lg border-2 border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,#fafafa,#fafafa_10px,#f3f4f6_10px,#f3f4f6_20px)]">
              <canvas ref={canvasRef} width={600} height={200} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
                className="w-full touch-none cursor-crosshair" style={{ height: 200 }} />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button type="button" onClick={clearPad} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm"><Eraser className="w-4 h-4" /> {t('Clear', 'مسح')}</button>
              <PrimaryButton onClick={saveDrawn} disabled={!hasInk || saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Save signature', 'احفظ التوقيع')}</PrimaryButton>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 h-[200px] rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100">
            {saving ? <Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /> : <Upload className="w-7 h-7 text-slate-400" />}
            <span className="text-sm text-slate-500">{t('Click to choose a signature image', 'اضغط لاختيار صورة توقيع')}</span>
            <span className="text-xs text-slate-400">PNG / JPG</span>
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
          </label>
        )}
      </div>

      {/* List */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">{t('My signatures', 'توقيعاتي')} ({items.length})</p>
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : items.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">{t('No signatures yet — create one above.', 'لا توجد توقيعات بعد — اعمل واحد فوق.')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((s) => (
              <div key={s._id} className={`bg-white border rounded-xl p-3 shadow-sm ${s.isDefault ? 'border-[#f37121]' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                    {s.isDefault && <Star className="w-3.5 h-3.5 fill-[#f37121] text-[#f37121]" />}{s.name}
                  </span>
                  <div className="flex items-center gap-1">
                    {!s.isDefault && <button type="button" onClick={() => setDefault(s._id)} title={t('Set default', 'اجعله الافتراضي')} className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-500"><Star className="w-4 h-4" /></button>}
                    <button type="button" onClick={() => rename(s._id, s.name)} title={t('Rename', 'إعادة تسمية')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(s._id)} title={t('Delete', 'حذف')} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-100 h-24 flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.dataUrl} alt={s.name} className="max-h-full max-w-full object-contain" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
