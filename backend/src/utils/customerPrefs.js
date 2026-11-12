// Customer shipment preferences (defaults.*) hold several values each, e.g. two truck types.
// Rows saved before the change hold one string; every read goes through prefList so both shapes read as a list.
const PREF_KEYS = ['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch'];

const prefList = (v) => {
  const raw = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const out = [];
  for (const x of raw) {
    const s = String(x ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

const normDefaults = (d) => Object.fromEntries(PREF_KEYS.map((k) => [k, prefList(d && d[k])]));

// Lean reads bypass the schema cast, so list endpoints normalise here.
const withPrefs = (c) => (c ? { ...c, defaults: normDefaults(c.defaults) } : c);

module.exports = { PREF_KEYS, prefList, normDefaults, withPrefs };
