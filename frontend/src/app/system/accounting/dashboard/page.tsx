'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Calculator, RefreshCw, BookOpen, Scale, FileText, TrendingUp } from 'lucide-react';
import { isFinanceStaff, money } from '@/lib/finance';
import { Spinner, PageHeader, StatCard, PrimaryButton } from '@/components/hr/HRKit';

interface Dash {
  totals: { assets: number; liabilities: number; equity: number; revenue: number; expenses: number; netIncome: number };
  thisMonth: { revenue: number; expenses: number; netIncome: number };
  accountsReceivable: number; journalEntries: number; accountsCount: number;
}

export default function AccountingDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>('/api/accounting/dashboard')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('accounting:journal', useCallback(() => load(), [load]));

  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post<{ message: string }>('/api/accounting/sync'); alert(r.message); load(); }
    catch (e: any) { alert(e.message); }
    finally { setSyncing(false); }
  };

  if (!isFinanceStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;
  const t = data.totals;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Calculator className="w-5 h-5" />} title={ar ? 'الحسابات' : 'Accounting'} subtitle={ar ? 'المركز المالي' : 'Financial position'}>
        <PrimaryButton onClick={sync} disabled={syncing}><RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {ar ? 'ترحيل تلقائي' : 'Auto-post'}</PrimaryButton>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={ar ? 'الأصول' : 'Assets'} value={money(t.assets)} accent="text-blue-600" />
        <StatCard label={ar ? 'الالتزامات' : 'Liabilities'} value={money(t.liabilities)} accent="text-amber-700" />
        <StatCard label={ar ? 'حقوق الملكية' : 'Equity'} value={money(t.equity)} accent="text-purple-600" />
        <StatCard label={ar ? 'الذمم المدينة' : 'Receivables'} value={money(data.accountsReceivable)} accent="text-orange-600" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label={ar ? 'إيرادات الشهر' : 'Revenue (month)'} value={money(data.thisMonth.revenue)} accent="text-green-600" />
        <StatCard label={ar ? 'مصروفات الشهر' : 'Expenses (month)'} value={money(data.thisMonth.expenses)} accent="text-red-600" />
        <StatCard label={ar ? 'صافي الدخل (الشهر)' : 'Net income (month)'} value={money(data.thisMonth.netIncome)} accent={data.thisMonth.netIncome >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: '/system/accounting/accounts', icon: <BookOpen className="w-5 h-5" />, label: ar ? 'دليل الحسابات' : 'Chart of Accounts', sub: `${data.accountsCount}` },
          { href: '/system/accounting/journal', icon: <FileText className="w-5 h-5" />, label: ar ? 'القيود اليومية' : 'Journal', sub: `${data.journalEntries}` },
          { href: '/system/accounting/trial-balance', icon: <Scale className="w-5 h-5" />, label: ar ? 'ميزان المراجعة' : 'Trial Balance', sub: '' },
          { href: '/system/accounting/profit-loss', icon: <TrendingUp className="w-5 h-5" />, label: ar ? 'الأرباح والخسائر' : 'Profit & Loss', sub: '' },
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
