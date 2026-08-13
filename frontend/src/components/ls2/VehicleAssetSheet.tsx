'use client';
// ملف الأصول للعربية الواحدة: الكاوتش اللي عليها دلوقتي، وكل حاجة حصلت لها.
//
// بيترد على سؤالين كانوا محتاجين خمس شاشات:
//
//   «الـ ١٤ كاوتش دول مين؟»      → تبويب الكاوتش: السيريال، النمرة، النوع،
//                                   الموقع من ١٤، القسم، السينسور، الحالة.
//   «العربية دي عملت فيها إيه؟»  → تبويب التاريخ: حركة الكاوتش + قطع الغيار
//                                   المصروفة + الإصلاحات + الصيانة، مرتّبين
//                                   زمنيًا في خط واحد وكل نوع بلونه.
//
// المصدر: /assets/vehicle/:plate للكاوتش الحالي، و/history للخط الزمني المدموج.
// الاتنين بيتحمّلوا مع بعض عشان التبديل بين التبويبين ما يستناش الشبكة.
import { useEffect, useState, useMemo } from 'react';
import { X, CircleDot, Wrench, Boxes, CalendarCheck, Search } from 'lucide-react';
import api from '@/lib/api';
import { fmtDateTime } from '@/lib/ls2';
import TireActions, { type TireActionHandlers } from './TireActions';

type Tire = {
  _id: string; serial: string; tireNumber: string; type: string; size: string;
  sensor: string; status: string; condition: string; conditionPercent: number | null;
  positionNumber: number | null; positionLabel: string; section: string; isSpare: boolean; notes: string;
};
type Row = {
  kind: 'tire' | 'part' | 'repair' | 'service' | 'asset';
  date: string; action: string; title: string; detail: string;
  odometerKm?: number | null; by?: string; notes?: string; source: string; reversed?: boolean;
};

const KIND: Record<string, { ar: string; en: string; cls: string; dot: string; icon: any }> = {
  tire: { ar: 'كاوتش', en: 'Tires', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500', icon: CircleDot },
  part: { ar: 'قطع غيار', en: 'Parts', cls: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500', icon: Boxes },
  repair: { ar: 'إصلاح', en: 'Repairs', cls: 'bg-rose-50 text-rose-800 border-rose-200', dot: 'bg-rose-500', icon: Wrench },
  service: { ar: 'صيانة', en: 'Service', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', icon: CalendarCheck },
  asset: { ar: 'أصول', en: 'Assets', cls: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-400', icon: Boxes },
};
const SENSOR: Record<string, { ar: string; en: string; cls: string }> = {
  yes: { ar: 'يوجد', en: 'yes', cls: 'bg-emerald-100 text-emerald-700' },
  no: { ar: 'لا يوجد', en: 'no', cls: 'bg-slate-100 text-slate-600' },
  unknown: { ar: 'غير محدد', en: 'unknown', cls: 'bg-slate-100 text-slate-500' },
};
const TIRE_STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  mounted: { ar: 'مركّب', en: 'mounted', cls: 'bg-emerald-100 text-emerald-700' },
  spare: { ar: 'مخزن', en: 'spare', cls: 'bg-sky-100 text-sky-700' },
  in_repair: { ar: 'تحت التجديد', en: 'in repair', cls: 'bg-amber-100 text-amber-800' },
  scrap: { ar: 'سكراب', en: 'scrap', cls: 'bg-slate-200 text-slate-700' },
  damaged: { ar: 'تالف', en: 'damaged', cls: 'bg-rose-100 text-rose-700' },
  retired: { ar: 'خارج الخدمة', en: 'retired', cls: 'bg-slate-100 text-slate-600' },
  sold: { ar: 'مباع', en: 'sold', cls: 'bg-slate-100 text-slate-600' },
};

const FULL = 14;

export default function VehicleAssetSheet({ plate, ar, onClose, admin = false, busy = false, actions, refreshKey = 0 }: {
  plate: string; ar: boolean; onClose: () => void;
  // الأفعال جاية من الصفحة زي ما هي — نفس المودالات ونفس الـ API. الشيت ما
  // بيعرفش يعمل حاجة بنفسه، فمستحيل يختلف سلوكه عن جدول الكاوتش.
  admin?: boolean; busy?: boolean; actions?: TireActionHandlers; refreshKey?: number;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [tab, setTab] = useState<'tires' | 'history'>('tires');
  const [tires, setTires] = useState<Tire[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = encodeURIComponent(plate);
      const [a, h] = await Promise.all([
        api.get<any>(`/api/ls2/assets/vehicle/${p}`).catch(() => null),
        api.get<any>(`/api/ls2/assets/vehicle/${p}/history`).catch(() => null),
      ]);
      if (!alive) return;
      setTires(a?.tires || []);
      setRows(h?.rows || []);
      setCounts(h?.counts || {});
    })();
    return () => { alive = false; };
  }, [plate, refreshKey]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!kind || r.kind === kind)
      && (!s || `${r.title} ${r.detail} ${r.by || ''} ${r.notes || ''}`.toLowerCase().includes(s)));
  }, [rows, kind, q]);

  // نفس قاعدة السيرفر: القسم هو المرجع والعلَم مشتق منه. لو الاتنين اختلفوا
  // لأي سبب، الشاشة تفضل تعرض التقسيمة الصح بدل ما تقول «رأس ٧ · استبن ١».
  const isSpareTire = (x: Tire) => x.isSpare || /استبن/.test(x.section || '');
  const head = (tires || []).filter((x) => !isSpareTire(x) && !/تيدر|تريل/.test(x.section || ''));
  const trailer = (tires || []).filter((x) => !isSpareTire(x) && /تيدر|تريل/.test(x.section || ''));
  const spare = (tires || []).filter(isSpareTire);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">{t('أصول العربية', 'Vehicle assets')} · {plate}</h3>
            <p className="text-[11.5px] text-slate-600">
              {tires == null ? t('جارٍ التحميل…', 'Loading…')
                : t(`${tires.length} من ${FULL} كاوتش مسجّل · ${rows?.length ?? 0} حركة في التاريخ`,
                    `${tires.length} of ${FULL} tires · ${rows?.length ?? 0} history entries`)}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center gap-1.5 px-5 pt-3">
          {([['tires', t('الكاوتش', 'Tires')], ['history', t('التاريخ', 'History')]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k as any)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border ${tab === k ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'tires' && (
            tires == null ? <p className="text-slate-500 py-8 text-center">{t('جارٍ التحميل…', 'Loading…')}</p>
              : tires.length === 0 ? (
                <p className="text-slate-600 py-10 text-center">
                  {t('لا توجد إطارات مسجَّلة على هذه المركبة بعد — تحتاج إلى جرد من الورشة',
                     'No tires registered on this vehicle yet — the workshop still has to inventory it')}
                </p>
              ) : (
                <div className="space-y-4">
                  {/* التقسيمة زي ما الورشة بتشوفها: ٦ رأس + ٦ تيدر + ٢ استبن */}
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    {[[t('الرأس', 'Head'), head.length, 6], [t('التيدر', 'Trailer'), trailer.length, 6], [t('الاستبن', 'Spare'), spare.length, 2]].map(([l, n, want]: any) => (
                      <span key={l} className={`px-2.5 py-1 rounded-lg font-semibold border ${n === want ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                        {l} {n}/{want}
                      </span>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
                        <tr>{[t('الموقع', 'Pos.'), t('السيريال', 'Serial'), t('نمرة الإطار', 'Tag no.'), t('النوع', 'Brand'),
                          t('القسم', 'Section'), t('سينسور', 'Sensor'), t('الحالة', 'Status'), t('ملاحظات', 'Notes'),
                          ...(admin && actions ? [t('إجراءات', 'Actions')] : [])].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-center font-bold whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...tires].sort((a, b) => (a.positionNumber ?? 99) - (b.positionNumber ?? 99)).map((x) => {
                          const st = TIRE_STATUS[x.status] || TIRE_STATUS.mounted;
                          const se = SENSOR[x.sensor] || SENSOR.unknown;
                          return (
                            <tr key={x._id} className="text-center hover:bg-slate-50">
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 text-slate-900 font-semibold text-[13px]">
                                  <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] grid place-items-center tabular-nums">{x.positionNumber ?? '—'}</span>
                                  {x.positionLabel || ''}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-[12.5px] text-slate-900 whitespace-nowrap">{x.serial}</td>
                              <td className="px-3 py-2 text-slate-700 text-[13px] tabular-nums whitespace-nowrap">{x.tireNumber || '—'}</td>
                              <td className="px-3 py-2 text-slate-800 text-[13px] whitespace-nowrap">{x.type || '—'}</td>
                              <td className="px-3 py-2 text-slate-800 text-[13px] whitespace-nowrap">{x.section || '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${se.cls}`}>{ar ? se.ar : se.en}</span></td>
                              <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
                              <td className="px-3 py-2 text-slate-700 text-[12px]">{x.notes || '—'}</td>
                              {admin && actions && (
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <TireActions tire={x} ar={ar} busy={busy} admin={admin} on={actions} compact />
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
          )}

          {tab === 'history' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setKind('')}
                  className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border ${!kind ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
                  {t('الكل', 'All')} {rows?.length ?? 0}
                </button>
                {Object.entries(KIND).filter(([k]) => counts[k]).map(([k, m]) => (
                  <button key={k} onClick={() => setKind(kind === k ? '' : k)}
                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border ${kind === k ? 'ring-2 ring-offset-1 ring-slate-900 ' + m.cls : m.cls}`}>
                    {ar ? m.ar : m.en} {counts[k]}
                  </button>
                ))}
                <div className="relative ms-auto">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('بحث…', 'Search…')}
                    className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 text-[13px] w-52" />
                </div>
              </div>

              {rows == null ? <p className="text-slate-500 py-8 text-center">{t('جارٍ التحميل…', 'Loading…')}</p>
                : shown.length === 0 ? <p className="text-slate-600 py-10 text-center">{t('لا توجد حركة مسجَّلة', 'No history recorded')}</p>
                : (
                  <ol className="relative space-y-2">
                    {shown.map((r, i) => {
                      const m = KIND[r.kind] || KIND.asset;
                      const Icon = m.icon;
                      return (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className={`mt-1.5 w-7 h-7 shrink-0 rounded-full grid place-items-center ${m.cls} border`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <div className={`flex-1 rounded-xl border border-slate-200 px-3 py-2 ${r.reversed ? 'opacity-60 line-through' : ''}`}>
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-semibold text-slate-900 text-[13.5px]">{r.title}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold border ${m.cls}`}>{ar ? m.ar : m.en}</span>
                              {r.action && <span className="text-[11.5px] text-slate-600">{r.action}</span>}
                              <span className="ms-auto text-[11.5px] text-slate-600 tabular-nums whitespace-nowrap">{fmtDateTime(r.date, ar ? 'ar' : 'en')}</span>
                            </div>
                            {r.detail && <p className="text-[12.5px] text-slate-800 mt-0.5">{r.detail}</p>}
                            <p className="text-[11.5px] text-slate-600 mt-0.5">
                              {[r.odometerKm ? `${t('عداد', 'odo')} ${Number(r.odometerKm).toLocaleString('en-US')}` : '', r.by, r.notes]
                                .filter(Boolean).join('  ·  ')}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
