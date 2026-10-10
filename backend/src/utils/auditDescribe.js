/**
 * auditDescribe — يقرأ `changes` في قيد المراجعة ويقول ما جرى.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * عمودُ التفاصيل كان يسرد أوّلَ أربعةِ مفاتيحَ في القيد كما هي:
 *
 *     netInvoice: 0 · tax: 0 · totalInvoice: 0 · collectedAmount: 0 · +45
 *
 * وهذه ليست ما تغيّر — هي أوّلُ أربعةِ حقولٍ في **لقطة الكشف كاملةً قبل
 * التعديل**. تعديلُ الكشف يُقيَّد هكذا: `before` الكشفُ كلُّه (ستّةٌ وخمسون
 * حقلًا)، و`after` ما أُرسل وحدَه (حقلان إلى عشرة). فمن وحّد المفاتيح وقارن
 * عدّ كلَّ حقلٍ في اللقطة «تغييرًا» لأنّه غائبٌ عن `after`.
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * ما تغيّر هو ما في `after` وخالف `before`. وما في `before` وحدَه سياقٌ: يُعرَف
 * منه السجلُّ (رقمُ الكشف، الاسم) ولا يُعدّ تغييرًا.
 *
 * ── والأشكالُ الواقعة فعلًا في القاعدة ───────────────────────────────────────
 *   { before:{…}, after:{…} }   تعديل            ← من كذا إلى كذا
 *   { after:{…} }               إنشاءٌ، أو تعديلٌ لم تُسجَّل قيمتُه السابقة
 *   { before:{…} }              حذف
 *   { after:[ 'حقل', … ] }      تعديلٌ سُجّلت أسماءُ حقوله بلا قيم
 *   { before:قيمة, after:قيمة, … }  قيمةٌ واحدةٌ تغيّرت ومعها بيان
 *   { waybillNumber, customerName }  بيانٌ مسطَّح
 *   null                        لا تفاصيل (دخول، خروج)
 */

const { getField: hrField } = require('../config/hrFields');
const { getDoc: vehicleDoc } = require('../config/vehicleDocuments');
const { LABELS_AR: ROLE_AR, LABELS_EN: ROLE_EN } = require('../config/roles');
const { sectionLabel: systemSectionLabel, SECTION_KEYS: SYSTEM_SECTION_KEYS } = require('../config/sections');
const { dayKeyOf } = require('./companyDay');
const {
  WORKFLOW_FIELDS, FIELD_LABELS, FIELD_VALUES_AR, VALUE_AR, humanise,
} = require('../config/auditLabels');

// ── ما لا يُقرأ ──────────────────────────────────────────────────────────────
// معرّفاتٌ داخليّة وأختامُ وقتٍ ومشتقّاتٌ يكتبها النظامُ مع كلِّ حفظ: ليست فعلَ
// المستخدم، وذكرُها يدفن فعلَه تحتها.
const NOISE = new Set([
  '_id', 'id', '__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'lastModifiedBy',
  'lockedBy', 'lockedByName', 'lockedAt', 'lastSyncedAt', 'externalId', 'externalSource',
  'externalUpdatedAt', 'password', 'history', 'paymentDateAt', 'paymentDateBy', 'paymentDateByName',
  'paymentTypeSource', 'sellingValueSource', 'statusSource', 'refId', 'workStatusShown',
  'vehicleTypeShown', 'dataOwnerShown', 'bulk',
]);

/** أعدادُ ما مسّه فعلٌ جماعيّ — وجودُ أحدها يجعل القيدَ «إجراءً جماعيًّا». */
const COUNT_KEYS = ['count', 'changed', 'updated', 'reps', 'vehicles', 'exported', 'reportsChanged', 'lines', 'ordersDeleted'];

/** ما يُعرَف به السجلُّ، بالترتيب — وبادئتُه حين لا يكفي الرقمُ وحدَه. */
const SUBJECT_KEYS = [
  ['reportNumber', 'كشف', 'Report'], ['refNumber', 'معاملة', 'Ref'], ['waybillNumber', 'بوليصة', 'Waybill'],
  ['order', 'أمر', 'Order'], ['claimId', 'حادث', 'Claim'], ['plateNumber', 'لوحة', 'Plate'],
  ['plate', 'لوحة', 'Plate'], ['arabicName', '', ''], ['name', '', ''], ['englishName', '', ''],
  ['rep', '', ''], ['employee', '', ''], ['driver', '', ''], ['email', '', ''], ['policy', 'وثيقة', 'Policy'],
  ['item', '', ''], ['nameAr', '', ''], ['nameEn', '', ''], ['title', '', ''],
];

const MONEY = /amount|value|balance|invoice$|^tax$|price|cost|salary|limit|sar$|expected|actual|difference|premium|cash$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  && !(v._bsontype);

/** الفراغُ بكلِّ صوره واحد: `null` و`''` و`[]` و`{}` لا فرقَ بينها عند القارئ. */
const isEmpty = (v) => v === undefined || v === null
  || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0)
  || (isPlain(v) && Object.keys(v).length === 0);

/** صورةٌ واحدةٌ للقيمة تُقارَن بها — فلا يُعدّ `"3200"` و`3200` تغييرًا. */
const canon = (v) => {
  if (isEmpty(v)) return '';
  if (v instanceof Date) return dayOrInstant(v.toISOString());
  if (v && v._bsontype) return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    const s = v.trim();
    if (ISO_DATE.test(s)) return dayOrInstant(s);
    if (s !== '' && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
    return s;
  }
  return JSON.stringify(v);
};

// «2026-10-07» و«2026-10-07T00:00:00.000Z» يومٌ واحدٌ كُتب بصيغتين: الواجهةُ
// ترسل اليومَ والقاعدةُ تحفظه لحظة. فمنتصفُ الليل يُقارَن يومًا لا لحظة.
function dayOrInstant(s) {
  if (s.length <= 10) return s;
  if (/T00:00:00(\.0+)?(Z|\+00:?00)$/.test(s)) return s.slice(0, 10);
  return s;
}

/** هل تغيّر شيءٌ يراه القارئ؟ صفرٌ مقابلَ فراغٍ، و`false` مقابلَ فراغ: لا. */
const same = (a, b) => {
  const x = canon(a); const y = canon(b);
  if (x === y) return true;
  const blank = (c) => c === '' || c === '0' || c === 'false';
  return blank(x) && blank(y);
};

function fieldLabel(key, entity, lang) {
  const i = lang === 'en' ? 1 : 0;
  if (entity === 'OperationsWorkflow' || entity === 'PrivateSellingPrice') {
    if (WORKFLOW_FIELDS[key]) return WORKFLOW_FIELDS[key][i];
  }
  if (entity === 'Employee') {
    const f = hrField(key);
    if (f) return lang === 'en' ? f.en : f.ar;
  }
  if (entity === 'VehicleMaster' || entity === 'VehicleRegistryConfig') {
    const d = vehicleDoc(key);
    if (d) return lang === 'en' ? d.en : d.ar;
  }
  // صلاحيّاتُ الدور مفاتيحُها أسماءُ الأقسام نفسُها.
  if (SYSTEM_SECTION_KEYS.includes(key)) return systemSectionLabel(key, lang);
  if (FIELD_LABELS[key]) return FIELD_LABELS[key][i];
  // حقلٌ عامٌّ لم يُكتب هنا قد يكون معرَّفًا في ملفّ الموظّف أو الكشف.
  const f = hrField(key);
  if (f) return lang === 'en' ? f.en : f.ar;
  if (WORKFLOW_FIELDS[key]) return WORKFLOW_FIELDS[key][i];
  return humanise(key);
}

const fmtNumber = (n, key) => {
  if (!Number.isFinite(n)) return String(n);
  if (MONEY.test(key)) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(n);
};

/**
 * القيمةُ كما تُقرأ. تعيد `null` للفراغ، و`undefined` لمرجعٍ داخليٍّ لم يُعرَف
 * صاحبُه — يُقال عنه «تغيّر» ولا يُعرَض رقمُه.
 */
function fmtValue(v, key, ctx) {
  const { lang, refs } = ctx;
  const ar = lang !== 'en';
  if (isEmpty(v)) return null;
  if (v instanceof Date) return fmtDate(v.toISOString());
  if (v && v._bsontype) v = String(v);
  if (typeof v === 'boolean') return ar ? (v ? 'نعم' : 'لا') : (v ? 'yes' : 'no');
  if (typeof v === 'number') return fmtNumber(v, key);
  if (typeof v === 'string') {
    const s = v.trim();
    if (OBJECT_ID.test(s)) return (refs && refs[s]) || undefined;
    if (ISO_DATE.test(s)) return fmtDate(s);
    if (key === 'role') return (ar ? ROLE_AR[s] : ROLE_EN[s]) || s;
    if (ar) {
      if (FIELD_VALUES_AR[key] && FIELD_VALUES_AR[key][s]) return FIELD_VALUES_AR[key][s];
      if (VALUE_AR[s]) return VALUE_AR[s];
    }
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => !isPlain(x) && !Array.isArray(x))) {
      const shown = v.slice(0, 6).map((x) => fmtValue(x, key, ctx)).filter((x) => x);
      const more = v.length - 6;
      return shown.join(ar ? '، ' : ', ') + (more > 0 ? (ar ? ` و${more} أخرى` : ` +${more}`) : '');
    }
    return ar ? `${v.length} عنصرًا` : `${v.length} items`;
  }
  if (isPlain(v)) return fmtObject(v, ctx);
  return String(v);
}

/** كائنٌ داخل حقل: مستوياتُ صلاحيّة، أو أعلامُ صفحات، أو إعداداتٌ صغيرة. */
function fmtObject(o, ctx) {
  const ar = ctx.lang !== 'en';
  const entries = Object.entries(o).filter(([k]) => !NOISE.has(k));
  const vals = entries.map(([, x]) => x);
  // مصفوفةُ الصلاحيّات: يُذكَر ما أُتيح، و«بلا صلاحية» هي الأصلُ فلا تُسرَد.
  if (vals.length && vals.every((x) => ['none', 'view', 'edit'].includes(x))) {
    const open = entries.filter(([, x]) => x !== 'none');
    if (!open.length) return ar ? 'لا صلاحية على أيّ قسم' : 'no access to any section';
    return open.map(([k, x]) => `${fieldLabel(k, '', ctx.lang)} (${fmtValue(x, 'access', ctx)})`).join(ar ? '، ' : ', ');
  }
  if (vals.length && vals.every((x) => typeof x === 'boolean')) {
    const on = entries.filter(([, x]) => x).map(([k]) => k);
    if (!on.length) return ar ? 'لا شيء' : 'none';
    if (on.length > 4) return ar ? `${on.length} عنصرًا مفعَّلًا` : `${on.length} enabled`;
    return on.map((k) => fieldLabel(k, '', ctx.lang)).join(ar ? '، ' : ', ');
  }
  const parts = entries
    .map(([k, x]) => [fieldLabel(k, '', ctx.lang), isPlain(x) ? fmtObject(x, ctx) : fmtValue(x, k, ctx), isPlain(x)])
    .filter(([, x]) => x)
    .map(([k, x, nested]) => (nested ? `${k} (${x})` : `${k}: ${x}`));
  const out = parts.join(ar ? '، ' : ', ');
  return out.length > 400 ? `${out.slice(0, 400)}…` : (out || null);
}

/** اليومُ بتوقيت الشركة؛ ومعه الساعةُ حين تكون اللحظةُ هي المقصودة. */
function fmtDate(s) {
  if (s.length <= 10) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  if (/T00:00:00(\.0+)?(Z|\+00:?00)$/.test(s)) return s.slice(0, 10);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.COMPANY_TZ || 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${dayKeyOf(d)} ${time}`;
}

const q = (v, lang) => (lang === 'en' ? `"${v}"` : `«${v}»`);

/** سطرٌ واحدٌ يُقرأ: «صافي الفاتورة: من «0» إلى «3,200»». */
function rowText(r, lang) {
  const ar = lang !== 'en';
  const changedOnly = ar ? 'تغيّر' : 'changed';
  if (r.kind === 'field') return r.label;
  if (r.kind === 'changed') {
    if (r.before === undefined || r.after === undefined) {
      if (r.before && r.after === undefined) return `${r.label}: ${changedOnly}`;
      if (r.after && r.before === undefined) return `${r.label}: ${q(r.after, lang)}`;
      return `${r.label}: ${changedOnly}`;
    }
    if (r.before === null) return ar ? `${r.label}: ${q(r.after, lang)} (كان فارغًا)` : `${r.label}: ${q(r.after, lang)} (was empty)`;
    if (r.after === null) return ar ? `${r.label}: أُفرغ (كان ${q(r.before, lang)})` : `${r.label}: cleared (was ${q(r.before, lang)})`;
    return ar
      ? `${r.label}: من ${q(r.before, lang)} إلى ${q(r.after, lang)}`
      : `${r.label}: ${q(r.before, lang)} → ${q(r.after, lang)}`;
  }
  if (r.kind === 'cleared') return ar ? `${r.label}: أُفرغ` : `${r.label}: cleared`;
  const v = r.after !== undefined && r.after !== null ? r.after : r.before;
  if (v === undefined || v === null) return r.label;
  return `${r.label}: ${v}`;
}

function subjectOf(changes, log, ctx) {
  const ar = ctx.lang !== 'en';
  // الاسمُ المقروء من جدول السجلّ أوّلًا: «العنوان: آيبان» في قيد مستندٍ عنوانُ
  // المستند لا اسمُ الموظّف صاحبِه.
  if (ctx.subjectHint) return { key: '', text: ctx.subjectHint };
  const pools = [];
  if (isPlain(changes)) {
    if (isPlain(changes.before)) pools.push(changes.before);
    if (isPlain(changes.after)) pools.push(changes.after);
    pools.push(changes);
  }
  for (const [k, pAr, pEn] of SUBJECT_KEYS) {
    for (const p of pools) {
      const v = p[k];
      if (isEmpty(v) || typeof v === 'object') continue;
      const s = String(v);
      if (OBJECT_ID.test(s)) continue;
      const prefix = ar ? pAr : pEn;
      return { key: k, text: prefix ? `${prefix} ${s}` : s };
    }
  }
  if (log.entityKey) {
    // المفتاحُ النصّيّ يُقرأ بما هو: رقمُ فاتورةٍ في قيود التحصيل، واسمُ دورٍ في
    // قيود الصلاحيّات.
    const k = String(log.entityKey);
    if (/^record_(collection|delivery)$/.test(log.action || '')) return { key: '', text: ar ? `فاتورة ${k}` : `Invoice ${k}` };
    if (log.entity === 'RolePermission' || log.entity === 'CustomRole') return { key: '', text: (ar ? ROLE_AR[k] : ROLE_EN[k]) || k };
    return { key: '', text: k };
  }
  return { key: '', text: '' };
}

/**
 * يصف قيدًا واحدًا.
 *
 * @param {object} log   القيد (action, entity, entityKey, changes)
 * @param {object} ctx   { lang, refs: {id→اسم}, subjectHint }
 * @returns {{ kind, subject, summary, rows, unchanged, bulkCount }}
 *   kind:      none | update | create | set | delete | fields | bulk | info
 *   rows:      ما يُعرَض — كلُّ صفٍّ { key, label, before, after, kind, text }
 *   unchanged: بقيّةُ اللقطة التي لم تتغيّر (للعرض الموسَّع فقط)
 */
function describe(log, ctx = {}) {
  const lang = ctx.lang === 'en' ? 'en' : 'ar';
  const c = { lang, refs: ctx.refs || {}, subjectHint: ctx.subjectHint || '' };
  const ar = lang === 'ar';
  const entity = log.entity || '';
  const action = String(log.action || '');
  const ch = log.changes;
  const out = { kind: 'none', subject: '', summary: '', rows: [], unchanged: [], bulkCount: null };
  const subj = subjectOf(ch, log, c);
  out.subject = subj.text;
  if (!isPlain(ch) || !Object.keys(ch).length) return out;

  const L = (k) => fieldLabel(k, entity, lang);
  const F = (v, k) => fmtValue(v, k, c);
  const visible = (k) => !NOISE.has(k);
  const hasB = 'before' in ch; const hasA = 'after' in ch;
  const extras = Object.keys(ch).filter((k) => k !== 'before' && k !== 'after' && visible(k));
  const rows = [];
  const info = (obj, keys) => {
    for (const k of keys) {
      const v = F(obj[k], k);
      if (v === null || v === undefined) continue;
      rows.push({ key: k, label: L(k), before: undefined, after: v, kind: 'value' });
    }
  };

  if (hasB && hasA && isPlain(ch.before) && isPlain(ch.after)) {
    // ── تعديل: ما في `after` وخالف `before` ───────────────────────────────
    out.kind = 'update';
    const { before, after } = ch;
    for (const k of Object.keys(after).filter(visible)) {
      const known = Object.prototype.hasOwnProperty.call(before, k);
      if (same(before[k], after[k])) continue;
      const b = F(before[k], k); const a = F(after[k], k);
      if (known) {
        if (b === a && b !== undefined) continue;
        rows.push({ key: k, label: L(k), before: b, after: a, kind: 'changed' });
      } else if (a !== null) {
        // غائبٌ عن اللقطة السابقة: إمّا كان فارغًا وإمّا لم تُلتقَط قيمتُه —
        // فتُذكَر القيمةُ الجديدة ولا يُدَّعى سابقٌ لم يُسجَّل.
        rows.push({ key: k, label: L(k), before: undefined, after: a === undefined ? undefined : a, kind: a === undefined ? 'changed' : 'value' });
      }
    }
    for (const k of Object.keys(before).filter(visible)) {
      if (rows.some((r) => r.key === k)) continue;
      const b = F(before[k], k);
      if (b === null || b === undefined) continue;
      out.unchanged.push({ key: k, label: L(k), value: b });
    }
    info(ch, extras);
  } else if (hasA && Array.isArray(ch.after)) {
    // ── أسماءُ حقولٍ بلا قيم ───────────────────────────────────────────────
    out.kind = 'fields';
    for (const k of ch.after.filter((x) => typeof x === 'string').filter(visible)) {
      rows.push({ key: k, label: L(k), before: undefined, after: undefined, kind: 'field' });
    }
  } else if (hasB && hasA) {
    // ── قيمةٌ واحدةٌ تغيّرت، ومعها بيانُها (تجديد وثيقة، رصيدٌ افتتاحيّ) ──
    out.kind = 'update';
    info(ch, extras);
    const vk = /balance|opening/i.test(action) ? 'openingBalance' : (/renew|expiry/i.test(action) ? 'expiry' : 'value');
    const label = vk === 'value' ? (ar ? 'القيمة' : 'Value') : L(vk);
    if (!same(ch.before, ch.after)) {
      rows.unshift({ key: vk, label, before: F(ch.before, vk), after: F(ch.after, vk), kind: 'changed' });
    } else {
      const v = F(ch.after, vk);
      if (v) out.unchanged.push({ key: vk, label, value: v });
    }
  } else if (hasA && isPlain(ch.after)) {
    // ── `after` وحدَه: إنشاءٌ، أو تعديلٌ لم تُسجَّل قيمتُه السابقة ─────────
    // الفعلُ يقول أيَّهما: «create_…» إنشاء، «update_…» تعديل، وما عداهما
    // (إقفال يوم، إلغاء تفويض) بيانٌ يكفيه اسمُ الفعل عنوانًا.
    const creating = /^(create|add|log_|wallet_transaction|bulk_import)/.test(action);
    const editing = /^(update|edit|set_|correct)/.test(action);
    out.kind = creating ? 'create' : (editing ? 'set' : 'info');
    for (const k of Object.keys(ch.after).filter(visible)) {
      const v = F(ch.after[k], k);
      if (v === null) {
        // في التعديل، القيمةُ الفارغةُ خبرٌ: الحقلُ أُفرغ. وفي الإنشاء لا خبرَ فيها.
        if (editing) rows.push({ key: k, label: L(k), before: undefined, after: null, kind: 'cleared' });
        continue;
      }
      rows.push({ key: k, label: L(k), before: undefined, after: v, kind: v === undefined ? 'changed' : 'value' });
    }
    info(ch, extras);
  } else if (hasB && isPlain(ch.before)) {
    // ── `before` وحدَه: حذف ────────────────────────────────────────────────
    out.kind = 'delete';
    for (const k of Object.keys(ch.before).filter(visible)) {
      const v = F(ch.before[k], k);
      if (v === null || v === undefined) continue;
      rows.push({ key: k, label: L(k), before: v, after: undefined, kind: 'value' });
    }
    info(ch, extras);
  } else {
    // ── بيانٌ مسطَّح ───────────────────────────────────────────────────────
    out.kind = 'info';
    info(ch, Object.keys(ch).filter((k) => visible(k) && k !== 'before' && k !== 'after'));
  }

  // ── الإجراءُ الجماعيّ: كم سجلًّا مسّ ───────────────────────────────────────
  const pool = { ...(isPlain(ch.before) ? ch.before : {}), ...(isPlain(ch.after) ? ch.after : {}), ...ch };
  const countKey = COUNT_KEYS.find((k) => typeof pool[k] === 'number');
  if (countKey && (pool[countKey] > 1 || ch.bulk === true || /bulk|apply_|cleanup|export|assign_.*supervisor/.test(action))) {
    out.bulkCount = pool[countKey];
    if (out.kind !== 'update') out.kind = 'bulk';
  }

  for (const r of rows) r.text = rowText(r, lang);
  out.rows = rows;

  // ── الجملةُ القصيرة ────────────────────────────────────────────────────────
  // ما يُعرَف به السجلُّ يظهر في عمود الكيان، فلا يُكرَّر هنا متى وُجد غيرُه.
  const told = rows.filter((r) => !(r.key === subj.key && r.kind === 'value'));
  const list = told.length ? told : rows;
  const SHOW = 3;
  const sep = ' · ';
  const body = list.slice(0, SHOW).map((r) => r.text).join(sep);
  const rest = list.length - SHOW;
  const more = rest > 0 ? (ar ? `${sep}و${rest} أخرى` : `${sep}+${rest} more`) : '';
  const lead = {
    update: '',
    create: ar ? 'أُنشئ — ' : 'Created — ',
    set: ar ? 'القيمة الجديدة — ' : 'New value — ',
    delete: ar ? 'حُذف — ' : 'Deleted — ',
    fields: ar ? `عُدِّلت حقولٌ عددُها ${rows.length} (لم تُسجَّل قيمُها) — ` : `${rows.length} fields edited (values not recorded) — `,
    bulk: ar ? `إجراء جماعي (${out.bulkCount}) — ` : `Bulk action (${out.bulkCount}) — `,
    info: '',
  }[out.kind] || '';

  if (!rows.length) {
    out.summary = out.kind === 'update'
      ? (ar ? 'حُفظ بلا تغييرٍ في أيّ قيمة' : 'Saved with no value changed')
      : '';
  } else {
    out.summary = `${lead}${body}${more}`;
  }
  return out;
}

module.exports = { describe, fieldLabel, isEmpty, same, NOISE };
