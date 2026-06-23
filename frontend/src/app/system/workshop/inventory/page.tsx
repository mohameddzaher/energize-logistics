'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package, Loader2, X, Plus, Pencil, Trash2, AlertCircle,
  ChevronLeft, ChevronRight, Download, Search, AlertTriangle,
  Check, XCircle,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { getWorkshopInventoryTranslations } from '@/lib/translations';

interface InventoryItem {
  _id: string;
  code: string;
  name: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  costPrice: number;
  location: string;
  supplier: string;
  notes: string;
  lowStock: boolean;
  createdAt: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
}

const EMPTY_FORM = {
  code: '',
  name: '',
  category: '',
  quantity: 0,
  minQuantity: 0,
  unit: 'piece',
  costPrice: 0,
  location: '',
  supplier: '',
  notes: '',
};

export default function InventoryPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const tx = getWorkshopInventoryTranslations(lang);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Approval state
  const [approvalFilter, setApprovalFilter] = useState('');
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [approving, setApproving] = useState<string | null>(null);

  const canEdit = user && ['super_admin', 'workshop_manager', 'purchasing'].includes(user.role);
  const canDelete = user && ['super_admin', 'workshop_manager'].includes(user.role);
  const canApprove = user && ['super_admin', 'workshop_manager'].includes(user.role);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (categoryFilter) params.append('category', categoryFilter);
      if (approvalFilter) params.append('approvalStatus', approvalFilter);
      params.append('page', String(page));
      params.append('limit', String(limit));
      const data = await api.get<any>(`/api/workshop/inventory?${params.toString()}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, categoryFilter, approvalFilter, page]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // WebSocket handlers
  const handleCreated = useCallback((item: InventoryItem) => {
    setItems(prev => [{ ...item, lowStock: item.quantity <= item.minQuantity }, ...prev]);
    setTotal(t => t + 1);
  }, []);

  const handleUpdated = useCallback((item: InventoryItem) => {
    setItems(prev => prev.map(x =>
      x._id === item._id ? { ...item, lowStock: item.quantity <= item.minQuantity } : x
    ));
  }, []);

  const handleDeleted = useCallback((data: { _id: string }) => {
    setItems(prev => prev.filter(x => x._id !== data._id));
    setTotal(t => Math.max(0, t - 1));
  }, []);

  useSocket('inventory:created', handleCreated);
  useSocket('inventory:updated', handleUpdated);
  useSocket('inventory:deleted', handleDeleted);

  const openAddModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingId(item._id);
    setForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || '',
      quantity: item.quantity || 0,
      minQuantity: item.minQuantity || 0,
      unit: item.unit || 'piece',
      costPrice: item.costPrice || 0,
      location: item.location || '',
      supplier: item.supplier || '',
      notes: item.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError(tx.codeNameRequired);
      return;
    }
    try {
      setSaving(true);
      if (editingId) {
        await api.put(`/api/workshop/inventory/${editingId}`, form);
      } else {
        await api.post('/api/workshop/inventory', form);
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      setDeleting(true);
      await api.delete(`/api/workshop/inventory/${deleteId}`);
      setDeleteId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleApproval = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    try {
      setApproving(id);
      await api.put(`/api/workshop/inventory/${id}/approve`, { status, ...(note ? { note } : {}) });
      setItems(prev => prev.map(x => x._id === id ? { ...x, approvalStatus: status } : x));
      setRejectModalId(null);
      setRejectNote('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApproving(null);
    }
  };

  const handleExport = () => {
    exportToExcel(items, [
      { header: tx.colCode, key: 'code', width: 15 },
      { header: tx.colName, key: 'name', width: 25 },
      { header: tx.colCategory, key: 'category', width: 15 },
      { header: tx.colQuantity, key: 'quantity', width: 10 },
      { header: tx.colMinQty, key: 'minQuantity', width: 10 },
      { header: tx.colUnit, key: 'unit', width: 10 },
      { header: tx.colCostPrice, key: 'costPrice', transform: fmt.money, width: 12 },
      { header: tx.colLocation, key: 'location', width: 15 },
      { header: tx.colSupplier, key: 'supplier', width: 20 },
      { header: tx.colNotes, key: 'notes', width: 25 },
    ], 'inventory', tx.pageTitle);
  };

  // Collect unique categories for filter
  const categories = Array.from(new Set(items.map(i => i.category).filter(Boolean)));

  const totalPages = Math.ceil(total / limit);

  const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]';
  const labelClass = 'text-slate-500 text-sm block mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Package className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-slate-900">{tx.pageTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={items.length === 0}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-900 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {tx.export}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e06010] text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {tx.addItem}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-red-600 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder={tx.searchPlaceholder}
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 text-sm pl-10 pr-3 py-2.5 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="w-full sm:w-44 shrink-0 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        >
          <option value="">{tx.allCategories}</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {canApprove && (
          <select
            value={approvalFilter}
            onChange={e => { setApprovalFilter(e.target.value); setPage(1); }}
            aria-label={tx.filterByApproval}
            className="w-full sm:w-44 shrink-0 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
          >
            <option value="">{tx.allStatuses}</option>
            <option value="pending">{tx.pending}</option>
            <option value="approved">{tx.approved}</option>
            <option value="rejected">{tx.rejected}</option>
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{tx.noItems}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                {[
                  tx.colCode,
                  tx.colName,
                  tx.colCategory,
                  tx.thQty,
                  tx.thMin,
                  tx.colUnit,
                  tx.thCost,
                  tx.colLocation,
                  tx.colSupplier,
                  tx.thApproval,
                  tx.thActions,
                ].map((h, i) => (
                  <th key={i} className="text-left text-slate-300 font-semibold py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item._id}
                  className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${item.lowStock ? 'bg-red-500/5' : ''}`}
                >
                  <td className="py-3 px-3 text-slate-700 font-mono text-xs">{item.code}</td>
                  <td className="py-3 px-3 text-slate-900 font-medium">
                    <div className="flex items-center gap-2">
                      {item.name}
                      {item.lowStock && (
                        <span className="flex items-center gap-1 text-orange-600" title={tx.lowStock}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-700">{item.category || '-'}</td>
                  <td className={`py-3 px-3 font-medium ${item.lowStock ? 'text-orange-600' : 'text-slate-700'}`}>
                    {item.quantity}
                  </td>
                  <td className="py-3 px-3 text-slate-500">{item.minQuantity}</td>
                  <td className="py-3 px-3 text-slate-700">{item.unit}</td>
                  <td className="py-3 px-3 text-slate-700">{item.costPrice ? item.costPrice.toLocaleString() : '-'}</td>
                  <td className="py-3 px-3 text-slate-700">{item.location || '-'}</td>
                  <td className="py-3 px-3 text-slate-700">{item.supplier || '-'}</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      {item.approvalStatus === 'approved' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-600">
                          {tx.approved}
                        </span>
                      )}
                      {item.approvalStatus === 'rejected' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-600">
                          {tx.rejected}
                        </span>
                      )}
                      {(!item.approvalStatus || item.approvalStatus === 'pending') && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-700">
                          {tx.pendingApproval}
                        </span>
                      )}
                      {canApprove && (!item.approvalStatus || item.approvalStatus === 'pending') && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApproval(item._id, 'approved')}
                            disabled={approving === item._id}
                            className="p-1 rounded-md bg-green-500/20 text-green-600 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                            title={tx.approve}
                          >
                            {approving === item._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRejectModalId(item._id); setRejectNote(''); }}
                            disabled={approving === item._id}
                            className="p-1 rounded-md bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                            title={tx.reject}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <button
                          onClick={() => openEditModal(item)}
                          className="p-1.5 rounded-lg bg-blue-500/20 text-blue-600 hover:bg-blue-500/30 transition-colors"
                          title={tx.edit}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleteId(item._id)}
                          className="p-1.5 rounded-lg bg-red-500/20 text-red-600 hover:bg-red-500/30 transition-colors"
                          title={tx.delete}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">{`${total} ${tx.resultsSuffix}`}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-500 text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 rounded-lg bg-white text-slate-500 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">
                    {editingId ? tx.editItem : tx.addNewItem}
                  </h2>
                  <button onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{tx.colCode} *</label>
                    <input type="text" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colName} *</label>
                    <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colCategory}</label>
                    <input type="text" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colQuantity}</label>
                    <input type="number" min={0} value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.minQuantity}</label>
                    <input type="number" min={0} value={form.minQuantity} onChange={e => setForm(p => ({ ...p, minQuantity: parseInt(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colUnit}</label>
                    <input type="text" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colCostPrice}</label>
                    <input type="number" min={0} step="0.01" value={form.costPrice} onChange={e => setForm(p => ({ ...p, costPrice: parseFloat(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colLocation}</label>
                    <input type="text" value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{tx.colSupplier}</label>
                    <input type="text" value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>{tx.colNotes}</label>
                    <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputClass} />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingId ? tx.saveChanges : tx.add}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {deleteId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold mb-3">{tx.confirmDelete}</h3>
                    <p className="text-slate-500 text-sm">{tx.deleteConfirmText}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {tx.delete}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Reject Modal */}
      <AnimatePresence>
        {rejectModalId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setRejectModalId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold mb-3">{tx.rejectItem}</h3>
                    <p className="text-slate-500 text-sm">{tx.addNoteOptional}</p>
                  </div>
                </div>
                <textarea
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder={tx.rejectionReasonPlaceholder}
                  rows={3}
                  className={inputClass}
                />
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setRejectModalId(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproval(rejectModalId, 'rejected', rejectNote || undefined)}
                    disabled={approving === rejectModalId}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {approving === rejectModalId && <Loader2 className="w-4 h-4 animate-spin" />}
                    {tx.reject}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
