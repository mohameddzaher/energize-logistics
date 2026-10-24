/**
 * يمنع حساباتِ العملاء والمورّدين من نقاطٍ داخليّة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * البوابةُ (/api/portal) هي ما يراه الشريكُ الخارجيّ، وهي بلا أسعارٍ للعميل. وبقيت
 * نقاطُ الفواتير والمدفوعات القديمة مفتوحةً لكلّ مسجَّل — فحسابُ عميلٍ يطلبها
 * مباشرةً يرى المبالغ. فتُغلق هنا أمام كلّ حسابٍ خارجيّ.
 */
module.exports = function denyExternal(req, res, next) {
  const u = req.user || {};
  if (u.role === 'client' || ['customer', 'vendor'].includes(u.accountType)) {
    return res.status(403).json({ message: 'غير متاح لحسابات العملاء والمورّدين' });
  }
  return next();
};
