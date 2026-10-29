'use client';
/**
 * IT — the custody movement log: every receipt, handover, transfer, return,
 * damage and sale in one table, with who recorded it. Filter by period, action,
 * employee (giver or receiver), recorder, and search the item/serial/people.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { CUSTODY_ACTION_LABEL } from '@/lib/it';
import { Spinner, PageHeader, SearchableSelect } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

interface Ev {
  _id: string; date: string; at: string; action: string; condition: string; notes: string; price: number; buyerName: string;
  asset: { _id: string; name: string; serialNumber: string } | null;
  from: { _id: string; name: string; employeeNumber: string } | null;
  to: { _id: string; name: string; employeeNumber: string } | null;
  by: string; byName: string;
}

const TONE: Record<string, string> = {
  assigned: 'bg-blue-50 text-blue-700', transferred: 'bg-indigo-50 text-indigo-700', returned: 'bg-emerald-50 text-emerald-700',
  added_to_store: 'bg-slate-100 text-slate-700', damaged: 'bg-red-50 text-red-700', lost: 'bg-red-50 text-red-700',
  retired: 'bg-red-50 text-red-700', sold: 'bg-violet-50 text-violet-700', sale_returned: 'bg-violet-50 text-violet-700', updated: 'bg-amber-50 text-amber-700',
};
const dmy = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export default function CustodyLogPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const label = (k: string) => (CUSTODY_ACTION_LABEL[k] ? (ar ? CUSTODY_ACTION_LABEL[k].ar : CUSTODY_ACTION_LABEL[k].en) : k);

  const [events, setEvents] = useState<Ev[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [doers, setDoers] = useState<{ _id: string; name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [by, setBy] = useState('');
  const [employee, setEmployee] = useState('');
  const [q, setQ] = useState('');
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const mine = guard.begin();
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (action) p.set('action', action);
    if (by) p.set('by', by);
    if (employee) p.set('employee', employee);
    try {
      const d = await api.get<{ events: Ev[]; actions: string[]; doers: { _id: string; name: string; count: number }[] }>(`/api/it/custody/events?${p}`);
      if (!guard.isCurrent(mine)) return;
      setEvents(d.events || []); setActions(d.actions || []); setDoers(d.doers || []);
    } catch { /* keep the last result */ }
    setLoading(false);
  }, [from, to, action, by, employee, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:asset', load);
  useSocket('it:updated', load);

  // People seen in the log (givers/receivers), for the employee filter.
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) { if (e.from) m.set(e.from._id, e.from.name); if (e.to) m.set(e.to._id, e.to.name); }
    return [...m.entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [events]);
  const [peopleAll, setPeopleAll] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { if (!employee && people.length > peopleAll.length) setPeopleAll(people); }, [people, employee, peopleAll.length]);

  const fold = (v: string) => v.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const shown = useMemo(() => {
    const s = fold(q.trim());
    if (!s) return events;
    return events.filter((e) => fold([e.asset?.name, e.asset?.serialNumber, e.from?.name, e.from?.employeeNumber, e.to?.name, e.to?.employeeNumber, e.byName, e.notes, e.buyerName].join(' ')).includes(s));
  }, [events, q]);

  const columns: ExportColumn[] = [
    { header: t('التاريخ', 'Date'), key: 'date', transform: (v: any) => dmy(v), width: 12 },
    { header: t('الحركة', 'Movement'), key: 'action', transform: (v: any) => label(v), width: 20 },
    { header: t('الجهاز', 'Item'), key: 'asset', transform: (v: any) => v?.name || '', width: 24 },
    { header: t('الرقم التسلسلي', 'Serial'), key: 'asset', transform: (v: any) => v?.serialNumber || '', width: 18 },
    { header: t('من', 'From'), key: 'from', transform: (v: any) => v?.name || '', width: 24 },
    { header: t('إلى', 'To'), key: 'to', transform: (v: any, r: any) => v?.name || r.buyerName || '', width: 24 },
    { header: t('الحالة', 'Condition'), key: 'condition', width: 12 },
    { header: t('سجّلها', 'Recorded by'), key: 'byName', width: 20 },
    { header: t('وقت التسجيل', 'Recorded at'), key: 'at', transform: (v: any) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 20 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30 },
  ];
  const scope = exportScopeLabels(ar);
  const sel = 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800';
  const anyFilter = from || to || action || by || employee || q;

  if (loading) return <Spinner />;
  return (
    <div className="space-y-5" dir={ar ? 'rtl' : 'ltr'}>
      <PageHeader icon={<History className="w-5 h-5" />} title={t('سجل حركة العهد', 'Custody movement log')}
        subtitle={t('كل استلامٍ وتسليمٍ ونقلٍ وإرجاعٍ وتلفٍ وبيع — ومَن سجّله ومتى', 'Every receipt, handover, transfer, return, damage and sale — who recorded it and when')}>
        <Link href="/system/it/custody" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">{t('العهد والأجهزة', 'IT Custody')}</Link>
        <ExportMenu fileName="custody-log" lang={ar ? 'ar' : 'en'} variant="subtle" label={t('تصدير Excel', 'Export Excel')}
          options={[{ key: 'shown', label: scope.shown, sheets: [{ name: t('الحركات', 'Movements'), rows: shown, columns }] }]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[230px] flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالجهاز أو الرقم التسلسلي أو الاسم…', 'Item, serial or name…')}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm focus:border-[#f37121] focus:outline-none" />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={sel} aria-label={t('نوع الحركة', 'Movement')}>
          <option value="">{t('كل الحركات', 'All movements')}</option>
          {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <div className="w-56">
          <SearchableSelect value={employee} onChange={setEmployee} searchAfter={0} searchPlaceholder={t('ابحث بالاسم…', 'Search name…')}
            options={[{ value: '', label: t('كل الموظفين (مستلم أو مسلّم)', 'All employees') }, ...peopleAll]} />
        </div>
        <div className="w-52">
          <SearchableSelect value={by} onChange={setBy} searchAfter={0} searchPlaceholder={t('ابحث بالاسم…', 'Search name…')}
            options={[{ value: '', label: t('سجّلها: الكل', 'Recorded by: all') }, ...doers.map((d) => ({ value: d._id, label: d.name, hint: `${d.count}` }))]} />
        </div>
        <PeriodFilter from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); }} ar={ar} />
        {anyFilter && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); setAction(''); setBy(''); setEmployee(''); setQ(''); }}
            className="rounded-lg bg-[#f37121]/10 px-3 py-2 text-sm font-semibold text-[#f37121] hover:bg-[#f37121]/20">{t('مسح الفلاتر', 'Clear filters')}</button>
        )}
      </div>

      <p className="text-sm text-slate-500">{t(`${shown.length.toLocaleString('en-US')} حركة`, `${shown.length.toLocaleString('en-US')} movements`)}</p>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="bg-slate-900 text-[12px] text-slate-300">
              {[t('التاريخ', 'Date'), t('الحركة', 'Movement'), t('الجهاز', 'Item'), t('من', 'From'), t('إلى', 'To'), t('الحالة', 'Condition'), t('سجّلها', 'Recorded by'), t('ملاحظات', 'Notes')].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 text-start font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{t('لا حركات', 'No movements')}</td></tr>}
              {shown.slice(0, 1500).map((e) => (
                <tr key={e._id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{dmy(e.date)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE[e.action] || 'bg-slate-100 text-slate-700'}`}>{label(e.action)}</span></td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{e.asset?.name || '—'}</p>
                    {e.asset?.serialNumber && <p className="font-mono text-[11.5px] text-slate-500" dir="ltr">{e.asset.serialNumber}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{e.from ? <>{e.from.name}{e.from.employeeNumber ? <span className="text-slate-400"> · {e.from.employeeNumber}</span> : ''}</> : <span className="text-slate-400">{e.action === 'assigned' ? t('المستودع', 'Store') : '—'}</span>}</td>
                  <td className="px-4 py-3 text-slate-700">{e.to ? <>{e.to.name}{e.to.employeeNumber ? <span className="text-slate-400"> · {e.to.employeeNumber}</span> : ''}</> : <span className="text-slate-400">{e.buyerName || (e.action === 'returned' ? t('المستودع', 'Store') : '—')}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{e.condition || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="font-semibold text-slate-800">{e.byName || '—'}</p>
                    {e.at && <p className="text-[11px] text-slate-400">{new Date(e.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</p>}
                  </td>
                  <td className="max-w-[18rem] px-4 py-3 text-slate-600"><span className="line-clamp-2">{e.notes || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
