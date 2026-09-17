/**
 * حرّاسُ قسم الأفراد التي لا تُترَك لمصفوفة الصلاحيّات.
 *
 * مشرفُ المناديب موظّفٌ في القسم، فيأخذ القسمَ «تعديلًا» افتراضيًّا — وهذا ما
 * يحتاجه ليسجّل التفقّد. لكنّ توزيعَ المناديب على المشرفين قرارُ مدير المشروع
 * ومدير القطاع والسوبر أدمن، فلا يُفتَح للمشرف ولو فُتحت له صفحةُ المناديب.
 */
const REP_SUPERVISOR = 'b2c_rep_supervisor';

const isRepSupervisor = (user) => user?.role === REP_SUPERVISOR;

const denyRepSupervisor = (req, res, next) => {
  if (isRepSupervisor(req.user)) {
    return res.status(403).json({ message: 'توزيع المناديب وتعديلهم لمدير المشروع ومدير القطاع فقط' });
  }
  next();
};

module.exports = { REP_SUPERVISOR, isRepSupervisor, denyRepSupervisor };
