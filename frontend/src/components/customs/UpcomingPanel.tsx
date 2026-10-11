'use client';
/**
 * المعاملاتُ القادمة — نافذةٌ واحدةٌ تكفي عن صفحة.
 *
 * كانت القادمةُ تُرى في مكانين: نافذةُ «قرُب موعدها» وصفحةٌ كاملةٌ تُفتَح
 * بزرّ. والقسمُ قال إنّ النافذةَ تكفي — فصارت تحمل القادمةَ **كلَّها** مرتَّبةً
 * بالأقرب، ومع كلّ واحدة:
 *   • كم بقي على موعدها (أو كم فات)،
 *   • تاريخُها يُعدَّل في مكانه،
 *   • أوراقُها الخمسُ تُعلَّم في مكانها — ما استُلِم منها وما لم يُستلَم،
 *   • وتُحوَّل إلى جاريةٍ (بسؤالٍ أوّلًا). ولا تُفتَح من هنا: القادمةُ تُدار
 *     من نافذتها، وصفحتُها تُفتَح بعد أن تصير جارية.
 *
 * والأوراقُ هي نفسُها قائمةُ «الأوراق المطلوبة» داخل المعاملة (`documents`):
 * ما يُعلَّم هنا معلَّمٌ هناك، والعكس — خانةٌ واحدةٌ تُكتب من بابين.
 */
import { useRef, useState } from 'react';
import api from '@/lib/api';
import { X, Check, Loader2, CalendarClock } from 'lucide-react';

export const DOC_KEYS = ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'] as const;
export type DocKey = typeof DOC_KEYS[number];
export const DOC_LABELS: Record<DocKey, [string, string]> = {
  bl: ['البوليصة', 'Bill of lading'],
  commercialInvoice: ['الفاتورة', 'Invoice'],
  certificateOfOrigin: ['شهادة المنشأ', 'Certificate of origin'],
  packingList: ['بيان التعبئة', 'Packing list'],
  saber: ['سابر', 'SABER'],
};

export interface UpcomingItem {
  _id: string; refNumber?: string; blNumber?: string; customerName?: string; shippingAgent?: string;
  expectedDate?: string; containerCount?: number; branch?: string; documents?: Partial<Record<DocKey, boolean>>;
  daysLeft: number | null; overdue?: boolean; dueSoon?: boolean;
}

/** «باقي ٣ أيّام» / «اليوم» / «فات يومان». */
export function remainingWords(n: number | null, ar: boolean): string {
  if (n === null) return ar ? 'بلا تاريخ' : 'No date';
  if (n === 0) return ar ? 'اليوم' : 'Today';
  if (n === 1) return ar ? 'باقي يوم واحد' : '1 day left';
  if (n === 2) return ar ? 'باقي يومان' : '2 days left';
  if (n > 2) return ar ? `باقي ${n} ${n <= 10 ? 'أيّام' : 'يومًا'}` : `${n} days left`;
  const late = -n;
  if (late === 1) return ar ? 'فات يوم واحد' : '1 day overdue';
  if (late === 2) return ar ? 'فات يومان' : '2 days overdue';
  return ar ? `فات ${late} ${late <= 10 ? 'أيّام' : 'يومًا'}` : `${late} days overdue`;
}

/** قائمةُ الأوراق الخمس كأزرارٍ تُعلَّم — تُستعمَل هنا وفي نموذج الإنشاء. */
export function DocChecklist({ value, onToggle, disabled, ar }: {
  value: Partial<Record<DocKey, boolean>> | undefined; onToggle: (k: DocKey, on: boolean) => void; disabled?: boolean; ar: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DOC_KEYS.map((k) => {
        const on = !!value?.[k];
        return (
          <button key={k} type="button" disabled={disabled} onClick={() => onToggle(k, !on)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[12px] font-medium transition-colors disabled:cursor-default ${
              on ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            title={on ? (ar ? 'استُلِمت — اضغط للإلغاء' : 'Received — click to undo') : (ar ? 'لم تُستلَم — اضغط عند الاستلام' : 'Not received — click when received')}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center ${on ? 'bg-emerald-500 text-white' : 'border border-slate-300'}`}>
              {on && <Check className="w-3 h-3" />}
            </span>
            {DOC_LABELS[k][ar ? 0 : 1]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * خانةُ التاريخ في صفّ القادمة.
 *
 * ── ولماذا لها مكوِّنٌ وزرُّ حفظ ─────────────────────────────────────────────
 * كانت تُحفَظ مع كلّ تغيير: يفتح المستخدمُ التقويمَ فيكتب المتصفّحُ قيمةً
 * أولى، فيُرسَل الحفظُ، فتُعاد قراءةُ النافذة، فيُعاد بناءُ الخانة (مفتاحُها
 * كان التاريخَ نفسَه) — **فيُغلَق التقويمُ قبل أن يُختار اليوم**.
 *
 * فالمكتوبُ مسوّدةٌ في الخانة لا تُرسَل حتى يُقال «حفظ» (أو Enter). والخانةُ
 * لا يُعاد بناؤها: مفتاحُها المعاملةُ لا تاريخُها.
 */
function DateEditor({ value, disabled, saving, onSave, ar }: {
  value: string; disabled?: boolean; saving?: boolean; onSave: (v: string) => void; ar: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // تاريخٌ تغيّر من خارج الخانة (حفظٌ نجح، أو زميلٌ عدّله) يُعرَض — ما لم تكن
  // فيها مسوّدةٌ لم تُحفَظ بعد.
  const [seen, setSeen] = useState(value);
  if (value !== seen) { if (draft === seen) setDraft(value); setSeen(value); }
  const dirty = !!draft && draft !== value;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="date" value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSave(draft); }}
        className="px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[13px] text-slate-800 disabled:opacity-60" />
      {dirty && (
        <>
          <button type="button" onClick={() => onSave(draft)} disabled={saving}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[12px] font-semibold disabled:opacity-50">{ar ? 'حفظ' : 'Save'}</button>
          <button type="button" onClick={() => setDraft(value)}
            className="px-2 py-1.5 rounded-lg text-[12px] text-slate-500 hover:text-slate-900">{ar ? 'تراجع' : 'Undo'}</button>
        </>
      )}
    </span>
  );
}

export default function UpcomingPanel({ items, days, canEdit, ar, onClose, onChanged, notify, confirm }: {
  items: UpcomingItem[]; days: number; canEdit: boolean; ar: boolean;
  /** `full` حين تتغيّر قائمةُ الجارية أيضًا (تحويل)؛ وإلّا فالنافذةُ وحدَها. */
  onClose: () => void; onChanged: (full?: boolean) => void; notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  /** سؤالُ التأكيد قبل التحويل — نافذةُ النظام لا `window.confirm`. */
  confirm: (message: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState('');
  const t = (a: string, e: string) => (ar ? a : e);

  // ── العلامةُ تظهر في الحال، والحفظُ خلفها ────────────────────────────────
  // كانت الورقةُ لا تُعلَّم حتى يعود الخادمُ ثمّ تُعاد قراءةُ النافذة والجدول
  // كلِّه — فيضغط المستخدمُ ولا يرى شيئًا لثانيةٍ أو اثنتين، فيظنّها معلّقةً
  // ويضغط ثانيةً فتنقلب. فما ضُغط يُكتب على الشاشة فورًا (`local`)، ويُحفَظ في
  // الخلف؛ وإن رُدّ الحفظُ عادت العلامةُ كما كانت وقيل ذلك.
  const [local, setLocal] = useState<Record<string, { documents?: Partial<Record<DocKey, boolean>>; expectedDate?: string; branch?: string }>>({});
  const view = (x: UpcomingItem): UpcomingItem => {
    const o = local[x._id];
    return o ? {
      ...x,
      ...(o.expectedDate !== undefined ? { expectedDate: o.expectedDate } : {}),
      ...(o.branch !== undefined ? { branch: o.branch } : {}),
      documents: { ...(x.documents || {}), ...(o.documents || {}) },
    } : x;
  };

  const queue = useRef<Record<string, Promise<unknown>>>({});
  const toggleDoc = async (x: UpcomingItem, k: DocKey, on: boolean) => {
    setLocal((m) => ({ ...m, [x._id]: { ...m[x._id], documents: { ...(m[x._id]?.documents || {}), [k]: on } } }));
    try {
      // ── وعلامتان متتاليتان تُحفَظان واحدةً بعد واحدة ──────────────────────
      // الخادمُ يقرأ أوراقَ المعاملة ثمّ يكتبها كاملةً؛ فطلبان معًا يقرآن الحالةَ
      // نفسَها ويكتب الثاني فوق الأوّل فتضيع علامتُه. فتُصَفّ طلباتُ المعاملة
      // الواحدة: كلٌّ ينتظر ما قبله.
      const prev = queue.current[x._id] || Promise.resolve();
      const mine = prev.catch(() => undefined).then(() => api.put(`/api/customs-clearance/${x._id}`, { documents: { [k]: on } }));
      queue.current[x._id] = mine;
      await mine;
      onChanged();
    } catch (e) {
      setLocal((m) => ({ ...m, [x._id]: { ...m[x._id], documents: { ...(m[x._id]?.documents || {}), [k]: !on } } }));
      notify((e as { message?: string })?.message || t('تعذّر الحفظ — عادت العلامةُ كما كانت', 'Not saved — the tick was restored'), 'error');
    }
  };

  /** التاريخُ أو الفرع: يُكتب على الشاشة فورًا ويُحفَظ في صفّ المعاملة نفسِه. */
  const save = async (x: UpcomingItem, body: { expectedDate?: string; branch?: string }) => {
    const before = { expectedDate: x.expectedDate, branch: x.branch };
    setBusy(x._id);
    setLocal((m) => ({ ...m, [x._id]: { ...m[x._id], ...body } }));
    try {
      const prev = queue.current[x._id] || Promise.resolve();
      const mine = prev.catch(() => undefined).then(() => api.put(`/api/customs-clearance/${x._id}`, body));
      queue.current[x._id] = mine;
      await mine;
      onChanged();
    } catch (e) {
      setLocal((m) => ({ ...m, [x._id]: { ...m[x._id], ...Object.fromEntries(Object.keys(body).map((k) => [k, (before as Record<string, string | undefined>)[k]])) } }));
      notify((e as { message?: string })?.message || t('تعذّر الحفظ — عادت القيمةُ كما كانت', 'Not saved — the value was restored'), 'error');
    }
    setBusy('');
  };
  // ── والتحويلُ يُسأل عنه أوّلًا ─────────────────────────────────────────
  // ضغطةٌ خاطئةٌ على الزرّ كانت تُخرج المعاملةَ من
  // القادمة في الحال وتُدخلها أعدادَ الجارية. فيُسأل، ويُقال أيُّ معاملة.
  const activate = async (id: string) => {
    const x = items.find((i) => i._id === id);
    const name = x?.blNumber || x?.refNumber || '';
    if (!(await confirm(t(`تحويلُ المعاملة ${name} إلى معاملةٍ جارية؟ ستخرج من المعاملات القادمة وتدخل قائمةَ الجارية.`,
      `Convert ${name} to a current transaction? It leaves the upcoming list and joins the current one.`)))) return;
    setBusy(id);
    try {
      await api.patch(`/api/customs-clearance/${id}/activate`, {});
      notify(t('صارت معاملةً جارية', 'Now a current transaction'), 'success');
      onChanged(true);
    } catch (e) { notify((e as { message?: string })?.message || t('تعذّر التحويل', 'Could not convert'), 'error'); }
    setBusy('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <p className="font-bold text-slate-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#f37121]" />{t('المعاملات القادمة', 'Upcoming transactions')}
              <span className="text-[12px] font-semibold text-slate-400 tabular-nums">({items.length})</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(`الملوَّنُ ما قرُب موعدُه — خلال ${days} يوم، وتُضبَط المدّةُ من إعدادات القسم`, `Highlighted: due within ${days} days — set in section settings`)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100" aria-label={t('إغلاق', 'Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500 text-center py-10">{t('لا معاملات قادمة.', 'No upcoming transactions.')}</p>}
          {items.map(view).map((x) => {
            const tone = x.overdue ? 'border-red-200 bg-red-50/40' : x.dueSoon ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200';
            const badge = x.overdue ? 'bg-red-100 text-red-700' : x.dueSoon ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
            const received = DOC_KEYS.filter((k) => x.documents?.[k]).length;
            return (
              <div key={x._id} className={`rounded-xl border px-4 py-3 ${tone}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* رقمُ البوليصة أوّلًا — هو ما تُعرَف به المعاملةُ في القسم. */}
                    <p className="font-bold text-slate-900 text-[14.5px]"><bdi>{x.blNumber || t('بلا رقم بوليصة', 'No BL number')}</bdi></p>
                    <p className="text-[12.5px] text-slate-600 mt-0.5 truncate">
                      {x.customerName || '—'}{x.shippingAgent ? ` · ${x.shippingAgent}` : ''}{x.containerCount ? ` · ${x.containerCount} ${t('حاوية', 'containers')}` : ''}
                      {` · ${x.branch === 'dammam' ? t('الدمام', 'Dammam') : t('جدة', 'Jeddah')}`}
                    </p>
                    <p className="text-[11.5px] text-slate-400 mt-0.5"><bdi>{x.refNumber}</bdi></p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${badge}`}>{remainingWords(x.daysLeft, ar)}</span>
                    {busy === x._id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center gap-2 text-[12px] text-slate-500">
                    {t('تاريخ المعاملة', 'Expected date')}
                    <DateEditor value={x.expectedDate || ''} disabled={!canEdit} saving={busy === x._id} ar={ar}
                      onSave={(v) => save(x, { expectedDate: v })} />
                  </span>
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-500">
                    {t('الفرع', 'Branch')}
                    <select value={x.branch || 'jeddah'} disabled={!canEdit} onChange={(e) => save(x, { branch: e.target.value })}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[13px] text-slate-800 disabled:opacity-60">
                      <option value="jeddah">{t('جدة', 'Jeddah')}</option>
                      <option value="dammam">{t('الدمام', 'Dammam')}</option>
                    </select>
                  </label>
                  <span className="text-[12px] text-slate-500">
                    {t(`الأوراق: ${received} من ${DOC_KEYS.length}`, `Papers: ${received} of ${DOC_KEYS.length}`)}
                  </span>
                </div>

                <div className="mt-2">
                  <DocChecklist value={x.documents} ar={ar} disabled={!canEdit}
                    onToggle={(k, on) => toggleDoc(x, k, on)} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <button type="button" onClick={() => activate(x._id)} disabled={busy === x._id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-semibold hover:bg-[#e06010] disabled:opacity-60">
                      <Check className="w-3.5 h-3.5" />{t('تحويل إلى معاملة جارية', 'Convert to current')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
