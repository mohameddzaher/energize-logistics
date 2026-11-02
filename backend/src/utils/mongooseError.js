/**
 * User-readable error message instead of a generic save failure.
 * Controllers replied 'Failed to create employee' for every fault, so a user could not tell a missing field from a duplicate number from a real system fault. Mongoose always knows which field and why, but it was swallowed in `catch`. It is translated here once and used everywhere.
 */

// Field names in Arabic, so the message reads the Arabic label rather than 'iqamaNumber'.
const LABELS = {
  firstName: 'الاسم الأول', lastName: 'الاسم الأخير', arabicName: 'الاسم بالعربية',
  employeeNumber: 'الرقم الوظيفي', iqamaNumber: 'رقم الإقامة', nationalId: 'رقم الهوية',
  idType: 'نوع الهوية', employmentStatus: 'حالة التوظيف', gender: 'الجنس',
  dateOfBirth: 'تاريخ الميلاد', nationality: 'الجنسية', department: 'القسم',
  position: 'المسمى الوظيفي', hireDate: 'تاريخ التعيين', branch: 'الفرع',
  directManager: 'المدير المباشر', contractType: 'نوع العقد', salary: 'الراتب',
  phone: 'الجوال', email: 'البريد الإلكتروني', passportNumber: 'رقم الجواز',
  plateNumber: 'رقم اللوحة', name: 'الاسم', idNumber: 'رقم الهوية',
  refNumber: 'الرقم المرجعي', reportNumber: 'رقم أمر النقل', date: 'التاريخ',
};
const label = (p) => LABELS[p] || LABELS[String(p).split('.').pop()] || p;

/** Converts a Mongoose error to `{ status, message, fields }`. `fields` lets the screen highlight the field itself, not only show text. */
function describeMongooseError(error, fallback = 'تعذّر الحفظ') {
  if (!error) return { status: 500, message: fallback, fields: [] };

  // Required field missing, or a value the field does not accept.
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

  // Text in a date or id field.
  if (error.name === 'CastError') {
    return {
      status: 400,
      message: `القيمة المُدخلة في «${label(error.path)}» غير صالحة.`,
      fields: [error.path],
    };
  }

  // Duplicate value in a unique field; the message names the value and the field.
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

/** Replies with the described error. Used in `catch` instead of `res.status(500)...`. */
function sendMongooseError(res, error, fallback) {
  const d = describeMongooseError(error, fallback);
  if (d.status >= 500) console.error(fallback || 'error:', error);
  return res.status(d.status).json({ message: d.message, fields: d.fields });
}

/**
 * Cleans the request body before saving.
 * The screen sends every field, most of them empty. An empty field is the string `''`, which text fields accept and every other type rejects (not an id, date or list value), so a form was rejected because an optional field was left blank.
 * Empty values are removed from non-text fields: empty means absent, not a value.
 */
function stripEmpty(body, schema) {
  const out = { ...body };
  for (const [k, v] of Object.entries(out)) {
    if (v !== '' && v !== null) continue;
    const p = schema && schema.paths[k];
    if (!p) { if (v === null) delete out[k]; continue; }
    // Free text accepts and means empty ('no note'), so it stays.
    if (p.instance === 'String') {
      const en = p.enumValues || (p.options && p.options.enum);
      // Except text restricted to a list: `''` is not an option there, so dropping it means 'not chosen' instead of rejecting the whole form over an optional field.
      if (!en || !en.length || en.includes('')) { if (v === null) delete out[k]; continue; }
    }
    delete out[k];
  }
  return out;
}

module.exports = { describeMongooseError, sendMongooseError, stripEmpty, fieldLabel: label };
