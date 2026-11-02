/**
 * A light-transport employee is registered in that department as soon as HR writes their department.
 * A person is registered once, in HR. If the department is light transport (the individuals sector), they belong to it by that fact, and nobody should re-enter name and identity on a second screen; anything asked twice gets forgotten, and the person works for a month absent from their department register, housing and equipment.
 * The link is created here: a row in the light-transport register tied to the HR file, not copied from it. Name, identity and status keep being read from HR; what is written here is department-only (project, vehicle, housing), filled by the department.
 * It never deletes: someone moved out stays and is deactivated by the department, since auto-removal would erase project, housing and transfer history because a field in another file changed. It never duplicates: the key is the identity number, so re-saving creates no second row.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** Folds letter and whitespace variants, for comparison only. */
const fold = (v) => S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي')
  .replace(/\s+/g, '').toLowerCase();

/** Department names meaning light transport. There are several because files were written by different hands over a year: B2C variants and the Arabic light-transport name. */
const LIGHT_DEPARTMENTS = ['النقل الخفيف', 'b2c', 'إدارة b2c', 'ادارة b2c', 'قطاع الأفراد', 'light transport'];
const isLightDepartment = (dept) => {
  const f = fold(dept);
  return !!f && LIGHT_DEPARTMENTS.some((d) => fold(d) === f);
};

/** Ensures a row exists for this employee in the light-transport register. Returns `'created'`, `'linked'` or `null`; never throws, since a sync failure must not fail the employee save. */
async function syncEmployeeToLightTransport(employee, user) {
  try {
    if (!employee || !isLightDepartment(employee.department)) return null;
    const idNumber = S(employee.nationalId) || S(employee.iqamaNumber);
    // Without an identity number the row has no key, and the key prevents duplicates.
    if (!idNumber) return null;

    const { LightTransportEmployee } = require('../models/LightTransport');
    const existing = await LightTransportEmployee.findOne({
      $or: [{ idNumber }, { employee: employee._id }],
    });
    if (existing) {
      // Exists but was unlinked: link it so its status is read from the file from now on.
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
      // Also set the project if the file holds a B2C project, as HR decided it, so it is not left empty (project moves between the two sections in both directions).
      projectAr: (await require('./hrLists').namesOf('lt_project')).includes(S(employee.project)) ? S(employee.project) : '',
      // Department-only fields are left empty for the department to fill: an invented project would read as real on the dashboard and nobody would know it was never decided.
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
    // The register carries the error; saving the employee is not undone for a sync.
    console.error('[lightTransportSync]', e.message);
    return null;
  }
}

module.exports = { isLightDepartment, syncEmployeeToLightTransport, LIGHT_DEPARTMENTS };
