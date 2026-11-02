/**
 * IT tickets and the IT work plan's «Tickets & Issues» project are one list read on two screens.
 * A ticket is mirrored as a task in that project and a task added there becomes a ticket; edits,
 * completion and deletion follow both ways. The pair is joined by the task's `ticket` link.
 * Each side writes the other with plain updates, so a sync never triggers the reverse sync.
 * Only pairs made here are synced (`ItTicket.jpTask`); a ticket linked to a task by hand keeps its own text.
 * Tasks outside the project, including ones linked to a ticket by hand, are left alone.
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const PROJECT_RX = /tickets?\s*(and|&)\s*issues?|تيكت|تذاكر/i;
const CLOSED = new Set(['resolved', 'closed']);
const S = (v) => String(v == null ? '' : v).trim();
const models = () => ({ ...require('../models/JpModels'), ItTicket: require('../models/ItTicket') });

/** The linked project, or null when the IT plan has none by that name. */
const linkedProject = () => cache.wrap('itjp:project', 30000, async () => {
  const { JpProject } = models();
  const rows = await JpProject.find({ scope: 'section', section: 'it' }).select('name').lean();
  return rows.find((p) => PROJECT_RX.test(S(p.name))) || null;
});

const announce = () => {
  try { emitToAll('jp:changed', { scope: 'section', section: 'it' }); } catch (_) { /* */ }
  try { emitToAll('it:updated', { type: 'ticket' }); } catch (_) { /* */ }
};

const labelOf = (t) => [t.ticketNumber && `#${t.ticketNumber}`, t.title].filter(Boolean).join(' ');
const taskFilter = (projectId, ticketId) => ({ project: projectId, links: { $elemMatch: { kind: 'ticket', ref: new mongoose.Types.ObjectId(String(ticketId)) } } });

/** Ticket → its task: created when missing, then kept equal. */
async function fromTicket(ticketId, actorId) {
  const project = await linkedProject();
  if (!project) return;
  const { JpTask, ItTicket } = models();
  const t = await ItTicket.findById(ticketId).lean();
  if (!t) return;
  const done = CLOSED.has(t.status);
  const task = await JpTask.findOne(taskFilter(project._id, t._id)).lean();
  const assignee = t.assignedTo || task?.assignedTo || t.createdBy || actorId;
  if (task && String(t.jpTask || '') !== String(task._id)) return;
  if (!task) {
    if (!assignee) return;
    const created = await JpTask.create({
      scope: 'section', section: 'it', kind: 'task', project: project._id,
      title: S(t.title).slice(0, 200), details: S(t.description).slice(0, 4000),
      assignedTo: assignee, createdBy: t.createdBy || actorId || assignee,
      status: done ? 'done' : 'open', doneAt: done ? (t.resolvedAt || new Date()) : null,
      links: [{ kind: 'ticket', ref: t._id, label: labelOf(t) }],
    });
    await ItTicket.updateOne({ _id: t._id }, { $set: { jpTask: created._id } });
    announce();
    return;
  }
  const set = {};
  if (S(task.title) !== S(t.title).slice(0, 200)) set.title = S(t.title).slice(0, 200);
  if (S(task.details) !== S(t.description).slice(0, 4000)) set.details = S(t.description).slice(0, 4000);
  if (t.assignedTo && String(task.assignedTo) !== String(t.assignedTo)) Object.assign(set, { assignedTo: t.assignedTo, assignedEmployee: null, assigneeName: '' });
  if (done && task.status !== 'done') Object.assign(set, { status: 'done', doneAt: new Date(), doneBy: actorId || null, progress: 'todo', timerStartedAt: null });
  if (!done && task.status === 'done') Object.assign(set, { status: 'open', doneAt: null, doneBy: null, doneNote: '' });
  const label = labelOf(t);
  if ((task.links || []).some((l) => l.kind === 'ticket' && String(l.ref) === String(t._id) && l.label !== label)) {
    set.links = task.links.map((l) => (l.kind === 'ticket' && String(l.ref) === String(t._id) ? { ...l, label } : l));
  }
  if (Object.keys(set).length) { await JpTask.updateOne({ _id: task._id }, { $set: set }); announce(); }
}

/** A deleted ticket takes its mirror task with it; a task linked by hand stays. */
async function ticketDeleted(ticket) {
  if (!ticket || !ticket.jpTask) return;
  const { JpTask } = models();
  const r = await JpTask.deleteOne({ _id: ticket.jpTask });
  if (r.deletedCount) announce();
}

/** Task in the project → its ticket: created when missing, then kept equal. */
async function fromTask(taskId, actorId) {
  const project = await linkedProject();
  if (!project) return;
  const { JpTask, ItTicket } = models();
  const task = await JpTask.findById(taskId).lean();
  if (!task || String(task.project) !== String(project._id)) return;
  const it = require('../controllers/itController')._ticketRules;
  const link = (task.links || []).find((l) => l.kind === 'ticket');
  const ticket = link ? await ItTicket.findById(link.ref) : null;
  if (link && (!ticket || String(ticket.jpTask || '') !== String(task._id))) return;
  const assignedTo = task.assignedTo || undefined;
  if (!ticket) {
    const created = await ItTicket.create({
      title: S(task.title), description: S(task.details), category: 'other',
      status: task.status === 'done' ? 'resolved' : 'open', assignedTo, createdBy: task.createdBy || actorId,
      reportedAt: it.today(), signature: it.buildSignature('other', task.title), jpTask: task._id,
      ...(task.status === 'done' ? it.closedFields(it.today(), it.today()) : {}),
    });
    const links = [...(task.links || []).filter((l) => l.kind !== 'ticket'), { kind: 'ticket', ref: created._id, label: labelOf(created) }];
    await JpTask.updateOne({ _id: task._id }, { $set: { links } });
    announce();
    return;
  }
  let changed = false;
  if (S(ticket.title) !== S(task.title)) { ticket.title = S(task.title); ticket.signature = it.buildSignature(ticket.category, ticket.title); changed = true; }
  if (S(ticket.description) !== S(task.details)) { ticket.description = S(task.details); changed = true; }
  if (assignedTo && String(ticket.assignedTo) !== String(assignedTo)) { ticket.assignedTo = assignedTo; changed = true; }
  const closed = CLOSED.has(ticket.status);
  if (task.status === 'done' && !closed) {
    ticket.status = 'resolved';
    Object.assign(ticket, it.closedFields(ticket.reportedAt, it.today()));
    changed = true;
  } else if (task.status !== 'done' && closed) {
    ticket.status = 'reopened'; ticket.resolvedDate = undefined; ticket.resolvedAt = undefined; ticket.resolutionMinutes = undefined;
    changed = true;
  }
  if (changed) { await ticket.save(); announce(); }
}

/** A deleted task in the project takes its ticket with it. */
async function taskDeleted(task) {
  const project = await linkedProject();
  if (!project || !task || String(task.project) !== String(project._id)) return;
  const link = (task.links || []).find((l) => l.kind === 'ticket');
  if (!link) return;
  await models().ItTicket.deleteOne({ _id: link.ref, jpTask: task._id });
  announce();
}

// A sync failure must not undo the write the user just made; it is logged and the next edit retries.
const safe = (fn) => (...a) => fn(...a).catch((e) => console.error('[it-ticket-jp]', e.message));

module.exports = {
  fromTicket: safe(fromTicket), fromTask: safe(fromTask), ticketDeleted: safe(ticketDeleted), taskDeleted: safe(taskDeleted),
  linkedProject, PROJECT_RX,
};
