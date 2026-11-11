'use client';
/**
 * Archive: staff whose service ended and who left the system, plus freelancers whose service ended.
 * Archived staff appear on no other screen or figure, only here (and its card on the HR dashboard). Archiving erases nothing: the full file opens from here. Order: end of service, then 'leave system' (from the employee file), then archive. See backend/src/controllers/hrArchiveController.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Archive, Search, Undo2, X, ChevronDown } from 'lucide-react';
import SearchSelect from '@/components/system/SearchSelect';
import DateRangeFilter from '@/components/system/DateRangeFilter';

interface Row {
  _id: string; name: string; employeeNumber?: string; iqamaNumber?: string; nationalId?: string; nationality?: string;
  department?: string; project?: string; jobTitle?: string; registerNumber?: string; engagement: '' | 'sponsored' | 'freelance' | 'trainee';
  terminatedAt?: string; terminationReason?: string; hireDate?: string;
  endDate?: string; endSource?: string; kindLabel?: string; terminationKind?: string; terminatedByName?: string; exitedAt?: string; exitedByName?: string; phone?: string;
}
type Opts = { departments: string[]; jobTitles: string[]; nationalities: string[]; kinds: { key: string; ar: string; en: string }[] };
const fmt = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export default function HrArchivePage() {
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [d, setD] = useState<{ items: Row[]; counts: { total: number; sponsored: number; freelance: number }; options?: Opts } | null>(null);
  const [q, setQ] = useState('');
  const [f, setF] = useState({ from: '', to: '', engagement: '', kind: '', department: '', jobTitle: '', nationality: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const setOne = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const anyFilter = !!q.trim() || Object.values(f).some(Boolean);
  const { begin, isCurrent } = useLatestRequest();

  const load = useCallback(async () => {
    const token = begin();
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
      const r = await api.get<any>(`/api/hr/archive${p.toString() ? `?${p}` : ''}`);
      if (isCurrent(token)) setD(r);
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, f]);
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
    { header: t('المسمّى الوظيفي', 'Job title'), key: 'jobTitle', width: 18, transform: (v) => v || '—' },
    { header: t('الجنسية', 'Nationality'), key: 'nationality', width: 12, transform: (v) => v || '—' },
    { header: t('تاريخ انتهاء الخدمة', 'Service ended'), key: 'endDate', width: 14, transform: (v) => fmt(v) },
    { header: t('نوع الإنهاء', 'Kind'), key: 'kindLabel', width: 18, transform: (v) => v || '—' },
    { header: t('السبب', 'Reason'), key: 'terminationReason', width: 30, transform: (v) => v || '—' },
    { header: t('سجّل الإنهاء', 'Ended by'), key: 'terminatedByName', width: 18, transform: (v) => v || '—' },
    { header: t('الخروج من النظام', 'Left the system'), key: 'exitedAt', width: 14, transform: (v) => fmt(v) },
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

      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[16rem] max-w-md">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو الرقم الوظيفي أو رقم الإقامة / الهوية أو الجوال…', 'Name, emp. no., iqama / ID, phone…')}
              className="w-full rounded-lg border border-slate-300 py-2 pe-8 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
            {q && <button type="button" onClick={() => setQ('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
          </div>
          <DateRangeFilter ar={ar} from={f.from} to={f.to} onFrom={(v) => setOne('from', v)} onTo={(v) => setOne('to', v)} />
          <span className="ms-auto">
            <ExportMenu fileName="hr-archive" lang={ar ? 'ar' : 'en'} variant="subtle"
              options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الأرشيف', 'Archive'), rows: d.items, columns: cols }] }]} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <SearchSelect ar={ar} value={f.engagement} onChange={(v) => setOne('engagement', v)} allLabel={t('كل الأنواع', 'All types')}
            options={[{ value: 'sponsored', label: t('على الكفالة', 'Sponsored') }, { value: 'freelance', label: t('فريلانسر', 'Freelance') }, { value: 'trainee', label: t('متدرب', 'Trainee') }]} />
          <SearchSelect ar={ar} value={f.kind} onChange={(v) => setOne('kind', v)} allLabel={t('كل أنواع الإنهاء', 'All end kinds')}
            options={[...(d.options?.kinds || []).map((k) => ({ value: k.key, label: ar ? k.ar : k.en })), { value: 'none', label: t('غير محدّد', 'Not set') }]} />
          <SearchSelect ar={ar} value={f.department} onChange={(v) => setOne('department', v)} allLabel={t('كل الأقسام', 'All departments')}
            options={(d.options?.departments || []).map((x) => ({ value: x, label: x }))} />
          <SearchSelect ar={ar} value={f.jobTitle} onChange={(v) => setOne('jobTitle', v)} allLabel={t('كل المسمّيات', 'All job titles')}
            options={(d.options?.jobTitles || []).map((x) => ({ value: x, label: x }))} />
          <SearchSelect ar={ar} value={f.nationality} onChange={(v) => setOne('nationality', v)} allLabel={t('كل الجنسيات', 'All nationalities')}
            options={(d.options?.nationalities || []).map((x) => ({ value: x, label: x }))} />
        </div>
        {anyFilter && (
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-500">{t(`النتائج: ${d.items.length}`, `Results: ${d.items.length}`)}</span>
            <button type="button" onClick={() => { setQ(''); setF({ from: '', to: '', engagement: '', kind: '', department: '', jobTitle: '', nationality: '' }); }}
              className="font-bold text-[#f37121] hover:underline">{t('مسح الفلاتر', 'Clear filters')}</button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="bg-slate-900 text-slate-300">
                {[t('الرقم الوظيفي', 'Emp. no.'), t('الموظف', 'Employee'), t('رقم الهوية / الإقامة', 'ID / Iqama'), t('النوع', 'Type'), t('القسم والمسمّى', 'Department · title'), t('انتهت الخدمة', 'Ended'), t('نوع الإنهاء والسبب', 'Kind · reason'), ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 text-start font-semibold whitespace-nowrap ${i === 1 ? 'w-56' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{t('الأرشيف فارغ.', 'The archive is empty.')}</td></tr>
              ) : d.items.map((r) => (
                <Fragment key={r._id}>
                <tr className={`cursor-pointer ${openId === r._id ? 'bg-orange-50/50' : 'hover:bg-slate-50'}`} onClick={() => setOpenId(openId === r._id ? null : r._id)}>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.employeeNumber || '—'}</td>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 font-semibold text-slate-900" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600"><bdi>{r.iqamaNumber || r.nationalId || '—'}</bdi></td>
                  <td className="px-3 py-2.5 text-slate-600">{engLabel(r.engagement)}</td>
                  <td className="px-3 py-2.5 text-slate-600"><p>{r.department || '—'}</p>{r.jobTitle && <p className="text-[11.5px] text-slate-400">{r.jobTitle}</p>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{fmt(r.endDate)}{r.endSource === 'contract' && <p className="text-[10.5px] text-slate-400">{t('من نهاية آخر عقد', 'last contract end')}</p>}</td>
                  <td className="max-w-[18rem] px-3 py-2.5 text-slate-600">
                    {r.kindLabel && <span className="me-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{r.kindLabel}</span>}
                    <span className="text-slate-500 line-clamp-1" title={r.terminationReason || ''}>{r.terminationReason || (r.kindLabel ? '' : '—')}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-end">
                    {r.engagement !== 'freelance' && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); returnBack(r); }} title={t('إعادة إلى النظام', 'Return to the system')}
                        className="p-1 text-slate-300 hover:text-[#f37121]"><Undo2 className="h-4 w-4" /></button>
                    )}
                    <ChevronDown className={`inline h-4 w-4 text-slate-400 transition-transform ${openId === r._id ? 'rotate-180' : ''}`} />
                  </td>
                </tr>
                {openId === r._id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50/70 px-4 py-3">
                      <div className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          [t('تاريخ التعيين', 'Hired'), fmt(r.hireDate)],
                          [t('تاريخ انتهاء الخدمة', 'Service ended'), `${fmt(r.endDate)}${r.endSource === 'contract' ? ` (${t('نهاية آخر عقد', 'last contract end')})` : ''}`],
                          [t('نوع الإنهاء', 'Kind'), r.kindLabel || '—'],
                          [t('سجّل الإنهاء', 'Ended by'), r.terminatedByName || '—'],
                          [t('الخروج من النظام', 'Left the system'), r.exitedAt ? `${fmt(r.exitedAt)}${r.exitedByName ? ` — ${r.exitedByName}` : ''}` : (r.engagement === 'freelance' ? t('فريلانسر: يُؤرشَف بإنهاء الخدمة', 'Freelance: archived on termination') : '—')],
                          [t('الجنسية', 'Nationality'), r.nationality || '—'],
                          [t('المشروع', 'Project'), r.project || '—'],
                          [t('الجوال', 'Phone'), r.phone || '—'],
                        ].map(([k, v]) => (
                          <div key={k}><p className="text-[11px] font-semibold text-slate-500">{k}</p><p className="font-semibold text-slate-800">{v}</p></div>
                        ))}
                        <div className="sm:col-span-2 lg:col-span-4"><p className="text-[11px] font-semibold text-slate-500">{t('سبب إنهاء الخدمة', 'Reason')}</p><p className="whitespace-pre-wrap text-slate-800">{r.terminationReason || t('لم يُكتب سبب', 'No reason written')}</p></div>
                      </div>
                      <button type="button" onClick={() => router.push(`/system/hr/employees/${r._id}`)} className="mt-3 rounded-lg bg-[#f37121] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#e06010]">{t('فتح الملف الكامل', 'Open the full file')}</button>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
