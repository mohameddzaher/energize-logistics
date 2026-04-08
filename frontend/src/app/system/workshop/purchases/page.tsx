'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Loader2, X, Check, Package, AlertCircle,
  ChevronLeft, ChevronRight, FileText, Download,
} from 'lucide-react';
import { exportToExcel, fmt } from '@/utils/exportExcel';

interface PurchaseRequest {
  _id: string;
  itemName: string;
  quantity: number;
  vehicleNumber: string;
  requestedBy: string;
  requestedByName?: string;
  date: string;
  status: 'pending' | 'received' | 'fulfilled';
  cost?: number;
  supplier?: string;
  invoiceNumber?: string;
  maintenanceId?: string;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; bg: string }> = {
  pending: { label: 'Pending', labelAr: 'معلق', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  received: { label: 'Received', labelAr: 'مستلم', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  fulfilled: { label: 'Fulfilled', labelAr: 'مكتمل', color: 'text-green-400', bg: 'bg-green-500/20' },
};

export default function WorkshopPurchasesPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState('');

  // Fulfill modal
  const [fulfillModal, setFulfillModal] = useState<string | null>(null);
  const [fulfillForm, setFulfillForm] = useState({ cost: '', supplier: '', invoiceNumber: '' });
  const [fulfilling, setFulfilling] = useState(false);

  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
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
  }, [statusFilter, page]);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  // WebSocket
  const handleCreated = useCallback((p: PurchaseRequest) => {
    setPurchases(prev => [p, ...prev]);
    setTotal(t => t + 1);
  }, []);
  const handleReceived = useCallback((p: PurchaseRequest) => {
    setPurchases(prev => prev.map(x => x._id === p._id ? p : x));
  }, []);
  const handleFulfilled = useCallback((p: PurchaseRequest) => {
    setPurchases(prev => prev.map(x => x._id === p._id ? p : x));
  }, []);

  useSocket('purchase:created', handleCreated);
  useSocket('purchase:received', handleReceived);
  useSocket('purchase:fulfilled', handleFulfilled);

  const markReceived = async (id: string) => {
    try {
      await api.put(`/api/workshop/purchases/${id}/received`);
    } catch (err: any) {
      setError(err.message);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-white">{isAr ? 'مشتريات الورشة' : 'Workshop Purchases'}</h1>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={purchases.length === 0}
          className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {isAr ? 'تصدير' : 'Export'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-[#f37121]"
        >
          <option value="">{isAr ? 'كل الحالات' : 'All Status'}</option>
          <option value="pending">{isAr ? 'معلق' : 'Pending'}</option>
          <option value="received">{isAr ? 'مستلم' : 'Received'}</option>
          <option value="fulfilled">{isAr ? 'مكتمل' : 'Fulfilled'}</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد طلبات شراء' : 'No purchase requests found'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {[
                  isAr ? 'الصنف' : 'Item',
                  isAr ? 'الكمية' : 'Qty',
                  isAr ? 'رقم المركبة' : 'Vehicle #',
                  isAr ? 'طلب بواسطة' : 'Requested By',
                  isAr ? 'التاريخ' : 'Date',
                  isAr ? 'الحالة' : 'Status',
                  isAr ? 'التكلفة' : 'Cost',
                  isAr ? 'المورد' : 'Supplier',
                  isAr ? 'إجراءات' : 'Actions',
                ].map((h, i) => (
                  <th key={i} className="text-left text-gray-400 font-medium py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map(p => {
                const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending;
                return (
                  <tr key={p._id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                    <td className="py-3 px-3 text-white font-medium">{p.itemName}</td>
                    <td className="py-3 px-3 text-gray-300">{p.quantity}</td>
                    <td className="py-3 px-3 text-gray-300">{p.vehicleNumber || '-'}</td>
                    <td className="py-3 px-3 text-gray-300">{p.requestedByName || (typeof p.requestedBy === 'object' && p.requestedBy ? `${p.requestedBy.firstName || ''} ${p.requestedBy.lastName || ''}`.trim() : '') || '-'}</td>
                    <td className="py-3 px-3 text-gray-300 whitespace-nowrap">
                      {new Date(p.date || p.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        {isAr ? sc.labelAr : sc.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-300">{p.cost ? `${p.cost.toLocaleString()}` : '-'}</td>
                    <td className="py-3 px-3 text-gray-300">{p.supplier || '-'}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {p.status === 'pending' && (
                          <button
                            onClick={() => markReceived(p._id)}
                            className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            <Package className="w-3 h-3" />
                            {isAr ? 'استلام' : 'Mark Received'}
                          </button>
                        )}
                        {p.status === 'received' && (
                          <button
                            onClick={() => {
                              setFulfillModal(p._id);
                              setFulfillForm({ cost: '', supplier: '', invoiceNumber: '' });
                            }}
                            className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            {isAr ? 'تم التوريد' : 'Mark Fulfilled'}
                          </button>
                        )}
                        {p.status === 'fulfilled' && (
                          <span className="text-gray-500 text-xs">{isAr ? 'للقراءة فقط' : 'Read-only'}</span>
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">{isAr ? 'تأكيد التوريد' : 'Fulfill Purchase'}</h2>
                  <button onClick={() => setFulfillModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'التكلفة' : 'Cost'}</label>
                    <input type="number" value={fulfillForm.cost} onChange={e => setFulfillForm(p => ({ ...p, cost: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'المورد' : 'Supplier'}</label>
                    <input type="text" value={fulfillForm.supplier} onChange={e => setFulfillForm(p => ({ ...p, supplier: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-sm block mb-1">{isAr ? 'رقم الفاتورة' : 'Invoice #'}</label>
                    <input type="text" value={fulfillForm.invoiceNumber} onChange={e => setFulfillForm(p => ({ ...p, invoiceNumber: e.target.value }))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setFulfillModal(null)} className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={handleFulfill} disabled={fulfilling}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {fulfilling && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Check className="w-4 h-4" />
                    {isAr ? 'تأكيد' : 'Confirm'}
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
