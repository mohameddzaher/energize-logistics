'use client';
// Vehicle register list: multiple filters, search, per-vehicle status, edit/add/delete.
import B2cOpBadge from '@/components/b2c/B2cOpBadge';
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { syncUrl } from '@/lib/urlSync';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { VReg, statusColor, statusLabel, fmtDate, canEditVehicles, canAdminVehicles, fromHijri, toHijriPlain } from '@/lib/vehicleRegistry';
import { REGISTRY_COLUMNS, BASE_COLUMN_KEYS } from '@/lib/vehicleColumns';
import { withHijri } from '@/utils/exportExcel';
import { canEditSection } from '@/lib/sections';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import ManagedSelect from '@/components/system/ManagedSelect';
import PersonLookup from '@/components/vehicles/PersonLookup';
// The same question is asked here and in every family page form, so it has one definition. See components/vehicles/ReqToggle.
import { ReqToggle } from '@/components/vehicles/ReqToggle';
import { LEAD, LEAD_CELL, LEAD_2, useLeadOffset } from '@/components/vehicles/stickyLead';
import { Car, Plus, Edit, Trash2, BarChart3, CalendarClock, X, Save, ArrowRight, Columns3, Check } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
// Every date has two calendars: papers are issued in Hijri and typing a hand conversion invites errors. Gregorian is stored; Hijri is an input and display layer.
import HijriGregorianField from '@/components/vehicles/HijriGregorianField';
import PersonSelect from '@/components/system/PersonSelect';

const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];


function VehicleRegistryListInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const { notify, confirm } = useDialog();
  // An edit grant on vehicles has to bring the actions with it: the API already accepts the calls, so hiding the buttons only made the section look read-only.
  const grant = canEditSection((user as any)?.permissions, 'Vehicles');
  const canEdit = canEditVehicles(user);
  const canDelete = canAdminVehicles(user);

  const [rows, setRows] = useState<VReg[]>([]);
  // Excel-style column filter: the value is read with the same expression the cell renders, so what is filtered is what is seen. See components/useColumnFilters.
  const cf = useColumnFilters<VReg>();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp?.get('q') || '');
  const [editing, setEditing] = useState<VReg | null>(null);
  const [showForm, setShowForm] = useState(false);
  // The table carries every column and shows the chosen ones; 47 always-open columns force endless horizontal scrolling. The choice persists in the browser.
  const [visibleCols, setVisibleCols] = useState<string[]>(BASE_COLUMN_KEYS);
  const [colsOpen, setColsOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vreg:cols');
      if (saved) { const a = JSON.parse(saved); if (Array.isArray(a) && a.length) setVisibleCols(a); }
    } catch { /* Display preference, not a condition */ }
  }, []);
  const toggleCol = (key: string) => setVisibleCols((prev) => {
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    try { localStorage.setItem('vreg:cols', JSON.stringify(next)); } catch { /* Preference, not a condition */ }
    return next;
  });
  const setColsAll = (on: boolean) => {
    const next = on ? REGISTRY_COLUMNS.map((c) => c.key) : BASE_COLUMN_KEYS;
    setVisibleCols(next);
    try { localStorage.setItem('vreg:cols', JSON.stringify(next)); } catch { /* Preference, not a condition */ }
  };
  const shownCols = useMemo(() => REGISTRY_COLUMNS.filter((c) => visibleCols.includes(c.key)), [visibleCols]);

  // The panel is first in the table, but export order is untouched. REGISTRY_COLUMNS order is the required report order, compared column by column with earlier files.
  // On screen the plate is the row identity, so it is drawn first in the table only.
  const plateCol = useMemo(() => shownCols.find((c) => c.key === 'plateNumber') || null, [shownCols]);
  const restCols = useMemo(() => shownCols.filter((c) => c.key !== 'plateNumber'), [shownCols]);
  const lead = useLeadOffset();
  const hasLead = canEdit || canDelete;

  // All header filters pass to the server as they are. A named whitelist silently dropped any filter outside it (city, department, authorized person, expiry range) so a clicked number opened a different list.
  const UI_ONLY = ['limit', 'page'];
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => k !== 'q' && !UI_ONLY.includes(k))));

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    p.set('limit', '2000');
    return p.toString();
  }, [q, JSON.stringify(filters)]);

  // Ignore stale responses: the slower all-vehicles reply starts first and would overwrite the search result. See hooks/useLatestRequest.
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ vehicles: VReg[]; total: number }>(`/api/vehicle-registry?${qs}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.vehicles || []); setTotal(d.total || 0);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally {
      if (guard.isCurrent(mine)) setLoading(false);
    }
  }, [qs, notify, guard]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  // Selections live in the URL so back/forward works and a page refresh keeps what was built.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    syncUrl('/system/vehicles/registry', p);
  }, [q, JSON.stringify(filters)]);

  /** Back to the overview carrying the current filter instead of dropping it. */
  const backToOverview = () => {
    const p = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.push(`/system/vehicles/registry/overview${p ? `?${p}` : ''}`);
  };
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // Readable names for filters that do not come from the server; otherwise the chip shows its code key.
  const EXTRA_LABELS: Record<string, { ar: string; en: string; values?: Record<string, { ar: string; en: string }> }> = {
    missing: { ar: 'ينقصها بيانات', en: 'Missing data', values: { 1: { ar: 'ينقصها بيانات', en: 'Missing data' } } },
    logistiGaps: { ar: 'نواقص لوجستي', en: 'Logisti gaps', values: {
      1: { ar: 'ينقصها شرط لوجستي', en: 'Has Logisti gaps' }, 0: { ar: 'مستوفية شروط لوجستي', en: 'Logisti complete' } } },
    hasGps: { ar: 'التتبّع', en: 'GPS', values: { 1: { ar: 'عليها جهاز تتبّع', en: 'With GPS' } } },
    missingDoc: { ar: 'بدون مستند', en: 'Missing document' },
    missingDocDate: { ar: 'بلا تاريخ انتهاء', en: 'No expiry date' },
    expiringDoc: { ar: 'قارب انتهاؤه', en: 'Expiring' },
    expiredDoc: { ar: 'منتهٍ', en: 'Expired' },
    expiryDoc: { ar: 'المستند', en: 'Document' },
    expiryFrom: { ar: 'الانتهاء من', en: 'Expiry from' },
    expiryTo: { ar: 'الانتهاء إلى', en: 'Expiry to' },
    yearFrom: { ar: 'سنة الصنع من', en: 'Year from' },
    yearTo: { ar: 'سنة الصنع إلى', en: 'Year to' },
    missingItem: { ar: 'البند الناقص', en: 'Missing item' },
    missingReason: { ar: 'سبب النقص', en: 'Missing reason' },
    logistiGap: { ar: 'شرط لوجستي', en: 'Logisti requirement' },
    insurancePolicy: { ar: 'وثيقة التأمين', en: 'Policy' },
  };

  // Export columns: the table columns plus fields asked about off-screen. Document dates are built from the same DOC_TYPES the server builds states from.
  // Applied last, above search and filters, as Excel does; the filter reads the cell with the same expression it renders. See vehicleColumns.
  const GETTERS = useMemo(
    () => Object.fromEntries(REGISTRY_COLUMNS.map((c) => [c.key, c.get])) as Record<string, (v: VReg) => any>,
    [],
  );
  const shownRows = cf.apply(rows, GETTERS);

  // Export columns equal the table columns: one definition in lib/vehicleColumns serves both. withHijri adds a Hijri column after each Gregorian date, except where the paper already carries a Hijri value (license and inspection).
  const toExport = useCallback((list: typeof REGISTRY_COLUMNS): ExportColumn[] => withHijri(
    list.map((c): ExportColumn => ({
      header: ar ? c.ar : c.en,
      key: c.key,
      width: c.width,
      type: c.type,
      transform: (_v, row: any) => {
        // The Hijri column exports its Gregorian date so it is a real date cell displayed as Hijri, not General-type text. See VCol.raw.
        const val = c.raw ? c.raw(row) : c.get(row);
        return val === null || val === undefined ? '' : val;
      },
    })),
  ), [ar]);

  // Export what is shown, rows and columns: the filter picks rows, the columns button picks columns. The all option stays every row and every column.
  const shownExportCols = useMemo(() => toExport(shownCols), [toExport, shownCols]);
  const allExportCols = useMemo(() => toExport(REGISTRY_COLUMNS), [toExport]);

  const del = async (v: VReg) => {
    if (!(await confirm(ar ? `حذف المركبة ${v.plateNumber}؟` : `Delete ${v.plateNumber}?`))) return;
    try { await api.delete(`/api/vehicle-registry/${v._id}`); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); load(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={backToOverview}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {ar ? 'النظرة الشاملة' : 'Overview'}
      </button>
      <PageHeader icon={<Car className="w-5 h-5" />} title={ar ? 'سجل المركبات' : 'Vehicle Registry'} subtitle={ar ? `${total} مركبة` : `${total} vehicles`}>
        <div className="flex items-center gap-2">
          <Link href="/system/vehicles/registry/dashboard" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><BarChart3 className="w-4 h-4" /> {ar ? 'التحليلات' : 'Analytics'}</Link>
          <Link href="/system/vehicles/registry/expiring" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm"><CalendarClock className="w-4 h-4" /> {ar ? 'الانتهاءات والتجديد' : 'Expiries & Renewals'}</Link>
          {/* Column picker: the table carries every register column; this controls which are shown. */}
          <div className="relative">
            <button onClick={() => setColsOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
              <Columns3 className="w-4 h-4" /> {ar ? 'الأعمدة' : 'Columns'}
              <span className="text-slate-400 tabular-nums">{shownCols.length}/{REGISTRY_COLUMNS.length}</span>
            </button>
            {colsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColsOpen(false)} />
                <div className="absolute z-50 mt-1 end-0 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg p-2">
                  <div className="flex items-center gap-2 px-1 pb-2 border-b border-slate-100">
                    <button onClick={() => setColsAll(true)} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{ar ? 'إظهار الكل' : 'Show all'}</button>
                    <button onClick={() => setColsAll(false)} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{ar ? 'الأساسية فقط' : 'Essentials'}</button>
                  </div>
                  {REGISTRY_COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-[13px]">
                      <input type="checkbox" className="w-4 h-4 accent-[#f37121]" checked={visibleCols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                      <span className="truncate">{ar ? c.ar : c.en}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          {canEdit && <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" /> {ar ? 'إضافة' : 'Add'}</button>}
          <ExportMenu fileName="vehicle-registry" lang={lang as 'ar' | 'en'}
            options={[
              {
                key: 'filtered',
                label: exportScopeLabels(ar).shown,
                hint: ar ? `${shownRows.length} صفًّا · ${shownCols.length} عمودًا` : `${shownRows.length} rows · ${shownCols.length} cols`,
                sheets: [{ name: ar ? 'المركبات' : 'Vehicles', rows: shownRows as any[], columns: shownExportCols }],
              },
              {
                key: 'all', label: exportScopeLabels(ar).all,
                hint: ar ? `كل المركبات · ${REGISTRY_COLUMNS.length} عمودًا` : `all vehicles · ${REGISTRY_COLUMNS.length} cols`,
                // The all export is not built from loaded rows, which are the current filter result capped at 2000.
                resolve: async () => {
                  const d = await api.get<{ vehicles: VReg[] }>('/api/vehicle-registry?limit=5000');
                  return [{ name: ar ? 'المركبات' : 'Vehicles', rows: (d.vehicles || []) as any[], columns: allExportCols }];
                },
              },
            ]} />
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بلوحة/هيكل/مالك/بوليصة…' : 'plate / chassis / owner…'} className="px-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          extraLabels={EXTRA_LABELS}
          resultCount={total}
          resultLabel={ar ? 'المركبات المطابقة' : 'Matching vehicles'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs">
              <tr>
                {/* Actions first and fixed: with 47 columns the edit/delete buttons were at the far end, forcing horizontal scrolling for each row. */}
                {hasLead && (
                  <th ref={lead.ref} className={`${LEAD} bg-slate-900 px-3 py-2.5 text-start font-semibold whitespace-nowrap`}>
                    {ar ? 'إجراءات' : 'Actions'}
                  </th>
                )}
                {/* The plate sits beside them so row identity stays visible while scrolling. */}
                {plateCol && (
                  <th className={`${LEAD_2} bg-slate-900 px-3 py-2.5 text-start font-semibold whitespace-nowrap`}
                    style={{ insetInlineStart: hasLead ? lead.offset : 0 }}>
                    <span className="inline-flex items-center">
                      {ar ? plateCol.ar : plateCol.en}
                      {cf.header(plateCol.key, rows, plateCol.get, ar)}
                    </span>
                  </th>
                )}
                {restCols.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center">
                      {ar ? c.ar : c.en}
                      {cf.header(c.key, rows, c.get, ar)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownRows.map((v) => (
                <tr key={v._id} className="group hover:bg-slate-50">
                  {hasLead && (
                    <td className={`${LEAD_CELL} px-3 py-2`}>
                      <div className="flex items-center gap-1">
                        {canEdit && <button onClick={() => { setEditing(v); setShowForm(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Edit className="w-3.5 h-3.5" /></button>}
                        {canDelete && <button onClick={() => del(v)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  )}
                  {/* The plate opens the vehicle: it is the row key people search by. */}
                  {plateCol && (() => {
                    const text = String(plateCol.get(v) ?? '') || v.plateNumber;
                    return (
                      <td className={`${LEAD_2} px-3 py-2 whitespace-nowrap bg-white group-hover:bg-slate-50`}
                        style={{ insetInlineStart: hasLead ? lead.offset : 0 }}>
                        <Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline font-mono font-semibold">{text}</Link>
                        {/* The rider's leave, suspension or accident status is written in the personnel section. */}
                        {!!(v as any).b2cRider?.opStatus && (
                          <span className="ms-1.5 align-middle"><B2cOpBadge status={(v as any).b2cRider.opStatus} ar={ar} /></span>
                        )}
                        {/* The dot means there is work here; detail is on the vehicle page. */}
                        {!!v.logistiGaps?.length && (
                          <span title={ar ? `ينقصها لمنصّة لوجستي: ${v.logistiGaps.join(' · ')}` : `Logisti gaps: ${v.logistiGaps.join(' · ')}`}
                            className="ms-1.5 inline-block w-1.5 h-1.5 rounded-full bg-violet-500 align-middle" />
                        )}
                      </td>
                    );
                  })()}
                  {restCols.map((c) => {
                    const val = c.get(v);
                    const text = val === null || val === undefined || val === '' ? '' : String(val);
                    // The insurance date carries its status color; it is the most looked-at value.
                    if (c.key === 'insExpiry' && text) {
                      return (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-xs">
                          <span style={{ color: statusColor(v.docStatuses?.insurance?.status || 'none') }}>{fmtDate(v.insurance?.expiryDate)}</span>
                        </td>
                      );
                    }
                    // Days left: negative means expired, near values are flagged.
                    if (c.key.endsWith('Days') && text !== '') {
                      const n = Number(val);
                      const tone = n < 0 ? 'text-red-600 font-semibold' : n <= 30 ? 'text-amber-600 font-semibold' : 'text-slate-500';
                      return <td key={c.key} className={`px-3 py-2 whitespace-nowrap tabular-nums ${tone}`}>{n}</td>;
                    }
                    return (
                      <td key={c.key}
                        className={`px-3 py-2 whitespace-nowrap max-w-[220px] truncate ${c.mono ? 'font-mono text-[12.5px] text-slate-700' : 'text-slate-600'}`}
                        title={text}>
                        {text || <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shownRows.length === 0 && <tr><td colSpan={shownCols.length + (hasLead ? 1 : 0)} className="px-3 py-10 text-center text-slate-500">{ar ? 'لا توجد مركبات مطابقة' : 'No matching vehicles'}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {showForm && <VehicleForm vehicle={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

// L and Card are defined outside the component on purpose. Defined inside VehicleForm they get a new identity each render, so React remounts every input per keystroke: focus is lost, Tab jumps to the page top, and every dropdown refetches /api/lookups.
const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
const L = ({ children }: { children: React.ReactNode }) => <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>;
// Section card: clear title and a frame, instead of a thin line between 36 fields in one grid.
const Card = ({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-slate-50/40">
    <header className="px-4 py-2.5 border-b border-slate-200 bg-white rounded-t-xl flex items-center justify-between gap-3 flex-wrap">
      <p className="text-[13px] font-bold text-slate-800">{title}</p>
      {extra}
    </header>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">{children}</div>
  </section>
);

/** Two empty values are equal: undefined becoming an empty string is not a change. */
const same = (a: any, b: any) => {
  const n = (x: any) => (x === undefined || x === null || x === '' ? '' : JSON.stringify(x));
  return n(a) === n(b);
};
const isPlainObj = (x: any) => !!x && typeof x === 'object' && !Array.isArray(x);

/** Diff between the row as opened and the dialog now, one level deep: fields are top-level or inside a document (insurance.companyAr). The server merges the sub-object, so sending one field is safe. */
const patchOf = (orig: any, cur: any) => {
  const out: Record<string, any> = {};
  for (const k of Object.keys(cur || {})) {
    const a = orig?.[k]; const b = cur[k];
    if (isPlainObj(b)) {
      const sub: Record<string, any> = {};
      for (const sk of Object.keys(b)) if (!same(a?.[sk], b[sk])) sub[sk] = b[sk];
      if (Object.keys(sub).length) out[k] = sub;
    } else if (!same(a, b)) out[k] = b;
  }
  return out;
};

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: VReg | null; onClose: () => void; onSaved: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [f, setF] = useState<any>(vehicle || { plateNumber: '', sectorAr: '', registrationTypeAr: '', ownerCompanyAr: '', brandAr: '', modelAr: '', modelYear: '', colorAr: '', ownerNameAr: '', chassisNumber: '', insurance: {}, operatingCard: {}, vehicleLicense: {}, inspection: {}, fuelCard: {} });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setSub = (o: string, k: string, v: any) => setF((p: any) => ({ ...p, [o]: { ...(p[o] || {}), [k]: v } }));

  /**
   * The two dates follow each other. License and inspection each have a Gregorian field (used for expiry maths) and a Hijri one (as on paper). Typing only Hijri left Gregorian empty and the document read as dateless.
   * Hijri fills Gregorian once readable (fromHijri inverts the browser Umm al-Qura table); the reverse is written too but never overwrites a hand-typed Hijri, since the paper is authoritative and our computation may differ by a day.
   */
  /** What the typed Hijri yields: a Gregorian date, or the reason it cannot. */
  const hijriHint = (text?: string) => {
    const t = String(text || '').trim();
    if (!t) return null;
    const greg = fromHijri(t);
    if (greg) return { ok: true, text: greg };
    // Still incomplete: do not call it invalid while typing.
    if (!/\d.*\D.*\d.*\D.*\d/.test(t)) return null;
    return { ok: false, text: ar ? 'تاريخ غير موجود في التقويم — راجعه' : 'no such date in the calendar' };
  };

  const setHijri = (o: 'vehicleLicense' | 'inspection', text: string) => {
    const greg = fromHijri(text);
    setF((p: any) => ({
      ...p,
      [o]: { ...(p[o] || {}), expiryDateHijri: text, ...(greg ? { expiryDate: greg } : {}) },
    }));
  };
  const setGreg = (o: 'vehicleLicense' | 'inspection', date: string | null) => {
    setF((p: any) => {
      const cur = p[o] || {};
      const hadHijri = String(cur.expiryDateHijri || '').trim();
      // Hijri is filled when empty, never replaced when typed.
      const next = date && !hadHijri ? toHijriPlain(date) : cur.expiryDateHijri;
      return { ...p, [o]: { ...cur, expiryDate: date, expiryDateHijri: next || '' } };
    });
  };

  const save = async () => {
    if (!f.plateNumber?.trim()) { notify(ar ? 'رقم اللوحة مطلوب' : 'Plate required', 'error'); return; }
    // Send only what changed. Sending the whole row overwrote untouched fields with stale values, silently erasing edits made elsewhere while the dialog was open.
    const patch = vehicle ? patchOf(vehicle, f) : f;
    if (vehicle && !Object.keys(patch).length) { notify(ar ? 'لا تغييرات للحفظ' : 'Nothing changed', 'info'); onClose(); return; }
    setSaving(true);
    try {
      if (vehicle) await api.put(`/api/vehicle-registry/${vehicle._id}`, patch);
      else await api.post('/api/vehicle-registry', f);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success'); onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{vehicle ? (ar ? 'تعديل مركبة' : 'Edit vehicle') : (ar ? 'إضافة مركبة' : 'Add vehicle')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        {/* Choice fields are lists, not free text: free text yields variants of one value (three spellings, three filter options, three brands). Lists are managed in section settings and new options added inline are shared. */}
        {/* Sections are cards, not faint lines: a thin divider and gray title made 36 fields blur together. */}
        <div className="space-y-4">
        <Card title={ar ? 'بيانات المركبة' : 'Vehicle'}>
          <div><L>{ar ? 'رقم اللوحة *' : 'Plate *'}</L><input className={inp} value={f.plateNumber} onChange={(e) => set('plateNumber', e.target.value)} /></div>
          <div><L>{ar ? 'رقم الهيكل' : 'Chassis'}</L><input className={inp} value={f.chassisNumber || ''} onChange={(e) => set('chassisNumber', e.target.value)} /></div>
          <div><L>{ar ? 'الرقم التسلسلي' : 'Serial'}</L><input className={inp} value={f.serialNumber || ''} onChange={(e) => set('serialNumber', e.target.value)} /></div>
          <div><L>{ar ? 'القطاع' : 'Sector'}</L><ManagedSelect storeLabel type="vehicle_sector" value={f.sectorAr || ''} onChange={(v) => set('sectorAr', v)} /></div>
          <div><L>{ar ? 'نوع التسجيل' : 'Registration type'}</L><ManagedSelect storeLabel type="vehicle_registration_type" value={f.registrationTypeAr || ''} onChange={(v) => set('registrationTypeAr', v)} /></div>
          {/* Owning company: the group has two companies; the list is managed from reference data so a third needs no code change. */}
          <div><L>{ar ? 'الشركة المالكة' : 'Owning company'}</L><ManagedSelect storeLabel type="vehicle_owner_company" value={f.ownerCompanyAr || ''} onChange={(v) => set('ownerCompanyAr', v)} /></div>
          <div><L>{ar ? 'الماركة' : 'Brand'}</L><ManagedSelect storeLabel type="vehicle_brand" value={f.brandAr || ''} onChange={(v) => set('brandAr', v)} /></div>
          <div><L>{ar ? 'الطراز' : 'Model'}</L><input className={inp} value={f.modelAr || ''} onChange={(e) => set('modelAr', e.target.value)} /></div>
          <div><L>{ar ? 'سنة الصنع' : 'Year'}</L><input type="number" className={inp} value={f.modelYear || ''} onChange={(e) => set('modelYear', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'اللون' : 'Colour'}</L><ManagedSelect storeLabel type="vehicle_color" value={f.colorAr || ''} onChange={(v) => set('colorAr', v)} /></div>
          <div><L>{ar ? 'حالة التشغيل' : 'Service status'}</L><ManagedSelect storeLabel type="vehicle_service_status" value={f.serviceStatusAr || ''} onChange={(v) => set('serviceStatusAr', v)} /></div>
          <div><L>{ar ? 'حالة الحيازة' : 'Possession'}</L><ManagedSelect storeLabel type="vehicle_possession_status" value={f.possessionStatusAr || ''} onChange={(v) => set('possessionStatusAr', v)} /></div>
          <div><L>{ar ? 'الإدارة' : 'Department'}</L><ManagedSelect storeLabel type="vehicle_department" value={f.departmentAr || ''} onChange={(v) => set('departmentAr', v)} /></div>
          <div><L>{ar ? 'المدينة' : 'City'}</L><ManagedSelect storeLabel type="vehicle_city" value={f.cityAr || ''} onChange={(v) => set('cityAr', v)} /></div>
          {/* The owner is searched too: many vehicles are registered under an employee, so search by employee rather than typing a name that does not match their file. */}
          <div className="sm:col-span-2 lg:col-span-3">
            <PersonLookup ar={ar}
              label={ar ? 'ابحث عن المالك (موظف عندنا) فيُملأ اسمه' : 'Find the owner (our employee)'}
              hint={ar ? 'اختياري — المالك قد يكون جهةً لا شخصًا، ويُكتب يدويًّا كما هو.'
                       : 'Optional — the owner may be a company; typing by hand still works.'}
              onPick={(pp) => set('ownerNameAr', pp.name || '')} />
          </div>
          <div><L>{ar ? 'المالك' : 'Owner'}</L><input className={inp} value={f.ownerNameAr || ''} onChange={(e) => set('ownerNameAr', e.target.value)} /></div>
          {/* Commercial register: the number vehicles are grouped and filtered by on the records page; it had no field here, so it could be read but not corrected. */}
          <div><L>{ar ? 'السجل التجاري' : 'Commercial register'}</L><input className={inp} value={f.commercialRegistration || ''} onChange={(e) => set('commercialRegistration', e.target.value)} /></div>
          {/* The done-status is a column in the required report and a condition on the logistics platform; it was readable but not correctable anywhere. */}
          {/* Values come from a list (owner or user), the same list used for possession status. A free field produced near-duplicate values in the column filter. */}
          <div><L>{ar ? 'حالة تم' : 'Tam status'}</L><ManagedSelect storeLabel type="vehicle_possession_status" value={f.tamStatusAr || ''} onChange={(v) => set('tamStatusAr', v)} /></div>
        </Card>

        <Card title={ar ? 'التأمين' : 'Insurance'}
          extra={<ReqToggle ar={ar} label={ar ? 'هل نطلبه؟' : 'Do we need it?'}
            code={f.insurance?.statusCode || ''} onChange={(v) => setSub('insurance', 'statusCode', v)} />}>
          <div><L>{ar ? 'شركة التأمين' : 'Insurer'}</L><ManagedSelect storeLabel type="vehicle_insurance_company" value={f.insurance?.companyAr || ''} onChange={(v) => setSub('insurance', 'companyAr', v)} /></div>
          <div><L>{ar ? 'نوع التغطية' : 'Coverage type'}</L><ManagedSelect storeLabel type="vehicle_coverage_type" value={f.insurance?.coverageTypeAr || ''} onChange={(v) => setSub('insurance', 'coverageTypeAr', v)} /></div>
          <div><L>{ar ? 'رقم الوثيقة' : 'Policy no.'}</L><input className={inp} value={f.insurance?.policyNumber || ''} onChange={(e) => setSub('insurance', 'policyNumber', e.target.value)} /></div>
          <div><L>{ar ? 'تاريخ انتهاء التأمين' : 'Insurance expiry'}</L><HijriGregorianField value={(f.insurance?.expiryDate || '').slice(0, 10)} onChange={(v) => setSub('insurance', 'expiryDate', v || null)} ar={ar} inp={inp} /></div>
          <div><L>{ar ? 'قسط التأمين' : 'Premium'}</L><input type="number" className={inp} value={f.insurance?.premiumSar || ''} onChange={(e) => setSub('insurance', 'premiumSar', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><L>{ar ? 'حالة القسط' : 'Premium status'}</L><ManagedSelect storeLabel type="vehicle_premium_status" value={f.insurance?.premiumStatusAr || ''} onChange={(v) => setSub('insurance', 'premiumStatusAr', v)} /></div>

        </Card>

        <Card title={ar ? 'المستندات' : 'Documents'}>
          {/* Three documents in one card, each with its own page and work slice, so one header question is not enough. */}
          <div className="md:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 -mt-1 mb-1">
            <ReqToggle ar={ar} label={ar ? 'بطاقة التشغيل' : 'Operating card'}
              code={f.operatingCard?.statusCode || ''} onChange={(v) => setSub('operatingCard', 'statusCode', v)} />
            <ReqToggle ar={ar} label={ar ? 'رخصة السير' : 'Licence'}
              code={f.vehicleLicense?.statusCode || ''} onChange={(v) => setSub('vehicleLicense', 'statusCode', v)} />
            <ReqToggle ar={ar} label={ar ? 'الفحص الدوري' : 'Inspection'}
              code={f.inspection?.statusCode || ''} onChange={(v) => setSub('inspection', 'statusCode', v)} />
          </div>
          <div><L>{ar ? 'رقم بطاقة التشغيل' : 'Operating card no.'}</L><input className={inp} value={f.operatingCard?.cardNumber || ''} onChange={(e) => setSub('operatingCard', 'cardNumber', e.target.value)} /></div>
          <div><L>{ar ? 'انتهاء بطاقة التشغيل' : 'Operating card expiry'}</L><HijriGregorianField value={(f.operatingCard?.expiryDate || '').slice(0, 10)} onChange={(v) => setSub('operatingCard', 'expiryDate', v || null)} ar={ar} inp={inp} /></div>
          <div><L>{ar ? 'انتهاء رخصة السير' : 'Licence expiry'}</L><HijriGregorianField value={(f.vehicleLicense?.expiryDate || '').slice(0, 10)} onChange={(v) => setGreg('vehicleLicense', v || null)} ar={ar} inp={inp} /></div>
          <div><L>{ar ? 'حالة الفحص' : 'Inspection status'}</L><ManagedSelect storeLabel type="vehicle_inspection_status" value={f.inspection?.statusAr || ''} onChange={(v) => setSub('inspection', 'statusAr', v)} /></div>
          <div><L>{ar ? 'انتهاء الفحص' : 'Inspection expiry'}</L><HijriGregorianField value={(f.inspection?.expiryDate || '').slice(0, 10)} onChange={(v) => setGreg('inspection', v || null)} ar={ar} inp={inp} /></div>
          {/* The Hijri date written on paper is stored as is, not computed: the paper is authoritative and our computation may differ by a day. The computed value remains for export. */}
          <div><L>{ar ? 'انتهاء رخصة السير (هجري)' : 'Licence expiry (Hijri)'}</L><input className={inp} placeholder="1447/07/22"
            value={f.vehicleLicense?.expiryDateHijri || ''} onChange={(e) => setHijri('vehicleLicense', e.target.value)} />
            {/* The effect shows while typing: the Gregorian value filled, or why it was not. */}
            {(() => { const h = hijriHint(f.vehicleLicense?.expiryDateHijri); return h ? (
              <p className={`mt-1 text-[11px] ${h.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {h.ok ? (ar ? `الميلادي: ${h.text}` : `Gregorian: ${h.text}`) : h.text}
              </p>) : null; })()}
          </div>
          <div><L>{ar ? 'انتهاء الفحص (هجري)' : 'Inspection expiry (Hijri)'}</L><input className={inp} placeholder="1447/07/22"
            value={f.inspection?.expiryDateHijri || ''} onChange={(e) => setHijri('inspection', e.target.value)} />
            {/* The effect shows while typing: the Gregorian value filled, or why it was not. */}
            {(() => { const h = hijriHint(f.inspection?.expiryDateHijri); return h ? (
              <p className={`mt-1 text-[11px] ${h.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {h.ok ? (ar ? `الميلادي: ${h.text}` : `Gregorian: ${h.text}`) : h.text}
              </p>) : null; })()}
          </div>

        </Card>

        {/* Fuel and tracking are separate. The fuel card account never expires or renews, while a tracking subscription has expiry, alert, renewal and its own page. Merging them made marking not required apply to tracking only. */}
        <Card title={ar ? 'شريحة الوقود — بترو اب' : 'Fuel card — Petro App'}
          extra={<ReqToggle ar={ar} label={ar ? 'شريحة الوقود' : 'Fuel card'}
            code={f.fuelCard?.statusCode || ''} onChange={(v) => setSub('fuelCard', 'statusCode', v)} />}>
          <div><L>{ar ? 'مزوّد شريحة الوقود' : 'Fuel provider'}</L><ManagedSelect storeLabel type="vehicle_fuel_provider" value={f.fuelCard?.provider || ''} onChange={(v) => setSub('fuelCard', 'provider', v)} /></div>
          <div><L>{ar ? 'رقم شريحة الوقود' : 'Fuel card no.'}</L><input className={inp} value={f.fuelCard?.cardNumber || ''} onChange={(e) => setSub('fuelCard', 'cardNumber', e.target.value)} /></div>
          <div><L>{ar ? 'حالة الشريحة' : 'Card status'}</L><ManagedSelect storeLabel type="vehicle_fuel_card_status" value={f.fuelCard?.statusAr || ''} onChange={(v) => setSub('fuelCard', 'statusAr', v)} /></div>
          <div><L>{ar ? 'نوع الاستهلاك' : 'Consumption type'}</L><ManagedSelect storeLabel type="vehicle_consumption_type" value={f.fuelCard?.consumptionTypeAr || ''} onChange={(v) => setSub('fuelCard', 'consumptionTypeAr', v)} /></div>
          {/* Fields previously editable only on the fuel-card page (consumption limit, plate on invoice) are editable here too, since this page opens everything. */}
          <div><L>{ar ? 'رقم اللوحة في فاتورة بترو اب' : 'Plate on Petro App invoice'}</L><input className={inp} value={f.fuelCard?.plateOnInvoiceAr || ''} onChange={(e) => setSub('fuelCard', 'plateOnInvoiceAr', e.target.value)} /></div>
          <div><L>{ar ? 'حد الاستهلاك (ر.س)' : 'Consumption limit (SAR)'}</L><input type="number" className={inp} value={f.fuelCard?.limitSar ?? ''} onChange={(e) => setSub('fuelCard', 'limitSar', e.target.value ? Number(e.target.value) : null)} /></div>
          {/* Open is a marker, not a number: zero means spending forbidden, empty means unknown. */}
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="w-4 h-4 accent-[#f37121]"
                checked={f.fuelCard?.limitStatus === 'open'}
                onChange={(e) => setSub('fuelCard', 'limitStatus', e.target.checked ? 'open' : '')} />
              {ar ? 'مفتوح — بلا سقف صرف' : 'Open — no spending ceiling'}
            </label>
          </div>
        </Card>

        <Card title={ar ? 'التتبّع — GPS' : 'Tracking — GPS'}
          extra={<ReqToggle ar={ar} label={ar ? 'اشتراك التتبّع' : 'Tracking subscription'}
            code={f.gps?.statusCode || ''} onChange={(v) => setSub('gps', 'statusCode', v)} />}>
          <div><L>{ar ? 'رقم جهاز GPS' : 'GPS device id'}</L><input className={inp} value={f.gps?.deviceId || ''} onChange={(e) => setSub('gps', 'deviceId', e.target.value)} /></div>
          <div><L>{ar ? 'رقم الشريحة (SIM)' : 'SIM number'}</L><input className={inp} value={f.gps?.simNumber || ''} onChange={(e) => setSub('gps', 'simNumber', e.target.value)} /></div>
          <div><L>{ar ? 'شركة الـGPS' : 'GPS provider'}</L><ManagedSelect storeLabel type="vehicle_gps_provider" value={f.gps?.provider || ''} onChange={(v) => setSub('gps', 'provider', v)} /></div>
          <div><L>{ar ? 'جهاز GPS' : 'GPS device'}</L><ManagedSelect storeLabel type="vehicle_gps_device" value={f.gps?.deviceModel || ''} onChange={(v) => setSub('gps', 'deviceModel', v)} /></div>
          <div><L>{ar ? 'سريال GPS' : 'GPS serial'}</L><input className={inp} value={f.gps?.serialImei || ''} onChange={(e) => setSub('gps', 'serialImei', e.target.value)} /></div>
          {/* Device status differs from subscription status: a stolen device can have a valid subscription, and an expired subscription does not mean the device was removed. */}
          <div><L>{ar ? 'حالة جهاز GPS' : 'GPS device status'}</L><ManagedSelect storeLabel type="vehicle_gps_device_status" value={f.gps?.deviceStatusAr || ''} onChange={(v) => setSub('gps', 'deviceStatusAr', v)} /></div>
          <div><L>{ar ? 'انتهاء اشتراك GPS' : 'GPS expiry'}</L><HijriGregorianField value={(f.gps?.expiryDate || '').slice(0, 10)} onChange={(v) => setSub('gps', 'expiryDate', v || null)} ar={ar} inp={inp} /></div>
        </Card>

        <Card title={ar ? 'التفويض بالقيادة' : 'Driving authorisation'}
          extra={<ReqToggle ar={ar} label={ar ? 'هل نطلبه؟' : 'Do we need it?'}
            code={f.authorizedPerson?.statusCode || ''} onChange={(v) => setSub('authorizedPerson', 'statusCode', v)} />}>
          {/* The authorized person is picked from employees; residence and phone come from the employee file. */}
          <div><L>{ar ? 'اسم المفوَّض' : 'Authorised person'}</L>
            <PersonSelect endpoint="/api/vehicle-registry/people" ar={ar} clearLabel={ar ? 'بلا تفويض' : 'No authorisation'}
              idNumber={f.authorizedPerson?.iqamaNumber || ''} name={f.authorizedPerson?.name || ''}
              onChange={(p) => setF((prev: any) => ({
                ...prev,
                authorizedPerson: {
                  ...(prev.authorizedPerson || {}), name: p?.name || '', iqamaNumber: p?.idNumber || '', phone: p?.phone || '',
                  jobTitleAr: prev.authorizedPerson?.jobTitleAr || p?.jobTitleAr || '',
                },
              }))} />
          </div>
          <div><L>{ar ? 'الوظيفة' : 'Job title'}</L><ManagedSelect storeLabel type="vehicle_job_title" value={f.authorizedPerson?.jobTitleAr || ''} onChange={(v) => setSub('authorizedPerson', 'jobTitleAr', v)} /></div>
          <div><L>{ar ? 'رقم الإقامة' : 'Iqama number'}</L><input className={`${inp} bg-slate-50 text-slate-500`} readOnly tabIndex={-1} value={f.authorizedPerson?.iqamaNumber || ''} /></div>
          <div><L>{ar ? 'رقم التفويض' : 'Authorisation no.'}</L><input className={inp} value={f.authorizedPerson?.authorizationNumber || ''} onChange={(e) => setSub('authorizedPerson', 'authorizationNumber', e.target.value)} /></div>
          <div><L>{ar ? 'بداية التفويض' : 'Auth. start'}</L><HijriGregorianField value={(f.authorizedPerson?.startDate || '').slice(0, 10)} onChange={(v) => setSub('authorizedPerson', 'startDate', v || null)} ar={ar} inp={inp} /></div>
          <div><L>{ar ? 'نهاية التفويض' : 'Auth. expiry'}</L><HijriGregorianField value={(f.authorizedPerson?.expiryDate || '').slice(0, 10)} onChange={(v) => setSub('authorizedPerson', 'expiryDate', v || null)} ar={ar} inp={inp} /></div>

        </Card>

        <Card title={ar ? 'ملاحظات' : 'Notes'}>
          <div className="md:col-span-2"><textarea className={inp} rows={2} value={f.notesAr || ''} onChange={(e) => set('notesAr', e.target.value)} /></div>
        </Card>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm disabled:opacity-60"><Save className="w-4 h-4" /> {ar ? 'حفظ' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the Next router. The page only survived because the section shell returns before content during prerender.
// Table columns and their readers live in lib/vehicleColumns: one definition for table, filter and export.

export default function VehicleRegistryList() {
  return <Suspense fallback={<Spinner />}><VehicleRegistryListInner /></Suspense>;
}
