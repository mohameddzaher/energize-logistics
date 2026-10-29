/**
 * customerHub — العميلُ واحدٌ في كلّ أقسام الشركة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * كان للعميل الواحد ثمانيةُ سجلّاتٍ لا يعرف أحدُها الآخر: بريدٌ يُصحَّح في التحصيل
 * يبقى قديمًا في طلبات الشحنات والأسطول والعلاقات والعقود. والمطلوب:
 *   · عملاءُ النقل (العمليّات، التحصيل، المنصّة، طلبات الشحنات، الأسطول، المبيعات)
 *     بياناتٌ واحدة؛ والتخليصُ له عملاؤه — وكلُّهم في «إدارة العلاقات» و«إدارة العقود».
 *   · ما يُعدَّل في عميلٍ من أيّ شاشةٍ يصل كلَّ سجلٍّ له في اللحظة.
 *
 * التصميم: **شركةُ العلاقات (CrmCompany) هي السجلُّ الأمّ** — فيها كلُّ العملاء.
 * وكلُّ سجلٍّ في قسمٍ آخر يحمل `crmCompany` رابطًا ثابتًا إليها (لا مطابقةَ أسماءٍ
 * في كلّ قراءة). و«بطاقةُ التواصل» (CARD) تعيش في الأمّ وتُنسَخ إلى كلّ مرتبط:
 *
 *   تعديلٌ في أيّ سجلّ ─▶ يُكتب في الأمّ ─▶ يُنسَخ إلى بقيّة المرتبطين ─▶ customers:changed
 *
 * والالتقاطُ في النموذج لا في الشاشات (attach): كلُّ حفظٍ (`save`) وكلُّ تعديلٍ
 * (`findOneAndUpdate`) على أيّ سجلٍّ يمرّ هنا — فشاشةٌ جديدةٌ تُضاف غدًا لا تُنسى.
 * والنسخُ نفسُه بـ`updateOne` (لا خطّافَ له) فلا يدور على نفسه.
 *
 * الاسمُ لا يُنسَخ هنا: له مسارُه (utils/renameOpsCustomer) لأنّه مفتاحُ كشوفٍ
 * وفواتيرَ مكتوبةٍ به. والبطاقةُ وحدَها تُنسَخ.
 */
const mongoose = require('mongoose');

/** حقولُ بطاقة التواصل — مشتركةٌ بين السجلّات كلِّها. */
// `code` is the customer's code (utils/customerCode): master `customerCode`, collections `code`.
const CARD = ['emails', 'phone', 'contactPerson', 'taxNumber', 'commercialRegister', 'address', 'city', 'code'];

const S = (v) => String(v == null ? '' : v).trim();
const { normalizeEmails } = require('../utils/partyEmails');
const foldName = (s) => require('../models/CollectionsParty').fold(String(s || ''));

/**
 * السجلّات — كيف تُقرأ بطاقتُها من صفٍّ وكيف تُكتب إليه.
 * `single`: سجلٌّ لا يحمل إلّا بريدًا واحدًا (يُكتب أوّلُ القائمة).
 */
const REG = {
  crm: {
    model: () => require('../models/CrmCompany'), base: {}, master: true,
    ar: 'إدارة العلاقات', href: (id) => `/system/crm/companies/${id}`,
    read: (d) => ({ emails: normalizeEmails([...(d.emails || []), d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    write: (c) => ({ emails: c.emails, email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, commercialRegister: c.commercialRegister, address: c.address, city: c.city, customerCode: c.code || '' }),
  },
  collections: {
    model: () => require('../models/CollectionsParty'), base: { kind: 'customer' },
    ar: 'التحصيل', href: (id) => `/system/collections-dept/parties/${id}`,
    read: (d) => ({ emails: normalizeEmails([...(d.emails || []), d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.code) }),
    write: (c) => ({ emails: c.emails, email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, commercialRegister: c.commercialRegister, address: c.address, city: c.city, code: c.code || '' }),
  },
  shipment: {
    model: () => require('../models/ShipmentOrderCustomer'), base: {}, single: true,
    ar: 'طلبات الشحنات والعمليات والمبيعات', href: (id) => `/system/shipment-orders/customers/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, address: c.address, city: c.city, customerCode: c.code || '' }),
  },
  fleet: {
    model: () => require('../models/FleetModels').FleetCustomer, base: {}, single: true,
    ar: 'إدارة الأسطول', href: (id) => `/system/fleet/customers/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), taxNumber: S(d.taxNumber), address: S(d.address), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, taxNumber: c.taxNumber, address: c.address, customerCode: c.code || '' }),
  },
  customs: {
    model: () => require('../models/CustomsParty'), base: { kind: 'customer' }, single: true,
    ar: 'التخليص الجمركي', href: (id) => `/system/customs/parties/${id}`,
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.commercialRegister), address: S(d.address), city: S(d.city), code: S(d.customerCode) }),
    // جهةُ الاتّصال الأولى مرآةُ الحقول المسطّحة في التخليص (mirrorContacts) — تُكتب معها
    // وإلّا أعادت أوّلُ حفظةٍ القديم.
    write: (c, d) => ({
      email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber,
      commercialRegister: c.commercialRegister, address: c.address, city: c.city, customerCode: c.code || '',
      ...(d && Array.isArray(d.contacts) && d.contacts.length
        ? { 'contacts.0.email': c.emails[0] || '', 'contacts.0.phone': c.phone, 'contacts.0.name': c.contactPerson || (d.contacts[0] && d.contacts[0].name) || '' }
        : {}),
    }),
  },
  contracts: {
    model: () => require('../models/ContractModels').ContractCustomer, base: {}, single: true,
    ar: 'إدارة العقود', href: () => '/system/contracts/customers',
    read: (d) => ({ emails: normalizeEmails([d.email || '']), phone: S(d.phone), contactPerson: S(d.contactPerson), taxNumber: S(d.taxNumber), commercialRegister: S(d.crNumber), address: S(d.headquarters), code: S(d.customerCode) }),
    write: (c) => ({ email: c.emails[0] || '', phone: c.phone, contactPerson: c.contactPerson, taxNumber: c.taxNumber, crNumber: c.commercialRegister, headquarters: c.address, customerCode: c.code || '' }),
  },
};
const REG_KEYS = Object.keys(REG);

/** ما تغيّر في البطاقة بين قراءتين. */
function cardDiff(a, b) {
  const out = [];
  for (const f of CARD) {
    const x = a[f]; const y = b[f];
    if (x === undefined && y === undefined) continue;
    if (JSON.stringify(x ?? (f === 'emails' ? [] : '')) !== JSON.stringify(y ?? (f === 'emails' ? [] : ''))) out.push(f);
  }
  return out;
}

/** البطاقةُ الجديدة للأمّ بعد تعديلٍ في سجلّ `reg`. */
function mergeCard(master, before, after, changed, reg) {
  const card = { ...master };
  for (const f of changed) {
    if (f !== 'emails') { card[f] = after[f] ?? ''; continue; }
    if (!REG[reg].single) { card.emails = after.emails || []; continue; }
    // سجلٌّ ببريدٍ واحد: يُستبدل ما كان فيه، وتبقى عناوينُ الأمّ الأخرى.
    const oldE = (before.emails || [])[0]; const newE = (after.emails || [])[0];
    card.emails = normalizeEmails([newE || '', ...(master.emails || []).filter((e) => e !== oldE && e !== newE)]);
  }
  return card;
}

const emitChanged = (payload) => { try { require('../websocket/socketManager').emitToAll('customers:changed', payload); } catch (_) { /* */ } };

/**
 * الأمُّ لهذا الصفّ: رابطُه إن وُجد، وإلّا شركةُ علاقاتٍ بالاسم نفسِه، وإلّا تُنشأ.
 * ويُكتب الرابطُ في الصفّ. (لا يُستدعى للأمّ نفسِها.)
 */
async function ensureMaster(reg, doc) {
  const R = REG[reg];
  if (doc.crmCompany) return doc.crmCompany;
  const Crm = REG.crm.model();
  const key = foldName(doc.name);
  // The code identifies the customer: a row carrying one joins the master with that code.
  const code = S(R.read(doc).code);
  let master = code ? await Crm.findOne({ customerCode: code }).select('_id').lean() : null;
  if (!key && !master) return null;
  if (!master) master = await Crm.findOne({ nameKey: key }).select('_id').lean();
  if (!master) {
    // سجلٌّ آخر بالاسم نفسِه مربوطٌ قبلًا؟ فأمُّه أمُّ هذا.
    for (const other of REG_KEYS.filter((k) => k !== 'crm' && k !== reg)) {
      const M = REG[other].model();
      const hit = await M.findOne({ ...REG[other].base, crmCompany: { $ne: null }, name: doc.name }).select('crmCompany').lean().catch(() => null);
      if (hit && hit.crmCompany) { master = { _id: hit.crmCompany }; break; }
    }
  }
  if (!master) {
    const card = R.read(doc);
    const created = await Crm.collection.insertOne({
      name: S(doc.name), nameKey: key, status: 'active', type: 'customer', source: `hub:${reg}`,
      ...REG.crm.write({ emails: card.emails || [], phone: card.phone || '', contactPerson: card.contactPerson || '', taxNumber: card.taxNumber || '', commercialRegister: card.commercialRegister || '', address: card.address || '', city: card.city || '' }),
      tags: [], rating: 0, score: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    master = { _id: created.insertedId };
  }
  await R.model().updateOne({ _id: doc._id }, { $set: { crmCompany: master._id } });
  return master._id;
}

/**
 * «إدارة العقود» فيها كلُّ العملاء: لكلّ أمٍّ صفُّ عقود — يُنشأ أوّلَ ما تُعرف الأمّ.
 * (مفتاحُ العقود يطوي «ال» فقد يلتقي اسمان؛ حينها يُربط القائمُ ولا يُكرَّر.)
 */
async function ensureContract(masterId) {
  try {
    const C = REG.contracts.model();
    if (await C.exists({ crmCompany: masterId })) return false;
    const m = await REG.crm.model().findById(masterId).lean();
    if (!m) return false;
    const key = require('../controllers/contractsController').nameKey(m.name);
    if (!key) return false;
    const hit = await C.findOne({ nameKey: key }).select('_id crmCompany').lean();
    // اسمٌ يطابق صفَّ عقودٍ لأمٍّ أخرى (شركتا علاقاتٍ بالاسم نفسِه) — صفٌّ واحدٌ يكفيهما.
    if (hit) { if (!hit.crmCompany) { await C.updateOne({ _id: hit._id }, { $set: { crmCompany: masterId } }); return true; } return false; }
    await C.collection.insertOne({
      name: S(m.name), nameKey: key, crmCompany: masterId, ...REG.contracts.write(REG.crm.read(m)),
      sector: '', customerType: '', energizeRep: '', customerSideContract: false, ourSideContract: false,
      documentsReceived: [], missingDocuments: [], attachments: [], createdByName: 'الربط الموحّد', createdAt: new Date(), updatedAt: new Date(),
    });
    return true;
  } catch (e) { if (e.code !== 11000) console.error('[customerHub] contract row:', e.message); return false; }
}

/** كلُّ صفٍّ مرتبطٍ بهذه الأمّ في كلّ سجلّ (عدا الأمّ نفسِها). */
async function linkedRows(masterId) {
  const out = [];
  for (const reg of REG_KEYS.filter((k) => k !== 'crm')) {
    const R = REG[reg];
    const rows = await R.model().find({ ...R.base, crmCompany: masterId }).lean().catch(() => []);
    for (const d of rows) out.push({ reg, doc: d });
  }
  return out;
}

/** يكتب بطاقةً في الأمّ ويوزّعها على المرتبطين — حقولًا بعينها، وما عدا `except`. */
async function fanOut(masterId, card, fieldsIn, except = null, origin = '') {
  let fields = fieldsIn;
  const Crm = REG.crm.model();
  const pick = (w) => {
    const out = {};
    for (const [k, v] of Object.entries(w)) {
      const base = k.startsWith('contacts.0.') ? (k.endsWith('email') ? 'emails' : k.endsWith('phone') ? 'phone' : 'contactPerson') : k;
      const f = base === 'email' ? 'emails' : base === 'crNumber' ? 'commercialRegister' : base === 'headquarters' ? 'address' : base === 'customerCode' ? 'code' : base;
      if (fields.includes(f)) out[k] = v;
    }
    return out;
  };
  const mset = pick(REG.crm.write(card));
  if (Object.keys(mset).length) {
    // A code already held by another customer is refused (unique): the rest of the card still goes through.
    try { await Crm.updateOne({ _id: masterId }, { $set: { ...mset, updatedAt: new Date() } }); }
    catch (e) {
      if (e.code !== 11000 || !('customerCode' in mset)) throw e;
      console.error('[customerHub] code taken:', mset.customerCode);
      delete mset.customerCode; fields = fields.filter((f) => f !== 'code');
      if (Object.keys(mset).length) await Crm.updateOne({ _id: masterId }, { $set: { ...mset, updatedAt: new Date() } });
    }
  }
  let n = 0;
  for (const { reg, doc } of await linkedRows(masterId)) {
    if (except && except.reg === reg && String(except.id) === String(doc._id)) continue;
    const set = pick(REG[reg].write(card, doc));
    if (!Object.keys(set).length) continue;
    try { await REG[reg].model().updateOne({ _id: doc._id }, { $set: set }); n += 1; }
    catch (e) { console.error(`[customerHub] fan-out ${reg} ${doc._id}:`, e.message); }
  }
  // المنصّةُ (UPL) تعرف بريدَ عميلها وهاتفَه — يُكتب فيها ما عُدِّل عندنا.
  if (origin !== 'platform' && (fields.includes('emails') || fields.includes('phone'))) pushToPlatform(masterId, card).catch(() => {});
  return n;
}

async function pushToPlatform(masterId, card) {
  const Crm = REG.crm.model();
  const m = await Crm.findById(masterId).select('externalSource externalId').lean();
  if (!m || m.externalSource !== 'ops_upl' || !m.externalId) return;
  const upl = require('./uplClient');
  if (!upl.isConfigured || !upl.isConfigured()) return;
  const body = { email: card.emails[0] || undefined, phone: card.phone || undefined };
  try {
    await upl.patch(`/admin/users/${encodeURIComponent(m.externalId)}`, { body });
    await Crm.updateOne({ _id: masterId }, { $set: { 'uplSeen.email': body.email || '', 'uplSeen.phone': body.phone || '' } });
  } catch (e) { console.error('[customerHub] platform push:', e.message); }
}

/**
 * التقاطُ تعديلٍ على صفٍّ في سجلّ `reg` — قبل وبعد.
 * @param origin 'platform' حين جاء من المنصّة (فلا يُردّ إليها)
 */
async function onChange(reg, before, after, origin = '') {
  try {
    if (!after || !REG[reg]) return;
    const R = REG[reg];
    if (R.base.kind && after.kind !== R.base.kind) return;
    const isNew = !before;
    // شركةُ علاقاتٍ جديدة: لا مرتبطين لها بعد — يكفي الإعلان (ولا تُردّ إلى المنصّة).
    if (isNew && R.master) { await ensureContract(after._id); emitChanged({ master: String(after._id), origin: reg, created: true }); return; }
    const masterId = R.master ? after._id : await ensureMaster(reg, after);
    if (!masterId) return;
    const Crm = REG.crm.model();
    const master = await Crm.findById(masterId).lean();
    if (!master) return;
    const mCard = REG.crm.read(master);
    const aCard = R.read(after);

    if (isNew && !R.master) {
      // صفٌّ جديد: يأخذ من الأمّ ما ينقصه، ويعطيها ما ينقصها.
      const fillDoc = {}; const fillMaster = {};
      for (const f of CARD) {
        if (aCard[f] === undefined) continue;
        const empty = (v) => (Array.isArray(v) ? !v.length : !S(v));
        if (empty(aCard[f]) && !empty(mCard[f])) fillDoc[f] = mCard[f];
        if (!empty(aCard[f]) && empty(mCard[f])) fillMaster[f] = aCard[f];
      }
      const card = { ...mCard, ...fillMaster };
      if (Object.keys(fillMaster).length) await fanOut(masterId, card, Object.keys(fillMaster), { reg, id: after._id }, origin);
      if (Object.keys(fillDoc).length) {
        const set = {}; const w = R.write({ ...card }, after);
        for (const [k, v] of Object.entries(w)) {
          const f = k === 'email' ? 'emails' : k === 'crNumber' ? 'commercialRegister' : k === 'headquarters' ? 'address' : k === 'customerCode' ? 'code' : k.startsWith('contacts.0.') ? null : k;
          if (f && fillDoc[f] !== undefined) set[k] = v;
        }
        if (Object.keys(set).length) await R.model().updateOne({ _id: after._id }, { $set: set });
      }
      await ensureContract(masterId);
      emitChanged({ master: String(masterId), origin: reg, created: true });
      return;
    }
    const changed = cardDiff(before ? R.read(before) : {}, aCard).filter((f) => aCard[f] !== undefined);
    if (!changed.length) return;
    const card = mergeCard(mCard, before ? R.read(before) : {}, aCard, changed, reg);
    await fanOut(masterId, card, changed, R.master ? null : { reg, id: after._id }, origin);
    emitChanged({ master: String(masterId), origin: reg, fields: changed });
  } catch (e) {
    console.error(`[customerHub] ${reg}:`, e.message);
  }
}

/**
 * يُركَّب على مخطّط كلّ سجلّ: `save` (إنشاءٌ أو حفظ) و`findOneAndUpdate` (تعديل).
 * يقرأ الصفَّ قبل التعديل حين يمسّ التعديلُ البطاقة، ويُطلق التوزيعَ بعد الردّ
 * (setImmediate) فلا يتأخّر حفظُ الشاشة.
 */
const WATCH = [...CARD, 'email', 'crNumber', 'headquarters', 'contacts', 'customerCode'];
function attach(schema, reg) {
  schema.pre('save', async function rememberBefore() {
    this.$locals.hubNew = this.isNew;
    if (this.isNew || !WATCH.some((f) => this.isModified(f))) return;
    try { this.$locals.hubBefore = await this.constructor.findById(this._id).lean(); } catch (_) { /* */ }
  });
  schema.post('save', function afterSave(doc) {
    const wasNew = doc.$locals && doc.$locals.hubNew;
    const before = doc.$locals && doc.$locals.hubBefore;
    if (!wasNew && !before) return;
    const after = doc.toObject();
    setImmediate(() => onChange(reg, wasNew ? null : before, after));
  });
  schema.pre('findOneAndUpdate', async function captureBefore() {
    try {
      const u = this.getUpdate() || {};
      const keys = [...Object.keys(u.$set || {}), ...Object.keys(u).filter((k) => !k.startsWith('$'))];
      if (!keys.some((k) => WATCH.includes(k.split('.')[0]))) return;
      this._hubBefore = await this.model.findOne(this.getQuery()).lean();
    } catch (_) { /* */ }
  });
  schema.post('findOneAndUpdate', function afterUpdate(doc) {
    if (!this._hubBefore) return;
    const before = this._hubBefore;
    const M = this.model;
    setImmediate(async () => {
      try { const after = await M.findById(doc ? doc._id : before._id).lean(); await onChange(reg, before, after); }
      catch (e) { console.error('[customerHub] update:', e.message); }
    });
  });
}

/** أين يوجد هذا العميل — لكلّ ملفّ عميلٍ رقائقُ «نفس العميل في: …». */
async function presence(reg, id) {
  if (!REG[reg] || !mongoose.isValidObjectId(id)) return null;
  const d = await REG[reg].model().findById(id).select('crmCompany name').lean();
  if (!d) return null;
  const masterId = reg === 'crm' ? d._id : d.crmCompany;
  if (!masterId) return { master: null, places: [] };
  const master = await REG.crm.model().findById(masterId).select('name').lean();
  const places = [{ reg: 'crm', ar: REG.crm.ar, id: String(masterId), href: REG.crm.href(masterId), name: master ? master.name : '' }];
  for (const { reg: r, doc } of await linkedRows(masterId)) {
    places.push({ reg: r, ar: REG[r].ar, id: String(doc._id), href: REG[r].href(doc._id), name: doc.name });
  }
  return { master: String(masterId), places };
}

/**
 * كنسٌ كلَّ ساعة: صفوفٌ تُنشأ بكتابةٍ مباشرة (مزامناتٌ بـ`updateOne`/`bulkWrite`)
 * لا تمرّ بخطّافات النموذج — فتُربط هنا كأنّها جديدة (onChange بلا «قبل»).
 */
async function sweepUnlinked(limit = 500) {
  let n = 0;
  for (const reg of REG_KEYS.filter((k) => k !== 'crm')) {
    const R = REG[reg];
    const rows = await R.model().find({ ...R.base, $or: [{ crmCompany: null }, { crmCompany: { $exists: false } }] }).limit(limit).lean().catch(() => []);
    for (const d of rows) { if (!S(d.name)) continue; await onChange(reg, null, d); n += 1; }
  }
  // وكلُّ شركة علاقاتٍ لها صفُّ عقود.
  const C = REG.contracts.model();
  const linked = new Set((await C.find({ crmCompany: { $ne: null } }).select('crmCompany').lean()).map((x) => String(x.crmCompany)));
  for (const m of await REG.crm.model().find({}).select('_id').lean()) {
    if (!linked.has(String(m._id)) && await ensureContract(m._id)) n += 1;
  }
  if (n) console.log(`[customerHub] sweep linked ${n}`);
  return n;
}
function startSweep() {
  const run = () => sweepUnlinked().catch((e) => console.error('[customerHub] sweep:', e.message));
  // نصفُ ساعةٍ بعد الإقلاع: الربطُ الأوّل يجريه السكربت (linkCustomerHub) بقاعدته الكاملة.
  setTimeout(run, 30 * 60 * 1000);
  setInterval(run, 60 * 60 * 1000).unref();
}

/**
 * Give a master customer its code and copy it to every linked record.
 * Refuses a code another customer already holds. Returns { ok, reason?, rows }.
 */
async function setMasterCode(masterId, rawCode) {
  const { normCode } = require('../utils/customerCode');
  const code = normCode(rawCode);
  const Crm = REG.crm.model();
  const master = await Crm.findById(masterId).lean();
  if (!master) return { ok: false, reason: 'master_missing' };
  if (code) {
    const other = await Crm.findOne({ customerCode: code, _id: { $ne: master._id } }).select('name').lean();
    if (other) return { ok: false, reason: 'code_taken', by: other.name };
  }
  const rows = await fanOut(master._id, { ...REG.crm.read(master), code }, ['code']);
  emitChanged({ master: String(master._id), origin: 'code', fields: ['code'] });
  return { ok: true, rows };
}

module.exports = { setMasterCode, sweepUnlinked, startSweep, CARD, REG, REG_KEYS, attach, onChange, ensureMaster, ensureContract, fanOut, presence, linkedRows, foldName, cardDiff };
