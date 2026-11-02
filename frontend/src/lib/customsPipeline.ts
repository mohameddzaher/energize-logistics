/**
 * Customs clearance stages as sent by the server, and what is derived from them for display.
 * The rules (which stages a transaction needs, which are closed, the percentage) live only on the server: pipelineOf in backend/src/models/CustomsClearance. The screen renders what it receives, so the rule is not written twice.
 */
export interface PipelineStep {
  key: string; done: boolean; locked: boolean; reason?: string;
  /** The other route: clicking switches the selection to it. */
  switchable?: boolean;
  /** A stage marked per unit; this is the total: how many units completed it out of how many need it. */
  perUnit?: boolean; unitsDone?: number; unitsOf?: number;
}
/** Stages of a single unit (container or car) from the start of transport. */
export interface UnitPipeline {
  index: number; route: '' | 'yard' | 'customer'; steps: PipelineStep[];
  done: number; total: number; percent: number; next: string;
}
export interface Pipeline {
  route: '' | 'yard' | 'customer';
  cargoType: 'containers' | 'vehicles';
  steps: PipelineStep[];
  /** Whether the transaction has units tracked individually; `units` holds each one's stages. */
  perUnit?: boolean; units?: UnitPipeline[]; mixedRoutes?: boolean;
  done: number; total: number; percent: number; next: string;
}

export type CargoType = 'containers' | 'vehicles';

/** Stages that are transport; each has its cars' statement in the container fields. */
export const TRANSPORT_LEGS = ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'] as const;
export const isTransportLeg = (key: string) => (TRANSPORT_LEGS as readonly string[]).includes(key);

/** Stage name; containers become cars in a car transaction. */
export const stageName = (stages: Record<string, string>, key: string, cargoType?: string) => {
  const base = stages?.[key] || key;
  if (cargoType !== 'vehicles') return base;
  return base.replace('الحاويات', 'السيّارات').replace('Containers', 'Vehicles');
};

export const unitWord = (cargoType: string | undefined, ar: boolean, plural = true) => {
  if (cargoType === 'vehicles') return ar ? (plural ? 'السيّارات' : 'السيّارة') : (plural ? 'Vehicles' : 'Vehicle');
  return ar ? (plural ? 'الحاويات' : 'الحاوية') : (plural ? 'Containers' : 'Container');
};

/** Numbering of repeated stages: a stage with two payments gets (1) and (2) in order of arrival. Returns each item's number among its peers, or 0 if it is alone. */
export function ordinals<T>(list: T[], nameOf: (x: T) => string): number[] {
  const total = new Map<string, number>();
  for (const x of list) { const k = nameOf(x).trim(); total.set(k, (total.get(k) || 0) + 1); }
  const seen = new Map<string, number>();
  return list.map((x) => {
    const k = nameOf(x).trim();
    if ((total.get(k) || 0) < 2) return 0;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n;
  });
}

/** File name on download, like "BL-123 - port fees payment (2).pdf". It used to download under its disk name, random digits that say neither the transaction nor the document. */
export function downloadName(ref: string | undefined, title: string | undefined, n: number, fileName?: string, fileUrl?: string) {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(fileName || '') || /\.([a-z0-9]{2,5})$/i.exec(fileUrl || '') || [])[1] || '';
  const clean = (v: string) => v.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = [clean(ref || ''), clean(title || '') || 'مرفق'].filter(Boolean).join(' - ');
  return `${base}${n ? ` (${n})` : ''}${ext ? `.${ext.toLowerCase()}` : ''}`;
}

// Payment stages: which are written into costs and which count as a transport invoice.
// Mirror of STAGE_COST and TRANSPORT_STAGE_KEYS in backend/src/models/CustomsClearance. Such a stage is a payment request that cannot be added without an amount (the server rejects it: AMOUNT_REQUIRED); when finance confirms payment, the amount is written to its cost item.
export const AMOUNT_REQUIRED_STAGE_KEYS: ReadonlySet<string> = new Set([
  'doInvoicePaid', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'extension',
  'transportPortToCustomer', 'transportPortToYard', 'transportYardToCustomer',
  'appointmentBooking', 'inspection', 'exitPermit', 'consolidator', 'commissions', 'labourExpenses',
]);
// The transport invoice that ends the transaction: any transport stage with an attachment. The old `transportInvoice` remains for records made before transport was split into three parts.
export const TRANSPORT_STAGE_KEYS: ReadonlySet<string> = new Set([
  'transportInvoice', 'transportPortToCustomer', 'transportPortToYard', 'transportYardToCustomer',
]);
