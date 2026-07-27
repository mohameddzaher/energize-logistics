require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const authenticate = require('./middleware/auth');
const sectionGate = require('./middleware/sectionGate');
const { initializeSocket } = require('./websocket/socketManager');
const { startWalletAutoCloseJob } = require('./jobs/walletAutoClose');
const { startSyncScheduler: startB2CSheetSync, migrateLegacySingletonIndex: migrateB2CSheetIndex } = require('./services/b2cGoogleSheetSyncService');
const { startOpsPoll } = require('./jobs/opsPoll');
const { startOpsCustomerSync } = require('./services/opsCustomerSyncService');
const { startOpsWorkflowSync } = require('./services/opsWorkflowSyncService');
const { startLs2Poll } = require('./jobs/ls2Poll');
const { startKeepAlive } = require('./jobs/keepAlive');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const collectionRoutes = require('./routes/collections');
const disputeRoutes = require('./routes/disputes');
const notificationRoutes = require('./routes/notifications');
const auditRoutes = require('./routes/audit');
const analyticsRoutes = require('./routes/analytics');
const assistantRoutes = require('./routes/assistant');
const workflowRoutes = require('./routes/workflows');
const taskRoutes = require('./routes/tasks');
const branchRoutes = require('./routes/branches');
const vendorRoutes = require('./routes/vendors');
const driverRoutes = require('./routes/drivers');
const expenseCategoryRoutes = require('./routes/expenseCategories');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const workshopRoutes = require('./routes/workshop');
const complaintRoutes = require('./routes/complaints');
const b2cRoutes = require('./routes/b2c');
const remoteRoutes = require('./routes/remote');
const hrRoutes = require('./routes/hr');
const crmRoutes = require('./routes/crm');
const accountingRoutes = require('./routes/accounting');
const salesRoutes = require('./routes/sales');
const kpiRoutes = require('./routes/kpi');
const procurementRoutes = require('./routes/procurement');
const lookupRoutes = require('./routes/lookups');
const customsClearanceRoutes = require('./routes/customsClearance');
const vehicleRoutes = require('./routes/vehicles');
const opsRoutes = require('./routes/ops');
const shipmentOrderRoutes = require('./routes/shipmentOrders');
const fleetRoutes = require('./routes/fleet');
const sectionWorkRoutes = require('./routes/sectionWork');
const b2cWalletRoutes = require('./routes/b2cWallet');
const crmVendorRoutes = require('./routes/crmVendors');
const ls2Routes = require('./routes/ls2');
const performanceRoutes = require('./routes/performance');
const marketingRoutes = require('./routes/marketing');
const businessDevelopmentRoutes = require('./routes/businessDevelopment');
const itRoutes = require('./routes/it');
const adminTaskRoutes = require('./routes/adminTasks');

// Safety net: never let a single bad request/promise take down the whole
// process. Before this, an unhandled rejection (e.g. express-rate-limit's
// X-Forwarded-For ValidationError when trust proxy was off) crashed Node,
// Render restarted, and every user got 503s in a crash loop. Log and stay up.
process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
});

const app = express();

// Render (and most PaaS) put the app behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and req.ip is wrong. `1` = trust the single Render proxy hop (not `true`,
// which would blindly trust any client-supplied header).
app.set('trust proxy', 1);

const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

// gzip-compress responses. Dashboard payloads are large JSON blobs; on a slow
// free-tier link this cuts transfer size ~70-80% and noticeably speeds up loads.
app.use(compression());

// Security middleware
app.use(helmet());
const { isAllowedOrigin } = require('./config/cors');

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(mongoSanitize());

// Body parsing. Limit is generous because employee documents are uploaded as
// base64 data URLs in JSON (no multer dependency) — see utils/fileStore.js.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

// Static serving of uploaded files (employee documents). Mounted under
// /api/uploads so the frontend's /api/* proxy forwards it (same-origin). Placed
// BEFORE the rate limiter so viewing files doesn't consume the API quota.
// Filenames are random and unguessable; the app is internal (behind login).
app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate limiting
app.use('/api/', generalLimiter);

// API Routes
// Section-owned prefixes are wrapped with authenticate + sectionGate(<section>)
// so the super_admin's dynamic role→section permissions are enforced on the API
// (view = read-only, none = 403, and grants let a permitted role through). The
// routers authenticate again internally, but that lookup is cached. Shared
// prefixes (auth, users, analytics, notifications, tasks, ...) stay ungated.
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', authenticate, sectionGate('Customers & Finance'), invoiceRoutes);
app.use('/api/payments', authenticate, sectionGate('Customers & Finance'), paymentRoutes);
app.use('/api/collections', authenticate, sectionGate('Customers & Finance'), collectionRoutes);
app.use('/api/disputes', authenticate, sectionGate('Customers & Finance'), disputeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/expense-categories', expenseCategoryRoutes);
app.use('/api/wallet', authenticate, sectionGate('Operations'), walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workshop', authenticate, sectionGate('Workshop'), workshopRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/b2c', authenticate, sectionGate('B2C'), b2cRoutes);
app.use('/api/remote', authenticate, sectionGate('Remote'), remoteRoutes);
app.use('/api/hr', authenticate, sectionGate('HR'), hrRoutes);
app.use('/api/crm', authenticate, sectionGate('CRM'), crmRoutes);
app.use('/api/accounting', authenticate, sectionGate('Accounting'), accountingRoutes);
app.use('/api/sales', authenticate, sectionGate('Sales'), salesRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/procurement', authenticate, sectionGate('Procurement'), procurementRoutes);
app.use('/api/lookups', lookupRoutes);
app.use('/api/customs-clearance', authenticate, sectionGate('Customs'), customsClearanceRoutes);
app.use('/api/vehicles', authenticate, sectionGate('Vehicles'), vehicleRoutes);
// /api/ops has ONE public route (POST /webhook, secured by a shared secret in
// the controller) declared before its internal auth — skip the section gate for
// it so the external UPL webhook keeps working.
app.use('/api/ops', (req, res, next) => {
  if (req.path === '/webhook') return next();
  authenticate(req, res, (err) => (err ? next(err) : sectionGate('Operations Platform')(req, res, next)));
}, opsRoutes);
app.use('/api/section-work', sectionWorkRoutes);
app.use('/api/b2c-wallet', authenticate, sectionGate('B2C'), b2cWalletRoutes);
app.use('/api/crm-vendors', authenticate, sectionGate('CRM'), crmVendorRoutes);
app.use('/api/ls2', authenticate, sectionGate('Location Solutions'), ls2Routes);
app.use('/api/shipment-orders', authenticate, sectionGate('Shipment Orders'), shipmentOrderRoutes);
app.use('/api/fleet', authenticate, sectionGate('Fleet Management'), fleetRoutes);
// No sectionGate: every performance handler scopes itself (a manager only ever
// sees their own team; only super_admin may configure or override), and a
// section switch here would risk locking managers out of their /kpis page.
app.use('/api/performance', authenticate, performanceRoutes);
app.use('/api/marketing', authenticate, sectionGate('Marketing'), marketingRoutes);
app.use('/api/business-development', authenticate, sectionGate('Business Development'), businessDevelopmentRoutes);
app.use('/api/it', authenticate, sectionGate('Software & IT'), itRoutes);
app.use('/api/admin-tasks', authenticate, sectionGate('Administration'), adminTaskRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Start server
const PORT = process.env.PORT || 5001;

// Auto-seed admin if none exists
const autoSeedAdmin = async () => {
  try {
    const User = require('./models/User');
    const existing = await User.findOne({ role: 'super_admin' });
    if (!existing) {
      await User.create({
        email: process.env.SEED_ADMIN_EMAIL || 'admin@energize.com',
        password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123456',
        firstName: process.env.SEED_ADMIN_FIRST_NAME || 'Super',
        lastName: process.env.SEED_ADMIN_LAST_NAME || 'Admin',
        role: 'super_admin',
        isActive: true,
      });
      console.log('Auto-seeded super admin account');
    }
  } catch (err) {
    console.error('Auto-seed admin error:', err.message);
  }
};

connectDB().then(async () => {
  await autoSeedAdmin();
  // Seed the default HR leave types once (no-op once they exist).
  const { ensureDefaultLeaveTypes } = require('./config/hrDefaults');
  await ensureDefaultLeaveTypes();
  // Seed the default chart of accounts once (no-op once they exist).
  const { ensureDefaultAccounts } = require('./config/accountingDefaults');
  await ensureDefaultAccounts();
  // Seed the default editable reference lists (lookups) once (no-op once they exist).
  const { ensureDefaultLookups } = require('./config/lookupTypes');
  await ensureDefaultLookups();
  const { ensureShipmentOrderDefaults } = require('./controllers/shipmentOrdersController');
  await ensureShipmentOrderDefaults();
  const { ensureFleetDefaults } = require('./controllers/fleetController');
  await ensureFleetDefaults();
  // Drop the legacy singleton_1 index on the B2C sheet sync collection so the new
  // (project, branch) compound unique index can take over. No-op on fresh installs.
  await migrateB2CSheetIndex();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start scheduled jobs
    startWalletAutoCloseJob();
    startB2CSheetSync();
    startOpsPoll();
    startOpsCustomerSync();
    startOpsWorkflowSync();
    startLs2Poll();
    startKeepAlive();
  });
});

module.exports = { app, server };
