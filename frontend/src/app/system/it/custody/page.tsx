'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Laptop, Plus, Edit, Undo2, Trash2, Check, Info, Boxes, ArrowLeftRight, AlertTriangle, Archive, History, ClipboardCheck } from 'lucide-react';
import { exportToExcel } from '@/utils/exportExcel';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, StatCard, Loader2,
} from '@/components/hr/HRKit';
import { useAssetVocab } from '@/hooks/useAssetVocab';
import {
  canViewIt, CustodyItem, StockItem, EmployeeRef, CUSTODY_TYPES, CUSTODY_STATUSES,
  CUSTODY_STATUS_KEYS, custodyStatusLabel,
  optionsOf, empName, fmtDate, fmtMoney, today, idOf,
} from '@/lib/it';

const EMPTY = {
  employee: '', name: '', type: 'laptop', serialNumber: '', brand: '', model: '',
  specs: '', condition: 'good', value: 0, assignedDate: '', notes: '',
};

// Bilingual names for the AssetEvent actions, used by the history timeline.
const ACTION_LABEL: Record<string, { en: string; ar: string }> = {
  added_to_store: { en: 'Added to store', ar: 'أُضيف إلى المستودع' },
  assigned: { en: 'Handed to employee', ar: 'سُلّم إلى موظف' },
  transferred: { en: 'Transferred', ar: 'نُقل إلى موظف آخر' },
  returned: { en: 'Returned to store', ar: 'أُعيد إلى المستودع' },
  damaged: { en: 'Reported damaged', ar: 'أُبلغ عن تلفه' },
  lost: { en: 'Reported lost', ar: 'أُبلغ عن فقده' },
  retired: { en: 'Taken out of service', ar: 'أُخرج من الخدمة' },
  updated: { en: 'Details updated', ar: 'عُدّلت بياناته' },
};

export default function ItCustodyPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);
  // Types/conditions are editable from Settings → Reference Data.
  const { itTypes, conditions, typeLabel: custodyTypeLabel, conditionLabel } = useAssetVocab();

  const [items, setItems] = useState<CustodyItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
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

  // Damaged / lost while in someone's hands.
  const [reporting, setReporting] = useState<CustodyItem | null>(null);
  const [reportForm, setReportForm] = useState<{ kind: 'damaged' | 'lost'; notes: string; cost: number; date: string }>({ kind: 'damaged', notes: '', cost: 0, date: '' });

  // One item's movement trail.
  const [historyOf, setHistoryOf] = useState<CustodyItem | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  // The handover desk: an employee brings gear back, we tick off what arrived
  // and the rest stays on them.
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverEmployee, setHandoverEmployee] = useState('');
  const [handoverHeld, setHandoverHeld] = useState<CustodyItem[]>([]);
  const [handoverPicked, setHandoverPicked] = useState<string[]>([]);
  const [handoverForm, setHandoverForm] = useState({ date: '', condition: 'good', notes: '', retire: false });
  const [handoverLoading, setHandoverLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (typeFilter) qs.set('type', typeFilter);
      const d = await api.get<{ items: CustodyItem[] }>(`/api/it/custody?${qs.toString()}`);
      setItems(d.items || []);
    } catch {}
    setLoading(false);
  }, [statusFilter, typeFilter]);

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
    ? !!form.employee && !!form.name.trim()
    : createMode === 'stock'
      ? !!form.employee && !!pickedStockId
      : !!form.employee && !!form.name.trim();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/it/custody/${editing._id}`, form);
      } else if (createMode === 'stock') {
        // Same document leaves the shelf and lands on the employee — the device
        // keeps its serial and its whole history.
        await api.post(`/api/it/stock/${pickedStockId}/assign`, {
          employee: form.employee,
          assignedDate: form.assignedDate,
          condition: form.condition,
          notes: form.notes,
        });
      } else {
        await api.post('/api/it/custody', form);
      }
      setShowModal(false); refresh();
    } catch (e: any) { alert(e.message); }
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
    catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (a: CustodyItem) => {
    if (!confirm(ar ? 'حذف هذه العهدة؟' : 'Delete this custody item?')) return;
    try { await api.delete(`/api/it/custody/${a._id}`); refresh(); } catch (e: any) { alert(e.message); }
  };

  const openTransfer = (a: CustodyItem) => {
    setTransferring(a);
    setTransferForm({ toEmployee: '', date: today(), condition: a.condition || 'good', notes: '' });
  };
  const doTransfer = async () => {
    if (!transferring || !transferForm.toEmployee) return;
    setSaving(true);
    try { await api.post(`/api/it/custody/${transferring._id}/transfer`, transferForm); setTransferring(null); refresh(); }
    catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const openReport = (a: CustodyItem) => {
    setReporting(a);
    setReportForm({ kind: 'damaged', notes: '', cost: 0, date: today() });
  };
  const doReport = async () => {
    if (!reporting) return;
    setSaving(true);
    try { await api.post(`/api/it/custody/${reporting._id}/report`, reportForm); setReporting(null); refresh(); }
    catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const doRetire = async (a: CustodyItem) => {
    if (!confirm(ar
      ? 'إخراج هذا الصنف من الخدمة نهائياً؟ لن يعود إلى المستودع.'
      : 'Take this item out of service for good? It will not go back to the store.')) return;
    try { await api.post(`/api/it/custody/${a._id}/retire`, { date: today() }); refresh(); }
    catch (e: any) { alert(e.message); }
  };

  const openHistory = async (a: CustodyItem) => {
    setHistoryOf(a); setHistory([]);
    try { const d = await api.get<{ events: any[] }>(`/api/it/custody/${a._id}/history`); setHistory(d.events || []); }
    catch {}
  };

  // Handover desk — picking the employee loads exactly what they still hold.
  const openHandover = () => {
    setHandoverOpen(true); setHandoverEmployee(''); setHandoverHeld([]); setHandoverPicked([]);
    setHandoverForm({ date: today(), condition: 'good', notes: '', retire: false });
  };
  const pickHandoverEmployee = async (id: string) => {
    setHandoverEmployee(id); setHandoverPicked([]); setHandoverHeld([]);
    if (!id) return;
    setHandoverLoading(true);
    try {
      const d = await api.get<{ assigned: CustodyItem[] }>(`/api/it/custody/by-employee/${id}`);
      setHandoverHeld(d.assigned || []);
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
      // Say plainly what is still on them — that is the whole point of the screen.
      alert(ar
        ? `تم تسجيل استلام ${d.returned} صنف. المتبقي بعهدة الموظف: ${d.outstanding.length} صنف.`
        : `Recorded ${d.returned} item(s) as handed back. Still outstanding: ${d.outstanding.length}.`);
      setHandoverOpen(false); refresh();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const filtered = items.filter((a) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [a.name, a.serialNumber, a.brand, a.model, a.specs, empName(a.employee, lang)]
      .some((v) => (v || '').toLowerCase().includes(s));
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  const assigned = items.filter((a) => a.status === 'assigned').length;
  const returned = items.filter((a) => a.status === 'returned').length;
  const totalValue = items.filter((a) => a.status === 'assigned').reduce((s, a) => s + (a.value || 0), 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Laptop className="w-5 h-5" />}
        title={ar ? 'عهد تقنية المعلومات' : 'IT Custody'}
        subtitle={ar ? `${assigned} عهدة بحوزة الموظفين` : `${assigned} items currently assigned`}
      >
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Employee', key: 'employee', transform: (v: any) => empName(v, 'en'), width: 24 },
          { header: 'Item', key: 'name', width: 22 },
          { header: 'Type', key: 'type', transform: (v: any) => custodyTypeLabel(v, 'en'), width: 14 },
          { header: 'Serial', key: 'serialNumber', width: 20 },
          { header: 'Brand', key: 'brand', width: 14 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'Specs', key: 'specs', width: 28 },
          { header: 'Condition', key: 'condition', transform: (v: any) => conditionLabel(v, 'en'), width: 12 },
          { header: 'Value', key: 'value', width: 12 },
          { header: 'Assigned', key: 'assignedDate', width: 14 },
          { header: 'Status', key: 'status', transform: (v: any) => custodyStatusLabel(v, 'en'), width: 12 },
          { header: 'Returned', key: 'returnedDate', width: 14 },
        ], `it-custody-${today()}`, 'Custody')} />
        <button type="button" onClick={openHandover} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
          <ClipboardCheck className="w-4 h-4" /> {ar ? 'استلام عهدة موظف' : 'Receive from employee'}
        </button>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'تسليم عهدة' : 'Assign item'}</PrimaryButton>
      </PageHeader>

      {/* Shared-data notice — this page writes to the same records HR reads, and
          people need to know that before they hand out a laptop. */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 leading-relaxed">
          {ar
            ? 'ملاحظة مهمة: العهد المسجّلة هنا هي نفسها المسجّلة في قسم الموارد البشرية — أي جهاز تسلّمه لموظف سيظهر تلقائياً في ملفه الشخصي في HR ضمن العهد الخاصة به، ولن يتمكن HR من إنهاء عقده قبل استرجاع العهدة. لا حاجة لتسجيل الجهاز مرتين.'
            : 'Note: custody recorded here is the same record HR uses — any device you assign appears automatically on the employee\'s HR profile, and HR cannot terminate their contract until it is returned. No need to record it twice.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'بحوزة الموظفين' : 'Assigned'} value={assigned} accent="text-amber-600" />
        <StatCard label={ar ? 'خارج الخدمة' : 'Out of service'} value={returned} accent="text-slate-600" />
        <StatCard label={ar ? 'في المستودع' : 'In stock'} value={stock.length} accent="text-blue-600" />
        <StatCard label={ar ? 'قيمة العهد الحالية' : 'Value assigned'} value={fmtMoney(totalValue)} accent="text-[#f37121]" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالجهاز أو الرقم التسلسلي أو الموظف...' : 'Search item, serial or employee...'} />
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {itTypes.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {optionsOf(CUSTODY_STATUSES, CUSTODY_STATUS_KEYS).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الموظف' : 'Employee'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الجهاز' : 'Item'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الرقم التسلسلي' : 'Serial'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'المواصفات' : 'Specs'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة الفنية' : 'Condition'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'تاريخ التسليم' : 'Assigned'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-slate-500 py-12">{ar ? 'لا توجد عهد مسجّلة.' : 'No custody items found.'}</td></tr>
            ) : filtered.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(a.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">
                  {a.name}
                  {(a.brand || a.model) && <div className="text-xs text-slate-500">{[a.brand, a.model].filter(Boolean).join(' ')}</div>}
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
                    label={a.status === 'returned' ? `${custodyStatusLabel(a.status, lang)} ${fmtDate(a.returnedDate)}` : custodyStatusLabel(a.status, lang)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {a.status === 'assigned' && (<>
                      <button type="button" onClick={() => openReturn(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-green-600 hover:bg-slate-100" title={ar ? 'استرجاع' : 'Return'}><Undo2 className="w-4 h-4" /></button>
                      <button type="button" onClick={() => openTransfer(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-slate-100" title={ar ? 'نقل لموظف آخر' : 'Transfer to another employee'}><ArrowLeftRight className="w-4 h-4" /></button>
                      <button type="button" onClick={() => openReport(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-amber-600 hover:bg-slate-100" title={ar ? 'إبلاغ عن تلف أو فقد' : 'Report damaged or lost'}><AlertTriangle className="w-4 h-4" /></button>
                      <button type="button" onClick={() => doRetire(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100" title={ar ? 'إخراج من الخدمة' : 'Take out of service'}><Archive className="w-4 h-4" /></button>
                    </>)}
                    <button type="button" onClick={() => openHistory(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'سجل الحركة' : 'Movement history'}><History className="w-4 h-4" /></button>
                    <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                <Select value={pickedStockId} onChange={(e) => setPickedStockId(e.target.value)}>
                  <option value="">—</option>
                  {stock.map((s) => (
                    <option key={s._id} value={s._id}>
                      {`${s.name}${s.serialNumber ? ` — ${s.serialNumber}` : ''} (${custodyTypeLabel(s.type, lang)})`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <>
              <Field label={ar ? 'اسم الجهاز' : 'Item name'}>
                <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={ar ? 'مثال: لابتوب Dell' : 'e.g. Dell laptop'} />
              </Field>
              <Field label={ar ? 'النوع' : 'Type'}>
                <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
                  {itTypes.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
                </Select>
              </Field>
              <Field label={ar ? 'الرقم التسلسلي' : 'Serial number'}>
                <TextInput value={form.serialNumber || ''} onChange={(e) => set('serialNumber', e.target.value)} />
              </Field>
              <Field label={ar ? 'الماركة' : 'Brand'}>
                <TextInput value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} />
              </Field>
              <Field label={ar ? 'الموديل' : 'Model'}>
                <TextInput value={form.model || ''} onChange={(e) => set('model', e.target.value)} />
              </Field>
            </>
          )}
          <Field label={ar ? 'الحالة الفنية' : 'Condition'}>
            <Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>
              {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          {(editing || createMode === 'new') && (
            <>
              <Field label={ar ? 'المواصفات' : 'Specs'} span2>
                <TextInput value={form.specs || ''} onChange={(e) => set('specs', e.target.value)} placeholder={ar ? 'مثال: i7 / 16GB / 512GB SSD' : 'e.g. i7 / 16GB / 512GB SSD'} />
              </Field>
              <Field label={ar ? 'القيمة' : 'Value'}>
                <TextInput type="number" value={form.value ?? 0} onChange={(e) => set('value', Number(e.target.value))} />
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
                { retire: true, ar: 'إخراج من الخدمة', en: 'Retire' },
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
                ? 'سيتم إخراج الجهاز من الخدمة نهائياً ولن يظهر في المستودع.'
                : 'The device leaves circulation and will not appear in stock.')
              : (ar
                ? 'سيعود الجهاز إلى المستودع جاهزاً للتسليم لموظف آخر، مع الاحتفاظ بسجله الكامل.'
                : 'The device returns to stock, ready to hand to someone else, keeping its full history.')}
          </p>
        </div>
      </Modal>
      {/* Transfer — the device goes straight to the next person, so both sides
          of the handover are recorded on one event. */}
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

      {/* Damaged / lost. A damaged device stays on its holder; a lost one leaves
          circulation, because it cannot be handed to anyone else. */}
      <Modal open={!!reporting} onClose={() => setReporting(null)} title={ar ? 'إبلاغ عن تلف أو فقد' : 'Report damaged or lost'}
        footer={<>
          <button type="button" onClick={() => setReporting(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doReport} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تسجيل البلاغ' : 'Record report'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {reporting?.name} — {empName(reporting?.employee, lang)}
          </p>
          <Field label={ar ? 'نوع البلاغ' : 'Report type'}>
            <Select value={reportForm.kind} onChange={(e) => setReportForm({ ...reportForm, kind: e.target.value as 'damaged' | 'lost' })}>
              <option value="damaged">{ar ? 'تالف' : 'Damaged'}</option>
              <option value="lost">{ar ? 'مفقود' : 'Lost'}</option>
            </Select>
          </Field>
          <p className="text-xs text-slate-500">
            {reportForm.kind === 'damaged'
              ? (ar ? 'الصنف يظل بعهدة الموظف وتتغير حالته إلى "تالف".' : 'The item stays with the employee and its condition becomes "damaged".')
              : (ar ? 'الصنف يخرج من التداول لأنه لم يعد موجوداً، ويظل البلاغ مسجلاً على الموظف.' : 'The item leaves circulation because it no longer exists; the report stays on the employee\u2019s record.')}
          </p>
          <Field label={ar ? 'تاريخ البلاغ' : 'Report date'}>
            <TextInput type="date" value={reportForm.date} onChange={(e) => setReportForm({ ...reportForm, date: e.target.value })} />
          </Field>
          <Field label={ar ? 'قيمة الخصم (إن وُجد)' : 'Amount charged (if any)'}>
            <TextInput type="number" min={0} value={reportForm.cost} onChange={(e) => setReportForm({ ...reportForm, cost: Number(e.target.value) })} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <TextArea rows={2} value={reportForm.notes} onChange={(e) => setReportForm({ ...reportForm, notes: e.target.value })} />
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
            {ar ? `تأكيد استلام ${handoverPicked.length}` : `Confirm ${handoverPicked.length} item(s)`}
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
                  {ar ? `بعهدته ${handoverHeld.length} صنف — علّم على اللي استلمته` : `Holds ${handoverHeld.length} item(s) — tick what was handed back`}
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
              <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={handoverForm.retire} onChange={(e) => setHandoverForm({ ...handoverForm, retire: e.target.checked })}
                  className="w-4 h-4 accent-[#f37121]" />
                {ar ? 'إخراج من الخدمة بدل إعادتها للمستودع' : 'Take out of service instead of returning to the store'}
              </label>
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
