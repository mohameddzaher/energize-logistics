/**
 * saCities — turning a live GPS point into "السيارة في جدة الآن".
 *
 * The Location Solutions feed gives exact coordinates; what the operations team
 * thinks in is CITIES. Each entry is a city centre + a radius that covers its
 * metro/port/industrial sprawl, so `cityForPoint` answers "which city is this
 * truck inside right now?" and `sameCity` matches that against the free-text
 * toCity typed on a shipment (hamza/ta-marbuta variants folded: جده == جدة).
 */

const CITIES = [
  { name: 'جدة', lat: 21.5433, lng: 39.1728, radiusKm: 40 },
  { name: 'الرياض', lat: 24.7136, lng: 46.6753, radiusKm: 50 },
  { name: 'الدمام', lat: 26.4207, lng: 50.0888, radiusKm: 25 },
  { name: 'الخبر', lat: 26.2172, lng: 50.1971, radiusKm: 15 },
  { name: 'الظهران', lat: 26.2361, lng: 50.0393, radiusKm: 12 },
  { name: 'مكة المكرمة', lat: 21.3891, lng: 39.8579, radiusKm: 25 },
  { name: 'المدينة المنورة', lat: 24.5247, lng: 39.5692, radiusKm: 30 },
  { name: 'الطائف', lat: 21.2703, lng: 40.4158, radiusKm: 25 },
  { name: 'ينبع', lat: 24.0895, lng: 38.0618, radiusKm: 30 },
  { name: 'رابغ', lat: 22.7986, lng: 39.0349, radiusKm: 25 },
  { name: 'الجبيل', lat: 27.0046, lng: 49.646, radiusKm: 30 },
  { name: 'الأحساء', lat: 25.3833, lng: 49.5866, radiusKm: 35 },
  { name: 'الخرج', lat: 24.1483, lng: 47.305, radiusKm: 20 },
  { name: 'القصيم', lat: 26.326, lng: 43.975, radiusKm: 35 }, // بريدة/عنيزة
  { name: 'حائل', lat: 27.5114, lng: 41.7208, radiusKm: 25 },
  { name: 'تبوك', lat: 28.3838, lng: 36.555, radiusKm: 25 },
  { name: 'أبها', lat: 18.2465, lng: 42.5117, radiusKm: 20 },
  { name: 'خميس مشيط', lat: 18.306, lng: 42.7297, radiusKm: 20 },
  { name: 'جيزان', lat: 16.8894, lng: 42.5511, radiusKm: 25 },
  { name: 'نجران', lat: 17.4917, lng: 44.1322, radiusKm: 20 },
  { name: 'الباحة', lat: 20.0129, lng: 41.4677, radiusKm: 15 },
  { name: 'بيشة', lat: 19.9764, lng: 42.6052, radiusKm: 15 },
  { name: 'حفر الباطن', lat: 28.4328, lng: 45.9601, radiusKm: 20 },
  { name: 'عرعر', lat: 30.9753, lng: 41.0381, radiusKm: 20 },
  { name: 'سكاكا', lat: 29.9697, lng: 40.2064, radiusKm: 20 },
  { name: 'القريات', lat: 31.3318, lng: 37.3421, radiusKm: 15 },
  { name: 'الدوادمي', lat: 24.5075, lng: 44.3924, radiusKm: 15 },
  { name: 'وادي الدواسر', lat: 20.4711, lng: 44.7958, radiusKm: 20 },
  { name: 'شرورة', lat: 17.467, lng: 47.1057, radiusKm: 15 },
  { name: 'القنفذة', lat: 19.1264, lng: 41.0789, radiusKm: 15 },
  { name: 'الليث', lat: 20.1507, lng: 40.2728, radiusKm: 15 },
  { name: 'المجمعة', lat: 25.8973, lng: 45.3444, radiusKm: 15 },
  { name: 'الرس', lat: 25.8697, lng: 43.4977, radiusKm: 15 },
];

// المسافة بالكيلومتر بين نقطتين (haversine).
const distanceKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Which city is this point inside? Nearest centre whose radius covers it.
const cityForPoint = (lat, lng) => {
  if (lat == null || lng == null) return null;
  let best = null;
  for (const c of CITIES) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    if (d <= c.radiusKm && (!best || d < best.d)) best = { city: c.name, d };
  }
  return best ? best.city : null;
};

// Free-text city comparison: fold hamza forms, ta marbuta and alif maqsura so
// "جده" matches "جدة" and "مكه" matches "مكة المكرمة" (prefix containment both
// ways covers "الدمام" vs "الدمام - الميناء").
const fold = (s) => String(s || '')
  .toLowerCase().trim()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ');
const sameCity = (a, b) => {
  const x = fold(a); const y = fold(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
};

module.exports = { CITIES, cityForPoint, sameCity, distanceKm };
