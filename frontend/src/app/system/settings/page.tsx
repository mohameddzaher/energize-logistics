'use client';
import { useState, useEffect, type ReactNode, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getSettingsTranslations, getSettingsExtraTranslations } from '@/lib/translations';
import { roleLabel } from '@/lib/roles';
import api from '@/lib/api';
import { Settings, Shield, RefreshCw, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, User, PenTool, Info, Mail, Save } from 'lucide-react';
import SignatureManager from '@/components/SignatureManager';
import { PageHeader, PrimaryButton, TextInput } from '@/components/hr/HRKit';

// Module-level so inputs keep focus between keystrokes.
function Section({ icon, title, desc, children, className = '' }: { icon: ReactNode; title: string; desc?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${className}`}>
      <header className="bg-slate-900 px-4 sm:px-5 py-3 flex items-center gap-2.5">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-[#f37121]/15 text-[#f37121] flex items-center justify-center">{icon}</span>
        <h2 className="text-white font-semibold text-[15px] leading-tight">{title}</h2>
      </header>
      <div className="p-4 sm:p-5">
        {desc && <p className="text-slate-500 text-sm mb-4 leading-relaxed">{desc}</p>}
        {children}
      </div>
    </section>
  );
}

function Notice({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  const ok = tone === 'ok';
  return (
    <div role="status" className={`rounded-lg border p-3 text-sm flex items-start gap-2 mb-4 ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-slate-700 text-sm font-medium mb-1.5">{children}</label>;
}

function PasswordInput({ id, value, onChange, placeholder, autoComplete, showLabel, hideLabel }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete: string; showLabel: string; hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <TextInput id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete} className="pe-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? hideLabel : showLabel} title={show ? hideLabel : showLabel}
        className="absolute end-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500 text-sm shrink-0">{label}</span>
      <span className="text-slate-900 text-sm font-medium break-words sm:text-end min-w-0">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  // role-only: system settings are for the system admin.
  const isSuperAdmin = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'].includes(user?.role || '');

  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const T = getSettingsTranslations(lang);
  const txx = getSettingsExtraTranslations(lang);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');

  const [profFirst, setProfFirst] = useState('');
  const [profLast, setProfLast] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profLoading, setProfLoading] = useState(false);
  const [profMsg, setProfMsg] = useState('');
  const [profErr, setProfErr] = useState('');

  useEffect(() => {
    if (user) { setProfFirst(user.firstName || ''); setProfLast(user.lastName || ''); setProfEmail(user.email || ''); }
  }, [user]);

  const handleSaveProfile = async (e?: FormEvent) => {
    e?.preventDefault();
    setProfErr(''); setProfMsg('');
    try {
      setProfLoading(true);
      await api.patch('/api/auth/me', { firstName: profFirst, lastName: profLast, email: profEmail });
      await refreshUser();
      setProfMsg(ar ? 'تم حفظ البيانات' : 'Saved');
    } catch (err: any) {
      setProfErr(err.message || (ar ? 'تعذّر الحفظ' : 'Failed to save'));
    } finally {
      setProfLoading(false);
    }
  };

  const [recalculating, setRecalculating] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [riskError, setRiskError] = useState(false);

  const handleChangePassword = async (e?: FormEvent) => {
    e?.preventDefault();
    setPwError('');
    setPwMessage('');

    if (!currentPassword || !newPassword) {
      setPwError(T.fillAllFields);
      return;
    }
    // Must match the server minimum (8), or the request is rejected after passing here.
    if (newPassword.length < 8) {
      setPwError(T.passwordMinLength);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError(T.passwordsNoMatch);
      return;
    }

    try {
      setPwLoading(true);
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setPwMessage(T.passwordChanged);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwError(err.message || txx.failedChangePassword);
    } finally {
      setPwLoading(false);
    }
  };

  const handleRecalculateRisk = async () => {
    setRecalculating(true);
    setRiskMessage('');
    setRiskError(false);
    try {
      const data = await api.post<any>('/api/analytics/risk/recalculate');
      setRiskMessage(`${txx.riskRecalcPrefix}${data.results?.length || 0}${txx.riskRecalcSuffix}`);
    } catch (err: any) {
      setRiskError(true);
      setRiskMessage(`${txx.errorPrefix}${err.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials = ((user?.firstName || '').trim().charAt(0) + (user?.lastName || '').trim().charAt(0)).toUpperCase() || '?';
  const eyeShow = ar ? 'إظهار كلمة المرور' : 'Show password';
  const eyeHide = ar ? 'إخفاء كلمة المرور' : 'Hide password';

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <PageHeader icon={<Settings className="w-5 h-5" />} title={T.title}
        subtitle={ar ? 'حسابك وكلمة المرور وتوقيعاتك' : 'Your account, password and signatures'} />

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 flex items-center gap-4 min-w-0">
        <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full bg-[#12325C] text-white flex items-center justify-center text-lg font-bold" dir="ltr">{initials}</div>
        <div className="min-w-0 flex-1">
          <p className="text-slate-900 font-bold text-base sm:text-lg truncate">{fullName || '—'}</p>
          <p className="text-slate-500 text-sm flex items-center gap-1.5 min-w-0">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            <span dir="ltr" className="truncate">{user?.email || '—'}</span>
          </p>
        </div>
        {user?.role && (
          <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 px-3 py-1 rounded-full bg-[#12325C]/10 text-[#12325C] text-xs font-semibold">
            <Shield className="w-3.5 h-3.5" /> {roleLabel(user.role, lang)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Section icon={<User className="w-4 h-4" />} title={txx.accountInformation}
          desc={ar ? 'عدّل اسمك وبريدك، يُحفظ فورًا ويظهر في كل النظام.' : 'Edit your name and email. Saved instantly and reflected across the system.'}>
          {profMsg && <Notice tone="ok">{profMsg}</Notice>}
          {profErr && <Notice tone="error">{profErr}</Notice>}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="min-w-0">
                <FieldLabel htmlFor="set-first">{ar ? 'الاسم الأول' : 'First name'}</FieldLabel>
                <TextInput id="set-first" value={profFirst} onChange={(e) => setProfFirst(e.target.value)} autoComplete="given-name" />
              </div>
              <div className="min-w-0">
                <FieldLabel htmlFor="set-last">{ar ? 'الاسم الأخير' : 'Last name'}</FieldLabel>
                <TextInput id="set-last" value={profLast} onChange={(e) => setProfLast(e.target.value)} autoComplete="family-name" />
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="set-email">{txx.email}</FieldLabel>
              <TextInput id="set-email" type="email" dir="ltr" value={profEmail} onChange={(e) => setProfEmail(e.target.value)} autoComplete="email" className="text-start" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-sm text-slate-500 min-w-0 break-words">
                {txx.role}: <span className="text-slate-900 font-medium">{roleLabel(user?.role, lang) || '—'}</span>
              </span>
              <PrimaryButton type="submit" disabled={profLoading}>
                {profLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {ar ? 'حفظ' : 'Save'}
              </PrimaryButton>
            </div>
          </form>
        </Section>

        <Section icon={<Lock className="w-4 h-4" />} title={T.changePassword} desc={T.updatePasswordDesc}>
          {pwMessage && <Notice tone="ok">{pwMessage}</Notice>}
          {pwError && <Notice tone="error">{pwError}</Notice>}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <FieldLabel htmlFor="set-pw-current">{T.currentPassword}</FieldLabel>
              <PasswordInput id="set-pw-current" value={currentPassword} onChange={setCurrentPassword}
                placeholder={txx.enterCurrentPassword} autoComplete="current-password" showLabel={eyeShow} hideLabel={eyeHide} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div className="min-w-0">
                <FieldLabel htmlFor="set-pw-new">{T.newPassword}</FieldLabel>
                <PasswordInput id="set-pw-new" value={newPassword} onChange={setNewPassword}
                  placeholder={txx.enterNewPassword} autoComplete="new-password" showLabel={eyeShow} hideLabel={eyeHide} />
              </div>
              <div className="min-w-0">
                <FieldLabel htmlFor="set-pw-confirm">{T.confirmPassword}</FieldLabel>
                <PasswordInput id="set-pw-confirm" value={confirmPassword} onChange={setConfirmPassword}
                  placeholder={txx.confirmNewPassword} autoComplete="new-password" showLabel={eyeShow} hideLabel={eyeHide} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-400">{ar ? '8 أحرف على الأقل' : 'At least 8 characters'}</span>
              <PrimaryButton type="submit" disabled={pwLoading}>
                {pwLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {pwLoading ? txx.changing : T.changePasswordBtn}
              </PrimaryButton>
            </div>
          </form>
        </Section>
      </div>

      <Section icon={<PenTool className="w-4 h-4" />} title={ar ? 'توقيعاتي' : 'My Signatures'}
        desc={ar ? 'أنشئ توقيعك (بالرسم أو برفع صورة) لاستخدامه في الموافقات والمستندات، مثل طلبات الإجازة.' : 'Create your signature (draw or upload) to apply it on approvals and documents like leave requests.'}>
        <SignatureManager />
      </Section>

      {isSuperAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Section icon={<Shield className="w-4 h-4" />} title={T.recalculateRisk} desc={T.recalculateRiskDesc}>
            {riskMessage && <Notice tone={riskError ? 'error' : 'ok'}>{riskMessage}</Notice>}
            <PrimaryButton onClick={handleRecalculateRisk} disabled={recalculating}>
              <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
              {recalculating ? txx.recalculating : T.recalculate}
            </PrimaryButton>
          </Section>

          <Section icon={<Info className="w-4 h-4" />} title={txx.systemInformation}>
            <InfoRow label={txx.system} value="Energize Logistics — Enterprise Management System" />
            <InfoRow label={txx.version} value={<span dir="ltr">1.0.0</span>} />
            <InfoRow label={txx.creditTermsSupported} value={txx.creditTermsDays} />
            <InfoRow label={txx.riskScoreRange} value={txx.riskScoreRangeValue} />
          </Section>
        </div>
      )}
    </div>
  );
}
