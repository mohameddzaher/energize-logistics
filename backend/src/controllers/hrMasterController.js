/**
 * hrMasterController — نظرة الموارد البشرية الشاملة: كارت لكل عمود، وقايمة شغل.
 *
 * الفكرة اللي القسم ده مبني عليها: الداشبورد مش عرض أرقام، دي **قايمة شغل**.
 * كل رقم «مطلوب» معناه ناقص لازم التيم يجمّعه، والضغط عليه بيفتح الناس اللي
 * ناقصهم بالظبط عشان يتملي من هناك على طول.
 *
 * وعشان كده «مطلوب» و«غير مطلوب» مفصولين في كل عدّاد: سعودي مالوش إقامة مش
 * «ناقص إقامة»، وحطّه في قايمة الشغل بيخلّيها كذب وبيضيّع وقت الناس.
 */
const Employee = require('../models/Employee');
const H = require('../config/hrFields');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const emit = () => { try { emitToAll('hr:master', {}); } catch (e) {} cache.clear('hrm:'); };
const filled = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** حالة حقل عند موظف: مطلوب / غير مطلوب / لا يوجد / مملي. */
const statusOf = (emp, fieldKey) => {
  const st = emp.fieldStatus?.[H.statusKeyOf(fieldKey)];
  if (st) return st;
  return filled(emp[fieldKey]) ? 'filled' : 'none';
};

// عتبات التنبيه — نفس فكرة المركبات. لو حبينا نخلّيها قابلة للتعديل بعدين،
// المكان ده هو اللي هيتغيّر.
const ALERT = { warnDays: 60, criticalDays: 30 };

function buildFilter(q) {
  // سجلات حسابات الدخول التلقائية مش موظفين — بتخرج من كل عدّاد وكل قايمة هنا.
  const f = { isHrRecord: { $ne: false } };
  if (q.status === 'active') f.employmentStatus = 'active';
  if (q.status === 'inactive') f.employmentStatus = { $ne: 'active' };
  for (const k of ['department', 'branchName', 'project', 'nationality', 'workStatusText', 'bank', 'licenseType', 'insuranceCompany', 'directManagerName', 'iqamaProfession', 'idType', 'gender', 'driverCardStatus', 'insuranceClass', 'contractStatusText', 'systemStatus']) {
    if (q[k]) f[k] = q[k] === '—' ? { $in: ['', null] } : q[k];
  }
  if (q.outsideKingdom === '1') f.isOutsideKingdom = true;
  if (q.freelancer === '1') f.isFreelancer = true;
  if (q.q && q.q.trim()) {
    const r = rx(q.q);
    f.$or = [{ arabicName: r }, { firstName: r }, { lastName: r }, { employeeNumber: r }, { iqamaNumber: r }, { passportNumber: r }, { companyNumber: r }, { absherNumber: r }];
  }
  return f;
}

// ═══════════════════════════════════════════════════════════════════════════
//  النظرة الشاملة
// ═══════════════════════════════════════════════════════════════════════════
exports.overview = async (req, res) => {
  try {
    const key = `hrm:ov:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const employees = await Employee.find(buildFilter(req.query)).lean();

    // ── كارت لكل حقل ─────────────────────────────────────────────────────────
    // العدّادات الأربعة هي اللي المستخدم طلبها بالاسم: مطلوب، غير مطلوب، مملي،
    // والإجمالي. وكل واحد معاه الفلتر اللي بيفتح الناس دول بالظبط.
    const groups = H.GROUPS.map((g) => {
      const fields = g.fields.map((f) => {
        const counts = { required: 0, not_required: 0, none: 0, filled: 0, cash_payroll: 0, unparseable: 0 };
        const values = new Map();
        for (const e of employees) {
          const st = statusOf(e, f.key);
          counts[st] = (counts[st] || 0) + 1;
          if (f.groupable) {
            const raw = e[f.key];
            const v = raw === true ? 'نعم' : raw === false ? 'لا' : (filled(raw) ? String(raw) : '—');
            values.set(v, (values.get(v) || 0) + 1);
          }
        }
        return {
          key: f.key, ar: f.ar, en: f.en, type: f.type, group: g.key,
          total: employees.length,
          counts,
          // «مطلوب» هو الرقم اللي بيتصرف فيه — بيتقدّم في الترتيب.
          required: counts.required,
          values: f.groupable
            ? [...values.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
            : undefined,
        };
      });
      const out = {
        key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document,
        fields,
        required: fields.reduce((n, f) => n + f.required, 0),
      };
      // المجموعات اللي فيها مستند بتاريخ انتهاء بتاخد كمان حالات التاريخ.
      if (g.document) {
        const states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
        let nearest = null;
        for (const e of employees) {
          const st = H.stateOf(e[g.expiryField], statusOf(e, g.expiryField) === 'filled' ? '' : statusOf(e, g.expiryField), ALERT);
          states[st.state] += 1;
          if (st.days != null && st.days >= 0 && (nearest === null || st.days < nearest)) nearest = st.days;
        }
        out.states = states;
        out.expiryField = g.expiryField;
        out.needsAttention = states.expired + states.critical + states.warning;
        out.nearestDays = nearest;
      }
      return out;
    });

    const totals = {
      employees: employees.length,
      active: employees.filter((e) => e.employmentStatus === 'active').length,
      required: groups.reduce((n, g) => n + g.required, 0),
      expiringSoon: groups.reduce((n, g) => n + (g.needsAttention || 0), 0),
      outsideKingdom: employees.filter((e) => e.isOutsideKingdom).length,
      freelancers: employees.filter((e) => e.isFreelancer).length,
      cashPayroll: employees.filter((e) => statusOf(e, 'iban') === 'cash_payroll').length,
      gosiRegistered: employees.filter((e) => filled(e.gosiNumber)).length,
    };

    // أكتر ١٢ حقل ناقص — «ابدأ من هنا».
    const topRequired = groups
      .flatMap((g) => g.fields.map((f) => ({ ...f, groupAr: g.ar, groupKey: g.key })))
      .filter((f) => f.required > 0)
      .sort((a, b) => b.required - a.required)
      .slice(0, 12);

    const body = { totals, groups, topRequired, alert: ALERT, statuses: H.STATUS_LABELS, states: H.STATE_LABELS };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('hr overview', e);
    res.status(500).json({ message: 'تعذّر تحميل نظرة الموارد البشرية' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  صفحة كل مجموعة — الإقامات، الرخص، التأمينات …
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /records/:group?field=&status=required&state=expired&withinDays=30&sort=&dir=
 *
 * بترجّع الموظفين + **حقول المجموعة دي بس** وحالة كل حقل، فالشاشة تقدر تعرض
 * الناقص وتخلّي المستخدم يملاه من نفس المكان.
 */
exports.records = async (req, res) => {
  try {
    const g = H.getGroup(req.params.group);
    if (!g) return res.status(404).json({ message: 'المجموعة غير معروفة' });

    const employees = await Employee.find(buildFilter(req.query))
      .select(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'department', 'branchName', 'project',
        'employmentStatus', 'workStatusText', 'fieldStatus', ...g.fields.map((f) => f.key)].join(' '))
      .lean();

    const field = req.query.field || '';
    const wantStatus = req.query.status || '';
    const wantState = req.query.state || '';
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Number(req.query.withinDays);

    let rows = employees.map((e) => {
      const values = {};
      const statuses = {};
      for (const f of g.fields) { values[f.key] = e[f.key] ?? null; statuses[f.key] = statusOf(e, f.key); }
      const doc = g.document
        ? H.stateOf(e[g.expiryField], statuses[g.expiryField] === 'filled' ? '' : statuses[g.expiryField], ALERT)
        : null;
      return {
        _id: e._id,
        employeeNumber: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        department: e.department, branchName: e.branchName, project: e.project,
        workStatusText: e.workStatusText, employmentStatus: e.employmentStatus,
        values, statuses,
        state: doc?.state || null, daysRemaining: doc?.days ?? null,
        // «ناقص إيه عند الشخص ده» — بالاسم، عشان الشاشة ما تحسبهاش تاني.
        missing: g.fields.filter((f) => statuses[f.key] === 'required').map((f) => ({ key: f.key, ar: f.ar })),
      };
    });

    if (field && wantStatus) rows = rows.filter((r) => r.statuses[field] === wantStatus);
    else if (wantStatus) rows = rows.filter((r) => g.fields.some((f) => r.statuses[f.key] === wantStatus));
    if (wantState) rows = rows.filter((r) => r.state === wantState);
    if (withinDays !== null && g.document) {
      rows = rows.filter((r) => r.daysRemaining != null && r.daysRemaining <= withinDays);
    }

    // الترتيب: بالأقرب انتهاءً افتراضيًا للمستندات، وبالاسم لغيرها.
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const sort = req.query.sort || (g.document ? 'daysRemaining' : 'name');
    rows.sort((a, b) => {
      const av = sort === 'daysRemaining' ? (a.daysRemaining ?? 1e9) : (a[sort] ?? a.values?.[sort] ?? '');
      const bv = sort === 'daysRemaining' ? (b.daysRemaining ?? 1e9) : (b[sort] ?? b.values?.[sort] ?? '');
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'ar') * dir;
    });

    // ملخّص محسوب على **نفس** الصفوف المعروضة.
    const summary = { total: rows.length };
    for (const f of g.fields) {
      summary[f.key] = { required: 0, not_required: 0, none: 0, filled: 0 };
      for (const r of rows) summary[f.key][r.statuses[f.key]] = (summary[f.key][r.statuses[f.key]] || 0) + 1;
    }
    if (g.document) {
      summary.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
      for (const r of rows) if (r.state) summary.states[r.state] += 1;
    }

    res.json({
      group: { key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document, expiryField: g.expiryField || null, fields: g.fields },
      rows: rows.slice(0, 1000),
      summary,
    });
  } catch (e) {
    console.error('hr records', e);
    res.status(500).json({ message: 'تعذّر تحميل السجلات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  ملء البيانات الناقصة — من أي مكان
// ═══════════════════════════════════════════════════════════════════════════
/**
 * PATCH /employees/:id/fields   { fields: { iqamaExpiry: '2027-01-01', ... } }
 *
 * الحقول المسموح بيها هي المعرَّفة في config/hrFields بس — عشان الشاشة ما تقدرش
 * تكتب في حقل مالهاش دعوة بيه. وحالة «مطلوب» بتتشال لوحدها في pre-save بتاع
 * الموديل، فالعدّاد في الداشبورد بينقص من غير أي خطوة زيادة.
 */
exports.updateFields = async (req, res) => {
  try {
    const incoming = req.body.fields || {};
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const applied = {}; const rejected = [];
    for (const [k, v] of Object.entries(incoming)) {
      const f = H.getField(k);
      if (!f) { rejected.push(k); continue; }
      if (f.type === 'date') {
        if (v === '' || v === null) { emp[k] = null; applied[k] = null; continue; }
        const dt = new Date(v);
        if (isNaN(dt)) { rejected.push(k); continue; }
        emp[k] = dt; applied[k] = dt;
      } else if (f.type === 'bool') {
        emp[k] = v === true || v === 'true' || v === '1'; applied[k] = emp[k];
      } else {
        emp[k] = String(v ?? '').trim(); applied[k] = emp[k];
      }
    }
    if (!Object.keys(applied).length) {
      return res.status(400).json({ message: rejected.length ? `حقول غير معروفة: ${rejected.join(', ')}` : 'لم تُرسل أي حقول' });
    }

    // «غير مطلوب» قرار إداري — لو المستخدم بيعلّم حقل كده بنسجّلها صراحةً.
    for (const [k, code] of Object.entries(req.body.markStatus || {})) {
      if (!H.getField(k)) continue;
      if (code === 'clear') emp.fieldStatus.delete(H.statusKeyOf(k));
      else if (['required', 'not_required', 'none'].includes(code)) emp.fieldStatus.set(H.statusKeyOf(k), code);
    }

    await emp.save();   // pre-save بيشيل «مطلوب» عن أي حقل اتملى

    logAudit({
      user: req.user, action: 'update_employee_fields', entity: 'Employee', entityId: emp._id,
      changes: { after: applied }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    const fresh = await Employee.findById(emp._id).lean();
    const statuses = {};
    for (const k of Object.keys(applied)) statuses[k] = statusOf(fresh, k);
    res.json({ employee: { _id: fresh._id, ...applied }, statuses, rejected });
  } catch (e) {
    if (e.name === 'ValidationError') {
      const first = Object.values(e.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'بيانات غير صالحة' });
    }
    console.error('hr updateFields', e);
    res.status(500).json({ message: 'تعذّر حفظ البيانات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الانتهاءات عبر كل المستندات
// ═══════════════════════════════════════════════════════════════════════════
exports.expiring = async (req, res) => {
  try {
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = (req.query.doc || '').split(',').map((x) => x.trim()).filter(Boolean);
    const docs = wanted.length ? H.DOCUMENT_GROUPS.filter((g) => wanted.includes(g.key)) : H.DOCUMENT_GROUPS;
    const includeExpired = req.query.includeExpired !== '0';
    const wantState = req.query.state || '';

    const employees = await Employee.find(buildFilter(req.query))
      .select(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'department', 'branchName', 'fieldStatus',
        ...H.DOCUMENT_GROUPS.map((g) => g.expiryField)].join(' '))
      .lean();

    const rows = [];
    for (const e of employees) {
      for (const g of docs) {
        const stCode = statusOf(e, g.expiryField);
        const st = H.stateOf(e[g.expiryField], stCode === 'filled' ? '' : stCode, ALERT);
        if (st.state === 'not_applicable' || st.state === 'missing') continue;
        if (!includeExpired && st.state === 'expired') continue;
        if (wantState && st.state !== wantState) continue;
        if (withinDays !== null && st.days > withinDays) continue;
        rows.push({
          employeeId: e._id, employeeNumber: e.employeeNumber,
          name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          department: e.department, branchName: e.branchName,
          docKey: g.key, docAr: g.ar, docEn: g.en, expiryField: g.expiryField,
          expiryDate: e[g.expiryField], daysRemaining: st.days, state: st.state,
        });
      }
    }
    rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

    const summary = { total: rows.length, expired: 0, critical: 0, warning: 0, valid: 0 };
    const byDoc = {};
    for (const r of rows) { summary[r.state] = (summary[r.state] || 0) + 1; byDoc[r.docKey] = (byDoc[r.docKey] || 0) + 1; }

    res.json({
      rows: rows.slice(0, 2000), summary,
      byDoc: H.DOCUMENT_GROUPS.map((g) => ({ key: g.key, ar: g.ar, en: g.en, count: byDoc[g.key] || 0 })),
      withinDays,
    });
  } catch (e) {
    console.error('hr expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

/** تعريف المجموعات والحقول — الواجهة بتبني منه الصفحات والفلاتر. */
exports.fieldConfig = (req, res) => {
  res.json({
    groups: H.GROUPS.map((g) => ({
      key: g.key, ar: g.ar, en: g.en, icon: g.icon,
      document: !!g.document, expiryField: g.expiryField || null, fields: g.fields,
    })),
    statuses: H.STATUS_LABELS, states: H.STATE_LABELS, alert: ALERT,
  });
};
