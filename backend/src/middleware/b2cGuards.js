/**
 * حرّاسُ قسم الأفراد التي لا تُترَك لمصفوفة الصلاحيّات.
 *
 * مشرفُ المناديب موظّفٌ في القسم، فيأخذ القسمَ «تعديلًا» افتراضيًّا — وهذا ما
 * يحتاجه ليسجّل التفقّد. لكنّ توزيعَ المناديب على المشرفين قرارُ مدير المشروع
 * ومدير القطاع والسوبر أدمن، فلا يُفتَح للمشرف ولو فُتحت له صفحةُ المناديب.
 */
const REP_SUPERVISOR = 'b2c_rep_supervisor';
const INSPECTION_SUPERVISOR = 'b2c_inspection_supervisor';

// ── والمشرفان كلاهما مشرف ──────────────────────────────────────────────────
// صار للمشرف دوران: تشغيليٌّ يقف على يوم المندوب، وتفقّديٌّ يقف على لحظة
// بداية الدوام. وكلاهما **لا يوزّع المناديب**: ذاك قرارُ مدير المشروع. فلو
// قُرئ المنعُ على الأوّل وحدَه لصار الدورُ الجديد أوسعَ من الذي اشتُقّ منه.
const SUPERVISOR_ROLES = [REP_SUPERVISOR, INSPECTION_SUPERVISOR];

const isRepSupervisor = (user) => SUPERVISOR_ROLES.includes(user?.role);
const isInspectionSupervisor = (user) => user?.role === INSPECTION_SUPERVISOR;

const denyRepSupervisor = (req, res, next) => {
  if (isRepSupervisor(req.user)) {
    return res.status(403).json({ message: 'توزيع المناديب وتعديلهم لمدير المشروع ومدير القطاع فقط' });
  }
  next();
};

module.exports = {
  REP_SUPERVISOR, INSPECTION_SUPERVISOR, SUPERVISOR_ROLES,
  isRepSupervisor, isInspectionSupervisor, denyRepSupervisor,
};
