const User = require("../models/User");
const Payment = require("../models/Payment");
const CollectionActivity = require("../models/CollectionActivity");
const Customer = require("../models/Customer");

const getCollectorPerformance = async (collectorId, dateFrom, dateTo) => {
  const now = new Date();
  const start = dateFrom
    ? new Date(dateFrom)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = dateTo ? new Date(dateTo) : now;

  const collector = await User.findById(collectorId);
  if (!collector) return null;

  const isAdmin = collector.role === "admin";

  // ── Dynamic Target: SUM of currentOutstanding from assigned customers ──
  let target = 0;
  let assignedCustomerIds = [];

  if (isAdmin) {
    // Admin: target = ALL active customers' outstanding
    const result = await Customer.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, total: { $sum: "$currentOutstanding" } } },
    ]);
    target = result[0]?.total || 0;
  } else {
    // Employee: target = assigned customers' outstanding (use User.assignedCustomers as source of truth)
    const rawIds = (collector.assignedCustomers || []).filter(Boolean);
    assignedCustomerIds = rawIds.map((id) => id.toString());
    if (rawIds.length > 0) {
      const result = await Customer.aggregate([
        { $match: { _id: { $in: rawIds }, isActive: true } },
        { $group: { _id: null, total: { $sum: "$currentOutstanding" } } },
      ]);
      target = result[0]?.total || 0;
    }
  }

  // ── Payments collected ──
  let receivedByMatch = collector._id;
  if (isAdmin) {
    const employees = await User.find({
      role: "employee",
      isActive: true,
    }).select("_id");
    const teamIds = [collector._id, ...employees.map((e) => e._id)];
    receivedByMatch = { $in: teamIds };
  }

  const collectorPayments = await Payment.find({
    receivedBy: receivedByMatch,
    paymentDate: { $gte: start, $lte: end },
  })
    .populate("invoice", "dueDate")
    .select("amount customer paymentDate invoice");

  let totalCollected = 0;
  let assignedCollected = 0;
  let extraCollected = 0;
  let paymentCount = collectorPayments.length;
  let totalDelay = 0;
  let delayCount = 0;

  const assignedSet = new Set(assignedCustomerIds);

  for (const pmt of collectorPayments) {
    const amt = pmt.amount || 0;
    totalCollected += amt;

    // Assigned vs Extra split (employee only)
    if (!isAdmin && pmt.customer) {
      const custId = pmt.customer.toString();
      if (assignedSet.has(custId)) {
        assignedCollected += amt;
      } else {
        extraCollected += amt;
      }
    }

    // Average delay calculation
    if (pmt.invoice && pmt.invoice.dueDate) {
      const delay = Math.ceil(
        (pmt.paymentDate - pmt.invoice.dueDate) / (1000 * 60 * 60 * 24),
      );
      if (delay > 0) {
        totalDelay += delay;
        delayCount++;
      }
    }
  }

  // Admin: all collections are "assigned" (no extra split)
  if (isAdmin) {
    assignedCollected = totalCollected;
    extraCollected = 0;
  }

  const efficiency =
    target > 0 ? Math.round((totalCollected / target) * 100) : 0;
  const avgDelay = delayCount > 0 ? Math.round(totalDelay / delayCount) : 0;

  // Promise fulfillment (personal only)
  const promises = await CollectionActivity.find({
    collector: collectorId,
    type: "promise",
    createdAt: { $gte: start, $lte: end },
  });
  const fulfilledPromises = promises.filter(
    (p) => p.promiseFulfilled === true,
  ).length;
  const promiseFulfillment =
    promises.length > 0
      ? Math.round((fulfilledPromises / promises.length) * 100)
      : 0;

  // Activities count (personal only)
  const activityCount = await CollectionActivity.countDocuments({
    collector: collectorId,
    createdAt: { $gte: start, $lte: end },
  });

  return {
    collector: {
      _id: collector._id,
      name: `${collector.firstName} ${collector.lastName}`,
      email: collector.email,
      role: collector.role,
    },
    target,
    totalCollected,
    assignedCollected,
    extraCollected,
    paymentCount,
    efficiency,
    promiseFulfillment,
    totalPromises: promises.length,
    fulfilledPromises,
    avgDelay,
    activityCount,
    assignedCustomers: (collector.assignedCustomers || []).length,
  };
};

const getCollectorRanking = async (dateFrom, dateTo) => {
  const collectors = await User.find({
    role: { $in: ["employee", "admin"] },
    isActive: true,
  });
  const rankings = [];

  for (const collector of collectors) {
    const perf = await getCollectorPerformance(collector._id, dateFrom, dateTo);
    if (perf) rankings.push(perf);
  }

  return rankings.sort((a, b) => b.efficiency - a.efficiency);
};

const getPerformanceTrend = async (collectorId, months = 6) => {
  const now = new Date();
  const trend = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

    const perf = await getCollectorPerformance(
      collectorId,
      monthStart,
      monthEnd,
    );
    trend.push({
      month: monthStart.toLocaleString("default", {
        month: "short",
        year: "numeric",
      }),
      ...perf,
    });
  }

  return trend;
};

module.exports = {
  getCollectorPerformance,
  getCollectorRanking,
  getPerformanceTrend,
};
