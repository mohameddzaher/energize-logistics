'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { BookOpen, Plus, Edit, Trash2, Eye } from 'lucide-react';
import {
  isFinanceStaff, isFinanceAdmin, ChartAccount, ACCOUNT_TYPE_STYLE, accountName, money, fmtDate,
} from '@/lib/finance';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Badge, Modal, Field, TextInput, TextArea, Select, ExportButton } from '@/components/hr/HRKit';
import { getAccountingAccountsTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const EMPTY = { code: '', nameEn: '', nameAr: '', type: 'asset', description: '' };

export default function ChartOfAccountsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getAccountingAccountsTranslations(lang);
  const [items, setItems] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeF, setTypeF] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ChartAccount | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState<{ account: ChartAccount; rows: any[]; closingBalance: number } | null>(null);

  const canDelete = isFinanceAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (typeF) qs.set('type', typeF);
      const d = await api.get<{ accounts: ChartAccount[] }>(`/api/accounting/accounts?${qs}`);
      setItems(d.accounts || []);
    } catch { /* */ }
    setLoading(false);
  }, [search, typeF]);
  useEffect(() => { load(); }, [load]);
  useSocket('accounting:account', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (a: ChartAccount) => { setEditing(a); setForm({ ...EMPTY, ...a }); setShowModal(true); };
  const save = async () => {
    if (!form.code.trim() || !form.nameEn.trim()) { notify(tx.codeAndNameRequired); return; }
    setSaving(true);
    try {
      if (editing) await api.put(`/api/accounting/accounts/${editing._id}`, form);
      else await api.post('/api/accounting/accounts', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const remove = async (a: ChartAccount) => {
    if (!(await confirm(`${tx.deletePrefix}${a.nameEn}${tx.deleteSuffix}`))) return;
    try { await api.delete(`/api/accounting/accounts/${a._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };
  const openLedger = async (a: ChartAccount) => {
    try { setLedger(await api.get(`/api/accounting/ledger/${a._id}`)); } catch (e: any) { notify(e.message, 'error'); }
  };
  const exportXlsx = () => {
    exportToExcel(items, [
      { header: tx.code, key: 'code', width: 14 },
      { header: tx.name, key: 'nameEn', width: 28, transform: (_v, r) => (ar && r.nameAr ? r.nameAr : r.nameEn) },
      { header: tx.type, key: 'type', width: 16, transform: (v) => (ar ? ACCOUNT_TYPE_STYLE[v]?.ar : ACCOUNT_TYPE_STYLE[v]?.en) || v },
    ], 'chart-of-accounts', tx.pageTitle);
  };

  if (!isFinanceStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<BookOpen className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${items.length}`}>
        <ExportButton onClick={exportXlsx} label={ar ? 'تصدير Excel' : 'Export Excel'} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newAccount}</PrimaryButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allTypes}</option>
          {TYPES.map((t) => <option key={t} value={t}>{ar ? ACCOUNT_TYPE_STYLE[t].ar : ACCOUNT_TYPE_STYLE[t].en}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start">
            <th className="px-4 py-3 text-slate-300 font-semibold">{tx.code}</th>
            <th className="px-4 py-3 text-slate-300 font-semibold">{tx.name}</th>
            <th className="px-4 py-3 text-slate-300 font-semibold">{tx.type}</th>
            <th className="px-4 py-3 text-slate-300 font-semibold text-end">{tx.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-800">—</td></tr> : items.map((a) => (
              <tr key={a._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-700 font-mono">{a.code}</td>
                <td className="px-4 py-3 text-slate-900">{ar && a.nameAr ? a.nameAr : a.nameEn}{a.system && <span className="ms-2 text-[10px] text-slate-700">({tx.systemLabel})</span>}</td>
                <td className="px-4 py-3"><Badge style={ACCOUNT_TYPE_STYLE[a.type]} lang={lang} /></td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  <button type="button" title={tx.ledger} onClick={() => openLedger(a)} className="text-slate-700 hover:text-slate-900"><Eye className="w-4 h-4" /></button>
                  <button type="button" title={tx.edit} onClick={() => openEdit(a)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>
                  {canDelete && !a.system && <button type="button" title={tx.delete} onClick={() => remove(a)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editAccount : tx.newAccount}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : tx.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.code}><TextInput value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" disabled={!!editing?.system} /></Field>
          <Field label={tx.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{ar ? ACCOUNT_TYPE_STYLE[t].ar : ACCOUNT_TYPE_STYLE[t].en}</option>)}
          </Select></Field>
          <Field label={tx.nameEn}><TextInput value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></Field>
          <Field label={tx.nameAr}><TextInput value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} dir="rtl" /></Field>
          <Field label={tx.description} span2><TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
      </Modal>

      {/* Ledger */}
      <Modal open={!!ledger} onClose={() => setLedger(null)} wide title={ledger ? `${tx.ledger} — ${accountName(ledger.account, lang)}` : ''}
        footer={<button type="button" onClick={() => setLedger(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.close}</button>}>
        {ledger && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
                <th className="px-2 py-2">{tx.date}</th><th className="px-2 py-2">#</th><th className="px-2 py-2">{tx.memo}</th>
                <th className="px-2 py-2 text-end">{tx.debit}</th><th className="px-2 py-2 text-end">{tx.credit}</th><th className="px-2 py-2 text-end">{tx.balance}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200">
                {ledger.rows.length === 0 ? <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-800">—</td></tr> : ledger.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2 text-slate-700">{fmtDate(r.date)}</td>
                    <td className="px-2 py-2 text-slate-800 font-mono text-xs">{r.entryNumber}</td>
                    <td className="px-2 py-2 text-slate-700">{r.memo || '—'}</td>
                    <td className="px-2 py-2 text-end text-green-600">{r.debit ? money(r.debit, '') : ''}</td>
                    <td className="px-2 py-2 text-end text-red-600">{r.credit ? money(r.credit, '') : ''}</td>
                    <td className="px-2 py-2 text-end text-slate-900">{money(r.balance, '')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-200"><td colSpan={5} className="px-2 py-2 text-end text-slate-800">{tx.closingBalance}</td><td className="px-2 py-2 text-end text-slate-900 font-bold">{money(ledger.closingBalance, '')}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
