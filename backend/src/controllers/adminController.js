const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CollectionActivity = require('../models/CollectionActivity');
const CollectionTask = require('../models/CollectionTask');
const TaskSuggestion = require('../models/TaskSuggestion');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const ExpenseCategory = require('../models/ExpenseCategory');

const clearData = async (req, res) => {
  try {
    const collections = [
      { name: 'DailyWallet', model: DailyWallet },
      { name: 'WalletTransaction', model: WalletTransaction },
      { name: 'Customer', model: Customer },
      { name: 'Invoice', model: Invoice },
      { name: 'Payment', model: Payment },
      { name: 'CollectionActivity', model: CollectionActivity },
      { name: 'CollectionTask', model: CollectionTask },
      { name: 'TaskSuggestion', model: TaskSuggestion },
      { name: 'Dispute', model: Dispute },
      { name: 'Notification', model: Notification },
      { name: 'AuditLog', model: AuditLog },
      { name: 'OperationsWorkflow', model: OperationsWorkflow },
      { name: 'Vendor', model: Vendor },
      { name: 'Driver', model: Driver },
      { name: 'ExpenseCategory', model: ExpenseCategory },
    ];

    const results = {};

    for (const { name, model } of collections) {
      const result = await model.deleteMany({});
      results[name] = result.deletedCount;
    }

    res.json({
      message: 'Data cleared successfully',
      deletedCounts: results,
    });
  } catch (error) {
    console.error('Clear data error:', error);
    res.status(500).json({ message: 'Failed to clear data', error: error.message });
  }
};

module.exports = { clearData };
