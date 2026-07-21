'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Boxes, Plus, Edit, Trash2, Check, Info, UserPlus } from 'lucide-react';
import { isHRStaff, Asset, Employee, empName, exportToExcel, today } from '@/lib/hr';
import { useAssetVocab } from '@/hooks/useAssetVocab';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, StatCard,
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, Loader2,
} from '@/components/hr/HRKit';
import { getHrStockTranslations } from '@/lib/translations';

const EMPTY = {
  name: '', type: 'tool', serialNumber: '', brand: '', model: '', specs: '',
  condition: 'new', value: 0, quantity: 1, location: '', notes: '',
};

// Consumables sit as one row with a count; serial-tracked gear keeps quantity 1.
const unitsOf = (a: Asset & { quantity?: number }) => (a.quantity && a.quantity > 0 ? a.quantity : 1);

export default function HRStockPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrStockTranslations(lang);
  const staff = isHRStaff(user?.role);
  // Types/conditions are editable from Settings → Reference Data.
  const { types, conditions, typeLabel, conditionLabel } = useAssetVocab();

  const [items, setItems] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // Handing an item over is a different decision from editing it — the employee
  // and the handover date are what gets audited later.
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [assignForm, setAssignForm] = useState({ employee: '', assignedDate: '', condition: 'good', notes: '' });

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (typeFilter) qs.set('type', typeFilter);
      if (conditionFilter) qs.set('condition', conditionFilter);
      const d = await api.get<{ items: Asset[] }>(`/api/hr/stock?${qs.toString()}`);
      setItems(d.items || []);
    } catch {}
    setLoading(false);
  }, [typeFilter, conditionFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ employees: Employee[] }>('/api/hr/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setShowModal(true); };
  const openEdit = (a: Asset) => { setEditing(a); setForm({ ...EMPTY, ...a }); setShowModal(true); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/stock/${editing._id}`, form);
      else await api.post('/api/hr/stock', form);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (a: Asset) => {
    if (!confirm(tx.deleteConfirm)) return;
    try { await api.delete(`/api/hr/stock/${a._id}`); load(); } catch (e: any) { alert(e.message); }
  };

  const openAssign = (a: Asset) => {
    setAssigning(a);
    setAssignForm({ employee: '', assignedDate: today(), condition: a.condition || 'good', notes: '' });
  };

  const doAssign = async () => {
    if (!assigning || !assignForm.employee) return;
    setSaving(true);
    try {
      await api.post(`/api/hr/stock/${assigning._id}/assign`, assignForm);
      setAssigning(null); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const filtered = items.filter((a) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [a.name, a.serialNumber, a.brand, a.model, a.specs, (a as any).location]
      .some((v) => (v || '').toLowerCase().includes(s));
  });

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  const totalUnits = items.reduce((s, a) => s + unitsOf(a), 0);
  const totalValue = items.reduce((s, a) => s + (a.value || 0) * unitsOf(a), 0);
  const damaged = items.filter((a) => a.condition === 'damaged').length;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${totalUnits} ${tx.unitsAvailable}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: 'Item', key: 'name', width: 22 },
          { header: 'Type', key: 'type', transform: (v: any) => typeLabel(v, 'en'), width: 14 },
          { header: 'Serial', key: 'serialNumber', width: 20 },
          { header: 'Brand', key: 'brand', width: 14 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'Condition', key: 'condition', transform: (v: any) => conditionLabel(v, 'en'), width: 12 },
          { header: 'Quantity', key: 'quantity', width: 10 },
          { header: 'Location', key: 'location', width: 18 },
          { header: 'Value', key: 'value', width: 12 },
        ], `hr-stock-${today()}`, 'Stock')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addToStock}</PrimaryButton>
      </PageHeader>

      {/* People confuse this shelf with the IT one, so say plainly what it is. */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 leading-relaxed">{tx.introNote}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={tx.statUnits} value={totalUnits} accent="text-[#f37121]" />
        <StatCard label={tx.statLines} value={items.length} accent="text-slate-900" />
        <StatCard label={tx.statDamaged} value={damaged} accent={damaged ? 'text-red-600' : 'text-green-600'} />
        <StatCard label={tx.statValue} value={totalValue.toLocaleString()} accent="text-slate-900" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{tx.allTypes}</option>
            {types.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)}>
            <option value="">{tx.allConditions}</option>
            {conditions.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colItem}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSerial}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colCondition}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colQty}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colLocation}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">{tx.empty}</td></tr>
            ) : filtered.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">
                  {a.name}
                  {(a.brand || a.model) && <div className="text-xs text-slate-500">{[a.brand, a.model].filter(Boolean).join(' ')}</div>}
                </td>
                <td className="px-4 py-3 text-slate-700">{typeLabel(a.type, lang)}</td>
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{a.serialNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{a.condition ? conditionLabel(a.condition, lang) : '—'}</td>
                <td className="px-4 py-3 text-slate-900 font-semibold">{unitsOf(a)}</td>
                <td className="px-4 py-3 text-slate-700">{(a as any).location || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => openAssign(a)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-xs font-semibold" title={tx.assignToEmployee}>
                      <UserPlus className="w-3.5 h-3.5" /> {tx.assign}
                    </button>
                    <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.actionEdit}><Edit className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.actionDelete}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editItem : tx.addToStock}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldItemName}><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tx.itemNamePlaceholder} /></Field>
          <Field label={tx.fieldType}><Select value={form.type} onChange={(e) => set('type', e.target.value)}>{types.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}</Select></Field>
          <Field label={tx.fieldSerial}><TextInput value={form.serialNumber || ''} onChange={(e) => set('serialNumber', e.target.value)} /></Field>
          <Field label={tx.fieldCondition}><Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>{conditions.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}</Select></Field>
          <Field label={tx.fieldBrand}><TextInput value={form.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label={tx.fieldModel}><TextInput value={form.model || ''} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={tx.fieldQuantity}><TextInput type="number" min={1} value={form.quantity ?? 1} onChange={(e) => set('quantity', Number(e.target.value))} /></Field>
          <Field label={tx.fieldLocation}><TextInput value={form.location || ''} onChange={(e) => set('location', e.target.value)} placeholder={tx.locationPlaceholder} /></Field>
          <Field label={tx.fieldValue}><TextInput type="number" value={form.value ?? 0} onChange={(e) => set('value', Number(e.target.value))} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={tx.assignToEmployee}
        footer={<>
          <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={doAssign} disabled={saving || !assignForm.employee}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.confirmHandover}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {tx.handingOver} “{assigning?.name}”{assigning?.serialNumber ? ` (${assigning.serialNumber})` : ''}
          </p>
          <Field label={tx.fieldEmployee}>
            <SearchableSelect
              value={assignForm.employee}
              onChange={(v) => setAssignForm({ ...assignForm, employee: v })}
              placeholder={tx.pickEmployee}
              searchPlaceholder={tx.searchEmployee}
              emptyLabel={tx.noMatches}
              options={employees.map((e) => ({
                value: e._id,
                label: empName(e, lang),
                hint: [e.employeeNumber, e.jobTitle, e.iqamaNumber].filter(Boolean).join(' · '),
              }))}
            />
          </Field>
          <Field label={tx.fieldHandoverDate}><TextInput type="date" value={assignForm.assignedDate} onChange={(e) => setAssignForm({ ...assignForm, assignedDate: e.target.value })} /></Field>
          <Field label={tx.fieldConditionAtHandover}>
            <Select value={assignForm.condition} onChange={(e) => setAssignForm({ ...assignForm, condition: e.target.value })}>
              {conditions.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}
            </Select>
          </Field>
          <Field label={tx.fieldNotes}><TextArea rows={2} value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">{tx.handoverNote}</p>
        </div>
      </Modal>
    </div>
  );
}
