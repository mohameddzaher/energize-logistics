'use client';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getReportsTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { BarChart3, Download, TrendingUp, AlertTriangle } from 'lucide-react';
import { exportMultiSheet, fmt } from '@/utils/exportExcel';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899'];

export default function ReportsPage() {
  const { lang } = useLanguage();
  const T = getReportsTranslations(lang);
  const [dso, setDso] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [predictions, setPredictions] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [dsoData, agingData, riskData, forecastData, predData] = await Promise.all([
          api.get<any>('/api/analytics/dso'),
          api.get<any>('/api/analytics/aging'),
          api.get<any>('/api/analytics/risk'),
          api.get<any>('/api/analytics/forecast'),
          api.get<any>('/api/analytics/predictions'),
        ]);
        setDso(dsoData);
        setAging(agingData);
        setRisk(riskData);
        setForecast(forecastData);
        setPredictions(predData);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-[#f37121]" />
          {T.title}
        </h1>
        <button type="button" onClick={() => {
          const sheets: { name: string; data: any[]; columns: any[] }[] = [];
          if (dso?.byCreditTerm?.length) sheets.push({
            name: T.dsoByCreditTerm,
            data: dso.byCreditTerm,
            columns: [
              { header: T.currentTerm, key: 'creditTerm', width: 20 },
              { header: 'DSO', key: 'dso', transform: fmt.money, width: 12 },
              { header: T.customerCount, key: 'customerCount', width: 16 },
            ],
          });
          if (dso?.byBranch?.length) sheets.push({
            name: T.dsoByBranch,
            data: dso.byBranch,
            columns: [
              { header: T.branch, key: 'branch', width: 20 },
              { header: 'DSO', key: 'dso', transform: fmt.money, width: 12 },
            ],
          });
          if (forecast?.projectedVsExpected?.length) sheets.push({
            name: T.forecast,
            data: forecast.projectedVsExpected,
            columns: [
              { header: T.week, key: 'week', width: 16 },
              { header: T.projected, key: 'projected', transform: fmt.money, width: 16 },
              { header: T.expected, key: 'expected', transform: fmt.money, width: 16 },
            ],
          });
          if (predictions?.potentialDefaults?.length) sheets.push({
            name: T.potentialDefaults,
            data: predictions.potentialDefaults,
            columns: [
              { header: T.customer, key: 'customer.companyName', width: 24 },
              { header: T.riskDistribution, key: 'customer.riskScore', width: 12 },
              { header: T.overdueDays, key: 'overdueInvoices', width: 18 },
              { header: T.totalOverdue, key: 'totalOverdue', transform: fmt.money, width: 16 },
              { header: T.reason, key: 'reason', width: 35 },
            ],
          });
          if (predictions?.creditTermSuggestions?.length) sheets.push({
            name: T.creditTermSuggestions,
            data: predictions.creditTermSuggestions,
            columns: [
              { header: T.customer, key: 'customer.companyName', width: 24 },
              { header: T.status, key: 'severity', width: 12 },
              { header: T.suggestedTerm, key: 'suggestedAction', width: 35 },
              { header: T.overdueDays, key: 'avgDelayDays', width: 18 },
              { header: T.currentTerm, key: 'customer.currentCreditTerm', width: 22 },
            ],
          });
          if (predictions?.anomalies?.length) sheets.push({
            name: T.riskDistribution,
            data: predictions.anomalies,
            columns: [
              { header: T.customer, key: 'customer.companyName', width: 24 },
              { header: T.type, key: 'type', transform: (v: string) => v?.replace(/_/g, ' '), width: 20 },
              { header: T.details, key: 'message', width: 40 },
            ],
          });
          if (sheets.length > 0) exportMultiSheet(sheets, `reports-analytics-${new Date().toISOString().split('T')[0]}`);
        }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">
          <Download className="w-4 h-4" /> {T.downloadExcel}
        </button>
      </div>

      {/* DSO Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DSO by Credit Term */}
        {dso?.byCreditTerm && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.dsoByCreditTerm}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dso.byCreditTerm}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="creditTerm" tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={(v) => `${v} days`} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
                <Bar dataKey="dso" fill="#f37121" radius={[4, 4, 0, 0]} name="DSO" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* DSO by Branch */}
        {dso?.byBranch && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">{T.dsoByBranch}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dso.byBranch}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="branch" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
                <Bar dataKey="dso" fill="#6366f1" radius={[4, 4, 0, 0]} name="DSO" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* DSO Alerts */}
      {dso?.alerts && dso.alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <h3 className="text-red-400 font-bold text-sm flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" /> {T.dsoTrend}
          </h3>
          {dso.alerts.map((a: any, i: number) => (
            <p key={i} className="text-red-300 text-sm">{a.message}</p>
          ))}
        </div>
      )}

      {/* Forecast Chart */}
      {forecast?.projectedVsExpected && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">{T.forecast}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={forecast.projectedVsExpected}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="week" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
              <Bar dataKey="projected" fill="#6366f1" name={T.projected} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expected" fill="#10b981" name={T.expected} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* AI Predictions */}
      {predictions && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Potential Defaults */}
          {predictions.potentialDefaults?.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                {T.potentialDefaults}
              </h3>
              <div className="space-y-3">
                {predictions.potentialDefaults.map((d: any, i: number) => (
                  <div key={i} className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
                    <p className="text-white font-medium text-sm">{d.customer?.companyName}</p>
                    <p className="text-red-400 text-xs mt-1">{d.reason}</p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{T.riskDistribution}: {d.customer?.riskScore}%</span>
                      <span>{T.overdueDays}: {d.overdueInvoices}</span>
                      <span>{T.totalOverdue}: {d.totalOverdue?.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credit Term Suggestions */}
          {predictions.creditTermSuggestions?.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-yellow-400" />
                {T.creditTermSuggestions}
              </h3>
              <div className="space-y-3">
                {predictions.creditTermSuggestions.map((s: any, i: number) => (
                  <div key={i} className={`border rounded-lg p-3 ${s.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                    <p className="text-white font-medium text-sm">{s.customer?.companyName}</p>
                    <p className={`text-xs mt-1 ${s.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{s.suggestedAction}</p>
                    <p className="text-gray-400 text-xs mt-1">{T.overdueDays}: {s.avgDelayDays} | {T.currentTerm}: {s.customer?.currentCreditTerm}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Anomalies */}
      {predictions?.anomalies?.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Abnormal Behavior Detection</h3>
          <div className="space-y-3">
            {predictions.anomalies.map((a: any, i: number) => (
              <div key={i} className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3 flex items-start justify-between">
                <div>
                  <p className="text-white font-medium text-sm">{a.customer?.companyName}</p>
                  <p className="text-yellow-400 text-xs mt-1">{a.message}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 capitalize whitespace-nowrap">
                  {a.type?.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
