'use client';
/**
 * إعداداتُ قسم الأفراد والنقل الخفيف.
 *
 * ما يتكرّر في القسم يُضبَط من هنا، وما يُغيَّر يظهر في الشاشات في اللحظة نفسها
 * (كلُّ كتابةٍ تبثّ `lt:updated`، والقوائمُ تُقرأ من مصدرها في كلّ فتحة).
 *
 * ── والسكنُ غرفٌ لا رقمٌ واحد ───────────────────────────────────────────────
 * «السكنُ يأخذ كم موظّفًا؟» ليس سؤالًا واحدًا: غرفةُ المناديب تسع ثمانيةً وغرفةُ
 * المشرفين ثلاثة. فسعةُ السكن مجموعُ غرفه، والإسكانُ يُرَدّ إن كانت الغرفةُ
 * مكتملةً أو كانت لنوعٍ آخرَ من الموظّفين — وإلّا صار العددُ المكتوب هنا زينةً
 * ووُضع في غرفةٍ أحدَ عشرَ وهي تسع ثمانية.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, Home, Tags, Plus, Pencil, Trash2, X } from 'lucide-react';
import {
  getLTHousing, saveLTHousing, deleteLTHousing, canEditLT, type LTHousing, type LTRoom,
} from '@/lib/lightTransport';

type Tab = 'housing' | 'lists';

const KIND_LABEL: Record<string, { ar: string; en: string }> = {
  any: { ar: 'للجميع', en: 'Anyone' },
  rep: { ar: 'مناديب', en: 'Reps' },
  admin: { ar: 'إداريون', en: 'Admin' },
};

export default function B2CSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const canEdit = canEditLT(user as any);

  const [tab, setTab] = useState<Tab>('housing');
  const [rows, setRows] = useState<LTHousing[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<LTHousing> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const d = await getLTHousing(); setRows(d.housing || []); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:updated', useCallback(() => load(), [load]));

  const save = async () => {
    if (!editing?.name?.trim()) { notify(t('اسم السكن مطلوب', 'Housing name is required'), 'error'); return; }
    setSaving(true);
    try {
      await saveLTHousing(editing._id || null, {
        name: editing.name, cityAr: editing.cityAr, addressAr: editing.addressAr,
        declaredCapacity: editing.declaredCapacity, notes: editing.notes, rooms: editing.rooms || [],
      });
      notify(t('حُفظ', 'Saved'), 'success');
      setEditing(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (h: LTHousing) => {
    const ok = await confirm({
      message: t(`يُحذف سكن «${h.name}»؟`, `Delete housing "${h.name}"?`),
      tone: 'error', confirmLabel: t('حذف', 'Delete'),
    });
    if (!ok) return;
    try { await deleteLTHousing(h._id); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const setRoom = (i: number, patch: Partial<LTRoom>) =>
    setEditing((p) => ({ ...p!, rooms: (p!.rooms || []).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRoom = () =>
    setEditing((p) => ({ ...p!, rooms: [...(p!.rooms || []), { name: '', kind: 'any', capacity: 0 } as LTRoom] }));
  const delRoom = (i: number) =>
    setEditing((p) => ({ ...p!, rooms: (p!.rooms || []).filter((_, j) => j !== i) }));

  if (loading) return <Spinner />;

  const roomsTotal = (editing?.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0);

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات قسم الأفراد', 'B2C settings')}
        subtitle={t('السكن والقوائم المنسدلة — والتغيير يظهر في الشاشات فورًا', 'Housing and the dropdown lists — changes apply at once')} />

      <div className="flex items-center gap-2 flex-wrap">
        {([['housing', 'السكن', 'Housing', Home], ['lists', 'القوائم المنسدلة', 'Dropdown lists', Tags]] as [Tab, string, string, any][])
          .map(([k, a, e, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === k ? 'bg-[#f37121] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'}`}>
              <Icon className="w-4 h-4" /> {t(a, e)}
            </button>
          ))}
      </div>

      {/* القوائمُ المرجعيّةُ الخاصّةُ بهذا القسم وحدَه — لا قوائمُ النظام كلِّه. */}
      {tab === 'lists' && <ReferenceDataManager module="b2c" embedded />}

      {tab === 'housing' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-slate-500 leading-relaxed max-w-3xl">
              {t('سعةُ السكن مجموعُ غرفه. وكلُّ غرفةٍ لها نوعٌ: للمناديب أو للإداريين أو للجميع — فلا يُسكَن مشرفٌ في غرفةِ مناديب، ولا يُتجاوَز عددُ الغرفة. والإشغالُ محسوبٌ من الموظفين لا مكتوبًا باليد.',
                 'A housing’s capacity is the sum of its rooms. Each room is for reps, for admin, or for anyone — so a supervisor is never put in a rep room, and a room is never over-filled. Occupancy is counted from the employees, not typed in.')}
            </p>
            {canEdit && (
              <PrimaryButton onClick={() => setEditing({ name: '', rooms: [] })}>
                <Plus className="w-4 h-4" /> {t('إضافة سكن', 'Add housing')}
              </PrimaryButton>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {rows.map((h) => {
              const pct = h.totalCapacity ? Math.round(((h.occupied || 0) / h.totalCapacity) * 100) : 0;
              const cap = h.totalCapacity || 0;
              const full = cap > 0 && (h.occupied || 0) >= cap;
              return (
                <section key={h._id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${h.isActive === false ? 'opacity-60' : ''} ${full ? 'border-red-300' : 'border-slate-200'}`}>
                  <div className="px-4 pt-3.5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-extrabold text-slate-900 text-[15px] flex items-center gap-2">
                          <Home className="w-4 h-4 text-slate-400" />{h.name}
                          {h.isActive === false && <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10.5px] font-bold">{t('معطَّل', 'inactive')}</span>}
                        </h2>
                        <p className="text-[11.5px] text-slate-500 mt-0.5">{[h.cityAr, h.addressAr].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => setEditing({ ...h, rooms: [...(h.rooms || [])] })} title={t('تعديل', 'Edit')}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                          <button type="button" onClick={() => remove(h)} title={t('حذف', 'Delete')}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>

                    {/* الإشغالُ رقمًا وشريطًا — «باقي كم» هو ما يُسأل عنه. */}
                    <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                      <span className="text-[22px] font-extrabold tabular-nums text-slate-900">{h.occupied || 0}</span>
                      <span className="text-slate-400 text-[13px]">{t('من', 'of')} {h.totalCapacity || 0}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${full ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {full ? t('مكتمل', 'Full') : t(`باقي ${h.free || 0}`, `${h.free || 0} free`)}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full ${full ? 'bg-red-500' : 'bg-[#f37121]'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>

                    {!!(h.rooms || []).length && (
                      <div className="mt-3 space-y-1.5">
                        {(h.rooms || []).map((r) => {
                          const rFull = (r.capacity || 0) > 0 && (r.occupied || 0) >= (r.capacity || 0);
                          return (
                            <div key={r.name} className="flex items-center justify-between gap-2 text-[12.5px] rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                              <span className="font-semibold text-slate-800 truncate">{r.name}</span>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold ${r.kind === 'rep' ? 'bg-indigo-100 text-indigo-700' : r.kind === 'admin' ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-600'}`}>
                                  {t(KIND_LABEL[r.kind].ar, KIND_LABEL[r.kind].en)}
                                </span>
                                <span className={`tabular-nums font-bold ${rFull ? 'text-red-600' : 'text-slate-700'}`}>{r.occupied || 0}/{r.capacity || 0}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!(h.rooms || []).length && (
                      <p className="mt-3 text-[11.5px] text-slate-400">
                        {t('لا غرف مسجَّلة — السعة المكتوبة تُستعمل حتى تُسجَّل الغرف.', 'No rooms yet — the declared capacity is used until rooms are added.')}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
            {!rows.length && (
              <p className="text-slate-400 text-sm p-6">{t('لا سكن مسجَّل بعد.', 'No housing yet.')}</p>
            )}
          </div>
        </div>
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing._id ? t('تعديل سكن', 'Edit housing') : t('إضافة سكن', 'Add housing')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t('اسم السكن', 'Name')}>
              <TextInput value={editing.name || ''} onChange={(e) => setEditing((p) => ({ ...p!, name: e.target.value }))} />
            </Field>
            <Field label={t('المدينة', 'City')}>
              <TextInput value={editing.cityAr || ''} onChange={(e) => setEditing((p) => ({ ...p!, cityAr: e.target.value }))} />
            </Field>
            <div className="md:col-span-2">
              <Field label={t('العنوان', 'Address')}>
                <TextInput value={editing.addressAr || ''} onChange={(e) => setEditing((p) => ({ ...p!, addressAr: e.target.value }))} />
              </Field>
            </div>
            <Field label={t('السعة المكتوبة (تُستعمل إن لم تُسجَّل غرف)', 'Declared capacity (used when there are no rooms)')}>
              <TextInput type="number" min={0} value={String(editing.declaredCapacity ?? 0)}
                onChange={(e) => setEditing((p) => ({ ...p!, declaredCapacity: Number(e.target.value) || 0 }))} />
            </Field>
            <div className="flex items-end">
              <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-full">
                {t(`سعةُ الغرف المسجَّلة: ${roomsTotal}`, `Rooms capacity: ${roomsTotal}`)}
                {roomsTotal > 0 && <span className="text-slate-400"> — {t('هي المعتمدة', 'this is what counts')}</span>}
              </p>
            </div>

            {/* ── الغرفُ ─────────────────────────────────────────────────── */}
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">{t('الغرف', 'Rooms')}</p>
                <button type="button" onClick={addRoom}
                  className="inline-flex items-center gap-1 text-[12.5px] font-bold text-[#f37121] hover:text-[#e06010]">
                  <Plus className="w-3.5 h-3.5" /> {t('إضافة غرفة', 'Add room')}
                </button>
              </div>
              {!(editing.rooms || []).length && (
                <p className="text-[12px] text-slate-400">{t('بلا غرف — تُستعمل السعة المكتوبة أعلاه.', 'No rooms — the declared capacity above is used.')}</p>
              )}
              {(editing.rooms || []).map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="col-span-5">
                    <label className="block text-[11px] text-slate-500 mb-1">{t('اسم الغرفة', 'Room name')}</label>
                    <TextInput value={r.name} onChange={(e) => setRoom(i, { name: e.target.value })} />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-[11px] text-slate-500 mb-1">{t('لمن', 'For')}</label>
                    <Select value={r.kind} onChange={(e: any) => setRoom(i, { kind: e.target.value })}>
                      <option value="any">{t('للجميع', 'Anyone')}</option>
                      <option value="rep">{t('مناديب', 'Reps')}</option>
                      <option value="admin">{t('إداريون', 'Admin')}</option>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">{t('السعة', 'Capacity')}</label>
                    <TextInput type="number" min={0} value={String(r.capacity ?? 0)}
                      onChange={(e) => setRoom(i, { capacity: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button type="button" onClick={() => delRoom(i)} title={t('حذف الغرفة', 'Remove room')}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-white"><X className="w-4 h-4" /></button>
                  </div>
                  {/* والغرفةُ المأهولةُ لا تُصغَّر دون سكّانها — الخادمُ يردّ ذلك بسببه. */}
                  {(r.occupied || 0) > 0 && (
                    <p className="col-span-12 text-[11px] text-slate-500">
                      {t(`يسكنها الآن ${r.occupied} — لا تُخفَّض السعة دونهم.`, `${r.occupied} living here now — capacity cannot go below that.`)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="md:col-span-2">
              <Field label={t('ملاحظات', 'Notes')}>
                <TextInput value={editing.notes || ''} onChange={(e) => setEditing((p) => ({ ...p!, notes: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={save} disabled={saving}>{t('حفظ', 'Save')}</PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
