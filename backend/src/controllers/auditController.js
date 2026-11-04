const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { SECTIONS, sectionOf, entitiesOfSection } = require('../config/auditSections');
const { actionLabel, entityLabel } = require('../config/auditLabels');
const { describe } = require('../utils/auditDescribe');
const { startOfDay, endOfDay } = require('../utils/companyDay');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isId = (v) => OBJECT_ID.test(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** A filter error itself: rejected with its reason instead of an empty table that reads as an answer. */
class FilterError extends Error {}

/**
 * A single day, or a range, in company time. date=YYYY-MM-DD is a whole day; dateFrom/dateTo is a range; either bound alone works.
 * Bounds were built with new Date('...T00:00:00.000') without a zone, which is read in server time; the server is on GMT, so a day started at 3 a.m. Riyadh and dropped post-midnight events. See utils/companyDay.
 */
const dayBounds = (from, to) => {
  let a = from ? String(from).slice(0, 10) : '';
  let b = to ? String(to).slice(0, 10) : '';
  if ((a && !YMD.test(a)) || (b && !YMD.test(b))) throw new FilterError('تاريخ غير صالح');
  // An inverted range is swapped rather than returned empty.
  if (a && b && a > b) [a, b] = [b, a];
  const range = {};
  if (a) range.$gte = startOfDay(a);
  if (b) range.$lte = endOfDay(b);
  return range;
};

/** Query condition from the screen filters. `skip` names filters to ignore, used to build option lists: each filter's list is computed with all filters except itself. */
async function buildFilter(q, skip = []) {
  const on = (k) => !skip.includes(k) && q[k] !== undefined && q[k] !== null && String(q[k]) !== '';
  const filter = {};

  // Section first, entity is a detail inside it. An explicit entity choice wins over its section: someone picking one entity wants only it. Combining both conditions would give empty results for conflicting choices with no visible reason.
  if (on('entity')) {
    filter.entity = String(q.entity);
  } else if (on('section')) {
    if (q.section === 'other') {
      // Other is not a counted list: it is everything not in the list, including an entity added to the server yesterday and not yet classified.
      const known = SECTIONS.flatMap((s) => entitiesOfSection(s.key));
      filter.entity = { $nin: known };
    } else {
      filter.entity = { $in: entitiesOfSection(String(q.section)) };
    }
  }

  // Action by its full key. It used to be a text search on the English key (update_workflow) while the screen shows Arabic, so searching the displayed word found nothing, and the text went into a regex unescaped so one bracket broke the request. Now a pick from actually occurring actions with an exact match.
  if (on('action')) {
    const list = String(q.action).split(',').map((s) => s.trim()).filter(Boolean);
    filter.action = list.length === 1 ? list[0] : { $in: list };
  }

  // Person. system is the system itself (auto-close): entries with no actor were unreachable by this filter. unnamed is accounts deleted before the log captured the actor name (over a thousand test accounts known only by id); grouped into one option instead of a thousand nameless rows, and not hidden since their actions are in the log.
  let users = null; // null = all
  let systemOnly = false;
  let unnamedOnly = false;
  if (on('user')) {
    if (q.user === 'system') systemOnly = true;
    else if (q.user === 'unnamed') unnamedOnly = true;
    else if (isId(q.user)) users = [String(q.user)];
    else throw new FilterError('مستخدم غير صالح');
  }

  // Branch is read from the actor. An entry has no branch because the action may target an entity with none (a permission role, a system setting), but the actor belongs to a branch, and that is the question: what did this branch's people do?
  if (on('branch')) {
    // none is actors with no branch (management and system admins, half the log). Without it the branch filter would never reach them.
    if (q.branch !== 'none' && !isId(q.branch)) throw new FilterError('فرع غير صالح');
    const cond = q.branch === 'none' ? { branch: null } : { branch: q.branch };
    const ids = (await User.find(cond).select('_id').lean()).map((u) => String(u._id));
    // With a specific person chosen, the conditions intersect: a person from another branch combined with this branch gives nothing, not everything they did. The system has no branch.
    users = users ? users.filter((u) => ids.includes(u)) : ids;
    if (systemOnly || unnamedOnly) { systemOnly = false; unnamedOnly = false; users = []; }
  }
  if (unnamedOnly) {
    // Unnamed is a property of the account, not the entry: an account whose name was captured in one entry is known by it in all entries, the same definition used to count the list.
    const live = await User.distinct('_id');
    const rows = await AuditLog.aggregate([
      { $match: { user: { $nin: [...live, null] } } },
      { $group: { _id: '$user', name: { $max: '$userName' }, email: { $max: '$userEmail' } } },
      { $match: { name: { $in: ['', null] }, email: { $in: ['', null] } } },
    ]);
    filter.user = { $in: rows.map((r) => r._id) };
  } else
  if (systemOnly) filter.user = null; // Matches missing and empty
  else if (users) filter.user = users.length === 1 ? oid(users[0]) : { $in: users.map(oid) };

  if (!skip.includes('date')) {
    const day = q.date;
    const from = day || q.dateFrom || q.from;
    const to = day || q.dateTo || q.to;
    if (from || to) filter.createdAt = dayBounds(from, to);
  }
  return filter;
}

/** Everything in `changes` that looks like an internal id, looked up once for the whole page. */
function collectIds(v, into, depth = 0) {
  if (v == null || depth > 3) return;
  if (typeof v === 'string') { if (OBJECT_ID.test(v)) into.add(v); return; }
  if (v._bsontype) { into.add(String(v)); return; }
  if (Array.isArray(v)) { v.slice(0, 20).forEach((x) => collectIds(x, into, depth + 1)); return; }
  if (typeof v === 'object' && !(v instanceof Date)) Object.values(v).forEach((x) => collectIds(x, into, depth + 1));
}

const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

/** Ids are shown as names. A raw branch id change says nothing, so page ids are collected and looked up in branches, users and employees (three queries per page, not per row). An unknown owner is reported as changed, without the id. */
async function resolveRefs(logs) {
  const ids = new Set();
  for (const l of logs) collectIds(l.changes, ids);
  if (!ids.size) return {};
  const list = [...ids].slice(0, 5000).map(oid);
  const Employee = require('../models/Employee');
  const [branches, users, employees] = await Promise.all([
    Branch.find({ _id: { $in: list } }).select('name').lean(),
    User.find({ _id: { $in: list } }).select('firstName lastName email').lean(),
    Employee.find({ _id: { $in: list } }).select('arabicName firstName lastName').lean(),
  ]);
  const refs = {};
  for (const b of branches) refs[String(b._id)] = b.name;
  for (const u of users) refs[String(u._id)] = fullName(u) || u.email;
  for (const e of employees) refs[String(e._id)] = e.arabicName || fullName(e);
  return refs;
}

/** Which record the action hit. The column showed a 24-character entityId nobody recognizes; the record name is read from its collection where known. A record deleted after the action is not found, so what the entry captured itself is kept. */
const SUBJECT_SOURCES = {
  Employee: ['Employee', 'arabicName firstName lastName', (d) => d.arabicName || fullName(d)],
  User: ['User', 'firstName lastName email', (d) => fullName(d) || d.email],
  OperationsWorkflow: ['OperationsWorkflow', 'reportNumber', (d) => (d.reportNumber ? `أمر نقل ${d.reportNumber}` : '')],
  VehicleMaster: ['VehicleMaster', 'plateNumber', (d) => (d.plateNumber ? `لوحة ${d.plateNumber}` : '')],
  CustomsClearance: ['CustomsClearance', 'refNumber', (d) => (d.refNumber ? `معاملة ${d.refNumber}` : '')],
  CollectionsParty: ['CollectionsParty', 'name', (d) => d.name],
  B2CRep: ['B2CRep', 'arabicName englishName', (d) => d.arabicName || d.englishName],
  CompanyEmail: ['CompanyEmail', 'email', (d) => d.email],
  Branch: ['Branch', 'name', (d) => d.name],
};

async function resolveSubjects(logs) {
  const byEntity = {};
  for (const l of logs) {
    if (!l.entityId || !SUBJECT_SOURCES[l.entity]) continue;
    (byEntity[l.entity] = byEntity[l.entity] || new Set()).add(String(l.entityId));
  }
  const out = {};
  await Promise.all(Object.entries(byEntity).map(async ([entity, set]) => {
    const [file, select, name] = SUBJECT_SOURCES[entity];
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const Model = require(`../models/${file}`);
      const docs = await Model.find({ _id: { $in: [...set].map(oid) } }).select(select).lean();
      for (const d of docs) out[`${entity}:${d._id}`] = name(d) || '';
    } catch (e) { /* The name is extra on the entry, not required to display it. */ }
  }));
  return out;
}

/**
 * One entry as a full sentence: who did what, on which record, and every value that changed.
 * «نورهان فراج عدّل فاتورة INV-1 (المبلغ: من 1,000 إلى 1,150، الحالة: مكتمل)». The table's short summary kept three changes; the log is read to know exactly what happened, so nothing is cut here.
 */
const GENERIC = /^(create|add|update|edit|delete|remove)(_|$)/;
function sentenceOf({ actor, action, actionLabel: label, entityLabel: ent, subject, kind, rows, bulkCount, lang }) {
  const ar = lang !== 'en';
  const verb = {
    create: ar ? 'أضاف' : 'added', update: ar ? 'عدّل' : 'edited', set: ar ? 'عدّل' : 'edited',
    delete: ar ? 'حذف' : 'deleted', fields: ar ? 'عدّل' : 'edited',
  }[kind];
  const what = [ent, subject && !String(ent || '').includes(subject) ? subject : ''].filter(Boolean).join(' ');
  // A named action ("record collection", "close the day") says more than a generic verb.
  let head;
  if (verb && GENERIC.test(String(action || ''))) head = `${actor} ${verb} ${what}`.trim();
  else head = ar ? `${actor} قام ب${label}${subject ? ` — ${subject}` : ''}` : `${actor}: ${label}${subject ? ` — ${subject}` : ''}`;
  const told = (rows || []).map((r) => r.text).filter(Boolean);
  const MAX = 15;
  const list = told.slice(0, MAX).join(ar ? '، ' : ', ');
  const more = told.length > MAX ? (ar ? ` و${told.length - MAX} أخرى` : ` +${told.length - MAX} more`) : '';
  const bulk = bulkCount ? (ar ? ` على ${bulkCount} سجلًّا` : ` on ${bulkCount} records`) : '';
  return `${head}${bulk}${list ? ` (${list}${more})` : ''}`;
}

exports.getAuditLogs = async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = await buildFilter(req.query);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        // _id separates entries written at the same instant (bulk import); without a stable tiebreak a row repeats across pages and another goes missing.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    // Actors are read in one query, not populate: populate clears the reference when the account is deleted, losing the id that filters its history.
    const actorIds = [...new Set(logs.map((l) => l.user && String(l.user)).filter(Boolean))];
    const [refs, subjects, actors] = await Promise.all([
      resolveRefs(logs), resolveSubjects(logs),
      User.find({ _id: { $in: actorIds } }).select('firstName lastName email role branch').lean(),
    ]);
    const actorById = Object.fromEntries(actors.map((u) => [String(u._id), u]));
    // The actor's branch by name, shown under each entry.
    const branchIds = [...new Set(actors.map((u) => u.branch && String(u.branch)).filter(Boolean))];
    const branchName = Object.fromEntries((branchIds.length
      ? await require('../models/Branch').find({ _id: { $in: branchIds } }).select('name nameAr').lean() : [])
      .map((b) => [String(b._id), (lang === 'ar' ? b.nameAr : '') || b.name || '']));
    // Full detail only for the screen page; export needs just the readable line, and a snapshot of every entry across tens of thousands of rows is a payload nobody reads.
    const withDetail = limit <= 200;

    const shaped = logs.map((l) => {
      const o = {
        _id: l._id, action: l.action, entity: l.entity, entityId: l.entityId, entityKey: l.entityKey || '',
        ipAddress: l.ipAddress, createdAt: l.createdAt, bySystem: !!l.bySystem,
        userName: l.userName || '', userEmail: l.userEmail || '',
        user: (l.user && actorById[String(l.user)]) || null,
      };
      // Actor from the snapshot when the account is deleted. populate returns empty for a deleted user, so the screen would attribute the action to the system; it is completed from the snapshot kept at action time and flagged as removed, so a human action is never attributed to a machine.
      if (!o.user && l.user) {
        o.user = {
          _id: String(l.user), firstName: l.userName || l.userEmail || (lang === 'en' ? 'Deleted account (no name recorded)' : 'حساب محذوف (لم يُسجَّل اسمه)'), lastName: '', email: l.userEmail || '', deleted: true,
          unnamed: !l.userName && !l.userEmail,
        };
      }
      // Actor name is ready in one field; the app shows it as is.
      o.userName = o.user ? (fullName(o.user) || o.user.email || o.userName) : (lang === 'en' ? 'System' : 'النظام');

      // Section is computed here, not in the UI: one map is read by both the filter and the column, so a row cannot be in one section when filtering and another when displaying.
      o.section = sectionOf(l.entity);
      const sec = SECTIONS.find((s) => s.key === o.section);
      o.sectionLabel = sec ? sec[lang] : o.section;
      o.actionLabel = actionLabel(l.action, l.entity, lang);
      o.entityLabel = entityLabel(l.entity, lang);

      const d = describe(l, { lang, refs, subjectHint: subjects[`${l.entity}:${l.entityId}`] || '' });
      o.subject = d.subject;
      o.summary = d.summary;
      o.kind = d.kind;
      o.hasDetails = d.rows.length > 0 || d.unchanged.length > 0;
      o.branchName = (o.user && o.user.branch && branchName[String(o.user.branch)]) || '';
      o.sentence = sentenceOf({ actor: o.userName, action: l.action, actionLabel: o.actionLabel, entityLabel: o.entityLabel, subject: d.subject, kind: d.kind, rows: d.rows.filter((r) => !(d.subjectKey && r.key === d.subjectKey && r.kind === 'value')), bulkCount: d.bulkCount, lang });
      if (withDetail) o.detail = { rows: d.rows, unchanged: d.unchanged, bulkCount: d.bulkCount };
      return o;
    });
    res.json({
      logs: shaped, total, page, pages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof FilterError) return res.status(400).json({ message: error.message });
    console.error('audit list error:', error.message);
    res.status(500).json({ message: 'Failed to load audit logs' });
  }
};

/**
 * Filter vocabularies: each list is computed with all other filters and those above it, so counts follow the current selection instead of the whole log.
 * Order: section (person, branch, time); entity (+ section); action (+ entity); person (branch, time, section, entity, action).
 */
exports.getAuditOptions = async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const q = req.query;
    const [base, userScope] = await Promise.all([
      buildFilter(q, ['section', 'entity', 'action']),
      buildFilter(q, ['user']),
    ]);
    const [pairs, actorRows, branches] = await Promise.all([
      AuditLog.aggregate([
        { $match: base },
        { $group: { _id: { e: '$entity', a: '$action' }, count: { $sum: 1 } } },
      ]),
      // Actors come from the entries with their name snapshot, so a person whose account was deleted stays in the list by name and their history stays readable.
      AuditLog.aggregate([
        { $match: userScope },
        { $group: { _id: '$user', count: { $sum: 1 }, name: { $max: '$userName' }, email: { $max: '$userEmail' } } },
      ]),
      // All branches are listed: the filter asks whether anyone in this branch did something, and no activity is a valid answer, not an option to hide.
      Branch.find({}).select('name').sort({ name: 1 }).lean(),
    ]);

    // Sections: all of them, with counts. A section with no entries shows zero, which tells the user nothing was recorded there; hiding it would read as not being in the log at all.
    const sectionCounts = {};
    const entityCounts = {};
    for (const p of pairs) {
      if (!p._id.e) continue;
      const s = sectionOf(p._id.e);
      sectionCounts[s] = (sectionCounts[s] || 0) + p.count;
      entityCounts[p._id.e] = (entityCounts[p._id.e] || 0) + p.count;
    }
    const sections = SECTIONS
      .filter((s) => s.key !== 'other' || sectionCounts.other)
      .map((s) => ({ key: s.key, ar: s.ar, en: s.en, count: sectionCounts[s.key] || 0 }));

    // Entities: all, with their section; the UI shows those in the chosen section.
    const entities = Object.entries(entityCounts)
      .map(([key, count]) => ({ key, section: sectionOf(key), count, label: entityLabel(key, lang) }))
      .sort((a, b) => b.count - a.count);

    // Actions: within the chosen section and entity.
    const inSection = (e) => {
      if (q.entity) return e === q.entity;
      if (q.section) return sectionOf(e) === q.section;
      return true;
    };
    const actionCounts = {};
    for (const p of pairs) {
      if (!p._id.e || !inSection(p._id.e)) continue;
      const slot = actionCounts[p._id.a] || (actionCounts[p._id.a] = { count: 0, entities: new Set() });
      slot.count += p.count;
      slot.entities.add(p._id.e);
    }
    const actions = Object.entries(actionCounts)
      .map(([key, v]) => ({
        key,
        count: v.count,
        // A generic action (create) is named with its entity when the entity is unique.
        label: actionLabel(key, v.entities.size === 1 ? [...v.entities][0] : '', lang),
      }))
      .sort((a, b) => b.count - a.count);

    // People
    const ids = actorRows.map((r) => r._id).filter(Boolean);
    const live = await User.find({ _id: { $in: ids } }).select('firstName lastName email role branch').lean();
    const liveById = Object.fromEntries(live.map((u) => [String(u._id), u]));
    const users = [];
    let systemCount = 0;
    let unnamedCount = 0;
    for (const r of actorRows) {
      if (!r._id) { systemCount += r.count; continue; }
      const u = liveById[String(r._id)];
      if (!u && !r.name && !r.email) { unnamedCount += r.count; continue; }
      users.push(u
        ? { _id: String(u._id), firstName: u.firstName || '', lastName: u.lastName || '', email: u.email || '', role: u.role, branch: u.branch, count: r.count }
        : { _id: String(r._id), firstName: r.name || r.email, lastName: '', email: r.email || '', deleted: true, count: r.count });
    }
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

    res.json({
      entities, sections, actions, users, branches, systemCount, unnamedCount,
    });
  } catch (error) {
    if (error instanceof FilterError) return res.status(400).json({ message: error.message });
    console.error('audit options error:', error.message);
    res.status(500).json({ message: 'Failed to load audit options' });
  }
};

exports._buildFilter = buildFilter;
