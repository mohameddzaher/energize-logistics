'use client';
/**
 * المحتوى الإعلانيّ — صفحةٌ مشتركةٌ بيننا وبين Media Go (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢).
 *
 * Media Go تطلب تصويرَ إعلانٍ: اسمُه، ولأيّ شركة (إنرجايز، هيرو مايل… من إعدادات
 * القسم)، ومركباتُ النقل الخفيف إن كان لشركتنا، وصورٌ أم فيديو، وبالإيواء أم
 * بالطريق، وملاحظةٌ وتاريخٌ اختياريّان. ونحن نصوّر لكلّ مركبةٍ تحقّقَها — صورًا
 * أو فيديو حتى ١٥ ثانية — ونراجعه ونعلّمه «جاهز»، ثمّ «تمّ» فيصلها في سجلّاتها
 * مركبةً مركبة، وتردّ بملاحظةٍ إن شاءت. والحسابُ كلُّه في الخادم
 * (controllers/mediagoAdController).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import {
  Clapperboard, Plus, X, Search, Camera, Video, Image as ImageIcon, Check, Loader2, Trash2, Send,
  ChevronLeft, ChevronRight, MapPin, CalendarDays, Building2, Car, Play, CheckCircle2, RotateCcw, Ban, Lock,
} from 'lucide-react';

const API = '/api/b2c/mediago-ads';
type VocabItem = { key: string; ar: string; en: string };
type Meta = { mediaType: VocabItem[]; location: VocabItem[]; status: VocabItem[]; companies: { key: string; nameAr: string; nameEn: string }[] };
type Can = { partner: boolean; create: boolean; shoot: boolean; deliver: boolean; close: boolean; cancel: boolean; delete: boolean };
type AdFile = { _id: string; fileUrl: string; fileName?: string; kind: 'image' | 'video'; durationSec?: number | null; uploadedByName?: string; uploadedAt?: string };
type AdItem = { _id: string; vehicle: string | null; plateNumber: string; serialNumber: string; project: string; mediaType: 'photo' | 'video'; files: AdFile[]; ready: boolean; readyAt?: string | null; readyByName?: string; note?: string };
type Row = {
  _id: string; ref: string; adName: string; company: string; companyKey: string; mediaType: 'photo' | 'video'; location: 'shelter' | 'road';
  note: string; neededBy: string; status: string; vehicles: string[]; vehicleCount: number; readyCount: number; fileCount: number;
  cover: string; replyCount: number; deliveredAt?: string | null; createdByName: string; createdAt: string;
};
type Full = Row & { items: AdItem[]; files: AdFile[]; statusHistory: { status: string; note?: string; byName?: string; side: string; at: string }[]; replies: { _id: string; text: string; byName?: string; side: string; at: string }[] };
type ListRes = { items: Row[]; total: number; grandTotal: number; counts: Record<string, Record<string, number>>; meta: Meta; can: Can };

const MAX_VIDEO_SEC = 15;
const STATUS_TONE: Record<string, string> = {
  new: 'bg-sky-50 text-sky-700 ring-sky-200', in_progress: 'bg-amber-50 text-amber-800 ring-amber-200',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200', closed: 'bg-slate-100 text-slate-600 ring-slate-200',
  cancelled: 'bg-red-50 text-red-700 ring-red-200',
};
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const fmtDT = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
const videoDuration = (f: File) => new Promise<number>((res) => {
  const v = document.createElement('video'); v.preload = 'metadata';
  v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(Number.isFinite(v.duration) ? v.duration : 0); };
  v.onerror = () => res(0);
  v.src = URL.createObjectURL(f);
});

function Lightbox({ files, index, onClose, onIndex }: { files: AdFile[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
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

function Thumbs({ files, onOpen, onRemove }: { files: AdFile[]; onOpen: (i: number) => void; onRemove?: (f: AdFile) => void }) {
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
            <button type="button" onClick={() => onRemove(f)} className="absolute end-1 top-1 hidden rounded-full bg-black/60 p-1 text-white hover:bg-red-600 group-hover:block" aria-label="Remove"><Trash2 className="h-3 w-3" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

function AdContentInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm, prompt } = useDialog();
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const [data, setData] = useState<ListRes | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(sp?.get('id') || null);
  const [creating, setCreating] = useState(false);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      if (q.trim()) p.set('q', q.trim());
      const d = await api.get<ListRes>(`${API}?${p.toString()}`);
      if (guard.isCurrent(mine)) setData(d);
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Load failed'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, q, guard]);
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useSocket('mediago:ad', useCallback(() => load(), [load]));
  const open = (id: string | null) => { setOpenId(id); router.replace(id ? `${pathname || ""}?id=${id}` : (pathname || "")); };

  if (!data) return <Spinner />;
  const { meta, can, counts } = data;
  const V = (g: 'mediaType' | 'location' | 'status', k: string) => { const x = meta[g].find((v) => v.key === k); return x ? (ar ? x.ar : x.en) : k; };
  const setFilter = (k: string, v: string) => setF((p) => ({ ...p, [k]: p[k] === v ? '' : v }));
  const statusTabs: [string, string, string][] = can.partner
    ? [['', 'كل الطلبات', 'All'], ['new', 'جديد', 'New'], ['in_progress', 'قيد التصوير', 'In progress'], ['delivered', 'السجلات — تمّ التسليم', 'Records — delivered'], ['closed', 'مغلق', 'Closed'], ['cancelled', 'ملغى', 'Cancelled']]
    : [['', 'كل الطلبات', 'All'], ['new', 'جديد', 'New'], ['in_progress', 'قيد التصوير', 'In progress'], ['delivered', 'تمّ التسليم', 'Delivered'], ['closed', 'مغلق', 'Closed'], ['cancelled', 'ملغى', 'Cancelled']];
  const sum = (o?: Record<string, number>) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`;

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Clapperboard className="h-6 w-6 text-[#f37121]" />} title={t('المحتوى الإعلاني', 'Ad content')}
        subtitle={can.partner
          ? t('اطلب تصوير إعلانك على مركباتنا، وتابع الطلب حتى يصلك المحتوى مركبةً مركبة', 'Request your ad shot on our vehicles and follow it until the content arrives, vehicle by vehicle')
          : t('طلبات Media Go لتصوير الإعلانات — صوّر لكل مركبة وراجع ثم سلّم', 'Media Go ad requests — shoot each vehicle, review, then deliver')}>
        {can.create && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white hover:bg-[#e06010]">
            <Plus className="h-4 w-4" />{t('طلب جديد', 'New request')}
          </button>
        )}
      </PageHeader>

      {/* ── الحالات ── */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map(([k, a, e]) => (
          <button key={k || 'all'} type="button" onClick={() => setF((p) => ({ ...p, status: k }))} className={chip((f.status || '') === k)}>
            {t(a, e)}<span className="tabular-nums opacity-70">{k ? (counts.status?.[k] || 0) : sum(counts.status)}</span>
          </button>
        ))}
      </div>

      {/* ── الفلاتر ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1 basis-[260px]">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالإعلان أو رقم الطلب أو لوحة المركبة…', 'Search ad, request no. or plate…')}
            className="w-full rounded-lg border border-slate-200 py-2 pe-3 ps-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        {meta.companies.map((c) => (
          <button key={c.key} type="button" onClick={() => setFilter('company', c.nameAr)} className={chip(f.company === c.nameAr)}>
            <Building2 className="h-3.5 w-3.5" />{ar ? c.nameAr : c.nameEn}<span className="tabular-nums opacity-70">{counts.company?.[c.nameAr] || 0}</span>
          </button>
        ))}
        {meta.mediaType.map((m) => (
          <button key={m.key} type="button" onClick={() => setFilter('mediaType', m.key)} className={chip(f.mediaType === m.key)}>
            {m.key === 'video' ? <Video className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}{ar ? m.ar : m.en}<span className="tabular-nums opacity-70">{counts.mediaType?.[m.key] || 0}</span>
          </button>
        ))}
        {meta.location.map((m) => (
          <button key={m.key} type="button" onClick={() => setFilter('location', m.key)} className={chip(f.location === m.key)}>
            <MapPin className="h-3.5 w-3.5" />{ar ? m.ar : m.en}<span className="tabular-nums opacity-70">{counts.location?.[m.key] || 0}</span>
          </button>
        ))}
        <PeriodFilter ar={ar} modes={['day', 'month', 'range']} from={f.from || ''} to={f.to || ''} onChange={(a, b) => setF((p) => ({ ...p, from: a, to: b }))} />
        {(Object.values(f).some(Boolean) || q) && (
          <button type="button" onClick={() => { setF({}); setQ(''); }} className="inline-flex items-center gap-1 rounded-lg bg-[#f37121]/10 px-3 py-1.5 text-[12.5px] font-semibold text-[#f37121]"><RotateCcw className="h-3.5 w-3.5" />{t('مسح', 'Clear')}</button>
        )}
      </div>

      {/* ── الطلبات ── */}
      {!data.items.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-500">
          <Clapperboard className="mx-auto mb-2 h-8 w-8 text-slate-300" />{t('لا طلبات هنا', 'No requests here')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((r) => (
            <button key={r._id} type="button" onClick={() => open(r._id)} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-start shadow-sm transition hover:border-slate-400 hover:shadow">
              <div className="relative aspect-[16/7] bg-slate-100">
                {r.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.cover} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-slate-300">{r.mediaType === 'video' ? <Video className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}</div>}
                <span className={`absolute end-2 top-2 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${STATUS_TONE[r.status] || ''}`}>{V('status', r.status)}</span>
                {r.fileCount > 0 && <span className="absolute bottom-2 end-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{r.fileCount} {t('ملف', 'files')}</span>}
              </div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[15px] font-bold text-slate-900">{r.adName}</p>
                  <span dir="ltr" className="shrink-0 text-[11.5px] font-semibold text-slate-400">{r.ref}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"><Building2 className="me-1 inline h-3 w-3" />{r.company}</span>
                  <span className="rounded-md bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">{V('mediaType', r.mediaType)}</span>
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{V('location', r.location)}</span>
                  {r.neededBy && <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800"><CalendarDays className="me-1 inline h-3 w-3" />{r.neededBy.split('-').reverse().join('/')}</span>}
                </div>
                {r.vehicleCount > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-[11.5px] text-slate-500">
                      <span><Car className="me-1 inline h-3 w-3" />{r.vehicleCount} {t('مركبة', 'vehicles')}</span>
                      <span className="tabular-nums">{r.readyCount}/{r.vehicleCount} {t('جاهزة', 'ready')}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(r.readyCount / r.vehicleCount) * 100}%` }} /></div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">{fmtDT(r.createdAt)} · {r.createdByName}{r.replyCount ? ` · ${r.replyCount} ${t('ملاحظة', 'notes')}` : ''}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && <CreateModal ar={ar} meta={meta} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); open(id); }} />}
      {openId && <Detail id={openId} ar={ar} onClose={() => open(null)} onChanged={load} notify={notify} confirm={confirm} prompt={prompt} />}
    </div>
  );
}

// ── طلبٌ جديد ────────────────────────────────────────────────────────────────
function CreateModal({ ar, meta, onClose, onCreated }: { ar: boolean; meta: Meta; onClose: () => void; onCreated: (id: string) => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [adName, setAdName] = useState('');
  const [companyKey, setCompanyKey] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [picked, setPicked] = useState<{ _id: string; plateNumber: string; serialNumber: string; project: string }[]>([]);
  const [vq, setVq] = useState('');
  const [opts, setOpts] = useState<{ _id: string; plateNumber: string; serialNumber: string; project: string; type?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ourCompany = companyKey === 'energize';
  useEffect(() => {
    if (!ourCompany) return undefined;
    const h = setTimeout(() => {
      api.get<{ items: any[] }>(`${API}/vehicles${vq.trim() ? `?q=${encodeURIComponent(vq.trim())}` : ''}`).then((d) => setOpts(d.items || [])).catch(() => {});
    }, 250);
    return () => clearTimeout(h);
  }, [vq, ourCompany]);
  const toggle = (v: any) => setPicked((p) => (p.some((x) => x._id === v._id) ? p.filter((x) => x._id !== v._id) : [...p, v]));
  const submit = async () => {
    const miss = [!adName.trim() && t('اسم الإعلان', 'Ad name'), !companyKey && t('الشركة', 'Company'), ourCompany && !picked.length && t('المركبات', 'Vehicles'), !mediaType && t('صور أم فيديو', 'Photo or video'), !location && t('بالإيواء أم بالطريق', 'Shelter or road')].filter(Boolean);
    if (miss.length) { notify(`${t('أكمل', 'Complete')}: ${miss.join('، ')}`, 'error'); return; }
    setBusy(true);
    try {
      const d = await api.post<{ item: Full }>(API, { adName: adName.trim(), companyKey, mediaType, location, note: note.trim(), neededBy, vehicleIds: ourCompany ? picked.map((x) => x._id) : [] });
      notify(t(`أُرسل الطلب ${d.item.ref}`, `Request ${d.item.ref} sent`), 'success');
      onCreated(d.item._id);
    } catch (e: any) { notify(e?.message || t('تعذّر الإرسال', 'Failed'), 'error'); }
    setBusy(false);
  };
  const choice = (on: boolean) => `flex-1 rounded-xl border-2 px-3 py-3 text-center text-sm font-bold transition ${on ? 'border-[#f37121] bg-[#f37121]/5 text-[#b4471a]' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
          <Clapperboard className="h-4 w-4 text-[#f37121]" /><h3 className="font-bold text-slate-900">{t('طلب محتوى إعلاني', 'Ad content request')}</h3>
          <button type="button" onClick={onClose} className="ms-auto text-slate-400 hover:text-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('اسم الإعلان *', 'Ad name *')}</span>
            <input value={adName} onChange={(e) => setAdName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>
          <div><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('الطلب لأيّ شركة؟ *', 'For which company? *')}</span>
            <div className="flex flex-wrap gap-2">{meta.companies.map((c) => (
              <button key={c.key} type="button" onClick={() => { setCompanyKey(c.key); if (c.key !== 'energize') setPicked([]); }} className={choice(companyKey === c.key)}>{ar ? c.nameAr : c.nameEn}</button>
            ))}</div></div>
          {ourCompany && (
            <div><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('المركبات *', 'Vehicles *')} <span className="font-normal text-slate-400">({picked.length})</span></span>
              {!!picked.length && <div className="mb-2 flex flex-wrap gap-1.5">{picked.map((v) => (
                <span key={v._id} className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[12px] font-semibold text-white">{v.plateNumber || v.serialNumber}<button type="button" onClick={() => toggle(v)}><X className="h-3 w-3" /></button></span>
              ))}</div>}
              <div className="relative"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder={t('ابحث باللوحة أو التسلسلي أو المشروع…', 'Search plate, serial or project…')} className="w-full rounded-lg border border-slate-200 py-2 pe-3 ps-9 text-sm" /></div>
              <div className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {opts.map((v) => { const on = picked.some((x) => x._id === v._id); return (
                  <button key={v._id} type="button" onClick={() => toggle(v)} className={`flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] ${on ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="font-semibold text-slate-800">{v.plateNumber || '—'}</span>
                    <span className="text-slate-500">{[v.serialNumber && `#${v.serialNumber}`, v.project, v.type].filter(Boolean).join(' · ')}</span>
                  </button>); })}
                {!opts.length && <p className="py-4 text-center text-[12.5px] text-slate-400">{t('لا نتائج', 'No matches')}</p>}
              </div></div>
          )}
          <div><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('المطلوب *', 'Needed *')}</span>
            <div className="flex gap-2">{meta.mediaType.map((m) => <button key={m.key} type="button" onClick={() => setMediaType(m.key)} className={choice(mediaType === m.key)}>{m.key === 'video' ? <Video className="me-1 inline h-4 w-4" /> : <Camera className="me-1 inline h-4 w-4" />}{ar ? m.ar : m.en}</button>)}</div></div>
          <div><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('مكان التصوير *', 'Where *')}</span>
            <div className="flex gap-2">{meta.location.map((m) => <button key={m.key} type="button" onClick={() => setLocation(m.key)} className={choice(location === m.key)}>{ar ? m.ar : m.en}</button>)}</div></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('ملاحظة (اختياري)', 'Note (optional)')}</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('التاريخ (اختياري)', 'Date (optional)')}</span>
              <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}{t('إرسال الطلب', 'Send request')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── الطلبُ مفتوحًا ───────────────────────────────────────────────────────────
function Detail({ id, ar, onClose, onChanged, notify, confirm, prompt }: {
  id: string; ar: boolean; onClose: () => void; onChanged: () => void;
  notify: (m: string, k?: any) => void; confirm: (o: any) => Promise<boolean>; prompt: (o: any) => Promise<string | null>;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [d, setD] = useState<Full | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [can, setCan] = useState<Can | null>(null);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<{ files: AdFile[]; i: number } | null>(null);
  const [reply, setReply] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const load = useCallback(async () => {
    try { const r = await api.get<{ item: Full; meta: Meta; can: Can }>(`${API}/${id}`); setD(r.item); setMeta(r.meta); setCan(r.can); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); onClose(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('mediago:ad', useCallback((p: any) => { if (!p?.id || p.id === id) { if (p?.action === 'deleted') onClose(); else load(); } }, [id, load, onClose]));
  const after = (item: Full) => { setD(item); onChanged(); };
  const V = (g: 'mediaType' | 'location' | 'status', k: string) => { const x = meta?.[g].find((v) => v.key === k); return x ? (ar ? x.ar : x.en) : k; };
  const editable = !!d && ['new', 'in_progress'].includes(d.status);

  const upload = async (url: string, list: FileList | null, want: 'photo' | 'video', key: string) => {
    if (!list || !list.length) return;
    const files: { dataUrl: string; fileName: string; durationSec?: number }[] = [];
    for (const file of Array.from(list)) {
      const isVid = file.type.startsWith('video/');
      if (want === 'photo' && isVid) { notify(t('المطلوب صور لهذه المركبة', 'Photos are required here'), 'error'); return; }
      if (want === 'video' && !isVid) { notify(t('المطلوب فيديو لهذه المركبة', 'A video is required here'), 'error'); return; }
      let durationSec: number | undefined;
      if (isVid) {
        durationSec = await videoDuration(file);
        if (durationSec > MAX_VIDEO_SEC + 0.5) { notify(t(`المقطع ${Math.round(durationSec)} ثانية — الحدّ ${MAX_VIDEO_SEC} ثانية`, `Video is ${Math.round(durationSec)}s — max ${MAX_VIDEO_SEC}s`), 'error'); return; }
        if (file.size > 15 * 1024 * 1024) { notify(t('المقطع أكبر من 15 ميغا', 'Video over 15 MB'), 'error'); return; }
      } else if (file.size > 8 * 1024 * 1024) { notify(t('الصورة أكبر من 8 ميغا', 'Image over 8 MB'), 'error'); return; }
      files.push({ dataUrl: await readFile(file), fileName: file.name, durationSec });
    }
    setBusy(key);
    try { after((await api.post<{ item: Full }>(url, { files })).item); }
    catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy('');
  };
  const removeFile = async (url: string) => {
    if (!(await confirm({ message: t('حذف هذا الملف؟', 'Delete this file?'), tone: 'danger', confirmLabel: t('حذف', 'Delete') }))) return;
    try { after((await api.delete<{ item: Full }>(url)).item); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };
  const patchItem = async (it: AdItem, body: any) => {
    setBusy(`i:${it._id}`);
    try { after((await api.patch<{ item: Full }>(`${API}/${id}/items/${it._id}`, body)).item); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const deliver = async () => {
    const note = await prompt({ title: t('تمّ — إرسال المحتوى إلى Media Go', 'Done — send to Media Go'), message: t('ملاحظة مع التسليم (اختياري)', 'A note with the delivery (optional)'), confirmLabel: t('إرسال', 'Send') });
    if (note === null) return;
    setBusy('deliver');
    try { after((await api.post<{ item: Full }>(`${API}/${id}/deliver`, { note })).item); notify(t('وصل المحتوى إلى Media Go', 'Delivered to Media Go'), 'success'); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const setStatus = async (status: string, needNote: boolean) => {
    const note = needNote ? await prompt({ title: V('status', status), message: t('السبب', 'Reason'), confirmLabel: t('تأكيد', 'Confirm') }) : '';
    if (note === null || (needNote && !String(note).trim())) return;
    setBusy(`s:${status}`);
    try { after((await api.patch<{ item: Full }>(`${API}/${id}/status`, { status, note })).item); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy('reply');
    try { after((await api.post<{ item: Full }>(`${API}/${id}/replies`, { text: reply.trim() })).item); setReply(''); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy('');
  };
  const remove = async () => {
    if (!(await confirm({ message: t('حذف الطلب نهائيًّا مع ملفّاته؟', 'Delete the request and its files permanently?'), tone: 'danger', confirmLabel: t('حذف', 'Delete') }))) return;
    try { await api.delete(`${API}/${id}`); onChanged(); onClose(); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  const allReady = !!d && (d.items.length ? d.items.every((i) => i.ready) : d.files.length > 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-5" onClick={onClose}>
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-start gap-3 bg-slate-900 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-slate-400">{d ? `${fmtDT(d.createdAt)} · ${d.createdByName}` : ''}</p>
            <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-[19px] font-extrabold">
              <span>{d?.adName || '…'}</span><span dir="ltr" className="text-[13px] font-semibold text-slate-400">{d?.ref}</span>
              {d && <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${STATUS_TONE[d.status] || ''}`}>{V('status', d.status)}</span>}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {d && can?.deliver && editable && (
              <button type="button" onClick={deliver} disabled={!allReady || busy === 'deliver'} title={!allReady ? t('راجع كل المركبات وعلّمها «جاهزة» أوّلًا', 'Mark every vehicle ready first') : ''}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-bold hover:bg-emerald-700 disabled:opacity-40">
                {busy === 'deliver' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{t('تمّ — إرسال إلى Media Go', 'Done — send to Media Go')}
              </button>
            )}
            {d && can?.close && d.status === 'delivered' && <button type="button" onClick={() => setStatus('closed', false)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-white/20"><Lock className="h-3.5 w-3.5" />{t('إغلاق', 'Close')}</button>}
            {d && can?.close && ['delivered', 'closed'].includes(d.status) && <button type="button" onClick={() => setStatus('in_progress', true)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-white/20"><RotateCcw className="h-3.5 w-3.5" />{t('إعادة فتح', 'Reopen')}</button>}
            {d && can?.cancel && editable && <button type="button" onClick={() => setStatus('cancelled', false)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-red-200 hover:bg-red-500/80 hover:text-white"><Ban className="h-3.5 w-3.5" />{t('إلغاء الطلب', 'Cancel request')}</button>}
            {d && can?.delete && <button type="button" onClick={remove} className="rounded-lg p-1.5 text-slate-300 hover:bg-red-500/80 hover:text-white" title={t('حذف', 'Delete')}><Trash2 className="h-4 w-4" /></button>}
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
          </div>
        </div>
        {!d ? <div className="flex flex-1 items-center justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {/* البطاقاتُ أوّلًا */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
              {[
                [t('الشركة', 'Company'), d.company], [t('المطلوب', 'Needed'), V('mediaType', d.mediaType)], [t('المكان', 'Where'), V('location', d.location)],
                [t('التاريخ', 'Date'), d.neededBy ? d.neededBy.split('-').reverse().join('/') : '—'],
                [t('المركبات', 'Vehicles'), d.items.length ? `${d.items.filter((i) => i.ready).length}/${d.items.length} ${t('جاهزة', 'ready')}` : '—'],
                [t('سُلِّم', 'Delivered'), d.deliveredAt ? fmtDate(d.deliveredAt) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11.5px] font-semibold text-slate-500">{k}</p><p className="mt-0.5 text-[13.5px] font-bold text-slate-900">{v}</p></div>
              ))}
            </div>
            {d.note && <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700"><b>{t('ملاحظة الطلب', 'Request note')}:</b> {d.note}</p>}

            {/* المركباتُ وتحقّقُها */}
            {d.items.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.items.map((it) => (
                  <div key={it._id} className={`rounded-xl border bg-white p-3 ${it.ready ? 'border-emerald-300' : 'border-slate-200'}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold text-slate-900"><Car className="me-1 inline h-4 w-4 text-slate-400" />{it.plateNumber || '—'}</p>
                        <p className="text-[11.5px] text-slate-500">{[it.serialNumber && `#${it.serialNumber}`, it.project].filter(Boolean).join(' · ')}</p>
                      </div>
                      {it.ready
                        ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />{t('جاهزة', 'Ready')}</span>
                        : <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-500">{it.files.length ? t('بانتظار المراجعة', 'To review') : t('لم تُصوَّر', 'Not shot')}</span>}
                    </div>
                    {can?.shoot && editable && (
                      <div className="mb-2 flex items-center gap-1.5 text-[12px]">
                        <span className="text-slate-500">{t('التحقق', 'Verify')}:</span>
                        {(['photo', 'video'] as const).map((m) => (
                          <button key={m} type="button" disabled={!!it.files.length && it.mediaType !== m} onClick={() => it.mediaType !== m && patchItem(it, { mediaType: m })}
                            className={`rounded-md px-2 py-1 font-semibold ${it.mediaType === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 disabled:opacity-40'}`}>
                            {m === 'video' ? <Video className="me-1 inline h-3 w-3" /> : <Camera className="me-1 inline h-3 w-3" />}{V('mediaType', m)}
                          </button>
                        ))}
                      </div>
                    )}
                    {it.files.length ? <Thumbs files={it.files} onOpen={(i) => setView({ files: it.files, i })} onRemove={can?.shoot && editable ? (f) => removeFile(`${API}/${id}/items/${it._id}/files/${f._id}`) : undefined} />
                      : <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-[12px] text-slate-400">{can?.partner ? t('لم يُصوَّر بعد', 'Not shot yet') : t('لا ملفات بعد', 'No files yet')}</p>}
                    {can?.shoot && editable && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <input ref={(el) => { inputs.current[it._id] = el; }} type="file" hidden multiple={it.mediaType === 'photo'}
                          accept={it.mediaType === 'video' ? 'video/*' : 'image/*'} capture="environment"
                          onChange={(e) => { upload(`${API}/${id}/items/${it._id}/files`, e.target.files, it.mediaType, `u:${it._id}`); e.target.value = ''; }} />
                        <button type="button" onClick={() => inputs.current[it._id]?.click()} disabled={busy === `u:${it._id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#f37121]/10 px-2.5 py-1.5 text-[12px] font-bold text-[#b4471a] hover:bg-[#f37121]/20">
                          {busy === `u:${it._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : it.mediaType === 'video' ? <Video className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                          {it.mediaType === 'video' ? t(`تصوير / رفع فيديو (≤${MAX_VIDEO_SEC} ث)`, `Shoot / upload video (≤${MAX_VIDEO_SEC}s)`) : t('تصوير / رفع صور', 'Shoot / upload photos')}
                        </button>
                        {!!it.files.length && (
                          <button type="button" onClick={() => patchItem(it, { ready: !it.ready })} disabled={busy === `i:${it._id}`}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold ${it.ready ? 'bg-slate-100 text-slate-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                            <Check className="h-3.5 w-3.5" />{it.ready ? t('إلغاء «جاهزة»', 'Unmark ready') : t('راجعتُها — جاهزة', 'Reviewed — ready')}
                          </button>
                        )}
                      </div>
                    )}
                    {it.ready && it.readyByName && <p className="mt-1.5 text-[11px] text-slate-400">{t('راجعها', 'Reviewed by')} {it.readyByName} · {fmtDT(it.readyAt)}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* طلبٌ بلا مركبات: ملفّاتُه */}
            {!d.items.length && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('المحتوى', 'Content')} ({d.files.length})</p>
                {d.files.length ? <Thumbs files={d.files} onOpen={(i) => setView({ files: d.files, i })} onRemove={can?.shoot && editable ? (f) => removeFile(`${API}/${id}/files/${f._id}`) : undefined} />
                  : <p className="py-4 text-center text-[12px] text-slate-400">{t('لا ملفات بعد', 'No files yet')}</p>}
                {can?.shoot && editable && (
                  <div className="mt-2">
                    <input ref={(el) => { inputs.current.req = el; }} type="file" hidden multiple={d.mediaType === 'photo'} accept={d.mediaType === 'video' ? 'video/*' : 'image/*'} capture="environment"
                      onChange={(e) => { upload(`${API}/${id}/files`, e.target.files, d.mediaType, 'u:req'); e.target.value = ''; }} />
                    <button type="button" onClick={() => inputs.current.req?.click()} className="inline-flex items-center gap-1 rounded-lg bg-[#f37121]/10 px-2.5 py-1.5 text-[12px] font-bold text-[#b4471a]">
                      {busy === 'u:req' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}{t('تصوير / رفع', 'Shoot / upload')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* الملاحظاتُ والمسار */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-3">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('الملاحظات', 'Notes')} ({d.replies.length})</p>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {d.replies.map((r) => {
                    const mine = (r.side === 'mediago') === !!can?.partner;
                    return (
                      <div key={r._id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${r.side === 'mediago' ? 'bg-violet-50 ring-1 ring-violet-100' : 'bg-orange-50 ring-1 ring-orange-100'}`}>
                          <p className="text-[10.5px] font-bold text-slate-500">{r.side === 'mediago' ? 'Media Go' : 'Energize'}{r.byName ? ` · ${r.byName}` : ''}</p>
                          <p className="whitespace-pre-wrap text-[13px]" dir="auto">{r.text}</p>
                          <p className="text-[10px] text-slate-400">{fmtDT(r.at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {!d.replies.length && <p className="text-[12.5px] text-slate-400">{t('لا ملاحظات بعد', 'No notes yet')}</p>}
                </div>
                <div className="mt-2 flex items-end gap-2 border-t border-slate-100 pt-2">
                  <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} dir="auto" placeholder={t('اكتب ملاحظة…', 'Write a note…')}
                    className="min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                  <button type="button" onClick={sendReply} disabled={!reply.trim() || busy === 'reply'} className="inline-flex h-10 items-center rounded-xl bg-[#f37121] px-3 text-white disabled:opacity-50">
                    {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-2">
                <p className="mb-2 text-[13px] font-bold text-slate-800">{t('مسار الطلب', 'Timeline')}</p>
                <ol className="space-y-2 border-s-2 border-slate-100 ps-3">
                  {d.statusHistory.map((h, i) => (
                    <li key={i}>
                      <p className="text-[12.5px] font-bold text-slate-800">{V('status', h.status)}</p>
                      <p className="text-[11px] text-slate-500">{h.side === 'mediago' ? 'Media Go' : 'Energize'}{h.byName ? ` · ${h.byName}` : ''} · {fmtDT(h.at)}</p>
                      {h.note && <p className="text-[12px] text-slate-600">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
      {view && <Lightbox files={view.files} index={view.i} onClose={() => setView(null)} onIndex={(i) => setView((v) => (v ? { ...v, i } : v))} />}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><AdContentInner /></Suspense>;
}
