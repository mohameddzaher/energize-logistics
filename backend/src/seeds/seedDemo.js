require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CollectionActivity = require('../models/CollectionActivity');

const seedDemo = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // ── 1. Create Users ─────────────────────────────────────────────
    const users = {};

    const userDefs = [
      { email: 'admin@energize.com', password: 'Admin@123456', firstName: 'Super', lastName: 'Admin', role: 'super_admin' },
      { email: 'manager@energize.com', password: 'Manager@123', firstName: 'Ahmed', lastName: 'Hassan', role: 'admin' },
      { email: 'collector@energize.com', password: 'Collector@123', firstName: 'Omar', lastName: 'Sayed', role: 'employee', collectionTarget: 500000 },
      { email: 'ops@energize.com', password: 'Ops@123456', firstName: 'Sara', lastName: 'Nabil', role: 'operations_manager' },
      { email: 'client@energize.com', password: 'Client@123456', firstName: 'Mohamed', lastName: 'Ali', role: 'client' },
    ];

    for (const def of userDefs) {
      let user = await User.findOne({ email: def.email });
      if (!user) {
        user = await User.create({ ...def, isActive: true });
        console.log(`  Created user: ${def.email} (${def.role})`);
      } else {
        console.log(`  User exists: ${def.email}`);
      }
      users[def.role === 'employee' ? 'collector' : def.role] = user;
    }

    // ── 2. Create Customers ─────────────────────────────────────────
    const customerDefs = [
      { customerNumber: 'CUST-001', companyName: 'Al Noor Trading Co.', contactPerson: 'Khaled Ibrahim', email: 'khaled@alnoor.com', phone: '+971501234567', creditTerm: 30, creditLimit: 200000, office: 'Dubai', salesManager: 'Youssef Mansour', grade: 'A', clientStatus: 'good_client' },
      { customerNumber: 'CUST-002', companyName: 'Gulf Star Logistics', contactPerson: 'Fatima Al-Rashid', email: 'fatima@gulfstar.com', phone: '+971502345678', creditTerm: 45, creditLimit: 350000, office: 'Abu Dhabi', salesManager: 'Ahmed Hassan', grade: 'B', clientStatus: 'late_payment' },
      { customerNumber: 'CUST-003', companyName: 'Emirates Supply Chain', contactPerson: 'Hassan Mahmoud', email: 'hassan@esc.ae', phone: '+971503456789', creditTerm: 60, creditLimit: 500000, office: 'Dubai', salesManager: 'Youssef Mansour', grade: 'A', clientStatus: 'vip_client' },
      { customerNumber: 'CUST-004', companyName: 'Desert Freight Solutions', contactPerson: 'Amira Khalil', email: 'amira@desertfreight.com', phone: '+971504567890', creditTerm: 15, creditLimit: 100000, office: 'Sharjah', salesManager: 'Ahmed Hassan', grade: 'C', clientStatus: 'under_review' },
      { customerNumber: 'CUST-005', companyName: 'Oasis Distribution LLC', contactPerson: 'Tariq Al-Mansoori', email: 'tariq@oasis.ae', phone: '+971505678901', creditTerm: 30, creditLimit: 250000, office: 'Dubai', salesManager: 'Youssef Mansour', grade: 'D', clientStatus: 'stopped_by_us', isStopped: true, stoppedAt: new Date() },
    ];

    const customers = [];
    for (const def of customerDefs) {
      let customer = await Customer.findOne({ customerNumber: def.customerNumber });
      if (!customer) {
        customer = await Customer.create({
          ...def,
          assignedCollector: users.collector._id,
          isActive: true,
        });
        console.log(`  Created customer: ${def.companyName}`);
      } else {
        console.log(`  Customer exists: ${def.companyName}`);
      }
      customers.push(customer);
    }

    // Link client user to first customer
    if (users.client && !users.client.linkedCustomer) {
      users.client.linkedCustomer = customers[0]._id;
      await users.client.save();
      console.log('  Linked client user to:', customers[0].companyName);
    }

    // Assign customers to collector
    if (users.collector) {
      users.collector.assignedCustomers = customers.map((c) => c._id);
      await users.collector.save();
      console.log('  Assigned all customers to collector');
    }

    // ── 3. Create Invoices ──────────────────────────────────────────
    const now = new Date();
    const invoiceDefs = [
      // Customer 0: Al Noor - mix of statuses
      { customer: 0, invoiceNumber: 'INV-2025-001', amount: 45000, daysAgo: 60, status: 'paid' },
      { customer: 0, invoiceNumber: 'INV-2025-002', amount: 32000, daysAgo: 40, status: 'partial', paidAmount: 15000 },
      { customer: 0, invoiceNumber: 'INV-2025-003', amount: 28000, daysAgo: 10, status: 'pending' },
      { customer: 0, invoiceNumber: 'INV-2025-004', amount: 15000, daysAgo: 5, status: 'pending' },
      // Customer 1: Gulf Star - overdue
      { customer: 1, invoiceNumber: 'INV-2025-005', amount: 78000, daysAgo: 90, status: 'overdue' },
      { customer: 1, invoiceNumber: 'INV-2025-006', amount: 55000, daysAgo: 65, status: 'partial', paidAmount: 20000 },
      { customer: 1, invoiceNumber: 'INV-2025-007', amount: 42000, daysAgo: 30, status: 'pending' },
      // Customer 2: Emirates SC - mostly paid
      { customer: 2, invoiceNumber: 'INV-2025-008', amount: 120000, daysAgo: 80, status: 'paid' },
      { customer: 2, invoiceNumber: 'INV-2025-009', amount: 95000, daysAgo: 50, status: 'paid' },
      { customer: 2, invoiceNumber: 'INV-2025-010', amount: 88000, daysAgo: 25, status: 'partial', paidAmount: 50000 },
      { customer: 2, invoiceNumber: 'INV-2025-011', amount: 67000, daysAgo: 5, status: 'pending' },
      // Customer 3: Desert Freight - 15 day term
      { customer: 3, invoiceNumber: 'INV-2025-012', amount: 18000, daysAgo: 30, status: 'overdue' },
      { customer: 3, invoiceNumber: 'INV-2025-013', amount: 22000, daysAgo: 20, status: 'overdue' },
      { customer: 3, invoiceNumber: 'INV-2025-014', amount: 12000, daysAgo: 8, status: 'pending' },
      // Customer 4: Oasis - stopped, has outstanding
      { customer: 4, invoiceNumber: 'INV-2025-015', amount: 65000, daysAgo: 100, status: 'overdue' },
      { customer: 4, invoiceNumber: 'INV-2025-016', amount: 48000, daysAgo: 75, status: 'overdue' },
      { customer: 4, invoiceNumber: 'INV-2025-017', amount: 35000, daysAgo: 50, status: 'partial', paidAmount: 10000 },
      { customer: 4, invoiceNumber: 'INV-2025-018', amount: 28000, daysAgo: 40, status: 'overdue' },
      // Extra invoices
      { customer: 1, invoiceNumber: 'INV-2025-019', amount: 33000, daysAgo: 15, status: 'pending' },
      { customer: 2, invoiceNumber: 'INV-2025-020', amount: 75000, daysAgo: 2, status: 'pending' },
    ];

    const invoices = [];
    for (const def of invoiceDefs) {
      const existing = await Invoice.findOne({ invoiceNumber: def.invoiceNumber });
      if (existing) {
        invoices.push(existing);
        continue;
      }

      const cust = customers[def.customer];
      const invoiceDate = new Date(now);
      invoiceDate.setDate(invoiceDate.getDate() - def.daysAgo);
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + cust.creditTerm);

      const invoice = await Invoice.create({
        invoiceNumber: def.invoiceNumber,
        customer: cust._id,
        amount: def.amount,
        paidAmount: def.paidAmount || (def.status === 'paid' ? def.amount : 0),
        balance: def.status === 'paid' ? 0 : def.amount - (def.paidAmount || 0),
        invoiceDate,
        dueDate,
        creditTerm: cust.creditTerm,
        status: def.status,
        createdBy: users.super_admin._id,
      });

      invoices.push(invoice);
      console.log(`  Created invoice: ${def.invoiceNumber} (${def.status})`);
    }

    // ── 4. Create Payments ──────────────────────────────────────────
    const paymentDefs = [
      { invoice: 0, amount: 45000, daysAgo: 25, method: 'bank_transfer' },
      { invoice: 1, amount: 15000, daysAgo: 20, method: 'check' },
      { invoice: 5, amount: 20000, daysAgo: 30, method: 'bank_transfer' },
      { invoice: 7, amount: 120000, daysAgo: 15, method: 'bank_transfer' },
      { invoice: 8, amount: 95000, daysAgo: 10, method: 'bank_transfer' },
      { invoice: 9, amount: 50000, daysAgo: 5, method: 'online' },
      { invoice: 16, amount: 10000, daysAgo: 15, method: 'cash' },
      // Extra payments
      { invoice: 4, amount: 30000, daysAgo: 45, method: 'bank_transfer' },
      { invoice: 14, amount: 20000, daysAgo: 50, method: 'check' },
      { invoice: 15, amount: 15000, daysAgo: 35, method: 'bank_transfer' },
    ];

    for (const def of paymentDefs) {
      if (def.invoice >= invoices.length) continue;
      const inv = invoices[def.invoice];
      const paymentDate = new Date(now);
      paymentDate.setDate(paymentDate.getDate() - def.daysAgo);

      const existing = await Payment.findOne({ invoice: inv._id, amount: def.amount });
      if (existing) continue;

      await Payment.create({
        invoice: inv._id,
        customer: inv.customer,
        amount: def.amount,
        paymentDate,
        paymentMethod: def.method,
        receivedBy: users.collector._id,
        notes: 'Demo payment',
      });
      console.log(`  Created payment: $${def.amount} for ${inv.invoiceNumber}`);
    }

    // Update customer outstanding
    for (const cust of customers) {
      const custInvoices = await Invoice.find({ customer: cust._id, status: { $nin: ['paid', 'refunded'] } });
      const outstanding = custInvoices.reduce((sum, inv) => sum + inv.balance, 0);
      cust.currentOutstanding = outstanding;

      const lastPayment = await Payment.findOne({ customer: cust._id }).sort({ paymentDate: -1 });
      if (lastPayment) {
        cust.lastPaymentDate = lastPayment.paymentDate;
        cust.lastPaymentAmount = lastPayment.amount;
      }

      await cust.save();
    }

    // ── 5. Create Collection Activities ─────────────────────────────
    const activityDefs = [
      { customer: 1, type: 'call', contactType: 'call', status: 'done', notes: 'Called client about overdue INV-2025-005. Promised to pay by end of week.', daysAgo: 5 },
      { customer: 1, type: 'promise', contactType: 'call', status: 'done', notes: 'Client promised to settle $30,000 by next Thursday.', promiseAmount: 30000, daysAgo: 3 },
      { customer: 3, type: 'email', contactType: 'email', status: 'done', notes: 'Sent payment reminder for overdue invoices INV-2025-012 and INV-2025-013.', daysAgo: 7 },
      { customer: 4, type: 'visit', contactType: 'visit', status: 'done', notes: 'Visited client office. Account stopped due to repeated late payments.', amountCollected: 10000, daysAgo: 15 },
      { customer: 0, type: 'follow_up', contactType: 'whatsapp', status: 'done', notes: 'WhatsApp follow-up on partial payment for INV-2025-002. Client confirmed remaining payment scheduled.', nextFollowUpDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), daysAgo: 1 },
    ];

    for (const def of activityDefs) {
      const cust = customers[def.customer];
      const createdAt = new Date(now);
      createdAt.setDate(createdAt.getDate() - def.daysAgo);

      const existing = await CollectionActivity.findOne({
        customer: cust._id,
        notes: def.notes,
      });
      if (existing) continue;

      await CollectionActivity.create({
        customer: cust._id,
        collector: users.collector._id,
        type: def.type,
        contactType: def.contactType,
        status: def.status,
        amountCollected: def.amountCollected || 0,
        promiseAmount: def.promiseAmount,
        nextFollowUpDate: def.nextFollowUpDate,
        notes: def.notes,
      });
      console.log(`  Created activity: ${def.type} for ${cust.companyName}`);
    }

    // ── Done ────────────────────────────────────────────────────────
    console.log('\n=== Demo Data Seeded Successfully ===\n');
    console.log('Demo Accounts:');
    console.log('  Super Admin:  admin@energize.com     / Admin@123456');
    console.log('  Admin:        manager@energize.com   / Manager@123');
    console.log('  Collector:    collector@energize.com  / Collector@123');
    console.log('  Ops Manager:  ops@energize.com       / Ops@123456');
    console.log('  Client:       client@energize.com    / Client@123456');
    console.log('\nCustomers: 5 | Invoices: 20 | Payments: 10 | Activities: 5');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedDemo();
