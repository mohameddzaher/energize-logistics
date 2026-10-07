const mongoose = require('mongoose');

/**
 * أهدافُ التشغيل — رحلاتٌ ومبيعاتٌ في السنة.
 *
 * كانت في ورقة إكسل («Annual Target Trips 36000 · Annual Revenue Target
 * 90,000,000») يكتبها مديرُ التشغيل في خانةٍ ويقرأها الرسمُ. وفي النظام لا
 * تُكتب في الشيفرة: هدفٌ يُغيَّر في اجتماعٍ لا يحتاج نشرةً.
 *
 * وهدفُ الفترة يُشتقّ ولا يُكتب: السنويُّ موزَّعًا على أيّامها (راجع
 * utils/opsAnalytics) — فأيُّ مدًى يُختار يأتي بهدفه. و`override` لمن أراد
 * رقمًا بعينه لشهرٍ بعينه.
 */
const opsTargetSchema = new mongoose.Schema({
  key: { type: String, default: 'ops', unique: true },
  annualTrips: { type: Number, default: 36000 },
  annualRevenue: { type: Number, default: 90000000 },
  // أهدافٌ تُكتب بعينها لشهرٍ («YYYY-MM») — تسبق الاشتقاق.
  overrides: [{
    month: { type: String, trim: true, default: '' },
    trips: { type: Number, default: null },
    revenue: { type: Number, default: null },
  }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.OpsTarget || mongoose.model('OpsTarget', opsTargetSchema);
