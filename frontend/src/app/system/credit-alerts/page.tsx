'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getCreditAlertsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import DataTable from '@/components/system/DataTable';
import { useSocket } from '@/hooks/useSocket';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, TrendingUp, Shield, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

export default function CreditAlertsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const T = getCreditAlertsTranslations(lang);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const result = await api.get<any>('/api/analytics/credit-alerts');
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useSocket('payment:logged', fetchData);
  useSocket('invoice:created', fetchData);
  useSocket('customer:updated', fetchData);

  const columns = [
    {
      key: 'companyName',
      label: T.companyName,
      render: (_: any, row: any) => (
        <div>
          <span className="text-slate-900 font-medium text-sm">{row.companyName}</span>
          {row.customerNumber && <span className="text-slate-500 text-xs block">{row.customerNumber}</span>}
        </div>
      ),
    },
    {
      key: 'creditLimit',
      label: T.creditLimit,
      render: (val: number) => <span className="text-slate-900 text-sm">{'SAR ' + Math.round(val || 0).toLocaleString('en-US')}</span>,
    },
    {
      key: 'currentOutstanding',
      label: T.currentOutstanding,
      render: (val: number) => <span className="text-red-600 text-sm font-medium">{'SAR ' + Math.round(val || 0).toLocaleString('en-US')}</span>,
    },
    {
      key: 'remaining',
      label: 'Remaining',
      render: (val: number, row: any) => (
        <span className={`text-sm font-medium ${val < 0 ? 'text-red-600' : val < row.creditLimit * 0.2 ? 'text-yellow-700' : 'text-green-600'}`}>
          {'SAR ' + Math.round(val || 0).toLocaleString('en-US')}
        </span>
      ),
    },
    {
      key: 'usagePercent',
      label: T.usage,
      render: (val: number) => (
        <div className="flex items-center gap-2">
          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${val > 100 ? 'bg-red-500' : val >= 90 ? 'bg-orange-500' : val >= 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(100, val)}%` }}
            />
          </div>
          <span className={`text-xs font-bold ${val > 100 ? 'text-red-600' : val >= 90 ? 'text-orange-600' : 'text-yellow-700'}`}>
            {val}%
          </span>
        </div>
      ),
    },
    {
      key: 'grade',
      label: 'Grade',
      render: (val: string) => {
        const colors: Record<string, string> = { A: 'text-green-600 bg-green-500/20', B: 'text-blue-600 bg-blue-500/20', C: 'text-yellow-700 bg-yellow-500/20', D: 'text-red-600 bg-red-500/20' };
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[val] || 'text-slate-500 bg-slate-500/20'}`}>{val || '-'}</span>;
      },
    },
    {
      key: 'creditTerm',
      label: 'Credit Term',
      render: (val: number) => <span className="text-slate-700 text-sm">{val} days</span>,
    },
    {
      key: 'assignedCollector',
      label: 'Collector',
      render: (_: any, row: any) => (
        <span className="text-slate-700 text-sm">
          {row.assignedCollector ? `${row.assignedCollector.firstName} ${row.assignedCollector.lastName}` : '-'}
        </span>
      ),
    },
    {
      key: 'lastPaymentDate',
      label: 'Last Payment',
      render: (val: string, row: any) => val ? (
        <div>
          <span className="text-slate-700 text-xs">{new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          {row.lastPaymentAmount && <span className="text-green-600 text-xs block">{'SAR ' + Math.round(row.lastPaymentAmount).toLocaleString('en-US')}</span>}
        </div>
      ) : <span className="text-slate-500 text-xs">No payments</span>,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#f37121]" />
            {T.title}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{T.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              exportToExcel(
                data?.alerts || [],
                [
                  { header: 'Customer', key: 'companyName', width: 25 },
                  { header: 'Customer #', key: 'customerNumber', width: 14 },
                  { header: 'Credit Limit', key: 'creditLimit', transform: fmt.money, width: 15 },
                  { header: 'Outstanding', key: 'currentOutstanding', transform: fmt.money, width: 15 },
                  { header: 'Remaining', key: 'remaining', transform: fmt.money, width: 15 },
                  { header: 'Usage %', key: 'usagePercent', width: 10 },
                  { header: 'Grade', key: 'grade', width: 8 },
                  { header: 'Credit Term', key: 'creditTerm', width: 12 },
                  { header: 'Collector', key: 'assignedCollector', transform: (v: any) => v ? `${v.firstName} ${v.lastName}` : '', width: 18 },
                  { header: 'Last Payment Date', key: 'lastPaymentDate', transform: fmt.date, width: 18 },
                  { header: 'Last Payment Amount', key: 'lastPaymentAmount', transform: fmt.money, width: 20 },
                ],
                `Credit_Alerts_${new Date().toISOString().split('T')[0]}`,
                'Credit Alerts'
              );
            }}
            disabled={!data?.alerts?.length}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {T.export}
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchData(); }}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">{error}</div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-600 text-xs uppercase font-medium">{T.overLimit}</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{data?.exceeded || 0}</p>
          <p className="text-red-600/60 text-xs mt-1">Over 100% usage</p>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <p className="text-yellow-700 text-xs uppercase font-medium">Near Limit</p>
          <p className="text-2xl font-bold text-yellow-700 mt-1">{data?.nearLimit || 0}</p>
          <p className="text-yellow-700/60 text-xs mt-1">80-100% usage</p>
        </div>
        <div className="bg-[#f37121]/10 border border-[#f37121]/30 rounded-xl p-4">
          <p className="text-[#f37121] text-xs uppercase font-medium">Total Alerts</p>
          <p className="text-2xl font-bold text-[#f37121] mt-1">{data?.total || 0}</p>
          <p className="text-[#f37121]/60 text-xs mt-1">70%+ credit usage</p>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.alerts || []}
        searchable
        searchPlaceholder={`${T.search}...`}
        emptyMessage={T.noAlerts}
      />
    </motion.div>
  );
}
