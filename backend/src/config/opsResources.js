/**
 * Whitelist of UPL Operations resources our /api/ops proxy is allowed to touch,
 * mapped to their path under the UPL /api/v1 prefix.
 *
 * - `form: true`  -> create/update are sent to UPL as multipart/form-data
 *   (our frontend still posts plain JSON to us; the controller converts it).
 * - `readOnly: true` -> only list/get are exposed (no create/update/delete).
 */
const OPS_RESOURCES = {
  shipments: { path: '/admin/shipments', form: true },
  drivers: { path: '/admin/drivers' },
  cars: { path: '/admin/cars' },
  'car-owners': { path: '/admin/car-owners' },
  branches: { path: '/admin/branches' },
  cities: { path: '/admin/cities' },
  countries: { path: '/admin/countries' },
  users: { path: '/admin/users' },
  'truck-types': { path: '/admin/truck-types' },
  'truck-sizes': { path: '/admin/truck-sizes' },
  'load-types': { path: '/admin/load-types' },
  'car-brands': { path: '/admin/car-brands' },
  'car-colors': { path: '/admin/car-colors' },
  'additional-inputs': { path: '/admin/additional-inputs' },
  admins: { path: '/admins' },
  roles: { path: '/roles' },
  permissions: { path: '/permissions', readOnly: true },
};

module.exports = { OPS_RESOURCES };
