'use client';
// حياةُ فردة كاوتش — لا موضعُها الحاليّ فقط.
//
// السؤال الذي تجيب عنه هذه الشاشة ليس «أين هي الآن» — ذاك سطرٌ في الجدول — بل:
// **كم عاشت، وعلى ماذا، وكم مشت.** فردةٌ عمرها سنتان على أربع عربيات ليست
// كفردةٍ عمرها سنتان على واحدة؛ والفرق لا يُقرأ إلّا من السجلّ مجموعًا.
//
// وفتراتُ التركيب تُبنى من سجلّ الحركة نفسه: كلُّ تركيبٍ يفتح فترة، وأوّلُ
// خروجٍ بعده يُغلقها. والمسافة = عدّاد العربية عند النزول ناقص عدّادها عند
// التركيب، يُقرآن من جدول العدّاد اليوميّ لا من لحظة الحدث — الحدث قد يُسجَّل
// بعد يومٍ من وقوعه فيحمل عدّادًا متأخّرًا.
//
// وما جرى للعربية **أثناء** وجود الفردة عليها منسوبٌ إلى الفردة: صيانةٌ ذلك
// اليوم كانت الفردة تحتها، وإصلاحٌ كذلك. وهذا هو الفرق بين سجلّ فردةٍ وسجلّ
// عربية، ولا يُعرف إلّا بمقاطعة التواريخ مع الفترات.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { tireStateDef, TIRE_STATES } from '@/lib/tireStates';
import {
  CircleDot, ArrowRight, Truck, Wrench, Gauge, CalendarDays, User, History,
  MapPin, AlertTriangle,
} from 'lucide-react';

interface Stint {
  plate: string | null; plateKey: string | null; position: string;
  from: string; to: string | null; endReason: string | null;
  odoStart: number | null; odoEnd: number | null;
  km: number | null; days: number | null; driver: string; current: boolean; inferred?: boolean;
}
interface Ev { _id: string; action: string; date: string; fromPlate: string | null; toPlate: string | null; fromPosition: string; toPosition: string; reason: string; notes: string; performedByName: string; odometerKm: number | null }
interface WhileOn { kind: 'repair' | 'service'; date: string; plate: string; title: string; detail: string; cost?: number | null; by: string }
interface Profile {
  tire: { _id: string; serial: string; tireNumber: string; type: string; size: string; sensor: string; status: string; condition: string; conditionPercent: number | null; plate: string | null; positionLabel: string; section: string; trailerNumber: string | null; isSpare: boolean; notes: string; createdAt: string };
  stints: Stint[]; events: Ev[]; whileOn: WhileOn[];
  totals: { stints: number; vehicles: number; km: number; days: number; mountedDays: number; repairs: number; services: number; ageDays: number };
}

const ACTION_AR: Record<string, string> = {
  registered: 'تسجيل', mounted: 'تركيب', removed: 'إنزال', transferred: 'نقل',
  to_repair: 'إلى التجديد', from_repair: 'عودة من التجديد', renewed: 'تجديد',
  scrapped: 'سكراب', damaged: 'تالفة', sold: 'بيع', retired: 'خارج الخدمة', updated: 'تعديل',
};
const END_AR: Record<string, string> = {
  removed: 'نزلت', transferred: 'نُقلت', to_repair: 'ذهبت للتجديد',
  scrapped: 'سكراب', damaged: 'تلفت', sold: 'بيعت', retired: 'خرجت',
};

const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const day = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

export default function TireProfilePage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [d, setD] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await api.get<Profile>(`/api/ls2/assets/tires/${id}/profile`)); }
    catch { /* keep */ } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  if (loading) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{t('الفردة غير موجودة', 'Tire not found')}</div>;

  const ti = d.tire;
  const st = tireStateDef(ti);
  const T = d.totals;

  const Stat = ({ label, value, icon, tone }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: string }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[11.5px] font-bold text-slate-500 flex items-center gap-1.5">
        <span className="text-slate-400" style={tone ? { color: tone } : undefined}>{icon}</span>{label}
      </p>
      <p className="text-[19px] font-extrabold text-slate-900 mt-1 tabular-nums leading-none">{value}</p>
    </div>
  );

  const stintRows = d.stints.map((s) => ({
    plate: s.plate || '—', position: s.position || '—',
    from: day(s.from), to: s.to ? day(s.to) : (ar ? 'حتى الآن' : 'still on'),
    days: s.days ?? '', km: s.km ?? '',
    odoStart: s.odoStart ?? '', odoEnd: s.odoEnd ?? '',
    driver: s.driver || '', end: s.endReason ? (END_AR[s.endReason] || s.endReason) : '',
  }));

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── الترويسة ────────────────────────────────────────────────────── */}
      <header className="rounded-2xl bg-[#12325c] text-white shadow-lg overflow-hidden">
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <CircleDot className="w-6 h-6 text-[#f37121]" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight font-mono leading-none">{ti.serial}</h1>
              <p className="text-[12.5px] text-white/65 mt-1.5 truncate">
                {[ti.tireNumber && `${t('رقم', 'no.')} ${ti.tireNumber}`, ti.type, ti.size].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-[11.5px] font-extrabold ${st.chip}`}>{ar ? st.ar : st.en}</span>
            {ti.condition && (
              <span className="px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-white/15">
                {ti.condition === 'new' ? t('جديدة', 'New') : t('مستعملة', 'Used')}
                {ti.conditionPercent != null ? ` · ${ti.conditionPercent}%` : ''}
              </span>
            )}
            {ti.sensor === 'yes' && <span className="px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-white/15">{t('بحسّاس', 'Sensor')}</span>}
            <ExportMenu fileName={`tire-${ti.serial}`} lang={ar ? 'ar' : 'en'}
              options={[{
                key: 'life', label: t('سجلّ الفردة (Excel)', 'Tire log (Excel)'),
                sheets: [
                  { name: ar ? 'فترات التركيب' : 'Stints', rows: stintRows as any[], columns: [
                    { header: t('العربية', 'Vehicle'), key: 'plate', width: 14 },
                    { header: t('الموضع', 'Position'), key: 'position', width: 26 },
                    { header: t('من', 'From'), key: 'from', width: 12 },
                    { header: t('إلى', 'To'), key: 'to', width: 12 },
                    { header: t('الأيام', 'Days'), key: 'days', width: 8 },
                    { header: t('الكيلومترات', 'Km'), key: 'km', width: 12 },
                    { header: t('العدّاد عند التركيب', 'Odo at mount'), key: 'odoStart', width: 16 },
                    { header: t('العدّاد عند النزول', 'Odo at dismount'), key: 'odoEnd', width: 16 },
                    { header: t('السائق', 'Driver'), key: 'driver', width: 20 },
                    { header: t('سبب الخروج', 'End reason'), key: 'end', width: 14 },
                  ] },
                  { name: ar ? 'ما جرى وهي عليها' : 'While mounted', rows: d.whileOn as any[], columns: [
                    { header: t('التاريخ', 'Date'), key: 'date', transform: (v: any) => day(v), width: 12 },
                    { header: t('النوع', 'Kind'), key: 'kind', transform: (v: any) => (v === 'repair' ? t('إصلاح', 'Repair') : t('صيانة', 'Service')), width: 10 },
                    { header: t('العربية', 'Vehicle'), key: 'plate', width: 14 },
                    { header: t('البند', 'Title'), key: 'title', width: 26 },
                    { header: t('التفصيل', 'Detail'), key: 'detail', width: 40 },
                  ] },
                ],
              }]} />
            <button type="button" onClick={() => router.push('/system/ls2/fleet-assets')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium">
              <ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /> {t('رجوع', 'Back')}
            </button>
          </div>
        </div>
      </header>

      {/* ── مجمل حياتها ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <Stat label={t('عمرها', 'Age')} value={`${num(T.ageDays)} ${t('يوم', 'd')}`} icon={<CalendarDays className="w-3.5 h-3.5" />} />
        <Stat label={t('عربيات ركبت عليها', 'Vehicles')} value={T.vehicles} icon={<Truck className="w-3.5 h-3.5" />} />
        <Stat label={t('مرّات التركيب', 'Mounts')} value={T.stints} icon={<History className="w-3.5 h-3.5" />} />
        <Stat label={t('إجمالي الكيلومترات', 'Total km')} value={num(T.km)} icon={<Gauge className="w-3.5 h-3.5" />} tone="#f37121" />
        <Stat label={t('أيام على العربيات', 'Days mounted')} value={num(T.days)} icon={<CalendarDays className="w-3.5 h-3.5" />} />
        <Stat label={t('صيانات وهي عليها', 'Services while on')} value={T.services} icon={<Wrench className="w-3.5 h-3.5" />} />
        <Stat label={t('إصلاحات وهي عليها', 'Repairs while on')} value={T.repairs} icon={<AlertTriangle className="w-3.5 h-3.5" />} tone="#dc2626" />
      </div>

      {/* ── أين هي الآن ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5 mb-2">
          <MapPin className="w-4 h-4 text-slate-400" />{t('أين هي الآن', 'Where it is now')}
        </p>
        {ti.status === 'mounted' ? (
          <p className="text-[13.5px] text-slate-800">
            {t('مركَّبة على', 'Mounted on')}{' '}
            {ti.plate
              ? <Link href={`/system/ls2/vehicles?q=${encodeURIComponent(ti.plate)}`} className="font-mono font-bold text-[#f37121] hover:underline">{ti.plate}</Link>
              : <span className="font-mono font-bold">{ti.trailerNumber ? `${t('تيدر', 'trailer')} ${ti.trailerNumber}` : '—'}</span>}
            {ti.positionLabel && <span className="text-slate-500"> — {ti.positionLabel}{ti.section ? ` · ${ti.section}` : ''}</span>}
            {ti.isSpare && <span className="ms-2 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-[11px] font-bold">{t('استبن', 'Spare')}</span>}
          </p>
        ) : (
          <p className="text-[13.5px] text-slate-800">
            {t('غير مركَّبة —', 'Not mounted —')} <span className={`px-2 py-0.5 rounded font-bold ${st.chip}`}>{ar ? st.ar : st.en}</span>
            {TIRE_STATES.find((x) => x.key === st.key)?.inStore && <span className="text-slate-500 text-[12px]"> · {t('محسوبة ضمن المخزن', 'counted in store')}</span>}
          </p>
        )}
        {!!ti.notes && <p className="text-[12.5px] text-slate-500 mt-2 whitespace-pre-wrap">{ti.notes}</p>}
      </div>

      {/* ── فترات التركيب ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-slate-400" />{t('على أيّ عربيات كانت، وكم مشت', 'Which vehicles, and how far')}
          </p>
          <span className="text-[11.5px] text-slate-500">{t('الكيلومترات من عدّاد العربية عند التركيب والنزول', 'Km from the vehicle odometer at mount and dismount')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-100 text-slate-600 text-[11.5px]">
              <tr>{[t('العربية', 'Vehicle'), t('الموضع', 'Position'), t('من', 'From'), t('إلى', 'To'), t('المدّة', 'Duration'), t('الكيلومترات', 'Km'), t('العدّاد', 'Odometer'), t('السائق', 'Driver'), t('الخروج', 'End')]
                .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.stints.map((s, i) => (
                <tr key={i} className={`hover:bg-orange-50/40 ${s.current ? 'bg-emerald-50/50' : ''}`}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {s.plate
                      ? <Link href={`/system/ls2/vehicles?q=${encodeURIComponent(s.plate)}`} className="font-mono font-bold text-slate-900 hover:text-[#f37121]">{s.plate}</Link>
                      : <span className="text-slate-400">—</span>}
                    {s.current && <span className="ms-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">{t('الآن', 'now')}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-[12px]">{s.position || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{day(s.from)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{s.to ? day(s.to) : <span className="text-emerald-700 font-sans font-bold">{t('حتى الآن', 'still on')}</span>}</td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-900 whitespace-nowrap">{s.days != null ? `${num(s.days)} ${t('يوم', 'd')}` : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums font-extrabold text-[#f37121] whitespace-nowrap">{s.km != null ? num(s.km) : <span className="text-slate-300 font-normal">—</span>}</td>
                  <td className="px-3 py-2.5 tabular-nums text-[11.5px] text-slate-500 whitespace-nowrap">
                    {s.odoStart != null || s.odoEnd != null ? `${num(s.odoStart)} → ${num(s.odoEnd)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-[12px] truncate max-w-[180px]">{s.driver || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-[12px] whitespace-nowrap">{s.endReason ? (END_AR[s.endReason] || s.endReason) : '—'}</td>
                </tr>
              ))}
              {!d.stints.length && <tr><td colSpan={9} className="text-center text-slate-400 py-10">{t('لم تُركَّب على عربيةٍ بعد', 'Never mounted yet')}</td></tr>}
            </tbody>
          </table>
        </div>
        {d.stints.some((s) => s.km == null) && (
          <p className="px-4 py-2.5 text-[11.5px] text-slate-500 border-t border-slate-100 bg-slate-50">
            {t('الفترات التي لا كيلومترات لها: لا يوجد عدّاد مسجَّل للعربية في يوم التركيب أو النزول.',
               'Stints without km: no odometer reading recorded for that vehicle on the mount or dismount day.')}
          </p>
        )}
      </div>

      {/* ── ما جرى للعربية وهي عليها ───────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
            <Wrench className="w-4 h-4 text-slate-400" />{t('صيانات وإصلاحات جرت والفردة مركَّبة', 'Services & repairs while it was mounted')}
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{d.whileOn.length}</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-100 text-slate-600 text-[11.5px]">
              <tr>{[t('التاريخ', 'Date'), t('النوع', 'Kind'), t('العربية', 'Vehicle'), t('البند', 'Item'), t('التفصيل', 'Detail'), t('بواسطة', 'By')]
                .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.whileOn.map((w, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{day(w.date)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${w.kind === 'repair' ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>
                      {w.kind === 'repair' ? t('إصلاح', 'Repair') : t('صيانة', 'Service')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-700">{w.plate || '—'}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{w.title || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 text-[12px] max-w-[380px] truncate" title={w.detail}>{w.detail || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-[12px]">{w.by || '—'}</td>
                </tr>
              ))}
              {!d.whileOn.length && <tr><td colSpan={6} className="text-center text-slate-400 py-10">{t('لا صيانة ولا إصلاح جرى والفردة مركَّبة', 'Nothing happened while it was mounted')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── السجلّ الخام ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="font-extrabold text-slate-900 text-[14.5px] flex items-center gap-1.5">
            <History className="w-4 h-4 text-slate-400" />{t('كلّ ما حدث للفردة', 'Everything that happened')}
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11.5px] font-bold">{d.events.length}</span>
          </p>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-100 text-slate-600 text-[11.5px] sticky top-0">
              <tr>{[t('التاريخ', 'Date'), t('الحركة', 'Action'), t('من', 'From'), t('إلى', 'To'), t('العدّاد', 'Odometer'), t('السبب', 'Reason'), t('بواسطة', 'By')]
                .map((h) => <th key={h} className="px-3 py-2.5 text-start font-bold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.events.map((e) => (
                <tr key={e._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{day(e.date)}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{ar ? (ACTION_AR[e.action] || e.action) : e.action}</td>
                  <td className="px-3 py-2.5 text-slate-600 text-[12px]">{[e.fromPlate, e.fromPosition].filter(Boolean).join(' — ') || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 text-[12px]">{[e.toPlate, e.toPosition].filter(Boolean).join(' — ') || '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-500">{num(e.odometerKm)}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-[12px] max-w-[240px] truncate" title={[e.reason, e.notes].filter(Boolean).join(' · ')}>{[e.reason, e.notes].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-[12px] flex items-center gap-1"><User className="w-3 h-3 text-slate-300" />{e.performedByName || '—'}</td>
                </tr>
              ))}
              {!d.events.length && <tr><td colSpan={7} className="text-center text-slate-400 py-10">{t('لا سجلّ حركة', 'No movement log')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
