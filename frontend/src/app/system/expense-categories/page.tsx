'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Tags, Plus, Search, X, Check, Edit, Trash2, Loader2 } from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useLanguage } from '@/context/LanguageContext';
import { getExpenseCategoriesTranslations, getExpenseCategoriesExtraTranslations } from '@/lib/translations';

interface ExpenseCategory {
  _id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export default function ExpenseCategoriesPage() {
  const { confirm } = useDialog();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const { lang } = useLanguage();
  const T = getExpenseCategoriesTranslations(lang);
  const txx = getExpenseCategoriesExtraTranslations(lang);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCategory, setEditCategory] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState({ name: '', description: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/expense-categories');
      setCategories(data.categories || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  useSocket('expenseCategory:created', useCallback(() => fetchCategories(), [fetchCategories]));
  useSocket('expenseCategory:updated', useCallback(() => fetchCategories(), [fetchCategories]));
  useSocket('expenseCategory:deleted', useCallback(() => fetchCategories(), [fetchCategories]));

  const openCreate = () => {
    setEditCategory(null);
    setForm({ name: '', description: '', isActive: true });
    setShowModal(true);
  };

  const openEdit = (c: ExpenseCategory) => {
    setEditCategory(c);
    setForm({ name: c.name, description: c.description || '', isActive: c.isActive });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editCategory) {
        await api.put(`/api/expense-categories/${editCategory._id}`, form);
      } else {
        await api.post('/api/expense-categories', form);
      }
      setShowModal(false);
      fetchCategories();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(T.deleteCategory))) return;
    try {
      await api.delete(`/api/expense-categories/${id}`);
      fetchCategories();
    } catch {}
  };

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const exportColumns: ExportColumn[] = [
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Description', key: 'description', width: 35 },
    { header: 'Status', key: 'isActive', transform: (v: boolean) => v ? 'Active' : 'Inactive', width: 10 },
    { header: 'Created At', key: 'createdAt', transform: fmt.date, width: 14 },
  ];
  // الفلترة تجري في الذاكرة، فالنطاقان حاضران دائمًا؛ والعدّاد جنب كلٍّ منهما
  // هو ما يمنع المستخدمَ من تصدير المفلتَر وهو يحسبه كلَّ التصنيفات.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Expense Categories', rows: filtered as unknown as Record<string, any>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: 'Expense Categories', rows: categories as unknown as Record<string, any>[], columns: exportColumns }] },
  ];

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
            <Tags className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
            <p className="text-slate-500 text-sm">{categories.length} {T.xCategories}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu fileName="expense-categories" lang={lang === 'ar' ? 'ar' : 'en'} variant="subtle" label={T.downloadExcel} options={exportOptions} />
          {isSuperAdmin && (
            <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" />
              {T.addCategory}
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" placeholder={T.searchCategories} value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-200">
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.name}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.description}</th>
              <th className="text-start text-slate-300 font-semibold px-4 py-3">{T.status}</th>
              {isSuperAdmin && <th className="text-end text-slate-300 font-semibold px-4 py-3">{T.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={isSuperAdmin ? 4 : 3} className="text-center text-slate-800 py-12">{T.noCategories}</td></tr>
            ) : filtered.map((c) => (
              <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-100 transition-colors">
                <td className="px-4 py-3 text-slate-900 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-slate-700">{c.description || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
                    {c.isActive ? T.active : T.inactive}
                  </span>
                </td>
                {isSuperAdmin && (
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100 transition-colors" title={T.edit}>
                        <Edit className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(c._id)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100 transition-colors" title={T.delete}>
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
                <h2 className="text-white font-bold text-lg">{editCategory ? T.editCategory : T.addCategory}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.categoryName + ' *'}</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" placeholder={txx.namePlaceholder} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{T.description}</label>
                  <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3}
                    className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 resize-none" placeholder={txx.descriptionPlaceholder} />
                </div>
                {editCategory && (
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
                  {editCategory ? T.save : T.create}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
