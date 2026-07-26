'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { TrendingUp, Trophy, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { isSalesStaff, money, pct, num, thisPeriod } from '@/lib/finance';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import OpsLiveSummary from '@/components/ops/OpsLiveSummary';
import { getSalesDashboardTranslations } from '@/lib/translations';

interface StageRow { stage: string; count: number; value: number; }
interface RepRow {
  repId: string; rep: string; wonValue: number; wonCount: number;
  openValue: number; openCount: number; target: number; attainment: number;
}
interface Dash {
  period: string; prevPeriod: string;
  wonValue: number; wonCount: number; lostValue: number; lostCount: number;
  openValue: number; openCount: number; teamTarget: number; attainment: number; winRate: number;
  avgDealSize: number; prevWonValue: number; prevWonCount: number; prevWinRate: number;
  byStage: StageRow[]; repRows: RepRow[];
  topReps: { repId: string; rep: string; count: number; value: number }[];
}

// Mirrors backend config/crmDefaults PIPELINE_STAGES (open stages only).
const STAGE_META: Record<string, { en: string; ar: string; color: string }> = {
  new: { en: 'New', ar: 'جديد', color: '#94a3b8' },
  contacted: { en: 'Contacted', ar: 'تم التواصل', color: '#3b82f6' },
  qualified: { en: 'Qualified', ar: 'مؤهّل', color: '#6366f1' },
  proposal: { en: 'Proposal', ar: 'عرض سعر', color: '#a855f7' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض', color: '#f97316' },
};

export default function SalesDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getSalesDashboardTranslations(lang);
  const [period, setPeriod] = useState(thisPeriod());
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>(`/api/sales/dashboard?period=${period}`)); } catch { /* */ }
    setLoading(false);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useSocket('crm:deal', useCallback(() => load(), [load]));
  useSocket('sales:target', useCallback(() => load(), [load]));

  if (!isSalesStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  // Month-over-month delta indicator.
  const delta = (cur: number, prev: number) => {
    if (!prev && !cur) return { dir: 'flat' as const, txt: '—' };
    if (!prev) return { dir: 'up' as const, txt: ar ? 'جديد' : 'new' };
    const d = ((cur - prev) / prev) * 100;
    return { dir: (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat', txt: `${d > 0 ? '+' : ''}${Math.round(d)}%` };
  };
  const wonDelta = delta(data.wonValue, data.prevWonValue);
  const Trend = ({ d }: { d: ReturnType<typeof delta> }) => (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${d.dir === 'up' ? 'text-green-600' : d.dir === 'down' ? 'text-red-600' : 'text-slate-400'}`}>
      {d.dir === 'up' ? <ArrowUpRight className="w-3 h-3" /> : d.dir === 'down' ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {d.txt}
    </span>
  );

  const stageTotal = data.byStage.reduce((s, x) => s + x.value, 0);
  const maxStageVal = Math.max(1, ...data.byStage.map((s) => s.value));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<TrendingUp className="w-5 h-5" />} title={tx.title} subtitle={tx.subtitle}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" aria-label={tx.period} />
      </PageHeader>

      <OpsLiveSummary />

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/sales/performance" className="block">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors">
            <p className="text-slate-500 text-xs flex items-center justify-between">{tx.wonValue} <Trend d={wonDelta} /></p>
            <p className="text-2xl font-bold mt-1 text-green-600">{money(data.wonValue)}</p>
            <p className="text-slate-400 text-[11px] mt-1">{ar ? 'الشهر السابق' : 'prev'}: {money(data.prevWonValue)}</p>
          </div>
        </Link>
        <Link href="/system/sales/targets" className="block">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors">
            <p className="text-slate-500 text-xs">{tx.target}</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{money(data.teamTarget)}</p>
            <p className="text-slate-400 text-[11px] mt-1">{ar ? 'إدارة الأهداف' : 'manage targets'}</p>
          </div>
        </Link>
        <Link href="/system/sales/performance" className="block">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors">
            <p className="text-slate-500 text-xs">{tx.attainment}</p>
            <p className={`text-2xl font-bold mt-1 ${data.attainment >= 100 ? 'text-green-600' : 'text-amber-700'}`}>{pct(data.attainment)}</p>
            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, data.attainment)}%`, backgroundColor: data.attainment >= 100 ? '#16a34a' : '#f37121' }} />
            </div>
          </div>
        </Link>
        <Link href="/system/sales/performance" className="block">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-[#f37121] transition-colors">
            <p className="text-slate-500 text-xs flex items-center justify-between">{tx.winRate} <Trend d={delta(data.winRate, data.prevWinRate)} /></p>
            <p className="text-2xl font-bold mt-1 text-purple-600">{pct(data.winRate)}</p>
            <p className="text-slate-400 text-[11px] mt-1">{ar ? 'فاز' : 'won'} {num(data.wonCount)} · {ar ? 'خسر' : 'lost'} {num(data.lostCount)}</p>
          </div>
        </Link>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/system/sales/pipeline"><StatCard label={tx.openDeals} value={num(data.openCount)} /></Link>
        <Link href="/system/sales/pipeline"><StatCard label={tx.pipelineValue} value={money(data.openValue)} accent="text-amber-700" /></Link>
        <Link href="/system/sales/pipeline"><StatCard label={ar ? 'متوسط حجم الصفقة' : 'Avg Deal Size'} value={money(data.avgDealSize)} accent="text-slate-900" /></Link>
        <Link href="/system/sales/performance"><StatCard label={ar ? 'الصفقات الفائزة' : 'Won Deals'} value={num(data.wonCount)} accent="text-green-600" /></Link>
      </div>

      {/* Pipeline by stage — clickable to pipeline */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /> {ar ? 'خط الأنابيب حسب المرحلة' : 'Pipeline by Stage'}</h3>
          <Link href="/system/sales/pipeline" className="text-[#f37121] text-sm font-medium hover:underline">{ar ? 'عرض اللوحة' : 'View board'} →</Link>
        </div>
        <div className="space-y-2">
          {data.byStage.map((s) => {
            const meta = STAGE_META[s.stage] || { en: s.stage, ar: s.stage, color: '#94a3b8' };
            return (
              <Link key={s.stage} href="/system/sales/pipeline" className="block group">
                <div className="flex items-center gap-3 bg-slate-50 group-hover:bg-slate-100 rounded-lg px-3 py-2.5 transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                  <span className="text-slate-800 text-sm font-medium w-28 shrink-0">{ar ? meta.ar : meta.en}</span>
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(s.value / maxStageVal) * 100}%`, backgroundColor: meta.color }} />
                  </div>
                  <span className="text-slate-500 text-xs w-10 text-end shrink-0">{num(s.count)}</span>
                  <span className="text-slate-800 text-sm font-medium w-32 text-end shrink-0">{money(s.value)}</span>
                </div>
              </Link>
            );
          })}
          {data.byStage.every((s) => s.count === 0) && <p className="text-slate-500 text-sm">—</p>}
        </div>
        <p className="text-slate-400 text-xs mt-3 text-end">{ar ? 'إجمالي خط الأنابيب المفتوح' : 'Total open pipeline'}: {money(stageTotal)}</p>
      </div>

      {/* Per-rep performance with target progress — clickable to performance */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2"><Trophy className="w-4 h-4 text-[#f37121]" /> {ar ? 'أداء المندوبين' : 'Rep Performance'}</h3>
          <Link href="/system/sales/performance" className="text-[#f37121] text-sm font-medium hover:underline">{ar ? 'التفاصيل' : 'Details'} →</Link>
        </div>
        {data.repRows.length === 0 ? <p className="text-slate-500 text-sm">—</p> : (
          <div className="space-y-2">
            {data.repRows.map((r, i) => {
              const att = r.attainment;
              const barColor = att >= 100 ? '#16a34a' : att >= 50 ? '#f37121' : '#f59e0b';
              return (
                <Link key={r.repId} href="/system/sales/performance" className="block group">
                  <div className="bg-slate-50 group-hover:bg-slate-100 rounded-lg px-3 py-3 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-800 text-sm font-medium">{i + 1}. {r.rep}</span>
                      <span className="text-slate-600 text-xs">
                        <span className="text-green-600 font-medium">{money(r.wonValue)}</span>
                        {r.target > 0 && <span className="text-slate-400"> / {money(r.target)}</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, att)}%`, backgroundColor: barColor }} />
                      </div>
                      <span className="text-xs font-medium w-12 text-end" style={{ color: barColor }}>{r.target > 0 ? pct(att) : '—'}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
                      <span>{ar ? 'فاز' : 'won'}: {num(r.wonCount)}</span>
                      <span>{ar ? 'مفتوح' : 'open'}: {num(r.openCount)} · {money(r.openValue)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
