'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, ArrowRight, Truck, UserCheck, ArrowLeftRight, Ban, AlertTriangle, Check } from 'lucide-react';
import {
  Vehicle, VehicleAuthorization, VehicleAccident, VEHICLE_STATUS, AUTH_STATUS, ACCIDENT_SEVERITY, ACCIDENT_STATUS,
  FAULT_PARTY, isVehicleStaff, vehicleTypeLabel, faultPartyLabel, empRefName, getVehiclesText, fmtDate, fmtDateTime, today,
} from '@/lib/vehicles';
import { Spinner, Badge, SmallBadge, Tabs, Modal, Field, TextInput, TextArea, Select, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import { EmployeePicker } from '@/components/vehicles/EmployeePicker';

interface Detail { vehicle: Vehicle | null; authorizations: VehicleAuthorization[]; accidents: VehicleAccident[]; }
type Action = 'authorize' | 'transfer' | 'revoke' | 'accident' | null;

export default function VehicleDetailPage() {
  const { notify } = useDialog();
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const tx = getVehiclesText(lang);
  const ar = lang === 'ar';
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const staff = isVehicleStaff(user?.role);

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [action, setAction] = useState<Action>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get<Detail>(`/api/vehicles/${id}`)); } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useSocket('vehicle:authorization', useCallback(() => load(), [load]));
  useSocket('vehicle:accident', useCallback(() => load(), [load]));
  useSocket('vehicle:updated', useCallback(() => load(), [load]));

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;
  if (!data?.vehicle) return <div className="text-slate-500 p-8">{tx.vehicleNotFound}</div>;

  const v = data.vehicle;
  const active = data.authorizations.find((a) => a.status === 'active') || null;

  const openAction = (a: Action) => {
    setAction(a);
    setForm(a === 'accident'
      ? { date: today(), description: '', faultParty: 'unknown', severity: 'minor', status: 'reported', location: '', employee: active ? (active.employee as any)?._id : '', estimatedCost: '', actualCost: '' }
      : { employee: '', startDate: today(), authorizationType: '', documentNumber: '', documentExpiry: '', issuedBy: '', notes: '', endDate: today(), revokedReason: '' });
  };
  const set = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }));

  const submit = async () => {
    setSaving(true);
    try {
      if (action === 'authorize') await api.post(`/api/vehicles/${id}/authorize`, form);
      else if (action === 'transfer') await api.post(`/api/vehicles/${id}/transfer`, form);
      else if (action === 'revoke') await api.post(`/api/vehicles/${id}/revoke`, { endDate: form.endDate, revokedReason: form.revokedReason });
      else if (action === 'accident') await api.post(`/api/vehicles/${id}/accidents`, { ...form, estimatedCost: Number(form.estimatedCost) || 0, actualCost: Number(form.actualCost) || 0 });
      setAction(null);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const tabs = [
    { key: 'overview', label: tx.tabOverview },
    { key: 'authorizations', label: tx.tabAuthorizations, badge: data.authorizations.length || undefined },
    { key: 'accidents', label: tx.tabAccidents, badge: data.accidents.length || undefined },
  ];

  const needEmployee = action === 'authorize' || action === 'transfer';
  const canSubmit = action === 'revoke' ? true : action === 'accident' ? !!form.description?.trim() : !!form.employee;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm"><Back className="w-4 h-4" /> {tx.back}</button>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-[#f37121]/15 flex items-center justify-center text-[#f37121]"><Truck className="w-8 h-8" /></div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{v.plateNumber}</h1>
              <Badge style={VEHICLE_STATUS[v.status]} lang={lang} />
            </div>
            <p className="text-slate-500 text-sm mt-1">
              {vehicleTypeLabel(v.type, lang)}{v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}{v.department ? ` · ${v.department}` : ''}{v.project ? ` · ${v.project}` : ''}
            </p>
            <p className="text-slate-700 text-sm mt-1">
              {active
                ? <>{tx.authorizedTo}: <span className="font-semibold text-slate-900">{empRefName(active.employee, lang)}</span> <span className="text-slate-400">· {tx.since} {fmtDate(active.startDate)}</span></>
                : <span className="text-amber-700">{tx.parkedNoHolder}</span>}
            </p>
          </div>
        </div>
        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-5">
          {!active && <button type="button" onClick={() => openAction('authorize')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"><UserCheck className="w-4 h-4" /> {tx.authorize}</button>}
          {active && <button type="button" onClick={() => openAction('transfer')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"><ArrowLeftRight className="w-4 h-4" /> {tx.transfer}</button>}
          {active && <button type="button" onClick={() => openAction('revoke')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"><Ban className="w-4 h-4" /> {tx.revoke}</button>}
          <button type="button" onClick={() => openAction('accident')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"><AlertTriangle className="w-4 h-4" /> {tx.reportAccident}</button>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.vehicleDetails}</h3>
            <DetailRows rows={[
              [tx.plateNumber, v.plateNumber], [tx.type, vehicleTypeLabel(v.type, lang)],
              [tx.make, v.make], [tx.model, v.model], [tx.year, v.year], [tx.color, v.color],
              [tx.branch, typeof v.branch === 'object' ? v.branch?.name : ''],
              [tx.department, v.department], [tx.project, v.project],
              [tx.registrationExpiry, fmtDate(v.registrationExpiry)], [tx.insuranceExpiry, fmtDate(v.insuranceExpiry)],
              [tx.accidents, v.accidentCount || 0],
            ]} />
            {v.notes && <p className="text-slate-500 text-sm mt-4 border-t border-slate-200 pt-3">{v.notes}</p>}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.currentAuthorization}</h3>
            {active ? (
              <DetailRows rows={[
                [tx.employee, empRefName(active.employee, lang)],
                [tx.startDate, fmtDate(active.startDate)],
                [tx.authType, active.authorizationType],
                [tx.documentNumber, active.documentNumber],
                [tx.documentExpiry, fmtDate(active.documentExpiry)],
                [tx.issuedBy, active.issuedBy],
                [tx.transferredFrom, empRefName(active.transferredFrom, lang) !== '—' ? empRefName(active.transferredFrom, lang) : ''],
              ]} />
            ) : <p className="text-slate-400 text-sm">{tx.parkedNoHolder}</p>}
          </div>
        </div>
      )}

      {tab === 'authorizations' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-slate-900 font-semibold mb-4">{tx.authHistory}</h3>
          {data.authorizations.length === 0 ? <p className="text-slate-400 text-sm text-center py-8">{tx.noAuthorizations}</p> : (
            <ol className={`relative ${isRTL ? 'border-r pr-5' : 'border-l pl-5'} border-slate-200 space-y-5`}>
              {data.authorizations.map((a) => (
                <li key={a._id} className="relative">
                  <span className={`absolute ${isRTL ? '-right-[27px]' : '-left-[27px]'} top-1 w-3 h-3 rounded-full ${a.status === 'active' ? 'bg-green-500' : a.status === 'revoked' ? 'bg-red-500' : 'bg-blue-500'}`} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-900 font-medium">{empRefName(a.employee, lang)}</span>
                    <Badge style={AUTH_STATUS[a.status]} lang={lang} />
                  </div>
                  <p className="text-slate-500 text-xs mt-1">
                    {tx.period}: {fmtDate(a.startDate)} → {a.endDate ? fmtDate(a.endDate) : (ar ? 'حتى الآن' : 'now')}
                  </p>
                  <div className="text-slate-600 text-xs mt-1 space-y-0.5">
                    {a.authorizationType && <p>{tx.authType}: {a.authorizationType}</p>}
                    {a.documentNumber && <p>{tx.documentNumber}: {a.documentNumber}</p>}
                    {empRefName(a.transferredTo, lang) !== '—' && <p>{tx.transferredTo}: {empRefName(a.transferredTo, lang)}</p>}
                    {empRefName(a.transferredFrom, lang) !== '—' && <p>{tx.transferredFrom}: {empRefName(a.transferredFrom, lang)}</p>}
                    {a.revokedReason && <p>{tx.revokedReason}: {a.revokedReason}</p>}
                    {a.notes && <p className="text-slate-400">{a.notes}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === 'accidents' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          {data.accidents.length === 0 ? <p className="text-slate-400 text-sm text-center py-12">{tx.noAccidents}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
                <th className="text-start font-semibold px-4 py-3">{tx.date}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.employee}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.description}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.faultParty}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.severity}</th>
                <th className="text-start font-semibold px-4 py-3">{tx.status}</th>
              </tr></thead>
              <tbody>{data.accidents.map((a) => (
                <tr key={a._id} className="border-b border-slate-200/70 hover:bg-slate-100">
                  <td className="px-4 py-3 text-slate-700">{fmtDate(a.date)}</td>
                  <td className="px-4 py-3 text-slate-900">{empRefName(a.employee, lang)}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={a.description}>{a.description}</td>
                  <td className="px-4 py-3 text-slate-700">{faultPartyLabel(a.faultParty, lang)}</td>
                  <td className="px-4 py-3"><Badge style={ACCIDENT_SEVERITY[a.severity || 'minor']} lang={lang} /></td>
                  <td className="px-4 py-3"><Badge style={ACCIDENT_STATUS[a.status || 'reported']} lang={lang} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {/* Action modal */}
      <Modal open={!!action} onClose={() => setAction(null)} wide={action === 'accident'}
        title={action === 'authorize' ? tx.authorizeVehicle : action === 'transfer' ? tx.transferAuthorization : action === 'revoke' ? tx.revokeAuthorization : tx.newAccident}
        footer={<>
          <button type="button" onClick={() => setAction(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={submit} disabled={saving || !canSubmit}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tx.save}</PrimaryButton>
        </>}>
        {needEmployee && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={action === 'transfer' ? tx.newHolder : tx.employee} span2>
              <EmployeePicker value={form.employee} onChange={(eid) => set('employee', eid)} placeholder={tx.selectEmployee} lang={lang} />
            </Field>
            <Field label={tx.startDate}><TextInput type="date" value={form.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
            <Field label={tx.authType}><TextInput value={form.authorizationType} onChange={(e) => set('authorizationType', e.target.value)} /></Field>
            <Field label={tx.documentNumber}><TextInput value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} /></Field>
            <Field label={tx.documentExpiry}><TextInput type="date" value={form.documentExpiry || ''} onChange={(e) => set('documentExpiry', e.target.value)} /></Field>
            <Field label={tx.issuedBy}><TextInput value={form.issuedBy} onChange={(e) => set('issuedBy', e.target.value)} /></Field>
            <Field label={tx.notes} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
        )}
        {action === 'revoke' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={tx.endDate}><TextInput type="date" value={form.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
            <Field label={tx.revokedReason} span2><TextArea rows={2} value={form.revokedReason} onChange={(e) => set('revokedReason', e.target.value)} /></Field>
          </div>
        )}
        {action === 'accident' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={tx.date}><TextInput type="date" value={form.date || ''} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label={tx.employee}><EmployeePicker value={form.employee} onChange={(eid) => set('employee', eid)} placeholder={tx.selectEmployee} lang={lang} /></Field>
            <Field label={tx.location}><TextInput value={form.location} onChange={(e) => set('location', e.target.value)} /></Field>
            <Field label={tx.reportNumber}><TextInput value={form.reportNumber} onChange={(e) => set('reportNumber', e.target.value)} /></Field>
            <Field label={tx.faultParty}><Select value={form.faultParty} onChange={(e) => set('faultParty', e.target.value)}>{FAULT_PARTY.map((f) => <option key={f.key} value={f.key}>{ar ? f.ar : f.en}</option>)}</Select></Field>
            <Field label={tx.severity}><Select value={form.severity} onChange={(e) => set('severity', e.target.value)}>{Object.entries(ACCIDENT_SEVERITY).map(([k, val]) => <option key={k} value={k}>{ar ? val.ar : val.en}</option>)}</Select></Field>
            <Field label={tx.estimatedCost}><TextInput type="number" value={form.estimatedCost} onChange={(e) => set('estimatedCost', e.target.value)} /></Field>
            <Field label={tx.actualCost}><TextInput type="number" value={form.actualCost} onChange={(e) => set('actualCost', e.target.value)} /></Field>
            <Field label={tx.status}><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(ACCIDENT_STATUS).map(([k, val]) => <option key={k} value={k}>{ar ? val.ar : val.en}</option>)}</Select></Field>
            <Field label={tx.description} span2><TextArea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label={tx.thirdPartyDetails} span2><TextArea rows={2} value={form.thirdPartyDetails} onChange={(e) => set('thirdPartyDetails', e.target.value)} /></Field>
            <Field label={tx.actionTaken} span2><TextArea rows={2} value={form.actionTaken} onChange={(e) => set('actionTaken', e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailRows({ rows }: { rows: [string, any][] }) {
  return (
    <div className="space-y-2">
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== '—').map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-2">
          <span className="text-slate-500 text-sm">{k}</span>
          <span className="text-slate-900 text-sm text-end">{v}</span>
        </div>
      ))}
    </div>
  );
}
