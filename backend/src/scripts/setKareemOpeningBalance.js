// One-off: set Kareem Nawar's opening balance for today (2026-06-21) to 14682.95.
// Opening balance lives on the DailyWallet record; there is no API for it, so we
// write the wallet directly and recompute the day's closing from its existing
// transaction totals (preserving any same-day movement).
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const DailyWallet = require('../models/DailyWallet');
require('../models/Branch');

const TARGET_EMAIL = 'kareem@energize.com';
const DATE = '2026-06-21';
const OPENING = 14682.95;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const user = await User.findOne({ email: TARGET_EMAIL }).select('firstName lastName branch');
  if (!user) throw new Error(`User ${TARGET_EMAIL} not found`);
  if (!user.branch) throw new Error('User has no branch assigned — cannot create wallet');

  let wallet = await DailyWallet.findOne({ user: user._id, date: DATE });
  if (!wallet) {
    wallet = new DailyWallet({ user: user._id, branch: user.branch, date: DATE });
  }

  const before = { opening: wallet.openingBalance, closing: wallet.closingBalance };
  wallet.openingBalance = OPENING;
  // Preserve any same-day movement already recorded on the wallet.
  const net = (wallet.totalCollections || 0) - (wallet.totalExpenses || 0) - (wallet.totalPurchases || 0);
  wallet.closingBalance = OPENING + net;
  await wallet.save();

  console.log(`User: ${user.firstName} ${user.lastName} (${TARGET_EMAIL})`);
  console.log(`Date: ${DATE}`);
  console.log(`Before -> opening: ${before.opening}, closing: ${before.closing}`);
  console.log(`After  -> opening: ${wallet.openingBalance}, closing: ${wallet.closingBalance}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
