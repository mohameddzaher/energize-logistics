'use client';
/**
 * مصاريف السوّاق — ما يُستحقّ للرجل على كلّ حمولة، وهل صُرِف.
 *
 * تجيب عن سؤالٍ واحدٍ للحسابات: مَن نحوّل له اليوم وكم؟ ولا تُنشئ رقمًا جديدًا:
 * المبلغُ هو «مصروف السائق» المكتوبُ وقت إنشاء الحمولة — وبونصُ الجمعة مضافٌ
 * فيه وقتَها — والإيبانُ مقروءٌ من ملفّ السائق لا من سطر الحمولة.
 *
 * وعمودُ حالة الدفع هو ما يفصل «مستحقٌّ ولم يُصرَف» عن «صُرِف». وبغيره تُقرأ
 * الصفحةُ مطالبةً واحدةً لا فرقَ فيها، فيُدفَع الشيءُ مرّتين أو لا يُدفَع.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Wallet, CheckCircle2, Clock, Users, Loader2, Search, CalendarDays, BadgeCheck, Coins,
} from 'lucide-react';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';

interface Row {
  _id: string;
  waybillNumber?: number;
  vehiclePlate?: string;
  loadDate?: string;
  driverExpense?: number;
  driverName?: string;
  secondDriverName?: string;
  driverIban?: string;
  driverPhone?: string;
  fridayBonus?: boolean;
  fromCity?: string;
  toCity?: string;
  supervisorName?: string;
  driverExpensePaid?: boolean;
  driverExpensePaidAt?: string;
  driverExpensePaidByName?: string;
}

interface Summary {
  loads: number; total: number; paid: number; unpaid: number;
  paidLoads: number; fridays: number; driverCount: number;
}

const PAY_ROLES = ['super_admin', 'admin', 'it_manager', 'finance_manager', 'accountant', 'fleet_manager', 'operations_manager'];
const todayStr = () => new Date().toISOString().slice(0, 10);
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const dt = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

export default function DriverExpensesPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const canPay = PAY_ROLES.includes(user?.role || '');

  const [mode, setMode] = useState<'all' | 'day' | 'range' | 'month'>('month');
  const [day, setDay] = useState(todayStr());
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01');
  const [to, setTo] = useState(todayStr());
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [paid, setPaid] = useState<'' | '0' | '1'>('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (mode === 'day') { p.set('from', day); p.set('to', day); }
    else if (mode === 'range') { p.set('from', from); p.set('to', to); }
    else if (mode === 'month') p.set('month', month);
    if (paid) p.set('paid', paid);
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [mode, day, from, to, month, paid, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ rows: Row[]; summary: Summary }>(`/api/fleet/driver-expenses?${qs}`);
      setRows(d.rows || []);
      setSummary(d.summary || null);
      setPicked(new Set());
    } catch { setRows([]); setSummary(null); }
    setLoading(false);
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:driverExpense', useCallback(() => load(), [load]));
  useSocket('fleet:shipments', useCallback(() => load(), [load]));

  const shownLabel = mode === 'all' ? t('كل الفترات', 'All time')
    : mode === 'day' ? day : mode === 'month' ? month : `${from} → ${to}`;

  const setPaidFor = async (ids: string[], value: boolean) => {
    if (!ids.length) return;
    if (ids.length > 1 && !(await confirm(
      value ? t(`تعليم ${ids.length} صفًّا كمسدَّد؟`, `Mark ${ids.length} rows as paid?`)
            : t(`رفع السداد عن ${ids.length} صفًّا؟`, `Unmark ${ids.length} rows?`)))) return;
    setBusy(true);
    try {
      await api.patch('/api/fleet/driver-expenses/paid', { ids, paid: value });
      // التحديثُ محليًّا ثمّ الجلب: العلامةُ تُرى فورًا ولا تنتظر دورةَ الشبكة.
      setRows((p) => p.map((r) => (ids.includes(r._id) ? { ...r, driverExpensePaid: value } : r)));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setBusy(false);
  };

  const cols: ExportColumn[] = [
    { header: t('رقم الكشف', 'Waybill'), key: 'waybillNumber', width: 12 },
    { header: t('رقم السيارة', 'Vehicle'), key: 'vehiclePlate', width: 14 },
    { header: t('تاريخ بداية الحمولة', 'Load date'), key: 'loadDate', width: 16, transform: (v: any) => dt(v) },
    { header: t('السائق', 'Driver'), key: 'driverName', width: 22 },
    { header: t('السائق الثاني', 'Second driver'), key: 'secondDriverName', width: 22 },
    { header: t('رقم الإيبان', 'IBAN'), key: 'driverIban', width: 30 },
    { header: t('مصروف السائق الفعلي', 'Actual expense'), key: 'driverExpense', width: 18 },
    { header: t('بونص الجمعة', 'Friday bonus'), key: 'fridayBonus', width: 12, transform: (v: any) => (v ? t('نعم', 'Yes') : '') },
    { header: t('من', 'From'), key: 'fromCity', width: 14 },
    { header: t('إلى', 'To'), key: 'toCity', width: 14 },
    { header: t('المشرف', 'Supervisor'), key: 'supervisorName', width: 20 },
    // ── والحالةُ تُكتب كلامًا لا علامةً ────────────────────────────────────
    // الملفُّ يُقرأ خارج النظام ويُرسَل إلى البنك، فخانةٌ فارغةٌ تعني «لا نعلم».
    { header: t('حالة الدفع', 'Payment status'), key: 'driverExpensePaid', width: 16,
      transform: (v: any) => (v ? t('تم السداد', 'Paid') : t('لم يتم السداد', 'Not paid')) },
    { header: t('تاريخ السداد', 'Paid at'), key: 'driverExpensePaidAt', width: 16, transform: (v: any) => dt(v) },
    { header: t('سدّدها', 'Paid by'), key: 'driverExpensePaidByName', width: 20 },
  ];

  const allPicked = rows.length > 0 && picked.size === rows.length;
  const pickedUnpaid = rows.filter((r) => picked.has(r._id) && !r.driverExpensePaid).map((r) => r._id);
  const pickedPaid = rows.filter((r) => picked.has(r._id) && r.driverExpensePaid).map((r) => r._id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Wallet className="h-5 w-5 text-[#f37121]" />
            {t('مصاريف السوّاق', 'Driver expenses')}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {t('المبلغ هو مصروف السائق المكتوب وقت إنشاء الحمولة، والإيبان من ملفّ السائق.',
               'The amount is the driver expense entered when the load was created; the IBAN comes from the driver’s profile.')}
          </p>
        </div>
        <ExportMenu fileName={`DriverExpenses_${shownLabel.replace(/[^0-9A-Za-z-]/g, '_')}`}
          lang={ar ? 'ar' : 'en'} label={t('تصدير Excel', 'Export Excel')}
          options={[{
            key: 'shown',
            label: `${t('المعروض', 'Shown')} — ${shownLabel}`,
            sheets: [{
              name: t('مصاريف السوّاق', 'Driver expenses'),
              rows: rows as unknown as Record<string, any>[],
              columns: cols,
              above: summary ? [{
                title: `${t('مصاريف السوّاق', 'Driver expenses')} — ${shownLabel}`,
                rows: [{
                  a: t('عدد الحمولات', 'Loads'), b: summary.loads,
                  c: t('عدد السوّاق', 'Drivers'), d: summary.driverCount,
                  e: t('الإجمالي', 'Total'), f: money(summary.total),
                  g: t('تم السداد', 'Paid'), h: money(summary.paid),
                  i: t('لم يتم السداد', 'Not paid'), j: money(summary.unpaid),
                }],
                columns: [
                  { header: '', key: 'a', width: 18 }, { header: '', key: 'b', width: 10 },
                  { header: '', key: 'c', width: 14 }, { header: '', key: 'd', width: 10 },
                  { header: '', key: 'e', width: 12 }, { header: '', key: 'f', width: 14 },
                  { header: '', key: 'g', width: 12 }, { header: '', key: 'h', width: 14 },
                  { header: '', key: 'i', width: 14 }, { header: '', key: 'j', width: 14 },
                ],
              }] : undefined,
            }],
          }]} />
      </div>

      {/* ── البطاقات: على المطابق كلِّه لا على المعروض ─────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <K label={t('عدد الحمولات', 'Loads')} value={summary?.loads ?? 0} Icon={CalendarDays} />
        <K label={t('عدد السوّاق', 'Drivers')} value={summary?.driverCount ?? 0} Icon={Users} />
        <K label={t('إجمالي المصاريف', 'Total expenses')} value={money(summary?.total)} tone="text-slate-900" Icon={Coins} />
        <K label={t('تم السداد', 'Paid')} value={money(summary?.paid)} tone="text-emerald-700" Icon={CheckCircle2}
          hint={t(`${summary?.paidLoads ?? 0} حمولة`, `${summary?.paidLoads ?? 0} loads`)} />
        <K label={t('لم يتم السداد', 'Not paid')} value={money(summary?.unpaid)} tone="text-red-600" Icon={Clock}
          hint={t(`${(summary?.loads ?? 0) - (summary?.paidLoads ?? 0)} حمولة`, `${(summary?.loads ?? 0) - (summary?.paidLoads ?? 0)} loads`)} />
        <K label={t('بونص الجمعة', 'Friday bonus')} value={summary?.fridays ?? 0} tone="text-violet-700" Icon={BadgeCheck}
          hint={t('حمولات عليها بونص', 'loads with bonus')} />
      </div>

      {/* ── الفلاتر ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {([['month', t('شهر', 'Month')], ['day', t('يوم', 'Day')], ['range', t('فترة', 'Period')], ['all', t('الكل', 'All')]] as const)
            .map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                {lbl}
              </button>
            ))}
        </div>
        {mode === 'month' && <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} aria-label={t('الشهر', 'Month')} />}
        {mode === 'day' && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inp} aria-label={t('اليوم', 'Day')} />}
        {mode === 'range' && (
          <>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inp} aria-label={t('من', 'From')} />
            <span className="pb-2 text-slate-400">→</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inp} aria-label={t('إلى', 'To')} />
          </>
        )}

        <select value={paid} onChange={(e) => setPaid(e.target.value as any)} className={inp} aria-label={t('حالة الدفع', 'Payment status')}>
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          <option value="0">{t('لم يتم السداد', 'Not paid')}</option>
          <option value="1">{t('تم السداد', 'Paid')}</option>
        </select>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={`${inp} ps-8 w-56`}
            placeholder={t('كشف أو سائق أو لوحة…', 'Waybill, driver or plate…')} />
        </div>

        {canPay && !!picked.size && (
          <div className="ms-auto flex items-center gap-2">
            {!!pickedUnpaid.length && (
              <button type="button" disabled={busy} onClick={() => setPaidFor(pickedUnpaid, true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" />{t(`تم السداد (${pickedUnpaid.length})`, `Mark paid (${pickedUnpaid.length})`)}
              </button>
            )}
            {!!pickedPaid.length && (
              <button type="button" disabled={busy} onClick={() => setPaidFor(pickedPaid, false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">
                {t(`رفع السداد (${pickedPaid.length})`, `Unmark (${pickedPaid.length})`)}
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                {canPay && (
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" className="h-4 w-4 accent-[#f37121]" checked={allPicked}
                      onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())}
                      aria-label={t('تحديد الكل', 'Select all')} />
                  </th>
                )}
                {[t('رقم الكشف', 'Waybill'), t('رقم السيارة', 'Vehicle'), t('تاريخ بداية الحمولة', 'Load date'),
                  t('السائق', 'Driver'), t('السائق الثاني', 'Second driver'), t('رقم الإيبان', 'IBAN'),
                  t('المصروف الفعلي', 'Actual expense'), t('حالة الدفع', 'Payment status')].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className={`border-b border-slate-100 hover:bg-slate-50 ${r.driverExpensePaid ? 'bg-emerald-50/40' : ''}`}>
                  {canPay && (
                    <td className="px-3 py-2">
                      <input type="checkbox" className="h-4 w-4 accent-[#f37121]" checked={picked.has(r._id)}
                        onChange={(e) => setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(r._id); else n.delete(r._id);
                          return n;
                        })}
                        aria-label={`${r.waybillNumber}`} />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-[12.5px] font-semibold text-slate-900">{r.waybillNumber ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-slate-700">{r.vehiclePlate || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{dt(r.loadDate)}</td>
                  <td className="px-3 py-2 text-[13px] text-slate-800">
                    {r.driverName || '—'}
                    {r.fridayBonus && (
                      <span className="ms-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                        {t('جمعة', 'Fri')}
                      </span>
                    )}
                  </td>
                  {/* السائقُ الثاني يُكتب إن وُجد، ويُترك خطًّا إن لم يوجد. */}
                  <td className="px-3 py-2 text-[13px] text-slate-600">{r.secondDriverName || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-[11.5px]" dir="ltr">
                    {r.driverIban || <span className="text-amber-600 font-sans text-[11px] font-semibold">{t('غير مسجَّل في ملفّه', 'not on file')}</span>}
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-slate-900">{money(r.driverExpense)}</td>
                  <td className="px-3 py-2">
                    {canPay ? (
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!r.driverExpensePaid}
                          disabled={busy}
                          onChange={(e) => setPaidFor([r._id], e.target.checked)} />
                        <span className={`text-[11.5px] font-semibold ${r.driverExpensePaid ? 'text-emerald-700' : 'text-red-600'}`}>
                          {r.driverExpensePaid ? t('تم السداد', 'Paid') : t('لم يتم السداد', 'Not paid')}
                        </span>
                      </label>
                    ) : (
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.driverExpensePaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {r.driverExpensePaid ? t('تم السداد', 'Paid') : t('لم يتم السداد', 'Not paid')}
                      </span>
                    )}
                    {r.driverExpensePaid && r.driverExpensePaidByName && (
                      <p className="mt-0.5 text-[10.5px] text-slate-400">{r.driverExpensePaidByName} · {dt(r.driverExpensePaidAt)}</p>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={canPay ? 9 : 8} className="px-3 py-12 text-center text-slate-500">
                  {t('لا مصاريف في هذا المدى', 'No expenses in this range')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inp = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm';
const K = ({ label, value, hint, tone, Icon }: { label: string; value: any; hint?: string; tone?: string; Icon: any }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="mb-1 flex items-center justify-between">
      <span className="text-[11px] text-slate-500">{label}</span>
      <Icon className="h-3.5 w-3.5 text-slate-300" />
    </div>
    <p className={`text-xl font-extrabold ${tone || 'text-slate-900'}`}>{value}</p>
    {hint && <p className="mt-0.5 text-[10.5px] text-slate-400">{hint}</p>}
  </div>
);
