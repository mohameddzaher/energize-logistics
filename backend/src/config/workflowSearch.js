/**
 * Atlas Search over the operations reports' text fields (utils/textSearchIndex).
 * The lists match buildWorkflowFilter's NAME_FIELDS and CODE_FIELDS; after changing them run `node src/scripts/ensureSearchIndexes.js --update` on the server.
 */
const { textSearchIndex } = require('../utils/textSearchIndex');

module.exports = textSearchIndex({
  collection: 'operationsworkflows',
  name: 'workflow_text',
  nameFields: [
    'username', 'carOwner', 'driverName', 'branch', 'payingBranch',
    'fromLocation', 'toLocation', 'finalReportDestination',
    'truckType', 'truckSize', 'agentName', 'representativeName',
    'ownerName', 'carName', 'product',
  ],
  codeFields: ['carNumber', 'plateNumber', 'customsLink.refNumber', 'customsLink.blNumber', 'customsLink.containersText', 'loadNumber', 'reference', 'invoiceRef'],
});
