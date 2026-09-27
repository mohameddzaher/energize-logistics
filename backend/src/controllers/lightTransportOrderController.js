/**
 * أوامرُ تشغيل النقل الخفيف — ومزامنةُ التفويض مع سجلّ المركبات.
 *
 * ── ما أمرُ التشغيل ─────────────────────────────────────────────────────────
 * «هذا الموظّفُ يعمل على هذه المركبة، في هذا المشروع، بهذا الفرع، تحت هذا
 * المشرف، ويسكن هنا.» أمرٌ واحدٌ سارٍ لكلّ موظّف. وإنشاءُ أمرٍ جديدٍ يُغلق
 * السابقَ ولا يمحوه، فتاريخُ من رَكِبَ ماذا ومتى يُقرأ إلى الوراء.
 *
 * ── ولماذا يُكتب التفويضُ في قسم المركبات ──────────────────────────────────
 * التفويضُ ورقةٌ واحدةٌ لمركبةٍ واحدة، وموضعُها `VehicleMaster.authorizedPerson`
 * — تقرأها شاشةُ التفاويض وتُبرَز عند المرور. فلو كتبها هذا القسمُ عنده وحدَه
 * لصار للمركبة الواحدة مفوَّضان: واحدٌ يقرأه قسمُ النقل الخفيف وآخرُ يقرأه قسمُ
 * المركبات — وهو غلطٌ يُكتشف عند مخالفةٍ أو حادث لا قبله.
 *
 * فالنقلُ من هنا يكتب هناك، ويُقيَّد في سجلّ تجديدات المركبة، ويبثّ
 * `vreg:updated` فتتحدّث شاشاتُ قسم المركبات في اللحظة نفسها. والعكسُ محفوظ:
 * القسمُ الآخرُ يكتب في الموضع نفسِه، فما يُقرأ هنا هو ما هناك دائمًا.
 */
const mongoose = require('mongoose');
const { LightTransportEmployee, LightTransportHousing, LightTransportOrder } = require('../models/LightTransport');
const { VehicleMaster } = require('../models/VehicleMaster');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const { applyHousing } = require('./lightTransportController');

const S = (v) => String(v == null ? '' : v).trim();
const byName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');
const D = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

/**
 * البثُّ يمسّ القسمين: هذا القسمُ وقسمُ المركبات. والذاكرةُ تُمحى قبل البثّ —
 * وإلّا قرأ المستمعون ما قبل التغيير فبقيت الشاشةُ متأخّرةً تغييرًا واحدًا.
 */
const emitBoth = () => {
  cache.clear('lt:');
  cache.clear('vreg:');
  try { emitToAll('lt:updated', {}); } catch (e) { /* */ }
  try { emitToAll('vreg:updated', {}); } catch (e) { /* */ }
};

exports.listOrders = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (S(q.status)) filter.status = S(q.status);
    if (S(q.project)) filter.projectAr = S(q.project);
    if (S(q.city)) filter.cityAr = S(q.city);
    if (S(q.employee)) filter.ltEmployee = S(q.employee);
    if (S(q.vehicle)) filter.vehicle = S(q.vehicle);
    if (S(q.from) || S(q.to)) {
      filter.startDate = {};
      if (S(q.from)) filter.startDate.$gte = new Date(S(q.from));
      if (S(q.to)) filter.startDate.$lte = new Date(`${S(q.to)}T23:59:59.999Z`);
    }
    if (S(q.q)) {
      const { arabicSearchRegex } = require('../utils/arabicSearch');
      const rx = arabicSearchRegex(S(q.q));
      filter.$or = [{ orderNumber: rx }, { employeeName: rx }, { employeeIdNumber: rx },
        { vehiclePlate: rx }, { supervisorName: rx }, { notesAr: rx }];
    }
    const orders = await LightTransportOrder.find(filter)
      .populate('vehicle', 'plateNumber registrationTypeAr serialNumber')
      .populate('housing', 'name')
      .sort({ startDate: -1, createdAt: -1 }).limit(3000).lean();
    res.json({
      orders,
      totals: {
        total: orders.length,
        active: orders.filter((o) => o.status === 'active').length,
        ended: orders.filter((o) => o.status === 'ended').length,
        authorizationMoved: orders.filter((o) => o.authorizationMoved).length,
      },
    });
  } catch (e) {
    console.error('lt listOrders:', e);
    res.status(500).json({ message: 'تعذّر تحميل أوامر التشغيل' });
  }
};

/**
 * ── مَن يُختار في الأمر ─────────────────────────────────────────────────────
 * الموظّفون من هذا القسم وحدَه (لا من كلّ الأقسام)، والمركباتُ من سجلّ المركبات.
 * والقائمتان تُبنيان هنا لا في المتصفّح: قائمةُ مركباتٍ كاملةٌ ثلاثُمئةٍ وستٌّ
 * وثلاثون صفًّا تُنقل في كلّ فتحةِ نافذة، والمطلوبُ منها اللوحةُ والنوع.
 */
exports.orderOptions = async (req, res) => {
  try {
    const [employees, vehicles, housings] = await Promise.all([
      LightTransportEmployee.find({ isActive: { $ne: false } })
        .select('name idNumber jobTitleAr staffKind projectAr cityAr vehiclePlate supervisorName')
        .sort({ name: 1 }).lean(),
      // النقلُ الخفيفُ دراجاتٌ ومركباتٌ خاصّة، لا شاحنات — فالقائمةُ تُضيَّق
      // بنوع التسجيل، وإلّا ظهرت الشاحناتُ الثقيلةُ في نافذةِ مندوب توصيل.
      VehicleMaster.find({ isActive: { $ne: false }, registrationTypeCode: { $in: ['motorcycle', 'private'] } })
        .select('plateNumber serialNumber registrationTypeAr brandAr modelAr authorizedPerson')
        .sort({ plateNumber: 1 }).lean(),
      LightTransportHousing.find({ isActive: { $ne: false } }).select('name rooms declaredCapacity').lean(),
    ]);
    res.json({
      employees: employees.map((e) => ({
        _id: String(e._id), name: e.name, idNumber: e.idNumber, jobTitleAr: e.jobTitleAr,
        staffKind: e.staffKind, projectAr: e.projectAr, cityAr: e.cityAr,
        vehiclePlate: e.vehiclePlate, supervisorName: e.supervisorName,
      })),
      vehicles: vehicles.map((v) => ({
        _id: String(v._id), plateNumber: v.plateNumber, serialNumber: v.serialNumber,
        typeAr: v.registrationTypeAr,
        brand: [v.brandAr, v.modelAr].filter(Boolean).join(' '),
        // ومن بيده التفويضُ الآن — يُرى قبل النقل فلا يُنقل ما هو منقول.
        authorizedName: v.authorizedPerson?.name || '',
        authorizedId: v.authorizedPerson?.iqamaNumber || '',
      })),
      housing: housings.map((h) => ({
        _id: String(h._id), name: h.name,
        rooms: (h.rooms || []).map((r) => ({ name: r.name, kind: r.kind, capacity: r.capacity })),
      })),
      // المشرفون: إداريّو القسم — المندوبُ لا يشرف على مندوب.
      supervisors: [...new Set(employees.filter((e) => e.staffKind === 'admin').map((e) => e.name))].sort(),
    });
  } catch (e) {
    console.error('lt orderOptions:', e);
    res.status(500).json({ message: 'تعذّر تحميل خيارات أمر التشغيل' });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(S(b.ltEmployee))) return res.status(400).json({ message: 'اختر الموظّف' });
    const emp = await LightTransportEmployee.findById(S(b.ltEmployee));
    if (!emp) return res.status(404).json({ message: 'الموظّف غير موجود' });

    // ── ولا يُشغَّل من ليس على رأس العمل ─────────────────────────────────
    // إنهاءُ الخدمة في الموارد البشريّة خبرٌ قاطع؛ وأمرُ تشغيلٍ لمن أُنهيت
    // خدمتُه يعني مركبةً مسجَّلةً على من ليس عندنا.
    const hr = emp.employee ? await require('../models/Employee').findById(emp.employee).select('employmentStatus').lean() : null;
    if (hr && hr.employmentStatus === 'terminated') {
      return res.status(400).json({ message: `${emp.name}: أُنهيت خدمتُه في الموارد البشريّة — لا يُشغَّل` });
    }

    let vehicle = null;
    if (S(b.vehicle)) {
      if (!mongoose.isValidObjectId(S(b.vehicle))) return res.status(400).json({ message: 'مركبةٌ غير معروفة' });
      vehicle = await VehicleMaster.findById(S(b.vehicle));
      if (!vehicle) return res.status(404).json({ message: 'المركبةُ غير موجودة في سجلّ المركبات' });
      // ── ومركبةٌ واحدةٌ لراكبٍ واحد ────────────────────────────────────
      // مركبةٌ في أمرين ساريين تعني اثنين يقودانها، ومخالفةً لا يُعرَف صاحبُها.
      const busy = await LightTransportOrder.findOne({
        vehicle: vehicle._id, status: 'active', ltEmployee: { $ne: emp._id },
      }).select('employeeName').lean();
      if (busy) {
        return res.status(400).json({
          code: 'VEHICLE_BUSY',
          message: `المركبة ${vehicle.plateNumber} عليها أمرُ تشغيلٍ سارٍ لـ${busy.employeeName} — أغلِقه أوّلًا`,
        });
      }
    }

    // السكنُ يُحسَب بالقواعد نفسِها التي تحسبه بها صفحةُ الموظّف — دالّةٌ واحدة.
    if (b.housing !== undefined) {
      await applyHousing(emp, b.housing, b.housingRoom, res);
      if (res.headersSent) return undefined;
    }

    // الأمرُ السابقُ يُغلَق ولا يُمحى.
    const previous = await LightTransportOrder.findOne({ ltEmployee: emp._id, status: 'active' });
    if (previous) {
      previous.status = 'ended';
      previous.endDate = D(b.startDate) || new Date();
      previous.endReasonAr = S(b.replaceReason) || 'أمرُ تشغيلٍ جديد';
      await previous.save();
    }

    const last = await LightTransportOrder.findOne({ orderNumber: /^LT-/ }).sort({ orderNumber: -1 }).select('orderNumber').lean();
    const n = last ? (Number(String(last.orderNumber).replace('LT-', '')) || 0) + 1 : 1;

    const order = await LightTransportOrder.create({
      orderNumber: `LT-${String(n).padStart(5, '0')}`,
      ltEmployee: emp._id,
      employeeName: emp.name,
      employeeIdNumber: emp.idNumber,
      vehicle: vehicle ? vehicle._id : null,
      vehiclePlate: vehicle ? vehicle.plateNumber : '',
      vehicleTypeAr: vehicle ? vehicle.registrationTypeAr : S(b.vehicleTypeAr),
      projectAr: S(b.projectAr) || emp.projectAr,
      cityAr: S(b.cityAr) || emp.cityAr,
      supervisorName: S(b.supervisorName) || emp.supervisorName,
      housing: emp.housing,
      housingRoom: emp.housingRoom,
      startDate: D(b.startDate) || new Date(),
      status: 'active',
      notesAr: S(b.notesAr),
      createdBy: req.user?._id,
      createdByName: byName(req.user),
    });

    // ── الحالةُ الحاضرةُ تُكتب على الموظّف ────────────────────────────────
    // القائمةُ تُقرأ من صفّ الموظّف لا من آخر أمر: صفٌّ واحدٌ لكلّ موظّف أسرعُ
    // وأصدقُ في القراءة. والأمرُ هو الأثر.
    const moves = [];
    if (S(order.projectAr) !== S(emp.projectAr)) moves.push({ kind: 'project', fromValue: S(emp.projectAr), toValue: S(order.projectAr) });
    if (S(order.cityAr) !== S(emp.cityAr)) moves.push({ kind: 'city', fromValue: S(emp.cityAr), toValue: S(order.cityAr) });
    if (S(order.supervisorName) !== S(emp.supervisorName)) moves.push({ kind: 'supervisor', fromValue: S(emp.supervisorName), toValue: S(order.supervisorName) });
    if (String(order.vehicle || '') !== String(emp.vehicle || '')) moves.push({ kind: 'vehicle', fromValue: S(emp.vehiclePlate), toValue: S(order.vehiclePlate) });
    emp.projectAr = order.projectAr;
    emp.cityAr = order.cityAr;
    emp.supervisorName = order.supervisorName;
    emp.vehicle = order.vehicle;
    emp.vehiclePlate = order.vehiclePlate;
    if (vehicle?.registrationTypeAr) emp.vehicleTypeAr = vehicle.registrationTypeAr;
    for (const mv of moves) emp.history.push({ ...mv, by: req.user?._id, byName: byName(req.user), note: `أمر تشغيل ${order.orderNumber}` });
    emp.history.push({ kind: 'order', by: req.user?._id, byName: byName(req.user), toValue: order.orderNumber, note: S(b.notesAr) });
    emp.lastModifiedBy = req.user?._id;
    await emp.save();

    // ── ونقلُ التفويض يُكتب في سجلّ المركبات ──────────────────────────────
    if (vehicle && b.moveAuthorization) {
      const before = vehicle.authorizedPerson?.name || '';
      vehicle.authorizedPerson = {
        ...(vehicle.authorizedPerson || {}),
        name: emp.name,
        iqamaNumber: emp.idNumber,
        phone: emp.phone || S(b.authorizationPhone),
        authorizationNumber: S(b.authorizationNumber) || vehicle.authorizedPerson?.authorizationNumber || '',
        startDate: D(b.authorizationStart) || order.startDate,
        expiryDate: D(b.authorizationEnd) || vehicle.authorizedPerson?.expiryDate || null,
      };
      // قيدٌ في سجلّ المركبة نفسِها: مَن قبلَ مَن، ومن أيّ بابٍ جاء التغيير.
      vehicle.renewals = vehicle.renewals || [];
      vehicle.renewals.push({
        document: 'authorization',
        previousExpiry: null,
        newExpiry: vehicle.authorizedPerson.expiryDate || order.startDate,
        previousNumber: before,
        newNumber: emp.name,
        note: `نُقل التفويضُ من قسم النقل الخفيف — أمر ${order.orderNumber}`,
        byName: byName(req.user),
        at: new Date(),
      });
      await vehicle.save();
      order.authorizationMoved = true;
      order.authorizationNumber = vehicle.authorizedPerson.authorizationNumber;
      order.authorizationStart = vehicle.authorizedPerson.startDate;
      order.authorizationEnd = vehicle.authorizedPerson.expiryDate;
      await order.save();
      emp.history.push({ kind: 'authorization', by: req.user?._id, byName: byName(req.user), fromValue: before, toValue: emp.name, note: `المركبة ${vehicle.plateNumber}` });
      await emp.save();
    }

    logAudit({
      user: req.user, action: 'create_lt_order', entity: 'LightTransportOrder', entityId: order._id,
      changes: { after: { order: order.orderNumber, employee: emp.name, vehicle: order.vehiclePlate, authorizationMoved: order.authorizationMoved } },
      ipAddress: req.ip,
    }).catch(() => {});
    emitBoth();
    return res.status(201).json({ order: order.toObject() });
  } catch (e) {
    console.error('lt createOrder:', e);
    return res.status(500).json({ message: 'تعذّر إنشاء أمر التشغيل' });
  }
};

/**
 * إنزالُ الموظّف عن المركبة. والمركبةُ تصير بلا راكبٍ — وهي حالةٌ تُقرأ في
 * اللوحة («مركباتٌ بلا موظّف») لا فراغٌ صامت.
 */
exports.endOrder = async (req, res) => {
  try {
    const order = await LightTransportOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'أمرُ التشغيل غير موجود' });
    if (order.status === 'ended') return res.status(400).json({ message: 'الأمرُ مُغلَقٌ بالفعل' });
    order.status = 'ended';
    order.endDate = D(req.body.endDate) || new Date();
    order.endReasonAr = S(req.body.reason);
    await order.save();

    const emp = await LightTransportEmployee.findById(order.ltEmployee);
    if (emp) {
      emp.history.push({
        kind: 'vehicle', by: req.user?._id, byName: byName(req.user),
        fromValue: S(order.vehiclePlate), toValue: '', note: `إنزال — ${S(req.body.reason) || 'إغلاق أمر ' + order.orderNumber}`,
      });
      emp.vehicle = null;
      emp.vehiclePlate = '';
      await emp.save();
    }

    // ── والتفويضُ يُرفَع أيضًا إن طُلب ───────────────────────────────────
    // إنزالُ الراكبِ وإبقاءُ التفويض باسمه يعني مركبةً مسجَّلةً على من لا
    // يقودها — وهي الحالةُ التي تُكتشف عند مخالفة.
    if (order.vehicle && req.body.releaseAuthorization) {
      const vehicle = await VehicleMaster.findById(order.vehicle);
      if (vehicle && S(vehicle.authorizedPerson?.iqamaNumber) === S(order.employeeIdNumber)) {
        const before = vehicle.authorizedPerson?.name || '';
        vehicle.authorizedPerson = { name: '', iqamaNumber: '', phone: '', authorizationNumber: '', startDate: null, expiryDate: null };
        vehicle.renewals = vehicle.renewals || [];
        vehicle.renewals.push({
          document: 'authorization', newExpiry: new Date(), previousNumber: before, newNumber: '',
          note: `رُفع التفويضُ من قسم النقل الخفيف — إغلاق أمر ${order.orderNumber}`,
          byName: byName(req.user), at: new Date(),
        });
        await vehicle.save();
      }
    }

    logAudit({ user: req.user, action: 'end_lt_order', entity: 'LightTransportOrder', entityId: order._id, changes: { after: { reason: order.endReasonAr } }, ipAddress: req.ip }).catch(() => {});
    emitBoth();
    return res.json({ order: order.toObject() });
  } catch (e) {
    console.error('lt endOrder:', e);
    return res.status(500).json({ message: 'تعذّر إغلاق أمر التشغيل' });
  }
};
