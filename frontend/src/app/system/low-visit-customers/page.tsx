'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { UserX, Search, ArrowLeft, Loader2, X, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { getLowVisitTranslations, getLowVisitCustomersExtraTranslations } from '@/lib/translations';

interface LowVisitCustomer {
  _id: string;
  companyName: string;
  customerNumber: string;
  currentOutstanding: number;
  riskLevel: string;
  assignedCollector: { _id: string; firstName: string; lastName: string } | null;
  totalTasks: number;
  lastTaskDate: string | null;
  daysSinceLastTask: number | null;
}

export default function LowVisitCustomersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getLowVisitTranslations(lang);
  const txx = getLowVisitCustomersExtraTranslations(lang);
  const [customers, setCustomers] = useState<LowVisitCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/tasks/low-visit-customers');
      setCustomers(data.customers || []);
    } catch (err) {
      console.error('Failed to load low visit customers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time updates
  useSocket('task:created', fetchData);
  useSocket('task:updated', fetchData);
  useSocket('task:deleted', fetchData);
  useSocket('customer:updated', fetchData);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 300);
  };

  const filtered = search
    ? customers.filter((c) => {
        const s = search.toLowerCase();
        return (
          c.companyName?.toLowerCase().includes(s) ||
          c.customerNumber?.toLowerCase().includes(s) ||
          (c.assignedCollector && `${c.assignedCollector.firstName} ${c.assignedCollector.lastName}`.toLowerCase().includes(s))
        );
      })
    : customers;

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
          <button
            type="button"
            onClick={() => router.push('/system/dashboard')}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            aria-label={txx.backToDashboard}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-lg bg-[#f59e0b]/20 flex items-center justify-center">
            <UserX className="w-5 h-5 text-[#f59e0b]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{filtered.length} {T.subtitle}</p>
          </div>
        </div>
        <button type="button" onClick={() => exportToExcel(filtered, [
          { header: txx.colCompanyName, key: 'companyName', width: 26 },
          { header: txx.colCustomerNumber, key: 'customerNumber', width: 16 },
          { header: txx.colOutstandingSar, key: 'currentOutstanding', transform: fmt.money, width: 20 },
          { header: txx.colRiskLevel, key: 'riskLevel', width: 12 },
          { header: txx.colAssignedCollector, key: 'assignedCollector', transform: (_: any, row: any) => row.assignedCollector ? `${row.assignedCollector.firstName} ${row.assignedCollector.lastName}` : '', width: 22 },
          { header: txx.colTotalTasks, key: 'totalTasks', width: 12 },
          { header: txx.colLastTaskDate, key: 'lastTaskDate', transform: fmt.date, width: 16 },
          { header: txx.colDaysSinceLastTask, key: 'daysSinceLastTask', transform: (v: number | null) => v !== null ? String(v) : txx.never, width: 22 },
        ], `low-visit-customers-${new Date().toISOString().split('T')[0]}`, T.title)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <Download className="w-4 h-4" /> {T.downloadExcel}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <div className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          ref={searchInputRef}
          type="text"
          placeholder={txx.searchPlaceholder}
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full ps-10 pe-10 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/50"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setSearch(''); searchInputRef.current?.focus(); }}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
            title={txx.clearSearch}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs mb-1">{T.customers}</p>
          <p className="text-2xl font-bold text-slate-900">{filtered.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs mb-1">{T.neverVisited}</p>
          <p className="text-2xl font-bold text-red-600">{filtered.filter((c) => c.totalTasks === 0).length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-slate-500 text-xs mb-1">{T.outstanding}</p>
          <p className="text-2xl font-bold text-[#f59e0b]">
            {filtered.reduce((sum, c) => sum + (c.currentOutstanding || 0), 0).toLocaleString()} SAR
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.customer}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.customer} #</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.outstanding}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.status}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.customer}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.actions}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.lastVisit}</th>
                <th className="px-4 py-3 text-start text-xs text-slate-300 font-semibold uppercase">{T.daysSinceLastVisit}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <UserX className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-700">{T.noCustomers}</p>
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors">
                    <td className="px-4 py-3 text-slate-900 font-medium">{c.companyName}</td>
                    <td className="px-4 py-3 text-slate-700">{c.customerNumber || '—'}</td>
                    <td className="px-4 py-3 text-red-600 font-medium">{c.currentOutstanding?.toLocaleString()} SAR</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        c.riskLevel === 'high' ? 'bg-red-500/20 text-red-600' :
                        c.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-700' :
                        'bg-green-500/20 text-green-600'
                      }`}>
                        {c.riskLevel || txx.notAvailable}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.assignedCollector ? `${c.assignedCollector.firstName} ${c.assignedCollector.lastName}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-center">{c.totalTasks}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.lastTaskDate ? new Date(c.lastTaskDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : T.neverVisited}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        c.daysSinceLastTask === null ? 'bg-red-500/20 text-red-600' :
                        c.daysSinceLastTask > 30 ? 'bg-red-500/20 text-red-600' :
                        c.daysSinceLastTask > 14 ? 'bg-yellow-500/20 text-yellow-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {c.daysSinceLastTask !== null ? `${c.daysSinceLastTask}` : T.neverVisited}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
