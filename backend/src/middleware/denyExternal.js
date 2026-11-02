/**
 * Blocks customer and supplier accounts from internal endpoints.
 * The portal (/api/portal) is what the external partner sees, with no customer prices. The old invoice and payment endpoints stayed open to any logged-in user, so a customer account requesting them directly saw the amounts. They are closed here to every external account.
 */
module.exports = function denyExternal(req, res, next) {
  const u = req.user || {};
  if (u.role === 'client' || ['customer', 'vendor'].includes(u.accountType)) {
    return res.status(403).json({ message: 'غير متاح لحسابات العملاء والمورّدين' });
  }
  return next();
};
