'use client';
// A single strategic initiative: its facts, a clickable stage pipeline and the
// full activity timeline logged against it.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Compass, ArrowLeft, ArrowRight, Plus, Check, Trash2, Loader2 } from 'lucide-react';
import {
  Spinner, PageHeader, PrimaryButton, SmallBadge, Modal, Field, TextInput, TextArea, Select, StatCard,
} from '@/components/hr/HRKit';
import {
  canViewBd, canEditBd, BdOpportunity, BdActivity, OPP_STAGE, OPP_TYPE, PRIORITY, ACTIVITY_TYPE,
  OPEN_STAGES, labelOf, optionsOf, bdName, userName, companyName, money, fmtDate, fmtDateTime,
  toDateInput, today,
} from '@/lib/bd';

const EMPTY_ACTIVITY = {
  date: '', title: '', type: 'meeting', summary: '', outcome: '', nextStep: '',
};

export default function BdOpportunityDetailPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const canEdit = canEditBd(user);

  const [opp, setOpp] = useState<BdOpportunity | null>(null);
  const [activities, setActivities] = useState<BdActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showActivity, setShowActivity] = useState(false);
  const [actForm, setActForm] = useState<any>(EMPTY_ACTIVITY);
  const [savingAct, setSavingAct] = useState(false);

  // Inline field editing (admins only) — one field at a time.
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<{ opportunity: BdOpportunity; activities: BdActivity[] }>(
        `/api/business-development/opportunities/${id}`
      );
      setOpp(d.opportunity);
      setActivities(d.activities || []);
    } catch { /* keep the last good render */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useSocket('bd:updated', useCallback(() => { load(); }, [load]));

  const patch = async (payload: Record<string, any>) => {
    setBusy(true);
    try {
      const d = await api.put<{ opportunity: BdOpportunity }>(`/api/business-development/opportunities/${id}`, payload);
      setOpp(d.opportunity);
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const moveToStage = (stage: string) => {
    if (!canEdit || !opp || opp.stage === stage) return;
    patch({ stage });
  };

  const startEdit = (field: string, current: any) => {
    if (!canEdit) return;
    setEditField(field);
    setEditValue(current === undefined || current === null ? '' : String(current));
  };
  const commitEdit = async () => {
    if (!editField) return;
    const numeric = ['estimatedValue', 'probability'];
    const value = numeric.includes(editField) ? Number(editValue) || 0 : editValue;
    const field = editField;
    setEditField(null);
    await patch({ [field]: value });
  };

  const saveActivity = async () => {
    if (!String(actForm.title || '').trim()) { alert(ar ? 'العنوان مطلوب' : 'Title is required'); return; }
    setSavingAct(true);
    try {
      await api.post('/api/business-development/activities', {
        ...actForm,
        date: actForm.date || today(),
        entityType: 'opportunity',
        refId: id,
      });
      setShowActivity(false);
      setActForm(EMPTY_ACTIVITY);
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSavingAct(false); }
  };

  const removeActivity = async (a: BdActivity) => {
    if (!confirm(ar ? 'تأكيد الحذف؟' : 'Delete this activity?')) return;
    try { await api.delete(`/api/business-development/activities/${a._id}`); load(); }
    catch (e: any) { alert(e.message); }
  };

  if (!canViewBd(user)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;
  if (!opp) return <div className="text-slate-500 p-8">{ar ? 'الفرصة غير موجودة' : 'Opportunity not found'}</div>;

  const st = OPP_STAGE[opp.stage];
  const ty = OPP_TYPE[opp.type];
  const pr = PRIORITY[opp.priority];
  const weighted = Math.round((opp.estimatedValue || 0) * ((opp.probability || 0) / 100));
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  // An editable read-only field cell. Click to edit when the user is an admin.
  const Cell = ({ label, field, value, display, type = 'text' }: {
    label: string; field?: string; value?: any; display?: string; type?: string;
  }) => {
    const isEditing = editField === field;
    return (
      <div className="border-b border-slate-100 py-2.5">
        <p className="text-slate-500 text-xs mb-1 text-start">{label}</p>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <TextInput type={type} value={editValue} autoFocus
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditField(null); }} />
            <button type="button" onClick={commitEdit} className="text-emerald-600 hover:text-emerald-700 shrink-0">
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button type="button" disabled={!canEdit || !field} onClick={() => field && startEdit(field, value)}
            className={`text-slate-900 text-sm text-start w-full ${canEdit && field ? 'hover:text-[#f37121] cursor-pointer' : 'cursor-default'}`}>
            {display || '—'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <button type="button" onClick={() => router.push('/system/bd/opportunities')}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm mb-3">
          <BackIcon className="w-4 h-4" /> {ar ? 'رجوع للفرص' : 'Back to opportunities'}
        </button>
        <PageHeader
          icon={<Compass className="w-5 h-5" />}
          title={bdName(opp, lang)}
          subtitle={[labelOf(OPP_TYPE, opp.type, lang), opp.region, opp.city].filter(Boolean).join(' · ')}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin text-[#f37121]" />}
          {ty && <SmallBadge bg={ty.bg} text={ty.text} label={ar ? ty.ar : ty.en} />}
          {pr && <SmallBadge bg={pr.bg} text={pr.text} label={ar ? pr.ar : pr.en} />}
          {st && <SmallBadge bg={st.bg} text={st.text} label={ar ? st.ar : st.en} />}
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={ar ? 'القيمة التقديرية' : 'Estimated value'} value={money(opp.estimatedValue, opp.currency)} accent="text-[#f37121]" />
        <StatCard label={ar ? 'الاحتمالية' : 'Probability'} value={`${opp.probability || 0}%`} />
        <StatCard label={ar ? 'القيمة المرجحة' : 'Weighted value'} value={money(weighted, opp.currency)} accent="text-indigo-600" />
        <StatCard label={ar ? 'الإغلاق المتوقع' : 'Expected close'} value={fmtDate(opp.expectedCloseDate)} />
      </div>

      {/* Clickable stage pipeline */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h2 className="text-slate-900 font-semibold mb-4">{ar ? 'مسار الفرصة' : 'Pipeline'}</h2>
        <div className="flex flex-wrap gap-2">
          {OPEN_STAGES.map((s, i) => {
            const currentIdx = OPEN_STAGES.indexOf(opp.stage as any);
            const done = currentIdx >= 0 && i <= currentIdx;
            const isCurrent = opp.stage === s;
            return (
              <button key={s} type="button" disabled={!canEdit} onClick={() => moveToStage(s)}
                className={`px-4 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  isCurrent ? 'bg-[#f37121] text-white border-[#f37121]'
                    : done ? 'bg-[#f37121]/10 text-[#f37121] border-[#f37121]/30'
                      : 'bg-white text-slate-500 border-slate-200'
                } ${canEdit ? 'hover:border-[#f37121]' : 'cursor-default'}`}>
                {labelOf(OPP_STAGE, s, lang)}
              </button>
            );
          })}
          <span className="w-px bg-slate-200 mx-1" />
          {(['won', 'lost', 'on_hold'] as const).map((s) => {
            const style = OPP_STAGE[s];
            const isCurrent = opp.stage === s;
            return (
              <button key={s} type="button" disabled={!canEdit} onClick={() => moveToStage(s)}
                className={`px-4 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  isCurrent ? `${style.bg} ${style.text} border-current` : 'bg-white text-slate-500 border-slate-200'
                } ${canEdit ? 'hover:border-[#f37121]' : 'cursor-default'}`}>
                {labelOf(OPP_STAGE, s, lang)}
              </button>
            );
          })}
        </div>
        {opp.stage === 'lost' && opp.lostReason && (
          <p className="text-red-600 text-sm mt-3 text-start">{ar ? 'سبب الخسارة: ' : 'Lost reason: '}{opp.lostReason}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h2 className="text-slate-900 font-semibold mb-2">{ar ? 'التفاصيل' : 'Details'}</h2>
          {canEdit && <p className="text-slate-400 text-xs mb-2">{ar ? 'اضغط على أي قيمة لتعديلها' : 'Click any value to edit it'}</p>}
          <Cell label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'} field="name" value={opp.name} display={opp.name} />
          <Cell label={ar ? 'الاسم (عربي)' : 'Name (Arabic)'} field="nameAr" value={opp.nameAr} display={opp.nameAr} />
          <Cell label={ar ? 'القيمة التقديرية' : 'Estimated value'} field="estimatedValue" value={opp.estimatedValue} display={money(opp.estimatedValue, opp.currency)} type="number" />
          <Cell label={ar ? 'الاحتمالية %' : 'Probability %'} field="probability" value={opp.probability} display={`${opp.probability || 0}%`} type="number" />
          <Cell label={ar ? 'الإغلاق المتوقع' : 'Expected close'} field="expectedCloseDate" value={toDateInput(opp.expectedCloseDate)} display={fmtDate(opp.expectedCloseDate)} type="date" />
          <Cell label={ar ? 'المسؤول' : 'Owner'} field="ownerName" value={opp.ownerName} display={opp.ownerName || userName(opp.owner)} />
          <Cell label={ar ? 'المنطقة' : 'Region'} field="region" value={opp.region} display={opp.region} />
          <Cell label={ar ? 'المدينة' : 'City'} field="city" value={opp.city} display={opp.city} />
          <Cell label={ar ? 'اسم الشريك' : 'Partner'} field="partnerName" value={opp.partnerName} display={opp.partnerName} />
          <Cell label={ar ? 'شركة CRM مرتبطة' : 'Linked CRM company'} display={companyName(opp.crmCompany, lang)} />
          <Cell label={ar ? 'المصدر' : 'Source'} field="source" value={opp.source} display={opp.source} />
          <Cell label={ar ? 'الخطوة التالية' : 'Next step'} field="nextStep" value={opp.nextStep} display={opp.nextStep} />
          <Cell label={ar ? 'تاريخ الخطوة التالية' : 'Next step date'} field="nextStepDate" value={toDateInput(opp.nextStepDate)} display={fmtDate(opp.nextStepDate)} type="date" />
          <Cell label={ar ? 'المنافسون' : 'Competitors'} display={(opp.competitors || []).join('، ') || '—'} />
          <Cell label={ar ? 'المخاطر' : 'Risks'} field="risks" value={opp.risks} display={opp.risks} />
          <Cell label={ar ? 'الوصف' : 'Description'} field="description" value={opp.description} display={opp.description} />
          <Cell label={ar ? 'ملاحظات' : 'Notes'} field="notes" value={opp.notes} display={opp.notes} />
        </div>

        {/* Activity timeline */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-slate-900 font-semibold">{ar ? 'سجل الأنشطة' : 'Activity timeline'}</h2>
            {canEdit && (
              <PrimaryButton onClick={() => { setActForm({ ...EMPTY_ACTIVITY, date: today() }); setShowActivity(true); }}>
                <Plus className="w-4 h-4" /> {ar ? 'إضافة نشاط' : 'Add activity'}
              </PrimaryButton>
            )}
          </div>
          <div className="space-y-3">
            {activities.map((a) => {
              const at = ACTIVITY_TYPE[a.type];
              return (
                <div key={a._id} className="border-s-2 border-[#f37121]/40 ps-3 py-1 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-slate-900 text-sm font-medium text-start">{a.title}</p>
                        {at && <SmallBadge bg={at.bg} text={at.text} label={ar ? at.ar : at.en} />}
                      </div>
                      {a.summary && <p className="text-slate-600 text-xs mt-1 text-start">{a.summary}</p>}
                      {a.outcome && <p className="text-emerald-700 text-xs mt-1 text-start">{ar ? 'النتيجة: ' : 'Outcome: '}{a.outcome}</p>}
                      {a.nextStep && <p className="text-indigo-700 text-xs mt-1 text-start">{ar ? 'التالي: ' : 'Next: '}{a.nextStep}</p>}
                      <p className="text-slate-400 text-[11px] mt-1 text-start">
                        {fmtDateTime(a.date)} · {a.performedByName || userName(a.performedBy)}
                      </p>
                    </div>
                    {canEdit && (
                      <button type="button" onClick={() => removeActivity(a)}
                        className="text-red-600 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {activities.length === 0 && (
              <p className="text-slate-400 text-sm py-8 text-center">{ar ? 'لا توجد أنشطة بعد' : 'No activity logged yet'}</p>
            )}
          </div>
        </div>
      </div>

      <Modal open={showActivity} onClose={() => setShowActivity(false)} title={ar ? 'إضافة نشاط' : 'Add activity'}
        footer={<>
          <button type="button" onClick={() => setShowActivity(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <PrimaryButton onClick={saveActivity} disabled={savingAct}>
            {savingAct ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'العنوان' : 'Title'} span2>
            <TextInput value={actForm.title} onChange={(e) => setActForm({ ...actForm, title: e.target.value })} />
          </Field>
          <Field label={ar ? 'النوع' : 'Type'}>
            <Select value={actForm.type} onChange={(e) => setActForm({ ...actForm, type: e.target.value })}>
              {optionsOf(ACTIVITY_TYPE, lang).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'التاريخ' : 'Date'}>
            <TextInput type="date" value={actForm.date} onChange={(e) => setActForm({ ...actForm, date: e.target.value })} />
          </Field>
          <Field label={ar ? 'الملخص' : 'Summary'} span2>
            <TextArea rows={3} value={actForm.summary} onChange={(e) => setActForm({ ...actForm, summary: e.target.value })} />
          </Field>
          <Field label={ar ? 'النتيجة' : 'Outcome'} span2>
            <TextInput value={actForm.outcome} onChange={(e) => setActForm({ ...actForm, outcome: e.target.value })} />
          </Field>
          <Field label={ar ? 'الخطوة التالية' : 'Next step'} span2>
            <TextInput value={actForm.nextStep} onChange={(e) => setActForm({ ...actForm, nextStep: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
