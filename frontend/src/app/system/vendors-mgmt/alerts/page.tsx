'use client';
/**
 * Alerts: what needs the vendors team's action, computed from the shipments and the register, each with a state the
 * whole team shares (new / in progress / done): active carriers missing from the master, active without a signed
 * contract, master carriers that stopped, incomplete files, prices above the approved tier A, and one carrier
 * written under several names.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { LiveDot, fmtInt, fmtDay } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, vendorHref } from '@/lib/vendors';
import { BellRing, ChevronDown } from 'lucide-react';

type Row = Record<string, any>;
const TONE: Record<string, string> = { notInMaster: 'border-red-200', unsigned: 'border-orange-200', stopped: 'border-amber-200', missingData: 'border-amber-200', aboveApproved: 'border-sky-200', multiName: 'border-slate-200' };
const DOT: Record<string, string> = { notInMaster: 'bg-red-500', unsigned: 'bg-orange-500', stopped: 'bg-amber-400', missingData: 'bg-amber-400', aboveApproved: 'bg-sky-500', multiName: 'bg-slate-400' };
const STATES: [string, string, string, string][] = [['new', 'جديد', 'New', 'bg-slate-100 text-slate-700'], ['in_progress', 'قيد المتابعة', 'In progress', 'bg-amber-100 text-amber-800'], ['done', 'تمّ الإنجاز', 'Done', 'bg-emerald-100 text-emerald-800']];

export default function VendorsAlertsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [days, setDays] = useState(30);
  const [hideDone, setHideDone] = useState(true);
  const [ind, setInd] = useState(false);
  const [d, setD] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await api.get(`/api/vendors-mgmt/alerts?days=${days}&hideDone=${hideDone ? 1 : 0}&individuals=${ind ? 1 : 0}`)); setError(''); }
    catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, hideDone, ind]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1000); }, [load]);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:updated', soon);
  useSocket('shipmentOrders:fleet', soon);

  const setState = async (key: string, state: string) => {
    try { await api.post('/api/vendors-mgmt/alerts/state', { key, state }); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const totalOpen = d.groups.reduce((s: number, g: Row) => s + g.open, 0);

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BellRing className="w-6 h-6 text-[#f37121]" />} title={t('التنبيهات', 'Alerts')}
        subtitle={t(`${fmtInt(totalOpen)} بندٍ مفتوح · حالةُ كلّ تنبيهٍ مشتركةٌ بين الفريق كلّه`, `${fmtInt(totalOpen)} open items · every state is shared by the team`)}>
        <LiveDot ar={ar} busy={busy} />
        <ExportMenu fileName="vendor-alerts" lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('كلّ التنبيهات', 'All alerts'), sheets: d.groups.map((g: Row) => ({
          name: g.ar.slice(0, 30), rows: g.items, columns: [{ header: t('المورّد', 'Carrier'), key: 'name', width: 34 }, { header: t('النوع', 'Kind'), key: 'kind', transform: (v: string) => kindLabel(v, ar) }, { header: t('رحلات', 'Trips'), key: 'trips' }, { header: t('آخر رحلة', 'Last'), key: 'last' }, { header: t('التفاصيل', 'Detail'), key: 'detail', width: 40 }, { header: t('المتابعة', 'Owner'), key: 'owner' }, { header: t('الحالة', 'State'), key: 'state', transform: (v: string) => (STATES.find((s) => s[0] === v) || STATES[0])[ar ? 1 : 2] }],
        })) }]} />
      </PageHeader>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-center gap-3 text-[12.5px]">
        <label className="flex items-center gap-1.5">{t('الفترة', 'Window')}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white">
            {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{t(`آخر ${n} يومًا`, `Last ${n} days`)}</option>)}
          </select></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[#f37121]" />{t('إخفاء ما تمّ إنجازه', 'Hide done')}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={ind} onChange={(e) => setInd(e.target.checked)} className="accent-[#f37121]" />{t('تضمين السائقين الأفراد', 'Include freelancers')}</label>
      </div>
      <div className="space-y-3">
        {d.groups.map((g: Row) => {
          const isOpen = open[g.type] ?? g.open > 0;
          return (
            <section key={g.type} className={`rounded-2xl border bg-white shadow-sm ${TONE[g.type] || 'border-slate-200'}`}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.type]: !isOpen }))} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-start">
                <span className={`w-2.5 h-2.5 rounded-full ${DOT[g.type]}`} />
                <span className="font-bold text-slate-900">{g.ar}</span>
                <span className="text-[12px] text-slate-500">{t(`الإجراء: ${g.action}`, g.action)}</span>
                <span className="ms-auto rounded-full bg-slate-900 text-white px-2.5 py-0.5 text-[12px] font-bold tabular-nums">{g.open}<span className="opacity-60"> / {g.total}</span></span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-slate-50 text-slate-600"><tr>
                      <th className="px-3 py-2 text-start">#</th><th className="px-3 py-2 text-start">{t('المورّد', 'Carrier')}</th><th className="px-3 py-2 text-start">{t('النوع', 'Kind')}</th>
                      <th className="px-3 py-2 text-end">{g.type === 'aboveApproved' ? t('رحلات أعلى من A', 'Trips above A') : g.type === 'missingData' ? t('الناقص', 'Missing') : t('رحلات', 'Trips')}</th>
                      <th className="px-3 py-2 text-start">{t('آخر رحلة', 'Last trip')}</th><th className="px-3 py-2 text-start">{t('التفاصيل', 'Detail')}</th><th className="px-3 py-2 text-start">{t('الحالة', 'State')}</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.items.slice(0, 200).map((it: Row, i: number) => (
                        <tr key={it.key} className={it.state === 'done' ? 'opacity-60' : ''}>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2"><Link href={vendorHref(it)} className="font-semibold text-slate-900 hover:text-[#f37121]">{it.name}</Link>{it.owner && <span className="block text-[11px] text-slate-500">{it.owner}</span>}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full border text-[11px] ${KIND[it.kind]?.cls}`}>{kindLabel(it.kind, ar)}</span></td>
                          <td className="px-3 py-2 text-end tabular-nums">{g.type === 'missingData' ? it.count : fmtInt(it.trips)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtDay(it.last)}</td>
                          <td className="px-3 py-2 text-slate-700 max-w-[420px]">{it.detail || '—'}</td>
                          <td className="px-3 py-2">
                            <select value={it.state} onChange={(e) => setState(it.key, e.target.value)} className={`px-2 py-1 rounded-lg border-0 text-[12px] font-semibold ${(STATES.find((s) => s[0] === it.state) || STATES[0])[3]}`}>
                              {STATES.map(([k, a, e]) => <option key={k} value={k}>{ar ? a : e}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                      {!g.items.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">{t('لا تنبيهاتٍ مفتوحة', 'No open alerts')}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
