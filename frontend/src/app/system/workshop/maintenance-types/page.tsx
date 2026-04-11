'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  Tag, Plus, Loader2, X, Edit, Trash2, AlertCircle, AlertTriangle,
} from 'lucide-react';

interface MaintenanceType {
  _id: string;
  name: string;
  description?: string;
  estimatedDuration?: number;
  isActive: boolean;
  createdAt: string;
}

export default function MaintenanceTypesPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [types, setTypes] = useState<MaintenanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MaintenanceType | null>(null);
  const [form, setForm] = useState({ name: '', description: '', estimatedDuration: '' });
  const [saving, setSaving] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{message: string; onConfirm: () => void} | null>(null);

  const fetchTypes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<any>('/api/workshop/maintenance-types');
      setTypes(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  useSocket('maintenanceType:created', fetchTypes);
  useSocket('maintenanceType:updated', fetchTypes);
  useSocket('maintenanceType:deleted', fetchTypes);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', estimatedDuration: '' });
    setShowModal(true);
  };

  const openEdit = (t: MaintenanceType) => {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description || '',
      estimatedDuration: t.estimatedDuration ? String(t.estimatedDuration) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      setSaving(true);
      const payload: any = {
        name: form.name.trim(),
        description: form.description,
      };
      if (form.estimatedDuration) payload.estimatedDuration = Number(form.estimatedDuration);

      if (editing) {
        await api.put(`/api/workshop/maintenance-types/${editing._id}`, payload);
      } else {
        await api.post('/api/workshop/maintenance-types', payload);
      }
      setShowModal(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (t: MaintenanceType) => {
    setConfirmModal({
      message: isAr ? `هل تريد حذف "${t.name}"؟` : `Delete "${t.name}"?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try { await api.delete(`/api/workshop/maintenance-types/${t._id}`); } catch (err: any) { setError(err.message); }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tag className="w-7 h-7 text-[#f37121]" />
          <h1 className="text-2xl font-bold text-white">{isAr ? 'أنواع الصيانة' : 'Maintenance Types'}</h1>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 bg-[#f37121] hover:bg-[#e0611a] text-white px-4 py-2.5 rounded-lg font-medium transition-colors">
          <Plus className="w-4 h-4" />
          {isAr ? 'نوع جديد' : 'New Type'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm">{error}</span>
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-[#f37121] animate-spin" />
        </div>
      ) : types.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Tag className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{isAr ? 'لا توجد أنواع صيانة' : 'No maintenance types yet'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map(t => (
            <div key={t._id} className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-white font-medium">{t.name}</h3>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => openEdit(t)} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600" title="Edit">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => handleDelete(t)} className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {t.description && <p className="text-gray-400 text-sm mb-2">{t.description}</p>}
              {t.estimatedDuration && (
                <p className="text-xs text-[#f37121]">
                  ⏱ {isAr ? 'المدة المقدرة:' : 'Est. Duration:'} {t.estimatedDuration} {isAr ? 'دقيقة' : 'min'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editing ? (isAr ? 'تعديل نوع الصيانة' : 'Edit Maintenance Type') : (isAr ? 'نوع صيانة جديد' : 'New Maintenance Type')}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-sm block mb-1">{isAr ? 'الاسم' : 'Name'} *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={isAr ? 'مثال: صيانة 10000 كم' : 'e.g. 10,000 km service'}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">{isAr ? 'الوصف' : 'Description'}</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121] resize-none" rows={3} />
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">{isAr ? 'المدة المقدرة (دقيقة)' : 'Estimated Duration (minutes)'}</label>
                <input type="number" value={form.estimatedDuration} onChange={e => setForm(p => ({ ...p, estimatedDuration: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#f37121]" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" onClick={handleSave} disabled={saving || !form.name.trim()}
                className="px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0611a] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isAr ? 'حفظ' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-white font-semibold">{isAr ? 'تأكيد' : 'Confirm'}</h3>
              </div>
              <p className="text-gray-300 text-sm">{confirmModal.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" onClick={confirmModal.onConfirm} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">
                {isAr ? 'حذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
