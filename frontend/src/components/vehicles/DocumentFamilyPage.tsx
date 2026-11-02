'use client';
// One document-family page: operating cards, authorizations, driving licences, etc.
// The data was always in the database (operating-card numbers on 220 vehicles, authorizations on 221); what was missing was a column that shows it, since the general vehicles list shows plate, sector and owner only, so filtering by operating card returned the right rows without any card number. A page per family rather than extra columns, because the six document families together exceed forty columns and such a table is unreadable; this also follows the grouping in the source sheet.
// Each of the seven pages only describes its columns. Copying the skeleton would let the copies diverge (title order fixed in one, renew button added to one).
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { stateMeta, docNeed } from '@/lib/vehicleRegistry';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import { RenewModal, BulkRenewModal, SharedPolicyRenewModal, type RenewTarget } from '@/components/vehicles/RenewModals';
import { ColumnFilter } from '@/components/ColumnFilter';
import { ReqToggle } from '@/components/vehicles/ReqToggle';
import { LEAD, LEAD_2, useLeadOffset } from '@/components/vehicles/stickyLead';
import { ArrowRight, RefreshCw, Plus, Pencil, Eraser, Trash2, X, Save, Search } from 'lucide-react';

/** A stable empty set, so a new one is not built every render and the panel reset. */
const EMPTY_SET: Set<string> = new Set();

import { VReg, DOC_TYPES, daysText, STATE_META, publicState, canEditVehicles, canAdminVehicles, isSharedPaper } from '@/lib/vehicleRegistry';
import { flexIncludes } from '@/lib/flexMatch';
import ManagedSelect from '@/components/system/ManagedSelect';
import IqamaPersonInfo from '@/components/vehicles/IqamaPersonInfo';
import PersonLookup, { type FoundPerson } from '@/components/vehicles/PersonLookup';
import HijriGregorianField from '@/components/vehicles/HijriGregorianField';
import PersonSelect from '@/components/system/PersonSelect';
import ScrollX from '@/components/system/ScrollX';

/** One column: how it is read from the vehicle, named, and rendered. */
export type DocColumn = {
  key: string;
  ar: string; en: string;
  /** Raw value; the column and the export are both built from it so the file matches the screen. */
  get: (v: VReg) => string | number | null | undefined;
  /** Document numbers read left to right whatever the page language. */
  mono?: boolean;
  width?: number;
};

/**
 * One editable field of this family.
 * Deliberately separate from `DocColumn`: a column displays and may be computed (an "open, no cap" text built from two fields), while a field is written and saved so it needs a real path on the vehicle. Merging them would give either columns that cannot be edited or fields written nowhere.
 */
export type DocField = {
  /** Path in the vehicle document, e.g. `operatingCard.cardNumber`. */
  path: string;
  ar: string; en: string;
  kind?: 'text' | 'date' | 'number' | 'flag';
  /** A checkbox that writes text: "open" in `fuelCard.limitStatus` is not a true/false. */
  on?: string; off?: string;
  mono?: boolean;
  /** Takes the full grid width, for long names. */
  wide?: boolean;
  hint?: string;
  /** Lookup list type that fills the field instead of free typing; managed from section settings, dropdown lists. Free text comes in many spellings (three job titles for one driver role make three filter options). The Arabic name is stored, not the key, since stored text has been Arabic since the first import and filters and exports read it. */
  lookup?: string;
  /** Iqama number: the owner's birth date and mobile are shown under it (IqamaPersonInfo). */
  personInfo?: boolean;
  /**
   * Person field: picked from employees, not typed.
   * A searchable dropdown (PersonSelect) fills the name and also the ID, mobile and job-title paths; the server rejects a name that does not match an employee (backend utils/vehiclePerson).
   */
  person?: { idPath: string; phonePath?: string; jobPath?: string };
  /** Read-only; filled from the person field. */
  readOnly?: boolean;
};

/** Reads a dotted path. `?.` is not enough because the path is a string known only at runtime. */
const readPath = (o: any, path: string) =>
  path.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);

/** Builds a nested object from a dotted path; nested rather than dotted, see below. */
const writePath = (o: any, path: string, val: any) => {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[ks[ks.length - 1]] = val;
  return o;
};

/**
 * What is sent to the server is always nested, never `{'operatingCard.cardNumber': ...}`.
 * `express-mongo-sanitize` on the server drops every key containing a dot before it reaches the controller, so a dotted path is sent and silently vanishes: "saved" appears and nothing changes. The controller flattens the nested object to paths so it merges rather than replaces.
 */
const buildPatch = (fields: DocField[], vals: Record<string, any>) => {
  const out: any = {};
  for (const f of fields) {
    const raw = vals[f.path];
    let v: any;
    if (f.kind === 'number') v = raw === '' || raw == null ? null : Number(raw);
    else if (f.kind === 'date') v = raw ? raw : null;
    else if (f.kind === 'flag') v = raw ? (f.on ?? 'open') : (f.off ?? '');
    else v = raw ?? '';
    writePath(out, f.path, v);
  }
  return out;
};

/** First segment of each path: the object the family lives in (`gps`, `insurance`, ...). */
const rootsOf = (fields: DocField[]) =>
  [...new Set(fields.map((f) => f.path.split('.')[0]).filter((r) => r))];

/** Does this vehicle have anything registered for this family at all? */
const filled = (x: any) => x !== null && x !== undefined && x !== '';
const hasDoc = (v: VReg, fields: DocField[], keyField?: string) => (keyField
  ? filled(readPath(v, keyField))
  : fields.some((f) => filled(readPath(v, f.path))));

/** Field value as the input accepts it; a date is cut to `YYYY-MM-DD`. */
const inputValue = (v: VReg | null, f: DocField) => {
  const raw = v ? readPath(v, f.path) : undefined;
  if (f.kind === 'flag') return !!raw && raw === (f.on ?? 'open');
  if (raw === null || raw === undefined) return '';
  if (f.kind === 'date') return String(raw).slice(0, 10);
  return raw;
};

/**
 * State of this document on this vehicle, by the name `STATE_META` understands.
 * Read from `docStatuses`, which the server computes with the settings thresholds; not computed here, or colours would differ from the alerts screen for the same vehicle.
 */
const stateOf = (v: VReg, docKey: string) => {
  const s = v.docStatuses?.[docKey];
  if (!s) return { state: 'missing', days: null as number | null };
  const state = s.status === 'none' ? 'missing' : s.status === ('not_required' as any) ? 'not_applicable' : s.status;
  return { state, days: s.days };
};

function DocumentFamilyPageInner({
  docKey, path, icon, titleAr, titleEn, subtitleAr, subtitleEn, columns, fileName, searchIn, chips, fields, keyField, rowAction, hideClear, personFill,
}: {
  /**
   * Key of the document that has an expiry date, or `null` for a family that does not expire.
   * The petrol-card chip has a number, status and spending cap but no expiry date; putting it in the days-remaining column would show 300 vehicles as "no date" on a screen where a date is meaningless, a made-up gap implying work to do. The renew button is also dropped: what does not expire is not renewed.
   */
  docKey: string | null;
  /** This page's path; filters live in its own URL, not another page's. */
  path: string;
  icon: React.ReactNode;
  titleAr: string; titleEn: string;
  subtitleAr: string; subtitleEn: string;
  columns: DocColumn[];
  fileName: string;
  /** Fields the quick search above the table covers. */
  searchIn?: (v: VReg) => (string | number | null | undefined)[];
  /** Family-specific chips; replace the status chips when no document expires. */
  chips?: Chip[];
  /** Person lookup that fills this family's fields, shown in the edit form above the fields. `map` returns a "field path to value" map. See `PersonLookup`. */
  personFill?: { label?: string; hint?: string; map: (p: FoundPerson) => Record<string, any> };
  /**
   * This family's fields only; add, edit and clear open with these alone.
   * The full vehicle form is not opened from here: it has 47 fields of seven other families, so each page would become a back door to everything, which is the job of the general register page. Leaving it empty keeps the page read/renew only, with no buttons that do not know where to write.
   */
  fields?: DocField[];
  /**
   * The field whose presence means the document exists.
   * "Any field filled" is not enough: ten vehicles have a fuel-chip status recorded but no chip, so they counted as having one and vanished from the add picker, while the filter above the table said they were there. A document exists by its identifier (chip number, policy number, card number); the rest are attributes.
   */
  keyField?: string;
  /**
   * Extra button on a family row, for a restricted action rather than clearing a field.
   * Chip removal is an example: it is a condition of employee clearance, so it cannot be a silent field clear. It calls its own endpoint that records who removed it and when.
   */
  rowAction?: (v: VReg, reload: () => void) => React.ReactNode;
  /**
   * A page with its own action does not show "clear data".
   * Clear empties the document fields on the vehicle, right for a mistyped operating card. For authorizations it is wrong: cancelling is two-sided (vehicle paper and employee assignment) and clear touches only the first, so the user thinks it was cancelled. Eleven rows were cleared this way and their owners stayed authorized in their files.
   */
  hideClear?: boolean;
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify, confirm } = useDialog();
  const sp = useSearchParams();
  const router = useRouter();
  const canEdit = canEditVehicles(user);
  /** Real delete is a narrower permission than edit; same split as on the server. */
  const canDelete = canAdminVehicles(user);
  /** No writing without known fields: a page that did not declare fields stays as it was. */
  const editable = canEdit && !!fields?.length;

  const doc = docKey ? DOC_TYPES.find((d) => d.key === docKey) : undefined;
  const renewable = !!doc && canEdit;
  /** Is there anything to do on the row at all? If not, no empty actions column is drawn. */
  const hasRowActions = editable || !!rowAction;
  // The actions column width is measured so the panel stops beside it; see components/vehicles/stickyLead.
  const lead = useLeadOffset();
  const hasLead = renewable || hasRowActions;

  const [rows, setRows] = useState<VReg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp?.get('q') || '');
  const [chip, setChip] = useState('');
  // Inner filter: range of days until expiry.
  // The main filter answers "which vehicles" (sector, city, owner); this answers "what expires within N days". They work together, e.g. heavy-transport operating cards in Jeddah expiring within a week, which used to need two screens. Read from the URL like other filters, so a link opens on what was filtered.
  const [within, setWithin] = useState(sp?.get('within') || '');
  const [includeExpired, setIncludeExpired] = useState(sp?.get('incExp') !== '0');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  const [bulk, setBulk] = useState<RenewTarget[] | null>(null);
  // Renewing a shared document.
  // One insurance policy covers 198 vehicles; select-then-renew means 198 sign-offs for one event, and any vehicle forgotten stays expired though insured. So the policy is asked, not the vehicles; see SharedPolicyRenewModal.
  const [sharedOpen, setSharedOpen] = useState(false);
  // Excel-style column filter. The funnel in the header opens the values to tick. The value is read with the column's own function that renders the cell and exports the file, so what is filtered is what is read. Rows are loaded in full (limit=2000), so the list is complete, not one page.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = useCallback((key: string, sel: Set<string>) => {
    setColFilters((prev) => {
      const next = { ...prev };
      if (sel.size) next[key] = sel; else delete next[key];
      return next;
    });
  }, []);
  /** Family form: `vehicle: null` means "pick the vehicle first", i.e. create. */
  const [form, setForm] = useState<{ vehicle: VReg | null } | null>(null);

  // Everything in the URL is a filter passed to the server as is. A named whitelist silently dropped other filters, so the screen opened the whole fleet while claiming to be filtered; a number that opens something different from what it says is worse than a number that cannot be clicked.
  const UI_ONLY = ['limit', 'page', 'q'];
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => !UI_ONLY.includes(k))));

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    p.set('limit', '2000');
    return p.toString();
  }, [q, JSON.stringify(filters)]);

  // An old response must not overwrite a newer one.
  // Search, chip and page are filtered on the server so several requests fly at once; the broadest is slowest, arrives last and overwrites the narrower, so the filter appears to release after seconds untouched. Six screens go through here. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ vehicles: VReg[]; total: number }>(`/api/vehicle-registry?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.vehicles || []); setTotal(d.total || 0);
      // A selection that left the result is not kept hidden: filtering then pressing bulk renew does not mean vehicles no longer in view.
      setPicked((prev) => new Set([...prev].filter((id) => (d.vehicles || []).some((v) => v._id === id))));
    } catch (e: any) { if (guard.isCurrent(mine)) notify(e?.message || 'Failed', 'error'); }
    finally { if (guard.isCurrent(mine)) setLoading(false); }
  }, [qs, notify, guard]);

  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // What is chosen lives in the URL: back and forward work and the link is sent as is.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    if (within) p.set('within', within);
    if (!includeExpired) p.set('incExp', '0');
    syncUrl(path, p);
  }, [q, JSON.stringify(filters), within, includeExpired, path]);

  // Chips show the state of this document only, not the general vehicle state: a vehicle with expired insurance but a valid operating card is not expired on the operating-cards page, or the chip would open rows unrelated to the screen's work.
  // Four chips the user reads: expired, near, healthy, missing. There used to be ten: three urgency levels read as one, "no date" separate from "required" though part of it, and "not required", "present", "held elsewhere" which opened nothing. The document name is in the chip ("insurance expired", not "expired") because a screen shows one document and a bare "expired" leaves the question what.
  const famLabelShort = doc ? (ar ? doc.ar : doc.en) : '';
  const CHIPS: Chip[] = useMemo(() => (chips || (!docKey ? [{ key: '', label: t('الكل', 'All') }] : [
    { key: '', label: t('الكل', 'All') },
    {
      key: 'expired',
      label: t(`${famLabelShort} منتهٍ`, `${famLabelShort} expired`),
      tone: 'red',
      test: (v: VReg) => stateOf(v, docKey).state === 'expired',
    },
    // Three chips instead of one: critical is today's work, warning is this week's, soon is preparation for next month. Each threshold in days is set per document in section settings.
    {
      key: 'critical', label: t('حرج', 'Critical'), tone: 'orange',
      test: (v: VReg) => stateOf(v, docKey).state === 'critical',
    },
    {
      key: 'warning', label: t('تحذير', 'Warning'), tone: 'amber',
      test: (v: VReg) => stateOf(v, docKey).state === 'warning',
    },
    {
      key: 'upcoming', label: t('قريب', 'Upcoming'), tone: 'sky',
      test: (v: VReg) => stateOf(v, docKey).state === 'upcoming',
    },
    { key: 'valid', label: t('ساري', 'Valid'), tone: 'green', test: (v: VReg) => stateOf(v, docKey).state === 'valid' },
    {
      // "Required" merges both gaps: a vehicle that needs the document and has none, and one that has it with no recorded date. Both are pending work and splitting them makes the work list two halves not read together. A vehicle that does not need the document is in neither.
      key: 'needed',
      label: t('مطلوب — ناقص', 'Needed — missing'),
      tone: 'red',
      test: (v: VReg) => docNeed(v, docKey) === 'required' || stateOf(v, docKey).state === 'missing',
    },
  ])), [ar, docKey, chips, famLabelShort]);

  // Search runs twice, so both must agree. The server searches every text field of the vehicle, then the result is filtered here again with the same text; if this pass looked at only two fields it would drop what the server found in a third (typing an authorized person's ID returns the row and the screen deletes it). So all row values are collected here, and what the caller passes is added, not substituted.
  const deepValues = (o: any, depth = 0): (string | number)[] => {
    if (o == null || depth > 3) return [];
    if (Array.isArray(o)) return o.flatMap((x) => deepValues(x, depth + 1));
    if (typeof o === 'object') return Object.entries(o)
      .filter(([k]) => k !== '_id' && k !== '__v')
      .flatMap(([, x]) => deepValues(x, depth + 1));
    return typeof o === 'string' || typeof o === 'number' ? [o] : [];
  };
  const search = useCallback(
    (v: VReg) => [...deepValues(v), ...(searchIn ? searchIn(v) : [])],
    [searchIn],
  );
  const chipFiltered = useChipFilter(rows, CHIPS, chip, q, search);

  // The days range applies on top of the chips, not instead of them. The order is intended: the chip says "expired" and the range says "within seven", together "expired or expiring within seven", which is what is asked. A vehicle with no recorded date leaves any range: it has no date to measure, and including it would make the number promise work that does not exist.
  const f = useMemo(() => {
    if (!docKey || within === '') return chipFiltered;
    const n = Number(within);
    if (!Number.isFinite(n)) return chipFiltered;
    const shown = chipFiltered.shown.filter((v: VReg) => {
      const st = stateOf(v, docKey);
      if (st.days == null) return false;
      if (st.days < 0) return includeExpired;   // Expired: included or excluded explicitly.
      return st.days <= n;
    });
    return { ...chipFiltered, shown };
  }, [chipFiltered, docKey, within, includeExpired]);

  // Column filters apply on top of everything, last, seeing what chips and period left, as Excel does.
  const colText = useCallback((c: DocColumn, v: VReg) => {
    const raw = c.get(v);
    return raw === null || raw === undefined || raw === '' ? '' : String(raw);
  }, []);
  const shownRows = useMemo(() => {
    const keys = Object.keys(colFilters);
    if (!keys.length) return f.shown;
    return f.shown.filter((v: VReg) => keys.every((k) => {
      const c = columns.find((x) => x.key === k);
      if (!c) return true;
      return colFilters[k].has(colText(c, v));
    }));
  }, [f.shown, colFilters, columns, colText]);
  const colFilterCount = Object.keys(colFilters).length;

  // Flat export row: the same functions that render the cells, so the file matches the screen with no second column definition.
  const flat = (v: VReg) => {
    const o: Record<string, any> = {};
    for (const c of columns) o[c.key] = c.get(v) ?? '';
    if (docKey) {
      const st = stateOf(v, docKey);
      o.__state = ar ? stateMeta(st.state).ar : stateMeta(st.state).en;
      o.__days = st.days ?? '';
    }
    return o;
  };
  const exportCols: ExportColumn[] = [
    ...columns.map((c) => ({ header: ar ? c.ar : c.en, key: c.key, width: c.width || 18 })),
    ...(docKey ? [
      { header: t('الحالة', 'State'), key: '__state', width: 14 },
      { header: t('الأيام المتبقية', 'Days left'), key: '__days', width: 12 },
    ] : []),
  ];

  const targetOf = (v: VReg): RenewTarget => ({
    vehicleId: v._id, plateNumber: v.plateNumber, docKey: docKey || '',
    docAr: doc?.ar, docEn: doc?.en, expiryDate: doc?.datePath(v) || null,
    documentNumber: doc?.numberOf(v) || '',
    // An authorization has a start date that is renewed with its end; only the modal knows which document has a start, so the current value is passed to compare with the new one.
    startDate: docKey === 'authorization' ? (v.authorizedPerson?.startDate || null) : null,
  });

  /** What the document is called in confirmations and messages: its name if it is a document, otherwise the page title. */
  const famLabel = doc ? (ar ? doc.ar : doc.en) : t(titleAr, titleEn);

  // "Delete" on a document page clears the document, not the vehicle.
  // The vehicle exists in reality with plate, chassis, accidents and authorizations; an expired operating card or a typo does not mean it is gone. Deleting it from here wiped six other families not shown on this screen, harm the clicker cannot see. The right destructive action is to empty this family only; the vehicle stays in the register as a row with empty cells, which the "no recorded date" chip shows as work to do.
  const clearDoc = useCallback(async (v: VReg) => {
    if (!fields?.length) return;
    const ok = await confirm({
      title: t('مسح بيانات المستند', 'Clear document data'),
      tone: 'danger',
      confirmLabel: t('مسح البيانات', 'Clear data'),
      message: t(
        `ستُفرَّغ خانات «${famLabel}» على المركبة ${v.plateNumber}. المركبة نفسها تبقى في السجلّ ببقيّة مستنداتها، وتظهر هنا بلا بيانات.`,
        `The «${famLabel}» fields on vehicle ${v.plateNumber} will be emptied. The vehicle itself stays in the registry with its other documents, and appears here with no data.`),
    });
    if (!ok) return;
    // `statusCode` is cleared too: it is the reason the date is missing ("not required", "held by the bank"); keeping it after an explicit clear makes the row excuse a gap that no longer exists.
    const patch = buildPatch(fields, {});
    for (const r of rootsOf(fields)) writePath(patch, `${r}.statusCode`, '');
    try {
      await api.put(`/api/vehicle-registry/${v._id}`, patch);
      notify(t('تم مسح بيانات المستند', 'Document data cleared'), 'success');
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  }, [fields, famLabel, confirm, notify, load, ar]);

  // Shared document numbers and the vehicle count of each, built from the loaded rows so what is offered for renewal is what is on screen, not a list from another source that may differ.
  const sharedGroups = useMemo(() => {
    if (!docKey || !isSharedPaper(docKey) || !doc) return [];
    const m = new Map<string, { number: string; count: number; expiryDate?: string | null }>();
    for (const v of rows) {
      const n = String(doc.numberOf(v) || '').trim();
      if (!n) continue;
      const g = m.get(n);
      const exp = doc.datePath(v) || null;
      if (!g) m.set(n, { number: n, count: 1, expiryDate: exp });
      else {
        g.count += 1;
        // The nearest expiry in the group is effectively the document's expiry.
        if (exp && (!g.expiryDate || new Date(exp) < new Date(g.expiryDate))) g.expiryDate = exp;
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [rows, docKey, doc]);

  // "Select all shown" means shown after column filters too, otherwise it selects rows the clicker cannot see.
  const allShownPicked = shownRows.length > 0 && shownRows.every((v: VReg) => picked.has(v._id));
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) shownRows.forEach((v: VReg) => n.delete(v._id));
    else shownRows.forEach((v: VReg) => n.add(v._id));
    return n;
  });

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link href="/system/vehicles/registry/overview"
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {t('النظرة الشاملة', 'Overview')}
      </Link>

      <PageHeader icon={icon} title={t(titleAr, titleEn)} subtitle={t(subtitleAr, subtitleEn)}>
        {renewable && sharedGroups.length > 0 && (
          <button
            onClick={() => setSharedOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12325c] hover:bg-[#0d2544] text-white text-sm font-semibold"
            title={t('الوثيقة الواحدة تغطّي عدّة مركبات — تُجدَّد مرّةً واحدة',
                     'One policy covers many vehicles — renew it once')}>
            <RefreshCw className="w-4 h-4" />
            {t('تجديد وثيقة كاملة', 'Renew a whole policy')}
          </button>
        )}
        {renewable && picked.size > 0 && (
          <button
            onClick={() => setBulk(rows.filter((v) => picked.has(v._id)).map(targetOf))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            <RefreshCw className="w-4 h-4" />
            {t(`تجديد ${picked.size} مستند`, `Renew ${picked.size}`)}
          </button>
        )}
        {editable && (
          <button onClick={() => setForm({ vehicle: null })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" />
            {t('إضافة', 'Add')}
          </button>
        )}
        {/* Two scopes, not one. "Shown" is exactly the screen after filter, chip, search and column filters. "All" is the whole register without filters, which could only be reached by clearing each filter, exporting, then restoring them. Columns are the same in both and are the screen's own, so a column added here appears in the file with no second definition. */}
        <ExportMenu fileName={fileName} lang={lang as 'ar' | 'en'}
          options={[
            {
              key: 'shown',
              label: t('تصدير المعروض (بعد الفلتر)', 'Export what is shown (filtered)'),
              sheets: [{ name: t(titleAr, titleEn).slice(0, 28), rows: shownRows.map(flat), columns: exportCols }],
            },
            {
              key: 'all',
              label: t('تصدير الكلّ', 'Export everything'),
              hint: t('السجلّ كلُّه', 'whole register'),
              resolve: async () => {
                const d = await api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=2000');
                return [{ name: t(titleAr, titleEn).slice(0, 28), rows: (d.vehicles || []).map(flat), columns: exportCols }];
              },
            },
          ]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {colFilterCount > 0 && (
          <button onClick={() => setColFilters({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold hover:bg-[#f37121]/20">
            {t(`مسح فلاتر الأعمدة (${colFilterCount})`, `Clear column filters (${colFilterCount})`)}
          </button>
        )}
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          resultCount={total}
          resultLabel={t('المركبات المطابقة', 'Matching vehicles')}
        />
      </div>

      {/* Inner filter: what expires before N days. Works with the main filter above and the status chips below. The period is a typed number, not a fixed list: the buttons are shortcuts for common values and anyone wanting 47 days types it. */}
      {!!docKey && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold text-slate-700">{t('ينتهي خلال', 'Expiring within')}</span>
          <input type="number" min={0} max={3650} value={within}
            onChange={(e) => setWithin(e.target.value)}
            placeholder={t('كل المدد', 'Any')}
            className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-center font-bold" />
          <span className="text-[12px] text-slate-500">{t('يوم', 'days')}</span>
          <div className="flex flex-wrap gap-1.5">
            {[7, 15, 30, 60, 90, 180].map((n) => (
              <button key={n} onClick={() => setWithin(String(n))}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}>{n}</button>
            ))}
            <button onClick={() => setWithin('')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                within === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>{t('الكل', 'All')}</button>
          </div>
          {within !== '' && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer ms-1">
              <input type="checkbox" checked={includeExpired}
                onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
              {t('يشمل المنتهي', 'Include expired')}
            </label>
          )}
          {within !== '' && (
            <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 ms-auto">
              {t(`المعروض ${f.shown.length} مركبة`, `${f.shown.length} shown`)}
            </span>
          )}
        </div>
      )}

      <FilterBar chips={CHIPS} counts={f.counts} active={chip} onChange={setChip}
        query={q} onQuery={setQ}
        placeholder={t('ابحث بأيّ شيء — لوحة، هيكل، مالك، رقم هويّة، رقم وثيقة، سريال جهاز…', 'Search anything — plate, chassis, owner, ID, policy, serial…')}
        shown={shownRows.length} total={rows.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
              <tr>
                {/* Actions column first and sticky. It used to be the last column in a table wider than the screen, so editing a row meant scrolling to the end and back for every row, and the wrong row was easy to hit after a slip. Now it is read first and does not scroll, together with the checkbox, since they are one action on the row. */}
                {hasLead && (
                  <th ref={lead.ref} className={`${LEAD} bg-slate-900 px-3 py-3 text-start font-bold whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-2">
                      {renewable && (
                        <input type="checkbox" checked={allShownPicked} onChange={toggleAll}
                          title={t('اختيار كل المعروض', 'Select all shown')} className="accent-[#f37121]" />
                      )}
                      {hasRowActions && t('إجراءات', 'Actions')}
                    </span>
                  </th>
                )}
                {columns.map((c, i) => (
                  // The first column is the plate, the row identity, pinned with the actions.
                  <th key={c.key}
                    className={`px-3 py-3 text-start font-bold whitespace-nowrap ${i === 0 ? `${LEAD_2} bg-slate-900` : ''}`}
                    style={i === 0 ? { insetInlineStart: hasLead ? lead.offset : 0 } : undefined}>
                    <span className="inline-flex items-center gap-1">
                      {ar ? c.ar : c.en}
                      <ColumnFilter
                        rows={f.shown}
                        field={c.key}
                        valueOf={(r: any) => colText(c, r)}
                        selected={colFilters[c.key] || EMPTY_SET}
                        onChange={(sel) => setColFilter(c.key, sel)}
                        lang={ar ? 'ar' : 'en'} />
                    </span>
                  </th>
                ))}
                {docKey && <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('الحالة', 'State')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownRows.map((v: VReg) => {
                const st = docKey ? stateOf(v, docKey) : null;
                const meta = st ? stateMeta(st.state) : null;
                const on = picked.has(v._id);
                return (
                  <tr key={v._id} className={`group hover:bg-slate-50 ${on ? 'bg-orange-50/60' : ''}`}>
                    {hasLead && (
                      <td className={`${LEAD} px-3 py-2 ${on ? 'bg-orange-50' : 'bg-white'} group-hover:bg-slate-50`}>
                        <div className="flex items-center gap-1.5">
                          {renewable && (
                            <input type="checkbox" checked={on} className="accent-[#f37121]"
                              onChange={() => setPicked((p) => {
                                const n = new Set(p); if (n.has(v._id)) n.delete(v._id); else n.add(v._id); return n;
                              })} />
                          )}
                          {rowAction?.(v, load)}
                          {renewable && (
                            <button onClick={() => setRenewing(targetOf(v))}
                              className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11.5px] font-semibold hover:bg-emerald-100 whitespace-nowrap">
                              {t('تجديد', 'Renew')}
                            </button>
                          )}
                          {editable && (
                            <button onClick={() => setForm({ vehicle: v })}
                              title={t('تعديل بيانات هذا المستند', 'Edit this document')}
                              className="p-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {/* An eraser, not a trash can: the icon itself says the cleared thing is data, not a vehicle. */}
                          {editable && !hideClear && hasDoc(v, fields!, keyField) && (
                            <button onClick={() => clearDoc(v)}
                              title={t('مسح بيانات هذا المستند', 'Clear this document')}
                              className="p-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                              <Eraser className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                    {columns.map((c, i) => {
                      const val = c.get(v);
                      const text = val === null || val === undefined || val === '' ? '—' : String(val);
                      return (
                        <td key={c.key}
                          className={`px-3 py-2 whitespace-nowrap ${c.mono ? 'font-mono text-[12.5px]' : 'text-[13px]'} `
                            + (i === 0
                              ? `font-semibold text-slate-900 ${LEAD_2} ${on ? 'bg-orange-50' : 'bg-white'} group-hover:bg-slate-50`
                              : 'text-slate-700')}
                          style={i === 0 ? { insetInlineStart: hasLead ? lead.offset : 0 } : undefined}
                          {...(c.mono ? { dir: 'ltr' } : {})}>
                          {i === 0
                            ? <Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline">{text}</Link>
                            : text}
                        </td>
                      );
                    })}
                    {st && meta && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${meta.bg}`}>
                          {st.days == null ? (ar ? meta.ar : meta.en) : daysText(st.days, ar)}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!f.shown.length && (
                <tr><td colSpan={columns.length + 2} className="px-3 py-12 text-center text-slate-500">
                  {t('لا نتائج مطابقة', 'No matching rows')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {renewing && (
        <RenewModal row={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}
      {sharedOpen && docKey && (
        <SharedPolicyRenewModal docKey={docKey} groups={sharedGroups} ar={ar}
          onClose={() => setSharedOpen(false)}
          onDone={() => { setSharedOpen(false); setPicked(new Set()); load(); }} />
      )}
      {bulk && (
        <BulkRenewModal rows={bulk} ar={ar} onClose={() => setBulk(null)}
          onDone={() => { setBulk(null); setPicked(new Set()); load(); }} />
      )}
      {form && !!fields?.length && (
        <DocFormModal vehicle={form.vehicle} fields={fields} keyField={keyField} famLabel={famLabel} ar={ar}
          canDelete={canDelete} personFill={personFill}
          onClose={() => setForm(null)}
          onDone={() => { setForm(null); load(); }} />
      )}
    </div>
  );
}

// `useSearchParams` requires a Suspense boundary in the Next router, or the build fails at the first edit in the section shell.
export default function DocumentFamilyPage(props: Parameters<typeof DocumentFamilyPageInner>[0]) {
  return <Suspense fallback={<Spinner />}><DocumentFamilyPageInner {...props} /></Suspense>;
}


// Family form: create and edit, with vehicle deletion behind a closed door.
// "Create" here does not create a vehicle. A vehicle is born in the general register page with plate, chassis and sector; creating it from the operating-cards page with only a card and plate would add an identity-incomplete vehicle by a side door. What is actually missing is a document not yet registered on an existing vehicle (115 vehicles have no operating-card number), whose entry path used to go through the 47-field form. So create here means pick the vehicle (the list starts with those lacking the document) and fill this family's fields only.
function DocFormModal({ vehicle, fields, keyField, famLabel, ar, canDelete, personFill, onClose, onDone }: {
  vehicle: VReg | null;
  fields: DocField[];
  keyField?: string;
  famLabel: string;
  ar: boolean;
  canDelete: boolean;
  /** Person lookup that fills this family's fields; see `PersonLookup`. The function returns a "field path to value" map used to fill the inputs. */
  personFill?: { label?: string; hint?: string; map: (p: FoundPerson) => Record<string, any> };
  onClose: () => void;
  onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const creating = !vehicle;

  const [target, setTarget] = useState<VReg | null>(vehicle);
  const [vals, setVals] = useState<Record<string, any>>(
    () => Object.fromEntries(fields.map((f) => [f.path, inputValue(vehicle, f)])));
  const [saving, setSaving] = useState(false);

  // "Do we need this document on this vehicle?"
  // This was asked only in the vehicle register form. Someone reviewing the inspection opens the inspection page, sees a trailer as "required, missing" though trailers are not inspected, and had to leave for another screen to fix it. Now the question is asked where the document is edited.
  // The object holding the family has the answer: `inspection.statusCode` for inspection, `gps.statusCode` for tracking. It is the same field the register writes and the server reads, so there is one source of truth.
  const statusPath = `${rootsOf(fields)[0] || ''}.statusCode`;
  const initialNeed = String((target ? readPath(target, statusPath) : '') || '');
  const [need, setNeed] = useState(initialNeed);
  // Nothing is written unless clicked: absence today implicitly means "required", so writing it ourselves on every save would change rows nobody intended.
  const needTouched = need !== initialNeed;

  // The picker list is fetched unfiltered. The screen filter is a question about what is shown, not a limit on what may be registered: someone who filters on "expired" and then clicks add does not mean to be blocked from a valid vehicle.
  const [pool, setPool] = useState<VReg[] | null>(null);
  const [pq, setPq] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  useEffect(() => {
    if (!creating) return;
    api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=2000')
      .then((d) => setPool(d.vehicles || []))
      .catch((e: any) => notify(e?.message || 'Failed', 'error'));
  }, [creating, notify]);

  // The vehicle picker is searched by plate, so it is folded like every other search; someone pasting the plate with two spaces used to not find the vehicle and registered the document on another one.
  const candidates = useMemo(() => (pool || []).filter((v) => {
    if (onlyMissing && hasDoc(v, fields, keyField)) return false;
    return flexIncludes(pq, v.plateNumber, v.ownerNameAr, v.departmentAr, v.sectorAr);
  }).slice(0, 400), [pool, pq, onlyMissing, fields]);

  /** Picking a vehicle fills the form with what is already on it, not with blanks that would erase what is registered. */
  const pick = (v: VReg) => {
    setTarget(v);
    setVals(Object.fromEntries(fields.map((f) => [f.path, inputValue(v, f)])));
    setNeed(String(readPath(v, statusPath) || ''));
  };

  const save = async () => {
    if (!target) { notify(t('اختر المركبة أوّلًا', 'Pick a vehicle first'), 'error'); return; }
    setSaving(true);
    try {
      const patch = buildPatch(fields, vals);
      if (needTouched) writePath(patch, statusPath, need);
      await api.put(`/api/vehicle-registry/${target._id}`, patch);
      notify(t('تم الحفظ', 'Saved'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  // Deleting the vehicle itself: behind a disclosure and a hand-typed plate.
  // A misclick in a 300-row table would erase a vehicle with its accidents, authorizations and renewal history. Typing the plate is not formality: it forces reading which row is being deleted.
  const [showDanger, setShowDanger] = useState(false);
  const [typed, setTyped] = useState('');
  const [killing, setKilling] = useState(false);
  const armed = !!target && typed.trim() === String(target.plateNumber || '').trim();
  const destroy = async () => {
    if (!target || !armed) return;
    setKilling(true);
    try {
      await api.delete(`/api/vehicle-registry/${target._id}`);
      notify(t(`حُذفت المركبة ${target.plateNumber}`, `Deleted ${target.plateNumber}`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setKilling(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-slate-900">
            {creating ? t(`إضافة ${famLabel}`, `Add ${famLabel}`) : t(`تعديل ${famLabel}`, `Edit ${famLabel}`)}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {target
            ? <>{target.plateNumber}{target.ownerNameAr ? ` · ${target.ownerNameAr}` : ''}</>
            : t('اختر المركبة التي تريد تسجيل هذا المستند عليها', 'Pick the vehicle to record this document on')}
          {creating && target && (
            <button onClick={() => setTarget(null)} className="ms-2 text-[#f37121] hover:underline text-[12px]">
              {t('تغيير المركبة', 'change vehicle')}
            </button>
          )}
        </p>

        {/* Vehicle picker. */}
        {creating && !target && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input value={pq} onChange={(e) => setPq(e.target.value)} autoFocus
                  placeholder={t('ابحث بلوحة أو مالك أو إدارة…', 'Search plate, owner or department…')}
                  className={`${inp} ps-9`} />
              </div>
              {/* Default is "those without data": that is why the dialog was opened. Someone correcting a registered vehicle unticks it and is not blocked. */}
              <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={onlyMissing} className="accent-[#f37121]"
                  onChange={(e) => setOnlyMissing(e.target.checked)} />
                {t('التي لا بيانات لها فقط', 'Only vehicles with no data')}
              </label>
            </div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {pool === null && <div className="p-4"><Spinner /></div>}
              {pool !== null && !candidates.length && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  {t('لا مركبات مطابقة', 'No matching vehicles')}
                </p>
              )}
              {candidates.map((v) => (
                <button key={v._id} onClick={() => pick(v)}
                  className="w-full text-start px-3 py-2 hover:bg-orange-50 flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900 text-[13px]">{v.plateNumber}</span>
                  <span className="text-[12px] text-slate-500 truncate">
                    {[v.ownerNameAr, v.departmentAr, v.cityAr].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
            {pool !== null && (
              <p className="text-[11.5px] text-slate-500">
                {t(`${candidates.length} مركبة معروضة من ${pool.length}`, `${candidates.length} of ${pool.length} shown`)}
              </p>
            )}
          </div>
        )}

        {/* This family's fields only. */}
        {target && (
          <>
            {creating && hasDoc(target, fields) && (
              <p className="mb-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('على هذه المركبة بياناتٌ مسجَّلة لهذا المستند — ما تحفظه سيحلّ محلَّها.',
                   'This vehicle already has data for this document — saving will replace it.')}
              </p>
            )}
            {/* The question comes before the fields: answering "not required" makes what is below meaningless, and nobody who answered that is expected to fill a date. */}
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <ReqToggle ar={ar}
                label={t(`هل «${famLabel}» مطلوبٌ على هذه المركبة؟`, `Is «${famLabel}» required on this vehicle?`)}
                code={need} onChange={setNeed} />
              <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
                {t('«غير مطلوب» ليست نقصًا: تخرج المركبة من قائمة العمل وتظهر رماديّةً هنا وفي سجلّ المركبات وفي النظرة الشاملة.',
                   '«Not required» is not a gap: the vehicle leaves the work list and shows greyed out here, in the vehicle registry and in the overview.')}
              </p>
            </div>

            {/* Lookup of a person fills their fields, instead of typing name, iqama and mobile by hand on every paper. */}
            {personFill && (
              <PersonLookup ar={ar} label={personFill.label} hint={personFill.hint}
                onPick={(pp) => setVals((prev) => ({ ...prev, ...personFill.map(pp) }))} />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((fl) => (
                <div key={fl.path} className={fl.wide ? 'md:col-span-2' : ''}>
                  {fl.kind === 'flag' ? (
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer h-full pt-5">
                      <input type="checkbox" className="accent-[#f37121]" checked={!!vals[fl.path]}
                        onChange={(e) => setVals((p) => ({ ...p, [fl.path]: e.target.checked }))} />
                      {ar ? fl.ar : fl.en}
                    </label>
                  ) : (
                    <>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {ar ? fl.ar : fl.en}
                        {fl.hint && <span className="font-normal text-slate-400"> ({fl.hint})</span>}
                      </label>
                      {fl.person ? (
                        <PersonSelect endpoint="/api/vehicle-registry/people" ar={ar}
                          clearLabel={t('بلا — يُلغى', 'None — clears it')}
                          idNumber={String(vals[fl.person.idPath] ?? '')} name={String(vals[fl.path] ?? '')}
                          onChange={(p) => setVals((prev) => {
                            const ps = fl.person!;
                            const next = { ...prev, [fl.path]: p?.name || '', [ps.idPath]: p?.idNumber || '' };
                            if (ps.phonePath) next[ps.phonePath] = p?.phone || '';
                            if (ps.jobPath && p?.jobTitleAr && !prev[ps.jobPath]) next[ps.jobPath] = p.jobTitleAr;
                            return next;
                          })} />
                      ) : fl.readOnly ? (
                        <input readOnly value={vals[fl.path] ?? ''} tabIndex={-1}
                          className={`${inp} bg-slate-50 text-slate-500 ${fl.mono ? 'font-mono' : ''}`}
                          {...(fl.mono ? { dir: 'ltr' } : {})} />
                      ) : fl.lookup ? (
                        <ManagedSelect storeLabel type={fl.lookup} value={vals[fl.path] ?? ''}
                          onChange={(v) => setVals((p) => ({ ...p, [fl.path]: v }))}
                          placeholder={t('اختر…', 'Select…')} />
                      ) : (
                        fl.kind === 'date' ? (
                          <HijriGregorianField
                            value={vals[fl.path] ?? ''}
                            onChange={(v) => setVals((p) => ({ ...p, [fl.path]: v }))}
                            ar={ar} inp={inp} />
                        ) : (
                          <input
                            type={fl.kind === 'number' ? 'number' : 'text'}
                            value={vals[fl.path] ?? ''}
                            onChange={(e) => setVals((p) => ({ ...p, [fl.path]: e.target.value }))}
                            className={`${inp} ${fl.mono ? 'font-mono' : ''}`}
                            {...(fl.mono ? { dir: 'ltr' } : {})} />
                        )
                      )}
                      {/* Iqama number with the owner identified under it: birth date and mobile. */}
                      {fl.personInfo && <IqamaPersonInfo idNumber={vals[fl.path]} ar={ar} />}
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
              {t('لا يُكتب من هنا إلا حقول هذا المستند — بقيّة بيانات المركبة تُعدَّل من صفحة سجل المركبات.',
                 'Only this document\u2019s fields are written here — the rest of the vehicle is edited in the vehicle registry.')}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">
                {t('إلغاء', 'Cancel')}
              </button>
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f14] text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {t('حفظ', 'Save')}
              </button>
            </div>
          </>
        )}

        {/* Delete the whole vehicle: only for those with delete permission, and only in edit. */}
        {!creating && canDelete && target && (
          <div className="mt-5 pt-4 border-t border-slate-200">
            {!showDanger ? (
              <button onClick={() => setShowDanger(true)}
                className="inline-flex items-center gap-1.5 text-[12px] text-red-600 hover:text-red-800 hover:underline">
                <Trash2 className="w-3.5 h-3.5" />
                {t('حذف المركبة من السجلّ نهائيًا', 'Permanently delete this vehicle')}
              </button>
            ) : (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 space-y-2">
                <p className="text-[12.5px] text-red-800 font-semibold leading-relaxed">
                  {t(`هذا ليس مسحًا لـ«${famLabel}». ستُحذف المركبة ${target.plateNumber} من سجلّ المركبات نهائيًا، بكل مستنداتها وتفاويضها وسجلّ تجديداتها — ولا رجعة.`,
                     `This is not clearing «${famLabel}». Vehicle ${target.plateNumber} will be permanently removed from the registry with every document, authorisation and renewal record — this cannot be undone.`)}
                </p>
                <label className="block text-[11.5px] font-semibold text-red-800">
                  {t(`اكتب رقم اللوحة للتأكيد: ${target.plateNumber}`, `Type the plate to confirm: ${target.plateNumber}`)}
                </label>
                <input value={typed} onChange={(e) => setTyped(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-red-300 text-sm bg-white" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowDanger(false); setTyped(''); }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[12.5px]">
                    {t('تراجع', 'Back')}
                  </button>
                  <button onClick={destroy} disabled={!armed || killing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[12.5px] font-semibold disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" /> {t('حذف المركبة نهائيًا', 'Delete vehicle')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Columns repeated in every family: plate first, then what locates the vehicle, then what identifies it.
 * Brand, model and year are here, not per page: the plate says which row, not which vehicle, and people reviewing inspection or insurance ask about the truck ("Hino 2019"), which used to mean opening the vehicle page or the general register from each of the seven pages. They are three short text fields that arrive with the row, so no second call and no column filled twice.
 */
export const commonColumns = (): DocColumn[] => [
  // Vehicle identity in the order used across section pages; see lib/vehicleColumns.
  { key: 'plateNumber', ar: 'رقم اللوحة', en: 'Plate', get: (v) => v.plateNumber, width: 16 },
  { key: 'chassisNumber', ar: 'رقم الهيكل', en: 'Chassis', get: (v) => v.chassisNumber, width: 22, mono: true },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (v) => v.serialNumber, width: 16, mono: true },
  { key: 'registrationTypeAr', ar: 'نوع التسجيل', en: 'Registration type', get: (v) => v.registrationTypeAr, width: 14 },
  { key: 'brandAr', ar: 'ماركة المركبة', en: 'Brand', get: (v) => v.brandAr, width: 14 },
  { key: 'modelAr', ar: 'طراز المركبة', en: 'Model', get: (v) => v.modelAr, width: 14 },
  { key: 'modelYear', ar: 'الموديل', en: 'Year', get: (v) => v.modelYear, width: 10 },
  { key: 'colorAr', ar: 'اللون', en: 'Colour', get: (v) => v.colorAr, width: 10 },
  { key: 'sectorAr', ar: 'القطاع', en: 'Sector', get: (v) => v.sectorAr, width: 16 },
  { key: 'departmentAr', ar: 'الإدارة', en: 'Department', get: (v) => v.departmentAr, width: 18 },
  { key: 'cityAr', ar: 'المدينة', en: 'City', get: (v) => v.cityAr, width: 14 },
  { key: 'ownerNameAr', ar: 'المالك', en: 'Owner', get: (v) => v.ownerNameAr, width: 26 },
];
