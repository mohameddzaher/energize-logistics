/**
 * reportSources — كل نوع تقرير، ومن أين يجمع بياناته.
 *
 * One builder per SUBJECT (عربية، سائق، عميل، مورد، موظف، قسم). Each builder
 * returns the same shape:
 *
 *   { title, subtitle, meta, blocks[] }
 *
 * …which reportBuilder turns into a PDF, and which the frontend also renders as
 * an on-screen preview. That is the whole point of the split: the report is
 * DESCRIBED once and consumed twice, so what you see on screen is exactly what
 * comes out of the printer, on the web and on the phone alike.
 *
 * Adding a new subject = adding one entry to SUBJECTS with an `options` (what
 * can be reported on) and a `build` (the report itself). Nothing else in the
 * system needs to change — the routes, the report centre page and the mobile
 * screen are all driven by this list.
 */
const { money, num, dt, dtm, pct } = require('./reportBuilder');
// Status keys are identifiers; a printed Arabic page must not show "loading".
const {
  SHIPMENT_STATUS_AR, EMPLOYMENT_STATUS_AR, statusLabel,
} = require('../config/constants');
const { nameKey, nameRegex } = require('../utils/nameKey');

const COMPANY = 'تنشيط للخدمات اللوجستية · Energize Logistics';
const T = (ar, en, lang) => (lang === 'en' ? en : ar);

// A period every builder shares. Defaults to the last 12 months, which is the
// span most of these questions are actually asked over.
function resolvePeriod(query = {}) {
  const to = query.to ? new Date(`${query.to}T23:59:59`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00`)
    : new Date(new Date(to).setFullYear(to.getFullYear() - 1));
  // The printed period must echo the dates the user ASKED for. Deriving them
  // from the Date objects via toISOString() shifts them by the UTC offset — a
  // report requested for 2026-01-01 printed "2025-12-31" in Riyadh, which makes
  // the whole document look wrong even when the data behind it is right.
  const localKey = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return {
    from, to,
    fromKey: query.from || localKey(from),
    toKey: query.to || localKey(to),
  };
}

const inRange = (v, from, to) => {
  if (!v) return false;
  const d = new Date(v);
  return d >= from && d <= to;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) تقرير مركبة — one truck, everything about it
// ─────────────────────────────────────────────────────────────────────────────
// Our trucks live in three places at once: Location Solutions has the telemetry
// and the manufacturer service plan, Fleet Management has the loads and the
// money they earned, and the workshop/asset registry has the tires and repairs.
// Nothing links them by id — the join is the plate. So the report joins on the
// normalised plate digits and says clearly which sources it actually found.
async function vehicleOptions(q) {
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const { FleetVehicle } = require('../models/FleetModels');
  const { plateKey } = require('../utils/plateKey');
  const [ls2, fleet] = await Promise.all([
    Ls2Vehicle.find(q ? { $or: [{ plate: nameRegex(q) }, { name: nameRegex(q) }, { driver: nameRegex(q) }] } : {})
      .select('unitId plate name driver odometerKm status').lean(),
    FleetVehicle.find(q ? { $or: [{ plate: nameRegex(q) }, { name: nameRegex(q) }] } : {})
      .select('plate name trailerType supervisorName isActive').lean(),
  ]);
  const byKey = new Map();
  for (const v of ls2) {
    const k = plateKey(v.plate) || `u${v.unitId}`;
    byKey.set(k, { id: k, name: v.plate || v.name || String(v.unitId), detail: [v.driver, v.status].filter(Boolean).join(' · '), sources: ['ls2'] });
  }
  for (const v of fleet) {
    const k = plateKey(v.plate) || `f${v._id}`;
    const cur = byKey.get(k);
    if (cur) { cur.sources.push('fleet'); cur.detail = [cur.detail, v.trailerType].filter(Boolean).join(' · '); }
    else byKey.set(k, { id: k, name: v.plate || v.name, detail: [v.trailerType, v.supervisorName].filter(Boolean).join(' · '), sources: ['fleet'] });
  }
  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

async function buildVehicleReport(id, query, lang) {
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const Ls2Repair = require('../models/Ls2Repair');
  const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const { FleetVehicle, FleetShipment } = require('../models/FleetModels');
  const { plateKey } = require('../utils/plateKey');
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);

  const [allLs2, allFleet] = await Promise.all([
    Ls2Vehicle.find({}).lean(),
    FleetVehicle.find({}).lean(),
  ]);
  // The id may arrive as the folded plate key (from the picker), as `u<unitId>`
  // or `f<fleetId>` (from a telemetry or fleet page that knows its own row), or
  // as a raw plate someone typed. Accepting all four means a link to a vehicle
  // report works from anywhere without every caller re-deriving the same key.
  const wanted = plateKey(id) || String(id);
  const matches = (v, prefix, ownId) =>
    (plateKey(v.plate) && plateKey(v.plate) === wanted)
    || `${prefix}${ownId}` === String(id)
    || String(v.plate || '').trim() === String(id).trim();
  const ls2 = allLs2.find((v) => matches(v, 'u', v.unitId)) || null;
  const fleet = allFleet.find((v) => matches(v, 'f', v._id)) || null;
  if (!ls2 && !fleet) return null;

  const plate = ls2?.plate || fleet?.plate || id;
  const blocks = [];

  // ── Identity ──────────────────────────────────────────────────────────────
  blocks.push({ kind: 'section', text: t('بيانات المركبة', 'Vehicle details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('رقم اللوحة', 'Plate'), plate],
      [t('الاسم في النظام', 'Unit name'), ls2?.name || fleet?.name],
      [t('السائق الحالي', 'Current driver'), ls2?.driver || null],
      [t('نوع المقطورة', 'Trailer type'), fleet?.trailerType],
      [t('الماركة', 'Brand'), ls2?.profile?.brand || fleet?.brand],
      [t('سنة الموديل', 'Model year'), ls2?.profile?.modelYear],
      [t('رقم الهيكل', 'VIN'), ls2?.profile?.vin],
      [t('المشرف', 'Supervisor'), fleet?.supervisorName],
      [t('عداد الكيلومترات', 'Odometer'), ls2?.odometerKm != null ? `${num(ls2.odometerKm)} km` : null],
      [t('الحالة الآن', 'Live status'), ls2?.status],
      [t('آخر إشارة', 'Last signal'), ls2?.lastMessageAt ? dtm(ls2.lastMessageAt) : null],
    ],
  });

  // ── Distance in the period, from the daily odometer mirror ────────────────
  if (ls2) {
    const snaps = await Ls2OdometerDaily.find({
      unitId: ls2.unitId, date: { $gte: fromKey, $lte: toKey },
    }).sort({ date: 1 }).lean();
    let km = 0; let prev = null; let activeDays = 0;
    for (const s of snaps) {
      if (prev) {
        const d = Math.max(0, s.odometerKm - prev.odometerKm);
        if (d > 0) { km += d; activeDays += 1; }
      }
      prev = s;
    }
    blocks.push({ kind: 'section', text: t('التشغيل في الفترة', 'Operation in the period') });
    blocks.push({
      kind: 'stats',
      items: [
        { label: t('المسافة المقطوعة', 'Distance'), value: `${num(km)} km`, accent: true },
        { label: t('أيام التشغيل', 'Active days'), value: num(activeDays) },
        { label: t('متوسط يومي', 'Daily average'), value: activeDays ? `${num(km / activeDays)} km` : '—' },
      ],
    });
    if (!snaps.length) {
      blocks.push({ kind: 'note', text: t('لا توجد لقطات عدّاد مسجّلة لهذه المركبة في هذه الفترة.', 'No odometer snapshots recorded for this vehicle in this period.') });
    }
  }

  // ── Maintenance: the real Wialon service plan ─────────────────────────────
  if (ls2?.serviceIntervals?.length) {
    blocks.push({ kind: 'section', text: t('خطة الصيانة', 'Maintenance plan') });
    blocks.push({
      kind: 'table',
      head: [t('الخدمة', 'Service'), t('الفترة', 'Interval'), t('آخر صيانة', 'Last service'), t('الصيانة القادمة', 'Next'), t('المتبقي', 'Remaining'), t('الحالة', 'Status')],
      align: ['start', 'end', 'end', 'end', 'end', 'center'],
      rows: ls2.serviceIntervals.map((s) => [
        s.name || '—',
        s.intervalKm ? `${num(s.intervalKm)} km` : (s.intervalDays ? `${s.intervalDays} d` : '—'),
        s.lastServiceKm != null ? num(s.lastServiceKm) : '—',
        s.nextServiceKm != null ? num(s.nextServiceKm) : '—',
        {
          t: s.remainingKm != null ? `${num(s.remainingKm)} km` : '—',
          color: s.statusLevel === 'overdue' ? '#dc2626' : s.statusLevel === 'due' ? '#d97706' : undefined,
        },
        { t: s.statusLevel || 'ok', color: s.statusLevel === 'overdue' ? '#dc2626' : s.statusLevel === 'due' ? '#d97706' : '#16a34a' },
      ]),
    });
  }

  // ── Exceptional repairs (accidents, breakdowns) ───────────────────────────
  if (ls2) {
    const repairs = await Ls2Repair.find({ unitId: ls2.unitId, createdAt: { $gte: from, $lte: to } })
      .sort({ createdAt: -1 }).limit(200).lean();
    blocks.push({ kind: 'section', text: t('الإصلاحات الاستثنائية', 'Exceptional repairs') });
    blocks.push({
      kind: 'table',
      head: [t('التاريخ', 'Date'), t('النوع', 'Category'), t('الوصف', 'Description'), t('التكلفة', 'Cost'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'end', 'center'],
      rows: repairs.map((r) => [dt(r.createdAt), r.category || '—', r.description || r.title || '—', money(r.cost), r.status || '—']),
      emptyText: t('لا توجد إصلاحات استثنائية مسجّلة في هذه الفترة.', 'No exceptional repairs recorded in this period.'),
    });
    if (repairs.length) {
      blocks.push({ kind: 'note', text: `${t('إجمالي تكلفة الإصلاحات', 'Total repair cost')}: ${money(repairs.reduce((s, r) => s + (Number(r.cost) || 0), 0))}` });
    }
  }

  // ── Tires currently mounted ───────────────────────────────────────────────
  if (plate) {
    const tires = await Ls2TireAsset.find({ plateKey: plateKey(plate) }).lean().catch(() => []);
    if (tires.length) {
      blocks.push({ kind: 'section', text: t('الكاوتش المركّب', 'Mounted tires') });
      blocks.push({
        kind: 'table',
        head: [t('الرقم التسلسلي', 'Serial'), t('الموضع', 'Position'), t('الحالة', 'Status'), t('الماركة', 'Brand')],
        rows: tires.slice(0, 40).map((x) => [x.serial || '—', x.position || '—', x.status || '—', x.brand || '—']),
      });
    }
  }

  // ── The commercial side: loads carried and what they earned ───────────────
  if (fleet) {
    const shipments = await FleetShipment.find({
      vehicle: fleet._id,
      $or: [{ loadDate: { $gte: from, $lte: to } }, { $and: [{ loadDate: null }, { createdAt: { $gte: from, $lte: to } }] }],
    }).sort({ loadDate: -1, createdAt: -1 }).limit(500).lean();
    const live = shipments.filter((s) => s.status !== 'cancelled');
    const income = live.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const expense = live.reduce((s, x) => s + (Number(x.driverExpense) || 0), 0);

    blocks.push({ kind: 'section', text: t('الحمولات والدخل', 'Loads & income') });
    blocks.push({
      kind: 'stats',
      items: [
        { label: t('عدد الحمولات', 'Loads'), value: num(live.length), accent: true },
        { label: t('الدخل', 'Income'), value: money(income) },
        { label: t('مصروف السائقين', 'Driver expenses'), value: money(expense) },
        { label: t('الصافي', 'Net'), value: money(income - expense) },
        { label: t('متوسط الحمولة', 'Avg / load'), value: live.length ? money(income / live.length) : '—' },
      ],
    });
    const target = (Number(fleet.monthlyTarget) || 0);
    if (target) {
      const monthsSpan = Math.max(1, Math.round((to - from) / (30 * 86400000)));
      const periodTarget = target * monthsSpan;
      blocks.push({
        kind: 'bars',
        items: [{
          label: t('المحقق مقابل الهدف', 'Achieved vs target'),
          value: income, max: Math.max(periodTarget, income),
          text: `${money(income)} / ${money(periodTarget)}`,
          color: income >= periodTarget ? '#16a34a' : '#f37121',
        }],
      });
    }
    blocks.push({
      kind: 'table',
      head: [t('البوليصة', 'Waybill'), t('التاريخ', 'Date'), t('العميل', 'Customer'), t('من', 'From'), t('إلى', 'To'), t('السائق', 'Driver'), t('الإيجار', 'Price'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'start', 'start', 'start', 'end', 'center'],
      rows: shipments.map((s) => [
        String(s.waybillNumber || '—'), dt(s.loadDate || s.createdAt), s.customerName || '—',
        s.fromCity || '—', s.toCity || '—', s.driverName || '—', money(s.price),
        { t: statusLabel(SHIPMENT_STATUS_AR, s.status, lang), color: s.status === 'late' ? '#dc2626' : s.status === 'cancelled' ? '#94a3b8' : undefined },
      ]),
      emptyText: t('لا توجد حمولات مسجّلة لهذه المركبة في هذه الفترة.', 'No loads recorded for this vehicle in this period.'),
    });
  }

  if (!ls2) blocks.push({ kind: 'note', tone: 'warn', text: t('هذه المركبة غير مرتبطة بجهاز تتبّع — بيانات التليمتري والصيانة غير متاحة.', 'This vehicle has no telemetry unit — tracking and maintenance data are unavailable.') });
  if (!fleet) blocks.push({ kind: 'note', tone: 'warn', text: t('هذه المركبة غير مسجّلة في إدارة الأسطول — بيانات الحمولات والدخل غير متاحة.', 'This vehicle is not registered in Fleet Management — load and income data are unavailable.') });

  return {
    title: t('تقرير مركبة', 'Vehicle Report'),
    subtitle: `${plate} · ${fromKey} → ${toKey}`,
    meta: { plate, sources: [ls2 && 'ls2', fleet && 'fleet'].filter(Boolean) },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) تقرير سائق — telemetry + the loads he carried
// ─────────────────────────────────────────────────────────────────────────────
async function driverOptions(q) {
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const Ls2DriverAssignment = require('../models/Ls2DriverAssignment');
  const { FleetDriver } = require('../models/FleetModels');
  const [units, assigns, fleetDrivers] = await Promise.all([
    Ls2Vehicle.find({ driver: { $nin: [null, ''] } }).select('driver plate').lean(),
    Ls2DriverAssignment.find({}).select('driver').lean(),
    FleetDriver.find(q ? { name: nameRegex(q) } : {}).select('name phone vehicle working').populate('vehicle', 'plate').lean(),
  ]);
  const byKey = new Map();
  const add = (name, detail) => {
    const k = nameKey(name);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, { id: name, name, detail: detail || '' });
    else if (detail && !byKey.get(k).detail) byKey.get(k).detail = detail;
  };
  for (const u of units) add(u.driver, u.plate);
  for (const a of assigns) add(a.driver, '');
  for (const d of fleetDrivers) add(d.name, [d.vehicle?.plate, d.phone].filter(Boolean).join(' · '));
  let out = [...byKey.values()];
  if (q) {
    const k = nameKey(q);
    out = out.filter((o) => nameKey(o.name).includes(k));
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

async function buildDriverReport(id, query, lang) {
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const Ls2DriverAssignment = require('../models/Ls2DriverAssignment');
  const { FleetDriver, FleetShipment } = require('../models/FleetModels');
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);
  const name = decodeURIComponent(id);
  const key = nameKey(name);

  const [vehicles, history, fleetDrivers] = await Promise.all([
    Ls2Vehicle.find({}).select('unitId plate driver odometerKm').lean(),
    Ls2DriverAssignment.find({ driver: name }).sort({ from: -1 }).limit(100).lean(),
    FleetDriver.find({}).populate('vehicle', 'plate name').lean(),
  ]);
  const fd = fleetDrivers.find((d) => nameKey(d.name) === key) || null;
  const current = vehicles.find((v) => nameKey(v.driver) === key) || null;
  if (!history.length && !fd && !current) return null;

  const blocks = [];
  blocks.push({ kind: 'section', text: t('بيانات السائق', 'Driver details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('الاسم', 'Name'), fd?.name || name],
      [t('الجوال', 'Phone'), fd?.phone],
      [t('رقم الإقامة', 'Iqama'), fd?.iqama],
      [t('الجنسية', 'Nationality'), fd?.nationality],
      [t('على الكفالة', 'On sponsorship'), fd ? (fd.onSponsorship !== false ? t('نعم', 'Yes') : t('لا', 'No')) : null],
      [t('حالة العمل', 'Working'), fd ? (fd.working !== false ? t('على رأس العمل', 'Working')
        : `${t('متوقف', 'Off')}${fd.offReason ? ` (${fd.offReason})` : ''}`) : null],
      [t('المركبة الحالية', 'Current truck'), current?.plate || fd?.vehicle?.plate],
    ],
  });

  // Telemetry side — the scoring service is the single source for this so the
  // report and the scorecard page can never disagree.
  try {
    const perf = require('./ls2DriverPerformance');
    const Ls2Settings = require('../models/Ls2Settings');
    const s = await Ls2Settings.getOrCreate();
    const limit = Number(s?.thresholds?.speedMaxKmh) || 90;
    const unitIds = [...new Set(history.map((h) => h.unitId).concat(current ? [current.unitId] : []))];
    if (unitIds.length) {
      const { merged } = await perf.deepForDriver(unitIds, fromKey, toKey);
      if (merged && merged.tripCount) {
        blocks.push({ kind: 'section', text: t('الأداء من بيانات التتبّع', 'Performance from telemetry') });
        blocks.push({
          kind: 'stats',
          items: [
            { label: t('عدد الرحلات', 'Trips'), value: num(merged.tripCount), accent: true },
            { label: t('المسافة', 'Distance'), value: `${num(merged.totalKm)} km` },
            { label: t('متوسط مدة الرحلة', 'Avg trip'), value: `${num(merged.totalDriveSec / merged.tripCount / 3600, 1)} ${t('س', 'h')}` },
            { label: t('متوسط التحميل', 'Avg loading'), value: merged.stopCount ? `${num(merged.totalStopSec / merged.stopCount / 3600, 1)} ${t('س', 'h')}` : '—' },
            { label: t('أقصى سرعة', 'Max speed'), value: num(merged.maxSpeed) },
          ],
        });
        if (merged.maxSpeed > limit) {
          blocks.push({ kind: 'note', tone: 'warn', text: `${t('تجاوز حد السرعة المسموح', 'Exceeded the speed limit of')} ${limit} km/h — ${t('أقصى سرعة مسجّلة', 'max recorded')} ${num(merged.maxSpeed)} km/h.` });
        }
      }
    }
  } catch (e) {
    blocks.push({ kind: 'note', tone: 'warn', text: t('تعذّر جلب بيانات الرحلات من نظام التتبّع في هذه المحاولة.', 'Trip data could not be read from the tracking system on this attempt.') });
  }

  // Assignment history — which truck, from when to when.
  if (history.length) {
    const plateOf = new Map(vehicles.map((v) => [v.unitId, v.plate]));
    blocks.push({ kind: 'section', text: t('سجل التعيينات', 'Assignment history') });
    blocks.push({
      kind: 'table',
      head: [t('المركبة', 'Truck'), t('من', 'From'), t('إلى', 'To')],
      rows: history.map((h) => [h.plate || plateOf.get(h.unitId) || String(h.unitId), dt(h.from), h.to ? dt(h.to) : t('حتى الآن', 'Current')]),
    });
  }

  // Commercial side — the loads he actually carried.
  const shipments = await FleetShipment.find({
    $or: [{ loadDate: { $gte: from, $lte: to } }, { $and: [{ loadDate: null }, { createdAt: { $gte: from, $lte: to } }] }],
  }).select('waybillNumber driverName secondDriverName customerName fromCity toCity price driverExpense status loadDate createdAt vehiclePlate').lean();
  const mine = shipments.filter((s) => nameKey(s.driverName) === key || nameKey(s.secondDriverName) === key);
  const live = mine.filter((s) => s.status !== 'cancelled');
  const done = live.filter((s) => ['arrived', 'bond_sent', 'bond_received', 'invoiced'].includes(s.status)).length;
  const late = live.filter((s) => s.status === 'late').length;

  blocks.push({ kind: 'section', text: t('الحمولات المنفَّذة', 'Loads carried') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('عدد الحمولات', 'Loads'), value: num(mine.length), accent: true },
      { label: t('وصلت', 'Delivered'), value: num(done) },
      { label: t('متأخرة', 'Late'), value: num(late) },
      { label: t('الدخل المحقق', 'Income'), value: money(live.reduce((s, x) => s + (Number(x.price) || 0), 0)) },
      { label: t('مصروفاته', 'His expenses'), value: money(live.reduce((s, x) => s + (Number(x.driverExpense) || 0), 0)) },
    ],
  });
  blocks.push({
    kind: 'table',
    head: [t('البوليصة', 'Waybill'), t('التاريخ', 'Date'), t('العميل', 'Customer'), t('المسار', 'Route'), t('المركبة', 'Truck'), t('الإيجار', 'Price'), t('الحالة', 'Status')],
    align: ['start', 'start', 'start', 'start', 'start', 'end', 'center'],
    rows: mine
      .sort((a, b) => new Date(b.loadDate || b.createdAt) - new Date(a.loadDate || a.createdAt))
      .map((s) => [
        String(s.waybillNumber || '—'), dt(s.loadDate || s.createdAt), s.customerName || '—',
        `${s.fromCity || '—'} ← ${s.toCity || '—'}`, s.vehiclePlate || '—', money(s.price),
        { t: statusLabel(SHIPMENT_STATUS_AR, s.status, lang), color: s.status === 'late' ? '#dc2626' : undefined },
      ]),
    emptyText: t('لا توجد حمولات مسجّلة لهذا السائق في هذه الفترة.', 'No loads recorded for this driver in this period.'),
  });

  return {
    title: t('تقرير سائق', 'Driver Report'),
    subtitle: `${fd?.name || name} · ${fromKey} → ${toKey}`,
    meta: { driver: name },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) تقرير عميل — everything we did for them, across every section
// ─────────────────────────────────────────────────────────────────────────────
// Reuses the portal's identity resolution, so a customer report and what that
// customer sees when they log in are computed from exactly the same join.
async function customerOptions(q) {
  const { REGISTERS } = require('../config/partnerRegisters');
  const partners = require('../controllers/partnerController');
  // The partner picker already flattens every customer register in the company;
  // the report just borrows it instead of maintaining a second list.
  const fake = { user: { role: 'super_admin' }, query: { kind: 'customer', q: q || '', limit: 400 } };
  const rows = [];
  await new Promise((resolve) => {
    partners.listPartners(fake, {
      statusCode: 200,
      status() { return this; },
      json(b) { rows.push(...(b.items || [])); resolve(); },
    });
  });
  // Collapse the same company appearing in several registers into ONE option —
  // the report reads all of them anyway.
  const byKey = new Map();
  for (const r of rows) {
    const k = r.nameKey || nameKey(r.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, { id: k, name: r.name, detail: r.registerAr, registers: [r.registerAr] });
    else {
      const cur = byKey.get(k);
      if (!cur.registers.includes(r.registerAr)) { cur.registers.push(r.registerAr); cur.detail = cur.registers.join(' · '); }
    }
  }
  void REGISTERS;
  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

async function buildCustomerReport(id, query, lang) {
  const Customer = require('../models/Customer');
  const Invoice = require('../models/Invoice');
  const Payment = require('../models/Payment');
  const CustomsClearance = require('../models/CustomsClearance');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const CrmCompany = require('../models/CrmCompany');
  const CrmDeal = require('../models/CrmDeal');
  const CrmActivity = require('../models/CrmActivity');
  const { FleetCustomer, FleetShipment } = require('../models/FleetModels');
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);
  // The picker sends the folded key; a profile page sends the name it is already
  // displaying. Folding an already-folded key is a no-op, so both work.
  const key = nameKey(id) || String(id);

  // The registers are read whole only to fold their names; that list barely
  // moves, so it is cached for a minute rather than re-read per report.
  const cache = require('../utils/ttlCache');
  let registers = cache.get('reports:customer:registers');
  if (registers === undefined) {
    const [a, b, c] = await Promise.all([
      Customer.find({}).lean(),
      FleetCustomer.find({}).lean(),
      CrmCompany.find({}).lean(),
    ]);
    registers = { finance: a, fleetCust: b, crm: c };
    cache.set('reports:customer:registers', registers, 60 * 1000);
  }
  const { finance, fleetCust, crm } = registers;
  const fin = finance.filter((c) => nameKey(c.companyName) === key);
  const fc = fleetCust.filter((c) => nameKey(c.name) === key);
  const co = crm.filter((c) => nameKey(c.name) === key);

  // A great many customers have no row in ANY register — customs work in
  // particular is filed against a typed name. Those are real customers with real
  // history, so the report falls back to recovering their name from the work
  // itself rather than pretending they don't exist.
  let displayName = fin[0]?.companyName || fc[0]?.name || co[0]?.name;
  if (!displayName) {
    const [cRow, oRow, fRow] = await Promise.all([
      CustomsClearance.find({ customerName: { $nin: [null, ''] } }).select('customerName').limit(20000).lean(),
      ShipmentOrder.find({ customerName: { $nin: [null, ''] } }).select('customerName').limit(20000).lean(),
      FleetShipment.find({ customerName: { $nin: [null, ''] } }).select('customerName').limit(20000).lean(),
    ]);
    displayName = [...cRow, ...oRow, ...fRow].find((r) => nameKey(r.customerName) === key)?.customerName;
  }
  if (!displayName) return null;

  const finIds = fin.map((c) => c._id);
  const fcIds = fc.map((c) => c._id);

  const [invoices, payments, fleetAll, ordersAll, customsAll, deals, activities] = await Promise.all([
    finIds.length ? Invoice.find({ customer: { $in: finIds } }).sort({ invoiceDate: -1 }).lean() : [],
    finIds.length ? Payment.find({ customer: { $in: finIds } }).sort({ paymentDate: -1 }).lean() : [],
    // Bounded by the reporting window. The name half of the join can't be done
    // in Mongo (the Arabic fold is a JS function), so these still narrow in
    // memory — but over the period's rows, not the whole history.
    FleetShipment.find({
      $and: [
        { $or: [{ customer: { $in: fcIds } }, { customerName: { $nin: [null, ''] } }] },
        { $or: [{ loadDate: { $gte: from, $lte: to } }, { createdAt: { $gte: from, $lte: to } }] },
      ],
    }).select('waybillNumber customer customerName vehiclePlate driverName fromCity toCity price status loadDate createdAt').limit(3000).lean(),
    ShipmentOrder.find({ customerName: { $nin: [null, ''] }, createdAt: { $gte: from, $lte: to } })
      .select('waybillNumber customerName fromCity toCity sellPrice status driverName vehicleName createdAt').limit(3000).lean(),
    CustomsClearance.find({
      $and: [
        { $or: [{ customer: { $in: finIds } }, { customerName: { $nin: [null, ''] } }] },
        { createdAt: { $gte: from, $lte: to } },
      ],
    }).select('refNumber customer customerName blNumber declarationNumber port stage cancelled containerCount totalWeight invoiceValue currency costs createdAt').limit(3000).lean(),
    co.length ? CrmDeal.find({ company: { $in: co.map((c) => c._id) } }).lean() : [],
    co.length ? CrmActivity.find({ company: { $in: co.map((c) => c._id) } }).sort({ date: -1 }).limit(60).lean() : [],
  ]);

  const fcIdSet = new Set(fcIds.map(String));
  const finIdSet = new Set(finIds.map(String));
  const fleetMine = fleetAll.filter((s) => (s.customer && fcIdSet.has(String(s.customer))) || nameKey(s.customerName) === key);
  const ordersMine = ordersAll.filter((s) => nameKey(s.customerName) === key);
  const customsMine = customsAll.filter((c) => (c.customer && finIdSet.has(String(c.customer))) || nameKey(c.customerName) === key);

  const inWin = (v) => inRange(v, from, to);
  const fleetP = fleetMine.filter((s) => inWin(s.loadDate || s.createdAt) && s.status !== 'cancelled');
  const ordersP = ordersMine.filter((s) => inWin(s.createdAt) && s.status !== 'cancelled');
  const customsP = customsMine.filter((c) => inWin(c.createdAt) && !c.cancelled);
  const invoicesP = invoices.filter((i) => inWin(i.invoiceDate));
  const paymentsP = payments.filter((p) => inWin(p.paymentDate));

  const blocks = [];
  blocks.push({ kind: 'section', text: t('بيانات العميل', 'Customer details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('الاسم', 'Name'), displayName],
      [t('رقم العميل', 'Customer no.'), fin[0]?.customerNumber],
      [t('نوع العميل', 'Type'), fc[0] ? (fc[0].customerType === 'branch' ? t('عميل فروع', 'Branch customer') : t('نقل ثقيل', 'Heavy transport')) : null],
      [t('الهاتف', 'Phone'), fin[0]?.phone || fc[0]?.phone || co[0]?.phone],
      [t('البريد', 'Email'), fin[0]?.email || fc[0]?.email || co[0]?.email],
      [t('العنوان', 'Address'), fin[0]?.address || co[0]?.address],
      [t('مدة الائتمان', 'Credit term'), fin[0]?.creditTerm ? `${fin[0].creditTerm} ${t('يوم', 'days')}` : null],
      [t('حد الائتمان', 'Credit limit'), fin[0]?.creditLimit != null ? money(fin[0].creditLimit) : null],
      [t('الفئة', 'Grade'), fin[0]?.grade],
      [t('حالة العميل', 'Status'), fin[0]?.clientStatus || co[0]?.status],
      [t('السجلات المرتبطة', 'Registers'), [fin.length && t('المالية', 'Finance'), fc.length && t('النقل الثقيل', 'Heavy transport'), co.length && 'CRM'].filter(Boolean).join(' · ') || null],
    ],
  });

  // Headline numbers for the period.
  const spend = fleetP.reduce((s, x) => s + (Number(x.price) || 0), 0) + ordersP.reduce((s, x) => s + (Number(x.sellPrice) || 0), 0);
  const outstanding = invoices.reduce((s, i) => s + (Number(i.balance) || 0), 0);
  const overdue = invoices.filter((i) => i.status !== 'paid' && new Date(i.dueDate) < new Date());

  blocks.push({ kind: 'section', text: t('ملخص الفترة', 'Period summary') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('إجمالي الشحنات', 'Shipments'), value: num(fleetP.length + ordersP.length), accent: true },
      { label: t('معاملات التخليص', 'Customs files'), value: num(customsP.length) },
      { label: t('الحاويات', 'Containers'), value: num(customsP.reduce((s, c) => s + (Number(c.containerCount) || 0), 0)) },
      { label: t('قيمة الشحنات', 'Shipment value'), value: money(spend) },
      { label: t('المفوتر', 'Invoiced'), value: money(invoicesP.reduce((s, i) => s + (Number(i.amount) || 0), 0)) },
      { label: t('المحصّل', 'Collected'), value: money(paymentsP.reduce((s, p) => s + (Number(p.amount) || 0), 0)) },
    ],
  });
  if (outstanding > 0) {
    blocks.push({
      kind: 'note',
      tone: overdue.length ? 'danger' : 'warn',
      text: `${t('الرصيد المستحق', 'Outstanding balance')}: ${money(outstanding)}`
        + (overdue.length ? ` — ${t('منها متأخرة', 'of which overdue')}: ${money(overdue.reduce((s, i) => s + (Number(i.balance) || 0), 0))} (${overdue.length} ${t('فاتورة', 'invoices')})` : ''),
    });
  }

  // Heavy transport.
  if (fleetMine.length) {
    blocks.push({ kind: 'section', text: t('شحنات النقل الثقيل', 'Heavy transport shipments') });
    blocks.push({
      kind: 'table',
      head: [t('البوليصة', 'Waybill'), t('التاريخ', 'Date'), t('من', 'From'), t('إلى', 'To'), t('المركبة', 'Truck'), t('السائق', 'Driver'), t('القيمة', 'Value'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'start', 'start', 'start', 'end', 'center'],
      rows: fleetMine
        .filter((s) => inWin(s.loadDate || s.createdAt))
        .sort((a, b) => new Date(b.loadDate || b.createdAt) - new Date(a.loadDate || a.createdAt))
        .map((s) => [String(s.waybillNumber || '—'), dt(s.loadDate || s.createdAt), s.fromCity || '—', s.toCity || '—',
          s.vehiclePlate || '—', s.driverName || '—', money(s.price),
          { t: statusLabel(SHIPMENT_STATUS_AR, s.status, lang), color: s.status === 'late' ? '#dc2626' : undefined }]),
      emptyText: t('لا توجد شحنات نقل ثقيل في هذه الفترة.', 'No heavy-transport shipments in this period.'),
    });
  }

  // Shipment orders.
  if (ordersMine.length) {
    blocks.push({ kind: 'section', text: t('طلبات الشحنات', 'Shipment orders') });
    blocks.push({
      kind: 'table',
      head: [t('البوليصة', 'Waybill'), t('التاريخ', 'Date'), t('من', 'From'), t('إلى', 'To'), t('السائق', 'Driver'), t('القيمة', 'Value'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'start', 'start', 'end', 'center'],
      rows: ordersMine.filter((s) => inWin(s.createdAt))
        .map((s) => [String(s.waybillNumber || '—'), dt(s.createdAt), s.fromCity || '—', s.toCity || '—', s.driverName || '—', money(s.sellPrice), s.status]),
      emptyText: t('لا توجد طلبات شحن في هذه الفترة.', 'No shipment orders in this period.'),
    });
  }

  // Customs.
  if (customsMine.length) {
    blocks.push({ kind: 'section', text: t('معاملات التخليص الجمركي', 'Customs clearance files') });
    blocks.push({
      kind: 'table',
      head: [t('المرجع', 'Reference'), t('التاريخ', 'Date'), t('البوليصة', 'BL'), t('البيان', 'Declaration'), t('الميناء', 'Port'), t('الحاويات', 'Ctnrs'), t('المرحلة', 'Stage')],
      align: ['start', 'start', 'start', 'start', 'start', 'end', 'start'],
      rows: customsMine.filter((c) => inWin(c.createdAt))
        .map((c) => [c.refNumber || '—', dt(c.createdAt), c.blNumber || '—', c.declarationNumber || '—', c.port || '—', num(c.containerCount), c.stage || '—']),
      emptyText: t('لا توجد معاملات تخليص في هذه الفترة.', 'No customs files in this period.'),
    });
  }

  // Finance.
  if (invoices.length) {
    blocks.push({ kind: 'section', text: t('الفواتير', 'Invoices') });
    blocks.push({
      kind: 'table',
      head: [t('رقم الفاتورة', 'Invoice'), t('تاريخها', 'Date'), t('الاستحقاق', 'Due'), t('المبلغ', 'Amount'), t('المدفوع', 'Paid'), t('المتبقي', 'Balance'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'end', 'end', 'end', 'center'],
      rows: invoicesP.map((i) => {
        const late = i.status !== 'paid' && new Date(i.dueDate) < new Date();
        return [i.invoiceNumber, dt(i.invoiceDate), dt(i.dueDate), money(i.amount), money(i.paidAmount),
          { t: money(i.balance), color: late ? '#dc2626' : undefined },
          { t: late ? t('متأخرة', 'Overdue') : i.status, color: late ? '#dc2626' : undefined }];
      }),
      emptyText: t('لا توجد فواتير في هذه الفترة.', 'No invoices in this period.'),
    });
  }
  if (paymentsP.length) {
    blocks.push({ kind: 'section', text: t('المدفوعات', 'Payments') });
    blocks.push({
      kind: 'table',
      head: [t('التاريخ', 'Date'), t('المبلغ', 'Amount'), t('الطريقة', 'Method'), t('المرجع', 'Reference')],
      align: ['start', 'end', 'start', 'start'],
      rows: paymentsP.map((p) => [dt(p.paymentDate), money(p.amount), p.paymentMethod || '—', p.reference || '—']),
    });
  }

  // Relationship.
  if (deals.length || activities.length) {
    blocks.push({ kind: 'section', text: t('العلاقة التجارية', 'Commercial relationship') });
    if (deals.length) {
      blocks.push({
        kind: 'table',
        head: [t('الصفقة', 'Deal'), t('المرحلة', 'Stage'), t('القيمة', 'Value'), t('الحالة', 'Status')],
        align: ['start', 'start', 'end', 'center'],
        rows: deals.map((d) => [d.title, d.stage || '—', money(d.value), d.status]),
      });
    }
    if (activities.length) {
      blocks.push({
        kind: 'timeline',
        items: activities.slice(0, 25).map((a) => ({ title: a.subject, sub: a.type, at: dt(a.date) })),
      });
    }
  }

  return {
    title: t('تقرير عميل', 'Customer Report'),
    subtitle: `${displayName} · ${fromKey} → ${toKey}`,
    meta: { customer: displayName },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) تقرير مورد — the 3PL carrier's file
// ─────────────────────────────────────────────────────────────────────────────
async function vendorOptions(q) {
  const CrmVendor = require('../models/CrmVendor');
  const { ContractVendor } = require('../models/ContractModels');
  const [crm, contracts] = await Promise.all([
    CrmVendor.find(q ? { name: nameRegex(q) } : {}).select('name headOffice vendorType').lean(),
    ContractVendor.find(q ? { name: nameRegex(q) } : {}).select('name nameKey headquarters vendorType').lean(),
  ]);
  const byKey = new Map();
  for (const v of crm) {
    const k = nameKey(v.name);
    if (k) byKey.set(k, { id: k, name: v.name, detail: [v.vendorType, v.headOffice].filter(Boolean).join(' · ') });
  }
  for (const v of contracts) {
    const k = v.nameKey || nameKey(v.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, { id: k, name: v.name, detail: [v.vendorType, v.headquarters].filter(Boolean).join(' · ') });
  }
  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

async function buildVendorReport(id, query, lang) {
  const CrmVendor = require('../models/CrmVendor');
  const ShipmentOrder = require('../models/ShipmentOrder');
  const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
  const { ContractVendor, VendorUtilisation } = require('../models/ContractModels');
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);
  const key = nameKey(id) || String(id);

  const [crmAll, cvAll, utilisation, suppliers] = await Promise.all([
    CrmVendor.find({}).lean(),
    ContractVendor.find({}).lean(),
    VendorUtilisation.find({ nameKey: key }).sort({ year: 1, month: 1 }).lean(),
    ShipmentOrderSupplier.find({}).select('name').lean(),
  ]);
  const v = crmAll.find((x) => nameKey(x.name) === key) || null;
  const cv = cvAll.find((x) => (x.nameKey || nameKey(x.name)) === key) || null;
  const displayName = v?.name || cv?.name;
  if (!displayName) return null;

  const mySupplierIds = suppliers.filter((s) => nameKey(s.name) === key).map((s) => s._id);
  const orders = mySupplierIds.length
    ? await ShipmentOrder.find({ supplier: { $in: mySupplierIds }, createdAt: { $gte: from, $lte: to } })
      .select('waybillNumber customerName fromCity toCity buyPrice sellPrice status driverName vehicleName createdAt').lean()
    : [];

  const monthsInWindow = utilisation.filter((u) => {
    const at = new Date(Date.UTC(u.year, (u.month || 1) - 1, 1));
    return at >= from && at <= to && !u.isExternal;
  });
  const ledgerLoads = monthsInWindow.reduce((s, u) => s + (Number(u.orders) || 0), 0);
  const capacity = monthsInWindow.reduce((s, u) => s + (Number(u.expectedMonthlyCapacity) || 0), 0);

  const blocks = [];
  blocks.push({ kind: 'section', text: t('بيانات المورد', 'Vendor details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('الاسم', 'Name'), displayName],
      [t('ممثل المورد', 'Contact'), v?.representative || cv?.contactPerson],
      [t('الجوال', 'Mobile'), v?.mobile || cv?.phone],
      [t('البريد', 'Email'), v?.email],
      [t('مندوب تنشيط', 'Our rep'), v?.energizeRep || cv?.energizeRep],
      [t('نوع التعامل', 'Payment type'), v?.vendorType || cv?.vendorType],
      [t('المقر', 'Head office'), v?.headOffice || cv?.headquarters],
      [t('الوجهات', 'Destinations'), v?.destinations || cv?.destinations],
      [t('حجم الأسطول', 'Fleet size'), v?.carsCount ?? cv?.fleetSize],
      [t('السجل التجاري', 'CR number'), cv?.crNumber],
      [t('مدة السداد', 'Payment terms'), cv?.paymentTermDays ? `${cv.paymentTermDays} ${t('يوم', 'days')}` : null],
      [t('حالة المتابعة', 'Follow-up'), v?.followUpStatus],
    ],
  });

  // Contract state — the four things that must be true before we can lean on them.
  const checks = [
    [t('الأوراق مستلمة', 'Papers received'), v?.hasPapers === true || cv?.documentsReceived === true],
    [t('موقّع من المورد', 'Vendor signed'), v?.vendorSideSigned === true || cv?.vendorSideContract === true],
    [t('موقّع من طرفنا', 'We signed'), v?.ourSideSigned === true || cv?.ourSideContract === true],
    [t('تاريخ العقد مسجّل', 'Contract dated'), !!(v?.contractDate || cv?.contractDate)],
  ];
  blocks.push({ kind: 'section', text: t('حالة العقد', 'Contract status') });
  blocks.push({ kind: 'kv', items: checks.map(([k, ok]) => [k, ok ? t('نعم ✓', 'Yes ✓') : t('لا ✗', 'No ✗')]) });
  if (cv?.missingDocuments) {
    blocks.push({ kind: 'note', tone: 'warn', text: `${t('أوراق ناقصة', 'Missing documents')}: ${cv.missingDocuments}` });
  }

  // Volume — the real ledger.
  blocks.push({ kind: 'section', text: t('التشغيل في الفترة', 'Volume in the period') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('الحمولات (سجل التشغيل)', 'Loads (ledger)'), value: num(ledgerLoads), accent: true },
      { label: t('حمولات طلبات الشحن', 'Trial orders'), value: num(orders.filter((o) => o.status !== 'cancelled').length) },
      { label: t('الطاقة المتاحة', 'Capacity'), value: num(capacity) },
      { label: t('نسبة التشغيل', 'Utilisation'), value: capacity ? pct((ledgerLoads / capacity) * 100) : '—' },
      { label: t('أشهر التشغيل', 'Active months'), value: num(monthsInWindow.filter((u) => (Number(u.orders) || 0) > 0).length) },
    ],
  });
  if (monthsInWindow.length) {
    blocks.push({
      kind: 'bars',
      items: monthsInWindow.map((u) => ({
        label: `${u.year}-${String(u.month).padStart(2, '0')}`,
        value: Number(u.orders) || 0,
        text: num(u.orders),
      })),
    });
  } else {
    blocks.push({ kind: 'note', text: t('لا توجد بيانات تشغيل شهرية مسجّلة لهذا المورد في هذه الفترة.', 'No monthly volume recorded for this vendor in this period.') });
  }

  if (orders.length) {
    blocks.push({ kind: 'section', text: t('الحمولات المنفَّذة (طلبات الشحنات)', 'Loads carried (shipment orders)') });
    blocks.push({
      kind: 'table',
      head: [t('البوليصة', 'Waybill'), t('التاريخ', 'Date'), t('العميل', 'Customer'), t('المسار', 'Route'), t('التكلفة علينا', 'Our cost'), t('الحالة', 'Status')],
      align: ['start', 'start', 'start', 'start', 'end', 'center'],
      rows: orders.map((o) => [String(o.waybillNumber || '—'), dt(o.createdAt), o.customerName || '—',
        `${o.fromCity || '—'} ← ${o.toCity || '—'}`, money(o.buyPrice), o.status]),
    });
  }

  return {
    title: t('تقرير مورد', 'Vendor Report'),
    subtitle: `${displayName} · ${fromKey} → ${toKey}`,
    meta: { vendor: displayName },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) تقرير موظف — the HR file, printable
// ─────────────────────────────────────────────────────────────────────────────
async function employeeOptions(q) {
  const Employee = require('../models/Employee');
  const filter = q
    ? { $or: [{ firstName: nameRegex(q) }, { lastName: nameRegex(q) }, { arabicName: nameRegex(q) }, { employeeNumber: nameRegex(q) }, { iqamaNumber: nameRegex(q) }] }
    : {};
  const rows = await Employee.find(filter)
    .select('firstName lastName arabicName employeeNumber jobTitle department employmentStatus').limit(500).lean();
  return rows.map((e) => ({
    id: String(e._id),
    name: e.arabicName || `${e.firstName} ${e.lastName}`.trim(),
    detail: [e.jobTitle, e.department, e.employeeNumber].filter(Boolean).join(' · '),
    inactive: e.employmentStatus !== 'active',
  })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

async function buildEmployeeReport(id, query, lang) {
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const LeaveRequest = require('../models/LeaveRequest');
  const EmployeeDocument = require('../models/EmployeeDocument');
  const EmployeeRenewal = require('../models/EmployeeRenewal');
  const Asset = require('../models/Asset');
  const VehicleAuthorization = require('../models/VehicleAuthorization');
  const PerfEvaluation = require('../models/PerfEvaluation');
  const { computeBalance } = require('../utils/leaveBalance');
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);

  // `Branch` is referenced by populate() below; requiring it here means the
  // report never depends on some other module having loaded it first. Skipping
  // this is what made every employee report 404 with no explanation.
  require('../models/Branch');
  const e = await Employee.findById(id).populate('branch', 'name').lean();
  if (!e) return null;

  const [contracts, leaves, documents, renewals, assets, auths, evals] = await Promise.all([
    Contract.find({ employee: e._id }).sort({ createdAt: -1 }).lean(),
    LeaveRequest.find({ employee: e._id }).populate('leaveType', 'nameAr nameEn affectsBalance')
      .select('-employeeSignature -managerDecision.signature -hrDecision.signature').sort({ createdAt: -1 }).lean(),
    EmployeeDocument.find({ employee: e._id }).select('-fileData').sort({ createdAt: -1 }).lean().catch(() => []),
    EmployeeRenewal.find({ employee: e._id }).sort({ dueDate: 1 }).lean().catch(() => []),
    Asset.find({ employee: e._id }).lean().catch(() => []),
    VehicleAuthorization.find({ employee: e._id }).populate('vehicle', 'plateNumber plate make model').sort({ startDate: -1 }).lean().catch(() => []),
    PerfEvaluation.find({ employee: e._id }).sort({ createdAt: -1 }).limit(20).lean().catch(() => []),
  ]);

  const active = contracts.find((c) => c.status === 'active') || contracts[0] || null;
  const takenAll = leaves.filter((l) => l.status === 'approved')
    .reduce((s, l) => s + ((l.leaveType?.affectsBalance ?? true) ? (l.days || 0) : 0), 0);
  const balance = active ? computeBalance(active, takenAll) : null;
  const leavesP = leaves.filter((l) => inRange(l.createdAt, from, to));

  const blocks = [];
  blocks.push({ kind: 'section', text: t('البيانات الشخصية', 'Personal details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('الاسم', 'Name'), e.arabicName || `${e.firstName} ${e.lastName}`.trim()],
      [t('الاسم بالإنجليزية', 'Name (EN)'), `${e.firstName} ${e.lastName}`.trim()],
      [t('الرقم الوظيفي', 'Employee no.'), e.employeeNumber],
      [t('الجنسية', 'Nationality'), e.nationality],
      [t('تاريخ الميلاد', 'Date of birth'), e.dateOfBirth],
      [e.idType === 'national_id' ? t('رقم الهوية', 'National ID') : t('رقم الإقامة', 'Iqama no.'), e.iqamaNumber || e.nationalId],
      [t('انتهاء الإقامة', 'Iqama expiry'), e.iqamaExpiry],
      [t('رقم الجواز', 'Passport'), e.passportNumber],
      [t('انتهاء الجواز', 'Passport expiry'), e.passportExpiry],
      [t('الجوال', 'Phone'), e.phone],
      [t('البريد', 'Email'), e.email],
    ],
  });

  blocks.push({ kind: 'section', text: t('البيانات الوظيفية', 'Employment details') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('المسمى الوظيفي', 'Job title'), e.jobTitle],
      [t('القسم', 'Department'), e.department],
      [t('الفرع', 'Branch'), e.branch?.name],
      [t('مقر العمل', 'Work location'), e.workLocation],
      [t('تاريخ التعيين', 'Hire date'), e.hireDate],
      [t('تاريخ مباشرة العمل', 'Actual start'), e.actualWorkStartDate],
      [t('حالة التوظيف', 'Status'), statusLabel(EMPLOYMENT_STATUS_AR, e.employmentStatus, lang)],
      [t('رقم عقد قوى', 'Qiwa contract'), e.qiwaContractNumber],
      [t('رقم التأمينات', 'GOSI number'), e.gosiNumber],
      [t('الكفيل', 'Sponsor'), e.sponsorName],
    ],
  });

  if (active) {
    blocks.push({ kind: 'section', text: t('العقد الحالي', 'Current contract') });
    blocks.push({
      kind: 'kv',
      items: [
        [t('نوع العقد', 'Type'), active.type],
        [t('من', 'From'), active.startDate],
        [t('إلى', 'To'), active.endDate || t('غير محدد', 'Open-ended')],
        [t('المدة', 'Duration'), active.durationMonths ? `${active.durationMonths} ${t('شهر', 'months')}` : null],
        [t('الراتب الأساسي', 'Basic salary'), active.basicSalary != null ? money(active.basicSalary) : null],
        [t('البدلات', 'Allowances'), active.allowances != null ? money(active.allowances) : null],
        [t('رصيد الإجازة السنوية', 'Annual leave'), active.annualLeaveDays ? `${active.annualLeaveDays} ${t('يوم', 'days')}` : null],
        [t('حالة العقد', 'Contract status'), active.status],
      ],
    });
  }

  if (balance) {
    blocks.push({ kind: 'section', text: t('رصيد الإجازات', 'Leave balance') });
    blocks.push({
      kind: 'stats',
      items: [
        { label: t('الاستحقاق السنوي', 'Entitlement'), value: `${num(balance.entitlement)} ${t('يوم', 'd')}` },
        { label: t('المتراكم', 'Accrued'), value: `${num(balance.accrued, 1)} ${t('يوم', 'd')}` },
        { label: t('المستخدَم', 'Taken'), value: `${num(balance.taken, 1)} ${t('يوم', 'd')}` },
        { label: t('المتاح', 'Available'), value: `${num(balance.available, 1)} ${t('يوم', 'd')}`, accent: true },
      ],
    });
  }

  blocks.push({ kind: 'section', text: t('الإجازات في الفترة', 'Leave in the period') });
  blocks.push({
    kind: 'table',
    head: [t('النوع', 'Type'), t('من', 'From'), t('إلى', 'To'), t('الأيام', 'Days'), t('الحالة', 'Status'), t('قُدّم قبل', 'Notice')],
    align: ['start', 'start', 'start', 'end', 'center', 'end'],
    rows: leavesP.map((l) => [
      lang === 'en' ? (l.leaveType?.nameEn || l.leaveTypeCode) : (l.leaveType?.nameAr || l.leaveTypeCode),
      l.startDate, l.endDate, num(l.days),
      { t: l.status, color: l.status === 'rejected' ? '#dc2626' : l.status === 'approved' ? '#16a34a' : undefined },
      // The advance-notice policy snapshot, when the request carries one.
      l.advanceNotice?.requiredDays
        ? { t: `${l.advanceNotice.daysAhead}/${l.advanceNotice.requiredDays} ${t('يوم', 'd')}`, color: l.advanceNotice.overridden ? '#d97706' : undefined }
        : '—',
    ]),
    emptyText: t('لا توجد طلبات إجازة في هذه الفترة.', 'No leave requests in this period.'),
  });

  if (assets.length) {
    blocks.push({ kind: 'section', text: t('العهدة', 'Custody') });
    blocks.push({
      kind: 'table',
      head: [t('الصنف', 'Item'), t('النوع', 'Type'), t('الرقم التسلسلي', 'Serial'), t('الحالة', 'Condition'), t('القيمة', 'Value'), t('تاريخ التسليم', 'Assigned')],
      align: ['start', 'start', 'start', 'start', 'end', 'start'],
      rows: assets.map((a) => [a.name, a.type || '—', a.serialNumber || '—', a.condition || '—', money(a.value), dt(a.assignedAt || a.createdAt)]),
    });
  }

  if (auths.length) {
    blocks.push({ kind: 'section', text: t('تفاويض المركبات', 'Vehicle authorizations') });
    blocks.push({
      kind: 'table',
      head: [t('المركبة', 'Vehicle'), t('النوع', 'Type'), t('من', 'From'), t('إلى', 'To'), t('الحالة', 'Status')],
      rows: auths.map((a) => [
        a.vehicle?.plateNumber || a.vehicle?.plate || '—', a.authorizationType || '—',
        a.startDate, a.endDate || t('سارٍ', 'Active'), a.status,
      ]),
    });
  }

  if (renewals.length) {
    blocks.push({ kind: 'section', text: t('التجديدات', 'Renewals') });
    blocks.push({
      kind: 'table',
      head: [t('البند', 'Item'), t('تاريخ الاستحقاق', 'Due date'), t('الحالة', 'Status')],
      rows: renewals.map((r) => {
        const overdue = r.dueDate && new Date(r.dueDate) < new Date() && r.status !== 'done';
        return [r.type || r.title || '—', r.dueDate || '—', { t: r.status || '—', color: overdue ? '#dc2626' : undefined }];
      }),
    });
  }

  if (documents.length) {
    blocks.push({ kind: 'section', text: t('المستندات المرفقة', 'Documents on file') });
    blocks.push({
      kind: 'table',
      head: [t('المستند', 'Document'), t('النوع', 'Type'), t('تاريخ الرفع', 'Uploaded')],
      rows: documents.map((d) => [d.title || d.fileName || '—', d.type || '—', dt(d.createdAt)]),
    });
  }

  if (evals.length) {
    blocks.push({ kind: 'section', text: t('تقييمات الأداء', 'Performance evaluations') });
    blocks.push({
      kind: 'table',
      head: [t('الفترة', 'Period'), t('المقيِّم', 'Evaluator'), t('النتيجة', 'Score'), t('النسبة', 'Percentage'), t('التصنيف', 'Band')],
      align: ['start', 'start', 'end', 'end', 'center'],
      rows: evals.map((v) => [v.periodLabel || `${v.periodType || ''} ${v.periodYear || ''}`.trim() || '—',
        v.evaluatorName || '—', num(v.weightedScore, 1), pct(v.percentage), v.band || '—']),
    });
  }

  return {
    title: t('تقرير موظف', 'Employee Report'),
    subtitle: `${e.arabicName || `${e.firstName} ${e.lastName}`} · ${fromKey} → ${toKey}`,
    meta: { employee: String(e._id) },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) تقرير قسم — a whole department in one sheet
// ─────────────────────────────────────────────────────────────────────────────
// Every section already owns a dashboard endpoint; rather than reimplement each
// one, the department report calls that section's own controller in-process and
// renders whatever it returned. That means a section report can never disagree
// with the section's own screen, and a new section becomes reportable by adding
// one row here.
const SECTION_REPORTS = [
  {
    key: 'fleet', ar: 'إدارة الأسطول', en: 'Fleet Management',
    controller: () => require('../controllers/fleetController'), handler: 'getDashboard',
    extra: async (query, lang, t) => {
      const { FleetShipment, FleetVehicle, FleetDriver } = require('../models/FleetModels');
      const { from, to } = resolvePeriod(query);
      const [ships, vehicles, drivers] = await Promise.all([
        FleetShipment.find({ $or: [{ loadDate: { $gte: from, $lte: to } }, { $and: [{ loadDate: null }, { createdAt: { $gte: from, $lte: to } }] }] })
          .select('price driverExpense status customerName vehiclePlate driverName').lean(),
        FleetVehicle.countDocuments({ isActive: { $ne: false } }),
        FleetDriver.countDocuments({ isActive: { $ne: false } }),
      ]);
      const live = ships.filter((s) => s.status !== 'cancelled');
      const income = live.reduce((s, x) => s + (Number(x.price) || 0), 0);
      const byCustomer = new Map();
      for (const s of live) {
        const k = s.customerName || '—';
        byCustomer.set(k, (byCustomer.get(k) || 0) + (Number(s.price) || 0));
      }
      const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      return [
        { kind: 'stats', items: [
          { label: t('الحمولات', 'Loads'), value: num(live.length), accent: true },
          { label: t('الدخل', 'Income'), value: money(income) },
          { label: t('المركبات', 'Vehicles'), value: num(vehicles) },
          { label: t('السائقون', 'Drivers'), value: num(drivers) },
          { label: t('متأخرة', 'Late'), value: num(live.filter((s) => s.status === 'late').length) },
        ] },
        top.length && { kind: 'section', text: t('أعلى العملاء دخلًا', 'Top customers by income') },
        top.length && { kind: 'bars', items: top.map(([n, val]) => ({ label: n, value: val, text: money(val) })) },
      ].filter(Boolean);
    },
  },
  {
    key: 'ls2', ar: 'لوكيشن سوليوشن', en: 'Location Solutions',
    controller: () => require('../controllers/ls2Controller'), handler: 'getDashboard',
  },
  {
    key: 'crm', ar: 'إدارة العلاقات', en: 'CRM',
    controller: () => require('../controllers/crmController'), handler: 'getDashboard',
  },
  {
    key: 'hr', ar: 'الموارد البشرية', en: 'HR',
    controller: () => require('../controllers/hrController'), handler: 'getDashboard',
  },
  {
    key: 'customs', ar: 'التخليص الجمركي', en: 'Customs Clearance',
    controller: () => require('../controllers/customsClearanceController'), handler: 'getAnalytics',
    extra: async (query, lang, t) => {
      const CustomsClearance = require('../models/CustomsClearance');
      const { from, to } = resolvePeriod(query);
      const rows = await CustomsClearance.find({ createdAt: { $gte: from, $lte: to }, cancelled: { $ne: true } })
        .select('stage containerCount customerName branch').lean();
      const byStage = new Map();
      for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) || 0) + 1);
      return [
        { kind: 'stats', items: [
          { label: t('المعاملات', 'Files'), value: num(rows.length), accent: true },
          { label: t('الحاويات', 'Containers'), value: num(rows.reduce((s, r) => s + (Number(r.containerCount) || 0), 0)) },
          { label: t('جدة', 'Jeddah'), value: num(rows.filter((r) => r.branch === 'jeddah').length) },
          { label: t('الدمام', 'Dammam'), value: num(rows.filter((r) => r.branch === 'dammam').length) },
        ] },
        byStage.size && { kind: 'section', text: t('التوزيع على المراحل', 'By stage') },
        byStage.size && { kind: 'bars', items: [...byStage.entries()].map(([k, v]) => ({ label: k, value: v, text: String(v) })) },
      ].filter(Boolean);
    },
  },
  {
    key: 'accounting', ar: 'المحاسبة', en: 'Accounting',
    controller: () => require('../controllers/accountingController'), handler: 'getDashboard',
  },
  {
    key: 'sales', ar: 'المبيعات', en: 'Sales',
    controller: () => require('../controllers/salesController'), handler: 'getDashboard',
  },
  {
    key: 'procurement', ar: 'المشتريات', en: 'Procurement',
    controller: () => require('../controllers/procurementController'), handler: 'getDashboard',
  },
  {
    key: 'workshop', ar: 'الورشة', en: 'Workshop',
    controller: () => require('../controllers/workshopController'), handler: 'getWorkshopDashboard',
  },
  {
    key: 'marketing', ar: 'التسويق', en: 'Marketing',
    controller: () => require('../controllers/marketingController'), handler: 'getDashboard',
  },
  {
    key: 'it', ar: 'تقنية المعلومات', en: 'IT',
    controller: () => require('../controllers/itController'), handler: 'getDashboard',
  },
  {
    key: 'contracts', ar: 'إدارة العقود', en: 'Contracts',
    controller: () => require('../controllers/contractsController'), handler: 'getDashboard',
  },
];

const sectionOptions = async () => SECTION_REPORTS.map((s) => ({ id: s.key, name: s.ar, nameEn: s.en, detail: s.en }));

/** Call a section's own dashboard controller in-process and capture its JSON. */
function callController(mod, handler, req) {
  return new Promise((resolve) => {
    if (!mod || typeof mod[handler] !== 'function') return resolve(null);
    let done = false;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { if (!done) { done = true; resolve(this.statusCode === 200 ? body : null); } return this; },
      setHeader() { return this; },
      send() { if (!done) { done = true; resolve(null); } return this; },
    };
    Promise.resolve(mod[handler](req, res)).catch(() => { if (!done) { done = true; resolve(null); } });
    // A dashboard that never answers must not hang a report.
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 25000);
  });
}

/**
 * Flatten whatever a dashboard returned into readable stat blocks. Dashboards
 * have no common schema — each section shaped its own — so this walks the object
 * and prints every number it finds, grouped by its parent key. Crude on purpose:
 * it means a section becomes reportable without anyone rewriting its dashboard.
 */
function statsFromDashboard(obj, t, depth = 0, prefix = '', budget = { left: 90 }) {
  const blocks = [];
  // A dashboard is someone else's shape — cap how much of it can land in a
  // report so an unusually deep one can't produce a hundred-page document.
  if (!obj || typeof obj !== 'object' || depth > 2 || budget.left <= 0) return blocks;
  const scalars = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') scalars.push({ label: prettyKey(k), value: Number.isInteger(v) ? num(v) : num(v, 2) });
    else if (typeof v === 'boolean') scalars.push({ label: prettyKey(k), value: v ? t('نعم', 'Yes') : t('لا', 'No') });
  }
  if (scalars.length) {
    const take = scalars.slice(0, budget.left);
    budget.left -= take.length;
    if (prefix) blocks.push({ kind: 'section', text: prefix });
    // Six tiles a row reads well on A4; more than that and the labels squeeze.
    for (let i = 0; i < take.length; i += 6) blocks.push({ kind: 'stats', items: take.slice(i, i + 6) });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (budget.left <= 0) break;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      blocks.push(...statsFromDashboard(v, t, depth + 1, prettyKey(k), budget));
    }
  }
  return blocks;
}

const prettyKey = (k) => String(k)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/^./, (c) => c.toUpperCase());

async function buildSectionReport(id, query, lang, user) {
  const spec = SECTION_REPORTS.find((s) => s.key === id);
  if (!spec) return null;
  const { from, to, fromKey, toKey } = resolvePeriod(query);
  const t = (ar, en) => T(ar, en, lang);
  const blocks = [];

  // The section's own dashboard, rendered as numbers.
  const req = {
    user,
    query: { ...query, from: fromKey, to: toKey },
    params: {}, body: {}, ip: '127.0.0.1',
  };
  const dash = await callController(spec.controller(), spec.handler, req);
  if (dash) {
    blocks.push({ kind: 'section', text: t('مؤشرات القسم', 'Section indicators') });
    const statBlocks = statsFromDashboard(dash, t);
    if (statBlocks.length) blocks.push(...statBlocks);
    else blocks.push({ kind: 'note', text: t('لوحة القسم لم تُرجع أرقامًا قابلة للعرض.', 'The section dashboard returned no displayable figures.') });
  } else {
    blocks.push({ kind: 'note', tone: 'warn', text: t('تعذّر قراءة لوحة هذا القسم في هذه المحاولة.', 'This section dashboard could not be read on this attempt.') });
  }

  // Section-specific extras, when the section has something worth adding.
  if (spec.extra) {
    try {
      const extra = await spec.extra(query, lang, t);
      if (extra?.length) {
        blocks.push({ kind: 'section', text: t('تفاصيل الفترة', 'Period detail') });
        blocks.push(...extra);
      }
    } catch (e) { /* an extra that fails must not void the report */ }
  }

  // Work and complaints raised inside the section — the same board the team uses.
  try {
    const SectionTask = require('../models/SectionTask');
    const SectionComplaint = require('../models/SectionComplaint');
    const [tasks, complaints] = await Promise.all([
      SectionTask.find({ section: id, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).limit(150).lean(),
      SectionComplaint.find({ section: id, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).limit(150).lean(),
    ]);
    if (tasks.length) {
      blocks.push({ kind: 'section', text: t('مهام القسم', 'Section tasks') });
      blocks.push({
        kind: 'stats',
        items: [
          { label: t('إجمالي المهام', 'Total'), value: num(tasks.length), accent: true },
          { label: t('مكتملة', 'Done'), value: num(tasks.filter((x) => x.status === 'done').length) },
          { label: t('جارية', 'In progress'), value: num(tasks.filter((x) => x.status === 'in_progress').length) },
          { label: t('لم تبدأ', 'To do'), value: num(tasks.filter((x) => x.status === 'todo').length) },
        ],
      });
      blocks.push({
        kind: 'table',
        head: [t('المهمة', 'Task'), t('المكلَّف', 'Assignee'), t('الأولوية', 'Priority'), t('الحالة', 'Status'), t('التاريخ', 'Date')],
        rows: tasks.slice(0, 60).map((x) => [x.title, x.assigneeName || '—', x.priority || '—', x.status, dt(x.createdAt)]),
      });
    }
    if (complaints.length) {
      blocks.push({ kind: 'section', text: t('الشكاوى', 'Complaints') });
      blocks.push({
        kind: 'table',
        head: [t('الشكوى', 'Complaint'), t('من', 'From'), t('الحالة', 'Status'), t('التاريخ', 'Date')],
        rows: complaints.slice(0, 60).map((x) => [x.title || x.subject || '—', x.createdByName || '—', x.status, dt(x.createdAt)]),
      });
    }
  } catch (e) { /* the section-work board is optional */ }

  return {
    title: t('تقرير قسم', 'Department Report'),
    subtitle: `${T(spec.ar, spec.en, lang)} · ${fromKey} → ${toKey}`,
    meta: { section: id },
    blocks,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 7) محضر اجتماع مراجعة الأعمال — the official record, printable and signable
// ─────────────────────────────────────────────────────────────────────────────
// This one is USER-SCOPED: you can only print a meeting you were entitled to
// read. The rule is the section's own (config/businessReview.js), not a second
// copy — the board and the secretariat get every round, a department head gets
// the rounds they sat in, and an employee gets none.
function brVisibleFilter(user) {
  const { canRunMeetings } = require('../config/businessReview');
  return canRunMeetings(user) ? {} : { 'attendees.user': user._id };
}

async function meetingOptions(q, user) {
  const { isParticipant } = require('../config/businessReview');
  if (!user || !isParticipant(user)) return []; // an employee has no meetings
  const { BrMeeting } = require('../models/BusinessReview');
  const filter = { ...brVisibleFilter(user) };
  if (q) {
    const rx = nameRegex(q);
    filter.$or = [{ title: rx }, { refNumber: rx }, { location: rx }];
  }
  const rows = await BrMeeting.find(filter)
    .select('refNumber title cadence scheduledAt status location attendees')
    .sort({ scheduledAt: -1 }).limit(400).lean();
  return rows.map((m) => ({
    id: String(m._id),
    name: `${m.refNumber} — ${m.title}`,
    detail: [new Date(m.scheduledAt).toLocaleDateString('en-GB'), m.location, `${(m.attendees || []).length} حاضر`]
      .filter(Boolean).join(' · '),
  }));
}

async function buildMeetingReport(id, query, lang, user) {
  const { BrMeeting, BrAction, BrAssignment } = require('../models/BusinessReview');
  const brCfg = require('../config/businessReview');
  const t = (ar, en) => T(ar, en, lang);

  const meeting = await BrMeeting.findById(id).lean().catch(() => null);
  if (!meeting) return null;

  // The same gate the section itself applies — printing must never be a way
  // around it.
  const attended = (meeting.attendees || []).some((a) => String(a.user) === String(user._id));
  if (!brCfg.canRunMeetings(user) && !attended) {
    const err = new Error(T('لا تملك صلاحية طباعة هذا الاجتماع', 'You may not print this meeting', lang));
    err.status = 403;
    throw err;
  }

  const actions = await BrAction.find({ meeting: meeting._id }).sort({ createdAt: 1 }).lean();
  const delegations = actions.length
    ? await BrAssignment.find({ action: { $in: actions.map((a) => a._id) } }).sort({ createdAt: 1 }).lean()
    : [];
  const byAction = new Map();
  for (const d of delegations) {
    const k = String(d.action);
    if (!byAction.has(k)) byAction.set(k, []);
    byAction.get(k).push(d);
  }

  const label = (list, key) => {
    const v = (list || []).find((x) => x.key === key);
    return v ? T(v.ar, v.en, lang) : (key || '—');
  };
  // Department keys are English section identifiers and role keys are snake_case
  // — neither belongs in a document a person reads.
  const { sectionLabel } = require('../config/sections');
  const { roleLabel } = require('../config/constants');
  const dept = (k) => (k ? sectionLabel(k, lang) : '');
  const ATT = {
    attended: t('حضر', 'Present'), absent: t('لم يحضر', 'Absent'),
    excused: t('اعتذر', 'Excused'), invited: t('مدعو', 'Invited'),
  };

  const blocks = [];

  // ── ① The meeting, at a glance ────────────────────────────────────────────
  blocks.push({
    kind: 'callout',
    title: t('بيانات الاجتماع', 'Meeting details'),
    lines: [
      [t('الرقم المرجعي', 'Reference'), meeting.refNumber],
      [t('الدورة', 'Cadence'), label(brCfg.CADENCES, meeting.cadence)],
      [t('الحالة', 'Status'), label(brCfg.MEETING_STATUSES, meeting.status)],
      [t('الموعد المجدول', 'Scheduled for'), dtm(meeting.scheduledAt)],
      [t('انعقد فعليًا', 'Actually held'), meeting.heldAt ? dtm(meeting.heldAt) : t('لم ينعقد بعد', 'Not yet held')],
      [t('المدة', 'Duration'), meeting.durationMinutes ? `${meeting.durationMinutes} ${t('دقيقة', 'min')}` : '—'],
      [t('المكان', 'Location'), meeting.location || '—'],
      [t('كاتب المحضر', 'Minuted by'), meeting.scribeName || '—'],
      [t('الأقسام المشمولة', 'Departments'), (meeting.departments || []).map(dept).join(' · ') || '—'],
    ],
  });

  if (meeting.summary) {
    blocks.push({ kind: 'section', text: t('الخلاصة', 'Summary') });
    blocks.push({ kind: 'note', text: meeting.summary });
  }

  // ── ② Attendance, with the when and the why ───────────────────────────────
  const att = meeting.attendees || [];
  const present = att.filter((a) => a.attendance === 'attended').length;
  blocks.push({ kind: 'section', text: t('سجل الحضور', 'Attendance') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('المدعوون', 'Invited'), value: num(att.length) },
      { label: t('حضروا', 'Present'), value: num(present), accent: true },
      { label: t('اعتذروا', 'Excused'), value: num(att.filter((a) => a.attendance === 'excused').length) },
      { label: t('لم يحضروا', 'Absent'), value: num(att.filter((a) => a.attendance === 'absent').length) },
    ],
  });
  blocks.push({
    kind: 'table',
    // WHEN the mark was made and WHO made it are two different facts and get two
    // columns — squeezed into one they wrap mid-cell and leave a dangling dash.
    head: [t('الاسم', 'Name'), t('القسم / الصفة', 'Department / role'), t('الحضور', 'Attendance'),
      t('وقت التسجيل', 'Recorded at'), t('سجّله', 'Recorded by'), t('سبب الاعتذار', 'Reason')],
    align: ['start', 'start', 'center', 'start', 'start', 'start'],
    widths: ['20%', '17%', '11%', '17%', '15%', '20%'],
    rows: att.map((a) => [
      a.isChair ? `${a.name} ★` : a.name,
      dept(a.department) || roleLabel(a.role, lang) || '—',
      {
        t: ATT[a.attendance] || ATT.invited,
        color: a.attendance === 'attended' ? '#16a34a'
          : a.attendance === 'absent' ? '#dc2626'
            : a.attendance === 'excused' ? '#d97706' : undefined,
      },
      a.attendanceAt ? dtm(a.attendanceAt) : '—',
      a.attendanceByName || '—',
      a.excuseReason || '—',
    ]),
    emptyText: t('لم تتم دعوة أحد.', 'Nobody was invited.'),
  });
  if (att.some((a) => a.isChair)) {
    blocks.push({ kind: 'note', text: t('★ رئيس الاجتماع', '★ Chair of the meeting') });
  }

  // ── ③ Agenda ──────────────────────────────────────────────────────────────
  if (meeting.agenda?.length) {
    blocks.push({ kind: 'section', text: t('جدول الأعمال', 'Agenda') });
    blocks.push({
      kind: 'table',
      head: ['#', t('البند', 'Item'), t('مقدّم البند', 'Presenter'), t('القسم', 'Department')],
      align: ['center', 'start', 'start', 'start'],
      widths: ['7%', '55%', '20%', '18%'],
      rows: meeting.agenda.map((a, i) => [String(i + 1), a.title || '—', a.presenterName || '—', dept(a.department) || '—']),
    });
  }

  // ── ④ The minutes themselves ──────────────────────────────────────────────
  blocks.push({ kind: 'section', text: t('محضر الاجتماع', 'Minutes') });
  if (meeting.minutes?.length) {
    for (const m of meeting.minutes) {
      blocks.push({
        kind: 'kv',
        items: [
          [t('الموضوع', 'Topic'), m.heading || '—'],
          ...(m.department ? [[t('القسم', 'Department'), dept(m.department)]] : []),
          [t('ما تمت مناقشته', 'Discussion'), m.body || '—'],
        ],
      });
    }
  } else {
    blocks.push({ kind: 'note', tone: 'warn', text: t('لم يُكتب المحضر بعد.', 'The minutes have not been written yet.') });
  }

  // ── ⑤ Actions — the commitments, and what happened to them ────────────────
  const OPEN = brCfg.OPEN_ACTION_STATUSES;
  const open = actions.filter((a) => OPEN.includes(a.status));
  const done = actions.filter((a) => a.status === 'done');
  const late = actions.filter((a) => a.isOverdue && OPEN.includes(a.status));

  blocks.push({ kind: 'section', text: t('البنود التنفيذية', 'Action items') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('إجمالي البنود', 'Total'), value: num(actions.length), accent: true },
      { label: t('مفتوحة', 'Open'), value: num(open.length) },
      { label: t('متأخرة', 'Overdue'), value: num(late.length) },
      { label: t('منجزة', 'Completed'), value: num(done.length) },
      { label: t('نسبة الإنجاز', 'Completion'), value: actions.length ? pct((done.length / actions.length) * 100) : '—' },
      { label: t('تكليفات فرعية', 'Delegated'), value: num(delegations.length) },
    ],
  });

  if (actions.length) {
    blocks.push({
      kind: 'table',
      head: [t('البند', 'Action'), t('المكلَّف', 'Owner'), t('بطلب من', 'Requested by'),
        t('التسليم', 'Due'), t('الحالة', 'Status'), t('الإنجاز', 'Progress')],
      align: ['start', 'start', 'start', 'start', 'center', 'end'],
      widths: ['32%', '16%', '15%', '13%', '14%', '10%'],
      rows: actions.map((a) => {
        const isLate = a.isOverdue && OPEN.includes(a.status);
        return [
          a.title,
          a.assigneeName || '—',
          a.raisedByName || '—',
          { t: a.dueDate ? dt(a.dueDate) : '—', color: isLate ? '#dc2626' : undefined },
          {
            t: label(brCfg.ACTION_STATUSES, a.status) + (isLate ? ` (${t('متأخر', 'late')})` : ''),
            color: a.status === 'done' ? '#16a34a' : isLate ? '#dc2626' : undefined,
          },
          `${a.progress || 0}%`,
        ];
      }),
    });

    // Each action in full: its description, its delegations, its history.
    for (const a of actions) {
      const mine = byAction.get(String(a._id)) || [];
      const hasDetail = a.description || mine.length || (a.updates || []).length;
      if (!hasDetail) continue;
      blocks.push({ kind: 'section', text: `${t('تفاصيل البند', 'Action detail')}: ${a.title}` });
      blocks.push({
        kind: 'kv',
        items: [
          [t('المكلَّف', 'Owner'), a.assigneeName],
          [t('بطلب من', 'Requested by'), a.raisedByName || '—'],
          [t('الأولوية', 'Priority'), label(brCfg.PRIORITIES, a.priority)],
          [t('موعد التسليم', 'Due date'), a.dueDate ? dt(a.dueDate) : '—'],
          [t('الحالة', 'Status'), label(brCfg.ACTION_STATUSES, a.status)],
          [t('تاريخ الإنجاز', 'Completed on'), a.completedAt ? dt(a.completedAt) : '—'],
          ...(a.description ? [[t('الوصف', 'Description'), a.description]] : []),
        ],
      });

      if (mine.length) {
        blocks.push({
          kind: 'table',
          head: [t('المكلَّف فرعيًا', 'Delegated to'), t('المطلوب منه', 'Their task'),
            t('التسليم', 'Due'), t('الحالة', 'Status'), t('الإنجاز', 'Progress')],
          align: ['start', 'start', 'start', 'center', 'end'],
          widths: ['18%', '42%', '13%', '17%', '10%'],
          rows: mine.map((d) => {
            const isLate = d.isOverdue && OPEN.includes(d.status);
            return [
              d.assigneeName,
              d.title,
              { t: d.dueDate ? dt(d.dueDate) : '—', color: isLate ? '#dc2626' : undefined },
              { t: label(brCfg.ACTION_STATUSES, d.status), color: d.status === 'done' ? '#16a34a' : isLate ? '#dc2626' : undefined },
              `${d.progress || 0}%`,
            ];
          }),
        });
      }

      if ((a.updates || []).length) {
        blocks.push({
          kind: 'timeline',
          label: `${t('سجل المتابعة', 'Progress log')} — ${a.title}`,
          items: a.updates.slice(-12).map((u) => ({
            title: u.statusTo
              ? `${u.byName}: ${label(brCfg.ACTION_STATUSES, u.statusFrom)} → ${label(brCfg.ACTION_STATUSES, u.statusTo)}`
              : (u.byName || ''),
            sub: u.text || (u.progress != null ? `${u.progress}%` : ''),
            at: dtm(u.at),
          })),
        });
      }
    }
  } else {
    blocks.push({ kind: 'note', text: t('لم تُسجَّل بنود تنفيذية لهذا الاجتماع.', 'No action items were recorded for this meeting.') });
  }

  // ── ⑥ Signatures ──────────────────────────────────────────────────────────
  const chair = att.find((a) => a.isChair);
  blocks.push({ kind: 'section', text: t('التوقيعات', 'Signatures') });
  blocks.push({
    kind: 'signatures',
    items: [
      { name: chair?.name || '', title: t('رئيس الاجتماع', 'Chair') },
      { name: meeting.scribeName || '', title: t('كاتب المحضر', 'Minuted by') },
      { name: '', title: t('اعتماد الإدارة', 'Management approval') },
    ],
  });

  return {
    title: t('محضر اجتماع مراجعة أعمال', 'Business Review Meeting Minutes'),
    subtitle: `${meeting.refNumber} · ${meeting.title} · ${dt(meeting.scheduledAt)}`,
    meta: { meeting: String(meeting._id) },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The registry every consumer reads
// ─────────────────────────────────────────────────────────────────────────────
const SUBJECTS = [
  { key: 'vehicle', ar: 'مركبة', en: 'Vehicle', icon: 'truck', options: vehicleOptions, build: buildVehicleReport, searchable: true },
  { key: 'driver', ar: 'سائق', en: 'Driver', icon: 'user', options: driverOptions, build: buildDriverReport, searchable: true },
  { key: 'customer', ar: 'عميل', en: 'Customer', icon: 'building', options: customerOptions, build: buildCustomerReport, searchable: true },
  { key: 'vendor', ar: 'مورد', en: 'Vendor', icon: 'store', options: vendorOptions, build: buildVendorReport, searchable: true },
  { key: 'employee', ar: 'موظف', en: 'Employee', icon: 'badge', options: employeeOptions, build: buildEmployeeReport, searchable: true },
  { key: 'section', ar: 'قسم', en: 'Department', icon: 'layers', options: sectionOptions, build: buildSectionReport, searchable: false },
  // userScoped: the list of meetings you may print depends on who you are.
  { key: 'meeting', ar: 'محضر اجتماع', en: 'Meeting minutes', icon: 'calendar', options: meetingOptions, build: buildMeetingReport, searchable: true, userScoped: true },
];

const getSubject = (key) => SUBJECTS.find((s) => s.key === key) || null;
const subjectMeta = () => SUBJECTS.map((s) => ({ key: s.key, ar: s.ar, en: s.en, icon: s.icon, searchable: s.searchable }));

module.exports = { SUBJECTS, SECTION_REPORTS, getSubject, subjectMeta, resolvePeriod, COMPANY };
