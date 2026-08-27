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
//
// وفوق الملء خانةً خانة، للصفحة ثلاثة أفعالٍ كاملة على بيانات المجموعة:
// «إضافة» تفتح ملفّ المجموعة لموظّفٍ لا بيانات له فيها، و«تعديل» تفتح حقول
// المجموعة وحدَها لشخصٍ واحد مجتمعةً — لا استمارة الموظّف كلَّها، فتلك في ملفّه
// وتكرارها هنا يُفرغ هذه الصفحات من معناها — و«تفريغ» تمحو بيانات هذه المجموعة
// عنده وحدَه. ولا شيء منها يحذف موظّفًا: انظر components/hr/HrGroupModals.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Search, Check, X, Pencil, ArrowUpDown, RefreshCw, ArrowRight, Plus, Trash2 } from 'lucide-react';
import {
  getHrRecords, updateEmployeeFields, renewHrDocument, renewHrBulk, RENEWABLE_GROUPS,
  STATUS_META, STATE_META, statusLabel, stateLabel,
  fmtDate, toDateInput, daysText, type RecordRow, type FieldDef,
} from '@/lib/hrMaster';
import SelectionBar from '@/components/ls2/SelectionBar';
import { canEditSection } from '@/lib/sections';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import { HR_DATE_FIELDS, HR_NUM_RANGES } from '@/lib/hrMaster';
import MasterNav from '@/components/hr/MasterNav';
import ContractsTabs from '@/components/hr/ContractsTabs';
import { HrGroupFormModal, HrGroupClearModal } from '@/components/hr/HrGroupModals';

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
  // «ينتهي خلال ٣٠ يوم» ماكانش بيستثني المنتهي من سنة — فكان بيطلع معاه ويبوّظ
  // الرقم. الاختيار بقى صريح للمستخدم زي شاشة المركبات.
  const [includeExpired, setIncludeExpired] = useState(true);
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  // الفلتر القادم من النظرة الشاملة يظل مرئيًّا وقابلًا للتعديل هنا. لو بقي
  // خفيًّا لرأى المستخدم جدولًا أقصر مما يتوقّع ولا يعرف السبب — وهذا أسوأ من
  // ألا يكون هناك فلتر أصلًا.
  const CTRL = ['field', 'status', 'state', 'withinDays', 'sort', 'dir', 'includeExpired', 'q'];
  // ملاحظة: `employment` ليست من CTRL — فهي فلتر يظهر في اللوحة كبقيّة الفلاتر.
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => !CTRL.includes(k))));
  const [d, setD] = useState<Awaited<ReturnType<typeof getHrRecords>> | null>(null);
  const [loading, setLoading] = useState(true);
  // ── التحديد والتجديد ───────────────────────────────────────────────────────
  // المجموعات ذات تاريخ الانتهاء وحدها تقبل التجديد؛ «البيانات البنكية» لا
  // تنتهي فلا معنى لزرّ تجديد فيها.
  const renewable = RENEWABLE_GROUPS.has(group);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [renewing, setRenewing] = useState<RecordRow | null>(null);
  // ── إنشاء / تعديل / تفريغ ──────────────────────────────────────────────────
  // نموذجٌ واحد للحالتين: «إضافة» تختار الموظّف ثم تملأ، و«تعديل» تبدأ بموظّفٍ
  // معروف. فصلُهما مكوّنين يجعل حقلًا يُضاف إلى المجموعة يظهر في أحدهما فقط.
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row: RecordRow | null } | null>(null);
  const [clearing, setClearing] = useState<RecordRow | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await getHrRecords(group, {
        q: q.trim(), field, status, state, withinDays: within, sort, dir,
        includeExpired: includeExpired ? '1' : '0',
        // فلاتر القيم القادمة من بطاقات النظرة الشاملة (القسم، الجنسية، المدد…)
        ...filters,
      }));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [group, q, field, status, state, within, includeExpired, sort, dir, JSON.stringify(filters), notify]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  // ── ما تختاره هنا يعيش في عنوان الصفحة ─────────────────────────────────────
  // كان الفلتر يُقرأ من العنوان مرّةً عند الفتح ثم ينفصل عنه: ترفع شرطًا أو
  // تضيف آخر فيتغيّر الجدول ويبقى العنوان على حاله — فالرجوع بزرّ المتصفّح
  // يعيدك إلى ما لم تعد فيه، والتحديث يمسح ما بنيتَه.
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    if (field) p.set('field', field);
    if (status) p.set('status', status);
    if (state) p.set('state', state);
    if (within) p.set('withinDays', within);
    const q = p.toString();
    router.replace(`/system/hr/master/${group}${q ? `?${q}` : ''}`, { scroll: false });
  }, [JSON.stringify(filters), field, status, state, within, group, router]);

  /** الرجوع إلى النظرة الشاملة حاملًا الفلتر الحاليّ — لا مُلقيًا به. */
  const backToOverview = () => {
    const q = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== '' && v != null) as [string, string][]).toString();
    router.push(`/system/hr/master${q ? `?${q}` : ''}`);
  };
  // التحديد يسقط مع تغيّر الفلاتر: صفٌّ اختير ثم خرج من النتيجة يبقى محدَّدًا
  // بلا أن يُرى، فتُجدَّد في الدفعة أسماءٌ لا تظهر على الشاشة.
  useEffect(() => { setPicked(new Set()); }, [group, q, field, status, state, within, includeExpired, JSON.stringify(filters)]);

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  const g = d.group;
  const rows = d.rows;
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('رقم الهوية', 'ID number'), key: 'iqamaNumber', width: 16 },
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
      <MasterNav />
      <button onClick={backToOverview}
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {t('النظرة الشاملة', 'Overview')}
      </button>
      {group === 'contract' && <ContractsTabs />}

      <PageHeader icon={<Pencil className="w-5 h-5" />} title={ar ? g.ar : g.en}
        subtitle={t('اضغط أي خانة ناقصة واملأها من هنا مباشرة', 'Click any missing cell and fill it right here')}>
        <ExportMenu fileName={`hr-${group}`} lang={lang as 'ar' | 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: ar ? g.ar : g.en, rows, columns: cols }] }]} />
        {canEdit && (
          <button onClick={() => setForm({ mode: 'create', row: null })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-semibold">
            <Plus className="w-4 h-4" />{t('إضافة بيانات', 'Add data')}
          </button>
        )}
      </PageHeader>

      {/* الفلتر — يشمل ما جاء محمولًا من النظرة الشاملة، ظاهرًا وقابلًا للرفع */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <FilterPanel
          optionsUrl="/api/hr/master/filters"
          value={filters}
          onChange={setFilters}
          dateFields={HR_DATE_FIELDS}
          numRanges={HR_NUM_RANGES}
          extraLabels={{
            employment: { ar: 'حالة التوظيف', en: 'Employment', values: {
              active: { ar: 'على رأس العمل', en: 'Active' },
              inactive: { ar: 'ليس على رأس العمل', en: 'Not active' } } },
            outsideKingdom: { ar: 'خارج المملكة', en: 'Outside kingdom', values: { 1: { ar: 'خارج المملكة', en: 'Outside kingdom' } } },
            freelancer: { ar: 'عمل حر', en: 'Freelancer', values: { 1: { ar: 'عمل حر', en: 'Freelancer' } } },
          }}
          resultCount={rows.length}
          resultLabel={t('الصفوف المعروضة', 'Rows shown')}
        />
      </div>

      {/* كروت الحالة لكل حقل — نفس أرقام النظرة الشاملة، بس على المعروض */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {g.fields.map((f) => {
          const s = d.summary[f.key] || {};
          return (
            <div key={f.key} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm">
              <p className="text-[12.5px] font-bold text-slate-800 mb-1.5">{ar ? f.ar : f.en}</p>
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
              <p className="text-[11px] text-slate-600 mt-1.5 leading-tight font-medium">{stateLabel(k, ar)}</p>
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
            <span className="text-xs text-slate-700 font-medium whitespace-nowrap">{t('ينتهي خلال', 'Within')}</span>
            <input type="number" min={0} value={within} onChange={(e) => setWithin(e.target.value)}
              className="w-20 px-2 py-2 rounded-lg border border-slate-200 text-sm text-center" />
            {QUICK.map((n) => (
              <button key={n} onClick={() => setWithin(String(n))}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${within === String(n) ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200'}`}>{n}</button>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} className="accent-[#f37121]" />
              {t('مع المنتهي', 'incl. expired')}
            </label>
          </div>
        )}
        {(q || field || status || state || within) && (
          <button onClick={() => { setQ(''); setField(''); setStatus(''); setState(''); setWithin(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:text-slate-900">
            {t('إلغاء الفلترة', 'Clear')}
          </button>
        )}
        <span className="text-[12.5px] font-semibold text-slate-700 ms-auto whitespace-nowrap">{rows.length} {t('موظف', 'people')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {renewable && canEdit && (
                  <th className="px-3 py-3 w-9">
                    <input type="checkbox" className="accent-[#f37121]"
                      title={t('اختيار كل المعروض', 'Select all shown')}
                      checked={rows.length > 0 && rows.every((x) => picked.has(x._id))}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p);
                        rows.forEach((x) => (e.target.checked ? n.add(x._id) : n.delete(x._id)));
                        return n;
                      })} />
                  </th>
                )}
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                  <button onClick={() => toggleSort('employeeNumber')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('الرقم الوظيفي', 'Emp. no.')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                  <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('الموظف', 'Employee')}<ArrowUpDown className="w-3 h-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-bold whitespace-nowrap">
                  <button onClick={() => toggleSort('iqamaNumber')} className="inline-flex items-center gap-1 hover:text-white">
                    {t('رقم الهوية', 'ID number')}<ArrowUpDown className="w-3 h-3 opacity-60" />
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
                {canEdit && <th className="px-3 py-3 text-center font-bold whitespace-nowrap">{t('إجراءات', 'Actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Row key={r._id} r={r} fields={g.fields} isDoc={g.document} ar={ar} t={t}
                  canEdit={canEdit} onSaved={load} notify={notify} router={router}
                  renewable={renewable} picked={picked} setPicked={setPicked} onRenew={setRenewing}
                  onEdit={(x: RecordRow) => setForm({ mode: 'edit', row: x })} onClear={setClearing} />
              ))}
              {!rows.length && (
                <tr><td colSpan={4 + g.fields.length + (g.document ? 1 : 0) + (renewable && canEdit ? 1 : 0) + (canEdit ? 1 : 0)} className="px-3 py-12 text-center text-slate-500">
                  {t('لا نتائج بالفلاتر دي', 'Nothing matches these filters')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {renewable && canEdit && (
        <SelectionBar
          count={picked.size} ar={ar} tone="green"
          label={t(`${picked.size} مستند محدَّد`, `${picked.size} selected`)}
          hint={t('يُسجَّل لها جميعًا تاريخ تجديد واحد', 'All get one renewal date')}
          actionLabel={t(`تجديدها بتاريخ واحد (${picked.size})`, `Renew to one date (${picked.size})`)}
          onAction={() => setBulk(true)}
          onClear={() => setPicked(new Set())} />
      )}

      {bulk && (
        <HrBulkRenewModal
          rows={rows.filter((r) => picked.has(r._id))} group={group} groupLabel={ar ? g.ar : g.en} ar={ar}
          onClose={() => setBulk(false)}
          onDone={() => { setBulk(false); setPicked(new Set()); load(); }} />
      )}

      {renewing && (
        <HrRenewModal row={renewing} group={group} groupLabel={ar ? g.ar : g.en}
          expiryField={g.expiryField} ar={ar} t={t} notify={notify}
          onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}

      <HrGroupFormModal
        open={!!form} mode={form?.mode || 'create'} group={group} groupLabel={ar ? g.ar : g.en}
        fields={g.fields} row={form?.row || null} ar={ar}
        onClose={() => setForm(null)}
        onDone={() => { setForm(null); load(); }} />

      <HrGroupClearModal
        open={!!clearing} groupLabel={ar ? g.ar : g.en} fields={g.fields} row={clearing} ar={ar}
        onClose={() => setClearing(null)}
        onDone={() => { setClearing(null); load(); }} />
    </div>
  );
}

// ── صف موظف: كل خانة قابلة للتعديل في مكانها ─────────────────────────────────
function Row({ r, fields, isDoc, ar, t, canEdit, onSaved, notify, router,
  renewable, picked, setPicked, onRenew, onEdit, onClear }: any) {
  const m = r.state ? STATE_META[r.state] : null;
  const sel = renewable && canEdit;
  return (
    <tr className={sel && picked.has(r._id) ? 'bg-orange-50/70 text-center align-middle' : 'hover:bg-slate-50 text-center align-middle'}>
      {sel && (
        <td className="px-3 py-2.5">
          <input type="checkbox" className="accent-[#f37121]"
            checked={picked.has(r._id)}
            onChange={() => setPicked((p: Set<string>) => {
              const n = new Set(p);
              if (n.has(r._id)) n.delete(r._id); else n.add(r._id);
              return n;
            })} />
        </td>
      )}
      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums">{r.employeeNumber || '—'}</td>
      <td className="px-3 py-2.5">
        <button onClick={() => router.push(`/system/hr/employees/${r._id}`)}
          className="font-semibold text-slate-900 hover:text-[#f37121] text-[13.5px] whitespace-nowrap">{r.name}</button>
      </td>
      {/* رقم الهوية — أكتر حاجة بيتسيرش بيها، فليها عمودها في كل جدول */}
      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 text-[13px] tabular-nums">{r.iqamaNumber || '—'}</td>
      <td className="px-3 py-2.5 text-slate-700 text-[13px] whitespace-nowrap">{r.department || '—'}</td>
      {fields.map((f: FieldDef) => (
        <td key={f.key} className="px-3 py-2.5">
          <Cell r={r} f={f} ar={ar} t={t} canEdit={canEdit} onSaved={onSaved} notify={notify} />
        </td>
      ))}
      {isDoc && (
        <td className="px-3 py-2.5 whitespace-nowrap font-bold" style={{ color: m?.color }}>
          {r.daysRemaining == null ? <span className="text-slate-500">—</span> : daysText(r.daysRemaining, ar)}
        </td>
      )}
      {/* الأفعال الثلاثة في عمودٍ واحد. التجديد يبقى أوّلها في المستندات لأنّه
          أكثرها تكرارًا، والتفريغ آخرها وحده بلونٍ يقول إنّه لا يُشبه ما قبله. */}
      {canEdit && (
        <td className="px-3 py-2.5">
          <div className="inline-flex items-center gap-1">
            {sel && (
              <button onClick={() => onRenew(r)} title={t('تجديد', 'Renew')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                <RefreshCw className="w-3.5 h-3.5" />{t('تجديد', 'Renew')}
              </button>
            )}
            <button onClick={() => onEdit(r)} title={t('تعديل بيانات المجموعة', 'Edit this group’s data')}
              className="p-1.5 rounded-md text-slate-600 hover:text-[#f37121] hover:bg-slate-100">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onClear(r)} title={t('تفريغ بيانات المجموعة', 'Clear this group’s data')}
              className="p-1.5 rounded-md text-slate-600 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
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
    // التاريخ غير المقروء («مطلوب» مكتوبةً في خانة تاريخ) كان يرمي استثناءً هنا
    // فيُسقِط الجدول كلَّه بدل أن تُفتَح الخانة فارغةً لتُصحَّح.
    setVal(f.type === 'date' ? toDateInput(raw) : (raw ?? ''));
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
        <button onClick={() => setEditing(false)} className="p-1 rounded text-slate-600 hover:text-slate-900"><X className="w-3.5 h-3.5" /></button>
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
  // «غير مطلوب» برضه بيتفتح للكتابة — الملف بيقول إنها ما بتنطبقش، لكن لو
  // الواقع اتغيّر (الموظف طلّع الرخصة) لازم تتكتب من نفس المكان من غير ما حد
  // يخرج من الجدول.
  if (st === 'not_required' || st === 'none' || st === 'cash_payroll') {
    return (
      <button onClick={start} disabled={!canEdit}
        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_META[st].bg} ${canEdit ? 'hover:ring-1 hover:ring-slate-400' : ''}`}
        title={canEdit ? (ar ? 'اضغط للكتابة' : 'Click to fill') : ''}>
        {statusLabel(st, ar)}
      </button>
    );
  }
  return (
    <button onClick={start} disabled={!canEdit}
      className="text-[13px] text-slate-900 hover:text-[#f37121] disabled:hover:text-slate-900 whitespace-nowrap">
      {f.type === 'date' ? fmtDate(raw) : (raw || '—')}
    </button>
  );
}


// ── تجديد مستند واحد ─────────────────────────────────────────────────────────
//
// التجديد ليس كتابةً فوق التاريخ القديم: هو يكتب التاريخ الجديد **ويترك أثرًا**
// يقول مَن جدّده ومن أيّ تاريخ إلى أيّ. الكتابة المباشرة على الخانة تفقد هذا
// الجواب تمامًا، وهو أول ما يُسأل عنه عند المراجعة.
function HrRenewModal({ row, group, groupLabel, expiryField, ar, t, notify, onClose, onDone }: any) {
  const cur = expiryField ? row.values?.[expiryField] : null;
  const [newExpiry, setNewExpiry] = useState('');
  const [docNum, setDocNum] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // الافتراض سنةٌ من تاريخ الانتهاء القائم إن كان في المستقبل، وإلا سنة من
    // اليوم — فالمنتهي منذ شهور لا يُجدَّد إلى تاريخ ماضٍ.
    const base = cur && !isNaN(new Date(cur).getTime()) ? new Date(cur) : new Date();
    const from = base > new Date() ? base : new Date();
    const d = new Date(from);
    d.setFullYear(d.getFullYear() + 1);
    setNewExpiry(d.toISOString().slice(0, 10));
  }, [cur]);

  const save = async () => {
    if (!newExpiry) return notify(t('أدخل تاريخ الانتهاء الجديد', 'Enter the new expiry date'), 'error');
    setBusy(true);
    try {
      await renewHrDocument({ employee: row._id, group, newExpiry, documentNumber: docNum.trim(), notes: note.trim() });
      notify(t(`تم التجديد حتى ${newExpiry}`, `Renewed to ${newExpiry}`), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-emerald-700 font-bold">{t('تجديد المستند', 'Renew document')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          {row.name} · {groupLabel}{cur ? ` · ${t('ينتهي', 'expires')} ${fmtDate(cur)}` : ''}
        </p>

        <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
        <input type="date" autoFocus value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-3" />

        <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('رقم المستند الجديد', 'New document number')}</label>
        <input value={docNum} onChange={(e) => setDocNum(e.target.value)}
          placeholder={t('اتركه فارغًا إن لم يتغيّر', 'Leave blank if unchanged')}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-3" />

        <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-4" />

        <p className="text-[11px] text-slate-400 mb-3">
          {t('يُحفَظ التجديد في سجلّ الموظف: التاريخ السابق والجديد ومَن سجّله ومتى.',
             'The renewal is kept on the employee record: previous and new date, who logged it and when.')}
        </p>
        <button onClick={save} disabled={busy || !newExpiry}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
          <Check className="w-4 h-4" />{busy ? t('جارٍ التجديد…', 'Renewing…') : t('تجديد', 'Renew')}
        </button>
      </div>
    </div>
  );
}

// ── تجديد دفعة بتاريخ واحد ───────────────────────────────────────────────────
//
// كله أو لا شيء. لو رفض الخادم سطرًا لم يُجدَّد أيّ سطر، وتُعرض أسباب الرفض
// بأرقام سطورها — لأن دفعةً نجح نصفها بصمت أسوأ من دفعةٍ فشلت كلها بوضوح.
function HrBulkRenewModal({ rows, group, groupLabel, ar, onClose, onDone }: {
  rows: any[]; group: string; groupLabel: string; ar: boolean; onClose: () => void; onDone: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const past = !!when && when < today;

  const save = async () => {
    setBusy(true); setErrors([]);
    try {
      const r = await renewHrBulk({
        items: rows.map((x) => ({ employee: x._id, group })),
        newExpiry: when, notes: note.trim(),
      });
      notify(t(`اتجدّد ${r.summary.count} مستند لـ${r.summary.employees} موظف`,
               `Renewed ${r.summary.count} documents for ${r.summary.employees} employees`), 'success');
      onDone();
    } catch (e: any) {
      const list = e?.data?.errors || e?.errors;
      if (Array.isArray(list) && list.length) {
        setErrors(list.map((x: any) => t(`سطر ${x.line}: ${x.message}`, `Row ${x.line}: ${x.message}`)));
        notify(t('العملية اترفضت بالكامل — مفيش أي مستند اتجدّد', 'Rejected in full — nothing was renewed'), 'error');
      } else notify(e?.message || 'Failed', 'error');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-emerald-700 font-bold">{t('تجديد جماعي', 'Bulk renewal')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-sm text-slate-600">
            {t(`${rows.length} مستند من «${groupLabel}» سيُجدَّد إلى التاريخ نفسه.`,
               `${rows.length} “${groupLabel}” documents will be renewed to the same date.`)}
          </p>

          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('تاريخ الانتهاء الجديد', 'New expiry')} *</label>
            <input type="date" autoFocus min={today} value={when} onChange={(e) => setWhen(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            {past && <p className="text-[11px] text-red-600 mt-1">{t('التاريخ في الماضي', 'That date is in the past')}</p>}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">{t('ملاحظة', 'Note')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>

          {!!errors.length && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 max-h-32 overflow-y-auto">
              {errors.map((x, i) => <p key={i} className="text-[11.5px] text-red-700">{x}</p>)}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100">
          <button onClick={save} disabled={busy || !when || past}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
            <Check className="w-4 h-4" />
            {busy ? t('جارٍ التجديد…', 'Renewing…') : !when ? t('اختر التاريخ أولًا', 'Pick a date first')
              : t(`تجديد ${rows.length} مستند`, `Renew ${rows.length} documents`)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><GroupInner /></Suspense>;
}
