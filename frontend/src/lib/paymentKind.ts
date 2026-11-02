/** Payment kind on an operations statement: six values are displayed and four can be chosen. Credit-invoice replaces tax, and credit-cash, cash-3PL and cash-HT replace cash. Choice is among the four only; the old tax and cash values remain displayable and filterable on existing statements until they are converted. */
export type PaymentFamily = '' | 'cash' | 'tax';
export type PaymentSubtype = 'deferred_cash' | 'deferred_invoice' | 'cash_3pl' | 'cash_ht';
export type PaymentKind = PaymentFamily | PaymentSubtype;

export const PAYMENT_SUBTYPES: Record<PaymentSubtype, { family: 'cash' | 'tax'; ar: string; en: string }> = {
  deferred_invoice: { family: 'tax', ar: 'آجل - فاتورة', en: 'Deferred – invoice' },
  deferred_cash: { family: 'cash', ar: 'آجل - كاش', en: 'Deferred – cash' },
  cash_3pl: { family: 'cash', ar: 'نقدي - 3PL', en: 'Cash – 3PL' },
  cash_ht: { family: 'cash', ar: 'نقدي - HT', en: 'Cash – HT' },
};

/** The options offered for choice: the four only, in order. */
export const PAYMENT_CHOICES: PaymentSubtype[] = ['deferred_invoice', 'deferred_cash', 'cash_3pl', 'cash_ht'];

export const isSubtype = (k: unknown): k is PaymentSubtype =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_SUBTYPES, k);

/** The family: a new kind is read by its family, and cash/tax as they are. */
export const paymentFamily = (k: unknown): PaymentFamily =>
  (isSubtype(k) ? PAYMENT_SUBTYPES[k].family : (k === 'cash' || k === 'tax' ? k : ''));

/** What the cell shows for a statement: its kind if present, else its family. (`paymentType` may hold one of the four in the edit copy before saving.) */
export const paymentKindOf = (w: { paymentType?: string | null; paymentSubtype?: string | null } | null | undefined): PaymentKind => {
  if (!w) return '';
  if (isSubtype(w.paymentType)) return w.paymentType;
  if (isSubtype(w.paymentSubtype)) return w.paymentSubtype;
  return paymentFamily(w.paymentType);
};

/** The value's name as read, all six. */
export const paymentKindLabel = (k: unknown, ar: boolean): string => {
  if (isSubtype(k)) return ar ? PAYMENT_SUBTYPES[k].ar : PAYMENT_SUBTYPES[k].en;
  if (k === 'cash') return ar ? 'كاش' : 'Cash';
  if (k === 'tax') return ar ? 'ضريبي' : 'Tax';
  return '';
};
