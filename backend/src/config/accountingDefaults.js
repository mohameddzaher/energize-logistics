// Default Chart of Accounts (seeded once, idempotent) + the standard account
// codes the auto-posting engine relies on. Accounting follows double-entry:
// every journal entry's debits must equal its credits.

// type → normal balance side. Assets & expenses are debit-normal; liabilities,
// equity & revenue are credit-normal.
const NORMAL_BALANCE = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

const ACCOUNT_TYPES = [
  { key: 'asset', nameEn: 'Asset', nameAr: 'أصل' },
  { key: 'liability', nameEn: 'Liability', nameAr: 'التزام' },
  { key: 'equity', nameEn: 'Equity', nameAr: 'حقوق ملكية' },
  { key: 'revenue', nameEn: 'Revenue', nameAr: 'إيراد' },
  { key: 'expense', nameEn: 'Expense', nameAr: 'مصروف' },
];

// Standard codes used by the posting engine — keep these stable.
const CODES = {
  CASH: '1000',
  BANK: '1010',
  AR: '1100',          // Accounts Receivable
  INVENTORY: '1200',
  AP: '2000',          // Accounts Payable
  VAT_PAYABLE: '2100',
  EQUITY: '3000',
  SALES_REVENUE: '4000',
  OTHER_REVENUE: '4900',
  COGS: '5000',        // Cost of goods / purchases
  OPEX: '6000',        // Operating expenses (default bucket)
  SALARIES: '6100',
};

const DEFAULT_ACCOUNTS = [
  { code: '1000', nameEn: 'Cash on Hand', nameAr: 'النقدية', type: 'asset' },
  { code: '1010', nameEn: 'Bank', nameAr: 'البنك', type: 'asset' },
  { code: '1100', nameEn: 'Accounts Receivable', nameAr: 'الذمم المدينة', type: 'asset' },
  { code: '1200', nameEn: 'Inventory', nameAr: 'المخزون', type: 'asset' },
  { code: '2000', nameEn: 'Accounts Payable', nameAr: 'الذمم الدائنة', type: 'liability' },
  { code: '2100', nameEn: 'VAT Payable', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'liability' },
  { code: '3000', nameEn: "Owner's Equity", nameAr: 'حقوق الملكية', type: 'equity' },
  { code: '4000', nameEn: 'Sales Revenue', nameAr: 'إيرادات المبيعات', type: 'revenue' },
  { code: '4900', nameEn: 'Other Revenue', nameAr: 'إيرادات أخرى', type: 'revenue' },
  { code: '5000', nameEn: 'Cost of Goods Sold', nameAr: 'تكلفة البضاعة المباعة', type: 'expense' },
  { code: '6000', nameEn: 'Operating Expenses', nameAr: 'مصروفات تشغيلية', type: 'expense' },
  { code: '6100', nameEn: 'Salaries & Wages', nameAr: 'الرواتب والأجور', type: 'expense' },
  { code: '6200', nameEn: 'Rent', nameAr: 'الإيجار', type: 'expense' },
  { code: '6300', nameEn: 'Fuel & Transport', nameAr: 'الوقود والنقل', type: 'expense' },
  { code: '6400', nameEn: 'Maintenance', nameAr: 'الصيانة', type: 'expense' },
  { code: '6900', nameEn: 'Other Expenses', nameAr: 'مصروفات أخرى', type: 'expense' },
];

const ensureDefaultAccounts = async () => {
  try {
    const ChartAccount = require('../models/ChartAccount');
    const count = await ChartAccount.estimatedDocumentCount();
    if (count > 0) return;
    await ChartAccount.insertMany(
      DEFAULT_ACCOUNTS.map((a) => ({ ...a, normalBalance: NORMAL_BALANCE[a.type], system: true, isActive: true }))
    );
    console.log('Seeded default chart of accounts');
  } catch (err) {
    console.error('ensureDefaultAccounts error:', err.message);
  }
};

module.exports = { NORMAL_BALANCE, ACCOUNT_TYPES, CODES, DEFAULT_ACCOUNTS, ensureDefaultAccounts };
