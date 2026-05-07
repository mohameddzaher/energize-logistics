'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, X, Target, RefreshCw } from 'lucide-react';

interface Project {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  color?: string;
  monthlyTarget: number;
  dailyTarget: number;
  expectedWorkingDays: number;
  isActive: boolean;
  createdAt: string;
}

const DEFAULT_FORM = {
  name: '',
  code: '',
  description: '',
  color: '#f37121',
  monthlyTarget: 400,
  dailyTarget: 15,
  expectedWorkingDays: 26,
};

export default function B2CProjectsPage() {
  const { lang } = useLanguage();
  const T = getB2CTranslations(lang);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchProjects = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/b2c/projects');
      setProjects(data.projects || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useSocket('b2c:project:created', fetchProjects);
  useSocket('b2c:project:updated', fetchProjects);
  useSocket('b2c:project:deleted', fetchProjects);

  const openCreate = () => { setEditing(null); setForm(DEFAULT_FORM); setError(''); setShowModal(true); };
  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name, code: p.code || '', description: p.description || '',
      color: p.color || '#f37121',
      monthlyTarget: p.monthlyTarget, dailyTarget: p.dailyTarget,
      expectedWorkingDays: p.expectedWorkingDays,
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.put(`/api/b2c/projects/${editing._id}`, form);
      } else {
        await api.post('/api/b2c/projects', form);
      }
      setShowModal(false);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(`${T.confirmDelete} ${p.name}`)) return;
    try {
      await api.delete(`/api/b2c/projects/${p._id}`);
      fetchProjects();
    } catch (err: any) {
      alert(err.message || 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Target className="w-6 h-6 text-[#f37121]" />
            {T.projects}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {lang === 'ar' ? 'إدارة مشاريع B2C (كيتا، هانجرستيشن، أمازون...)' : 'Manage B2C projects (Keeta, HungerStation, Amazon...)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchProjects} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> {T.addProject}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 bg-gray-800 rounded-xl border border-gray-700">
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 mb-4">{lang === 'ar' ? 'لا توجد مشاريع بعد' : 'No projects yet'}</p>
          <button type="button" onClick={openCreate} className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm">
            {T.addProject}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <motion.div key={p._id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-gray-600 transition-all"
              style={{ borderLeftWidth: 4, borderLeftColor: p.color || '#f37121' }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h3 className="text-white font-semibold truncate">{p.name}</h3>
                  {p.code && <p className="text-gray-500 text-xs mt-0.5">{p.code}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => openEdit(p)} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700" title={T.edit}>
                    <Edit className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => handleDelete(p)} className="p-1.5 text-gray-400 hover:text-red-400 rounded hover:bg-gray-700" title={T.delete}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {p.description && <p className="text-gray-400 text-sm mb-3 line-clamp-2">{p.description}</p>}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-900/50 rounded-lg p-2">
                  <p className="text-gray-500 text-[10px] uppercase">{T.monthlyTarget}</p>
                  <p className="text-white text-sm font-bold">{p.monthlyTarget}</p>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-2">
                  <p className="text-gray-500 text-[10px] uppercase">{T.dailyTarget}</p>
                  <p className="text-white text-sm font-bold">{p.dailyTarget}</p>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-2">
                  <p className="text-gray-500 text-[10px] uppercase">{lang === 'ar' ? 'أيام' : 'Days'}</p>
                  <p className="text-white text-sm font-bold">{p.expectedWorkingDays}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${p.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-xs text-gray-400">{p.isActive ? (lang === 'ar' ? 'نشط' : 'Active') : (lang === 'ar' ? 'متوقف' : 'Inactive')}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="fixed inset-0 bg-black/60 z-50" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-700">
                  <h2 className="text-white font-semibold text-lg">{editing ? T.editProject : T.addProject}</h2>
                  <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white" title="Close"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                  {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.name}</label>
                      <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.code}</label>
                      <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.description}</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.monthlyTarget}</label>
                      <input type="number" value={form.monthlyTarget} onChange={(e) => setForm({ ...form, monthlyTarget: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.dailyTarget}</label>
                      <input type="number" value={form.dailyTarget} onChange={(e) => setForm({ ...form, dailyTarget: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.expectedWorkingDays}</label>
                      <input type="number" value={form.expectedWorkingDays} onChange={(e) => setForm({ ...form, expectedWorkingDays: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-1.5">{T.color}</label>
                    <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                      className="w-full h-10 rounded-lg bg-gray-900 border border-gray-700 cursor-pointer" />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm">{T.cancel}</button>
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                      {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {editing ? T.save_ : T.add}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
