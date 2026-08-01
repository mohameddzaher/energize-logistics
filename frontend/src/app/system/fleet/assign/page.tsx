'use client';
// توزيع السيارات على المشرفين — شاشة مدير القسم (والسوبر أدمن): اختر المشرف،
// علّم بالتشيك ليست على السيارات، واحفظ الإسناد دفعة واحدة. كل سيارة تعرض
// مشرفها الحالي، ويمكن نقلها من مشرف إلى آخر أو إلغاء إسنادها بنفس الطريقة.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { UserCog, Truck, Check, Loader2, Search, X, Users } from 'lucide-react';
import { Spinner, PageHeader, SearchableSelect, SmallBadge } from '@/components/hr/HRKit';
import { FleetVehicle, foldAr, canAdminFleet } from '@/lib/fleet';

interface Supervisor { _id: string; firstName: string; lastName: string; email: string }
const supName = (u: Supervisor) => `${u.firstName} ${u.lastName}`.trim() || u.email;

export default function FleetAssignPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { notify, confirm } = useDialog();
  const admin = canAdminFleet(user);

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState('');           // المشرف المستهدف
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [ownerFilter, setOwnerFilter] = useState(''); // '' الكل، 'none' غير مُسند، أو معرف مشرف

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
        api.get<{ users: Supervisor[] }>('/api/fleet/supervisors'),
      ]);
      setVehicles(v.vehicles || []);
      setSupervisors(s.users || []);
    } catch (e: any) { notify(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));

  const filtered = useMemo(() => {
    let r = vehicles;
    if (ownerFilter === 'none') r = r.filter((v) => !v.supervisor);
    else if (ownerFilter) r = r.filter((v) => v.supervisor === ownerFilter);
    const s = foldAr(q.trim());
    if (s) r = r.filter((v) => [v.plate, v.name, v.supervisorName, ...(v.drivers || []).map((d) => d.name)].some((x) => foldAr(String(x || '')).includes(s)));
    return r;
  }, [vehicles, ownerFilter, q]);

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allFilteredSelected = filtered.length > 0 && filtered.every((v) => selected.has(v._id));
  const toggleAll = () => setSelected((p) => {
    const n = new Set(p);
    if (allFilteredSelected) filtered.forEach((v) => n.delete(v._id));
    else filtered.forEach((v) => n.add(v._id));
    return n;
  });

  const assign = async (toSupervisor: string | null) => {
    if (selected.size === 0) { notify(ar ? 'حدد السيارات أولًا.' : 'Select vehicles first.', 'error'); return; }
    if (toSupervisor === null && !(await confirm(ar ? `إلغاء إسناد ${selected.size} سيارة؟` : `Unassign ${selected.size} vehicles?`))) return;
    setSaving(true);
    try {
      const d = await api.post<{ modified: number; supervisorName: string }>('/api/fleet/vehicles/assign-supervisor-bulk', {
        supervisor: toSupervisor, vehicleIds: [...selected],
      });
      notify(toSupervisor
        ? (ar ? `أُسندت ${d.modified} سيارة إلى ${d.supervisorName}.` : `${d.modified} vehicles assigned to ${d.supervisorName}.`)
        : (ar ? `أُلغي إسناد ${d.modified} سيارة.` : `${d.modified} vehicles unassigned.`), 'success');
      setSelected(new Set());
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setSaving(false);
  };

  // إسناد سريع لسيارة واحدة مباشرةً — أسهل طريق لتغيير مشرف سيارة بعينها.
  const quickAssign = async (vehicleId: string, supervisorId: string) => {
    try {
      await api.patch(`/api/fleet/vehicles/${vehicleId}/supervisor`, { supervisor: supervisorId || null });
      load();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (!admin) return <div className="text-slate-500 p-8">{ar ? 'هذه الصفحة لمدير القسم فقط.' : 'Section manager only.'}</div>;
  if (loading) return <Spinner />;

  const counts = new Map<string, number>();
  vehicles.forEach((v) => { const k = v.supervisor || 'none'; counts.set(k, (counts.get(k) || 0) + 1); });

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<UserCog className="w-5 h-5" />} title={ar ? 'توزيع السيارات على المشرفين' : 'Assign vehicles to supervisors'}
        subtitle={ar ? 'علّم على السيارات ثم أسندها لمشرف دفعة واحدة' : 'Tick vehicles, hand them to a supervisor in one save'} />

      {supervisors.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {ar
            ? 'لا يوجد مستخدمون بدور «مشرف أسطول» بعد. أنشئهم أولًا من إدارة المستخدمين (الدور: مشرف أسطول)، ثم عد إلى هنا للتوزيع.'
            : 'No users with the fleet_supervisor role yet. Create them in user management first, then come back to assign.'}
        </div>
      )}

      {/* ملخص التوزيع الحالي — كل مشرف وعدد سياراته، والضغط يرشح */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 flex items-center gap-1"><Users className="w-3.5 h-3.5 text-[#f37121]" /> {ar ? 'التوزيع الحالي:' : 'Current split:'}</span>
        <button type="button" onClick={() => setOwnerFilter('')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${!ownerFilter ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200'}`}>
          {ar ? 'الكل' : 'All'} <b className="tabular-nums">{vehicles.length}</b>
        </button>
        {supervisors.map((s) => (
          <button key={s._id} type="button" onClick={() => setOwnerFilter(ownerFilter === s._id ? '' : s._id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${ownerFilter === s._id ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]'}`}>
            {supName(s)} <b className="tabular-nums">{counts.get(s._id) || 0}</b>
          </button>
        ))}
        <button type="button" onClick={() => setOwnerFilter(ownerFilter === 'none' ? '' : 'none')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${ownerFilter === 'none' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
          {ar ? 'غير مُسند' : 'Unassigned'} <b className="tabular-nums">{counts.get('none') || 0}</b>
        </button>
      </div>

      {/* شريط التنفيذ — ثابت أعلى القائمة */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3 sticky top-2 z-20">
        <div className="w-full sm:w-64">
          <SearchableSelect
            value={target} onChange={setTarget}
            placeholder={ar ? '— اختر المشرف —' : '— choose supervisor —'}
            searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search…'}
            options={supervisors.map((s) => ({ value: s._id, label: supName(s), hint: s.email }))}
          />
        </div>
        <button type="button" disabled={saving || !target || selected.size === 0} onClick={() => assign(target)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {ar ? `إسناد المحدد (${selected.size})` : `Assign selected (${selected.size})`}
        </button>
        <button type="button" disabled={saving || selected.size === 0} onClick={() => assign(null)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium disabled:opacity-40">
          {ar ? 'إلغاء إسناد المحدد' : 'Unassign selected'}
        </button>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'ابحث باللوحة أو السائق…' : 'Search plate / driver…'}
            className="w-full ps-9 pe-8 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* التشيك ليست */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="accent-[#f37121] w-4 h-4" />
            {ar ? `تحديد الكل (${filtered.length})` : `Select all (${filtered.length})`}
          </label>
          <span className="text-xs text-slate-500 tabular-nums">{ar ? `محدد: ${selected.size}` : `Selected: ${selected.size}`}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
          {filtered.map((v) => {
            const on = selected.has(v._id);
            return (
              <label key={v._id}
                className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition ${on ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 hover:border-slate-300'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(v._id)} className="mt-1 accent-[#f37121] w-4 h-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 font-mono text-sm flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-400" /> {v.plate}</span>
                    {v.supervisorName
                      ? <SmallBadge bg="bg-[#f37121]/10" text="text-[#f37121]" label={v.supervisorName} />
                      : <span className="text-[11px] text-slate-400">{ar ? 'غير مُسند' : 'Unassigned'}</span>}
                  </span>
                  <span className="block text-xs text-slate-600 mt-1 truncate">
                    {(v.drivers || []).length ? (v.drivers || []).map((d) => d.name).join(' · ') : (ar ? 'بدون سائق' : 'No driver')}
                    {v.trailerType ? ` · ${v.trailerType}` : ''}
                  </span>
                  {/* إسناد سريع لهذه السيارة وحدها — لا يمرّ عبر التحديد الجماعي. */}
                  <span className="block mt-2" onClick={(e) => e.preventDefault()}>
                    <select value={(v as any).supervisor ? String((v as any).supervisor) : ''}
                      onChange={(e) => quickAssign(v._id, e.target.value)}
                      className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700">
                      <option value="">{ar ? '— بدون مشرف —' : '— unassigned —'}</option>
                      {supervisors.map((s) => <option key={s._id} value={s._id}>{supName(s)}</option>)}
                    </select>
                  </span>
                </span>
              </label>
            );
          })}
          {filtered.length === 0 && <p className="col-span-full text-center text-slate-400 py-10">{ar ? 'لا توجد سيارات مطابقة.' : 'No matching vehicles.'}</p>}
        </div>
      </div>
    </div>
  );
}
