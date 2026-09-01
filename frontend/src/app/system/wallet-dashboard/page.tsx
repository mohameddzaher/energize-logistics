'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Building2, Wallet, ArrowUpCircle, ArrowDownCircle, ShoppingCart,
  TrendingUp, Users, AlertTriangle, Calendar, CalendarRange,
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { useLanguage } from '@/context/LanguageContext';
import { getWalletDashboardTranslations, getWalletDashboardExtraTranslations } from '@/lib/translations';

interface BranchData {
  branch: { _id: string; name: string; code: string };
  // رصيدُ الفرع قبل بداية الفترة — به تُقرأ الحركاتُ على ما جرت عليه.
  openingBalance: number;
  // فرقُ الجرد داخل الفترة: يظهر حين يُثبَّت رصيدٌ يدويًّا فلا يقفل الميزانُ
  // بالحركات وحدَها. صفرٌ في الأحوال العاديّة.
  adjustment?: number;
  totalCollections: number;
  totalExpenses: number;
  totalPurchases: number;
  netMovement: number;
  closingBalance: number;
  activeWallets: number;
  closedWallets: number;
  totalExpectedCash: number;
  totalActualCash: number;
  totalDifference: number;
}

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type DateMode = 'single' | 'month' | 'range';

export default function WalletDashboardPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const T = getWalletDashboardTranslations(lang);
  const txx = getWalletDashboardExtraTranslations(lang);
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateMode, setDateMode] = useState<DateMode>('single');
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [dateFrom, setDateFrom] = useState(getTodayStr());
  const [dateTo, setDateTo] = useState(getTodayStr());
  // الشهرُ سؤالٌ يُطرح أكثرَ من المدى الحرّ: «كم حصّل الفرعُ هذا الشهر».
  // وكتابتُه مدًى من أوّله إلى آخره في كلّ مرّة عملٌ يتكرّر بلا داعٍ.
  const [month, setMonth] = useState(getTodayStr().slice(0, 7));
  const monthRange = (mk: string) => {
    const [y, mo] = mk.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { from: `${mk}-01`, to: `${mk}-${String(last).padStart(2, '0')}` };
  };

  const fetchDashboard = useCallback(async () => {
    try {
      let url: string;
      if (dateMode === 'range') {
        url = `/api/wallet/dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}`;
      } else if (dateMode === 'month') {
        const r = monthRange(month);
        url = `/api/wallet/dashboard?dateFrom=${r.from}&dateTo=${r.to}`;
      } else {
        url = `/api/wallet/dashboard?date=${selectedDate}`;
      }
      const data = await api.get<any>(url);
      setBranches(data.branches || []);
    } catch {}
    setLoading(false);
  }, [dateMode, selectedDate, dateFrom, dateTo, month]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleEvent = useCallback(() => fetchDashboard(), [fetchDashboard]);
  useSocket('wallet:transaction', handleEvent);
  useSocket('wallet:dayClosed', handleEvent);
  useSocket('wallet:dayReopened', handleEvent);
  // ── وحذفُ حركةٍ يغيّر الرصيدَ كما تغيّره إضافتُها ──────────────────────────
  // كانت اللوحةُ تسمع الإضافةَ والإقفالَ ولا تسمع الحذفَ ولا التصفير، فتبقى
  // تعرض مالًا أُزيل حتّى يُحدَّث المتصفّح بيدٍ.
  useSocket('wallet:transactionDeleted', handleEvent);
  useSocket('wallet:reset', handleEvent);

  const dateLabel = dateMode === 'range' ? `${dateFrom}_to_${dateTo}` : (dateMode === 'month' ? month : selectedDate);

  const exportColumns: ExportColumn[] = [
    { header: txx.colBranch, key: 'branch.name', width: 20 },
    { header: txx.colBranchCode, key: 'branch.code', width: 12 },
    { header: txx.colCollections, key: 'totalCollections', transform: fmt.money, width: 18 },
    { header: txx.colExpenses, key: 'totalExpenses', transform: fmt.money, width: 18 },
    { header: txx.colPurchases, key: 'totalPurchases', transform: fmt.money, width: 18 },
    { header: txx.colNetMovement, key: 'netMovement', transform: fmt.money, width: 18 },
    { header: txx.colClosingBalance, key: 'closingBalance', transform: fmt.money, width: 20 },
    { header: txx.colActiveWallets, key: 'activeWallets', width: 14 },
  ];
  // اليومُ أو المدى ليس فلترًا على صفوفٍ نملكها، بل هو التقرير نفسه: الخادم
  // يحسب الأرقام لتلك الفترة وحدها ويعيد كلَّ الفروع. فلا معنى لنطاقٍ ثانٍ —
  // اسمُ الملفّ يحمل الفترةَ حتّى لا يختلط ملفُّ يومٍ بملفِّ آخر.
  const scope = exportScopeLabels(lang === 'ar');
  const exportOptions = [
    { key: 'all', label: scope.all, sheets: [{ name: 'Branches', rows: branches as unknown as Record<string, any>[], columns: exportColumns }] },
  ];

  const totals = branches.reduce((acc, b) => ({
    opening: acc.opening + (b.openingBalance || 0),
    collections: acc.collections + b.totalCollections,
    expenses: acc.expenses + b.totalExpenses,
    purchases: acc.purchases + b.totalPurchases,
    net: acc.net + b.netMovement,
    adjustment: acc.adjustment + (b.adjustment || 0),
    closing: acc.closing + (b.closingBalance || 0),
    wallets: acc.wallets + b.activeWallets,
  }), { opening: 0, collections: 0, expenses: 0, purchases: 0, net: 0, adjustment: 0, closing: 0, wallets: 0 });
  const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  const buildBranchLink = (branchId: string) => {
    if (dateMode === 'range') {
      return `/system/wallet-dashboard/branch/${branchId}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    }
    return `/system/wallet-dashboard/branch/${branchId}?date=${selectedDate}`;
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-[#f37121]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{T.walletDashboard}</h1>
            <p className="text-slate-500 text-sm">{T.allBranchesOverview}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Date Mode Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-slate-200">
            <button type="button" onClick={() => setDateMode('single')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'single' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
              <Calendar className="w-3.5 h-3.5" /> {T.day}
            </button>
            <button type="button" onClick={() => setDateMode('month')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'month' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
              <CalendarRange className="w-3.5 h-3.5" /> {lang === 'ar' ? 'شهر' : 'Month'}
            </button>
            <button type="button" onClick={() => setDateMode('range')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${dateMode === 'range' ? 'bg-[#f37121] text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>
              <CalendarRange className="w-3.5 h-3.5" /> {T.range}
            </button>
          </div>

          {dateMode === 'single' ? (
            <>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.selectDate} />
              <button type="button" onClick={() => setSelectedDate(getTodayStr())}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{T.today}</button>
            </>
          ) : dateMode === 'month' ? (
            <>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
                aria-label={lang === 'ar' ? 'اختر الشهر' : 'Pick month'} />
              <button type="button" onClick={() => setMonth(getTodayStr().slice(0, 7))}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">
                {lang === 'ar' ? 'هذا الشهر' : 'This month'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                {/* «من» و«إلى» خارجَ الخانة — راجع DateRangeFilter. */}
                <span className="text-[12px] font-bold text-slate-600">{lang === 'ar' ? 'من' : 'From'}</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.fromDate} />
                <span className="text-[12px] font-bold text-slate-600">{lang === 'ar' ? 'إلى' : 'To'}</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" aria-label={txx.toDate} />
              </div>
              <button type="button" onClick={() => { setDateFrom(getTodayStr()); setDateTo(getTodayStr()); }}
                className="px-3 py-2 rounded-lg bg-slate-100 text-[#f37121] text-sm font-medium hover:bg-slate-200 transition-colors">{T.today}</button>
            </>
          )}

          <ExportMenu fileName={`Wallet_Dashboard_${dateLabel}`} lang={lang === 'ar' ? 'ar' : 'en'} label={T.export} options={exportOptions} />
        </div>
      </div>

      {/* Date Range Indicator */}
      {dateMode === 'range' && (
        <div className="bg-[#f37121]/10 border border-[#f37121]/30 rounded-lg px-4 py-2 text-sm text-[#f37121] flex items-center gap-2">
          <CalendarRange className="w-4 h-4" />
          {T.showingData} <span className="font-medium">{dateFrom}</span> {T.to} <span className="font-medium">{dateTo}</span>
        </div>
      )}

      {/* ── الميزانُ يُقرأ من اليسار إلى اليمين ──────────────────────────────
          افتتاحيٌّ + تحصيلاتٌ − مصروفاتٌ − مشترياتٌ = ختاميّ. وبلا الافتتاحيّ
          تُقرأ الحركاتُ بلا ما جرت عليه: «حصّلنا كذا» بلا «من كم بدأنا».
          والبطاقاتُ مرتّبةٌ على هذا الترتيب فتُقرأ كسطرِ حساب. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-4">
        <div className="min-w-0 bg-white border border-slate-300 rounded-xl p-4 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-slate-500" />
            <p className="text-slate-500 text-xs truncate">{lang === 'ar' ? 'الرصيد الافتتاحي' : 'Opening balance'}</p></div>
          <p className={`text-lg xl:text-xl font-bold tabular-nums truncate ${totals.opening >= 0 ? 'text-slate-900' : 'text-red-600'}`}
            title={`${money(totals.opening).toLocaleString()} SAR`}>{money(totals.opening).toLocaleString()} SAR</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {lang === 'ar' ? 'قبل بداية الفترة' : 'before the period starts'}
          </p>
        </div>
        <div className="min-w-0 bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 mb-2"><ArrowUpCircle className="w-4 h-4 text-green-600" /><p className="text-slate-500 text-xs truncate">{T.totalCollections}</p></div>
          <p className="text-xl font-bold text-green-600">{totals.collections.toLocaleString()} SAR</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><ArrowDownCircle className="w-4 h-4 text-red-600" /><p className="text-slate-500 text-xs">{T.totalExpenses}</p></div>
          <p className="text-xl font-bold text-red-600">{totals.expenses.toLocaleString()} SAR</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><ShoppingCart className="w-4 h-4 text-blue-600" /><p className="text-slate-500 text-xs">{T.totalPurchases}</p></div>
          <p className="text-xl font-bold text-blue-600">{totals.purchases.toLocaleString()} SAR</p>
        </div>
        <div className="bg-white border border-[#f37121]/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-[#f37121]" /><p className="text-slate-500 text-xs">{T.netMovement}</p></div>
          <p className={`text-xl font-bold ${totals.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{totals.net.toLocaleString()} SAR</p>
        </div>
        {/* تسويةُ الجرد: تظهر حين تكون، وتُخفى حين لا تكون — الصفرُ لا يُعرض
            لئلّا يُقرأ بندًا قائمًا في كلّ فترة. */}
        {Math.abs(totals.adjustment) > 0.01 && (
          <div className="min-w-0 bg-white border border-amber-400/40 rounded-xl p-4 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-amber-600" />
              <p className="text-slate-500 text-xs truncate">{lang === 'ar' ? 'تسوية جرد' : 'Stock-take adj.'}</p></div>
            <p className="text-lg xl:text-xl font-bold tabular-nums text-amber-700 truncate">{money(totals.adjustment).toLocaleString()} SAR</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {lang === 'ar' ? 'رصيدٌ ثُبِّت يدويًّا داخل الفترة' : 'balance set manually in the period'}
            </p>
          </div>
        )}
        <div className="min-w-0 bg-white border border-yellow-500/30 rounded-xl p-4 overflow-hidden">
          <div className="flex items-center gap-2 mb-2"><Wallet className="w-4 h-4 text-yellow-700" /><p className="text-slate-500 text-xs truncate">{T.closingBalance}</p></div>
          <p className="text-lg xl:text-xl font-bold tabular-nums text-yellow-700 truncate"
            title={`${money(totals.closing).toLocaleString()} SAR`}>{money(totals.closing).toLocaleString()} SAR</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-slate-500" /><p className="text-slate-500 text-xs">{T.activeWallets}</p></div>
          <p className="text-xl font-bold text-slate-900">{totals.wallets}</p>
        </div>
      </div>

      {/* Branch Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {branches.length === 0 ? (
          <div className="col-span-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
            <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">{T.noBranches}</p>
          </div>
        ) : branches.map((b) => (
          <button key={b.branch._id} type="button"
            onClick={() => router.push(buildBranchLink(b.branch._id))}
            className="bg-white border border-slate-200 rounded-xl p-5 text-start hover:border-[#f37121]/50 hover:bg-slate-50 transition-all group shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#f37121]" />
                <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-bold mb-3">{b.branch.name}</h3>
              </div>
              {b.branch.code && <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{b.branch.code}</span>}
            </div>
            <div className="space-y-2 text-sm">
              {/* بطاقةُ الفرع تُقرأ كسطر حساب: من كم بدأ، وما جرى، وإلامَ انتهى. */}
              <div className="flex justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-500">{lang === 'ar' ? 'الافتتاحي' : 'Opening'}</span>
                <span className={`font-medium tabular-nums ${(b.openingBalance || 0) >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                  {money(b.openingBalance || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{T.collections}</span>
                <span className="text-green-600 font-medium">+{b.totalCollections.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{T.expenses}</span>
                <span className="text-red-600 font-medium">-{b.totalExpenses.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{T.purchases}</span>
                <span className="text-blue-600 font-medium">-{b.totalPurchases.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200">
                <span className="text-slate-700 font-medium">{T.net}</span>
                <span className={`font-bold ${b.netMovement >= 0 ? 'text-green-600' : 'text-red-600'}`}>{b.netMovement.toLocaleString()} SAR</span>
              </div>
              {!!b.adjustment && Math.abs(b.adjustment) > 0.01 && (
                <div className="flex justify-between">
                  <span className="text-amber-600" title={lang === 'ar' ? 'رصيدٌ ثُبِّت يدويًّا داخل الفترة' : 'balance set manually in the period'}>
                    {lang === 'ar' ? 'تسوية جرد' : 'Adjustment'}
                  </span>
                  <span className="font-medium tabular-nums text-amber-700">{money(b.adjustment).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-yellow-700 font-medium">{T.closingBalance}</span>
                <span className="font-bold tabular-nums text-yellow-700">{money(b.closingBalance || 0).toLocaleString()} SAR</span>
              </div>
              {b.closedWallets > 0 && b.totalDifference !== 0 && (
                <div className="flex justify-between pt-2 border-t border-slate-200">
                  <span className={`font-medium ${b.totalDifference > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {b.totalDifference > 0 ? T.deficit : T.surplus}
                  </span>
                  <span className={`font-bold ${b.totalDifference > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {b.totalDifference > 0 ? '-' : '+'}{Math.abs(b.totalDifference).toLocaleString()} SAR
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
              <Users className="w-3 h-3" /> {b.activeWallets} {b.activeWallets !== 1 ? T.activeWalletPlural : T.activeWallet}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
