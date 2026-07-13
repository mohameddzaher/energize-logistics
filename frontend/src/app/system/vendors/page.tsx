'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Plus, Search, X, Check, Edit, Trash2, Loader2, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getVendorsTranslations, getVendorsExtraTranslations } from '@/lib/translations';

interface Vendor {
  _id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  category: string;
  totalPaid: number;
  totalOutstanding: number;
  isActive: boolean;
  notes: string;
  createdAt: string;
}

export default function VendorsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(user?.role || '');
  const { lang } = useLanguage();
  const T = getVendorsTranslations(lang);
  const txx = getVendorsExtraTranslations(lang);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '', address: '', category: '', notes: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const fetchVendors = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/vendors');
      setVendors(data.vendors || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  useSocket('vendor:created', useCallback(() => fetchVendors(), [fetchVendors]));
  useSocket('vendor:updated', useCallback(() => fetchVendors(), [fetchVendors]));
  useSocket('vendor:deleted', useCallback(() => fetchVendors(), [fetchVendors]));

  const openCreate = () => {
    setEditVendor(null);
    setForm({ name: '', contactPerson: '', phone: '', email: '', address: '', category: '', notes: '', isActive: true });
    setShowModal(true);
  };

  const openEdit = (v: Vendor) => {
    setEditVendor(v);
    setForm({ name: v.name, contactPerson: v.contactPerson || '', phone: v.phone || '', email: v.email || '', address: v.address || '', category: v.category || '', notes: v.notes || '', isActive: v.isActive });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editVendor) {
        await api.put(`/api/vendors/${editVendor._id}`, form);
      } else {
        await api.post('/api/vendors', form);
      }
      setShowModal(false);
      fetchVendors();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(T.deleteVendor)) return;
    try {
      await api.delete(`/api/vendors/${id}`);
      fetchVendors();
    } catch {}
  };

  const filtered = vendors.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.contactPerson && v.contactPerson.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Store className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{vendors.length} {T.xVendors}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => exportToExcel(filtered, [
            { header: 'Name', key: 'name', width: 22 },
            { header: 'Contact Person', key: 'contactPerson', width: 20 },
            { header: 'Phone', key: 'phone', width: 18 },
            { header: 'Email', key: 'email', width: 24 },
            { header: 'Address', key: 'address', width: 25 },
            { header: 'Category', key: 'category', width: 16 },
            { header: 'Total Paid', key: 'totalPaid', transform: fmt.money, width: 14 },
            { header: 'Total Outstanding', key: 'totalOutstanding', transform: fmt.money, width: 18 },
            { header: 'Status', key: 'isActive', transform: (v: boolean) => v ? 'Active' : 'Inactive', width: 10 },
            { header: 'Notes', key: 'notes', width: 25 },
            { header: 'Created At', key: 'createdAt', transform: fmt.date, width: 14 },
          ], `vendors-${new Date().toISOString().split('T')[0]}`, 'Vendors')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          {canEdit && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" />
              {T.addVendor}
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" placeholder={T.searchVendors} value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200">
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.name}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.contactPerson}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.phone}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.totalPaid}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.status}</th>
              {canEdit && <th className="text-end text-slate-300 font-semibold px-4 py-3">{T.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={canEdit ? 6 : 5} className="text-center text-slate-500 py-12">{T.noVendors}</td></tr>
            ) : filtered.map((v) => (
              <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors">
                <td className="px-4 py-3 text-slate-900 font-medium">{v.name}</td>
                <td className="px-4 py-3 text-slate-700">{v.contactPerson || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{v.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{(v.totalPaid || 0).toLocaleString()} {txx.sarUnit}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${v.isActive ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
                    {v.isActive ? T.active : T.inactive}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 transition-colors" title={T.edit}>
                        <Edit className="w-4 h-4" />
                      </button>
                      {isSuperAdmin && (
                        <button type="button" onClick={() => handleDelete(v._id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors" title={T.delete}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg">{editVendor ? T.editVendor : T.addVendor}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white" aria-label={T.close}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.vendorName + ' *'}</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.namePlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.contactPerson}</label>
                  <input type="text" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.contactPersonPlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.phone}</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.phonePlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.email}</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.emailPlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.address}</label>
                  <input type="text" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.addressPlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.category}</label>
                  <input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.categoryPlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.notes}</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={T.additionalNotes} />
                </div>
                {editVendor && (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="rounded border-slate-200" />
                    <label htmlFor="isActive" className="text-slate-700 text-sm">{T.active}</label>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{T.cancel}</button>
                <button type="button" onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editVendor ? T.save : T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
