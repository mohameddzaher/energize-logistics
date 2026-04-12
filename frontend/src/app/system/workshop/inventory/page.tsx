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
  const isAr = lang === 'ar';

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
      setError(isAr ? 'الكود والاسم مطلوبان' : 'Code and name are required');
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
      { header: isAr ? 'الكود' : 'Code', key: 'code', width: 15 },
      { header: isAr ? 'الاسم' : 'Name', key: 'name', width: 25 },
      { header: isAr ? 'الفئة' : 'Category', key: 'category', width: 15 },
      { header: isAr ? 'الكمية' : 'Quantity', key: 'quantity', width: 10 },
      { header: isAr ? 'الحد الأدنى' : 'Min Qty', key: 'minQuantity', width: 10 },
      { header: isAr ? 'الوحدة' : 'Unit', key: 'unit', width: 10 },
      { header: isAr ? 'سعر التكلفة' : 'Cost Price', key: 'costPrice', transform: fmt.money, width: 12 },
      { header: isAr ? 'الموقع' : 'Location', key: 'location', width: 15 },
      { header: isAr ? 'المورد' : 'Supplier', key: 'supplier', width: 20 },
      { header: isAr ? 'ملاحظات' : 'Notes', key: 'notes', width: 25 },
    ], 'inventory', isAr ? 'المخزون' : 'Inventory');
  };

  // Collect unique categories for filter
  const categories = Array.from(new Set(items.map(i => i.category).filter(Boolean)));

  const totalPages = Math.ceil(total / limit);

  const inputClass = 'w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]';
  const labelClass = 'text-gray-400 text-sm block mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Package className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-white">{isAr ? 'المخزون' : 'Inventory'}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={items.length === 0}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isAr ? 'تصدير' : 'Export'}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e06010] text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {isAr ? 'إضافة صنف' : 'Add Item'}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={isAr ? 'بحث بالاسم أو الكود...' : 'Search by name or code...'}
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm pl-10 pr-3 py-2.5 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        >
          <option value="">{isAr ? 'كل الفئات' : 'All Categories'}</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {canApprove && (
          <select
            value={approvalFilter}
            onChange={e => { setApprovalFilter(e.target.value); setPage(1); }}
            aria-label={isAr ? 'تصفية حالة الموافقة' : 'Filter by approval status'}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
          >
            <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
            <option value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
            <option value="approved">{isAr ? 'موافق عليه' : 'Approved'}</option>
            <option value="rejected">{isAr ? 'مرفوض' : 'Rejected'}</option>
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد أصناف في المخزون' : 'No inventory items found'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {[
                  isAr ? 'الكود' : 'Code',
                  isAr ? 'الاسم' : 'Name',
                  isAr ? 'الفئة' : 'Category',
                  isAr ? 'الكمية' : 'Qty',
                  isAr ? 'الحد الأدنى' : 'Min',
                  isAr ? 'الوحدة' : 'Unit',
                  isAr ? 'التكلفة' : 'Cost',
                  isAr ? 'الموقع' : 'Location',
                  isAr ? 'المورد' : 'Supplier',
                  isAr ? 'الموافقة' : 'Approval',
                  isAr ? 'إجراءات' : 'Actions',
                ].map((h, i) => (
                  <th key={i} className="text-left text-gray-400 font-medium py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item._id}
                  className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${item.lowStock ? 'bg-red-500/5' : ''}`}
                >
                  <td className="py-3 px-3 text-gray-300 font-mono text-xs">{item.code}</td>
                  <td className="py-3 px-3 text-white font-medium">
                    <div className="flex items-center gap-2">
                      {item.name}
                      {item.lowStock && (
                        <span className="flex items-center gap-1 text-orange-400" title={isAr ? 'مخزون منخفض' : 'Low Stock'}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-300">{item.category || '-'}</td>
                  <td className={`py-3 px-3 font-medium ${item.lowStock ? 'text-orange-400' : 'text-gray-300'}`}>
                    {item.quantity}
                  </td>
                  <td className="py-3 px-3 text-gray-400">{item.minQuantity}</td>
                  <td className="py-3 px-3 text-gray-300">{item.unit}</td>
                  <td className="py-3 px-3 text-gray-300">{item.costPrice ? item.costPrice.toLocaleString() : '-'}</td>
                  <td className="py-3 px-3 text-gray-300">{item.location || '-'}</td>
                  <td className="py-3 px-3 text-gray-300">{item.supplier || '-'}</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      {item.approvalStatus === 'approved' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                          {isAr ? 'موافق عليه' : 'Approved'}
                        </span>
                      )}
                      {item.approvalStatus === 'rejected' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                          {isAr ? 'مرفوض' : 'Rejected'}
                        </span>
                      )}
                      {(!item.approvalStatus || item.approvalStatus === 'pending') && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
                          {isAr ? 'قيد الانتظار' : 'Pending Approval'}
                        </span>
                      )}
                      {canApprove && (!item.approvalStatus || item.approvalStatus === 'pending') && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApproval(item._id, 'approved')}
                            disabled={approving === item._id}
                            className="p-1 rounded-md bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                            title={isAr ? 'موافقة' : 'Approve'}
                          >
                            {approving === item._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRejectModalId(item._id); setRejectNote(''); }}
                            disabled={approving === item._id}
                            className="p-1 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                            title={isAr ? 'رفض' : 'Reject'}
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
                          className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                          title={isAr ? 'تعديل' : 'Edit'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleteId(item._id)}
                          className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          title={isAr ? 'حذف' : 'Delete'}
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
          <p className="text-gray-400 text-sm">{isAr ? `${total} نتيجة` : `${total} results`}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-400 text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">
                    {editingId
                      ? (isAr ? 'تعديل صنف' : 'Edit Item')
                      : (isAr ? 'إضافة صنف جديد' : 'Add New Item')
                    }
                  </h2>
                  <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{isAr ? 'الكود' : 'Code'} *</label>
                    <input type="text" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الاسم' : 'Name'} *</label>
                    <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الفئة' : 'Category'}</label>
                    <input type="text" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الكمية' : 'Quantity'}</label>
                    <input type="number" min={0} value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الحد الأدنى' : 'Min Quantity'}</label>
                    <input type="number" min={0} value={form.minQuantity} onChange={e => setForm(p => ({ ...p, minQuantity: parseInt(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الوحدة' : 'Unit'}</label>
                    <input type="text" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'سعر التكلفة' : 'Cost Price'}</label>
                    <input type="number" min={0} step="0.01" value={form.costPrice} onChange={e => setForm(p => ({ ...p, costPrice: parseFloat(e.target.value) || 0 }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'الموقع' : 'Location'}</label>
                    <input type="text" value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{isAr ? 'المورد' : 'Supplier'}</label>
                    <input type="text" value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputClass} />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingId
                      ? (isAr ? 'حفظ التعديلات' : 'Save Changes')
                      : (isAr ? 'إضافة' : 'Add Item')
                    }
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold">{isAr ? 'تأكيد الحذف' : 'Confirm Delete'}</h3>
                    <p className="text-gray-400 text-sm">{isAr ? 'هل أنت متأكد من حذف هذا الصنف؟' : 'Are you sure you want to delete this item?'}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isAr ? 'حذف' : 'Delete'}
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold">{isAr ? 'رفض الصنف' : 'Reject Item'}</h3>
                    <p className="text-gray-400 text-sm">{isAr ? 'أضف ملاحظة (اختياري)' : 'Add a note (optional)'}</p>
                  </div>
                </div>
                <textarea
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder={isAr ? 'سبب الرفض...' : 'Reason for rejection...'}
                  rows={3}
                  className={inputClass}
                />
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setRejectModalId(null)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproval(rejectModalId, 'rejected', rejectNote || undefined)}
                    disabled={approving === rejectModalId}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {approving === rejectModalId && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isAr ? 'رفض' : 'Reject'}
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
