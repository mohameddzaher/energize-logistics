'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Building2, ArrowLeft, ArrowUpCircle, ArrowDownCircle, ShoppingCart,
  TrendingUp, Users, Wallet, Receipt, AlertTriangle, Lock, Unlock,
  Calendar, CalendarRange,
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletDashboardTranslations, getWalletDashboardBranchIdExtraTranslations } from '@/lib/translations';

interface WalletSummary {
  _id: string;
  user: { _id: string; firstName: string; lastName: string };
  branch: { _id: string; name: string };
  date: string;
  openingBalance: number;
  closingBalance: number;
  totalCollections: number;
  totalExpenses: number;
  totalPurchases: number;
  isClosed: boolean;
  actualCash: number | null;
  cashDifference: number | null;
  differenceReason: string;
  differenceNotes: string;
}

interface Transaction {
  _id: string;
  user: { firstName: string; lastName: string };
  type: 'collection' | 'expense' | 'purchase';
  amount: number;
  customer: { companyName: string; customerNumber: string } | null;
  invoice: { invoiceNumber: string; amount: number; balance: number } | null;
  deliveryStatementNumber: string;
  vendor: { name: string } | null;
  driver: { name: string } | null;
  expenseCategory: { name: string } | null;
  itemName: string;
  reference: string;
  notes: string;
  isFlagged: boolean;
  createdAt: string;
  date?: string;
  purchaseDeliveryStatementNumber?: string;
  purchaseDriverName?: string;
  purchaseReceiptNumber?: string;
  purchaseBranch?: string;
  purchaseInvoiceAmount?: number | null;
  collectionSource?: 'client' | 'company';
  description?: string;
  vendorName?: string;
  driverName?: string;
  operationDetails?: {
    client: string;
    from: string;
    to: string;
    carType: string;
    length: string;
    carNumber: string;
    reportDate: string | null;
    branch: string;
  };
}

interface Summary {
  totalCollections: number;
  totalExpenses: number;
  totalPurchases: number;
  netMovement: number;
  closingBalance: number;
  activeWallets: number;
}

const TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  collection: { color: 'text-green-600', bg: 'bg-green-500/20' },
  expense: { color: 'text-red-600', bg: 'bg-red-500/20' },
  purchase: { color: 'text-blue-600', bg: 'bg-blue-500/20' },
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type DateMode = 'single' | 'range';

export default function BranchWalletDashboardPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const branchId = params?.id as string;

  // Detect initial mode from URL params
  const initialDateFrom = searchParams?.get('dateFrom') || '';
  const initialDateTo = searchParams?.get('dateTo') || '';
  const initialMode: DateMode = (initialDateFrom && initialDateTo) ? 'range' : 'single';

  const [summary, setSummary] = useState<Summary | null>(null);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateMode, setDateMode] = useState<DateMode>(initialMode);
  const [selectedDate, setSelectedDate] = useState(searchParams?.get('date') || getTodayStr());
  const [dateFrom, setDateFrom] = useState(initialDateFrom || getTodayStr());
  const [dateTo, setDateTo] = useState(initialDateTo || getTodayStr());
  const { lang } = useLanguage();
  const T = getWalletDashboardTranslations(lang);
  const txx = getWalletDashboardBranchIdExtraTranslations(lang);
  const [branchName, setBranchName] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const fetchData = useCallback(async () => {
    try {
      let url: string;
      if (dateMode === 'range') {
        url = `/api/wallet/branch/${branchId}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
      } else {
        url = `/api/wallet/branch/${branchId}?date=${selectedDate}`;
      }
      const data = await api.get<any>(url);
      setSummary(data.summary);
      setWallets(data.wallets || []);
      setTransactions(data.transactions || []);
      if (data.wallets?.[0]?.branch?.name) setBranchName(data.wallets[0].branch.name);
    } catch {}
    setLoading(false);
  }, [branchId, dateMode, selectedDate, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleEvent = useCallback(() => fetchData(), [fetchData]);
  useSocket('wallet:transaction', handleEvent);
  useSocket('wallet:dayClosed', handleEvent);

  const dateLabel = dateMode === 'range' ? `${dateFrom}_to_${dateTo}` : selectedDate;
  const dateDisplay = dateMode === 'range' ? `${dateFrom} to ${dateTo}` : selectedDate;

  const walletColumns: ExportColumn[] = [
    { header: T.user, key: 'user', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 20 },
    ...(dateMode === 'range' ? [{ header: T.date, key: 'date', width: 12 }] : []),
    { header: txx.openingBalanceSar, key: 'openingBalance', transform: fmt.money, width: 20 },
    { header: txx.collectionsSar, key: 'totalCollections', transform: fmt.money, width: 18 },
    { header: txx.expensesSar, key: 'totalExpenses', transform: fmt.money, width: 18 },
    { header: txx.purchasesSar, key: 'totalPurchases', transform: fmt.money, width: 18 },
    { header: txx.closingBalanceSar, key: 'closingBalance', transform: fmt.money, width: 20 },
    { header: T.status, key: 'isClosed', transform: (v: any) => v ? T.closed : T.open, width: 10 },
    { header: txx.actualCashSar, key: 'actualCash', transform: (v: any, row: any) => v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : txx.notClosed), width: 18 },
    { header: txx.cashDifferenceSar, key: 'cashDifference', transform: (v: any, row: any) => v != null ? fmt.money(v) : (row?.isClosed ? fmt.money(0) : txx.notClosed), width: 20 },
  ];
  const txColumns: ExportColumn[] = [
    ...(dateMode === 'range' ? [{ header: T.date, key: 'date', width: 12 }] : []),
    { header: T.time, key: 'createdAt', transform: (v: any) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', width: 8 },
    { header: T.user, key: 'user', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 20 },
    { header: T.type, key: 'type', transform: (v: any) => v ? (txx[`type_${v}` as keyof typeof txx] || v.charAt(0).toUpperCase() + v.slice(1)) : '', width: 12 },
    { header: txx.amountSar, key: 'amount', transform: fmt.money, width: 15 },
    { header: txx.customer, key: 'customer', transform: (v: any) => v ? `${v.companyName} (${v.customerNumber})` : '', width: 25 },
    { header: txx.invoiceNo, key: 'invoice', transform: (v: any) => v?.invoiceNumber || '', width: 15 },
    { header: txx.invoiceAmount, key: 'invoice', transform: (v: any) => v?.amount != null ? fmt.money(v.amount) : '', width: 15 },
    { header: txx.invoiceBalance, key: 'invoice', transform: (v: any) => v?.balance != null ? fmt.money(v.balance) : '', width: 15 },
    { header: txx.deliveryStatementNo, key: 'deliveryStatementNumber', width: 20 },
    { header: txx.vendor, key: 'vendor', transform: (v: any) => v?.name || '', width: 18 },
    { header: txx.driver, key: 'driver', transform: (v: any) => v?.name || '', width: 18 },
    { header: txx.category, key: 'expenseCategory', transform: (v: any) => v?.name || '', width: 18 },
    { header: txx.itemDescription, key: 'itemName', width: 22 },
    { header: T.reference, key: 'reference', width: 15 },
    { header: T.client, key: 'operationDetails', transform: (v: any) => v?.client || '', width: 18 },
    { header: T.from, key: 'operationDetails', transform: (v: any) => v?.from || '', width: 15 },
    { header: T.to2, key: 'operationDetails', transform: (v: any) => v?.to || '', width: 15 },
    { header: txx.carTypeHeader, key: 'operationDetails', transform: (v: any) => v?.carType || '', width: 12 },
    { header: T.length, key: 'operationDetails', transform: (v: any) => v?.length || '', width: 10 },
    { header: T.carNumber, key: 'operationDetails', transform: (v: any) => v?.carNumber || '', width: 15 },
    { header: T.reportDate, key: 'operationDetails', transform: (v: any) => v?.reportDate ? new Date(v.reportDate).toLocaleDateString('en-GB') : '', width: 14 },
    { header: T.notes, key: 'notes', width: 25 },
    { header: txx.flagged, key: 'isFlagged', transform: fmt.yesNo, width: 8 },
  ];
  const safeBranchName = branchName || txx.branch;

  const filteredTx = transactions.filter((tx) => {
    if (typeFilter && tx.type !== typeFilter) return false;
    if (userFilter && `${tx.user.firstName} ${tx.user.lastName}` !== userFilter) return false;
    return true;
  });

  const uniqueUsers = [...new Set(transactions.map((t) => `${t.user.firstName} ${t.user.lastName}`))];

  // فلترا النوع والموظّف يعملان في الذاكرة على جدول الحركات وحده، وكان الزرّ
  // يصدّر الحركاتِ كلَّها دائمًا مهما ضيّق المستخدمُ الجدولَ أمامه — فيخرج ملفٌّ
  // لا يشبه الشاشة. النطاقان الآن يفصلان الحالتين، وشيتُ المحافظ لا يتأثّر بهما.
  const scope = exportScopeLabels(lang === 'ar');
  const walletSheet = { name: 'Wallets', rows: wallets as unknown as Record<string, any>[], columns: walletColumns };
  const hasActiveFilters = !!typeFilter || !!userFilter;
  const exportOptions = hasActiveFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [walletSheet, { name: 'Transactions', rows: filteredTx as unknown as Record<string, any>[], columns: txColumns }] },
        { key: 'all', label: scope.all, sheets: [walletSheet, { name: 'Transactions', rows: transactions as unknown as Record<string, any>[], columns: txColumns }] },
      ]
    : [{ key: 'all', label: scope.all, sheets: [walletSheet, { name: 'Transactions', rows: transactions as unknown as Record<string, any>[], columns: txColumns }] }];

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => router.push('/system/wallet-dashboard')}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{branchName || txx.branch} {T.dashboard}</h1>
            <p className="text-slate-500 text-sm">{dateDisplay}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Mode Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-slate-200">
            <button type="button" onClick={() => setDateMode('single')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'single' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
              <Calendar className="w-3.5 h-3.5" /> {T.day}
            </button>
            <button type="button" onClick={() => setDateMode('range')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'range' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
              <CalendarRange className="w-3.5 h-3.5" /> {T.range}
            </button>
          </div>

          {dateMode === 'single' ? (
            <>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.selectDate} />
              <button type="button" onClick={() => setSelectedDate(getTodayStr())}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{T.today}</button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.fromDate} />
                <span className="text-slate-500 text-sm">{T.to}</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.toDate} />
              </div>
              <button type="button" onClick={() => { setDateFrom(getTodayStr()); setDateTo(getTodayStr()); }}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{T.today}</button>
            </>
          )}

          <ExportMenu fileName={`${safeBranchName}_Wallet_${dateLabel}`} lang={lang === 'ar' ? 'ar' : 'en'} label={T.export} options={exportOptions} />
        </div>
      </div>

      {/* Date Range Indicator */}
      {dateMode === 'range' && (
        <div className="bg-[#f37121]/10 border border-[#f37121]/30 rounded-lg px-4 py-2 text-sm text-[#f37121] flex items-center gap-2">
          <CalendarRange className="w-4 h-4" />
          {T.showingData} <span className="font-medium">{dateFrom}</span> {T.to} <span className="font-medium">{dateTo}</span>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs mb-1">{T.collections}</p>
            <p className="text-xl font-bold text-green-600">+{summary.totalCollections.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs mb-1">{T.expenses}</p>
            <p className="text-xl font-bold text-red-600">-{summary.totalExpenses.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs mb-1">{T.purchases}</p>
            <p className="text-xl font-bold text-blue-600">-{summary.totalPurchases.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-[#f37121]/30 rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1">{T.netMovement}</p>
            <p className={`text-xl font-bold ${summary.netMovement >= 0 ? 'text-green-600' : 'text-red-600'}`}>{summary.netMovement.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-yellow-500/30 rounded-xl p-4">
            <p className="text-slate-500 text-xs mb-1">{T.closingBalance}</p>
            <p className="text-xl font-bold text-yellow-700">{(summary.closingBalance || 0).toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs mb-1">{T.activeWallets}</p>
            <p className="text-xl font-bold text-slate-900">{summary.activeWallets}</p>
          </div>
        </div>
      )}

      {/* Individual Wallets */}
      {wallets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[#f37121]" /> {T.individualWallets}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-200">
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.user}</th>
                  {dateMode === 'range' && <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.date}</th>}
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.opening}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.collections}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.expenses}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.purchases}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.closing}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.status}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.expected}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.actualCash}</th>
                  <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.difference}</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors">
                    <td className="px-4 py-3 text-slate-900 font-medium">{w.user?.firstName} {w.user?.lastName}</td>
                    {dateMode === 'range' && <td className="px-4 py-3 text-slate-800 text-xs">{w.date}</td>}
                    <td className="px-4 py-3 text-slate-700">{w.openingBalance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-green-600">+{w.totalCollections.toLocaleString()}</td>
                    <td className="px-4 py-3 text-red-600">-{w.totalExpenses.toLocaleString()}</td>
                    <td className="px-4 py-3 text-blue-600">-{w.totalPurchases.toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#f37121] font-medium">{w.closingBalance.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${w.isClosed ? 'bg-red-500/20 text-red-600' : 'bg-green-500/20 text-green-600'}`}>
                        {w.isClosed ? T.closed : T.open}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#f37121] font-medium text-xs">{w.closingBalance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{w.actualCash != null ? w.actualCash.toLocaleString() : <span className="text-slate-700">—</span>}</td>
                    <td className="px-4 py-3">
                      {w.cashDifference != null && w.cashDifference !== 0 ? (
                        <div>
                          <span className={`text-xs font-medium ${w.cashDifference > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {w.cashDifference > 0 ? `${T.deficit} -` : `${T.surplus} +`}{Math.abs(w.cashDifference).toLocaleString()}
                          </span>
                        </div>
                      ) : w.isClosed ? <span className="text-green-600 text-xs">{T.matched}</span> : <span className="text-slate-700">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={txx.filterByType}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
          <option value="">{T.allTypes}</option>
          <option value="collection">{T.collections}</option>
          <option value="expense">{T.expenses}</option>
          <option value="purchase">{T.purchases}</option>
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label={txx.filterByUser}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
          <option value="">{T.allUsers}</option>
          {uniqueUsers.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {/* Transaction Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-[#f37121]" /> {T.transactionLog} ({filteredTx.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                {dateMode === 'range' && <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.date}</th>}
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.time}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.user}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.type}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.customerVendor}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.amount}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.reference}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{lang === 'ar' ? 'رقم كشف التخريج' : 'DS #'}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.client}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.from}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.to2}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.carType}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.length}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.carNumber}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.reportDate}</th>
                <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.notes}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.length === 0 ? (
                <tr><td colSpan={dateMode === 'range' ? 16 : 15} className="text-center text-slate-800 py-12">{T.noTransactions}</td></tr>
              ) : filteredTx.map((tx) => {
                const tc = TYPE_COLORS[tx.type] || { color: 'text-slate-500', bg: 'bg-slate-100' };
                return (
                  <tr key={tx._id} className={`border-b border-slate-200/70 hover:bg-slate-100 transition-colors ${tx.isFlagged ? 'bg-red-500/5' : ''}`}>
                    {dateMode === 'range' && <td className="px-4 py-3 text-slate-800 text-xs">{tx.date || ''}</td>}
                    <td className="px-4 py-3 text-slate-800 text-xs">
                      {new Date(tx.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-slate-900 text-xs">{tx.user.firstName} {tx.user.lastName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${tc.bg} ${tc.color}`}>
                        {txx[`type_${tx.type}` as keyof typeof txx] || tx.type}
                      </span>
                      {tx.isFlagged && <AlertTriangle className="w-3 h-3 text-red-600 inline ms-1" />}
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">
                      <div>{tx.customer?.companyName || tx.vendor?.name || tx.driver?.name || tx.itemName || '—'}</div>
                      {tx.purchaseReceiptNumber && <div className="text-slate-700">{T.reference}: {tx.purchaseReceiptNumber}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-bold text-xs ${tx.type === 'collection' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'collection' ? '+' : '-'}{tx.amount.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-800 text-xs">{tx.reference || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{tx.deliveryStatementNumber || tx.purchaseDeliveryStatementNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.client || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.from || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.to || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.carType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.length || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.carNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{tx.operationDetails?.reportDate ? new Date(tx.operationDetails.reportDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-slate-800 text-xs max-w-[150px] truncate">{tx.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
