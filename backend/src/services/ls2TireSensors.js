/**
 * ls2TireSensors: how many of a truck's tires have a sensor that is actually transmitting.
 * The workshop fits sensors in batches, so the fleet is a mix of fully and half equipped trucks, and no single number showed campaign progress.
 * Computed on the server so the live fleet screen, the fleet register and the mobile app show the same number; if each derived it alone they would diverge on the first rule change.
 * Two sources, each knowing what the other does not:   asset register (Ls2TireAsset) knows positions: where each tire is and which has a sensor registered; but it is paper, a sensor may be registered then die without an update.   live stream (Ls2Vehicle.tires) knows work: which channels send temperature and pressure now; but not the tire's position in the workshop naming. Green is computed from the stream, since "has a sensor?" practically means "gives a reading?"; the register supplies position counts and names, and detects the silent installed sensor.
 */
const Ls2TireAsset = require('../models/Ls2TireAsset');
const Ls2Flatbed = require('../models/Ls2Flatbed');
const cache = require('../utils/ttlCache');
const { vehiclePlateKey } = require('../utils/plateKey');

// Official tire position layout as the workshop writes it in its sheets. It lives on the server, not the screen, because position counts (ground/spare) for a truck not yet inventoried are derived from it.
const TIRE_POSITIONS = [
  { n: 1, label: 'اطار 1 يسار', section: 'الرأس' },
  { n: 2, label: 'اطار 2 يمين', section: 'الرأس' },
  { n: 3, label: 'اطار 3 خارجي يمين', section: 'المحور الخلفي للرأس' },
  { n: 4, label: 'اطار 4 داخلي يمين', section: 'المحور الخلفي للرأس' },
  { n: 5, label: 'اطار 5 داخلي يسار', section: 'المحور الخلفي للرأس' },
  { n: 6, label: 'اطار 6 خارجي يسار', section: 'المحور الخلفي للرأس' },
  { n: 7, label: 'اطار 7 يسار', section: 'التيدر' },
  { n: 8, label: 'اطار 8 يسار', section: 'التيدر' },
  { n: 9, label: 'اطار 9 يسار', section: 'التيدر' },
  { n: 10, label: 'اطار 10 يمين', section: 'التيدر' },
  { n: 11, label: 'اطار 11 يمين', section: 'التيدر' },
  { n: 12, label: 'اطار 12 يمين', section: 'التيدر' },
  { n: 13, label: 'اطار 13', section: 'الاستبن' },
  { n: 14, label: 'اطار 14', section: 'الاستبن' },
];

// Section is matched by pattern, not string equality: the section text comes from the workshop sheet in several forms (spare, trailer and so on), and exact equality dropped the tire into the head section silently.
const isSpareSection = (s) => /استبن/.test(String(s || ''));
const isTrailerSection = (s) => /تيدر|تريل/.test(String(s || ''));

// Standard layout counts, derived from the table above rather than hard-coded, so adding or removing a position follows automatically.
const STD = (() => {
  const spare = TIRE_POSITIONS.filter((p) => isSpareSection(p.section)).length;
  const trailer = TIRE_POSITIONS.filter((p) => isTrailerSection(p.section)).length;
  const head = TIRE_POSITIONS.length - spare - trailer;
  return { spare, trailer, head, ground: head + trailer };
})();

// "Channel that transmits", the same definition the sensor-change detector in ls2Poll uses. Kept identical on purpose: otherwise the detector would alert on a change the column does not show, or the column would show green where the detector sees none.
const isReporting = (t) => t.tempC != null || (t.pressurePsi != null && t.pressurePsi > 10);

const LAYOUT_KEY = 'ls2:tireSensorLayout';
const LAYOUT_TTL = 60000; // The asset register changes by workshop action (a few times a day), not by the second.

const EMPTY_ENTRY = { known: false, hasTrailer: false, ground: [], spares: [] };

/** Map of plateKey to the truck's registered positions. One query for the whole fleet instead of one per table row: the screen shows 57 trucks and one Atlas read costs about 90 ms round trip. */
async function loadLayoutMap() {
  return cache.wrap(LAYOUT_KEY, LAYOUT_TTL, async () => {
    const [tires, flatbeds] = await Promise.all([
      Ls2TireAsset.find({ status: 'mounted' }, {
        plateKey: 1, section: 1, isSpare: 1, sensor: 1, positionNumber: 1, positionLabel: 1, serial: 1,
      }).lean(),
      Ls2Flatbed.find({}, { plateKey: 1, currentTrailerNumber: 1 }).lean(),
    ]);
    const map = new Map();
    const entryFor = (key) => {
      if (!map.has(key)) map.set(key, { known: false, hasTrailer: false, ground: [], spares: [] });
      return map.get(key);
    };
    for (const t of tires) {
      if (!t.plateKey) continue; // A tire on a standalone trailer; not on a truck now.
      const e = entryFor(t.plateKey);
      e.known = true;
      if (t.isSpare || isSpareSection(t.section)) e.spares.push(t);
      else e.ground.push(t);
    }
    for (const f of flatbeds) {
      if (!f.plateKey) continue;
      const e = entryFor(f.plateKey);
      e.hasTrailer = !!f.currentTrailerNumber;
    }
    return map;
  });
}

// Called from ls2AssetsController on any asset movement: fitting a tire with a sensor must show in the column at once, not after a minute in which the technician thinks the registration was lost.
function clearLayoutCache() {
  cache.clear(LAYOUT_KEY);
}

/**
 * Share for one truck: "7 / 5 / 2" = fitted with working sensor / ground positions without sensor / spare count.
 * Position counts are derived rather than fixed at 12 and 2: trucks differ (head alone has six tires, with trailer twelve, and a trailer may have more axles). The count is taken from the register when it shows more than standard, and drops to head positions only when the register positively shows no trailer (registered flatbed, no trailer number, with registered tires none of which is a trailer tire). Otherwise the standard, since a truck not yet inventoried still has its positions on the ground, and dropping them would show "7 / 0 / 0" for a truck missing five sensors.
 */
function summarize(reg, liveTires) {
  const e = reg || EMPTY_ENTRY;
  const ground = e.ground || [];
  const spares = e.spares || [];

  const hasTrailer = e.hasTrailer || ground.some((t) => isTrailerSection(t.section));
  const headOnly = e.known && !hasTrailer && ground.length > 0;
  const groundCount = ground.length > STD.ground ? ground.length : (headOnly ? STD.head : STD.ground);
  const spareCount = Math.max(spares.length, STD.spare);

  const live = Array.isArray(liveTires) ? liveTires : [];
  const reporting = live.filter(isReporting).length;
  // A channel exists on the carrier but sends garbage (temperature 1774, or an electrical fault flag): an installed and silent sensor, which must not be counted green.
  const faulty = live.filter((t) => t.fault).length;

  const withSensor = Math.min(reporting, groundCount);
  const withoutSensor = Math.max(0, groundCount - withSensor);

  const fitted = ground.filter((t) => t.sensor === 'yes').length;
  const spareFitted = spares.filter((t) => t.sensor === 'yes').length;
  // Stream beyond the ground positions can only come from an armed spare; channels do not exceed those fitted on the ground otherwise.
  const spareReporting = Math.max(0, Math.min(spareCount, reporting - groundCount));

  // Silent = a sensor that one source says exists but gives no reading: a faulty stream channel, or a tire the workshop registered a sensor for with no channel at all. Bounded by the red position count, since it explains part of them rather than being an independent number.
  const unseenFitted = Math.max(0, fitted - (reporting + faulty));
  const silent = Math.min(withoutSensor, faulty + unseenFitted);

  return {
    // The three numbers as the owner reads them: green / red / spare.
    withSensor,
    withoutSensor,
    spare: spareCount,
    spareWithSensor: Math.max(spareFitted, spareReporting),
    // Silent: an installed sensor that does not transmit; part of red, shown in amber so "not fitted" is not confused with "fitted and failed": the first needs installation, the second replacement or inspection.
    silent,
    // Audit context: builds the detail window and identifies the source of each number.
    ground: groundCount,
    registered: ground.length,
    unregistered: Math.max(0, groundCount - ground.length),
    fitted,
    reporting,
    faulty,
    layout: ground.length > STD.ground ? 'registry' : headOnly ? 'head' : 'standard',
    // Ground positions with no sensor registered; the answer to "exactly who is missing".
    positionsWithoutSensor: ground
      .filter((t) => t.sensor !== 'yes')
      .map((t) => ({ positionNumber: t.positionNumber ?? null, positionLabel: t.positionLabel || '', section: t.section || '', serial: t.serial || '', sensor: t.sensor || 'unknown' }))
      .sort((a, b) => (a.positionNumber ?? 99) - (b.positionNumber ?? 99)),
    // Faulty channels in Wialon numbering (axle/tire). Deliberately not translated to workshop positions: the two numberings do not map one to one, and guessing a position would send the technician to the wrong tire; the device's explicit name is more truthful than a guess.
    faultyChannels: live.filter((t) => t.fault).map((t) => ({ axle: t.axle ?? null, position: t.position ?? null })),
    label: `${withSensor} / ${withoutSensor} / ${spareCount}`,
  };
}

/** Attaches `tireSensors` to each vehicle in the list; one register query for all. */
async function attachToVehicles(vehicles) {
  const map = await loadLayoutMap();
  return vehicles.map((v) => ({ ...v, tireSensors: summarize(map.get(vehiclePlateKey(v)), v.tires) }));
}

/** Single version, for one vehicle's page. */
async function attachToVehicle(vehicle) {
  if (!vehicle) return vehicle;
  const map = await loadLayoutMap();
  return { ...vehicle, tireSensors: summarize(map.get(vehiclePlateKey(vehicle)), vehicle.tires) };
}

module.exports = {
  TIRE_POSITIONS, STD, isSpareSection, isTrailerSection, isReporting,
  loadLayoutMap, clearLayoutCache, summarize, attachToVehicles, attachToVehicle,
};
