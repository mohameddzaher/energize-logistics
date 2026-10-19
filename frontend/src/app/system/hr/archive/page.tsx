'use client';
/**
 * الأرشيف — مَن انتهت خدمتُه وخرج من النظام، والفريلانسرُ الذي انتهت خدمتُه.
 *
 * المؤرشَفُ لا يظهر في أيّ شاشةٍ أخرى ولا رقمٍ — هنا وحدَه (وكارتُه في لوحة
 * الموارد البشريّة). والأرشفةُ لا تمحو: ملفُّه كاملٌ يُفتَح من هنا. والترتيب:
 * إنهاءُ الخدمة ← «خروج من النظام» (من ملفّ الموظّف) ← الأرشيف. راجع
 * backend/src/controllers/hrArchiveController.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Archive, Search, Undo2 } from 'lucide-react';

interface Row {
  _id: string; name: string; employeeNumber?: string; iqamaNumber?: string; nationalId?: string; nationality?: string;
  department?: string; project?: string; jobTitle?: string; registerNumber?: string; engagement: '' | 'sponsored' | 'freelance' | 'trainee';
  terminatedAt?: string; terminationReason?: string; hireDate?: string;
}
const fmt = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export default function HrArchivePage() {
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [d, setD] = useState<{ items: Row[]; counts: { total: number; sponsored: number; freelance: number } } | null>(null);
  const [q, setQ] = useState('');
  const { begin, isCurrent } = useLatestRequest();

  const load = useCallback(async () => {
    const token = begin();
    try {
      const r = await api.get<any>(`/api/hr/archive${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
      if (isCurrent(token)) setD(r);
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  useSocket('hr:employee', load);
  useSocket('hr:master', load);

  const returnBack = async (r: Row) => {
    if (!(await confirm({ title: t('إعادة إلى النظام؟', 'Return to the system?'), message: t(`يعود ${r.name} داخل النظام ويخرج من الأرشيف — لتصحيح خروجٍ سُجِّل خطأً.`, 'For correcting an exit recorded by mistake.'), confirmLabel: t('إعادة', 'Return') }))) return;
    try { await api.post(`/api/hr/employees/${r._id}/return-system`, {}); notify(t('أُعيد إلى النظام', 'Returned'), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر', 'Failed'), 'error'); }
  };

  if (!d) return <Spinner />;
  const engLabel = (k: Row['engagement']) => (k === 'sponsored' ? t('على الكفالة', 'Sponsored') : k === 'freelance' ? t('فريلانسر', 'Freelance') : k === 'trainee' ? t('متدرب', 'Trainee') : '—');
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Emp. no.'), key: 'employeeNumber', width: 12 },
    { header: t('الموظف', 'Employee'), key: 'name', width: 28 },
    { header: t('رقم الهوية / الإقامة', 'ID / Iqama'), key: 'iqamaNumber', width: 16, transform: (v, r: any) => v || r.nationalId || '—' },
    { header: t('النوع', 'Type'), key: 'engagement', width: 12, transform: (v) => engLabel(v) },
    { header: t('القسم', 'Department'), key: 'department', width: 16, transform: (v) => v || '—' },
    { header: t('تاريخ انتهاء الخدمة', 'Service ended'), key: 'terminatedAt', width: 14, transform: (v) => fmt(v) },
    { header: t('السبب', 'Reason'), key: 'terminationReason', width: 30, transform: (v) => v || '—' },
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Archive className="w-6 h-6 text-[#f37121]" />}
        title={t('الأرشيف', 'Archive')}
        subtitle={t('مَن انتهت خدمته وخرج من النظام، والفريلانسر الذي انتهت خدمته — لا يظهرون في أي شاشة أو رقم آخر', 'Ended and out of the system, and freelancers whose service ended — they appear nowhere else')} />

      <div className="grid grid-cols-3 gap-2.5 sm:max-w-xl">
        {([[t('في الأرشيف', 'Archived'), d.counts.total, '#475569'], [t('على الكفالة', 'Sponsored'), d.counts.sponsored, '#4f46e5'], [t('فريلانسر', 'Freelance'), d.counts.freelance, '#0f172a']] as const).map(([label, v, c]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-xl font-extrabold tabular-nums" style={{ color: c }}>{v}</p>
            <p className="mt-1 text-[11px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('الاسم، الرقم الوظيفي، رقم الهوية…', 'Name, emp. no., ID…')}
            className="w-64 rounded-lg border border-slate-200 py-2 pe-2 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        <span className="ms-auto">
          <ExportMenu fileName="hr-archive" lang={ar ? 'ar' : 'en'} variant="subtle"
            options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الأرشيف', 'Archive'), rows: d.items, columns: cols }] }]} />
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="bg-slate-900 text-slate-300">
                {[t('الرقم الوظيفي', 'Emp. no.'), t('الموظف', 'Employee'), t('رقم الهوية / الإقامة', 'ID / Iqama'), t('النوع', 'Type'), t('القسم', 'Department'), t('انتهت الخدمة', 'Ended'), t('السبب', 'Reason'), ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 text-start font-semibold whitespace-nowrap ${i === 1 ? 'w-56' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{t('الأرشيف فارغ.', 'The archive is empty.')}</td></tr>
              ) : d.items.map((r) => (
                <tr key={r._id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/system/hr/employees/${r._id}`)}>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.employeeNumber || '—'}</td>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 font-semibold text-slate-900" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600"><bdi>{r.iqamaNumber || r.nationalId || '—'}</bdi></td>
                  <td className="px-3 py-2.5 text-slate-600">{engLabel(r.engagement)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{r.department || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmt(r.terminatedAt)}</td>
                  <td className="max-w-[16rem] truncate px-3 py-2.5 text-slate-500" title={r.terminationReason || ''}>{r.terminationReason || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-end">
                    {r.engagement !== 'freelance' && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); returnBack(r); }} title={t('إعادة إلى النظام', 'Return to the system')}
                        className="p-1 text-slate-300 hover:text-[#f37121]"><Undo2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
