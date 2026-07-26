import { canAccessSection, canEditSection } from '@/lib/sections';
// Marketing (قسم التسويق) — shared config, types and helpers.
//
// The section tracks two things: campaigns (a budgeted, dated push on one
// channel) and activities (each individual dated post/ad/design/event executed).
// The activity log IS the history, and the daily/weekly/monthly report is just
// those rows bucketed by date — which is how a marketing manager answers "what
// did we actually do this week?".
//
// Pages read /api/marketing/* and refresh on the `marketing:updated` socket.

export type Lang = 'en' | 'ar';

// ---- Roles (mirror of backend routes/marketing.js + config/constants.js) ----
// Reads are broad: the dashboard and the weekly report are things managers
// across the company ask to see. Writes are the marketing team + admin/IT tier.
export const MARKETING_STAFF_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator', 'employee',
  'marketing_manager', 'marketing_specialist', 'bd_manager',
  'crm_manager', 'crm_team_lead', 'sales_manager', 'operations_manager',
];
export const MARKETING_ADMIN_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager',
];
// Roles that see the section pinned in their sidebar.
export const MARKETING_SECTION_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'moderator', 'bd_manager',
];

export const isMarketingStaff = (role?: string | null) => !!role && MARKETING_STAFF_ROLES.includes(role);
export const isMarketingAdmin = (role?: string | null) => !!role && MARKETING_ADMIN_ROLES.includes(role);

// ---- Types (light shapes matching the API) ---------------------------------
export type Platform =
  | 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok' | 'snapchat'
  | 'google_ads' | 'youtube' | 'website' | 'email' | 'whatsapp' | 'offline' | 'other';
export type Objective = 'awareness' | 'leads' | 'engagement' | 'traffic' | 'sales' | 'recruitment' | 'other';
export type CampaignStatus = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';
export type ActivityType = 'post' | 'story' | 'reel' | 'video' | 'ad' | 'article' | 'email' | 'event' | 'design' | 'other';

export interface UserRef { _id: string; firstName?: string; lastName?: string; role?: string }

export interface Campaign {
  _id: string;
  name: string;
  nameAr?: string;
  platform: Platform;
  objective: Objective;
  status: CampaignStatus;
  startDate?: string;
  endDate?: string;
  budget: number;
  spend: number;
  revenue: number;
  owner?: UserRef | string | null;
  targetAudience?: string;
  description?: string;
  notes?: string;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  reach: number;
  engagements: number;
  // Stamped on by the controller (schema virtuals don't survive .lean()).
  ctr?: number;
  cpl?: number;
  roas?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivityMetrics {
  impressions: number; clicks: number; likes: number; comments: number; shares: number; leads: number; reach: number;
}

export interface Activity {
  _id: string;
  date: string;
  campaign?: { _id: string; name?: string; nameAr?: string; platform?: Platform } | string | null;
  platform: Platform;
  type: ActivityType;
  title?: string;
  description?: string;
  link?: string;
  metrics: ActivityMetrics;
  performedBy?: UserRef | string | null;
  performedByName?: string;
  notes?: string;
  createdAt?: string;
}

export interface DashboardTotals {
  campaigns: number; activeCampaigns: number; activities: number;
  budget: number; spend: number; leads: number; impressions: number;
  clicks: number; conversions: number; ctr: number; cpl: number;
}
export interface PlatformRow { platform: Platform; activities: number; impressions: number; clicks: number; leads: number; spend: number }
export interface TypeRow { type: ActivityType; count: number }
export interface TimelineRow { date: string; activities: number; impressions: number; clicks: number; leads: number }

export interface Dashboard {
  range: DateRange;
  totals: DashboardTotals;
  byPlatform: PlatformRow[];
  byType: TypeRow[];
  timeline: TimelineRow[];
  topCampaigns: Campaign[];
  recentActivities: Activity[];
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';
export interface ReportRow {
  bucket: string; label: string;
  activities: number; impressions: number; clicks: number; leads: number;
  reach: number; engagements: number; conversions: number; spend: number;
}
export interface ReportSummary extends Omit<ReportRow, 'bucket' | 'label'> {
  buckets: number; ctr: number; cpl: number; avgActivitiesPerBucket: number;
}
export interface Report { period: ReportPeriod; range: DateRange; rows: ReportRow[]; summary: ReportSummary }

export interface DateRange { from: string; to: string }

// ---- Label maps ------------------------------------------------------------
type Label = { en: string; ar: string; color?: string };

export const PLATFORMS: Record<Platform, Label> = {
  facebook: { en: 'Facebook', ar: 'فيسبوك', color: '#1877f2' },
  instagram: { en: 'Instagram', ar: 'إنستغرام', color: '#e1306c' },
  twitter: { en: 'X / Twitter', ar: 'إكس / تويتر', color: '#0f172a' },
  linkedin: { en: 'LinkedIn', ar: 'لينكد إن', color: '#0a66c2' },
  tiktok: { en: 'TikTok', ar: 'تيك توك', color: '#111827' },
  snapchat: { en: 'Snapchat', ar: 'سناب شات', color: '#eab308' },
  google_ads: { en: 'Google Ads', ar: 'إعلانات جوجل', color: '#34a853' },
  youtube: { en: 'YouTube', ar: 'يوتيوب', color: '#ff0000' },
  website: { en: 'Website', ar: 'الموقع الإلكتروني', color: '#0ea5e9' },
  email: { en: 'Email', ar: 'البريد الإلكتروني', color: '#8b5cf6' },
  whatsapp: { en: 'WhatsApp', ar: 'واتساب', color: '#25d366' },
  offline: { en: 'Offline', ar: 'خارج الإنترنت', color: '#64748b' },
  other: { en: 'Other', ar: 'أخرى', color: '#94a3b8' },
};

export const ACTIVITY_TYPES: Record<ActivityType, Label> = {
  post: { en: 'Post', ar: 'منشور', color: '#0ea5e9' },
  story: { en: 'Story', ar: 'قصة', color: '#f59e0b' },
  reel: { en: 'Reel', ar: 'ريل', color: '#e1306c' },
  video: { en: 'Video', ar: 'فيديو', color: '#ef4444' },
  ad: { en: 'Ad', ar: 'إعلان مدفوع', color: '#f37121' },
  article: { en: 'Article', ar: 'مقال', color: '#8b5cf6' },
  email: { en: 'Email', ar: 'رسالة بريدية', color: '#6366f1' },
  event: { en: 'Event', ar: 'فعالية', color: '#10b981' },
  design: { en: 'Design', ar: 'تصميم', color: '#14b8a6' },
  other: { en: 'Other', ar: 'أخرى', color: '#94a3b8' },
};

export const OBJECTIVES: Record<Objective, Label> = {
  awareness: { en: 'Awareness', ar: 'الوعي بالعلامة', color: '#0ea5e9' },
  leads: { en: 'Leads', ar: 'جذب عملاء محتملين', color: '#f37121' },
  engagement: { en: 'Engagement', ar: 'التفاعل', color: '#8b5cf6' },
  traffic: { en: 'Traffic', ar: 'زيارات الموقع', color: '#14b8a6' },
  sales: { en: 'Sales', ar: 'المبيعات', color: '#10b981' },
  recruitment: { en: 'Recruitment', ar: 'التوظيف', color: '#6366f1' },
  other: { en: 'Other', ar: 'أخرى', color: '#94a3b8' },
};

// `color` here is a tailwind pair so the badges render straight from the map.
export const STATUSES: Record<CampaignStatus, Label & { bg: string; text: string }> = {
  planned: { en: 'Planned', ar: 'مخططة', bg: 'bg-slate-100', text: 'text-slate-700', color: '#94a3b8' },
  active: { en: 'Active', ar: 'نشطة', bg: 'bg-emerald-100', text: 'text-emerald-700', color: '#10b981' },
  paused: { en: 'Paused', ar: 'متوقفة مؤقتاً', bg: 'bg-amber-100', text: 'text-amber-700', color: '#f59e0b' },
  completed: { en: 'Completed', ar: 'مكتملة', bg: 'bg-blue-100', text: 'text-blue-700', color: '#3b82f6' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة', bg: 'bg-red-100', text: 'text-red-700', color: '#ef4444' },
};

export const REPORT_PERIODS: Record<ReportPeriod, Label> = {
  daily: { en: 'Daily', ar: 'يومي' },
  weekly: { en: 'Weekly', ar: 'أسبوعي' },
  monthly: { en: 'Monthly', ar: 'شهري' },
};

// ---- Label helpers ---------------------------------------------------------
const pickLabel = (map: Record<string, Label>, key: string | undefined, lang: Lang) => {
  const entry = key ? map[key] : undefined;
  if (!entry) return key || '—';
  return lang === 'ar' ? entry.ar : entry.en;
};

export const platformLabel = (k?: string, lang: Lang = 'en') => pickLabel(PLATFORMS as Record<string, Label>, k, lang);
export const activityTypeLabel = (k?: string, lang: Lang = 'en') => pickLabel(ACTIVITY_TYPES as Record<string, Label>, k, lang);
export const objectiveLabel = (k?: string, lang: Lang = 'en') => pickLabel(OBJECTIVES as Record<string, Label>, k, lang);
export const statusLabel = (k?: string, lang: Lang = 'en') => pickLabel(STATUSES as Record<string, Label>, k, lang);
export const periodLabel = (k?: string, lang: Lang = 'en') => pickLabel(REPORT_PERIODS as Record<string, Label>, k, lang);

export const platformColor = (k?: string) => (k && PLATFORMS[k as Platform]?.color) || '#94a3b8';
export const activityTypeColor = (k?: string) => (k && ACTIVITY_TYPES[k as ActivityType]?.color) || '#94a3b8';

export const statusStyle = (k?: string) => STATUSES[k as CampaignStatus] || null;

export const campaignName = (c?: Campaign | { name?: string; nameAr?: string } | null, lang: Lang = 'en') => {
  if (!c) return '—';
  return (lang === 'ar' ? c.nameAr || c.name : c.name) || '—';
};

export const personName = (p?: UserRef | string | null): string => {
  if (!p || typeof p === 'string') return '—';
  return `${p.firstName || ''} ${p.lastName || ''}`.trim() || '—';
};

// ---- Formatters ------------------------------------------------------------
export const num = (v?: number | null) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US'));
export const money = (v?: number | null, lang: Lang = 'en') =>
  v == null || !Number.isFinite(Number(v))
    ? '—'
    : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${lang === 'ar' ? 'ج.م' : 'EGP'}`;
export const pct = (v?: number | null, digits = 2) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(digits)}%`;

// ---- Date range helpers ----------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const thisMonthToDate = (): DateRange => {
  const now = new Date();
  return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: toIso(now) };
};
export const lastNDays = (n: number): DateRange => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (n - 1));
  return { from: toIso(from), to: toIso(to) };
};

export const emptyMetrics = (): ActivityMetrics =>
  ({ impressions: 0, clicks: 0, likes: 0, comments: 0, shares: 0, leads: 0, reach: 0 });

// The engagement figure the report shows: likes + comments + shares.
export const engagementOf = (m?: Partial<ActivityMetrics> | null) =>
  (m?.likes || 0) + (m?.comments || 0) + (m?.shares || 0);

// Access is the ROLE list OR whatever the super-admin granted this role in the
// permissions matrix. Guarding on the role list alone would make a granted role
// see the sidebar link and be allowed by the API, then be refused by the page.
type UserLike = { role?: string | null; permissions?: Record<string, 'none' | 'view' | 'edit'> } | null | undefined;
export const canViewMarketing = (u: UserLike) => isMarketingStaff(u?.role) || canAccessSection(u?.permissions, 'Marketing');
export const canEditMarketing = (u: UserLike) => isMarketingAdmin(u?.role) || canEditSection(u?.permissions, 'Marketing');
