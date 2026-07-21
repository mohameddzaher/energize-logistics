'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Calculator, RefreshCw, BookOpen, Scale, FileText, TrendingUp, Wallet, Clock, ArrowRight, ArrowLeft } from 'lucide-react';
import { isFinanceStaff, money, fmtDate } from '@/lib/finance';
import { Spinner, PageHeader, StatCard, PrimaryButton } from '@/components/hr/HRKit';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import { getAccountingDashboardTranslations } from '@/lib/translations';

interface RecentEntry {
  _id: string; entryNumber: string; date?: string; memo: string; status: string;
  totalDebit: number; source: { type: string; auto?: boolean }; lineCount: number;
}
interface ExpenseAcct { id: string; code: string; nameEn: string; nameAr: string; amount: number; }
interface Dash {
  totals: { assets: number; liabilities: number; equity: number; revenue: number; expenses: number; netIncome: number };
  thisMonth: { revenue: number; expenses: number; netIncome: number };
  accountsReceivable: number; accountsPayable: number; cashBank: number;
  arAging: { current: number; d30: number; d60: number; d90: number; d90plus: number };
  topExpenses: ExpenseAcct[]; recentEntries: RecentEntry[]; openInvoiceCount: number;
  journalEntries: number; accountsCount: number;
}

export default function AccountingDashboardPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getAccountingDashboardTranslations(lang);
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>('/api/accounting/dashboard')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const reload = useCallback(() => load(), [load]);
  useSocket('accounting:journal', reload);
  useSocket('accounting:account', reload);

  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post<{ message: string }>('/api/accounting/sync'); notify(r.message); load(); }
    catch (e: any) { notify(e.message, 'error'); }
    finally { setSyncing(false); }
  };

  if (!isFinanceStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;
  const t = data.totals;
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  // Clickable wrapper to turn a StatCard into a drill-down link.
  const StatLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">{children}</Link>
  );

  const aging = [
    { label: ar ? 'مستحق حالياً' : 'Current', value: data.arAging.current, color: 'bg-green-500' },
    { label: ar ? '1-30 يوم' : '1–30 days', value: data.arAging.d30, color: 'bg-amber-400' },
    { label: ar ? '31-60 يوم' : '31–60 days', value: data.arAging.d60, color: 'bg-orange-500' },
    { label: ar ? '61-90 يوم' : '61–90 days', value: data.arAging.d90, color: 'bg-red-400' },
    { label: ar ? '+90 يوم' : '90+ days', value: data.arAging.d90plus, color: 'bg-red-600' },
  ];
  const agingMax = Math.max(1, ...aging.map((a) => a.value));
  const expMax = Math.max(1, ...data.topExpenses.map((e) => e.amount));
  const eqMax = Math.max(1, Math.abs(t.assets), Math.abs(t.liabilities), Math.abs(t.equity));

  const srcLabel = (s: string) => {
    const map: Record<string, [string, string]> = {
      manual: ['Manual', 'يدوي'], invoice: ['Invoice', 'فاتورة'], payment: ['Payment', 'دفعة'],
      wallet: ['Wallet', 'محفظة'], vendorbill: ['Vendor Bill', 'فاتورة مورد'], vendorpayment: ['Vendor Payment', 'دفعة مورد'],
    };
    const m = map[s] || [s, s];
    return ar ? m[1] : m[0];
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Calculator className="w-5 h-5" />} title={tx.title} subtitle={tx.subtitle}>
        <PrimaryButton onClick={sync} disabled={syncing}><RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {tx.autoPost}</PrimaryButton>
      </PageHeader>

      <OpsLiveSummary />

      {/* Position / balance sheet snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatLink href="/system/accounting/trial-balance"><StatCard label={tx.assets} value={money(t.assets)} accent="text-blue-600" /></StatLink>
        <StatLink href="/system/accounting/trial-balance"><StatCard label={tx.liabilities} value={money(t.liabilities)} accent="text-amber-700" /></StatLink>
        <StatLink href="/system/accounting/trial-balance"><StatCard label={tx.equity} value={money(t.equity)} accent="text-purple-600" /></StatLink>
        <StatLink href="/system/accounting/accounts"><StatCard label={ar ? 'النقدية والبنك' : 'Cash & Bank'} value={money(data.cashBank)} accent="text-emerald-600" /></StatLink>
      </div>

      {/* Receivables / payables / open invoices */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatLink href="/system/accounting/receivables"><StatCard label={tx.receivables} value={money(data.accountsReceivable)} accent="text-orange-600" /></StatLink>
        <StatLink href="/system/accounting/payables"><StatCard label={ar ? 'الذمم الدائنة' : 'Accounts Payable'} value={money(data.accountsPayable)} accent="text-rose-600" /></StatLink>
        <StatLink href="/system/accounting/receivables"><StatCard label={ar ? 'فواتير مفتوحة' : 'Open Invoices'} value={`${data.openInvoiceCount}`} accent="text-slate-900" /></StatLink>
        <StatLink href="/system/accounting/profit-loss"><StatCard label={ar ? 'صافي الدخل (إجمالي)' : 'Net Income (Total)'} value={money(t.netIncome)} accent={t.netIncome >= 0 ? 'text-green-600' : 'text-red-600'} /></StatLink>
      </div>

      {/* This-month P&L */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatLink href="/system/accounting/profit-loss"><StatCard label={tx.revenueMonth} value={money(data.thisMonth.revenue)} accent="text-green-600" /></StatLink>
        <StatLink href="/system/accounting/profit-loss"><StatCard label={tx.expensesMonth} value={money(data.thisMonth.expenses)} accent="text-red-600" /></StatLink>
        <StatLink href="/system/accounting/profit-loss"><StatCard label={tx.netIncomeMonth} value={money(data.thisMonth.netIncome)} accent={data.thisMonth.netIncome >= 0 ? 'text-green-600' : 'text-red-600'} /></StatLink>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AR aging */}
        <Link href="/system/accounting/receivables" className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 hover:border-[#f37121]/50 block">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-900 font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-[#f37121]" /> {ar ? 'تقادم الذمم المدينة' : 'AR Aging'}</h3>
            <Arrow className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3">
            {aging.map((a) => (
              <div key={a.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600">{a.label}</span>
                  <span className="text-slate-900 font-medium">{money(a.value)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${a.color}`} style={{ width: `${(a.value / agingMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Link>

        {/* Top expenses (this month) */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-900 font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-[#f37121]" /> {ar ? 'أعلى المصروفات (هذا الشهر)' : 'Top Expenses (This Month)'}</h3>
          </div>
          {data.topExpenses.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">{ar ? 'لا توجد مصروفات' : 'No expenses yet'}</p>
          ) : (
            <div className="space-y-3">
              {data.topExpenses.map((e) => (
                <Link key={e.id} href="/system/accounting/profit-loss" className="block group">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600 group-hover:text-[#f37121]">{e.code} · {ar ? e.nameAr : e.nameEn}</span>
                    <span className="text-slate-900 font-medium">{money(e.amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#f37121]" style={{ width: `${(e.amount / expMax) * 100}%` }} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Assets vs Liabilities vs Equity bar */}
      <Link href="/system/accounting/trial-balance" className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 hover:border-[#f37121]/50 block">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-900 font-semibold flex items-center gap-2"><Scale className="w-4 h-4 text-[#f37121]" /> {ar ? 'المركز المالي' : 'Financial Position'}</h3>
          <Arrow className="w-4 h-4 text-slate-400" />
        </div>
        <div className="space-y-3">
          {[
            { label: ar ? 'الأصول' : 'Assets', value: t.assets, color: 'bg-blue-500' },
            { label: ar ? 'الالتزامات' : 'Liabilities', value: t.liabilities, color: 'bg-amber-500' },
            { label: ar ? 'حقوق الملكية' : 'Equity', value: t.equity, color: 'bg-purple-500' },
          ].map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">{r.label}</span>
                <span className="text-slate-900 font-medium">{money(r.value)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: `${(Math.abs(r.value) / eqMax) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Link>

      {/* Recent journal entries */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-slate-900 font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-[#f37121]" /> {ar ? 'أحدث القيود اليومية' : 'Recent Journal Entries'}</h3>
          <Link href="/system/accounting/journal" className="text-[#f37121] text-sm font-medium flex items-center gap-1 hover:underline">{ar ? 'عرض الكل' : 'View all'} <Arrow className="w-3.5 h-3.5" /></Link>
        </div>
        {data.recentEntries.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center">{ar ? 'لا توجد قيود' : 'No entries yet'}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.recentEntries.map((e) => (
              <Link key={e._id} href="/system/accounting/journal" className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-900 text-sm font-medium">{e.entryNumber || (ar ? 'قيد' : 'Entry')}</span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{srcLabel(e.source.type)}</span>
                    {e.status !== 'posted' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{e.status}</span>}
                  </div>
                  <p className="text-slate-500 text-xs truncate max-w-[260px] sm:max-w-md">{e.memo || `${e.lineCount} ${ar ? 'سطر' : 'lines'}`}</p>
                </div>
                <div className="text-end shrink-0">
                  <p className="text-slate-900 text-sm font-semibold">{money(e.totalDebit)}</p>
                  <p className="text-slate-400 text-xs">{fmtDate(e.date)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: '/system/accounting/accounts', icon: <BookOpen className="w-5 h-5" />, label: tx.chartOfAccounts, sub: `${data.accountsCount}` },
          { href: '/system/accounting/journal', icon: <FileText className="w-5 h-5" />, label: tx.journal, sub: `${data.journalEntries}` },
          { href: '/system/accounting/trial-balance', icon: <Scale className="w-5 h-5" />, label: tx.trialBalance, sub: '' },
          { href: '/system/accounting/profit-loss', icon: <TrendingUp className="w-5 h-5" />, label: tx.profitLoss, sub: '' },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#f37121]/50 flex items-center gap-3 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-[#f37121]/15 text-[#f37121] flex items-center justify-center">{c.icon}</div>
            <div><p className="text-slate-900 text-sm font-medium">{c.label}</p>{c.sub && <p className="text-slate-500 text-xs">{c.sub}</p>}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
