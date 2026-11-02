/**
 * Where a truck is now and where it is headed, derived from FleetShipment.
 * Maintenance needs this next to overdue/due-soon work. Nothing is copied into the Wialon mirror; it is read on demand and grouped by `utils/plateKey`, the same key the workshop store and asset registry use.
 */
const { plateKey } = require('./plateKey');

// Live load: not yet invoiced and not cancelled. A sent/received waybill means the truck has unloaded and arrived, which matters most to maintenance (the truck is empty).
const LIVE_STATUSES = ['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'late', 'bond_sent', 'bond_received'];

/** Truck whereabouts derived from the load status. `where` is display text; `phase` is the key the UI colours and filters by. */
const placeOf = (trip) => {
  const from = trip.fromCity || '';
  const to = trip.toCity || '';
  switch (trip.status) {
    case 'requesting':
      return { phase: 'preparing', ar: from ? `تُجهَّز في ${from}` : 'تُجهَّز', en: from ? `Preparing in ${from}` : 'Preparing' };
    case 'loading':
    case 'uploaded':
      return { phase: 'loading', ar: from ? `تُحمَّل في ${from}` : 'تُحمَّل', en: from ? `Loading in ${from}` : 'Loading' };
    case 'on_way':
      return { phase: 'moving', ar: to ? `في الطريق إلى ${to}` : 'في الطريق', en: to ? `On the way to ${to}` : 'On the way' };
    case 'late':
      return { phase: 'late', ar: to ? `متأخّرة — إلى ${to}` : 'متأخّرة', en: to ? `Late — to ${to}` : 'Late' };
    case 'arrived':
      return { phase: 'arrived', ar: to ? `وصلت ${to}` : 'وصلت', en: to ? `Arrived ${to}` : 'Arrived' };
    case 'bond_sent':
    case 'bond_received':
      return { phase: 'unloaded', ar: to ? `فرّغت في ${to}` : 'فرّغت', en: to ? `Unloaded in ${to}` : 'Unloaded' };
    default:
      return { phase: 'unknown', ar: 'غير معروف', en: 'Unknown' };
  }
};

/** Map of plate key to the newest live load. If a truck has several live loads (a previous one was never closed) the newest wins and the count of the others is reported so the conflict stays visible. */
const liveTripsByPlateKey = async () => {
  const FleetShipment = require('../models/FleetModels').FleetShipment;
  const trips = await FleetShipment.find({ status: { $in: LIVE_STATUSES } })
    .select('waybillNumber vehiclePlate driverName customerName fromCity toCity status loadDate lastContactAt expectedArrival')
    .sort({ loadDate: -1, createdAt: -1 })
    .lean();
  const map = new Map();
  for (const t of trips) {
    const k = plateKey(t.vehiclePlate);
    if (!k) continue;
    const prev = map.get(k);
    if (prev) { prev.others = (prev.others || 0) + 1; continue; }
    const place = placeOf(t);
    map.set(k, {
      waybillNumber: t.waybillNumber || null,
      status: t.status,
      phase: place.phase,
      whereAr: place.ar,
      whereEn: place.en,
      fromCity: t.fromCity || '',
      toCity: t.toCity || '',
      customerName: t.customerName || '',
      driverName: t.driverName || '',
      loadDate: t.loadDate || null,
      lastContactAt: t.lastContactAt || null,
      expectedArrival: t.expectedArrival || null,
      others: 0,
    });
  }
  return map;
};

/** Empty load for trucks without one, so the UI reads a single shape. */
const IDLE = { status: 'idle', phase: 'idle', whereAr: 'في الفراغ — بلا حمولة', whereEn: 'Idle — no load' };

module.exports = { liveTripsByPlateKey, placeOf, LIVE_STATUSES, IDLE };
