/**
 * Light-transport operating orders, and authorization sync with the vehicle register.
 * An order says this employee works on this vehicle, project, branch and supervisor, and lives here; one active order per employee, and a new one closes the previous without erasing it.
 * Authorization is written in the vehicles section (`VehicleMaster.authorizedPerson`) so a vehicle never has two authorized persons: a transfer writes there, is logged in the vehicle renewals, and broadcasts `vreg:updated`.
 */
const mongoose = require('mongoose');
const { LightTransportEmployee, LightTransportHousing, LightTransportOrder } = require('../models/LightTransport');
const { VehicleMaster } = require('../models/VehicleMaster');
const logAudit = require('../utils/auditLogger');
const { listSupervisors, resolveSupervisor, syncRepSupervisor } = require('../utils/b2cSupervisors');
const { applyHousing } = require('./lightTransportController');

const S = (v) => String(v == null ? '' : v).trim();
const byName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');
const D = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

/** The broadcast touches two sections: this one and vehicles. The cache is cleared before broadcasting, otherwise listeners read pre-change data and the screen lags by one change. */
const emitBoth = () => require('../utils/vehicleAnnounce').announceVehicles({});

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
    // Search finds by any number, including ones not on the order row: the serial number and authorization number in the vehicle register are looked up there and added by vehicle id.
    if (S(q.q)) {
      const { arabicSearchRegex } = require('../utils/arabicSearch');
      const term = S(q.q);
      const rx = arabicSearchRegex(term);
      const or = [{ orderNumber: rx }, { employeeName: rx }, { employeeIdNumber: rx },
        { vehiclePlate: rx }, { vehicleTypeAr: rx }, { supervisorName: rx },
        { projectAr: rx }, { cityAr: rx }, { authorizationNumber: rx }, { notesAr: rx }];
      const vm = await VehicleMaster.find({
        $or: [{ plateNumber: rx }, { serialNumber: rx }, { chassisNumber: rx },
          { 'authorizedPerson.name': rx }, { 'authorizedPerson.iqamaNumber': rx },
          { 'authorizedPerson.authorizationNumber': rx }],
      }).select('_id').limit(400).lean();
      const ids = vm.map((v) => v._id);
      // A plate is read in any order: both letter/digit orders are one plate. See `plateKeyOf` in lightTransportController.
      const { plateKeyOf, looksLikePlate } = require('./lightTransportController');
      if (looksLikePlate(term)) {
        const want = plateKeyOf(term);
        const byKey = await VehicleMaster.find({}).select('_id plateNumber').lean();
        for (const v of byKey) if (plateKeyOf(v.plateNumber) === want) ids.push(v._id);
        const byOrderPlate = await LightTransportOrder.find({ vehiclePlate: { $nin: ['', null] } })
          .select('_id vehiclePlate').lean();
        const hit = byOrderPlate.filter((x) => plateKeyOf(x.vehiclePlate) === want).map((x) => x._id);
        if (hit.length) or.push({ _id: { $in: hit } });
      }
      if (ids.length) or.push({ vehicle: { $in: ids } });
      filter.$or = or;
    }
    const orders = await LightTransportOrder.find(filter)
      // The current authorization paper is read from the vehicle register, not the order: the order is a snapshot at creation and the paper changes afterwards, from here or from vehicles.
      .populate('vehicle', 'plateNumber registrationTypeAr serialNumber authorizedPerson')
      .populate('housing', 'name')
      .sort({ startDate: -1, createdAt: -1 }).limit(3000).lean();

    /**
     * A paper in a name other than the rider is a state to show.
     * Fourteen vehicles are authorized to one person while another actually drives. It is not an error to fix silently - the paper is in one name and the rider is another, which happens. But it is shown explicitly, otherwise it is found only at a violation or accident.
     */
    const shaped = orders.map((o) => {
      const holderId = S(o.vehicle?.authorizedPerson?.iqamaNumber);
      const holderName = S(o.vehicle?.authorizedPerson?.name);
      return {
        ...o,
        // The import label meaning created from the data (vehicle sheet) is not shown - see utils/importLabels.
        notesAr: require('../utils/importLabels').stripImportNote(o.notesAr),
        createdByName: o.createdByName === 'استيراد شيت القسم' ? '' : o.createdByName,
        authorizedNowName: holderName,
        authorizedNowId: holderId,
        authorizationNumberNow: S(o.vehicle?.authorizedPerson?.authorizationNumber),
        // A real discrepancy: a paper in one name and a different rider working on it.
        authorizationMismatch: !!holderId && !!S(o.employeeIdNumber) && holderId !== S(o.employeeIdNumber),
      };
    });

    res.json({
      orders: shaped,
      totals: {
        total: orders.length,
        active: orders.filter((o) => o.status === 'active').length,
        ended: orders.filter((o) => o.status === 'ended').length,
        authorizationMoved: orders.filter((o) => o.authorizationMoved).length,
        authorizationMismatch: shaped.filter((o) => o.authorizationMismatch).length,
      },
    });
  } catch (e) {
    console.error('lt listOrders:', e);
    res.status(500).json({ message: 'تعذّر تحميل أوامر التشغيل' });
  }
};

/**
 * Who can be chosen in the order.
 * Employees from this department only (not all departments), vehicles from the vehicle register. Both lists are built here, not in the browser: the full vehicle list of 336 rows would be shipped on every dialog open, when only plate and type are needed.
 */
exports.orderOptions = async (req, res) => {
  try {
    // An archived employee cannot be chosen in an operating order, as if deleted.
    const AH = require('../utils/archivedHidden');
    const archSets = await AH.endedStaff();
    const [employees, vehicles, housings] = await Promise.all([
      LightTransportEmployee.find(AH.andAll({ isActive: { $ne: false } }, AH.notArchivedRow(archSets)))
        .select('name idNumber jobTitleAr staffKind projectAr cityAr vehicle vehiclePlate supervisorName supervisorUser')
        .sort({ name: 1 }).lean(),
      // Light transport is bikes and private vehicles, not trucks; the list is narrowed by registration type, otherwise heavy trucks would show in a delivery rider's dialog.
      VehicleMaster.find({ isActive: { $ne: false }, registrationTypeCode: { $in: ['motorcycle', 'private'] } })
        .select('plateNumber serialNumber registrationTypeAr brandAr modelAr authorizedPerson')
        .sort({ plateNumber: 1 }).lean(),
      LightTransportHousing.find({ isActive: { $ne: false } }).select('name rooms declaredCapacity').lean(),
    ]);
    res.json({
      employees: employees.map((e) => ({
        _id: String(e._id), name: e.name, idNumber: e.idNumber, jobTitleAr: e.jobTitleAr,
        staffKind: e.staffKind, projectAr: e.projectAr, cityAr: e.cityAr,
        vehicle: e.vehicle ? String(e.vehicle) : '', vehiclePlate: e.vehiclePlate, supervisorName: e.supervisorName,
        supervisorUser: e.supervisorUser ? String(e.supervisorUser) : '',
      })),
      vehicles: vehicles.map((v) => ({
        _id: String(v._id), plateNumber: v.plateNumber, serialNumber: v.serialNumber,
        typeAr: v.registrationTypeAr,
        brand: [v.brandAr, v.modelAr].filter(Boolean).join(' '),
        // And who holds the authorization now, shown before the transfer so an already-transferred vehicle is not transferred again.
        authorizedName: v.authorizedPerson?.name || '',
        authorizedId: v.authorizedPerson?.iqamaNumber || '',
        // And the actual driver (who is on it in this department) - what is asked at operating order time.
        driverId: (() => { const d = employees.find((e) => String(e.vehicle || '') === String(v._id)); return d ? String(d._id) : ''; })(),
        driverName: (() => { const d = employees.find((e) => String(e.vehicle || '') === String(v._id)); return d ? d.name : ''; })(),
      })),
      housing: housings.map((h) => ({
        _id: String(h._id), name: h.name,
        rooms: (h.rooms || []).map((r) => ({ name: r.name, kind: r.kind, capacity: r.capacity })),
      })),
      /**
       * Supervisors: system supervision accounts.
       * The list used to be the department's administrators' names, i.e. anyone written as administrative, supervisor, mechanic or cleaner. An operating order says who stands over this man in the morning, and the answer is an account that opens the inspection screen, not a name in a list. See `utils/b2cSupervisors`.
       */
      supervisors: await listSupervisors(),
    });
  } catch (e) {
    console.error('lt orderOptions:', e);
    res.status(500).json({ message: 'تعذّر تحميل خيارات أمر التشغيل' });
  }
};


/**
 * Transferring a vehicle's authorization on its own.
 * Not every transfer is a new operating order. A vehicle may be authorized to one person while another actually drives it - an existing case on fourteen vehicles, not an error: the paper is in one name and the rider is another. So correcting the paper alone may be requested, or moving it from one rider to another who already holds the vehicle.
 * Writing to the vehicle register is the same as in the operating order: the authorization has one place, otherwise sections would read different values.
 */
exports.moveAuthorization = async (req, res) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(S(b.vehicle))) return res.status(400).json({ message: 'اختر المركبة' });
    const vehicle = await VehicleMaster.findById(S(b.vehicle));
    if (!vehicle) return res.status(404).json({ message: 'المركبةُ غير موجودة في سجلّ المركبات' });

    // To whom: an employee of this department, or remove the authorization with no replacement.
    let to = null;
    if (S(b.toEmployee)) {
      if (!mongoose.isValidObjectId(S(b.toEmployee))) return res.status(400).json({ message: 'موظّفٌ غير معروف' });
      to = await LightTransportEmployee.findById(S(b.toEmployee));
      if (!to) return res.status(404).json({ message: 'الموظّفُ غير موجود' });
    }

    const before = {
      name: vehicle.authorizedPerson?.name || '',
      id: vehicle.authorizedPerson?.iqamaNumber || '',
    };
    if (to && S(before.id) === S(to.idNumber)) {
      return res.status(400).json({ message: `المركبة ${vehicle.plateNumber} مفوَّضةٌ له بالفعل` });
    }

    vehicle.authorizedPerson = to ? {
      ...(vehicle.authorizedPerson || {}),
      name: to.name,
      iqamaNumber: to.idNumber,
      phone: to.phone || S(b.phone),
      authorizationNumber: S(b.authorizationNumber) || vehicle.authorizedPerson?.authorizationNumber || '',
      startDate: D(b.startDate) || new Date(),
      expiryDate: D(b.expiryDate) || vehicle.authorizedPerson?.expiryDate || null,
    } : { name: '', iqamaNumber: '', phone: '', authorizationNumber: '', startDate: null, expiryDate: null };

    // An entry in the vehicle's log: who took over from whom, and through which door the change came.
    vehicle.renewals = vehicle.renewals || [];
    vehicle.renewals.push({
      document: 'authorization',
      newExpiry: vehicle.authorizedPerson.expiryDate || new Date(),
      previousNumber: before.name,
      newNumber: to ? to.name : '',
      note: to
        ? `نُقل التفويضُ من قسم النقل الخفيف${S(b.reason) ? ` — ${S(b.reason)}` : ''}`
        : `رُفع التفويضُ من قسم النقل الخفيف${S(b.reason) ? ` — ${S(b.reason)}` : ''}`,
      byName: byName(req.user),
      at: new Date(),
    });
    await vehicle.save();

    // And in the employees' log: with whom it was taken and from whom it was lost.
    if (to) {
      to.history.push({
        kind: 'authorization', by: req.user?._id, byName: byName(req.user),
        fromValue: before.name, toValue: to.name, note: `المركبة ${vehicle.plateNumber}${S(b.reason) ? ` — ${S(b.reason)}` : ''}`,
      });
      await to.save();
    }
    if (before.id) {
      const from = await LightTransportEmployee.findOne({ idNumber: before.id });
      if (from && String(from._id) !== String(to?._id || '')) {
        from.history.push({
          kind: 'authorization', by: req.user?._id, byName: byName(req.user),
          fromValue: from.name, toValue: to ? to.name : '', note: `المركبة ${vehicle.plateNumber} — نُقل التفويضُ عنه`,
        });
        await from.save();
      }
    }

    logAudit({
      user: req.user, action: 'move_lt_authorization', entity: 'VehicleMaster', entityId: vehicle._id,
      changes: { before: { authorizedTo: before.name }, after: { authorizedTo: to ? to.name : '(رُفع)' } },
      ipAddress: req.ip,
    }).catch(() => {});
    emitBoth();
    return res.json({
      vehicle: { _id: String(vehicle._id), plateNumber: vehicle.plateNumber, authorizedPerson: vehicle.authorizedPerson },
    });
  } catch (e) {
    console.error('lt moveAuthorization:', e);
    return res.status(500).json({ message: 'تعذّر نقل التفويض' });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(S(b.ltEmployee))) return res.status(400).json({ message: 'اختر الموظّف' });
    const emp = await LightTransportEmployee.findById(S(b.ltEmployee));
    if (!emp) return res.status(404).json({ message: 'الموظّف غير موجود' });
    // A project transfer through an operating order is like one from the register: only by whoever owns it. See utils/b2cEntry.canTransfer.
    if (S(b.projectAr) && S(b.projectAr) !== S(emp.projectAr) && !require('../utils/b2cEntry').canTransfer(req.user)) {
      return res.status(403).json({ message: 'نقلُ المندوب إلى مشروعٍ آخر لنائب مدير قطاع الأفراد ومدير القسم والسوبر أدمن والأدمن' });
    }

    // Someone not on duty is not assigned.
    // The HR status of the employee is authoritative; an operating order for someone not on duty means a vehicle registered to a person not working. The condition used to be 'terminated' only, so suspended and on-leave staff could be assigned, though not on duty. The condition is now the one valid status: `active`.
    // If he has actually returned and his file is not updated yet, the department sends a request to HR from 'HR requests', the status is corrected, then he is assigned. See models/StaffStatusRequest.
    const HR_STATUS_AR = {
      terminated: 'أُنهيت خدمتُه', suspended: 'موقوف', on_leave: 'في إجازة',
      resigned: 'استقال', retired: 'متقاعد',
    };
    const hr = emp.employee ? await require('../models/Employee').findById(emp.employee).select('employmentStatus').lean() : null;
    if (hr && hr.employmentStatus && hr.employmentStatus !== 'active') {
      const why = HR_STATUS_AR[hr.employmentStatus] || hr.employmentStatus;
      return res.status(400).json({
        message: `${emp.name}: ${why} في الموارد البشريّة — لا يُشغَّل. إن عاد فعلًا فأرسِل طلبًا من «طلبات الموارد البشرية».`,
        code: 'HR_NOT_ACTIVE',
      });
    }

    let vehicle = null;
    if (S(b.vehicle)) {
      if (!mongoose.isValidObjectId(S(b.vehicle))) return res.status(400).json({ message: 'مركبةٌ غير معروفة' });
      vehicle = await VehicleMaster.findById(S(b.vehicle));
      if (!vehicle) return res.status(404).json({ message: 'المركبةُ غير موجودة في سجلّ المركبات' });
      // One vehicle, one actual driver.
      // The actual driver is whoever has the operating order, not the authorized person (the paper may be in another name). If another driver is on the vehicle, the order is not accepted until it says where he goes: another vehicle, or none. So a vehicle never has two drivers.
      const current = await LightTransportEmployee.findOne({ vehicle: vehicle._id, _id: { $ne: emp._id } })
        || await LightTransportEmployee.findOne({
          _id: (await LightTransportOrder.findOne({ vehicle: vehicle._id, status: { $in: ['active', 'hold'] }, ltEmployee: { $ne: emp._id } }).select('ltEmployee').lean())?.ltEmployee || null,
        });
      if (current) {
        const decision = S(b.currentDriverTo); // 'none' or a vehicle id
        if (!decision) {
          return res.status(409).json({
            code: 'VEHICLE_HAS_DRIVER',
            driver: { _id: String(current._id), name: current.name, idNumber: current.idNumber },
            message: `المركبة ${vehicle.plateNumber} قائدُها الفعليّ ${current.name} — حدِّد: ينتقل إلى مركبةٍ أخرى أم يبقى بلا مركبة.`,
          });
        }
        let toVehicle = null;
        if (decision !== 'none') {
          if (!mongoose.isValidObjectId(decision)) return res.status(400).json({ message: 'مركبةُ القائد الحاليّ غير معروفة' });
          toVehicle = await VehicleMaster.findById(decision);
          if (!toVehicle) return res.status(404).json({ message: 'المركبةُ الأخرى غير موجودة' });
          if (String(toVehicle._id) === String(vehicle._id)) return res.status(400).json({ message: 'اختر مركبةً غيرَ هذه للقائد الحاليّ' });
          const toTaken = await LightTransportEmployee.findOne({ vehicle: toVehicle._id, _id: { $nin: [current._id, emp._id] } }).select('name').lean();
          if (toTaken) return res.status(400).json({ message: `المركبة ${toVehicle.plateNumber} قائدُها ${toTaken.name} — اختر مركبةً بلا قائد` });
        }
        // The current driver's order is closed, and a new order on his new vehicle is opened if one was chosen.
        await LightTransportOrder.updateMany({ ltEmployee: current._id, status: { $in: ['active', 'hold'] } },
          { $set: { status: 'ended', endDate: D(b.startDate) || new Date(), endReasonAr: `نُقلت مركبتُه ${vehicle.plateNumber} إلى ${emp.name}` } });
        if (toVehicle) {
          const lastN = await LightTransportOrder.findOne({ orderNumber: /^LT-/ }).sort({ orderNumber: -1 }).select('orderNumber').lean();
          const nn = lastN ? (Number(String(lastN.orderNumber).replace('LT-', '')) || 0) + 1 : 1;
          await LightTransportOrder.create({
            orderNumber: `LT-${String(nn).padStart(5, '0')}`,
            ltEmployee: current._id, employeeName: current.name, employeeIdNumber: current.idNumber,
            vehicle: toVehicle._id, vehiclePlate: toVehicle.plateNumber, vehicleTypeAr: toVehicle.registrationTypeAr,
            projectAr: current.projectAr, cityAr: current.cityAr,
            supervisorUser: current.supervisorUser || null, supervisorName: current.supervisorName,
            housing: current.housing, housingRoom: current.housingRoom,
            startDate: D(b.startDate) || new Date(), status: 'active',
            notesAr: `انتقل من ${vehicle.plateNumber} — أمرُ تشغيل ${emp.name}`,
            createdBy: req.user?._id, createdByName: byName(req.user),
          });
        }
        current.history.push({
          kind: 'vehicle', by: req.user?._id, byName: byName(req.user),
          fromValue: S(vehicle.plateNumber), toValue: toVehicle ? S(toVehicle.plateNumber) : '',
          note: toVehicle ? `نُقل إلى ${toVehicle.plateNumber} — مركبتُه أُعطيت لـ${emp.name}` : `صار بلا مركبة — مركبتُه أُعطيت لـ${emp.name}`,
        });
        current.vehicle = toVehicle ? toVehicle._id : null;
        current.vehiclePlate = toVehicle ? toVehicle.plateNumber : '';
        if (toVehicle?.registrationTypeAr) current.vehicleTypeAr = toVehicle.registrationTypeAr;
        current.vehicleHold = { at: null, reason: '' };
        await current.save();
      }
    }

    // Housing is computed by the same rules as the employee page: one function.
    if (b.housing !== undefined) {
      await applyHousing(emp, b.housing, b.housingRoom, res);
      if (res.headersSent) return undefined;
    }

    // The previous order is closed, not erased.
    const previous = await LightTransportOrder.findOne({ ltEmployee: emp._id, status: { $in: ['active', 'hold'] } });
    if (previous) {
      previous.status = 'ended';
      previous.endDate = D(b.startDate) || new Date();
      previous.endReasonAr = S(b.replaceReason) || 'أمرُ تشغيلٍ جديد';
      await previous.save();
    }

    /** The supervisor in the order is an account chosen. Absent means 'as on the employee', not 'no supervisor': an operating order for a vehicle must not drop existing supervision. */
    let supervisor = null;
    if (S(b.supervisorUser)) {
      supervisor = await resolveSupervisor(S(b.supervisorUser));
      if (!supervisor) return res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
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
      supervisorUser: supervisor ? supervisor._id : (emp.supervisorUser || null),
      supervisorName: supervisor ? supervisor.name : emp.supervisorName,
      housing: emp.housing,
      housingRoom: emp.housingRoom,
      startDate: D(b.startDate) || new Date(),
      status: 'active',
      notesAr: S(b.notesAr),
      createdBy: req.user?._id,
      createdByName: byName(req.user),
    });

    // The current state is written on the employee.
    // The list reads from the employee row, not the last order: one row per employee is faster and more truthful to read. The order is the trail.
    const moves = [];
    if (S(order.projectAr) !== S(emp.projectAr)) moves.push({ kind: 'project', fromValue: S(emp.projectAr), toValue: S(order.projectAr) });
    if (S(order.cityAr) !== S(emp.cityAr)) moves.push({ kind: 'city', fromValue: S(emp.cityAr), toValue: S(order.cityAr) });
    const supChanged = String(order.supervisorUser || '') !== String(emp.supervisorUser || '');
    if (supChanged) moves.push({ kind: 'supervisor', fromValue: S(emp.supervisorName), toValue: S(order.supervisorName) });
    if (String(order.vehicle || '') !== String(emp.vehicle || '')) moves.push({ kind: 'vehicle', fromValue: S(emp.vehiclePlate), toValue: S(order.vehiclePlate) });
    emp.projectAr = order.projectAr;
    emp.cityAr = order.cityAr;
    emp.supervisorUser = order.supervisorUser;
    emp.supervisorName = order.supervisorName;
    if (supervisor) emp.supervisor = supervisor.employee || null;
    emp.vehicle = order.vehicle;
    emp.vehiclePlate = order.vehiclePlate;
    if (vehicle?.registrationTypeAr) emp.vehicleTypeAr = vehicle.registrationTypeAr;
    for (const mv of moves) emp.history.push({ ...mv, by: req.user?._id, byName: byName(req.user), note: `أمر تشغيل ${order.orderNumber}` });
    emp.history.push({ kind: 'order', by: req.user?._id, byName: byName(req.user), toValue: order.orderNumber, note: S(b.notesAr) });
    emp.lastModifiedBy = req.user?._id;
    await emp.save();
    // And his supervisor sees him in the start-of-shift check from this moment.
    if (supChanged) await syncRepSupervisor(emp.name, emp.supervisorUser, { ltId: emp._id });

    // An authorization transfer is written to the vehicle register
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
      // An entry in the vehicle's own log: who took over from whom, and through which door the change came.
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

/** Taking an employee off a vehicle. The vehicle becomes riderless, a state shown on the dashboard ('vehicles without an employee'), not a silent gap. */
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

    // The authorization is lifted too if requested.
    // Taking the rider off while leaving the authorization in his name means a vehicle registered to someone who does not drive it, which is only found at a violation.
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
