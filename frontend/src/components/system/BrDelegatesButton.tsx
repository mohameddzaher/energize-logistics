'use client';
/**
 * A section manager lets members of his team act for him in business review (backend utils/brDelegate):
 * they see the section's tasks and act on them as he would, under their own names. Shown to section managers only.
 */
import { useCallback, useEffect, useState } from 'react';
import { UserCheck, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { isBrParticipant } from '@/lib/businessReview';

interface Member { _id: string; name: string; role: string; delegated: boolean; actsForOther: boolean }

export default function BrDelegatesButton({ ar }: { ar: boolean }) {
  const { user } = useAuth();
  const { notify } = useDialog();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Member[] | null>(null);
  const [section, setSection] = useState('');
  const [sectionName, setSectionName] = useState<{ ar: string; en: string }>({ ar: '', en: '' });
  const [busy, setBusy] = useState('');
  const t = (a: string, e: string) => (ar ? a : e);
  // A delegate does not hand the section on; only its manager does.
  const allowed = !!user && isBrParticipant(user.role) && !(user as any).brActsFor;

  const load = useCallback(async () => {
    try { const d = await api.get<{ section: string; sectionAr?: string; sectionEn?: string; members: Member[] }>('/api/business-review/delegates'); setRows(d.members || []); setSection(d.section || ''); setSectionName({ ar: d.sectionAr || d.section || '', en: d.sectionEn || d.section || '' }); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); setRows([]); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (open && rows === null) load(); }, [open, rows, load]);
  if (!allowed) return null;

  const toggle = async (m: Member) => {
    setBusy(m._id);
    try {
      await api.put(`/api/business-review/delegates/${m._id}`, { on: !m.delegated });
      setRows((p) => (p || []).map((x) => (x._id === m._id ? { ...x, delegated: !m.delegated } : x)));
      notify(!m.delegated ? t(`فُوِّض ${m.name}`, `${m.name} delegated`) : t(`أُلغي تفويض ${m.name}`, `${m.name} revoked`), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };
  const count = (rows || []).filter((m) => m.delegated).length;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <UserCheck className="h-4 w-4 text-[#f37121]" />{t('تفويض الفريق', 'Delegate to team')}{count ? <span className="rounded-full bg-[#f37121] px-1.5 text-[11px] font-bold text-white tabular-nums">{count}</span> : null}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900">{t('تفويض مراجعة الأعمال', 'Business review delegation')}</p>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" title={t('إغلاق', 'Close')}><X className="h-4 w-4" /></button>
          </div>
          <p className="mb-3 text-[11.5px] text-slate-500">
            {t('مَن تفوّضه يرى بنود قسمك ويعمل عليها كما تعمل أنت، وتُسجَّل أفعاله باسمه.', 'A delegate sees your section’s items and works them as you do; actions are logged under their name.')}
            {section && <> {t('القسم', 'Section')}: <b>{t(sectionName.ar, sectionName.en)}</b></>}
          </p>
          {rows === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : !rows.length ? (
            <p className="py-4 text-center text-[12.5px] text-slate-500">{t('لا أعضاء في قسمك.', 'No members in your section.')}</p>
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {rows.map((m) => (
                <li key={m._id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-slate-900">{m.name}</span>
                    {m.actsForOther && <span className="block text-[11px] text-amber-600">{t('مفوَّض من مديرٍ آخر', 'Delegated by another manager')}</span>}
                  </span>
                  <button type="button" disabled={busy === m._id} onClick={() => toggle(m)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${m.delegated ? 'bg-[#f37121]' : 'bg-slate-300'} disabled:opacity-50`}
                    title={m.delegated ? t('إلغاء التفويض', 'Revoke') : t('تفويض', 'Delegate')}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${m.delegated ? 'start-[22px]' : 'start-0.5'}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
