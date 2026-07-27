'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Loader2, X, Check, Package, AlertCircle,
  ChevronLeft, ChevronRight, Download, Search, Trash2, ExternalLink, Boxes, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { exportToExcel, fmt } from '@/utils/exportExcel';
import { getWorkshopPurchasesTranslations } from '@/lib/translations';

interface PurchaseRequest {
  _id: string;
  itemName: string;
  quantity: number;
  vehicleNumber: string;
  requestedBy: string | { firstName?: string; lastName?: string };
  requestedByName?: string;
  date: string;
  status: 'pending' | 'received' | 'fulfilled';
  cost?: number;
  supplier?: string;
  invoiceNumber?: string;
  maintenanceId?: string;
  createdAt: string;
  // The stock line this delivery landed in — present once it has been received.
  inventoryItem?: { _id: string; code: string; name: string; quantity: number; unit?: string } | null;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  pending: { color: 'text-yellow-700', bg: 'bg-yellow-500/20' },
  received: { color: 'text-blue-600', bg: 'bg-blue-500/20' },
  fulfilled: { color: 'text-green-600', bg: 'bg-green-500/20' },
};

export default function WorkshopPurchasesPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const tx = getWorkshopPurchasesTranslations(lang);

  const statusLabels: Record<string, string> = {
    pending: tx.statusPending,
    received: tx.statusReceived,
    fulfilled: tx.statusFulfilled,
  };

  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  // Server-side search, so the box is debounced — otherwise every keystroke is
  // a request and a slow early one can land after a later one.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Creating a purchase used to be possible only from a maintenance job, so a
  // part bought off the shelf had nowhere to be recorded. `arrived` covers the
  // common case — it already came in — by receiving it in the same step, which
  // is what puts it in the store.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ itemName: '', quantity: '1', vehicleNumber: '', supplier: '', cost: '', invoiceNumber: '', description: '' });
  const [creating, setCreating] = useState(false);

  // Per-item loading state for Mark Received
  const [receivingIds, setReceivingIds] = useState<Set<string>>(new Set());



  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      params.append('page', String(page));
      params.append('limit', String(limit));
      const data = await api.get<any>(`/api/workshop/purchases?${params.toString()}`) || {};
      setPurchases(data.purchases || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  // WebSocket - refetch all data on any change for reliable updates
  const handleSocketRefresh = useCallback(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  useSocket('purchase:created', handleSocketRefresh);
  useSocket('purchase:received', handleSocketRefresh);
  useSocket('purchase:fulfilled', handleSocketRefresh);
  useSocket('purchase:deleted', handleSocketRefresh);
  useSocket('inventory:updated', handleSocketRefresh);

  // One click: the goods are here, put them in the store. The receive endpoint
  // is what adds the quantity (creating the stock line when the part is new).
  const receiveDirect = async (id: string) => {
    setReceivingIds((prev) => new Set(prev).add(id));
    try {
      await api.put(`/api/workshop/purchases/${id}/receive`, {});
      notify(isAr ? 'تم الاستلام وإضافته إلى المستودع.' : 'Received and added to the store.', 'success');
      fetchPurchases();
    } catch (e: any) { setError(e.message); }
    setReceivingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  // Role list OR a permissions-matrix EDIT grant on Workshop (the backend
  // rbac honours the grant, so hiding the button here just strands the user).
  const canCreate = user && (['super_admin', 'workshop_manager', 'workshop_employee', 'purchasing'].includes(user.role)
    || canEditSection((user as any)?.permissions, 'Workshop'));
  const submitCreate = async () => {
    if (!createForm.itemName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<any>('/api/workshop/purchases', {
        itemName: createForm.itemName.trim(),
        quantity: Math.max(1, Number(createForm.quantity) || 1),
        vehicleNumber: createForm.vehicleNumber.trim(),
        supplier: createForm.supplier.trim(),
        cost: createForm.cost ? Number(createForm.cost) : undefined,
        invoiceNumber: createForm.invoiceNumber.trim(),
        description: createForm.description.trim(),
      });
      // Recording IS receiving — the server puts it straight into the store in
      // the same call. One step, nothing staged, nothing to fail halfway.
      notify(isAr ? 'تم التسجيل وإضافته إلى المستودع.' : 'Recorded and added to the store.', 'success');
      setCreateOpen(false);
      setCreateForm({ itemName: '', quantity: '1', vehicleNumber: '', supplier: '', cost: '', invoiceNumber: '', description: '' });
      fetchPurchases();
    } catch (e: any) { setError(e.message); }
    setCreating(false);
  };

  // Deleting undoes what the request did to stock, so spell that out before
  // asking — "delete" reads as harmless until it silently moves the shelf count.
  const canDelete = user && ['super_admin', 'workshop_manager'].includes(user.role);
  const deletePurchase = async (p: PurchaseRequest) => {
    const warn = p.status === 'received'
      ? (isAr
        ? `سيتم أيضاً خصم ${p.quantity} من رصيد «${p.inventoryItem?.name || p.itemName}» في المستودع، لأن هذا الطلب هو الذي أضافها.`
        : `This will also remove ${p.quantity} from “${p.inventoryItem?.name || p.itemName}” in the store, because this request is what added them.`)
      : p.status === 'fulfilled'
        ? (isAr ? 'تم صرف هذه القطع بالفعل، فلن يتأثر رصيد المستودع.' : 'These parts were already issued, so stock is unaffected.')
        : (isAr ? 'لم يصل هذا الطلب بعد، فلن يتأثر رصيد المستودع.' : 'This request never arrived, so stock is unaffected.');
    if (!(await confirm(`${isAr ? 'حذف طلب' : 'Delete'} «${p.itemName}»؟\n\n${warn}`))) return;
    setDeletingId(p._id);
    try {
      await api.delete(`/api/workshop/purchases/${p._id}`);
      fetchPurchases();
    } catch (e: any) { setError(e.message); }
    setDeletingId(null);
  };






  const handleExport = () => {
    exportToExcel(purchases, [
      { header: 'Item', key: 'itemName', width: 25 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Vehicle #', key: 'vehicleNumber', width: 15 },
      { header: 'Requested By', key: 'requestedByName', width: 20 },
      { header: 'Date', key: 'date', transform: fmt.date, width: 15 },
      { header: 'Status', key: 'status', transform: fmt.status, width: 15 },
      { header: 'Cost', key: 'cost', transform: fmt.money, width: 12 },
      { header: 'Supplier', key: 'supplier', width: 20 },
      { header: 'Invoice #', key: 'invoiceNumber', width: 15 },
    ], 'workshop-purchases', 'Purchases');
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-slate-900">{tx.pageTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={purchases.length === 0}
          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-900 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {tx.export}
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e06010] text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {isAr ? 'تسجيل شراء' : 'Record a purchase'}
          </button>
        )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-red-600 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ms-auto text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'بحث بالصنف أو المركبة أو المورّد أو رقم الفاتورة…' : 'Search item, vehicle, supplier or invoice…'}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-white border border-slate-200 rounded-lg text-slate-900 text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        >
          <option value="">{tx.allStatus}</option>
          <option value="pending">{tx.statusPending}</option>
          <option value="received">{tx.statusReceived}</option>
          <option value="fulfilled">{tx.statusFulfilled}</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{tx.emptyState}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                {[
                  tx.colItem,
                  tx.colQty,
                  tx.colVehicle,
                  tx.colRequestedBy,
                  tx.colDate,
                  tx.colStatus,
                  tx.colCost,
                  tx.colSupplier,
                  isAr ? 'في المستودع' : 'In store',
                  tx.colActions,
                ].map((h, i) => (
                  <th key={i} className="text-start text-slate-300 font-semibold py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map(p => {
                const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending;
                return (
                  <tr key={p._id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 text-slate-900 font-medium">{p.itemName}</td>
                    <td className="py-3 px-3 text-slate-700">{p.quantity}</td>
                    <td className="py-3 px-3 text-slate-700">{p.vehicleNumber || '-'}</td>
                    <td className="py-3 px-3 text-slate-700">{p.requestedByName || (typeof p.requestedBy === 'object' && p.requestedBy ? `${(p.requestedBy as {firstName?: string; lastName?: string}).firstName || ''} ${(p.requestedBy as {firstName?: string; lastName?: string}).lastName || ''}`.trim() : '') || '-'}</td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                      {new Date(p.date || p.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {statusLabels[p.status] || statusLabels.pending}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-700">{p.cost ? `${p.cost.toLocaleString()}` : '-'}</td>
                    <td className="py-3 px-3 text-slate-700">{p.supplier || '-'}</td>
                    {/* Closes the loop: did this delivery actually reach the shelf? */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {p.inventoryItem ? (
                        <Link href="/system/workshop/store"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 text-xs font-medium">
                          <Boxes className="w-3 h-3" />
                          {p.inventoryItem.name} · {p.inventoryItem.quantity}
                        </Link>
                      ) : p.status === 'pending' ? (
                        <span className="text-slate-400 text-xs">{isAr ? 'لم يصل بعد' : 'Not arrived'}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {/* The staged pending → preparing → ready-for-pickup desk is
                            gone: a purchase is recorded once the goods are in hand.
                            Pending rows still arrive from maintenance jobs, so they
                            keep ONE action — into the store, one click. */}
                        {p.status === 'pending' && (
                          <button
                            onClick={() => receiveDirect(p._id)}
                            disabled={receivingIds.has(p._id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30 text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {receivingIds.has(p._id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />}
                            {isAr ? 'استلام للمستودع' : 'Receive into store'}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => deletePurchase(p)}
                            disabled={deletingId === p._id}
                            title={isAr ? 'حذف الطلب' : 'Delete request'}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            {deletingId === p._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">{isAr ? `${total} ${tx.results}` : `${total} ${tx.results}`}</p>
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


      {/* Record a purchase. Two things happen here depending on "already
          arrived": either a request is logged for later receipt, or it is
          received on the spot and lands in the store immediately. */}
      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setCreateOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <h2 className="text-lg font-bold text-slate-900">{isAr ? 'تسجيل شراء' : 'Record a purchase'}</h2>
                <button type="button" onClick={() => setCreateOpen(false)} className="text-slate-500 hover:text-slate-900" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الصنف *' : 'Item *'}</label>
                    <input value={createForm.itemName} onChange={(e) => setCreateForm((f) => ({ ...f, itemName: e.target.value }))}
                      placeholder={isAr ? 'مثال: فلتر زيت' : 'e.g. Oil filter'}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'الكمية' : 'Quantity'}</label>
                    <input type="number" min={1} value={createForm.quantity} onChange={(e) => setCreateForm((f) => ({ ...f, quantity: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'رقم المركبة (اختياري)' : 'Vehicle number (optional)'}</label>
                    <input value={createForm.vehicleNumber} onChange={(e) => setCreateForm((f) => ({ ...f, vehicleNumber: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'المورّد' : 'Supplier'}</label>
                    <input value={createForm.supplier} onChange={(e) => setCreateForm((f) => ({ ...f, supplier: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'التكلفة الإجمالية' : 'Total cost'}</label>
                    <input type="number" min={0} value={createForm.cost} onChange={(e) => setCreateForm((f) => ({ ...f, cost: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'رقم الفاتورة' : 'Invoice number'}</label>
                    <input value={createForm.invoiceNumber} onChange={(e) => setCreateForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-slate-500 text-sm block mb-1">{isAr ? 'ملاحظات' : 'Notes'}</label>
                    <textarea rows={2} value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" onClick={submitCreate} disabled={creating || !createForm.itemName.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e06010] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {isAr ? 'تسجيل وإضافة للمستودع' : 'Record and add to store'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
