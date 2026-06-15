require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const { initializeSocket } = require('./websocket/socketManager');
const { startWalletAutoCloseJob } = require('./jobs/walletAutoClose');
const { startSyncScheduler: startB2CSheetSync, migrateLegacySingletonIndex: migrateB2CSheetIndex } = require('./services/b2cGoogleSheetSyncService');

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

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

// Security middleware
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(mongoSanitize());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate limiting
app.use('/api/', generalLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/disputes', disputeRoutes);
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
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workshop', workshopRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/b2c', b2cRoutes);
app.use('/api/remote', remoteRoutes);

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
  // Drop the legacy singleton_1 index on the B2C sheet sync collection so the new
  // (project, branch) compound unique index can take over. No-op on fresh installs.
  await migrateB2CSheetIndex();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start scheduled jobs
    startWalletAutoCloseJob();
    startB2CSheetSync();
  });
});

module.exports = { app, server };
