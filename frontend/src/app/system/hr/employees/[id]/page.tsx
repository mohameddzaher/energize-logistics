'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  ArrowLeft, ArrowRight, Edit, RefreshCw, UserX, UserCheck, Plus, Trash2, FileText, ExternalLink, Check,
} from 'lucide-react';
import {
  isHRStaff, Employee, Contract, LeaveRequest, Asset, HRRequest, LeaveBalance,
  EmployeeDocument, EmployeeRenewal, AuditEntry,
  empName, userName, fmtDate, fmtDateTime, leaveTypeLabel, expiryBadge,
  EMPLOYMENT_STATUS, CONTRACT_STATUS, LEAVE_STATUS, REQUEST_STATUS, assetTypeLabel, conditionLabel,
  RENEWAL_TYPES, DOCUMENT_CATEGORIES, renewalTypeLabel, docCategoryLabel, auditActionLabel,
} from '@/lib/hr';
import {
  Spinner, Badge, SmallBadge, Tabs, StatCard, Modal, Field, TextInput, Select, TextArea, PrimaryButton, Loader2,
} from '@/components/hr/HRKit';
import ReportButton from '@/components/system/ReportButton';
import { EmployeeFormModal } from '@/components/hr/EmployeeFormModal';
import ContractFormModal from '@/components/hr/ContractFormModal';
import { getHrEmployeesIdTranslations } from '@/lib/translations';
import {
  VehicleAuthorization, VehicleAccident, AUTH_STATUS, ACCIDENT_SEVERITY, ACCIDENT_STATUS,
  vehicleTypeLabel, plateOf, faultPartyLabel, getVehiclesText,
} from '@/lib/vehicles';

interface Profile {
  employee: Employee | null;
  contracts: Contract[];
  activeContract: Contract | null;
  balance: LeaveBalance | null;
  leaves: LeaveRequest[];
  assets: Asset[];
  requests: HRRequest[];
  documents: EmployeeDocument[];
  renewals: EmployeeRenewal[];
}

export default function EmployeeProfilePage() {
  const { confirm, notify } = useDialog();
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrEmployeesIdTranslations(lang);
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const staff = isHRStaff(user);

  const vtx = getVehiclesText(lang);
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [vehicleData, setVehicleData] = useState<{ current: VehicleAuthorization | null; authorizations: VehicleAuthorization[]; accidents: VehicleAccident[] } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Action modals
  const [showEdit, setShowEdit] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [showRenew, setShowRenew] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [editDoc, setEditDoc] = useState<EmployeeDocument | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get<Profile>(`/api/hr/employees/${id}`)); } catch {}
    setLoading(false);
  }, [id]);
  const loadVehicles = useCallback(async () => {
    try { setVehicleData(await api.get(`/api/vehicles/by-employee/${id}`)); } catch {}
  }, [id]);
  const loadAudit = useCallback(async () => {
    if (!staff) return;
    try { const d = await api.get<{ logs: AuditEntry[] }>(`/api/hr/employees/${id}/audit`); setAudit(d.logs || []); } catch {}
  }, [id, staff]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVehicles(); }, [loadVehicles]);
  useEffect(() => { if (tab === 'history') loadAudit(); }, [tab, loadAudit]);
  useSocket('hr:employee', useCallback(() => { load(); loadVehicles(); loadAudit(); }, [load, loadVehicles, loadAudit]));
  useSocket('hr:leave', useCallback(() => load(), [load]));
  useSocket('hr:asset', useCallback(() => load(), [load]));
  useSocket('hr:contract', useCallback(() => load(), [load]));
  useSocket('vehicle:authorization', useCallback(() => loadVehicles(), [loadVehicles]));
  useSocket('vehicle:accident', useCallback(() => loadVehicles(), [loadVehicles]));

  const reactivate = async () => {
    if (!(await confirm(ar ? 'إعادة تفعيل هذا الموظف؟' : 'Reactivate this employee?'))) return;
    try { await api.post(`/api/hr/employees/${id}/reactivate`, {}); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  if (loading) return <Spinner />;
  if (!data?.employee) return <div className="text-slate-500 p-8">{tx.employeeNotFound}</div>;

  const e = data.employee;
  const b = data.balance;
  const assignedAssets = data.assets.filter((a) => a.status === 'assigned');
  const terminated = e.employmentStatus === 'terminated';

  const tabs = [
    { key: 'overview', label: tx.tabOverview },
    { key: 'documents', label: ar ? 'الملفات' : 'Files', badge: data.documents?.length || undefined },
    { key: 'leaves', label: tx.tabLeaves, badge: data.leaves.length || undefined },
    { key: 'custody', label: tx.tabCustody, badge: assignedAssets.length || undefined },
    { key: 'vehicles', label: vtx.empVehicleTab, badge: (vehicleData?.authorizations.length || 0) || undefined },
    { key: 'contracts', label: tx.tabContracts, badge: data.contracts.length || undefined },
    { key: 'requests', label: tx.tabRequests, badge: data.requests.length || undefined },
    ...(staff ? [{ key: 'history', label: ar ? 'السجل' : 'History', badge: undefined }] : []),
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm"><Back className="w-4 h-4" /> {tx.back}</button>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-[#f37121]/20 flex items-center justify-center text-[#f37121] text-2xl font-bold">
          {empName(e).charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{empName(e, lang)}</h1>
            <Badge style={EMPLOYMENT_STATUS[e.employmentStatus || 'active']} lang={lang} />
          </div>
          <p className="text-slate-500 text-sm mt-1">{e.jobTitle || '—'} {e.department ? `· ${e.department}` : ''} {e.employeeNumber ? `· #${e.employeeNumber}` : ''}</p>
          <p className="text-slate-500 text-xs mt-1">{e.user ? `${tx.linkedLogin}: ${userName(e.user)}` : tx.noLoginLinked}</p>
        </div>
        {/* Quick actions (staff only) */}
        {staff && (
          <div className="flex flex-wrap items-center gap-2">
            <ReportButton subject="employee" id={String(e._id)} label={ar ? 'تقرير الموظف' : 'Employee report'} />
            <ActionBtn onClick={() => setShowEdit(true)} icon={<Edit className="w-4 h-4" />} label={ar ? 'تعديل' : 'Edit'} primary />
            <ActionBtn onClick={() => setShowRenew(true)} icon={<RefreshCw className="w-4 h-4" />} label={ar ? 'تجديد مستند' : 'Renew Doc'} />
            {terminated
              ? <ActionBtn onClick={reactivate} icon={<UserCheck className="w-4 h-4" />} label={ar ? 'إعادة تفعيل' : 'Reactivate'} />
              : <ActionBtn onClick={() => setShowTerminate(true)} icon={<UserX className="w-4 h-4" />} label={ar ? 'إنهاء الخدمة' : 'End Service'} danger />}
          </div>
        )}
      </div>

      {/* Termination banner */}
      {terminated && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {ar ? 'انتهت خدمة هذا الموظف' : 'This employee’s service has ended'}
          {e.terminatedAt ? ` · ${fmtDate(e.terminatedAt)}` : ''}
          {e.terminationReason ? ` · ${e.terminationReason}` : ''}
        </div>
      )}

      {/* Leave balance stats */}
      {b && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={tx.annualEntitlement} value={`${b.entitlement} ${tx.dayUnit}`} />
          <StatCard label={tx.accruedToDate} value={`${b.accrued} ${tx.dayUnit}`} accent="text-blue-600" />
          <StatCard label={tx.taken} value={`${b.taken} ${tx.dayUnit}`} accent="text-amber-700" />
          <StatCard label={tx.available} value={`${b.available} ${tx.dayUnit}`} accent={b.available < 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <Overview e={e} lang={lang} tx={tx} vtx={vtx} />}

      {tab === 'documents' && (
        <div className="space-y-4">
          {staff && (
            <div className="flex justify-end">
              <PrimaryButton onClick={() => setShowAddDoc(true)}><Plus className="w-4 h-4" /> {ar ? 'إضافة ملف' : 'Add File'}</PrimaryButton>
            </div>
          )}
          {!data.documents?.length ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 shadow-sm">{ar ? 'لا توجد ملفات مرفوعة' : 'No files uploaded'}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.documents.map((d) => {
                const exp = expiryBadge(d.expiryDate, lang);
                return (
                  <div key={d._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-2">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#f37121]/15 flex items-center justify-center text-[#f37121] shrink-0"><FileText className="w-5 h-5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-900 font-medium truncate" title={d.title}>{d.title}</p>
                        <p className="text-slate-500 text-xs">{docCategoryLabel(d.category || 'other', lang)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                      <span>{fmtDate(d.createdAt)}</span>
                      {d.uploadedBy && <span>· {userName(d.uploadedBy)}</span>}
                      {d.expiryDate && exp && <SmallBadge bg={exp.bg} text={exp.text} label={exp.label} />}
                    </div>
                    <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100 text-xs"><ExternalLink className="w-3.5 h-3.5" /> {ar ? 'فتح' : 'Open'}</a>
                      {staff && <button type="button" onClick={() => setEditDoc(d)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:text-[#f37121] hover:bg-slate-100 text-xs"><Edit className="w-3.5 h-3.5" /> {ar ? 'تعديل' : 'Edit'}</button>}
                      {staff && <DeleteDocBtn doc={d} ar={ar} onDone={load} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'leaves' && (
        <DataCard empty={!data.leaves.length} emptyText={tx.noLeaves}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{tx.colType}</Th><Th>{tx.colFrom}</Th><Th>{tx.colTo}</Th><Th>{tx.colDays}</Th><Th>{tx.colStatus}</Th><Th>{tx.colSubmitted}</Th>
            </tr></thead>
            <tbody>{data.leaves.map((l) => (
              <Tr key={l._id}>
                <Td className="text-slate-900">{leaveTypeLabel(l.leaveType, lang)}</Td>
                <Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td><Td>{l.days}</Td>
                <Td><Badge style={LEAVE_STATUS[l.status]} lang={lang} /></Td>
                <Td>{fmtDate(l.createdAt)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'custody' && (
        <DataCard empty={!data.assets.length} emptyText={tx.noCustodyItems}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{tx.colItem}</Th><Th>{tx.colType}</Th><Th>{tx.colSerial}</Th><Th>{tx.colCondition}</Th><Th>{tx.colStatus}</Th><Th>{tx.colAssigned}</Th>
            </tr></thead>
            <tbody>{data.assets.map((a) => (
              <Tr key={a._id}>
                <Td className="text-slate-900">{a.name}</Td><Td>{assetTypeLabel(a.type, lang)}</Td><Td>{a.serialNumber || '—'}</Td>
                <Td>{a.condition ? conditionLabel(a.condition, lang) : '—'}</Td>
                <Td>{a.status === 'assigned' ? <SmallBadge bg="bg-amber-500/20" text="text-amber-700" label={tx.assigned} /> : <SmallBadge bg="bg-green-500/20" text="text-green-600" label={tx.returned} />}</Td>
                <Td>{fmtDate(a.assignedDate)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'vehicles' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-[#f37121] text-sm font-semibold mb-3">{vtx.empCurrentVehicle}</h3>
            {vehicleData?.current ? (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <Link href={`/system/vehicles/${typeof vehicleData.current.vehicle === 'object' ? (vehicleData.current.vehicle as any)?._id : vehicleData.current.vehicle}`} className="text-slate-900 font-bold text-lg hover:text-[#f37121]">{plateOf(vehicleData.current.vehicle)}</Link>
                  <p className="text-slate-500 text-sm mt-1">
                    {vehicleTypeLabel(typeof vehicleData.current.vehicle === 'object' ? (vehicleData.current.vehicle as any)?.type : '', lang)}
                    {' · '}{vtx.since} {fmtDate(vehicleData.current.startDate)}
                    {vehicleData.current.authorizationType ? ` · ${vehicleData.current.authorizationType}` : ''}
                  </p>
                </div>
                <Badge style={AUTH_STATUS[vehicleData.current.status]} lang={lang} />
              </div>
            ) : <p className="text-slate-400 text-sm">{vtx.empNoCurrentVehicle}</p>}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-900 font-semibold mb-4">{vtx.empAuthHistory}</h3>
            {!vehicleData?.authorizations.length ? <p className="text-slate-400 text-sm text-center py-6">{vtx.noAuthorizations}</p> : (
              <ol className={`relative ${isRTL ? 'border-r pr-5' : 'border-l pl-5'} border-slate-200 space-y-5`}>
                {vehicleData.authorizations.map((a) => (
                  <li key={a._id} className="relative">
                    <span className={`absolute ${isRTL ? '-right-[27px]' : '-left-[27px]'} top-1 w-3 h-3 rounded-full ${a.status === 'active' ? 'bg-green-500' : a.status === 'revoked' ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/system/vehicles/${typeof a.vehicle === 'object' ? (a.vehicle as any)?._id : a.vehicle}`} className="text-slate-900 font-medium hover:text-[#f37121]">{plateOf(a.vehicle)}</Link>
                      <Badge style={AUTH_STATUS[a.status]} lang={lang} />
                    </div>
                    <p className="text-slate-500 text-xs mt-1">{vtx.period}: {fmtDate(a.startDate)} → {a.endDate ? fmtDate(a.endDate) : (ar ? 'حتى الآن' : 'now')}</p>
                    {a.revokedReason && <p className="text-slate-500 text-xs">{vtx.revokedReason}: {a.revokedReason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <DataCard empty={!vehicleData?.accidents.length} emptyText={vtx.noAccidents}>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
                <Th>{vtx.date}</Th><Th>{vtx.plateNumber}</Th><Th>{vtx.description}</Th><Th>{vtx.faultParty}</Th><Th>{vtx.severity}</Th><Th>{vtx.status}</Th>
              </tr></thead>
              <tbody>{(vehicleData?.accidents || []).map((a) => (
                <Tr key={a._id}>
                  <Td>{fmtDate(a.date)}</Td>
                  <Td className="text-slate-900">{plateOf(a.vehicle)}</Td>
                  <Td>{a.description}</Td>
                  <Td>{faultPartyLabel(a.faultParty, lang)}</Td>
                  <Td><Badge style={ACCIDENT_SEVERITY[a.severity || 'minor']} lang={lang} /></Td>
                  <Td><Badge style={ACCIDENT_STATUS[a.status || 'reported']} lang={lang} /></Td>
                </Tr>
              ))}</tbody>
            </table>
          </DataCard>
        </div>
      )}

      {tab === 'contracts' && (
        <div className="space-y-3">
          {staff && (
            <div className="flex justify-end">
              <PrimaryButton onClick={() => { setEditingContract(null); setShowContract(true); }}><Plus className="w-4 h-4" /> {ar ? 'إضافة عقد' : 'Add contract'}</PrimaryButton>
            </div>
          )}
          <DataCard empty={!data.contracts.length} emptyText={tx.noContracts}>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
                <Th>{tx.colType}</Th><Th>{tx.colStart}</Th><Th>{tx.colEnd}</Th><Th>{tx.colAnnualLeave}</Th><Th>{tx.colSalary}</Th><Th>{tx.colStatus}</Th>{staff && <Th>{ar ? 'إجراء' : 'Action'}</Th>}
              </tr></thead>
              <tbody>{data.contracts.map((c) => (
                <Tr key={c._id}>
                  <Td className="text-slate-900">{c.type === 'unlimited' ? tx.contractUnlimited : tx.contractFixed}</Td>
                  <Td>{fmtDate(c.startDate)}</Td><Td>{c.endDate ? fmtDate(c.endDate) : '—'}</Td>
                  <Td>{c.annualLeaveDays} {tx.dayUnit}</Td><Td>{(c.basicSalary || 0).toLocaleString()}</Td>
                  <Td><Badge style={CONTRACT_STATUS[c.status]} lang={lang} /></Td>
                  {staff && <Td><button type="button" onClick={() => { setEditingContract(c); setShowContract(true); }} className="p-1 rounded text-slate-500 hover:text-[#f37121]" title={ar ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button></Td>}
                </Tr>
              ))}</tbody>
            </table>
          </DataCard>
        </div>
      )}

      {tab === 'requests' && (
        <DataCard empty={!data.requests.length} emptyText={tx.noRequests}>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <Th>{tx.colSubject}</Th><Th>{tx.colStatus}</Th><Th>{tx.colDate}</Th>
            </tr></thead>
            <tbody>{data.requests.map((r) => (
              <Tr key={r._id}>
                <Td className="text-slate-900">{r.subject}</Td>
                <Td><Badge style={REQUEST_STATUS[r.status]} lang={lang} /></Td>
                <Td>{fmtDateTime(r.createdAt)}</Td>
              </Tr>
            ))}</tbody>
          </table>
        </DataCard>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          {/* Renewals */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-900 font-semibold mb-4">{ar ? 'سجل التجديدات' : 'Renewals'}</h3>
            {!data.renewals?.length ? <p className="text-slate-400 text-sm text-center py-4">{ar ? 'لا توجد تجديدات' : 'No renewals yet'}</p> : (
              <div className="space-y-3">
                {data.renewals.map((r) => (
                  <div key={r._id} className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-100 pb-3 last:border-0">
                    <div>
                      <span className="text-slate-900 font-medium">{renewalTypeLabel(r.docType, lang)}</span>
                      <span className="text-slate-500 text-sm"> · {r.previousExpiry ? fmtDate(r.previousExpiry) : '—'} → {fmtDate(r.newExpiry)}</span>
                      {r.documentNumber && <span className="text-slate-500 text-xs"> · {r.documentNumber}</span>}
                      {r.notes && <p className="text-slate-500 text-xs mt-0.5">{r.notes}</p>}
                    </div>
                    <span className="text-slate-400 text-xs">{fmtDate(r.renewedAt)} {r.renewedBy ? `· ${userName(r.renewedBy)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Audit */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-900 font-semibold mb-4">{ar ? 'سجل التغييرات' : 'Change Log'}</h3>
            {!audit.length ? <p className="text-slate-400 text-sm text-center py-4">{ar ? 'لا يوجد سجل بعد' : 'No history yet'}</p> : (
              <ol className={`relative ${isRTL ? 'border-r pr-5' : 'border-l pl-5'} border-slate-200 space-y-4`}>
                {audit.map((a) => (
                  <li key={a._id} className="relative">
                    <span className={`absolute ${isRTL ? '-right-[27px]' : '-left-[27px]'} top-1 w-3 h-3 rounded-full bg-[#f37121]`} />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-900 font-medium text-sm">{auditActionLabel(a.action, lang)}</span>
                      <span className="text-slate-400 text-xs">{fmtDateTime(a.createdAt)} {a.user ? `· ${userName(a.user)}` : ''}</span>
                    </div>
                    {a.changes?.after && typeof a.changes.after === 'object' && (
                      <p className="text-slate-500 text-xs mt-1">
                        {Object.keys(a.changes.after).slice(0, 8).join('، ')}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <EmployeeFormModal open={showEdit} employee={e} onClose={() => setShowEdit(false)} onSaved={() => load()} />
      <ContractFormModal open={showContract} contract={editingContract} employeeId={String(e._id)} onClose={() => setShowContract(false)} onSaved={() => load()} />
      <RenewModal open={showRenew} employeeId={id} ar={ar} onClose={() => setShowRenew(false)} onDone={load} />
      <TerminateModal open={showTerminate} employeeId={id} ar={ar} onClose={() => setShowTerminate(false)} onDone={load} />
      <DocModal open={showAddDoc || !!editDoc} doc={editDoc} employeeId={id} ar={ar} onClose={() => { setShowAddDoc(false); setEditDoc(null); }} onDone={load} />
    </div>
  );
}

// ── Small UI bits ──────────────────────────────────────────────────────────────
function ActionBtn({ onClick, icon, label, primary, danger }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean; danger?: boolean }) {
  const cls = primary
    ? 'bg-[#f37121] text-white hover:bg-[#e06010]'
    : danger
      ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50'
      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100';
  return <button type="button" onClick={onClick} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${cls}`}>{icon} {label}</button>;
}

function DeleteDocBtn({ doc, ar, onDone }: { doc: EmployeeDocument; ar: boolean; onDone: () => void }) {
  const { confirm, notify } = useDialog();
  const del = async () => {
    if (!(await confirm(ar ? `حذف الملف "${doc.title}"؟` : `Delete "${doc.title}"?`))) return;
    try { await api.delete(`/api/hr/documents/${doc._id}`); onDone(); } catch (e: any) { notify(e.message, 'error'); }
  };
  return <button type="button" onClick={del} className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:text-red-600 hover:bg-slate-100 text-xs"><Trash2 className="w-3.5 h-3.5" /> {ar ? 'حذف' : 'Delete'}</button>;
}

// Renew a dated document (iqama / license / insurance ...).
function RenewModal({ open, employeeId, ar, onClose, onDone }: { open: boolean; employeeId: string; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const [docType, setDocType] = useState('iqama');
  const [newExpiry, setNewExpiry] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setDocType('iqama'); setNewExpiry(''); setDocumentNumber(''); setNotes(''); } }, [open]);
  const save = async () => {
    if (!newExpiry) return;
    setSaving(true);
    try { await api.post(`/api/hr/employees/${employeeId}/renew`, { docType, newExpiry, documentNumber, notes }); onDone(); onClose(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };
  return (
    <Modal open={open} onClose={onClose} title={ar ? 'تجديد مستند' : 'Renew Document'}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <PrimaryButton onClick={save} disabled={saving || !newExpiry}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}</PrimaryButton>
      </>}>
      <Field label={ar ? 'نوع المستند' : 'Document'}>
        <Select aria-label={ar ? 'نوع المستند' : 'Document type'} value={docType} onChange={(ev) => setDocType(ev.target.value)}>
          {RENEWAL_TYPES.map((t) => <option key={t.key} value={t.key}>{renewalTypeLabel(t.key, lang)}</option>)}
        </Select>
      </Field>
      <Field label={ar ? 'تاريخ الانتهاء الجديد' : 'New expiry date'}><TextInput type="date" value={newExpiry} onChange={(ev) => setNewExpiry(ev.target.value)} /></Field>
      <Field label={ar ? 'الرقم الجديد (اختياري)' : 'New number (optional)'}><TextInput value={documentNumber} onChange={(ev) => setDocumentNumber(ev.target.value)} /></Field>
      <Field label={ar ? 'ملاحظات' : 'Notes'}><TextArea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
    </Modal>
  );
}

// End of service.
function TerminateModal({ open, employeeId, ar, onClose, onDone }: { open: boolean; employeeId: string; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setReason(''); setDate(''); } }, [open]);
  const save = async () => {
    setSaving(true);
    try { await api.post(`/api/hr/employees/${employeeId}/terminate`, { reason, date: date || undefined }); onDone(); onClose(); }
    catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };
  return (
    <Modal open={open} onClose={onClose} title={ar ? 'إنهاء الخدمة' : 'End Service'}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}{ar ? 'تأكيد الإنهاء' : 'Confirm'}</button>
      </>}>
      <p className="text-slate-500 text-sm">{ar ? 'سيتم تحديث الحالة إلى "منتهي" وإنهاء العقد الساري. يجب إرجاع العهدة أولاً.' : 'Status becomes “terminated” and the active contract is ended. Custody must be returned first.'}</p>
      <Field label={ar ? 'تاريخ الإنهاء' : 'Date'}><TextInput type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></Field>
      <Field label={ar ? 'السبب' : 'Reason'}><TextArea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
    </Modal>
  );
}

// Add / edit a document. When `doc` is set we edit metadata only (no re-upload).
function DocModal({ open, doc, employeeId, ar, onClose, onDone }: { open: boolean; doc: EmployeeDocument | null; employeeId: string; ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const { lang } = useLanguage();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(doc?.title || '');
    setCategory(doc?.category || 'other');
    setExpiryDate(doc?.expiryDate || '');
    setNotes(doc?.notes || '');
    setDataUrl(''); setFileName('');
  }, [open, doc]);

  const onFile = (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!title.trim()) return;
    if (!doc && !dataUrl) { notify(ar ? 'اختر ملفاً أولاً' : 'Pick a file first'); return; }
    setSaving(true);
    try {
      if (doc) await api.put(`/api/hr/documents/${doc._id}`, { title, category, expiryDate, notes });
      else await api.post(`/api/hr/employees/${employeeId}/documents`, { title, category, expiryDate, notes, dataUrl, fileName });
      onDone(); onClose();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={doc ? (ar ? 'تعديل ملف' : 'Edit File') : (ar ? 'إضافة ملف' : 'Add File')}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
        <PrimaryButton onClick={save} disabled={saving || !title.trim()}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}</PrimaryButton>
      </>}>
      {!doc && (
        <Field label={ar ? 'الملف (صورة / PDF)' : 'File (image / PDF)'}>
          <input type="file" aria-label={ar ? 'اختيار ملف' : 'Choose file'} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(ev) => onFile(ev.target.files?.[0])}
            className="w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-[#f37121] file:text-white file:px-3 file:py-2 file:text-sm" />
          {fileName && <p className="text-slate-500 text-xs mt-1">{fileName}</p>}
        </Field>
      )}
      <Field label={ar ? 'اسم الملف / الوصف' : 'Name / description'}><TextInput value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder={ar ? 'مثال: صورة الإقامة' : 'e.g. Iqama scan'} /></Field>
      <Field label={ar ? 'التصنيف' : 'Category'}>
        <Select aria-label={ar ? 'التصنيف' : 'Category'} value={category} onChange={(ev) => setCategory(ev.target.value)}>
          {DOCUMENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{docCategoryLabel(c.key, lang)}</option>)}
        </Select>
      </Field>
      <Field label={ar ? 'تاريخ انتهاء المستند (اختياري)' : 'Document expiry (optional)'}><TextInput type="date" value={expiryDate} onChange={(ev) => setExpiryDate(ev.target.value)} /></Field>
      <Field label={ar ? 'ملاحظات' : 'Notes'}><TextArea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
    </Modal>
  );
}

function Overview({ e, lang, tx, vtx }: { e: Employee; lang: 'en' | 'ar'; tx: ReturnType<typeof getHrEmployeesIdTranslations>; vtx: ReturnType<typeof getVehiclesText> }) {
  const rows: [string, any][] = [
    [tx.arabicName, e.arabicName],
    [tx.nationality, e.nationality],
    [tx.gender, e.gender ? (e.gender === 'male' ? tx.male : tx.female) : ''],
    [tx.dateOfBirth, fmtDate(e.dateOfBirth)],
    [tx.idType, e.idType === 'national_id' ? tx.idTypeNational : tx.idTypeIqama],
    [tx.iqamaNumber, e.iqamaNumber],
    [tx.nationalId, e.nationalId],
    [tx.passport, e.passportNumber],
    [tx.qiwaContract, e.qiwaContractNumber],
    [tx.gosiNumber, e.gosiNumber],
    [tx.absherStatus, e.absherStatus],
    [tx.sponsor, e.sponsorName],
    [tx.hireDate, fmtDate(e.hireDate)],
    [tx.actualWorkStartDate, fmtDate(e.actualWorkStartDate)],
    [tx.workLocation, e.workLocation],
    [tx.directManager, userName(e.directManager)],
    [tx.phone, e.phone],
    [tx.email, e.email],
    [tx.address, e.address],
    [tx.emergencyContact, e.emergencyContactName ? `${e.emergencyContactName} ${e.emergencyContactPhone || ''}` : ''],
    [tx.basicSalary, e.basicSalary ? e.basicSalary.toLocaleString() : ''],
    [vtx.iban, e.iban],
    [vtx.bank, e.bank],
    [vtx.project2, e.project],
    [vtx.registerNumber, e.registerNumber],
    [vtx.absherNumber, e.absherNumber],
    [vtx.iqamaProfession, e.iqamaProfession],
    [vtx.penaltyClause, e.penaltyClause ? e.penaltyClause.toLocaleString() : ''],
    [vtx.insuranceCompany, e.insuranceCompany],
    [vtx.insuranceExpiry, fmtDate(e.insuranceExpiry)],
    [vtx.socialInsuranceStatus, e.socialInsuranceStatus],
    [vtx.visaExpiry, fmtDate(e.visaExpiry)],
    [vtx.classification, e.classification],
    [vtx.fileStatus, e.fileStatus],
    [vtx.vehiclePlate, e.vehiclePlate],
    [vtx.licenseNumber, e.licenseNumber],
    [vtx.licenseType, e.licenseType],
    [vtx.licenseExpiry, fmtDate(e.licenseExpiry)],
    [vtx.driverCardNumber, e.driverCardNumber],
    [vtx.driverCardType, e.driverCardType],
    [vtx.driverCardExpiry, fmtDate(e.driverCardExpiry)],
  ];
  const iqamaB = expiryBadge(e.iqamaExpiry, lang);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
        {rows.filter(([, v]) => v && v !== '—').map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-slate-200/70 pb-2">
            <span className="text-slate-500 text-sm">{k}</span>
            <span className="text-slate-900 text-sm text-end">{v}</span>
          </div>
        ))}
        {e.iqamaExpiry && (
          <div className="flex justify-between gap-4 border-b border-slate-200/70 pb-2">
            <span className="text-slate-500 text-sm">{tx.iqamaExpiry}</span>
            <span className="text-slate-900 text-sm flex items-center gap-2">{fmtDate(e.iqamaExpiry)} {iqamaB && <SmallBadge bg={iqamaB.bg} text={iqamaB.text} label={iqamaB.label} />}</span>
          </div>
        )}
      </div>
      {e.notes && <p className="text-slate-500 text-sm mt-4 border-t border-slate-200 pt-4">{e.notes}</p>}
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="text-start font-medium px-4 py-3">{children}</th>;
const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => <td className={`px-4 py-3 text-slate-700 ${className || ''}`}>{children}</td>;
const Tr = ({ children }: { children: React.ReactNode }) => <tr className="border-b border-slate-200/70 hover:bg-slate-100">{children}</tr>;

function DataCard({ children, empty, emptyText }: { children: React.ReactNode; empty?: boolean; emptyText: string }) {
  if (empty) return <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 shadow-sm">{emptyText}</div>;
  return <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">{children}</div>;
}
