/**
 * الإدارة الماليّة — تعريفُ الأقسام وشكلُ الحمولة التي يردّها الخادم.
 * راجع backend/src/controllers/financeController.js.
 */
export type FinFormat = 'money' | 'number' | 'pct' | 'date' | 'text';

export interface FinCard {
  key: string; ar: string; en: string; value: number; format: FinFormat;
  tone?: 'good' | 'bad' | 'warn' | 'neutral'; href?: string;
}
export interface FinColumn { key: string; ar: string; en: string; format: FinFormat }
export interface FinTable {
  key: string; ar: string; en: string; noteAr?: string;
  columns: FinColumn[]; rows: Record<string, any>[]; capped?: boolean;
}
export interface FinDept {
  dept: string; ar: string; en: string; period: { from: string; to: string }; generatedAt: string;
  cards: FinCard[]; tables: FinTable[]; notes: { ar: string; en: string }[];
}

/** الأقسامُ بترتيبها في الشريط — وأسماءُ صفحاتها «ماليات …» لا اسمُ القسم نفسُه. */
export const FINANCE_DEPTS: { key: string; ar: string; en: string; href: string }[] = [
  { key: 'operations', ar: 'ماليات التشغيل', en: 'Operations finance', href: '/system/finance/operations' },
  { key: 'fleet', ar: 'ماليات إدارة الأسطول', en: 'Fleet finance', href: '/system/finance/fleet' },
  { key: 'customs', ar: 'ماليات التخليص الجمركي', en: 'Customs finance', href: '/system/finance/customs' },
  { key: 'light', ar: 'ماليات النقل الخفيف', en: 'Light transport finance', href: '/system/finance/light-transport' },
  { key: 'marketing', ar: 'ماليات التسويق والتطوير', en: 'Marketing & BD finance', href: '/system/finance/marketing' },
  { key: 'hr', ar: 'ماليات الموارد البشرية', en: 'HR finance', href: '/system/finance/hr' },
  { key: 'it', ar: 'ماليات تقنية المعلومات', en: 'IT finance', href: '/system/finance/it' },
  { key: 'collections', ar: 'ماليات التحصيل', en: 'Collections finance', href: '/system/finance/collections' },
  { key: 'vehicles', ar: 'ماليات المركبات', en: 'Vehicles finance', href: '/system/finance/vehicles' },
];

export const fmtFin = (v: any, format: FinFormat, ar: boolean): string => {
  if (v == null || v === '') return '—';
  if (format === 'money') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
  }
  if (format === 'number') return Number(v).toLocaleString('en-US');
  if (format === 'pct') return `${(Math.round(Number(v) * 10) / 10).toLocaleString('en-US')}%`;
  if (format === 'date') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  void ar;
  return String(v);
};

const RIYADH = 'Asia/Riyadh';
export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** فتراتٌ جاهزة — والمخصَّصةُ تُكتب يدويًّا. */
export function presetRange(key: string): { from: string; to: string } {
  const t = todayKey();
  const [y, m] = t.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (key === 'lastMonth') {
    const ly = m === 1 ? y - 1 : y; const lm = m === 1 ? 12 : m - 1;
    return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}` };
  }
  if (key === 'quarter') {
    const d = new Date(Date.UTC(y, m - 3, 1));
    return { from: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`, to: t };
  }
  if (key === 'year') return { from: `${y}-01-01`, to: t };
  return { from: `${y}-${pad(m)}-01`, to: t };
}
