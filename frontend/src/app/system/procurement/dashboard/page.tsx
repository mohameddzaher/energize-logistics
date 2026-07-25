'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ShoppingCart, ClipboardList, FileText, Receipt, AlertTriangle, Building2, ArrowRight } from 'lucide-react';
import { isProcStaff, money, vendorName, userName, fmtDate, PR_STATUS_STYLE, PO_STATUS_STYLE, BILL_STATUS_STYLE, PRIORITY_STYLE } from '@/lib/procurement';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import { getProcurementDashboardTranslations } from '@/lib/translations';
import type { ProcDashboard } from '@/lib/procurement';

export default function ProcurementDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getProcurementDashboardTranslations(lang);
  const [data, setData] = useState<ProcDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<ProcDashboard>('/api/procurement/dashboard')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('procurement:pr', useCallback(() => load(), [load]));
  useSocket('procurement:po', useCallback(() => load(), [load]));
  useSocket('procurement:bill', useCallback(() => load(), [load]));

  if (!isProcStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  const cards = [
    { href: '/system/procurement/requests?status=pending_approval', icon: <ClipboardList className="w-5 h-5" />, label: ar ? 'موافقات معلقة' : 'Pending Approvals', value: data.prPending, accent: 'text-amber-700' },
    { href: '/system/procurement/orders', icon: <FileText className="w-5 h-5" />, label: tx.openOrders, value: data.openPOs },
    { href: '/system/procurement/orders', icon: <FileText className="w-5 h-5" />, label: ar ? 'قيمة الطلبات المفتوحة' : 'Open PO Value', value: money(data.openPOValue), accent: 'text-blue-600' },
    { href: '/system/procurement/bills?status=unpaid', icon: <Receipt className="w-5 h-5" />, label: ar ? `الفواتير غير المدفوعة (${data.unpaidBillsCount})` : `Unpaid Bills (${data.unpaidBillsCount})`, value: money(data.unpaidBills), accent: 'text-red-600' },
  ];

  // Status order maps for stable, styled breakdown chips.
  const prOrder = ['draft', 'pending_approval', 'approved', 'rejected', 'ordered'];
  const poOrder = ['draft', 'sent', 'partially_received', 'received', 'billed', 'cancelled'];
  const sortBy = (rows: { status: string; count: number; value: number }[], order: string[]) =>
    [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShoppingCart className="w-5 h-5" />} title={tx.procurement} subtitle={tx.headerSubtitle} />

      <OpsLiveSummary />

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => <Link key={i} href={c.href}><StatCard label={c.label} value={c.value} accent={c.accent} /></Link>)}
      </div>

      {/* Spend + payables + overdue */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/system/procurement/bills">
          <StatCard label={ar ? `الإنفاق هذا الشهر (${data.spendThisMonthCount} فاتورة)` : `Spend This Month (${data.spendThisMonthCount} bills)`} value={money(data.spendThisMonth)} accent="text-purple-600" />
        </Link>
        <Link href="/system/accounting/payables">
          <StatCard label={ar ? 'إجمالي الذمم الدائنة' : 'Accounts Payable'} value={money(data.unpaidBills)} accent="text-orange-600" />
        </Link>
        <Link href="/system/procurement/bills?status=unpaid">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs flex items-center gap-1">
              {data.overdueBillsCount > 0 && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
              {ar ? `فواتير متأخرة (${data.overdueBillsCount})` : `Overdue Bills (${data.overdueBillsCount})`}
            </p>
            <p className={`text-2xl font-bold mt-1 ${data.overdueBillsCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{money(data.overdueBills)}</p>
          </div>
        </Link>
      </div>

      {/* Status breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Breakdown title={ar ? 'طلبات الشراء حسب الحالة' : 'Purchase Requests by Status'} rows={sortBy(data.prByStatus, prOrder)} styles={PR_STATUS_STYLE} hrefBase="/system/procurement/requests" lang={lang} ar={ar} />
        <Breakdown title={ar ? 'أوامر الشراء حسب الحالة' : 'Purchase Orders by Status'} rows={sortBy(data.poByStatus, poOrder)} styles={PO_STATUS_STYLE} hrefBase="/system/procurement/orders" lang={lang} ar={ar} />
      </div>

      {/* Top vendors this month */}
      {data.topVendors.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <SectionHead title={ar ? 'أكبر الموردين (هذا الشهر)' : 'Top Vendors (This Month)'} href="/system/procurement/bills" ar={ar} icon={<Building2 className="w-4 h-4" />} />
          <div className="divide-y divide-slate-100">
            {data.topVendors.map((v) => {
              const max = data.topVendors[0]?.total || 1;
              return (
                <Link key={v._id} href={`/system/procurement/bills?vendor=${v._id}`} className="block px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-800 truncate">{v.name}</span>
                    <span className="text-slate-500 shrink-0">{money(v.total)} · {v.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, (v.total / max) * 100)}%`, backgroundColor: '#f37121' }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent PRs */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <SectionHead title={ar ? 'أحدث طلبات الشراء' : 'Recent Purchase Requests'} href="/system/procurement/requests" ar={ar} icon={<ClipboardList className="w-4 h-4" />} />
          <ListBody empty={ar ? 'لا توجد طلبات' : 'No requests'} rows={data.recentPRs} render={(p) => (
            <Link key={p._id} href="/system/procurement/requests" className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{p.title}</p>
                <p className="text-xs text-slate-500">{p.requestNumber} · {userName(p.requester)} · {fmtDate(p.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-slate-700">{money(p.totalEstimate)}</span>
                <Chip style={PR_STATUS_STYLE[p.status]} ar={ar} />
              </div>
            </Link>
          )} />
        </div>

        {/* Recent POs */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <SectionHead title={ar ? 'أحدث أوامر الشراء' : 'Recent Purchase Orders'} href="/system/procurement/orders" ar={ar} icon={<FileText className="w-4 h-4" />} />
          <ListBody empty={ar ? 'لا توجد أوامر' : 'No orders'} rows={data.recentPOs} render={(p) => (
            <Link key={p._id} href="/system/procurement/orders" className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{vendorName(p.vendor)}</p>
                <p className="text-xs text-slate-500">{p.poNumber} · {ar ? 'متوقع' : 'exp'} {fmtDate(p.expectedDate)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-slate-700">{money(p.total)}</span>
                <Chip style={PO_STATUS_STYLE[p.status]} ar={ar} />
              </div>
            </Link>
          )} />
        </div>
      </div>

      {/* Unpaid bills */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <SectionHead title={ar ? 'الفواتير غير المدفوعة' : 'Unpaid Bills'} href="/system/procurement/bills?status=unpaid" ar={ar} icon={<Receipt className="w-4 h-4" />} />
        <ListBody empty={ar ? 'لا توجد فواتير مستحقة' : 'No outstanding bills'} rows={data.unpaidBillsList} render={(b) => {
          const overdue = b.dueDate && new Date(b.dueDate) < new Date();
          return (
            <Link key={b._id} href="/system/procurement/bills" className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{vendorName(b.vendor)}</p>
                <p className="text-xs text-slate-500">{b.billNumber}{b.vendorInvoiceNumber ? ` · ${b.vendorInvoiceNumber}` : ''} · {ar ? 'استحقاق' : 'due'} <span className={overdue ? 'text-red-600 font-medium' : ''}>{fmtDate(b.dueDate)}</span></p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-red-600 font-medium">{money(b.balance)}</span>
                <Chip style={BILL_STATUS_STYLE[b.status]} ar={ar} />
              </div>
            </Link>
          );
        }} />
      </div>

      <p className="text-slate-500 text-sm">{tx.cycleNote}</p>
    </div>
  );
}

// ── Small presentational helpers (inline, page-local) ────────────────────────
function SectionHead({ title, href, ar, icon }: { title: string; href: string; ar: boolean; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2"><span className="text-[#f37121]">{icon}</span>{title}</h3>
      <Link href={href} className="text-xs text-[#f37121] hover:underline flex items-center gap-1">{ar ? 'عرض الكل' : 'View all'} <ArrowRight className="w-3 h-3 rtl:rotate-180" /></Link>
    </div>
  );
}

function ListBody<T>({ rows, render, empty }: { rows: T[]; render: (r: T) => React.ReactNode; empty: string }) {
  if (!rows || rows.length === 0) return <p className="px-4 py-6 text-sm text-slate-400 text-center">{empty}</p>;
  return <div className="divide-y divide-slate-100">{rows.map(render)}</div>;
}

function Chip({ style, ar }: { style?: { bg: string; text: string; en: string; ar: string }; ar: boolean }) {
  if (!style) return null;
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text}`}>{ar ? style.ar : style.en}</span>;
}

function Breakdown({ title, rows, styles, hrefBase, lang, ar }: {
  title: string;
  rows: { status: string; count: number; value: number }[];
  styles: Record<string, { bg: string; text: string; en: string; ar: string }>;
  hrefBase: string; lang: 'en' | 'ar'; ar: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <h3 className="font-semibold text-slate-900 text-sm mb-3">{title} <span className="text-slate-400 font-normal">({total})</span></h3>
      {rows.length === 0 ? <p className="text-sm text-slate-400">{ar ? 'لا توجد بيانات' : 'No data'}</p> : (
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => {
            const st = styles[r.status];
            return (
              <Link key={r.status} href={`${hrefBase}?status=${r.status}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#f37121] hover:bg-slate-50 transition-colors text-sm">
                <Chip style={st} ar={ar} />
                <span className="font-bold text-slate-900">{r.count}</span>
                <span className="text-xs text-slate-400">{money(r.value)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
