'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Trash2, RefreshCw, X } from 'lucide-react';
import {
  isFinanceStaff, isFinanceAdmin, ChartAccount, JournalEntry, accountName, money, fmtDate, today,
} from '@/lib/finance';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, ExportButton } from '@/components/hr/HRKit';
import { getAccountingJournalTranslations } from '@/lib/translations';
import { exportToExcel } from '@/utils/exportExcel';

const emptyLine = () => ({ account: '', debit: '', credit: '', description: '' });

export default function JournalPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getAccountingJournalTranslations(lang);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<{ date: string; memo: string; lines: any[] }>({ date: today(), memo: '', lines: [emptyLine(), emptyLine()] });

  const canDelete = isFinanceAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(); if (search.trim()) qs.set('q', search.trim());
      const d = await api.get<{ entries: JournalEntry[] }>(`/api/accounting/journal?${qs}`);
      setEntries(d.entries || []);
    } catch { /* */ }
    setLoading(false);
  }, [search]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ accounts: ChartAccount[] }>('/api/accounting/accounts').then((d) => setAccounts(d.accounts || [])).catch(() => {}); }, []);
  useSocket('accounting:journal', useCallback(() => load(), [load]));

  const totalDebit = form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const setLine = (i: number, patch: any) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const openCreate = () => { setForm({ date: today(), memo: '', lines: [emptyLine(), emptyLine()] }); setShowModal(true); };
  const save = async () => {
    if (!balanced) { notify(tx.entryNotBalanced); return; }
    setSaving(true);
    try {
      const lines = form.lines.filter((l) => l.account && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description }));
      await api.post('/api/accounting/journal', { date: form.date, memo: form.memo, lines });
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const remove = async (e: JournalEntry) => {
    if (!(await confirm(tx.deleteEntryConfirm))) return;
    try { await api.delete(`/api/accounting/journal/${e._id}`); load(); } catch (er: any) { notify(er.message, 'error'); }
  };
  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post<{ message: string }>('/api/accounting/sync'); notify(r.message); load(); }
    catch (e: any) { notify(e.message, 'error'); } finally { setSyncing(false); }
  };

  const handleExport = () => {
    const rows = entries.flatMap((e) => (e.lines || []).map((l) => ({
      entryNumber: e.entryNumber,
      date: e.date,
      memo: e.memo,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
    })));
    exportToExcel(rows, [
      { header: ar ? 'رقم القيد' : 'Entry #', key: 'entryNumber', width: 14 },
      { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: (v) => fmtDate(v), width: 14 },
      { header: ar ? 'البيان' : 'Memo', key: 'memo', transform: (v) => v || '', width: 28 },
      { header: ar ? 'الحساب' : 'Account', key: 'account', transform: (v) => accountName(v, lang), width: 28 },
      { header: tx.debit, key: 'debit', transform: (v) => v ? money(v, '') : '', width: 14 },
      { header: tx.credit, key: 'credit', transform: (v) => v ? money(v, '') : '', width: 14 },
    ], 'journal', ar ? 'دفتر اليومية' : 'Journal');
  };

  if (!isFinanceStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={tx.journal} subtitle={`${entries.length}`}>
        <button type="button" onClick={sync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {tx.autoPost}
        </button>
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={handleExport} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.newEntry}</PrimaryButton>
      </PageHeader>

      <SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} />

      <div className="space-y-3">
        {entries.length === 0 ? <div className="bg-white border border-slate-200 rounded-xl py-10 text-center text-slate-500 shadow-sm">—</div> : entries.map((e) => (
          <div key={e._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-mono text-xs">{e.entryNumber}</span>
                <span className="text-slate-900 text-sm font-medium">{e.memo || '—'}</span>
                {e.source?.auto && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600">{tx.auto} · {e.source.type}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-500 text-xs">{fmtDate(e.date)}</span>
                {canDelete && <button type="button" title={tx.delete} onClick={() => remove(e)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i} className="text-slate-700">
                    <td className="py-1">{accountName(l.account, lang)}</td>
                    <td className="py-1 text-end text-green-600 w-28">{l.debit ? money(l.debit, '') : ''}</td>
                    <td className="py-1 text-end text-red-600 w-28">{l.credit ? money(l.credit, '') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={tx.newJournalEntry}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving || !balanced}>{saving ? '...' : tx.post}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.date}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={tx.memo}><TextInput value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
        </div>
        <div className="mt-2 space-y-2">
          {form.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
                <option value="">{tx.account}</option>
                {accounts.map((a) => <option key={a._id} value={a._id}>{a.code} · {ar && a.nameAr ? a.nameAr : a.nameEn}</option>)}
              </select>
              <input type="number" placeholder={tx.debit} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <input type="number" placeholder={tx.credit} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <button type="button" title={tx.removeLine} onClick={() => removeLine(i)} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addLine} className="text-[#f37121] text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {tx.addLine}</button>
          <div className={`flex justify-end gap-6 text-sm pt-2 border-t border-slate-200 ${balanced ? 'text-green-600' : 'text-red-600'}`}>
            <span>{tx.debit}: {money(totalDebit, '')}</span>
            <span>{tx.credit}: {money(totalCredit, '')}</span>
            <span>{balanced ? tx.balancedMark : tx.notBalancedMark}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
