#!/usr/bin/env node
/**
 * تحسين أداء استعلامات HR Master بإضافة indexes على الحقول الفلترية
 * استخدام: node src/scripts/addHrIndexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const Employee = require('../models/Employee');

    console.log('إضافة indexes لتحسين أداء HR Master...\n');

    // الحقول الأساسية المستخدمة في الفلترة والفرز
    const indexes = [
      // المرشحات الأساسية
      { inCurrentMaster: 1, employmentStatus: 1 },
      { inCurrentMaster: 1, nationality: 1 },
      { inCurrentMaster: 1, branchName: 1 },
      { inCurrentMaster: 1, department: 1 },
      { inCurrentMaster: 1, gender: 1 },
      { inCurrentMaster: 1, project: 1 },
      { inCurrentMaster: 1, workStatusText: 1 },

      // الحقول ذات التواريخ (للبحث عن الانتهاءات)
      { inCurrentMaster: 1, iqamaExpiry: 1 },
      { inCurrentMaster: 1, contractEndDate: 1 },
      { inCurrentMaster: 1, passportExpiry: 1 },
      { inCurrentMaster: 1, insuranceExpiry: 1 },
      { inCurrentMaster: 1, healthCertExpiry: 1 },
      { inCurrentMaster: 1, driverCardExpiry: 1 },

      // الحقول المنطقية
      { inCurrentMaster: 1, isOutsideKingdom: 1 },
      { inCurrentMaster: 1, isFreelancer: 1 },

      // الحقول الأخرى
      { inCurrentMaster: 1, bank: 1 },
      { inCurrentMaster: 1, nationality: 1, branchName: 1 },

      // للبحث النصي
      { arabicName: 'text', firstName: 'text', lastName: 'text', employeeNumber: 1, iqamaNumber: 1 },
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
