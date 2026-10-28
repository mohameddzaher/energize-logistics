/** Builds a real link for every detail page ([id] routes) from the local QA data. */
const path = require('path');
const fs = require('fs');
const { QA_URI, assertLocal } = require('./guard');
assertLocal(QA_URI);
const mongoose = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mongoose'));
const MAP = {
  '/system/b2c/light-transport/[id]': 'LightTransportEmployee', '/system/b2c/mediago-ads/[id]': 'MediaGoAdRequest',
  '/system/b2c/mediago-complaints/[id]': 'MediaGoComplaint', '/system/bd/opportunities/[id]': 'BdOpportunity',
  '/system/business-review/[id]': 'BrMeeting', '/system/collections-dept/parties/[id]': 'CollectionsParty',
  '/system/contracts/vendors/[id]': 'ContractVendor', '/system/crm/companies/[id]': 'CrmCompany',
  '/system/customs/[id]': 'CustomsClearance', '/system/customs/parties/[id]': 'CustomsParty',
  '/system/fleet/[id]': 'FleetShipment', '/system/fleet/customers/[id]': 'FleetCustomer', '/system/fleet/vehicles/[id]': 'FleetVehicle',
  '/system/hr/employees/[id]': 'Employee', '/system/it/tickets/[id]': 'ItTicket', '/system/ls2/maintenance/[id]': 'Ls2Repair',
  '/system/ls2/tires/[id]': 'Ls2TireAsset', '/system/marketing/campaigns/[id]': 'MarketingCampaign',
  '/system/operations/[id]': 'OperationsWorkflow', '/system/operations/customers/[id]': 'Customer',
  '/system/performance/evaluate/[employeeId]': 'Employee', '/system/sales/customers/[id]': 'CrmCompany',
  '/system/shipment-orders/customers/[id]': 'ShipmentOrderCustomer', '/system/vehicles/[id]': 'Vehicle',
  '/system/vehicles/registry/[id]': 'VehicleMaster', '/system/vehicles/registry/claims/[id]': 'VehicleClaim',
  '/system/wallet-dashboard/branch/[id]': 'Branch',
};
const MODELS = path.join(__dirname, '..', 'backend', 'src', 'models');
for (const f of fs.readdirSync(MODELS)) if (f.endsWith('.js')) { try { require(path.join(MODELS, f)); } catch { /* */ } }
(async () => {
  await mongoose.connect(QA_URI);
  const db = mongoose.connection.db;
  const urls = [];
  const one = async (coll, q = {}) => db.collection(coll).findOne(q);
  for (const [route, model] of Object.entries(MAP)) {
    let doc = null;
    try { doc = await mongoose.model(model).collection.findOne({}); } catch (e) { console.warn('model', model, e.message); }
    if (doc) urls.push(route.replace(/\[[^\]]+\]/, String(doc._id)));
    else console.warn('no record for', route);
  }
  const ls2 = await one('ls2vehicles'); if (ls2) urls.push(`/system/ls2/${ls2.unitId}`);
  const fv = await one('fleetvehicles'); if (fv && fv.plate) urls.push(`/system/fleet/vehicle-logs/${encodeURIComponent(fv.plate)}`);
  const inv = await one('collectioninvoices', { kind: 'tax' }); if (inv) urls.push(`/system/collections-dept/invoices/tax/${encodeURIComponent(inv.invoiceNumber)}`);
  urls.push('/system/hr/master/all');
  fs.writeFileSync(path.join(__dirname, 'out', 'detail-urls.txt'), urls.join('\n'));
  console.log(urls.length, 'detail links');
  await mongoose.disconnect(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
