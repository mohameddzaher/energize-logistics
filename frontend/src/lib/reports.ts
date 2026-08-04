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
};
