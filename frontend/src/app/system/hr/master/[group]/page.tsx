'use client';
// صفحة أي مجموعة: الإقامات، الجوازات، العقود، التأمين الطبي، الشهادات الصحية،
// بطاقات السائقين، رخص القيادة، البنوك، التأمينات الاجتماعية…
//
// صفحة واحدة بتتبنى من تعريف الحقول اللي جاي من السيرفر — عشان أي مجموعة
// تتضاف تلاقي نفس الكروت ونفس الفلاتر ونفس التعديل السريع، من غير ما حد يفتكر
// يعملها. ولو اتعملت صفحة بإيد لكل مجموعة كانوا هيفرقوا عن بعض بعد أول تعديل.
//
// الملء بيحصل **من نفس المكان**: تدوس على الخانة الناقصة وتكتبها. الحفظ بيشيل
// حالة «مطلوب» على السيرفر، فالعدّاد فوق بينقص لوحده.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ArrowRight, Search, Check, X, Pencil, ArrowUpDown } from 'lucide-react';
import {
  getHrRecords, updateEmployeeFields, STATUS_META, STATE_META, statusLabel, stateLabel,
  fmtDate, daysText, type RecordRow, type FieldDef,
} from '@/lib/hrMaster';
import { canEditSection } from '@/lib/sections';

const QUICK = [30, 60, 90, 180];

function GroupInner() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const params = useParams();
  const sp = useSearchParams();
  const { user } = useAuth();
  const { notify } = useDialog();
  const group = String(params?.group || '');

  const canEdit = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].includes((user as any)?.role)
    || canEditSection((user as any)?.permissions, 'HR');

  const [q, setQ] = useState('');
  const [field, setField] = useState(sp?.get('field') || '');
  const [status, setStatus] = useState(sp?.get('status') || '');
  const [state, setState] = useState(sp?.get('state') || '');
  const [within, setWithin] = useState(sp?.get('withinDays') || '');
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [d, setD] = useState<Awaited<ReturnType<typeof getHrRecords>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setD(await getHrRecords(group, {
        q: q.trim(), field, status, state, withinDays: within, sort, dir,
        // فلاتر القيم الجاية من كروت النظرة الشاملة (القسم، الجنسية…)
        ...Object.fromEntries([...(sp?.entries() || [])].filter(([k]) =>
          !['field', 'status', 'state', 'withinDays'].includes(k))),
      }));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [group, q, field, status, state, within, sort, dir, sp, notify]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  const g = d.group;
  const rows = d.rows;
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('القسم', 'Department'), key: 'department', width: 18 },
    ...g.fields.map((f) => ({
      header: ar ? f.ar : f.en, key: 'values',
      transform: (v: any, row: any) => {
        const raw = row.values?.[f.key];
        const st = row.statuses?.[f.key];
        if (st === 'required') return ar ? 'مطلوب' : 'Required';
        if (st === 'not_required') return ar ? 'غير مطلوب' : 'Not required';
        return f.type === 'date' ? fmtDate(raw) : (raw ?? '');
      }, width: 18,
    })),
  ];

  const toggleSort = (key: string) => {
    if (sort === key) setDir((x) => (x === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir('asc'); }
  };

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <button onClick={() => router.push('/system/hr/master')}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />{t('النظرة الشاملة', 'Overview')}
      </button>

      <PageHeader icon={<Pencil className="w-5 h-5" />} title={ar ? g.ar : g.en}
        subtitle={t('اضغط أي خانة ناقصة واملأها من هنا مباشرة', 'Click any missing cell and fill it right here')}>
        <ExportMenu fileName={`hr-${group}`} lang={lang as 'ar' | 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: ar ? g.ar : g.en, rows, columns: cols }] }]} />
      </PageHeader>

      {/* كروت الحالة لكل حقل — نفس أرقام النظرة الشاملة، بس على المعروض */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {g.fields.map((f) => {
          const s = d.summary[f.key] || {};
          return (
            <div key={f.key} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm">
              <p className="text-[12px] font-semibold text-slate-700 mb-1.5">{ar ? f.ar : f.en}</p>
              <div className="flex flex-wrap gap-1">
                {(['required', 'not_required', 'filled', 'none'] as const).map((k) => (s[k] > 0) && (
                  <button key={k}
                    onClick={() => { setField(f.key); setStatus(status === k && field === f.key ? '' : k); }}
                    className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${STATUS_META[k].bg} ${
                      field === f.key && status === k ? 'ring-2 ring-offset-1 ring-[#f37121]' : ''}`}>
                    {statusLabel(k, ar)} {s[k]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* حالات التاريخ لو المجموعة مستند */}
      {g.document && d.summary.states && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          {(['expired', 'critical', 'warning', 'valid', 'missing', 'not_applicable'] as const).map((k) => (
            <button key={k} onClick={() => setState(state === k ? '' : k)}
              className={`text-start bg-white border rounded-xl p-3 shadow-sm ${state === k ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-xl font-extrabold leading-none" style={{ color: STATE_META[k].color }}>{d.summary.states[k]}</p>
              <p className="text-[10.5px] text-slate-500 mt-1.5 leading-tight">{stateLabel(k, ar)}</p>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('اسم / رقم وظيفي / رقم هوية…', 'name / employee no / ID…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        </div>
        <select value={field} onChange={(e) => setField(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحقول', 'All fields')}</option>
          {g.fields.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          {['required', 'not_required', 'filled', 'none'].map((k) => <option key={k} value={k}>{statusLabel(k, ar)}</option>)}
        </select>
        {g.document && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{t('ينتهي خلال', 'Within')}</span>
            <input type="number" min={0} value={within} onChange={(e) => setWithin(e.target.value)}
              className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm text-center" />
            {QUICK.map((n) => (
              <button key={n} onClick={() => setWithin(String(n))}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>{n}</button>
            ))}
          </div>
        )}
        {(q || field || status || state || within) && (
          <button onClick={() => { setQ(''); setField(''); setStatus(''); setState(''); setWithin(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 hover:text-slate-800">
            {t('إلغاء الفلترة', 'Clear')}
          </button>
        )}
        <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('موظف', 'people')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                  <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('الموظف', 'Employee')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">{t('القسم', 'Department')}</th>
                {g.fields.map((f) => (
                  <th key={f.key} className="px-3 py-3 text-center font-bold whitespace-nowrap">
                    <button onClick={() => toggleSort(f.key)} className="inline-flex items-center gap-1 hover:text-white">
                      {ar ? f.ar : f.en}<ArrowUpDown className="w-3 h-3 opacity-60" />
                    </button>
                  </th>
                ))}
                {g.document && (
                  <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                    <button onClick={() => toggleSort('daysRemaining')} className="inline-flex items-center gap-1 hover:text-white">
                      {t('المتبقي', 'Left')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Row key={r._id} r={r} fields={g.fields} isDoc={g.document} ar={ar} t={t}
                  canEdit={canEdit} onSaved={load} notify={notify} router={router} />
              ))}
              {!rows.length && (
                <tr><td colSpan={g.fields.length + 3} className="px-3 py-12 text-center text-slate-400">
                  {t('لا نتائج بالفلاتر دي', 'Nothing matches these filters')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── صف موظف: كل خانة قابلة للتعديل في مكانها ─────────────────────────────────
function Row({ r, fields, isDoc, ar, t, canEdit, onSaved, notify, router }: any) {
  const m = r.state ? STATE_META[r.state] : null;
  return (
    <tr className="hover:bg-slate-50 text-center align-middle">
      <td className="px-3 py-2.5">
        <button onClick={() => router.push(`/system/hr/employees/${r._id}`)}
          className="font-semibold text-slate-800 hover:text-[#f37121]">{r.name}</button>
        {r.employeeNumber && <p className="text-[10px] text-slate-400">{r.employeeNumber}</p>}
      </td>
      <td className="px-3 py-2.5 text-slate-500 text-[12px]">{r.department || '—'}</td>
      {fields.map((f: FieldDef) => (
        <td key={f.key} className="px-3 py-2.5">
          <Cell r={r} f={f} ar={ar} t={t} canEdit={canEdit} onSaved={onSaved} notify={notify} />
        </td>
      ))}
      {isDoc && (
        <td className="px-3 py-2.5 whitespace-nowrap font-bold" style={{ color: m?.color }}>
          {r.daysRemaining == null ? <span className="text-slate-300">—</span> : daysText(r.daysRemaining, ar)}
        </td>
      )}
    </tr>
  );
}

/** خانة واحدة — بتعرض القيمة، أو «مطلوب» بلون واضح، والضغط بيفتحها للكتابة. */
function Cell({ r, f, ar, t, canEdit, onSaved, notify }: any) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const st = r.statuses[f.key];
  const raw = r.values[f.key];

  const start = () => {
    if (!canEdit) return;
    setVal(f.type === 'date' && raw ? new Date(raw).toISOString().slice(0, 10) : (raw ?? ''));
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateEmployeeFields(r._id, { [f.key]: val });
      notify(ar ? 'تم الحفظ' : 'Saved', 'success');
      setEditing(false);
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input type={f.type === 'date' ? 'date' : 'text'} value={val} autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="w-32 px-2 py-1 rounded border border-[#f37121] text-[12px] text-center" />
        <button onClick={save} disabled={busy} className="p-1 rounded bg-emerald-50 text-emerald-700"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={() => setEditing(false)} className="p-1 rounded text-slate-400"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  // «مطلوب» بلون واضح — دي مش قيمة فاضية، دي شغل مطلوب.
  if (st === 'required') {
    return (
      <button onClick={start} disabled={!canEdit}
        className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold hover:bg-red-200 disabled:hover:bg-red-100">
        {t('مطلوب', 'Required')}
      </button>
    );
  }
  if (st === 'not_required' || st === 'none' || st === 'cash_payroll') {
    return <span className={`px-2 py-0.5 rounded-full text-[11px] ${STATUS_META[st].bg}`}>{statusLabel(st, ar)}</span>;
  }
  return (
    <button onClick={start} disabled={!canEdit}
      className="text-[12px] text-slate-700 hover:text-[#f37121] disabled:hover:text-slate-700">
      {f.type === 'date' ? fmtDate(raw) : (raw || '—')}
    </button>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><GroupInner /></Suspense>;
}
