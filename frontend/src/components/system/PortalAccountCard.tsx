'use client';
// «إنشاء إيميل للعميل من البروفايل بتاعه».
//
// One card, dropped onto every customer/supplier profile page in every section.
// It asks the backend whether THIS register row already has a portal login and
// then either offers to create one (email + password) or shows the account with
// the actions that matter afterwards: reset the password, suspend it, delete it.
//
// The register key + row id are all it needs — see backend/config/partnerRegisters.js
// for the list of registers this works against.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import {
  KeyRound, Mail, ShieldCheck, ShieldOff, Trash2, Eye, EyeOff, Loader2, UserPlus, ExternalLink,
} from 'lucide-react';

export interface PartnerAccount {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isLocked: boolean;
  lastLogin?: string;
  accountType: 'customer' | 'vendor';
  partner?: { source: string; refId: string; name: string; kind: string };
  createdAt?: string;
}

const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

export default function PortalAccountCard({
  source, refId, name, compact,
}: {
  source: string;   // register key, e.g. 'fleet_customer'
  refId: string;    // that row's _id (or the folded name for the customs register)
  name?: string;    // display name, used to prefill the account name
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const { notify, confirm, prompt: askText } = useDialog();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [account, setAccount] = useState<PartnerAccount | null>(null);
  const [kind, setKind] = useState<'customer' | 'vendor'>('customer');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const canManage = !!user && ADMIN_ROLES.includes(user.role);

  const load = useCallback(async () => {
    if (!source || !refId) { setLoading(false); return; }
    try {
      const r = await api.get<{ account: PartnerAccount | null; register: { kind: 'customer' | 'vendor' } }>(
        `/api/partners/account?source=${encodeURIComponent(source)}&refId=${encodeURIComponent(refId)}`
      );
      setAccount(r.account);
      setKind(r.register?.kind || 'customer');
    } catch { setAccount(null); }
    setLoading(false);
  }, [source, refId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.email.trim() || form.password.length < 8) {
      notify(tx('Enter an email and a password of at least 8 characters', 'أدخل بريدًا إلكترونيًا وكلمة مرور لا تقل عن 8 أحرف'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ account: PartnerAccount; message: string }>('/api/partners/account', {
        source, refId, email: form.email.trim(), password: form.password, firstName: name,
      });
      setAccount(r.account);
      setOpenForm(false);
      setForm({ email: '', password: '' });
      notify(r.message || tx('Login created', 'تم إنشاء حساب الدخول'), 'success');
    } catch (e: any) {
      notify(e?.message || tx('Failed to create the login', 'تعذّر إنشاء الحساب'), 'error');
    }
    setBusy(false);
  };

  const resetPassword = async () => {
    if (!account) return;
    const pw = await askText({
      title: tx('Reset password', 'تغيير كلمة المرور'),
      message: tx('New password (min 8 characters)', 'كلمة المرور الجديدة (8 أحرف على الأقل)'),
      confirmLabel: tx('Reset', 'تغيير'),
    });
    if (!pw) return;
    if (pw.length < 8) { notify(tx('Password must be at least 8 characters', 'كلمة المرور 8 أحرف على الأقل'), 'error'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/partners/account/${account._id}`, { password: pw });
      notify(tx('Password reset — the partner is signed out of every device', 'تم تغيير كلمة المرور — تم إنهاء جلساته على كل الأجهزة'), 'success');
    } catch (e: any) { notify(e?.message || tx('Failed', 'فشل'), 'error'); }
    setBusy(false);
  };

  const toggleActive = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const r = await api.patch<{ account: PartnerAccount }>(`/api/partners/account/${account._id}`, { isActive: !account.isActive });
      setAccount(r.account);
      notify(r.account.isActive ? tx('Account enabled', 'تم تفعيل الحساب') : tx('Account suspended', 'تم إيقاف الحساب'), 'success');
    } catch (e: any) { notify(e?.message || tx('Failed', 'فشل'), 'error'); }
    setBusy(false);
  };

  const remove = async () => {
    if (!account) return;
    const ok = await confirm({
      title: tx('Delete this login?', 'حذف حساب الدخول؟'),
      message: tx('The customer record stays — only the login is removed.', 'سجل العميل يبقى كما هو — يُحذف حساب الدخول فقط.'),
      confirmLabel: tx('Delete', 'حذف'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/api/partners/account/${account._id}`);
      setAccount(null);
      notify(tx('Login deleted', 'تم حذف الحساب'), 'success');
    } catch (e: any) { notify(e?.message || tx('Failed', 'فشل'), 'error'); }
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-2 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        {tx('Checking portal access…', 'جارٍ التحقق من حساب البوابة…')}
      </div>
    );
  }

  const kindLabel = kind === 'vendor' ? tx('supplier', 'المورد') : tx('customer', 'العميل');

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">
            <KeyRound className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-slate-900 font-semibold text-sm">{tx('Portal access', 'حساب البوابة')}</h3>
            <p className="text-slate-400 text-[11px]">
              {tx(`A login lets this ${kind === 'vendor' ? 'supplier' : 'customer'} see their own shipments, waybills and invoices.`,
                `حساب دخول يتيح لهذا ${kindLabel} متابعة شحناته وبوالصه وفواتيره بنفسه.`)}
            </p>
          </div>
        </div>
        {account && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${account.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {account.isActive ? tx('Active', 'مفعّل') : tx('Suspended', 'موقوف')}
          </span>
        )}
      </div>

      {account ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Mail className="w-4 h-4 text-slate-400" />
            <span className="font-medium break-all">{account.email}</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {account.lastLogin
              ? `${tx('Last login', 'آخر دخول')}: ${new Date(account.lastLogin).toLocaleString()}`
              : tx('Has never signed in yet', 'لم يسجّل الدخول بعد')}
          </p>
          {canManage && !compact && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={busy} onClick={resetPassword} className="inline-flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <KeyRound className="w-3.5 h-3.5" />{tx('Reset password', 'تغيير كلمة المرور')}
              </button>
              <button type="button" disabled={busy} onClick={toggleActive} className="inline-flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {account.isActive ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {account.isActive ? tx('Suspend', 'إيقاف') : tx('Enable', 'تفعيل')}
              </button>
              <button type="button" disabled={busy} onClick={remove} className="inline-flex items-center gap-1.5 text-xs border border-red-200 rounded-lg px-2.5 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />{tx('Delete', 'حذف')}
              </button>
            </div>
          )}
        </div>
      ) : canManage ? (
        openForm ? (
          <div className="mt-3 space-y-2">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={tx('Login email', 'البريد الإلكتروني للدخول')}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
            />
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={tx('Password (min 8 characters)', 'كلمة المرور (8 أحرف على الأقل)')}
                className="w-full px-3 py-2 pe-9 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={create} className="inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                {tx('Create login', 'إنشاء الحساب')}
              </button>
              <button type="button" onClick={() => setOpenForm(false)} className="text-xs text-slate-500 px-3 py-2">{tx('Cancel', 'إلغاء')}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpenForm(true)} className="mt-3 inline-flex items-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-2">
            <UserPlus className="w-3.5 h-3.5" />
            {tx('Create a login for this ' + (kind === 'vendor' ? 'supplier' : 'customer'), `إنشاء حساب دخول لهذا ${kindLabel}`)}
          </button>
        )
      ) : (
        <p className="mt-3 text-[11px] text-slate-400">{tx('No portal login yet. An administrator can create one.', 'لا يوجد حساب بوابة بعد. يمكن للمسؤول إنشاؤه.')}</p>
      )}

      {account && (
        <a href="/system/users?accountType=partner" className="mt-3 inline-flex items-center gap-1 text-[#f37121] text-[11px] hover:underline">
          <ExternalLink className="w-3 h-3" />
          {tx('Manage all partner logins', 'إدارة كل حسابات الشركاء')}
        </a>
      )}
    </div>
  );
}
