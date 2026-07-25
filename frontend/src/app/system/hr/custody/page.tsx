'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Package, Plus, Edit, Undo2, Trash2, Check, Eye, Lock } from 'lucide-react';
import { isHRStaff, Asset, Employee, empName, fmtDate, exportToExcel, today } from '@/lib/hr';
import { useAssetVocab } from '@/hooks/useAssetVocab';
import { Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge, Modal, Field, TextInput, Select, SearchableSelect, TextArea, Loader2 } from '@/components/hr/HRKit';
import { getHrCustodyTranslations } from '@/lib/translations';

const EMPTY = { employee: '', name: '', type: 'laptop', serialNumber: '', brand: '', model: '', condition: 'good', value: 0, assignedDate: '', notes: '' };

// Items handed out by the Software & IT section (devices, SIMs, peripherals)
// show here in full — HR needs to know who holds what and since when — but IT
// owns the record, so HR gets no edit/return/delete on them. The backend
// refuses those writes too; this only keeps the UI honest.
const isItOwned = (a: Asset) => a.issuedBySection === 'it';
// SIM cards are the exception: IT registers them, but the line follows the
// employee rather than the device, so HR edits and returns them like its own.
const isLocked = (a: Asset) => isItOwned(a) && a.type !== 'sim';
const userName = (u: any) => (u && typeof u === 'object' ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

export default function CustodyPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrCustodyTranslations(lang);
  const staff = isHRStaff(user);
  // Types/conditions are editable from Settings → Reference Data.
  const { types, conditions, typeLabel, conditionLabel } = useAssetVocab();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [details, setDetails] = useState<Asset | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ assets: Asset[] }>(`/api/hr/assets${qs}`);
      setAssets(d.assets || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useEffect(() => { api.get<{ employees: Employee[] }>('/api/hr/employees').then((d) => setEmployees(d.employees || [])).catch(() => {}); }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, assignedDate: today() }); setShowModal(true); };
  const openEdit = (a: Asset) => { setEditing(a); setForm({ ...EMPTY, ...a, employee: typeof a.employee === 'object' ? a.employee?._id : a.employee }); setShowModal(true); };

  const save = async () => {
    if (!form.employee || !form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/assets/${editing._id}`, form);
      else await api.post('/api/hr/assets', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const returnAsset = async (a: Asset) => {
    const cond = prompt(tx.returnConditionPrompt, a.condition || 'good') || a.condition;
    try { await api.post(`/api/hr/assets/${a._id}/return`, { returnedCondition: cond }); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const remove = async (a: Asset) => { if (!(await confirm(tx.deleteConfirm))) return; try { await api.delete(`/api/hr/assets/${a._id}`); load(); } catch (e: any) { notify(e.message, 'error'); } };

  const filtered = assets
    .filter((a) => !sourceFilter || (sourceFilter === 'it' ? isItOwned(a) : !isItOwned(a)))
    .filter((a) => !search.trim() || a.name.toLowerCase().includes(search.toLowerCase()) || (a.serialNumber || '').toLowerCase().includes(search.toLowerCase()) || empName(a.employee).toLowerCase().includes(search.toLowerCase()));

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Package className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${assets.filter((a) => a.status === 'assigned').length} ${tx.assignedCount}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
          { header: 'Item', key: 'name', width: 20 },
          { header: 'Type', key: 'type', transform: (v: any) => typeLabel(v, 'en'), width: 16 },
          { header: 'Serial', key: 'serialNumber', width: 18 },
          { header: 'Brand', key: 'brand', width: 14 },
          { header: 'Condition', key: 'condition', width: 12 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Assigned', key: 'assignedDate', width: 14 },
          { header: 'Returned', key: 'returnedDate', width: 14 },
          { header: 'Source', key: 'issuedBySection', transform: (v: any) => (v === 'it' ? tx.sourceIt : tx.sourceHr), width: 20 },
        ], `custody-${today()}`, 'Custody')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addCustody}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx.filterAll}</option>
            <option value="assigned">{tx.filterAssigned}</option>
            <option value="returned">{tx.filterReturned}</option>
          </Select>
        </div>
        <div className="w-full sm:w-52 shrink-0">
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">{tx.filterSourceAll}</option>
            <option value="it">{tx.sourceIt}</option>
            <option value="hr">{tx.sourceHr}</option>
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colItem}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSerial}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colCondition}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colSource}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-800 py-12">{tx.empty}</td></tr>
            ) : filtered.map((a) => (
              <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900 font-medium">{empName(a.employee, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{a.name}{a.brand ? <span className="text-slate-700"> · {a.brand} {a.model}</span> : ''}</td>
                <td className="px-4 py-3 text-slate-700">{typeLabel(a.type, lang)}</td>
                <td className="px-4 py-3 text-slate-700">{a.serialNumber || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{a.condition ? conditionLabel(a.condition, lang) : '—'}</td>
                <td className="px-4 py-3">{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={tx.badgeAssigned} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={`${tx.badgeReturned} ${fmtDate(a.returnedDate)}`} />}</td>
                <td className="px-4 py-3">{isItOwned(a) ? <SmallBadge bg="bg-sky-500/20" text="text-sky-700" label={tx.sourceIt} /> : <SmallBadge bg="bg-slate-500/20" text="text-slate-700" label={tx.sourceHr} />}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => setDetails(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.actionDetails}><Eye className="w-4 h-4" /></button>
                    {isLocked(a) ? (
                      <span className="p-1.5 text-slate-400" title={tx.readOnlyIt}><Lock className="w-4 h-4" /></span>
                    ) : (<>
                      {a.status === 'assigned' && <button type="button" onClick={() => returnAsset(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-green-600 hover:bg-slate-100" title={tx.actionReturn}><Undo2 className="w-4 h-4" /></button>}
                      <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.actionEdit}><Edit className="w-4 h-4" /></button>
                      <button type="button" onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.actionDelete}><Trash2 className="w-4 h-4" /></button>
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editCustody : tx.addCustody}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.employee || !form.name.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldEmployee} span2>
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v)}
              disabled={!!editing}
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
          <Field label={tx.fieldItemName}><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tx.itemNamePlaceholder} /></Field>
          <Field label={tx.fieldType}><Select value={form.type} onChange={(e) => set('type', e.target.value)}>{types.map((t) => <option key={t.key} value={t.key}>{ar ? t.ar : t.en}</option>)}</Select></Field>
          <Field label={tx.fieldSerial}><TextInput value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} /></Field>
          <Field label={tx.fieldBrand}><TextInput value={form.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label={tx.fieldModel}><TextInput value={form.model} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={tx.fieldCondition}><Select value={form.condition} onChange={(e) => set('condition', e.target.value)}>{conditions.map((c) => <option key={c.key} value={c.key}>{ar ? c.ar : c.en}</option>)}</Select></Field>
          <Field label={tx.fieldValue}><TextInput type="number" value={form.value} onChange={(e) => set('value', Number(e.target.value))} /></Field>
          <Field label={tx.fieldAssignedDate}><TextInput type="date" value={form.assignedDate || ''} onChange={(e) => set('assignedDate', e.target.value)} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>

      {/* Read-only view — the only way HR inspects an IT-issued item in full. */}
      <Modal open={!!details} onClose={() => setDetails(null)} title={tx.detailsTitle}
        footer={<button type="button" onClick={() => setDetails(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.close}</button>}>
        {details && (
          <div className="space-y-4">
            {isLocked(details) && (
              <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 text-sky-800 px-3 py-2 text-sm">
                <Lock className="w-4 h-4 shrink-0" /> {tx.readOnlyIt}
              </div>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                [tx.colEmployee, empName(details.employee, lang)],
                [tx.colItem, details.name],
                [tx.colType, typeLabel(details.type, lang)],
                [tx.fieldBrand, details.brand],
                [tx.fieldModel, details.model],
                [tx.fieldSerial, details.serialNumber],
                [tx.fieldSpecs, details.specs],
                [tx.fieldCategory, details.category],
                [tx.fieldCondition, details.condition ? conditionLabel(details.condition, lang) : ''],
                [tx.fieldAssignedDate, fmtDate(details.assignedDate)],
                [tx.fieldAssignedBy, userName(details.assignedBy)],
                [tx.colSource, isItOwned(details) ? tx.sourceIt : tx.sourceHr],
                [tx.colStatus, details.status === 'assigned' ? tx.badgeAssigned : tx.badgeReturned],
                [tx.fieldReturnedDate, details.status === 'returned' ? fmtDate(details.returnedDate) : ''],
                [tx.fieldReturnedCondition, details.returnedCondition ? conditionLabel(details.returnedCondition, lang) : ''],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-slate-500 text-xs mb-0.5">{label}</dt>
                  <dd className="text-slate-900 font-medium break-words">{value || '—'}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-slate-500 text-xs mb-0.5">{tx.fieldNotes}</dt>
                <dd className="text-slate-900 whitespace-pre-wrap break-words">{details.notes || '—'}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
