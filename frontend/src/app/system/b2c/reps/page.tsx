'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getB2CTranslations, getB2cRepsTranslations } from '@/lib/translations';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, X, Users as UsersIcon, RefreshCw, Search, Award } from 'lucide-react';
import DataTable from '@/components/system/DataTable';
import B2CRepProfileModal from '@/components/system/B2CRepProfileModal';

interface Project { _id: string; name: string; code?: string; color?: string }
interface Branch { _id: string; name: string; city?: string }

interface Rep {
  _id: string;
  repId?: string;
  arabicName?: string;
  englishName: string;
  phone?: string;
  joiningDate?: string;
  project?: Project;
  branch?: Branch;
  monthlyTarget: number;
  dailyTarget: number;
  expectedWorkingDays: number;
  isActive: boolean;
}

const DEFAULT_FORM = {
  repId: '', arabicName: '', englishName: '', phone: '',
  joiningDate: '', project: '', branch: '',
  monthlyTarget: 400, dailyTarget: 15, expectedWorkingDays: 26,
  notes: '', isActive: true,
};

export default function B2CRepsPage() {
  const { lang } = useLanguage();
  const T = getB2CTranslations(lang);
  const tx = getB2cRepsTranslations(lang);
  const [reps, setReps] = useState<Rep[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Rep | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Profile drilldown
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);

  const fetchReps = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterProject) params.set('project', filterProject);
      if (filterBranch) params.set('branch', filterBranch);
      if (search) params.set('search', search);
      const data = await api.get<any>(`/api/b2c/reps?${params.toString()}`);
      setReps(data.reps || []);
    } catch {} finally { setLoading(false); }
  }, [filterProject, filterBranch, search]);

  const fetchProjects = useCallback(async () => {
    try { const data = await api.get<any>('/api/b2c/projects?active=true'); setProjects(data.projects || []); } catch {}
  }, []);

  const fetchBranches = useCallback(async () => {
    try { const data = await api.get<any>('/api/branches?active=true'); setBranches(data.branches || []); } catch {}
  }, []);

  useEffect(() => { fetchReps(); }, [fetchReps]);
  useEffect(() => { fetchProjects(); fetchBranches(); }, [fetchProjects, fetchBranches]);
  useSocket('b2c:rep:created', fetchReps);
  useSocket('b2c:rep:updated', fetchReps);
  useSocket('b2c:rep:deleted', fetchReps);

  const openCreate = () => { setEditing(null); setForm(DEFAULT_FORM); setError(''); setShowModal(true); };
  const openEdit = (r: Rep) => {
    setEditing(r);
    setForm({
      repId: r.repId || '', arabicName: r.arabicName || '', englishName: r.englishName,
      phone: r.phone || '',
      joiningDate: r.joiningDate ? r.joiningDate.slice(0, 10) : '',
      project: r.project?._id || '', branch: r.branch?._id || '',
      monthlyTarget: r.monthlyTarget, dailyTarget: r.dailyTarget,
      expectedWorkingDays: r.expectedWorkingDays,
      notes: '', isActive: r.isActive,
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload: any = { ...form };
      if (!payload.joiningDate) delete payload.joiningDate;
      if (!payload.project) delete payload.project;
      if (!payload.branch) delete payload.branch;
      if (!payload.repId) delete payload.repId;
      if (editing) {
        await api.put(`/api/b2c/reps/${editing._id}`, payload);
      } else {
        await api.post('/api/b2c/reps', payload);
      }
      setShowModal(false);
      fetchReps();
    } catch (err: any) {
      setError(err.message || tx.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Rep) => {
    if (!confirm(`${T.confirmDelete} ${r.englishName}`)) return;
    try {
      await api.delete(`/api/b2c/reps/${r._id}`);
      fetchReps();
    } catch (err: any) {
      alert(err.message || tx.failed);
    }
  };

  const columns = [
    {
      key: 'englishName', label: T.englishName,
      render: (_: any, row: Rep) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedRepId(row._id); }}
          className="text-start hover:underline">
          <p className="text-slate-900 font-medium hover:text-[#f37121] transition-colors">{row.englishName}</p>
          {row.arabicName && <p className="text-slate-500 text-xs mt-0.5">{row.arabicName}</p>}
        </button>
      ),
    },
    { key: 'repId', label: T.repId, render: (v: string) => <span className="text-slate-500 text-xs font-mono">{v || '—'}</span> },
    {
      key: 'project', label: T.project,
      render: (_: any, row: Rep) => row.project ? (
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: `${row.project.color || '#f37121'}20`, color: row.project.color || '#f37121' }}>
          {row.project.name}
        </span>
      ) : <span className="text-slate-500">—</span>,
    },
    {
      key: 'branch', label: T.branch,
      render: (_: any, row: Rep) => {
        if (!row.branch) return <span className="text-slate-500">—</span>;
        const name = row.branch.name;
        const city = row.branch.city;
        // Hide city when it duplicates the name (case-insensitive trim)
        const showCity = city && city.trim().toLowerCase() !== name.trim().toLowerCase();
        return <span className="text-slate-700 text-sm">{name}{showCity ? ` — ${city}` : ''}</span>;
      },
    },
    { key: 'monthlyTarget', label: T.monthlyTarget, render: (v: number) => <span className="text-slate-900">{v}</span> },
    {
      key: 'isActive', label: tx.status,
      render: (_: any, row: Rep) => (
        <span className={`inline-flex items-center gap-1.5 text-xs ${row.isActive ? 'text-green-600' : 'text-slate-500'}`}>
          <span className={`w-2 h-2 rounded-full ${row.isActive ? 'bg-green-400' : 'bg-slate-300'}`} />
          {row.isActive ? tx.active : tx.inactive}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Award className="w-6 h-6 text-[#f37121]" />
            {T.reps}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {tx.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchReps} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100" title={tx.refresh}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button type="button" onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#f37121] hover:bg-[#e0611a] text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> {T.addRep}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 shadow-sm">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={tx.searchPlaceholder}
            className="w-full ps-10 pe-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
        </div>
        <select aria-label="Project" value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
          <option value="">{T.allProjects}</option>
          {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select aria-label="Branch" value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
          <option value="">{T.allBranches}</option>
          {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={reps}
          searchable={false}
          emptyMessage={tx.noReps}
          actions={(row: Rep) => (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => openEdit(row)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100" title={T.edit}>
                <Edit className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => handleDelete(row)} className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-slate-100" title={T.delete}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        />
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)} className="fixed inset-0 bg-black/60 z-50" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
                    <UsersIcon className="w-5 h-5 text-[#f37121]" />
                    {editing ? T.editRep : T.addRep}
                  </h2>
                  <button type="button" onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-900" title={tx.close}><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                  {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm">{error}</div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.englishName} *</label>
                      <input required type="text" value={form.englishName} onChange={(e) => setForm({ ...form, englishName: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.arabicName}</label>
                      <input type="text" value={form.arabicName} onChange={(e) => setForm({ ...form, arabicName: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.repId}</label>
                      <input type="text" value={form.repId} onChange={(e) => setForm({ ...form, repId: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 font-mono" />
                    </div>
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.phone}</label>
                      <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.project}</label>
                      <select aria-label="Project" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                        <option value="">{T.selectProject}</option>
                        {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.branch}</label>
                      <select aria-label="Branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                        <option value="">{T.selectBranch}</option>
                        {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.monthlyTarget}</label>
                      <input type="number" value={form.monthlyTarget} onChange={(e) => setForm({ ...form, monthlyTarget: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.dailyTarget}</label>
                      <input type="number" value={form.dailyTarget} onChange={(e) => setForm({ ...form, dailyTarget: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                    <div>
                      <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.expectedWorkingDays}</label>
                      <input type="number" value={form.expectedWorkingDays} onChange={(e) => setForm({ ...form, expectedWorkingDays: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.joiningDate}</label>
                    <input type="date" aria-label="Joining date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="rounded border-slate-300 bg-white text-[#f37121] focus:ring-[#f37121]/50" />
                    <span className="text-slate-700 text-sm">{tx.active}</span>
                  </label>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">{T.cancel}</button>
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

      {/* Rep profile modal — opens when a name in the table is clicked */}
      <AnimatePresence>
        {selectedRepId && (
          <B2CRepProfileModal
            repId={selectedRepId}
            onClose={() => setSelectedRepId(null)}
            lang={lang}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
