'use client';
// سجلّات السيارات — الشهرُ كلُّه لسيّارةٍ واحدة، أو الشهرُ كلُّه لكلّ السيارات.
//
// السؤال الذي لم تكن له شاشة: «ماذا جرى لهذه السيّارة الشهر الماضي؟». كانت
// إجابتُه مبعثرةً في سجلّات ستّ شحنات: عطلٌ مكتوبٌ في متابعة شحنةٍ سُلّمت،
// وإطارٌ في متابعة أخرى — ولا موضعَ يجمعها.
//
// والصفحة طبقتان: جدولٌ بكلّ السيارات في الفترة (حمولاتُها ودخلُها وأعطالُها)،
// وحين تُختار سيّارةٌ يُفتح سجلُّها الكامل تحته.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { canEditFleet } from '@/lib/fleet';
import { syncUrl } from '@/lib/urlSync';
import VehicleMonthLog, { thisMonth } from '@/components/fleet/VehicleMonthLog';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ClipboardList, Lock, Search, ChevronLeft, ChevronRight } from 'lucide-react';

interface Row {
  _id: string; plate: string; name?: string; trailerType?: string; supervisorName?: string;
  target: number; loads: number; income: number; driverExpense: number; logCost: number;
  net: number; entries: number; breakdowns: number; byKind: Record<string, number>;
}
interface Resp {
  period: { from: string; to: string; monthKey: string; label: string; scope: string };
  closed: boolean;
  kinds: { key: string; ar: string; en: string }[];
  rows: Row[];
}

const p2 = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (mk: string, by: number) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
};
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

function VehicleLogsInner() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const sp = useSearchParams();
  const router = useRouter();
  const canEdit = canEditFleet(user);

  // ── الفترة: شهرٌ (وهي وحدةُ الإقفال) أو مدًى حرّ أو يومٌ بعينه ─────────────
  const [mode, setMode] = useState<'month' | 'range' | 'day'>((sp?.get('mode') as any) || 'month');
  const [month, setMonth] = useState(sp?.get('month') || thisMonth());
  const [from, setFrom] = useState(sp?.get('from') || '');
  const [to, setTo] = useState(sp?.get('to') || '');
  const [day, setDay] = useState(sp?.get('date') || '');
  const [plate, setPlate] = useState(sp?.get('vehicle') || '');
  const [search, setSearch] = useState('');

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const params = () => {
    const q = new URLSearchParams();
    if (mode === 'day' && day) q.set('date', day);
    else if (mode === 'range' && (from || to)) { if (from) q.set('from', from); if (to) q.set('to', to); }
    else q.set('month', month);
    return q;
  };
  const query = params().toString();

  const load = useCallback(async () => {
    try { setData(await api.get<Resp>(`/api/fleet/vehicle-logs/summary?${query}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => { load(); }, [load]));

  // الرابط يعكس ما على الشاشة — بلا تنقّلٍ يومض عند كل ضغطة.
  useEffect(() => {
    const q = params();
    q.set('mode', mode);
    if (plate) q.set('vehicle', plate);
    syncUrl('/system/fleet/vehicle-logs', q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, month, from, to, day, plate]);

  const rows = (data?.rows || []).filter((r) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [r.plate, r.name, r.supervisorName, r.trailerType].some((v) => v && String(v).toLowerCase().includes(s));
  });

  const totals = rows.reduce((a, r) => ({
    loads: a.loads + r.loads, income: a.income + r.income, driverExpense: a.driverExpense + r.driverExpense,
    logCost: a.logCost + r.logCost, net: a.net + r.net, entries: a.entries + r.entries, breakdowns: a.breakdowns + r.breakdowns,
  }), { loads: 0, income: 0, driverExpense: 0, logCost: 0, net: 0, entries: 0, breakdowns: 0 });

  const exportColumns: ExportColumn[] = [
    { header: t('اللوحة', 'Plate'), key: 'plate', width: 16 },
    { header: t('المقطورة', 'Trailer'), key: 'trailerType', width: 14, transform: (v) => v || '—' },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName', width: 20, transform: (v) => v || '—' },
    { header: t('حمولات', 'Loads'), key: 'loads', width: 10 },
    { header: t('الدخل', 'Income'), key: 'income', width: 14 },
    { header: t('مصروف السائق', 'Driver expense'), key: 'driverExpense', width: 16 },
    { header: t('تكلفة السجلّ', 'Log cost'), key: 'logCost', width: 14 },
    { header: t('الصافي', 'Net'), key: 'net', width: 14 },
    { header: t('قيود', 'Entries'), key: 'entries', width: 10 },
    { header: t('أعطال وصيانة', 'Breakdowns'), key: 'breakdowns', width: 14 },
    { header: t('الهدف الشهري', 'Monthly target'), key: 'target', width: 14 },
  ];

  const selected = rows.find((r) => r.plate === plate) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={t('سجلّات السيارات', 'Vehicle Logs')}
        subtitle={t('السجلّ الشهريّ الكامل لكلّ سيّارة — يُقفل تلقائيًّا مع أوّل الشهر التالي', 'The full monthly log per vehicle — closes automatically on the 1st of the next month')}
      >
        <ExportMenu
          fileName={`vehicle-logs-${data?.period.monthKey || data?.period.label || ''}`}
          lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('سجلّات السيارات', 'Vehicle logs'), rows, columns: exportColumns }] }]}
        />
      </PageHeader>

      {/* الفلاتر */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['month', 'range', 'day'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {m === 'month' ? t('شهر', 'Month') : m === 'range' ? t('من — إلى', 'From — To') : t('يوم بعينه', 'A single day')}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {mode === 'month' && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" aria-label="prev">
                {ar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" aria-label="next">
                {ar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
          {mode === 'range' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('من', 'From')}</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('إلى', 'To')}</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('حتى اليوم', 'Until today')}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              </div>
            </>
          )}
          {mode === 'day' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('اليوم', 'Day')}</label>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
            </div>
          )}
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('ابحث بلوحة أو مشرف', 'Search plate or supervisor')}
              className="w-full ps-10 pe-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          </div>
          {data?.closed && (
            <span className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-600 inline-flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> {t(`سجلّ ${data.period.label} مقفل`, `${data.period.label} is closed`)}
            </span>
          )}
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-900">
                  {[t('اللوحة', 'Plate'), t('المقطورة', 'Trailer'), t('المشرف', 'Supervisor'), t('حمولات', 'Loads'),
                    t('الدخل', 'Income'), t('مصروف السائق', 'Driver exp.'), t('تكلفة السجلّ', 'Log cost'),
                    t('الصافي', 'Net'), t('قيود', 'Entries'), t('أعطال', 'Breakdowns')].map((h) => (
                    <th key={h} className="text-start text-slate-300 font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="text-center text-slate-500 py-12">{t('لا سيارات في هذه الفترة.', 'No vehicles in this period.')}</td></tr>
                ) : rows.map((r) => (
                  <tr key={r._id} onClick={() => setPlate(plate === r.plate ? '' : r.plate)}
                    className={`cursor-pointer transition-colors ${plate === r.plate ? 'bg-orange-50' : 'bg-white hover:bg-slate-50'}`}>
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{r.plate}</td>
                    <td className="px-4 py-3 text-slate-700">{r.trailerType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.supervisorName || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.loads}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money(r.income)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money(r.driverExpense)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{money(r.logCost)}</td>
                    <td className={`px-4 py-3 font-semibold whitespace-nowrap ${r.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{money(r.net)}</td>
                    <td className="px-4 py-3 text-slate-700">{r.entries}</td>
                    <td className="px-4 py-3">
                      {r.breakdowns
                        ? <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">{r.breakdowns}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-semibold text-slate-900">
                    <td className="px-4 py-3" colSpan={3}>{t('الإجمالي', 'Total')}</td>
                    <td className="px-4 py-3">{totals.loads}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(totals.income)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(totals.driverExpense)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(totals.logCost)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${totals.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{money(totals.net)}</td>
                    <td className="px-4 py-3">{totals.entries}</td>
                    <td className="px-4 py-3">{totals.breakdowns || '—'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {plate && (
        <VehicleMonthLog
          vehicle={plate}
          month={mode === 'month' ? month : undefined}
          from={mode === 'range' ? from : undefined}
          to={mode === 'range' ? to : undefined}
          date={mode === 'day' ? day : undefined}
          canEdit={canEdit}
        />
      )}
      {!plate && !loading && rows.length > 0 && (
        <p className="text-center text-sm text-slate-500">{t('اضغط على صفّ سيّارة لفتح سجلّها الكامل.', 'Click a vehicle row to open its full log.')}</p>
      )}
    </div>
  );
}

export default function FleetVehicleLogsPage() {
  return <Suspense fallback={<Spinner />}><VehicleLogsInner /></Suspense>;
}
