'use client';
// Alerts — every telemetry notify(open or resolved) with severity/type/status
// filters. Operators can acknowledge an alert; clicking a row opens the vehicle.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Bell, RefreshCw, Check } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ls2Text, isLs2Staff, severityStyle, alertTypeLabel, alertMessage, timeAgo, ALERT_TYPE_LABELS, type Lang, type Alert } from '@/lib/ls2';

export default function Ls2AlertsPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const t = ls2Text(lang as Lang);
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState(params?.get('severity') || '');
  const [type, setType] = useState(params?.get('type') || '');
  const [status, setStatus] = useState('open');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (severity) qs.set('severity', severity);
      if (type) qs.set('type', type);
      if (status) qs.set('status', status);
      const res = await api.get<{ items: Alert[] }>(`/api/ls2/alerts?${qs.toString()}`);
      setItems(res.items || []);
    } catch { /* keep */ }
    setLoading(false);
  }, [severity, type, status]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));
  useSocket('ls2:alert', useCallback(() => load(), [load]));

  const ack = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await api.patch(`/api/ls2/alerts/${id}/ack`); await load(); } catch { /* ignore */ }
  };

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !items.length) return <Spinner />;

  const selectCls = 'px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm';

  const ar = lang === 'ar';
  const fmtDate = (v: any) => (v ? new Date(v).toLocaleString('en-GB') : '—');
  const exportColumns: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 14 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', transform: (v) => v || '—', width: 22 },
    { header: ar ? 'نوع التنبيه' : 'Alert type', key: 'type', transform: (v) => alertTypeLabel(v, lang as Lang), width: 18 },
    { header: ar ? 'الخطورة' : 'Severity', key: 'severity', transform: (v) => { const s = severityStyle(v); return ar ? s.ar : s.en; }, width: 12 },
    { header: ar ? 'الرسالة' : 'Message', key: 'message', transform: (_v, row) => alertMessage(row as Alert, lang as Lang), width: 45 },
    { header: ar ? 'القيمة' : 'Value', key: 'value', transform: (v) => v ?? '—', width: 10 },
    { header: ar ? 'الحد' : 'Threshold', key: 'threshold', transform: (v) => v ?? '—', width: 10 },
    { header: ar ? 'الوحدة' : 'Unit', key: 'unit', transform: (v) => v || '—', width: 10 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (ar ? (v === 'open' ? 'مفتوح' : 'مغلق') : v || '—'), width: 10 },
    { header: ar ? 'أول ظهور' : 'First seen', key: 'firstSeenAt', transform: fmtDate, width: 18 },
    { header: ar ? 'آخر ظهور' : 'Last seen', key: 'lastSeenAt', transform: fmtDate, width: 18 },
    { header: ar ? 'تم الإقرار' : 'Acknowledged', key: 'acknowledgedAt', transform: fmtDate, width: 18 },
  ];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Bell className="w-5 h-5" />} title={t.alerts} subtitle={`${items.length} · ${t.live}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
        <ExportMenu
          fileName="ls2-alerts"
          lang={lang as Lang}
          options={[{ key: 'filtered', label: ar ? 'النتائج الحالية (حسب الفلاتر)' : 'Current results (as filtered)', sheets: [{ name: t.alerts, rows: items as unknown as Record<string, any>[], columns: exportColumns }] }]}
        />
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={t.severity} className={selectCls}>
          <option value="">{t.allSeverities}</option>
          <option value="critical">{lang === 'ar' ? 'حرِج' : 'Critical'}</option>
          <option value="warning">{lang === 'ar' ? 'تحذير' : 'Warning'}</option>
          <option value="info">{lang === 'ar' ? 'معلومة' : 'Info'}</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t.type} className={selectCls}>
          <option value="">{t.allTypes}</option>
          {Object.keys(ALERT_TYPE_LABELS).map((k) => <option key={k} value={k}>{alertTypeLabel(k, lang as Lang)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status} className={selectCls}>
          <option value="open">{t.open}</option>
          <option value="resolved">{t.resolved}</option>
          <option value="all">{t.all}</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{t.severity}</th>
                <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                <th className="text-start font-semibold px-4 py-3">{t.type}</th>
                <th className="text-start font-semibold px-4 py-3">{lang === 'ar' ? 'الرسالة' : 'Message'}</th>
                <th className="text-start font-semibold px-4 py-3">{lang === 'ar' ? 'منذ' : 'Since'}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const st = severityStyle(a.severity);
                return (
                  <tr key={a._id} onClick={() => router.push(`/system/ls2/${a.unitId}`)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span></td>
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{a.plate}</td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{alertTypeLabel(a.type, lang as Lang)}</td>
                    <td className="px-4 py-3 text-slate-800">{alertMessage(a, lang as Lang)}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs whitespace-nowrap">{timeAgo(a.firstSeenAt, lang as Lang)}</td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      {a.status === 'resolved' ? <span className="text-xs text-emerald-600">{t.resolved}</span>
                        : a.acknowledgedAt ? <span className="inline-flex items-center gap-1 text-xs text-slate-700"><Check className="w-3.5 h-3.5" /> {t.acknowledged}</span>
                        : <button type="button" onClick={(e) => ack(a._id, e)} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">{t.acknowledge}</button>}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={6} className="text-center text-slate-700 py-10">{t.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
