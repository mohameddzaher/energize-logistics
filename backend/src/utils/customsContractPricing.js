/**
 * Customer contract prices feed 'Revenue and billing' on the transaction.
 * Prices are written once in CustomsContract.pricing and fill each transaction's revenue fields: clearance fees = container price x container count; the three transport prices come from the contract (chosen destination for port-to-customer).
 * Fields stay editable: refilling writes only to empty fields or ones still holding the last contract value, so manual edits survive. The 'fill from contract' button writes all.
 */
const CustomsContract = require('../models/CustomsContract');

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;
const fold = (s) => String(s || '').trim().toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

/** The customer's active contract that has prices; the newest start if there are several. */
async function activeCustomerContract(partyId) {
  if (!partyId) return null;
  const now = Date.now();
  const rows = await CustomsContract.find({ party: partyId, partyKind: 'customer', status: 'active' })
    .sort({ startDate: -1, createdAt: -1 }).lean();
  const live = rows.filter((c) => !c.endDate || new Date(c.endDate).getTime() >= now - 86400000);
  const priced = (c) => {
    const p = c.pricing || {};
    return num(p.clearanceFeePerContainer) !== null || num(p.portToYard) !== null || num(p.yardToCustomer) !== null
      || (p.routes || []).some((r) => num(r.price) !== null);
  };
  return live.find(priced) || null;
}

/** Intended destination: the chosen one if still in the contract, else the only one, else the one matching the transaction city. */
function pickRoute(contract, { from, to } = {}, clearance = {}) {
  const routes = ((contract && contract.pricing && contract.pricing.routes) || []).filter((r) => num(r.price) !== null);
  if (!routes.length) return null;
  if (from || to) {
    const hit = routes.find((r) => fold(r.from) === fold(from) && fold(r.to) === fold(to));
    if (hit) return hit;
  }
  if (routes.length === 1) return routes[0];
  const city = fold(clearance.city);
  if (city) {
    const byCity = routes.filter((r) => fold(r.from) === city || fold(r.from).includes(city) || city.includes(fold(r.from)));
    if (byCity.length === 1) return byCity[0];
  }
  return null;
}

/** What the contract says for this transaction; a field with no contract price does not appear. */
function pricingFor(contract, containerCount, route) {
  const p = (contract && contract.pricing) || {};
  const out = {};
  const fee = num(p.clearanceFeePerContainer);
  if (fee !== null) out.clearanceFee = r2(fee * Math.max(0, Number(containerCount) || 0));
  if (route && num(route.price) !== null) out.transportSelling = num(route.price);
  if (num(p.portToYard) !== null) out.transportToYardSelling = num(p.portToYard);
  if (num(p.yardToCustomer) !== null) out.yardToCustomerSelling = num(p.yardToCustomer);
  return out;
}

/**
 * Fills `target.revenue` from the contract and writes `target.contractPricing`.
 * `target` is a plain object (update data) or a document; `current` is what is in the database now.
 * @returns {boolean} whether anything changed
 */
function fillRevenue(target, current, contract, { overwrite = false, from, to } = {}) {
  if (!contract) return false;
  const containerCount = target.containerCount !== undefined ? target.containerCount : current.containerCount;
  const prev = (current.contractPricing && current.contractPricing.applied) || {};
  const sameContract = current.contractPricing && String(current.contractPricing.contract || '') === String(contract._id);
  const route = pickRoute(contract, {
    from: from !== undefined ? from : (sameContract ? current.contractPricing.routeFrom : ''),
    to: to !== undefined ? to : (sameContract ? current.contractPricing.routeTo : ''),
  }, { city: target.city !== undefined ? target.city : current.city });
  const want = pricingFor(contract, containerCount, route);

  const revenue = { ...((current && current.revenue) || {}), ...(target.revenue || {}) };
  let changed = false;
  for (const [k, v] of Object.entries(want)) {
    const now = num(revenue[k]);
    const untouched = now === null || now === 0 || (sameContract && num(prev[k]) !== null && now === num(prev[k]));
    if ((overwrite || untouched) && now !== v) { revenue[k] = v; changed = true; }
  }
  target.revenue = revenue;
  target.contractPricing = {
    contract: contract._id,
    contractTitle: contract.title || '',
    routeFrom: route ? route.from : '',
    routeTo: route ? route.to : '',
    applied: {
      clearanceFee: want.clearanceFee ?? null,
      transportSelling: want.transportSelling ?? null,
      transportToYardSelling: want.transportToYardSelling ?? null,
      yardToCustomerSelling: want.yardToCustomerSelling ?? null,
    },
    appliedAt: new Date(),
  };
  return changed;
}

/** Contract summary for the transaction screen: which contract, its destinations, and what it says now. */
function contractSummary(contract, clearance) {
  if (!contract) return null;
  const route = pickRoute(contract, {
    from: clearance.contractPricing && clearance.contractPricing.routeFrom,
    to: clearance.contractPricing && clearance.contractPricing.routeTo,
  }, clearance);
  return {
    _id: contract._id,
    title: contract.title,
    contractNumber: contract.contractNumber || '',
    pricing: contract.pricing || {},
    route: route ? { from: route.from, to: route.to, price: route.price } : null,
    values: pricingFor(contract, clearance.containerCount, route),
  };
}

module.exports = { activeCustomerContract, pickRoute, pricingFor, fillRevenue, contractSummary };
