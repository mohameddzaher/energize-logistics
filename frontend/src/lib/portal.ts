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

// The customs stages, in order, so the portal can draw a real progress bar
// instead of a status word with no context. Keys and order mirror
// backend/src/models/CustomsClearance (STAGES).
export const CUSTOMS_STAGES: { key: string; ar: string; en: string }[] = [
  { key: 'papers_received', ar: 'استلام الأوراق', en: 'Papers received' },
  { key: 'declaration_paid', ar: 'سداد البيان الجمركي', en: 'Declaration paid' },
  { key: 'do_requested', ar: 'طلب فاتورة إذن التسليم', en: 'Delivery order requested' },
  { key: 'do_invoice_paid', ar: 'سداد فاتورة إذن التسليم', en: 'Delivery order invoice paid' },
  { key: 'do_linked', ar: 'ربط إذن التسليم', en: 'Delivery order linked' },
  { key: 'port_fees_paid', ar: 'سداد أجور الموانئ', en: 'Port fees paid' },
  { key: 'unloading_fees_paid', ar: 'سداد أجور التفريغ', en: 'Unloading fees paid' },
  { key: 'transport_order', ar: 'أمر النقل', en: 'Transport order' },
  { key: 'transport_to_yard', ar: 'النقل من الميناء إلى الساحة', en: 'Port to yard' },
  { key: 'transport_to_customer', ar: 'النقل من الميناء إلى العميل', en: 'Port to customer' },
  { key: 'unloaded_stored', ar: 'التفريغ والتخزين', en: 'Unloading & storage' },
  { key: 'yard_to_customer', ar: 'النقل من الساحة إلى العميل', en: 'Yard to customer' },
  { key: 'containers_returned', ar: 'إرجاع الحاويات', en: 'Containers returned' },
  { key: 'invoiced', ar: 'إصدار الفاتورة', en: 'Invoiced' },
];

// A row ticked before the transport stage was split still carries the old key.
const LEGACY_CUSTOMS_STAGE: Record<string, string> = { containers_transported: 'transport_to_customer' };
export const customsStageIndex = (stage: string) =>
  CUSTOMS_STAGES.findIndex((s) => s.key === (LEGACY_CUSTOMS_STAGE[stage] || stage));
/**
 * مراحلُ معاملةٍ بعينها كما يرسلها الخادم (`pipeline`): ما يَلزمها وحدَه، وما
 * أُنجز منه. الدورةُ تتفرّع، فقائمةٌ ثابتةٌ تُري العميلَ مراحلَ ليست من طريقه.
 * وما لم يحمل `pipeline` (جوابٌ قديم) يُقرأ بموضع مرحلته في القائمة.
 */
export interface PortalStep { key: string; ar: string; en: string; done: boolean }
export function customsSteps(c: { stage?: string; cargoType?: string; pipeline?: { steps?: { key: string; done: boolean; locked: boolean }[]; percent?: number } }): { steps: PortalStep[]; percent: number; done: number } {
  const name = (key: string) => {
    const s = CUSTOMS_STAGES.find((x) => x.key === key) || { key, ar: key, en: key };
    return c.cargoType === 'vehicles'
      ? { ...s, ar: s.ar.replace('الحاويات', 'السيّارات'), en: s.en.replace('Containers', 'Vehicles') } : s;
  };
  const live = c.pipeline?.steps;
  if (live?.length) {
    const steps = live.filter((s) => !s.locked).map((s) => ({ ...name(s.key), done: s.done }));
    return { steps, percent: c.pipeline?.percent ?? 0, done: steps.filter((s) => s.done).length };
  }
  const idx = customsStageIndex(c.stage || '');
  const steps = CUSTOMS_STAGES.map((s, i) => ({ ...name(s.key), done: idx >= i }));
  return { steps, percent: idx < 0 ? 0 : ((idx + 1) / steps.length) * 100, done: Math.max(0, idx + 1) };
}

export const customsStageText = (stage: string, lang: Lang) => {
  if (stage === 'containers_transported') return lang === 'ar' ? 'نقل الحاويات' : 'Containers transported';
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
