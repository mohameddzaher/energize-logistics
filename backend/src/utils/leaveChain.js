/**
 * سلسلةُ موافقات الإجازة — مَن يقرّر في كلّ محطّة.
 *
 * ── المحطّاتُ أربع ────────────────────────────────────────────────────────
 * المديرُ المباشر ← الموارد البشريّة ← الحسابات ← الإدارة العليا.
 *
 * وكانت محطّتين. فما يخصّ المالَ — سلفةٌ على الموظّف، أو مستحقّاتٌ تُصفَّى قبل
 * السفر — لم يكن يمرّ على الحسابات أصلًا، والإدارةُ العليا تعلم بالسفر بعد
 * وقوعه.
 *
 * ── و«طلبُ إيضاح» ليس رفضًا ───────────────────────────────────────────────
 * قد تقول الحسابات: «عليه مبلغٌ يُسدَّد أوّلًا». فالطلبُ لا يُرفَض ولا يُوافَق
 * عليه — يعود إلى صاحبه ليردّ أو يعدّل أو يرفع إيصالًا. فإذا ردّ عادت السلسلةُ
 * من أوّلها، لأنّ الطلبَ الذي وافق عليه المديرُ لم يعد هو الطلبَ نفسَه.
 */
const { rolesOfSection } = require('../config/roles');

// المحطّةُ ← الحالةُ المعلَّقة عندها.
const STAGES = ['manager', 'hr', 'finance', 'executive'];
const PENDING_OF = {
  manager: 'pending_manager',
  hr: 'pending_hr',
  finance: 'pending_finance',
  executive: 'pending_executive',
};
// الطلبُ «مفتوح» ما لم يُبَتّ فيه نهائيًّا — في أيّ محطّةٍ وقف، أو مرتدًّا إلى
// صاحبه للردّ. وهو المقياسُ الذي تُعَدّ به الطلباتُ المعلَّقة في كلّ لوحة؛ فلمّا
// كانت القوائمُ تُكتب محطّتين في كلّ ملفّ، سقط ما بلغ الحساباتِ أو الإدارةَ من
// كلّ عدّاد — يبدو منتهيًا وهو واقف.
const OPEN_STATUSES = [...Object.values(PENDING_OF), 'info_requested'];

const NEXT_OF = { manager: 'hr', hr: 'finance', finance: 'executive', executive: 'done' };
const DECISION_FIELD = {
  manager: 'managerDecision', hr: 'hrDecision',
  finance: 'financeDecision', executive: 'executiveDecision',
};

// ── مَن يملك كلَّ محطّة ───────────────────────────────────────────────────
// الأدوارُ تُقرأ من `config/roles` لا تُكتب هنا قائمةً ثانية تشيخ؛ فإذا زِيد
// دورٌ إلى قسم الموارد البشريّة أو الحسابات دخل السلسلةَ من نفسه.
const HR_ROLES = rolesOfSection('HR');
const FINANCE_ROLES = rolesOfSection('Accounting');
const EXEC_ROLES = ['super_admin', 'admin'];

// ومَن يُمضي ما تعطّل. وليست `FULL_ACCESS_ROLES`: تقنيةُ المعلومات تملك النظامَ
// كلَّه لأنّها تُصلحه، لا لتوقّع على إجازة أحد.
const OVERRIDE_ROLES = ['super_admin'];

/** أيملك هذا المستخدمُ البتَّ في هذه المحطّة على هذا الطلب؟ */
function canActAt(stage, user, leave) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return true;
  if (stage === 'manager') return String(leave.manager || '') === String(user._id);
  if (stage === 'hr') return HR_ROLES.includes(role);
  if (stage === 'finance') return FINANCE_ROLES.includes(role);
  if (stage === 'executive') return EXEC_ROLES.includes(role);
  return false;
}

/**
 * المحطّاتُ التي يملكها هذا المستخدم — تُبنى منها صفحةُ «طلبات تنتظرني».
 * ومحطّةُ المدير ليست دورًا بل صلةٌ بالطلب نفسه، فتُذكر لكلّ مستخدم ويُصفّيها
 * `inboxFilter` بـ `manager: user._id`.
 */
function stagesFor(user) {
  const role = user?.role || '';
  if (OVERRIDE_ROLES.includes(role)) return [...STAGES];
  const out = ['manager'];
  if (HR_ROLES.includes(role)) out.push('hr');
  if (FINANCE_ROLES.includes(role)) out.push('finance');
  if (EXEC_ROLES.includes(role)) out.push('executive');
  return out;
}

/**
 * شرطُ «الطلباتُ التي تنتظر هذا المستخدم» — استعلامٌ واحد لا حلقةٌ في Node.
 * محطّةُ المدير مقيَّدةٌ بطلبات فريقه؛ وسائرُ المحطّات بالدور.
 */
function inboxFilter(user) {
  const stages = stagesFor(user);
  const or = [];
  for (const st of stages) {
    if (st === 'manager' && !OVERRIDE_ROLES.includes(user?.role)) {
      or.push({ status: 'pending_manager', manager: user._id });
    } else {
      or.push({ status: PENDING_OF[st] });
    }
  }
  return or.length ? { $or: or } : { _id: null };
}

/** يُقدِّم الطلبَ إلى المحطّة التالية بعد موافقةٍ في `stage`. */
function advance(leave, stage) {
  const next = NEXT_OF[stage];
  if (next === 'done') { leave.status = 'approved'; leave.currentStage = 'done'; return 'approved'; }
  leave.status = PENDING_OF[next];
  leave.currentStage = next;
  return next;
}

/**
 * يعيد الطلبَ إلى صاحبه بسؤال.
 * ولا تُمحى الموافقاتُ هنا — تُمحى حين يردّ، فيُعرَف من وافق قبل السؤال.
 */
function askEmployee(leave) {
  leave.status = 'info_requested';
  leave.currentStage = 'employee';
}

/**
 * ردُّ الموظّف يعيد السلسلةَ من أوّلها.
 * والموافقاتُ السابقةُ تُمحى: الطلبُ تغيّر، فموافقةُ الأمس كانت على غيره.
 */
function restart(leave) {
  leave.managerDecision = undefined;
  leave.hrDecision = undefined;
  leave.financeDecision = undefined;
  leave.executiveDecision = undefined;
  const hasManager = !!leave.manager;
  leave.status = hasManager ? 'pending_manager' : 'pending_hr';
  leave.currentStage = hasManager ? 'manager' : 'hr';
}

module.exports = {
  STAGES, PENDING_OF, OPEN_STATUSES, NEXT_OF, DECISION_FIELD,
  HR_ROLES, FINANCE_ROLES, EXEC_ROLES, OVERRIDE_ROLES,
  canActAt, stagesFor, inboxFilter, advance, askEmployee, restart,
};
