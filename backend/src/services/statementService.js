const PDFDocument = require('pdfkit');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');

const generateStatement = async (customerId, dateFrom, dateTo) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  const startDate = dateFrom ? new Date(dateFrom) : new Date(new Date().getFullYear(), 0, 1);
  const endDate = dateTo ? new Date(dateTo) : new Date();
  endDate.setHours(23, 59, 59, 999);

  // Get invoices in date range
  const invoices = await Invoice.find({
    customer: customerId,
    invoiceDate: { $gte: startDate, $lte: endDate },
  }).sort({ invoiceDate: 1 });

  // Get payments in date range
  const payments = await Payment.find({
    customer: customerId,
    paymentDate: { $gte: startDate, $lte: endDate },
  })
    .populate('receivedBy', 'firstName lastName')
    .sort({ paymentDate: 1 });

  // Calculate opening balance (outstanding before start date)
  const priorInvoices = await Invoice.aggregate([
    { $match: { customer: customer._id, invoiceDate: { $lt: startDate } } },
    { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
  ]);
  const priorPayments = await Payment.aggregate([
    { $match: { customer: customer._id, paymentDate: { $lt: startDate } } },
    { $group: { _id: null, totalPaid: { $sum: '$amount' } } },
  ]);
  const openingBalance = (priorInvoices[0]?.totalAmount || 0) - (priorPayments[0]?.totalPaid || 0);

  // Build transaction list
  const transactions = [];

  for (const inv of invoices) {
    transactions.push({
      date: inv.invoiceDate,
      description: `Invoice #${inv.invoiceNumber}`,
      debit: inv.amount,
      credit: 0,
      type: 'invoice',
    });
  }

  for (const pay of payments) {
    const collector = pay.receivedBy ? `${pay.receivedBy.firstName} ${pay.receivedBy.lastName}` : '';
    transactions.push({
      date: pay.paymentDate,
      description: `Payment - ${pay.paymentMethod}${collector ? ` (${collector})` : ''}`,
      debit: 0,
      credit: pay.amount,
      type: 'payment',
    });
  }

  // Sort by date
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate running balance
  let runningBalance = openingBalance;
  for (const tx of transactions) {
    runningBalance += tx.debit - tx.credit;
    tx.balance = runningBalance;
  }

  const closingBalance = runningBalance;

  // Generate PDF
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const buffers = [];

  doc.on('data', (chunk) => buffers.push(chunk));

  // Header
  doc.fontSize(20).font('Helvetica-Bold').text('ENERGIZE LOGISTICS', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text('Collection & Financial Control System', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#f37121');
  doc.moveDown();

  // Statement title
  doc.fontSize(16).font('Helvetica-Bold').text('Statement of Account', { align: 'center' });
  doc.moveDown();

  // Customer info
  doc.fontSize(10).font('Helvetica-Bold').text('Customer Details:');
  doc.font('Helvetica');
  doc.text(`Company: ${customer.companyName}`);
  if (customer.customerNumber) doc.text(`Customer #: ${customer.customerNumber}`);
  if (customer.contactPerson) doc.text(`Contact: ${customer.contactPerson}`);
  if (customer.address) doc.text(`Address: ${customer.address}`);
  if (customer.email) doc.text(`Email: ${customer.email}`);
  doc.text(`Credit Term: ${customer.creditTerm} days`);
  doc.moveDown(0.5);

  // Date range
  doc.font('Helvetica-Bold').text('Period:');
  doc.font('Helvetica').text(
    `${formatDate(startDate)} to ${formatDate(endDate)}`
  );
  doc.moveDown();

  // Opening balance
  doc.font('Helvetica-Bold').text(`Opening Balance: ${formatCurrency(openingBalance)}`);
  doc.moveDown();

  // Transaction table header
  const tableTop = doc.y;
  const colWidths = { date: 80, desc: 180, debit: 80, credit: 80, balance: 80 };
  const startX = 50;

  doc.font('Helvetica-Bold').fontSize(9);
  drawTableRow(doc, startX, tableTop, colWidths, ['Date', 'Description', 'Debit', 'Credit', 'Balance'], true);

  let y = tableTop + 20;

  // Transaction rows
  doc.font('Helvetica').fontSize(8);
  for (const tx of transactions) {
    if (y > 720) {
      doc.addPage();
      y = 50;
      doc.font('Helvetica-Bold').fontSize(9);
      drawTableRow(doc, startX, y, colWidths, ['Date', 'Description', 'Debit', 'Credit', 'Balance'], true);
      y += 20;
      doc.font('Helvetica').fontSize(8);
    }

    drawTableRow(doc, startX, y, colWidths, [
      formatDate(tx.date),
      tx.description,
      tx.debit > 0 ? formatCurrency(tx.debit) : '-',
      tx.credit > 0 ? formatCurrency(tx.credit) : '-',
      formatCurrency(tx.balance),
    ]);
    y += 18;
  }

  // Closing balance
  y += 10;
  if (y > 720) {
    doc.addPage();
    y = 50;
  }
  doc.moveTo(startX, y).lineTo(545, y).stroke('#333');
  y += 10;
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(`Closing Balance: ${formatCurrency(closingBalance)}`, startX, y);

  // Footer
  doc.moveDown(2);
  doc.fontSize(8).font('Helvetica').fillColor('#888');
  doc.text(`Generated on ${formatDate(new Date())} | Energize Logistics - Statement of Account`, {
    align: 'center',
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
  });
};

function drawTableRow(doc, x, y, colWidths, values, isHeader = false) {
  if (isHeader) {
    doc.rect(x, y - 3, 495, 18).fill('#f0f0f0').stroke();
    doc.fillColor('#333');
  } else {
    doc.fillColor('#000');
  }

  let currentX = x;
  const cols = Object.values(colWidths);
  values.forEach((val, i) => {
    const align = i >= 2 ? 'right' : 'left';
    doc.text(val, currentX + 3, y, { width: cols[i] - 6, align });
    currentX += cols[i];
  });
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

module.exports = { generateStatement };
