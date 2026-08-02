'use client';
// لوحة تحليلات سجل المركبات — أرقام كثيفة لكل بُعد + فلاتر متعددة + نطاق تاريخي
// + عتبات انتهاء المستندات، وكله حي وقابل للنقر للتصفية.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import { money, statusColor, statusLabel, docLabel, DOC_TYPES, CHART_COLORS } from '@/lib/vehicleRegistry';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { Car, RotateCcw, ListFilter, BellRing } from 'lucide-react';

type Row = { key: string; count: number };
type Dash = {
  totals: {
    vehicles: number; totalPremium: number; avgPremium: number; totalFuelLimit: number;
    activeFuelCards: number; withGps: number; missingInsurance: number; missingOperatingCard: number;
    expiredTotal: number; expiringTotal: number; sectors: number; brands: number; owners: number;
  };
  bySector: Row[]; byRegistrationType: Row[]; byBrand: Row[]; byOwner: Row[]; byInsuranceCompany: Row[];
  byCoverageType: Row[]; byFuelCardStatus: Row[]; byInspectionStatus: Row[]; byColor: Row[]; byTamStatus: Row[]; byModelYear: Row[];
  docBuckets: Record<string, { expired: number; critical: number; warning: number; valid: number; none: number }>;
};

export default function VehicleRegistryDashboard() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sectors, setSectors] = useState<string[]>([]);
  const [regTypes, setRegTypes] = useState<string[]>([]);
  const [expiringDoc, setExpiringDoc] = useState('');
  const [expiringWithin, setExpiringWithin] = useState('60');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    sectors.forEach((s) => p.append('sector', s));
    regTypes.forEach((s) => p.append('registrationType', s));
    if (expiringDoc) { p.set('expiringDoc', expiringDoc); p.set('expiringWithin', expiringWithin); }
    return p.toString();
  }, [q, sectors, regTypes, expiringDoc, expiringWithin]);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>(`/api/vehicle-registry/dashboard${qs ? `?${qs}` : ''}`)); }
    catch { /* keep */ } finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const goList = (extra: Record<string, string>) => {
    const p = new URLSearchParams(qs);
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    router.push(`/system/vehicles/registry?${p.toString()}`);
  };

  if (loading && !data) return <Spinner />;
  if (!data) return <div className="p-8 text-slate-500">{ar ? 'تعذّر تحميل اللوحة' : 'Failed to load'}</div>;
  const t = data.totals;

  // خريطة أكواد القطاع/النوع للأسماء العربية (من التوزيعات) للفلاتر.
  const sectorOpts = data.bySector.map((r) => r.key);
  const regTypeOpts = data.byRegistrationType.map((r) => r.key);

  const bucketColors: Record<string, string> = { expired: '#dc2626', critical: '#ea580c', warning: '#ca8a04', valid: '#16a34a', none: '#cbd5e1' };

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Car className="w-5 h-5" />} title={ar ? 'تحليلات سجل المركبات' : 'Vehicle Registry Analytics'}
        subtitle={ar ? `${t.vehicles} مركبة` : `${t.vehicles} vehicles`}>
        <div className="flex items-center gap-2">
          <Link href="/system/vehicles/registry/alerts" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">
            <BellRing className="w-4 h-4" /> {ar ? 'التنبيهات' : 'Alerts'} {t.expiredTotal + t.expiringTotal > 0 && <span className="bg-white/25 rounded-full px-1.5 text-xs">{t.expiredTotal + t.expiringTotal}</span>}
          </Link>
          <Link href="/system/vehicles/registry" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><ListFilter className="w-4 h-4" /> {ar ? 'القائمة' : 'List'}</Link>
        </div>
      </PageHeader>

      {/* شريط الفلاتر */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'لوحة / هيكل / مالك / بوليصة…' : 'plate / chassis / owner…'}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm w-64 max-w-full" />
          <select value={expiringDoc} onChange={(e) => setExpiringDoc(e.target.value)} className="px-2 py-2 rounded-lg border border-slate-200 text-sm">
            <option value="">{ar ? 'كل المستندات' : 'All documents'}</option>
            {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{ar ? d.ar : d.en}</option>)}
          </select>
          {expiringDoc && (
            <select value={expiringWithin} onChange={(e) => setExpiringWithin(e.target.value)} className="px-2 py-2 rounded-lg border border-slate-200 text-sm">
              {['30', '60', '90', '180'].map((d) => <option key={d} value={d}>{ar ? `خلال ${d} يوم` : `within ${d}d`}</option>)}
            </select>
          )}
          {(q || sectors.length || regTypes.length || expiringDoc) && (
            <button onClick={() => { setQ(''); setSectors([]); setRegTypes([]); setExpiringDoc(''); }} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm"><RotateCcw className="w-3.5 h-3.5" /> {ar ? 'مسح' : 'Reset'}</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sectorOpts.map((s) => (
            <Chip key={s} active={sectors.includes(s)} onClick={() => toggle(sectors, setSectors, s)}>{s}</Chip>
          ))}
          {regTypeOpts.slice(0, 8).map((s) => (
            <Chip key={s} active={regTypes.includes(s)} onClick={() => toggle(regTypes, setRegTypes, s)}>{s}</Chip>
          ))}
        </div>
      </div>

      {/* بطاقات المؤشرات */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label={ar ? 'إجمالي المركبات' : 'Vehicles'} value={t.vehicles} accent="text-[#f37121]" />
        <button onClick={() => router.push('/system/vehicles/registry/alerts')} className="text-start"><StatCard label={ar ? 'مستندات منتهية' : 'Expired docs'} value={t.expiredTotal} accent="text-red-600" /></button>
        <button onClick={() => router.push('/system/vehicles/registry/alerts')} className="text-start"><StatCard label={ar ? 'قرب الانتهاء' : 'Expiring soon'} value={t.expiringTotal} accent="text-amber-600" /></button>
        <StatCard label={ar ? 'إجمالي أقساط التأمين' : 'Total premium'} value={money(t.totalPremium)} accent="text-emerald-600" />
        <StatCard label={ar ? 'متوسط القسط' : 'Avg premium'} value={money(t.avgPremium)} />
        <StatCard label={ar ? 'حد الوقود الشهري' : 'Fuel limit'} value={money(t.totalFuelLimit)} accent="text-sky-600" />
        <StatCard label={ar ? 'شرائح وقود نشطة' : 'Active fuel cards'} value={t.activeFuelCards} />
        <StatCard label={ar ? 'مزوّدة بـ GPS' : 'With GPS'} value={t.withGps} />
        <StatCard label={ar ? 'بدون تأمين' : 'No insurance'} value={t.missingInsurance} accent="text-orange-600" />
        <StatCard label={ar ? 'بدون بطاقة تشغيل' : 'No op. card'} value={t.missingOperatingCard} accent="text-orange-600" />
        <StatCard label={ar ? 'عدد الماركات' : 'Brands'} value={t.brands} />
        <StatCard label={ar ? 'عدد المُلّاك' : 'Owners'} value={t.owners} />
      </div>

      {/* عتبات انتهاء المستندات */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="font-bold text-slate-900 mb-3">{ar ? 'حالة المستندات حسب النوع' : 'Document status by type'}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {DOC_TYPES.map((d) => {
            const b = data.docBuckets[d.key] || { expired: 0, critical: 0, warning: 0, valid: 0, none: 0 };
            const tot = b.expired + b.critical + b.warning + b.valid + b.none || 1;
            return (
              <div key={d.key} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-slate-800">{ar ? d.ar : d.en}</span>
                  <span className="text-xs text-slate-400">{b.expired + b.critical + b.warning} {ar ? 'تنبيه' : 'alerts'}</span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                  {(['expired', 'critical', 'warning', 'valid', 'none'] as const).map((k) => b[k] > 0 && (
                    <div key={k} style={{ width: `${(b[k] / tot) * 100}%`, background: bucketColors[k] }} title={`${statusLabel(k, ar)}: ${b[k]}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
                  {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => b[k] > 0 && (
                    <button key={k} onClick={() => k === 'valid' ? null : goList({ [k === 'expired' ? 'expiredDoc' : 'expiringDoc']: d.key, ...(k !== 'expired' ? { expiringWithin: k === 'critical' ? '30' : '60' } : {}) })}
                      className="flex items-center gap-1" style={{ color: bucketColors[k] }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: bucketColors[k] }} /> {statusLabel(k, ar)}: <b>{b[k]}</b>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* الرسوم */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title={ar ? 'حسب القطاع' : 'By sector'}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={data.bySector} dataKey="count" nameKey="key" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.key}: ${e.count}`}>
              {data.bySector.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'حسب نوع التسجيل' : 'By registration type'}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byRegistrationType}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" /><XAxis dataKey="key" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#12325c" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'أكثر الماركات' : 'Top brands'}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.byBrand.slice(0, 10)} layout="vertical"><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="key" tick={{ fontSize: 11 }} width={90} /><Tooltip /><Bar dataKey="count" fill="#f37121" radius={[0, 4, 4, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'أكبر المُلّاك' : 'Top owners'}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.byOwner.slice(0, 8)} layout="vertical"><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="key" tick={{ fontSize: 10 }} width={130} /><Tooltip /><Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'شركات التأمين' : 'Insurance companies'}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={data.byInsuranceCompany} dataKey="count" nameKey="key" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.key}: ${e.count}`}>
              {data.byInsuranceCompany.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'حسب سنة الصنع' : 'By model year'}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[...data.byModelYear].sort((a, b) => a.key.localeCompare(b.key))}><CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" /><XAxis dataKey="key" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'نوع التغطية' : 'Coverage type'}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart><Pie data={data.byCoverageType} dataKey="count" nameKey="key" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.count}`}>
              {data.byCoverageType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={ar ? 'حالة الفحص' : 'Inspection status'}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart><Pie data={data.byInspectionStatus} dataKey="count" nameKey="key" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.count}`}>
              {data.byInspectionStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${active ? 'bg-[#12325c] text-white border-[#12325c]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>{children}</button>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="font-bold text-slate-900 mb-2">{title}</p>{children}</div>;
}
