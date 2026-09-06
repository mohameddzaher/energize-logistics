'use client';
// Executive Overview — the owner's single-glance view of the WHOLE company. Every
// section (Finance, Operations, Location Solutions, B2C, HR, Vehicles, CRM, Sales,
// Procurement, Workshop, Tasks) is a tidy card cluster of clickable KPIs + a
// compact chart, fed by that section's OWN dashboard endpoint (so the numbers are
// the same tested aggregates each section shows). Live: refetches on key socket
// events and every 45s. Reuses each endpoint's server-side cache, and one slow /
// failing section never blocks the rest (Promise.allSettled).
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  LayoutDashboard, RefreshCw, ArrowRight, Wallet, Truck, Gauge, Users, Car, Building2,
  TrendingUp, ShoppingCart, Wrench, ListTodo, AlertTriangle, DollarSign, Package, Activity,
} from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';

type AnyObj = Record<string, any>;
const EXEC_ROLES = ['super_admin', 'admin'];

// ── formatting helpers ─────────────────────────────────────────────────────
const n = (v: any) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US'));
const money = (v: any) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const kMoney = (v: any) => {
  const x = Number(v);
  if (v == null || Number.isNaN(x)) return '—';
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (Math.abs(x) >= 1_000) return `${(x / 1_000).toFixed(0)}k`;
  return String(Math.round(x));
};

export default function ExecutiveOverviewPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  const [d, setD] = useState<AnyObj>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounce = useRef<any>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    // Each section pulls from its OWN dashboard endpoint (server-side cached).
    const jobs: { key: string; url: string }[] = [
      { key: 'finance', url: '/api/analytics/dashboard' },
      { key: 'overview', url: '/api/analytics/super-overview' },
      { key: 'ls2', url: '/api/ls2/dashboard' },
      { key: 'hr', url: '/api/hr/dashboard' },
      { key: 'vehicles', url: '/api/vehicles/dashboard' },
      { key: 'crm', url: '/api/crm/dashboard' },
      { key: 'sales', url: '/api/sales/dashboard' },
      { key: 'procurement', url: '/api/procurement/dashboard' },
    ];
    const results = await Promise.allSettled(jobs.map((j) => api.get<AnyObj>(j.url)));
    const next: AnyObj = {};
    results.forEach((r, i) => { next[jobs[i].key] = r.status === 'fulfilled' ? r.value : null; });
    setD(next);
    setUpdatedAt(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live: debounced refetch on the busiest section events + a slow safety poll.
  const kick = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(), 1500);
  }, [load]);
  useSocket('ls2:updated', kick);
  useSocket('ops:stats', kick);
  useSocket('payment:logged', kick);
  useSocket('invoice:created', kick);
  useSocket('workflow:bulkImported', kick);
  useEffect(() => { const id = setInterval(() => load(), 45000); return () => clearInterval(id); }, [load]);

  if (!EXEC_ROLES.includes(user?.role || '')) return <div className="text-slate-500 p-8">{t('You do not have access to this page', 'لا تملك صلاحية لهذه الصفحة')}</div>;
  if (loading) return <Spinner />;

  const fin = d.finance || {};
  const ov = d.overview || {};
  const ops = ov.operations || {};
  const b2c = ov.b2c || {};
  const wallet = ov.wallet || {};
  const roster = ov.roster || {};
  const tasks = ov.tasks || {};
  const service = ov.service || {};
  const ls2 = d.ls2 || {};
  const hr = (d.hr || {}).summary || {};
  const hrByStatus = (d.hr || {}).byStatus || [];
  const veh = (d.vehicles || {}).totals || {};
  const vehByStatus = (d.vehicles || {}).byStatus || {};
  const crm = d.crm || {};
  const sales = d.sales || {};
  const proc = d.procurement || {};

  const go = (href: string) => router.push(href);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]"><LayoutDashboard className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('Executive Overview', 'النظرة التنفيذية')}</h1>
            <p className="text-slate-500 text-sm">{t('Every section, every number — live', 'كل قسم وكل رقم — لحظيًا')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('Live', 'مباشر')}</span>
          <button type="button" onClick={() => load()} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {t('Refresh', 'تحديث')}</button>
        </div>
      </div>

      {/* ── FINANCE ── */}
      <Section icon={<DollarSign className="w-4 h-4" />} color="emerald" title={t('Finance & Collections', 'المالية والتحصيل')} href="/system/invoices" go={go} viewLabel={t('Open', 'فتح')}>
        <Kpis>
          <Kpi label={t('Outstanding', 'المستحقات')} value={money(fin.totalOutstanding)} accent="text-emerald-600" onClick={() => go('/system/invoices')} />
          <Kpi label={t('Collected (MTD)', 'المحصّل (الشهر)')} value={money(fin.monthlyCollected)} accent="text-emerald-600" onClick={() => go('/system/payments')} />
          <Kpi label={t('Collection Rate', 'نسبة التحصيل')} value={fin.collectionRate != null ? `${fin.collectionRate}%` : '—'} accent="text-slate-800" onClick={() => go('/system/payments')} />
          <Kpi label={t('DSO (days)', 'مدة التحصيل')} value={fin.dso != null ? n(fin.dso) : '—'} accent="text-slate-800" />
          <Kpi label={t('Overdue Invoices', 'فواتير متأخرة')} value={n(fin.overdueCount)} accent="text-red-600" onClick={() => go('/system/overdue')} />
          <Kpi label={t('Active Customers', 'عملاء نشطين')} value={n(fin.customerCount)} accent="text-slate-800" onClick={() => go('/system/customers')} />
        </Kpis>
      </Section>

      {/* ── OPERATIONS ── */}
      <Section icon={<Truck className="w-4 h-4" />} color="orange" title={t('Operations', 'العمليات')} href="/system/ops" go={go} viewLabel={t('Open', 'فتح')}
        chart={<StageBar data={Object.entries(ops.byStage || {}).map(([k, v]) => ({ name: k, value: Number(v) }))} color="#f37121" />}>
        <Kpis>
          <Kpi label={t('Total Shipments', 'إجمالي الشحنات')} value={n(ops.total)} accent="text-[#f37121]" onClick={() => go('/system/ops/shipments')} />
          <Kpi label={t('This Month', 'هذا الشهر')} value={n(ops.thisMonth)} accent="text-slate-800" trend={ops.trendPct} onClick={() => go('/system/ops')} />
          <Kpi label={t('Last Month', 'الشهر الماضي')} value={n(ops.lastMonth)} accent="text-slate-500" />
          <Kpi label={t('Drivers', 'السائقون')} value={n(roster.drivers)} accent="text-blue-600" onClick={() => go('/system/ops/drivers')} />
          <Kpi label={t('Branches', 'الفروع')} value={n(roster.branches)} accent="text-slate-800" />
          {/* roster.vendors counts the procurement Vendor collection — link to
              THAT list, not CRM's separate 3PL register (different numbers). */}
          <Kpi label={t('Vendors', 'الموردين')} value={n(roster.vendors)} accent="text-violet-600" onClick={() => go('/system/vendors')} />
        </Kpis>
      </Section>

      {/* ── LOCATION SOLUTIONS ── */}
      <Section icon={<Gauge className="w-4 h-4" />} color="blue" title={t('Location Solutions (Fleet Telemetry)', 'لوكيشن سوليوشن (تتبّع الأسطول)')} href="/system/ls2" go={go} viewLabel={t('Open', 'فتح')}
        chart={<MiniPie data={Object.entries(ls2.fleet?.statusCounts || {}).map(([k, v]) => ({ name: k, value: Number(v) }))} colors={{ moving: '#10b981', idle: '#f59e0b', stopped: '#94a3b8', offline: '#ef4444' }} />}>
        <Kpis>
          <Kpi label={t('Fleet Online', 'الأسطول متصل')} value={`${n(ls2.fleet?.online)} / ${n(ls2.fleet?.total)}`} accent="text-blue-600" onClick={() => go('/system/ls2/live')} />
          <Kpi label={t('Moving', 'تتحرك')} value={n(ls2.fleet?.statusCounts?.moving)} accent="text-emerald-600" onClick={() => go('/system/ls2/live?status=moving')} />
          <Kpi label={t('Critical Alerts', 'تنبيهات حرِجة')} value={n(ls2.alerts?.bySeverity?.critical)} accent="text-red-600" onClick={() => go('/system/ls2/alerts?severity=critical')} />
          <Kpi label={t('Service Due', 'صيانة قريبة')} value={n(ls2.maintenance?.dueCount)} accent="text-amber-600" onClick={() => go('/system/ls2/maintenance?filter=due')} />
          <Kpi label={t('Service Overdue', 'صيانة متأخرة')} value={n(ls2.maintenance?.overdueCount)} accent="text-red-600" onClick={() => go('/system/ls2/maintenance?filter=overdue')} />
          <Kpi label={t('Hot Tires', 'كاوتش ساخن')} value={n(ls2.temperature?.hotTires)} accent="text-orange-600" onClick={() => go('/system/ls2/temperature')} />
        </Kpis>
      </Section>

      {/* ── B2C ── */}
      <Section icon={<TrendingUp className="w-4 h-4" />} color="violet" title={t('B2C', 'B2C')} href="/system/b2c/dashboard" go={go} viewLabel={t('Open', 'فتح')}>
        <Kpis>
          <Kpi label={t('Orders (MTD)', 'الطلبات (الشهر)')} value={n(b2c.monthOrders)} accent="text-violet-600" trend={b2c.trendPct} onClick={() => go('/system/b2c/dashboard')} />
          <Kpi label={t('Reps', 'المناديب')} value={n(b2c.reps)} accent="text-slate-800" onClick={() => go('/system/b2c/reps')} />
          <Kpi label={t('Projects', 'المشاريع')} value={n(b2c.projects)} accent="text-slate-800" onClick={() => go('/system/b2c/projects')} />
          <Kpi label={t('Working Days', 'أيام العمل')} value={n(b2c.monthWorkingDays)} accent="text-slate-800" />
          {/* These two are the COLLECTORS' daily wallet (WalletTransaction /
              DailyWallet) — not the B2C عهدة ledger. Labeling them "custody"
              and linking to /b2c/custody showed the owner a different page
              with different numbers. */}
          <Kpi label={t('Collections Wallet In (MTD)', 'محفظة التحصيل — داخل (الشهر)')} value={money(wallet.monthInflow)} accent="text-emerald-600" onClick={() => go('/system/wallet-dashboard')} />
          <Kpi label={t('Collections Wallet Net (MTD)', 'محفظة التحصيل — صافي (الشهر)')} value={money(wallet.monthNet)} accent="text-slate-800" onClick={() => go('/system/wallet-dashboard')} />
        </Kpis>
      </Section>

      {/* ── HR ── */}
      <Section icon={<Users className="w-4 h-4" />} color="cyan" title={t('Human Resources', 'الموارد البشرية')} href="/system/hr/master" go={go} viewLabel={t('Open', 'فتح')}
        chart={<MiniPie data={(hrByStatus || []).map((s: AnyObj) => ({ name: s.status, value: Number(s.count) }))} colors={{ active: '#10b981', on_leave: '#f59e0b', suspended: '#f97316', terminated: '#ef4444' }} />}>
        <Kpis>
          <Kpi label={t('Employees', 'الموظفون')} value={n(hr.totalEmployees)} accent="text-cyan-600" onClick={() => go('/system/hr/employees')} />
          <Kpi label={t('Active', 'نشط')} value={n(hr.activeEmployees)} accent="text-emerald-600" onClick={() => go('/system/hr/employees')} />
          <Kpi label={t('Pending Leaves', 'إجازات معلّقة')} value={n(hr.pendingLeaves)} accent="text-amber-600" onClick={() => go('/system/hr/leaves')} />
          <Kpi label={t('Open Requests', 'طلبات مفتوحة')} value={n(hr.openRequests)} accent="text-amber-600" onClick={() => go('/system/hr/requests')} />
          <Kpi label={t('Expiring Docs (60d)', 'وثائق تنتهي (60ي)')} value={n(hr.expiringDocsCount)} accent="text-orange-600" onClick={() => go('/system/hr/employees')} />
          <Kpi label={t('Expired Docs', 'وثائق منتهية')} value={n(hr.expiredDocsCount)} accent="text-red-600" onClick={() => go('/system/hr/employees')} />
        </Kpis>
      </Section>

      {/* ── VEHICLES & AUTHORIZATIONS ── */}
      <Section icon={<Car className="w-4 h-4" />} color="amber" title={t('Vehicles & Authorizations', 'المركبات والتفاويض')} href="/system/vehicles/dashboard" go={go} viewLabel={t('Open', 'فتح')}
        chart={<MiniPie data={Object.entries(vehByStatus || {}).map(([k, v]) => ({ name: k, value: Number(v) }))} colors={{ authorized: '#10b981', parked: '#94a3b8', available: '#3b82f6', maintenance: '#f59e0b', out_of_service: '#ef4444' }} />}>
        <Kpis>
          <Kpi label={t('Total Vehicles', 'إجمالي المركبات')} value={n(veh.vehicles)} accent="text-amber-600" onClick={() => go('/system/vehicles')} />
          <Kpi label={t('Authorized', 'مفوّضة')} value={n(veh.authorized)} accent="text-emerald-600" onClick={() => go('/system/vehicles')} />
          <Kpi label={t('Active Authorizations', 'تفاويض نشطة')} value={n(veh.activeAuthorizations)} accent="text-slate-800" onClick={() => go('/system/vehicles')} />
          <Kpi label={t('Expiring Auths (30d)', 'تفاويض تنتهي (30ي)')} value={n(veh.expiringAuthorizations)} accent="text-orange-600" onClick={() => go('/system/vehicles')} />
          <Kpi label={t('Open Accidents', 'حوادث مفتوحة')} value={n(veh.openAccidents)} accent="text-red-600" onClick={() => go('/system/vehicles/accidents')} />
          <Kpi label={t('Accident Cost (est.)', 'تكلفة الحوادث (تقديري)')} value={money(veh.estimatedAccidentCost)} accent="text-slate-800" onClick={() => go('/system/vehicles/accidents')} />
        </Kpis>
      </Section>

      {/* ── CRM ── */}
      <Section icon={<Building2 className="w-4 h-4" />} color="indigo" title={t('CRM', 'إدارة العملاء')} href="/system/crm/dashboard" go={go} viewLabel={t('Open', 'فتح')}
        chart={<StageBar data={Object.entries(crm.dealsByStage || {}).map(([k, v]: [string, any]) => ({ name: k, value: Number(v?.count ?? v) }))} color="#6366f1" />}>
        <Kpis>
          <Kpi label={t('Companies', 'الشركات')} value={n(crm.companiesTotal)} accent="text-indigo-600" onClick={() => go('/system/crm/companies')} />
          <Kpi label={t('Contacts', 'جهات الاتصال')} value={n(crm.contactsTotal)} accent="text-slate-800" onClick={() => go('/system/crm/contacts')} />
          <Kpi label={t('Open Deals', 'صفقات مفتوحة')} value={n(crm.openDealsCount)} accent="text-slate-800" onClick={() => go('/system/crm/deals')} />
          <Kpi label={t('Pipeline Value', 'قيمة الصفقات')} value={money(crm.pipelineValue)} accent="text-emerald-600" onClick={() => go('/system/crm/deals')} />
          <Kpi label={t('Win Rate', 'نسبة الفوز')} value={crm.winRate != null ? `${crm.winRate}%` : '—'} accent="text-slate-800" />
          <Kpi label={t('Overdue Tasks', 'مهام متأخرة')} value={n(crm.overdueTasks)} accent="text-red-600" onClick={() => go('/system/crm/tasks')} />
        </Kpis>
      </Section>

      {/* ── SALES ── */}
      <Section icon={<TrendingUp className="w-4 h-4" />} color="green" title={t('Sales', 'المبيعات')} href="/system/sales/dashboard" go={go} viewLabel={t('Open', 'فتح')}>
        <Kpis>
          <Kpi label={t('Won (MTD)', 'مكتسبة (الشهر)')} value={money(sales.wonValue)} accent="text-green-600" onClick={() => go('/system/sales/dashboard')} />
          <Kpi label={t('Target', 'الهدف')} value={money(sales.teamTarget)} accent="text-slate-800" onClick={() => go('/system/sales/targets')} />
          <Kpi label={t('Attainment', 'التحقيق')} value={sales.attainment != null ? `${Math.round(sales.attainment)}%` : '—'} accent="text-slate-800" onClick={() => go('/system/sales/performance')} />
          <Kpi label={t('Win Rate', 'نسبة الفوز')} value={sales.winRate != null ? `${Math.round(sales.winRate)}%` : '—'} accent="text-slate-800" />
          <Kpi label={t('Open Pipeline', 'قيد التفاوض')} value={money(sales.openValue)} accent="text-slate-800" onClick={() => go('/system/sales/pipeline')} />
          <Kpi label={t('Avg Deal', 'متوسط الصفقة')} value={money(sales.avgDealSize)} accent="text-slate-800" />
        </Kpis>
      </Section>

      {/* ── PROCUREMENT ── */}
      <Section icon={<ShoppingCart className="w-4 h-4" />} color="rose" title={t('Procurement', 'المشتريات')} href="/system/procurement/dashboard" go={go} viewLabel={t('Open', 'فتح')}>
        <Kpis>
          <Kpi label={t('PRs Pending', 'طلبات شراء معلّقة')} value={n(proc.prPending)} accent="text-amber-600" onClick={() => go('/system/procurement/requests')} />
          <Kpi label={t('Open POs', 'أوامر شراء مفتوحة')} value={n(proc.openPOs)} accent="text-slate-800" onClick={() => go('/system/procurement/orders')} />
          <Kpi label={t('Open PO Value', 'قيمة الأوامر')} value={money(proc.openPOValue)} accent="text-slate-800" onClick={() => go('/system/procurement/orders')} />
          <Kpi label={t('Unpaid Bills', 'فواتير غير مدفوعة')} value={money(proc.unpaidBills)} accent="text-red-600" onClick={() => go('/system/procurement/bills')} />
          <Kpi label={t('Overdue Bills', 'فواتير متأخرة')} value={n(proc.overdueBillsCount)} accent="text-red-600" onClick={() => go('/system/procurement/bills')} />
          <Kpi label={t('Spend (MTD)', 'الإنفاق (الشهر)')} value={money(proc.spendThisMonth)} accent="text-slate-800" />
        </Kpis>
      </Section>

      {/* ── TASKS/SERVICE ──
          كان هنا لوحُ «الورشة» بجانبه. وقد أُزيل القسمُ من النظام — عملُه
          كلُّه في لوكيشن سوليوشن — فأُزيل لوحُه معه: بطاقةٌ تُضغَط فتفتح صفحةً
          محذوفةً أسوأُ من غيابها. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section icon={<ListTodo className="w-4 h-4" />} color="red" title={t('Tasks & Service', 'المهام والخدمة')} href="/system/tasks" go={go} viewLabel={t('Open', 'فتح')} compact>
          <Kpis compact>
            <Kpi label={t('Open Tasks', 'مهام مفتوحة')} value={n(tasks.open)} accent="text-slate-800" onClick={() => go('/system/tasks')} />
            <Kpi label={t('Due Today', 'مستحقة اليوم')} value={n(tasks.dueToday)} accent="text-amber-600" onClick={() => go('/system/tasks')} />
            <Kpi label={t('Open Complaints', 'شكاوى مفتوحة')} value={n(service.complaintsOpen)} accent="text-red-600" onClick={() => go('/system/complaints')} />
            <Kpi label={t('Open Disputes', 'نزاعات مفتوحة')} value={n(service.disputesOpen)} accent="text-red-600" onClick={() => go('/system/disputes')} />
          </Kpis>
        </Section>
      </div>

      {updatedAt && <p className="text-center text-xs text-slate-400">{t('Updated', 'آخر تحديث')} {new Date(updatedAt).toLocaleTimeString(ar ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
    </div>
  );
}

// ── Reusable pieces ─────────────────────────────────────────────────────────
const COLOR_BAR: Record<string, string> = {
  emerald: 'bg-emerald-500', orange: 'bg-[#f37121]', blue: 'bg-blue-500', violet: 'bg-violet-500',
  cyan: 'bg-cyan-500', amber: 'bg-amber-500', indigo: 'bg-indigo-500', green: 'bg-green-500',
  rose: 'bg-rose-500', slate: 'bg-slate-500', red: 'bg-red-500',
};
const COLOR_TEXT: Record<string, string> = {
  emerald: 'text-emerald-600', orange: 'text-[#f37121]', blue: 'text-blue-600', violet: 'text-violet-600',
  cyan: 'text-cyan-600', amber: 'text-amber-600', indigo: 'text-indigo-600', green: 'text-green-600',
  rose: 'text-rose-600', slate: 'text-slate-600', red: 'text-red-600',
};

function Section({ icon, color, title, href, go, viewLabel, children, chart, compact }: {
  icon: React.ReactNode; color: string; title: string; href: string; go: (h: string) => void; viewLabel: string;
  children: React.ReactNode; chart?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className={`h-1 ${COLOR_BAR[color] || 'bg-slate-300'}`} />
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className={`w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center ${COLOR_TEXT[color] || 'text-slate-600'}`}>{icon}</span>
            {title}
          </h2>
          <button type="button" onClick={() => go(href)} className="flex items-center gap-1 text-xs text-[#f37121] hover:underline shrink-0">{viewLabel} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" /></button>
        </div>
        {chart && !compact ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div className="lg:col-span-2">{children}</div>
            <div className="h-[160px]">{chart}</div>
          </div>
        ) : children}
      </div>
    </div>
  );
}

function Kpis({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={`grid gap-2.5 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>{children}</div>;
}

function Kpi({ label, value, accent, onClick, trend }: { label: string; value: React.ReactNode; accent?: string; onClick?: () => void; trend?: number | null }) {
  const clickable = !!onClick;
  return (
    <button type="button" onClick={onClick} disabled={!clickable}
      className={`text-start rounded-lg border border-slate-200 bg-slate-50/50 p-3 transition-all ${clickable ? 'hover:bg-white hover:border-[#f37121]/40 hover:shadow-sm cursor-pointer' : 'cursor-default'}`}>
      <p className="text-slate-500 text-[11px] leading-tight truncate" title={label}>{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <p className={`text-lg font-bold ${accent || 'text-slate-800'}`}>{value}</p>
        {trend != null && !Number.isNaN(trend) && (
          <span className={`text-[10px] font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{trend >= 0 ? '▲' : '▼'}{Math.abs(trend)}%</span>
        )}
      </div>
    </button>
  );
}

function StageBar({ data, color }: { data: { name: string; value: number }[]; color: string }) {
  const rows = data.filter((r) => r.value > 0);
  if (!rows.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={0} angle={-20} textAnchor="end" height={40} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={28} />
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MiniPie({ data, colors }: { data: { name: string; value: number }[]; colors: Record<string, string> }) {
  const rows = data.filter((r) => r.value > 0);
  if (!rows.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2}>
          {rows.map((r) => <Cell key={r.name} fill={colors[r.name] || '#94a3b8'} />)}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-slate-300 text-xs"><Activity className="w-4 h-4 me-1" /> —</div>;
}
