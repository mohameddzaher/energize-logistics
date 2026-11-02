#!/usr/bin/env node
/**
 * Speeds up HR Master queries by adding indexes on the filter fields.
 * Usage: node src/scripts/addHrIndexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const Employee = require('../models/Employee');

    console.log('إضافة indexes لتحسين أداء HR Master...\n');

    // Core fields used for filtering and sorting.
    const indexes = [
      // Primary filters.
      { inCurrentMaster: 1, employmentStatus: 1 },
      { inCurrentMaster: 1, nationality: 1 },
      { inCurrentMaster: 1, branchName: 1 },
      { inCurrentMaster: 1, department: 1 },
      { inCurrentMaster: 1, gender: 1 },
      { inCurrentMaster: 1, project: 1 },
      { inCurrentMaster: 1, workStatusText: 1 },

      // Date fields (for expiry lookups).
      { inCurrentMaster: 1, iqamaExpiry: 1 },
      { inCurrentMaster: 1, contractEndDate: 1 },
      { inCurrentMaster: 1, passportExpiry: 1 },
      { inCurrentMaster: 1, insuranceExpiry: 1 },
      { inCurrentMaster: 1, healthCertExpiry: 1 },
      { inCurrentMaster: 1, driverCardExpiry: 1 },

      // Boolean fields.
      { inCurrentMaster: 1, isOutsideKingdom: 1 },
      { inCurrentMaster: 1, isFreelancer: 1 },

      // Other fields.
      { inCurrentMaster: 1, bank: 1 },
      { inCurrentMaster: 1, nationality: 1, branchName: 1 },

      // These screens search by regex, not $text, so there is no text index here: nobody uses it and it blocks creating another text index (only one per collection).
    ];

    for (const idx of indexes) {
      try {
        await Employee.collection.createIndex(idx);
        console.log(`✓ تم إنشاء index:`, JSON.stringify(idx));
      } catch (e) {
        if (e.code === 85) {
          console.log(`  (موجود بالفعل): ${JSON.stringify(idx)}`);
        } else {
          console.error(`✗ خطأ:`, e.message);
        }
      }
    }

    console.log('\n✓ اكتمل إضافة الـ indexes');
    process.exit(0);
  } catch (e) {
    console.error('خطأ:', e.message);
    process.exit(1);
  }
})();
