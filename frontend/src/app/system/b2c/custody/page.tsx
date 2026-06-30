'use client';
// B2C custody (عهدة) wallets. Self-contained, additive — does not touch the rest
// of B2C. Project managers see/record/edit/delete their OWN movements; managers
// (head / admin / super_admin) grant custody to any PM and audit every wallet,
// with dynamic date-range + search filters and period totals.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Wallet, Plus, ArrowDownCircle, ArrowUpCircle, Edit, Trash2, Check, Loader2, Users, X, Search } from 'lucide-react';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, TextArea, Select, StatCard } from '@/components/hr/HRKit';

const MANAGER_ROLES = ['super_admin', 'admin', 'b2c_head'];
type Entry = Record<string, any>;
type Manager = Record<string, any>;
type Wallet2 = { entries: Entry[]; balance: number; totalIn: number; totalOut: number; periodIn: number; periodOut: number; periodBalance: number; filtered: boolean };

const METHODS = [
  { value: 'cash', en: 'Cash', ar: 'كاش' },
  { value: 'bank_transfer', en: 'Bank transfer', ar: 'تحويل بنكي' },
  { value: 'other', en: 'Other', ar: 'أخرى' },
];
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const personName = (p?: any) => p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : '—';
const fmt = (v?: string, lang: 'en' | 'ar' = 'en') => v ? new Date(v).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const firstOfMonth = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function B2CCustodyPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const isManager = MANAGER_ROLES.includes(user?.role || '');
  const SAR = t('SAR', 'ريال');

  const [loaded, setLoaded] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedPM, setSelectedPM] = useState<string>('');
  const [wallet, setWallet] = useState<Wallet2 | null>(null);

  // wallet filters
  const [wFrom, setWFrom] = useState('');
  const [wTo, setWTo] = useState('');
  const [wSearch, setWSearch] = useState('');
  const [wDebounced, setWDebounced] = useState('');

  const [modal, setModal] = useState<null | 'in' | 'out' | 'grant'>(null);
  const [editId, setEditId] = useState<string>('');
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { const x = setTimeout(() => setWDebounced(wSearch.trim()), 350); return () => clearTimeout(x); }, [wSearch]);

  const loadManagers = useCallback(async () => {
    if (!isManager) return;
    try { const d = await api.get<{ managers: Manager[] }>('/api/b2c-wallet/managers'); setManagers(d.managers || []); } catch { /* */ }
  }, [isManager]);

  const loadWallet = useCallback(async () => {
    if (isManager && !selectedPM) { setWallet(null); setLoaded(true); return; }
    const url = isManager ? `/api/b2c-wallet/${selectedPM}` : '/api/b2c-wallet/me';
    const qs = new URLSearchParams();
    if (wFrom) qs.set('date_from', wFrom);
    if (wTo) qs.set('date_to', wTo);
    if (wDebounced) qs.set('search', wDebounced);
    try { setWallet(await api.get<Wallet2>(`${url}?${qs.toString()}`)); } catch { /* keep last */ }
    setLoaded(true);
  }, [isManager, selectedPM, wFrom, wTo, wDebounced]);

  useEffect(() => { loadManagers(); }, [loadManagers]);
  useEffect(() => { loadWallet(); }, [loadWallet]);

  const reload = useCallback(() => { loadManagers(); loadWallet(); }, [loadManagers, loadWallet]);
  useSocket('b2c:wallet', reload);

  const closeModal = () => { setModal(null); setEditId(''); };
  const openRecord = (dir: 'in' | 'out') => { setEditId(''); setForm({ amount: '', method: 'cash', reason: '' }); setErr(''); setModal(dir); };
  const openGrant = () => { setEditId(''); setForm({ projectManager: selectedPM || '', amount: '', method: 'bank_transfer', reason: '' }); setErr(''); setModal('grant'); };
  const openEdit = (e: Entry) => { setEditId(e._id); setForm({ amount: String(e.amount), method: e.method || 'cash', reason: e.reason || '' }); setErr(''); setModal(e.direction); };

  const save = async () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr(t('Enter a valid amount', 'أدخل مبلغ صحيح')); return; }
    if (modal === 'grant' && !editId && !form.projectManager) { setErr(t('Select a project manager', 'اختر مدير المشروع')); return; }
    setSaving(true); setErr('');
    try {
      const body: any = { amount: amt, reason: form.reason };
      if (modal === 'grant') { body.direction = 'in'; body.method = form.method; }
      else { body.direction = modal; if (modal === 'in') body.method = form.method; }
      if (editId) {
        await api.patch(`/api/b2c-wallet/${editId}`, body);
      } else {
        if (modal === 'grant') body.projectManager = form.projectManager;
        await api.post('/api/b2c-wallet', body);
      }
      closeModal(); reload();
    } catch (e: any) { setErr(e?.message || t('Failed', 'فشل')); }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!confirm(t('Delete this entry?', 'حذف هذه الحركة؟'))) return;
    try { await api.delete(`/api/b2c-wallet/${id}`); reload(); } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const mine = (e: Entry) => isManager || String(e.createdBy?._id || '') === String(user?._id || '');
  const setRange = (from: string, to: string) => { setWFrom(from); setWTo(to); };
  const anyFilter = !!(wFrom || wTo || wDebounced);

  if (!isManager && user?.role !== 'b2c_project_manager') return <div className="text-slate-500 p-8">{t('Not authorized', 'لا تملك صلاحية')}</div>;
  if (!loaded) return <Spinner />;

  const selectedManager = managers.find((m) => String(m._id) === selectedPM);
  const showWallet = wallet && (!isManager || selectedPM);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wallet className="w-5 h-5" />} title={t('Custody Wallets', 'العهدة')} subtitle={isManager ? t('Grant & audit project-manager custody', 'منح ومتابعة عهد مديري المشاريع') : t('Your custody wallet', 'محفظة العهدة الخاصة بك')}>
        {isManager
          ? <PrimaryButton onClick={openGrant}><Plus className="w-4 h-4" /> {t('Grant custody', 'منح عهدة')}</PrimaryButton>
          : <>
              <button type="button" onClick={() => openRecord('in')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"><ArrowDownCircle className="w-4 h-4" /> {t('Record received', 'سجّل استلام')}</button>
              <button type="button" onClick={() => openRecord('out')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700"><ArrowUpCircle className="w-4 h-4" /> {t('Record spent', 'سجّل صرف')}</button>
            </>}
      </PageHeader>

      {/* Manager: all PMs with balances */}
      {isManager && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-[#f37121]" /> {t('Project Managers', 'مديرو المشاريع')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {managers.map((m) => (
              <button key={m._id} type="button" onClick={() => setSelectedPM(String(m._id))}
                className={`text-start bg-white border rounded-xl p-4 shadow-sm transition-all ${selectedPM === String(m._id) ? 'border-[#f37121] ring-1 ring-[#f37121]/30' : 'border-slate-200 hover:border-[#f37121]/40'}`}>
                <p className="text-slate-900 font-semibold truncate">{personName(m)}</p>
                <p className={`text-xl font-bold mt-1 ${m.balance > 0 ? 'text-emerald-600' : m.balance < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{money(m.balance)} <span className="text-xs font-normal text-slate-400">{SAR}</span></p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t('In', 'وارد')} {money(m.totalIn)} · {t('Out', 'صادر')} {money(m.totalOut)}</p>
              </button>
            ))}
            {managers.length === 0 && <p className="text-slate-500 text-sm">{t('No project managers', 'لا يوجد مديرو مشاريع')}</p>}
          </div>
        </div>
      )}

      {showWallet && wallet && (
        <>
          {/* All-time balance */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label={t('Current balance', 'الرصيد الحالي')} value={`${money(wallet.balance)} ${SAR}`} accent={wallet.balance < 0 ? 'text-rose-600' : 'text-emerald-600'} />
            <StatCard label={t('Total received', 'إجمالي الوارد')} value={`${money(wallet.totalIn)} ${SAR}`} />
            <StatCard label={t('Total spent', 'إجمالي الصادر')} value={`${money(wallet.totalOut)} ${SAR}`} />
          </div>

          {/* Filters: presets + range + search */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-sm">
            {[
              { en: 'Today', ar: 'اليوم', from: ymd(new Date()), to: ymd(new Date()) },
              { en: 'This week', ar: 'هذا الأسبوع', from: addDays(-6), to: ymd(new Date()) },
              { en: 'This month', ar: 'هذا الشهر', from: firstOfMonth(), to: ymd(new Date()) },
              { en: 'All', ar: 'الكل', from: '', to: '' },
            ].map((p) => {
              const active = wFrom === p.from && wTo === p.to;
              return <button key={p.en} type="button" onClick={() => setRange(p.from, p.to)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{ar ? p.ar : p.en}</button>;
            })}
            <span className="mx-1 w-px h-5 bg-slate-200" />
            <label className="text-xs text-slate-500">{t('From', 'من')}</label>
            <input type="date" aria-label={t('From', 'من')} value={wFrom} onChange={(e) => setWFrom(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
            <label className="text-xs text-slate-500">{t('To', 'إلى')}</label>
            <input type="date" aria-label={t('To', 'إلى')} value={wTo} onChange={(e) => setWTo(e.target.value)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={wSearch} onChange={(e) => setWSearch(e.target.value)} placeholder={t('Search reason / note…', 'بحث في السبب / الملاحظة…')} className="w-full ps-9 pe-8 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" />
              {wSearch && <button type="button" aria-label={t('Clear search', 'مسح البحث')} onClick={() => setWSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>}
            </div>
            {anyFilter && <button type="button" onClick={() => { setWFrom(''); setWTo(''); setWSearch(''); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 text-xs"><X className="w-3.5 h-3.5" /> {t('Clear', 'مسح')}</button>}
          </div>

          {/* Period totals (only when a filter is active) */}
          {wallet.filtered && (
            <div className="bg-[#f37121]/5 border border-[#f37121]/20 rounded-xl p-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-500">{t('In the selected period', 'في الفترة المحددة')}:</span>
              <span className="text-emerald-700 font-semibold">{t('Received', 'استلام')} {money(wallet.periodIn)} {SAR}</span>
              <span className="text-rose-700 font-semibold">{t('Spent', 'صرف')} {money(wallet.periodOut)} {SAR}</span>
              <span className="text-slate-900 font-bold">{t('Net', 'الصافي')} {money(wallet.periodBalance)} {SAR}</span>
              <span className="text-slate-400">· {wallet.entries.length} {t('movements', 'حركة')}</span>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">{t('History', 'السجل')} {isManager && selectedManager ? `· ${personName(selectedManager)}` : ''}</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 text-slate-300">
                  {[t('Type', 'النوع'), t('Amount', 'المبلغ'), t('Method', 'الطريقة'), t('For / note', 'السبب'), t('By', 'بواسطة'), t('Date', 'التاريخ'), ''].map((h, i) => <th key={i} className="text-start font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(wallet.entries || []).length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-10">{t('No movements', 'لا توجد حركات')}</td></tr>
                ) : wallet.entries.map((e) => (
                  <tr key={e._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      {e.direction === 'in'
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 font-medium"><ArrowDownCircle className="w-4 h-4" /> {t('Received', 'استلام')}</span>
                        : <span className="inline-flex items-center gap-1 text-rose-700 font-medium"><ArrowUpCircle className="w-4 h-4" /> {t('Spent', 'صرف')}</span>}
                    </td>
                    <td className={`px-3 py-2.5 font-bold ${e.direction === 'in' ? 'text-emerald-700' : 'text-rose-700'}`}>{e.direction === 'in' ? '+' : '−'}{money(e.amount)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{e.method ? (ar ? METHODS.find((m) => m.value === e.method)?.ar : METHODS.find((m) => m.value === e.method)?.en) || e.method : '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700 max-w-[260px] truncate">{e.reason || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{personName(e.createdBy)}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{fmt(e.createdAt, lang)}</td>
                    <td className="px-3 py-2.5">
                      {mine(e) && (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => openEdit(e)} className="p-1 rounded text-slate-400 hover:text-[#f37121]" title={t('Edit', 'تعديل')}><Edit className="w-4 h-4" /></button>
                          <button type="button" onClick={() => remove(e._id)} className="p-1 rounded text-slate-400 hover:text-red-600" title={t('Delete', 'حذف')}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isManager && !selectedPM && <p className="text-slate-400 text-sm">{t('Select a project manager to view their custody history.', 'اختر مدير مشروع لعرض سجل عهدته.')}</p>}

      {/* Record / grant / edit modal */}
      <Modal open={!!modal} onClose={closeModal} title={editId ? t('Edit entry', 'تعديل حركة') : modal === 'grant' ? t('Grant custody', 'منح عهدة') : modal === 'in' ? t('Record received custody', 'تسجيل استلام عهدة') : t('Record spending', 'تسجيل صرف')}
        footer={<>
          <button type="button" onClick={closeModal} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('Cancel', 'إلغاء')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('Save', 'حفظ')}</PrimaryButton>
        </>}>
        {err && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-2">{err}</div>}
        <div className="space-y-3">
          {modal === 'grant' && !editId && (
            <Field label={t('Project manager', 'مدير المشروع')}>
              <Select value={form.projectManager || ''} onChange={(e) => setForm({ ...form, projectManager: e.target.value })}>
                <option value="">—</option>
                {managers.map((m) => <option key={m._id} value={m._id}>{personName(m)}</option>)}
              </Select>
            </Field>
          )}
          <Field label={`${t('Amount', 'المبلغ')} (${SAR})`}><TextInput type="number" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" /></Field>
          {(modal === 'grant' || modal === 'in') && (
            <Field label={t('Method', 'الطريقة')}>
              <Select value={form.method || 'cash'} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{ar ? m.ar : m.en}</option>)}
              </Select>
            </Field>
          )}
          <Field label={modal === 'out' ? t('What for? (e.g. field reps)', 'السبب؟ (مثلاً: للمناديب)') : t('Note (optional)', 'ملاحظة (اختياري)')}>
            <TextArea rows={2} value={form.reason || ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
