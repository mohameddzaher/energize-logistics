/* eslint-disable no-console, no-await-in-loop */
/**
 * One-time join of existing IT tickets with the IT plan's «Tickets & Issues» project (services/itTicketJp).
 * Open tickets get their task; every task already in the project gets its ticket. Closed tickets stay off the
 * plan so it does not fill with finished history. Safe to rerun: existing pairs are only aligned.
 * Usage: node src/scripts/syncItTicketsJp.js [--apply]   (dry run by default)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`DB host: ${mongoose.connection.host} · ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const sync = require('../services/itTicketJp');
  const { JpTask } = require('../models/JpModels');
  const ItTicket = require('../models/ItTicket');
  const project = await sync.linkedProject();
  if (!project) { console.log('No IT plan project matches «Tickets & Issues» — nothing to join.'); return mongoose.disconnect(); }
  console.log(`Project: ${project.name} (${project._id})`);

  const tasks = await JpTask.find({ project: project._id }).select('title links').lean();
  const unpairedTasks = tasks.filter((t) => !(t.links || []).some((l) => l.kind === 'ticket'));
  const pairedTickets = new Set(tasks.flatMap((t) => (t.links || []).filter((l) => l.kind === 'ticket').map((l) => String(l.ref))));
  const open = await ItTicket.find({ status: { $nin: ['resolved', 'closed'] } }).select('ticketNumber title').lean();
  const unpairedTickets = open.filter((t) => !pairedTickets.has(String(t._id)));
  console.log(`Tasks in the project: ${tasks.length} · without a ticket: ${unpairedTasks.length}`);
  console.log(`Open tickets: ${open.length} · without a task: ${unpairedTickets.length}`);
  for (const t of unpairedTasks.slice(0, 30)) console.log(`  task → new ticket: ${t.title}`);
  for (const t of unpairedTickets.slice(0, 30)) console.log(`  ticket → new task: ${t.ticketNumber} ${t.title}`);

  if (APPLY) {
    for (const t of tasks) await sync.fromTask(t._id, null);
    for (const t of open) await sync.fromTicket(t._id, null);
    const left = await JpTask.countDocuments({ project: project._id, 'links.kind': { $ne: 'ticket' } });
    console.log(`Done. Tasks in the project still without a ticket: ${left}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
