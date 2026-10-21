/**
 * نوعُ الدفع على كشف التشغيل — ستُّ قيمٍ تُعرَض، وأربعٌ تُختار.
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/٢١): «آجل - فاتورة» تحلّ محلَّ «ضريبي»، و«آجل - كاش»
 * و«نقدي - 3PL» و«نقدي - HT» تحلّ محلَّ «كاش». فالاختيارُ من الأربعة وحدَها؛
 * و«ضريبي»/«كاش» يبقيان يُعرَضان ويُفلتَر بهما على الكشوف القائمة حتى تُحوَّل.
 *
 * والخادمُ يحفظ العائلةَ (`paymentType`: cash | tax) — وعليها تقوم القواعدُ كلُّها —
 * والنوعَ (`paymentSubtype`). والمرآةُ في الخادم: utils/paymentType.PAYMENT_SUBTYPES.
 */
export type PaymentFamily = '' | 'cash' | 'tax';
export type PaymentSubtype = 'deferred_cash' | 'deferred_invoice' | 'cash_3pl' | 'cash_ht';
export type PaymentKind = PaymentFamily | PaymentSubtype;

export const PAYMENT_SUBTYPES: Record<PaymentSubtype, { family: 'cash' | 'tax'; ar: string; en: string }> = {
  deferred_invoice: { family: 'tax', ar: 'آجل - فاتورة', en: 'Deferred – invoice' },
  deferred_cash: { family: 'cash', ar: 'آجل - كاش', en: 'Deferred – cash' },
  cash_3pl: { family: 'cash', ar: 'نقدي - 3PL', en: 'Cash – 3PL' },
  cash_ht: { family: 'cash', ar: 'نقدي - HT', en: 'Cash – HT' },
};

/** الاختياراتُ المعروضةُ للاختيار — الأربعةُ وحدَها، بترتيبها. */
export const PAYMENT_CHOICES: PaymentSubtype[] = ['deferred_invoice', 'deferred_cash', 'cash_3pl', 'cash_ht'];

export const isSubtype = (k: unknown): k is PaymentSubtype =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_SUBTYPES, k);

/** العائلة: نوعٌ جديدٌ يُقرأ بعائلته، و«cash»/«tax» كما هما. */
export const paymentFamily = (k: unknown): PaymentFamily =>
  (isSubtype(k) ? PAYMENT_SUBTYPES[k].family : (k === 'cash' || k === 'tax' ? k : ''));

/**
 * ما تعرضه الخانة لكشف: نوعُه إن وُجد، وإلّا عائلتُه.
 * (`paymentType` قد يحمل أحدَ الأربعة في نسخة التعديل قبل الحفظ.)
 */
export const paymentKindOf = (w: { paymentType?: string | null; paymentSubtype?: string | null } | null | undefined): PaymentKind => {
  if (!w) return '';
  if (isSubtype(w.paymentType)) return w.paymentType;
  if (isSubtype(w.paymentSubtype)) return w.paymentSubtype;
  return paymentFamily(w.paymentType);
};

/** اسمُ القيمة كما تُقرأ — الستُّ كلُّها. */
export const paymentKindLabel = (k: unknown, ar: boolean): string => {
  if (isSubtype(k)) return ar ? PAYMENT_SUBTYPES[k].ar : PAYMENT_SUBTYPES[k].en;
  if (k === 'cash') return ar ? 'كاش' : 'Cash';
  if (k === 'tax') return ar ? 'ضريبي' : 'Tax';
  return '';
};
