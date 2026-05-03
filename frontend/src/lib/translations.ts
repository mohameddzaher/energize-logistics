import type { Lang } from '@/context/LanguageContext';

// ─── SYSTEM LAYOUT (Sidebar + Header) ────────────────────────
const layout = {
  en: {
    dashboard: 'Dashboard',
    overdue: 'Overdue',
    creditAlerts: 'Credit Alerts',
    customers: 'Customers',
    invoices: 'Invoices',
    payments: 'Payments',
    collections: 'Collections',
    collectors: 'Collectors',
    tasks: 'Tasks',
    disputes: 'Disputes',
    operations: 'Operations',
    wallet: 'Wallet',
    walletDashboard: 'Wallet Dashboard',
    branches: 'Branches',
    vendors: 'Vendors',
    drivers: 'Drivers',
    expenseCategories: 'Expense Categories',
    assistant: 'Assistant',
    reports: 'Reports',
    users: 'Users',
    auditLog: 'Audit Log',
    settings: 'Settings',
    overview: 'Overview',
    myInvoices: 'My Invoices',
    myPayments: 'My Payments',
    logout: 'Logout',
    notifications: 'Notifications',
    markAllRead: 'Mark all read',
    noNewNotifications: 'No new notifications',
    system: 'System',
    lowVisitCustomers: 'Low Visit Customers',
    workshop: 'Workshop',
    workshopPurchases: 'Purchases',
    workshopDashboard: 'Workshop Dashboard',
    workshopTasks: 'Workshop Tasks',
    inventory: 'Inventory',
    complaints: 'Complaints',
    b2c: 'B2C',
    b2cDashboard: 'B2C Dashboard',
    b2cRepsPerformance: 'Reps Performance',
    b2cReps: 'Sales Reps',
    b2cProjects: 'Projects',
    b2cDailyEntry: 'Daily Entry',
  },
  ar: {
    dashboard: 'لوحة التحكم',
    overdue: 'متأخرات',
    creditAlerts: 'تنبيهات الائتمان',
    customers: 'العملاء',
    invoices: 'الفواتير',
    payments: 'المدفوعات',
    collections: 'التحصيلات',
    collectors: 'المحصلين',
    tasks: 'المهام',
    disputes: 'النزاعات',
    operations: 'التشغيل',
    wallet: 'المحفظة',
    walletDashboard: 'لوحة المحفظة',
    branches: 'الفروع',
    vendors: 'الموردين',
    drivers: 'السائقين',
    expenseCategories: 'فئات المصروفات',
    assistant: 'المساعد',
    reports: 'التقارير',
    users: 'المستخدمين',
    auditLog: 'سجل المراجعة',
    settings: 'الإعدادات',
    overview: 'نظرة عامة',
    myInvoices: 'فواتيري',
    myPayments: 'مدفوعاتي',
    logout: 'تسجيل الخروج',
    notifications: 'الإشعارات',
    markAllRead: 'قراءة الكل',
    noNewNotifications: 'لا توجد إشعارات جديدة',
    system: 'النظام',
    lowVisitCustomers: 'عملاء قليلي الزيارة',
    workshop: 'الورشة',
    workshopPurchases: 'المشتريات',
    workshopDashboard: 'لوحة الورشة',
    workshopTasks: 'مهام الورشة',
    inventory: 'المخزون',
    complaints: 'الشكاوى',
    b2c: 'B2C',
    b2cDashboard: 'لوحة B2C',
    b2cRepsPerformance: 'أداء المناديب',
    b2cReps: 'مناديب المبيعات',
    b2cProjects: 'المشاريع',
    b2cDailyEntry: 'إدخال يومي',
  },
};

// ─── WALLET PAGE ─────────────────────────────────────────────
const walletPage = {
  en: {
    dailyWallet: 'Daily Wallet',
    selectBranch: 'Select Branch',
    today: 'Today',
    export: 'Export',
    selectBranchUser: 'Select a branch and user above to view their wallet.',
    noBranch: 'No branch assigned to your account.',
    contactAdmin: 'Contact your administrator to assign a branch.',
    opening: 'Opening',
    collections: 'Collections',
    expenses: 'Expenses',
    purchases: 'Purchases',
    closingBalance: 'Closing Balance',
    status: 'Status',
    closed: 'Closed',
    open: 'Open',
    deficit: 'Deficit',
    surplus: 'Surplus',
    expected: 'Expected',
    actual: 'Actual',
    reason: 'Reason',
    collection: 'Collection',
    expense: 'Expense',
    purchase: 'Purchase',
    closeDay: 'Close Day',
    reopenDay: 'Reopen Day',
    transactions: 'Transactions',
    type: 'Type',
    amount: 'Amount',
    details: 'Details',
    notes: 'Notes',
    time: 'Time',
    actions: 'Actions',
    noTransactions: 'No transactions yet',
    fromCompany: 'From Company',
    newTransaction: 'New',
    amountSar: 'Amount (SAR)',
    fromClient: 'From Client',
    fromCompanyLabel: 'From Company',
    deliveryStatementNumber: 'Delivery Statement Number',
    description: 'Description',
    driverName: 'Driver Name',
    receiptNumber: 'Receipt Number',
    branch: 'Branch',
    sellingPrice: 'Selling Price',
    addNotes: 'Add notes...',
    cancel: 'Cancel',
    add: 'Add',
    edit: 'Edit',
    editTransaction: 'Edit Transaction',
    itemDescription: 'Item / Description',
    saveChanges: 'Save Changes',
    expectedCashBalance: 'Expected Cash Balance',
    cashInHand: 'Cash in Hand (SAR)',
    enterAmountHave: 'Enter the amount you currently have',
    notesOptional: 'Notes (optional)',
    addAnyNotes: 'Add any notes...',
    delete: 'Delete',
    deleteConfirm: 'Delete this transaction?',
    reopenConfirm: 'Reopen this day?',
    enterDeliveryStatement: 'Enter delivery statement number...',
    enterDriverName: 'Enter driver name...',
    enterReceiptNumber: 'Enter receipt number...',
    enterBranchName: 'Enter branch name...',
    collectionPlaceholder: 'e.g. Check, bank transfer...',
    expensePlaceholder: 'e.g. Fuel, spare parts, supplies...',
    noUsers: 'No users',
    vendor: 'Vendor',
    driver: 'Driver',
    category: 'Category',
    receipt: 'Receipt',
    // Operation details shown in transactions
    client: 'Client',
    from: 'From',
    to: 'To',
    carType: 'Type',
    length: 'Length',
    carNumber: 'Car Number',
    reportDate: 'Report Date',
    operationDetails: 'Operation Details',
  },
  ar: {
    dailyWallet: 'المحفظة اليومية',
    selectBranch: 'اختر الفرع',
    today: 'اليوم',
    export: 'تصدير',
    selectBranchUser: 'اختر فرع ومستخدم من الأعلى لعرض محفظته.',
    noBranch: 'لا يوجد فرع مرتبط بحسابك.',
    contactAdmin: 'تواصل مع المسؤول لربط فرع بحسابك.',
    opening: 'الرصيد الافتتاحي',
    collections: 'التحصيلات',
    expenses: 'المصروفات',
    purchases: 'المشتريات',
    closingBalance: 'الرصيد الختامي',
    status: 'الحالة',
    closed: 'مغلق',
    open: 'مفتوح',
    deficit: 'عجز',
    surplus: 'فائض',
    expected: 'المتوقع',
    actual: 'الفعلي',
    reason: 'السبب',
    collection: 'تحصيل',
    expense: 'مصروف',
    purchase: 'مشتريات',
    closeDay: 'إغلاق اليوم',
    reopenDay: 'إعادة فتح اليوم',
    transactions: 'المعاملات',
    type: 'النوع',
    amount: 'المبلغ',
    details: 'التفاصيل',
    notes: 'ملاحظات',
    time: 'الوقت',
    actions: 'إجراءات',
    noTransactions: 'لا توجد معاملات بعد',
    fromCompany: 'من الشركة',
    newTransaction: 'جديد',
    amountSar: 'المبلغ (ريال)',
    fromClient: 'من العميل',
    fromCompanyLabel: 'من الشركة',
    deliveryStatementNumber: 'رقم كشف التخريج',
    description: 'البيان',
    driverName: 'اسم السائق',
    receiptNumber: 'رقم السند',
    branch: 'الفرع',
    sellingPrice: 'سعر البيع',
    addNotes: 'أضف ملاحظات...',
    cancel: 'إلغاء',
    add: 'إضافة',
    edit: 'تعديل',
    editTransaction: 'تعديل المعاملة',
    itemDescription: 'الصنف / الوصف',
    saveChanges: 'حفظ التغييرات',
    expectedCashBalance: 'الرصيد النقدي المتوقع',
    cashInHand: 'النقد الفعلي (ريال)',
    enterAmountHave: 'أدخل المبلغ الموجود معك',
    notesOptional: 'ملاحظات (اختياري)',
    addAnyNotes: 'أضف أي ملاحظات...',
    delete: 'حذف',
    deleteConfirm: 'هل تريد حذف هذه المعاملة؟',
    reopenConfirm: 'هل تريد إعادة فتح هذا اليوم؟',
    enterDeliveryStatement: 'أدخل رقم كشف التخريج...',
    enterDriverName: 'أدخل اسم السائق...',
    enterReceiptNumber: 'أدخل رقم السند...',
    enterBranchName: 'أدخل اسم الفرع...',
    collectionPlaceholder: 'مثال: شيك، تحويل بنكي...',
    expensePlaceholder: 'مثال: بنزين، قطع غيار، مستلزمات...',
    noUsers: 'لا يوجد مستخدمين',
    vendor: 'المورد',
    driver: 'السائق',
    category: 'التصنيف',
    receipt: 'السند',
    // Operation details shown in transactions
    client: 'العميل',
    from: 'من',
    to: 'الى',
    carType: 'النوع',
    length: 'الطول',
    carNumber: 'رقم السيارة',
    reportDate: 'تاريخ الكشف',
    operationDetails: 'تفاصيل العملية',
  },
};

// ─── WALLET DASHBOARD ────────────────────────────────────────
const walletDashboard = {
  en: {
    walletDashboard: 'Wallet Dashboard',
    allBranchesOverview: 'All branches overview',
    day: 'Day',
    range: 'Range',
    today: 'Today',
    export: 'Export',
    showingData: 'Showing aggregated data from',
    to: 'to',
    totalCollections: 'Total Collections',
    totalExpenses: 'Total Expenses',
    totalPurchases: 'Total Purchases',
    netMovement: 'Net Movement',
    closingBalance: 'Closing Balance',
    activeWallets: 'Active Wallets',
    noBranches: 'No branches configured. Add branches first.',
    collections: 'Collections',
    expenses: 'Expenses',
    purchases: 'Purchases',
    net: 'Net',
    deficit: 'Deficit',
    surplus: 'Surplus',
    activeWallet: 'active wallet',
    activeWalletPlural: 'active wallets',
    // Branch detail page
    dashboard: 'Dashboard',
    individualWallets: 'Individual Wallets',
    user: 'User',
    date: 'Date',
    opening: 'Opening',
    closing: 'Closing',
    status: 'Status',
    expected: 'Expected',
    actualCash: 'Actual Cash',
    difference: 'Difference',
    closed: 'Closed',
    open: 'Open',
    matched: 'Matched',
    allTypes: 'All Types',
    allUsers: 'All Users',
    transactionLog: 'Transaction Log',
    time: 'Time',
    type: 'Type',
    customerVendor: 'Customer/Vendor',
    amount: 'Amount',
    reference: 'Reference',
    notes: 'Notes',
    noTransactions: 'No transactions',
    // Operation details
    client: 'Client',
    from: 'From',
    to2: 'To',
    carType: 'Type',
    length: 'Length',
    carNumber: 'Car Number',
    reportDate: 'Report Date',
  },
  ar: {
    walletDashboard: 'لوحة المحفظة',
    allBranchesOverview: 'نظرة عامة على جميع الفروع',
    day: 'يوم',
    range: 'فترة',
    today: 'اليوم',
    export: 'تصدير',
    showingData: 'عرض البيانات المجمعة من',
    to: 'الى',
    totalCollections: 'إجمالي التحصيلات',
    totalExpenses: 'إجمالي المصروفات',
    totalPurchases: 'إجمالي المشتريات',
    netMovement: 'صافي الحركة',
    closingBalance: 'الرصيد الختامي',
    activeWallets: 'المحافظ النشطة',
    noBranches: 'لا توجد فروع مضافة. أضف فروع أولاً.',
    collections: 'التحصيلات',
    expenses: 'المصروفات',
    purchases: 'المشتريات',
    net: 'الصافي',
    deficit: 'عجز',
    surplus: 'فائض',
    activeWallet: 'محفظة نشطة',
    activeWalletPlural: 'محافظ نشطة',
    // Branch detail page
    dashboard: 'لوحة التحكم',
    individualWallets: 'المحافظ الفردية',
    user: 'المستخدم',
    date: 'التاريخ',
    opening: 'الافتتاحي',
    closing: 'الختامي',
    status: 'الحالة',
    expected: 'المتوقع',
    actualCash: 'النقد الفعلي',
    difference: 'الفرق',
    closed: 'مغلق',
    open: 'مفتوح',
    matched: 'متطابق',
    allTypes: 'كل الأنواع',
    allUsers: 'كل المستخدمين',
    transactionLog: 'سجل المعاملات',
    time: 'الوقت',
    type: 'النوع',
    customerVendor: 'العميل/المورد',
    amount: 'المبلغ',
    reference: 'المرجع',
    notes: 'ملاحظات',
    noTransactions: 'لا توجد معاملات',
    // Operation details
    client: 'العميل',
    from: 'من',
    to2: 'الى',
    carType: 'النوع',
    length: 'الطول',
    carNumber: 'رقم السيارة',
    reportDate: 'تاريخ الكشف',
  },
};

// ─── COMMON (shared across all pages) ────────────────────────
const common = {
  en: {
    // General
    name: 'Name', code: 'Code', city: 'City', status: 'Status', actions: 'Actions',
    active: 'Active', inactive: 'Inactive', cancel: 'Cancel', save: 'Save', create: 'Create',
    edit: 'Edit', delete: 'Delete', search: 'Search', close: 'Close', back: 'Back',
    notes: 'Notes', phone: 'Phone', email: 'Email', address: 'Address', description: 'Description',
    branch: 'Branch', category: 'Category', type: 'Type', amount: 'Amount', date: 'Date',
    from: 'From', to: 'To', reference: 'Reference', user: 'User', all: 'All',
    filters: 'Filters', clearFilters: 'Clear Filters', showing: 'Showing', of: 'of',
    page: 'Page', next: 'Next', previous: 'Previous', loading: 'Loading...', retry: 'Retry',
    yes: 'Yes', no: 'No', confirm: 'Confirm', downloadExcel: 'Download Excel', export: 'Export',
    contactPerson: 'Contact Person', totalPaid: 'Total Paid', totalOutstanding: 'Total Outstanding',
    createdAt: 'Created At', noDataFound: 'No data found', today: 'Today',
    customer: 'Customer', customers: 'Customers', invoice: 'Invoice', invoices: 'Invoices',
    payment: 'Payment', payments: 'Payments', collections: 'Collections', collection: 'Collection',
    expenses: 'Expenses', purchases: 'Purchases', time: 'Time', details: 'Details',
    firstName: 'First Name', lastName: 'Last Name', password: 'Password', role: 'Role',
    selectBranch: 'Select branch', add: 'Add',
    // Status
    open: 'Open', closed: 'Closed', pending: 'Pending', completed: 'Completed',
    // Risk
    low: 'Low', medium: 'Medium', high: 'High',
    // Confirm messages
    deleteConfirmGeneric: 'Are you sure you want to delete this?',
  },
  ar: {
    name: 'الاسم', code: 'الكود', city: 'المدينة', status: 'الحالة', actions: 'إجراءات',
    active: 'نشط', inactive: 'غير نشط', cancel: 'إلغاء', save: 'حفظ', create: 'إنشاء',
    edit: 'تعديل', delete: 'حذف', search: 'بحث', close: 'إغلاق', back: 'رجوع',
    notes: 'ملاحظات', phone: 'الهاتف', email: 'البريد الإلكتروني', address: 'العنوان', description: 'الوصف',
    branch: 'الفرع', category: 'التصنيف', type: 'النوع', amount: 'المبلغ', date: 'التاريخ',
    from: 'من', to: 'إلى', reference: 'المرجع', user: 'المستخدم', all: 'الكل',
    filters: 'تصفية', clearFilters: 'مسح التصفية', showing: 'عرض', of: 'من',
    page: 'صفحة', next: 'التالي', previous: 'السابق', loading: 'جاري التحميل...', retry: 'إعادة المحاولة',
    yes: 'نعم', no: 'لا', confirm: 'تأكيد', downloadExcel: 'تحميل Excel', export: 'تصدير',
    contactPerson: 'جهة الاتصال', totalPaid: 'إجمالي المدفوع', totalOutstanding: 'إجمالي المستحق',
    createdAt: 'تاريخ الإنشاء', noDataFound: 'لا توجد بيانات', today: 'اليوم',
    customer: 'العميل', customers: 'العملاء', invoice: 'فاتورة', invoices: 'الفواتير',
    payment: 'دفعة', payments: 'المدفوعات', collections: 'التحصيلات', collection: 'تحصيل',
    expenses: 'المصروفات', purchases: 'المشتريات', time: 'الوقت', details: 'التفاصيل',
    firstName: 'الاسم الأول', lastName: 'اسم العائلة', password: 'كلمة المرور', role: 'الدور',
    selectBranch: 'اختر الفرع', add: 'إضافة',
    open: 'مفتوح', closed: 'مغلق', pending: 'قيد الانتظار', completed: 'مكتمل',
    low: 'منخفض', medium: 'متوسط', high: 'مرتفع',
    deleteConfirmGeneric: 'هل أنت متأكد من الحذف؟',
  },
};

// ─── DASHBOARD PAGE ──────────────────────────────────────────
const dashboardPage = {
  en: {
    executiveDashboard: 'Executive Dashboard', exportExcel: 'Export Excel',
    period: 'Period', thisMonth: 'This Month', lastMonth: 'Last Month', custom: 'Custom',
    totalOutstanding: 'Total Outstanding', collectedMonth: 'Collected (Month)',
    collectionRate: 'Collection Rate', nearCreditLimit: 'Near Credit Limit',
    lowVisitCustomers: 'Low Visit Customers', overdueInvoices: 'Overdue Invoices',
    totalCustomers: 'Total Customers', highRiskClients: 'High Risk Clients',
    agingBreakdown: 'Aging Breakdown', dsoTrend: 'DSO Trend (12 Months)',
    riskDistribution: 'Risk Distribution', creditTerms: 'Credit Terms',
    cashflowForecast: 'Cashflow Forecast', expected: 'Expected', outstanding: 'Outstanding', gap: 'Gap',
    collectorPerformance: 'Collector Performance Ranking',
    rank: 'Rank', collector: 'Collector', target: 'Target', collected: 'Collected',
    efficiency: 'Efficiency', promisePercent: 'Promise %', avgDelay: 'Avg Delay', days: 'days',
    riskScore: 'Risk Score', creditTerm: 'Credit Term', vsLastMonth: 'vs last month',
    amount: 'Amount', count: 'Count', dsoDays: 'DSO (days)',
  },
  ar: {
    executiveDashboard: 'لوحة التحكم التنفيذية', exportExcel: 'تصدير Excel',
    period: 'الفترة', thisMonth: 'هذا الشهر', lastMonth: 'الشهر الماضي', custom: 'مخصص',
    totalOutstanding: 'إجمالي المستحقات', collectedMonth: 'المحصّل (الشهر)',
    collectionRate: 'نسبة التحصيل', nearCreditLimit: 'قرب حد الائتمان',
    lowVisitCustomers: 'عملاء قليلي الزيارة', overdueInvoices: 'فواتير متأخرة',
    totalCustomers: 'إجمالي العملاء', highRiskClients: 'عملاء عالي المخاطر',
    agingBreakdown: 'تحليل الأعمار', dsoTrend: 'اتجاه DSO (12 شهر)',
    riskDistribution: 'توزيع المخاطر', creditTerms: 'شروط الائتمان',
    cashflowForecast: 'توقعات التدفق النقدي', expected: 'المتوقع', outstanding: 'المستحق', gap: 'الفجوة',
    collectorPerformance: 'ترتيب أداء المحصلين',
    rank: 'الترتيب', collector: 'المحصل', target: 'الهدف', collected: 'المحصّل',
    efficiency: 'الكفاءة', promisePercent: 'نسبة الوعود', avgDelay: 'متوسط التأخير', days: 'يوم',
    riskScore: 'درجة المخاطر', creditTerm: 'مدة الائتمان', vsLastMonth: 'مقارنة بالشهر الماضي',
    amount: 'المبلغ', count: 'العدد', dsoDays: 'DSO (أيام)',
  },
};

// ─── CUSTOMERS PAGE ──────────────────────────────────────────
const customersPage = {
  en: {
    title: 'Customers', addCustomer: 'Add Customer', editCustomer: 'Edit Customer',
    searchCustomers: 'Search customers...', noCustomers: 'No customers found',
    deleteCustomer: 'Delete this customer?',
    companyName: 'Company Name', contactPerson: 'Contact Person', office: 'Office',
    creditTerm: 'Credit Term', creditLimit: 'Credit Limit', currentOutstanding: 'Outstanding',
    riskLevel: 'Risk Level', riskScore: 'Risk Score', grade: 'Grade',
    customerNumber: 'Customer Number', salesManager: 'Sales Manager',
    clientStatus: 'Client Status', clientEmail: 'Client Portal Email',
    lastPaymentDate: 'Last Payment', lastPaymentAmount: 'Last Payment Amount',
    assignedCollector: 'Assigned Collector', stopped: 'Stopped', notStopped: 'Active',
    newClient: 'New Client', activeClient: 'Active', vip: 'VIP', onHold: 'On Hold',
    blacklisted: 'Blacklisted', showStopped: 'Show Stopped', hideStopped: 'Hide Stopped',
    totalBalance: 'Total Balance', totalCreditLimit: 'Total Credit Limit',
    // Customer detail page
    overview: 'Overview', invoiceHistory: 'Invoice History', paymentHistory: 'Payment History',
    collectionActivity: 'Collection Activity', creditInfo: 'Credit Information',
    noInvoices: 'No invoices', noPayments: 'No payments', noActivity: 'No activity',
    invoiceNumber: 'Invoice #', dueDate: 'Due Date', balance: 'Balance', paidAmount: 'Paid',
    overdueDays: 'Overdue Days', paymentDate: 'Payment Date', paymentMethod: 'Payment Method',
    receivedBy: 'Received By',
    pendingInvoices: 'Pending Invoices', noPendingInvoices: 'No pending invoices',
    reportNumber: 'Report Number', reportDate: 'Report Date', from: 'From', to: 'To',
    branch: 'Branch', carOwner: 'Car Owner', sellingValue: 'Selling Value', stage: 'Stage',
  },
  ar: {
    title: 'العملاء', addCustomer: 'إضافة عميل', editCustomer: 'تعديل عميل',
    searchCustomers: 'بحث في العملاء...', noCustomers: 'لا يوجد عملاء',
    deleteCustomer: 'هل تريد حذف هذا العميل؟',
    companyName: 'اسم الشركة', contactPerson: 'جهة الاتصال', office: 'المكتب',
    creditTerm: 'مدة الائتمان', creditLimit: 'حد الائتمان', currentOutstanding: 'المستحق',
    riskLevel: 'مستوى المخاطر', riskScore: 'درجة المخاطر', grade: 'التصنيف',
    customerNumber: 'رقم العميل', salesManager: 'مدير المبيعات',
    clientStatus: 'حالة العميل', clientEmail: 'بريد بوابة العميل',
    lastPaymentDate: 'آخر دفعة', lastPaymentAmount: 'مبلغ آخر دفعة',
    assignedCollector: 'المحصل المعين', stopped: 'موقوف', notStopped: 'نشط',
    newClient: 'عميل جديد', activeClient: 'نشط', vip: 'VIP', onHold: 'معلق',
    blacklisted: 'محظور', showStopped: 'إظهار الموقوفين', hideStopped: 'إخفاء الموقوفين',
    totalBalance: 'إجمالي الرصيد', totalCreditLimit: 'إجمالي حد الائتمان',
    overview: 'نظرة عامة', invoiceHistory: 'سجل الفواتير', paymentHistory: 'سجل المدفوعات',
    collectionActivity: 'نشاط التحصيل', creditInfo: 'معلومات الائتمان',
    noInvoices: 'لا توجد فواتير', noPayments: 'لا توجد مدفوعات', noActivity: 'لا يوجد نشاط',
    invoiceNumber: 'رقم الفاتورة', dueDate: 'تاريخ الاستحقاق', balance: 'الرصيد', paidAmount: 'المدفوع',
    overdueDays: 'أيام التأخير', paymentDate: 'تاريخ الدفع', paymentMethod: 'طريقة الدفع',
    receivedBy: 'استلمها',
    pendingInvoices: 'فواتير لم تصل', noPendingInvoices: 'لا توجد فواتير معلقة',
    reportNumber: 'رقم الكشف', reportDate: 'تاريخ الكشف', from: 'من', to: 'الي',
    branch: 'الفرع', carOwner: 'مالك السيارة', sellingValue: 'قيمة البيع', stage: 'المرحلة',
  },
};

// ─── INVOICES PAGE ───────────────────────────────────────────
const invoicesPage = {
  en: {
    title: 'Invoices', addInvoice: 'Add Invoice', editInvoice: 'Edit Invoice',
    searchInvoices: 'Search invoices...', noInvoices: 'No invoices found',
    deleteInvoice: 'Delete this invoice?',
    invoiceNumber: 'Invoice #', invoiceDate: 'Invoice Date', dueDate: 'Due Date',
    paidAmount: 'Paid', balance: 'Balance', remainingDays: 'Days Left',
    overdueDays: 'Overdue Days', isOverdue: 'Overdue', creditTerm: 'Credit Term',
    total: 'Total', selectCustomer: 'Select customer', selectStatus: 'All Statuses',
    showOverdueOnly: 'Overdue Only', dateRange: 'Date Range',
    // Statuses
    paid: 'Paid', partial: 'Partial', overdue: 'Overdue', pendingStatus: 'Pending',
    frozen: 'Frozen', disputed: 'Disputed', refunded: 'Refunded',
    // Detail page
    invoiceDetails: 'Invoice Details', paymentHistory: 'Payment History',
    markAsPaid: 'Mark as Paid', markAsFrozen: 'Freeze', markAsDisputed: 'Dispute',
  },
  ar: {
    title: 'الفواتير', addInvoice: 'إضافة فاتورة', editInvoice: 'تعديل فاتورة',
    searchInvoices: 'بحث في الفواتير...', noInvoices: 'لا توجد فواتير',
    deleteInvoice: 'هل تريد حذف هذه الفاتورة؟',
    invoiceNumber: 'رقم الفاتورة', invoiceDate: 'تاريخ الفاتورة', dueDate: 'تاريخ الاستحقاق',
    paidAmount: 'المدفوع', balance: 'الرصيد', remainingDays: 'الأيام المتبقية',
    overdueDays: 'أيام التأخير', isOverdue: 'متأخر', creditTerm: 'مدة الائتمان',
    total: 'الإجمالي', selectCustomer: 'اختر عميل', selectStatus: 'كل الحالات',
    showOverdueOnly: 'المتأخرات فقط', dateRange: 'نطاق التاريخ',
    paid: 'مدفوع', partial: 'جزئي', overdue: 'متأخر', pendingStatus: 'قيد الانتظار',
    frozen: 'مجمد', disputed: 'متنازع عليه', refunded: 'مسترد',
    invoiceDetails: 'تفاصيل الفاتورة', paymentHistory: 'سجل المدفوعات',
    markAsPaid: 'تعيين كمدفوع', markAsFrozen: 'تجميد', markAsDisputed: 'نزاع',
  },
};

// ─── PAYMENTS PAGE ───────────────────────────────────────────
const paymentsPage = {
  en: {
    title: 'Payments', addPayment: 'Add Payment', noPayments: 'No payments found',
    deletePayment: 'Delete this payment?',
    paymentDate: 'Payment Date', paymentMethod: 'Payment Method', receivedBy: 'Received By',
    selectCustomer: 'Select customer', selectInvoice: 'Select invoice',
    invoiceBalance: 'Invoice Balance', quickPay: 'Quick Pay',
    cash: 'Cash', bankTransfer: 'Bank Transfer', cheque: 'Cheque', other: 'Other',
  },
  ar: {
    title: 'المدفوعات', addPayment: 'إضافة دفعة', noPayments: 'لا توجد مدفوعات',
    deletePayment: 'هل تريد حذف هذه الدفعة؟',
    paymentDate: 'تاريخ الدفع', paymentMethod: 'طريقة الدفع', receivedBy: 'استلمها',
    selectCustomer: 'اختر عميل', selectInvoice: 'اختر فاتورة',
    invoiceBalance: 'رصيد الفاتورة', quickPay: 'دفع سريع',
    cash: 'نقدي', bankTransfer: 'تحويل بنكي', cheque: 'شيك', other: 'أخرى',
  },
};

// ─── COLLECTIONS PAGE ────────────────────────────────────────
const collectionsPage = {
  en: {
    title: 'Collections', addActivity: 'Add Activity', noActivities: 'No activities found',
    followUps: 'Follow-ups', activityType: 'Activity Type',
    call: 'Call', emailType: 'Email', visit: 'Visit', promise: 'Promise',
    followUp: 'Follow-Up', whatsapp: 'WhatsApp', note: 'Note',
    promiseDate: 'Promise Date', promiseAmount: 'Promise Amount',
    promiseFulfilled: 'Promise Fulfilled', followUpDate: 'Follow-Up Date',
    amountCollected: 'Amount Collected', completionNotes: 'Completion Notes',
    markComplete: 'Mark Complete', selectInvoice: 'Select invoice',
  },
  ar: {
    title: 'التحصيلات', addActivity: 'إضافة نشاط', noActivities: 'لا توجد أنشطة',
    followUps: 'المتابعات', activityType: 'نوع النشاط',
    call: 'مكالمة', emailType: 'بريد إلكتروني', visit: 'زيارة', promise: 'وعد',
    followUp: 'متابعة', whatsapp: 'واتساب', note: 'ملاحظة',
    promiseDate: 'تاريخ الوعد', promiseAmount: 'مبلغ الوعد',
    promiseFulfilled: 'الوعد محقق', followUpDate: 'تاريخ المتابعة',
    amountCollected: 'المبلغ المحصل', completionNotes: 'ملاحظات الإنجاز',
    markComplete: 'تعيين كمكتمل', selectInvoice: 'اختر فاتورة',
  },
};

// ─── OVERDUE PAGE ────────────────────────────────────────────
const overduePage = {
  en: {
    title: 'Overdue Invoices', searchOverdue: 'Search overdue invoices...',
    noOverdue: 'No overdue invoices', invoiceNumber: 'Invoice #',
    invoiceDate: 'Invoice Date', dueDate: 'Due Date', balance: 'Balance',
    overdueDays: 'Overdue Days', grade: 'Grade', salesManager: 'Sales Manager',
    office: 'Office', assignedCollector: 'Collector',
  },
  ar: {
    title: 'الفواتير المتأخرة', searchOverdue: 'بحث في الفواتير المتأخرة...',
    noOverdue: 'لا توجد فواتير متأخرة', invoiceNumber: 'رقم الفاتورة',
    invoiceDate: 'تاريخ الفاتورة', dueDate: 'تاريخ الاستحقاق', balance: 'الرصيد',
    overdueDays: 'أيام التأخير', grade: 'التصنيف', salesManager: 'مدير المبيعات',
    office: 'المكتب', assignedCollector: 'المحصل',
  },
};

// ─── CREDIT ALERTS PAGE ──────────────────────────────────────
const creditAlertsPage = {
  en: {
    title: 'Credit Alerts', subtitle: 'Customers approaching or exceeding credit limits',
    noAlerts: 'No credit alerts', companyName: 'Company',
    creditLimit: 'Credit Limit', currentOutstanding: 'Outstanding',
    usage: 'Usage', overLimit: 'Over Limit',
  },
  ar: {
    title: 'تنبيهات الائتمان', subtitle: 'العملاء الذين يقتربون من حد الائتمان أو تجاوزوه',
    noAlerts: 'لا توجد تنبيهات', companyName: 'الشركة',
    creditLimit: 'حد الائتمان', currentOutstanding: 'المستحق',
    usage: 'الاستخدام', overLimit: 'تجاوز الحد',
  },
};

// ─── COLLECTORS PAGE ─────────────────────────────────────────
const collectorsPage = {
  en: {
    title: 'Collectors', addCollector: 'Add Collector', noCollectors: 'No collectors found',
    searchCollectors: 'Search collectors...', assignedCustomers: 'Assigned Customers',
    totalCollected: 'Total Collected', target: 'Target', efficiency: 'Efficiency',
    viewProfile: 'View Profile', assignCustomer: 'Assign Customer',
    // Detail page
    collectorProfile: 'Collector Profile', performance: 'Performance',
    recentActivity: 'Recent Activity', customerList: 'Customer List',
    noCustomersAssigned: 'No customers assigned',
  },
  ar: {
    title: 'المحصلين', addCollector: 'إضافة محصل', noCollectors: 'لا يوجد محصلين',
    searchCollectors: 'بحث في المحصلين...', assignedCustomers: 'العملاء المعينين',
    totalCollected: 'إجمالي المحصل', target: 'الهدف', efficiency: 'الكفاءة',
    viewProfile: 'عرض الملف', assignCustomer: 'تعيين عميل',
    collectorProfile: 'ملف المحصل', performance: 'الأداء',
    recentActivity: 'النشاط الأخير', customerList: 'قائمة العملاء',
    noCustomersAssigned: 'لا يوجد عملاء معينين',
  },
};

// ─── TASKS PAGE ──────────────────────────────────────────────
const tasksPage = {
  en: {
    title: 'Tasks', monitoring: 'Monitoring', suggestions: 'Suggestions',
    createTask: 'Create Task', editTask: 'Edit Task', noTasks: 'No tasks found',
    assignedTo: 'Assigned To', contactMethod: 'Contact Method', dueDate: 'Due Date',
    actionNotes: 'Action Notes', nextFollowUp: 'Next Follow-up', collectedAmount: 'Collected',
    pending: 'Pending', done: 'Done', cancelled: 'Cancelled', postponed: 'Postponed',
    call: 'Call', whatsapp: 'WhatsApp', visit: 'Visit', emailMethod: 'Email', message: 'Message',
    completionRate: 'Completion Rate', avgCompletionHours: 'Avg Completion (hrs)',
    totalCollected: 'Total Collected', byCollector: 'By Collector', byCustomer: 'By Customer',
    acceptSuggestion: 'Accept', rejectSuggestion: 'Reject',
    reason: 'Reason', overdueDays: 'Overdue Days',
  },
  ar: {
    title: 'المهام', monitoring: 'المراقبة', suggestions: 'الاقتراحات',
    createTask: 'إنشاء مهمة', editTask: 'تعديل مهمة', noTasks: 'لا توجد مهام',
    assignedTo: 'مُعين لـ', contactMethod: 'طريقة التواصل', dueDate: 'تاريخ الاستحقاق',
    actionNotes: 'ملاحظات الإجراء', nextFollowUp: 'المتابعة القادمة', collectedAmount: 'المحصل',
    pending: 'قيد الانتظار', done: 'مكتمل', cancelled: 'ملغي', postponed: 'مؤجل',
    call: 'مكالمة', whatsapp: 'واتساب', visit: 'زيارة', emailMethod: 'بريد إلكتروني', message: 'رسالة',
    completionRate: 'نسبة الإنجاز', avgCompletionHours: 'متوسط الإنجاز (ساعات)',
    totalCollected: 'إجمالي المحصل', byCollector: 'حسب المحصل', byCustomer: 'حسب العميل',
    acceptSuggestion: 'قبول', rejectSuggestion: 'رفض',
    reason: 'السبب', overdueDays: 'أيام التأخير',
  },
};

// ─── DISPUTES PAGE ───────────────────────────────────────────
const disputesPage = {
  en: {
    title: 'Disputes', addDispute: 'Add Dispute', noDisputes: 'No disputes found',
    searchDisputes: 'Search disputes...', reason: 'Reason', resolution: 'Resolution',
    openDispute: 'Open', resolvedDispute: 'Resolved', escalated: 'Escalated',
    resolveDispute: 'Resolve', escalateDispute: 'Escalate', disputeDetails: 'Dispute Details',
  },
  ar: {
    title: 'النزاعات', addDispute: 'إضافة نزاع', noDisputes: 'لا توجد نزاعات',
    searchDisputes: 'بحث في النزاعات...', reason: 'السبب', resolution: 'الحل',
    openDispute: 'مفتوح', resolvedDispute: 'محلول', escalated: 'مصعّد',
    resolveDispute: 'حل النزاع', escalateDispute: 'تصعيد', disputeDetails: 'تفاصيل النزاع',
  },
};

// ─── OPERATIONS PAGE ─────────────────────────────────────────
const operationsPage = {
  en: {
    title: 'Operations Workflow', createNew: 'Create New', importExcel: 'Import Excel',
    deleteSelected: 'Delete Selected', searchPlaceholder: 'Search by report #, client, car...',
    noWorkflows: 'No workflows found',
    reportNumber: 'Report #', reportDate: 'Report Date',
    fromLocation: 'From', toLocation: 'To', client: 'Client',
    carOwner: 'Car Owner', carNumber: 'Car Number', ownerType: 'Owner Type',
    executionStatus: 'Execution', applicationStatus: 'Application',
    paymentMethod: 'Payment Method', purchaseValue: 'Purchase Value',
    sellingValue: 'Selling Value', stage: 'Stage', lockedBy: 'Locked By',
    // Stages
    draft: 'Draft', submittedToOps: 'Submitted to Ops', opsCompleted: 'Ops Completed',
    toCollections: 'To Collections', completedStage: 'Completed',
    // Detail page
    workflowDetails: 'Workflow Details', generalInfo: 'General Information',
    driverInfo: 'Driver Information', truckInfo: 'Truck Information',
    financialInfo: 'Financial Information', invoiceInfo: 'Invoice Information',
    reviewInfo: 'Review Information',
    driverName: 'Driver Name', driverPhone: 'Driver Phone',
    truckType: 'Truck Type', truckSize: 'Truck Size', loadType: 'Load Type',
    quantity: 'Quantity', goodsValue: 'Goods Value',
    representativeName: 'Representative', country: 'Country',
    lock: 'Lock', unlock: 'Unlock', advanceStage: 'Advance Stage',
    // List page extras
    newRequest: 'New Request', exportExcel: 'Export Excel',
    deleteCount: 'Delete', total: 'Total',
    stageTransition: 'Stage Transition',
    submitToOps: 'Submit to Ops', markOpsComplete: 'Mark Ops Complete',
    returnToDraft: 'Return to Draft', returnToOps: 'Return to Ops',
    submitToCollections: 'Submit to Collections', markComplete: 'Mark Complete',
    deleteWorkflowConfirm: 'Are you sure you want to delete this workflow?',
    deleteBulkConfirm: 'Are you sure you want to delete {count} workflow(s)?',
    selectAll: 'Select all', selectRow: 'Select row',
    clearSearch: 'Clear search', clearDates: 'Clear dates',
    fromDate: 'From date', toDate: 'To date',
    // Table headers (Arabic column labels)
    thReportNumber: 'رقم الكشف', thReportDate: 'تاريخ الكشف',
    thFrom: 'من', thTo: 'الي', thBranch: 'الفرع',
    thCarOwner: 'مالك السياره', thCarNumber: 'رقم السياره',
    thOwnerType: 'نوع المالك', thExecution: 'حاله التنفيذ',
    thApplication: 'حاله الابلكيشن', thPaymentMethod: 'طريقه الدفع',
    thUsername: 'اسم المستخدم', thUserPhone: 'هاتف المستخدم',
    thTaxIndicator: 'ض / غ ض', thPurchaseValue: 'قيمه الشراء',
    thSellingValue: 'قيمه البيع', thLoadingTime: 'وقت التحميل',
    thDriverName: 'اسم السائق', thDriverPhone: 'هاتف السائق',
    thTruckType: 'نوع الشاحنة', thTruckSize: 'حجم الشاحنة',
    thLoadType: 'نوع الحمولة', thQuantity: 'الكمية',
    thReference: 'رقم المرجع', thRepresentative: 'اسم المندوب',
    thOpsReview: 'مراجعه التشغيل',
    thPaymentDate: 'تاريخ السداد', thPayingBranch: 'الفرع المسدد',
    thDocNumber: 'رقم السند', thSendingDate: 'تاريخ الارسال',
    thDeliveryDate: 'تاريخ التسليم', thAccountingReview: 'مراجعه الحسابات',
    thInvoiceNumber: 'رقم الفاتوره', thNetInvoice: 'صافي الفاتوره',
    thTax: 'ضريبه', thTotalInvoice: 'اجمالى الفاتوره',
    thInvoiceDate: 'تاريخ الفاتوره', thCollectionDate: 'تاريخ التحصيل',
    thStage: 'المرحلة',
    lockedByTooltip: 'Locked by {name}',
    // New/Create page
    newWorkflowRequest: 'New Workflow Request', importFromExcel: 'Import from Excel',
    fillDetailsBelow: 'Fill in the details below',
    uploadExcelDescription: 'Upload an Excel file with workflow data',
    singleRequest: 'Single Request',
    workflowCreatedSuccess: 'Workflow created successfully',
    failedToCreateWorkflow: 'Failed to create workflow',
    uploadExcelFile: 'Upload Excel File',
    supportsHeaders: 'Supports Arabic and English column headers with automatic field matching',
    downloadTemplate: 'Download Template',
    clickToUpload: 'Click to upload or drag and drop',
    xlsxFiles: '.xlsx, .xls files',
    rowsImported: 'rows imported', fieldsMapped: 'fields mapped',
    columnsNotMatched: 'Some columns were not matched:',
    preview: 'Preview', showingKeyColumns: 'Showing key columns',
    allFieldsImported: 'All {count} fields will be imported',
    clear: 'Clear', importCount: 'Import {count} Row(s)',
    createRequest: 'Create Request', viewOnly: 'View only',
    excelFileEmpty: 'Excel file is empty',
    failedToParseExcel: 'Failed to parse Excel file. Make sure it is a valid .xlsx or .xls file.',
    noRowsToImport: 'No rows to import',
    successfullyImported: 'Successfully imported {count} workflow(s)',
    failedToImport: 'Failed to import',
    removeRow: 'Remove row',
    applicationDetails: 'Application Details', operationsSection: 'Operations',
    manualModerator: 'Manual Moderator', collectionsSection: 'Collections',
    // Detail page extras
    editingBy: 'Editing by {name}',
    recordInfo: 'Record Info', createdBy: 'Created By',
    lastModifiedBy: 'Last Modified By', updatedAt: 'Updated At',
    readOnlyForRole: 'Read only for your role',
    workflowNotFound: 'Workflow not found', goBack: 'Go back',
    changesSavedSuccess: 'Changes saved successfully',
    failedToSave: 'Failed to save',
    stageUpdated: 'Stage updated',
    submitToOperations: 'Submit to Operations',
    failedToLock: 'Failed to lock for editing',
  },
  ar: {
    title: 'سير عمل التشغيل', createNew: 'إنشاء جديد', importExcel: 'استيراد Excel',
    deleteSelected: 'حذف المحدد', searchPlaceholder: 'بحث برقم الكشف، العميل، السيارة...',
    noWorkflows: 'لا توجد عمليات',
    reportNumber: 'رقم الكشف', reportDate: 'تاريخ الكشف',
    fromLocation: 'من', toLocation: 'إلى', client: 'العميل',
    carOwner: 'مالك السيارة', carNumber: 'رقم السيارة', ownerType: 'نوع المالك',
    executionStatus: 'التنفيذ', applicationStatus: 'الطلب',
    paymentMethod: 'طريقة الدفع', purchaseValue: 'قيمة الشراء',
    sellingValue: 'قيمة البيع', stage: 'المرحلة', lockedBy: 'مقفل بواسطة',
    draft: 'مسودة', submittedToOps: 'مرسل للتشغيل', opsCompleted: 'التشغيل مكتمل',
    toCollections: 'للتحصيلات', completedStage: 'مكتمل',
    workflowDetails: 'تفاصيل العملية', generalInfo: 'معلومات عامة',
    driverInfo: 'معلومات السائق', truckInfo: 'معلومات الشاحنة',
    financialInfo: 'معلومات مالية', invoiceInfo: 'معلومات الفاتورة',
    reviewInfo: 'معلومات المراجعة',
    driverName: 'اسم السائق', driverPhone: 'هاتف السائق',
    truckType: 'نوع الشاحنة', truckSize: 'حجم الشاحنة', loadType: 'نوع الحمولة',
    quantity: 'الكمية', goodsValue: 'قيمة البضائع',
    representativeName: 'المندوب', country: 'الدولة',
    lock: 'قفل', unlock: 'فتح القفل', advanceStage: 'تقديم المرحلة',
    // List page extras
    newRequest: 'طلب جديد', exportExcel: 'تصدير Excel',
    deleteCount: 'حذف', total: 'الإجمالي',
    stageTransition: 'انتقال المرحلة',
    submitToOps: 'إرسال للتشغيل', markOpsComplete: 'اكتمال التشغيل',
    returnToDraft: 'إرجاع للمسودة', returnToOps: 'إرجاع للتشغيل',
    submitToCollections: 'إرسال للتحصيلات', markComplete: 'اكتمال',
    deleteWorkflowConfirm: 'هل أنت متأكد من حذف هذه العملية؟',
    deleteBulkConfirm: 'هل أنت متأكد من حذف {count} عملية؟',
    selectAll: 'تحديد الكل', selectRow: 'تحديد الصف',
    clearSearch: 'مسح البحث', clearDates: 'مسح التواريخ',
    fromDate: 'من تاريخ', toDate: 'إلى تاريخ',
    // Table headers
    thReportNumber: 'رقم الكشف', thReportDate: 'تاريخ الكشف',
    thFrom: 'من', thTo: 'الي', thBranch: 'الفرع',
    thCarOwner: 'مالك السياره', thCarNumber: 'رقم السياره',
    thOwnerType: 'نوع المالك', thExecution: 'حاله التنفيذ',
    thApplication: 'حاله الابلكيشن', thPaymentMethod: 'طريقه الدفع',
    thUsername: 'اسم المستخدم', thUserPhone: 'هاتف المستخدم',
    thTaxIndicator: 'ض / غ ض', thPurchaseValue: 'قيمه الشراء',
    thSellingValue: 'قيمه البيع', thLoadingTime: 'وقت التحميل',
    thDriverName: 'اسم السائق', thDriverPhone: 'هاتف السائق',
    thTruckType: 'نوع الشاحنة', thTruckSize: 'حجم الشاحنة',
    thLoadType: 'نوع الحمولة', thQuantity: 'الكمية',
    thReference: 'رقم المرجع', thRepresentative: 'اسم المندوب',
    thOpsReview: 'مراجعه التشغيل',
    thPaymentDate: 'تاريخ السداد', thPayingBranch: 'الفرع المسدد',
    thDocNumber: 'رقم السند', thSendingDate: 'تاريخ الارسال',
    thDeliveryDate: 'تاريخ التسليم', thAccountingReview: 'مراجعه الحسابات',
    thInvoiceNumber: 'رقم الفاتوره', thNetInvoice: 'صافي الفاتوره',
    thTax: 'ضريبه', thTotalInvoice: 'اجمالى الفاتوره',
    thInvoiceDate: 'تاريخ الفاتوره', thCollectionDate: 'تاريخ التحصيل',
    thStage: 'المرحلة',
    lockedByTooltip: 'مقفل بواسطة {name}',
    // New/Create page
    newWorkflowRequest: 'طلب عملية جديد', importFromExcel: 'استيراد من Excel',
    fillDetailsBelow: 'املأ التفاصيل أدناه',
    uploadExcelDescription: 'قم بتحميل ملف Excel يحتوي على بيانات العمليات',
    singleRequest: 'طلب فردي',
    workflowCreatedSuccess: 'تم إنشاء العملية بنجاح',
    failedToCreateWorkflow: 'فشل في إنشاء العملية',
    uploadExcelFile: 'تحميل ملف Excel',
    supportsHeaders: 'يدعم عناوين الأعمدة العربية والإنجليزية مع المطابقة التلقائية',
    downloadTemplate: 'تحميل القالب',
    clickToUpload: 'انقر للتحميل أو اسحب وأفلت',
    xlsxFiles: 'ملفات .xlsx, .xls',
    rowsImported: 'صف مستورد', fieldsMapped: 'حقل مطابق',
    columnsNotMatched: 'بعض الأعمدة لم تتم مطابقتها:',
    preview: 'معاينة', showingKeyColumns: 'عرض الأعمدة الرئيسية',
    allFieldsImported: 'جميع {count} حقل سيتم استيرادها',
    clear: 'مسح', importCount: 'استيراد {count} صف',
    createRequest: 'إنشاء الطلب', viewOnly: 'عرض فقط',
    excelFileEmpty: 'ملف Excel فارغ',
    failedToParseExcel: 'فشل في قراءة ملف Excel. تأكد أنه ملف .xlsx أو .xls صالح.',
    noRowsToImport: 'لا توجد صفوف للاستيراد',
    successfullyImported: 'تم استيراد {count} عملية بنجاح',
    failedToImport: 'فشل في الاستيراد',
    removeRow: 'حذف الصف',
    applicationDetails: 'بيانات الطلب', operationsSection: 'التشغيل',
    manualModerator: 'بيانات المودريتور', collectionsSection: 'التحصيل',
    // Detail page extras
    editingBy: 'يحرر بواسطة {name}',
    recordInfo: 'معلومات السجل', createdBy: 'أنشئ بواسطة',
    lastModifiedBy: 'آخر تعديل بواسطة', updatedAt: 'تاريخ التحديث',
    readOnlyForRole: 'للقراءة فقط لدورك',
    workflowNotFound: 'العملية غير موجودة', goBack: 'رجوع',
    changesSavedSuccess: 'تم حفظ التغييرات بنجاح',
    failedToSave: 'فشل في الحفظ',
    stageUpdated: 'تم تحديث المرحلة',
    submitToOperations: 'إرسال للتشغيل',
    failedToLock: 'فشل في القفل للتحرير',
  },
};

// ─── BRANCHES PAGE ───────────────────────────────────────────
const branchesPage = {
  en: {
    title: 'Branches', addBranch: 'Add Branch', editBranch: 'Edit Branch',
    searchBranches: 'Search branches...', noBranches: 'No branches found',
    deleteBranch: 'Delete this branch?', branchName: 'Branch Name',
    xBranches: 'branches',
  },
  ar: {
    title: 'الفروع', addBranch: 'إضافة فرع', editBranch: 'تعديل فرع',
    searchBranches: 'بحث في الفروع...', noBranches: 'لا توجد فروع',
    deleteBranch: 'هل تريد حذف هذا الفرع؟', branchName: 'اسم الفرع',
    xBranches: 'فرع',
  },
};

// ─── VENDORS PAGE ────────────────────────────────────────────
const vendorsPage = {
  en: {
    title: 'Vendors', addVendor: 'Add Vendor', editVendor: 'Edit Vendor',
    searchVendors: 'Search vendors...', noVendors: 'No vendors found',
    deleteVendor: 'Delete this vendor?', vendorName: 'Vendor Name',
    xVendors: 'vendors', additionalNotes: 'Additional notes',
  },
  ar: {
    title: 'الموردين', addVendor: 'إضافة مورد', editVendor: 'تعديل مورد',
    searchVendors: 'بحث في الموردين...', noVendors: 'لا يوجد موردين',
    deleteVendor: 'هل تريد حذف هذا المورد؟', vendorName: 'اسم المورد',
    xVendors: 'مورد', additionalNotes: 'ملاحظات إضافية',
  },
};

// ─── DRIVERS PAGE ────────────────────────────────────────────
const driversPage = {
  en: {
    title: 'Drivers', addDriver: 'Add Driver', editDriver: 'Edit Driver',
    searchDrivers: 'Search drivers...', noDrivers: 'No drivers found',
    deleteDriver: 'Delete this driver?', driverName: 'Driver Name',
    idNumber: 'ID Number', xDrivers: 'drivers', optionalNotes: 'Optional notes',
  },
  ar: {
    title: 'السائقين', addDriver: 'إضافة سائق', editDriver: 'تعديل سائق',
    searchDrivers: 'بحث في السائقين...', noDrivers: 'لا يوجد سائقين',
    deleteDriver: 'هل تريد حذف هذا السائق؟', driverName: 'اسم السائق',
    idNumber: 'رقم الهوية', xDrivers: 'سائق', optionalNotes: 'ملاحظات اختيارية',
  },
};

// ─── EXPENSE CATEGORIES PAGE ─────────────────────────────────
const expenseCategoriesPage = {
  en: {
    title: 'Expense Categories', addCategory: 'Add Category', editCategory: 'Edit Category',
    searchCategories: 'Search categories...', noCategories: 'No expense categories found',
    deleteCategory: 'Delete this expense category?', categoryName: 'Category Name',
    xCategories: 'categories',
  },
  ar: {
    title: 'فئات المصروفات', addCategory: 'إضافة فئة', editCategory: 'تعديل فئة',
    searchCategories: 'بحث في الفئات...', noCategories: 'لا توجد فئات مصروفات',
    deleteCategory: 'هل تريد حذف هذه الفئة؟', categoryName: 'اسم الفئة',
    xCategories: 'فئة',
  },
};

// ─── USERS PAGE ──────────────────────────────────────────────
const usersPage = {
  en: {
    title: 'Users', addUser: 'Add User', editUser: 'Edit User',
    searchUsers: 'Search users...', noUsers: 'No users found',
    deleteUser: 'Delete this user?', resetPassword: 'Reset Password',
    lockUser: 'Lock', unlockUser: 'Unlock', newPassword: 'New Password',
    confirmPassword: 'Confirm Password', lastLogin: 'Last Login',
    linkedCustomer: 'Linked Customer', assignedCustomers: 'Assigned Customers',
    xUsers: 'users',
    // Roles
    superAdmin: 'Super Admin', admin: 'Admin', employee: 'Employee',
    operationsManager: 'Operations Manager', operationsRole: 'Operations',
    moderator: 'Moderator', clientRole: 'Client',
    // Statuses
    activeStatus: 'Active', lockedStatus: 'Locked', inactiveStatus: 'Inactive',
  },
  ar: {
    title: 'المستخدمين', addUser: 'إضافة مستخدم', editUser: 'تعديل مستخدم',
    searchUsers: 'بحث في المستخدمين...', noUsers: 'لا يوجد مستخدمين',
    deleteUser: 'هل تريد حذف هذا المستخدم؟', resetPassword: 'إعادة تعيين كلمة المرور',
    lockUser: 'قفل', unlockUser: 'فتح القفل', newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور', lastLogin: 'آخر دخول',
    linkedCustomer: 'العميل المرتبط', assignedCustomers: 'العملاء المعينين',
    xUsers: 'مستخدم',
    superAdmin: 'مدير عام', admin: 'مدير', employee: 'موظف',
    operationsManager: 'مدير التشغيل', operationsRole: 'التشغيل',
    moderator: 'مشرف', clientRole: 'عميل',
    activeStatus: 'نشط', lockedStatus: 'مقفل', inactiveStatus: 'غير نشط',
  },
};

// ─── AUDIT LOG PAGE ──────────────────────────────────────────
const auditPage = {
  en: {
    title: 'Audit Log', searchAction: 'Search action...',
    noLogs: 'No audit logs found', action: 'Action', entity: 'Entity',
    entityId: 'Entity ID', ipAddress: 'IP Address', changes: 'Changes',
    before: 'Before', after: 'After', filterByEntity: 'Filter by entity',
    showDetails: 'Show Details', hideDetails: 'Hide Details',
  },
  ar: {
    title: 'سجل المراجعة', searchAction: 'بحث في الإجراء...',
    noLogs: 'لا توجد سجلات', action: 'الإجراء', entity: 'الكيان',
    entityId: 'معرف الكيان', ipAddress: 'عنوان IP', changes: 'التغييرات',
    before: 'قبل', after: 'بعد', filterByEntity: 'تصفية حسب الكيان',
    showDetails: 'عرض التفاصيل', hideDetails: 'إخفاء التفاصيل',
  },
};

// ─── REPORTS PAGE ────────────────────────────────────────────
const reportsPage = {
  en: {
    title: 'Reports & Analytics',
    dsoTrend: 'DSO Trend', dsoByCreditTerm: 'DSO by Credit Term', dsoByBranch: 'DSO by Branch',
    agingBreakdown: 'Aging Breakdown', riskDistribution: 'Risk Distribution',
    forecast: 'Cashflow Forecast', projected: 'Projected', expected: 'Expected',
    potentialDefaults: 'Potential Defaults', creditTermSuggestions: 'Credit Term Suggestions',
    customerCount: 'Customer Count', overdueDays: 'Overdue Days',
    totalOverdue: 'Total Overdue', reason: 'Reason', currentTerm: 'Current Term',
    suggestedTerm: 'Suggested Term', week: 'Week',
  },
  ar: {
    title: 'التقارير والتحليلات',
    dsoTrend: 'اتجاه DSO', dsoByCreditTerm: 'DSO حسب مدة الائتمان', dsoByBranch: 'DSO حسب الفرع',
    agingBreakdown: 'تحليل الأعمار', riskDistribution: 'توزيع المخاطر',
    forecast: 'توقعات التدفق النقدي', projected: 'المتوقع', expected: 'المتوقع',
    potentialDefaults: 'حالات تعثر محتملة', creditTermSuggestions: 'اقتراحات مدة الائتمان',
    customerCount: 'عدد العملاء', overdueDays: 'أيام التأخير',
    totalOverdue: 'إجمالي المتأخر', reason: 'السبب', currentTerm: 'المدة الحالية',
    suggestedTerm: 'المدة المقترحة', week: 'الأسبوع',
  },
};

// ─── SETTINGS PAGE ───────────────────────────────────────────
const settingsPage = {
  en: {
    title: 'Settings', changePassword: 'Change Password',
    updatePasswordDesc: 'Update your account password. You will need to enter your current password for verification.',
    currentPassword: 'Current Password', newPassword: 'New Password',
    confirmPassword: 'Confirm Password', changePasswordBtn: 'Change Password',
    passwordChanged: 'Password changed successfully',
    fillAllFields: 'Please fill in all fields',
    passwordMinLength: 'New password must be at least 6 characters',
    passwordsNoMatch: 'New passwords do not match',
    recalculateRisk: 'Recalculate Risk Scores',
    recalculateRiskDesc: 'Manually trigger a full risk score recalculation for all customers.',
    recalculate: 'Recalculate Now', adminTools: 'Admin Tools',
  },
  ar: {
    title: 'الإعدادات', changePassword: 'تغيير كلمة المرور',
    updatePasswordDesc: 'تحديث كلمة مرور حسابك. ستحتاج لإدخال كلمة المرور الحالية للتحقق.',
    currentPassword: 'كلمة المرور الحالية', newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور', changePasswordBtn: 'تغيير كلمة المرور',
    passwordChanged: 'تم تغيير كلمة المرور بنجاح',
    fillAllFields: 'يرجى ملء جميع الحقول',
    passwordMinLength: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل',
    passwordsNoMatch: 'كلمات المرور الجديدة غير متطابقة',
    recalculateRisk: 'إعادة حساب درجات المخاطر',
    recalculateRiskDesc: 'تشغيل إعادة حساب شاملة لدرجات المخاطر لجميع العملاء.',
    recalculate: 'إعادة الحساب الآن', adminTools: 'أدوات المدير',
  },
};

// ─── ASSISTANT PAGE ──────────────────────────────────────────
const assistantPage = {
  en: {
    title: 'AI Assistant', placeholder: 'Ask me anything about your data...',
    send: 'Send', thinking: 'Thinking...', noMessages: 'Start a conversation with the AI assistant.',
  },
  ar: {
    title: 'المساعد الذكي', placeholder: 'اسألني أي شيء عن بياناتك...',
    send: 'إرسال', thinking: 'جاري التفكير...', noMessages: 'ابدأ محادثة مع المساعد الذكي.',
  },
};

// ─── LOW VISIT CUSTOMERS PAGE ────────────────────────────────
const lowVisitPage = {
  en: {
    title: 'Low Visit Customers', subtitle: 'Customers with low collection activity',
    noCustomers: 'No low visit customers', daysSinceLastVisit: 'Days Since Last Visit',
    lastVisit: 'Last Visit', outstanding: 'Outstanding', neverVisited: 'Never Visited',
  },
  ar: {
    title: 'عملاء قليلي الزيارة', subtitle: 'العملاء ذوي نشاط تحصيل منخفض',
    noCustomers: 'لا يوجد عملاء قليلي الزيارة', daysSinceLastVisit: 'أيام منذ آخر زيارة',
    lastVisit: 'آخر زيارة', outstanding: 'المستحق', neverVisited: 'لم يتم زيارته',
  },
};

// ─── PORTAL PAGES ────────────────────────────────────────────
const portalPage = {
  en: {
    overview: 'Overview', myInvoices: 'My Invoices', myPayments: 'My Payments',
    welcome: 'Welcome', totalOutstanding: 'Total Outstanding',
    totalPaid: 'Total Paid', openInvoices: 'Open Invoices',
    noInvoices: 'No invoices found', noPayments: 'No payments found',
    invoiceNumber: 'Invoice #', invoiceDate: 'Invoice Date', dueDate: 'Due Date',
    balance: 'Balance', paymentDate: 'Payment Date', paymentMethod: 'Payment Method',
  },
  ar: {
    overview: 'نظرة عامة', myInvoices: 'فواتيري', myPayments: 'مدفوعاتي',
    welcome: 'مرحباً', totalOutstanding: 'إجمالي المستحق',
    totalPaid: 'إجمالي المدفوع', openInvoices: 'الفواتير المفتوحة',
    noInvoices: 'لا توجد فواتير', noPayments: 'لا توجد مدفوعات',
    invoiceNumber: 'رقم الفاتورة', invoiceDate: 'تاريخ الفاتورة', dueDate: 'تاريخ الاستحقاق',
    balance: 'الرصيد', paymentDate: 'تاريخ الدفع', paymentMethod: 'طريقة الدفع',
  },
};

// ─── EXPORTS ─────────────────────────────────────────────────
export function getLayoutTranslations(lang: Lang) {
  return layout[lang];
}

export function getWalletTranslations(lang: Lang) {
  return walletPage[lang];
}

export function getWalletDashboardTranslations(lang: Lang) {
  return walletDashboard[lang];
}

export function getCommonTranslations(lang: Lang) {
  return common[lang];
}

export function getDashboardTranslations(lang: Lang) {
  return { ...common[lang], ...dashboardPage[lang] };
}

export function getCustomersTranslations(lang: Lang) {
  return { ...common[lang], ...customersPage[lang] };
}

export function getInvoicesTranslations(lang: Lang) {
  return { ...common[lang], ...invoicesPage[lang] };
}

export function getPaymentsTranslations(lang: Lang) {
  return { ...common[lang], ...paymentsPage[lang] };
}

export function getCollectionsTranslations(lang: Lang) {
  return { ...common[lang], ...collectionsPage[lang] };
}

export function getOverdueTranslations(lang: Lang) {
  return { ...common[lang], ...overduePage[lang] };
}

export function getCreditAlertsTranslations(lang: Lang) {
  return { ...common[lang], ...creditAlertsPage[lang] };
}

export function getCollectorsTranslations(lang: Lang) {
  return { ...common[lang], ...collectorsPage[lang] };
}

export function getTasksTranslations(lang: Lang) {
  return { ...common[lang], ...tasksPage[lang] };
}

export function getDisputesTranslations(lang: Lang) {
  return { ...common[lang], ...disputesPage[lang] };
}

export function getOperationsTranslations(lang: Lang) {
  return { ...common[lang], ...operationsPage[lang] };
}

export function getBranchesTranslations(lang: Lang) {
  return { ...common[lang], ...branchesPage[lang] };
}

export function getVendorsTranslations(lang: Lang) {
  return { ...common[lang], ...vendorsPage[lang] };
}

export function getDriversTranslations(lang: Lang) {
  return { ...common[lang], ...driversPage[lang] };
}

export function getExpenseCategoriesTranslations(lang: Lang) {
  return { ...common[lang], ...expenseCategoriesPage[lang] };
}

export function getUsersTranslations(lang: Lang) {
  return { ...common[lang], ...usersPage[lang] };
}

export function getAuditTranslations(lang: Lang) {
  return { ...common[lang], ...auditPage[lang] };
}

export function getReportsTranslations(lang: Lang) {
  return { ...common[lang], ...reportsPage[lang] };
}

export function getSettingsTranslations(lang: Lang) {
  return { ...common[lang], ...settingsPage[lang] };
}

export function getAssistantTranslations(lang: Lang) {
  return { ...common[lang], ...assistantPage[lang] };
}

export function getLowVisitTranslations(lang: Lang) {
  return { ...common[lang], ...lowVisitPage[lang] };
}

export function getPortalTranslations(lang: Lang) {
  return { ...common[lang], ...portalPage[lang] };
}

// ─── B2C PAGES ───────────────────────────────────────────────
const b2cPage = {
  en: {
    // Common
    project: 'Project', projects: 'Projects', branch: 'Branch', branches: 'Branches',
    rep: 'Rep', reps: 'Reps', allProjects: 'All Projects', allBranches: 'All Branches',
    allReps: 'All Reps', addProject: 'Add Project', editProject: 'Edit Project',
    addRep: 'Add Rep', editRep: 'Edit Rep', deleteRep: 'Delete Rep',
    repId: 'Account ID', arabicName: 'Account Username', englishName: 'Rep (Current Operator)',
    phone: 'Phone', joiningDate: 'Joining Date', monthlyTarget: 'Monthly Target',
    dailyTarget: 'Daily Target', expectedWorkingDays: 'Expected Working Days',
    selectProject: 'Select Project', selectBranch: 'Select Branch',
    selectRep: 'Select Rep', notes: 'Notes',
    // Dashboard
    dashboardTitle: 'B2C Performance Dashboard',
    dashboardSubtitle: 'Track and evaluate sales reps performance',
    overview: 'Overview', filters: 'Filters', clearFilters: 'Clear Filters',
    dateFrom: 'From', dateTo: 'To', currentMonth: 'Current Month',
    totalOrders: 'Total Orders', activeReps: 'Active Reps', avgDailyRate: 'Avg Daily Rate',
    avgPerformance: 'Avg Performance', aboveTarget: 'Above Target', onTrack: 'On Track',
    belowTarget: 'Below Target', bestRep: 'Best Rep', worstRep: 'Lowest Rep',
    bestDay: 'Best Day', workingDays: 'Working Days', teamCapacity: 'Team Capacity',
    capacityUsed: 'Capacity Used', byMonth: 'By Month', byProject: 'By Project',
    byBranch: 'By Branch', byRep: 'By Rep', dailyTrend: 'Daily Trend',
    topReps: 'Top 10 Reps', bottomReps: 'Bottom 10 Reps',
    performanceDistribution: 'Performance Distribution',
    // Reps Performance page
    repsPerformanceTitle: 'Reps Performance',
    uploadExcel: 'Upload Excel', dragDropExcel: 'Drag & drop Excel file or click to browse',
    excelHint: 'Multi-sheet .xlsx with monthly performance per rep',
    parsing: 'Parsing...', parsed: 'Parsed', uploaded: 'Uploaded',
    monthsDetected: 'Months Detected', repsDetected: 'Reps Detected',
    daysInserted: 'Days Inserted', daysUpdated: 'Days Updated', daysSkipped: 'Days Skipped',
    warnings: 'Warnings', uploadHistory: 'Upload History', mode: 'Mode',
    mergeNewOnly: 'Merge new days only', overwrite: 'Overwrite all',
    chooseProject: 'Choose project for this upload', chooseBranch: 'Choose branch (optional)',
    confirmUpload: 'Confirm Upload', noUploadsYet: 'No uploads yet',
    // Daily entry
    dailyEntryTitle: 'Quick Daily Entry',
    dailyEntrySubtitle: 'Enter today\'s orders for each rep — saves automatically',
    pickDate: 'Pick a date', pickProject: 'Pick a project', save: 'Save', saving: 'Saving',
    saved: 'Saved', noRepsForProject: 'No reps in this project',
    // Status
    excellent: 'Excellent', good: 'Good', acceptable: 'Acceptable', poor: 'Poor',
    notWorked: 'Not Worked', noData: 'No Data',
    // Rep evaluation
    evaluationTitle: 'Reps Evaluation', grade: 'Grade', consistency: 'Consistency',
    trend: 'Trend', rising: 'Rising', falling: 'Falling', stable: 'Stable',
    monthsActive: 'Months Active', dailyOrders: 'Daily Orders',
    // Profile
    repProfile: 'Rep Profile', lifetime: 'Lifetime', bestMonth: 'Best Month',
    worstMonth: 'Worst Month', monthHistory: 'Month History',
    performanceVsTarget: 'Performance vs Target', performancePercent: 'Performance %',
    shortOfTarget: 'Short of Target', performance: 'Performance',
    // Common form
    addBranch: 'Add Branch',
    name: 'Name', code: 'Code', city: 'City', description: 'Description', color: 'Color',
    delete: 'Delete', save_: 'Save', cancel: 'Cancel', add: 'Add', edit: 'Edit',
    confirmDelete: 'Are you sure you want to delete this?',
    // Roles
    b2cHead: 'B2C Head', b2cProjectManager: 'B2C Project Manager',
    assignedProjects: 'Assigned Projects', assignedBranches: 'Assigned Branches',
    manager: 'Manager (Direct Supervisor)',
    excelUploadFailed: 'Excel upload failed. Please check the file format.',
    excelParseError: 'Could not parse Excel file. Verify the structure matches expected format.',
    repCreatedFromExcel: 'Reps auto-created from Excel',
  },
  ar: {
    project: 'المشروع', projects: 'المشاريع', branch: 'الفرع', branches: 'الفروع',
    rep: 'مندوب', reps: 'المناديب', allProjects: 'كل المشاريع', allBranches: 'كل الفروع',
    allReps: 'كل المناديب', addProject: 'إضافة مشروع', editProject: 'تعديل مشروع',
    addRep: 'إضافة مندوب', editRep: 'تعديل مندوب', deleteRep: 'حذف مندوب',
    repId: 'رقم الحساب', arabicName: 'اسم اليوزر', englishName: 'اسم المندوب (الشخص الشغال على الحساب)',
    phone: 'رقم الجوال', joiningDate: 'تاريخ الانضمام', monthlyTarget: 'الهدف الشهري',
    dailyTarget: 'الهدف اليومي', expectedWorkingDays: 'أيام العمل المتوقعة',
    selectProject: 'اختر مشروع', selectBranch: 'اختر فرع',
    selectRep: 'اختر مندوب', notes: 'ملاحظات',
    dashboardTitle: 'لوحة أداء B2C',
    dashboardSubtitle: 'تتبع وتقييم أداء مناديب المبيعات',
    overview: 'نظرة عامة', filters: 'فلاتر', clearFilters: 'مسح الفلاتر',
    dateFrom: 'من', dateTo: 'إلى', currentMonth: 'الشهر الحالي',
    totalOrders: 'إجمالي الطلبات', activeReps: 'المناديب النشطين', avgDailyRate: 'متوسط الطلبات اليومي',
    avgPerformance: 'متوسط الأداء', aboveTarget: 'فوق الهدف', onTrack: 'على المسار',
    belowTarget: 'دون الهدف', bestRep: 'أفضل مندوب', worstRep: 'أقل مندوب',
    bestDay: 'أفضل يوم', workingDays: 'أيام العمل', teamCapacity: 'طاقة الفريق',
    capacityUsed: 'الطاقة المستخدمة', byMonth: 'حسب الشهر', byProject: 'حسب المشروع',
    byBranch: 'حسب الفرع', byRep: 'حسب المندوب', dailyTrend: 'الاتجاه اليومي',
    topReps: 'أفضل 10 مناديب', bottomReps: 'أقل 10 مناديب',
    performanceDistribution: 'توزيع الأداء',
    repsPerformanceTitle: 'أداء المناديب',
    uploadExcel: 'رفع ملف إكسل', dragDropExcel: 'اسحب ملف Excel هنا أو اضغط للاختيار',
    excelHint: 'ملف .xlsx متعدد الشيتات بأداء كل مندوب شهرياً',
    parsing: 'جاري التحليل...', parsed: 'تم التحليل', uploaded: 'تم الرفع',
    monthsDetected: 'الشهور المكتشفة', repsDetected: 'المناديب المكتشفين',
    daysInserted: 'الأيام المضافة', daysUpdated: 'الأيام المحدثة', daysSkipped: 'الأيام المتخطاة',
    warnings: 'تحذيرات', uploadHistory: 'سجل الرفع', mode: 'الوضع',
    mergeNewOnly: 'إضافة الأيام الجديدة فقط', overwrite: 'استبدال الكل',
    chooseProject: 'اختر مشروع لهذا الرفع', chooseBranch: 'اختر الفرع (اختياري)',
    confirmUpload: 'تأكيد الرفع', noUploadsYet: 'لا يوجد رفعات سابقة',
    dailyEntryTitle: 'إدخال يومي سريع',
    dailyEntrySubtitle: 'اكتب طلبات اليوم لكل مندوب — يحفظ تلقائياً',
    pickDate: 'اختر التاريخ', pickProject: 'اختر المشروع', save: 'حفظ', saving: 'جاري الحفظ',
    saved: 'تم الحفظ', noRepsForProject: 'لا يوجد مناديب في هذا المشروع',
    excellent: 'ممتاز', good: 'جيد', acceptable: 'مقبول', poor: 'ضعيف',
    notWorked: 'لم يعمل', noData: 'لا بيانات',
    evaluationTitle: 'تقييم المناديب', grade: 'الدرجة', consistency: 'الثبات',
    trend: 'الاتجاه', rising: 'صاعد', falling: 'هابط', stable: 'مستقر',
    monthsActive: 'أشهر النشاط', dailyOrders: 'الطلبات اليومية',
    repProfile: 'ملف المندوب', lifetime: 'مدى الحياة', bestMonth: 'أفضل شهر',
    worstMonth: 'أسوأ شهر', monthHistory: 'سجل الأشهر',
    performanceVsTarget: 'الأداء مقابل الهدف', performancePercent: 'الأداء %',
    shortOfTarget: 'الفارق عن الهدف', performance: 'الأداء',
    addBranch: 'إضافة فرع',
    name: 'الاسم', code: 'الرمز', city: 'المدينة', description: 'الوصف', color: 'اللون',
    delete: 'حذف', save_: 'حفظ', cancel: 'إلغاء', add: 'إضافة', edit: 'تعديل',
    confirmDelete: 'هل أنت متأكد من الحذف؟',
    b2cHead: 'مدير B2C', b2cProjectManager: 'مدير مشروع B2C',
    assignedProjects: 'المشاريع المعينة', assignedBranches: 'الفروع المعينة',
    manager: 'المدير المباشر',
    excelUploadFailed: 'فشل رفع الملف. تأكد من صيغة الملف.',
    excelParseError: 'تعذر تحليل الملف. تأكد أن البنية مطابقة للنموذج المتوقع.',
    repCreatedFromExcel: 'تم إنشاء مناديب جدد تلقائياً من الملف',
  },
};

export function getB2CTranslations(lang: Lang) {
  return { ...common[lang], ...b2cPage[lang] };
}

// Navigation label mapping (href -> translation key)
export const NAV_LABEL_KEYS: Record<string, keyof typeof layout.en> = {
  '/system/dashboard': 'dashboard',
  '/system/overdue': 'overdue',
  '/system/credit-alerts': 'creditAlerts',
  '/system/customers': 'customers',
  '/system/low-visit-customers': 'lowVisitCustomers',
  '/system/invoices': 'invoices',
  '/system/payments': 'payments',
  '/system/collections': 'collections',
  '/system/collectors': 'collectors',
  '/system/tasks': 'tasks',
  '/system/disputes': 'disputes',
  '/system/operations': 'operations',
  '/system/wallet': 'wallet',
  '/system/wallet-dashboard': 'walletDashboard',
  '/system/branches': 'branches',
  '/system/vendors': 'vendors',
  '/system/drivers': 'drivers',
  '/system/expense-categories': 'expenseCategories',
  '/system/assistant': 'assistant',
  '/system/reports': 'reports',
  '/system/users': 'users',
  '/system/audit': 'auditLog',
  '/system/settings': 'settings',
  '/system/portal': 'overview',
  '/system/portal/invoices': 'myInvoices',
  '/system/portal/payments': 'myPayments',
  '/system/workshop': 'workshop',
  '/system/workshop/purchases': 'workshopPurchases',
  '/system/workshop/dashboard': 'workshopDashboard',
  '/system/workshop/tasks': 'workshopTasks',
  '/system/workshop/inventory': 'inventory',
  '/system/complaints': 'complaints',
  '/system/b2c/dashboard': 'b2cDashboard',
  '/system/b2c/reps-performance': 'b2cRepsPerformance',
  '/system/b2c/reps': 'b2cReps',
  '/system/b2c/projects': 'b2cProjects',
  '/system/b2c/daily-entry': 'b2cDailyEntry',
};
