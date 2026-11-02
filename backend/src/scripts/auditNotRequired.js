/**
 * Not-required applies on every screen, not only the family page.
 * A test vehicle with no documents is read everywhere, then each family is marked not required and read again. The difference between the two reads is what the user sees.
 */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { VehicleMaster } = require('../models/VehicleMaster');
  const VDOC = require('../config/vehicleDocuments');
  const c = require('../controllers/vehicleRegistryController');
  const user = { _id: new mongoose.Types.ObjectId(), role: 'super_admin' };

  const call = (fn, req) => new Promise((r) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ code: this.statusCode, body: b }); } };
    fn({ query: {}, params: {}, body: {}, user, ip: '', ...req }, res).catch((e) => r({ code: 500, body: { err: e.message } }));
  });

  const PLATE = 'اختبار غم 9999';
  await VehicleMaster.deleteMany({ plateNumber: PLATE });
  const made = await call(c.create, { body: { plateNumber: PLATE, sectorAr: 'اختبار' } });
  const id = made.body?.vehicle?._id;
  if (!id) { console.log('تعذّر الإنشاء:', JSON.stringify(made.body)); process.exit(1); }

  // Reads the vehicle itself, not the register list: the list is cached for thirty seconds, so the second read returned the first answer and hid the difference.
  const VDOCcfg = (await require('../models/VehicleMaster').VehicleRegistryConfig.findOne().lean()) || {};
  const alerts = VDOCcfg.alerts || {};
  const get = (o, p2) => p2.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

  const readAll = async (label) => {
    const v = await VehicleMaster.findById(id).lean();
    const exp = await call(c.expiring, { query: { withinDays: '3650', _t: String(Date.now()) } });
    const inExpiring = (exp.body?.rows || []).filter((r) => String(r.plateNumber || '') === PLATE);

    const lines = []; const need = [];
    for (const d of VDOC.DOCUMENTS) {
      const { state } = VDOC.stateOf(get(v, d.path), get(v, d.statusPath), alerts[d.key] || {});
      const mapped = state === 'not_applicable' ? 'not_required' : state === 'missing' ? 'none' : state;
      lines.push(`${d.ar}=${mapped}`);
      // Exactly as the required-missing chip on the family page computes it:
      // docNeed === 'required' || stateOf(...).state === 'missing'
      const code = String(get(v, d.statusPath) || '');
      const dn = get(v, d.path) ? 'have'
        : (code === 'not_required' || code === 'not_in_use') ? 'not_required'
        : (code === 'required' || code === 'none' || code === '') ? 'required' : 'unknown';
      const feState = mapped === 'none' ? 'missing' : mapped === 'not_required' ? 'not_applicable' : mapped;
      if (dn === 'required' || feState === 'missing') need.push(d.ar);
    }
    console.log(`\n  ── ${label} ──`);
    console.log(`    حالاتُ العائلات: ${lines.join('  ')}`);
    console.log(`    صفوفُها في «قرب انتهاؤه»: ${inExpiring.length}`);
    console.log(`    تُعَدّ «مطلوب — ناقص» في: ${need.length ? need.join('، ') : 'لا شيء ✓'}`);
    return need.length;
  };

  const before = await readAll('قبل: بلا أوراقَ ولا وضعٍ مسجَّل');

  // Exactly what the new button does.
  const patch = {};
  for (const d of VDOC.DOCUMENTS) {
    const [obj, key] = d.statusPath.split('.');
    patch[obj] = { ...(patch[obj] || {}), [key]: 'not_required' };
  }
  const upd = await call(c.update, { params: { id: String(id) }, body: patch });
  console.log(`\n  الحفظ (كما يرسله النموذج): ${upd.code === 200 ? '✓' : '✗ ' + JSON.stringify(upd.body)}`);
  const after = await readAll('بعد: كلُّها «غير مطلوب»');

  console.log(`\n  النتيجة: ${before} ← ${after}  ${after === 0 && before > 0 ? '✓ خرجت من قوائم العمل كلِّها' : '✗ راجِع'}`);
  await VehicleMaster.deleteMany({ _id: id });
  console.log('  (حُذفت مركبةُ الاختبار)\n');
  await mongoose.disconnect();
})();
