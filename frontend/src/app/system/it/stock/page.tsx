'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Boxes, Plus, Edit, Trash2, Check, Info, UserPlus } from 'lucide-react';
import { exportToExcel } from '@/utils/exportExcel';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, StatCard, Loader2,
} from '@/components/hr/HRKit';
import { useAssetVocab } from '@/hooks/useAssetVocab';
import {
  canViewIt, StockItem, EmployeeRef, CUSTODY_TYPES,
  optionsOf, empName, fmtDate, fmtMoney, today, unitsOf,
} from '@/lib/it';

const EMPTY = {
  name: '', type: 'laptop', serialNumber: '', brand: '', model: '',
  specs: '', condition: 'new', value: 0, quantity: 1, location: '', notes: '',
};

export default function ItStockPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);
  // Types/conditions are editable from Settings → Reference Data.
  const { itTypes, conditions, typeLabel: custodyTypeLabel, conditionLabel } = useAssetVocab();

  const [items, setItems] = useState<StockItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // Handing an item over is a separate decision from editing it, so it gets its
  // own modal — the employee and the handover date are what HR later audits.
  const [assigning, setAssigning] = useState<StockItem | null>(null);
  const [assignForm, setAssignForm] = useState({ employee: '', assignedDate: '', condition: 'good', notes: '' });

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (typeFilter) qs.set('type', typeFilter);
      if (conditionFilter) qs.set('condition', conditionFilter);
      const d = await api.get<{ items: StockItem[] }>(`/api/it/stock?${qs.toString()}`);
      setItems(d.items || []);
    } catch {}
    setLoading(false);
  }, [typeFilter, conditionFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));
  useSocket('hr:asset', useCallback(() => load(), [load]));

  useEffect(() => {
    api.get<{ employees: EmployeeRef[] }>('/api/it/employees')
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setShowModal(true); };
  const openEdit = (a: StockItem) => { setEditing(a); setForm({ ...EMPTY, ...a }); setShowModal(true); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/it/stock/${editing._id}`, form);
      else await api.post('/api/it/stock', form);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (a: StockItem) => {
    if (!confirm(ar ? 'حذف هذا الصنف من المستودع؟' : 'Delete this item from stock?')) return;
    try { await api.delete(`/api/it/stock/${a._id}`); load(); } catch (e: any) { alert(e.message); }
  };

  const openAssign = (a: StockItem) => {
    setAssigning(a);
    setAssignForm({ employee: '', assignedDate: today(), condition: a.condition || 'good', notes: '' });
  };

  const doAssign = async () => {
    if (!assigning || !assignForm.employee) return;
    setSaving(true);
    try {
      await api.post(`/api/it/stock/${assigning._id}/assign`, assignForm);
      setAssigning(null); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const filtered = items.filter((a) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [a.name, a.serialNumber, a.brand, a.model, a.specs, a.location]
      .some((v) => (v || '').toLowerCase().includes(s));
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  const totalUnits = items.reduce((s, a) => s + unitsOf(a), 0);
  const totalValue = items.reduce((s, a) => s + (a.value || 0) * unitsOf(a), 0);

  // Per-type unit counts drive both the stat row and the low-stock warning.
  const byType = new Map<string, number>();
  items.forEach((a) => byType.set(a.type, (byType.get(a.type) || 0) + unitsOf(a)));
  const lowTypes = itTypes.filter((t) => (byType.get(t.key) || 0) < 3);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Boxes className="w-5 h-5" />}
        title={ar ? 'مستودع تقنية المعلومات' : 'IT Stock'}
        subtitle={ar ? `${totalUnits} وحدة متاحة للتسليم` : `${totalUnits} units available to hand out`}
      >
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Item', key: 'name', width: 22 },
          { header: 'Type', key: 'type', transform: (v: any) => custodyTypeLabel(v, 'en'), width: 14 },
          { header: 'Serial', key: 'serialNumber', width: 20 },
          { header: 'Brand', key: 'brand', width: 14 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'Specs', key: 'specs', width: 28 },
          { header: 'Condition', key: 'condition', transform: (v: any) => conditionLabel(v, 'en'), width: 12 },
          { header: 'Quantity', key: 'quantity', width: 10 },
          { header: 'Location', key: 'location', width: 18 },
          { header: 'Value', key: 'value', width: 12 },
        ], `it-stock-${today()}`, 'Stock')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة للمستودع' : 'Add to stock'}</PrimaryButton>
      </PageHeader>

      {/* Stock is the same collection as custody, one document per device — the
          moment it is handed out it stops being stock and becomes a custody
          record on the employee's HR profile. People need to expect that. */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 leading-relaxed">
          {ar
            ? 'الأصناف هنا غير مسلّمة لأي موظف. عند الضغط على "تسليم لموظف" ينتقل نفس الصنف — بنفس الرقم التسلسلي وسجله الكامل — إلى عهد الموظف ويظهر مباشرة في ملفه في الموارد البشرية. وعند استرجاع العهدة يعود الصنف إلى المستودع تلقائياً.'
            : 'Items here are held by nobody. Assigning one moves the same record — same serial, same history — into the employee\'s custody, where it appears on their HR profile immediately. Returning it puts it back on this shelf.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'إجمالي الوحدات' : 'Total units'} value={totalUnits} accent="text-[#f37121]" />
        <StatCard label={ar ? 'عدد الأصناف' : 'Line items'} value={items.length} accent="text-slate-900" />
        <StatCard label={ar ? 'أنواع شبه منتهية' : 'Low-stock types'} value={lowTypes.length} accent={lowTypes.length ? 'text-red-600' : 'text-green-600'} />
        <StatCard label={ar ? 'قيمة المستودع' : 'Stock value'} value={fmtMoney(totalValue)} accent="text-slate-900" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <p className="text-xs font-semibold text-slate-500 mb-3">{ar ? 'المتاح حسب النوع' : 'Available by type'}</p>
        <div className="flex flex-wrap gap-2">
          {itTypes.map(({ key: k }) => {
            const n = byType.get(k) || 0;
            return (
              <div key={k} className={`rounded-lg border px-3 py-2 ${n < 3 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <span className="text-xs text-slate-600">{custodyTypeLabel(k, lang)}</span>
                <span className={`ms-2 text-sm font-semibold ${n < 3 ? 'text-red-600' : 'text-slate-900'}`}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالجهاز أو الرقم التسلسلي أو الموقع...' : 'Search item, serial or location...'} />
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {itTypes.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
            <option value="">{ar ? 'كل الحالات الفنية' : 'All conditions'}</option>
            {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الجهاز' : 'Item'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الرقم التسلسلي' : 'Serial'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'المواصفات' : 'Specs'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة الفنية' : 'Condition'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الكمية' : 'Qty'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الموقع' : 'Location'}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-12">{ar ? 'المستودع فارغ.' : 'No items in stock.'}</td></tr>
            ) : filtered.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">
                  {a.name}
                  {(a.brand || a.model) && <div className="text-xs text-slate-500">{[a.brand, a.model].filter(Boolean).join(' ')}</div>}
                </td>
                <td className="px-4 py-3">
                  <SmallBadge bg={CUSTODY_TYPES[a.type]?.bg || 'bg-slate-500/15'} text={CUSTODY_TYPES[a.type]?.text || 'text-slate-700'} label={custodyTypeLabel(a.type, lang)} />
                </td>
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{a.serialNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700 text-xs max-w-[200px] truncate" title={a.specs || ''}>{a.specs || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{a.condition ? conditionLabel(a.condition, lang) : '—'}</td>
                <td className="px-4 py-3 text-slate-900 font-semibold">{unitsOf(a)}</td>
                <td className="px-4 py-3 text-slate-700">{a.location || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openAssign(a)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-xs font-semibold" title={ar ? 'تسليم لموظف' : 'Assign to employee'}>
                      <UserPlus className="w-3.5 h-3.5" /> {ar ? 'تسليم' : 'Assign'}
                    </button>
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
        title={editing ? (ar ? 'تعديل صنف المستودع' : 'Edit stock item') : (ar ? 'إضافة صنف للمستودع' : 'Add item to stock')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <Field label={ar ? 'الحالة الفنية' : 'Condition'}>
            <Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>
              {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الماركة' : 'Brand'}>
            <TextInput value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label={ar ? 'الموديل' : 'Model'}>
            <TextInput value={form.model || ''} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label={ar ? 'المواصفات' : 'Specs'} span2>
            <TextInput value={form.specs || ''} onChange={(e) => set('specs', e.target.value)} placeholder={ar ? 'مثال: i7 / 16GB / 512GB SSD' : 'e.g. i7 / 16GB / 512GB SSD'} />
          </Field>
          <Field label={ar ? 'الكمية' : 'Quantity'}>
            <TextInput type="number" min={1} value={form.quantity ?? 1} onChange={(e) => set('quantity', Number(e.target.value))} />
          </Field>
          <Field label={ar ? 'الموقع في المستودع' : 'Location in store'}>
            <TextInput value={form.location || ''} onChange={(e) => set('location', e.target.value)} placeholder={ar ? 'مثال: رف A-3' : 'e.g. Shelf A-3'} />
          </Field>
          <Field label={ar ? 'القيمة' : 'Value'}>
            <TextInput type="number" value={form.value ?? 0} onChange={(e) => set('value', Number(e.target.value))} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!assigning} onClose={() => setAssigning(null)}
        title={ar ? 'تسليم لموظف' : 'Assign to employee'}
        footer={<>
          <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={doAssign} disabled={saving || !assignForm.employee}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'تأكيد التسليم' : 'Confirm handover'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {ar
              ? `تسليم "${assigning?.name}"${assigning?.serialNumber ? ` (${assigning.serialNumber})` : ''} من المستودع`
              : `Handing over "${assigning?.name}"${assigning?.serialNumber ? ` (${assigning.serialNumber})` : ''} from stock`}
          </p>
          <Field label={ar ? 'الموظف' : 'Employee'}>
            <SearchableSelect
              value={assignForm.employee}
              onChange={(v) => setAssignForm({ ...assignForm, employee: v })}
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
          <Field label={ar ? 'تاريخ التسليم' : 'Handover date'}>
            <TextInput type="date" value={assignForm.assignedDate} onChange={(e) => setAssignForm({ ...assignForm, assignedDate: e.target.value })} />
          </Field>
          <Field label={ar ? 'الحالة عند التسليم' : 'Condition at handover'}>
            <Select value={assignForm.condition} onChange={(e) => setAssignForm({ ...assignForm, condition: e.target.value })}>
              {conditions.map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'}>
            <TextArea rows={2} value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500">
            {ar
              ? 'سيظهر هذا الجهاز فوراً ضمن عهد الموظف في ملفه بالموارد البشرية، ولن يمكن إنهاء عقده قبل استرجاعه.'
              : 'This device will appear on the employee\'s HR profile immediately, and their contract cannot be terminated until it is returned.'}
          </p>
        </div>
      </Modal>
    </div>
  );
}
