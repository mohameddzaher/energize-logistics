'use client';
// إعدادات إدارة الأسطول — بونص الجمعة، الهدف الشهري الافتراضي، هدف كل سيارة،
// وروابط تعديل القوائم المنسدلة (نوع الإيجار/الدفع/الحمولة).
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { canAdminFleet } from '@/lib/fleet';
import { Settings, Save, Target, CalendarClock, ListChecks, Truck } from 'lucide-react';
import ReferenceDataManager from '@/components/system/ReferenceDataManager';

export default function FleetSettingsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const { notify } = useDialog();
  const admin = canAdminFleet(user);

  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [fridayBonusAmount, setFridayBonusAmount] = useState(50);
  const [defaultMonthlyTarget, setDefaultMonthlyTarget] = useState(27000);
  const [defaultDriverMonthlyLoads, setDefaultDriverMonthlyLoads] = useState(8);
  const [defaultDriverMonthlyKm, setDefaultDriverMonthlyKm] = useState(8000);
  // «ثلاثون ألفًا شهريًّا» جملةٌ ناقصةٌ ما لم يُقل: دخلًا كما هو، أم بعد مصروف
  // السائق؟ والفرقُ آلافٌ في السيّارة الواحدة.
  const [targetBasis, setTargetBasis] = useState<'gross' | 'net'>('gross');
  const [vehicles, setVehicles] = useState<{ _id: string; plate: string; name?: string; monthlyTarget?: number }[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [savingV, setSavingV] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, v] = await Promise.all([
        api.get<{ config: { fridayBonusAmount: number; defaultMonthlyTarget: number; targetBasis?: 'gross' | 'net'; defaultDriverMonthlyLoads?: number; defaultDriverMonthlyKm?: number } }>('/api/fleet/config'),
        api.get<{ vehicles: { _id: string; plate: string; name?: string; monthlyTarget?: number }[] }>('/api/fleet/vehicles'),
      ]);
      setFridayBonusAmount(cfg.config.fridayBonusAmount);
      setDefaultMonthlyTarget(cfg.config.defaultMonthlyTarget);
      if (cfg.config.defaultDriverMonthlyLoads != null) setDefaultDriverMonthlyLoads(cfg.config.defaultDriverMonthlyLoads);
      if (cfg.config.defaultDriverMonthlyKm != null) setDefaultDriverMonthlyKm(cfg.config.defaultDriverMonthlyKm);
      setTargetBasis(cfg.config.targetBasis === 'net' ? 'net' : 'gross');
      setVehicles(v.vehicles || []);
      setTargets(Object.fromEntries((v.vehicles || []).map((x) => [x._id, String(x.monthlyTarget ?? cfg.config.defaultMonthlyTarget)])));
    } catch (e: any) { notify(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      await api.put('/api/fleet/config', { fridayBonusAmount: Number(fridayBonusAmount) || 0, defaultMonthlyTarget: Number(defaultMonthlyTarget) || 0, targetBasis, defaultDriverMonthlyLoads: Number(defaultDriverMonthlyLoads) || 0, defaultDriverMonthlyKm: Number(defaultDriverMonthlyKm) || 0 });
      notify(ar ? 'تم حفظ الإعدادات' : 'Settings saved', 'success');
    } catch (e: any) { notify(e.message, 'error'); }
    setSavingCfg(false);
  };

  const saveTarget = async (id: string) => {
    setSavingV(id);
    try {
      await api.put(`/api/fleet/vehicles/${id}`, { monthlyTarget: Number(targets[id]) || 0 });
      notify(ar ? 'تم حفظ هدف السيارة' : 'Vehicle target saved', 'success');
    } catch (e: any) { notify(e.message, 'error'); }
    setSavingV(null);
  };

  if (!admin) return <div className="text-slate-500 p-8">{ar ? 'إعدادات القسم لمدير الأسطول فقط.' : 'Fleet manager only.'}</div>;
  if (loading) return <Spinner />;

  const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';
  // خانة الهدف تعرض القيمة السارية فعلًا (الهدف الخاصّ، أو الافتراضيّ لمن لا
  // هدف له) وقد تحمل تعديلًا لم يُحفَظ بعد — فالتصدير يأخذها من نفس الحالة
  // التي تغذّي الخانة، لا من `monthlyTarget` المحفوظ، كي يطابق الملفُّ الشاشة.
  const targetCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 18 },
    { header: ar ? 'الاسم' : 'Name', key: 'name', width: 26, transform: (v) => v || '—' },
    { header: ar ? 'الهدف الشهري' : 'Monthly target', key: '_id', width: 16, transform: (id: string) => Number(targets[id] ?? defaultMonthlyTarget) || 0 },
    // عمودٌ لا تعرضه الشاشة لأنّها تُظهر القيمة السارية فقط: من يراجع الأهداف
    // خارج النظام يحتاج تمييز المخصَّص من المتوارَث عن الافتراضيّ.
    { header: ar ? 'مصدر الهدف' : 'Target source', key: 'monthlyTarget', width: 16, transform: (v) => (v == null || v === '' ? (ar ? 'الافتراضي' : 'Default') : (ar ? 'مخصَّص' : 'Custom')) },
  ];
  const configRows = [
    { label: ar ? 'بونص الجمعة للسائق' : 'Friday driver bonus', value: fridayBonusAmount },
    { label: ar ? 'الهدف الشهري الافتراضي للسيارة' : 'Default vehicle monthly target', value: defaultMonthlyTarget },
  ];
  const configCols: ExportColumn[] = [
    { header: ar ? 'الإعداد' : 'Setting', key: 'label', width: 38 },
    { header: ar ? 'القيمة' : 'Value', key: 'value', width: 16 },
  ];

  const dropdowns = [
    { type: 'fleet_rent_type', ar: 'نوع الإيجار', en: 'Rent types' },
    { type: 'fleet_payment_type', ar: 'نوع الدفع', en: 'Payment types' },
    { type: 'fleet_load_type', ar: 'نوع الحمولة', en: 'Load types' },
  ];

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Settings className="w-5 h-5" />} title={ar ? 'إعدادات إدارة الأسطول' : 'Fleet Settings'}
        subtitle={ar ? 'الأرقام والقوائم القابلة للتعديل في القسم' : 'The section’s tunable numbers & lists'}>
        {/* أرقام القسم وأهداف السيارات جدولان مختلفان، فيخرجان في شيتين لا في
            شيتٍ واحد يخلط سطرين من الإعدادات بعشرات السيارات. */}
        <ExportMenu
          fileName="fleet-settings" lang={ar ? 'ar' : 'en'}
          options={[{
            key: 'all',
            label: ar ? 'الإعدادات والأهداف' : 'Settings & targets',
            sheets: [
              { name: ar ? 'أهداف السيارات' : 'Vehicle targets', rows: vehicles as any[], columns: targetCols },
              { name: ar ? 'أرقام القسم' : 'Section numbers', rows: configRows, columns: configCols },
            ],
          }]}
        />
      </PageHeader>

      {/* أرقام القسم */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <p className="font-bold text-slate-900 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#f37121]" /> {ar ? 'أرقام القسم' : 'Section numbers'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">{ar ? 'بونص الجمعة للسائق' : 'Friday driver bonus'}</label>
            <input type="number" min={0} value={fridayBonusAmount} onChange={(e) => setFridayBonusAmount(Number(e.target.value))} className={inputCls} />
            <p className="text-[11px] text-slate-500 mt-1">{ar ? 'يُضاف لمصروف السائق عند تفعيل زر الجمعة في الحمولة.' : 'Added to driver expense when the Friday toggle is on.'}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">{ar ? 'الهدف الشهري الافتراضي للسيارة' : 'Default vehicle monthly target'}</label>
            <input type="number" min={0} value={defaultMonthlyTarget} onChange={(e) => setDefaultMonthlyTarget(Number(e.target.value))} className={inputCls} />
          </div>

          {/* ── وهدفُ السائق حمولاتٌ ومسافة ────────────────────────────────
              السيّارةُ تُقاس بالدخل، والسائقُ لا يملك السعر: يملك أن يشيل
              ويمشي. فيُقاس بما يملكه. والمسافةُ مقروءةٌ من عدّاد المركبة في
              لوكيشن سوليوشن، لا مقدَّرةٌ من أسماء المدن. */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">{ar ? 'هدف السائق — حمولات في الشهر' : 'Driver target — loads per month'}</label>
            <input type="number" min={0} value={defaultDriverMonthlyLoads} onChange={(e) => setDefaultDriverMonthlyLoads(Number(e.target.value))} className={inputCls} />
            <p className="text-[11px] text-slate-500 mt-1">{ar ? 'يمكن تخصيص هدف مختلف لسائق بعينه من صفحة السائقين.' : 'A single driver can be given a different target on the drivers page.'}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">{ar ? 'هدف السائق — كيلومترات في الشهر' : 'Driver target — km per month'}</label>
            <input type="number" min={0} value={defaultDriverMonthlyKm} onChange={(e) => setDefaultDriverMonthlyKm(Number(e.target.value))} className={inputCls} />
            <p className="text-[11px] text-slate-500 mt-1">{ar ? 'المسافة تُقرأ من عدّاد المركبة نفسه (لوكيشن سوليوشن)، وتُنسب للسائق بحمولته أو بمقعده على المركبة.' : 'Distance is read from the truck\u2019s own odometer and attributed by load, or by the driver\u2019s seat on the truck.'}</p>
          </div>
          <div className="sm:col-span-2">
            {/* ── يُقاس الهدفُ بماذا؟ ────────────────────────────────────────
                بغير هذا السطر يبقى الرقمُ مبهمًا، وتظهر السيّارةُ محقِّقةً على
                مقياسٍ ومقصّرةً على الآخر، فلا يُصدَّق أيُّهما. */}
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">{ar ? 'الهدف يُقاس بـ' : 'Target is measured against'}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ['gross', ar ? 'الدخل كما هو' : 'Income as-is', ar ? 'شامل مصاريف السائقين — يُقارَن بإجمالي إيجارات الحمولات.' : 'Includes driver expenses — compared to gross rent.'],
                ['net', ar ? 'الدخل بعد مصروف السائق' : 'Income after driver expense', ar ? 'غير شامل مصاريف السائقين — يُخصَم مصروف السائق أوّلًا ثمّ يُقارَن.' : 'Excludes driver expenses — deducted first, then compared.'],
              ] as const).map(([k, title, hint]) => (
                <button key={k} type="button" onClick={() => setTargetBasis(k)}
                  className={`text-start rounded-xl border p-3 transition-colors ${targetBasis === k ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${targetBasis === k ? 'border-[#f37121] bg-[#f37121]' : 'border-slate-300'}`} />
                    {title}
                  </span>
                  <span className="block text-[11.5px] text-slate-500 mt-1">{hint}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{ar ? 'يُستخدم للسيارات التي لم يُحدَّد لها هدف خاص.' : 'Used for vehicles without a custom target.'}</p>
          </div>
        </div>
        <button type="button" onClick={saveCfg} disabled={savingCfg} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-60">
          <Save className="w-4 h-4" /> {ar ? 'حفظ الأرقام' : 'Save numbers'}
        </button>
      </div>

      {/* القوائم المنسدلة */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="font-bold text-slate-900 flex items-center gap-2 mb-3"><ListChecks className="w-4 h-4 text-[#f37121]" /> {ar ? 'القوائم المنسدلة القابلة للتعديل' : 'Editable dropdown lists'}</p>
        <p className="text-sm text-slate-500 mb-3">{ar ? 'أضِف أو عدّل خيارات نوع الإيجار والدفع والحمولة من صفحة البيانات المرجعية.' : 'Add / edit rent, payment and load type options in Reference Data.'}</p>
        <div className="flex flex-wrap gap-2">
          {dropdowns.map((d) => (
            <Link key={d.type} href="/system/settings/reference-data" className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-sm font-medium text-slate-700">
              {ar ? d.ar : d.en}
            </Link>
          ))}
        </div>
      </div>

      {/* ── قوائم القسم المنسدلة ────────────────────────────────────────────
          نوعُ الإيجار والدفع والحمولة، وملاحظاتُ المتابعة الجاهزة. كانت
          الأخيرةُ ثمانيةَ سطورٍ في الشيفرة، فمن أراد سطرًا تاسعًا انتظر نشرة. */}
      <ReferenceDataManager module="fleet" embedded />

      {/* أهداف السيارات */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2"><Target className="w-4 h-4 text-[#f37121]" /> <p className="font-bold text-slate-900">{ar ? 'الهدف الشهري لكل سيارة' : 'Monthly target per vehicle'}</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head"><tr>
              <th className="px-4 py-2 text-start font-semibold">{ar ? 'اللوحة' : 'Plate'}</th>
              <th className="px-4 py-2 text-start font-semibold">{ar ? 'الاسم' : 'Name'}</th>
              <th className="px-4 py-2 text-start font-semibold">{ar ? 'الهدف الشهري' : 'Monthly target'}</th>
              <th className="px-4 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map((v) => (
                <tr key={v._id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono font-semibold flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-400" /> {v.plate}</td>
                  <td className="px-4 py-2 text-slate-600">{v.name || '—'}</td>
                  <td className="px-4 py-2"><input type="number" min={0} value={targets[v._id] ?? ''} onChange={(e) => setTargets((t) => ({ ...t, [v._id]: e.target.value }))} className="w-36 px-2 py-1.5 rounded-lg border border-slate-200 text-sm" /></td>
                  <td className="px-4 py-2"><button type="button" onClick={() => saveTarget(v._id)} disabled={savingV === v._id} className="px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-xs font-semibold disabled:opacity-60">{ar ? 'حفظ' : 'Save'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
