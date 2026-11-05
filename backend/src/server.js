require('dotenv').config();
// Before any model compiles, so every schema gets it.
require('mongoose').plugin(require('./utils/keepDeleted'));
const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrfGuard = require('./middleware/csrf');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const authenticate = require('./middleware/auth');
const sectionGate = require('./middleware/sectionGate');
const { initializeSocket } = require('./websocket/socketManager');
const { startWalletAutoCloseJob } = require('./jobs/walletAutoClose');
// Google Sheets order sync was removed; orders are now entered in the system (b2cEntryController).
const { startOpsPoll } = require('./jobs/opsPoll');
const { startOpsReconcile } = require('./jobs/opsReconcile');
const { startOpsCustomerSync } = require('./services/opsCustomerSyncService');
const { startOpsWorkflowSync } = require('./services/opsWorkflowSyncService');
const { startLs2Poll } = require('./jobs/ls2Poll');
// Pre-computes Wialon trip metrics off-hours so driver/vehicle reports are instant.
const { startLs2TripWarm } = require('./jobs/ls2TripWarm');
const { startBusinessReviewSweep } = require('./jobs/businessReviewSweep');
const { startHrTransferAlerts } = require('./jobs/hrTransferAlerts');
const { startKeepAlive } = require('./jobs/keepAlive');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const notificationRoutes = require('./routes/notifications');
const auditRoutes = require('./routes/audit');
const analyticsRoutes = require('./routes/analytics');
const assistantRoutes = require('./routes/assistant');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const workflowRoutes = require('./routes/workflows');
const collectionsDeptRoutes = require('./routes/collectionsDept');
const branchRoutes = require('./routes/branches');
const vendorRoutes = require('./routes/vendors');
const driverRoutes = require('./routes/drivers');
const expenseCategoryRoutes = require('./routes/expenseCategories');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const complaintRoutes = require('./routes/complaints');
const b2cRoutes = require('./routes/b2c');
const lightTransportRoutes = require('./routes/lightTransport');
const remoteRoutes = require('./routes/remote');
const hrRoutes = require('./routes/hr');
const crmRoutes = require('./routes/crm');
const accountingRoutes = require('./routes/accounting');
const financeRoutes = require('./routes/finance');
const salesRoutes = require('./routes/sales');
const procurementRoutes = require('./routes/procurement');
const lookupRoutes = require('./routes/lookups');
const customsClearanceRoutes = require('./routes/customsClearance');
const vehicleRoutes = require('./routes/vehicles');
const vehicleRegistryRoutes = require('./routes/vehicleRegistry');
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
const contractsRoutes = require('./routes/contracts');
// Customer and vendor accounts and their portal: partner account provisioning (staff side) and the partner-facing portal (client side).
const partnerRoutes = require('./routes/partners');
const portalRoutes = require('./routes/portal');
// Reports center: cross-section PDF reports (vehicle, driver, customer, vendor, employee, department). Deliberately not section-gated; see routes/reports.js.
const reportRoutes = require('./routes/reports');
// Business review meetings: the managers/board forum and its action register.
const businessReviewRoutes = require('./routes/businessReview');

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
    // Rejected without exception. Throwing here would reach the global error handler and return 500, which reads as a server fault, gets retried and reported, and hides that the origin is simply not allowed. The explicit rejection comes from csrfGuard below with its own message.
    callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
}));


// Body parsing. Limit is generous because employee documents are uploaded as
// base64 data URLs in JSON (no multer dependency) — see utils/fileStore.js.
app.use(express.json({ limit: '25mb' }));
// urlencoded is intentionally removed: this server accepts only JSON. A form parser would let a form on any other site send a simple request that reaches the handler without preflight, half of a request-forgery hole; csrfGuard below closes the other half.
app.use(cookieParser());

// Sanitizing runs after the body parsers, not before. It used to run before express.json() and skips what does not exist, and req.body did not exist yet, so bodies and cookies passed unsanitized. Now it runs after them and sees what it inspects.
app.use(mongoSanitize());

// Reject anything from a foreign origin on every state-changing request, before it reaches any route.
app.use(csrfGuard);

// Audit safety net: every successful write in a section is recorded even if its controller forgot.
app.use(require('./middleware/auditTrail'));

// Static serving of uploaded files (employee documents), mounted under /api/uploads so the frontend proxy forwards it same-origin.
// Placed before the rate limiter so viewing files does not use the API quota. Filenames are random; the app is internal.
// Browser errors arrive without a login; see routes/clientErrors.
app.use('/api/client-errors', require('./routes/clientErrors'));
// Files download under a readable name. The on-disk name is random on purpose. Browsers name it via the download attribute, but the mobile app opens the link as is, so it requests the name in ?dl= and gets it here.
app.use('/api/uploads', (req, res, next) => {
  const dl = typeof req.query.dl === 'string' ? req.query.dl.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 180) : '';
  if (dl) {
    const ascii = dl.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
    // A name truncated in the middle of a composite character breaks encoding, so the file downloads under its Latin name.
    let star = '';
    try { star = `; filename*=UTF-8''${encodeURIComponent(dl)}`; } catch (_) { /* */ }
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"${star}`);
  }
  next();
});
app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));
// API documentation, built from the router itself at request time so it cannot drift from what is mounted: an added route appears, a removed one disappears. See services/apiDocs.
// Mounted before pageGate: pageGate guards screen calls via the page map, while this is a document read by partners with their key and no page in our system. It is guarded in its own router: a key for partners, an admin account for the internal surface.
app.use('/api/docs', require('./routes/apiDocs'));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Slow request log. Without real numbers, performance work is guesswork. Prints one line per request over the threshold, in production and development, so the slowest calls with names and times can be read from pm2 logs.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 1000);
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms < SLOW_MS) return;
    // Path without ids (/api/hr/employees/:id, not one line per employee), otherwise the log is noise with no readable pattern.
    const route = req.originalUrl.split('?')[0]
      .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:n');
    console.warn(`[slow] ${req.method} ${route} ${Math.round(ms)}ms status=${res.statusCode}`);
  });
  next();
});

// Rate limiting
// Cache sync between the two workers before serving a request. Production runs two workers, each with its own cache, so an invalidation in one does not reach the other. The shared invalidation stamp is read at most once per second: one request per second waits on a small query, the rest compare a number. See utils/ttlCache.
app.use('/api/', async (req, res, next) => {
  try { await require('./utils/ttlCache').syncIfDue(); } catch (_) { /* The cache is an optimization, not a requirement. */ }
  next();
});

app.use('/api/', generalLimiter);

// Page guard. Page permission guards the data, not just the screen: if every page calling this endpoint is closed to the role, it returns 403. Mounted before the section guards because it covers all routes and reads the requester itself without answering public routes. See middleware/pageGate.
// Scoped-role fence before it: a partner account that sees a single screen (Media Go) reaches only that screen's endpoints, as an allow-list rather than a block-list. See config/scopedRoles and middleware/scopedRoleFence.
app.use('/api/', require('./middleware/scopedRoleFence'));
app.use('/api/', require('./middleware/pageGate'));

// API Routes
// Section-owned prefixes are wrapped with authenticate + sectionGate(<section>)
// so the super_admin's dynamic role→section permissions are enforced on the API
// (view = read-only, none = 403, and grants let a permitted role through). The
// routers authenticate again internally, but that lookup is cached. Shared
// prefixes (auth, users, analytics, notifications, tasks, ...) stay ungated.
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
// What remains of the removed customers-and-finance section. The section, its pages, roles and permission-matrix entry are gone; these endpoints stay because they still have a real reader:
// - Invoices and payments: the customer portal reads them (getInvoices and getPayments limit the response to the account owner's rows for a client), and the operations workflow and wallet still create entries in them.
// - Collections follow-ups moved entirely to the collections section, recorded against a party, not a customer from the removed workflow.
// The section guard was removed from them since a nonexistent section guards nothing.
app.use('/api/invoices', authenticate, require('./middleware/denyExternal'), invoiceRoutes);
app.use('/api/payments', authenticate, require('./middleware/denyExternal'), paymentRoutes);
app.use('/api/customers', customerRoutes);
// Fleet API for automation. Outside authenticate because it uses a key, not a session, and outside csrfGuard because that guard skips requests with no session cookie. Read-only.
app.use('/api/fleet-api', require('./routes/publicFleetApi'));

app.use('/api/notifications', notificationRoutes);
app.use('/api/nav-badges', require('./routes/navBadges'));
// Selling-price change requests: approvers are checked in the controller, not by section.
app.use('/api/selling-price-requests', require('./routes/sellingPriceRequests'));
// Top management: its own gate (the flagged accounts and super admins), not a section in the permissions matrix.
app.use('/api/top-management', require('./routes/topManagement'));
// Finance's leave desk (its stage, after the direct manager) and the staff requests to HR; the chairman's desk decides the final stage.
{
  const leaveDesk = require('./routes/leaveDesk');
  const chain = require('./utils/leaveChain');
  const { isTopRole } = require('./config/constants');
  app.use('/api/finance-desk', authenticate, leaveDesk({ stage: 'finance', allow: (u) => chain.FINANCE_ROLES.includes(u?.role) || isTopRole(u?.role), denyMessage: 'هذه الصفحة للإدارة المالية', requests: true }));
  app.use('/api/chairman', authenticate, leaveDesk({ stage: 'chairman', allow: (u) => chain.isChairman(u) || isTopRole(u?.role), denyMessage: 'هذه الصفحة لرئيس مجلس الإدارة' }));
}
// Section requests to HR: guarded in the controller, see the file header.
app.use('/api/staff-requests', require('./routes/staffRequests'));
app.use('/api/audit', auditRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/assistant', assistantRoutes);
// Status roles change a status even with read-only access to Operations; the controller still checks the role.
app.patch('/api/workflows/:id/application-status', authenticate, (req, res, next) => (
  require('./controllers/workflowController').STATUS_ROLES.includes(req.user.role) && require('mongoose').isValidObjectId(req.params.id)
    ? require('./controllers/workflowController').updateApplicationStatus(req, res) : next()));
app.use('/api/workflows', authenticate, sectionGate('Operations'), workflowRoutes);
// Loads board: its page decides access, not the Operations section, so sales reach it without the rest of Operations (config/opsBoard).
app.use('/api/ops-board', require('./routes/opsBoard'));
// Operations private: the same statements at our selling price, part of the operations section with a narrower permission inside it (see routes/operationsPrivate).
// Section guard on both read and write. Writes used to be unguarded because the price was a page-specific column (PrivateSellingPrice); it is now the statement's own column (sellingValue) written via the workflow path, so it is guarded like /api/workflows and nobody gains here what they lack there. The column permission itself is checked in setSellingValue.
app.use('/api/operations-private', authenticate, sectionGate('Operations'), require('./routes/operationsPrivate'));
// Customer requests from the portal, answered by Operations (the customer communication page).
app.use('/api/customer-requests', authenticate, sectionGate('Operations'), require('./routes/customerRequests'));
app.use('/api/branches', branchRoutes);
// Two registers written by more than one section: they are stamped with the permission grant and nobody is rejected (see stampSection), so a custom role granted operations edit can save in them, and purchases keep their previous access.
app.use('/api/vendors', authenticate, sectionGate.stampSection('Operations', 'Procurement'), vendorRoutes);
app.use('/api/drivers', authenticate, sectionGate.stampSection('Operations'), driverRoutes);
app.use('/api/expense-categories', expenseCategoryRoutes);
// Collections reads the wallet but does not write to it: config/walletViewOnly.
const walletView = require('./config/walletViewOnly');
const opsWalletGate = sectionGate('Operations');
app.use('/api/wallet', authenticate,
  (req, res, next) => (walletView.isWalletViewOnly(req.user && req.user.role)
    ? walletView.walletViewOnlyGate(req, res, next) : opsWalletGate(req, res, next)),
  walletRoutes);
// Collections department. The -dept suffix distinguishes it from /api/collections (collection follow-ups under customers and finance); express matching stops at the segment boundary so neither captures the other.
app.use('/api/collections-dept', authenticate, sectionGate('Collections'), collectionsDeptRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/complaints', complaintRoutes);
// Media Go complaints, before the section router. Section endpoints are guarded by the staff guard as usual; the Media Go account has no section (config/scopedRoles), so it passes to the route's role list alone, after the fence has restricted it to this prefix.
{
  const b2cGate = sectionGate('B2C');
  const { isScopedRole } = require('./config/scopedRoles');
  app.use('/api/b2c/mediago-complaints', authenticate,
    (req, res, next) => (isScopedRole(req.user.role) ? next() : b2cGate(req, res, next)),
    require('./routes/mediagoComplaints'));
  // Advertising content: a second page shared with Media Go under the same guard.
  app.use('/api/b2c/mediago-ads', authenticate,
    (req, res, next) => (isScopedRole(req.user.role) ? next() : b2cGate(req, res, next)),
    require('./routes/mediagoAds'));
}
app.use('/api/b2c', authenticate, sectionGate('B2C'), b2cRoutes);
// Light transport: its employees, housing and operating orders, guarded by the B2C section itself.
// Custody roles reach the custody ledger without the section; its own route list decides (authorize.strict).
const custodyOrSection = (section, roles, prefix = '') => {
  const gate = sectionGate(section);
  return (req, res, next) => ((!prefix || req.path.startsWith(prefix)) && roles().includes(req.user.role) ? next() : gate(req, res, next));
};
app.use('/api/light-transport', authenticate, custodyOrSection('B2C', () => require('./controllers/ltCustodyController').CUSTODY_ROLES, '/custody'), lightTransportRoutes);
app.use('/api/remote', authenticate, sectionGate('Remote'), remoteRoutes);
app.use('/api/hr', authenticate, sectionGate('HR'), hrRoutes);
app.use('/api/crm', authenticate, sectionGate('CRM'), crmRoutes);
app.use('/api/accounting', authenticate, sectionGate('Accounting'), accountingRoutes);
app.use('/api/finance', authenticate, sectionGate('Accounting'), financeRoutes);
app.use('/api/sales', authenticate, sectionGate('Sales'), salesRoutes);
app.use('/api/procurement', authenticate, sectionGate('Procurement'), procurementRoutes);
app.use('/api/lookups', lookupRoutes);
app.use('/api/customs-clearance', authenticate, sectionGate('Customs'), customsClearanceRoutes);
app.use('/api/vehicles', authenticate, sectionGate('Vehicles'), vehicleRoutes);
app.use('/api/vehicle-registry', authenticate, sectionGate('Vehicles'), vehicleRegistryRoutes);
// /api/ops has ONE public route (POST /webhook, secured by a shared secret in
// the controller) declared before its internal auth — skip the section gate for
// it so the external UPL webhook keeps working.
app.use('/api/ops', (req, res, next) => {
  if (req.path === '/webhook') return next();
  authenticate(req, res, (err) => (err ? next(err) : sectionGate('Operations Platform')(req, res, next)));
}, opsRoutes);
app.use('/api/section-work', sectionWorkRoutes);
app.use('/api/jp', require('./routes/jp'));
app.use('/api/b2c-wallet', authenticate, sectionGate('B2C'), b2cWalletRoutes);
app.use('/api/crm-vendors', authenticate, sectionGate('CRM'), crmVendorRoutes);
// Heavy transport custody before the section router: that router limits its endpoints to section roles, and custody is also for finance roles.
app.use('/api/ls2/custody', authenticate, require('./middleware/custodyGate')({ roles: () => require('./controllers/htCustodyController').CUSTODY_ROLES, section: 'Location Solutions', page: '/system/ls2/custody' }), require('./routes/htCustody'));
app.use('/api/ls2', authenticate, sectionGate('Location Solutions'), ls2Routes);
app.use('/api/shipment-orders', authenticate, sectionGate('Shipment Orders'), shipmentOrderRoutes);
// The customer register is read from three sections. The same screen appears in shipment orders, operations and sales, so it belongs to no single section: pageGate opens it to anyone with one of the three pages, and editing is guarded by the route's role list (routes/customerRegistry).
app.use('/api/customer-registry', authenticate, require('./routes/customerRegistry'));
// Large exports are built in the background and delivered to the requester by notification; see exportJobsController.
app.use('/api/exports', authenticate, require('./routes/exportJobs'));
// The data team creates and edits loads as it does shipments, whatever the Fleet section grant; the route lists still decide each action.
app.use('/api/fleet', authenticate, custodyOrSection('Fleet Management', () => require('./config/roles').DATA_ROLES), fleetRoutes);
// No sectionGate: every performance handler scopes itself (a manager only ever
// sees their own team; only super_admin may configure or override), and a
// section switch here would risk locking managers out of their /kpis page.
app.use('/api/performance', authenticate, performanceRoutes);
app.use('/api/marketing', authenticate, sectionGate('Marketing'), marketingRoutes);
app.use('/api/business-development', authenticate, sectionGate('Business Development'), businessDevelopmentRoutes);
app.use('/api/it', authenticate, sectionGate('Software & IT'), itRoutes);
app.use('/api/admin-tasks', authenticate, sectionGate('Administration'), adminTaskRoutes);
app.use('/api/contracts', authenticate, sectionGate('Contracts'), contractsRoutes);
// Not section-gated: /api/partners is used from every section's customer profile
// page, and /api/portal belongs to outside partners who have no section at all.
app.use('/api/partners', partnerRoutes);
// One customer across all sections: where it exists (services/customerHub).
app.use('/api/customer-hub', require('./routes/customerHub'));
app.use('/api/portal', portalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/business-review', authenticate, sectionGate('Business Review'), businessReviewRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Daily target of a B2C project as plain text, for the order sheets. Each project's Google Sheet reads its target from here (IMPORTDATA), so day cells color green or red against the target set in the projects page and follow it when it changes. A single non-secret number, so no authentication (Google sends no token). See services/b2cOrderSheetSync.
app.get('/api/public/b2c-target', async (req, res) => {
  try {
    const E = require('./utils/b2cEntry');
    const p = (await E.projects()).rows.find((x) => [x.name, x.nameAr, x.code].some((n) => E.fold(n) === E.fold(req.query.project)));
    const daily = p ? (Number(p.dailyTarget) || Math.round((Number(p.monthlyTarget) || 0) / 30)) : 0;
    res.set('Cache-Control', 'no-store').type('text/plain').send(String(daily));
  } catch (e) { res.type('text/plain').send('0'); }
});

// Order sheets managed by a Google script, with a shared secret. See b2cSheetAppController.
{
  const sheetsApp = require('./controllers/b2cSheetAppController');
  app.get('/api/public/b2c-sheets/layout', sheetsApp.layout);
  app.post('/api/public/b2c-sheets/edit', sheetsApp.edit);
  app.post('/api/public/b2c-sheets/register', sheetsApp.register);
  app.get('/api/public/b2c-sheets/stamps', sheetsApp.stamps);
  app.post('/api/public/b2c-sheets/order', sheetsApp.order);
}

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

// Start listening IMMEDIATELY — do NOT wait on the DB connect + the seven
// sequential seed/migration round-trips (~10s), which previously left nginx
// getting connection-refused → a 502 window on every deploy. Mongoose buffers
// queries until the pool is ready, so DB-backed routes just wait sub-second
// while /api/health stays up the whole time.
/**
 * The route map can be loaded without starting a server.
 * The API docs check (scripts/checkApiDocs) needs the router exactly as mounted here, and copying the mounting elsewhere would create two maps that drift apart. So this file is imported itself, and API_DOCS_ONLY stops it from opening a port, connecting a database or starting the periodic jobs: the goal is the route tree, not a running server.
 */
const DOCS_ONLY = process.env.API_DOCS_ONLY === '1';

if (!DOCS_ONLY) server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  // The old instance is not stopped before the new one listens. pm2 in cluster mode replaces one instance at a time; without this signal it treats an instance as ready as soon as it is launched, before it opens its port, then kills the old one, leaving seconds with nobody listening so nginx returns 502 during deploys. The signal is sent once accepting is actually possible, so deploys drop no requests. See wait_ready in ecosystem.config.js.
  if (typeof process.send === 'function') process.send('ready');
});

// The old instance finishes its work before closing. pm2 sends SIGINT to the old instance on deploy; without a handler it dies immediately with its in-flight requests. It stops accepting new ones, finishes current ones, then exits, so users see no interruption.
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  // Upper bound: if a connection stays open (websocket), the deploy is not held forever.
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!DOCS_ONLY) connectDB().then(async () => {
  await autoSeedAdmin();
  // Seed the default HR leave types once (no-op once they exist).
  const { ensureDefaultLeaveTypes, ensureLeavePolicyDefaults } = require('./config/hrDefaults');
  await ensureDefaultLeaveTypes();
  // Backfill the advance-notice policy onto pre-existing leave types.
  await ensureLeavePolicyDefaults();
  // Seed the default chart of accounts once (no-op once they exist).
  const { ensureDefaultAccounts } = require('./config/accountingDefaults');
  await ensureDefaultAccounts();
  // Seed the default editable reference lists (lookups) once (no-op once they exist).
  const { ensureDefaultLookups } = require('./config/lookupTypes');
  await ensureDefaultLookups();
  // Day/month/year dates and stale «required» marks on filled fields are corrected once per start; see utils/employeeDateRepair.
  require('./utils/employeeDateRepair').repairEmployeeDates()
    .then((n) => { if (n) console.log(`[hr] repaired dates/marks on ${n} employee files`); })
    .catch((e) => console.error('[hr] date repair:', e.message));
  const { ensureShipmentOrderDefaults } = require('./controllers/shipmentOrdersController');
  await ensureShipmentOrderDefaults();
  const { ensureFleetDefaults } = require('./controllers/fleetController');
  await ensureFleetDefaults();
  // A contract whose term has lapsed becomes expired by itself, at startup and then hourly. See utils/contractStatus.expireLapsedContracts (safe to run in both workers).
  {
    const { expireLapsedContracts } = require('./utils/contractStatus');
    const run = () => expireLapsedContracts().then((n) => { if (n) console.log(`[contracts] ${n} lapsed → expired`); }).catch((e) => console.error('[contracts] expire:', e.message));
    run();
    setInterval(run, 60 * 60 * 1000).unref();
  }

  // Scheduled jobs run in a single instance.
  // Deploys used to cut service: one instance in fork_mode, so pm2 restart killed it before the replacement was up and nginx returned 502. The fix is two instances reloading in turn, but these nine jobs cannot run twice: the pulse would pull and raise the alert twice, and the automatic wallet close would hit the same day twice. So they are restricted to the first instance.
  // NODE_APP_INSTANCE is set by pm2 in cluster mode; when absent (manual run or fork_mode) there is one instance and the jobs run as before.
  const instance = process.env.NODE_APP_INSTANCE;
  const runsJobs = instance === undefined || instance === '0';
  if (runsJobs) {
    startWalletAutoCloseJob();
    startOpsPoll();
    // Polling sees what was added or changed, but permanently deleted records never come back on any page and nobody sees them, so the two lists are reconciled once a day.
    startOpsReconcile();
    // The vehicle filters panel is computed once after startup, so the first user to click filter does not pay for a cold connection and row reads together.
    setTimeout(() => {
      try { require('./controllers/vehicleRegistryController').warmFilters(); } catch (e) {}
    }, 45 * 1000);
    startOpsCustomerSync();
    startOpsWorkflowSync();
    require('./services/shipmentOrderWorkflowLink').startShipmentOrderLink();
    // Light-transport vehicles: an expired one stops being ridden, and an authorized person without a vehicle is assigned one. Hourly.
    try { require('./utils/ltVehicleRelease').startHourly(); } catch (e) { console.error('[lt-release] start:', e.message); }
    // B2C order sheets (one Google Sheet per project), every minute. See services/b2cOrderSheetSync.
    try { require('./services/b2cOrderSheetSync').startB2cOrderSheetSync(); } catch (e) { console.error('[b2c-sheets] start:', e.message); }
    startLs2Poll();
    startLs2TripWarm();
    startBusinessReviewSweep();
    // Pending sponsorship transfer: alert HR twice a day until the employee leaves the system.
    startHrTransferAlerts();
    // Leave start/return flips the employee's work status on the day.
    try { require('./utils/leaveReturn').startLeaveReturnSync(); } catch (e) { console.error('[leave-sync] start:', e.message); }
    // Customs nets are always derived now; legacy rows get a price that keeps their typed net.
    require('./models/CustomsClearance').backfillDerivedPrices()
      .then((k) => { if (k) console.log(`[customs] backfilled ${k} price(s) for derived nets`); })
      .catch((e) => console.error('[customs] price backfill:', e.message));
    // CRM KPI boards are computed in the background so the first opener does not wait. See warmKpis.
    try { require('./controllers/crmKpiController').startKpiWarm(); } catch (e) { /* */ }
    // Export files are deleted after one day: a snapshot of its moment, not an archive.
    try { require('./controllers/exportJobsController').startExportCleanup(); } catch (e) { /* */ }
    // B2C duty-check records and their photos are purged after fourteen days. See jobs/b2cDutyPurge.
    try { require('./jobs/b2cDutyPurge').startB2cDutyPurge(); } catch (e) { console.error('[duty-purge] start:', e.message); }
    // A customer created by a direct write is linked to its parent customer hourly (services/customerHub).
    try { require('./services/customerHub').startSweep(); } catch (e) { console.error('[customerHub] start:', e.message); }
    // Exports interrupted by a deploy are resumed, so no request stays in progress forever.
    try { require('./controllers/exportJobsController').resumeInterrupted(); } catch (e) { /* */ }
    startKeepAlive();
    console.log('DB ready — scheduled jobs started');
  } else {
    console.log(`DB ready — instance ${instance} serves requests only (jobs run on instance 0)`);
  }
}).catch((err) => {
  console.error('DB initialisation failed:', err.message);
});

module.exports = { app, server };
