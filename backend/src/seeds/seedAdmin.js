require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const existingAdmin = await User.findOne({ role: 'super_admin' });
    if (existingAdmin) {
      console.log('Super Admin already exists:', existingAdmin.email);
      process.exit(0);
    }

    const admin = await User.create({
      email: process.env.SEED_ADMIN_EMAIL || 'admin@energize.com',
      password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123456',
      firstName: process.env.SEED_ADMIN_FIRST_NAME || 'Super',
      lastName: process.env.SEED_ADMIN_LAST_NAME || 'Admin',
      role: 'super_admin',
      isActive: true,
    });

    console.log('Super Admin created successfully:');
    console.log(`  Email: ${admin.email}`);
    console.log(`  Name: ${admin.firstName} ${admin.lastName}`);
    console.log(`  Role: ${admin.role}`);
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error.message);
    process.exit(1);
  }
};

seedAdmin();
