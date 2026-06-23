'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus, Search, X, Check, Edit, Trash2, Loader2, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getBranchesTranslations, getBranchesExtraTranslations } from '@/lib/translations';

interface Branch {
  _id: string;
  name: string;
  code: string;
  city: string;
  isActive: boolean;
  createdAt: string;
}

export default function BranchesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const { lang } = useLanguage();
  const T = getBranchesTranslations(lang);
  const txx = getBranchesExtraTranslations(lang);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: '', code: '', city: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const fetchBranches = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/branches');
      setBranches(data.branches || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  useSocket('branch:created', useCallback(() => fetchBranches(), [fetchBranches]));
  useSocket('branch:updated', useCallback(() => fetchBranches(), [fetchBranches]));
  useSocket('branch:deleted', useCallback(() => fetchBranches(), [fetchBranches]));

  const openCreate = () => {
    setEditBranch(null);
    setForm({ name: '', code: '', city: '', isActive: true });
    setShowModal(true);
  };

  const openEdit = (b: Branch) => {
    setEditBranch(b);
    setForm({ name: b.name, code: b.code || '', city: b.city || '', isActive: b.isActive });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editBranch) {
        await api.put(`/api/branches/${editBranch._id}`, form);
      } else {
        await api.post('/api/branches', form);
      }
      setShowModal(false);
      fetchBranches();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(T.deleteBranch)) return;
    try {
      await api.delete(`/api/branches/${id}`);
      fetchBranches();
    } catch {}
  };

  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.code && b.code.toLowerCase().includes(search.toLowerCase())) ||
    (b.city && b.city.toLowerCase().includes(search.toLowerCase()))
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
            <Building2 className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{branches.length} {T.xBranches}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => exportToExcel(filtered, [
            { header: T.name, key: 'name', width: 20 },
            { header: T.code, key: 'code', width: 10 },
            { header: T.city, key: 'city', width: 16 },
            { header: T.status, key: 'isActive', transform: (v: boolean) => v ? T.active : T.inactive, width: 10 },
            { header: T.createdAt, key: 'createdAt', transform: fmt.date, width: 14 },
          ], `branches-${new Date().toISOString().split('T')[0]}`, 'Branches')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm transition-colors">
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          {isSuperAdmin && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" />
              {T.addBranch}
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" placeholder={T.searchBranches} value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200">
              <th className="text-left text-slate-300 font-semibold px-4 py-3">{T.name}</th>
              <th className="text-left text-slate-300 font-semibold px-4 py-3">{T.code}</th>
              <th className="text-left text-slate-300 font-semibold px-4 py-3">{T.city}</th>
              <th className="text-left text-slate-300 font-semibold px-4 py-3">{T.status}</th>
              {isSuperAdmin && <th className="text-right text-slate-300 font-semibold px-4 py-3">{T.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={isSuperAdmin ? 5 : 4} className="text-center text-slate-500 py-12">{T.noBranches}</td></tr>
            ) : filtered.map((b) => (
              <tr key={b._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors">
                <td className="px-4 py-3 text-slate-900 font-medium">{b.name}</td>
                <td className="px-4 py-3 text-slate-700">{b.code || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{b.city || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${b.isActive ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
                    {b.isActive ? T.active : T.inactive}
                  </span>
                </td>
                {isSuperAdmin && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(b)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 transition-colors" title={T.edit}>
                        <Edit className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(b._id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors" title={T.delete}>
                        <Trash2 className="w-4 h-4" />
                      </button>
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
                <h2 className="text-white font-bold text-lg">{editBranch ? T.editBranch : T.addBranch}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white" aria-label={T.close}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.branchName + ' *'}</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.placeholderCity} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.code}</label>
                  <input type="text" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.placeholderCode} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.city}</label>
                  <input type="text" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.placeholderCity} />
                </div>
                {editBranch && (
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
                  {editBranch ? T.save : T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
