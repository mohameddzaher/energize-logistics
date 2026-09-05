'use client';
// إدارة العقود — the department dashboard: contracted base at a glance
// (signed vendors, contracted fleet, missing paperwork), geographic and rep
// distribution, fleet-size buckets, monthly signing trend and quick links.
// Everything is computed server-side from the live registers.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  FileSignature, Building2, Truck, AlertTriangle, Users, TrendingUp, MapPin,
  ClipboardList, BarChart3, PhoneCall, ExternalLink, Handshake,
} from 'lucide-react';
import { Spinner, PageHeader, StatCard, ErrorNotice } from '@/components/hr/HRKit';
import { canViewContracts, fmtN, monthLabel } from '@/lib/contracts';

interface Dash {
  vendors: {
    total: number; signed: number; pending: number; unsigned: number;
    signedFleet: number; totalFleet: number; reps: number;
    missingDocs: { _id: string; name: string; missingDocuments: string; energizeRep: string }[];
    byHq: { name: string; count: number }[];
    byRep: { name: string; count: number }[];
    signTrend: { month: string; count: number }[];
    fleetBuckets: Record<string, number>;
    topByFleet: { _id: string; name: string; fleetSize: number; energizeRep: string; headquarters: string }[];
  };
  prospects: { total: number; interested: number };
  // العملاء — الطرفُ الآخر من كلّ صفقة، ويُقرأ مع المورّدين لا في شاشةٍ وحدَه.
  customers?: {
    total: number; signed: number; unsigned: number; missingDocs: number; expiring: number;
    expiringList: { _id: string; name: string; endDate: string; energizeRep: string }[];
  };
  deptContracts: { total: number; byDepartment: { department: string; count: number }[]; expiringSoon: number };
  utilisationMonths: { year: number; month: number; orders: number }[];
}

// Horizontal proportion bar used across the dashboard — label · value · share.
function Bars({ rows, accent = 'bg-cyan-700' }: { rows: { label: string; value: number; hint?: string }[]; accent?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 truncate text-slate-600 font-medium shrink-0">{r.label}</span>
          <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
            <div className={`h-full rounded-full ${accent}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-14 text-end tabular-nums font-bold text-slate-700 shrink-0">{fmtN(r.value)}</span>
          {r.hint !== undefined && <span className="w-14 text-end tabular-nums text-slate-400 shrink-0">{r.hint}</span>}
        </div>
      ))}
    </div>
  );
}

function Card({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ContractsDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get<Dash>('/api/contracts/dashboard'));
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  if (error) return <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />;
  if (!data) return null;

  const v = data.vendors;
  const signedPct = v.total ? Math.round((v.signed / v.total) * 100) : 0;
  const lastUtil = data.utilisationMonths[data.utilisationMonths.length - 1];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<FileSignature className="w-7 h-7 text-cyan-700" />}
        title={ar ? 'إدارة العقود — لوحة القسم' : 'Contracts Management — Dashboard'}
        subtitle={ar
          ? `${fmtN(v.total)} مورد في السجل · ${fmtN(v.signed)} موقّع (${signedPct}٪) · أسطول متعاقد ${fmtN(v.signedFleet)} سيارة`
          : `${fmtN(v.total)} vendors · ${fmtN(v.signed)} signed (${signedPct}%) · ${fmtN(v.signedFleet)} contracted vehicles`}
      >
        <Link href="/system/contracts/analysis" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-sm font-semibold">
          <BarChart3 className="w-4 h-4" />{ar ? 'تحليل التشغيل' : 'Utilisation Analysis'}
        </Link>
      </PageHeader>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label={ar ? 'موردون موقّعون' : 'Signed vendors'} value={fmtN(v.signed)} accent="text-emerald-600" />
        <StatCard label={ar ? 'قيد التوقيع / غير موقّع' : 'Pending / unsigned'} value={`${fmtN(v.pending)} / ${fmtN(v.unsigned)}`} accent="text-amber-600" />
        <StatCard label={ar ? 'الأسطول المتعاقد' : 'Contracted fleet'} value={fmtN(v.signedFleet)} accent="text-cyan-700" />
        <StatCard label={ar ? 'مستندات ناقصة' : 'Missing documents'} value={fmtN(v.missingDocs.length)} accent={v.missingDocs.length ? 'text-red-600' : 'text-slate-400'} />
        <StatCard label={ar ? 'عملاء موقّعون' : 'Signed customers'}
          value={`${fmtN(data.customers?.signed || 0)} / ${fmtN(data.customers?.total || 0)}`} accent="text-emerald-600" />
        <StatCard label={ar ? 'شركات قيد التنشيط' : 'Prospects'} value={`${fmtN(data.prospects.interested)} / ${fmtN(data.prospects.total)}`} accent="text-violet-600" />
        <StatCard label={ar ? 'عقود الأقسام الأخرى' : 'Dept contracts'} value={fmtN(data.deptContracts.total)} accent="text-blue-600" />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: '/system/contracts/vendors', icon: <Building2 className="w-5 h-5" />, ar: 'سجل الموردين', en: 'Vendor register', hint: ar ? `${fmtN(v.total)} مورد` : `${fmtN(v.total)} vendors` },
          { href: '/system/contracts/customers', icon: <Handshake className="w-5 h-5" />, ar: 'العملاء', en: 'Customers', hint: data.customers?.expiring ? (ar ? `${fmtN(data.customers.expiring)} عقدًا ينتهي أو انتهى` : `${fmtN(data.customers.expiring)} ending / ended`) : (ar ? `${fmtN(data.customers?.total || 0)} عميلًا` : `${fmtN(data.customers?.total || 0)} customers`) },
          { href: '/system/contracts/analysis', icon: <TrendingUp className="w-5 h-5" />, ar: 'تحليل التشغيل والترتيب', en: 'Utilisation & ranking', hint: lastUtil ? (ar ? `آخر شهر: ${monthLabel(`${lastUtil.year}-${String(lastUtil.month).padStart(2, '0')}`, ar)}` : `latest: ${lastUtil.year}-${lastUtil.month}`) : '—' },
          { href: '/system/contracts/prospects', icon: <PhoneCall className="w-5 h-5" />, ar: 'تنشيط الموردين الجدد', en: 'Prospect outreach', hint: ar ? `${fmtN(data.prospects.interested)} مهتم` : `${fmtN(data.prospects.interested)} interested` },
          { href: '/system/contracts/agreements', icon: <ClipboardList className="w-5 h-5" />, ar: 'عقود الأقسام', en: 'Department contracts', hint: ar ? `${fmtN(data.deptContracts.expiringSoon)} تنتهي خلال ٦٠ يومًا` : `${fmtN(data.deptContracts.expiringSoon)} expiring in 60d` },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 hover:border-cyan-600 hover:shadow-md transition-all group">
            <div className="flex items-center gap-2 text-cyan-700">{l.icon}<span className="font-bold text-slate-800 text-sm group-hover:text-cyan-700">{ar ? l.ar : l.en}</span></div>
            <div className="text-xs text-slate-400 mt-1.5">{l.hint}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={ar ? 'التوزيع الجغرافي للعقود الموقّعة' : 'Signed contracts by headquarters'} icon={<MapPin className="w-4 h-4 text-cyan-700" />}>
          <Bars rows={v.byHq.slice(0, 8).map((h) => ({ label: h.name, value: h.count }))} />
        </Card>
        <Card title={ar ? 'توزيع العقود على مناديب التنشيط' : 'Signed contracts by rep'} icon={<Users className="w-4 h-4 text-cyan-700" />}>
          <Bars rows={v.byRep.slice(0, 8).map((r) => ({ label: r.name, value: r.count }))} accent="bg-violet-600" />
        </Card>
        <Card title={ar ? 'اتجاه توقيع العقود شهريًا' : 'Monthly signing trend'} icon={<TrendingUp className="w-4 h-4 text-cyan-700" />}>
          <Bars rows={v.signTrend.slice(-10).map((t) => ({ label: monthLabel(t.month, ar), value: t.count }))} accent="bg-emerald-600" />
        </Card>
        <Card title={ar ? 'الموردون الموقّعون حسب حجم الأسطول' : 'Signed vendors by fleet size'} icon={<Truck className="w-4 h-4 text-cyan-700" />}>
          <Bars rows={Object.entries(v.fleetBuckets).map(([k, n]) => ({ label: ar ? `${k} سيارة` : `${k} veh.`, value: n }))} accent="bg-blue-600" />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={ar ? 'أكبر ١٠ موردين موقّعين بعدد السيارات' : 'Top 10 signed vendors by fleet'} icon={<Truck className="w-4 h-4 text-cyan-700" />}>
          <div className="space-y-1.5">
            {v.topByFleet.map((t, i) => (
              <Link key={t._id} href={`/system/contracts/vendors/${t._id}`} className="flex items-center gap-2 text-xs hover:bg-slate-50 rounded-lg px-2 py-1.5 group">
                <span className="w-5 h-5 rounded-full bg-cyan-50 text-cyan-700 font-bold text-[10px] flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="flex-1 truncate font-medium text-slate-700 group-hover:text-cyan-700">{t.name}</span>
                <span className="text-slate-400 truncate max-w-24">{t.energizeRep || '—'} · {t.headquarters || '—'}</span>
                <span className="font-bold tabular-nums text-slate-800 w-12 text-end">{fmtN(t.fleetSize)}</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card title={ar ? 'تنبيهات: موقّعون بمستندات ناقصة' : 'Alerts: signed with missing documents'} icon={<AlertTriangle className="w-4 h-4 text-red-600" />}
          action={<Link href="/system/contracts/vendors?filter=missingDocs" className="text-[11px] font-medium text-cyan-700 hover:underline inline-flex items-center gap-1">{ar ? 'الكل' : 'All'}<ExternalLink className="w-3 h-3" /></Link>}>
          {v.missingDocs.length === 0
            ? <div className="text-xs text-slate-400 py-6 text-center">{ar ? 'كل الملفات المستندية مكتملة' : 'All document files complete'}</div>
            : (
              <div className="space-y-1.5">
                {v.missingDocs.slice(0, 8).map((m) => (
                  <Link key={m._id} href={`/system/contracts/vendors/${m._id}`} className="flex items-start gap-2 text-xs bg-red-50/60 border border-red-100 rounded-lg px-3 py-2 hover:border-red-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                    <span className="flex-1">
                      <span className="font-bold text-slate-800 block">{m.name}</span>
                      <span className="text-slate-500">{m.missingDocuments || (ar ? 'مستندات غير مستلمة' : 'documents not received')}{m.energizeRep ? ` — ${ar ? 'المندوب' : 'rep'}: ${m.energizeRep}` : ''}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
        </Card>
      </div>
    </div>
  );
}
