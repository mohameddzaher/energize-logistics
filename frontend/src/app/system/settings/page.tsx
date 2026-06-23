'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getSettingsTranslations, getSettingsExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { Settings, Shield, RefreshCw, Lock, Eye, EyeOff, CheckCircle2, User } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const { lang } = useLanguage();
  const T = getSettingsTranslations(lang);
  const txx = getSettingsExtraTranslations(lang);

  // Change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');

  // Risk recalculation
  const [recalculating, setRecalculating] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [riskError, setRiskError] = useState(false);

  const handleChangePassword = async () => {
    setPwError('');
    setPwMessage('');

    if (!currentPassword || !newPassword) {
      setPwError(T.fillAllFields);
      return;
    }
    if (newPassword.length < 6) {
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

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-[#f37121]" />
        {T.title}
      </h1>

      {/* ── Change Password (All users) ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-2 flex items-center gap-2">
          <Lock className="w-5 h-5 text-[#f37121]" />
          {T.changePassword}
        </h3>
        <p className="text-slate-500 text-sm mb-4">
          {T.updatePasswordDesc}
        </p>

        {pwMessage && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-600 text-sm flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4" /> {pwMessage}
          </div>
        )}
        {pwError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-600 text-sm mb-4">
            {pwError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.currentPassword}</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pr-10"
                placeholder={txx.enterCurrentPassword}
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.newPassword}</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 pr-10"
                placeholder={txx.enterNewPassword}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 text-sm font-medium mb-1.5">{T.confirmPassword}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50"
              placeholder={txx.confirmNewPassword}
            />
          </div>

          <button
            type="button"
            onClick={handleChangePassword}
            disabled={pwLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium transition-all disabled:opacity-50"
          >
            {pwLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {pwLoading ? txx.changing : T.changePasswordBtn}
          </button>
        </div>
      </div>

      {/* ── Account Info (All users) ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-[#f37121]" />
          {txx.accountInformation}
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-slate-200/70">
            <span className="text-slate-500">{txx.name}</span>
            <span className="text-slate-900">{user?.firstName} {user?.lastName}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-200/70">
            <span className="text-slate-500">{txx.email}</span>
            <span className="text-slate-900">{user?.email}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">{txx.role}</span>
            <span className="text-slate-900 capitalize">{user?.role?.replace('_', ' ')}</span>
          </div>
        </div>
      </div>

      {/* ── Super Admin Only Sections ── */}
      {isSuperAdmin && (
        <>
          {/* Risk Recalculation */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-2 flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#f37121]" />
              {T.recalculateRisk}
            </h3>
            <p className="text-slate-500 text-sm mb-4">
              {T.recalculateRiskDesc}
            </p>
            {riskMessage && (
              <div className={`p-3 rounded-lg border text-sm mb-4 ${riskError ? 'bg-red-500/10 border-red-500/30 text-red-600' : 'bg-green-500/10 border-green-500/30 text-green-600'}`}>
                {riskMessage}
              </div>
            )}
            <button
              type="button"
              onClick={handleRecalculateRisk}
              disabled={recalculating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e06010] text-white text-sm font-medium transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
              {recalculating ? txx.recalculating : T.recalculate}
            </button>
          </div>

          {/* System Info */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-500" />
              {txx.systemInformation}
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-slate-200/70">
                <span className="text-slate-500">{txx.system}</span>
                <span className="text-slate-900">Energize Logistics — Enterprise Management System</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200/70">
                <span className="text-slate-500">{txx.version}</span>
                <span className="text-slate-900">1.0.0</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200/70">
                <span className="text-slate-500">{txx.creditTermsSupported}</span>
                <span className="text-slate-900">{txx.creditTermsDays}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">{txx.riskScoreRange}</span>
                <span className="text-slate-900">{txx.riskScoreRangeValue}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
