'use client';
/**
 * تعديلُ العميل — البياناتُ والتفضيلاتُ وأسعارُ المسارات.
 *
 * ── وما كان مكسورًا فيه ─────────────────────────────────────────────────────
 * ١) المدينةُ المحفوظة كانت تُرسَم فارغة: `SearchableSelect` يعرض النصَّ الشبحيّ
 *    لكلّ قيمةٍ ليست في قائمة إعدادات النموذج، ومساراتُ العملاء فيها مدنٌ جاءت
 *    من الكشوف لا من القائمة («جده ص ٣»). فالعميلُ ذو ٧٢ مسارًا يُفتَح تعديلُه
 *    فيبدو بلا بيانات. صار الصندوقُ مركّبًا: يعرض المحفوظَ دائمًا، والقائمةُ
 *    اقتراحاتٌ يُكتَب خارجَها.
 * ٢) والعرضُ كان مقلوبًا: مدينتان ضيّقتان وسعرٌ عريض، والمدينةُ اسمٌ والسعرُ
 *    أربعةُ أرقام. فالمدينتان تأخذان العرضَ والسعرُ سبعةُ أروع لا أكثر.
 * ٣) واثنتان وسبعون مسارًا لا تُقرأ في قائمةٍ بلا بحث: فوقها بحثٌ، وزرُّ
 *    الإضافة ملتصقٌ بأعلاها فلا يُبحَث عنه في آخر القائمة.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, X, Check, Loader2, Search, Route } from 'lucide-react';
import {
  Modal, Field, TextInput, TextArea, Select, SearchableSelect, PrimaryButton,
} from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { FormField, optionLabel, Lang } from '@/lib/shipmentOrders';
import { AgreedRoute, foldAr, fmtDay, priceSourceLabel } from '@/lib/customerRegistry';

export interface EditableCustomer {
  _id?: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  routes?: AgreedRoute[];
  defaults?: Record<string, string>;
}

const EMPTY_DEFAULTS = { truckType: '', cargoType: '', paymentMethod: '', driverRentType: '', branch: '' };

const DEFAULT_KEYS: [keyof typeof EMPTY_DEFAULTS, string, string][] = [
  ['truckType', 'نوع الشاحنة', 'Truck type'],
  ['cargoType', 'نوع الحمولة', 'Cargo type'],
  ['paymentMethod', 'طريقة الدفع', 'Payment method'],
  ['driverRentType', 'نوع تأجير السائق', 'Driver rent type'],
  ['branch', 'الفرع', 'Branch'],
];

export default function CustomerEditDialog({
  open, customer, onClose, onSaved, lang,
}: {
  open: boolean;
  /** `null` = عميلٌ جديد. */
  customer: EditableCustomer | null;
  onClose: () => void;
  onSaved: () => void;
  lang: Lang;
}) {
  const ar = lang === 'ar';
  const { notify } = useDialog();
  const [fields, setFields] = useState<FormField[]>([]);
  const [form, setForm] = useState<any>({ name: '', phone: '', email: '', notes: '', routes: [], defaults: { ...EMPTY_DEFAULTS } });
  const [saving, setSaving] = useState(false);
  const [routeQ, setRouteQ] = useState('');

  // القوائمُ نفسُها التي يقرأها نموذجُ إنشاء الشحنة — مفردةٌ واحدةٌ في كلّ مكان.
  useEffect(() => {
    if (!open || fields.length) return;
    api.get<{ fields: FormField[] }>('/api/customer-registry/options')
      .then((d) => setFields(d.fields || [])).catch(() => {});
  }, [open, fields.length]);

  useEffect(() => {
    if (!open) return;
    setRouteQ('');
    setForm({
      name: customer?.name || '',
      phone: customer?.phone || '',
      email: customer?.email || '',
      notes: customer?.notes || '',
      routes: (customer?.routes || []).map((r) => ({ ...r, price: r.price ?? '' })),
      defaults: { ...EMPTY_DEFAULTS, ...(customer?.defaults || {}) },
    });
  }, [open, customer]);

  const optionsOf = useCallback(
    (key: string) => fields.find((f) => f.key === key)?.options || [],
    [fields],
  );
  const cityOptions = useMemo(
    () => optionsOf('fromCity').map((o) => ({ value: o.key, label: optionLabel(o, lang) })),
    [optionsOf, lang],
  );

  // الفهرسُ الأصليُّ يُحمَل مع الصفّ: البحثُ يخفي صفوفًا، والكتابةُ على الفهرس
  // المعروض تكتب على مسارٍ آخر.
  const visibleRoutes = useMemo(() => {
    const rows = (form.routes || []).map((r: any, i: number) => ({ r, i }));
    const s = foldAr(routeQ);
    if (!s) return rows;
    return rows.filter(({ r }: any) => foldAr(`${r.fromCity} ${r.toCity} ${r.price ?? ''}`).includes(s));
  }, [form.routes, routeQ]);

  const setRoute = (i: number, k: string, v: any) =>
    setForm((f: any) => ({ ...f, routes: f.routes.map((r: any, x: number) => (x === i ? { ...r, [k]: v } : r)) }));

  const addRoute = () => {
    setRouteQ('');
    setForm((f: any) => ({ ...f, routes: [{ fromCity: '', toCity: '', price: '' }, ...f.routes] }));
  };

  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        email: form.email,
        notes: form.notes,
        defaults: form.defaults,
        routes: (form.routes || [])
          .filter((r: any) => r.fromCity && r.toCity)
          .map((r: any) => ({
            fromCity: r.fromCity,
            toCity: r.toCity,
            price: r.price === '' || r.price == null ? null : Number(r.price),
            // التاريخُ والمصدرُ لا يُخترعان هنا — يُعادان كما جاءا.
            ...(r.at ? { at: r.at } : {}),
            ...(r.source ? { source: r.source } : {}),
            ...(r.hits ? { hits: r.hits } : {}),
          })),
      };
      if (customer?._id) await api.put(`/api/customer-registry/${customer._id}`, payload);
      else await api.post('/api/customer-registry', payload);
      onClose();
      onSaved();
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} wide
      title={customer?._id ? `${ar ? 'تعديل عميل' : 'Edit customer'} — ${customer.name}` : (ar ? 'إضافة عميل' : 'Add customer')}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
        </PrimaryButton>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={ar ? 'الاسم *' : 'Name *'} span2>
          <TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label={ar ? 'الجوال' : 'Phone'}>
          <TextInput value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <Field label={ar ? 'البريد' : 'Email'}>
          <TextInput value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} />
        </Field>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5 me-auto">
            <Route className="w-3.5 h-3.5 text-[#f37121]" />
            {ar ? 'أسعار المسارات' : 'Route prices'}
            <span className="text-slate-400 font-semibold tabular-nums">
              {visibleRoutes.length}{visibleRoutes.length !== (form.routes || []).length ? ` / ${(form.routes || []).length}` : ''}
            </span>
          </p>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
            <input value={routeQ} onChange={(e) => setRouteQ(e.target.value)}
              placeholder={ar ? 'بحث في المسارات…' : 'Search routes…'}
              className="w-44 ps-8 pe-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:border-[#f37121]" />
          </div>
          <button type="button" onClick={addRoute}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-semibold hover:bg-[#e06010]">
            <Plus className="w-3.5 h-3.5" /> {ar ? 'إضافة مسار' : 'Add route'}
          </button>
        </div>

        <div className="max-h-[42vh] overflow-y-auto p-3 space-y-2">
          {(form.routes || []).length === 0 && (
            <p className="text-xs text-slate-400 py-4 text-center">{ar ? 'لا توجد مسارات بعد.' : 'No routes yet.'}</p>
          )}
          {(form.routes || []).length > 0 && visibleRoutes.length === 0 && (
            <p className="text-xs text-slate-400 py-4 text-center">{ar ? 'لا مسار يطابق البحث.' : 'No route matches.'}</p>
          )}
          {visibleRoutes.map(({ r, i }: any) => (
            <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchableSelect value={r.fromCity || ''} onChange={(x) => setRoute(i, 'fromCity', x)} searchAfter={0} allowCustom
                    placeholder={ar ? 'من…' : 'From…'} searchPlaceholder={ar ? 'اكتب أو ابحث…' : 'Type or search…'}
                    customHint={(t) => (ar ? `استعمل «${t}»` : `Use “${t}”`)}
                    options={cityOptions} />
                </div>
                <span className="text-slate-300 shrink-0 text-xs">←</span>
                <div className="flex-1 min-w-0">
                  <SearchableSelect value={r.toCity || ''} onChange={(x) => setRoute(i, 'toCity', x)} searchAfter={0} allowCustom
                    placeholder={ar ? 'إلى…' : 'To…'} searchPlaceholder={ar ? 'اكتب أو ابحث…' : 'Type or search…'}
                    customHint={(t) => (ar ? `استعمل «${t}»` : `Use “${t}”`)}
                    options={cityOptions} />
                </div>
                {/* العرضُ على الغلاف لا على الخانة: `TextInput` أساسُه `w-full`
                    ويغلب أيَّ عرضٍ يُمرَّر إليه، فتصير خانةُ السعر هي العريضة
                    والمدينتان شريطين — وهو عينُ ما كان مكسورًا. */}
                <div className="w-28 shrink-0">
                  <TextInput type="number" className="text-end" value={r.price ?? ''}
                    onChange={(e) => setRoute(i, 'price', e.target.value)} placeholder={ar ? 'السعر' : 'Price'} />
                </div>
                <button type="button" onClick={() => setForm((f: any) => ({ ...f, routes: f.routes.filter((_: any, x: number) => x !== i) }))}
                  className="p-2 text-slate-400 hover:text-red-600 shrink-0" aria-label="remove"><X className="w-4 h-4" /></button>
              </div>
              {(r.at || r.source) && (
                <p className="mt-1 text-[11px] text-slate-400 px-1">
                  {ar ? 'آخر سعر' : 'last priced'} {fmtDay(r.at)}
                  {r.source ? ` · ${priceSourceLabel(r.source, ar)}` : ''}
                  {r.hits > 1 ? ` · ${ar ? 'تكرّرت' : 'seen'} ${r.hits}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-slate-600 mb-2">{ar ? 'التفضيلات المعتمدة (تُملأ تلقائياً في الشحنة)' : 'Usual defaults (autofilled on the form)'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DEFAULT_KEYS.map(([k, labelAr, labelEn]) => (
            <Field key={k} label={ar ? labelAr : labelEn}>
              <Select value={form.defaults[k] || ''} onChange={(e) => setForm((f: any) => ({ ...f, defaults: { ...f.defaults, [k]: e.target.value } }))}>
                <option value="">—</option>
                {/* القيمةُ المحفوظةُ تظهر ولو لم تعد في القائمة — لا تُمحى بصمت. */}
                {form.defaults[k] && !optionsOf(k).some((o) => o.key === form.defaults[k]) && (
                  <option value={form.defaults[k]}>{form.defaults[k]}</option>
                )}
                {optionsOf(k).map((o) => <option key={o.key} value={o.key}>{optionLabel(o, lang)}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </div>

      <Field label={ar ? 'ملاحظات' : 'Notes'}>
        <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
      </Field>
    </Modal>
  );
}
