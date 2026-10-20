'use client';
/**
 * شكاوى Media Go — بلاغاتُ أعطال الشاشات المركَّبة على دبّاباتنا.
 *
 * شاشةٌ واحدةٌ لطرفين:
 *   • قسمُ الأفراد يرفع البلاغَ بأسئلة نموذج Media Go نفسِها، ويتابعه ويغلقه.
 *   • حسابُ Media Go (`mediago_account`) لا يرى من نظامنا غيرَ هذه الصفحة: يجد
 *     البلاغاتِ بلغتين، ويقول «قيد المعالجة» ثمّ «تمّ الإصلاح»، ويردّ.
 * وحدودُ كلّ طرفٍ يحسمها الخادم ويقولها في `can` — والشاشةُ تعرض ما يُسمح به.
 *
 * والبطاقاتُ تُعَدّ بكلّ الفلاتر إلّا فلترِ الحالة، فلا تقفز تحت الضغطة.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, StatCard } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  MEDIAGO_API, MEDIAGO_ROLE, STATUS_TONE, availabilityText, fmtDateTime, issueText, vocabLabel,
  type MgList, type MgRow,
} from '@/lib/mediago';
import { Bi, ComplaintDetailModal, CreateComplaintModal, StatusPill, makeTx, type Mode } from '@/components/b2c/MediaGoKit';
import { MonitorPlay, Plus, Search, Film, Image as ImageIcon, MessageCircle, MapPin, Clock, Bike, X, Lock } from 'lucide-react';

type Filters = { status: string; issue: string; location: string; availability: string; from: string; to: string };
const NO_FILTERS: Filters = { status: '', issue: '', location: '', availability: '', from: '', to: '' };

// ── بطاقةُ البلاغ لشاشة الشريك — مكوّنٌ في مستوى الملفّ ──
function ComplaintCard({ r, data, mode, onOpen }: { r: MgRow; data: MgList; mode: Mode; onOpen: () => void }) {
  const ar = mode !== 'en';
  const tone = STATUS_TONE[r.status] || STATUS_TONE.closed;
  return (
    <button type="button" onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-start shadow-sm transition hover:-translate-y-0.5 hover:border-[#f37121]/50 hover:shadow-lg">
      <div className="relative h-36 w-full overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900">
        {r.cover
          ? <img src={r.cover} alt="" className="h-full w-full object-cover opacity-95 transition group-hover:scale-105" />
          : <div className="flex h-full w-full items-center justify-center text-white/40"><MonitorPlay className="h-10 w-10" /></div>}
        <span className={`absolute start-0 top-0 h-full w-1.5 ${tone.dot}`} />
        <span className="absolute end-2 top-2"><StatusPill status={r.status} meta={data.meta} mode={mode} /></span>
        <span className="absolute bottom-2 start-3 rounded-md bg-black/55 px-2 py-0.5 text-[12px] font-extrabold tracking-wide text-white" dir="ltr">{r.ref}</span>
        <span className="absolute bottom-2 end-2 flex gap-1">
          {r.fileCount > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white"><ImageIcon className="h-3 w-3" />{r.fileCount}</span>}
          {r.hasVideo && <span className="inline-flex items-center rounded-md bg-black/55 px-1.5 py-0.5 text-white"><Film className="h-3 w-3" /></span>}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="text-[14px] font-bold leading-snug text-slate-900">{issueText(data.meta, r, 'ar')}</p>
        {r.issue !== 'other' && <p className="-mt-1.5 text-[11.5px] text-slate-500" dir="ltr">{issueText(data.meta, r, 'en')}</p>}
        <div className="mt-auto grid grid-cols-2 gap-x-2 gap-y-1 text-[11.5px] text-slate-600">
          <span className="inline-flex items-center gap-1 truncate"><Bike className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate font-semibold" dir="auto">{r.motorcycleNumber}</span></span>
          <span className="inline-flex items-center gap-1 truncate"><MonitorPlay className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{r.screenNumber || '—'}</span></span>
          <span className="inline-flex items-center gap-1 truncate"><Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate" dir="ltr">{availabilityText(data.meta, r, 'en')}</span></span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          <span>{fmtDateTime(r.createdAt, ar)}</span>
          {r.replyCount > 0 && <span className="inline-flex items-center gap-1 font-semibold text-violet-600"><MessageCircle className="h-3.5 w-3.5" />{r.replyCount}</span>}
        </div>
      </div>
    </button>
  );
}

export default function MediaGoComplaintsPage() {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<MgList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string>('');

  // الإشعارُ يفتح البلاغَ بمعرّفه في الرابط (lib/notificationLink).
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('id');
      if (id && /^[0-9a-f]{24}$/i.test(id)) {
        // حسابُ Media Go يقرأ البلاغَ صفحةً؛ وموظّفونا في النافذة.
        if (String(user?.role || '') === MEDIAGO_ROLE) router.replace(`/system/b2c/mediago-complaints/${id}`);
        else setOpenId(id);
      }
    } catch (_) { /* */ }
  }, [user?.role, router]);
  useEffect(() => { const h = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    const p = new URLSearchParams();
    if (qd) p.set('q', qd);
    (Object.keys(f) as (keyof Filters)[]).forEach((k) => { if (f[k]) p.set(k, f[k]); });
    try {
      const res = await api.get<MgList>(`${MEDIAGO_API}${p.toString() ? `?${p}` : ''}`);
      if (!guard.isCurrent(mine)) return;
      setData(res); setFailed(''); setForbidden(false);
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      if (e?.status === 403) setForbidden(true); else setFailed(e?.message || 'Failed');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  }, [qd, f, guard]);
  useEffect(() => { load(); }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(), 400); }, [load]);
  useSocket('mediago:complaint', soon);

  const partner = data ? data.can.partner : String(user?.role || '') === MEDIAGO_ROLE;
  const mode: Mode = partner ? 'partner' : (lang === 'ar' ? 'ar' : 'en');
  const tx = useMemo(() => makeTx(mode), [mode]);
  const ar = lang === 'ar';

  const setFilter = (k: keyof Filters, v: string) => setF((o) => ({ ...o, [k]: o[k] === v && k === 'status' ? '' : v }));
  const anyFilter = !!qd || Object.values(f).some(Boolean);

  const exportCols: ExportColumn[] = useMemo(() => {
    const L = (a: string, e: string) => (partner ? `${a} / ${e}` : ar ? a : e);
    const vl = partner ? 'both' : (ar ? 'ar' : 'en');
    const meta = data?.meta;
    return [
      { header: L('المرجع', 'Ref'), key: 'ref' },
      { header: L('التاريخ', 'Date'), key: 'createdAt', type: 'date' },
      { header: L('رقم الدبّاب', 'Motorcycle'), key: 'motorcycleNumber' },
      { header: L('الرقم التسلسلي', 'Serial'), key: 'serialNumber' },
      { header: L('المشروع', 'Project'), key: 'project' },
      { header: L('رقم الشاشة', 'Screen'), key: 'screenNumber' },
      { header: L('المشكلة', 'Issue'), key: 'issue', transform: (_v: string, r: MgRow) => issueText(meta, r, vl) },
      { header: L('موقع الصيانة', 'Location'), key: 'location', transform: (v: string) => vocabLabel(meta, 'location', v, vl) },
      { header: L('وقت التوفّر', 'Availability'), key: 'availability', transform: (_v: string, r: MgRow) => availabilityText(meta, r, vl) },
      { header: L('الحالة', 'Status'), key: 'status', transform: (v: string) => vocabLabel(meta, 'status', v, vl) },
      { header: L('تاريخ الإصلاح', 'Fixed at'), key: 'fixedAt', type: 'date' },
      { header: L('المرفقات', 'Files'), key: 'fileCount', type: 'number' },
      { header: L('الردود', 'Replies'), key: 'replyCount', type: 'number' },
      { header: L('رُفع بواسطة', 'Reported by'), key: 'createdByName' },
    ];
  }, [data?.meta, partner, ar]);

  if (loading && !data) return <Spinner />;
  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <Lock className="h-8 w-8 text-slate-400" />
        <p className="text-[15px] font-semibold text-slate-700">{tx('هذه الصفحة لقسم الأفراد وحساب Media Go', 'This page is for the B2C section and the Media Go account')}</p>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-slate-500">{failed || tx('تعذّر التحميل', 'Could not load')}</div>;

  const sc = data.counts.status || {};
  const optCount = (g: 'issue' | 'location' | 'availability', k: string) => data.counts[g]?.[k] || 0;
  const vl = partner ? 'both' : (ar ? 'ar' : 'en');

  return (
    <div className="w-full space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* الرأس — للشريك لافتةٌ تحمل الاسمين، ولنا رأسُ القسم */}
      {/* بلون الشريط الجانبيّ نفسِه (slate-900) — والبرتقاليُّ وحدَه للإبراز. */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-md">
        <div className="pointer-events-none absolute -end-10 -top-16 h-48 w-48 rounded-full bg-[#f37121]/25 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="rounded-2xl bg-white/15 p-3"><MonitorPlay className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            {partner ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/60" dir="ltr">Energize × Media Go</p>
                <h1 className="text-[21px] font-extrabold leading-tight">بلاغات أعطال الشاشات</h1>
                <p className="text-[13px] text-white/75" dir="ltr">Screen fault reports from the Energize fleet</p>
              </>
            ) : (
              <>
                <h1 className="text-[21px] font-extrabold leading-tight">{tx('شكاوى Media Go', 'Media Go Complaints')}</h1>
                <p className="text-[13px] text-white/75">{tx('بلاغات أعطال شاشات Media Go على الدبّابات — تُرفع من هنا ويراها حساب Media Go ويردّ عليها', 'Screen fault reports on our motorcycles — Media Go sees, updates and replies to them')}</p>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu fileName="mediago-complaints" lang={ar ? 'ar' : 'en'} variant="subtle"
              label={tx('تصدير Excel', 'Export Excel')}
              options={[
                { key: 'shown', label: tx('المعروض', 'Shown'), sheets: [{ name: 'Media Go', rows: data.items, columns: exportCols }] },
              ]} />
            {data.can.create && (
              <button type="button" onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-[13px] font-bold text-white shadow-sm hover:bg-[#e0621a]">
                <Plus className="h-4 w-4" />{tx('بلاغ جديد', 'New complaint')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* البطاقات — تُعَدّ بلا فلتر الحالة */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label={tx('الكل', 'All')} value={data.grandTotal} onClick={() => setF((o) => ({ ...o, status: '' }))} active={!f.status} />
        {data.meta.status.map((s) => (
          <StatCard key={s.key} label={partner ? `${s.ar} / ${s.en}` : (ar ? s.ar : s.en)} value={sc[s.key] || 0}
            accent={(STATUS_TONE[s.key] || STATUS_TONE.closed).accent} onClick={() => setFilter('status', s.key)} active={f.status === s.key} />
        ))}
      </div>

      {/* الفلاتر */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('ابحث بالمرجع أو الدبّاب أو الشاشة', 'Search ref, motorcycle or screen')}
            className="w-72 max-w-full rounded-lg border border-slate-200 bg-white py-2 pe-3 ps-8 text-sm" />
        </div>
        <select value={f.issue} onChange={(e) => setFilter('issue', e.target.value)} className="max-w-[16rem] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{tx('كل المشاكل', 'All issues')}</option>
          {data.meta.issue.map((o) => <option key={o.key} value={o.key}>{vocabLabel(data.meta, 'issue', o.key, vl)} ({optCount('issue', o.key)})</option>)}
        </select>
        <select value={f.availability} onChange={(e) => setFilter('availability', e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm">
          <option value="">{tx('كل الأوقات', 'Any time')}</option>
          {data.meta.availability.map((o) => <option key={o.key} value={o.key}>{vocabLabel(data.meta, 'availability', o.key, vl)} ({optCount('availability', o.key)})</option>)}
        </select>
        <label className="inline-flex items-center gap-1 text-[12px] text-slate-500">{tx('من', 'From')}
          <input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="inline-flex items-center gap-1 text-[12px] text-slate-500">{tx('إلى', 'To')}
          <input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        {anyFilter && (
          <button type="button" onClick={() => { setF(NO_FILTERS); setQ(''); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">
            <X className="h-3.5 w-3.5" />{tx('مسح الفلاتر', 'Clear')}
          </button>
        )}
        <span className="ms-auto text-[12.5px] font-semibold text-slate-600">{data.total} {tx('بلاغ', 'complaints')}</span>
      </div>

      {/* القائمة — بطاقاتٌ للشريك، وجدولٌ لنا */}
      {!data.items.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <MonitorPlay className="mx-auto mb-2 h-10 w-10 text-slate-300" />
          <p className="font-semibold text-slate-600"><Bi ar={anyFilter ? 'لا بلاغات مطابقة' : 'لا بلاغات بعد'} en={anyFilter ? 'No matching complaints' : 'No complaints yet'} mode={mode} /></p>
        </div>
      ) : partner ? (
        // حسابُ Media Go يفتح البلاغَ صفحةً كاملة لا نافذة.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((r) => <ComplaintCard key={r._id} r={r} data={data} mode={mode} onOpen={() => router.push(`/system/b2c/mediago-complaints/${r._id}`)} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <ScrollX>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-900 text-[12.5px] text-slate-200">
                <tr>
                  <th className="px-3 py-2.5 text-start">{tx('المرجع', 'Ref')}</th>
                  <th className="px-3 py-2.5 text-start">{tx('رقم الدبّاب', 'Motorcycle')}</th>
                  <th className="px-3 py-2.5 text-start">{tx('الشاشة', 'Screen')}</th>
                  <th className="px-3 py-2.5 text-start">{tx('المشكلة', 'Issue')}</th>
                  <th className="px-3 py-2.5 text-start">{tx('وقت التوفّر', 'Available')}</th>
                  <th className="px-3 py-2.5">{tx('الحالة', 'Status')}</th>
                  <th className="px-3 py-2.5">{tx('مرفقات', 'Files')}</th>
                  <th className="px-3 py-2.5">{tx('ردود', 'Replies')}</th>
                  <th className="px-3 py-2.5 text-start">{tx('التاريخ', 'Date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r._id} onClick={() => setOpenId(r._id)} className="cursor-pointer hover:bg-orange-50/40">
                    <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-900" dir="ltr">{r.ref}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">
                      <span dir="auto">{r.motorcycleNumber}</span>
                      {r.project && <span className="ms-1.5 text-[11px] font-normal text-slate-400">{r.project}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.screenNumber || '—'}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2 text-slate-800" title={issueText(data.meta, r, vl)}>{issueText(data.meta, r, vl)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{availabilityText(data.meta, r, vl)}</td>
                    <td className="px-3 py-2 text-center"><StatusPill status={r.status} meta={data.meta} mode={mode} /></td>
                    <td className="px-3 py-2 text-center text-slate-600">
                      <span className="inline-flex items-center gap-1">{r.fileCount}{r.hasVideo && <Film className="h-3.5 w-3.5 text-slate-400" />}</span>
                    </td>
                    <td className={`px-3 py-2 text-center font-semibold ${r.replyCount ? 'text-violet-600' : 'text-slate-300'}`}>{r.replyCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[12px] text-slate-500">{fmtDateTime(r.createdAt, ar)}<span className="block text-[11px] text-slate-400">{r.createdByName}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {/* بعد الرفع تُحدَّث القائمةُ ولا يُفتَح شيء — التفصيلُ بضغطةٍ على البلاغ وحدَها. */}
      <CreateComplaintModal open={creating} onClose={() => setCreating(false)} meta={data.meta} tx={tx} ar={mode !== 'en'}
        onCreated={() => { setCreating(false); load(); }} />
      {openId && <ComplaintDetailModal id={openId} mode={mode} onClose={() => setOpenId('')} onChanged={soon} />}
    </div>
  );
}
