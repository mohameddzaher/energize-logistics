'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Laptop, Plus, Edit, Undo2, Trash2, Check, Boxes, ArrowLeftRight, AlertTriangle, History, ClipboardCheck, BadgeDollarSign } from 'lucide-react';
import ManagedSelect from '@/components/system/ManagedSelect';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, StatCard, Loader2,
} from '@/components/hr/HRKit';
import { useAssetVocab } from '@/hooks/useAssetVocab';
import {
  canViewIt, CustodyItem, StockItem, EmployeeRef, CustodyCounts, CustodyListResponse,
  CUSTODY_TYPES, CUSTODY_STATUSES, CUSTODY_BUCKETS, OTHER_BUCKET_TYPES, bucketOf,
  custodyStatusLabel, deriveAssetName, empName, fmtDate, fmtMoney, today, idOf,
  CUSTODY_ACTION_LABEL,
} from '@/lib/it';
import { CustodyCards, CustodyStateButtons } from '@/components/it/CustodyOverview';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters } from '@/hooks/useColumnFilters';

// No `name` or `model`: the name is derived on the server from type and brand, and model was dropped because it was left empty in most rows.
const EMPTY = {
  employee: '', type: 'laptop', serialNumber: '', brand: '',
  specs: '', condition: 'good', value: 0, assignedDate: '', notes: '',
};

// Bilingual names for the AssetEvent actions live in lib/it (shared with the custody log).
const ACTION_LABEL = CUSTODY_ACTION_LABEL;

export default function ItCustodyPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);
  // Types and conditions are editable from Settings, Reference Data. No itTypes here: the type is chosen from the five categories, not the detailed type list, and the categories are fixed in lib/it.ts since they are a display layer, not vocabulary.
  const { conditions, typeLabel: custodyTypeLabel, conditionLabel } = useAssetVocab();

  const [items, setItems] = useState<CustodyItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // All filters go to the server, which returns each card and button count computed on the same filtered set. The screen used to load the whole register and compute totals on it while the table below was filtered, so pressing "warehouse" changed the rows and left the laptops card at 68 over six rows: a number that does not describe what is under it.
  const [counts, setCounts] = useState<CustodyCounts | null>(null);
  const [register, setRegister] = useState({ total: 0, assigned: 0 });
  const [bucket, setBucket] = useState('');
  const [otherType, setOtherType] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CustodyItem | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // Two ways to hand something out: take it off the warehouse shelf (which
  // keeps one document per physical device), or type in a device that was never
  // stocked. Stock is the better habit, so it is the default mode.
  const [createMode, setCreateMode] = useState<'stock' | 'new'>('stock');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [pickedStockId, setPickedStockId] = useState('');

  // Return flow needs a condition, so it gets its own small modal rather than a
  // prompt() — the condition is what HR later disputes.
  const [returning, setReturning] = useState<CustodyItem | null>(null);
  const [returnForm, setReturnForm] = useState({ returnedCondition: 'good', returnedDate: '', retire: false });

  // Transfer A → B without the device passing through the store.
  const [transferring, setTransferring] = useState<CustodyItem | null>(null);
  const [transferForm, setTransferForm] = useState({ toEmployee: '', date: '', condition: 'good', notes: '' });

  // Damaged is one action, previously two buttons: "report damaged" wrote a report and left the item in the employee's custody, and "convert to damaged" moved the state with no reason or deduction. The merged one does both. Selling an item from custody: the employee buys what is in his custody and pays accounts. The buyer is either an employee from the list or a free name for someone outside the company, one not both, and the server rejects if neither is given. See sellCustody.
  const [selling, setSelling] = useState<CustodyItem | null>(null);
  const [sellForm, setSellForm] = useState({ employee: '', buyerName: '', price: 0, date: '', notes: '' });
  // Return a sold item: the sale is cancelled and the price refunded, so the same device returns to the shelf with its history. See unsellCustody.
  const [unselling, setUnselling] = useState<CustodyItem | null>(null);
  const [unsellForm, setUnsellForm] = useState({ refund: 0, date: '', notes: '' });
  const [faulty, setFaulty] = useState<CustodyItem | null>(null);
  const [faultyForm, setFaultyForm] = useState<{ kind: 'damaged' | 'lost'; notes: string; cost: number; date: string }>({ kind: 'damaged', notes: '', cost: 0, date: '' });

  // One item's movement trail.
  const [historyOf, setHistoryOf] = useState<CustodyItem | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  // The handover desk: an employee brings gear back, we tick off what arrived
  // and the rest stays on them.
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverEmployee, setHandoverEmployee] = useState('');
  const [handoverHeld, setHandoverHeld] = useState<CustodyItem[]>([]);
  const [handoverPicked, setHandoverPicked] = useState<string[]>([]);
  // `outcome`: to stock, damaged, or sold to the same employee. See handoverCustody.
  const [handoverForm, setHandoverForm] = useState<{
    date: string; condition: string; notes: string; retire: boolean;
    outcome: 'stock' | 'faulty' | 'sold'; price: number;
  }>({ date: '', condition: 'good', notes: '', retire: false, outcome: 'stock', price: 0 });
  const [handoverLoading, setHandoverLoading] = useState(false);

  // The dashboard opens this page on a specific card or button, so the initial state arrives from the URL.
  const params = useSearchParams();
  useEffect(() => {
    const b = params?.get('bucket'); if (b) setBucket(b);
    const ot = params?.get('otherType'); if (ot) setOtherType(ot);
    const st = params?.get('status'); if (st) setStateFilter(st);
    const c = params?.get('condition'); if (c) setConditionFilter(c);
  }, [params]);

  // Without debouncing, typing fires a request per character. Search is now on the server because counts are computed there with it; a screen-only search would make counts describe a different set than the table.
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // `scope=all` includes the warehouse: the warehouse button and each category card must count stock too, otherwise the screen shows totals missing a third of the register.
  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ scope: 'all' });
      if (bucket) qs.set('bucket', bucket);
      // The detailed type has no meaning outside the "other" bucket.
      if (bucket === 'other' && otherType) qs.set('otherType', otherType);
      if (stateFilter) qs.set('status', stateFilter);
      if (conditionFilter) qs.set('condition', conditionFilter);
      if (searchQuery) qs.set('q', searchQuery);
      const d = await api.get<CustodyListResponse>(`/api/it/custody?${qs.toString()}`);
      setItems(d.items || []);
      setCounts(d.counts || null);
      if (d.register) setRegister(d.register);
    } catch {}
    setLoading(false);
  }, [bucket, otherType, stateFilter, conditionFilter, searchQuery]);

  // What is currently on the shelf and therefore assignable from this page.
  const loadStock = useCallback(async () => {
    try {
      const d = await api.get<{ items: StockItem[] }>('/api/it/stock');
      setStock(d.items || []);
    } catch {}
  }, []);

  const refresh = useCallback(() => { load(); loadStock(); }, [load, loadStock]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStock(); }, [loadStock]);
  useSocket('hr:asset', useCallback(() => refresh(), [refresh]));
  useSocket('it:updated', useCallback(() => refresh(), [refresh]));

  // /api/hr/employees is restricted to HR roles, so IT reads the employee list
  // from its own endpoint instead.
  useEffect(() => {
    api.get<{ employees: EmployeeRef[] }>('/api/it/employees')
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // Category is derived from the saved type, not stored beside it: two values for one thing diverge.
  const formBucket = bucketOf(form.type);
  const derivedName = deriveAssetName(form.type, form.brand);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, assignedDate: today() });
    // Fall straight to manual entry when the shelf is empty — offering an empty
    // dropdown as the default would just be a dead end.
    setCreateMode(stock.length ? 'stock' : 'new');
    setPickedStockId('');
    setShowModal(true);
  };

  const openEdit = (a: CustodyItem) => {
    setEditing(a);
    setForm({ ...EMPTY, ...a, employee: idOf(a.employee) });
    setShowModal(true);
  };

  // Editing always takes the plain custody path; creating branches on the mode.
  const canSave = editing
    ? !!form.employee && !!form.type
    : createMode === 'stock'
      ? !!form.employee && !!pickedStockId
      : !!form.employee && !!form.type;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/it/custody/${editing._id}`, form);
      } else if (createMode === 'stock') {
        // The same document leaves the shelf and lands on the employee; the device keeps its serial and whole history. No `condition`: the item carries its condition from the warehouse, and asking again here gives two truths for one thing with no way to tell which is right.
        await api.post(`/api/it/stock/${pickedStockId}/assign`, {
          employee: form.employee,
          assignedDate: form.assignedDate,
          notes: form.notes,
        });
      } else {
        await api.post('/api/it/custody', form);
      }
      setShowModal(false); refresh();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openReturn = (a: CustodyItem) => {
    setReturning(a);
    setReturnForm({ returnedCondition: a.condition || 'good', returnedDate: today(), retire: false });
  };

  const doReturn = async () => {
    if (!returning) return;
    setSaving(true);
    try { await api.post(`/api/it/custody/${returning._id}/return`, returnForm); setReturning(null); refresh(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (a: CustodyItem) => {
    if (!(await confirm(ar ? 'حذف هذه العهدة؟' : 'Delete this custody item?'))) return;
    try { await api.delete(`/api/it/custody/${a._id}`); refresh(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const openTransfer = (a: CustodyItem) => {
    setTransferring(a);
    setTransferForm({ toEmployee: '', date: today(), condition: a.condition || 'good', notes: '' });
  };
  const doTransfer = async () => {
    if (!transferring || !transferForm.toEmployee) return;
    setSaving(true);
    try { await api.post(`/api/it/custody/${transferring._id}/transfer`, transferForm); setTransferring(null); refresh(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openSell = (a: CustodyItem) => {
    setSelling(a);
    // The default buyer is the holder: most sales go to whoever already has the item.
    const holder = typeof a.employee === 'object' && a.employee ? String((a.employee as any)._id || '') : '';
    setSellForm({ employee: holder, buyerName: '', price: a.value || 0, date: today(), notes: '' });
  };
  const doSell = async () => {
    if (!selling || (!sellForm.employee && !sellForm.buyerName.trim())) return;
    setSaving(true);
    try {
      await api.post(`/api/it/custody/${selling._id}/sell`, {
        ...sellForm,
        // Both are never sent: if an employee is chosen the free name is ignored, and the reverse.
        employee: sellForm.employee || undefined,
        buyerName: sellForm.employee ? undefined : sellForm.buyerName.trim(),
      });
      setSelling(null); refresh();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openUnsell = (a: CustodyItem) => {
    setUnselling(a);
    // The refund defaults to what was paid and is editable if less was returned.
    setUnsellForm({ refund: a.soldPrice || 0, date: today(), notes: '' });
  };
  const doUnsell = async () => {
    if (!unselling) return;
    setSaving(true);
    try {
      await api.post(`/api/it/custody/${unselling._id}/unsell`, unsellForm);
      setUnselling(null); refresh();
      notify(ar ? 'رجع الصنف إلى المخزن' : 'Item is back in stock', 'success');
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openFaulty = (a: CustodyItem) => {
    setFaulty(a);
    setFaultyForm({ kind: 'damaged', notes: '', cost: 0, date: today() });
  };
  const doFaulty = async () => {
    if (!faulty) return;
    setSaving(true);
    try { await api.post(`/api/it/custody/${faulty._id}/report`, faultyForm); setFaulty(null); refresh(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const openHistory = async (a: CustodyItem) => {
    setHistoryOf(a); setHistory([]);
    try { const d = await api.get<{ events: any[] }>(`/api/it/custody/${a._id}/history`); setHistory(d.events || []); }
    catch {}
  };

  // Handover desk — picking the employee loads exactly what they still hold.
  const openHandover = () => {
    setHandoverOpen(true); setHandoverEmployee(''); setHandoverHeld([]); setHandoverPicked([]);
    setHandoverForm({ date: today(), condition: 'good', notes: '', retire: false, outcome: 'stock', price: 0 });
  };
  const pickHandoverEmployee = async (id: string) => {
    setHandoverEmployee(id); setHandoverPicked([]); setHandoverHeld([]);
    setHandoverForm((f) => ({ ...f, outcome: 'stock', price: 0 }));
    if (!id) return;
    setHandoverLoading(true);
    try {
      const d = await api.get<{ assigned: CustodyItem[] }>(`/api/it/custody/by-employee/${id}`);
      const held = d.assigned || [];
      setHandoverHeld(held);
      // "Handed over his full custody" is the common case. This screen opens because an employee ended service or transferred and hands over everything. Marking item by item took twenty presses for twenty items, and one forgotten item stayed on the employee and blocked his clearance. So all are marked and those only partly received are unticked.
      setHandoverPicked(held.map((i) => i._id));
    } catch {}
    setHandoverLoading(false);
  };
  const toggleHandover = (id: string) =>
    setHandoverPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const doHandover = async () => {
    if (!handoverEmployee || !handoverPicked.length) return;
    setSaving(true);
    try {
      const d = await api.post<{ returned: number; outstanding: any[] }>('/api/it/custody/handover', {
        employee: handoverEmployee, items: handoverPicked, ...handoverForm,
      });
      // Say plainly what is still on them; that is the whole point of the screen. The action is named by its name: "received" differs from "sold", and whoever sold wants to read that.
      const verb = handoverForm.outcome === 'sold' ? (ar ? 'بيع' : 'sold')
        : handoverForm.outcome === 'faulty' ? (ar ? 'سُجّل كتالف' : 'recorded faulty')
        : (ar ? 'استلام' : 'handed back');
      notify(ar
        ? `تم ${verb} ${d.returned} صنف. المتبقي بعهدة الموظف: ${d.outstanding.length} صنف.`
        : `${d.returned} item(s) ${verb}. Still outstanding: ${d.outstanding.length}.`);
      setHandoverOpen(false); refresh();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  // Counts as computed by the server on the same filtered set: each card says exactly how many rows pressing it opens. Deriving them again here is what produced two different numbers for one thing.
  const bucketCounts = counts?.buckets ?? CUSTODY_BUCKETS.map((b) => ({ key: b.key, count: 0 }));
  const stateCounts = counts?.byStatus ?? { assigned: 0, in_stock: 0, returned: 0 };
  // The second filter for the "other" bucket shows only what exists after the other filters; an option with a zero result is not an option.
  const otherKinds = counts?.otherKinds ?? [];

  // Column funnel: values as read in the row, list after the page filter. See hooks/useColumnFilters.
  const cf = useColumnFilters<any>({
    employee: (a) => empName(a.employee, lang),
    item: (a) => a.name || '',
    type: (a) => custodyTypeLabel(a.type, lang),
    serial: (a) => a.serialNumber || '',
    specs: (a) => a.specs || '',
    condition: (a) => (a.condition ? conditionLabel(a.condition, lang) : ''),
    assigned: (a) => fmtDate(a.assignedDate),
    status: (a) => custodyStatusLabel(a.status, lang),
  }, items, ar ? 'ar' : 'en');
  const shown = cf.apply(items);

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  // Status buttons describe the filtered set, while the page header describes the whole register, so it reads from `register` not `stateCounts`; otherwise "custody with employees" would change on a filter click.
  const anyFilter = !!(bucket || stateFilter || conditionFilter || otherType || search.trim());

  const exportColumns: ExportColumn[] = [
    { header: 'Employee', key: 'employee', transform: (v: any) => empName(v, 'en'), width: 24 },
    { header: 'Item', key: 'name', width: 22 },
    { header: 'Type', key: 'type', transform: (v: any) => custodyTypeLabel(v, 'en'), width: 14 },
    { header: 'Serial', key: 'serialNumber', width: 20 },
    { header: 'Brand', key: 'brand', width: 14 },
    { header: 'Specs', key: 'specs', width: 28 },
    { header: 'Condition', key: 'condition', transform: (v: any) => conditionLabel(v, 'en'), width: 12 },
    { header: 'Value (per unit)', key: 'value', width: 14 },
    { header: 'Assigned', key: 'assignedDate', width: 14 },
    { header: 'Status', key: 'status', transform: (v: any) => custodyStatusLabel(v, 'en'), width: 12 },
    // Mobile line details: empty for other items, and all that is asked about it.
    { header: ar ? 'الباقة' : 'Package', key: 'telecom', transform: (v: any) => v?.package || '', width: 22 },
    { header: ar ? 'المزوّد' : 'Provider', key: 'telecom', transform: (v: any) => v?.provider || '', width: 12 },
    { header: ar ? 'الرقم التسلسلي للشريحة' : 'SIM serial', key: 'telecom', transform: (v: any) => v?.iccid || '', width: 24 },
    { header: ar ? 'مدة العقد (شهر)' : 'Contract months', key: 'telecom', transform: (v: any) => (v?.contractMonths ?? ''), width: 14 },
    { header: ar ? 'انتهاء العقد' : 'Contract expiry', key: 'telecom', transform: (v: any) => v?.expiryDate || '', width: 14 },
    { header: ar ? 'المفوَّض لدى المزوّد' : 'Authorised with provider', key: 'telecom', transform: (v: any) => v?.authorizedName || '', width: 26 },
    { header: 'Returned', key: 'returnedDate', width: 14 },
    { header: 'Returned by', key: 'returnedTo', transform: (v: any) => (v && typeof v === 'object' ? [v.firstName, v.lastName].filter(Boolean).join(' ') : ''), width: 20 },
  ];
  // All filtering is on the server without pagination, so memory holds the full filter result. "All" needs a second call without parameters; otherwise exporting the whole register meant clearing filters by hand, exporting, and restoring them.
  const fetchAllForExport = async () => {
    const d = await api.get<CustodyListResponse>('/api/it/custody?scope=all');
    return [{ name: 'Custody', rows: d.items || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = anyFilter
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: 'Custody', rows: items, columns: exportColumns }] },
        { key: 'all', label: scope.all, resolve: fetchAllForExport, hint: String(register.total) },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: 'Custody', rows: items, columns: exportColumns }] }];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Laptop className="w-5 h-5" />}
        title={ar ? 'عهد تقنية المعلومات' : 'IT Custody'}
        subtitle={ar ? `${register.assigned} عهدة بحوزة الموظفين` : `${register.assigned} items currently assigned`}
      >
        <Link href="/system/it/custody-log" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <History className="w-4 h-4" /> {ar ? 'سجل حركة العهد' : 'Custody log'}
        </Link>
        <ExportMenu fileName="it-custody" lang={ar ? 'ar' : 'en'} variant="subtle" options={exportOptions} />
        <button type="button" onClick={openHandover} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <ClipboardCheck className="w-4 h-4" /> {ar ? 'استلام عهدة موظف' : 'Receive from employee'}
        </button>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'تسليم عهدة' : 'Assign item'}</PrimaryButton>
      </PageHeader>

      {/* The five categories with their totals. Pressing filters, pressing again clears. */}
      <CustodyCards
        buckets={bucketCounts}
        active={bucket}
        onPick={(k) => { setBucket(k); setOtherType(''); }}
        lang={lang}
      />

      {/* Second filter: exactly which kind within "other". Shown only when meaningful. */}
      {bucket === 'other' && otherKinds.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'أي نوع من «أخرى»؟' : 'Which kind of "Other"?'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOtherType('')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                otherType === '' ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}>
              {ar ? 'الكل' : 'All'}
            </button>
            {otherKinds.map((k) => (
              <button key={k.key} type="button" onClick={() => setOtherType(otherType === k.key ? '' : k.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  otherType === k.key ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}>
                {custodyTypeLabel(k.key, lang)} <span className="tabular-nums opacity-70">{k.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Where the item is now: in an employee's custody, on the shelf, or damaged. */}
      <CustodyStateButtons byStatus={stateCounts} active={stateFilter} onPick={setStateFilter} lang={lang} />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالجهاز أو الرقم التسلسلي أو الموظف...' : 'Search item, serial or employee...'} />
        </div>
        <div className="w-full sm:w-48 shrink-0">
          <SearchableSelect
            value={conditionFilter} onChange={setConditionFilter}
            searchAfter={0}
            placeholder={ar ? 'كل الحالات الفنية' : 'All conditions'} emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
            options={[{ value: '', label: ar ? 'كل الحالات الفنية' : 'All conditions' }, ...conditions.map((o) => ({ value: o.key, label: ar ? o.ar : o.en }))]}
          />
        </div>
        {anyFilter && (
          <button type="button"
            onClick={() => { setBucket(''); setOtherType(''); setStateFilter(''); setConditionFilter(''); setSearch(''); }}
            className="shrink-0 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">
            {ar ? 'مسح الفلاتر' : 'Clear filters'}
          </button>
        )}
      </div>

      {/* The two numbers sit side by side on purpose: shown describes the table and register total says what it was cut from; without the second nobody knows the filter hid anything. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label={ar ? 'المعروض الآن' : 'Showing'} value={counts?.total ?? items.length} accent="text-slate-900" />
        {/* The register total returns everything: the bigger number is the way back to unfiltered. */}
        <StatCard label={ar ? 'إجمالي السجل' : 'Total register'} value={register.total} accent="text-slate-900"
          onClick={() => { setStateFilter(''); setConditionFilter(''); setBucket(''); setOtherType(''); setSearch(''); }}
          hint={ar ? 'اضغط لعرض الكل' : 'tap to show all'} />
        <StatCard label={ar ? 'قيمة المعروض' : 'Value shown'} value={fmtMoney(counts?.value ?? 0)} accent="text-[#f37121]" />
      </div>

      <ScrollX className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{cf.head('employee', ar ? 'الموظف' : 'Employee')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('item', ar ? 'الجهاز' : 'Item')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('type', ar ? 'النوع' : 'Type')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('serial', ar ? 'الرقم التسلسلي' : 'Serial')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('specs', ar ? 'المواصفات' : 'Specs')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('condition', ar ? 'الحالة الفنية' : 'Condition')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('assigned', ar ? 'تاريخ التسليم' : 'Assigned')}</th>
            <th className="text-start font-semibold px-4 py-3">{cf.head('status', ar ? 'الحالة' : 'Status')}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-slate-500 py-12">{anyFilter
                ? (ar ? 'لا توجد عهد مطابقة للفلتر الحالي.' : 'Nothing matches the current filter.')
                : (ar ? 'لا توجد عهد مسجّلة.' : 'No custody items found.')}</td></tr>
            ) : shown.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(a.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">
                  {a.name}
                  {a.specs && <div className="text-xs text-slate-500 truncate max-w-[180px]" title={a.specs}>{a.specs}</div>}
                </td>
                <td className="px-4 py-3">
                  <SmallBadge bg={CUSTODY_TYPES[a.type]?.bg || 'bg-slate-500/15'} text={CUSTODY_TYPES[a.type]?.text || 'text-slate-700'} label={custodyTypeLabel(a.type, lang)} />
                </td>
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{a.serialNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700 text-xs max-w-[200px] truncate" title={a.specs || ''}>{a.specs || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{a.condition ? conditionLabel(a.condition, lang) : '—'}</td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(a.assignedDate)}</td>
                <td className="px-4 py-3">
                  <SmallBadge
                    bg={CUSTODY_STATUSES[a.status]?.bg || 'bg-slate-500/15'}
                    text={CUSTODY_STATUSES[a.status]?.text || 'text-slate-700'}
                    label={a.status === 'returned' ? `${custodyStatusLabel(a.status, lang)} ${fmtDate(a.returnedDate)}${a.returnedTo && typeof a.returnedTo === 'object' ? ` · ${lang === 'ar' ? 'سجّله' : 'by'} ${[a.returnedTo.firstName, a.returnedTo.lastName].filter(Boolean).join(' ')}` : ''}`
                      // A sold item states its price in the label; "sold" alone leaves the question open.
                      : a.status === 'sold' ? `${custodyStatusLabel(a.status, lang)}${a.soldPrice ? ` · ${a.soldPrice.toLocaleString()}` : ''}`
                      : custodyStatusLabel(a.status, lang)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {a.status === 'assigned' && (<>
                      <button type="button" onClick={() => openReturn(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-green-600 hover:bg-slate-100" title={ar ? 'استرجاع' : 'Return'}><Undo2 className="w-4 h-4" /></button>
                      <button type="button" onClick={() => openTransfer(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'نقل لموظف آخر' : 'Transfer to another employee'}><ArrowLeftRight className="w-4 h-4" /></button>
                    </>)}
                    {/* Damaged: one button, named like the filter button itself. While the item is not yet recorded damaged (whether in custody or on the shelf), this is how to get there. */}
                    {a.status !== 'returned' && a.status !== 'sold' && (
                      <button type="button" onClick={() => openFaulty(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={ar ? 'تالف' : 'Faulty'}><AlertTriangle className="w-4 h-4" /></button>
                    )}
                    {/* Sale: while the item is ours (in custody or on the shelf) this is how it leaves by sale. A sold item cannot be sold twice. */}
                    {/* A sold item's only way back is to the store when its sale is cancelled. */}
                    {a.status === 'sold' && (
                      <button type="button" onClick={() => openUnsell(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-emerald-600 hover:bg-slate-100" title={ar ? 'إرجاع المبيع إلى المخزن' : 'Return sale to store'}><Undo2 className="w-4 h-4" /></button>
                    )}
                    {a.status !== 'sold' && (
                      <button type="button" onClick={() => openSell(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-violet-600 hover:bg-slate-100" title={ar ? 'بيع للموظف' : 'Sell'}><BadgeDollarSign className="w-4 h-4" /></button>
                    )}
                    <button type="button" onClick={() => openHistory(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'سجل الحركة' : 'Movement history'}><History className="w-4 h-4" /></button>
                    <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل العهدة' : 'Edit custody item') : (ar ? 'تسليم عهدة' : 'Assign custody item')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !canSave}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        {/* Two routes to the same outcome: pull a device off the shelf (keeps one
            record per physical device) or type in one that was never stocked. */}
        {!editing && (
          <div className="mb-4 flex gap-2">
            {([
              { key: 'stock', ar: 'من المخزن', en: 'From stock' },
              { key: 'new', ar: 'جديد مباشرة', en: 'Brand new' },
            ] as const).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setCreateMode(m.key)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  createMode === m.key
                    ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {ar ? m.ar : m.en}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الموظف' : 'Employee'} span2>
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v)}
              disabled={!!editing}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((emp) => ({
                value: emp._id,
                label: empName(emp, lang),
                hint: [emp.employeeNumber, emp.department, emp.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          {/* Stock mode identifies the device by picking it; every other detail
              already lives on the record, so re-typing it would only invite
              drift between the shelf and the custody sheet. */}
          {!editing && createMode === 'stock' ? (
            <Field label={ar ? 'الجهاز من المخزن' : 'Item from stock'} span2>
              {stock.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
                  <Boxes className="w-4 h-4 shrink-0" />
                  {ar
                    ? 'المستودع فارغ حالياً — استخدم "جديد مباشرة" أو أضف أصنافاً في صفحة المستودع.'
                    : 'Stock is empty — use "Brand new", or add items on the Stock page.'}
                </div>
              ) : (
                <SearchableSelect
                  value={pickedStockId} onChange={setPickedStockId}
                  placeholder="—"
                  searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم التسلسلي…' : 'Search name or serial…'}
                  options={stock.map((s) => ({
                    value: s._id,
                    label: `${s.name}${s.serialNumber ? ` — ${s.serialNumber}` : ''}`,
                    hint: custodyTypeLabel(s.type, lang),
                  }))}
                />
              )}
            </Field>
          ) : (
            <>
              {/* Type is chosen from the five categories. The name is no longer a field: it is derived from category and brand and shown below as it will be saved. */}
              <Field label={ar ? 'النوع' : 'Type'}>
                <SearchableSelect
                  value={formBucket} searchAfter={0}
                  onChange={(v) => {
                    const b = CUSTODY_BUCKETS.find((x) => x.key === v);
                    set('type', b ? b.canonicalType : 'other');
                  }}
                  options={CUSTODY_BUCKETS.map((b) => ({ value: b.key, label: ar ? b.ar : b.en }))}
                />
              </Field>
              {formBucket === 'other' ? (
                <Field label={ar ? 'أي نوع من «أخرى»؟' : 'Which kind of "Other"?'}>
                  <SearchableSelect
                    value={form.type} onChange={(v) => set('type', v)} searchAfter={0}
                    options={OTHER_BUCKET_TYPES.map((t) => ({ value: t, label: custodyTypeLabel(t, lang) }))}
                  />
                </Field>
              ) : <div className="hidden sm:block" />}
              <Field label={ar ? 'الماركة' : 'Brand'}>
                <TextInput value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} placeholder={ar ? 'مثال: Dell' : 'e.g. Dell'} />
              </Field>
              <Field label={ar ? 'الرقم التسلسلي' : 'Serial number'}>
                <TextInput value={form.serialNumber || ''} onChange={(e) => set('serialNumber', e.target.value)} />
              </Field>
              <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs text-slate-500">{ar ? 'سيُسجَّل باسم' : 'Will be recorded as'}</span>
                <span className="ms-2 text-sm font-semibold text-slate-900">{derivedName}</span>
              </div>
              <Field label={ar ? 'الحالة الفنية' : 'Condition'}>
                <Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                  {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
                </Select>
              </Field>
              <Field label={ar ? 'القيمة للقطعة الواحدة' : 'Value per single unit'}>
                <TextInput type="number" value={form.value ?? 0} onChange={(e) => set('value', Number(e.target.value))} />
              </Field>
              {/* A mobile line is described differently from a computer: no brand, model or specs; it has a plan, a contract with term and expiry date, and a SIM serial (ICCID). Most important is the authorized person: the name registered with the provider on the line, which differs from the person holding it in 22 of 99 lines. Whoever contacts the provider needs the authorized person, not the user. The plan is a managed reference list, not free text, since typing 79 lines by hand gives 79 spellings of two plans. */}
              {form.type === 'sim' && (
                <>
                  <Field label={ar ? 'الباقة' : 'Package'}>
                    <ManagedSelect storeLabel type="telecom_package"
                      value={form.telecom?.package || ''}
                      onChange={(v: string) => set('telecom', { ...(form.telecom || {}), package: v })}
                      placeholder={ar ? 'اختر الباقة…' : 'Select a package…'} />
                  </Field>
                  <Field label={ar ? 'المزوّد' : 'Provider'}>
                    <ManagedSelect storeLabel type="telecom_provider"
                      value={form.telecom?.provider || ''}
                      onChange={(v: string) => set('telecom', { ...(form.telecom || {}), provider: v })}
                      placeholder={ar ? 'اختر المزوّد…' : 'Select a provider…'} />
                  </Field>
                  <Field label={ar ? 'الرقم التسلسلي للشريحة' : 'SIM serial (ICCID)'} span2>
                    <TextInput value={form.telecom?.iccid || ''}
                      onChange={(e) => set('telecom', { ...(form.telecom || {}), iccid: e.target.value })} />
                  </Field>
                  <Field label={ar ? 'مدة العقد (شهر)' : 'Contract (months)'}>
                    <TextInput type="number" min={0} value={form.telecom?.contractMonths ?? ''}
                      onChange={(e) => set('telecom', { ...(form.telecom || {}), contractMonths: e.target.value === '' ? null : Number(e.target.value) })} />
                  </Field>
                  <Field label={ar ? 'تاريخ انتهاء العقد' : 'Contract expiry'}>
                    <TextInput type="date" value={form.telecom?.expiryDate || ''}
                      onChange={(e) => set('telecom', { ...(form.telecom || {}), expiryDate: e.target.value })} />
                  </Field>
                  <Field label={ar ? 'اسم المفوَّض لدى المزوّد' : 'Authorised with the provider'} span2>
                    <TextInput value={form.telecom?.authorizedName || ''}
                      onChange={(e) => set('telecom', { ...(form.telecom || {}), authorizedName: e.target.value })}
                      placeholder={ar ? 'قد يختلف عن المستخدم الحالي' : 'May differ from the current user'} />
                  </Field>
                </>
              )}
              <Field label={ar ? 'المواصفات' : 'Specs'} span2>
                <TextInput value={form.specs || ''} onChange={(e) => set('specs', e.target.value)} placeholder={ar ? 'مثال: i7 / 16GB / 512GB SSD' : 'e.g. i7 / 16GB / 512GB SSD'} />
              </Field>
            </>
          )}
          <Field label={ar ? 'تاريخ التسليم' : 'Assigned date'}>
            <TextInput type="date" value={form.assignedDate || ''} onChange={(e) => set('assignedDate', e.target.value)} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!returning} onClose={() => setReturning(null)}
        title={ar ? 'استرجاع العهدة' : 'Return custody item'}
        footer={<>
          <button type="button" onClick={() => setReturning(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doReturn} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تأكيد الاسترجاع' : 'Confirm return'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {ar ? `استرجاع "${returning?.name}" من ${empName(returning?.employee, lang)}` : `Returning "${returning?.name}" from ${empName(returning?.employee, lang)}`}
          </p>
          <Field label={ar ? 'الحالة عند الاسترجاع' : 'Condition on return'}>
            <Select value={returnForm.returnedCondition} onChange={(e) => setReturnForm({ ...returnForm, returnedCondition: e.target.value })}>
              {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'تاريخ الاسترجاع' : 'Return date'}>
            <TextInput type="date" value={returnForm.returnedDate} onChange={(e) => setReturnForm({ ...returnForm, returnedDate: e.target.value })} />
          </Field>

          {/* Where the device goes next. Most gear is reissued, so back-to-stock
              is the default; retiring is the deliberate, irreversible-feeling
              choice for anything dead or written off. */}
          <Field label={ar ? 'وجهة الجهاز بعد الاسترجاع' : 'Where does it go?'}>
            <div className="flex gap-2">
              {([
                { retire: false, ar: 'رجوع للمخزن', en: 'Back to stock' },
                { retire: true, ar: 'تالف', en: 'Faulty' },
              ] as const).map((o) => (
                <button
                  key={String(o.retire)}
                  type="button"
                  onClick={() => setReturnForm({ ...returnForm, retire: o.retire })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    returnForm.retire === o.retire
                      ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {ar ? o.ar : o.en}
                </button>
              ))}
            </div>
          </Field>

          <p className="text-xs text-slate-500">
            {returnForm.retire
              ? (ar
                ? 'سيُسجَّل الجهاز كتالف ولن يظهر في المستودع.'
                : 'The device is recorded as faulty and will not appear in stock.')
              : (ar
                ? 'سيعود الجهاز إلى المستودع جاهزاً للتسليم لموظف آخر، مع الاحتفاظ بسجله الكامل.'
                : 'The device returns to stock, ready to hand to someone else, keeping its full history.')}
          </p>
        </div>
      </Modal>
      {/* Transfer — the device goes straight to the next person, so both sides
          of the handover are recorded on one event. */}
      {/* Sell an item from custody: the employee buys what he holds and pays accounts. It used to be recorded as "handed over", staying in the owned count after leaving, or its row was deleted so where it went and for how much was lost. It now has its own status, and its row keeps saying to whom, when and for how much. The buyer is one of two, not both: an employee from the list, or a free name for someone outside; choosing an employee disables the free-name field so one buyer never has two names. */}
      {/* Return a sold item to the store. */}
      <Modal open={!!unselling} onClose={() => setUnselling(null)} title={ar ? 'إرجاع المبيع إلى المخزن' : 'Return sale to store'}
        footer={<>
          <button type="button" onClick={() => setUnselling(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doUnsell} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تأكيد الإرجاع' : 'Confirm return'}
          </PrimaryButton>
        </>}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{unselling?.name}</span>
            {unselling?.serialNumber ? <span className="text-slate-400 font-mono text-xs"> · {unselling.serialNumber}</span> : null}
            <span className="text-slate-500"> — {ar ? 'بيع إلى' : 'sold to'} {unselling?.soldTo ? empName(unselling.soldTo as any, lang) : (unselling?.soldToName || '—')}
              {unselling?.soldPrice ? ` · ${unselling.soldPrice.toLocaleString()}` : ''}{unselling?.soldDate ? ` · ${unselling.soldDate}` : ''}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={ar ? 'المبلغ المردود للموظف' : 'Amount refunded'}>
              <input type="number" min={0} value={unsellForm.refund}
                onChange={(e) => setUnsellForm({ ...unsellForm, refund: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" title={ar ? 'المبلغ المردود' : 'Refund'} />
            </Field>
            <Field label={ar ? 'تاريخ الإرجاع' : 'Return date'}>
              <input type="date" value={unsellForm.date}
                onChange={(e) => setUnsellForm({ ...unsellForm, date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" title={ar ? 'تاريخ الإرجاع' : 'Return date'} />
            </Field>
          </div>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <input type="text" value={unsellForm.notes}
              onChange={(e) => setUnsellForm({ ...unsellForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" title={ar ? 'ملاحظات' : 'Notes'} />
          </Field>
          <p className="text-xs text-slate-500 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
            {ar ? 'يرجع الصنف نفسه إلى المخزن بحالة «في المخزن»، ويبقى البيع ثم الإرجاع والمبلغ المردود في سجل حركته.'
              : 'The same item goes back to stock; its history keeps the sale, then this return and the refunded amount.'}
          </p>
        </div>
      </Modal>

      <Modal open={!!selling} onClose={() => setSelling(null)} title={ar ? 'بيع الصنف' : 'Sell item'}
        footer={<>
          <button type="button" onClick={() => setSelling(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doSell} disabled={saving || (!sellForm.employee && !sellForm.buyerName.trim())}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تأكيد البيع' : 'Confirm sale'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{selling?.name}</span>
            {selling?.serialNumber ? <span className="text-slate-400 font-mono text-xs"> · {selling.serialNumber}</span> : null}
            {selling?.employee ? <span className="text-slate-500"> — {ar ? 'بعهدة' : 'held by'} {empName(selling.employee, lang)}</span> : null}
          </p>
          <Field label={ar ? 'المشتري (موظف)' : 'Buyer (employee)'}>
            <SearchableSelect
              value={sellForm.employee}
              onChange={(v) => setSellForm({ ...sellForm, employee: v, buyerName: v ? '' : sellForm.buyerName })}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.department, e.iqamaNumber].filter(Boolean).join(' · '),
              }))} />
          </Field>
          <Field label={ar ? 'أو مشترٍ من خارج الشركة' : 'Or an outside buyer'}>
            <input type="text" value={sellForm.buyerName} disabled={!!sellForm.employee}
              onChange={(e) => setSellForm({ ...sellForm, buyerName: e.target.value })}
              placeholder={ar ? 'اسم المشتري' : 'Buyer name'}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={ar ? 'الثمن المدفوع للحسابات' : 'Price paid to accounting'}>
              <input type="number" min={0} value={sellForm.price}
                onChange={(e) => setSellForm({ ...sellForm, price: Number(e.target.value) })}
                title={ar ? 'الثمن' : 'Price'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </Field>
            <Field label={ar ? 'تاريخ البيع' : 'Sale date'}>
              <input type="date" value={sellForm.date}
                onChange={(e) => setSellForm({ ...sellForm, date: e.target.value })}
                title={ar ? 'تاريخ البيع' : 'Sale date'}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </Field>
          </div>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <input type="text" value={sellForm.notes}
              onChange={(e) => setSellForm({ ...sellForm, notes: e.target.value })}
              placeholder={ar ? 'رقم سند القبض مثلًا' : 'Receipt number, for example'}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </Field>
          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
            {ar ? 'بعد البيع يخرج الصنف من العهدة ومن المخزون معًا، ويبقى صفّه في السجل يقول لمن بيع وبكم ومتى.'
                : 'Once sold, the item leaves both custody and stock, and its row stays in the register recording who bought it, for how much, and when.'}
          </p>
        </div>
      </Modal>

      <Modal open={!!transferring} onClose={() => setTransferring(null)} title={ar ? 'نقل العهدة لموظف آخر' : 'Transfer to another employee'}
        footer={<>
          <button type="button" onClick={() => setTransferring(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doTransfer} disabled={saving || !transferForm.toEmployee}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تأكيد النقل' : 'Confirm transfer'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {ar ? 'الحائز الحالي:' : 'Currently held by:'} <span className="font-semibold text-slate-900">{empName(transferring?.employee, lang)}</span>
            {transferring?.serialNumber ? <span className="text-slate-400 font-mono text-xs"> · {transferring.serialNumber}</span> : null}
          </p>
          <Field label={ar ? 'الموظف الجديد' : 'New holder'}>
            <SearchableSelect
              value={transferForm.toEmployee}
              onChange={(v) => setTransferForm({ ...transferForm, toEmployee: v })}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.department, e.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          <Field label={ar ? 'تاريخ النقل' : 'Transfer date'}>
            <TextInput type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} />
          </Field>
          <Field label={ar ? 'الحالة عند النقل' : 'Condition at transfer'}>
            <Select value={transferForm.condition} onChange={(e) => setTransferForm({ ...transferForm, condition: e.target.value })}>
              {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <TextArea rows={2} value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* Damaged: the action that used to be two buttons. It writes the report with its reason and deduction and moves the item to damaged, so it appears under the filter button of the same name. */}
      <Modal open={!!faulty} onClose={() => setFaulty(null)} title={ar ? 'تالف' : 'Faulty'}
        footer={<>
          <button type="button" onClick={() => setFaulty(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doFaulty} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تسجيل' : 'Record'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {faulty?.name}
            {faulty?.employee ? ` — ${empName(faulty?.employee, lang)}` : ''}
          </p>
          <Field label={ar ? 'ما الذي حدث؟' : 'What happened?'}>
            <Select value={faultyForm.kind} onChange={(e) => setFaultyForm({ ...faultyForm, kind: e.target.value as 'damaged' | 'lost' })}>
              <option value="damaged">{ar ? 'تالف' : 'Damaged'}</option>
              <option value="lost">{ar ? 'مفقود' : 'Lost'}</option>
            </Select>
          </Field>
          <p className="text-xs text-slate-500">
            {faultyForm.kind === 'damaged'
              ? (ar ? 'يخرج الصنف من التداول ويظهر تحت «تالف»، وتصير حالته الفنية «تالف». يبقى اسم من كان يحمله مسجّلاً عليه ولا يُحسب عليه عهدةً قائمة.' : 'The item leaves circulation and appears under "Faulty", with its condition set to damaged. Who was holding it stays on the record, but it no longer counts as outstanding custody.')
              : (ar ? 'يخرج الصنف من التداول لأنه لم يعد موجوداً، ويبقى البلاغ باسم من كان يحمله.' : 'The item leaves circulation because it no longer exists; the report stays under whoever was holding it.')}
          </p>
          <Field label={ar ? 'التاريخ' : 'Date'}>
            <TextInput type="date" value={faultyForm.date} onChange={(e) => setFaultyForm({ ...faultyForm, date: e.target.value })} />
          </Field>
          <Field label={ar ? 'قيمة الخصم (إن وُجد)' : 'Amount charged (if any)'}>
            <TextInput type="number" min={0} value={faultyForm.cost} onChange={(e) => setFaultyForm({ ...faultyForm, cost: Number(e.target.value) })} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <TextArea rows={2} value={faultyForm.notes} onChange={(e) => setFaultyForm({ ...faultyForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* Movement trail for one device. */}
      <Modal open={!!historyOf} onClose={() => setHistoryOf(null)} wide title={ar ? 'سجل حركة الصنف' : 'Item movement history'}
        footer={<button type="button" onClick={() => setHistoryOf(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إغلاق' : 'Close'}</button>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {historyOf?.name}
            {historyOf?.serialNumber ? <span className="text-slate-400 font-mono text-xs"> · {historyOf.serialNumber}</span> : null}
          </p>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">{ar ? 'لا توجد حركات مسجلة لهذا الصنف.' : 'No movements recorded for this item yet.'}</p>
          ) : (
            <ol className="relative border-s border-slate-200 ms-2">
              {history.map((ev) => (
                <li key={ev._id} className="ms-4 pb-4 last:pb-0">
                  <span className="absolute -start-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#f37121]" />
                  <p className="text-sm font-semibold text-slate-900">{ACTION_LABEL[ev.action]?.[ar ? 'ar' : 'en'] || ev.action}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(ev.date)}
                    {ev.fromEmployee ? ` · ${ar ? 'من' : 'from'} ${empName(ev.fromEmployee, lang)}` : ''}
                    {ev.toEmployee ? ` · ${ar ? 'إلى' : 'to'} ${empName(ev.toEmployee, lang)}` : ''}
                  </p>
                  {(ev.notes || ev.cost > 0) && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      {ev.notes}
                      {ev.cost > 0 ? ` · ${ar ? 'خصم' : 'charged'} ${fmtMoney(ev.cost)}` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-0.5">{ar ? 'سجّلها' : 'recorded by'} {ev.byName || '—'}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Modal>

      {/* The handover desk. Pick the employee, tick what physically came back;
          anything left unticked stays on them and the result says how much. */}
      <Modal open={handoverOpen} onClose={() => setHandoverOpen(false)} wide title={ar ? 'استلام عهدة من موظف' : 'Receive custody from an employee'}
        footer={<>
          <button type="button" onClick={() => setHandoverOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doHandover} disabled={saving || !handoverPicked.length}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {handoverForm.outcome === 'sold'
              ? (ar ? `تأكيد بيع ${handoverPicked.length}` : `Confirm sale of ${handoverPicked.length}`)
              : (ar ? `تأكيد استلام ${handoverPicked.length}` : `Confirm ${handoverPicked.length} item(s)`)}
          </PrimaryButton>
        </>}>
        <div className="space-y-4">
          <Field label={ar ? 'الموظف' : 'Employee'}>
            <SearchableSelect
              value={handoverEmployee}
              onChange={pickHandoverEmployee}
              placeholder={ar ? 'اختر الموظف' : 'Select an employee'}
              searchPlaceholder={ar ? 'ابحث بالاسم أو الرقم الوظيفي أو الإقامة…' : 'Search by name, number or iqama…'}
              emptyLabel={ar ? 'لا توجد نتائج' : 'No matches'}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.department, e.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>

          {handoverLoading ? (
            <p className="text-sm text-slate-400 py-4 text-center">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          ) : handoverEmployee && handoverHeld.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">{ar ? 'لا توجد عهد على هذا الموظف.' : 'This employee holds no custody items.'}</p>
          ) : handoverHeld.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500">
                  {ar ? `بعهدته ${handoverHeld.length} صنف — علِّم على ما استلمته` : `Holds ${handoverHeld.length} item(s) — tick what was handed back`}
                </p>
                <button type="button" onClick={() => setHandoverPicked(handoverPicked.length === handoverHeld.length ? [] : handoverHeld.map((i) => i._id))}
                  className="text-xs text-[#f37121] hover:underline">
                  {handoverPicked.length === handoverHeld.length ? (ar ? 'إلغاء التحديد' : 'Clear all') : (ar ? 'تحديد الكل' : 'Select all')}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {handoverHeld.map((it) => (
                  <label key={it._id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={handoverPicked.includes(it._id)} onChange={() => toggleHandover(it._id)}
                      className="w-4 h-4 accent-[#f37121] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-900 truncate">{it.name}</span>
                      <span className="block text-xs text-slate-400 truncate">
                        {custodyTypeLabel(it.type, lang)}
                        {it.serialNumber ? ` · ${it.serialNumber}` : ''}
                        {it.assignedDate ? ` · ${ar ? 'منذ' : 'since'} ${fmtDate(it.assignedDate)}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {ar
                  ? `سيتبقى ${handoverHeld.length - handoverPicked.length} صنف بعهدة الموظف بعد هذا الاستلام.`
                  : `${handoverHeld.length - handoverPicked.length} item(s) will remain with the employee after this.`}
              </p>
            </div>
          )}

          {handoverPicked.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <Field label={ar ? 'تاريخ الاستلام' : 'Handover date'}>
                <TextInput type="date" value={handoverForm.date} onChange={(e) => setHandoverForm({ ...handoverForm, date: e.target.value })} />
              </Field>
              <Field label={ar ? 'الحالة عند الاستلام' : 'Condition on return'}>
                <Select value={handoverForm.condition} onChange={(e) => setHandoverForm({ ...handoverForm, condition: e.target.value })}>
                  {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
                </Select>
              </Field>
              <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
                <TextArea rows={2} value={handoverForm.notes} onChange={(e) => setHandoverForm({ ...handoverForm, notes: e.target.value })} />
              </Field>
              {/* What happens to a received item has three outcomes, not two. It used to be a single choice, damaged or back to the warehouse. The third really happens: the employee buys what he holds and pays for it, and it was recorded as "handed over", staying in the owned count after it left. */}
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-slate-600 mb-1.5">{ar ? 'مصير ما استُلم' : 'What happens to them'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    { k: 'stock', ar: 'يعود للمستودع', en: 'Back to store' },
                    { k: 'faulty', ar: 'تالف', en: 'Faulty' },
                    { k: 'sold', ar: 'اشتراه الموظف', en: 'Bought by the employee' },
                  ] as const).map((o) => (
                    <button key={o.k} type="button"
                      onClick={() => setHandoverForm({ ...handoverForm, outcome: o.k, retire: o.k === 'faulty' })}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        handoverForm.outcome === o.k
                          ? 'border-[#f37121] bg-[#f37121]/10 text-[#f37121]'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                      {ar ? o.ar : o.en}
                    </button>
                  ))}
                </div>
              </div>
              {handoverForm.outcome === 'sold' && (
                <Field label={ar ? 'الثمن المدفوع للحسابات (للصنف الواحد)' : 'Price paid to accounting (per item)'} span2>
                  <TextInput type="number" min={0} value={String(handoverForm.price)}
                    onChange={(e) => setHandoverForm({ ...handoverForm, price: Number(e.target.value) })} />
                </Field>
              )}
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
