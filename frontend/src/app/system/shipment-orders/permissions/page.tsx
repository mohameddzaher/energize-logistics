'use client';
// Which branches each data and follow-up user sees on the Shipments page. Same
// field as the user form, so a change in either place shows in the other.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ShieldCheck } from 'lucide-react';

type Branch = { key: string; ar: string; en: string };
type Row = { _id: string; name: string; email: string; roleAr: string; role: string; branches: string[]; self?: boolean };

export default function ShipmentBranchPermissionsPage() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selfLocked, setSelfLocked] = useState(false);
  const [q, setQ] = useState('');
  // role-only: management, the operations manager, and the data team for its own people.
  const allowed = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'data_manager', 'data_analyst'].includes(user?.role || '');

  const load = useCallback(async () => {
    const d = await api.get<{ branches: Branch[]; users: Row[]; selfLocked?: boolean }>('/api/shipment-orders/branch-access');
    setBranches(d.branches);
    setSelfLocked(!!d.selfLocked);
    setRows(d.users);
  }, []);
  useEffect(() => { if (allowed) load().catch(() => setRows([])); }, [allowed, load]);
  useSocket('shipmentOrders:branchAccess', () => { if (allowed) load().catch(() => {}); });

  const toggle = async (row: Row, key: string) => {
    const next = row.branches.includes(key) ? row.branches.filter((b) => b !== key) : [...row.branches, key];
    setRows((all) => (all || []).map((r) => (r._id === row._id ? { ...r, branches: next } : r)));
    try {
      await api.put(`/api/shipment-orders/branch-access/${row._id}`, { branches: next });
    } catch (e: any) {
      notify(e.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error');
      load().catch(() => {});
    }
  };

  if (!allowed) return <div className="p-6 text-slate-600">{ar ? 'هذه الصفحة للإدارة ومدير التشغيل وإدارة البيانات' : 'For management, the operations manager and the data team'}</div>;
  if (!rows) return <Spinner />;
  const shown = rows.filter((r) => `${r.name} ${r.email} ${r.roleAr}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-5 w-full">
      <PageHeader icon={<ShieldCheck className="w-6 h-6" />} title={ar ? 'الصلاحيات' : 'Permissions'}
        subtitle={ar ? 'الفروع المفتوحة لكل مستخدم في صفحة الشحنات. من بدون فرع يرى كل الفروع.' : 'Branches each user sees on the Shipments page. No branch selected means all branches.'} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم…' : 'Search by name…'}
        className="w-full sm:w-72 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900" />
      <div className="space-y-3">
        {shown.map((r) => (
          <div key={r._id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-bold text-slate-900">{r.name}</span>
              <span className="text-xs text-slate-500">{r.roleAr}</span>
              {selfLocked && r.self && <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">{ar ? 'حسابك — يعدّله مديرك أو الإدارة' : 'Your account — set by your manager or management'}</span>}
              <span className="text-xs text-slate-500 ms-auto">
                {r.branches.length ? (ar ? `${r.branches.length} فرع` : `${r.branches.length} branches`) : (ar ? 'كل الفروع' : 'All branches')}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {branches.map((b) => {
                const on = r.branches.includes(b.key);
                return (
                  <button key={b.key} type="button" onClick={() => toggle(r, b.key)} aria-pressed={on} disabled={selfLocked && r.self}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${on
                      ? 'bg-[#f37121] border-[#f37121] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    {ar ? b.ar : b.en}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!shown.length && <div className="text-sm text-slate-500 p-4">{ar ? 'لا يوجد مستخدمون' : 'No users'}</div>}
      </div>
    </div>
  );
}
