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
  const ar = lang === 'ar';
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Overview>('/api/kpi/overview')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));
  useSocket('accounting:journal', useCallback(() => load(), [load]));

  if (!isKpiViewer(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Gauge className="w-5 h-5" />} title={ar ? 'مؤشرات الأداء (KPIs)' : 'KPIs'} subtitle={ar ? 'نظرة تنفيذية على كل الأقسام' : 'Executive view across all departments'} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Group icon={<Wallet className="w-4 h-4" />} title={ar ? 'المالية' : 'Finance'} href="/system/accounting/dashboard">
          <StatCard label={ar ? 'إيرادات الشهر' : 'Revenue (mo)'} value={money(data.finance.revenueThisMonth)} accent="text-green-600" />
          <StatCard label={ar ? 'مصروفات الشهر' : 'Expenses (mo)'} value={money(data.finance.expensesThisMonth)} accent="text-red-600" />
          <StatCard label={ar ? 'صافي الدخل' : 'Net Income'} value={money(data.finance.netIncomeThisMonth)} accent={data.finance.netIncomeThisMonth >= 0 ? 'text-green-600' : 'text-red-600'} />
          <StatCard label={ar ? 'الذمم المدينة' : 'Receivables'} value={money(data.finance.accountsReceivable)} accent="text-amber-700" />
        </Group>

        <Group icon={<TrendingUp className="w-4 h-4" />} title={ar ? 'المبيعات و CRM' : 'Sales & CRM'} href="/system/sales/dashboard">
          <StatCard label={ar ? 'مبيعات الشهر' : 'Won (mo)'} value={money(data.crm.wonThisMonthValue)} accent="text-green-600" />
          <StatCard label={ar ? 'قيمة المسار' : 'Pipeline'} value={money(data.crm.openPipelineValue)} accent="text-amber-700" />
          <StatCard label={ar ? 'صفقات مفتوحة' : 'Open Deals'} value={num(data.crm.openDeals)} />
          <StatCard label={ar ? 'شركات CRM' : 'CRM Companies'} value={num(data.crm.companies)} />
        </Group>

        <Group icon={<Users className="w-4 h-4" />} title={ar ? 'العملاء' : 'Customers'} href="/system/customers">
          <StatCard label={ar ? 'إجمالي العملاء' : 'Total'} value={num(data.customers.total)} />
          <StatCard label={ar ? 'نشطون' : 'Active'} value={num(data.customers.active)} accent="text-green-600" />
        </Group>

        <Group icon={<Briefcase className="w-4 h-4" />} title={ar ? 'الموارد البشرية' : 'HR'} href="/system/hr/dashboard">
          <StatCard label={ar ? 'موظفون نشطون' : 'Active Employees'} value={num(data.hr.activeEmployees)} />
          <StatCard label={ar ? 'إجازات معلّقة' : 'Pending Leaves'} value={num(data.hr.pendingLeaves)} accent="text-amber-700" />
        </Group>

        <Group icon={<ShoppingBag className="w-4 h-4" />} title={ar ? 'B2C' : 'B2C'} href="/system/b2c/dashboard">
          <StatCard label={ar ? 'طلبات الشهر' : 'Orders (mo)'} value={num(data.b2c.ordersThisMonth)} accent="text-blue-600" />
        </Group>

        <Group icon={<Truck className="w-4 h-4" />} title={ar ? 'العمليات' : 'Operations'} href="/system/operations">
          <StatCard label={ar ? 'عمليات مفتوحة' : 'Open Workflows'} value={num(data.operations.openWorkflows)} accent="text-amber-700" />
        </Group>
      </div>
    </div>
  );
}
