'use client';
// Executive Overview — the owner's single-glance view of the WHOLE company. Every
// section (Finance, Operations, Location Solutions, B2C, HR, Vehicles, CRM, Sales,
// Procurement, Workshop, Tasks) is a tidy card cluster of clickable KPIs + a
// compact chart, fed by that section's OWN dashboard endpoint (so the numbers are
// the same tested aggregates each section shows). Live: refetches on key socket
// events and every 45s. Reuses each endpoint's server-side cache, and one slow /
// failing section never blocks the rest (Promise.allSettled).
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  LayoutDashboard, RefreshCw, ArrowRight, Wallet, Truck, Gauge, Users, Car, Building2,
  TrendingUp, ShoppingCart, Wrench, ListTodo, AlertTriangle, DollarSign, Package, Activity,
} from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';

type AnyObj = Record<string, any>;
const EXEC_ROLES = ['super_admin', 'admin'];

// ── formatting helpers ─────────────────────────────────────────────────────
const n = (v: any) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US'));
const money = (v: any) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const kMoney = (v: any) => {
  const x = Number(v);
  if (v == null || Number.isNaN(x)) return '—';
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (Math.abs(x) >= 1_000) return `${(x / 1_000).toFixed(0)}k`;
  return String(Math.round(x));
};

interface ExecKpi { ar: string; en: string; value: number | null; format: 'number' | 'money' | 'pct'; tone?: 'good' | 'bad' | 'warn' | 'auto'; href?: string; trend?: number | null; suffix?: string }
interface ExecSection { key: string; ar: string; en: string; color: string; href: string; kpis: ExecKpi[]; chart?: { kind: 'bar' | 'pie'; ar: string; data: { name: string; value: number }[] } }

const TONE: Record<string, string> = { good: 'text-emerald-600', bad: 'text-red-600', warn: 'text-amber-600' };
const SECTION_ICON: Record<string, React.ReactNode> = {
  finance: <DollarSign className="w-4 h-4" />, operations: <Truck className="w-4 h-4" />, collections: <Wallet className="w-4 h-4" />,
  fleet: <Truck className="w-4 h-4" />, ls2: <Gauge className="w-4 h-4" />, vehicles: <Car className="w-4 h-4" />,
  hr: <Users className="w-4 h-4" />, customs: <Package className="w-4 h-4" />, b2c: <Building2 className="w-4 h-4" />,
  commercial: <TrendingUp className="w-4 h-4" />,
};

export default function ExecutiveOverviewPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  const [sections, setSections] = useState<ExecSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounce = useRef<any>(null);

  // ── نقطةٌ واحدةٌ على الخادم ─────────────────────────────────────────────
  // كانت الصفحةُ تنادي ثماني لوحات، أوّلُها تقرأ جداولَ قسمٍ زال فتعرض أصفارًا،
  // وتُفتح بطاقاتُها على صفحاتٍ حُذفت. صار الخادمُ يجمع كلَّ قسمٍ من مصدره الحيّ
  // (راجع backend executiveController)، وكلُّ رابطٍ هنا صفحةٌ موجودة.
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.get<{ sections: ExecSection[]; generatedAt: string }>('/api/analytics/executive');
      setSections(res.sections || []);
      setUpdatedAt(Date.now());
    } catch { /* keep last */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── لحظيّ ─────────────────────────────────────────────────────────────────
  // الخادمُ يبثّ `executive:changed` بعد أيّ حدثٍ في أيّ قسم (مجمَّعًا خمسَ
  // ثوانٍ)، و`finance:changed` بعد أيّ حركةٍ ماليّة. ومهلةُ الدقيقة احتياط.
  const kick = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(), 800);
  }, [load]);
  useSocket('executive:changed', kick);
  useSocket('finance:changed', kick);
  useEffect(() => { const id = setInterval(() => load(), 60000); return () => clearInterval(id); }, [load]);

  if (!EXEC_ROLES.includes(user?.role || '')) return <div className="text-slate-500 p-8">{t('You do not have access to this page', 'لا تملك صلاحية لهذه الصفحة')}</div>;
  if (loading) return <Spinner />;

  const go = (href: string) => router.push(href);
  const show = (k: ExecKpi) => {
    if (k.value == null) return '—';
    const v = k.format === 'money' ? kMoney(k.value) : k.format === 'pct' ? `${Math.round(k.value * 10) / 10}%` : n(k.value);
    return `${v}${k.suffix || ''}`;
  };
  const toneOf = (k: ExecKpi) => (k.tone === 'auto' ? ((k.value ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600') : (k.value ?? 0) < 0 ? 'text-red-600' : (TONE[k.tone || ''] || 'text-slate-800'));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]"><LayoutDashboard className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('Executive Overview', 'النظرة التنفيذية')}</h1>
            <p className="text-slate-500 text-sm">{t('Every section, every number — live', 'كل قسم وكل رقم — لحظيًا')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('Live', 'مباشر')}</span>
          <button type="button" onClick={() => load()} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {t('Refresh', 'تحديث')}</button>
        </div>
      </div>

      {sections.map((s) => (
        <Section key={s.key} icon={SECTION_ICON[s.key] || <Activity className="w-4 h-4" />} color={s.color} title={ar ? s.ar : s.en} href={s.href} go={go} viewLabel={t('Open', 'فتح')}
          chart={s.chart && s.chart.data.length ? (s.chart.kind === 'pie'
            ? <MiniPie data={s.chart.data} colors={{ moving: '#10b981', idle: '#f59e0b', stopped: '#94a3b8', offline: '#ef4444' }} />
            : <StageBar data={s.chart.data} color="#f37121" />) : undefined}>
          <Kpis>
            {s.kpis.map((k, i) => (
              <Kpi key={i} label={ar ? k.ar : k.en} value={show(k)} accent={toneOf(k)} trend={k.trend} onClick={k.href ? () => go(k.href!) : undefined} />
            ))}
          </Kpis>
        </Section>
      ))}

      {updatedAt && <p className="text-center text-[11px] text-slate-400">{t('Updated', 'آخر تحديث')} {new Date(updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
    </div>
  );
}

// ── Reusable pieces ─────────────────────────────────────────────────────────
const COLOR_BAR: Record<string, string> = {
  emerald: 'bg-emerald-500', orange: 'bg-[#f37121]', blue: 'bg-blue-500', violet: 'bg-violet-500',
  cyan: 'bg-cyan-500', amber: 'bg-amber-500', indigo: 'bg-indigo-500', green: 'bg-green-500',
  rose: 'bg-rose-500', slate: 'bg-slate-500', red: 'bg-red-500',
};
const COLOR_TEXT: Record<string, string> = {
  emerald: 'text-emerald-600', orange: 'text-[#f37121]', blue: 'text-blue-600', violet: 'text-violet-600',
  cyan: 'text-cyan-600', amber: 'text-amber-600', indigo: 'text-indigo-600', green: 'text-green-600',
  rose: 'text-rose-600', slate: 'text-slate-600', red: 'text-red-600',
};

function Section({ icon, color, title, href, go, viewLabel, children, chart, compact }: {
  icon: React.ReactNode; color: string; title: string; href: string; go: (h: string) => void; viewLabel: string;
  children: React.ReactNode; chart?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className={`h-1 ${COLOR_BAR[color] || 'bg-slate-300'}`} />
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className={`w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center ${COLOR_TEXT[color] || 'text-slate-600'}`}>{icon}</span>
            {title}
          </h2>
          <button type="button" onClick={() => go(href)} className="flex items-center gap-1 text-xs text-[#f37121] hover:underline shrink-0">{viewLabel} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" /></button>
        </div>
        {chart && !compact ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div className="lg:col-span-2">{children}</div>
            <div className="h-[160px]">{chart}</div>
          </div>
        ) : children}
      </div>
    </div>
  );
}

function Kpis({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={`grid gap-2.5 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>{children}</div>;
}

function Kpi({ label, value, accent, onClick, trend }: { label: string; value: React.ReactNode; accent?: string; onClick?: () => void; trend?: number | null }) {
  const clickable = !!onClick;
  return (
    <button type="button" onClick={onClick} disabled={!clickable}
      className={`text-start rounded-lg border border-slate-200 bg-slate-50/50 p-3 transition-all ${clickable ? 'hover:bg-white hover:border-[#f37121]/40 hover:shadow-sm cursor-pointer' : 'cursor-default'}`}>
      <p className="text-slate-500 text-[11px] leading-tight truncate" title={label}>{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <p className={`text-lg font-bold ${accent || 'text-slate-800'}`}>{value}</p>
        {trend != null && !Number.isNaN(trend) && (
          <span className={`text-[10px] font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{trend >= 0 ? '▲' : '▼'}{Math.abs(trend)}%</span>
        )}
      </div>
    </button>
  );
}

function StageBar({ data, color }: { data: { name: string; value: number }[]; color: string }) {
  const rows = data.filter((r) => r.value > 0);
  if (!rows.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={0} angle={-20} textAnchor="end" height={40} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={28} />
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MiniPie({ data, colors }: { data: { name: string; value: number }[]; colors: Record<string, string> }) {
  const rows = data.filter((r) => r.value > 0);
  if (!rows.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2}>
          {rows.map((r) => <Cell key={r.name} fill={colors[r.name] || '#94a3b8'} />)}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-slate-300 text-xs"><Activity className="w-4 h-4 me-1" /> —</div>;
}
