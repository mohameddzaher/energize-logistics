/**
 * موظّفُ النقل الخفيف يُسجَّل في قسمه بمجرّد أن يُكتب قسمُه في الموارد البشريّة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * الإنسانُ يُسجَّل مرّةً واحدة — في الموارد البشريّة. فإن كان قسمُه النقلَ الخفيف
 * (وهو قطاعُ الأفراد نفسُه)، فهو من ذلك القسم بحكم قسمه، ولا معنى لأن يُطلَب من
 * أحدٍ أن يفتح شاشةً ثانيةً ويعيد كتابةَ اسمِه وهويّتِه. وما يُطلَب مرّتين يُنسى
 * مرّةً: فيعمل الرجلُ شهرًا ولا يظهر في سجلّ قسمه، ولا في عدّةٍ ولا في سكن.
 *
 * فالرابطُ يقوم هنا: يُنشَأ صفُّه في سجلّ النقل الخفيف مربوطًا بملفّه — لا
 * منسوخًا عنه. الاسمُ والهويّةُ والحالةُ تبقى تُقرأ من الموارد البشريّة، وما
 * يُكتب هنا هو ما يخصّ القسمَ وحدَه (مشروعُه ومركبتُه وسكنُه) ويملؤه القسم.
 *
 * ── وما لا يفعله ────────────────────────────────────────────────────────────
 * لا يحذف: من نُقل من هذا القسم إلى غيره يبقى صفُّه ويُعطَّل بيد القسم — إخراجُه
 * تلقائيًّا يمحو مشروعَه وسكنَه وتاريخَ نقله لمجرّد أنّ خانةً في ملفٍّ آخرَ
 * تغيّرت. ولا يكرّر: المفتاحُ رقمُ الهويّة، فإعادةُ الحفظ لا تُنشئ صفًّا ثانيًا.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** يطوي صورَ الحروف والمسافات — للمقارنة لا للعرض. */
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي')
  .replace(/\s+/g, '').toLowerCase();

/**
 * أسماءُ القسم التي تعني «النقل الخفيف». وهي أكثرُ من واحد: الملفّاتُ كُتبت
 * على مدى سنةٍ بأيدٍ مختلفة — «B2C» و«b2c» و«ادارة B2C» و«النقل الخفيف».
 */
const LIGHT_DEPARTMENTS = ['النقل الخفيف', 'b2c', 'إدارة b2c', 'ادارة b2c', 'قطاع الأفراد', 'light transport'];
const isLightDepartment = (dept) => {
  const f = fold(dept);
  return !!f && LIGHT_DEPARTMENTS.some((d) => fold(d) === f);
};

/**
 * يضمن وجودَ صفٍّ لهذا الموظّف في سجلّ النقل الخفيف. يُعيد `'created'` أو
 * `'linked'` أو `null` — ولا يرمي أبدًا: فشلُ المزامنة لا يُسقط حفظَ الموظّف.
 */
async function syncEmployeeToLightTransport(employee, user) {
  try {
    if (!employee || !isLightDepartment(employee.department)) return null;
    const idNumber = S(employee.nationalId) || S(employee.iqamaNumber);
    // بلا رقمِ هويّةٍ لا مفتاحَ للصفّ — والمفتاحُ هو ما يمنع التكرار.
    if (!idNumber) return null;

    const { LightTransportEmployee } = require('../models/LightTransport');
    const existing = await LightTransportEmployee.findOne({
      $or: [{ idNumber }, { employee: employee._id }],
    });
    if (existing) {
      // موجودٌ ولم يكن مربوطًا: يُربَط فتُقرأ حالتُه من الملفّ من الآن.
      if (!existing.employee) {
        existing.employee = employee._id;
        await existing.save();
        return 'linked';
      }
      return null;
    }

    const name = S(employee.arabicName)
      || [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim();
    const byName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    await LightTransportEmployee.create({
      idNumber,
      employee: employee._id,
      name: name || idNumber,
      nationalityAr: S(employee.nationality),
      phone: S(employee.phone),
      hireDate: employee.hireDate || employee.joiningDate || null,
      jobTitleAr: S(employee.jobTitle),
      // ما يخصّ القسمَ وحدَه يُترك فارغًا ليملأه القسم: مشروعٌ يُخترَع هنا
      // يُقرأ حقيقةً في اللوحة، ولا أحدَ يعلم أنّه لم يُقرَّر.
      isActive: true,
      createdBy: user?._id,
      history: [{
        kind: 'created',
        by: user?._id,
        byName: byName || 'الموارد البشرية',
        note: 'أُنشئ تلقائيًّا عند تسجيله في قسم النقل الخفيف بالموارد البشرية',
      }],
    });
    return 'created';
  } catch (e) {
    // السجلُّ يحمل الخطأ، وحفظُ الموظّف لا يُنقَض من أجل مزامنة.
    console.error('[lightTransportSync]', e.message);
    return null;
  }
}

module.exports = { isLightDepartment, syncEmployeeToLightTransport, LIGHT_DEPARTMENTS };
