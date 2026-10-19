'use client';
/**
 * مشاريعُ المشرفين ومديري المشاريع (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * لكلّ حسابِ إشرافٍ في القسم مشروعٌ أو أكثر — ومنه يرى في «مدخلات الأوردرات»
 * مناديبَ مشاريعه وحدَها ويكتب لهم. والإسنادُ لنائب مدير القطاع ومدير القسم
 * والإدارة (`canEdit` من الخادم)، وغيرُهم يرى ولا يغيّر.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { getB2CManagers, setB2CManagerProjects, type B2CManager } from '@/lib/lightTransport';
import { Check } from 'lucide-react';

export default function ManagersProjects({ open, onClose, ar }: { open: boolean; onClose: () => void; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [list, setList] = useState<B2CManager[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    getB2CManagers().then((d) => { setList(d.managers || []); setProjects(d.projects || []); setCanEdit(!!d.canEdit); }).catch(() => {});
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  useSocket('b2c:entry:scope', useCallback(() => { if (open) load(); }, [open, load]));

  const toggle = async (m: B2CManager, p: string) => {
    if (!canEdit) return;
    const next = m.projects.includes(p) ? m.projects.filter((x) => x !== p) : [...m.projects, p];
    setBusy(m._id);
    try {
      await setB2CManagerProjects(m._id, next);
      setList((l) => l.map((x) => (x._id === m._id ? { ...x, projects: next } : x)));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={t('مشاريع المشرفين ومديري المشاريع', 'Supervisors’ projects')}>
      <p className="mb-3 text-sm text-slate-600">
        {t('كل مشرف أو مدير مشروع يرى في «مدخلات الأوردرات» مناديب مشاريعه فقط. اضغط على المشروع لإسناده أو رفعه.',
          'Each supervisor sees only the reps of his projects in Orders entry. Click a project to toggle it.')}
      </p>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {list.map((m) => (
          <div key={m._id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <div className="min-w-[180px] flex-1">
              <p className="text-[13.5px] font-bold text-slate-900">{m.name}</p>
              <p className="text-[11px] text-slate-400">{m.role}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {projects.map((p) => {
                const on = m.projects.includes(p);
                return (
                  <button key={p} type="button" disabled={!canEdit || busy === m._id} onClick={() => toggle(m, p)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition
                      ${on ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[#f37121]/60'} disabled:cursor-default`}>
                    {on && <Check className="h-3 w-3" />}{p}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!list.length && <p className="px-3 py-6 text-center text-sm text-slate-400">{t('لا مشرفين بحسابات بعد', 'No supervisor accounts yet')}</p>}
      </div>
    </Modal>
  );
}
