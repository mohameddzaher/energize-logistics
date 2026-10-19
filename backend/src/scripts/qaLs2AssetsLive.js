/**
 * Live QA of trailers & tires on PRODUCTION — on throwaway QA entities only, then fully removed.
 *
 *   ssh … 'cd /opt/energize/backend && node src/scripts/qaLs2AssetsLive.js'
 *
 * First run 2026-10-19: 98/98 passed, real-asset fingerprint unchanged, nothing left behind.
 *
 * Runs on the VPS from /opt/energize/backend. Talks HTTP to the running app (127.0.0.1:5001) as a
 * temporary user with Mohamed Abdulaal's role (vehicles_manager), so every request goes through the
 * real routes, guards, caches and both PM2 workers. Real trucks/trailers/tires are never touched:
 * QA plates/serials are unique, and a fingerprint of every real LS2 asset is compared before/after.
 */
require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
const crypto = require('crypto');
const mongoose = require('mongoose');

const BASE = 'http://127.0.0.1:5001';
const TAG = 'QA-LS2-TEMP';
const PLATES = ['QA 990001', 'QA 990002', 'QA 990003'];          // plateKey → 990001…
const TR = ['QA-T1', 'QA-T2', 'QA-T3'];
const POS = [
  [1, 'اطار 1 يسار', 'الرأس'], [2, 'اطار 2 يمين', 'الرأس'],
  [3, 'اطار 3 خارجي يمين', 'المحور الخلفي للرأس'], [4, 'اطار 4 داخلي يمين', 'المحور الخلفي للرأس'],
  [5, 'اطار 5 داخلي يسار', 'المحور الخلفي للرأس'], [6, 'اطار 6 خارجي يسار', 'المحور الخلفي للرأس'],
  [7, 'اطار 7 يسار', 'التيدر'], [8, 'اطار 8 يسار', 'التيدر'], [9, 'اطار 9 يسار', 'التيدر'],
  [10, 'اطار 10 يمين', 'التيدر'], [11, 'اطار 11 يمين', 'التيدر'], [12, 'اطار 12 يمين', 'التيدر'],
  [13, 'اطار 13', 'الاستبن'], [14, 'اطار 14', 'الاستبن'],
];
const results = [];
const log = (ok, step, detail = '') => { results.push({ ok, step }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${detail}` : ''}`); };

let token = null;
async function http(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, connection: 'close' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = null; try { d = await r.json(); } catch (_) { /* */ }
  return { code: r.status, d };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const F = require('../models/Ls2Flatbed'); const T = require('../models/Ls2Trailer');
  const TI = require('../models/Ls2TireAsset'); const EV = require('../models/Ls2AssetEvent');
  const { plateKey } = require('../utils/plateKey');
  const keys = PLATES.map(plateKey);

  // ── guard: QA names must be free ──────────────────────────────────────────
  if (await F.findOne({ plateKey: { $in: keys } }) || await T.findOne({ trailerNumber: { $in: TR } }) || await TI.findOne({ serial: /^QA-/ })) {
    console.log('ABORT: QA names already exist — refusing to run'); process.exit(2);
  }

  // ── snapshot ─────────────────────────────────────────────────────────────
  const fp = async () => {
    const h = crypto.createHash('sha1');
    for (const [M, sort] of [[F, { plateKey: 1 }], [T, { trailerNumber: 1 }], [TI, { serial: 1 }]]) {
      const rows = await M.find({}).sort(sort).lean();
      for (const r of rows) { delete r.updatedAt; h.update(JSON.stringify(r)); }
    }
    return h.digest('hex');
  };
  const counts = async () => Object.fromEntries(await Promise.all((await db.listCollections().toArray())
    .map(async (c) => [c.name, await db.collection(c.name).estimatedDocumentCount()])));
  const fpBefore = await fp();
  const countsBefore = await counts();
  const realEventsBefore = await EV.countDocuments();
  const startedAt = new Date();
  console.log(`snapshot: ${Object.keys(countsBefore).length} collections, real LS2 asset fingerprint ${fpBefore.slice(0, 12)}`);

  let user = null;
  const created = { flatbeds: [], trailers: [], tires: [] };
  try {
    // ── temporary user, same role as Mohamed Abdulaal ─────────────────────────
    const pass = crypto.randomBytes(12).toString('hex') + 'Aa1!';
    user = await User.create({ firstName: 'QA', lastName: TAG, email: 'qa-ls2-temp@energize.invalid', password: pass, role: 'vehicles_manager', isActive: true });
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ email: user.email, password: pass }) });
    token = (await lr.json()).accessToken;
    log(!!token, 'login as temporary vehicles_manager');

    // ── invariants (DB) + "does the screen hear it" (HTTP overview, 6 reads → both workers) ──
    const invariants = async (label) => {
      const mounted = await TI.find({ serial: /^QA-/, status: 'mounted', plateKey: { $ne: null } }).lean();
      const seen = new Map(); const dup = [];
      for (const t of mounted) { const k = `${t.plateKey}#${t.positionNumber}`; if (seen.has(k)) dup.push(`${k}: ${seen.get(k)} & ${t.serial}`); seen.set(k, t.serial); }
      log(dup.length === 0, `${label}: no two tires in one position`, dup.join('; '));
      const trailers = await T.find({ trailerNumber: { $in: TR } }).lean();
      const onPlate = new Map(trailers.filter((x) => x.currentPlateKey).map((x) => [x.currentPlateKey, x.trailerNumber]));
      const bad = mounted.filter((t) => /تيدر|تريل/.test(t.section) && (onPlate.get(t.plateKey) || null) !== (t.trailerNumber || null));
      log(bad.length === 0, `${label}: every trailer tire carries its truck's trailer number`, bad.map((t) => `${t.serial}@${t.plate}=${t.trailerNumber}`).join(', '));
      const fbs = await F.find({ plateKey: { $in: keys } }).lean();
      const fbBad = fbs.filter((f) => (f.currentTrailerNumber || null) !== (onPlate.get(f.plateKey) || null));
      log(fbBad.length === 0, `${label}: truck ↔ trailer agree`, fbBad.map((f) => `${f.plate}:${f.currentTrailerNumber}`).join(', '));
      const db1 = Object.fromEntries((await TI.find({ serial: /^QA-/ }).lean()).map((t) => [t.serial, `${t.status}|${t.plateKey}|${t.positionNumber}`]));
      let stale = 0;
      for (let i = 0; i < 6; i += 1) {
        const r = await http('GET', '/api/ls2/assets/overview');
        const api = Object.fromEntries((r.d?.tires || []).filter((t) => /^QA-/.test(t.serial)).map((t) => [t.serial, `${t.status}|${t.plateKey}|${t.positionNumber}`]));
        if (JSON.stringify(api, Object.keys(db1).sort()) !== JSON.stringify(db1, Object.keys(db1).sort())) stale += 1;
      }
      log(stale === 0, `${label}: page shows the change immediately (6/6 reads, both workers)`, stale ? `${stale}/6 reads stale` : '');
    };
    const tire = (serial) => TI.findOne({ serial }).lean();
    const where = async (serial) => { const t = await tire(serial); return t.status === 'mounted' ? `${t.plate}#${t.positionNumber}` : t.status; };
    const expect = async (serial, want, step) => { const w = await where(serial); log(w === want, step, `${serial} → ${w} (want ${want})`); };

    // ── setup through the API ─────────────────────────────────────────────────
    for (const p of PLATES) { const r = await http('POST', '/api/ls2/assets/flatbeds', { plate: p, notes: TAG }); if (r.d?._id || r.d?.flatbed?._id) created.flatbeds.push(p); log(r.code < 300, `create truck ${p}`, `${r.code}`); }
    for (const [i, n] of TR.entries()) {
      const r = await http('POST', '/api/ls2/assets/trailers', { trailerNumber: n, plate: i < 2 ? PLATES[i] : null, notes: TAG });
      log(r.code < 300, `create trailer ${n} ${i < 2 ? `on ${PLATES[i]}` : 'standing'}`, `${r.code} ${r.code >= 300 ? JSON.stringify(r.d) : ''}`);
    }
    // 14 tires on trucks 1 and 2, 4 in stock
    for (const [ti, p] of [[1, PLATES[0]], [2, PLATES[1]]]) {
      for (const [n, label, section] of POS) {
        const r = await http('POST', '/api/ls2/assets/tires', { serial: `QA-${ti}-${n}`, type: 'QA', size: '315/80R22.5', sensor: 'no', condition: 'new', plate: p, positionNumber: n, positionLabel: label, section, notes: TAG });
        if (r.code >= 300) log(false, `create tire QA-${ti}-${n}`, `${r.code} ${JSON.stringify(r.d)}`);
      }
    }
    for (let i = 1; i <= 4; i += 1) {
      const r = await http('POST', '/api/ls2/assets/tires', { serial: `QA-S-${i}`, type: 'QA', size: '315/80R22.5', sensor: 'no', condition: i <= 2 ? 'new' : 'used', notes: TAG });
      if (r.code >= 300) log(false, `create stock tire QA-S-${i}`, `${r.code} ${JSON.stringify(r.d)}`);
    }
    log((await TI.countDocuments({ serial: /^QA-/ })) === 32, 'setup: 28 mounted + 4 stock tires registered');
    await invariants('after setup');

    const id = async (serial) => String((await tire(serial))._id);
    const trId = async (n) => String((await T.findOne({ trailerNumber: n }).lean())._id);

    // 1) tire swap on the same truck (head 1 ↔ head 2)
    let r = await http('POST', `/api/ls2/assets/tires/${await id('QA-1-1')}/move`, { destination: 'swap', replacementTireId: await id('QA-1-2'), reason: TAG });
    log(r.code === 200, '1. swap two tires on the same truck', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await expect('QA-1-1', `${PLATES[0]}#2`, '1. QA-1-1 now in position 2');
    await expect('QA-1-2', `${PLATES[0]}#1`, '1. QA-1-2 now in position 1');
    await invariants('after 1');

    // 2) tire swap between two trucks
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-1-3')}/move`, { destination: 'swap', replacementTireId: await id('QA-2-3'), reason: TAG });
    log(r.code === 200, '2. swap tires between two trucks', `${r.code}`);
    await expect('QA-1-3', `${PLATES[1]}#3`, '2. QA-1-3 on truck 2');
    await expect('QA-2-3', `${PLATES[0]}#3`, '2. QA-2-3 on truck 1');
    await invariants('after 2');

    // 3) mount a stock tire onto an occupied position WITHOUT saying where the old one goes → must be refused
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-S-1')}/move`, { toPlate: PLATES[0], positionNumber: 4, positionLabel: POS[3][1], section: POS[3][2], reason: TAG });
    log(r.code === 400 && r.d?.code === 'DISPLACED_FATE_REQUIRED', '3. occupied position without a fate is refused (no stacking)', `${r.code} ${r.d?.code || ''}`);
    await expect('QA-1-4', `${PLATES[0]}#4`, '3. the tire already there is untouched');
    await invariants('after 3');

    // 4) same, with the old tire going to the store as used
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-S-1')}/move`, { toPlate: PLATES[0], positionNumber: 4, positionLabel: POS[3][1], section: POS[3][2], displacedTo: 'used', reason: TAG });
    log(r.code === 200, '4. replace a mounted tire with a stock tire (old → store)', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await expect('QA-S-1', `${PLATES[0]}#4`, '4. new tire in position 4');
    const old4 = await tire('QA-1-4');
    log(old4.status !== 'mounted' && !old4.plateKey, '4. old tire left the truck to the store', `${old4.status}`);
    await invariants('after 4');

    // 5) dismount a tire with no replacement → refused (a position never stays empty)
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-1-5')}/move`, { toPlate: null, destination: 'used', reason: TAG });
    log(r.code === 400, '5. dismount without a replacement is refused', `${r.code} ${r.d?.code || r.d?.message || ''}`);
    await expect('QA-1-5', `${PLATES[0]}#5`, '5. tire still mounted');

    // 6) dismount with a replacement from stock
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-1-5')}/move`, { toPlate: null, destination: 'used', replacementTireId: await id('QA-S-2'), reason: TAG });
    log(r.code === 200, '6. dismount with a stock replacement', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await expect('QA-S-2', `${PLATES[0]}#5`, '6. replacement took the empty position');
    await invariants('after 6');

    // 7) move a tire from truck 2 into an occupied position on truck 1 with a replacement chain from stock
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-2-6')}/move`, { toPlate: PLATES[0], positionNumber: 6, positionLabel: POS[5][1], section: POS[5][2], displacedTo: 'used', replacementTireId: await id('QA-S-3'), reason: TAG });
    log(r.code === 200, '7. move a tire to another truck\'s occupied position, backfilled from stock', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await expect('QA-2-6', `${PLATES[0]}#6`, '7. tire now on truck 1 #6');
    await expect('QA-S-3', `${PLATES[1]}#6`, '7. stock tire filled truck 2 #6');
    await invariants('after 7');

    // 8) spare: take a spare off with no replacement (the only slot allowed to stay empty)
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-2-14')}/move`, { toPlate: null, destination: 'used', reason: TAG });
    log(r.code === 200, '8. spare may come off with no replacement', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await invariants('after 8');

    // ── trailers ──────────────────────────────────────────────────────────────
    const trailerTires = async (n) => (await TI.find({ serial: /^QA-/, trailerNumber: n, status: 'mounted' }).lean()).map((t) => t.plate || 'standing');
    const t1Before = (await trailerTires('QA-T1')).length; const t2Before = (await trailerTires('QA-T2')).length;
    log(t1Before === 6 && t2Before === 6, 'trailers carry 6 tires each before moving', `${t1Before}/${t2Before}`);

    // 9) truck side: on truck 1 choose trailer T2 with SWAP (T1 goes to truck 2)
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T2')}/move`, { toPlate: PLATES[0], reason: TAG, displacedTo: 'swap' });
    log(r.code === 200, '9. swap trailers from the truck side', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    let a = await trailerTires('QA-T2'); let b = await trailerTires('QA-T1');
    log(a.length === 6 && a.every((p) => p === PLATES[0]), '9. all 6 T2 tires moved to truck 1', a.join(','));
    log(b.length === 6 && b.every((p) => p === PLATES[1]), '9. all 6 T1 tires moved to truck 2 (not stacked on truck 1)', b.join(','));
    await invariants('after 9');

    // 10) swap back → everything returns
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T1')}/move`, { toPlate: PLATES[0], reason: TAG, displacedTo: 'swap' });
    log(r.code === 200, '10. swap back', `${r.code}`);
    a = await trailerTires('QA-T1'); b = await trailerTires('QA-T2');
    log(a.every((p) => p === PLATES[0]) && b.every((p) => p === PLATES[1]) && a.length === 6 && b.length === 6, '10. both trailers back with their own tires', `${a.join(',')} | ${b.join(',')}`);
    await invariants('after 10');

    // 11) hitch standing T3 onto empty truck 3, then change truck 1's trailer to T3 with T1 standing alone
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T3')}/move`, { toPlate: PLATES[2], reason: TAG, displacedTo: 'standing' });
    log(r.code === 200 && (await F.findOne({ plateKey: keys[2] }).lean()).currentTrailerNumber === 'QA-T3', '11. hitch a standing trailer onto an empty truck', `${r.code}`);
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T3')}/move`, { toPlate: PLATES[0], reason: TAG, displacedTo: 'standing' });
    log(r.code === 200, '12. change truck 1\'s trailer; old one stands alone', `${r.code}`);
    a = await trailerTires('QA-T1');
    log(a.length === 6 && a.every((p) => p === 'standing'), '12. T1 stands alone with all 6 of its tires', a.join(','));
    log(!(await F.findOne({ plateKey: keys[2] }).lean()).currentTrailerNumber, '12. truck 3 is now empty');
    await invariants('after 12');

    // 13) rehitch T1 (standing) onto truck 3 → its tires come back from "standing"
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T1')}/move`, { toPlate: PLATES[2], reason: TAG });
    a = await trailerTires('QA-T1');
    log(r.code === 200 && a.length === 6 && a.every((p) => p === PLATES[2]), '13. standing trailer rehitched — its 6 tires came with it', a.join(','));
    await invariants('after 13');

    // 14) swap is refused when the incoming trailer stands alone
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T3')}/move`, { toPlate: null, reason: TAG });
    r = await http('POST', `/api/ls2/assets/trailers/${await trId('QA-T3')}/move`, { toPlate: PLATES[1], reason: TAG, displacedTo: 'swap' });
    log(r.code === 400 && (await F.findOne({ plateKey: keys[1] }).lean()).currentTrailerNumber === 'QA-T2', '14. swap with a standing trailer is refused, nothing moved', `${r.code}`);
    await invariants('after 14');

    // 15) a tire swap after trailers moved still respects positions
    r = await http('POST', `/api/ls2/assets/tires/${await id('QA-2-7')}/move`, { destination: 'swap', replacementTireId: await id('QA-1-8'), reason: TAG });
    log(r.code === 200, '15. swap trailer tires between trucks after the trailer moves', `${r.code} ${r.code !== 200 ? JSON.stringify(r.d) : ''}`);
    await invariants('after 15');
  } catch (e) {
    log(false, 'test crashed', e.stack);
  } finally {
    // ── cleanup: everything the test created, nothing else ─────────────────────
    const ids = [
      ...(await F.find({ plateKey: { $in: keys } }).select('_id').lean()),
      ...(await T.find({ trailerNumber: { $in: TR } }).select('_id').lean()),
      ...(await TI.find({ serial: /^QA-/ }).select('_id').lean()),
    ].map((x) => x._id);
    const del = {};
    del.events = (await EV.deleteMany({ $or: [{ refId: { $in: ids } }, { fromPlateKey: { $in: keys } }, { toPlateKey: { $in: keys } }] })).deletedCount;
    del.tires = (await TI.deleteMany({ serial: /^QA-/ })).deletedCount;
    del.trailers = (await T.deleteMany({ trailerNumber: { $in: TR } })).deletedCount;
    del.flatbeds = (await F.deleteMany({ plateKey: { $in: keys } })).deletedCount;
    if (user) {
      del.audit = (await db.collection('auditlogs').deleteMany({ $or: [{ user: user._id }, { userId: user._id }, { entityId: { $in: ids } }] })).deletedCount;
      // every logged asset move also posts an activity notification titled with the actor's name
      // (recipient null, broadcast) — matched by the QA name and the test window, nothing else.
      del.notifications = (await db.collection('notifications').deleteMany({ $or: [
        { relatedEntityId: { $in: ids } }, { recipient: user._id }, { sender: user._id },
        { createdAt: { $gte: startedAt }, title: new RegExp(TAG) },
      ] })).deletedCount;
      del.activity = (await db.collection('activitylogs').deleteMany({ $or: [{ user: user._id }, { userId: user._id }] }).catch(() => ({ deletedCount: 0 }))).deletedCount;
      del.user = (await User.deleteOne({ _id: user._id })).deletedCount;
    }
    // drop cached overview so no worker keeps showing QA rows
    try { require('../utils/ttlCache').clear('ls2assets'); require('../utils/ttlCache').clear('ls2'); } catch (_) { /* */ }
    console.log('\ncleanup removed:', JSON.stringify(del));

    // ── proof nothing real changed and nothing is left ─────────────────────────
    const fpAfter = await fp();
    log(fpAfter === fpBefore, 'real trucks/trailers/tires are byte-identical to before the test', `${fpBefore.slice(0, 12)} → ${fpAfter.slice(0, 12)}`);
    const left = await TI.countDocuments({ serial: /^QA-/ }) + await T.countDocuments({ trailerNumber: { $in: TR } }) + await F.countDocuments({ plateKey: { $in: keys } }) + await User.countDocuments({ lastName: TAG });
    log(left === 0, 'no QA truck/trailer/tire/user left');
    const countsAfter = await counts();
    const diffs = Object.keys({ ...countsBefore, ...countsAfter }).filter((k) => (countsBefore[k] || 0) !== (countsAfter[k] || 0))
      .map((k) => `${k}: ${countsBefore[k] || 0}→${countsAfter[k] || 0}`);
    // a real user may write while the test runs — those rows are theirs; show what moved and when
    const realNew = {};
    for (const d of diffs) {
      const name = d.split(':')[0];
      realNew[name] = await db.collection(name).countDocuments({ createdAt: { $gte: startedAt } }).catch(() => '?');
    }
    console.log('collection counts that differ from before:', diffs.length ? diffs.join(' | ') : 'none');
    if (diffs.length) console.log('  rows created by others during the test window:', JSON.stringify(realNew));
    console.log(`asset events: ${realEventsBefore} before → ${await EV.countDocuments()} after`);
    const failed = results.filter((x) => !x.ok);
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
    if (failed.length) console.log('FAILED:\n  ' + failed.map((x) => x.step).join('\n  '));
    await mongoose.disconnect();
    process.exit(failed.length ? 1 : 0);
  }
})();
