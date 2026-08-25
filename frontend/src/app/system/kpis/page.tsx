'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Gauge, Wallet, Users, TrendingUp, Briefcase, Truck, ShoppingBag } from 'lucide-react';
import { isKpiViewer, money, num } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import { getKpisTranslations } from '@/lib/translations';

interface Overview {
  finance: { accountsReceivable: number; paymentsThisMonth: number; revenueThisMonth: number; expensesThisMonth: number; netIncomeThisMonth: number };
  customers: { total: number; active: number };
  crm: { companies: number; openDeals: number; openPipelineValue: number; wonThisMonthValue: number; wonThisMonthCount: number; openTasks: number };
  hr: { activeEmployees: number; pendingLeaves: number };
  b2c: { ordersThisMonth: number };
  operations: { openWorkflows: number };
}

function Group({ icon, title, href, children }: { icon: React.ReactNode; title: string; href?: string; children: React.ReactNode }) {
  const head = (
    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
      <span className="text-[#f37121]">{icon}</span> {title}
    </h3>
  );
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      {href ? <Link href={href} className="hover:opacity-80">{head}</Link> : head}
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export default function KpisPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getKpisTranslations(lang);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Overview>('/api/kpi/overview')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));
  useSocket('accounting:journal', useCallback(() => load(), [load]));

  if (!isKpiViewer(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Gauge className="w-5 h-5" />} title={tx.pageTitle} subtitle={tx.pageSubtitle} />

      <OpsLiveSummary />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Group icon={<Wallet className="w-4 h-4" />} title={tx.finance} href="/system/accounting/dashboard">
          <StatCard label={tx.revenueMo} value={money(data.finance.revenueThisMonth)} accent="text-green-600" />
          <StatCard label={tx.expensesMo} value={money(data.finance.expensesThisMonth)} accent="text-red-600" />
          <StatCard label={tx.netIncome} value={money(data.finance.netIncomeThisMonth)} accent={data.finance.netIncomeThisMonth >= 0 ? 'text-green-600' : 'text-red-600'} />
          <StatCard label={tx.receivables} value={money(data.finance.accountsReceivable)} accent="text-amber-700" />
        </Group>

        <Group icon={<TrendingUp className="w-4 h-4" />} title={tx.salesCrm} href="/system/sales/dashboard">
          <StatCard label={tx.wonMo} value={money(data.crm.wonThisMonthValue)} accent="text-green-600" />
          <StatCard label={tx.pipeline} value={money(data.crm.openPipelineValue)} accent="text-amber-700" />
          <StatCard label={tx.openDeals} value={num(data.crm.openDeals)} />
          <StatCard label={tx.crmCompanies} value={num(data.crm.companies)} />
        </Group>

        <Group icon={<Users className="w-4 h-4" />} title={tx.customers} href="/system/customers">
          <StatCard label={tx.total} value={num(data.customers.total)} />
          <StatCard label={tx.active} value={num(data.customers.active)} accent="text-green-600" />
        </Group>

        <Group icon={<Briefcase className="w-4 h-4" />} title={tx.hr} href="/system/hr/master">
          <StatCard label={tx.activeEmployees} value={num(data.hr.activeEmployees)} />
          <StatCard label={tx.pendingLeaves} value={num(data.hr.pendingLeaves)} accent="text-amber-700" />
        </Group>

        <Group icon={<ShoppingBag className="w-4 h-4" />} title={tx.b2c} href="/system/b2c/dashboard">
          <StatCard label={tx.ordersMo} value={num(data.b2c.ordersThisMonth)} accent="text-blue-600" />
        </Group>

        <Group icon={<Truck className="w-4 h-4" />} title={tx.operations} href="/system/operations">
          <StatCard label={tx.openWorkflows} value={num(data.operations.openWorkflows)} accent="text-amber-700" />
        </Group>
      </div>
    </div>
  );
}
