'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ShoppingCart, ClipboardList, FileText, Receipt } from 'lucide-react';
import { isProcStaff, money } from '@/lib/procurement';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';

interface Dash { prPending: number; openPOs: number; openPOValue: number; unpaidBills: number; spendThisMonth: number; }

export default function ProcurementDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>('/api/procurement/dashboard')); } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('procurement:pr', useCallback(() => load(), [load]));
  useSocket('procurement:po', useCallback(() => load(), [load]));
  useSocket('procurement:bill', useCallback(() => load(), [load]));

  if (!isProcStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading || !data) return <Spinner />;

  const cards = [
    { href: '/system/procurement/requests', icon: <ClipboardList className="w-5 h-5" />, label: ar ? 'طلبات شراء معلّقة' : 'Pending Requests', value: data.prPending, accent: 'text-amber-700' },
    { href: '/system/procurement/orders', icon: <FileText className="w-5 h-5" />, label: ar ? 'أوامر شراء مفتوحة' : 'Open Orders', value: data.openPOs },
    { href: '/system/procurement/orders', icon: <FileText className="w-5 h-5" />, label: ar ? 'قيمة الأوامر' : 'Orders Value', value: money(data.openPOValue), accent: 'text-blue-600' },
    { href: '/system/procurement/bills', icon: <Receipt className="w-5 h-5" />, label: ar ? 'فواتير غير مدفوعة' : 'Unpaid Bills', value: money(data.unpaidBills), accent: 'text-red-600' },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShoppingCart className="w-5 h-5" />} title={ar ? 'المشتريات' : 'Procurement'} subtitle={ar ? 'الطلبات والأوامر والفواتير' : 'Requests, orders & bills'} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => <Link key={i} href={c.href}><StatCard label={c.label} value={c.value} accent={c.accent} /></Link>)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label={ar ? 'إنفاق هذا الشهر' : 'Spend This Month'} value={money(data.spendThisMonth)} accent="text-purple-600" />
        <Link href="/system/accounting/payables"><StatCard label={ar ? 'الذمم الدائنة (A/P)' : 'Accounts Payable'} value={money(data.unpaidBills)} accent="text-orange-600" /></Link>
      </div>
      <p className="text-slate-500 text-sm">{ar ? 'دورة الشراء: طلب شراء → موافقة → أمر شراء → استلام → فاتورة مورّد (تُرحَّل تلقائيًا للذمم الدائنة في المحاسبة).' : 'Cycle: Request → Approval → Purchase Order → Receive → Vendor Bill (auto-posted to Accounting A/P).'}</p>
    </div>
  );
}
