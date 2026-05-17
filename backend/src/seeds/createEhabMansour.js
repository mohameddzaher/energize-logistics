require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Branch = require('../models/Branch');

const EMAIL = 'ehab.mansour@energize.com';
const FIRST = 'Ehab';
const LAST = 'Mansour';
const ROLE = 'operations';
const PRIMARY_PASSWORD = 'ehabenergize';
const FALLBACK_PASSWORD = 'Ehabenergize1!';
const BRANCH_NAME = 'Jeddah';

const looksLikeJeddah = (s) =>
  /jeddah|جدة|جده/i.test(String(s || ''));

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find Jeddah branch — try direct name match first, then fuzzy
    let branch = await Branch.findOne({ name: BRANCH_NAME });
    if (!branch) {
      const all = await Branch.find({});
      branch = all.find((b) => looksLikeJeddah(b.name) || looksLikeJeddah(b.code) || looksLikeJeddah(b.city));
    }
    if (!branch) {
      console.error('No Jeddah branch found. Create one in the admin UI first, then re-run.');
      process.exit(1);
    }
    console.log(`Using branch: ${branch.name} (${branch._id})`);

    // Decide password: try primary first; if model rejects (min 8 ok, but allow fallback), use fallback
    const tryPasswords = [PRIMARY_PASSWORD, FALLBACK_PASSWORD];

    let user = await User.findOne({ email: EMAIL });
    if (user) {
      console.log(`User ${EMAIL} already exists. Updating branch and resetting password.`);
      user.branch = branch._id;
      user.firstName = FIRST;
      user.lastName = LAST;
      user.role = ROLE;
      user.isActive = true;
      // Try primary first
      let updated = false;
      for (const pwd of tryPasswords) {
        try {
          user.password = pwd;
          await user.save();
          console.log(`Password reset to "${pwd}"`);
          updated = true;
          break;
        } catch (err) {
          console.warn(`Failed with password "${pwd}":`, err.message);
        }
      }
      if (!updated) {
        console.error('Could not save user with either password.');
        process.exit(1);
      }
    } else {
      // Create fresh
      let created = null;
      for (const pwd of tryPasswords) {
        try {
          created = await User.create({
            email: EMAIL,
            password: pwd,
            firstName: FIRST,
            lastName: LAST,
            role: ROLE,
            branch: branch._id,
            isActive: true,
          });
          console.log(`Created user with password "${pwd}"`);
          break;
        } catch (err) {
          console.warn(`Create failed with password "${pwd}":`, err.message);
        }
      }
      if (!created) {
        console.error('Could not create user with either password.');
        process.exit(1);
      }
      user = created;
    }

    console.log('Done:');
    console.log(`  Name: ${user.firstName} ${user.lastName}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Branch: ${branch.name}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err);
    process.exit(1);
  }
})();
