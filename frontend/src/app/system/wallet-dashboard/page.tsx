'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Building2, Wallet, ArrowUpCircle, ArrowDownCircle, ShoppingCart,
  TrendingUp, Users, AlertTriangle, Download, Calendar, CalendarRange,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletDashboardTranslations } from '@/lib/translations';

interface BranchData {
  branch: { _id: string; name: string; code: string };
  totalCollections: number;
  totalExpenses: number;
  totalPurchases: number;
  netMovement: number;
  closingBalance: number;
  activeWallets: number;
  closedWallets: number;
  totalExpectedCash: number;
  totalActualCash: number;
  totalDifference: number;
}

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type DateMode = 'single' | 'range';

export default function WalletDashboardPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getWalletDashboardTranslations(lang);
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateMode, setDateMode] = useState<DateMode>('single');
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [dateFrom, setDateFrom] = useState(getTodayStr());
  const [dateTo, setDateTo] = useState(getTodayStr());

  const fetchDashboard = useCallback(async () => {
    try {
      let url: string;
      if (dateMode === 'range') {
        url = `/api/wallet/dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}`;
      } else {
        url = `/api/wallet/dashboard?date=${selectedDate}`;
      }
      const data = await api.get<any>(url);
      setBranches(data.branches || []);
    } catch {}
    setLoading(false);
  }, [dateMode, selectedDate, dateFrom, dateTo]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleEvent = useCallback(() => fetchDashboard(), [fetchDashboard]);
  useSocket('wallet:transaction', handleEvent);
  useSocket('wallet:dayClosed', handleEvent);
  useSocket('wallet:dayReopened', handleEvent);

  const dateLabel = dateMode === 'range' ? `${dateFrom}_to_${dateTo}` : selectedDate;

  const handleExportExcel = () => {
    if (branches.length === 0) return;
    const columns = [
      { header: 'Branch', key: 'branch.name', width: 20 },
      { header: 'Branch Code', key: 'branch.code', width: 12 },
      { header: 'Collections (SAR)', key: 'totalCollections', transform: fmt.money, width: 18 },
      { header: 'Expenses (SAR)', key: 'totalExpenses', transform: fmt.money, width: 18 },
      { header: 'Purchases (SAR)', key: 'totalPurchases', transform: fmt.money, width: 18 },
      { header: 'Net Movement (SAR)', key: 'netMovement', transform: fmt.money, width: 18 },
      { header: 'Closing Balance (SAR)', key: 'closingBalance', transform: fmt.money, width: 20 },
      { header: 'Active Wallets', key: 'activeWallets', width: 14 },
    ];
    exportToExcel(branches, columns, `Wallet_Dashboard_${dateLabel}`, 'Branches');
  };

  const totals = branches.reduce((acc, b) => ({
    collections: acc.collections + b.totalCollections,
    expenses: acc.expenses + b.totalExpenses,
    purchases: acc.purchases + b.totalPurchases,
    net: acc.net + b.netMovement,
    closing: acc.closing + (b.closingBalance || 0),
    wallets: acc.wallets + b.activeWallets,
  }), { collections: 0, expenses: 0, purchases: 0, net: 0, closing: 0, wallets: 0 });

  const buildBranchLink = (branchId: string) => {
    if (dateMode === 'range') {
      return `/system/wallet-dashboard/branch/${branchId}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    }
    return `/system/wallet-dashboard/branch/${branchId}?date=${selectedDate}`;
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{T.walletDashboard}</h1>
            <p className="text-gray-400 text-sm">{T.allBranchesOverview}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Date Mode Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button type="button" onClick={() => setDateMode('single')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'single' ? 'bg-[#f37121] text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              <Calendar className="w-3.5 h-3.5" /> {T.day}
            </button>
            <button type="button" onClick={() => setDateMode('range')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'range' ? 'bg-[#f37121] text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              <CalendarRange className="w-3.5 h-3.5" /> {T.range}
            </button>
          </div>

          {dateMode === 'single' ? (
            <>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label="Select date" />
              <button type="button" onClick={() => setSelectedDate(getTodayStr())}
                className="px-3 py-2 rounded-lg bg-gray-700 text-[#f37121] text-sm font-medium hover:bg-gray-600 transition-colors">{T.today}</button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label="From date" />
                <span className="text-gray-500 text-sm">{T.to}</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label="To date" />
              </div>
              <button type="button" onClick={() => { setDateFrom(getTodayStr()); setDateTo(getTodayStr()); }}
                className="px-3 py-2 rounded-lg bg-gray-700 text-[#f37121] text-sm font-medium hover:bg-gray-600 transition-colors">{T.today}</button>
            </>
          )}

          <button type="button" onClick={handleExportExcel} disabled={branches.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50" title="Export to Excel">
            <Download className="w-4 h-4" /> {T.export}
          </button>
        </div>
      </div>

      {/* Date Range Indicator */}
      {dateMode === 'range' && (
        <div className="bg-[#f37121]/10 border border-[#f37121]/30 rounded-lg px-4 py-2 text-sm text-[#f37121] flex items-center gap-2">
          <CalendarRange className="w-4 h-4" />
          {T.showingData} <span className="font-medium">{dateFrom}</span> {T.to} <span className="font-medium">{dateTo}</span>
        </div>
      )}

      {/* Total Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><ArrowUpCircle className="w-4 h-4 text-green-400" /><p className="text-gray-400 text-xs">{T.totalCollections}</p></div>
          <p className="text-xl font-bold text-green-400">{totals.collections.toLocaleString()} SAR</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><ArrowDownCircle className="w-4 h-4 text-red-400" /><p className="text-gray-400 text-xs">{T.totalExpenses}</p></div>
          <p className="text-xl font-bold text-red-400">{totals.expenses.toLocaleString()} SAR</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><ShoppingCart className="w-4 h-4 text-blue-400" /><p className="text-gray-400 text-xs">{T.totalPurchases}</p></div>
          <p className="text-xl font-bold text-blue-400">{totals.purchases.toLocaleString()} SAR</p>
        </div>
        <div className="bg-gray-800 border border-[#f37121]/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /><p className="text-gray-400 text-xs">{T.netMovement}</p></div>
          <p className={`text-xl font-bold ${totals.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totals.net.toLocaleString()} SAR</p>
        </div>
        <div className="bg-gray-800 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-yellow-400" /><p className="text-gray-400 text-xs">{T.closingBalance}</p></div>
          <p className="text-xl font-bold text-yellow-400">{totals.closing.toLocaleString()} SAR</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-gray-400" /><p className="text-gray-400 text-xs">{T.activeWallets}</p></div>
          <p className="text-xl font-bold text-white">{totals.wallets}</p>
        </div>
      </div>

      {/* Branch Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {branches.length === 0 ? (
          <div className="col-span-full bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
            <Building2 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">{T.noBranches}</p>
          </div>
        ) : branches.map((b) => (
          <button key={b.branch._id} type="button"
            onClick={() => router.push(buildBranchLink(b.branch._id))}
            className="bg-gray-800 border border-gray-700 rounded-xl p-5 text-left hover:border-[#f37121]/50 hover:bg-gray-800/80 transition-all group">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#f37121]" />
                <h3 className="text-white font-bold">{b.branch.name}</h3>
              </div>
              {b.branch.code && <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">{b.branch.code}</span>}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">{T.collections}</span>
                <span className="text-green-400 font-medium">+{b.totalCollections.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{T.expenses}</span>
                <span className="text-red-400 font-medium">-{b.totalExpenses.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{T.purchases}</span>
                <span className="text-blue-400 font-medium">-{b.totalPurchases.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700">
                <span className="text-gray-300 font-medium">{T.net}</span>
                <span className={`font-bold ${b.netMovement >= 0 ? 'text-green-400' : 'text-red-400'}`}>{b.netMovement.toLocaleString()} SAR</span>
              </div>
              <div className="flex justify-between">
                <span className="text-yellow-400 font-medium">{T.closingBalance}</span>
                <span className="font-bold text-yellow-400">{(b.closingBalance || 0).toLocaleString()} SAR</span>
              </div>
              {b.closedWallets > 0 && b.totalDifference !== 0 && (
                <div className="flex justify-between pt-2 border-t border-gray-700">
                  <span className={`font-medium ${b.totalDifference > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {b.totalDifference > 0 ? T.deficit : T.surplus}
                  </span>
                  <span className={`font-bold ${b.totalDifference > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {b.totalDifference > 0 ? '-' : '+'}{Math.abs(b.totalDifference).toLocaleString()} SAR
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs text-gray-500">
              <Users className="w-3 h-3" /> {b.activeWallets} {b.activeWallets !== 1 ? T.activeWalletPlural : T.activeWallet}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
