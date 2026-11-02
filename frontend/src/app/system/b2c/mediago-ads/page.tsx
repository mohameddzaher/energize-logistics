'use client';
/**
 * Advertising content: a page shared between us and Media Go.
 * Media Go requests an ad shoot: its name, for which company (from department settings), light-transport vehicles if it is ours, photos or video, at shelter or on the road, plus an optional note and date. We shoot each vehicle's verification (photos or video up to 15 seconds), review it and mark it ready, then done, and it reaches Media Go in its records vehicle by vehicle; it may reply with a note. All logic is server-side (controllers/mediagoAdController).
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import {
  Clapperboard, Plus, X, Search, Camera, Video, Loader2, Send,
  MapPin, Building2, RotateCcw, Check,
} from 'lucide-react';

import { API, STATUS_TONE, fmtDT, type Meta, type Full, type ListRes } from '@/components/b2c/MediaGoAdKit';

function AdContentInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const router = useRouter(); const sp = useSearchParams();
  const [data, setData] = useState<ListRes | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
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
  // Each request has its own page; old notification links (?id=) are redirected to it.
  const open = (id: string) => router.push(`/system/b2c/mediago-ads/${id}`);
  useEffect(() => { const id = sp?.get('id'); if (id) router.replace(`/system/b2c/mediago-ads/${id}`); }, [sp, router]);

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

      {/* Statuses. */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map(([k, a, e]) => (
          <button key={k || 'all'} type="button" onClick={() => setF((p) => ({ ...p, status: k }))} className={chip((f.status || '') === k)}>
            {t(a, e)}<span className="tabular-nums opacity-70">{k ? (counts.status?.[k] || 0) : sum(counts.status)}</span>
          </button>
        ))}
      </div>

      {/* Filters. */}
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

      {/* Requests. */}
      {!data.items.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-500">
          <Clapperboard className="mx-auto mb-2 h-8 w-8 text-slate-300" />{t('لا طلبات هنا', 'No requests here')}
        </div>
      ) : (
        // A table, not cards: read row by row, and a click opens the request page.
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead className="bg-slate-900 text-[12px] text-slate-200">
              <tr>
                {[t('الطلب', 'Request'), t('الإعلان', 'Ad'), t('الشركة', 'Company'), t('المطلوب', 'Needed'), t('المكان', 'Where'), t('المركبات', 'Vehicles'), t('التاريخ المطلوب', 'Needed by'), t('الحالة', 'Status'), t('أُنشئ', 'Created')]
                  .map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-start font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <tr key={r._id} onClick={() => open(r._id)} className="cursor-pointer hover:bg-orange-50/50">
                  <td className="px-3 py-2.5 font-semibold text-slate-500" dir="ltr">{r.ref}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-slate-900">{r.adName}</p>
                    {r.note && <p className="max-w-[260px] truncate text-[11.5px] text-slate-500">{r.note}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{r.company}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">{r.mediaType === 'video' ? <Video className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}{V('mediaType', r.mediaType)}</span></td>
                  <td className="px-3 py-2.5 text-slate-700">{V('location', r.location)}</td>
                  <td className="px-3 py-2.5">
                    {r.vehicleCount ? (
                      <div className="min-w-[110px]">
                        <p className="text-[12px] tabular-nums text-slate-700">{r.readyCount}/{r.vehicleCount} {t('جاهزة', 'ready')}</p>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(r.readyCount / r.vehicleCount) * 100}%` }} /></div>
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.neededBy ? r.neededBy.split('-').reverse().join('/') : '—'}</td>
                  <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${STATUS_TONE[r.status] || ''}`}>{V('status', r.status)}</span>
                    {r.fileCount > 0 && <span className="ms-1.5 text-[11px] text-slate-400">{r.fileCount} {t('ملف', 'files')}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-slate-500">{fmtDT(r.createdAt)}<br />{r.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateModal ar={ar} meta={meta} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); open(id); }} />}
    </div>
  );
}

// New request.
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
                <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder={t('ابحث برقم المركبة…', 'Search vehicle number…')} className="w-full rounded-lg border border-slate-200 py-2 pe-3 ps-9 text-sm" /></div>
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

export default function Page() {
  return <Suspense fallback={<Spinner />}><AdContentInner /></Suspense>;
}
