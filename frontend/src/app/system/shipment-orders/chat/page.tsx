'use client';
// مساعد إنشاء الشحنة — the create form as a conversation. One question per
// turn, each rendered as whatever form-settings configured (chips for options,
// typed inputs otherwise), and at the end it POSTs the SAME payload to the SAME
// endpoint as the form page. There is no AI and no extra backend: it is a
// scripted walk over the field config, so it costs the server exactly one
// request — the create — no matter how many agents use it at once.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Bot, Send, Check, Loader2, RotateCcw, UserPlus, ExternalLink, SkipForward } from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  FormField, OrderCustomer, OrderVehicle, GROUP_LABELS, fieldLabel, optionLabel,
  FIXED_KEYS, Lang, canEditOrders, money,
} from '@/lib/shipmentOrders';

const fold = (x: string) => x.toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

const SYSTEM_KEYS = new Set([
  'fromCity', 'toCity', 'truckType', 'cargoType', 'truckLength', 'quantity',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch', 'notes',
]);

interface Msg { who: 'bot' | 'user'; text: string }

type Step =
  | { kind: 'customer' }
  | { kind: 'vehicle' }
  | { kind: 'field'; field: FormField }
  | { kind: 'summary' };

export default function ChatCreatePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const { notify } = useDialog();

  const [fields, setFields] = useState<FormField[]>([]);
  const [customers, setCustomers] = useState<OrderCustomer[]>([]);
  const [vehicles, setVehicles] = useState<OrderVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [done, setDone] = useState<{ waybill: number } | null>(null);

  // The one free-text box at the bottom, reused by every typed step.
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [newCustMode, setNewCustMode] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [f, c, v] = await Promise.all([
          api.get<{ fields: FormField[] }>('/api/shipment-orders/fields'),
          api.get<{ customers: OrderCustomer[] }>('/api/shipment-orders/customers'),
          api.get<{ vehicles: OrderVehicle[] }>('/api/shipment-orders/vehicles'),
        ]);
        setFields(f.fields || []);
        setCustomers(c.customers || []);
        setVehicles(v.vehicles || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // The script: customer → truck → every active configured question, in the
  // groups' reading order → confirm.
  const steps: Step[] = useMemo(() => {
    const groupOrder: FormField['group'][] = ['pickup_delivery', 'shipment', 'pricing_time', 'payment'];
    const qs: Step[] = [{ kind: 'customer' }, { kind: 'vehicle' }];
    groupOrder.forEach((g) => {
      fields
        .filter((x) => x.group === g && !FIXED_KEYS.has(x.key))
        .forEach((x) => qs.push({ kind: 'field', field: x }));
    });
    qs.push({ kind: 'summary' });
    return qs;
  }, [fields]);

  const step = steps[stepIdx];

  const botAsk = useCallback((s: Step | undefined): string => {
    if (!s) return '';
    if (s.kind === 'customer') return ar ? 'أهلاً! 👋 نبدأ — الشحنة دي لمين؟ اكتب اسم العميل أو اختاره:' : 'Hi! 👋 Who is this shipment for?';
    if (s.kind === 'vehicle') return ar ? 'تمام. أنهي سيارة هتشيلها؟ اكتب اللوحة أو اسم السائق:' : 'Which truck carries it? Type a plate or driver:';
    if (s.kind === 'summary') return ar ? 'كده خلصنا ✅ — راجع الملخص وأكّد:' : 'All set ✅ — review and confirm:';
    const f = s.field;
    const label = fieldLabel(f, lang as Lang);
    if (f.inputType === 'cards' || f.inputType === 'select') return ar ? `اختار ${label}:` : `Pick ${label}:`;
    if (f.inputType === 'datetime') return ar ? `${label} — إمتى؟` : `${label} — when?`;
    return ar ? `${label}؟` : `${label}?`;
  }, [ar, lang]);

  // Ask the current question once, whenever the step changes.
  const askedRef = useRef(-1);
  useEffect(() => {
    if (loading || done || askedRef.current === stepIdx) return;
    askedRef.current = stepIdx;
    const text = botAsk(step);
    if (text) setMsgs((m) => [...m, { who: 'bot', text }]);
    setDraft(''); setSearch('');
  }, [stepIdx, loading, done, step, botAsk]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, stepIdx]);

  const say = (who: 'bot' | 'user', text: string) => setMsgs((m) => [...m, { who, text }]);
  const next = () => setStepIdx((i) => Math.min(i + 1, steps.length - 1));

  const pickCustomer = (c: OrderCustomer) => {
    setCustomerId(c._id);
    say('user', c.name);
    // Same autofill as the form page — defaults now, route price on the fly.
    setAnswers((a) => {
      const nextA: Record<string, any> = { ...a, customerName: c.name };
      const d = c.defaults || {};
      (['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch'] as const)
        .forEach((k) => { if (!nextA[k] && d[k]) nextA[k] = d[k]; });
      return nextA;
    });
    if ((c.routes || []).length) {
      say('bot', ar
        ? `ده ليه ${c.routes.length} مسار متسعّر — لو اخترت واحد منهم هحط السعر تلقائياً.`
        : `They have ${c.routes.length} priced routes — matching ones auto-price.`);
    }
    next();
  };

  const createCustomerInline = () => {
    const name = draft.trim();
    if (!name) return;
    setAnswers((a) => ({ ...a, newCustomerName: name, customerName: name }));
    setCustomerId('');
    say('user', name);
    say('bot', ar ? `هسجّل «${name}» كعميل جديد مع الشحنة ✅` : `“${name}” will be registered as a new customer ✅`);
    setNewCustMode(false);
    next();
  };

  const pickVehicle = (v: OrderVehicle | null) => {
    if (!v) {
      say('user', ar ? 'من غير سيارة دلوقتي' : 'No truck yet');
      next();
      return;
    }
    setVehicleId(v._id);
    const label = [v.plate, v.name].filter(Boolean).join(' — ');
    say('user', label);
    setAnswers((a) => ({
      ...a,
      driverName: a.driverName || v.defaultDriverName || '',
      driverPhone: a.driverPhone || v.defaultDriverPhone || '',
      truckType: a.truckType || v.truckType || '',
    }));
    if (v.defaultDriverName) say('bot', ar ? `السائق: ${v.defaultDriverName} ✓ (من بيانات السيارة)` : `Driver: ${v.defaultDriverName} ✓`);
    next();
  };

  const answerField = (f: FormField, value: any, display: string) => {
    say('user', display);
    setAnswers((a) => {
      const nextA = { ...a, [f.key]: value };
      // Route priced for this customer? plant the sell price the moment both
      // cities are known.
      const c = customers.find((x) => x._id === customerId);
      if (c && (f.key === 'fromCity' || f.key === 'toCity')) {
        const from = f.key === 'fromCity' ? value : nextA.fromCity;
        const to = f.key === 'toCity' ? value : nextA.toCity;
        const route = (c.routes || []).find((r) => r.fromCity === from && r.toCity === to);
        if (route?.price != null && nextA.sellPrice == null) {
          nextA.sellPrice = route.price;
          setTimeout(() => say('bot', ar ? `سعر المسار ده متسجل عندي: ${money(route.price)} — حطيته كسعر بيع ✓` : `Known route price ${money(route.price)} applied ✓`), 0);
        }
      }
      return nextA;
    });
    next();
  };

  const skip = (f: FormField) => { say('user', ar ? 'تخطّي' : 'skip'); next(); };

  const submit = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = { customFields: {} };
      fields.forEach((f) => {
        const v = answers[f.key];
        if (v === undefined) return;
        if (SYSTEM_KEYS.has(f.key)) payload[f.key] = v;
        else payload.customFields[f.key] = v;
      });
      payload.driverName = answers.driverName || '';
      payload.driverPhone = answers.driverPhone || '';
      payload.status = 'requesting';
      if (customerId) payload.customer = customerId;
      else if (answers.newCustomerName) payload.newCustomer = { name: answers.newCustomerName, phone: '' };
      if (vehicleId) payload.vehicle = vehicleId;
      ['pickupTime', 'startTime', 'arrivalTime'].forEach((k) => {
        payload[k] = answers[k] ? new Date(answers[k]).toISOString() : null;
      });
      ['quantity', 'sellPrice', 'buyPrice', 'driverRentPrice'].forEach((k) => {
        if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
        else if (payload[k] != null) payload[k] = Number(payload[k]);
      });
      const d = await api.post<{ order: any }>('/api/shipment-orders/orders', payload);
      setDone({ waybill: d.order.waybillNumber });
      say('bot', ar ? `تمت! 🎉 الشحنة اتسجلت برقم بوليصة ${d.order.waybillNumber}` : `Done! 🎉 Waybill ${d.order.waybillNumber}`);
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const restart = () => {
    setMsgs([]); setAnswers({}); setCustomerId(''); setVehicleId('');
    setDone(null); setStepIdx(0); askedRef.current = -1; setDraft(''); setSearch('');
  };

  if (!canEditOrders(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const chip = 'px-3.5 py-2 rounded-full border text-sm font-semibold transition-all border-slate-300 bg-white text-slate-700 hover:border-[#f37121] hover:text-[#f37121]';

  // ── the answer area for the current step ─────────────────────────────────
  const renderControls = () => {
    if (done) {
      return (
        <div className="flex flex-wrap gap-2 justify-center">
          <button type="button" onClick={restart} className={chip}><RotateCcw className="w-4 h-4 inline me-1" /> {ar ? 'شحنة جديدة' : 'New shipment'}</button>
          <button type="button" onClick={() => router.push('/system/shipment-orders')} className={chip}><ExternalLink className="w-4 h-4 inline me-1" /> {ar ? 'افتح القائمة' : 'Open the list'}</button>
        </div>
      );
    }
    if (!step) return null;

    if (step.kind === 'customer') {
      const list = customers.filter((c) => !search.trim() || fold(c.name).includes(fold(search))).slice(0, 8);
      return (
        <div className="space-y-2">
          {!newCustMode ? (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={ar ? 'اكتب اسم العميل للبحث…' : 'Type to search customers…'}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
              <div className="flex flex-wrap gap-2">
                {list.map((c) => (
                  <button key={c._id} type="button" onClick={() => pickCustomer(c)} className={chip}>{c.name}</button>
                ))}
                <button type="button" onClick={() => { setNewCustMode(true); setDraft(search); }}
                  className={chip + ' border-dashed'}><UserPlus className="w-4 h-4 inline me-1" /> {ar ? 'عميل جديد' : 'New customer'}</button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                onKeyDown={(e) => e.key === 'Enter' && createCustomerInline()}
                placeholder={ar ? 'اسم العميل الجديد…' : 'New customer name…'}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
              <button type="button" onClick={createCustomerInline} disabled={!draft.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#f37121] text-white disabled:opacity-40"><Send className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      );
    }

    if (step.kind === 'vehicle') {
      const list = vehicles.filter((v) => {
        if (!search.trim()) return true;
        const hay = fold([v.plate, v.name, v.defaultDriverName, typeof v.supplier === 'object' ? v.supplier?.name : ''].filter(Boolean).join(' '));
        return hay.includes(fold(search));
      }).slice(0, 8);
      return (
        <div className="space-y-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={ar ? 'اكتب اللوحة أو السائق…' : 'Type plate or driver…'}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
          <div className="flex flex-wrap gap-2">
            {list.map((v) => (
              <button key={v._id} type="button" onClick={() => pickVehicle(v)} className={chip}>
                {v.plate}{v.defaultDriverName ? ` · ${v.defaultDriverName}` : ''}
              </button>
            ))}
            <button type="button" onClick={() => pickVehicle(null)} className={chip + ' border-dashed text-slate-500'}>
              <SkipForward className="w-4 h-4 inline me-1" /> {ar ? 'أحددها بعدين' : 'Decide later'}
            </button>
          </div>
        </div>
      );
    }

    if (step.kind === 'summary') {
      const rows: [string, string][] = [];
      if (answers.customerName) rows.push([ar ? 'العميل' : 'Customer', answers.customerName]);
      const veh = vehicles.find((v) => v._id === vehicleId);
      if (veh) rows.push([ar ? 'السيارة' : 'Vehicle', veh.plate]);
      if (answers.driverName) rows.push([ar ? 'السائق' : 'Driver', answers.driverName]);
      fields.forEach((f) => {
        if (FIXED_KEYS.has(f.key)) return;
        const v = answers[f.key];
        if (v === undefined || v === '') return;
        const disp = ['select', 'cards'].includes(f.inputType)
          ? optionLabel(f.options.find((o) => o.key === v) || { key: v, ar: v, en: v }, lang as Lang)
          : f.inputType === 'datetime' ? new Date(v).toLocaleString(ar ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : String(v);
        rows.push([fieldLabel(f, lang as Lang), disp]);
      });
      return (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {rows.map(([k, v], i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm border-b border-slate-100 pb-1.5 last:border-0">
                <span className="text-slate-500">{k}</span>
                <span className="font-semibold text-slate-900 text-end">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={restart} className={chip}><RotateCcw className="w-4 h-4 inline me-1" /> {ar ? 'من الأول' : 'Start over'}</button>
            <button type="button" onClick={submit} disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {ar ? 'تأكيد وإنشاء الشحنة' : 'Confirm & create'}
            </button>
          </div>
        </div>
      );
    }

    // configured field steps
    const f = step.field;
    if (f.inputType === 'cards' || f.inputType === 'select') {
      const list = f.options.filter((o) => !search.trim() || fold(optionLabel(o, lang as Lang)).includes(fold(search)));
      return (
        <div className="space-y-2">
          {f.options.length > 10 && (
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={ar ? 'اكتب للبحث…' : 'Type to filter…'}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
          )}
          <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
            {list.map((o) => (
              <button key={o.key} type="button" onClick={() => answerField(f, o.key, optionLabel(o, lang as Lang))} className={chip}>
                {optionLabel(o, lang as Lang)}
              </button>
            ))}
            {!f.required && (
              <button type="button" onClick={() => skip(f)} className={chip + ' border-dashed text-slate-500'}>
                <SkipForward className="w-4 h-4 inline me-1" /> {ar ? 'تخطّي' : 'Skip'}
              </button>
            )}
          </div>
        </div>
      );
    }
    const inputType = f.inputType === 'number' ? 'number' : f.inputType === 'datetime' ? 'datetime-local' : 'text';
    const sendTyped = () => {
      if (!draft.trim()) { if (!f.required) skip(f); return; }
      const disp = f.inputType === 'datetime'
        ? new Date(draft).toLocaleString(ar ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : draft;
      answerField(f, draft, disp);
    };
    return (
      <div className="flex gap-2">
        <input type={inputType} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
          onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
          placeholder={fieldLabel(f, lang as Lang)}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
        {!f.required && (
          <button type="button" onClick={() => skip(f)} className="px-3 py-2.5 rounded-xl border border-dashed border-slate-300 text-slate-500 text-sm" title={ar ? 'تخطّي' : 'Skip'}>
            <SkipForward className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={sendTyped} className="px-4 py-2.5 rounded-xl bg-[#f37121] text-white"><Send className="w-4 h-4" /></button>
      </div>
    );
  };

  const progress = Math.round((Math.min(stepIdx, steps.length - 1) / Math.max(steps.length - 1, 1)) * 100);

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Bot className="w-5 h-5" />} title={ar ? 'مساعد إنشاء الشحنة' : 'Shipment assistant'}
        subtitle={ar ? 'سؤال بسؤال — وبينشئ نفس الشحنة اللي بتطلع من النموذج بالظبط' : 'One question at a time — creates the same shipment as the form'} />

      {/* progress */}
      <div className="mt-3 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full bg-[#f37121] transition-all duration-500" style={{ width: `${done ? 100 : progress}%` }} />
      </div>

      {/* the conversation */}
      <div className="flex-1 overflow-y-auto py-5 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.who === 'bot' ? 'justify-start' : 'justify-end'}`}>
            {m.who === 'bot' && (
              <span className="w-8 h-8 rounded-full bg-[#f37121]/15 text-[#f37121] flex items-center justify-center me-2 shrink-0">
                <Bot className="w-4 h-4" />
              </span>
            )}
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.who === 'bot'
              ? 'bg-white border border-slate-200 text-slate-800 rounded-ts-sm'
              : 'bg-[#f37121] text-white rounded-te-sm shadow-sm'}`}>
              {m.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* the answer area */}
      <div className="border-t border-slate-200 bg-slate-50/60 rounded-t-2xl p-4">
        {renderControls()}
      </div>
    </div>
  );
}
