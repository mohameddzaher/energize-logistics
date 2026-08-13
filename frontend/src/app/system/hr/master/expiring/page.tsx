'use client';
// انتهاءات مستندات الموظفين — الإقامة، الجواز، العقد، التأمين الطبي، الشهادة
// الصحية، بطاقة السائق، رخصة القيادة — في شاشة واحدة.
//
// المدة رقم يكتبه المستخدم مش قايمة ثابتة. الأزرار السريعة اختصار بس.
// ملاحظة: المسار ده ساكن، فبياخد الأولوية على [group] في Next — لولا كده كان
// «expiring» هيتفهم على إنه اسم مجموعة ويرجّع 404.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { CalendarClock } from 'lucide-react';
import { getHrExpiring, STATE_META, stateLabel, fmtDate, daysText } from '@/lib/hrMaster';
import MasterNav from '@/components/hr/MasterNav';

const QUICK = [7, 15, 30, 60, 90, 180];

function ExpiringInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const sp = useSearchParams();
  const { notify } = useDialog();

  const [within, setWithin] = useState(sp?.get('withinDays') || '60');
  const [doc, setDoc] = useState(sp?.get('doc') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('includeExpired') !== '0');
  const [d, setD] = useState<Awaited<ReturnType<typeof getHrExpiring>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setD(await getHrExpiring({
        withinDays: within === '' ? undefined : within,
        doc, state, includeExpired: includeExpired ? '1' : '0', status: 'active',
      }));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [within, doc, state, includeExpired, notify]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  const rows = d?.rows || [];
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('رقم الهوية', 'ID number'), key: 'iqamaNumber', width: 16 },
    { header: t('المستند', 'Document'), key: 'docAr', width: 18 },
    { header: t('ينتهي في', 'Expires'), key: 'expiryDate', transform: (v) => fmtDate(v), width: 14 },
    { header: t('المتبقي', 'Days left'), key: 'daysRemaining', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', transform: (v) => stateLabel(v, ar), width: 16 },
    { header: t('القسم', 'Department'), key: 'department', width: 18 },
  ];

  if (loading && !d) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <MasterNav />

      <PageHeader icon={<CalendarClock className="w-5 h-5" />}
        title={t('انتهاءات مستندات الموظفين', 'Employee document expiries')}
        subtitle={t('كل مستند له تاريخ — اختر المدة التي تهمّك', 'Every dated document — pick the window that matters')}>
        <ExportMenu fileName="hr-expiries" lang={lang as 'ar' | 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: t('الانتهاءات', 'Expiries'), rows, columns: cols }] }]} />
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <input type="number" min={0} max={3650} value={within} onChange={(e) => setWithin(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm text-center font-bold" />
          <span className="text-sm text-slate-500">{t('يوم', 'days')}</span>
          {QUICK.map((n) => (
            <button key={n} onClick={() => setWithin(String(n))}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>{n}</button>
          ))}
          <button onClick={() => setWithin('')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'}`}>
            {t('الكل', 'All')}
          </button>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer ms-auto">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
            {t('اعرض المنتهي بالفعل', 'Include expired')}
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          {(d?.byDoc || []).map((x) => (
            <button key={x.key} onClick={() => setDoc(doc === x.key ? '' : x.key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${doc === x.key ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}>
              {ar ? x.ar : x.en} <b>{x.count}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => (
          <button key={k} onClick={() => setState(state === k ? '' : k)}
            className={`text-start bg-white border rounded-xl p-3 shadow-sm ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
            <p className="text-2xl font-extrabold leading-none" style={{ color: STATE_META[k].color }}>{d?.summary?.[k] ?? 0}</p>
            <p className="text-[11.5px] text-slate-600 mt-1.5 font-medium">{stateLabel(k, ar)}</p>
          </button>
        ))}
        <div className="bg-slate-900 rounded-xl p-3 text-white">
          <p className="text-2xl font-extrabold leading-none">{d?.summary?.total ?? 0}</p>
          <p className="text-[11px] text-slate-300 mt-1.5">{t('الإجمالي', 'Total')}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{[t('الرقم الوظيفي', 'Emp. no.'), t('الموظف', 'Employee'), t('رقم الهوية', 'ID number'),
                t('المستند', 'Document'), t('ينتهي في', 'Expires'),
                t('المتبقي', 'Left'), t('الحالة', 'State'), t('القسم', 'Department')].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                const m = STATE_META[r.state] || STATE_META.valid;
                return (
                  <tr key={`${r.employeeId}-${r.docKey}`} className="hover:bg-slate-50 text-center">
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums">{r.employeeNumber || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => router.push(`/system/hr/employees/${r.employeeId}`)}
                        className="font-semibold text-slate-900 hover:text-[#f37121] text-[13.5px] whitespace-nowrap">{r.name}</button>
                    </td>
                    {/* رقم الهوية — ده اللي القسم بيسيرش بيه */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums">{r.iqamaNumber || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => router.push(`/system/hr/master/${r.docKey}`)}
                        className="text-slate-800 hover:text-[#f37121] text-[13px] whitespace-nowrap font-medium">{ar ? r.docAr : r.docEn}</button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 text-[13px] whitespace-nowrap tabular-nums">{fmtDate(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: m.color }}>{daysText(r.daysRemaining, ar)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg}`}>{stateLabel(r.state, ar)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{r.department || '—'}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-400">
                  {t('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><ExpiringInner /></Suspense>;
}
