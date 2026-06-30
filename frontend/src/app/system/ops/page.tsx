'use client';
// Operations Platform dashboard — a live, clickable overview of the external
// UPL field-ops system. Counts + status breakdown + monthly revenue + latest
// shipments + leaderboards, all fed by /api/ops/dashboard and kept current by
// the `ops:stats` / `ops:shipments:changed` socket events.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Truck, Users, Car, UserSquare, Building2, Activity, TrendingUp, Award, ArrowRight, RefreshCw, X,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { isOpsStaff, opsText, statusStyle, fmtMoney, fmtNum, locName } from '@/lib/ops';

interface Dash {
  home?: { stats?: { status: string; count: string; label: string; icon?: string }[] } | null;
  stats?: { counts?: Record<string, string>; statusesShipmentsCount?: Record<string, number | string>; statusesShipmentsChart?: { status: string; count: string }[] } | null;
  charts?: {
    monthlyRevenueBarChart?: { month: string; revenue: number }[];
    latestShipments?: any[];
    topDrivers?: { rank: number; id: string; name: string; completedShipments: number }[];
    topCarOwners?: { rank: number; id: string; name: string; totalShipments: number }[];
    deliveryTrackingMap?: any[];
  } | null;
}

const COUNT_CARDS = [
  { key: 'shipments', route: 'shipments', en: 'Shipments', ar: 'الشحنات', icon: Truck, accent: 'text-[#f37121]' },
  { key: 'drivers', route: 'drivers', en: 'Drivers', ar: 'السائقون', icon: Users, accent: 'text-blue-600' },
  { key: 'cars', route: 'cars', en: 'Cars', ar: 'المركبات', icon: Car, accent: 'text-emerald-600' },
  { key: 'carOwners', route: 'car-owners', en: 'Car Owners', ar: 'أصحاب المركبات', icon: UserSquare, accent: 'text-violet-600' },
  { key: 'users', route: 'users', en: 'Customers', ar: 'العملاء', icon: Users, accent: 'text-cyan-600' },
  { key: 'branches', route: 'branches', en: 'Branches', ar: 'الفروع', icon: Building2, accent: 'text-amber-600' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const firstOfMonth = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function OpsDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const tx = opsText(lang);
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  // No date filter by default → the dashboard shows the true full totals (matching
  // the Shipments page). The backend makes any picked `date_to` inclusive of that
  // whole day, so ranges/presets count correctly.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [branches, setBranches] = useState<any[]>([]);

  useEffect(() => { api.get<any>('/api/ops/branches?limit=100').then((d) => setBranches(d.items || [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ lang });
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      if (branchFilter) qs.set('branches', branchFilter);
      const res = await api.get<Dash>(`/api/ops/dashboard?${qs.toString()}`);
      setD(res);
    } catch { /* keep previous */ }
    setLoading(false);
  }, [lang, dateFrom, dateTo, branchFilter]);

  useEffect(() => { load(); }, [load]);
  // Live: poll-driven stats push + shipment changes.
  // Ignore the unfiltered live stats push while a date filter is active.
  useSocket('ops:stats', useCallback((stats: any) => { if (!dateFrom && !dateTo && !branchFilter) setD((p) => ({ ...(p || {}), stats })); }, [dateFrom, dateTo, branchFilter]));
  useSocket('ops:shipments:changed', useCallback(() => load(), [load]));

  if (!isOpsStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading && !d) return <Spinner />;

  const counts = d?.stats?.counts || {};
  // Prefer the date-filtered status chart; fall back to the (unfiltered) home stats.
  const statusStats: { status: string; count: string }[] = d?.stats?.statusesShipmentsChart?.length
    ? d.stats.statusesShipmentsChart
    : (d?.home?.stats || []).filter((s) => s.status !== 'all').map((s) => ({ status: s.status, count: s.count }));
  const revenue = d?.charts?.monthlyRevenueBarChart || [];
  const latest = d?.charts?.latestShipments || [];
  const topDrivers = d?.charts?.topDrivers || [];
  const topOwners = d?.charts?.topCarOwners || [];
  const go = (route: string, q = '') => router.push(`/system/ops/${route}${q}`);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Activity className="w-5 h-5" />} title={tx.dashboard} subtitle={`${tx.liveSubtitle} · ${tx.live}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {tx.refresh}</button>
      </PageHeader>

      {/* Date filters: quick presets + a single-day picker + a custom range */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'الفرع' : 'Branch'}</label>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label={lang === 'ar' ? 'الفرع' : 'Branch'} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{lang === 'ar' ? 'كل الفروع' : 'All branches'}</option>
          {branches.map((b) => <option key={String(b.id)} value={String(b.id)}>{locName(b.name, lang)}</option>)}
        </select>
        <span className="mx-1 w-px h-5 bg-slate-200" />
        {[
          { en: 'Today', ar: 'اليوم', from: ymd(new Date()), to: ymd(new Date()) },
          { en: 'Yesterday', ar: 'أمس', from: addDays(-1), to: addDays(-1) },
          { en: 'Last 7 days', ar: 'آخر 7 أيام', from: addDays(-6), to: ymd(new Date()) },
          { en: 'This month', ar: 'هذا الشهر', from: firstOfMonth(), to: ymd(new Date()) },
          { en: 'All', ar: 'الكل', from: '', to: '' },
        ].map((p) => {
          const active = dateFrom === p.from && dateTo === p.to;
          return (
            <button key={p.en} type="button" onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {lang === 'ar' ? p.ar : p.en}
            </button>
          );
        })}
        <span className="mx-1 w-px h-5 bg-slate-200" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'يوم محدد' : 'Specific day'}</label>
        <input type="date" aria-label={lang === 'ar' ? 'يوم محدد' : 'Specific day'} value={dateFrom && dateFrom === dateTo ? dateFrom : ''} onChange={(e) => { const v = e.target.value; if (v) { setDateFrom(v); setDateTo(v); } }} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
        <span className="mx-1 w-px h-5 bg-slate-200" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'من' : 'From'}</label>
        <input type="date" aria-label={lang === 'ar' ? 'من تاريخ' : 'From'} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
        <label className="text-xs text-slate-500">{lang === 'ar' ? 'إلى' : 'To'}</label>
        <input type="date" aria-label={lang === 'ar' ? 'إلى تاريخ' : 'To'} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
        {(dateFrom || dateTo || branchFilter) && (
          <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); setBranchFilter(''); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 text-xs"><X className="w-3.5 h-3.5" /> {lang === 'ar' ? 'مسح' : 'Clear'}</button>
        )}
      </div>

      {/* KPI cards (clickable) */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {COUNT_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <button key={c.key} type="button" onClick={() => go(c.route)} className="text-start bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-[#f37121]/40 transition-all group">
              <div className="flex items-center justify-between">
                <Icon className={`w-5 h-5 ${c.accent}`} />
                <ArrowRight className={`w-4 h-4 text-slate-300 group-hover:text-[#f37121] ${isRTL ? 'rotate-180' : ''}`} />
              </div>
              <p className={`text-2xl font-bold mt-2 ${c.accent}`}>{fmtNum(counts[c.key])}</p>
              <p className="text-slate-500 text-xs mt-0.5">{lang === 'ar' ? c.ar : c.en}</p>
            </button>
          );
        })}
      </div>

      {/* Shipment status breakdown (clickable → filtered shipments) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Truck className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'توزيع حالات الشحنات' : 'Shipment Status Breakdown'}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {statusStats.map((s) => {
            const st = statusStyle(s.status);
            return (
              <button key={s.status} type="button" onClick={() => go('shipments', `?status=${s.status}`)} className={`text-start rounded-xl p-3 border border-transparent hover:border-current transition-all ${st?.bg || 'bg-slate-100'} ${st?.text || 'text-slate-700'}`}>
                <p className="text-2xl font-bold">{fmtNum(s.count)}</p>
                <p className="text-xs mt-0.5 flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${st?.dot || 'bg-slate-400'}`} />{lang === 'ar' ? (st?.ar || s.status) : (st?.en || s.status)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Monthly revenue */}
      {revenue.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" /> {lang === 'ar' ? 'الإيرادات الشهرية' : 'Monthly Revenue'}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="revenue" fill="#f37121" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Latest shipments */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Truck className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'أحدث الشحنات' : 'Latest Shipments'}</h2>
            <button type="button" onClick={() => go('shipments')} className="text-xs text-[#f37121] hover:underline">{tx.viewAll}</button>
          </div>
          <div className="divide-y divide-slate-100">
            {latest.map((s: any) => {
              const st = statusStyle(s.status);
              return (
                <button key={s.id} type="button" onClick={() => go('shipments')} className="w-full text-start py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 rounded-lg px-2 -mx-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 font-medium truncate">#{s.reference_num || String(s.id).slice(0, 6)} · {s.address_from} → {s.address_to}</p>
                    <p className="text-xs text-slate-400 truncate">{locName(s.user?.name, lang)}</p>
                  </div>
                  {st && <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{lang === 'ar' ? st.ar : st.en}</span>}
                </button>
              );
            })}
            {latest.length === 0 && <p className="text-slate-400 text-sm py-4">{tx.noData}</p>}
          </div>
        </div>

        {/* Leaderboards */}
        <div className="space-y-5">
          <Leaderboard title={lang === 'ar' ? 'أعلى السائقين (شحنات مكتملة)' : 'Top Drivers (completed)'} icon={<Award className="w-4 h-4 text-blue-600" />} rows={topDrivers.map((x) => ({ id: x.id, name: x.name, value: x.completedShipments }))} onClick={() => go('drivers')} lang={lang} />
          <Leaderboard title={lang === 'ar' ? 'أعلى أصحاب المركبات' : 'Top Car Owners'} icon={<Award className="w-4 h-4 text-violet-600" />} rows={topOwners.map((x) => ({ id: x.id, name: x.name, value: x.totalShipments }))} onClick={() => go('car-owners')} lang={lang} />
        </div>
      </div>
    </div>
  );
}

function Leaderboard({ title, icon, rows, onClick, lang }: { title: string; icon: React.ReactNode; rows: { id: string; name: string; value: number }[]; onClick: () => void; lang: 'en' | 'ar' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">{icon} {title}</h2>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <button key={r.id} type="button" onClick={onClick} className="w-full flex items-center gap-3 hover:bg-slate-50 rounded-lg px-2 py-1.5 -mx-2">
            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="text-sm text-slate-800 truncate flex-1 text-start">{locName(r.name, lang)}</span>
            <span className="text-sm font-bold text-slate-900">{fmtNum(r.value)}</span>
          </button>
        ))}
        {rows.length === 0 && <p className="text-slate-400 text-sm py-2">—</p>}
      </div>
    </div>
  );
}
