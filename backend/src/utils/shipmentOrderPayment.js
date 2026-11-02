/**
 * The payment type on a shipment order: the same four types as on the operations statement.
 * The owner's decision: the driver-hire-type field in shipment creation becomes the payment type with four options: credit-cash, credit-invoice, cash-3PL and cash-HT. These are the operations workflow keys themselves (`utils/paymentType` `PAYMENT_SUBTYPES`), read from there and not rewritten here, so one type never has two names on two screens.
 * The payment method follows the type and is not chosen. `paymentMethod` on the order (credit / cash) is read by the waybill to decide whether to print the transport price (the driver collects on delivery) and is used to filter the table. It is derived on the server from the type: credit types give credit and cash types give cash, so it cannot contradict the type. The mapping is an explicit table, not parsed from the name, so editing a display name does not change what the waybill prints.
 */
const { PAYMENT_SUBTYPES, SUBTYPE_KEYS, isSubtype } = require('./paymentType');

/** Payment terms per type: what is written to `paymentMethod` on the order. */
const TERMS_BY_SUBTYPE = {
  deferred_cash: 'آجل',
  deferred_invoice: 'آجل',
  cash_3pl: 'نقدي',
  cash_ht: 'نقدي',
};
// A type added in the workflow but not here is caught at startup, not on a printed waybill.
SUBTYPE_KEYS.forEach((k) => {
  if (!TERMS_BY_SUBTYPE[k]) throw new Error(`shipmentOrderPayment: no terms for payment subtype "${k}"`);
});

/** Credit | cash | '' */
const termsOfSubtype = (k) => (isSubtype(k) ? TERMS_BY_SUBTYPE[k] : '');

/** Whether the driver collects on delivery; `null` when the order has no type (falls back to the old rule). */
const collectsOnDelivery = (k) => (isSubtype(k) ? TERMS_BY_SUBTYPE[k] === 'نقدي' : null);

/** The type's display name. */
const subtypeLabel = (k, lang = 'ar') => (isSubtype(k) ? PAYMENT_SUBTYPES[k][lang === 'en' ? 'en' : 'ar'] : '');

/** Options for the payment type field in the create form, in the owner's order. */
const paymentSubtypeOptions = () => SUBTYPE_KEYS.map((k) => ({
  key: k,
  ar: PAYMENT_SUBTYPES[k].ar,
  en: PAYMENT_SUBTYPES[k].en,
  paymentMethod: TERMS_BY_SUBTYPE[k],
}));

module.exports = {
  TERMS_BY_SUBTYPE, termsOfSubtype, collectsOnDelivery, subtypeLabel, paymentSubtypeOptions,
};
