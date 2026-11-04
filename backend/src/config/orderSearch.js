/**
 * Atlas Search over shipment orders' text fields (utils/textSearchIndex), the same fields the shipment orders search matched by regex.
 * After changing the lists run `node src/scripts/ensureSearchIndexes.js --update` on the server.
 */
const { textSearchIndex } = require('../utils/textSearchIndex');

module.exports = textSearchIndex({
  collection: 'shipmentorders',
  name: 'order_text',
  nameFields: [
    'customerName', 'driverName', 'fromCity', 'toCity', 'vehicleName', 'supplierName', 'agentName', 'notes',
    'truckType', 'branch', 'salesRepName', 'cargoType', 'addressFrom', 'addressTo', 'cancelReason',
    'statusLog.note', 'statusLog.byName',
  ],
  codeFields: ['driverPhone', 'vehiclePlate', 'reference', 'externalRef'],
});
