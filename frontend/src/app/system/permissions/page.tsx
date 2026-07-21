'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { ShieldCheck, Check, Eye, Ban, Save, Loader2, Crown } from 'lucide-react';
import { getPermissionsTranslations, getRoleLabel, getSectionLabel } from '@/lib/translations';
import { Spinner, PageHeader } from '@/components/hr/HRKit';

type Access = 'none' | 'view' | 'edit';
interface Payload {
  sections: string[];
  roles: string[];
  accessLevels: Access[];
  permissions: Record<string, Record<string, Access>>;
}

const LEVELS: { key: Access; icon: any; en: string; ar: string; active: string }[] = [
  { key: 'none', icon: Ban, en: 'None', ar: 'ممنوع', active: 'bg-red-500 text-white border-red-500' },
  { key: 'view', icon: Eye, en: 'View', ar: 'مشاهدة', active: 'bg-amber-500 text-white border-amber-500' },
  { key: 'edit', icon: Check, en: 'Edit', ar: 'تعديل', active: 'bg-green-600 text-white border-green-600' },
];

export default function PermissionsPage() {
  const { notify } = useDialog();
  const { user, refreshUser } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getPermissionsTranslations(lang);
  const isSuper = ['super_admin', 'it_manager', 'it_specialist'].includes(user?.role || '');

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>('');
  // Working copy for the selected role: sectionKey -> level.
  const [draft, setDraft] = useState<Record<string, Access>>({});
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<Payload>('/api/admin/permissions');
      setData(d);
      if (!selectedRole && d.roles.length) setSelectedRole(d.roles[0]);
    } catch {}
    setLoading(false);
  }, [selectedRole]);

  useEffect(() => { load(); }, [load]);

  // Load the draft whenever the selected role (or fetched data) changes.
  useEffect(() => {
    if (!data || !selectedRole) return;
    setDraft({ ...(data.permissions[selectedRole] || {}) });
    setSavedFlash(false);
  }, [data, selectedRole]);

  const original = useMemo(() => (data && selectedRole ? data.permissions[selectedRole] || {} : {}), [data, selectedRole]);
  const dirty = useMemo(() => data?.sections.some((s) => (draft[s] || 'none') !== (original[s] || 'none')) || false, [data, draft, original]);

  const setLevel = (section: string, level: Access) => setDraft((d) => ({ ...d, [section]: level }));
  const setAll = (level: Access) => { if (!data) return; const next: Record<string, Access> = {}; data.sections.forEach((s) => { next[s] = level; }); setDraft(next); };

  const save = async () => {
    if (!selectedRole || !data) return;
    setSaving(true);
    try {
      const res = await api.put<{ role: string; permissions: Record<string, Access> }>(`/api/admin/permissions/${selectedRole}`, { sections: draft });
      // Reflect the saved state back into the matrix.
      setData((prev) => prev ? { ...prev, permissions: { ...prev.permissions, [selectedRole]: res.permissions } } : prev);
      setSavedFlash(true);
      // If the super admin changed their OWN effective view indirectly, refresh.
      if (user?.role === selectedRole) refreshUser();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  if (!isSuper) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShieldCheck className="w-5 h-5" />} title={tx.pageTitle} subtitle={tx.subtitle} />

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
        <Crown className="w-4 h-4 shrink-0" /> {tx.superAdminNote}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Roles list */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-200 text-slate-900 font-semibold text-sm">{tx.rolesTitle}</div>
          <div className="max-h-[70vh] overflow-y-auto p-2 space-y-1">
            {data?.roles.map((r) => {
              const active = r === selectedRole;
              return (
                <button key={r} type="button" onClick={() => setSelectedRole(r)}
                  className={`w-full text-start px-3 py-2 rounded-lg text-sm transition-colors ${active ? 'bg-[#f37121] text-white font-medium' : 'text-slate-700 hover:bg-slate-100'}`}>
                  {getRoleLabel(r, lang)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sections access editor */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-slate-900 font-semibold">{selectedRole ? getRoleLabel(selectedRole, lang) : tx.sectionsTitle}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAll('none')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allNone}</button>
              <button type="button" onClick={() => setAll('view')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allView}</button>
              <button type="button" onClick={() => setAll('edit')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allEdit}</button>
            </div>
          </div>

          {!selectedRole ? (
            <p className="text-slate-500 text-sm p-8 text-center">{tx.pickRole}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data?.sections.map((section) => {
                const cur = draft[section] || 'none';
                return (
                  <div key={section} className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-slate-800 text-sm font-medium">{getSectionLabel(section, lang)}</span>
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                      {LEVELS.map((lv) => {
                        const Icon = lv.icon;
                        const on = cur === lv.key;
                        return (
                          <button key={lv.key} type="button" onClick={() => setLevel(section, lv.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-e last:border-e-0 border-slate-200 transition-colors ${on ? lv.active : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                            <Icon className="w-3.5 h-3.5" /> {ar ? lv.ar : lv.en}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedRole && (
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-3">
              {dirty && <span className="text-amber-600 text-xs">{tx.unsaved}</span>}
              {savedFlash && !dirty && <span className="text-green-600 text-xs flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {tx.saved}</span>}
              <button type="button" onClick={() => setDraft({ ...original })} disabled={!dirty || saving}
                className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm disabled:opacity-40">{tx.reset}</button>
              <button type="button" onClick={save} disabled={!dirty || saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? tx.saving : tx.save}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
