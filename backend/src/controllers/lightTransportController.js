/**
 * Light transport - its employees, housing and operating orders.
 * Where each thing is read from: the person lives in HR, the vehicle in the vehicle register, and what belongs to this department is here. The list joins the three in one row, and a field owned elsewhere is never copied; see models/LightTransport.
 * Service status is read live from the HR file on every call, so someone terminated there reads as out of work here at once, with no sync job to forget.
 */
const mongoose = require('mongoose');
const { listSupervisors, resolveSupervisor, syncRepSupervisor, fold: foldAr } = require('../utils/b2cSupervisors');
const VDOC = require('../config/vehicleDocuments');
const { VehicleRegistryConfig } = require('../models/VehicleMaster');

/** Document alert thresholds come from the vehicles department settings, not numbers written here. The document and its threshold live there; copying the threshold here would let a change in one place miss the other, and one card would say critical on one screen and valid on another. */
const docAlerts = async () => {
  const hit = cache.get('lt:doc-alerts');
  if (hit !== undefined) return hit;
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean();
  const alerts = cfg?.alerts || {};
  cache.set('lt:doc-alerts', alerts, 60000);
  return alerts;
};
const { LightTransportEmployee, LightTransportHousing, LightTransportOrder } = require('../models/LightTransport');
const Employee = require('../models/Employee');
const { VehicleMaster } = require('../models/VehicleMaster');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

const emit = (event, payload = {}) => {
  // Clear the cache before broadcasting, not after, or listeners read the old data. See utils/ttlCache and the announce-after-invalidate rule. (Broadcast used to come first.)
  cache.clear('lt:');
  try { emitToAll(event, payload); } catch (e) { /* Broadcast failure must not stop the work. */ }
};

const S = (v) => String(v == null ? '' : v).trim();
const byName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');


/**
 * Two spellings for one vehicle type.
 * The vehicle register writes the official registration type and the department sheet writes a colloquial variant for the same motorbike type. Filtering by one returned zero from the other side: 'motorbikes' showed 195 vehicles and zero employees.
 * The type belongs to the vehicle, so it is read from the vehicle register when linked, and the employee field remains for those without a registered vehicle. This table merges both spellings so either filters.
 */
const TYPE_ALIASES = [
  ['دراجة آلية', 'دراجة نارية', 'دراجه ناريه', 'دراجة'],
  ['خاص', 'كيا', 'كيا بيجاز', 'فان'],
];
const typeKey = (v) => {
  const x = S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, '');
  for (const group of TYPE_ALIASES) {
    if (group.some((g) => S(g).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, '') === x)) return group[0];
  }
  return S(v);
};


/**
 * A plate is read in any order.
 * The vehicle register writes it letters-then-digits and the sheet digits-then-letters, and a violation is dictated by phone in either. A literal search returned zero though the vehicle exists; seven plates were once asked for and none appeared.
 * So letter/digit order is folded: the plate is compared by its key (digits + sorted letters), as the vehicles department does itself.
 */
const plateKeyOf = (p) => {
  const w = S(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (w.match(/\d+/g) || []).join('');
  const letters = (w.match(/[\u0621-\u064AA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

/** Is this text a plate? Letters and digits together, and at most four digits - not a name or an ID number. */
const looksLikePlate = (t) => {
  const w = S(t);
  const digits = (w.match(/[0-9٠-٩]/g) || []).length;
  const letters = (w.match(/[\u0621-\u064AA-Za-z]/g) || []).length;
  return digits >= 3 && digits <= 4 && letters >= 2 && letters <= 6;
};

/**
 * Work status: working, on leave, suspended, accident.
 * Hiring and termination belong to HR alone; the operating day status is written by the department in `opStatus`. The full rule is in utils/b2cBoard, read by the dashboard and both lists so a figure never differs from its list.
 */
const BOARD = require('../utils/b2cBoard');
const { shownStatus } = BOARD;

/**
 * The vehicle's two documents as read in this section.
 * The operating card and the periodic inspection live on the vehicle register, and alert thresholds (critical, warning, near) are set in the vehicles department settings. State is computed the same way (`VDOC.stateOf`) with the same thresholds; otherwise two screens would give one document two states.
 */
const docOf = (vehicle, key, alerts) => {
  const d = vehicle && typeof vehicle === 'object' ? vehicle[key] : null;
  const st = VDOC.stateOf(d?.expiryDate, d?.statusCode, alerts?.[key] || {});
  return {
    expiryDate: d?.expiryDate || null,
    number: d?.cardNumber || '',
    statusAr: d?.statusAr || '',
    state: VDOC.publicState(st.state),
    days: st.days,
  };
};

const decorate = (row, alerts = {}) => ({
  ...row,
  // The import phrase meaning added from the vehicle sheet is not a note; the system is the reference.
  notesAr: require('../utils/importLabels').stripImportNote(row.notesAr),
  ...(Array.isArray(row.history) ? { history: row.history.map(require('../utils/importLabels').cleanHistoryEntry) } : {}),
  workStatusShown: shownStatus(row),
  // The operating card and inspection of his vehicle, by state and not just date.
  operatingCard: docOf(row.vehicle, 'operatingCard', alerts),
  inspection: docOf(row.vehicle, 'inspection', alerts),
  // Vehicle type from its register when linked, where it is officially recorded.
  vehicleTypeShown: (row.vehicle && typeof row.vehicle === 'object' ? row.vehicle.registrationTypeAr : '') || row.vehicleTypeAr || '',
  // And where the information came from, so nobody asks who changed the status.
  statusSource: BOARD.statusSource(row),
  // Category, linkage type and register, with the meanings the dashboard counts by (utils/b2cBoard).
  categoryShown: BOARD.categoryOf(row),
  engagementShown: BOARD.engagementOf(row),
  registerShown: BOARD.registerOf(row),
  // The authorization of his vehicle from the vehicle register (the reference); only `BOARD.authOf` reads it.
  authState: row.vehicle && typeof row.vehicle === 'object' ? BOARD.authOf(row.vehicle) : '',
  hrLinked: !!row.employee,
  // Contract type as displayed and counted: from HR for those with a file. See contractKindOf.
  contractTypeShown: ({ sponsored: 'كفالة', freelance: 'فري لانسر', users: 'يوزرات' })[contractKindOf(row)] || '',
  employeeNumber: row.employee && typeof row.employee === 'object' ? row.employee.employeeNumber : '',
});

/**
 * The supervisor filter accepts an account or a name.
 * Supervisor is now an account, so the filter uses the id. The name stays accepted because saved links and app copies send it, and someone whose supervisor has no account yet stays filtered by the written name, so no row vanishes from a screen where it was seen.
 */
/**
 * Light-transport sector, folded.
 * The individuals (b2c) department is the light-transport department, and its vehicles are recognised by sector in the vehicle register. Matching the literal sector string missed vehicles created there with a variant spelling or an extra space, with no clue why. Matching is by the word: anything containing the light-transport keyword belongs to it.
 */
const LIGHT_SECTOR = /خفيف/;

const supervisorFilter = (filter, value, field = 'supervisorUser') => {
  const v = S(value);
  if (!v) return;
  const nameField = field === 'supervisorUser' ? 'supervisorName' : 'dutySupervisorName';
  if (v === 'none') { filter[field] = null; return; }
  if (mongoose.isValidObjectId(v)) filter[field] = v;
  else filter[nameField] = v;
};

// Employee list
const LIST_POPULATE = [
  { path: 'employee', select: 'employeeNumber arabicName firstName lastName employmentStatus phone registerNumber staffCategory jobTitle department project' },
  { path: 'supervisor', select: 'arabicName firstName lastName employeeNumber' },
  { path: 'supervisorUser', select: 'firstName lastName email role' },
  { path: 'dutySupervisorUser', select: 'firstName lastName email role' },
  // The operating card and inspection are read with the vehicle.
  // The question 'whose operating card expires this month' is asked in this section, not in vehicles: the supervisor stops the person, not the vehicle. Both documents live on the vehicle register, so they are read with it in the same call and not copied here. The authorization sheet and the actual driver come along too: the sheet carries them as two columns and the question is about the person.
  { path: 'vehicle', select: 'plateNumber serialNumber registrationTypeAr brandAr modelAr operatingCard inspection authorizedPerson actualDriver' },
  { path: 'housing', select: 'name cityAr' },
];

exports.listEmployees = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.active !== 'all') filter.isActive = { $ne: false };
    // Comma-separated values (quick dashboard filters) or a single value as before.
    for (const [key, field] of [['jobTitle', 'jobTitleAr'],
      ['contractType', 'contractTypeAr'], ['register', 'registerNumber'],
      ['staffKind', 'staffKind']]) {
      const v = BOARD.vals(q[key]);
      if (v.length) filter[field] = v.length === 1 ? v[0] : { $in: v };
    }
    if (BOARD.vals(q.city).length) {
      const v = BOARD.vals(q.city);
      filter.cityAr = { $in: v.includes('—') ? [...v, '', null] : v };
    }
    // Project folded as the dashboard counts it (`projectKey`): one spelling variant also opens the other, otherwise the card count and the link would differ by half. The dashboard's 'unspecified' label opens those with no project.
    if (BOARD.vals(q.project).length) {
      const wants = new Set(BOARD.vals(q.project).map(BOARD.projectKey));
      const names = (await LightTransportEmployee.distinct('projectAr')).filter((n) => wants.has(BOARD.projectKey(n)));
      filter.projectAr = { $in: wants.has('') ? [...names, null, ''] : names };
    }
    supervisorFilter(filter, q.supervisor);
    supervisorFilter(filter, q.dutySupervisor, 'dutySupervisorUser');
    if (S(q.housing)) filter.housing = S(q.housing) === 'none' ? null : S(q.housing);
    // Those with a vehicle and those without; a frequent question.
    if (q.hasVehicle === 'yes') filter.vehicle = { $ne: null };
    if (q.hasVehicle === 'no') filter.vehicle = null;
    if (S(q.hiredFrom) || S(q.hiredTo)) {
      filter.hireDate = {};
      if (S(q.hiredFrom)) filter.hireDate.$gte = new Date(S(q.hiredFrom));
      // The upper bound is inclusive of that day, otherwise the last day of every range drops.
      if (S(q.hiredTo)) filter.hireDate.$lte = new Date(`${S(q.hiredTo)}T23:59:59.999Z`);
    }
    /**
     * Search matches any number in the asker's hand.
     * Someone asking about a driver holds whatever came to hand: name, plate, ID or residence number, vehicle serial number, or authorization number. Three of these are not on the employee row at all but in the vehicle register, so a search limited to our rows says no results while the vehicle is ours.
     * So the number is looked up in the vehicle register first, and matches are added to the condition by vehicle id: one small query whose answer opens the door from the other side.
     */
    if (S(q.q)) {
      const { arabicSearchRegex } = require('../utils/arabicSearch');
      const term = S(q.q);
      const rx = arabicSearchRegex(term);
      const or = [{ name: rx }, { idNumber: rx }, { vehiclePlate: rx }, { phone: rx },
        { supervisorName: rx }, { projectAr: rx }, { cityAr: rx }, { jobTitleAr: rx },
        { contractTypeAr: rx }, { registerNumber: rx }, { vehicleTypeAr: rx }, { notesAr: rx }];
      const vm = await VehicleMaster.find({
        $or: [{ plateNumber: rx }, { serialNumber: rx }, { chassisNumber: rx },
          { 'authorizedPerson.name': rx }, { 'authorizedPerson.iqamaNumber': rx },
          { 'authorizedPerson.authorizationNumber': rx }],
      }).select('_id').limit(400).lean();
      const ids = vm.map((v) => v._id);
      // Even if the text looks like a plate, it is matched by its folded key so letter/digit order does not block a find. See `plateKeyOf`.
      if (looksLikePlate(term)) {
        const want = plateKeyOf(term);
        const byKey = await VehicleMaster.find({}).select('_id plateNumber').lean();
        for (const v of byKey) if (plateKeyOf(v.plateNumber) === want) ids.push(v._id);
        const ltByPlate = await LightTransportEmployee.find({ vehiclePlate: { $nin: ['', null] } })
          .select('_id vehiclePlate').lean();
        const hit = ltByPlate.filter((x) => plateKeyOf(x.vehiclePlate) === want).map((x) => x._id);
        if (hit.length) or.push({ _id: { $in: hit } });
      }
      if (ids.length) or.push({ vehicle: { $in: ids } });
      filter.$or = or;
    }

    // An archived employee has no row here, as if deleted; a terminated one stays as a row (below).
    const { endedStaff, notArchivedRow, andAll } = require('../utils/archivedHidden');
    let rows = await LightTransportEmployee.find(andAll(filter, notArchivedRow(await endedStaff())))
      .populate(LIST_POPULATE).sort({ name: 1 }).lean();
    await BOARD.markHrLeave(rows);
    await require('../utils/ltRental').markRentals(rows);
    const alerts = await docAlerts();
    // Residence and driving licence expiry of the rider come from his file (utils/personDocDates).
    const personDocs = await require('../utils/personDocDates').docDatesFor(rows);
    rows = rows.map((r) => ({ ...decorate(r, alerts), ...personDocs(r) }));
    /**
     * Dashboard filters are applied with their dashboard meaning.
     * Status, category, linkage type, register, rider, vehicle and authorization are derived from two or three registers, so they apply after derivation using the same `personTests` the dashboard counts with: a clicked number opens exactly its members.
     */
    const tests = BOARD.personTests(
      Object.fromEntries(['status', 'vehicleType', 'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'].map((k) => [k, q[k]])),
      { typeKey },
    );
    rows = rows.filter((r) => tests(r));
    /**
     * The 'total riders' numbers open with their members.
     * Contract type is folded as `repsBreakdown` counts it (`contractIs`), and 'none' means no contract type written. `inService=1` drops terminated staff as the dashboard does, so a list opened from a number shows exactly those counted in it.
     */
    const ck = S(q.contractKind);
    if (ck === 'sponsored' || ck === 'freelance' || ck === 'users') rows = rows.filter((r) => contractIs(r, ck));
    if (ck === 'none') rows = rows.filter((r) => !contractKindOf(r));
    if (q.inService === '1') rows = rows.filter((r) => !isEnded(r));

    res.json({ employees: rows, totals: totalsOf(rows, { includeEnded: BOARD.vals(q.status).includes(ENDED) }), options: await optionsOf() });
  } catch (e) {
    console.error('lt listEmployees:', e);
    res.status(500).json({ message: 'تعذّر تحميل موظّفي النقل الخفيف' });
  }
};

/**
 * Terminated staff do not appear in the dashboard.
 * Rule for every department except HR: anyone whose service ended contributes to no dashboard figure, neither the terminated card nor the status distribution. A figure of 16 administrators included one terminated in HR, and a reviewer comparing with HR found 15. His row stays in the employee list to search and review his file: the list is a register, the dashboard is figures.
 * Terminated means the termination status (from HR) or a row removed from the department register.
 */
const ENDED = 'إنهاء خدمة';
const isEnded = (r) => r.workStatusShown === ENDED || r.isActive === false;
exports.isEnded = isEnded;

/** Department rows of terminated staff, to exclude them from the housing count. A bed is a counted resource: a terminated name left on a room makes it full and turns away someone who needs it. Status comes from HR when a file exists, otherwise from the last register entry. */
async function endedRowIds() {
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const rows = await LightTransportEmployee.find({
    housing: { $ne: null },
    $or: [{ employee: { $in: [...sets.ids].map((x) => new mongoose.Types.ObjectId(x)) } }, { employee: null, workStatusAr: ENDED }],
  }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** Sponsorship and freelancer are folded, not matched as text: the sheet writes several spellings of each. Anything without a written contract type is neither. */
/**
 * Sponsorship of someone with an HR file comes from the file.
 * Rule: sponsorship/freelancer is derived from the commercial registration number in HR (utils/hrEngagement). The department used to write its own field, leaving it empty for seven people whose type is known there (no contract type). The department field now serves only those without a file.
 */
const ENG = require('../utils/hrEngagement');
const contractKindOf = (r) => {
  // A rented user account is not sponsorship.
  // Every written value other than freelancer used to read as sponsorship, so the 13 Ninja user accounts were counted under sponsorship: 114 on the dashboard against 98 in the report sheet. A rented user is an active rental linked to its row; the text is a fallback for unlinked ones. See utils/ltRental.
  if (require('../utils/ltRental').isRented(r)) return 'users';
  if (r.employee && typeof r.employee === 'object') {
    const e = ENG.engagementOf(r.employee);
    return e === 'sponsored' || e === 'freelance' ? e : '';
  }
  const v = foldAr(String(r.contractTypeAr || '')).replace(/\s+/g, '');
  return v.includes('فريلانسر') ? 'freelance' : (v ? 'sponsored' : '');
};
const contractIs = (r, kind) => contractKindOf(r) === kind;

/**
 * Total riders: sponsorship + freelancer + user accounts.
 * Working riders by contract type, plus rented user accounts (user rental), all per project. A rider with no contract type is counted on its own (no contract type) so the sum holds. Project is folded: the two spellings of one project are one.
 */
const projectKey = (p) => foldAr(String(p || '')).replace(/\s+/g, '').replace(/ق/g, 'ج');
async function repsBreakdown(rows, projectFilter) {
  const rentals = await require('./ltUserRentalController').activeByProject();
  const key = projectKey;
  const by = new Map();
  const slot = (name) => {
    const k = key(name) || '—';
    if (!by.has(k)) by.set(k, { project: S(name) || '(غير محدد)', sponsored: 0, freelance: 0, users: 0, noContract: 0 });
    return by.get(k);
  };
  // Working staff only.
  // All department rows used to be counted, including six terminated freelancers with no HR file: 62 on the dashboard against 56 in the sheet. A terminated person is not counted here, as in the employee cards (totalsOf).
  const reps = rows.filter((r) => (r.staffKind === 'rep' || contractIs(r, 'users')) && !isEnded(r));
  for (const r of reps) {
    const o = slot(r.projectAr);
    const k = contractKindOf(r);
    if (k === 'freelance') o.freelance += 1;
    else if (k === 'sponsored') o.sponsored += 1;
    else if (k === 'users') o.users += 1;
    else o.noContract += 1;
  }
  for (const [p, n] of Object.entries(rentals)) {
    if (projectFilter && key(p) !== key(projectFilter)) continue;
    slot(p).users += n;
  }
  const projects = [...by.values()]
    .map((o) => ({ ...o, total: o.sponsored + o.freelance + o.users + o.noContract }))
    .filter((o) => o.total > 0)
    .sort((a, b) => b.total - a.total);
  const sum = (k) => projects.reduce((n, o) => n + o[k], 0);
  return {
    sponsored: sum('sponsored'), freelance: sum('freelance'), users: sum('users'), noContract: sum('noContract'),
    total: sum('total'),
    projects,
  };
}

/** Counts read in the cards - computed after filtering. */
const totalsOf = (allRows, { includeEnded = false } = {}) => {
  // Someone filtering explicitly on termination asked about them, so they are counted for that filter.
  const rows = includeEnded ? allRows : allRows.filter((r) => !isEnded(r));
  const count = (fn) => rows.filter(fn).length;
  const group = (fn) => {
    const o = {};
    for (const r of rows) { const k = fn(r) || '—'; o[k] = (o[k] || 0) + 1; }
    return o;
  };
  // Working means status 'working', the same filter the card opens. It used to be everyone not terminated or suspended, which included people on leave: card 161 against filter 157. Now working + on leave + suspended = total, each in its own card.
  const working = (r) => r.workStatusShown === 'يعمل';
  /**
   * Sponsorship and freelancer: two cards, not just a filter option.
   * How many are on sponsorship and how many freelancers are asked first when the screen opens, and used to need opening the filter, choosing each and reading the counter. They are now two fixed cards computed after filtering like the rest: filtering on a project reads that project's sponsorship only.
   * Matching is folded, not textual: the sheet writes four spellings for two meanings, and text matching gives a zero card.
   */
  const docState = (r, key, want) => {
    const st = r[key]?.state;
    return want === 'gap' ? ['expired', 'critical'].includes(st) : st === want;
  };
  return {
    total: rows.length,
    // All list rows (including terminated), for information, not counting.
    listed: allRows.length,
    endedHidden: allRows.length - rows.length,
    sponsored: count((r) => contractIs(r, 'sponsored')),
    freelance: count((r) => contractIs(r, 'freelance')),
    // An expired or nearly expired operating card or inspection: the person is stopped, not the vehicle. Someone with no inspection supervisor appears to nobody on the inspection screen, so the number is tracked until it reaches zero.
    noDutySupervisor: count((r) => r.staffKind === 'rep' && !r.dutySupervisorUser),
    cardGap: count((r) => docState(r, 'operatingCard', 'gap')),
    cardSoon: count((r) => ['warning', 'upcoming'].includes(r.operatingCard?.state)),
    inspectionGap: count((r) => docState(r, 'inspection', 'gap')),
    inspectionSoon: count((r) => ['warning', 'upcoming'].includes(r.inspection?.state)),
    reps: count((r) => r.staffKind === 'rep'),
    admins: count((r) => r.staffKind === 'admin'),
    // A driver works in the field, and someone with no written job does not fall under the rule; each is its own count, not an addition to administrators.
    drivers: count((r) => r.staffKind === 'driver'),
    unknownKind: count((r) => r.staffKind === 'unknown' || !String(r.jobTitleAr || '').trim()),
    working: count(working),
    notWorking: count((r) => !working(r)),
    onLeave: count((r) => r.workStatusShown === 'إجازة' || r.workStatusShown === 'اجازه'),
    suspended: count((r) => r.workStatusShown === BOARD.SUSPENDED),
    accident: count((r) => r.workStatusShown === BOARD.ACCIDENT),
    // Zero unless asked for explicitly with the termination filter.
    terminated: count(isEnded),
    withVehicle: count((r) => !!r.vehicle),
    withoutVehicle: count((r) => !r.vehicle),
    hrLinked: count((r) => r.hrLinked),
    ownedHere: count((r) => !r.hrLinked),
    housed: count((r) => !!r.housing),
    unhoused: count((r) => !r.housing),
    byProject: group((r) => r.projectAr),
    byCity: group((r) => r.cityAr),
    byJob: group((r) => r.jobTitleAr),
    byContract: group((r) => r.contractTypeAr),
    byRegister: group((r) => r.registerNumber),
    byVehicleType: group((r) => r.vehicleTypeShown),
    bySupervisor: group((r) => r.supervisorName),
    byStatus: group((r) => r.workStatusShown),
  };
};

/** Filter values are built from the register itself, not hand-written: anything added in department settings shows without a release, and unused values do not crowd the list. */
const optionsOf = async () => cache.wrap('lt:options', 60 * 1000, async () => {
  const [projects, cities, jobs, contracts, registers, vehicleTypes, supervisors, housings,
    unlinkedSupervisors] = await Promise.all([
    LightTransportEmployee.distinct('projectAr'),
    LightTransportEmployee.distinct('cityAr'),
    LightTransportEmployee.distinct('jobTitleAr'),
    LightTransportEmployee.distinct('contractTypeAr'),
    LightTransportEmployee.distinct('registerNumber'),
    // Types come from two registers: the employee field and the vehicle register's registration type, folded to one word; otherwise two spellings of one motorbike type would show as two options.
    (async () => {
      const [a, b] = await Promise.all([
        LightTransportEmployee.distinct('vehicleTypeAr'),
        VehicleMaster.distinct('registrationTypeAr', { sectorAr: LIGHT_SECTOR }),
      ]);
      return [...new Set([...a, ...b].filter(Boolean).map(typeKey))];
    })(),
    /**
     * Supervisors are accounts, not written names.
     * The list used to be `distinct('supervisorName')`, i.e. whatever was typed in rows: it showed variants of one name, missed a supervisor appointed yesterday with nobody assigned yet, and did not know the name has a login.
     * It now comes from accounts: every active account with a supervision role in the department, with its Arabic name from its file and its role. See `utils/b2cSupervisors`.
     */
    listSupervisors(),
    LightTransportHousing.find({ isActive: { $ne: false } }).select('name').lean(),
    // Names written in rows with no account yet stay in the filter so their rows do not vanish.
    LightTransportEmployee.distinct('supervisorName', { supervisorUser: null }),
  ]);
  const clean = (a) => a.filter(Boolean).sort((x, y) => String(x).localeCompare(String(y), 'ar'));
  return {
    project: clean(projects), city: clean(cities), jobTitle: clean(jobs),
    contractType: clean(contracts), register: clean(registers), vehicleType: clean(vehicleTypes),
    supervisor: supervisors,
    supervisorsUnlinked: clean(unlinkedSupervisors),
    housing: housings.map((h) => ({ _id: String(h._id), name: h.name })),
  };
});


/**
 * The supervisor list alone, a small call the phone reads.
 * The web takes it inside the list response (`options.supervisor`) and the phone builds its picker from a separate endpoint; both share one source, `listSupervisors`.
 */
exports.supervisors = async (req, res) => {
  try {
    res.json({ supervisors: await listSupervisors() });
  } catch (e) {
    console.error('lt supervisors:', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة المشرفين' });
  }
};

/**
 * Department dashboard: one query, not ten.
 * It is read in one call: employees, vehicles and housing together; ten sequential calls mean ten database round trips and a screen built in stages.
 * All counts are computed after filtering, so card and table agree: filtering on a project and reading 'sponsorship 9' finds the same nine in the list.
 * Vehicles are counted from the vehicle register, not from employee rows: a vehicle without a rider is in none of their rows and is the first thing asked about (how many vehicles are idle).
 */
/**
 * Figures do not move under the one who clicks them: each card group is counted with all filters except its own (faceted counts, same rule as `hrMasterController.expiring`), so clicking a card does not zero its siblings.
 * staffKind groups: without `staffKind`; status groups: without `status`; vehicle: without `hasVehicle`; housing: without `housing`; each split: without its own key; total and non-clickable: all filters.
 * Hence these keys are applied in memory, not in the query, with the same meaning as `listEmployees`.
 */
const OVERVIEW_FACETS = ['city', 'jobTitle', 'contractType', 'register', 'staffKind', 'project',
  'supervisor', 'housing', 'hasVehicle', 'status', 'vehicleType',
  // Quick dashboard filters; see utils/b2cBoard.QUICK.
  'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'];

/** Name of the B2C department in the HR departments list (its key is light_transport). */
const b2cDepartment = () => cache.wrap('lt:b2cdept', 60000, async () => {
  const Lookup = require('../models/Lookup');
  const row = await Lookup.findOne({ type: 'hr_department', key: 'light_transport', deleted: { $ne: true } }).select('nameAr').lean();
  return S(row?.nameAr) || 'B2C';
});

/**
 * Department vehicles as countable, filterable rows.
 * Every vehicle the vehicles department attributes to light transport (by sector or management), authorized or not, plus every vehicle with a rider from the department register (`BOARD.vehicleScope`). Each has its project (the rider's project, else its management in the register), city, folded type, authorization state (`BOARD.authOf`) and riders.
 * Read by both the dashboard and the light-transport vehicles page, so what a card counts is what its link opens.
 */
async function vehicleRows(riderRows, select = '', holderRows = []) {
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const id = String(r.vehicle && typeof r.vehicle === 'object' ? r.vehicle._id : r.vehicle);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(r);
    }
    return m;
  };
  const byVehicle = group(riderRows);
  const heldBy = group(holderRows);
  const vehicles = await VehicleMaster.find(BOARD.vehicleScope([...byVehicle.keys(), ...heldBy.keys()]))
    .select(`plateNumber serialNumber registrationTypeAr departmentAr cityAr sectorAr serviceStatusAr serviceStatusCode authorizedPerson actualDriver ${select}`)
    .lean();
  const today = require('../utils/companyDay').todayKey();
  const { vehicleState } = require('../utils/ltRider');
  return vehicles.map((v) => {
    const riders = byVehicle.get(String(v._id)) || [];
    const holders = heldBy.get(String(v._id)) || [];
    return {
      _id: String(v._id), v, riders, holders,
      // With rider, awaiting hand-over (including terminated staff), idle - utils/ltRider.
      state: vehicleState(riders, holders),
      project: S(riders[0]?.projectAr) || S(v.departmentAr),
      city: S(riders[0]?.cityAr) || S(v.cityAr),
      typeKey: typeKey(v.registrationTypeAr),
      auth: BOARD.authOf(v, today),
    };
  });
}

/**
 * Staff whose service ended while the vehicle is still with them: awaiting hand-over.
 * Active department rows linked to a vehicle whose holder is terminated in HR (or in the register if no file), including archived ones: the name is not shown and the vehicle shows 'awaiting hand-over', not 'idle'. A separate query from the dashboard rows, so neither person filters nor the archive rule hide it.
 */
async function heldRows() {
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const rows = await LightTransportEmployee.find({
    isActive: { $ne: false }, vehicle: { $ne: null },
    $or: [{ employee: { $in: [...sets.ids].map((x) => new mongoose.Types.ObjectId(x)) } },
      { employee: null, workStatusAr: /انهاء|إنهاء/ }],
  }).select('_id name idNumber vehicle vehiclePlate employee vehicleHold').lean();
  return rows.map((r) => ({
    ...r,
    archived: r.employee ? sets.archivedIds.has(String(r.employee)) : sets.archivedIdNumbers.has(S(r.idNumber).replace(/\s+/g, '')),
  }));
}
exports._heldRows = heldRows;

/** Department rows enriched: all of them, plus those counted as riders (in service and on a vehicle). */
async function boardRows(filter) {
  const { endedStaff, notArchivedRow, andAll } = require('../utils/archivedHidden');
  const archSets = await endedStaff();
  const rows = await LightTransportEmployee.find(andAll(filter, notArchivedRow(archSets))).populate(LIST_POPULATE).lean();
  await BOARD.markHrLeave(rows);
  await require('../utils/ltRental').markRentals(rows);
  const alerts = await docAlerts();
  return rows.map((r) => decorate(r, alerts));
}

/** Filter options: `{value, label, count}` by row count, most first. */
const optionList = (list, valueOf, labelOf = (v) => v) => {
  const m = new Map();
  for (const r of list) {
    const v = valueOf(r);
    if (v == null || v === '') continue;
    const o = m.get(v) || { value: v, label: labelOf(v, r), count: 0 };
    o.count += 1;
    m.set(v, o);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'ar'));
};

exports._facetTest = (q) => BOARD.personTests(q, { typeKey, contractKindOf });
exports._vehicleRows = vehicleRows;

exports.overview = async (req, res) => {
  try {
    const q = req.query || {};
    // The query holds what is not a dashboard filter; dashboard filters are applied after the fetch.
    const filter = { isActive: { $ne: false } };
    supervisorFilter(filter, q.dutySupervisor, 'dutySupervisorUser');
    if (S(q.hiredFrom) || S(q.hiredTo)) {
      filter.hireDate = {};
      if (S(q.hiredFrom)) filter.hireDate.$gte = new Date(S(q.hiredFrom));
      if (S(q.hiredTo)) filter.hireDate.$lte = new Date(`${S(q.hiredTo)}T23:59:59.999Z`);
    }
    const narrowed = Object.keys(filter).length > 1;

    const [decorated, allRows, housing, orders, b2cDept] = await Promise.all([
      boardRows(filter),
      // 'Idle' is measured over the whole register, not the filtered set. A terminated person is not counted as a rider: his vehicle is idle even if his name stays on it in the register.
      narrowed ? boardRows({ isActive: { $ne: false } }) : null,
      LightTransportHousing.find({ isActive: { $ne: false } }).lean(),
      LightTransportOrder.find({ status: 'active' }).select('vehicle ltEmployee').lean(),
      b2cDepartment(),
    ]);
    // Rider has one definition (utils/ltRider): an active row linked to the vehicle, whatever its day status - over the whole register, not the filtered set, so a person filter does not make a vehicle 'idle'. A terminated one is 'awaiting hand-over'.
    const riderRows = (allRows || decorated).filter((r) => r.vehicle && !isEnded(r));
    const vrows = await vehicleRows(riderRows, '', await heldRows());

    const people = BOARD.personTests(q, { typeKey, contractKindOf });
    const vpass = BOARD.vehicleTests(q, people, { typeKey });
    const has = (k) => (k === 'hasVehicle' ? !!q.hasVehicle : BOARD.vals(q[k]).length > 0);
    const listedRows = decorated.filter((r) => people(r));
    // All dashboard figures cover people in service, unless the filter asks for terminated.
    const includeEnded = BOARD.vals(q.status).includes(ENDED);
    const live = (list) => (includeEnded ? list : list.filter((r) => !isEnded(r)));
    const rows = live(listedRows);
    /** Rows of a group counted without its own filter - for splits and filter options. */
    const without = (k) => (has(k) ? decorated.filter((r) => people(r, k)) : listedRows);

    // Vehicles
    const onOrder = new Set(orders.map((o) => String(o.vehicle || '')));
    const vShown = vrows.filter((v) => vpass(v));
    // 'With rider / idle' is the vehicles' own split: 'without vehicle' does not zero it.
    const vSplit = vrows.filter((v) => vpass(v, 'hasVehicle'));
    const vGroup = (list, fn) => {
      const o = {};
      for (const v of list) { const k = fn(v) || '—'; o[k] = (o[k] || 0) + 1; }
      return o;
    };

    // Housing occupancy without the housing filter: clicking one housing in the table does not zero the others.
    const housingRows = live(without('housing'));
    const housedIn = {};
    for (const r of housingRows) { if (r.housing) { const k = String(r.housing._id); housedIn[k] = (housedIn[k] || 0) + 1; } }
    const roomOcc = {};
    for (const r of housingRows) {
      if (r.housing && r.housingRoom) { const k = `${String(r.housing._id)}|${r.housingRoom}`; roomOcc[k] = (roomOcc[k] || 0) + 1; }
    }

    // The old figures (splits and the old app): each group without its own filter.
    const employees = totalsOf(listedRows, { includeEnded });
    const facet = (k, keys) => {
      if (!has(k)) return;
      const t = totalsOf(without(k), { includeEnded });
      for (const key of keys) employees[key] = t[key];
    };
    facet('staffKind', ['reps', 'admins', 'drivers', 'unknownKind']);
    facet('status', ['working', 'notWorking', 'onLeave', 'suspended', 'accident', 'terminated', 'byStatus']);
    facet('hasVehicle', ['withVehicle', 'withoutVehicle']);
    facet('housing', ['housed', 'unhoused']);
    facet('project', ['byProject']); facet('city', ['byCity']); facet('jobTitle', ['byJob']);
    facet('contractType', ['byContract']); facet('register', ['byRegister']);
    facet('supervisor', ['bySupervisor']); facet('vehicleType', ['byVehicleType']);

    const reps = await repsBreakdown(rows, BOARD.vals(q.project).length === 1 ? BOARD.vals(q.project)[0] : '');
    if (has('project')) reps.projects = (await repsBreakdown(live(without('project')), '')).projects;

    /**
     * The dashboard as the company owner asked.
     * The total, and under it three cards (rider, administrative, technician), each with its two halves (sponsorship, freelancer) and the remainder as a small number: the halves plus the remainder equal the card, and the cards (plus 'unclassified' if present) equal the total. Then work status: working, leave, suspended, accident, each split by category, summing to the same total. Every figure is under all filters: choosing a project reads that project's figures only.
     */
    const ENG_KEYS = ['sponsored', 'freelance', 'trainee', 'users', 'none'];
    const CATS = ['rep', 'admin', 'tech', 'none'];
    const categories = {};
    for (const c of CATS) categories[c] = { total: 0, ...Object.fromEntries(ENG_KEYS.map((k) => [k, 0])) };
    const status = {};
    for (const s of [...BOARD.WORK_STATES, ...(includeEnded ? [ENDED] : [])]) {
      status[s] = { total: 0, ...Object.fromEntries(CATS.map((c) => [c, 0])) };
    }
    for (const r of rows) {
      const c = BOARD.categoryOf(r);
      categories[c].total += 1;
      categories[c][BOARD.engagementOf(r)] += 1;
      const st = status[r.workStatusShown] || (status[r.workStatusShown] = { total: 0, ...Object.fromEntries(CATS.map((x) => [x, 0])) });
      st.total += 1; st[c] += 1;
    }
    const authCount = (list) => ({
      authorized: list.filter((v) => v.auth === 'authorized').length,
      expired: list.filter((v) => v.auth === 'expired').length,
      none: list.filter((v) => v.auth === 'none').length,
    });

    // Filter options: each with its count under the other filters.
    const projectNames = new Map();
    for (const r of decorated) { const k = BOARD.projectKey(r.projectAr); if (!projectNames.has(k)) projectNames.set(k, S(r.projectAr) || BOARD.UNSET); }
    const vehiclesWithout = (k) => vrows.filter((v) => vpass(v, k));
    const filterOptions = {
      project: optionList(live(without('project')), (r) => projectNames.get(BOARD.projectKey(r.projectAr)) || BOARD.UNSET),
      rep: optionList(live(without('rep')), (r) => String(r._id), (v, r) => `${r.name}${r.idNumber ? ` — ${r.idNumber}` : ''}`),
      vehicle: optionList(vehiclesWithout('vehicle'), (v) => v._id,
        (id, v) => `${S(v.v.plateNumber) || S(v.v.serialNumber) || '—'}${v.riders[0] ? ` — ${v.riders[0].name}` : ''}`),
      auth: optionList(vehiclesWithout('auth'), (v) => v.auth, (v) => BOARD.AUTH_AR[v] || v),
      cr: optionList(live(without('cr')), (r) => BOARD.registerOf(r), (v) => (v === '—' ? 'غير محدد' : v)),
      engagement: optionList(live(without('engagement')), (r) => BOARD.engagementOf(r), (v) => BOARD.ENGAGEMENT_AR[v] || v),
      category: optionList(live(without('category')), (r) => BOARD.categoryOf(r), (v) => BOARD.CATEGORY_AR[v] || v),
      city: optionList(live(without('city')), (r) => S(r.cityAr) || '—', (v) => (v === '—' ? 'غير محدد' : v)),
      // Terminated staff are not an option: their place is HR (ended staff rule).
      status: optionList(without('status').filter((r) => !isEnded(r)), (r) => r.workStatusShown),
    };

    res.json({
      board: {
        total: rows.length,
        categories,
        status,
        vehicles: {
          total: vSplit.length,
          withRider: vSplit.filter((v) => v.state === 'withRider').length,
          hold: vSplit.filter((v) => v.state === 'hold').length,
          idle: vSplit.filter((v) => v.state === 'idle').length,
          onActiveOrder: vSplit.filter((v) => onOrder.has(v._id)).length,
          auth: authCount(vSplit),
        },
        // His HR file is in a department other than B2C: he was moved there but not removed from the department register (removal is not automatic). A figure to review, not to correct silently.
        otherDepartment: rows.filter((r) => r.employee && typeof r.employee === 'object'
          && S(r.employee.department) && S(r.employee.department) !== b2cDept
          && !require('../utils/lightTransportSync').isLightDepartment(r.employee.department)).length,
        b2cDepartment: b2cDept,
      },
      filterOptions,
      quickFilters: BOARD.QUICK,
      employees,
      reps,
      vehicles: {
        total: vSplit.length,
        // The department's vehicle total stays shown so the displayed part is known to be a portion of it.
        totalAll: vrows.length,
        withRider: vSplit.filter((v) => v.state === 'withRider').length,
        hold: vSplit.filter((v) => v.state === 'hold').length,
        idle: vSplit.filter((v) => v.state === 'idle').length,
        onActiveOrder: vSplit.filter((v) => onOrder.has(v._id)).length,
        byType: vGroup(vrows.filter((v) => vpass(v, 'vehicleType')), (v) => v.v.registrationTypeAr),
        byProject: vGroup(vShown, (v) => v.project),
        byServiceStatus: vGroup(vShown, (v) => v.v.serviceStatusAr),
        byAuth: authCount(vShown),
      },
      housing: housing.map((h) => {
        const cap = (h.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0) || Number(h.declaredCapacity) || 0;
        const occupied = housedIn[String(h._id)] || 0;
        return {
          _id: String(h._id), name: h.name, cityAr: h.cityAr,
          capacity: cap, occupied, free: Math.max(0, cap - occupied),
          rooms: (h.rooms || []).map((r) => {
            const o = roomOcc[`${String(h._id)}|${r.name}`] || 0;
            return { name: r.name, kind: r.kind, capacity: r.capacity, occupied: o, free: Math.max(0, (Number(r.capacity) || 0) - o) };
          }),
        };
      }),
      orders: { active: orders.length },
      /** What is missing and needs work, not what exists. */
      gaps: {
        workingWithoutVehicle: rows.filter((r) => !r.vehicle
          && ![ENDED, BOARD.SUSPENDED, BOARD.ACCIDENT].includes(r.workStatusShown)).length,
        idleVehicles: vSplit.filter((v) => v.state === 'idle').length,
        heldVehicles: vSplit.filter((v) => v.state === 'hold').length,
        noRegister: rows.filter((r) => !S(r.registerNumber) && r.workStatusShown !== ENDED).length,
        noContractType: rows.filter((r) => !S(r.contractTypeAr)).length,
        noSupervisor: rows.filter((r) => r.staffKind === 'rep' && !S(r.supervisorName)).length,
        unhoused: housingRows.filter((r) => !r.housing).length,
        noHrFile: rows.filter((r) => !r.hrLinked).length,
        // A sheet in a name other than the rider's, read from the vehicle register, not the row.
        authorizationMismatch: rows.filter((r) => {
          if (!r.vehicle || typeof r.vehicle !== 'object') return false;
          const holder = S(r.vehicle.authorizedPerson?.iqamaNumber);
          return holder && S(r.idNumber) && holder !== S(r.idNumber);
        }).length,
      },
      options: await optionsOf(),
    });
  } catch (e) {
    console.error('lt overview:', e);
    res.status(500).json({ message: 'تعذّر تحميل لوحة القسم' });
  }
};

// Single employee file
exports.getEmployee = async (req, res) => {
  try {
    const row = await LightTransportEmployee.findById(req.params.id).populate(LIST_POPULATE).lean();
    if (!row) return res.status(404).json({ message: 'الموظّف غير موجود' });
    await BOARD.markHrLeave([row]);
    await require('../utils/ltRental').markRentals([row]);
    const orders = await LightTransportOrder.find({ ltEmployee: row._id })
      .populate('vehicle', 'plateNumber registrationTypeAr')
      .populate('housing', 'name')
      .sort({ startDate: -1 }).lean();
    res.json({ employee: decorate(row, await docAlerts()), orders });
  } catch (e) {
    console.error('lt getEmployee:', e);
    res.status(500).json({ message: 'تعذّر تحميل ملفّ الموظّف' });
  }
};

// `supervisorName` is not one of them: it is derived from the chosen account. See `applySupervisor`.
const EDITABLE = ['name', 'nationalityAr', 'phone', 'cityAr', 'projectAr', 'jobTitleAr', 'contractTypeAr',
  // `workStatusAr` is not one of them: work status comes from HR. See `shownStatus`.
  'registerNumber', 'vehicleTypeAr', 'housingRoom', 'notesAr', 'hireDate'];

/**
 * Supervisor assignment: an account is chosen, the rest is derived.
 * `supervisorUser` (an account id) is sent, or empty meaning no supervisor. From it the name is written as a snapshot and the file as a reference, so no hand-typed name drifts from its owner.
 * The rider is also assigned in the app register (`B2CRep.supervisor`) so his supervisor sees him in the start-of-shift check: one assignment shows on both screens. See `utils/b2cSupervisors.syncRepSupervisor`.
 * An account without a supervision role is rejected explicitly: assigning to it leaves a rider nobody checks.
 */
async function applySupervisor(doc, body, res) {
  // Operational supervisor and inspection supervisor are assigned independently, and both are accounts, not names.
  for (const [field, nameField, empField] of [
    ['supervisorUser', 'supervisorName', 'supervisor'],
    ['dutySupervisorUser', 'dutySupervisorName', null],
  ]) {
    if (body[field] === undefined) continue;
    const want = S(body[field]);
    if (!want || want === 'none') {
      doc[field] = null; doc[nameField] = '';
      if (empField) doc[empField] = null;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const sup = await resolveSupervisor(want);
    if (!sup) {
      res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
      return false;
    }
    doc[field] = sup._id;
    doc[nameField] = sup.name;
    if (empField) doc[empField] = sup.employee || null;
  }
  return true;
}

/**
 * Adding an employee here also creates his HR file in the same request, tagged `createdVia: 'b2c'` with department 'B2C', so no working person exists without a file. HR completes the rest from the employees page.
 * Documents are saved with it.
 * body: register fields + { dateOfBirth, files: [{ dataUrl, fileName, title }] }
 */
const FREELANCE_RX = /فري|حر|free/i;
exports.createEmployee = async (req, res) => {
  try {
    const idNumber = S(req.body.idNumber).replace(/\s+/g, '');
    if (!idNumber) return res.status(400).json({ message: 'رقمُ الهويّة مطلوب' });
    const name = S(req.body.name);
    if (!name) return res.status(400).json({ message: 'الاسمُ مطلوب' });
    const dup = await LightTransportEmployee.findOne({ idNumber });
    if (dup) return res.status(400).json({ message: `الهويّةُ ${idNumber} مسجَّلةٌ بالفعل لـ${dup.name}` });

    // Documents are saved before any write: a rejected file leaves no half-created employee.
    const { saveUploadFile } = require('../utils/fileStore');
    const stored = [];
    try {
      for (const f of Array.isArray(req.body.files) ? req.body.files.slice(0, 15) : []) {
        if (!f?.dataUrl) continue;
        if (!S(f.title)) return res.status(400).json({ message: 'اكتب اسمَ كلّ مستندٍ مرفق' });
        stored.push({ ...saveUploadFile(f.dataUrl, 'employees', f.fileName || ''), title: S(f.title).slice(0, 150) });
      }
    } catch (e) { return res.status(400).json({ message: 'نوعُ الملفّ غير مدعوم (صورة أو PDF أو Word أو Excel) أو حجمُه أكبر من ٢٠ ميغابايت' }); }

    const doc = new LightTransportEmployee({ idNumber, createdBy: req.user?._id });
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    doc.name = name;
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    await applyHousing(doc, req.body.housing, req.body.housingRoom, res);
    if (res.headersSent) return undefined;

    // Linked to his file if his ID is in HR, otherwise a file is created for him.
    let hr = await Employee.findOne({ $or: [{ nationalId: idNumber }, { iqamaNumber: idNumber }] });
    let hrCreated = false;
    if (!hr) {
      const parts = name.split(/\s+/);
      const type = S(req.body.contractTypeAr);
      const { applyEmploymentType, FREELANCER, SPONSORED } = require('../utils/employmentType');
      const isSaudi = /^1\d{9}$/.test(idNumber);
      const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(S(v)) ? S(v).slice(0, 10) : '');
      hr = new Employee({
        firstName: parts[0], lastName: parts.slice(1).join(' ') || '—', arabicName: name,
        idType: isSaudi ? 'national_id' : 'iqama',
        ...(isSaudi ? { nationalId: idNumber } : { iqamaNumber: idNumber }),
        nationality: S(req.body.nationalityAr), phone: S(req.body.phone),
        hireDate: day(req.body.hireDate) || undefined, dateOfBirth: day(req.body.dateOfBirth) || undefined,
        department: 'B2C', project: S(req.body.projectAr), workLocation: S(req.body.cityAr), branchName: S(req.body.cityAr),
        jobTitle: S(req.body.jobTitleAr), registerNumber: S(req.body.registerNumber),
        employmentStatus: 'active', isHrRecord: true, createdVia: 'b2c', hrPending: true, createdBy: req.user?._id,
      });
      if (type) {
        const set = applyEmploymentType(FREELANCE_RX.test(type) ? FREELANCER : SPONSORED);
        hr.employmentType = set.employmentType; hr.isFreelancer = set.isFreelancer;
        if (!hr.fieldStatus || typeof hr.fieldStatus.set !== 'function') hr.fieldStatus = new Map();
        for (const [k, v] of Object.entries(set)) if (k.startsWith('fieldStatus.') && v) hr.fieldStatus.set(k.slice('fieldStatus.'.length), v);
      }
      await hr.save();
      hrCreated = true;
    }
    doc.employee = hr._id;
    doc.history.push({ kind: 'created', by: req.user?._id, byName: byName(req.user), note: hrCreated ? 'أُنشئ في القسم، وأُنشئ ملفُّه في الموارد البشريّة' : 'أُنشئ ومُرتبطٌ بملفّ الموارد البشريّة' });
    try {
      await doc.save();
    } catch (e) {
      // No HR file without its light-transport row: a retry would otherwise find a file and no employee.
      if (hrCreated) await Employee.deleteOne({ _id: hr._id }).catch(() => {});
      throw e;
    }

    if (stored.length) {
      const EmployeeDocument = require('../models/EmployeeDocument');
      await EmployeeDocument.insertMany(stored.map((f) => ({
        employee: hr._id, title: f.title, category: 'other', fileUrl: f.fileUrl, fileName: f.fileName, mimeType: f.mimeType, size: f.size, uploadedBy: req.user?._id,
      })));
    }
    if (doc.supervisorUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    logAudit({ user: req.user, action: 'create_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: { name: doc.name, idNumber, hrFileCreated: hrCreated, documents: stored.length } }, ipAddress: req.ip }).catch(() => {});
    if (hrCreated) {
      logAudit({ user: req.user, action: 'create_employee', entity: 'Employee', entityId: hr._id, changes: { after: { name, idNumber, from: 'سجلّ النقل الخفيف (قسم الأفراد)' } }, ipAddress: req.ip }).catch(() => {});
    }
    // HR hears at once: employees, master, analytics and expiries.
    try { require('./hrController')._bustEmployeeCaches(); } catch (e) { /* */ }
    if (hrCreated) {
      try {
        const { notifySection } = require('../services/notificationService');
        await notifySection('HR', { title: 'موظف جديد من قسم الأفراد', message: `${name} — أضافه ${byName(req.user) || 'قسم الأفراد'}. أكمِل بياناتِه.`, relatedEntity: 'Employee', relatedEntityId: hr._id });
      } catch (e) { /* The notification is a convenience, not a requirement. */ }
    }
    emit('lt:updated', {});
    return res.status(201).json({ employee: doc.toObject(), hrEmployee: hr._id, hrCreated, documents: stored.length });
  } catch (e) {
    console.error('lt createEmployee:', e);
    return require('../utils/mongooseError').sendMongooseError(res, e, 'تعذّر إنشاء الموظّف');
  }
};

/**
 * Housing is never exceeded.
 * Housing is limited capacity and its rooms are for different types: the riders' room takes eight, the supervisors' room three. So placement is computed before writing: how many in this housing now, how many in this room, and whether the room suits his type. Without it the number in settings is decoration and eleven get housed in a room for eight.
 */
async function applyHousing(doc, housingId, room, res) {
  const wanted = S(housingId);
  if (!wanted || wanted === 'none') { doc.housing = null; doc.housingRoom = ''; return; }
  if (!mongoose.isValidObjectId(wanted)) { res.status(400).json({ message: 'سكنٌ غير معروف' }); return; }
  const housing = await LightTransportHousing.findById(wanted).lean();
  if (!housing) { res.status(404).json({ message: 'السكنُ غير موجود' }); return; }

  const roomName = S(room);
  const sameHousing = String(doc.housing || '') === String(housing._id);
  const sameRoom = sameHousing && S(doc.housingRoom) === roomName;
  if (sameRoom) return;                       // Nothing changes, so no calculation and no risk.

  const occupants = await LightTransportEmployee.countDocuments({
    housing: housing._id, isActive: { $ne: false }, _id: { $ne: doc._id, $nin: await endedRowIds() },
  });
  const capacity = (housing.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0)
    || Number(housing.declaredCapacity) || 0;
  if (capacity && occupants >= capacity) {
    res.status(400).json({
      code: 'HOUSING_FULL',
      message: `سكن «${housing.name}» مكتمل: ${occupants} من ${capacity}.`,
    });
    return;
  }

  if (roomName) {
    const r = (housing.rooms || []).find((x) => S(x.name) === roomName);
    if (!r) { res.status(400).json({ message: `لا غرفةَ بهذا الاسم في «${housing.name}»` }); return; }
    // The room is for his type or for all; otherwise a supervisor would be housed in a riders' room.
    if (r.kind !== 'any' && r.kind !== doc.staffKind) {
      const want = r.kind === 'rep' ? 'المناديب' : 'الإداريّين';
      res.status(400).json({ message: `غرفة «${r.name}» مخصَّصةٌ لـ${want}` });
      return;
    }
    const inRoom = await LightTransportEmployee.countDocuments({
      housing: housing._id, housingRoom: roomName, isActive: { $ne: false }, _id: { $ne: doc._id, $nin: await endedRowIds() },
    });
    if (Number(r.capacity) && inRoom >= Number(r.capacity)) {
      res.status(400).json({
        code: 'ROOM_FULL',
        message: `غرفة «${r.name}» مكتملة: ${inRoom} من ${r.capacity}.`,
      });
      return;
    }
  }

  if (!sameHousing) {
    doc.history.push({ kind: 'housing', fromValue: doc.housing ? 'سكنٌ سابق' : '', toValue: housing.name });
  }
  doc.housing = housing._id;
  doc.housingRoom = roomName;
}

exports.updateEmployee = async (req, res) => {
  try {
    const doc = await LightTransportEmployee.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الموظّف غير موجود' });

    // Every transfer is recorded.
    // 'Moved from project to project' is asked months later, and a field that is replaced does not keep the answer. So any change to these four is written in the employee's log with its author.
    // Project does not change through edit: only 'transfer project', and only by whoever owns it - POST /employees/:id/transfer-project.
    if (req.body.projectAr !== undefined && S(req.body.projectAr) !== S(doc.projectAr) && S(doc.projectAr)) {
      return res.status(403).json({ message: 'المشروع يتغيّر بـ«نقل مشروع» من صفحة المندوب — لنائب مدير قطاع الأفراد ومدير القسم والسوبر أدمن والأدمن' });
    }
    // User accounts are written only by user rental.
    // Contract type 'user accounts' mirrors an active rental (utils/ltRental): the rental is registered or ended in user rental and the row follows. It is not written here, or the two would diverge.
    if (req.body.contractTypeAr !== undefined) {
      const RENT = require('../utils/ltRental');
      const toUsers = RENT.isUsersText(req.body.contractTypeAr);
      if (toUsers !== RENT.isUsersText(doc.contractTypeAr)) {
        const active = await require('../models/LtUserRental').exists({ ltEmployee: doc._id, status: 'active' });
        if (toUsers || active) {
          return res.status(409).json({
            message: toUsers
              ? 'اليوزرُ المؤجَّر يُسجَّل من «تأجير اليوزرات» — فيصير نوعُ عقده «يوزرات» تلقائيًّا'
              : 'هذا يوزرٌ مؤجَّر — أنهِ تأجيرَه من «تأجير اليوزرات» فيعود نوعُ عقده تلقائيًّا',
          });
        }
      }
    }
    const TRACKED = { projectAr: 'project', cityAr: 'city' };
    for (const [field, kind] of Object.entries(TRACKED)) {
      if (req.body[field] !== undefined && S(req.body[field]) !== S(doc[field])) {
        doc.history.push({
          kind, by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc[field]), toValue: S(req.body[field]), note: S(req.body.moveNote),
        });
      }
    }
    // A supervisor change is logged by the two names, not ids: the log is read months later.
    const beforeSupName = S(doc.supervisorName);
    const beforeSupUser = String(doc.supervisorUser || '');
    const beforeDutyName = S(doc.dutySupervisorName);
    const beforeIdentity = `${S(doc.name)}|${S(doc.phone)}`;
    const beforeDutyUser = String(doc.dutySupervisorUser || '');
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    if (String(doc.supervisorUser || '') !== beforeSupUser) {
      doc.history.push({
        kind: 'supervisor', by: req.user?._id, byName: byName(req.user),
        fromValue: beforeSupName, toValue: S(doc.supervisorName), note: S(req.body.moveNote),
      });
    }
    if (String(doc.dutySupervisorUser || '') !== beforeDutyUser) {
      doc.history.push({
        kind: 'dutySupervisor', by: req.user?._id, byName: byName(req.user),
        fromValue: beforeDutyName, toValue: S(doc.dutySupervisorName), note: S(req.body.moveNote),
      });
    }
    if (req.body.housing !== undefined) {
      await applyHousing(doc, req.body.housing, req.body.housingRoom ?? doc.housingRoom, res);
      if (res.headersSent) return undefined;
    }
    /**
     * Today's status: working, leave, suspended, accident.
     * Written by the department from the employee row, recorded in his log, and copied to his HR file and his vehicle (models/LightTransport). Only termination in HR blocks it: a terminated person has no day status.
     */
    if (req.body.opStatus !== undefined) {
      const want = S(req.body.opStatus);
      if (!['', ...Object.keys(BOARD.OP_STATUS)].includes(want)) return res.status(400).json({ message: 'حالةُ عملٍ غير معروفة' });
      if (want !== S(doc.opStatus)) {
        const hr = doc.employee ? await Employee.findById(doc.employee).select('employmentStatus').lean() : null;
        if (hr && hr.employmentStatus === 'terminated' && want) {
          return res.status(409).json({ message: 'انتهت خدمتُه في الموارد البشرية — لا حالةَ عملٍ له في القسم' });
        }
        doc.history.push({
          kind: 'status', by: req.user?._id, byName: byName(req.user),
          fromValue: BOARD.OP_STATUS[doc.opStatus] || BOARD.WORKING, toValue: BOARD.OP_STATUS[want] || BOARD.WORKING,
          note: S(req.body.opStatusNote),
        });
        doc.opStatus = want;
        doc.opStatusAt = new Date();
        doc.opStatusNote = S(req.body.opStatusNote).slice(0, 300);
      }
    }
    doc.lastModifiedBy = req.user?._id;
    await doc.save();
    if (String(doc.supervisorUser || '') !== beforeSupUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    // Name and phone are followed by the delivery-app account - utils/b2cEntry.syncRepOf.
    if (`${S(doc.name)}|${S(doc.phone)}` !== beforeIdentity) {
      try { await require('../utils/b2cEntry').syncRepOf(doc); cache.clear('b2c:'); } catch (_) { /* */ }
    }
    logAudit({ user: req.user, action: 'update_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: Object.keys(req.body) }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    // Status became termination? The vehicle is released - see utils/ltVehicleRelease.
    require('../utils/ltVehicleRelease').after();
    return res.json({ employee: doc.toObject() });
  } catch (e) {
    console.error('lt updateEmployee:', e);
    return res.status(500).json({ message: 'تعذّر تعديل الموظّف' });
  }
};

/**
 * Assigning a supervisor to several employees at once.
 * Assigning row by row means opening a dialog 147 times, and distribution happens in groups: a whole station moves to a supervisor, or a project is handed over.
 * Either supervisor kind may be sent - operational, inspection or both - and an explicit empty (`none`) means remove. What is not sent is untouched: assigning an inspection supervisor must not drop the operational one by omission.
 */
exports.assignSupervisors = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'اختر موظّفًا واحدًا على الأقلّ' });
    const has = (k) => req.body[k] !== undefined && req.body[k] !== null && String(req.body[k]) !== '';
    if (!has('supervisorUser') && !has('dutySupervisorUser')) {
      return res.status(400).json({ message: 'اختر مشرفًا تشغيليًّا أو مشرفَ تفقّد' });
    }

    const set = {};
    for (const [field, nameField, empField] of [
      ['supervisorUser', 'supervisorName', 'supervisor'],
      ['dutySupervisorUser', 'dutySupervisorName', null],
    ]) {
      if (!has(field)) continue;
      const want = S(req.body[field]);
      if (want === 'none') {
        set[field] = null; set[nameField] = '';
        if (empField) set[empField] = null;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const sup = await resolveSupervisor(want);
      if (!sup) return res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
      set[field] = sup._id;
      set[nameField] = sup.name;
      if (empField) set[empField] = sup.employee || null;
    }

    // `history` is in the loaded fields: the entry is pushed to it, and an array that was not loaded is `undefined`.
    /**
     * Written with an update, not a save.
     * `doc.save()` on a row loaded with selected fields runs schema hooks on absent fields and re-derives what was not read. Only two fields and a log entry are needed, not a row recompute, so they are written directly with `$set` and `$push`.
     */
    const rows = await LightTransportEmployee.find({ _id: { $in: ids } })
      .select('name supervisorName dutySupervisorName supervisorUser dutySupervisorUser').lean();
    for (const doc of rows) {
      const entries = [];
      if (set.supervisorUser !== undefined && String(doc.supervisorUser || '') !== String(set.supervisorUser || '')) {
        entries.push({ kind: 'supervisor', by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc.supervisorName), toValue: S(set.supervisorName), note: S(req.body.note), at: new Date() });
      }
      if (set.dutySupervisorUser !== undefined && String(doc.dutySupervisorUser || '') !== String(set.dutySupervisorUser || '')) {
        entries.push({ kind: 'dutySupervisor', by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc.dutySupervisorName), toValue: S(set.dutySupervisorName), note: S(req.body.note), at: new Date() });
      }
      const update = { $set: { ...set, lastModifiedBy: req.user?._id } };
      if (entries.length) update.$push = { history: { $each: entries } };
      // eslint-disable-next-line no-await-in-loop
      await LightTransportEmployee.updateOne({ _id: doc._id }, update);
    }

    logAudit({ user: req.user, action: 'assign_lt_supervisors', entity: 'LightTransportEmployee',
      changes: { after: { count: rows.length, ...set } }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    // The inspection screen reads the inspection supervisor, so it is woken too.
    try { require('../websocket/socketManager').emitToAll('b2c:duty', {}); } catch (e) { /* */ }
    return res.json({ updated: rows.length });
  } catch (e) {
    console.error('lt assignSupervisors:', e);
    return res.status(500).json({ message: 'تعذّر الإسناد' });
  }
};

/** An employee is never erased: the record is disabled and its trail stays. See the HR rule. */
exports.deactivateEmployee = async (req, res) => {
  try {
    const doc = await LightTransportEmployee.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الموظّف غير موجود' });
    doc.isActive = false;
    doc.history.push({ kind: 'status', by: req.user?._id, byName: byName(req.user), toValue: 'خارج القسم', note: S(req.body.reason) });
    await doc.save();
    emit('lt:updated', {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التعطيل' });
  }
};

// Housing
exports.listHousing = async (req, res) => {
  try {
    const rows = await LightTransportHousing.find({}).sort({ name: 1 }).lean();
    // Occupancy is computed, not written: the number living there now, not a hand-updated figure.
    const counts = await LightTransportEmployee.aggregate([
      // A terminated person occupies no bed - see `endedRowIds`.
      { $match: { housing: { $ne: null }, isActive: { $ne: false }, _id: { $nin: await endedRowIds() } } },
      { $group: { _id: { h: '$housing', r: '$housingRoom' }, n: { $sum: 1 } } },
    ]);
    const perHousing = new Map(); const perRoom = new Map();
    for (const c of counts) {
      const h = String(c._id.h);
      perHousing.set(h, (perHousing.get(h) || 0) + c.n);
      perRoom.set(`${h}|${S(c._id.r)}`, c.n);
    }
    res.json({
      housing: rows.map((h) => {
        const cap = (h.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0) || Number(h.declaredCapacity) || 0;
        const occupied = perHousing.get(String(h._id)) || 0;
        return {
          ...h,
          totalCapacity: cap,
          occupied,
          free: Math.max(0, cap - occupied),
          rooms: (h.rooms || []).map((r) => {
            const o = perRoom.get(`${String(h._id)}|${S(r.name)}`) || 0;
            return { ...r, occupied: o, free: Math.max(0, (Number(r.capacity) || 0) - o) };
          }),
        };
      }),
    });
  } catch (e) {
    console.error('lt listHousing:', e);
    res.status(500).json({ message: 'تعذّر تحميل السكن' });
  }
};

exports.saveHousing = async (req, res) => {
  try {
    const body = req.body || {};
    if (!S(body.name)) return res.status(400).json({ message: 'اسمُ السكن مطلوب' });
    const fields = {
      name: S(body.name), cityAr: S(body.cityAr), addressAr: S(body.addressAr),
      declaredCapacity: Number(body.declaredCapacity) || 0, notes: S(body.notes),
      isActive: body.isActive !== false,
      rooms: Array.isArray(body.rooms) ? body.rooms.map((r) => ({
        name: S(r.name), kind: ['rep', 'admin', 'any'].includes(r.kind) ? r.kind : 'any',
        capacity: Number(r.capacity) || 0, notes: S(r.notes),
      })).filter((r) => r.name) : undefined,
    };
    if (fields.rooms === undefined) delete fields.rooms;

    let doc;
    if (req.params.id) {
      doc = await LightTransportHousing.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: 'السكنُ غير موجود' });
      // Capacity is not reduced below the residents.
      // Lowering a room with five people to three makes the register lie ('5 of 3'), so the request is rejected and residents are moved first.
      if (fields.rooms) {
        const occ = await LightTransportEmployee.aggregate([
          { $match: { housing: doc._id, isActive: { $ne: false }, _id: { $nin: await endedRowIds() } } },
          { $group: { _id: '$housingRoom', n: { $sum: 1 } } },
        ]);
        for (const o of occ) {
          const r = fields.rooms.find((x) => x.name === S(o._id));
          if (S(o._id) && r && r.capacity && o.n > r.capacity) {
            return res.status(400).json({ message: `غرفة «${r.name}» فيها ${o.n} ساكنًا — لا تُخفَّض سعتُها إلى ${r.capacity}` });
          }
        }
      }
      Object.assign(doc, fields);
    } else {
      doc = new LightTransportHousing({ ...fields, createdBy: req.user?._id });
    }
    await doc.save();
    emit('lt:updated', {});
    return res.json({ housing: doc.toObject() });
  } catch (e) {
    if (e?.code === 11000) return res.status(400).json({ message: 'اسمُ السكن مستعملٌ بالفعل' });
    console.error('lt saveHousing:', e);
    return res.status(500).json({ message: 'تعذّر حفظ السكن' });
  }
};

exports.deleteHousing = async (req, res) => {
  try {
    const live = await LightTransportEmployee.countDocuments({ housing: req.params.id, isActive: { $ne: false } });
    if (live) return res.status(400).json({ message: `يسكنه ${live} موظّفًا — انقلهم أوّلًا` });
    await LightTransportHousing.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    emit('lt:updated', {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حذف السكن' });
  }
};

module.exports.plateKeyOf = plateKeyOf;
module.exports.looksLikePlate = looksLikePlate;
module.exports.optionsOf = optionsOf;
module.exports.totalsOf = totalsOf;
module.exports.decorate = decorate;
module.exports.applyHousing = applyHousing;

// Light-transport vehicles - the department's project vehicles, from the vehicle register itself
/**
 * The individuals department runs projects (Keeta, HungerStation, Amazon, Ninja) on vehicles registered in the vehicles section. Authorization and the actual driver change in the field daily, so the department knows them, not the vehicles department.
 * This is a window on the same register (`VehicleMaster`), not a copy: what is edited here is written there and broadcast to the vehicles section at once, and what is edited there is read here. Editing from here is limited to operating columns (project, city, actual driver, authorization); plate, serial number and vehicle documents stay with the vehicles department.
 */
// Vehicle scope is the same as the dashboard's: `BOARD.vehicleScope` (its sector or projects, and whatever has a rider).
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ltVehicleRow = (v) => {
  const a = v.authorizedPerson || {}; const d = v.actualDriver || {};
  const start = ymd(a.startDate); const end = ymd(a.expiryDate);
  const today = require('../utils/companyDay').todayKey();
  return {
    _id: v._id, serialNumber: v.serialNumber || '', project: v.departmentAr || '', city: v.cityAr || '', plateNumber: v.plateNumber || '',
    driverId: d.idNumber || '', driverName: d.name || '',
    authorizedId: a.iqamaNumber || '', authorizedName: a.name || '', authorizedPhone: a.phone || '',
    authStart: start, authEnd: end, authNumber: a.authorizationNumber || '',
    // Duration is derived: start to end, in days.
    durationDays: start && end ? Math.round((new Date(end) - new Date(start)) / 86400000) : null,
    daysLeft: end ? Math.round((new Date(end) - new Date(today)) / 86400000) : null,
    sector: v.sectorAr || '', updatedAt: v.updatedAt,
    // What the department manages of vehicle data
    serviceStatus: v.serviceStatusAr || '', color: v.colorAr || '', notes: v.notesAr || '',
    registrationType: v.registrationTypeAr || '',
    operatingCardNumber: v.operatingCard?.cardNumber || '', operatingCardEnd: ymd(v.operatingCard?.expiryDate),
    insuranceEnd: ymd(v.insurance?.expiryDate), licenseEnd: ymd(v.vehicleLicense?.expiryDate),
    inspectionEnd: ymd(v.inspection?.expiryDate),
  };
};
const LT_VEHICLE_SELECT = 'serialNumber departmentAr cityAr plateNumber sectorAr actualDriver authorizedPerson updatedAt '
  + 'serviceStatusAr colorAr notesAr registrationTypeAr operatingCard.cardNumber operatingCard.expiryDate insurance.expiryDate '
  + 'vehicleLicense.expiryDate inspection.expiryDate';
/** Who may edit: sector manager, deputy, system admin (and finance roles, as for everything opened to them). */
const LT_VEHICLE_EDIT = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager', 'b2c_deputy', ...require('../config/financeAuthority').FINANCE_FULL_ROLES];
exports.LT_VEHICLE_EDIT = LT_VEHICLE_EDIT;
/** Who edits the vehicle register itself (routes/vehicleRegistry EDIT); only they change the plate from here. */
const REGISTRY_EDIT = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'];

// GET /people?q= - people dropdown for department vehicles: light-transport employees first, then HR. What it shows is what the edit accepts - utils/vehiclePerson.
exports.people = async (req, res) => {
  try {
    const all = await require('../utils/vehiclePerson').options({ scope: 'lt', q: req.query.q });
    // `only=lt` for the actual driver and the rental user: department employees only (the app picker does not filter).
    const people = req.query.only === 'lt' ? all.filter((p) => p.source === 'lt') : all;
    res.json({ people });
  } catch (e) {
    console.error('lt people:', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة الموظّفين' });
  }
};

// GET /vehicles
/**
 * All department vehicles, with dashboard filters.
 * The same set the dashboard counts (`vehicleRows` from `BOARD.vehicleScope`): light-transport sector or a management of its projects, plus whatever has a rider from the department register, authorized or not. It accepts the dashboard filters in the URL (project, rider, vehicle, authorization, register, sponsorship/freelancer, category, city, status) and `vstate` (withRider, idle, activeOrder), so a card number opens its vehicles exactly.
 */
exports.listVehicles = async (req, res) => {
  try {
    const q = req.query || {};
    const decorated = await boardRows({ isActive: { $ne: false } });
    const riderRows = decorated.filter((r) => r.vehicle && !isEnded(r));
    let vrows = await vehicleRows(riderRows, LT_VEHICLE_SELECT, await heldRows());
    const people = BOARD.personTests(q, { typeKey, contractKindOf });
    const vpass = BOARD.vehicleTests(q, people, { typeKey });
    vrows = vrows.filter((v) => vpass(v));
    const vstate = S(q.vstate);
    if (['withRider', 'hold', 'idle'].includes(vstate)) vrows = vrows.filter((v) => v.state === vstate);
    if (vstate === 'activeOrder') {
      const on = new Set((await LightTransportOrder.find({ status: 'active' }).select('vehicle').lean()).map((o) => String(o.vehicle || '')));
      vrows = vrows.filter((v) => on.has(v._id));
    }
    const vehicles = vrows
      .map((v) => {
        /**
         * The 'actual driver' column is the rider himself (utils/ltRider).
         * Taken from his row in the department register, not from text on the vehicle: an idle vehicle has no name on it. One awaiting hand-over is shown with its marker (and an archived one with no name). Text left on the vehicle with no matching row is shown as 'unlinked', not as a driver.
         */
        const rider = v.riders[0] || null;
        const holder = !rider ? (v.holders[0] || null) : null;
        const mirror = v.v.actualDriver || {};
        const base = ltVehicleRow(v.v);
        return {
          ...base,
          driverName: rider ? S(rider.name) : holder ? (holder.archived ? 'منتهي الخدمة' : S(holder.name)) : '',
          driverId: rider ? S(rider.idNumber) : holder && !holder.archived ? S(holder.idNumber) : '',
          driverLt: rider ? String(rider._id) : '',
          driverHold: !!holder,
          // Old text on the vehicle that matches no rider is fixed by reconciliation (scripts/reconcileLtRiders).
          driverUnlinked: !rider && !holder && S(mirror.name) ? S(mirror.name) : '',
          vstate: v.state,
          // Project as the dashboard counts it (the rider's project, else the management); the register field stays in `project`.
          boardProject: v.project,
          authState: v.auth,
          riderName: v.riders.map((r) => r.name).join('، '),
          riderId: S(rider?._id),
        };
      })
      .sort((a, b) => String(a.project).localeCompare(String(b.project), 'ar') || String(a.plateNumber).localeCompare(String(b.plateNumber), 'ar'));
    const count = (f) => vehicles.filter(f).length;
    const filtered = Object.keys(q).some((k) => BOARD.vals(q[k]).length);
    res.json({
      vehicles,
      summary: {
        total: vehicles.length,
        noAuthorization: count((v) => v.authState === 'none'),
        expired: count((v) => v.authState === 'expired'),
        expiringSoon: count((v) => v.daysLeft != null && v.daysLeft >= 0 && v.daysLeft <= 30),
        noDriver: count((v) => v.vstate === 'idle'),
        withRider: count((v) => v.vstate === 'withRider'),
        hold: count((v) => v.vstate === 'hold'),
        idle: count((v) => v.vstate === 'idle'),
      },
      filtered,
      canEdit: LT_VEHICLE_EDIT.includes(req.user?.role),
      canEditPlate: LT_VEHICLE_EDIT.includes(req.user?.role) && REGISTRY_EDIT.includes(req.user?.role),
    });
  } catch (e) {
    console.error('lt vehicles:', e);
    res.status(500).json({ message: 'تعذّر تحميل مركبات القسم' });
  }
};

// PUT /vehicles/:id - operating columns only.
exports.updateVehicle = async (req, res) => {
  try {
    if (!LT_VEHICLE_EDIT.includes(req.user?.role)) return res.status(403).json({ message: 'تعديلُ مركبات القسم لمدير القطاع ونائبه' });
    const { VehicleMaster } = require('../models/VehicleMaster');
    // Department vehicles as the dashboard counts them: its sector or projects, and whatever has a rider from its register.
    const ridden = await LightTransportEmployee.distinct('vehicle', { isActive: { $ne: false }, vehicle: { $ne: null } });
    const v = await VehicleMaster.findOne({ _id: req.params.id, ...BOARD.vehicleScope(ridden) });
    if (!v) return res.status(404).json({ message: 'المركبةُ ليست من مركبات القسم' });
    const b = req.body || {};
    const before = ltVehicleRow((await VehicleMaster.findById(v._id).select(LT_VEHICLE_SELECT).lean()) || {});
    const text = (x) => S(x).slice(0, 150);
    const dateOf = (x, label) => {
      if (x === '' || x === null) return null;
      const d = new Date(`${S(x).slice(0, 10)}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}/.test(S(x)) || Number.isNaN(d.getTime())) { const err = new Error(`${label} غير صحيح`); err.bad = true; throw err; }
      return d;
    };
    const $set = {};
    if (b.project !== undefined) $set.departmentAr = text(b.project);
    if (b.city !== undefined) $set.cityAr = text(b.city);
    // What the department manages of vehicle data
    // Written to the vehicle register itself and through its path (findByIdAndUpdate) so its hooks run: derivation, authorization mirror, and copying the plate to its copies.
    if (b.serviceStatus !== undefined) $set.serviceStatusAr = text(b.serviceStatus);
    if (b.color !== undefined) $set.colorAr = text(b.color);
    if (b.notes !== undefined) $set.notesAr = S(b.notes).slice(0, 1000);
    if (b.operatingCardNumber !== undefined) $set['operatingCard.cardNumber'] = text(b.operatingCardNumber).replace(/\s+/g, '');
    for (const [k, p, label] of [['operatingCardEnd', 'operatingCard.expiryDate', 'تاريخُ انتهاء بطاقة التشغيل'],
      ['insuranceEnd', 'insurance.expiryDate', 'تاريخُ انتهاء التأمين'], ['licenseEnd', 'vehicleLicense.expiryDate', 'تاريخُ انتهاء الاستمارة'],
      ['inspectionEnd', 'inspection.expiryDate', 'تاريخُ انتهاء الفحص الدوري']]) {
      if (b[k] !== undefined) {
        $set[p] = dateOf(b[k], label);
        // A written date clears the 'required / none' flag on the document; it now has a date.
        if ($set[p]) $set[p.replace('expiryDate', 'statusCode')] = '';
      }
    }
    // The plate is the vehicle's identity: only those who edit the vehicle register change it.
    if (b.plateNumber !== undefined && text(b.plateNumber) !== S(v.plateNumber)) {
      if (!REGISTRY_EDIT.includes(req.user?.role)) return res.status(403).json({ message: 'اللوحةُ تُعدَّل من قسم المركبات' });
      if (!text(b.plateNumber)) return res.status(400).json({ message: 'اللوحةُ لا تُترك فارغة' });
      $set.plateNumber = text(b.plateNumber);
    }
    if (b.authNumber !== undefined) $set['authorizedPerson.authorizationNumber'] = text(b.authNumber);
    if (b.authStart !== undefined) $set['authorizedPerson.startDate'] = dateOf(b.authStart, 'تاريخُ بداية التفويض');
    if (b.authEnd !== undefined) $set['authorizedPerson.expiryDate'] = dateOf(b.authEnd, 'تاريخُ نهاية التفويض');

    /**
     * Actual driver and authorized person are chosen from employees, not typed.
     * Actual driver = the vehicle's rider from the department register (utils/ltRider), changed by linking his row to it, not by writing a name on it. The authorized person is a paper written with `setHolder` (utils/vehicleAuthorization) so the assignment log follows. A name matching no employee is rejected with a clear message (utils/vehiclePerson).
     */
    const VP = require('../utils/vehiclePerson');
    const driverSent = ['driverLt', 'driverId', 'driverName'].some((k) => b[k] !== undefined);
    let rider;
    if (driverSent) {
      rider = await VP.resolvePerson({ ltId: b.driverLt, idNumber: b.driverId, name: b.driverName }, { needLt: true, label: 'القائد الفعلي' });
    }
    const authSent = ['authorizedEmployee', 'authorizedLt', 'authorizedId', 'authorizedName'].some((k) => b[k] !== undefined);
    let holder;
    if (authSent) {
      holder = await VP.resolvePerson({ employeeId: b.authorizedEmployee, ltId: b.authorizedLt, idNumber: b.authorizedId, name: b.authorizedName }, { label: 'المفوَّض' });
    }
    const holderChanged = authSent && (holder ? holder.idNumber !== S(v.authorizedPerson?.iqamaNumber) || holder.name !== S(v.authorizedPerson?.name) : !!(S(v.authorizedPerson?.name) || S(v.authorizedPerson?.iqamaNumber)));
    if (!Object.keys($set).length && !driverSent && !authSent) return res.status(400).json({ message: 'لا حقولَ للتعديل' });
    const s0 = $set['authorizedPerson.startDate'] !== undefined ? $set['authorizedPerson.startDate'] : v.authorizedPerson?.startDate;
    const e0 = $set['authorizedPerson.expiryDate'] !== undefined ? $set['authorizedPerson.expiryDate'] : v.authorizedPerson?.expiryDate;
    if (s0 && e0 && new Date(e0) < new Date(s0)) return res.status(400).json({ message: 'نهايةُ التفويض قبل بدايته' });
    // A written date clears the 'required / none' flag on the authorization; it now has a date.
    if ($set['authorizedPerson.expiryDate']) $set['authorizedPerson.statusCode'] = '';

    // An authorization paper for another person is written whole with `setHolder`, including its number and term.
    if (holderChanged) {
      const auth = {};
      for (const k of Object.keys($set)) if (k.startsWith('authorizedPerson.')) { auth[k.slice(17)] = $set[k]; delete $set[k]; }
      const VA = require('../utils/vehicleAuthorization');
      await VA.setHolder(v._id, holder ? {
        employee: holder.employee || null, name: holder.name, idNumber: holder.idNumber, phone: holder.phone,
        jobTitleAr: holder.jobTitleAr || undefined,
        authorizationNumber: auth.authorizationNumber !== undefined ? auth.authorizationNumber : S(v.authorizedPerson?.authorizationNumber),
        startDate: auth.startDate !== undefined ? auth.startDate : (v.authorizedPerson?.startDate || null),
        expiryDate: auth.expiryDate !== undefined ? auth.expiryDate : (v.authorizedPerson?.expiryDate || null),
      } : null, { userId: req.user?._id, byName: byName(req.user), note: holder ? 'فُوِّضت المركبة من مركبات النقل الخفيف' : undefined, reason: holder ? '' : 'من مركبات النقل الخفيف' });
    }
    if (Object.keys($set).length) {
      const { fillHijriPairs } = require('../utils/hijri');
      fillHijriPairs($set, v.toObject());
      await VehicleMaster.findByIdAndUpdate(v._id, { $set }, { new: true, runValidators: true });
    }
    if (driverSent) {
      await require('../utils/ltRider').setRider(v._id, rider ? rider.ltId : null, { user: req.user, announce: false });
    }
    const saved = await VehicleMaster.findById(v._id).select(LT_VEHICLE_SELECT).lean();
    const after = ltVehicleRow(saved);
    const changedKeys = Object.keys(after).filter((k) => !['updatedAt', 'daysLeft'].includes(k) && String(before[k] ?? '') !== String(after[k] ?? ''));
    logAudit({
      user: req.user, action: 'lt_vehicle_update', entity: 'VehicleMaster', entityId: v._id,
      changes: { details: `مركبة ${after.plateNumber} — من قسم الأفراد`, before: Object.fromEntries(changedKeys.map((k) => [k, before[k]])), after: Object.fromEntries(changedKeys.map((k) => [k, after[k]])) },
      ipAddress: req.ip,
    }).catch(() => {});
    // The vehicles section hears at once (its cache is cleared before the announcement), and so does this section.
    // The shared door (utils/vehicleAnnounce) also reaches fleet and heavy transport.
    require('../utils/vehicleAnnounce').announceVehicles({}, { extraCaches: ['hr:', 'dash:'], events: ['hr:employee'] });
    res.json({ vehicle: after });
  } catch (e) {
    if (e.bad) return res.status(400).json({ message: e.message });
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('lt vehicle update:', e);
    return require('../utils/mongooseError').sendMongooseError(res, e, 'تعذّر تعديل المركبة');
  }
};

// POST /vehicles/:id/revoke-authorization - the same revoke as the vehicles section (services/vehicleLifecycle), limited to the department's vehicles.
exports.revokeVehicleAuthorization = async (req, res) => {
  const L = require('../services/vehicleLifecycle');
  try {
    if (!LT_VEHICLE_EDIT.includes(req.user?.role)) return res.status(403).json({ message: 'إلغاءُ التفويض من مركبات القسم لمدير القطاع ونائبه' });
    const { VehicleMaster } = require('../models/VehicleMaster');
    const ridden = await LightTransportEmployee.distinct('vehicle', { isActive: { $ne: false }, vehicle: { $ne: null } });
    const v = await VehicleMaster.findOne({ _id: req.params.id, ...BOARD.vehicleScope(ridden) });
    if (!v) return res.status(404).json({ message: 'المركبةُ ليست من مركبات القسم' });
    const r = await L.revokeAuthorization(v, { user: req.user, reason: req.body?.reason, source: 'مركبات النقل الخفيف', ip: req.ip });
    res.json({ message: r.message, closedAssignments: r.closedAssignments, clearedOrders: r.clearedOrders });
  } catch (e) { L.reply(res, e, 'تعذّر إلغاء التفويض'); }
};
