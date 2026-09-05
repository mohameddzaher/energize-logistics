'use client';
// إعدادات قسم طلبات الشحنات — القسمُ كلُّه يُضبط من هنا.
//
// كانت «إعدادات النموذج» صفحةً وحدَها، وبقيّةُ ما يُضبط في القسم لا موضعَ له:
// أرقامُ البوالص من أين تبدأ، وقوائمُ المدن وأنواع الشاحنات، والحالاتُ التي
// تمرّ بها الشحنة. فمن أراد ضبطَ شيءٍ بحث عنه، أو لم يجده أصلًا.
//
// وكلُّه ديناميكيّ: ما يُغيَّر هنا يظهر في نموذج الإنشاء وفي الجداول في اللحظة
// نفسِها، بلا نشرةٍ برمجيّة.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { canAdminOrders, vocabLabel, Lang } from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { Spinner, PageHeader, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import ShipmentFormFields from '@/components/shipment-orders/FormFieldsManager';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';
import { Settings, SlidersHorizontal, Hash, Tags, ListChecks, Users, Truck } from 'lucide-react';
import Link from 'next/link';

type Tab = 'form' | 'numbering' | 'lists' | 'statuses';

export default function ShipmentOrdersSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const admin = canAdminOrders(user);

  const [tab, setTab] = useState<Tab>('form');
  // تشمل المُطفأة: صفحةُ الضبط تُري ما أُخفي كي يُعاد.
  const statusVocab = useOrderStatuses(true);
  const [counter, setCounter] = useState<{ next: number; start: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ next: number; start: number }>('/api/shipment-orders/counter');
      setCounter(d);
    } catch { /* اختياريّ */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveStart = async () => {
    if (!counter) return;
    setSaving(true);
    try {
      const d = await api.put<{ next: number; start: number }>('/api/shipment-orders/counter', { start: counter.start });
      setCounter(d);
      notify(t('حُفظ', 'Saved'), 'success');
    } catch (e: any) { notify(e?.message || t('لم يُحفظ', 'Not saved'), 'error'); }
    setSaving(false);
  };

  if (!admin) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading) return <Spinner />;

  const TABS: [Tab, any, string, string][] = [
    ['form', SlidersHorizontal, 'نموذج الإنشاء', 'Create form'],
    ['lists', Tags, 'قوائم القسم', 'Section lists'],
    ['numbering', Hash, 'ترقيم البوالص', 'Waybill numbering'],
    ['statuses', ListChecks, 'حالات الشحنة', 'Shipment statuses'],
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Settings className="w-6 h-6 text-[#f37121]" />}
        title={t('إعدادات القسم', 'Section settings')}
        subtitle={t('نموذجُ الإنشاء وقوائمُه وترقيمُ البوالص وحالاتُ الشحنة — كلُّها من هنا', 'The create form, its lists, waybill numbering and shipment statuses — all from here')}
      />

      <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-sm inline-flex flex-wrap gap-1 w-full sm:w-auto">
        {TABS.map(([k, Icon, arL, enL]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex-1 sm:flex-none inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon className={`w-4 h-4 ${tab === k ? 'text-[#f37121]' : 'text-slate-400'}`} />
            {ar ? arL : enL}
          </button>
        ))}
      </div>

      {tab === 'form' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {t('كلُّ سطرٍ هنا خانةٌ في نموذج إنشاء الشحنة: اسمُها، وشكلُها (قائمة أو بطاقات أو كتابة)، وخياراتُها، وترتيبُها، وهل هي مطلوبة. ما يُغيَّر يظهر في النموذج فورًا.',
               'Each row is one input on the create-shipment form: its label, how it renders, its options, its order, and whether it is required. Changes appear on the form at once.')}
          </p>
          <ShipmentFormFields embedded />
        </div>
      )}

      {tab === 'lists' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {t('القوائم المشتركة التي تُغذّي خانات النموذج والجداول.', 'The shared lists that feed the form inputs and the tables.')}
          </p>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <ReferenceDataManager module="shipment_orders" embedded />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/system/shipment-orders/customers"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-[#f37121] transition-colors">
              <Users className="w-5 h-5 text-[#f37121]" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{t('سجلّ العملاء', 'Customer register')}</span>
                <span className="block text-[11.5px] text-slate-500">{t('العملاء وأسعارُ مساراتهم', 'Customers and their route prices')}</span>
              </span>
            </Link>
            <Link href="/system/shipment-orders/fleet"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-[#f37121] transition-colors">
              <Truck className="w-5 h-5 text-[#f37121]" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{t('الموردون والمركبات', 'Suppliers & vehicles')}</span>
                <span className="block text-[11.5px] text-slate-500">{t('من يُنفِّذ الحمولة وبأيّ شاحنة', 'Who executes the load, and with which truck')}</span>
              </span>
            </Link>
          </div>
        </div>
      )}

      {tab === 'numbering' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm max-w-xl">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
            <Hash className="w-4 h-4 text-[#f37121]" /> {t('ترقيم البوالص', 'Waybill numbering')}
          </h3>
          {/* ── الرقمُ لا يُنقَص ولا يُعاد ──────────────────────────────────────
              رقمُ البوليصة يُكتب على ورقٍ يُسلَّم للسائق ويُحاسَب عليه. وتكرارُه
              يعني بوليصتين بالرقم نفسِه في يدين — فلا يُقبَل إلّا التقديم. */}
          <p className="text-sm text-slate-500 mb-4">
            {t('رقمُ البوليصة يُكتب على ورقٍ يُسلَّم للسائق ويُحاسَب عليه، فلا يُعاد رقمٌ صُرف. يمكن تقديمُ العدّاد إلى رقمٍ أكبر، ولا يمكن إرجاعُه.',
               'The waybill number goes on paper handed to a driver and is accounted for, so a used number is never reissued. The counter may be moved forward, never back.')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الرقم القادم', 'Next number')}</label>
              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono font-bold text-slate-900">
                {counter?.next ?? '—'}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ابدأ من', 'Start from')}</label>
              <input type="number" min={counter?.next ?? 1} value={counter?.start ?? 0}
                onChange={(e) => setCounter((c) => (c ? { ...c, start: Number(e.target.value) || 0 } : c))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </div>
          </div>
          <div className="mt-4">
            <PrimaryButton onClick={saveStart} disabled={saving || !counter || counter.start < counter.next}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('حفظ', 'Save')}
            </PrimaryButton>
            {counter && counter.start < counter.next && (
              <p className="text-xs text-red-600 mt-2">
                {t(`لا يقلّ عن ${counter.next} — الأرقام التي صُرفت لا تُعاد.`, `Cannot be below ${counter.next} — issued numbers are never reused.`)}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'statuses' && (
        <div className="space-y-4">
          {/* ── ما يُملَك منها وما لا يُملَك ────────────────────────────────────
              الحالةُ مفتاحٌ وتسمية. المفتاحُ عقدٌ: التحليلاتُ تعدّ على
              `arrived`، والتنبيهاتُ تُطلق من `late`، وشرطُ المشتريات في
              المحفظة يقف على `bond_received`، والمنصّةُ الخارجيّة تتكلّم بها.
              فالعشرةُ مكتوبةٌ في الشيفرة ولا تُحذف.

              والتسميةُ واللونُ والترتيبُ وأهي مُستعمَلةٌ اليوم — كلُّها هنا،
              ويُزاد عليها. وما يُغيَّر يظهر في البطاقات وفي نموذج الإنشاء وفي
              التطبيق في اللحظة نفسِها. */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-[#f37121]" /> {t('دورةُ الشحنة الآن', 'The lifecycle as it stands')}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('هذه هي الحالاتُ كما تظهر للفريق الآن. تُعدَّل تسميتُها ولونُها وترتيبُها — وتُخفى من الاستعمال أو يُزاد عليها — من الجدول أسفلَه. والمفاتيحُ العشرة الأساسيّة لا تُحذف: التحليلاتُ تعدّ عليها والتنبيهاتُ تُطلق منها والمنصّةُ الخارجيّة تتكلّم بها.',
                 'These are the statuses as the team sees them now. Their label, colour and order are edited — and they can be hidden or added to — in the table below. The ten core keys are never deleted: analytics count on them, alerts fire from them, and the external platform speaks them.')}
            </p>
            <ol className="space-y-2">
              {statusVocab.map((st, i) => (
                <li key={st.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${st.active ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-200 bg-white opacity-60'}`}>
                  <span className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-500 shrink-0">{i + 1}</span>
                  <span className="text-xs font-semibold rounded-full px-2.5 py-1 text-white" style={{ background: st.color }}>
                    {vocabLabel(st, lang as Lang)}
                  </span>
                  {!st.active && <span className="text-[11px] text-slate-400">{t('غيرُ مستعملة', 'not in use')}</span>}
                  {!st.isCore && <span className="text-[11px] text-[#f37121]">{t('مُضافة', 'added')}</span>}
                  <code className="ms-auto text-[11px] text-slate-400">{st.key}</code>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <ReferenceDataManager module="shipment_orders" type="so_status" embedded />
          </div>

          {/* ── ولماذا لا يُغيَّر المفتاحُ نفسُه ────────────────────────────────
              المخزَّنُ على الشحنة هو المفتاح. فتُعاد تسميةُ «وصلت» غدًا ولا
              يتغيّر شيءٌ في السجلّات؛ أمّا تغييرُ المفتاح فيترك كلَّ شحنةٍ قديمةٍ
              تشير إلى حالةٍ لا وجودَ لها. */}
          <p className="text-[12px] text-slate-500 leading-relaxed">
            {t('المخزَّن على الشحنة هو المفتاح لا الاسم — فتغييرُ التسمية آمنٌ على السجلّات كلِّها، مهما كثرت. وإخفاءُ حالةٍ يُخرجها من الشاشات ولا يمسّ شحنةً تحملها.',
               'What a shipment stores is the key, not the label — renaming is safe across every record, however many. Hiding a status takes it off the screens without touching a shipment that carries it.')}
          </p>
        </div>
      )}

    </div>
  );
}
