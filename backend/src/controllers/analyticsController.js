const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');

exports.getOverdueInvoices = async (req, res) => {
  try {
    const { search, page = 1, limit = 50, sortBy = 'overdueDays', sortOrder = 'desc' } = req.query;
    const now = new Date();

    const filter = {
      dueDate: { $lt: now },
      status: { $nin: ['paid', 'frozen', 'refunded'] },
    };

    let invoices = await Invoice.find(filter)
      .populate('customer', 'companyName customerNumber grade office salesManager assignedCollector clientStatus')
      .populate({
        path: 'customer',
        populate: { path: 'assignedCollector', select: 'firstName lastName' }
      })
      .sort({ dueDate: 1 });

    // Enrich with overdue days
    let enriched = invoices.map((inv) => {
      const doc = inv.toObject();
      const diffMs = now - new Date(doc.dueDate);
      doc.overdueDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return doc;
    });

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      enriched = enriched.filter((inv) =>
        (inv.customer?.companyName || '').toLowerCase().includes(searchLower) ||
        (inv.customer?.customerNumber || '').toLowerCase().includes(searchLower) ||
        (inv.invoiceNumber || '').toLowerCase().includes(searchLower) ||
        (inv.customer?.salesManager || '').toLowerCase().includes(searchLower)
      );
    }

    // Sort
    enriched.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'overdueDays': aVal = a.overdueDays; bVal = b.overdueDays; break;
        case 'amount': aVal = a.balance; bVal = b.balance; break;
        case 'dueDate': aVal = new Date(a.dueDate); bVal = new Date(b.dueDate); break;
        default: aVal = a.overdueDays; bVal = b.overdueDays;
      }
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    const total = enriched.length;
    const skip = (Number(page) - 1) * Number(limit);
    const paged = enriched.slice(skip, skip + Number(limit));

    res.json({
      invoices: paged,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error('Overdue invoices error:', error);
    res.status(500).json({ message: 'Failed to load overdue invoices' });
  }
};
