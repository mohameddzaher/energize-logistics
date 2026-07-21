'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
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

interface InventorySearchItem {
  _id: string;
  name: string;
  code: string;
  quantity: number;
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
  const [createForm, setCreateForm] = useState({ itemName: '', quantity: '1', vehicleNumber: '', supplier: '', cost: '', invoiceNumber: '', description: '', arrived: true });
  const [creating, setCreating] = useState(false);

  // Per-item loading state for Mark Received
  const [receivingIds, setReceivingIds] = useState<Set<string>>(new Set());

  // Acknowledge modal
  const [acknowledgeModal, setAcknowledgeModal] = useState<string | null>(null);
  const [inStock, setInStock] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryResults, setInventoryResults] = useState<InventorySearchItem[]>([]);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventorySearchItem | null>(null);
  const [searchingInventory, setSearchingInventory] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fulfill modal
  const [fulfillModal, setFulfillModal] = useState<string | null>(null);
  const [fulfillForm, setFulfillForm] = useState({ cost: '', supplier: '', invoiceNumber: '' });
  const [fulfilling, setFulfilling] = useState(false);

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

  const canCreate = user && ['super_admin', 'workshop_manager', 'workshop_employee', 'purchasing'].includes(user.role);
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
      // Already in hand → receive it now, which is the step that adds it to stock.
      if (createForm.arrived && created?._id) {
        await api.put(`/api/workshop/purchases/${created._id}/receive`, {});
        notify(isAr ? 'تم التسجيل وإضافته إلى المستودع.' : 'Recorded and added to the store.', 'success');
      } else {
        notify(isAr ? 'تم تسجيل الطلب.' : 'Request recorded.', 'success');
      }
      setCreateOpen(false);
      setCreateForm({ itemName: '', quantity: '1', vehicleNumber: '', supplier: '', cost: '', invoiceNumber: '', description: '', arrived: true });
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

  const searchInventoryItems = async (term: string) => {
    if (!term || term.length < 2) {
      setInventoryResults([]);
      return;
    }
    try {
      setSearchingInventory(true);
      const results = await api.get<InventorySearchItem[]>(`/api/workshop/inventory/search?q=${encodeURIComponent(term)}`);
      setInventoryResults(results || []);
    } catch {
      setInventoryResults([]);
    } finally {
      setSearchingInventory(false);
    }
  };

  const handleInventorySearchChange = (term: string) => {
    setInventorySearch(term);
    setSelectedInventoryItem(null);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => searchInventoryItems(term), 300);
  };

  const openAcknowledgeModal = (id: string) => {
    setAcknowledgeModal(id);
    setInStock(false);
    setInventorySearch('');
    setInventoryResults([]);
    setSelectedInventoryItem(null);
  };

  const handleAcknowledge = async () => {
    if (!acknowledgeModal) return;
    const id = acknowledgeModal;
    try {
      setAcknowledging(true);
      setReceivingIds(prev => new Set(prev).add(id));

      if (inStock && selectedInventoryItem) {
        // Mark received with inventory deduction
        await api.put(`/api/workshop/purchases/${id}/received`, { inventoryItemId: selectedInventoryItem._id });
        // Immediately fulfill since it's from stock
        await api.put(`/api/workshop/purchases/${id}/fulfilled`, { cost: 0, supplier: tx.fromInventory });
      } else {
        // Just mark as received (under preparation)
        await api.put(`/api/workshop/purchases/${id}/received`);
      }

      setAcknowledgeModal(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAcknowledging(false);
      setReceivingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleFulfill = async () => {
    if (!fulfillModal) return;
    try {
      setFulfilling(true);
      await api.put(`/api/workshop/purchases/${fulfillModal}/fulfilled`, {
        cost: parseFloat(fulfillForm.cost) || 0,
        supplier: fulfillForm.supplier,
        invoiceNumber: fulfillForm.invoiceNumber,
      });
      setFulfillModal(null);
      setFulfillForm({ cost: '', supplier: '', invoiceNumber: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFulfilling(false);
    }
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
                        {p.status === 'pending' && (
                          <button
                            onClick={() => openAcknowledgeModal(p._id)}
                            disabled={receivingIds.has(p._id)}
                            className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-600 hover:bg-blue-500/30 text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {receivingIds.has(p._id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
                            {tx.acknowledge}
                          </button>
                        )}
                        {p.status === 'received' && (
                          <button
                            onClick={() => {
                              setFulfillModal(p._id);
                              setFulfillForm({ cost: '', supplier: '', invoiceNumber: '' });
                            }}
                            className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-600 hover:bg-green-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            {tx.markReady}
                          </button>
                        )}
                        {p.status === 'fulfilled' && (
                          <span className="text-green-500 text-xs flex items-center gap-1"><Check className="w-3 h-3" />{tx.ready}</span>
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

      {/* Acknowledge Modal */}
      <AnimatePresence>
        {acknowledgeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setAcknowledgeModal(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{tx.acknowledgeModalTitle}</h2>
                  <button onClick={() => setAcknowledgeModal(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>

                {/* In Stock Checkbox */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={e => {
                      setInStock(e.target.checked);
                      if (!e.target.checked) {
                        setInventorySearch('');
                        setInventoryResults([]);
                        setSelectedInventoryItem(null);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 bg-slate-50 text-[#f37121] focus:ring-[#f37121]"
                  />
                  <span className="text-slate-900 text-sm">{tx.availableInStock}</span>
                </label>

                {/* Inventory Search (shown when inStock is checked) */}
                {inStock && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        value={inventorySearch}
                        onChange={e => handleInventorySearchChange(e.target.value)}
                        placeholder={tx.searchInventoryPlaceholder}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 ps-10 pe-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]"
                      />
                      {searchingInventory && <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 animate-spin" />}
                    </div>

                    {/* Search Results */}
                    {inventoryResults.length > 0 && !selectedInventoryItem && (
                      <div className="max-h-48 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg">
                        {inventoryResults.map(item => (
                          <button
                            key={item._id}
                            onClick={() => {
                              setSelectedInventoryItem(item);
                              setInventorySearch(item.name);
                              setInventoryResults([]);
                            }}
                            className="w-full text-start px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-200 last:border-0"
                          >
                            <p className="text-slate-900 text-sm font-medium">{item.name}</p>
                            <p className="text-slate-500 text-xs">
                              {tx.code}: {item.code} | {tx.available}: {item.quantity}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Selected Item */}
                    {selectedInventoryItem && (
                      <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2.5">
                        <div>
                          <p className="text-green-600 text-sm font-medium">{selectedInventoryItem.name}</p>
                          <p className="text-slate-500 text-xs">{tx.available}: {selectedInventoryItem.quantity}</p>
                        </div>
                        <button type="button" title={tx.remove} onClick={() => {
                          setSelectedInventoryItem(null);
                          setInventorySearch('');
                        }} className="text-slate-500 hover:text-slate-900">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {inStock && selectedInventoryItem && (
                      <p className="text-blue-600 text-xs">
                        {tx.deductInventoryNote}
                      </p>
                    )}
                  </div>
                )}

                {!inStock && (
                  <p className="text-slate-500 text-xs">
                    {tx.underPreparationNote}
                  </p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setAcknowledgeModal(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button
                    onClick={handleAcknowledge}
                    disabled={acknowledging || (inStock && !selectedInventoryItem)}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {acknowledging && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Check className="w-4 h-4" />
                    {tx.confirm}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Fulfill Modal */}
      <AnimatePresence>
        {fulfillModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50" onClick={() => setFulfillModal(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-lg font-bold text-white mb-3">{tx.fulfillModalTitle}</h2>
                  <button onClick={() => setFulfillModal(null)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.colCost}</label>
                    <input type="number" value={fulfillForm.cost} onChange={e => setFulfillForm(p => ({ ...p, cost: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.colSupplier}</label>
                    <input type="text" value={fulfillForm.supplier} onChange={e => setFulfillForm(p => ({ ...p, supplier: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-sm block mb-1">{tx.invoiceNumber}</label>
                    <input type="text" value={fulfillForm.invoiceNumber} onChange={e => setFulfillForm(p => ({ ...p, invoiceNumber: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg text-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setFulfillModal(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
                    {tx.cancel}
                  </button>
                  <button onClick={handleFulfill} disabled={fulfilling}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {fulfilling && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Check className="w-4 h-4" />
                    {tx.confirm}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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

                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 cursor-pointer">
                  <input type="checkbox" checked={createForm.arrived} onChange={(e) => setCreateForm((f) => ({ ...f, arrived: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 mt-0.5" />
                  <span className="text-sm">
                    <span className="font-semibold text-emerald-900 block">{isAr ? 'الصنف وصل بالفعل' : 'The item has already arrived'}</span>
                    <span className="text-xs text-emerald-800">
                      {isAr
                        ? 'هيتسجّل كمستلَم ويتضاف إلى المستودع فوراً. لو شِلت العلامة هيتسجّل كطلب جديد وتستلمه لما يوصل.'
                        : 'It is recorded as received and added to the store right away. Untick it to log a request and receive it when it arrives.'}
                    </span>
                  </span>
                </label>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" onClick={submitCreate} disabled={creating || !createForm.itemName.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e06010] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {createForm.arrived ? (isAr ? 'تسجيل وإضافة للمستودع' : 'Record and add to store') : (isAr ? 'تسجيل الطلب' : 'Log the request')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
