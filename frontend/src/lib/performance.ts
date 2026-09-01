// Performance / KPI evaluation (تقييم الأداء) — shared types, styling and the
// scoring maths.
//
// The score rule, identical to the backend (config/performanceConfig.js):
//   weightedScore = Σ (score(1..5) × weight%)   → out of 5
//   percentage    = weightedScore × 20          → 0..100
//   band          = which bracket that % lands in
//   bonus         = looked up from the team's TIER table, in monthly salaries
//
// It is duplicated here on purpose: the evaluation page recomputes on every
// click so the gauge, the radar and the bonus move instantly, without a round
// trip. The server recomputes on save and its answer is authoritative.

import { MANAGER_ROLES } from './roles';

export type Lang = 'en' | 'ar';

// ── مَن يفتح لوحةَ التقييم: يُشتقّ ولا يُكتب ──────────────────────────────
// الخادمُ يقرّرها بقاعدةٍ واحدة (`/(_manager|_head|_lead|moderator)/` في
// `performanceController`)، وكانت هنا قائمةً تُكتب باليد — فسقط منها ستّةُ
// مديرين وُلدوا بعدها (المركبات، لوكيشن سوليوشن، منصّة الأوبريشن، طلبات
// الشحنات، الشؤون الإدارية، التحصيل). فكلٌّ منهم يفتح الصفحةَ برابطٍ مباشر
// ولا يجد لها مدخلًا في شريطه.
//
// و«_manager» ليست تسميةً جميلة: `config/roles.js` يوقف الخادمَ عند التحميل
// إن خالفها دورٌ واحد — فالاشتقاقُ عليها آمنٌ كاشتقاق الخادم.
export const PERF_STAFF_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator',
  ...MANAGER_ROLES,
  // موظّفون يشاركون في التقييم بحكم عملهم لا بحكم إدارتهم.
  'hr_specialist', 'crm_team_lead', 'b2c_project_lead',
];
// Full visibility across every department.
export const PERF_FULL_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];
// May edit the forms, weights, bands and bonus tiers. Deliberately just one role:
// these are the company's compensation rules.
export const PERF_CONFIG_ROLES = ['super_admin'];

export const isPerfStaff = (r?: string | null) => !!r && PERF_STAFF_ROLES.includes(r);
export const isPerfFull = (r?: string | null) => !!r && PERF_FULL_ROLES.includes(r);
export const canConfigurePerf = (r?: string | null) => !!r && PERF_CONFIG_ROLES.includes(r);

// ---- Types (mirroring the API) --------------------------------------------
export interface ScalePoint { score: number; label: string; labelAr: string }
export interface Criterion {
  key: string; order: number;
  title: string; titleAr: string;
  description: string; descriptionAr: string;
  dataSource: string; dataSourceAr: string;
  weight: number;
  scale: ScalePoint[];
}
export interface Template {
  _id: string; name: string; nameAr: string;
  description: string; descriptionAr: string;
  department: string; jobTitles: string[]; tier: number;
  active: boolean; criteria: Criterion[]; totalWeight?: number;
}
export interface Band { key: string; en: string; ar: string; min: number; max: number; color: string }
export interface Tier { tier: number; en: string; ar: string; cap: number; bonus: Record<string, number> }
export interface Settings {
  bands: Band[]; tiers: Tier[];
  departmentTiers: Record<string, number>;
  eligibilityThreshold: number;
}
export interface Answer { criterionKey: string; score: number | null; note: string }
export interface Evaluation {
  _id: string; template: string; employee: string; employeeName: string;
  department: string; jobTitle: string;
  evaluator: string; evaluatorName: string;
  period: { type: string; quarter?: number | null; month?: number | null; year: number; from?: string; to?: string };
  periodKey: string; evaluationDate: string;
  answers: Answer[];
  weightedScore: number | null; percentage: number | null; band: string | null;
  tier: number | null; bonusMultiplier: number | null; monthlySalary: number | null;
  notes: string; status: 'draft' | 'submitted'; submittedAt: string | null; updatedAt: string;
}
export interface TeamMember {
  _id: string; name: string; jobTitle: string; department: string;
  employeeNumber: string; photo: string;
  template: { _id: string; nameAr: string; tier: number; criteriaCount: number } | null;
  evaluation: {
    _id: string; status: 'draft' | 'submitted';
    percentage: number | null; weightedScore: number | null;
    band: string | null; bonusMultiplier: number | null; updatedAt: string;
    // A submitted evaluation is frozen; reopening it needs an approved request.
    locked?: boolean;
    editRequestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  } | null;
}

// ---- Scoring ---------------------------------------------------------------
export const SCORE_MAX = 5;
export const PERCENT_FACTOR = 100 / SCORE_MAX; // 20

export function bandFor(percentage: number | null, bands: Band[]): Band | null {
  if (percentage == null || Number.isNaN(percentage) || !bands?.length) return null;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const isTop = i === sorted.length - 1;
    if (percentage >= b.min && (isTop ? percentage <= b.max : percentage < b.max)) return b;
  }
  return sorted[0] || null;
}

export interface ScoreResult {
  weightedScore: number | null;
  percentage: number | null;
  band: Band | null;
  bonusMultiplier: number | null;
  answeredWeight: number;
  complete: boolean;
}

/**
 * Unanswered criteria are excluded and the remaining weights renormalised, so a
 * half-finished form shows a fair running score instead of one dragged toward
 * zero by questions the manager hasn't reached yet.
 */
export function computeScore(
  criteria: Criterion[],
  answers: Record<string, number | null>,
  bands: Band[],
  tier?: Tier | null
): ScoreResult {
  const answered = (criteria || []).filter((c) => answers[c.key] != null);
  const answeredWeight = answered.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const totalWeight = (criteria || []).reduce((s, c) => s + (Number(c.weight) || 0), 0);

  if (!answered.length || answeredWeight <= 0) {
    return { weightedScore: null, percentage: null, band: null, bonusMultiplier: null, answeredWeight: 0, complete: false };
  }
  const weightedScore = answered.reduce(
    (s, c) => s + (Number(answers[c.key]) * (Number(c.weight) || 0)) / answeredWeight, 0
  );
  const percentage = weightedScore * PERCENT_FACTOR;
  const band = bandFor(percentage, bands);
  return {
    weightedScore: Math.round(weightedScore * 100) / 100,
    percentage: Math.round(percentage * 10) / 10,
    band,
    bonusMultiplier: tier && band ? (tier.bonus?.[band.key] ?? 0) : null,
    answeredWeight,
    complete: Math.abs(answeredWeight - totalWeight) < 0.01,
  };
}

// ---- Styling ---------------------------------------------------------------
// Band colour → tailwind classes + a hex for the charts.
export const BAND_STYLES: Record<string, { bg: string; text: string; border: string; bar: string; hex: string }> = {
  red: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', bar: 'bg-red-500', hex: '#ef4444' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', bar: 'bg-amber-500', hex: '#f59e0b' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', bar: 'bg-blue-500', hex: '#3b82f6' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-500', hex: '#10b981' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', bar: 'bg-slate-400', hex: '#94a3b8' },
};
export const bandStyle = (band?: Band | null) => BAND_STYLES[band?.color || 'slate'] || BAND_STYLES.slate;
export const bandLabel = (band: Band | null | undefined, lang: Lang) =>
  band ? (lang === 'ar' ? band.ar : band.en) : (lang === 'ar' ? 'لم يُقيَّم' : 'Not evaluated');

// Colour for a raw 1..5 answer card.
export const SCORE_COLORS: Record<number, string> = {
  1: '#ef4444', 2: '#f97316', 3: '#f59e0b', 4: '#3b82f6', 5: '#10b981',
};

// ---- Periods ---------------------------------------------------------------
export type Period = { type: 'quarter' | 'month' | 'year'; quarter?: number; month?: number; year: number };

export const periodKey = (p: Period): string => {
  if (p.type === 'month') return `${p.year}-M${String(p.month || 1).padStart(2, '0')}`;
  if (p.type === 'year') return `${p.year}`;
  return `${p.year}-Q${p.quarter || 1}`;
};
export function periodLabel(p: Period, lang: Lang): string {
  const Q = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];
  const M = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  if (lang === 'ar') {
    if (p.type === 'month') return `${M[p.month || 1]} ${p.year}`;
    if (p.type === 'year') return `سنة ${p.year}`;
    return `الربع ${Q[p.quarter || 1]} ${p.year}`;
  }
  if (p.type === 'month') return `${p.month}/${p.year}`;
  if (p.type === 'year') return `Year ${p.year}`;
  return `Q${p.quarter} ${p.year}`;
}
export function currentPeriod(): Period {
  const now = new Date();
  return { type: 'quarter', quarter: Math.floor(now.getMonth() / 3) + 1, year: now.getFullYear() };
}

// ---- Formatters ------------------------------------------------------------
export const pct = (v?: number | null) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
export const score5 = (v?: number | null) => (v == null ? '—' : Number(v).toFixed(1));
export const money = (v?: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
// Bonus is expressed in monthly salaries: 0.5 → "½ راتب".
export function bonusLabel(mult: number | null | undefined, lang: Lang): string {
  if (mult == null) return '—';
  if (mult === 0) return lang === 'ar' ? 'لا بونص' : 'No bonus';
  const fracs: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };
  const f = fracs[String(mult)];
  if (lang === 'ar') return f ? `${f} راتب` : `${mult} راتب`;
  return f ? `${f} salary` : `${mult} salaries`;
}
