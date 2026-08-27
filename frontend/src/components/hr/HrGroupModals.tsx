'use client';
// نماذج مجموعات الموارد البشرية: فتحُ ملفّ مجموعةٍ لموظّف، وتعديلُ حقولها
// مجتمعةً، وتفريغُها.
//
// ── لماذا «الإنشاء» هنا ليس إنشاء موظّف ─────────────────────────────────────
// الموظّف يُولَد مرّةً واحدة في سجلّ الموظفين، ومعه رقمُه ومَن أنشأه. ولو صار
// يُولَد من صفحة الإقامات ومن صفحة الجوازات ومن صفحة العقود لظهر في السجلّ ناسٌ
// لا يعرف أحدٌ من أيّ باب دخلوا ولا ما الذي نقصهم. فالإنشاء في هذه الصفحات هو
// **فتحُ ملفّ المجموعة لمن لا ملفَّ له فيها**: تختار الموظّف — والقائمة تقدّم من
// لا بيانات له في المجموعة — ثم تكتب حقولها كلّها دفعةً واحدة، بدل ملاحقة خاناته
// في الجدول خانةً خانة.
//
// ── ولماذا «الحذف» تفريغٌ لا محو ────────────────────────────────────────────
// صفحةُ مستندٍ لا تملك أن تمحو رجلًا من الشركة: محوُ الموظّف يمحو معه عهدته
// وإجازاته ومستنداته المرفوعة، ويتخطّى إجراء إنهاء الخدمة كلَّه (إعادة العهدة
// والمخالصة). فالفعل المدمِّر الصحيح في هذه الصفحة هو تفريغُ بيانات هذه المجموعة
// وحدَها عند شخصٍ بعينه. ومحوُ الموظّف باقٍ في سجلّ الموظفين محصورًا بمن يملكه
// هناك.
//
// ── والعلامات لا تُمَسّ ضمنًا ───────────────────────────────────────────────
// تفريغُ الخانة ليس قولَ «غير مطلوبة»: الأولى تقول «لا نملك البيانات» فتبقى
// شغلًا على التيم، والثانية قرارٌ إداريّ يقول «لا تنطبق على هذا الموظّف» فتخرج
// من قائمة الشغل أصلًا. وخلطُهما يُخرج أسماءً من القائمة بلا أن يقرّر ذلك أحد،
// فتبدو الأرقام أفضل ممّا هي. لذلك: التفريغ يترك العَلَم كما هو، و«غير مطلوب»
// لا تُكتب إلا باختيارٍ صريح من القائمة المجاورة للحقل.
import { useState, useEffect, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { Modal, Field, TextInput, Select, SearchableSelect, type SearchOption } from '@/components/hr/HRKit';
import { Check, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  getHrRecords, updateEmployeeFields, toDateInput, statusLabel, STATUS_META,
  type FieldDef, type RecordRow,
} from '@/lib/hrMaster';

const isFilled = (v: any) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));

/** قيمة الحقل كما تُكتب في مُدخَل النموذج — التاريخ بصيغة الحقل، والمنطقيّ نعم/لا. */
const asInput = (f: FieldDef, v: any) => {
  if (f.type === 'date') return toDateInput(v);
  if (f.type === 'bool') return v === true ? '1' : v === false ? '0' : '';
  return v == null ? '' : String(v);
};

/** ماذا يفعل المستخدم بعَلَم الحالة — «كما هي» هو الأصل فلا يُرسَل شيء. */
type Mark = 'keep' | 'clear' | 'required' | 'not_required';

function StatusChip({ code, ar }: { code?: string; ar: boolean }) {
  if (!code) return null;
  const m = STATUS_META[code];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${m ? m.bg : 'bg-slate-100 text-slate-600'}`}>
      {statusLabel(code, ar)}
    </span>
  );
}

export function HrGroupFormModal({ open, mode, group, groupLabel, fields, row, ar, onClose, onDone }: {
  open: boolean;
  /** create = فتح ملفّ المجموعة لموظّف تختاره، edit = تعديل حقولها لصفٍّ قائم */
  mode: 'create' | 'edit';
  group: string;
  groupLabel: string;
  fields: FieldDef[];
  row: RecordRow | null;
  ar: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [empId, setEmpId] = useState('');
  const [pool, setPool] = useState<RecordRow[] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  // الحالة الابتدائية تُحفَظ بجانب النموذج ليُرسَل **ما تغيّر وحدَه**: إرسال
  // الحقول كلّها في كلّ حفظ يكتب فوق قيمٍ لم يمسّها أحد ويملأ سجلّ التدقيق
  // بتغييراتٍ لم تحدث، فيضيع التغيير الحقيقيّ بينها.
  const [base, setBase] = useState<Record<string, string>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);

  const target = mode === 'edit' ? row : (pool || []).find((x) => x._id === empId) || null;

  useEffect(() => { setPool(null); }, [group]);
  // وتُجلَب من جديد عند كلّ فتح: حالات الموظفين تتغيّر بالحفظ نفسه، فقائمةٌ
  // محفوظةٌ من الفتحة السابقة تعرض «لا بيانات في هذه المجموعة» لمن ملأتَ بياناته
  // قبل لحظة.
  useEffect(() => { if (!open) setPool(null); }, [open]);

  useEffect(() => {
    if (!open) return;
    setBusy(false); setMarks({});
    if (mode === 'edit' && row) {
      const f = Object.fromEntries(fields.map((x) => [x.key, asInput(x, row.values?.[x.key])]));
      setEmpId(row._id); setForm(f); setBase(f);
    } else { setEmpId(''); setForm({}); setBase({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, row?._id]);

  // قائمة الاختيار تُجلَب بلا فلاتر الشاشة: مَن ينقصه هذا المستند غالبًا ما يكون
  // خارج الفلتر القائم — فلو اقتُصر على المعروض لَما ظهر في القائمة أبدًا من
  // فُتحت الشاشة أصلًا لأجله.
  useEffect(() => {
    if (!open || mode !== 'create' || pool) return;
    getHrRecords(group, {}).then((d) => setPool(d.rows || [])).catch(() => setPool([]));
  }, [open, mode, group, pool]);

  useEffect(() => {
    if (mode !== 'create') return;
    const r = (pool || []).find((x) => x._id === empId);
    const f = Object.fromEntries(fields.map((x) => [x.key, r ? asInput(x, r.values?.[x.key]) : '']));
    setForm(f); setBase(f); setMarks({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, pool, mode]);

  // الترتيب: مَن لا بيانات له في المجموعة أوّلًا. الغرض من الشاشة هو هؤلاء،
  // وقائمةٌ أبجديّةٌ تدفنهم بين ثلاثمئة اسمٍ مكتملٍ تجعل الزرّ زينة.
  const options: SearchOption[] = useMemo(() => {
    const filledCount = (r: RecordRow) => fields.filter((f) => r.statuses?.[f.key] === 'filled').length;
    return [...(pool || [])]
      .sort((a, b) => filledCount(a) - filledCount(b) || (b.missing?.length || 0) - (a.missing?.length || 0))
      .map((r) => {
        const done = filledCount(r);
        const req = fields.filter((f) => r.statuses?.[f.key] === 'required').length;
        return {
          value: r._id,
          label: r.name,
          hint: [r.employeeNumber, r.iqamaNumber, r.department].filter(Boolean).join(' · '),
          badge: done === 0 ? t('لا بيانات في هذه المجموعة', 'No data in this group')
            : req ? t(`ناقص ${req}`, `${req} required`)
              : t(`مكتمل ${done}/${fields.length}`, `${done}/${fields.length} filled`),
          tone: (done === 0 ? 'info' : req ? 'busy' : 'ok') as 'info' | 'busy' | 'ok',
        };
      });
  }, [pool, fields, ar]);

  const save = async () => {
    if (!target) { notify(t('اختر الموظف أولًا', 'Pick an employee first'), 'error'); return; }
    const changed = fields.filter((f) => (form[f.key] ?? '') !== (base[f.key] ?? ''));
    const marked = fields.filter((f) => marks[f.key] && marks[f.key] !== 'keep');
    if (!changed.length && !marked.length) { notify(t('لا يوجد تغيير لحفظه', 'Nothing changed'), 'info'); return; }
    // الحقل المُعلَّم يُرسَل بقيمته الحالية: الخادم يرفض طلبًا بلا حقول، فتغييرُ
    // العلامة وحدَها كان يرتدّ خطأً لا يفهمه من غيّرها.
    const send: Record<string, any> = {};
    for (const f of [...changed, ...marked]) send[f.key] = form[f.key] ?? '';
    const markStatus: Record<string, string> = {};
    for (const f of marked) markStatus[f.key] = marks[f.key];

    setBusy(true);
    try {
      const res = await updateEmployeeFields(target._id, send, Object.keys(markStatus).length ? markStatus : undefined);
      if (res.rejected?.length) notify(t(`حقول لم تُقبل: ${res.rejected.join('، ')}`, `Rejected: ${res.rejected.join(', ')}`), 'error');
      else notify(t('تم الحفظ', 'Saved'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} wide
      title={mode === 'create'
        ? t(`إضافة بيانات — ${groupLabel}`, `Add data — ${groupLabel}`)
        : t(`تعديل — ${groupLabel}`, `Edit — ${groupLabel}`)}
      footer={(
        <>
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:text-slate-900">
            {t('إلغاء', 'Cancel')}
          </button>
          <button type="button" onClick={save} disabled={busy || !target}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] disabled:opacity-50 text-white text-sm font-semibold">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}
          </button>
        </>
      )}>

      {mode === 'create' && (
        <Field label={t('الموظف', 'Employee')}>
          {pool === null
            ? <p className="text-sm text-slate-500 py-2">{t('جارٍ تحميل الموظفين…', 'Loading employees…')}</p>
            : (
              <SearchableSelect
                value={empId} onChange={setEmpId} options={options} searchAfter={5}
                placeholder={t('اختر موظفًا…', 'Pick an employee…')}
                searchPlaceholder={t('اسم / رقم وظيفي / رقم هوية…', 'name / employee no / ID…')}
                emptyLabel={t('لا موظف مطابق', 'No matching employee')} />
            )}
          <p className="text-[11px] text-slate-500 mt-1.5">
            {t('المرتَّبون أوّلًا هم من لا بيانات لهم في هذه المجموعة.',
               'Those with no data in this group are listed first.')}
          </p>
        </Field>
      )}

      {mode === 'edit' && target && (
        <p className="text-[12.5px] text-slate-600">
          {target.name}{target.employeeNumber ? ` · ${target.employeeNumber}` : ''}{target.department ? ` · ${target.department}` : ''}
        </p>
      )}

      {target && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.key}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-slate-500 text-xs">{ar ? f.ar : f.en}</label>
                <StatusChip code={target.statuses?.[f.key]} ar={ar} />
              </div>
              {f.type === 'bool' ? (
                <Select value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}>
                  <option value="">{t('—', '—')}</option>
                  <option value="1">{t('نعم', 'Yes')}</option>
                  <option value="0">{t('لا', 'No')}</option>
                </Select>
              ) : (
                <TextInput type={f.type === 'date' ? 'date' : 'text'} value={form[f.key] ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
              )}
              {/* العَلَم الإداريّ بجانب الحقل لا في شاشةٍ أخرى: «هذا لا ينطبق على
                  هذا الموظّف» قرارٌ يُتَّخذ وأنت تنظر إلى الخانة الفارغة، وكان
                  الخادم يقبله ولا شاشة تُرسله. */}
              <div className="mt-1">
                <Select value={marks[f.key] || 'keep'}
                  aria-label={t('حالة الحقل', 'Field status')}
                  onChange={(e) => setMarks((s) => ({ ...s, [f.key]: e.target.value as Mark }))}>
                  <option value="keep">{t('الحالة: كما هي', 'Status: unchanged')}</option>
                  <option value="required">{t('علّمه: مطلوب', 'Mark: required')}</option>
                  <option value="not_required">{t('علّمه: غير مطلوب', 'Mark: not required')}</option>
                  <option value="clear">{t('ارفع العلامة (بحسب القيمة)', 'Clear the flag (derive from value)')}</option>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}

      {!target && mode === 'create' && (
        <p className="text-sm text-slate-500">{t('اختر موظفًا لتظهر حقول المجموعة.', 'Pick an employee to see this group’s fields.')}</p>
      )}
    </Modal>
  );
}

// ── تفريغ بيانات المجموعة عند موظّف واحد ────────────────────────────────────
export function HrGroupClearModal({ open, groupLabel, fields, row, ar, onClose, onDone }: {
  open: boolean; groupLabel: string; fields: FieldDef[]; row: RecordRow | null; ar: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  // حقلٌ كان مملوءًا ثم فُرِّغ يعود «لا يوجد» لا «مطلوب»، لأنّ عَلَم «مطلوب»
  // يُحذف في الموديل أوّلَ ما يُملأ الحقل فلا يبقى ما يعود إليه. وأكثرُ ما
  // يُفرَّغ إنما يُفرَّغ لأنّه كُتب خطأً والبيان ما زال مطلوبًا، فالخيار معروضٌ
  // صريحًا ومُفعَّلٌ ابتداءً — ولا يُطبَّق إلّا على ما حالته «مملي» حتى لا
  // يُنقَض قرارُ «غير مطلوب» من حيث لا يدري صاحبه.
  const [reRequire, setReRequire] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReRequire(true); setBusy(false); } }, [open]);

  if (!row) return null;
  const hasValue = fields.filter((f) => isFilled(row.values?.[f.key]));

  const run = async () => {
    setBusy(true);
    try {
      const send: Record<string, any> = {};
      for (const f of hasValue) send[f.key] = '';
      const markStatus: Record<string, string> = {};
      if (reRequire) for (const f of hasValue) if (row.statuses?.[f.key] === 'filled') markStatus[f.key] = 'required';
      await updateEmployeeFields(row._id, send, Object.keys(markStatus).length ? markStatus : undefined);
      notify(t('تم تفريغ بيانات المجموعة', 'Group data cleared'), 'success');
      onDone();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose}
      title={t(`تفريغ بيانات ${groupLabel}`, `Clear ${groupLabel} data`)}
      footer={(
        <>
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:text-slate-900">
            {t('إلغاء', 'Cancel')}
          </button>
          <button type="button" onClick={run} disabled={busy || !hasValue.length}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {t(`تفريغ ${hasValue.length} حقل`, `Clear ${hasValue.length} fields`)}
          </button>
        </>
      )}>
      <p className="text-sm text-slate-700">
        {t(`ستُفرَّغ بيانات «${groupLabel}» عند ${row.name}${row.employeeNumber ? ` (${row.employeeNumber})` : ''} وحدَه.`,
           `“${groupLabel}” data for ${row.name}${row.employeeNumber ? ` (${row.employeeNumber})` : ''} will be emptied.`)}
      </p>

      {!hasValue.length ? (
        <p className="text-sm text-slate-500">{t('لا بيانات في هذه المجموعة لتُفرَّغ.', 'There is no data in this group to clear.')}</p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
          {hasValue.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12.5px] text-slate-600">{ar ? f.ar : f.en}</span>
              <span className="text-[12.5px] font-semibold text-slate-900 truncate max-w-[55%]">
                {f.type === 'date' ? (toDateInput(row.values?.[f.key]) || '—')
                  : f.type === 'bool' ? (row.values?.[f.key] ? t('نعم', 'Yes') : t('لا', 'No'))
                    : String(row.values?.[f.key])}
              </span>
            </div>
          ))}
        </div>
      )}

      {!!hasValue.length && (
        <label className="flex items-start gap-2 text-[12.5px] text-slate-700 cursor-pointer">
          <input type="checkbox" checked={reRequire} onChange={(e) => setReRequire(e.target.checked)} className="accent-[#f37121] mt-0.5" />
          <span>
            {t('أعِد الحقول المُفرَّغة إلى «مطلوب»', 'Put the emptied fields back to “Required”')}
            <span className="block text-[11px] text-slate-500">
              {t('لا يمسّ ما هو مُعلَّم «غير مطلوب» — ذاك قرار إداريّ لا يُنقَض بالتفريغ.',
                 'Fields marked “Not required” are left alone — that is an administrative decision, not missing data.')}
            </span>
          </span>
        </label>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[11.5px] text-amber-800">
          {t('هذا تفريغ بياناتٍ لا حذفُ موظّف. حذف الموظّف — بعهدته وإجازاته ومستنداته — في سجلّ الموظفين، وإنهاء الخدمة له إجراؤه الخاص.',
             'This clears data, it does not delete the employee. Deleting a person — with their custody, leaves and documents — lives on the employees page, and termination has its own process.')}
        </p>
      </div>
    </Modal>
  );
}
