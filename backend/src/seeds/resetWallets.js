require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const Payment = require('../models/Payment');
const User = require('../models/User');

// Ehab (Jeddah branch) keeps a non-zero starting balance after the reset.
const EHAB_EMAIL = 'ehab.mansour@energize.com';
const EHAB_OPENING_BALANCE = 7735; // SAR, as of the reset date

const toDateStr = (d) => {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const txns = await WalletTransaction.find({}).lean();
    console.log(`Found ${txns.length} wallet transactions to reverse + delete`);

    let custTouched = 0, invTouched = 0, vendTouched = 0, drvTouched = 0;
    for (const t of txns) {
      if (t.type === 'collection') {
        if (t.customer) {
          const c = await Customer.findById(t.customer);
          if (c) {
            c.currentOutstanding += t.amount;
            await c.save();
            custTouched++;
          }
        }
        if (t.invoice) {
          const inv = await Invoice.findById(t.invoice);
          if (inv) {
            inv.paidAmount = Math.max(0, inv.paidAmount - t.amount);
            inv.balance = inv.amount - inv.paidAmount;
            if (inv.balance >= inv.amount) inv.status = 'pending';
            else if (inv.balance > 0) inv.status = 'partial';
            else { inv.status = 'paid'; inv.balance = 0; }
            await inv.save();
            invTouched++;
          }
        }
      }
      if (t.type === 'expense') {
        if (t.vendor) {
          const v = await Vendor.findById(t.vendor);
          if (v) { v.totalPaid = Math.max(0, v.totalPaid - t.amount); await v.save(); vendTouched++; }
        }
        if (t.driver) {
          const d = await Driver.findById(t.driver);
          if (d) { d.totalPaid = Math.max(0, d.totalPaid - t.amount); await d.save(); drvTouched++; }
        }
      }
    }
    console.log(`Reversed: customers=${custTouched}, invoices=${invTouched}, vendors=${vendTouched}, drivers=${drvTouched}`);

    const paymentResult = await Payment.deleteMany({ reference: /^WALLET-/ });
    console.log(`Deleted ${paymentResult.deletedCount} wallet-sourced Payment records`);

    const txResult = await WalletTransaction.deleteMany({});
    console.log(`Deleted ${txResult.deletedCount} wallet transactions`);

    const walletResult = await DailyWallet.deleteMany({});
    console.log(`Deleted ${walletResult.deletedCount} daily wallets`);

    console.log('Wallet reset complete. Users start fresh from scratch.');

    // ─── SEED EHAB'S OPENING BALANCE ───────────────────────────
    const ehab = await User.findOne({ email: EHAB_EMAIL });
    if (!ehab) {
      console.warn(`Ehab user (${EHAB_EMAIL}) not found — skipping opening balance seed.`);
    } else if (!ehab.branch) {
      console.warn('Ehab has no branch assigned — skipping opening balance seed.');
    } else {
      const today = toDateStr();
      await DailyWallet.create({
        user: ehab._id,
        branch: ehab.branch,
        date: today,
        openingBalance: EHAB_OPENING_BALANCE,
        closingBalance: EHAB_OPENING_BALANCE,
      });
      console.log(`Ehab opening balance set: ${EHAB_OPENING_BALANCE} SAR on ${today}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Reset failed:', err);
    process.exit(1);
  }
})();
