'use client';
// Portal login of one customer or supplier register row: asks the backend whether the row already has a login, then offers to create one or shows the account with reset, suspend and delete.
// Needs only the register key and row id; see backend/config/partnerRegisters.js.
// The password is never stored on the screen: it is shown once, right after create or reset, so it can be copied and sent.
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import {
  KeyRound, Mail, ShieldCheck, ShieldOff, Trash2, Eye, EyeOff, Loader2, UserPlus, ExternalLink,
  Copy, Check, Link2, Clock, CalendarPlus, Wand2, X, Building2,
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

const fmtWhen = (v?: string) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** A strong password without look-alike characters, so it can be read out over the phone. */
const makePassword = () => {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => pool[n % pool.length]).join('');
};

/** Copies a value and confirms with a tick for a moment. Module-level so its state survives the parent's renders. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <button type="button" onClick={copy} title={label} aria-label={label}
      className={`shrink-0 p-1.5 rounded-md border transition-colors ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-white text-slate-500 hover:text-[#f37121] hover:border-[#f37121]/40'}`}>
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function InfoRow({ icon, label, children, copy, copyLabel }: { icon: ReactNode; label: string; children: ReactNode; copy?: string; copyLabel?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-7 h-7 shrink-0 rounded-md bg-white border border-slate-200 text-slate-400 flex items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-500">{label}</p>
        <div className="text-[13.5px] font-semibold text-slate-900 break-all">{children}</div>
      </div>
      {copy ? <CopyButton text={copy} label={copyLabel || label} /> : null}
    </div>
  );
}

export default function PortalAccountCard({
  source, refId, name, compact, bare,
}: {
  source: string;   // register key, e.g. 'fleet_customer'
  refId: string;    // that row's _id (or the folded name for the customs register)
  name?: string;    // display name, used to prefill the account name
  compact?: boolean;
  /** Inside a modal: no card frame of its own. */
  bare?: boolean;
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
  // Shown once after create or reset so the credentials can be copied; cleared on close.
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  // role-only: partner accounts; matches ACCOUNT_ADMIN_ROLES on the server.
  const canManage = !!user && ADMIN_ROLES.includes(user.role);
  const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';

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
      setIssued({ email: r.account.email, password: form.password });
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
      message: tx('New password (min 8 characters). It is shown once after saving so you can copy it.', 'كلمة المرور الجديدة (8 أحرف على الأقل). تظهر مرّةً واحدة بعد الحفظ لنسخها.'),
      defaultValue: makePassword(),
      confirmLabel: tx('Reset', 'تغيير'),
    });
    if (!pw) return;
    if (pw.length < 8) { notify(tx('Password must be at least 8 characters', 'كلمة المرور 8 أحرف على الأقل'), 'error'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/partners/account/${account._id}`, { password: pw });
      setIssued({ email: account.email, password: pw });
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
      setIssued(null);
      notify(tx('Login deleted', 'تم حذف الحساب'), 'success');
    } catch (e: any) { notify(e?.message || tx('Failed', 'فشل'), 'error'); }
    setBusy(false);
  };

  const frame = bare ? '' : 'bg-white border border-slate-200 rounded-xl p-4 shadow-sm';

  if (loading) {
    return (
      <div className={`${frame} flex items-center gap-2 text-slate-500 text-sm py-6 justify-center`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        {tx('Checking portal access…', 'جارٍ التحقق من حساب البوابة…')}
      </div>
    );
  }

  const kindLabel = kind === 'vendor' ? tx('supplier', 'المورد') : tx('customer', 'العميل');
  const status = !account
    ? { label: tx('No account', 'لا يوجد حساب'), cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' }
    : account.isLocked
      ? { label: tx('Locked', 'مقفل'), cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' }
      : account.isActive
        ? { label: tx('Active', 'مفعّل'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
        : { label: tx('Suspended', 'موقوف'), cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  const btn = 'inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-lg px-3 py-2 disabled:opacity-50 transition-colors';
  const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#f37121] focus:ring-2 focus:ring-[#f37121]/20';

  return (
    <div className={`${frame} space-y-4`}>
      {/* Who the account is for, what it gives, and where it stands. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-10 h-10 shrink-0 rounded-xl bg-[#f37121]/10 text-[#f37121] flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-slate-900 font-bold text-[15px] flex items-center gap-1.5">
              {name ? <><Building2 className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{name}</span></> : tx('Portal access', 'حساب البوابة')}
            </h3>
            <p className="text-slate-500 text-[12.5px] leading-relaxed mt-0.5">
              {tx(`A login lets this ${kind === 'vendor' ? 'supplier' : 'customer'} follow their own shipments, waybills and invoices on the portal.`,
                `حسابُ دخولٍ يتيح لهذا ${kindLabel} متابعة شحناته وبوالصه وفواتيره بنفسه عبر البوابة.`)}
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ${status.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
        </span>
      </div>

      {/* Credentials just issued: shown once, to copy and send. */}
      {issued && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-emerald-100">
            <p className="text-[12.5px] font-bold text-emerald-800">{tx('Login details — copy and send them now', 'بيانات الدخول — انسخها وأرسلها الآن')}</p>
            <button type="button" onClick={() => setIssued(null)} className="p-1 rounded text-emerald-700 hover:bg-emerald-100" aria-label={tx('Close', 'إغلاق')}><X className="w-4 h-4" /></button>
          </div>
          <div className="divide-y divide-emerald-100">
            <InfoRow icon={<Link2 className="w-3.5 h-3.5" />} label={tx('Login page', 'صفحة الدخول')} copy={loginUrl}><span dir="ltr">{loginUrl}</span></InfoRow>
            <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label={tx('Email', 'البريد الإلكتروني')} copy={issued.email}><span dir="ltr">{issued.email}</span></InfoRow>
            <InfoRow icon={<KeyRound className="w-3.5 h-3.5" />} label={tx('Password', 'كلمة المرور')} copy={issued.password}><span dir="ltr" className="font-mono tracking-wide">{issued.password}</span></InfoRow>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-emerald-100">
            <p className="text-[11.5px] text-emerald-800">{tx('The password is not shown again after you close this.', 'لا تظهر كلمة المرور مرّةً أخرى بعد الإغلاق.')}</p>
            <CopyButton text={`${tx('Login page', 'صفحة الدخول')}: ${loginUrl}\n${tx('Email', 'البريد')}: ${issued.email}\n${tx('Password', 'كلمة المرور')}: ${issued.password}`} label={tx('Copy all', 'نسخ الكل')} />
          </div>
        </div>
      )}

      {account ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 divide-y divide-slate-200">
            {/* While fresh credentials are shown above, the email and link are not repeated here. */}
            {!issued && (
              <>
                <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label={tx('Login email', 'بريد الدخول')} copy={account.email} copyLabel={tx('Copy email', 'نسخ البريد')}>
                  <span dir="ltr">{account.email}</span>
                </InfoRow>
                <InfoRow icon={<Link2 className="w-3.5 h-3.5" />} label={tx('Login page', 'صفحة الدخول')} copy={loginUrl} copyLabel={tx('Copy link', 'نسخ الرابط')}>
                  <span dir="ltr">{loginUrl}</span>
                </InfoRow>
              </>
            )}
            <InfoRow icon={<Clock className="w-3.5 h-3.5" />} label={tx('Last sign-in', 'آخر دخول')}>
              {account.lastLogin ? <span className="tabular-nums" dir="ltr">{fmtWhen(account.lastLogin)}</span> : <span className="text-slate-500 font-medium">{tx('Has not signed in yet', 'لم يسجّل الدخول بعد')}</span>}
            </InfoRow>
            {account.createdAt && (
              <InfoRow icon={<CalendarPlus className="w-3.5 h-3.5" />} label={tx('Created', 'تاريخ الإنشاء')}>
                <span className="tabular-nums" dir="ltr">{fmtWhen(account.createdAt)}</span>
              </InfoRow>
            )}
          </div>
          {canManage && !compact && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={resetPassword} className={`${btn} bg-[#f37121] text-white hover:bg-[#e06010]`}>
                <KeyRound className="w-4 h-4" />{tx('Reset password', 'تغيير كلمة المرور')}
              </button>
              <button type="button" disabled={busy} onClick={toggleActive} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
                {account.isActive ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                {account.isActive ? tx('Suspend', 'إيقاف الحساب') : tx('Enable', 'تفعيل الحساب')}
              </button>
              <button type="button" disabled={busy} onClick={remove} className={`${btn} ms-auto border border-red-200 bg-white text-red-600 hover:bg-red-50`}>
                <Trash2 className="w-4 h-4" />{tx('Delete login', 'حذف الحساب')}
              </button>
              {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            </div>
          )}
          <a href="/system/users?accountType=partner" className="inline-flex items-center gap-1 text-[#f37121] text-[12px] font-semibold hover:underline">
            <ExternalLink className="w-3.5 h-3.5" />
            {tx('Manage all partner logins', 'إدارة كل حسابات الشركاء')}
          </a>
        </>
      ) : canManage ? (
        openForm ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">{tx('Login email', 'البريد الإلكتروني للدخول')}</label>
              <input type="email" dir="ltr" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">{tx('Password (min 8 characters)', 'كلمة المرور (8 أحرف على الأقل)')}</label>
              <div className="flex items-center gap-2">
                {/* ltr box: the eye button sits at the end of the typed text, not over its start. */}
                <div className="relative flex-1" dir="ltr">
                  <input type={showPw ? 'text' : 'password'} value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })} className={`${inputCls} pe-9 font-mono`} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-700"
                    aria-label={showPw ? tx('Hide password', 'إخفاء كلمة المرور') : tx('Show password', 'إظهار كلمة المرور')}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button type="button" onClick={() => { setForm((f) => ({ ...f, password: makePassword() })); setShowPw(true); }}
                  className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
                  <Wand2 className="w-4 h-4" />{tx('Generate', 'توليد')}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" disabled={busy} onClick={create} className={`${btn} bg-[#f37121] text-white hover:bg-[#e06010]`}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {tx('Create login', 'إنشاء الحساب')}
              </button>
              <button type="button" onClick={() => setOpenForm(false)} className={`${btn} text-slate-600 hover:text-slate-900`}>{tx('Cancel', 'إلغاء')}</button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-[13px] text-slate-600">{tx(`This ${kind === 'vendor' ? 'supplier' : 'customer'} has no portal login yet.`, `لا يملك هذا ${kindLabel} حسابَ دخولٍ للبوابة بعد.`)}</p>
            <button type="button" onClick={() => { setOpenForm(true); setForm({ email: '', password: makePassword() }); setShowPw(true); }}
              className={`${btn} bg-[#f37121] text-white hover:bg-[#e06010] shrink-0`}>
              <UserPlus className="w-4 h-4" />
              {tx('Create a login', 'إنشاء حساب دخول')}
            </button>
          </div>
        )
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-[13px] text-slate-600">
          {tx('No portal login yet. A system administrator can create one.', 'لا يوجد حساب بوابة بعد. يستطيع مديرُ النظام إنشاءه.')}
        </p>
      )}
    </div>
  );
}
