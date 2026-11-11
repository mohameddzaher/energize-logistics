/**
 * Which side of a shipment's price a role may see.
 * Sales sees the selling price and never the purchase; the vendors team sees the purchase and never the selling price;
 * everyone else keeps what their own screen rules already give them. One list, read by the shipment screens, the
 * analytics, the shipment requests and the operations workflow, so the two halves can never leak through another door.
 */
const SALES_ROLES = ['sales_manager', 'sales_rep', 'sales_trainee'];
const VENDOR_ROLES = ['vendors_manager', 'vendors_team_leader', 'vendors_staff', 'vendors_trainee'];
// Manager and team leader hold the same rights in the section (owner's rule).
const VENDOR_LEADS = ['vendors_manager', 'vendors_team_leader'];

const roleOf = (u) => (typeof u === 'string' ? u : u?.role) || '';
const isSalesRole = (u) => SALES_ROLES.includes(roleOf(u));
const isVendorRole = (u) => VENDOR_ROLES.includes(roleOf(u));
const isVendorLead = (u) => VENDOR_LEADS.includes(roleOf(u));

/** { sell, buy }: may this user see the selling price / the purchase side (buy, advance, driver fare). */
const priceView = (u) => ({ sell: !isVendorRole(u), buy: !isSalesRole(u) });

const FLEET_ROLES = ['fleet_manager', 'fleet_supervisor'];
/**
 * Selling price on a shipment request (owner, 2026-11-11): in Operations only the manager (and whoever holds his
 * rights, the team leader) sees it; operations staff complete trucks on purchase alone. The fleet never sees the
 * order's selling price. Every other role follows priceView.
 */
// Who sees the selling price on sales requests (owner's list): top management and IT, finance (CFO, accounts manager, accountant), the general manager, the sales team, the data team, and from operations the operations manager alone (not the team leader).
const REQUEST_SELL_ROLES = new Set([
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'it_trainee',
  'cfo', 'accounting_manager', 'accountant', 'general_manager',
  'operations_manager', ...SALES_ROLES, 'data_manager', 'data_analyst', 'data_entry',
]);
const requestSellVisible = (u) => REQUEST_SELL_ROLES.has(roleOf(u));

// Purchase-side fields of a shipment order; hidden together because any one of them reveals the cost.
const BUY_FIELDS = ['buyPrice', 'advanceAmount', 'driverRentPrice'];
const SELL_FIELDS = ['sellPrice'];

/** Removes the fields this user may not see from a shipment (or a list of them). */
const stripOrderPrices = (u, docs) => {
  const v = priceView(u);
  if (v.sell && v.buy) return docs;
  const drop = [...(v.sell ? [] : SELL_FIELDS), ...(v.buy ? [] : BUY_FIELDS)];
  const one = (d) => {
    if (!d) return d;
    const o = typeof d.toObject === 'function' ? d.toObject() : { ...d };
    for (const f of drop) delete o[f];
    if (!v.sell || !v.buy) { delete o.margin; delete o.profit; }
    return o;
  };
  return Array.isArray(docs) ? docs.map(one) : one(docs);
};

/**
 * Removes money a viewer may not see from an analytics answer, at any depth.
 * Margin needs both sides, so it goes whenever either side is hidden; the losing-shipments list is margin by another name.
 */
const SELL_KEYS = new Set(['sell', 'sellPrice', 'sellTotal', 'avgSell', 'revenue', 'sellingValue', 'minSell', 'maxSell', 'pSell']);
const BUY_KEYS = new Set(['buy', 'buyPrice', 'buyTotal', 'avgBuy', 'advances', 'advanceAmount', 'driverRentPrice', 'purchaseValue', 'driverCost', 'cost', 'avgCost', 'minBuy', 'maxBuy', 'pBuy']);
const BOTH_KEYS = new Set(['margin', 'marginPct', 'avgMargin', 'profit', 'losing', 'marginBuckets', 'top5Share']);
const maskMoney = (u, obj) => {
  const v = priceView(u);
  if (v.sell && v.buy) return obj;
  const drop = (k) => (!v.sell && SELL_KEYS.has(k)) || (!v.buy && BUY_KEYS.has(k)) || BOTH_KEYS.has(k);
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object' || x instanceof Date || x._bsontype) return x;
    const out = {};
    for (const [k, val] of Object.entries(x)) if (!drop(k)) out[k] = walk(val);
    return out;
  };
  return walk(obj);
};

module.exports = {
  maskMoney,
  SALES_ROLES, VENDOR_ROLES, VENDOR_LEADS, BUY_FIELDS, SELL_FIELDS,
  isSalesRole, isVendorRole, isVendorLead, priceView, stripOrderPrices, requestSellVisible, FLEET_ROLES,
};
