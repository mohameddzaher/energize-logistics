'use client';
/**
 * لوحة طلبات الشحنات — أوّلُ صفحةِ القسم.
 *
 * ── لماذا لوحةٌ أوّلًا ───────────────────────────────────────────────────────
 * كان القسمُ يُفتَح على جدول سبعةٍ وثلاثين ألف شحنة. ومن يفتح قسمًا يسأل أوّلًا
 * «كيف حالُه اليوم؟» لا «أرني الصفَّ الأوّل». فهذه لوحتُه: شحناتُ اليوم
 * والشهر، وأين تقف كلُّ واحدة، وربحُ الشهر، والسجلُّ الذي يُحمَّل منه — ومن
 * يحمل أكثرَ العمل.
 *
 * ── وكلُّ رقمٍ يُفتَح ────────────────────────────────────────────────────────
 * الرقمُ الذي لا يؤدّي إلى صفوفه نصفُ جواب: يُقرأ «أربعَ عشرةَ متأخّرة» ثمّ
 * يُبحَث عنها في الجدول باليد. فكلُّ بطاقةٍ هنا رابطٌ إلى الشحنات نفسِها
 * بفلترها في العنوان — راجع رأسَ صفحة الشحنات.
 *
 * ولا نقطةَ جديدةً في الخادم: اللوحةُ تُركَّب من `analytics` و`fleet-summary`
 * و`orders` — فما يُحسَب للتحليلات يُحسَب لها، ولا يختلف رقمان لشيءٍ واحد.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, ErrorNotice } from '@/components/hr/HRKit';
import { statusLabel, vocabLabel, canEditOrders, type ShipmentOrder, type Lang } from '@/lib/shipmentOrders';
import { useOrderStatuses } from '@/hooks/useOrderStatuses';
import { canAccessSection, permsOf } from '@/lib/sections';
import {
  LayoutDashboard, PackagePlus, PackageSearch, Truck, Users, Store, BarChart3,
  TrendingUp, TrendingDown, AlertTriangle, ArrowRight,
} from 'lucide-react';

interface Analytics {
  totals: {
    orders: number; live: number; cancelled: number; cancelRate: number;
    sell: number; buy: number; margin: number; marginPct: number; avgMargin: number; avgSell: number;
    customers: number; suppliers: number; routes: number; losing: number; missingPrice: number;
  };
  byStatus: Record<string, number>;
  byCustomer: { name: string; orders: number; sell: number; margin: number }[];
  bySupplier: { name: string; orders: number; sell: number; margin: number }[];
  byRoute: { name: string; orders: number; sell: number; margin: number }[];
  byMonth: { key: string; orders: number; sell: number; buy: number; margin: number }[];
}
interface FleetSummary {
  vehicles: number; suppliers: number; drivers: number;
  ours?: number; supplier?: number; unknown?: number;
  gaps?: { unknown: number; noBrand: number; supNoVehicle: number };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function ShipmentOrdersDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const statusVocab = useOrderStatuses();

  const [month, setMonth] = useState<Analytics | null>(null);
  const [today, setToday] = useState<Analytics | null>(null);
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [recent, setRecent] = useState<ShipmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // ── نداءٌ واحد ──────────────────────────────────────────────────────
      // كان أربعةً (تحليلاتُ الشهر واليوم والسجلُّ وآخرُ الشحنات). والخادمُ
      // يبنيها معًا ويقدّم القديمةَ بينما يجدّد، والهاتفُ يقرأ الردَّ نفسَه —
      // فلا يختلف رقمٌ بين شاشةٍ وشاشة، ولا يُحسَب الشيءُ مرّتين.
      const d = await api.get<{ month: Analytics; today: Analytics; fleet: FleetSummary; recent: ShipmentOrder[] }>(
        '/api/shipment-orders/dashboard');
      setMonth(d.month); setToday(d.today); setFleet(d.fleet); setRecent(d.recent || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('shipmentOrders:updated', useCallback(() => load(), [load]));
  useSocket('shipmentOrders:fleet', useCallback(() => load(), [load]));

  const money = (n: number) => (Number(n) || 0).toLocaleString(ar ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 });
  const LIST = '/system/shipment-orders';

  // ── الحالاتُ مرتَّبةً بالعدد: ما فيه عملٌ أوّلًا ──────────────────────────
  const statusCards = useMemo(() => {
    const by = month?.byStatus || {};
    return Object.entries(by)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => {
        const sv = statusVocab.find((x) => x.key === key) || null;
        return { key, n, label: sv ? vocabLabel(sv, lang as Lang) : statusLabel(key, lang as Lang) };
      });
  }, [month, statusVocab, lang]);

  // القراءةُ تكفي لرؤية اللوحة: مَن مُنح «عرض» على القسم يقرأ حالَه.
  if (!canEditOrders(user as any) && !canAccessSection(permsOf(user as any), 'Shipment Orders')) {
    return <div className="text-slate-500 p-8">{t('لا تملك صلاحية.', 'Not authorized.')}</div>;
  }
  if (loading && !month) return <Spinner />;

  const T = month?.totals;
  const D = today?.totals;
  const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  const link = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#f37121]/60 hover:shadow-md block';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<LayoutDashboard className="w-5 h-5" />}
        title={t('لوحة طلبات الشحنات', 'Shipment Orders Dashboard')}
        subtitle={t('حالُ القسم اليوم وهذا الشهر — وكلُّ رقمٍ يُفتَح على صفوفه',
                    'Today and this month — every number opens its rows')}>
        <Link href="/system/shipment-orders/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-bold hover:bg-[#d9601a]">
          <PackagePlus className="w-4 h-4" /> {t('شحنة جديدة', 'New shipment')}
        </Link>
        <Link href={LIST} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <PackageSearch className="w-4 h-4" /> {t('كل الشحنات', 'All shipments')}
        </Link>
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* ── اليومُ والشهر ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href={`${LIST}?from=${iso(new Date())}`} className={link}>
          <p className="text-2xl font-bold tabular-nums text-[#f37121]">{D?.orders ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5">{t('شحنات اليوم', 'Today')}</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('اضغط لعرضها', 'tap to open')}</p>
        </Link>
        <Link href={`${LIST}?from=${monthStart()}`} className={link}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{T?.orders ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5">{t('شحنات الشهر', 'This month')}</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('منها ملغاة', 'cancelled')}: {T?.cancelled ?? 0}</p>
        </Link>
        <div className={card}>
          <p className={`text-2xl font-bold tabular-nums ${(T?.margin ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {money(T?.margin ?? 0)}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">{t('ربح الشهر (ر.س)', 'Month margin (SAR)')}</p>
          <p className="text-[10px] text-slate-400 mt-1">
            {t('بيع', 'sell')} {money(T?.sell ?? 0)} · {t('شراء', 'buy')} {money(T?.buy ?? 0)} · {T?.marginPct ?? 0}%
          </p>
        </div>
        <div className={card}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{money(T?.avgMargin ?? 0)}</p>
          <p className="text-xs text-slate-600 mt-0.5">{t('متوسط ربح الشحنة', 'Avg margin / load')}</p>
          <p className="text-[10px] text-slate-400 mt-1">
            {t('متوسط البيع', 'avg sell')} {money(T?.avgSell ?? 0)}
          </p>
        </div>
      </div>

      {/* ── ما يحتاج تصرُّفًا ────────────────────────────────────────────────
          الخسرانةُ والتي بلا سعر: رقمان لا يُقرآن في جدولٍ طويل، وكلٌّ منهما
          قرارٌ مؤجَّل. */}
      {!!T && (T.losing > 0 || T.missingPrice > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {T.losing > 0 && (
            <Link href="/system/shipment-orders/analytics" className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3 hover:border-red-400">
              <TrendingDown className="w-5 h-5 text-red-600 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-red-800">{T.losing} {t('شحنة بخسارة هذا الشهر', 'loss-making loads this month')}</p>
                <p className="text-[11px] text-red-700">{t('البيع أقلُّ من الشراء — تُراجَع في التحليلات', 'sold below cost — review in analytics')}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-red-400 ms-auto shrink-0" />
            </Link>
          )}
          {T.missingPrice > 0 && (
            <Link href={`${LIST}?from=${monthStart()}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3 hover:border-amber-400">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-amber-900">{T.missingPrice} {t('شحنة بلا سعر', 'loads with no price')}</p>
                <p className="text-[11px] text-amber-800">{t('لا تدخل حسابَ الربح حتى يُكتب سعرُها', 'excluded from margin until priced')}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-400 ms-auto shrink-0" />
            </Link>
          )}
        </div>
      )}

      {/* ── أين تقف شحناتُ الشهر ─────────────────────────────────────────────
          كلُّ حالةٍ بطاقةٌ تؤدّي إلى صفوفها بفلترها — لا إلى أوّل الجدول. */}
      {statusCards.length > 0 && (
        <div className={card}>
          <p className="font-bold text-slate-900 text-sm mb-3">{t('أين تقف شحنات الشهر', 'Where this month stands')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {statusCards.map((s) => (
              <Link key={s.key} href={`${LIST}?status=${encodeURIComponent(s.key)}&from=${monthStart()}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center hover:border-[#f37121] hover:bg-white transition">
                <p className="text-xl font-bold tabular-nums text-slate-900">{s.n}</p>
                <p className="text-[11px] text-slate-600 mt-0.5 truncate" title={s.label}>{s.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── السجلُّ الذي يُحمَّل منه ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/system/shipment-orders/fleet" className={link}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{fleet?.suppliers ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5 inline-flex items-center gap-1"><Store className="w-3.5 h-3.5" /> {t('مورّد', 'Suppliers')}</p>
        </Link>
        <Link href="/system/shipment-orders/fleet" className={link}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{fleet?.vehicles ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5 inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> {t('شاحنة في السجلّ', 'Trucks on file')}</p>
          {fleet?.gaps?.unknown ? (
            <p className="text-[10px] text-amber-700 mt-1">{t('مجهولة المالك', 'owner unknown')}: {fleet.gaps.unknown}</p>
          ) : null}
        </Link>
        <Link href="/system/shipment-orders/fleet" className={link}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{fleet?.drivers ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t('سائق', 'Drivers')}</p>
        </Link>
        <Link href="/system/shipment-orders/customers" className={link}>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{T?.customers ?? 0}</p>
          <p className="text-xs text-slate-600 mt-0.5 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t('عميل عمل هذا الشهر', 'Customers this month')}</p>
          <p className="text-[10px] text-slate-400 mt-1">{t('مسارات', 'routes')}: {T?.routes ?? 0}</p>
        </Link>
      </div>

      {/* ── مَن يحمل العمل: العملاءُ والموردون والمسارات ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {([
          [t('أكبر العملاء', 'Top customers'), month?.byCustomer || [], '/system/shipment-orders/customers'],
          [t('أكبر الموردين', 'Top suppliers'), month?.bySupplier || [], '/system/shipment-orders/fleet'],
          [t('أكثر المسارات', 'Top routes'), month?.byRoute || [], '/system/shipment-orders/analytics'],
        ] as [string, { name: string; orders: number; margin: number }[], string][]).map(([title, rows, href]) => (
          <div key={title} className={card}>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-[#f37121]" />
              <p className="font-bold text-slate-900 text-sm">{title}</p>
              <Link href={href} className="ms-auto text-[11px] text-[#f37121] hover:underline">{t('الكل', 'all')}</Link>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">{t('لا بيانات هذا الشهر', 'nothing this month')}</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.slice(0, 6).map((r) => (
                  <li key={r.name} className="flex items-center gap-2 text-[13px]">
                    <span className="flex-1 min-w-0 truncate text-slate-800" title={r.name}>{r.name}</span>
                    <span className="tabular-nums text-slate-500">{r.orders}</span>
                    <span className={`tabular-nums font-semibold ${r.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {money(r.margin)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* ── اتّجاهُ الأشهر: شريطٌ لكلّ شهرٍ بربحه ───────────────────────────── */}
      {(month?.byMonth || []).length > 1 && (
        <div className={card}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#f37121]" />
            <p className="font-bold text-slate-900 text-sm">{t('الأشهر الأخيرة', 'Recent months')}</p>
          </div>
          <div className="flex items-end gap-2 h-32">
            {month!.byMonth.slice(-12).map((b) => {
              const max = Math.max(...month!.byMonth.slice(-12).map((x) => Math.abs(x.margin)), 1);
              const h = Math.max(4, Math.round((Math.abs(b.margin) / max) * 100));
              return (
                <div key={b.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                  <span className="text-[10px] tabular-nums text-slate-500">{money(b.margin)}</span>
                  <div className={`w-full rounded-t ${b.margin >= 0 ? 'bg-[#f37121]/70' : 'bg-red-400'}`} style={{ height: `${h}%` }} />
                  <span className="text-[10px] text-slate-500 truncate w-full text-center" dir="ltr">{b.key}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── آخرُ ما سُجِّل ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <PackageSearch className="w-4 h-4 text-[#f37121]" />
          <p className="font-bold text-slate-900 text-sm">{t('آخر الشحنات', 'Latest shipments')}</p>
          <Link href={LIST} className="ms-auto text-[11px] text-[#f37121] hover:underline">{t('كل الشحنات', 'all')}</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {recent.length === 0 && <li className="px-4 py-8 text-center text-slate-400 text-sm">{t('لا شحنات بعد', 'nothing yet')}</li>}
          {recent.map((o) => (
            <li key={o._id}>
              <Link href={`/system/shipment-orders/new?id=${o._id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-slate-50">
                <span className="font-mono font-bold text-slate-900 text-sm">{(o as any).reference || o.waybillNumber}</span>
                <span className="text-[13px] text-slate-800 flex-1 min-w-0 truncate">{o.customerName || '—'}</span>
                <span className="text-xs text-slate-600 whitespace-nowrap">{o.fromCity || '—'} ← <b>{o.toCity || '—'}</b></span>
                <span className="text-xs text-slate-500 font-mono" dir="ltr">{(o as any).vehiclePlate || ''}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                  {(() => {
                    const sv = statusVocab.find((x) => x.key === o.status) || null;
                    return sv ? vocabLabel(sv, lang as Lang) : statusLabel(o.status, lang as Lang);
                  })()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
