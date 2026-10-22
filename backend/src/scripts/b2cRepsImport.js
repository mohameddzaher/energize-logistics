/**
 * b2cRepsImport — شيتُ «تقرير تحقيق المناديب» إلى سجلّ النقل الخفيف، مرّةً واحدة
 * (صاحبُ الشركة، ٢٠٢٦/١٠/١٩). وبعدها: ما يُكتب على النظام وحدَه.
 *
 *   node src/scripts/b2cRepsImport.js <xlsx>            ← عرضٌ فقط
 *   node src/scripts/b2cRepsImport.js <xlsx> --apply
 *
 * من ورقة «الإدخال اليومي» لكلّ مندوب: رقمُ الإقامة، والاسم، والمشروع، والجهة
 * (كفالة · فري لانسر · يوزرات)، والمشرف، وتاريخ البدء.
 *
 * ١. المشاريع: كيتا · هنجرستيشن · نينجا · امازون بأسمائها العربيّة وأهدافها من
 *    ورقة «الإعدادات» (٤٥٠ · ٤٥٠ · ٣٦٠ · امازون شحناتٌ بلا هدف).
 * ٢. صفُّ المندوب في سجلّ النقل الخفيف: يُطابَق برقم الإقامة (واليوزرُ بلا إقامةٍ
 *    باسمه)، ويُنشأ إن لم يوجد. ويُكتب فيه المشروعُ والجهةُ والمشرف — وكلُّ تغييرٍ
 *    في سجلّه بصاحبه («مطابقة شيت التحقيق ١٧/١٠»).
 * ٣. حسابُ طلباته: كان المندوبُ في الشيتات اسمًا، فصار في النظام أكثرُ من حسابٍ
 *    للرجل الواحد. يُختار الحسابُ الذي **يطابق مجموعُه من ١ إلى ١٥ أكتوبر رقمَ
 *    الشيت** («إجمالي حتى ١٥/١٠») — فتتّصل طلباتُه الماضيةُ بما يُكتب بعدُ —
 *    ويُفكّ الربطُ الخاطئ إن وُجد.
 * ٤. مشاريعُ المشرفين: ما في الشيت لكلّ مشرف (مَن يرى ماذا في مدخلات الأوردرات).
 * ٥. امازون: لا طلباتَ له في النظام؛ تُكتب أيّامُه المفصّلةُ في الشيت (١٥–١٧).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file) { console.error('usage: b2cRepsImport.js <xlsx> [--apply]'); process.exit(1); }
const S = (v) => String(v ?? '').trim();
const fold = (v) => S(v).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/[^a-z0-9ء-ي]/g, '');
const serialToIso = (n) => (typeof n === 'number' && n > 30000 ? new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) : null);
const NOTE = 'مطابقة شيت التحقيق 17/10/2026';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  require('../models/Employee'); // listSupervisors يقرأ ملفّاتِ المشرفين
  const { LightTransportEmployee } = require('../models/LightTransport');
  const B2CRep = require('../models/B2CRep');
  const B2CProject = require('../models/B2CProject');
  const B2CDailyOrder = require('../models/B2CDailyOrder');
  const User = require('../models/User');
  const Lookup = require('../models/Lookup');
  const { listSupervisors } = require('../utils/b2cSupervisors');
  const E = require('../utils/b2cEntry');

  // ── الشيت ────────────────────────────────────────────────────────────────
  const wb = XLSX.readFile(file);
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['الإدخال اليومي'], { header: 1, raw: true, defval: '' });
  const head = grid[2];
  const dayCols = head.map((h, i) => [h, i]).filter(([h]) => typeof h === 'number').map(([h, i]) => ({ i, iso: serialToIso(h) }));
  const reps = grid.slice(4).filter((r) => S(r[0]) || S(r[1])).map((r) => ({
    id: S(r[0]), name: S(r[1]), project: S(r[2]), start: serialToIso(r[5]), month: Number(r[8]) || 0,
    base: r[9] === '' ? null : Number(r[9]), kind: S(r[29]), sup: S(r[30]), status: S(r[31]),
    days: Object.fromEntries(dayCols.map((c) => [c.iso, r[c.i] === '' ? null : Number(r[c.i])])),
  }));
  const settings = XLSX.utils.sheet_to_json(wb.Sheets['الإعدادات'], { header: 1, raw: true, defval: '' });
  const targets = {};
  for (const r of settings) if (['هنجرستيشن', 'كيتا', 'نينجا', 'امازون'].includes(S(r[0]))) targets[S(r[0])] = Number(r[1]) || 0;
  console.log(`الشيت: ${reps.length} مندوب · الأيام المفصّلة: ${dayCols.filter((c) => reps.some((r) => r.days[c.iso] != null)).map((c) => c.iso.slice(5)).join('، ')} · الأهداف: ${JSON.stringify(targets)}`);

  // ── ١. المشاريع ─────────────────────────────────────────────────────────
  const PNAMES = { 'كيتا': /keeta|كيتا/i, 'هنجرستيشن': /hunger|هنجر|هنقر/i, 'نينجا': /ninja|نينجا/i, 'امازون': /amazon|امازون/i };
  const allP = await B2CProject.find({}).lean();
  const projOf = {};
  for (const [ar, re] of Object.entries(PNAMES)) {
    let p = allP.find((x) => re.test(`${x.name} ${x.nameAr || ''}`));
    const mt = targets[ar] ?? 450;
    const set = { nameAr: ar, monthlyTarget: mt, dailyTarget: mt ? Math.round(mt / 30) : 0, unitAr: mt ? 'طلب' : 'شحنة', isActive: true };
    if (!p) { console.log(`  + مشروع «${ar}» (Amazon) هدف ${mt}`); if (APPLY) p = (await B2CProject.create({ name: ar === 'امازون' ? 'Amazon' : ar, ...set })).toObject(); else p = { _id: new mongoose.Types.ObjectId(), ...set, name: ar }; }
    else { console.log(`  ~ ${p.name}: الاسم «${ar}» · الهدف ${p.monthlyTarget} ← ${mt}`); if (APPLY) await B2CProject.updateOne({ _id: p._id }, { $set: set }); }
    projOf[ar] = { ...p, ...set };
  }
  if (APPLY && !(await Lookup.exists({ type: 'lt_contract_type', nameAr: 'يوزرات', deleted: { $ne: true } }))) {
    await Lookup.create({ type: 'lt_contract_type', key: 'users', nameAr: 'يوزرات', nameEn: 'Rented users', order: 9, isActive: true, isSystem: false }).catch(() => {});
  }

  // ── المشرفون ─────────────────────────────────────────────────────────────
  const sups = await listSupervisors();
  const supOf = (name) => {
    const toks = S(name).split(/\s+/).map(fold).filter(Boolean);
    const hits = sups.filter((s) => { const f = fold(`${s.nameAr} ${s.nameEn}`); return toks.every((t) => f.includes(t) || f.includes(t.replace(/ه$/, ''))); });
    return hits.length === 1 ? hits[0] : null;
  };
  const supNames = [...new Set(reps.map((r) => r.sup).filter(Boolean))];
  const supMap = Object.fromEntries(supNames.map((n) => [n, supOf(n)]));
  for (const n of supNames) console.log(`  مشرف «${n}» ← ${supMap[n] ? `${supMap[n].name} (${supMap[n].role})` : '✗ غير معروف'}`);

  // ── ٢ و٣. المناديب وحساباتُ طلباتهم ────────────────────────────────────
  const ltAll = await LightTransportEmployee.find({}).lean();
  const ltById = new Map(ltAll.map((r) => [S(r.idNumber), r]));
  const ltByName = new Map(ltAll.map((r) => [fold(r.name), r]));
  const repsAll = await B2CRep.find({}).lean();
  const sums = new Map((await B2CDailyOrder.aggregate([{ $match: { dateKey: { $gte: '2026-10-01', $lte: '2026-10-15' } } }, { $group: { _id: '$rep', s: { $sum: { $ifNull: ['$orders', 0] } } } }])).map((x) => [String(x._id), x.s]));
  const tally = { found: 0, created: 0, project: 0, supervisor: 0, kind: 0, linked: 0, relinked: 0, newRep: 0, noHistory: 0, amazonDays: 0 };
  const notes = []; const supProjects = {};
  const usedReps = new Set();
  // ── المطابقةُ على دفعتين ──────────────────────────────────────────────────
  // الأولى: الاسمُ والمجموعُ معًا لكلّ المناديب. والثانية لمن بقي: المجموعُ وحدَه
  // إن لم يطابقه غيرُ حسابٍ واحدٍ لم يُؤخَذ. بدفعةٍ واحدةٍ كان مندوبٌ يأخذ حسابَ
  // آخرَ تساوى مجموعاهما قبل أن يصل صاحبُه إليه.
  const sumOfRep = (x) => sums.get(String(x._id)) || 0;
  const ltOfSheet = (r) => (r.id && ltById.get(r.id)) || (!r.id && ltByName.get(fold(r.name))) || null;
  const namesOfSheet = (r) => { const lt = ltOfSheet(r); return [fold(r.name), lt ? fold(lt.name) : ''].filter(Boolean); };
  const hitName = (x, r) => namesOfSheet(r).some((n) => [fold(x.englishName), fold(x.arabicName)].includes(n));
  const assigned = new Map();
  for (const pass of [1, 2]) {
    for (const [i, r] of reps.entries()) {
      if (assigned.has(i) || r.base == null || !r.base || !projOf[r.project]) continue;
      const pool = repsAll.filter((x) => String(x.project) === String(projOf[r.project]._id) && !usedReps.has(String(x._id)) && sumOfRep(x) === r.base);
      const pick = pass === 1 ? pool.find((x) => hitName(x, r)) : (pool.length === 1 ? pool[0] : null);
      if (pick) { assigned.set(i, pick); usedReps.add(String(pick._id)); }
    }
  }
  for (const [ri, r] of reps.entries()) {
    const proj = projOf[r.project];
    if (!proj) { notes.push(`✗ مشروع غير معروف «${r.project}» — ${r.name}`); continue; }
    let lt = (r.id && ltById.get(r.id)) || (!r.id && ltByName.get(fold(r.name))) || null;
    const sup = supMap[r.sup] || null;
    if (sup) (supProjects[sup._id] = supProjects[sup._id] || new Set()).add(r.project);
    const kind = r.kind || (r.id ? '' : 'يوزرات');
    if (!lt) {
      tally.created += 1;
      notes.push(`+ يُنشأ في سجلّ النقل الخفيف: ${r.id || 'بلا إقامة'} ${r.name} — ${r.project} / ${kind || '—'} / ${r.sup || '—'}`);
      if (APPLY) {
        const doc = new LightTransportEmployee({
          idNumber: r.id || `NOID-${fold(r.name)}`, name: r.name, projectAr: r.project, contractTypeAr: kind, jobTitleAr: 'مندوب',
          hireDate: r.start ? new Date(r.start) : undefined, cityAr: 'جدة', workStatusAr: 'يعمل', isActive: true,
          supervisorUser: sup?._id || null, supervisorName: sup?.name || '',
          history: [{ at: new Date(), byName: 'النظام', kind: 'created', toValue: r.project, note: NOTE }],
        });
        await doc.save();
        lt = doc.toObject();
      } else continue;
    } else {
      tally.found += 1;
      const doc = APPLY ? await LightTransportEmployee.findById(lt._id) : null;
      const change = (field, val, kindName) => {
        if (S(lt[field]) === S(val) || !S(val)) return false;
        // تصحيحُ المشروع من الشيت تصحيحٌ لا نقل: يُكتب `project_fix` فلا يقرؤه خطُّ
        // المشروع (b2cEntry.projectTimeline) نقلًا في يوم التصحيح — وإلّا عُدّ المندوبُ
        // في المشروع القديم كلَّ ما قبله، فرُفضت أرقامُه في مشروعه الحقيقيّ.
        if (doc) { doc.history.push({ at: new Date(), byName: 'النظام', kind: kindName === 'project' ? 'project_fix' : kindName, fromValue: S(lt[field]), toValue: S(val), note: NOTE }); doc[field] = val; }
        return true;
      };
      if (change('projectAr', r.project, 'project')) tally.project += 1;
      if (kind && S(lt.contractTypeAr) !== kind) { tally.kind += 1; if (doc) doc.contractTypeAr = kind; }
      if (sup && String(lt.supervisorUser || '') !== String(sup._id)) {
        tally.supervisor += 1;
        if (doc) { doc.history.push({ at: new Date(), byName: 'النظام', kind: 'supervisor', fromValue: S(lt.supervisorName), toValue: sup.name, note: NOTE }); doc.supervisorUser = sup._id; doc.supervisorName = sup.name; }
      }
      if (doc && !doc.hireDate && r.start) doc.hireDate = new Date(r.start);
      if (doc && !S(doc.jobTitleAr)) doc.jobTitleAr = 'مندوب';
      if (doc && doc.isModified()) await doc.save();
    }
    // حسابُ الطلبات.
    let pick = assigned.get(ri) || null;
    if (!pick) {
      const inProj = repsAll.filter((x) => String(x.project) === String(proj._id) && !usedReps.has(String(x._id)));
      pick = inProj.find((x) => lt && String(x.ltEmployee) === String(lt._id)) || inProj.find((x) => hitName(x, r)) || null;
      if (pick) usedReps.add(String(pick._id));
    }
    const base = r.base == null ? null : r.base;
    const sumOf = sumOfRep;
    if (pick) {
      if (base && sumOf(pick) !== base) notes.push(`≠ ${r.name} [${r.project}]: الشيت ${base} · النظام ${sumOf(pick)} (${pick.englishName})`);
      if (String(pick.ltEmployee || '') !== String(lt._id)) tally[pick.ltEmployee ? 'relinked' : 'linked'] += 1;
      if (APPLY) {
        await B2CRep.updateMany({ ltEmployee: lt._id, _id: { $ne: pick._id } }, { $set: { ltEmployee: null } });
        await B2CRep.updateOne({ _id: pick._id }, { $set: { ltEmployee: lt._id, project: proj._id, monthlyTarget: proj.monthlyTarget, dailyTarget: proj.dailyTarget, isActive: true, ...(sup ? { supervisor: sup._id } : {}) } });
      }
    } else {
      tally.newRep += 1; if (base) { tally.noHistory += 1; notes.push(`؟ ${r.name} [${r.project}] الشيت ${base} ولا حسابَ مطابق — يبدأ من النظام`); }
      if (APPLY) await E.ensureRep(await LightTransportEmployee.findById(lt._id), null);
    }
    // ٥. امازون: الأيامُ المفصّلةُ في الشيت.
    if (r.project === 'امازون') {
      for (const [iso, n] of Object.entries(r.days)) {
        if (n == null) continue;
        tally.amazonDays += 1;
        if (APPLY) {
          const rep = await B2CRep.findOne({ ltEmployee: lt._id });
          const [y, m, d] = iso.split('-').map(Number);
          await B2CDailyOrder.updateOne({ rep: rep._id, dateKey: iso }, { $set: { orders: n, worked: n > 0, project: rep.project, branch: rep.branch, source: 'manual', notes: NOTE }, $setOnInsert: { date: new Date(`${iso}T00:00:00Z`), year: y, month: m, day: d } }, { upsert: true });
        }
      }
    }
  }
  // ٤. مشاريعُ المشرفين.
  for (const [uid, set] of Object.entries(supProjects)) {
    const s = sups.find((x) => String(x._id) === String(uid));
    const ids = [...set].map((n) => projOf[n]?._id).filter(Boolean);
    console.log(`  مشاريع ${s?.name}: ${[...set].join('، ')}`);
    if (APPLY) await User.updateOne({ _id: uid }, { $set: { assignedProjects: ids } });
  }
  // مناديبُ يعملون في السجلّ وليسوا في الشيت — تقرّر فيهم الإدارة.
  const inSheet = new Set(reps.map((r) => r.id).filter(Boolean)); const inSheetNames = new Set(reps.map((r) => fold(r.name)));
  const extra = ltAll.filter((r) => r.staffKind === 'rep' && r.isActive !== false && r.workStatusAr !== 'إنهاء خدمة' && !inSheet.has(S(r.idNumber)) && !inSheetNames.has(fold(r.name)));
  console.log('\n', tally);
  console.log(notes.join('\n'));
  if (extra.length) console.log(`\nفي السجلّ ويعملون وليسوا في الشيت (${extra.length}): ${extra.map((r) => `${r.idNumber} ${r.name} — ${r.projectAr}`).join(' · ')}`);
  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  try { require('../utils/ttlCache').clear('b2c:'); require('../utils/ttlCache').clear('lt:'); } catch (_) { /* */ }
  console.log('\nApplied.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
