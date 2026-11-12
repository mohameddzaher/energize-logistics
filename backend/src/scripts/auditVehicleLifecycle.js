/**
 * Vehicle lifecycle check against a throwaway LOCAL database with the real controllers: cancel authorization (registry, B2C, employee file), end of service refused while authorized, archive, every active list without it, restore.
 * Usage: node src/scripts/auditVehicleLifecycle.js [mongodb://127.0.0.1:27993/lifecycle_test]  (drops that database)
 */
process.env.AUDIT_SUPPRESS = '1';
const path = require('path');
const B = path.join(__dirname, '..');
const mongoose = require('mongoose');
const URI = process.argv[2] || 'mongodb://127.0.0.1:27993/lifecycle_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI)) { console.error('Local databases only: this script drops the database it is given.'); process.exit(2); }

// Record socket events before any module destructures emitToAll.
const sm = require(path.join(B, 'websocket/socketManager'));
const events = [];
sm.emitToAll = (e, p) => events.push(e);
const cache = require(path.join(B, 'utils/ttlCache'));
const clears = [];
const origClear = cache.clear;
cache.clear = (k) => { clears.push({ k, at: events.length }); return origClear(k); };

const req = (user, params = {}, body = {}, query = {}) => ({ user, params, body, query, ip: '127.0.0.1' });
const call = (fn, r) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  Promise.resolve(fn(r, res)).catch((e) => resolve({ status: 'throw', body: e.message }));
});
let pass = 0; let fail = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); };

(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  const Employee = require(path.join(B, 'models/Employee'));
  const User = require(path.join(B, 'models/User'));
  const { VehicleMaster } = require(path.join(B, 'models/VehicleMaster'));
  const Vehicle = require(path.join(B, 'models/Vehicle'));
  const VehicleAuthorization = require(path.join(B, 'models/VehicleAuthorization'));
  const { LightTransportEmployee, LightTransportOrder } = require(path.join(B, 'models/LightTransport'));
  const reg = require(path.join(B, 'controllers/vehicleRegistryController'));
  const lt = require(path.join(B, 'controllers/lightTransportController'));
  const vc = require(path.join(B, 'controllers/vehicleController'));
  const VA = require(path.join(B, 'utils/vehicleAuthorization'));

  const admin = await User.create({ firstName: 'Test', lastName: 'Admin', email: 'a@t.local', password: 'Secret123!', role: 'super_admin' }).catch(async (e) => { console.log('user create:', e.message); return { _id: new mongoose.Types.ObjectId(), firstName: 'Test', lastName: 'Admin', role: 'super_admin' }; });
  const user = { _id: admin._id, firstName: 'Test', lastName: 'Admin', role: 'super_admin' };
  const b2cUser = { _id: new mongoose.Types.ObjectId(), firstName: 'B2C', lastName: 'Manager', role: 'b2c_manager' };

  const emp = await Employee.create({ firstName: 'Ahmed', lastName: 'Driver', iqamaNumber: '2400000001', employmentStatus: 'active' });
  const emp2 = await Employee.create({ firstName: 'Omar', lastName: 'Rider', iqamaNumber: '2400000002', employmentStatus: 'active' });

  // Vehicle A: light transport, authorized to emp, ridden by an LT rep with an active order carrying the auth number.
  const vA = await VehicleMaster.create({ plateNumber: 'أ ب ج 1234', sectorAr: 'النقل الخفيف', sectorCode: 'light_transport', registrationTypeAr: 'دراجة آلية', brandAr: 'هوندا' });
  let r = await call(reg.authorizationAction, req(user, { id: String(vA._id) }, { action: 'assign', employeeId: String(emp._id), authorizationNumber: 'AUTH-777', startDate: '2026-01-01', expiryDate: '2027-01-01' }));
  check('assign authorization', r.status === 200, r.body.message);
  const ltRow = await LightTransportEmployee.create({ idNumber: '2400000002', name: 'Omar Rider', employee: emp2._id, vehicle: vA._id, vehiclePlate: vA.plateNumber });
  const order = await LightTransportOrder.create({ orderNumber: 'LT-1', ltEmployee: ltRow._id, vehicle: vA._id, vehiclePlate: vA.plateNumber, status: 'active', authorizationMoved: true, authorizationNumber: 'AUTH-777', authorizationStart: new Date('2026-01-01'), authorizationEnd: new Date('2027-01-01') });

  let vaDoc = await VehicleMaster.findById(vA._id).lean();
  const empFile = await Employee.findById(emp._id).lean();
  const activeA = await VehicleAuthorization.countDocuments({ employee: emp._id, status: 'active' });
  check('setup: holder on paper', vaDoc.authorizedPerson.name && vaDoc.authorizedPerson.authorizationNumber === 'AUTH-777');
  check('setup: employee plate snapshot', /1234/.test(empFile.vehiclePlate || ''), empFile.vehiclePlate);
  check('setup: active assignment in HR', activeA === 1);
  let cur = await VA.currentFor(emp._id);
  check('setup: employee vehicles tab shows it', cur.length === 1 && cur[0].authorizationNumber === 'AUTH-777');

  // End service while authorized is refused.
  r = await call(reg.endService, req(user, { id: String(vA._id) }, { reason: 'lease ended', date: '2026-11-10' }));
  check('end-service refused while authorized (409)', r.status === 409 && r.body.code === 'VEHICLE_AUTHORIZED', r.body.message);
  check('refusal message names holder', /ما زالت مفوَّضة لـ .*ألغِ التفويض أولًا/.test(r.body.message));

  // Cancel from the registry (same endpoint the registry row / profile / authorizations page use).
  events.length = 0; clears.length = 0;
  r = await call(reg.authorizationAction, req(user, { id: String(vA._id) }, { action: 'revoke', source: 'registry' }));
  check('revoke from registry', r.status === 200, r.body.message);
  vaDoc = await VehicleMaster.findById(vA._id).lean();
  const ap = vaDoc.authorizedPerson;
  check('paper cleared (name/iqama/number/dates)', !ap.name && !ap.iqamaNumber && !ap.authorizationNumber && !ap.startDate && !ap.expiryDate);
  check('vehicle log records the revoke', (vaDoc.renewals || []).some((x) => x.document === 'authorization' && /أُلغي التفويض/.test(x.note)));
  check('HR assignment closed', (await VehicleAuthorization.countDocuments({ employee: emp._id, status: 'active' })) === 0);
  check('HR assignment kept as history (revoked)', (await VehicleAuthorization.countDocuments({ employee: emp._id, status: 'revoked' })) === 1);
  check('employee plate snapshot cleared', !((await Employee.findById(emp._id).lean()).vehiclePlate));
  cur = await VA.currentFor(emp._id);
  check('employee vehicles tab empty', cur.length === 0);
  const ord = await LightTransportOrder.findById(order._id).lean();
  check('LT running order auth number/dates cleared', !ord.authorizationNumber && !ord.authorizationStart && !ord.authorizationEnd && !ord.authorizationMoved);
  { const lr = await LightTransportEmployee.findById(ltRow._id).lean(); check('LT rider released by revoke (owner, 2026-11-12)', !lr.vehicle && !lr.vehiclePlate); }
  check('LT running order ended by revoke', (await LightTransportOrder.findById(order._id).lean()).status === 'ended');
  const ltList = await call(lt.listVehicles, req({ ...b2cUser }, {}, {}, {}));
  const ltRowA = (ltList.body.vehicles || []).find((x) => String(x._id) === String(vA._id));
  check('B2C vehicle list shows no authorization', ltRowA && !ltRowA.authorizedName && !ltRowA.authNumber && !ltRowA.authStart, ltList.status);
  for (const e of ['vreg:updated', 'lt:updated', 'vehicle:authorization', 'hr:employee']) check(`event ${e} emitted`, events.includes(e));
  const firstEmit = events.indexOf('vreg:updated');
  const vregClear = clears.find((c) => c.k === 'vreg:');
  check('cache cleared before first emit', vregClear && vregClear.at <= firstEmit);

  // B2C path: re-authorize then cancel from the B2C vehicles endpoint.
  await call(reg.authorizationAction, req(user, { id: String(vA._id) }, { action: 'assign', employeeId: String(emp._id), authorizationNumber: 'AUTH-888' }));
  await LightTransportOrder.updateOne({ _id: order._id }, { $set: { authorizationMoved: true, authorizationNumber: 'AUTH-888' } });
  events.length = 0;
  r = await call(lt.revokeVehicleAuthorization, req(b2cUser, { id: String(vA._id) }, {}));
  check('revoke from B2C vehicles', r.status === 200, r.body.message);
  vaDoc = await VehicleMaster.findById(vA._id).lean();
  check('B2C revoke cleared the paper', !vaDoc.authorizedPerson.name && !vaDoc.authorizedPerson.authorizationNumber);
  check('B2C revoke closed HR assignment', (await VehicleAuthorization.countDocuments({ employee: emp._id, status: 'active' })) === 0);
  { const o = await LightTransportOrder.findById(order._id).lean(); check('B2C revoke: no running order keeps the number', o.status === 'ended' || !o.authorizationNumber); }
  check('B2C revoke emitted vreg+lt+hr', ['vreg:updated', 'lt:updated', 'hr:employee'].every((e) => events.includes(e)));
  r = await call(lt.revokeVehicleAuthorization, req(b2cUser, { id: String(vA._id) }, {}));
  check('second revoke answers 400 (nothing to cancel)', r.status === 400, r.body.message);
  r = await call(lt.revokeVehicleAuthorization, req({ ...b2cUser, role: 'b2c_project_lead' }, { id: String(vA._id) }, {}));
  check('project lead refused (403)', r.status === 403);

  // End service: needs reason + date.
  r = await call(reg.endService, req(user, { id: String(vA._id) }, { date: '2026-11-10' }));
  check('end-service without reason refused', r.status === 400);
  const before = await VehicleMaster.countDocuments({});
  await VehicleMaster.create({ plateNumber: 'د ه و 5678', sectorAr: 'النقل الثقيل' });
  const before2 = await VehicleMaster.countDocuments({});
  const dashBefore = (await call(reg.dashboard, req(user, {}, {}, {}))).body.totals.vehicles;
  const pickBefore = JSON.stringify((await call(reg.plateOptions, req(user, {}, {}, { q: '1234' }))).body);
  check('plate picker lists it while active', pickBefore.includes('1234'), pickBefore.slice(0, 100));
  events.length = 0;
  r = await call(reg.endService, req(user, { id: String(vA._id) }, { reason: 'انتهاء عقد الإيجار', date: '2026-11-10' }));
  check('end-service succeeds after cancel', r.status === 200, r.body.message);
  check('end-service emitted vreg+lt', events.includes('vreg:updated') && events.includes('lt:updated'));
  const raw = await mongoose.connection.db.collection('vehiclemasters').findOne({ _id: vA._id });
  check('record kept in DB with archived flag + reason/date', raw && raw.archived === true && raw.archive.reason === 'انتهاء عقد الإيجار' && raw.archive.endDate);
  check('history intact (renewals)', (raw.renewals || []).filter((x) => x.document === 'authorization').length >= 3, String((raw.renewals || []).length));
  check('archive log has end entry', (raw.archiveLog || []).some((x) => x.action === 'end'));
  check('registry count drops by 1', (await VehicleMaster.countDocuments({})) === before2 - 1);
  r = await call(reg.list, req(user, {}, {}, { limit: '2000' }));
  check('absent from registry list', !(r.body.vehicles || []).some((x) => String(x._id) === String(vA._id)));
  r = await call(reg.dashboard, req(user, {}, {}, {}));
  check('dashboard total excludes it', r.status === 200 && r.body.totals.vehicles === dashBefore - 1, `${dashBefore} -> ${r.body.totals.vehicles}`);
  r = await call(reg.overview, req(user, {}, {}, {}));
  check('overview excludes it', r.status === 200 && !JSON.stringify(r.body).includes(String(vA._id)), String(r.status));
  r = await call(lt.listVehicles, req(b2cUser, {}, {}, {}));
  check('absent from B2C vehicles', !(r.body.vehicles || []).some((x) => String(x._id) === String(vA._id)));
  r = await call(reg.plateOptions, req(user, {}, {}, { q: '1234' }));
  check('absent from plate picker', !JSON.stringify(r.body).includes('1234'), JSON.stringify(r.body).slice(0, 120));
  r = await call(reg.expiring, req(user, {}, {}, {}));
  check('absent from expiries', !JSON.stringify(r.body).includes(String(vA._id)));
  for (const [name, fn, q] of [['alerts', reg.alerts, {}], ['filters', reg.filterOptions, {}], ['registers', reg.registers, {}], ['driver-cards', reg.listDriverCards, {}], ['lt overview', lt.overview, {}], ['people', reg.people, {}]]) {
    const x = await call(fn, req(name === 'lt overview' ? b2cUser : user, {}, {}, q));
    check(`${name} answers 200 without the archived vehicle`, x.status === 200 && !JSON.stringify(x.body).includes(String(vA._id)), String(x.status));
  }
  const rs = require(path.join(B, 'services/reportSources'));
  check('report source still exports', !!rs);
  const ltAfter = await LightTransportEmployee.findById(ltRow._id).lean();
  check('rider released from the vehicle', !ltAfter.vehicle && !ltAfter.vehiclePlate);
  check('rider history records the release', (ltAfter.history || []).some((h) => /انتهت خدمة المركبة|أُلغي التفويض/.test(h.note || '')));
  check('running LT order ended', (await LightTransportOrder.findById(order._id).lean()).status === 'ended');
  const legacy = await Vehicle.find({ master: vA._id }).lean();
  check('legacy mirror out of service', legacy.length && legacy.every((x) => x.status === 'out_of_service'), legacy.map((x) => x.status).join(','));
  r = await call(reg.archiveList, req(user, {}, {}, {}));
  check('in archive list', (r.body.vehicles || []).some((x) => String(x._id) === String(vA._id)), `${r.body.total}`);
  r = await call(reg.getOne, req(user, { id: String(vA._id) }));
  check('profile opens archived vehicle', r.status === 200 && r.body.vehicle.archived === true);
  r = await call(reg.update, req(user, { id: String(vA._id) }, { notesAr: 'x' }));
  check('archived vehicle is read-only (edit 404)', r.status === 404);
  r = await call(reg.update, req(user, { id: String(vA._id) }, { archived: false }));
  check('archived flag cannot be cleared by an edit', r.status !== 200 || (await mongoose.connection.db.collection('vehiclemasters').findOne({ _id: vA._id })).archived === true);
  r = await call(reg.endService, req(user, { id: String(vA._id) }, { reason: 'x', date: '2026-11-10' }));
  check('ending twice answers 409', r.status === 409);

  // Restore.
  r = await call(reg.restoreService, req(user, { id: String(vA._id) }, {}));
  check('restore succeeds', r.status === 200, r.body.message);
  check('back in registry count', (await VehicleMaster.countDocuments({})) === before2);
  check('back in dashboard total', (await call(reg.dashboard, req(user, {}, {}, {}))).body.totals.vehicles === dashBefore);
  r = await call(reg.list, req(user, {}, {}, { limit: '2000' }));
  check('back in registry list', (r.body.vehicles || []).some((x) => String(x._id) === String(vA._id)));
  const rawR = await mongoose.connection.db.collection('vehiclemasters').findOne({ _id: vA._id });
  check('archive log keeps end + restore', (rawR.archiveLog || []).map((x) => x.action).join(',') === 'end,restore');
  check('renewal history still intact', (rawR.renewals || []).length === (raw.renewals || []).length);
  check('legacy mirror available again', (await Vehicle.find({ master: vA._id }).lean()).every((x) => x.status === 'available'));
  r = await call(reg.archiveList, req(user, {}, {}, {}));
  check('gone from archive list', !(r.body.vehicles || []).some((x) => String(x._id) === String(vA._id)));

  // Legacy HR-side revoke goes through the same service.
  await call(reg.authorizationAction, req(user, { id: String(vA._id) }, { action: 'assign', employeeId: String(emp._id), authorizationNumber: 'AUTH-999' }));
  const legacyV = await Vehicle.findOne({ master: vA._id });
  r = await call(vc.revokeVehicle, req(user, { id: String(legacyV._id) }, { revokedReason: 'test' }));
  vaDoc = await VehicleMaster.findById(vA._id).lean();
  check('legacy (employee file) revoke clears the paper', r.status === 200 && !vaDoc.authorizedPerson.name && !vaDoc.authorizedPerson.authorizationNumber, String(r.status));

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
