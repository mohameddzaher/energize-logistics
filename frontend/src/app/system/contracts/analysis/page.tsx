'use client';
// تحليل حجم تشغيل الموردين — the quarterly report the department used to build
// by hand, computed live: pick any month window and get the contract-status
// split, top vendors, wasted capacity, movers, rep performance and the vendor
// stability picture. Data entry (a new month's numbers) is on this page too,
// so the analysis is always as fresh as the last row typed in.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Users, Package, Plus,
  ArrowUpRight, ArrowDownRight, RefreshCw,
} from 'lucide-react';
import { Spinner, PageHeader, StatCard, ErrorNotice, Modal, Field, TextInput, Select, PrimaryButton, SearchableSelect } from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import {
  CATEGORY_LABELS, CategoryKey, MONTH_AR, canViewContracts, canEditContracts,
  fmtN, pct, monthLabel, ContractVendor,
} from '@/lib/contracts';

interface Analysis {
  window: { months: string[] };
  totals: { orders: number; byCategory: Record<CategoryKey, number>; categoryVendorCounts: { signed: number; credit: number; cash: number }; uniqueVendors: number };
  trend: { month: string; total: number; signed: number; credit: number; cash: number; external: number }[];
  topVendors: { nameKey: string; vendorName: string; vendor?: string | null; category: CategoryKey; fleetSize: number; months: Record<string, number>; totalOrders: number }[];
  topByCategory: Record<'signed' | 'credit' | 'cash', { vendorName: string; vendor?: string | null; totalOrders: number }[]>;
  wastedCapacity: { vendorName: string; vendor?: string | null; fleetSize: number; totalOrders: number; capacity: number; utilisation: number }[];
  movers: { growth: { vendorName: string; from: number; to: number; delta: number }[]; decline: { vendorName: string; from: number; to: number; delta: number }[] };
  reps: { rep: string; orders: number; vendors: number; signed: number }[];
  stability: { uniqueVendors: number; stableAllMonths: number; newInLast: number; stoppedAfterFirst: number };
}

function Card({ title, icon, children, tone = '' }: { title: string; icon?: React.ReactNode; children: React.ReactNode; tone?: string }) {
  return (
    <div className={`bg-white border rounded-xl shadow-sm p-4 ${tone || 'border-slate-200'}`}>
      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-3">{icon}{title}</h3>
      {children}
    </div>
  );
}

export default function ContractsAnalysisPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const { notify } = useDialog();
  const ar = lang === 'ar';
  const canEdit = canEditContracts(user);

  const [available, setAvailable] = useState<{ year: number; month: number }[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEntry, setShowEntry] = useState(false);
  const [vendors, setVendors] = useState<ContractVendor[]>([]);
  const [entry, setEntry] = useState({ vendorName: '', year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1), orders: '', isExternal: false });
  const [saving, setSaving] = useState(false);

  // Which months exist → default window = the last 3 (a rolling quarter).
  const loadMonths = useCallback(async () => {
    try {
      const d = await api.get<{ vendors: { total: number }; utilisationMonths: { year: number; month: number }[] }>('/api/contracts/dashboard');
      const ms = d.utilisationMonths || [];
      setAvailable(ms);
      if (ms.length && !from) {
        const lastThree = ms.slice(-3);
        setFrom(`${lastThree[0].year}-${String(lastThree[0].month).padStart(2, '0')}`);
        setTo(`${ms[ms.length - 1].year}-${String(ms[ms.length - 1].month).padStart(2, '0')}`);
      }
    } catch (e: any) { setError(e?.message || 'Request failed'); setLoading(false); }
  }, [from]);
  useEffect(() => { loadMonths(); }, [loadMonths]);

  const load = useCallback(async () => {
    if (!from || !to) return;
    try {
      setData(await api.get<Analysis>(`/api/contracts/analysis?from=${from}&to=${to}`));
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => { loadMonths(); load(); }, [loadMonths, load]));

  useEffect(() => {
    if (!canEdit) return;
    api.get<{ vendors: ContractVendor[] }>('/api/contracts/vendors').then((d) => setVendors(d.vendors || [])).catch(() => {});
  }, [canEdit]);

  const monthOptions = useMemo(() => available.map((m) => {
    const v = `${m.year}-${String(m.month).padStart(2, '0')}`;
    return { value: v, label: monthLabel(v, ar) };
  }), [available, ar]);

  const saveEntry = async () => {
    if ((!entry.vendorName && !entry.isExternal) || saving) return;
    setSaving(true);
    try {
      await api.post('/api/contracts/utilisation', {
        vendorName: entry.isExternal ? 'أفراد خارجية (بلا عقد)' : entry.vendorName,
        year: Number(entry.year), month: Number(entry.month),
        orders: Number(entry.orders) || 0,
        isExternal: entry.isExternal,
      });
      setEntry({ ...entry, vendorName: '', orders: '' });
      await Promise.all([loadMonths(), load()]);
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
    setSaving(false);
  };

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading && !data) return <Spinner />;

  const t = data?.totals;
  const share = (n: number) => (t && t.orders ? pct(n / t.orders) : '—');

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<BarChart3 className="w-7 h-7 text-cyan-700" />}
        title={ar ? 'تحليل حجم تشغيل الموردين' : 'Vendor Utilisation Analysis'}
        subtitle={data ? (ar
          ? `${data.window.months.map((m) => monthLabel(m, true)).join(' + ')} · ${fmtN(t!.orders)} طلب · ${fmtN(t!.uniqueVendors)} مورد فريد`
          : `${data.window.months.join(' + ')} · ${fmtN(t!.orders)} orders`) : ''}
      >
        {canEdit && (
          <PrimaryButton onClick={() => setShowEntry(true)}>
            <span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{ar ? 'إدخال أرقام شهر' : 'Enter month data'}</span>
          </PrimaryButton>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />}

      {/* Window picker */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <span className="text-xs font-bold text-slate-600">{ar ? 'الفترة:' : 'Window:'}</span>
        <span className="text-xs text-slate-500">{ar ? 'من' : 'from'}</span>
        <div className="w-40"><SearchableSelect value={from} onChange={setFrom} options={monthOptions} placeholder="—" /></div>
        <span className="text-xs text-slate-500">{ar ? 'إلى' : 'to'}</span>
        <div className="w-40"><SearchableSelect value={to} onChange={setTo} options={monthOptions} placeholder="—" /></div>
        <button onClick={() => { setLoading(true); load(); }} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium"><RefreshCw className="w-3.5 h-3.5" />{ar ? 'تحديث' : 'Refresh'}</button>
        <span className="text-[11px] text-slate-400 ms-auto">{ar ? 'كل الأرقام تُحسب لحظيًا من السجل — أي تعديل يظهر هنا فورًا.' : 'Computed live from the register.'}</span>
      </div>

      {!data ? <Spinner /> : (
        <>
          {/* Contract-status split */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard label={ar ? 'إجمالي طلبات الفترة' : 'Total orders'} value={fmtN(t!.orders)} accent="text-slate-800" />
            {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((k) => (
              <StatCard key={k} label={ar ? CATEGORY_LABELS[k].ar : CATEGORY_LABELS[k].en}
                value={`${fmtN(t!.byCategory[k] || 0)} · ${share(t!.byCategory[k] || 0)}`}
                accent={CATEGORY_LABELS[k].cls.split(' ')[1]} />
            ))}
          </div>

          {/* Stacked share bar */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex h-6 rounded-full overflow-hidden">
              {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((k) => {
                const w = t!.orders ? ((t!.byCategory[k] || 0) / t!.orders) * 100 : 0;
                return w > 0 ? <div key={k} className={CATEGORY_LABELS[k].bar} style={{ width: `${w}%` }} title={`${ar ? CATEGORY_LABELS[k].ar : CATEGORY_LABELS[k].en} ${w.toFixed(1)}%`} /> : null;
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2.5 text-[11px]">
              {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                  <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_LABELS[k].bar}`} />
                  {ar ? CATEGORY_LABELS[k].ar : CATEGORY_LABELS[k].en} · {share(t!.byCategory[k] || 0)}
                </span>
              ))}
            </div>
          </div>

          {/* Monthly trend */}
          {data.trend.length > 1 && (
            <Card title={ar ? 'اتجاه الطلبات الشهري حسب التصنيف' : 'Monthly trend by category'} icon={<TrendingUp className="w-4 h-4 text-cyan-700" />}>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${data.trend.length}, minmax(0,1fr))` }}>
                {data.trend.map((m) => (
                  <div key={m.month} className="text-center">
                    <div className="text-xs font-bold text-slate-700 mb-1">{monthLabel(m.month, ar)}</div>
                    <div className="text-lg font-bold tabular-nums text-slate-800">{fmtN(m.total)}</div>
                    <div className="flex h-2.5 rounded-full overflow-hidden mt-1.5">
                      {(['signed', 'credit', 'cash', 'external'] as const).map((k) => {
                        const w = m.total ? (m[k] / m.total) * 100 : 0;
                        return w > 0 ? <div key={k} className={CATEGORY_LABELS[k].bar} style={{ width: `${w}%` }} /> : null;
                      })}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 tabular-nums">
                      ✅ {m.total ? Math.round((m.signed / m.total) * 100) : 0}% · 🚨 {m.total ? Math.round((m.external / m.total) * 100) : 0}%
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top vendors table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-cyan-700" />{ar ? `أعلى الموردين تشغيلًا خلال الفترة (أول ${Math.min(20, data.topVendors.length)})` : 'Top vendors'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-4 py-2.5">{ar ? 'المورد' : 'Vendor'}</th>
                    {data.window.months.map((m) => <th key={m} className="text-center font-semibold px-3 py-2.5">{monthLabel(m, ar)}</th>)}
                    <th className="text-center font-semibold px-4 py-2.5">{ar ? 'إجمالي الفترة' : 'Total'}</th>
                    <th className="text-center font-semibold px-4 py-2.5">{ar ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topVendors.map((v) => (
                    <tr key={v.nameKey} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-semibold text-slate-800">
                        {v.vendor ? <Link href={`/system/contracts/vendors/${v.vendor}`} className="hover:text-cyan-700">{v.vendorName}</Link> : v.vendorName}
                      </td>
                      {data.window.months.map((m) => <td key={m} className="px-3 py-2 text-center tabular-nums text-slate-600">{v.months[m] != null ? fmtN(v.months[m]) : '—'}</td>)}
                      <td className="px-4 py-2 text-center font-bold tabular-nums text-slate-900">{fmtN(v.totalOrders)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_LABELS[v.category].cls}`}>{ar ? CATEGORY_LABELS[v.category].ar : CATEGORY_LABELS[v.category].en}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Wasted capacity */}
            <Card title={ar ? 'أعلى طاقة مهدرة — موقّعون باستغلال شبه معدوم' : 'Wasted capacity (signed, <5% used)'} icon={<AlertTriangle className="w-4 h-4 text-red-600" />} tone="border-red-200">
              {data.wastedCapacity.length === 0
                ? <div className="text-xs text-slate-400 py-4 text-center">{ar ? 'لا توجد حالات في هذه الفترة' : 'None in this window'}</div>
                : (
                  <div className="space-y-1.5">
                    {data.wastedCapacity.slice(0, 10).map((w) => (
                      <div key={w.vendorName} className="flex items-center gap-2 text-xs bg-red-50/50 border border-red-100 rounded-lg px-3 py-2">
                        <span className="flex-1 min-w-0">
                          <span className="font-bold text-slate-800 block truncate">{w.vendor ? <Link href={`/system/contracts/vendors/${w.vendor}`} className="hover:text-cyan-700">{w.vendorName}</Link> : w.vendorName}</span>
                          <span className="text-slate-500">{fmtN(w.fleetSize)} {ar ? 'سيارة' : 'veh.'} → {fmtN(w.totalOrders)} {ar ? 'طلب' : 'orders'}</span>
                        </span>
                        <span className="font-bold text-red-600 tabular-nums shrink-0">{pct(w.utilisation)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </Card>

            {/* Rep performance */}
            <Card title={ar ? 'أداء مناديب التشغيل خلال الفترة' : 'Operations rep performance'} icon={<Users className="w-4 h-4 text-cyan-700" />}>
              {data.reps.length === 0
                ? <div className="text-xs text-slate-400 py-4 text-center">{ar ? 'لا توجد بيانات مناديب لهذه الفترة' : 'No rep data'}</div>
                : (
                  <div className="space-y-1.5">
                    {data.reps.slice(0, 12).map((r) => (
                      <div key={r.rep} className="flex items-center gap-2 text-xs border-b border-slate-50 pb-1.5">
                        <span className="font-bold text-slate-800 w-28 truncate">{r.rep}</span>
                        <span className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                          <span className="block h-full bg-cyan-600 rounded-full" style={{ width: `${(r.orders / (data.reps[0]?.orders || 1)) * 100}%` }} />
                        </span>
                        <span className="tabular-nums font-bold text-slate-700 w-14 text-end">{fmtN(r.orders)}</span>
                        <span className="text-slate-400 w-24 text-end">{fmtN(r.vendors)} {ar ? 'مورد' : 'vendors'} · {fmtN(r.signed)} {ar ? 'موقّع' : 'signed'}</span>
                      </div>
                    ))}
                  </div>
                )}
            </Card>

            {/* Movers */}
            <Card title={ar ? 'الأعلى نموًا بين أول وآخر شهر' : 'Top growth'} icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}>
              <div className="space-y-1.5">
                {data.movers.growth.map((m) => (
                  <div key={m.vendorName} className="flex items-center gap-2 text-xs border-b border-slate-50 pb-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="flex-1 font-medium text-slate-700 truncate">{m.vendorName}</span>
                    <span className="text-slate-400 tabular-nums">{fmtN(m.from)} ← {fmtN(m.to)}</span>
                    <span className="font-bold text-emerald-600 tabular-nums w-12 text-end">+{fmtN(m.delta)}</span>
                  </div>
                ))}
                {data.movers.growth.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">—</div>}
              </div>
            </Card>
            <Card title={ar ? 'الأعلى تراجعًا بين أول وآخر شهر' : 'Top decline'} icon={<TrendingDown className="w-4 h-4 text-red-600" />}>
              <div className="space-y-1.5">
                {data.movers.decline.map((m) => (
                  <div key={m.vendorName} className="flex items-center gap-2 text-xs border-b border-slate-50 pb-1.5">
                    <ArrowDownRight className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span className="flex-1 font-medium text-slate-700 truncate">{m.vendorName}</span>
                    <span className="text-slate-400 tabular-nums">{fmtN(m.from)} ← {fmtN(m.to)}</span>
                    <span className="font-bold text-red-600 tabular-nums w-12 text-end">{fmtN(m.delta)}</span>
                  </div>
                ))}
                {data.movers.decline.length === 0 && <div className="text-xs text-slate-400 py-3 text-center">—</div>}
              </div>
            </Card>
          </div>

          {/* Stability + category tops */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label={ar ? 'مورد فريد خلال الفترة' : 'Unique vendors'} value={fmtN(data.stability.uniqueVendors)} accent="text-slate-800" />
            <StatCard label={ar ? 'نشط في كل الأشهر' : 'Active all months'} value={fmtN(data.stability.stableAllMonths)} accent="text-emerald-600" />
            <StatCard label={ar ? 'دخل في آخر شهر' : 'New in last month'} value={fmtN(data.stability.newInLast)} accent="text-blue-600" />
            <StatCard label={ar ? 'توقف بعد أول شهر' : 'Stopped after first'} value={fmtN(data.stability.stoppedAfterFirst)} accent="text-amber-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(['signed', 'credit', 'cash'] as const).map((k) => (
              <Card key={k} title={ar ? `أعلى ${CATEGORY_LABELS[k].ar}` : `Top ${CATEGORY_LABELS[k].en}`} icon={<span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_LABELS[k].bar}`} />}>
                <div className="space-y-1">
                  {data.topByCategory[k].map((v, i) => (
                    <div key={v.vendorName} className="flex items-center gap-2 text-xs py-1 border-b border-slate-50">
                      <span className="w-4 text-slate-400 font-bold">{i + 1}</span>
                      <span className="flex-1 font-medium text-slate-700 truncate">{v.vendor ? <Link href={`/system/contracts/vendors/${v.vendor}`} className="hover:text-cyan-700">{v.vendorName}</Link> : v.vendorName}</span>
                      <span className="font-bold tabular-nums text-slate-800">{fmtN(v.totalOrders)}</span>
                    </div>
                  ))}
                  {data.topByCategory[k].length === 0 && <div className="text-xs text-slate-400 py-3 text-center">—</div>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Month data entry */}
      <Modal open={showEntry} onClose={() => setShowEntry(false)} title={ar ? 'إدخال أرقام تشغيل شهر' : 'Enter month utilisation'}
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowEntry(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إغلاق' : 'Close'}</button>
            <PrimaryButton onClick={saveEntry} disabled={saving || (!entry.vendorName && !entry.isExternal)}>{ar ? 'حفظ وإضافة التالي' : 'Save & next'}</PrimaryButton>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{ar ? 'أدخل عدد طلبات المورد في الشهر — الحفظ يحدّث كل التحليلات فورًا، وإعادة إدخال نفس المورد لنفس الشهر تصحّح الرقم.' : 'Saving updates every analysis immediately; re-entering the same vendor+month corrects it.'}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={ar ? 'السنة' : 'Year'}>
              <TextInput type="number" value={entry.year} onChange={(e) => setEntry({ ...entry, year: e.target.value })} dir="ltr" />
            </Field>
            <Field label={ar ? 'الشهر' : 'Month'}>
              <Select value={entry.month} onChange={(e) => setEntry({ ...entry, month: e.target.value })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{ar ? MONTH_AR[m] : m}</option>)}
              </Select>
            </Field>
          </div>
          <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={entry.isExternal} onChange={(e) => setEntry({ ...entry, isExternal: e.target.checked, vendorName: '' })} className="accent-red-600 w-4 h-4" />
            <span className="text-slate-700">{ar ? 'هذا رقم «الأفراد الخارجية» (بلا عقد)' : 'This is the external-individuals bucket'}</span>
          </label>
          {!entry.isExternal && (
            <Field label={ar ? 'المورد' : 'Vendor'}>
              <SearchableSelect value={entry.vendorName} onChange={(v) => setEntry({ ...entry, vendorName: v })}
                options={vendors.map((v) => ({ value: v.name, label: v.name, hint: v.headquarters }))}
                placeholder={ar ? '— اختر المورد —' : '— choose —'} searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search…'} />
            </Field>
          )}
          <Field label={ar ? 'عدد الطلبات في الشهر' : 'Orders in the month'}>
            <TextInput type="number" value={entry.orders} onChange={(e) => setEntry({ ...entry, orders: e.target.value })} dir="ltr" autoFocus />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
