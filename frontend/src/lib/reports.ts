// Shared client for the reporting engine (/api/reports).
//
// One place that knows how to list subjects, search what can be reported on,
// fetch a report as blocks, and open it as a PDF — used by the report centre and
// by every "تقرير" button scattered across the profile pages.
import api from '@/lib/api';
import type { ReportDoc } from '@/components/system/ReportView';

export interface ReportSubject {
  key: string;
  ar: string;
  en: string;
  icon: string;
  searchable: boolean;
}

export interface ReportOption {
  id: string;
  name: string;
  detail?: string;
  inactive?: boolean;
}

export const listSubjects = () => api.get<{ subjects: ReportSubject[]; company: string }>('/api/reports/subjects');

export const listOptions = (subject: string, q = '') =>
  api.get<{ items: ReportOption[]; total: number }>(`/api/reports/${subject}/options${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const fetchReport = (subject: string, id: string, from: string, to: string, lang: 'ar' | 'en') =>
  api.get<ReportDoc>(`/api/reports/${subject}/${encodeURIComponent(id)}?from=${from}&to=${to}&lang=${lang}`);

/** The PDF path — the caller decides whether to stream it or hand it to a viewer. */
export const reportPdfPath = (subject: string, id: string, from: string, to: string, lang: 'ar' | 'en') =>
  `/api/reports/${subject}/${encodeURIComponent(id)}?from=${from}&to=${to}&lang=${lang}&format=pdf`;

/**
 * Download/open the PDF. Goes through the API client rather than a bare link so
 * the auth cookie/refresh flow applies — a plain <a href> would 401 the moment
 * the access token needed refreshing.
 */
export async function openReportPdf(subject: string, id: string, from: string, to: string, lang: 'ar' | 'en') {
  const blob = await api.getBlob(reportPdfPath(subject, id, from, to, lang));
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** A sensible default window: the last 12 months, which is how these are read. */
export function defaultRange() {
  const to = new Date();
  const from = new Date(new Date(to).setFullYear(to.getFullYear() - 1));
  const iso = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return { from: iso(from), to: iso(to) };
}

/**
 * ── الفترةُ تُسأل بالطريقة التي يُسأل بها ────────────────────────────────────
 *
 * كانت خانتين: «من» و«إلى». ومَن يريد يومًا بعينه يكتب التاريخ مرّتين، ومَن
 * يريد شهرًا يحسب أوّلَه وآخرَه بيده — وآخرُ الشهر ليس رقمًا واحدًا (٢٨ · ٢٩ ·
 * ٣٠ · ٣١). فتُختار الفترةُ باسمها، والحدّان يُحسبان — ونظيرُ هذا الحساب في
 * الخادم (`resolvePeriod`) فلا تختلف شاشتان في معنى «الشهر الماضي».
 */
export const PERIOD_PRESETS: { key: string; ar: string; en: string }[] = [
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: 'yesterday', ar: 'أمس', en: 'Yesterday' },
  { key: 'this_week', ar: 'هذا الأسبوع', en: 'This week' },
  { key: 'this_month', ar: 'هذا الشهر', en: 'This month' },
  { key: 'last_month', ar: 'الشهر الماضي', en: 'Last month' },
  { key: 'this_quarter', ar: 'هذا الربع', en: 'This quarter' },
  { key: 'this_year', ar: 'هذا العام', en: 'This year' },
  { key: 'last_year', ar: 'العام الماضي', en: 'Last year' },
  { key: 'last_12m', ar: 'آخر ١٢ شهرًا', en: 'Last 12 months' },
  { key: 'all', ar: 'كل التاريخ', en: 'All time' },
];

/** حدّا فترةٍ باسمها — بتقويم الجهاز، كما يحسبها الخادم. */
export function presetRange(preset: string): { from: string; to: string } | null {
  const p = (n: number) => String(n).padStart(2, '0');
  const key = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'today': return { from: key(now), to: key(now) };
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return { from: key(d), to: key(d) }; }
    case 'this_week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return { from: key(d), to: key(now) }; }
    case 'this_month': return { from: key(new Date(y, m, 1)), to: key(new Date(y, m + 1, 0)) };
    case 'last_month': return { from: key(new Date(y, m - 1, 1)), to: key(new Date(y, m, 0)) };
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return { from: key(new Date(y, q, 1)), to: key(new Date(y, q + 3, 0)) }; }
    case 'this_year': return { from: key(new Date(y, 0, 1)), to: key(new Date(y, 11, 31)) };
    case 'last_year': return { from: key(new Date(y - 1, 0, 1)), to: key(new Date(y - 1, 11, 31)) };
    case 'last_12m': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return { from: key(d), to: key(now) }; }
    case 'all': return { from: '2000-01-01', to: key(now) };
    default: return null;
  }
}

/** شهرٌ «YYYY-MM» → أوّلُه وآخرُه — واليومُ صفرٌ من التالي هو آخرُ هذا. */
export function monthRange(month: string): { from: string; to: string } | null {
  const [y, mo] = String(month).split('-').map(Number);
  if (!y || !mo) return null;
  const last = new Date(y, mo, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const SUBJECT_HINT: Record<string, { ar: string; en: string }> = {
  vehicle: { ar: 'التتبّع والصيانة والحمولات والدخل لمركبة واحدة', en: 'Telemetry, maintenance, loads and income for one truck' },
  driver: { ar: 'الرحلات ومدة الوصول والتحميل والحمولات المنفَّذة', en: 'Trips, delivery and loading time, and the loads carried' },
  customer: { ar: 'كل ما نفّذناه للعميل: شحنات، تخليص، فواتير، ومدفوعات', en: 'Everything we did for them: shipments, customs, invoices, payments' },
  vendor: { ar: 'العقد والأوراق وحجم التشغيل ونسبة الاستغلال', en: 'Contract, paperwork, volume given and capacity utilisation' },
  employee: { ar: 'الملف الوظيفي: العقد، الإجازات، العهدة، التفاويض، التقييمات', en: 'The HR file: contract, leave, custody, authorizations, evaluations' },
  section: { ar: 'مؤشرات القسم ومهامه وشكاواه خلال الفترة', en: 'Section indicators, tasks and complaints over the period' },
  meeting: {
    ar: 'محضر رسمي كامل: الحضور والاعتذارات، المحضر، البنود والتكليفات، وخانات التوقيع',
    en: 'The official record: attendance and excuses, minutes, actions and delegations, with signature lines',
  },
  shipment: {
    ar: 'بوليصةٌ واحدة من طلبها إلى تسليمها: العميل والناقل والسائق والمال ومسيرة الحالة',
    en: 'One waybill end to end: customer, carrier, driver, money and the status trail',
  },
  carrier: {
    ar: 'ناقلٌ بشاحناته وسوّاقه وأوراقه، وما حمله لنا في الفترة وما نستحقّ دفعَه',
    en: 'A carrier with his trucks, drivers and paperwork, what he carried and what we owe',
  },
  rider: {
    ar: 'مندوبٌ بملفّه ومركبته والتزامه بتفقّد بداية الدوام في الفترة',
    en: 'A rider: his file, his vehicle and his duty-check compliance over the period',
  },
  tire: {
    ar: 'فردةُ كاوتش بسجلّها: أين رُكّبت ومتى، وما جرى لها',
    en: 'One tire and its history: where it was fitted, when, and what happened to it',
  },
};
