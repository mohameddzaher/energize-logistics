/**
 * رسالةُ خطأٍ يفهمها المستخدم — لا «فشل الحفظ».
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * كانت المتحكّماتُ تردّ «Failed to create employee» على كلّ عطل. فمَن ملأ نموذجًا
 * ورُدَّ عليه لا يعرف ما ينقص: هل نسي حقلًا؟ أهو رقمٌ مكرَّر؟ أم عطلٌ في النظام
 * أصلًا فلا فائدةَ من إعادة المحاولة؟ فيعيد الكرّةَ مرّاتٍ ثمّ يسأل مَن يسأل.
 *
 * ومنغوسة تعرف الجوابَ دائمًا: أيُّ حقلٍ، ولماذا. لكنّه يُبتلع في `catch`.
 * فيُترجَم هنا مرّةً ويُستعمل في كلّ مكان.
 */

// أسماءُ الحقول بالعربيّة — يُقرأ «رقم الإقامة» لا «iqamaNumber».
const LABELS = {
  firstName: 'الاسم الأول', lastName: 'الاسم الأخير', arabicName: 'الاسم بالعربية',
  employeeNumber: 'الرقم الوظيفي', iqamaNumber: 'رقم الإقامة', nationalId: 'رقم الهوية',
  idType: 'نوع الهوية', employmentStatus: 'حالة التوظيف', gender: 'الجنس',
  dateOfBirth: 'تاريخ الميلاد', nationality: 'الجنسية', department: 'القسم',
  position: 'المسمى الوظيفي', hireDate: 'تاريخ التعيين', branch: 'الفرع',
  directManager: 'المدير المباشر', contractType: 'نوع العقد', salary: 'الراتب',
  phone: 'الجوال', email: 'البريد الإلكتروني', passportNumber: 'رقم الجواز',
  plateNumber: 'رقم اللوحة', name: 'الاسم', idNumber: 'رقم الهوية',
  refNumber: 'الرقم المرجعي', reportNumber: 'رقم الكشف', date: 'التاريخ',
};
const label = (p) => LABELS[p] || LABELS[String(p).split('.').pop()] || p;

/**
 * يحوّل خطأ منغوسة إلى `{ status, message, fields }`.
 * `fields` تُمكّن الشاشةَ من تلوين الخانة نفسِها لا عرضِ نصٍّ فقط.
 */
function describeMongooseError(error, fallback = 'تعذّر الحفظ') {
  if (!error) return { status: 500, message: fallback, fields: [] };

  // حقلٌ مطلوبٌ ناقص، أو قيمةٌ لا يقبلها الحقل.
  if (error.name === 'ValidationError' && error.errors) {
    const missing = []; const invalid = []; const fields = [];
    for (const [p, e] of Object.entries(error.errors)) {
      fields.push(p);
      if (e.kind === 'required') missing.push(label(p));
      else invalid.push(label(p));
    }
    const parts = [];
    if (missing.length) parts.push(`حقول مطلوبة ناقصة: ${missing.join('، ')}`);
    if (invalid.length) parts.push(`قيم غير مقبولة: ${invalid.join('، ')}`);
    return { status: 400, message: parts.join(' — '), fields };
  }

  // نصٌّ في خانة تاريخٍ أو معرّف.
  if (error.name === 'CastError') {
    return {
      status: 400,
      message: `القيمة المُدخلة في «${label(error.path)}» غير صالحة.`,
      fields: [error.path],
    };
  }

  // رقمٌ مكرَّرٌ في حقلٍ فريد — والرسالةُ تقول أيُّ رقمٍ وأيُّ حقل.
  if (error.code === 11000) {
    const key = Object.keys(error.keyPattern || error.keyValue || {})[0];
    const val = (error.keyValue || {})[key];
    return {
      status: 409,
      message: key
        ? `«${label(key)}» مستخدَم بالفعل${val ? ` (${val})` : ''} — لا يتكرر.`
        : 'قيمة مكرَّرة لا تتكرر.',
      fields: key ? [key] : [],
    };
  }

  return { status: 500, message: error.message || fallback, fields: [] };
}

/** يردّ الخطأَ موصوفًا. يُستعمل في `catch` بدل `res.status(500)...`. */
function sendMongooseError(res, error, fallback) {
  const d = describeMongooseError(error, fallback);
  if (d.status >= 500) console.error(fallback || 'error:', error);
  return res.status(d.status).json({ message: d.message, fields: d.fields });
}

/**
 * ينظّف جسمَ الطلب قبل الحفظ.
 *
 * الشاشةُ ترسل كلَّ حقولها، وأكثرُها فارغ. والخانةُ الفارغةُ نصٌّ `''` — تقبله
 * حقولُ النصّ ويرفضه كلُّ ما عداه: `''` ليست معرّفًا ولا تاريخًا ولا قيمةً في
 * قائمة. فكان النموذجُ يُرفض لأنّ المستخدم **لم** يملأ حقلًا اختياريًّا.
 *
 * فتُحذف الفراغاتُ من الحقول غير النصّيّة: الفراغُ غيابٌ لا قيمة.
 */
function stripEmpty(body, schema) {
  const out = { ...body };
  for (const [k, v] of Object.entries(out)) {
    if (v !== '' && v !== null) continue;
    const p = schema && schema.paths[k];
    if (!p) { if (v === null) delete out[k]; continue; }
    // النصُّ الحرُّ يقبل الفراغَ ويعنيه: «لا ملاحظة». فيبقى.
    if (p.instance === 'String') {
      const en = p.enumValues || (p.options && p.options.enum);
      // إلّا نصًّا محصورًا في قائمة: `''` ليست خيارًا فيها، فحذفُها يعني
      // «لم يُختَر» بدل أن تُرفض الاستمارةُ كلُّها لأجل حقلٍ اختياريّ.
      if (!en || !en.length || en.includes('')) { if (v === null) delete out[k]; continue; }
    }
    delete out[k];
  }
  return out;
}

module.exports = { describeMongooseError, sendMongooseError, stripEmpty, fieldLabel: label };
