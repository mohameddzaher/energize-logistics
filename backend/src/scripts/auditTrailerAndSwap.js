/* eslint-disable no-console */
/**
 * auditTrailerAndSwap — نقل التيدر، واستبدال الكاوتش، والتاريخ.
 *
 *   node src/scripts/auditTrailerAndSwap.js --base https://api.energize-logistics.com
 *
 * تلات أسئلة:
 *
 * ① نقل التيدر من عربية لعربية شغّال **صح**؟
 *    الصح مش إن السجل يتغيّر — الصح إن **كاوتشه يمشي معاه**. كان بيتغيّر السجل
 *    وبس، فالعربية القديمة تفضل مسجّل عليها ١٤ إطار وفيهم ٦ مش عليها،
 *    والجديدة ٨. التيست بيعدّ الإطارات على الاتنين قبل وبعد.
 *
 * ② استبدال الكاوتش شغّال؟ الداخل ⇐ الخارج: الفردة الجديدة تاخد الموقع،
 *    والقديمة تروح المكان اللي اتحدّد لها (مخزن / تجديد / تالفة / سكراب).
 *
 * ③ كل حركة بتتسجّل في التاريخ؟ الحركة اللي ما اتسجّلتش كأنها ما حصلتش —
 *    الورشة بتحاسب على عمر الإطار من التاريخ ده.
 *
 * كله بيتعمل على **عربيات وتيدر وكاوتش اختبار** بيتعملوا ويتمسحوا. مفيش سجل
 * شغّال بيتلمس.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');

let pass = 0; let fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗ FAIL'}  ${l}${x ? '   — ' + x : ''}`); c ? pass++ : fail++; };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const Ls2Flatbed = require('../models/Ls2Flatbed');
  const Ls2Trailer = require('../models/Ls2Trailer');
  const Ls2TireAsset = require('../models/Ls2TireAsset');
  const Ls2AssetEvent = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');

  const A = 'ZZ 8001'; const B = 'ZZ 8002';
  const kA = plateKey(A); const kB = plateKey(B);
  const TNUM = 'ZZ99';

  const cleanup = async () => {
    const ids = (await Ls2TireAsset.find({ serial: { $regex: '^ZZT-' } }).select('_id').lean()).map((x) => x._id);
    const trs = (await Ls2Trailer.find({ trailerNumber: { $regex: `^${TNUM}` } }).select('_id').lean()).map((x) => x._id);
    await Ls2AssetEvent.deleteMany({
      $or: [{ refId: { $in: [...ids, ...trs] } }, { fromPlateKey: { $in: [kA, kB] } }, { toPlateKey: { $in: [kA, kB] } }],
    });
    await Ls2TireAsset.deleteMany({ serial: { $regex: '^ZZT-' } });
    await Ls2Trailer.deleteMany({ trailerNumber: { $regex: `^${TNUM}` } });
    await Ls2Flatbed.deleteMany({ plateKey: { $in: [kA, kB] } });
  };
  await cleanup();
  await User.deleteMany({ email: { $regex: '^zz-trswap' } });

  const u = await User.create({
    email: 'zz-trswap@example.invalid', password: 'Test@12345',
    firstName: 'ت', lastName: 'ن', role: 'super_admin', isActive: true,
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'Test@12345' }),
  });
  if (lr.status === 429) { console.error('RATE LIMITED'); process.exit(2); }
  const ck = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const post = async (p, body) => {
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify(body),
    });
    let j = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j };
  };
  const countOn = (key) => Ls2TireAsset.countDocuments({ plateKey: key, status: 'mounted' });
  const evOf = (id) => Ls2AssetEvent.find({ refId: id }).sort({ createdAt: 1 }).lean();

  try {
    // ── التجهيز: عربيتين، تيدر على A، وكاوتش ──────────────────────────────
    await Ls2Flatbed.create([{ plate: A, plateKey: kA }, { plate: B, plateKey: kB }]);
    const mk = (serial, extra) => post('/api/ls2/assets/tires', {
      serial, tireNumber: serial, type: 'Test', ...extra,
    });
    // ٦ إطارات رأس على A، و٦ إطارات تيدر على A مربوطة بالتيدر
    for (let i = 1; i <= 6; i++) {
      await mk(`ZZT-H${i}`, { plate: A, positionNumber: i, positionLabel: `اطار ${i}`, section: 'الرأس' });
    }
    const trailer = await Ls2Trailer.create({ trailerNumber: TNUM, currentPlate: A, currentPlateKey: kA, status: 'active' });
    await Ls2Flatbed.updateOne({ plateKey: kA }, { currentTrailerNumber: TNUM });
    for (let i = 7; i <= 12; i++) {
      await mk(`ZZT-T${i}`, { plate: A, positionNumber: i, positionLabel: `اطار ${i}`, section: 'التريلة' });
    }
    await Ls2TireAsset.updateMany({ serial: { $regex: '^ZZT-T' } }, { $set: { trailerNumber: TNUM } });
    const spare = (await mk('ZZT-SPARE', {})).body?.tire;   // في المخزن

    ok(`تجهيز: ${A} عليها ${await countOn(kA)} إطار · ${B} عليها ${await countOn(kB)}`,
      (await countOn(kA)) === 12 && (await countOn(kB)) === 0);

    // ═══ ① نقل التيدر من A لـ B ═══════════════════════════════════════════
    console.log('\n── نقل التيدر من عربية لعربية ──');
    const mv = await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: B, reason: 'تيست' });
    ok('النقل نجح', mv.status === 200, `HTTP ${mv.status} ${mv.body?.message || ''}`);

    const t2 = await Ls2Trailer.findById(trailer._id).lean();
    ok(`التيدر بقى على ${B}`, t2.currentPlateKey === kB, t2.currentPlate || '—');
    const fA = await Ls2Flatbed.findOne({ plateKey: kA }).lean();
    const fB = await Ls2Flatbed.findOne({ plateKey: kB }).lean();
    ok('العربية القديمة بقت من غير تيدر', !fA.currentTrailerNumber, fA.currentTrailerNumber || '');
    ok('والجديدة عليها التيدر', fB.currentTrailerNumber === TNUM, fB.currentTrailerNumber || '—');

    // ** الحاجة اللي كانت مكسورة **
    const [onA, onB] = [await countOn(kA), await countOn(kB)];
    ok(`وكاوتش التيدر مشي معاه: ${A} → ${onA} (رأس بس) · ${B} → ${onB} (تيدر)`,
      onA === 6 && onB === 6, `${onA}/${onB}`);
    const stray = await Ls2TireAsset.countDocuments({ plateKey: kA, section: /تيدر|تريل/, status: 'mounted' });
    ok('مفيش إطار تيدر فاضل على العربية القديمة', stray === 0, `${stray} إطار`);

    // ── التاريخ سجّل النقل، للتيدر ولكل فردة ───────────────────────────────
    const tEv = await evOf(trailer._id);
    ok('حركة التيدر اتسجّلت', tEv.some((e) => e.action === 'transferred' && e.toPlateKey === kB));
    const oneTire = await Ls2TireAsset.findOne({ serial: 'ZZT-T7' }).lean();
    const tireEv = await evOf(oneTire._id);
    ok('وحركة كل فردة تيدر اتسجّلت باسم التيدر',
      tireEv.some((e) => e.action === 'transferred' && e.toPlateKey === kB && /تيدر/.test(e.reason || '')),
      tireEv.map((e) => e.action).join(' → '));

    // ── ورجوع: التيدر ينزل ويقف لوحده ──────────────────────────────────────
    const off = await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: null, reason: 'تيست وقوف' });
    ok('التيدر ينزل ويقف لوحده', off.status === 200, `HTTP ${off.status}`);
    const standing = await Ls2TireAsset.find({ trailerNumber: TNUM, status: 'mounted' }).lean();
    ok(`وكاوتشه فاضل عليه (${standing.length} إطار، من غير عربية)`,
      standing.length === 6 && standing.every((t) => !t.plateKey));
    ok(`و${B} رجعت ${await countOn(kB)} إطار`, (await countOn(kB)) === 0);
    // نرجّعه على B عشان باقي التيست
    await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: B, reason: 'رجوع' });

    // ═══ ①ب التيدر رايح على عربية عليها تيدر — لازم يتحدّد يروح فين ═══════
    console.log('\n── تيدر مكانه تيدر ──');
    const other = await Ls2Trailer.create({ trailerNumber: `${TNUM}B`, currentPlate: A, currentPlateKey: kA, status: 'active' });
    await Ls2Flatbed.updateOne({ plateKey: kA }, { currentTrailerNumber: `${TNUM}B` });
    for (let i = 7; i <= 12; i++) {
      await mk(`ZZT-X${i}`, { plate: A, positionNumber: i, positionLabel: `اطار ${i}`, section: 'التريلة' });
    }
    await Ls2TireAsset.updateMany({ serial: { $regex: '^ZZT-X' } }, { $set: { trailerNumber: `${TNUM}B` } });

    // من غير ما نقول التيدر القديم يروح فين ⇒ مرفوض
    const noFate = await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: A, displacedTo: '' });
    ok('من غير تحديد مصير التيدر اللي مكانه ⇒ مرفوض',
      noFate.status === 400 && noFate.body?.code === 'DISPLACED_TRAILER_FATE_REQUIRED', `HTTP ${noFate.status}`);

    // تبديل كامل: TNUM (على B) ⟷ TNUM_B (على A)
    const swap = await post(`/api/ls2/assets/trailers/${trailer._id}/move`, {
      toPlate: A, displacedTo: 'swap', reason: 'تبديل تيدرين',
    });
    ok('تبديل تيدرين بين عربيتين', swap.status === 200, `HTTP ${swap.status} ${swap.body?.message || ''}`);
    const [t3, o3] = [await Ls2Trailer.findById(trailer._id).lean(), await Ls2Trailer.findById(other._id).lean()];
    ok(`${TNUM} راح ${A} و${TNUM}B راح ${B}`, t3.currentPlateKey === kA && o3.currentPlateKey === kB,
      `${t3.currentPlate} / ${o3.currentPlate}`);
    const tOnA = await Ls2TireAsset.countDocuments({ trailerNumber: TNUM, plateKey: kA, status: 'mounted' });
    const tOnB = await Ls2TireAsset.countDocuments({ trailerNumber: `${TNUM}B`, plateKey: kB, status: 'mounted' });
    ok(`وكاوتش الاتنين مشي معاهم (${tOnA} + ${tOnB})`, tOnA === 6 && tOnB === 6, `${tOnA}/${tOnB}`);
    ok(`العربيتين ١٢ و٦: ${await countOn(kA)} / ${await countOn(kB)}`,
      (await countOn(kA)) === 12 && (await countOn(kB)) === 6);

    // تيدر واقف ياخد مكان مركّب، والمركّب يقف
    const standingTr = await Ls2Trailer.findById(other._id);   // على B
    await post(`/api/ls2/assets/trailers/${standingTr._id}/move`, { toPlate: null, reason: 'يقف' });
    ok(`${TNUM}B وقف لوحده وكاوتشه معاه`,
      (await Ls2TireAsset.countDocuments({ trailerNumber: `${TNUM}B`, status: 'mounted', plateKey: null })) === 6);
    const back = await post(`/api/ls2/assets/trailers/${standingTr._id}/move`, {
      toPlate: A, displacedTo: 'standing', reason: 'واقف ياخد مكان مركّب',
    });
    ok('تيدر واقف بيترکب واللي مكانه يقف', back.status === 200, `HTTP ${back.status} ${back.body?.message || ''}`);
    const nowOnA = await Ls2Trailer.findOne({ currentPlateKey: kA }).lean();
    const nowStanding = await Ls2Trailer.findById(trailer._id).lean();
    ok(`${TNUM}B بقى على ${A} و${TNUM} وقف`,
      nowOnA?.trailerNumber === `${TNUM}B` && !nowStanding.currentPlateKey);
    ok('وكاوتش اللي وقف نزل معاه',
      (await Ls2TireAsset.countDocuments({ trailerNumber: TNUM, status: 'mounted', plateKey: null })) === 6);

    // لوحة مالهاش سطحة ⇒ مرفوض (ده اللي حصل مع تيدر ٢٧)
    const ghost = await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: 'ZZ 9999' });
    ok('نقل لعربية مش موجودة ⇒ مرفوض', ghost.status === 400, `HTTP ${ghost.status}`);

    // نرجّع الوضع: TNUM على A عشان باقي التيست
    await post(`/api/ls2/assets/trailers/${standingTr._id}/move`, { toPlate: null });
    await post(`/api/ls2/assets/trailers/${trailer._id}/move`, { toPlate: A });

    // ═══ ② استبدال كاوتش ═══════════════════════════════════════════════════
    console.log('\n── استبدال فردة كاوتش ──');
    const old = await Ls2TireAsset.findOne({ serial: 'ZZT-H3' }).lean();
    const rep = await post(`/api/ls2/assets/tires/${old._id}/move`, {
      toPlate: null, destination: 'store', conditionPercent: 65,
      replacementTireId: spare._id, reason: 'تيست استبدال',
    });
    ok('الاستبدال نجح', rep.status === 200, `HTTP ${rep.status} ${rep.body?.message || ''}`);
    const newAt3 = await Ls2TireAsset.findOne({ plateKey: kA, positionNumber: 3, status: 'mounted' }).lean();
    ok('البديل اترکب في نفس الموقع', newAt3 && newAt3.serial === 'ZZT-SPARE', newAt3?.serial || 'فاضي');
    const oldNow = await Ls2TireAsset.findById(old._id).lean();
    ok(`والقديمة راحت المخزن بنسبتها (${oldNow.status} · ${oldNow.conditionPercent}%)`,
      oldNow.status === 'spare' && oldNow.conditionPercent === 65 && !oldNow.plateKey);
    const onAafter = await countOn(kA);
    const brk = await Ls2TireAsset.find({ plateKey: kA, status: 'mounted' }).select('serial section positionNumber trailerNumber').lean();
    ok(`و${A} لسه ${onAafter} إطار (ما زادتش وما نقصتش)`, onAafter === 12,
      brk.map((x) => `${x.serial}@${x.positionNumber}`).join(' '));

    // التاريخ للاتنين
    const oldEv = await evOf(old._id);
    const newEv = await evOf(spare._id);
    ok('تاريخ الفردة النازلة فيه الإنزال',
      oldEv.some((e) => ['removed', 'to_repair', 'scrapped', 'damaged'].includes(e.action) && e.fromPlateKey === kA),
      oldEv.map((e) => e.action).join(' → '));
    ok('وتاريخ البديلة فيه التركيب في نفس الموقع',
      newEv.some((e) => e.action === 'mounted' && e.toPlateKey === kA),
      newEv.map((e) => e.action).join(' → '));

    // ── والاتنين بيبانوا في تاريخ العربية ─────────────────────────────────
    const hist = await (await fetch(`${BASE}/api/ls2/assets/vehicle/${encodeURIComponent(A)}/history`, { headers: { Cookie: ck } })).json();
    const rows = hist?.rows || [];
    ok(`تاريخ العربية فيه ${rows.filter((r) => r.kind === 'tire').length} حركة كاوتش`,
      rows.some((r) => String(r.title).includes('ZZT-H3')) && rows.some((r) => String(r.title).includes('ZZT-SPARE')),
      rows.slice(0, 3).map((r) => r.title).join(' | '));

    // ═══ ③ القواعد لسه مفروضة ══════════════════════════════════════════════
    console.log('\n── القواعد ──');
    const head1 = await Ls2TireAsset.findOne({ plateKey: kA, positionNumber: 1, status: 'mounted' }).lean();
    const bare = await post(`/api/ls2/assets/tires/${head1._id}/move`, { toPlate: null, destination: 'store' });
    ok('إنزال من غير بديل لسه مرفوض', bare.status === 400 && bare.body?.code === 'REPLACEMENT_REQUIRED', `HTTP ${bare.status}`);
    ok('والعربية ما اتغيّرتش', (await countOn(kA)) === onAafter, `${await countOn(kA)} مقابل ${onAafter}`);
  } finally {
    await cleanup();
    await Employee.deleteMany({ email: { $regex: '^zz-trswap' } });
    await User.deleteMany({ email: { $regex: '^zz-trswap' } });
  }
  ok('التدقيق ما سابش أثر',
    (await Ls2TireAsset.countDocuments({ serial: { $regex: '^ZZT-' } })) === 0
    && (await Ls2Flatbed.countDocuments({ plateKey: { $in: [kA, kB] } })) === 0
    && (await Ls2Trailer.countDocuments({ trailerNumber: { $regex: `^${TNUM}` } })) === 0);

  console.log(`\n${'─'.repeat(62)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
