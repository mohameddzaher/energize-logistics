'use client';
// Central management screen for every editable reference list (lookup) in the
// system. Types are grouped by module on the left; the selected type's rows are
// listed on the right with add / edit / activate / delete. Backed by /api/lookups.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Tags, Plus, Edit, Trash2, Check } from 'lucide-react';
import { Spinner, PageHeader, PrimaryButton, SmallBadge, Modal, Field, TextInput, Select, Loader2, ExportButton } from '@/components/hr/HRKit';
import { getSettingsReferenceDataTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

interface LookupType { type: string; module: string; nameEn: string; nameAr: string; canManage: boolean }
interface LookupItem { _id: string; type: string; key: string; nameEn: string; nameAr: string; color?: string; isActive: boolean; isSystem: boolean }

const MODULE_LABELS: Record<string, { en: string; ar: string }> = {
  procurement: { en: 'Procurement', ar: 'المشتريات' },
  crm: { en: 'CRM', ar: 'إدارة العملاء' },
  hr: { en: 'HR', ar: 'الموارد البشرية' },
  sales: { en: 'Sales', ar: 'المبيعات' },
  accounting: { en: 'Accounting', ar: 'المحاسبة' },
};

const EMPTY = { nameEn: '', nameAr: '', color: '#f37121', isActive: true };

export default function ReferenceDataPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getSettingsReferenceDataTranslations(lang);

  const [types, setTypes] = useState<LookupType[]>([]);
  const [activeType, setActiveType] = useState<string>('');
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LookupItem | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const current = types.find((t) => t.type === activeType) || null;
  const canManage = !!current?.canManage;

  const loadTypes = useCallback(async () => {
    try {
      const d = await api.get<{ types: LookupType[] }>('/api/lookups/types');
      setTypes(d.types || []);
      if (d.types && d.types.length && !activeType) setActiveType(d.types[0].type);
    } catch {}
    setLoading(false);
  }, [activeType]);

  const loadItems = useCallback(async (type: string) => {
    if (!type) return;
    setListLoading(true);
    try {
      const d = await api.get<{ items: LookupItem[] }>(`/api/lookups?type=${encodeURIComponent(type)}`);
      setItems(d.items || []);
    } catch { setItems([]); }
    setListLoading(false);
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);
  useEffect(() => { if (activeType) loadItems(activeType); }, [activeType, loadItems]);
  useSocket('lookup:changed', useCallback((p: any) => { if (p?.type === activeType) loadItems(activeType); }, [activeType, loadItems]));

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (it: LookupItem) => { setEditing(it); setForm({ nameEn: it.nameEn, nameAr: it.nameAr, color: it.color || '#f37121', isActive: it.isActive }); setShowModal(true); };

  const save = async () => {
    if (!form.nameEn.trim() && !form.nameAr.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/lookups/${editing._id}`, form);
      else await api.post('/api/lookups', { type: activeType, ...form });
      setShowModal(false);
      loadItems(activeType);
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const remove = async (it: LookupItem) => {
    if (it.isSystem) { alert(tx.cannotDeleteDefault); return; }
    if (!confirm(tx.confirmDelete)) return;
    try { await api.delete(`/api/lookups/${it._id}`); loadItems(activeType); } catch (e: any) { alert(e.message); }
  };

  const toggleActive = async (it: LookupItem) => { try { await api.put(`/api/lookups/${it._id}`, { isActive: !it.isActive }); loadItems(activeType); } catch (e: any) { alert(e.message); } };

  const exportItems = () => {
    exportToExcel(items, [
      { header: tx.colName, key: ar ? 'nameAr' : 'nameEn', width: 28 },
      { header: tx.colKey, key: 'key', width: 22 },
      { header: tx.colStatus, key: 'isActive', transform: (v: any) => (v ? tx.active : tx.inactive), width: 14 },
    ], 'reference-data', current ? (ar ? current.nameAr : current.nameEn) : tx.pageTitle);
  };

  if (!user) return <Spinner />;
  if (loading) return <Spinner />;
  if (!types.length) return <div className="text-slate-500 p-8">{tx.noLists}</div>;

  // Group types by module for the left rail.
  const grouped = types.reduce<Record<string, LookupType[]>>((acc, t) => { (acc[t.module] = acc[t.module] || []).push(t); return acc; }, {});

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Tags className="w-5 h-5" />} title={tx.pageTitle} subtitle={tx.pageSubtitle}>
        {!!items.length && <ExportButton onClick={exportItems} label={ar ? 'تصدير Excel' : 'Export Excel'} />}
        {canManage && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.addItem}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Left rail: lists grouped by module */}
        <div className="space-y-4">
          {Object.entries(grouped).map(([mod, list]) => (
            <div key={mod}>
              <p className="text-slate-500 text-xs font-semibold uppercase px-1 mb-1">{MODULE_LABELS[mod] ? (ar ? MODULE_LABELS[mod].ar : MODULE_LABELS[mod].en) : mod}</p>
              <div className="space-y-1">
                {list.map((t) => (
                  <button key={t.type} type="button" onClick={() => setActiveType(t.type)}
                    className={`w-full text-start px-3 py-2 rounded-lg text-sm transition-colors ${activeType === t.type ? 'bg-[#f37121]/20 text-[#f37121] font-medium' : 'text-slate-700 hover:bg-slate-100'}`}>
                    {ar ? t.nameAr : t.nameEn}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right: items table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto min-h-[200px] shadow-sm">
          {listLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
                <th className="text-start font-semibold px-4 py-3">{tx.colName}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.colKey}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
                <th className="text-end font-semibold px-4 py-3">{tx.colActions}</th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                    <td className="px-4 py-3 text-slate-900 font-medium">
                      <span className="inline-block w-3 h-3 rounded-full me-2 align-middle" style={{ background: it.color || '#f37121' }} />
                      {ar ? it.nameAr : it.nameEn}
                      {it.isSystem && <span className="ms-2 text-[10px] text-slate-700">{tx.defaultTag}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-mono text-xs">{it.key}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => canManage && toggleActive(it)} disabled={!canManage} className={canManage ? 'cursor-pointer' : 'cursor-default'}>
                        {it.isActive ? <SmallBadge bg="bg-green-500/20" text="text-green-600" label={tx.active} /> : <SmallBadge bg="bg-red-500/20" text="text-red-600" label={tx.inactive} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && <button type="button" onClick={() => openEdit(it)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100"><Edit className="w-4 h-4" /></button>}
                        {canManage && !it.isSystem && <button type="button" onClick={() => remove(it)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-800">{tx.noItems}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editItem : tx.newItem}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || (!form.nameEn.trim() && !form.nameAr.trim())}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tx.nameArabic}><TextInput value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
          <Field label={tx.nameEnglish}><TextInput value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} /></Field>
          <Field label={tx.color}><TextInput type="color" value={form.color} onChange={(e) => set('color', e.target.value)} /></Field>
          <Field label={tx.activeLabel}><Select value={form.isActive ? '1' : '0'} onChange={(e) => set('isActive', e.target.value === '1')}><option value="1">{tx.yes}</option><option value="0">{tx.no}</option></Select></Field>
        </div>
      </Modal>
    </div>
  );
}
