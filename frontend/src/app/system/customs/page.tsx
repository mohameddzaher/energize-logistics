'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Ship, Plus, Search, X, Check, Trash2, Loader2, ScrollText, Container, Download, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomsTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

interface Clearance {
  _id: string;
  refNumber: string;
  branch: 'jeddah' | 'dammam';
  stage: string;
  cancelled: boolean;
  blNumber?: string;
  customerName?: string;
  shippingAgent?: string;
  invoiceNumber?: string;
  port?: string;
  containerCount?: number;
  assignedTo?: string;
  createdAt: string;
  periodMonth?: number;
  periodYear?: number;
  city?: string;
  declarationNumber?: string;
  costs?: { total?: number };
  revenue?: { totalInvoiced?: number; clearanceFee?: number; profit?: number };
  billing?: { invoiceStatus?: string; ourInvoiceNumber?: string };
}

const MONTH_LABELS: [string, string][] = [
  ['يناير', 'January'], ['فبراير', 'February'], ['مارس', 'March'], ['أبريل', 'April'],
  ['مايو', 'May'], ['يونيو', 'June'], ['يوليو', 'July'], ['أغسطس', 'August'],
  ['سبتمبر', 'September'], ['أكتوبر', 'October'], ['نوفمبر', 'November'], ['ديسمبر', 'December'],
];

const STAGE_ORDER = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];

function stageBadge(stage: string, cancelled: boolean) {
  if (cancelled) return 'bg-slate-500/20 text-slate-600';
  if (stage === 'invoiced') return 'bg-green-500/20 text-green-600';
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx >= 7) return 'bg-blue-500/20 text-blue-600';
  if (idx >= 3) return 'bg-amber-500/20 text-amber-700';
  return 'bg-[#f37121]/20 text-[#f37121]';
}

const EMPTY = {
  branch: 'jeddah', blNumber: '', customerName: '', shippingAgent: '', shippingAgentEmail: '',
  invoiceNumber: '', port: '', invoiceType: '', containerCount: 0, currency: 'USD', assignedTo: '',
};

export default function CustomsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const router = useRouter();
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'].includes(user?.role || '');
  const canDelete = ['super_admin', 'admin', 'customs_manager'].includes(user?.role || '');
  const { lang } = useLanguage();
  const T = getCustomsTranslations(lang);

  const [list, setList] = useState<Clearance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [fYear, setFYear] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fInvoice, setFInvoice] = useState('');
  const ar = lang === 'ar';

  const fetchList = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/customs-clearance');
      setList(data.clearances || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);
  useSocket('customs:created', useCallback(() => fetchList(), [fetchList]));
  useSocket('customs:updated', useCallback(() => fetchList(), [fetchList]));
  useSocket('customs:deleted', useCallback(() => fetchList(), [fetchList]));

  const openCreate = () => { setForm({ ...EMPTY }); setShowModal(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await api.post<any>('/api/customs-clearance', form);
      setShowModal(false);
      fetchList();
      if (data?.clearance?._id) router.push(`/system/customs/${data.clearance._id}`);
    } catch (e: any) { notify(e?.message || 'Failed to save', 'error'); }
    setSaving(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!(await confirm(T.deleteClearance))) return;
    try { await api.delete(`/api/customs-clearance/${id}`); fetchList(); }
    catch (err: any) { notify(err?.message || 'Failed to delete', 'error'); }
  };

  const years = Array.from(new Set(list.map((c) => c.periodYear).filter(Boolean) as number[])).sort((a, b) => b - a);
  const invoiceStatuses = Array.from(new Set(list.map((c) => (c.billing?.invoiceStatus || '').trim()).filter(Boolean))).sort();

  const filtered = list.filter((c) => {
    const s = search.toLowerCase();
    if (s && ![c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.invoiceNumber, c.port, c.declarationNumber, c.billing?.ourInvoiceNumber]
      .some((v) => v && String(v).toLowerCase().includes(s))) return false;
    if (fYear && String(c.periodYear || '') !== fYear) return false;
    if (fMonth && String(c.periodMonth || '') !== fMonth) return false;
    if (fInvoice === '__none') { if ((c.billing?.invoiceStatus || '').trim()) return false; }
    else if (fInvoice && (c.billing?.invoiceStatus || '').trim() !== fInvoice) return false;
    return true;
  });

  const money = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const handleExport = () => {
    exportToExcel(filtered, [
      { header: T.refNumber, key: 'refNumber', width: 18 },
      { header: T.blNumber, key: 'blNumber', width: 18, transform: (v) => v || '—' },
      { header: T.customerName, key: 'customerName', width: 22, transform: (v) => v || '—' },
      { header: T.branch, key: 'branch', width: 14, transform: (v) => (v === 'dammam' ? T.dammam : T.jeddah) },
      { header: ar ? 'المدينة' : 'City', key: 'city', width: 14, transform: (v) => v || '—' },
      { header: ar ? 'الشهر' : 'Month', key: 'periodMonth', width: 12, transform: (v) => (v ? MONTH_LABELS[v - 1][ar ? 0 : 1] : '—') },
      { header: ar ? 'السنة' : 'Year', key: 'periodYear', width: 10, transform: (v) => v || '—' },
      { header: ar ? 'وكيل الشحن' : 'Shipping agent', key: 'shippingAgent', width: 20, transform: (v) => v || '—' },
      { header: ar ? 'رقم البيان' : 'Declaration no.', key: 'declarationNumber', width: 16, transform: (v) => v || '—' },
      { header: T.containerCount, key: 'containerCount', width: 14, transform: (v) => v || 0 },
      { header: ar ? 'إجمالي المصروفات' : 'Total costs', key: 'costs.total', width: 16, transform: money },
      { header: ar ? 'أجور التخليص' : 'Clearance fee', key: 'revenue.clearanceFee', width: 16, transform: money },
      { header: ar ? 'إجمالي الفاتورة' : 'Total invoiced', key: 'revenue.totalInvoiced', width: 16, transform: money },
      { header: ar ? 'صافي الربح' : 'Net profit', key: 'revenue.profit', width: 14, transform: money },
      { header: ar ? 'حالة الفاتورة' : 'Invoice status', key: 'billing.invoiceStatus', width: 16, transform: (v) => v || '—' },
      { header: ar ? 'رقم فاتورتنا' : 'Our invoice no.', key: 'billing.ourInvoiceNumber', width: 16, transform: (v) => v || '—' },
      { header: T.stage, key: 'stage', width: 20, transform: (v, r) => (r.cancelled ? T.cancelled : T.stages[v] || v) },
    ], 'customs-clearances', T.title);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Ship className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{list.length} {T.xTransactions}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/system/customs/analytics" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <BarChart3 className="w-4 h-4" /> {ar ? 'لوحة المعلومات' : 'Dashboard'}
          </Link>
          <Link href="/system/customs/guide" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <ScrollText className="w-4 h-4" /> {T.openGuide}
          </Link>
          <button type="button" onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <Download className="w-4 h-4" /> {lang === 'ar' ? 'تصدير Excel' : 'Export Excel'}
          </button>
          {canEdit && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" /> {T.addClearance}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder={T.searchClearance} value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <select value={fYear} onChange={(e) => setFYear(e.target.value)} className="cc-filter" aria-label={ar ? 'السنة' : 'Year'}>
          <option value="">{ar ? 'كل السنوات' : 'All years'}</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className="cc-filter" aria-label={ar ? 'الشهر' : 'Month'}>
          <option value="">{ar ? 'كل الأشهر' : 'All months'}</option>
          {MONTH_LABELS.map((m, i) => <option key={i} value={String(i + 1)}>{m[ar ? 0 : 1]}</option>)}
        </select>
        <select value={fInvoice} onChange={(e) => setFInvoice(e.target.value)} className="cc-filter" aria-label={ar ? 'حالة الفاتورة' : 'Invoice status'}>
          <option value="">{ar ? 'كل حالات الفاتورة' : 'All invoice statuses'}</option>
          {invoiceStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="__none">{ar ? 'غير مفوتر' : 'Not invoiced'}</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.refNumber}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.blNumber}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.customerName}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.branch}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{ar ? 'الفترة' : 'Period'}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.containerCount}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{ar ? 'إجمالي الفاتورة' : 'Invoiced'}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{ar ? 'حالة الفاتورة' : 'Invoice status'}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.stage}</th>
                {canDelete && <th className="text-end text-slate-300 font-semibold px-4 py-3">{T.actions}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.length === 0 ? (
                <tr><td colSpan={canDelete ? 10 : 9} className="text-center text-slate-800 py-12">{T.noClearances}</td></tr>
              ) : filtered.map((c) => (
                <tr key={c._id} onClick={() => router.push(`/system/customs/${c._id}`)}
                  className="bg-white hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-slate-900 font-medium">{c.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{c.blNumber || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{c.customerName || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{c.branch === 'dammam' ? T.dammam : T.jeddah}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {c.periodMonth ? `${MONTH_LABELS[c.periodMonth - 1][ar ? 0 : 1]} ${c.periodYear || ''}`.trim() : (c.periodYear || '—')}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="inline-flex items-center gap-1"><Container className="w-3.5 h-3.5 text-slate-700" />{c.containerCount || 0}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {money(c.revenue?.totalInvoiced) ? money(c.revenue?.totalInvoiced).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(c.billing?.invoiceStatus || '').trim()
                      ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-700">{c.billing?.invoiceStatus}</span>
                      : <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-600">{ar ? 'غير مفوتر' : 'Not invoiced'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${stageBadge(c.stage, c.cancelled)}`}>
                      {c.cancelled ? T.cancelled : T.stages[c.stage] || c.stage}
                    </span>
                  </td>
                  {canDelete && (
                    <td className="px-4 py-3 text-end">
                      <button type="button" onClick={(e) => handleDelete(e, c._id)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100 transition-colors" title={T.delete}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg">{T.addClearance}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white" aria-label={T.close}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                <Field label={T.branch}>
                  <select value={form.branch} onChange={(e) => setForm((f: any) => ({ ...f, branch: e.target.value }))} className="cc-input">
                    <option value="jeddah">{T.jeddah}</option>
                    <option value="dammam">{T.dammam}</option>
                  </select>
                </Field>
                <Field label={T.assignedTo}><input className="cc-input" value={form.assignedTo} onChange={(e) => setForm((f: any) => ({ ...f, assignedTo: e.target.value }))} /></Field>
                <Field label={T.blNumber}><input className="cc-input" value={form.blNumber} onChange={(e) => setForm((f: any) => ({ ...f, blNumber: e.target.value }))} /></Field>
                <Field label={T.customerName}><input className="cc-input" value={form.customerName} onChange={(e) => setForm((f: any) => ({ ...f, customerName: e.target.value }))} /></Field>
                <Field label={T.shippingAgent}><input className="cc-input" value={form.shippingAgent} onChange={(e) => setForm((f: any) => ({ ...f, shippingAgent: e.target.value }))} /></Field>
                <Field label={T.shippingAgentEmail}><input className="cc-input" value={form.shippingAgentEmail} onChange={(e) => setForm((f: any) => ({ ...f, shippingAgentEmail: e.target.value }))} /></Field>
                <Field label={T.invoiceNumber}><input className="cc-input" value={form.invoiceNumber} onChange={(e) => setForm((f: any) => ({ ...f, invoiceNumber: e.target.value }))} /></Field>
                <Field label={T.port}><input className="cc-input" value={form.port} onChange={(e) => setForm((f: any) => ({ ...f, port: e.target.value }))} /></Field>
                <Field label={T.invoiceType}>
                  <select value={form.invoiceType} onChange={(e) => setForm((f: any) => ({ ...f, invoiceType: e.target.value }))} className="cc-input">
                    <option value="">—</option><option value="C&F">C&F</option><option value="CIF">CIF</option><option value="FOB">FOB</option>
                  </select>
                </Field>
                <Field label={T.containerCount}><input type="number" className="cc-input" value={form.containerCount} onChange={(e) => setForm((f: any) => ({ ...f, containerCount: Number(e.target.value) }))} /></Field>
                <Field label={T.currency}><input className="cc-input" value={form.currency} onChange={(e) => setForm((f: any) => ({ ...f, currency: e.target.value }))} /></Field>
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{T.cancel}</button>
                <button type="button" onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        :global(.cc-input) {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border-radius: 0.5rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #0f172a;
          font-size: 0.875rem;
        }
        :global(.cc-input:focus) { outline: none; box-shadow: 0 0 0 2px rgba(243,113,33,0.4); }
        :global(.cc-filter) {
          padding: 0.6rem 0.75rem;
          border-radius: 0.5rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #0f172a;
          font-size: 0.875rem;
          min-width: 10rem;
        }
        :global(.cc-filter:focus) { outline: none; box-shadow: 0 0 0 2px rgba(243,113,33,0.4); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      {children}
    </div>
  );
}
