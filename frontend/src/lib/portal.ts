// Shared vocabulary for the customer/supplier portal pages.
//
// The portal is dynamic: a partner sees a tab only when they actually have work
// of that kind. Both the labels and the status vocabulary live here so the
// overview, the shipment list, the detail page and the sidebar all speak the
// same language.
export type Lang = 'ar' | 'en';

export const SERVICE_LABEL: Record<string, { ar: string; en: string }> = {
  heavy_transport: { ar: 'النقل الثقيل', en: 'Heavy transport' },
  shipment_orders: { ar: 'طلبات الشحن', en: 'Shipment orders' },
  customs: { ar: 'التخليص الجمركي', en: 'Customs clearance' },
  finance: { ar: 'الفواتير والمدفوعات', en: 'Invoices & payments' },
};

// The shipment lifecycle, in the same words the operations team uses internally
// — a customer asking "فين شحنتي؟" should get the same answer either way.
export const STATUS_LABEL: Record<string, { ar: string; en: string; color: string }> = {
  requesting: { ar: 'قيد الطلب', en: 'Requested', color: '#94a3b8' },
  loading: { ar: 'جارٍ التحميل', en: 'Loading', color: '#0ea5e9' },
  uploaded: { ar: 'تم التحميل', en: 'Loaded', color: '#6366f1' },
  on_way: { ar: 'في الطريق', en: 'On the way', color: '#f59e0b' },
  arrived: { ar: 'وصلت', en: 'Arrived', color: '#16a34a' },
  bond_sent: { ar: 'أُرسلت البوليصة', en: 'Waybill sent', color: '#22c55e' },
  bond_received: { ar: 'استُلمت البوليصة', en: 'Waybill received', color: '#22c55e' },
  late: { ar: 'متأخرة', en: 'Late', color: '#ef4444' },
  invoiced: { ar: 'تمت الفوترة', en: 'Invoiced', color: '#0f766e' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled', color: '#64748b' },
};

export const statusText = (s: string, lang: Lang) =>
  (STATUS_LABEL[s] ? (lang === 'ar' ? STATUS_LABEL[s].ar : STATUS_LABEL[s].en) : s || '—');
export const statusColor = (s: string) => STATUS_LABEL[s]?.color || '#94a3b8';

// The 11 customs stages, in order, so the portal can draw a real progress bar
// instead of a status word with no context.
export const CUSTOMS_STAGES: { key: string; ar: string; en: string }[] = [
  { key: 'papers_received', ar: 'استلام الأوراق', en: 'Papers received' },
  { key: 'declaration_paid', ar: 'سداد البيان الجمركي', en: 'Declaration paid' },
  { key: 'do_requested', ar: 'طلب إذن التسليم', en: 'Delivery order requested' },
  { key: 'do_linked', ar: 'ربط إذن التسليم', en: 'Delivery order linked' },
  { key: 'port_fees_paid', ar: 'سداد أجور الموانئ', en: 'Port fees paid' },
  { key: 'unloading_fees_paid', ar: 'سداد أجور التفريغ', en: 'Unloading fees paid' },
  { key: 'transport_order', ar: 'أمر النقل', en: 'Transport order' },
  { key: 'containers_transported', ar: 'نقل الحاويات', en: 'Containers transported' },
  { key: 'unloaded_stored', ar: 'التفريغ والتخزين', en: 'Unloaded & stored' },
  { key: 'containers_returned', ar: 'إرجاع الحاويات', en: 'Containers returned' },
  { key: 'invoiced', ar: 'الفوترة', en: 'Invoiced' },
];

export const customsStageIndex = (stage: string) => CUSTOMS_STAGES.findIndex((s) => s.key === stage);
export const customsStageText = (stage: string, lang: Lang) => {
  const s = CUSTOMS_STAGES.find((x) => x.key === stage);
  return s ? (lang === 'ar' ? s.ar : s.en) : stage || '—';
};

export const money = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('en-US');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

export interface PortalService { key: string; count: number; ar: string; en: string }

export interface PortalMe {
  kind: 'customer' | 'vendor';
  name: string;
  source: string;
  profile: { finance: any; fleet: any; crm: any };
  services: PortalService[];
  account: { email: string; name: string; lastLogin?: string };
}
