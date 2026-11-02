/**
 * jpLinks: what a work-plan task is linked to in each section (a clearance transaction, shipment order, report, employee, vehicle...). It is added from that page and appears there and in the section plan live (jp:changed).
 * Per kind: its word, model, name reader, search, where it opens, and the sections that link to it.
 * Both clients read the word and link from GET /api/jp/me (linkKinds + linkMeta), so no second list ages.
 */
const mongoose = require('mongoose');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rx = (q) => new RegExp(esc(q).replace(/\s+/g, '\\s*'), 'i');
const num = (q) => (/^\d+$/.test(String(q).trim()) ? Number(q) : null);
const join = (...xs) => xs.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join(' · ');
const M = (name, file) => () => mongoose.models[name] || (file ? require(`../models/${file}`)[name] || require(`../models/${file}`) : require(`../models/${name}`));

const party = (kind, ar, en) => ({
  ar, en, sections: ['customs'], model: M('CustomsParty'), select: 'name', base: { kind },
  label: (d) => d.name, search: (q) => ({ name: rx(q) }), href: (id) => `/system/customs/parties/${id}`,
});

const KINDS = {
  clearance: {
    ar: 'معاملة', en: 'Transaction', sections: ['customs', 'accounting'],
    model: M('CustomsClearance'), select: 'refNumber blNumber customerName',
    label: (d) => join(d.blNumber || d.refNumber, d.customerName),
    search: (q) => ({ $or: [{ refNumber: rx(q) }, { blNumber: rx(q) }, { customerName: rx(q) }] }),
    href: (id) => `/system/customs/${id}`,
  },
  customer: party('customer', 'عميل', 'Customer'),
  agent: party('agent', 'وكيل شحن', 'Shipping agent'),
  carrier: party('carrier', 'ناقل', 'Carrier'),
  workflow: {
    ar: 'تقرير تشغيل', en: 'Ops report', sections: ['operations', 'collections'],
    model: M('OperationsWorkflow'), select: 'reportNumber customerName plateNumber',
    label: (d) => join(d.reportNumber && `#${d.reportNumber}`, d.customerName, d.plateNumber),
    search: (q) => ({ $or: [{ reportNumber: rx(q) }, { customerName: rx(q) }, { plateNumber: rx(q) }] }),
    href: (id) => `/system/operations/${id}`,
  },
  shipment: {
    ar: 'شحنة', en: 'Shipment', sections: ['shipment-orders', 'operations'],
    model: M('ShipmentOrder'), select: 'waybillNumber customerName',
    label: (d) => join(d.waybillNumber && `#${d.waybillNumber}`, d.customerName),
    search: (q) => ({ $or: [...(num(q) !== null ? [{ waybillNumber: num(q) }] : []), { customerName: rx(q) }] }),
    href: (id) => `/system/shipment-orders?open=${id}`,
  },
  fleetShipment: {
    ar: 'رحلة أسطول', en: 'Fleet trip', sections: ['fleet'],
    model: M('FleetShipment', 'FleetModels'), select: 'waybillNumber customerName',
    label: (d) => join(d.waybillNumber && `#${d.waybillNumber}`, d.customerName),
    search: (q) => ({ $or: [...(num(q) !== null ? [{ waybillNumber: num(q) }] : []), { customerName: rx(q) }] }),
    href: (id) => `/system/fleet/${id}`,
  },
  employee: {
    ar: 'موظّف', en: 'Employee', sections: ['hr', 'administration', 'remote', 'it', 'accounting'],
    model: M('Employee'), select: 'firstName lastName employeeNumber',
    label: (d) => join(`${d.firstName || ''} ${d.lastName || ''}`.trim(), d.employeeNumber && `#${d.employeeNumber}`),
    search: (q) => ({ $or: [{ firstName: rx(q) }, { lastName: rx(q) }, { employeeNumber: rx(q) }] }),
    href: (id) => `/system/hr/employees/${id}`,
  },
  vehicle: {
    ar: 'مركبة', en: 'Vehicle', sections: ['vehicles', 'b2c', 'administration'],
    model: M('VehicleMaster', 'VehicleMaster'), select: 'plateNumber serialNumber',
    label: (d) => join(d.plateNumber, d.serialNumber && `#${d.serialNumber}`),
    search: (q) => ({ $or: [{ plateNumber: rx(q) }, { serialNumber: rx(q) }] }),
    href: (id) => `/system/vehicles/registry/${id}`,
  },
  truck: {
    ar: 'شاحنة', en: 'Truck', sections: ['ls2', 'fleet'],
    model: M('Ls2Vehicle'), select: 'plate name',
    label: (d) => join(d.plate, d.name),
    search: (q) => ({ $or: [{ plate: rx(q) }, { name: rx(q) }] }),
    href: (id) => `/system/ls2/${id}`,
  },
  rep: {
    ar: 'مندوب', en: 'Rider', sections: ['b2c'],
    model: M('LightTransportEmployee', 'LightTransport'), select: 'name idNumber',
    label: (d) => join(d.name, d.idNumber),
    search: (q) => ({ $or: [{ name: rx(q) }, { idNumber: rx(q) }] }),
    href: (id) => `/system/b2c/light-transport/${id}`,
  },
  company: {
    ar: 'شركة', en: 'Company', sections: ['crm', 'sales', 'marketing', 'bd'],
    model: M('CrmCompany'), select: 'name',
    label: (d) => d.name, search: (q) => ({ name: rx(q) }),
    href: (id) => `/system/crm/companies/${id}`,
  },
  collParty: {
    ar: 'عميل تحصيل', en: 'Collections party', sections: ['collections', 'accounting'],
    model: M('CollectionsParty'), select: 'name code',
    label: (d) => join(d.name, d.code), search: (q) => ({ $or: [{ name: rx(q) }, { code: rx(q) }] }),
    href: (id) => `/system/collections-dept/parties/${id}`,
  },
  vendor: {
    ar: 'مورّد', en: 'Vendor', sections: ['contracts', 'procurement'],
    model: M('ContractVendor', 'ContractModels'), select: 'name companyName',
    label: (d) => d.name || d.companyName, search: (q) => ({ $or: [{ name: rx(q) }, { companyName: rx(q) }] }),
    href: (id) => `/system/contracts/vendors/${id}`,
  },
  ticket: {
    ar: 'تذكرة', en: 'Ticket', sections: ['it'],
    model: M('ItTicket'), select: 'ticketNumber title',
    label: (d) => join(d.ticketNumber && `#${d.ticketNumber}`, d.title),
    search: (q) => ({ $or: [{ ticketNumber: rx(q) }, { title: rx(q) }] }),
    href: (id) => `/system/it/tickets/${id}`,
  },
  opportunity: {
    ar: 'فرصة', en: 'Opportunity', sections: ['bd'],
    model: M('BdOpportunity'), select: 'name nameAr',
    label: (d) => d.nameAr || d.name, search: (q) => ({ $or: [{ name: rx(q) }, { nameAr: rx(q) }] }),
    href: (id) => `/system/bd/opportunities/${id}`,
  },
  campaign: {
    ar: 'حملة', en: 'Campaign', sections: ['marketing'],
    model: M('MarketingCampaign'), select: 'name nameAr',
    label: (d) => d.nameAr || d.name, search: (q) => ({ $or: [{ name: rx(q) }, { nameAr: rx(q) }] }),
    href: (id) => `/system/marketing/campaigns/${id}`,
  },
};

/** Link kinds for a section, in the order defined here. */
const kindsFor = (section) => Object.keys(KINDS).filter((k) => KINDS[k].sections.includes(section));

/** Name of the linked item; `null` if not found. */
async function labelOf(kind, id) {
  const k = KINDS[kind];
  if (!k || !mongoose.isValidObjectId(id)) return null;
  const d = await k.model().findOne({ _id: id, ...(k.base || {}) }).select(k.select).lean();
  return d ? (k.label(d) || '—') : null;
}

/** Search within a kind: the latest fifty (up to 200 for the phone list), or those matching the text. */
async function searchKind(kind, q, limit = 50) {
  const k = KINDS[kind];
  if (!k) return [];
  const f = { ...(k.base || {}), ...(q && String(q).trim() ? k.search(String(q).trim().slice(0, 60)) : {}) };
  const rows = await k.model().find(f).select(k.select).sort({ updatedAt: -1, _id: -1 }).limit(Math.min(200, Math.max(1, Number(limit) || 50))).lean();
  return rows.map((d) => ({ value: String(d._id), label: k.label(d) || '—' }));
}

/** What both clients read per kind: its word and link template. */
const metaFor = (section) => Object.fromEntries(kindsFor(section).map((k) => [k, {
  ar: KINDS[k].ar, en: KINDS[k].en, href: KINDS[k].href(':id'),
}]));

module.exports = { JP_LINK_KINDS: KINDS, kindsFor, labelOf, searchKind, metaFor };
