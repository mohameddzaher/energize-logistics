'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ScrollText, Plus, Edit, Trash2, Check, Building2 } from 'lucide-react';
import { isHRStaff, fmtDate, daysUntil, expiryBadge, exportToExcel, today } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, StatCard, SmallBadge, Modal, Field, TextInput, Select, TextArea, Loader2 } from '@/components/hr/HRKit';
import { getHrLicensesTranslations } from '@/lib/translations';

interface License {
  _id: string;
  category: string;
  name: string;
  duration?: string;
  expiryDate?: string;
  location?: string;
  notes?: string;
  createdAt?: string;
}

// Fixed establishment metadata (shown above the table, not editable rows).
const FACILITY = {
  name: 'تنشيط الخدمات اللوجستية',
  nameEn: 'Energize Logistics Services',
  commercialRegister: '4030428255',
  unifiedNumber: '7025667531',
};

// Suggested categories & locations for the form datalists (users can still type
// a new value — the field is free-text).
const CATEGORY_SUGGESTIONS = [
  'النقل', 'التامين الطبي للموظفين', 'التامين الطبي للبضائع', 'التامين للمركبات',
  'التامين الطبي للمركبات', 'مقيم', 'السجل التجاري', 'بلدي',
  'المركز الوطني للرقابة على الالتزام البيئي', 'المركز الوطني لإدارة النفايات',
];
const LOCATION_SUGGESTIONS = ['جدة', 'عقلة الصقور'];

const EMPTY = { category: '', name: '', duration: '', expiryDate: '', location: '', notes: '' };

export default function LicensesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLicensesTranslations(lang);
  const staff = isHRStaff(user?.role);

  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<License | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ licenses: License[] }>('/api/hr/licenses');
      setLicenses(d.licenses || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('hr:license', useCallback(() => load(), [load]));

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (l: License) => { setEditing(l); setForm({ ...EMPTY, ...l }); setShowModal(true); };

  const save = async () => {
    if (!form.category.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/hr/licenses/${editing._id}`, form);
      else await api.post('/api/hr/licenses', form);
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (l: License) => { if (!confirm(tx.deleteConfirm)) return; try { await api.delete(`/api/hr/licenses/${l._id}`); load(); } catch (e: any) { alert(e.message); } };

  // Distinct values for the filter dropdowns.
  const categories = useMemo(() => Array.from(new Set(licenses.map((l) => l.category).filter(Boolean))).sort(), [licenses]);
  const locations = useMemo(() => Array.from(new Set(licenses.map((l) => l.location).filter(Boolean) as string[])).sort(), [licenses]);

  const filtered = useMemo(() => licenses.filter((l) => {
    if (categoryFilter && l.category !== categoryFilter) return false;
    if (locationFilter && l.location !== locationFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!`${l.name} ${l.category} ${l.location || ''} ${l.duration || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [licenses, categoryFilter, locationFilter, search]);

  // Mini-dashboard stats (computed from the full set, not the filtered view).
  const stats = useMemo(() => {
    let expired = 0; let soon = 0; let valid = 0;
    for (const l of licenses) {
      const d = daysUntil(l.expiryDate);
      if (d === null) { valid += 1; continue; }
      if (d < 0) expired += 1;
      else if (d <= 60) soon += 1;
      else valid += 1;
    }
    return { total: licenses.length, expired, soon, valid, categories: categories.length, locations: locations.length };
  }, [licenses, categories.length, locations.length]);

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ScrollText className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${licenses.length} ${tx.recordsUnit}`}>
        <ExportButton label={tx.exportExcel} onClick={() => exportToExcel(filtered, [
          { header: tx.thCategory, key: 'category', width: 26 },
          { header: tx.thName, key: 'name', width: 40 },
          { header: tx.thDuration, key: 'duration', width: 16 },
          { header: tx.thExpiry, key: 'expiryDate', width: 14 },
          { header: tx.thLocation, key: 'location', width: 16 },
          { header: tx.thDaysLeft, key: 'expiryDate', transform: (v: any) => { const d = daysUntil(v); return d === null ? '' : d; }, width: 12 },
        ], `licenses-${today()}`, 'Licenses')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addLicense}</PrimaryButton>
      </PageHeader>

      {/* Establishment info */}
      <div className="bg-slate-900 text-white rounded-xl px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-2 shadow-sm">
        <div className="flex items-center gap-2 font-semibold"><Building2 className="w-5 h-5 text-[#f37121]" />{ar ? FACILITY.name : FACILITY.nameEn}</div>
        <div className="text-sm"><span className="text-slate-400">{tx.commercialRegister}: </span>{FACILITY.commercialRegister}</div>
        <div className="text-sm"><span className="text-slate-400">{tx.unifiedNumber}: </span>{FACILITY.unifiedNumber}</div>
      </div>

      {/* Mini dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={tx.cardTotal} value={stats.total} />
        <StatCard label={tx.cardExpiringSoon} value={stats.soon} accent="text-amber-700" />
        <StatCard label={tx.cardExpired} value={stats.expired} accent="text-red-600" />
        <StatCard label={tx.cardValid} value={stats.valid} accent="text-green-600" />
        <StatCard label={tx.cardCategories} value={stats.categories} />
        <StatCard label={tx.cardLocations} value={stats.locations} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <div className="w-full sm:w-56 shrink-0">
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">{tx.allCategories}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
            <option value="">{tx.allLocations}</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.thCategory}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thName}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thDuration}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thExpiry}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thLocation}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.thDaysLeft}</th>
            <th className="text-end font-semibold px-4 py-3">{tx.thActions}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{tx.empty}</td></tr>
            ) : filtered.map((l) => {
              const b = expiryBadge(l.expiryDate, lang);
              const d = daysUntil(l.expiryDate);
              return (
                <tr key={l._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                  <td className="px-4 py-3 text-slate-800">{l.category}</td>
                  <td className="px-4 py-3 text-slate-900 font-medium">{l.name}</td>
                  <td className="px-4 py-3 text-slate-700">{l.duration || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtDate(l.expiryDate)}</td>
                  <td className="px-4 py-3 text-slate-700">{l.location || '—'}</td>
                  <td className="px-4 py-3">{d === null ? <span className="text-slate-700">—</span> : b && <SmallBadge bg={b.bg} text={b.text} label={d < 0 ? tx.expiredLabel : `${d} ${tx.dayUnit}`} />}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(l)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={tx.actionEdit}><Edit className="w-4 h-4" /></button>
                      <button type="button" onClick={() => remove(l)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={tx.actionDelete}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editLicense : tx.newLicense}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.category.trim() || !form.name.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <datalist id="license-categories">{CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="license-locations">{LOCATION_SUGGESTIONS.map((l) => <option key={l} value={l} />)}</datalist>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.fieldCategory} span2><TextInput list="license-categories" value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
          <Field label={tx.fieldName} span2><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={tx.fieldDuration}><TextInput value={form.duration} onChange={(e) => set('duration', e.target.value)} placeholder={ar ? 'سنوي / 3 سنوات' : 'Annual / 3 years'} /></Field>
          <Field label={tx.fieldExpiry}><TextInput type="date" value={form.expiryDate || ''} onChange={(e) => set('expiryDate', e.target.value)} /></Field>
          <Field label={tx.fieldLocation}><TextInput list="license-locations" value={form.location} onChange={(e) => set('location', e.target.value)} /></Field>
          <Field label={tx.fieldNotes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
