'use client';
// Shared building blocks for every KPI scorecard page (تقييم السائقين، مؤشرات
// العملاء والموردين). The backends all return the same shape — a 0–100 `score`,
// a named `band` with its colour, and a `breakdown` of weighted metrics — so the
// presentation is written once here instead of four times.
import { ReactNode } from 'react';

export interface ScoreBreakdownItem {
  key: string;
  ar: string;
  en: string;
  weight: number;
  weightPct?: number;
  value: number; // 0–100
  detail?: Record<string, any>;
}

export interface ScoreBand {
  min: number;
  key: string;
  ar: string;
  en: string;
  color: string;
}

/** The score itself: a number, a coloured bar, and the band name. */
export function ScoreBadge({ score, band, color, size = 'md' }: { score: number; band?: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const c = color || '#94a3b8';
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg';
  return (
    <div className="flex items-center gap-2">
      <span className={`font-bold tabular-nums ${text}`} style={{ color: c }}>{score}</span>
      {band && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${c}1f`, color: c }}>
          {band}
        </span>
      )}
    </div>
  );
}

/** A thin 0–100 bar. Used both for the total score and each breakdown metric. */
export function ScoreBar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="w-full rounded-full bg-slate-100 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, backgroundColor: color || '#f37121' }} />
    </div>
  );
}

/**
 * The "why is the score what it is" panel: every weighted metric, its own 0–100
 * value, and the raw numbers behind it. This is the part that makes a score
 * arguable instead of magic — a driver can be shown exactly which component cost
 * them the marks.
 */
export function ScoreBreakdown({
  items, lang, color, renderDetail,
}: {
  items: ScoreBreakdownItem[];
  lang: 'ar' | 'en';
  color?: string;
  renderDetail?: (item: ScoreBreakdownItem) => ReactNode;
}) {
  if (!items?.length) return <p className="text-slate-400 text-xs">{lang === 'ar' ? 'لا توجد بيانات كافية للتقييم' : 'Not enough data to score'}</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
      {items.map((it) => (
        <div key={it.key}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-slate-700 text-xs font-medium">
              {lang === 'ar' ? it.ar : it.en}
              <span className="text-slate-400 ms-1.5">({it.weightPct ?? it.weight}%)</span>
            </span>
            <span className="text-slate-900 text-xs font-bold tabular-nums">{it.value}</span>
          </div>
          <ScoreBar value={it.value} color={color} height={5} />
          {renderDetail
            ? <div className="text-[11px] text-slate-500 mt-1">{renderDetail(it)}</div>
            : it.detail && <div className="text-[11px] text-slate-500 mt-1">{formatDetail(it.detail, lang)}</div>}
        </div>
      ))}
    </div>
  );
}

/** Fallback rendering of a metric's raw numbers when a page has nothing custom. */
function formatDetail(detail: Record<string, any>, lang: 'ar' | 'en') {
  const labels: Record<string, { ar: string; en: string }> = {
    trips: { ar: 'رحلات', en: 'trips' },
    tripCount: { ar: 'رحلات', en: 'trips' },
    best: { ar: 'الأفضل', en: 'best' },
    activeDays: { ar: 'أيام عمل', en: 'active days' },
    periodDays: { ar: 'أيام الفترة', en: 'period days' },
    km: { ar: 'كم', en: 'km' },
    target: { ar: 'المستهدف', en: 'target' },
    daysSince: { ar: 'يوم منذ آخر تعامل', en: 'days since' },
    avgDaysLate: { ar: 'متوسط التأخير (يوم)', en: 'avg days late' },
    maxSpeed: { ar: 'أقصى سرعة', en: 'max speed' },
    limit: { ar: 'الحد', en: 'limit' },
    loads: { ar: 'حمولات', en: 'loads' },
    cars: { ar: 'سيارات', en: 'cars' },
    done: { ar: 'مكتملة', en: 'done' },
    late: { ar: 'متأخرة', en: 'late' },
    expected: { ar: 'المتوقع', en: 'expected' },
    cancelled: { ar: 'ملغاة', en: 'cancelled' },
    activities: { ar: 'أنشطة', en: 'activities' },
    revenue: { ar: 'إيراد', en: 'revenue' },
    shipments: { ar: 'شحنات', en: 'shipments' },
  };
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => {
      const l = labels[k];
      const name = l ? (lang === 'ar' ? l.ar : l.en) : k;
      const val = typeof v === 'boolean' ? (v ? '✓' : '✗') : (typeof v === 'number' ? v.toLocaleString() : String(v));
      return `${name}: ${val}`;
    })
    .join(' · ');
}

/** The legend explaining what each band means — shown once per page. */
export function BandLegend({ bands, lang }: { bands: ScoreBand[]; lang: 'ar' | 'en' }) {
  if (!bands?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {bands.map((b) => (
        <span key={b.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
          {lang === 'ar' ? b.ar : b.en}
          <span className="text-slate-400">≥ {b.min}</span>
        </span>
      ))}
    </div>
  );
}

/** A compact stat tile matching the light ERP theme used across /system pages. */
export function KpiTile({
  label, value, sub, accent = '#f37121', icon,
}: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; icon?: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-slate-500 text-[11px] font-medium uppercase tracking-wide truncate">{label}</p>
          <p className="text-slate-900 text-xl font-bold mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-slate-400 text-[11px] mt-0.5">{sub}</p>}
        </div>
        {icon && (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}1f`, color: accent }}>
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small coloured pill for the "what to do about this row" flags. */
export function FlagPill({ label, tone = 'warn' }: { label: string; tone?: 'warn' | 'danger' | 'info' }) {
  const map = {
    warn: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-slate-100 text-slate-600',
  } as const;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${map[tone]}`}>{label}</span>;
}
