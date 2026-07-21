'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Laptop, Plus, Edit, Undo2, Trash2, Check, Info, Boxes } from 'lucide-react';
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
                    {a.status === 'assigned' && (
                      <button type="button" onClick={() => openReturn(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-green-600 hover:bg-slate-100" title={ar ? 'استرجاع' : 'Return'}><Undo2 className="w-4 h-4" /></button>
                    )}
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
    </div>
  );
}
