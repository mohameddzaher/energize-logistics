// Trip Detection Algorithm
// Converts granular GPS segments into logical trips based on known cities
// A trip = vehicle moves from one known city to another known city

export interface GPSMovement {
  vehicleId: string;
  beginning: string;
  end: string;
  initialLocation: string;
  finalLocation: string;
  duration: string;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  [key: string]: any;
}

export interface DetectedTrip {
  vehicleId: string;
  startCity: string;
  endCity: string;
  startTime: string;
  endTime: string;
  startLocation: string;
  endLocation: string;
  totalDistance: number;
  durationMinutes: number;
  maxSpeed: number;
  avgSpeed: number;
  segmentCount: number;
  speedViolations: number; // segments with max speed > 120
  segments: GPSMovement[];
}

// Known Saudi cities - English and Arabic variants
// Order matters: longer/more specific names first to avoid false matches
export const KNOWN_CITIES: { key: string; variants: string[] }[] = [
  { key: 'Riyadh', variants: ['Riyadh', 'الرياض', 'Ar Riyad', 'Al Riyadh'] },
  { key: 'Jeddah', variants: ['Jeddah', 'Jedda', 'Jiddah', 'جدة', 'جده'] },
  { key: 'Dammam', variants: ['Dammam', 'الدمام', 'Ad Dammam'] },
  { key: 'Mecca', variants: ['Mecca', 'Makkah', 'مكة', 'مكه', 'Makka', 'Al Makkah'] },
  { key: 'Medina', variants: ['Medina', 'Madinah', 'المدينة', 'المدينه', 'Al Madinah', 'Al Madina'] },
  { key: 'Jubail', variants: ['Jubail', 'Al Jubail', 'الجبيل'] },
  { key: 'Khobar', variants: ['Khobar', 'Al Khobar', 'الخبر'] },
  { key: 'Dhahran', variants: ['Dhahran', 'الظهران'] },
  { key: 'Taif', variants: ['Taif', 'Al Taif', 'At Taif', 'الطائف'] },
  { key: 'Yanbu', variants: ['Yanbu', 'ينبع'] },
  { key: 'Abha', variants: ['Abha', 'أبها'] },
  { key: 'Khamis Mushait', variants: ['Khamis Mushait', 'خميس مشيط', 'Khamis'] },
  { key: 'Tabuk', variants: ['Tabuk', 'تبوك'] },
  { key: 'Hail', variants: ['Hail', 'Hail Region', 'حائل'] },
  { key: 'Buraidah', variants: ['Buraidah', 'Buraydah', 'بريدة', 'بريده'] },
  { key: 'Unaizah', variants: ['Unaizah', 'Unayzah', 'عنيزة', 'عنيزه'] },
  { key: 'Al Hasa', variants: ['Al Hasa', 'Ahsa', 'Al Ahsa', 'الأحساء', 'الاحساء', 'الحسا', 'Al-Hasa'] },
  { key: 'Al Kharj', variants: ['Al Kharj', 'Kharj', 'الخرج'] },
  { key: 'Qatif', variants: ['Qatif', 'Al Qatif', 'القطيف'] },
  { key: 'Najran', variants: ['Najran', 'نجران'] },
  { key: 'Jazan', variants: ['Jazan', 'Jizan', 'جازان', 'جيزان'] },
  { key: 'Hafr Al Batin', variants: ['Hafr Al Batin', 'Hafar Al Batin', 'حفر الباطن'] },
  { key: 'Arar', variants: ['Ar ar', 'Arar', 'Arʿar', 'عرعر'] },
  { key: 'Sakaka', variants: ['Sakaka', 'Sakakah', 'سكاكا'] },
  { key: 'Al Ula', variants: ['Al Ula', 'AlUla', 'العلا'] },
  { key: 'Wadi Al Dawaser', variants: ['Wadi Al Dawaser', 'Wadi ad Dawasir', 'وادي الدواسر'] },
  { key: 'Afif', variants: ['Afif', 'Afeef', 'عفيف'] },
  { key: 'Bisha', variants: ['Bisha', 'بيشة', 'بيشه'] },
  { key: 'Nairiyah', variants: ['Nairyah', 'Nairiyah', 'النعيرية', 'النعيريه'] },
  { key: 'Qassim', variants: ['Qassim', 'Al Qassim', 'القصيم'] },
  { key: 'Rabigh', variants: ['Rabigh', 'رابغ'] },
  { key: 'Jummum', variants: ['Jummum', 'جموم'] },
  { key: 'Rumah', variants: ['Rumah', 'رمح'] },
  { key: 'Al Majma', variants: ['Al Majma', 'Majmaah', 'المجمعة', 'المجمعه'] },
  { key: 'Al Dawadmi', variants: ['Al Dawadmi', 'Dawadmi', 'الدوادمي'] },
  { key: 'Quwayiyah', variants: ['Quwayiyah', 'Al Quwayiyah', 'القويعية'] },
  { key: 'Huraymala', variants: ['Huraymala', 'Huraimla', 'حريملاء'] },
  { key: 'Al Muwayh', variants: ['Al Muwayh', 'Muwayh', 'المويه'] },
  { key: 'Al Wajh', variants: ['Al Wajh', 'Wajh', 'الوجه'] },
  { key: 'Al Khafji', variants: ['Al Khafji', 'Khafji', 'الخفجي'] },
  { key: 'Al Aflaj', variants: ['Al Aflaj', 'Aflaj', 'الأفلاج', 'الافلاج'] },
  { key: 'Al Ahsa', variants: ['Al Ahsaa'] },
];

// Try to match a location string to a known city
export function detectCity(location: string): string | null {
  if (!location) return null;
  const loc = String(location).trim();
  const locLower = loc.toLowerCase();

  for (const city of KNOWN_CITIES) {
    for (const variant of city.variants) {
      const v = variant.toLowerCase();
      // Match as whole word or comma-separated token
      if (
        locLower === v ||
        locLower.includes(`, ${v}`) ||
        locLower.includes(`${v},`) ||
        locLower.includes(` ${v} `) ||
        locLower.endsWith(` ${v}`) ||
        locLower.startsWith(`${v} `) ||
        locLower.startsWith(`${v},`)
      ) {
        return city.key;
      }
    }
  }
  return null;
}

// Parse duration string like "0:45:17" or "8:56:09" into minutes
export function parseDuration(duration: string): number {
  if (!duration) return 0;
  const parts = String(duration).split(':').map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return Number(duration) || 0;
}

// Parse a date-like value (handles both Excel serial dates and strings)
function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/**
 * Detect logical trips from GPS movements.
 *
 * Algorithm:
 * 1. Sort movements chronologically
 * 2. Track vehicle's "current city" (last known city it was in)
 * 3. For each movement:
 *    - If vehicle is idle in a city and moves within it → ignore
 *    - If vehicle LEAVES the current city → start tracking a trip
 *    - Continue accumulating until final_location = another known city → trip ends
 *    - The end city becomes the new current city
 */
export function detectTrips(movements: GPSMovement[]): DetectedTrip[] {
  if (!movements.length) return [];

  // Sort by beginning time
  const sorted = [...movements].sort((a, b) => {
    const da = parseDate(a.beginning);
    const db = parseDate(b.beginning);
    if (!da || !db) return 0;
    return da.getTime() - db.getTime();
  });

  const trips: DetectedTrip[] = [];
  let currentCity: string | null = null; // The city vehicle is currently "in"
  let pendingTrip: {
    startCity: string;
    startTime: string;
    startLocation: string;
    segments: GPSMovement[];
  } | null = null;

  // Initialize current city from first movement's initial_location
  const firstCity = detectCity(sorted[0]?.initialLocation);
  if (firstCity) currentCity = firstCity;

  for (const mov of sorted) {
    const initCity = detectCity(mov.initialLocation);
    const finalCity = detectCity(mov.finalLocation);

    if (!pendingTrip) {
      // Not in a trip - looking for trip start
      if (finalCity && finalCity !== currentCity && finalCity !== initCity) {
        // This single segment IS a complete trip (start city → end city directly)
        const fromCity = initCity || currentCity || 'Unknown';
        trips.push({
          vehicleId: mov.vehicleId,
          startCity: fromCity,
          endCity: finalCity,
          startTime: mov.beginning,
          endTime: mov.end,
          startLocation: mov.initialLocation,
          endLocation: mov.finalLocation,
          totalDistance: Number(mov.distance) || 0,
          durationMinutes: parseDuration(mov.duration),
          maxSpeed: Number(mov.maxSpeed) || 0,
          avgSpeed: Number(mov.avgSpeed) || 0,
          segmentCount: 1,
          speedViolations: (Number(mov.maxSpeed) || 0) > 120 ? 1 : 0,
          segments: [mov],
        });
        currentCity = finalCity;
      } else if (finalCity && finalCity === currentCity) {
        // Still moving within same city - ignore
        continue;
      } else if (!finalCity && initCity === currentCity) {
        // Started moving out of current city - begin a pending trip
        pendingTrip = {
          startCity: currentCity || initCity || 'Unknown',
          startTime: mov.beginning,
          startLocation: mov.initialLocation,
          segments: [mov],
        };
      } else if (!finalCity) {
        // Moving between unknown locations - start trip from current city
        pendingTrip = {
          startCity: currentCity || initCity || 'Unknown',
          startTime: mov.beginning,
          startLocation: mov.initialLocation,
          segments: [mov],
        };
      } else if (finalCity && finalCity === initCity) {
        // Moved within same city (short trip) - update current city if it was null
        if (!currentCity) currentCity = finalCity;
      }
    } else {
      // In a pending trip - looking for end
      pendingTrip.segments.push(mov);

      if (finalCity && finalCity !== pendingTrip.startCity) {
        // Trip ends here!
        const totalDistance = pendingTrip.segments.reduce((s, m) => s + (Number(m.distance) || 0), 0);
        const totalDuration = pendingTrip.segments.reduce((s, m) => s + parseDuration(m.duration), 0);
        const maxSpeed = Math.max(...pendingTrip.segments.map(m => Number(m.maxSpeed) || 0));
        const speeds = pendingTrip.segments.map(m => Number(m.avgSpeed) || 0).filter(s => s > 0);
        const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
        const speedViolations = pendingTrip.segments.filter(m => (Number(m.maxSpeed) || 0) > 120).length;

        trips.push({
          vehicleId: mov.vehicleId,
          startCity: pendingTrip.startCity,
          endCity: finalCity,
          startTime: pendingTrip.startTime,
          endTime: mov.end,
          startLocation: pendingTrip.startLocation,
          endLocation: mov.finalLocation,
          totalDistance,
          durationMinutes: totalDuration,
          maxSpeed,
          avgSpeed,
          segmentCount: pendingTrip.segments.length,
          speedViolations,
          segments: pendingTrip.segments,
        });

        currentCity = finalCity;
        pendingTrip = null;
      }
    }
  }

  return trips;
}

// Group trips by vehicle and compute summary stats
export interface VehicleTripSummary {
  vehicleId: string;
  tripCount: number;
  totalDistance: number;
  totalDuration: number; // minutes
  avgTripDistance: number;
  avgTripDuration: number;
  maxSpeedRecorded: number;
  totalSpeedViolations: number;
  routes: Record<string, number>; // "from → to" → count
}

export function summarizeByVehicle(trips: DetectedTrip[]): Record<string, VehicleTripSummary> {
  const result: Record<string, VehicleTripSummary> = {};

  for (const trip of trips) {
    if (!result[trip.vehicleId]) {
      result[trip.vehicleId] = {
        vehicleId: trip.vehicleId,
        tripCount: 0,
        totalDistance: 0,
        totalDuration: 0,
        avgTripDistance: 0,
        avgTripDuration: 0,
        maxSpeedRecorded: 0,
        totalSpeedViolations: 0,
        routes: {},
      };
    }
    const s = result[trip.vehicleId];
    s.tripCount += 1;
    s.totalDistance += trip.totalDistance;
    s.totalDuration += trip.durationMinutes;
    s.maxSpeedRecorded = Math.max(s.maxSpeedRecorded, trip.maxSpeed);
    s.totalSpeedViolations += trip.speedViolations;
    const routeKey = `${trip.startCity} → ${trip.endCity}`;
    s.routes[routeKey] = (s.routes[routeKey] || 0) + 1;
  }

  // Compute averages
  for (const vid in result) {
    const s = result[vid];
    s.avgTripDistance = s.tripCount > 0 ? s.totalDistance / s.tripCount : 0;
    s.avgTripDuration = s.tripCount > 0 ? s.totalDuration / s.tripCount : 0;
  }

  return result;
}
