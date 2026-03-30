'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Truck, Plus, Search, X, Check, Edit, Trash2, Loader2, Download } from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { useLanguage } from '@/context/LanguageContext';
import { getDriversTranslations } from '@/lib/translations';

interface Branch {
  _id: string;
  name: string;
}

interface Driver {
  _id: string;
  name: string;
  phone: string;
  idNumber: string;
  branch: { _id: string; name: string };
  totalPaid: number;
  isActive: boolean;
  notes: string;
  createdAt: string;
}

export default function DriversPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(user?.role || '');
  const { lang } = useLanguage();
  const T = getDriversTranslations(lang);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', idNumber: '', branch: '', notes: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDrivers = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/drivers');
      setDrivers(data.drivers || []);
    } catch {}
    setLoading(false);
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/branches?active=true');
      setBranches(data.branches || []);
    } catch {}
  }, []);

  useEffect(() => { fetchDrivers(); fetchBranches(); }, [fetchDrivers, fetchBranches]);

  useSocket('driver:created', useCallback(() => fetchDrivers(), [fetchDrivers]));
  useSocket('driver:updated', useCallback(() => fetchDrivers(), [fetchDrivers]));
  useSocket('driver:deleted', useCallback(() => fetchDrivers(), [fetchDrivers]));

  const openCreate = () => {
    setEditDriver(null);
    setForm({ name: '', phone: '', idNumber: '', branch: '', notes: '', isActive: true });
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    setEditDriver(d);
    setForm({ name: d.name, phone: d.phone || '', idNumber: d.idNumber || '', branch: d.branch?._id || '', notes: d.notes || '', isActive: d.isActive });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editDriver) {
        await api.put(`/api/drivers/${editDriver._id}`, form);
      } else {
        await api.post('/api/drivers', form);
      }
      setShowModal(false);
      fetchDrivers();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(T.deleteDriver)) return;
    try {
      await api.delete(`/api/drivers/${id}`);
      fetchDrivers();
    } catch {}
  };

  const filtered = drivers.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
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
            <Truck className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{T.title}</h1>
            <p className="text-gray-400 text-sm">{drivers.length} {T.xDrivers}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => exportToExcel(filtered, [
            { header: 'Name', key: 'name', width: 20 },
            { header: 'Phone', key: 'phone', width: 16 },
            { header: 'ID Number', key: 'idNumber', width: 16 },
            { header: 'Branch', key: 'branch.name', width: 16 },
            { header: 'Total Paid', key: 'totalPaid', transform: fmt.money, width: 14 },
            { header: 'Status', key: 'isActive', transform: (v: boolean) => v ? 'Active' : 'Inactive', width: 10 },
            { header: 'Notes', key: 'notes', width: 25 },
            { header: 'Created At', key: 'createdAt', transform: fmt.date, width: 14 },
          ], `drivers-${new Date().toISOString().split('T')[0]}`, 'Drivers')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">
            <Download className="w-4 h-4" /> {T.downloadExcel}
          </button>
          {canEdit && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" />
              {T.addDriver}
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder={T.searchDrivers} value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.name}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.phone}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.idNumber}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.branch}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.totalPaid}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{T.status}</th>
              {(canEdit || isSuperAdmin) && <th className="text-right text-gray-400 font-medium px-4 py-3">{T.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={(canEdit || isSuperAdmin) ? 8 : 6} className="text-center text-gray-400 py-12">{T.noDrivers}</td></tr>
            ) : filtered.map((d) => (
              <tr key={d._id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                <td className="px-4 py-3 text-white font-medium">{d.name}</td>
                <td className="px-4 py-3 text-gray-300">{d.phone || '—'}</td>
                <td className="px-4 py-3 text-gray-300">{d.idNumber || '—'}</td>
                <td className="px-4 py-3 text-gray-300">{d.branch?.name || '—'}</td>
                <td className="px-4 py-3 text-gray-300">{(d.totalPaid || 0).toLocaleString()} SAR</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${d.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {d.isActive ? T.active : T.inactive}
                  </span>
                </td>
                {(canEdit || isSuperAdmin) && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(d)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#f37121] hover:bg-gray-700 transition-colors" title="Edit">
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button type="button" onClick={() => handleDelete(d._id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors" title="Delete">
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
              onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg">{editDriver ? T.editDriver : T.addDriver}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{T.driverName + ' *'}</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="e.g. Ahmed Ali" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{T.phone}</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="e.g. 0501234567" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{T.idNumber}</label>
                  <input type="text" value={form.idNumber} onChange={(e) => setForm((f) => ({ ...f, idNumber: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder="e.g. 1234567890" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{T.branch}</label>
                  <select value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                    <option value="">{T.selectBranch}</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">{T.notes}</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={T.optionalNotes} />
                </div>
                {editDriver && (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="rounded border-gray-700" />
                    <label htmlFor="isActive" className="text-gray-300 text-sm">{T.active}</label>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{T.cancel}</button>
                <button type="button" onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editDriver ? T.save : T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
