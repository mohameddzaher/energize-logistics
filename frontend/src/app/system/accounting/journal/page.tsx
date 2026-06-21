'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { FileText, Plus, Trash2, RefreshCw, X } from 'lucide-react';
import {
  isFinanceStaff, isFinanceAdmin, ChartAccount, JournalEntry, accountName, money, fmtDate, today,
} from '@/lib/finance';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select } from '@/components/hr/HRKit';

const emptyLine = () => ({ account: '', debit: '', credit: '', description: '' });

export default function JournalPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
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
    if (!balanced) { alert(ar ? 'القيد غير متوازن' : 'Entry is not balanced'); return; }
    setSaving(true);
    try {
      const lines = form.lines.filter((l) => l.account && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description }));
      await api.post('/api/accounting/journal', { date: form.date, memo: form.memo, lines });
      setShowModal(false); load();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  };
  const remove = async (e: JournalEntry) => {
    if (!confirm(ar ? 'حذف القيد؟' : 'Delete entry?')) return;
    try { await api.delete(`/api/accounting/journal/${e._id}`); load(); } catch (er: any) { alert(er.message); }
  };
  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post<{ message: string }>('/api/accounting/sync'); alert(r.message); load(); }
    catch (e: any) { alert(e.message); } finally { setSyncing(false); }
  };

  if (!isFinanceStaff(user?.role)) return <div className="text-slate-500 p-8">{ar ? 'لا تملك صلاحية' : 'Not authorized'}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FileText className="w-5 h-5" />} title={ar ? 'القيود اليومية' : 'Journal'} subtitle={`${entries.length}`}>
        <button type="button" onClick={sync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {ar ? 'ترحيل تلقائي' : 'Auto-post'}
        </button>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'قيد جديد' : 'New Entry'}</PrimaryButton>
      </PageHeader>

      <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث...' : 'Search...'} />

      <div className="space-y-3">
        {entries.length === 0 ? <div className="bg-white border border-slate-200 rounded-xl py-10 text-center text-slate-500 shadow-sm">—</div> : entries.map((e) => (
          <div key={e._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-mono text-xs">{e.entryNumber}</span>
                <span className="text-slate-900 text-sm font-medium">{e.memo || '—'}</span>
                {e.source?.auto && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600">{ar ? 'تلقائي' : 'auto'} · {e.source.type}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-500 text-xs">{fmtDate(e.date)}</span>
                {canDelete && <button type="button" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(e)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i} className="text-slate-700">
                    <td className="py-1">{accountName(l.account, lang)}</td>
                    <td className="py-1 text-right text-green-600 w-28">{l.debit ? money(l.debit, '') : ''}</td>
                    <td className="py-1 text-right text-red-600 w-28">{l.credit ? money(l.credit, '') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide title={ar ? 'قيد يومية جديد' : 'New Journal Entry'}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !balanced}>{saving ? '...' : (ar ? 'حفظ' : 'Post')}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={ar ? 'التاريخ' : 'Date'}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={ar ? 'البيان' : 'Memo'}><TextInput value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
        </div>
        <div className="mt-2 space-y-2">
          {form.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
                <option value="">{ar ? 'اختر حساب' : 'Account'}</option>
                {accounts.map((a) => <option key={a._id} value={a._id}>{a.code} · {ar && a.nameAr ? a.nameAr : a.nameEn}</option>)}
              </select>
              <input type="number" placeholder={ar ? 'مدين' : 'Debit'} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <input type="number" placeholder={ar ? 'دائن' : 'Credit'} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} className="w-24 px-2 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm" dir="ltr" />
              <button type="button" title={ar ? 'حذف السطر' : 'Remove line'} onClick={() => removeLine(i)} className="text-red-600 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addLine} className="text-[#f37121] text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {ar ? 'إضافة سطر' : 'Add line'}</button>
          <div className={`flex justify-end gap-6 text-sm pt-2 border-t border-slate-200 ${balanced ? 'text-green-600' : 'text-red-600'}`}>
            <span>{ar ? 'مدين' : 'Debit'}: {money(totalDebit, '')}</span>
            <span>{ar ? 'دائن' : 'Credit'}: {money(totalCredit, '')}</span>
            <span>{balanced ? (ar ? '✓ متوازن' : '✓ Balanced') : (ar ? '✗ غير متوازن' : '✗ Not balanced')}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
