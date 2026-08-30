'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { CalendarCheck, Check, X, FileDown, PenTool, CalendarPlus, History } from 'lucide-react';
import { isHRStaff, LeaveRequest, LEAVE_STATUS, empName, userName, fmtDate, leaveTypeLabel } from '@/lib/hr';
import { Spinner, PageHeader, SearchInput, Badge, Modal, TextArea, PrimaryButton, SearchableSelect, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { getHrLeavesTranslations } from '@/lib/translations';
import { downloadLeaveSheet } from '@/lib/leavePdf';
import type { Signature } from '@/components/SignatureManager';
import FilePicker, { AttachmentList, type PickedFile } from '@/components/system/FilePicker';

export default function HRLeavesPage() {
  const { notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getHrLeavesTranslations(lang);
  const staff = isHRStaff(user);

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [review, setReview] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // ورقةُ القرار: تقريرُ الطبيب المعتمد، أو خطابُ الرفض بسببه.
  const [files, setFiles] = useState<PickedFile[]>([]);
  // ── تقييدُ إجازةٍ وقعت فعلًا ────────────────────────────────────────
  // كثيرٌ من الإجازات تُؤخذ قبل النظام أو تُتّفق شفاهةً ثمّ تُقيَّد.
  // وما لم تُسجَّل بقي الموظّف في الورق مستحقًّا ثلاثين يومًا وقد أخذ
  // اثنَي عشر. تُقيَّد معتمَدةً وتُخصَم كأخواتها، وتُوسَم «قيد رجعيّ».
  const [showBack, setShowBack] = useState(false);
  const [backForm, setBackForm] = useState<any>({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' });
  const [backFiles, setBackFiles] = useState<PickedFile[]>([]);
  const [backSaving, setBackSaving] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [mySigs, setMySigs] = useState<Signature[]>([]);
  const [signWith, setSignWith] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');
  const t = (en: string, a: string) => (ar ? a : en);

  const load = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<{ leaves: LeaveRequest[] }>(`/api/hr/leaves${qs}`);
      setLeaves(d.leaves || []);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ signatures: Signature[] }>('/api/auth/signatures').then((r) => setMySigs(r.signatures || [])).catch(() => {}); }, []);
  // تُجلب مرّةً واحدة عند أوّل فتحٍ للنموذج، لا مع كلّ زيارةٍ للصفحة.
  useEffect(() => {
    if (!showBack || employees.length) return;
    // القائمةُ الخفيفة لا المستندُ الكامل: سبعةُ حقولٍ لأربع مئة موظّف تصل
    // في لحظة، بينما المستندُ الكامل (خمسون حقلًا) كان يجمّد القائمةَ عند فتحها.
    api.get<{ employees: any[] }>('/api/hr/employees/search?limit=2000').then((d) => setEmployees(d.employees || [])).catch(() => {});
    api.get<{ leaveTypes: any[] }>('/api/hr/leave-types').then((d) => setTypes(d.leaveTypes || [])).catch(() => {});
  }, [showBack, employees.length]);

  const days = (() => {
    const { startDate, endDate } = backForm;
    if (!startDate || !endDate || endDate < startDate) return 0;
    return Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
  })();

  const saveBackdated = async () => {
    if (!backForm.employee || !backForm.leaveType || !backForm.startDate || !backForm.endDate) {
      notify(ar ? 'اختر الموظّف ونوع الإجازة والتاريخين' : 'Pick the employee, the leave type and both dates', 'error');
      return;
    }
    setBackSaving(true);
    try {
      const r = await api.post<any>('/api/hr/leaves/backdated', {
        ...backForm,
        files: backFiles.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      const b = r?.balance;
      notify(ar
        ? `سُجّلت ${days} يوم${b ? ` — الرصيد المتبقّي ${b.available} يوم` : ''}`
        : `Recorded ${days} day(s)${b ? ` — remaining balance ${b.available}` : ''}`, 'success');
      setShowBack(false);
      setBackForm({ employee: '', leaveType: '', startDate: '', endDate: '', reason: '' });
      setBackFiles([]);
      load();
    } catch (e: any) { notify(e?.message || (ar ? 'تعذّر التسجيل' : 'Could not record'), 'error'); }
    setBackSaving(false);
  };
  useSocket('hr:leave', useCallback(() => load(), [load]));

  const openReview = (l: LeaveRequest) => { setReview(l); setNote(''); setSignWith(''); setFiles([]); };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!review) return;
    setBusy(true);
    try {
      await api.patch(`/api/hr/leaves/${review._id}/decision`, {
        decision, note, signatureId: signWith || undefined,
        files: files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      setReview(null); setNote(''); setSignWith(''); setFiles([]); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBusy(false);
  };

  // Fetch the full leave (with signatures) then build the official PDF sheet.
  const downloadPdf = async (id: string) => {
    setPdfBusy(id);
    try {
      const { leave } = await api.get<{ leave: any }>(`/api/hr/leaves/${id}`);
      await downloadLeaveSheet(leave, lang as 'ar' | 'en');
    } catch (e: any) { notify(e.message || 'PDF failed', 'error'); }
    setPdfBusy('');
  };

  const filtered = leaves.filter((l) => {
    if (!search.trim()) return true;
    return empName(l.employee).toLowerCase().includes(search.toLowerCase()) || userName(l.requester).toLowerCase().includes(search.toLowerCase());
  });
  const pendingCount = leaves.filter((l) => l.status === 'pending_manager' || l.status === 'pending_hr').length;

  const exportColumns: ExportColumn[] = [
    { header: 'Employee', key: 'employee', transform: (v: any) => empName(v), width: 22 },
    { header: 'Type', key: 'leaveType', transform: (v: any) => leaveTypeLabel(v, 'en'), width: 16 },
    { header: 'From', key: 'startDate', width: 14 },
    { header: 'To', key: 'endDate', width: 14 },
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Reason', key: 'reason', width: 28 },
  ];
  // فلتر الحالة يمرّ على الخادم، فحين يكون «قيد الاعتماد» مثلًا لا تحمل الذاكرة
  // سواه؛ فـ«الكلّ» يعيد النداء بلا حالةٍ وإلّا خرج سجلُّ الإجازات مبتورًا.
  const fetchAllLeaves = async () => {
    const d = await api.get<{ leaves: LeaveRequest[] }>('/api/hr/leaves');
    return [{ name: 'Leaves', rows: d.leaves || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: 'Leaves', rows: filtered, columns: exportColumns }] },
    statusFilter
      ? { key: 'all', label: scope.all, resolve: fetchAllLeaves }
      : { key: 'all', label: scope.all, sheets: [{ name: 'Leaves', rows: leaves, columns: exportColumns }] },
  ];

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<CalendarCheck className="w-5 h-5" />} title={tx.pageTitle} subtitle={`${pendingCount} ${tx.pending}`}>
        <button type="button" onClick={() => setShowBack(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors">
          <CalendarPlus className="w-4 h-4" /> {ar ? 'تسجيل إجازة قديمة' : 'Record a past leave'}
        </button>
        <ExportMenu fileName="leaves" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx.exportExcel} options={exportOptions} />
      </PageHeader>

      <Modal open={showBack} onClose={() => setShowBack(false)}
        title={ar ? 'تسجيل إجازة وقعت فعلًا' : 'Record a leave that already happened'}
        footer={<>
          <button type="button" onClick={() => setShowBack(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveBackdated} disabled={backSaving || !days}>
            {backSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {ar ? 'تسجيل' : 'Record'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-500 text-xs">
            {ar
              ? 'تُسجَّل معتمَدةً مباشرةً وتُخصَم من الرصيد — لا تمرّ بمديرٍ ولا بمهلة إخطار، فالماضي لا يُوافَق عليه. ويبقى في السجلّ أنّها قيدٌ رجعيّ باسم من قيّدها.'
              : 'Recorded as approved and deducted from the balance — no manager step and no notice rule, since the past is not approved. The log keeps that it was back-dated and by whom.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* ── يُبحَث لا يُتصفَّح ────────────────────────────────────────────
                أربعُ مئةِ اسمٍ في قائمةٍ منسدلةٍ لا تُقرأ بالتمرير. والبحثُ
                يشمل الاسمَ ورقمَ الإقامة والرقمَ الوظيفيّ معًا، ويطوي همزاتِ
                العربيّة فـ«احمد» تجد «أحمد». */}
            <div className="sm:col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'الموظّف' : 'Employee'}</label>
              <SearchableSelect
                value={backForm.employee}
                onChange={(v) => setBackForm((f: any) => ({ ...f, employee: v }))}
                placeholder={ar ? '— اختر الموظّف —' : '— pick the employee —'}
                searchPlaceholder={ar ? 'ابحث بالاسم أو الإقامة أو الرقم الوظيفي…' : 'name, ID or employee number…'}
                emptyLabel={employees.length ? undefined : (ar ? 'جارٍ التحميل…' : 'Loading…')}
                options={employees.map((e) => ({
                  value: e._id,
                  label: [
                    (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim()) || '—',
                    e.employeeNumber ? `#${e.employeeNumber}` : '',
                    e.iqamaNumber || e.nationalId || '',
                  ].filter(Boolean).join(' · '),
                }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'نوع الإجازة' : 'Leave type'}</label>
              <SearchableSelect
                value={backForm.leaveType}
                onChange={(v) => setBackForm((f: any) => ({ ...f, leaveType: v }))}
                placeholder={ar ? '— اختر نوع الإجازة —' : '— pick the leave type —'}
                searchPlaceholder={ar ? 'ابحث…' : 'search…'}
                // الخصمُ صفةُ النوع لا سؤالٌ يُطرح هنا — فيُقال في الاسم كي
                // يعرف من يختار ما سيحدث للرصيد قبل أن يسجّل.
                options={types.map((t) => ({
                  value: t._id,
                  label: `${ar ? t.nameAr : t.nameEn}${t.affectsBalance === false ? (ar ? ' — لا تُخصَم من الرصيد' : ' — no balance deduction') : (ar ? ' — تُخصَم من الرصيد' : ' — deducted from balance')}`,
                }))}
              />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'من' : 'From'}</label>
              <input type="date" value={backForm.startDate} onChange={(e) => setBackForm((f: any) => ({ ...f, startDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light]" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">{ar ? 'إلى' : 'To'}</label>
              <input type="date" value={backForm.endDate} min={backForm.startDate || undefined}
                onChange={(e) => setBackForm((f: any) => ({ ...f, endDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm [color-scheme:light]" />
            </div>
          </div>
          {!!days && (
            <p className="text-slate-900 text-sm font-semibold">
              {ar ? `المدّة: ${days} يوم` : `Duration: ${days} day(s)`}
            </p>
          )}
          <div>
            <label className="text-slate-500 text-xs mb-1 block">{ar ? 'السبب / ملاحظة' : 'Reason / note'}</label>
            <TextArea rows={2} value={backForm.reason} onChange={(e: any) => setBackForm((f: any) => ({ ...f, reason: e.target.value }))} />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">{ar ? 'مرفقات (اختياري)' : 'Attachments (optional)'}</label>
            <FilePicker files={backFiles} onChange={setBackFiles} max={5} />
          </div>
        </div>
      </Modal>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-44 shrink-0 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
          <option value="">{tx.allStatuses}</option>
          {Object.entries(LEAVE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{tx.colEmployee}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colType}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colPeriod}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colDays}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colBalance}</th>
            <th className="text-start font-semibold px-4 py-3">{tx.colStatus}</th>
            <th className="text-end font-semibold px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-800 py-12">{tx.noRequests}</td></tr>
            ) : filtered.map((l) => {
              const over = l.balanceSnapshot && typeof l.balanceSnapshot.remainingAfter === 'number' && l.balanceSnapshot.remainingAfter < 0;
              return (
                <tr key={l._id} className="border-b border-slate-200/70 hover:bg-slate-100 cursor-pointer" onClick={() => openReview(l)}>
                  <td className="px-4 py-3 text-slate-900 font-medium">{empName(l.employee, lang)}</td>
                  <td className="px-4 py-3 text-slate-700">{leaveTypeLabel(l.leaveType, lang)}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                  <td className="px-4 py-3 text-slate-700">{l.days}</td>
                  <td className="px-4 py-3"><span className={over ? 'text-red-600' : 'text-slate-700'}>{l.balanceSnapshot?.accrued ?? '—'}{over ? ` ${tx.over}` : ''}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge style={LEAVE_STATUS[l.status]} lang={lang} />
                      {/* «طلبَ فوافقتُ» غيرُ «أخبرني فقيّدتُ» — والفرقُ يبقى مقروءًا. */}
                      {(l as any).backdated && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600"
                          title={(l as any).recordedByName ? `${ar ? 'قيّدها' : 'Recorded by'} ${(l as any).recordedByName}` : ''}>
                          <History className="w-3 h-3" /> {ar ? 'قيد رجعيّ' : 'Back-dated'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button type="button" title={t('Download PDF', 'تحميل PDF')} onClick={(e) => { e.stopPropagation(); downloadPdf(l._id); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#f37121]/10 hover:text-[#f37121] text-slate-600 text-xs">
                      {pdfBusy === l._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!review} onClose={() => setReview(null)} title={tx.reviewTitle}
        footer={review && (review.status === 'pending_manager' || review.status === 'pending_hr') ? <>
          <button type="button" onClick={() => decide('rejected')} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-50"><X className="w-4 h-4" /> {tx.reject}</button>
          <PrimaryButton onClick={() => decide('approved')} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {tx.approve}</PrimaryButton>
        </> : undefined}>
        {review && (
          <div className="space-y-3 text-sm">
            <Row k={tx.fieldEmployee} v={empName(review.employee, lang)} />
            <Row k={tx.fieldRequester} v={userName(review.requester)} />
            <Row k={tx.fieldType} v={leaveTypeLabel(review.leaveType, lang)} />
            <Row k={tx.fieldPeriod} v={`${fmtDate(review.startDate)} → ${fmtDate(review.endDate)} (${review.days} ${tx.dayUnit})`} />
            <Row k={tx.fieldAccrued} v={`${review.balanceSnapshot?.accrued ?? '—'} ${tx.dayUnit}`} />
            <Row k={tx.fieldRemainingAfter} v={`${review.balanceSnapshot?.remainingAfter ?? '—'} ${tx.dayUnit}`} danger={typeof review.balanceSnapshot?.remainingAfter === 'number' && review.balanceSnapshot.remainingAfter < 0} />
            <Row k={tx.fieldStatus} v={<Badge style={LEAVE_STATUS[review.status]} lang={lang} />} />
            {review.reason && <div className="border-t border-slate-200 pt-3"><span className="text-slate-500">{tx.fieldReason}: </span><span className="text-slate-900">{review.reason}</span></div>}
            {/* سندُ الطلب يُقرأ قبل البتّ فيه: تقريرُ الطبيب لا يُطلب على
                الواتساب ثمّ يُوافَق هنا على غير أساس. */}
            {!!((review as any).attachments || []).length && (
              <div className="border-t border-slate-200 pt-3">
                <p className="text-slate-500 text-xs mb-1">{ar ? 'مرفقات الموظّف' : 'Employee attachments'}</p>
                <AttachmentList items={(review as any).attachments} />
              </div>
            )}
            {review.managerDecision?.decision && <p className="text-xs text-slate-500">{tx.managerDecision}: {review.managerDecision.decision} {review.managerDecision.note ? `— ${review.managerDecision.note}` : ''}</p>}
            {(review.status === 'pending_manager' || review.status === 'pending_hr') && (
              <div className="border-t border-slate-200 pt-3 space-y-3">
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{tx.noteOptional}</label>
                  <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div>
                  <label className="text-slate-500 text-xs mb-1 block">{ar ? 'مرفقات القرار (اختياري)' : 'Decision attachments (optional)'}</label>
                  <FilePicker files={files} onChange={setFiles} max={5} />
                </div>
                {/* Optional: sign this approval with one of your signatures */}
                <div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!signWith} disabled={mySigs.length === 0}
                      onChange={(e) => setSignWith(e.target.checked ? (mySigs.find((s) => s.isDefault)?._id || mySigs[0]?._id || '') : '')} />
                    <PenTool className="w-4 h-4 text-[#f37121]" /> {t('Sign this approval', 'أوقّع على الموافقة')}
                  </label>
                  {/* ── ولا يُقال «اعمل توقيعًا أوّلًا» بلا باب ──────────────
                      كانت الخانةُ معطّلةً والجملةُ تحتها تحيل إلى «الإعدادات»
                      ولا رابطَ إليها، وصفحةُ الإعدادات نفسُها كانت مخفيّةً عن
                      أكثر الأدوار — فيقف المدير أمام بابٍ مغلقٍ لا مقبضَ له.
                      صار السطرُ رابطًا يفتحها في تبويبٍ جديد فلا يضيع ما كُتب
                      في المراجعة. */}
                  {mySigs.length === 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t('You have no signature yet — ', 'ما عندكش توقيع لسه — ')}
                      <a href="/system/settings" target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-[#f37121] hover:underline">
                        {t('create one in Settings', 'اعمل واحد من الإعدادات')}
                      </a>
                      {t(' (opens in a new tab), then reopen this review.', ' (هيفتح في تبويب جديد)، وبعدين افتح المراجعة تاني.')}
                    </p>
                  )}
                  {signWith && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {mySigs.map((s) => (
                        <button key={s._id} type="button" onClick={() => setSignWith(s._id)} className={`border rounded-lg p-1 bg-white ${signWith === s._id ? 'border-[#f37121] ring-1 ring-[#f37121]' : 'border-slate-200'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.dataUrl} alt={s.name} className="h-9 w-20 object-contain" />
                          <div className="text-[10px] text-slate-500 text-center truncate w-20">{s.name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="border-t border-slate-200 pt-3">
              <button type="button" onClick={() => downloadPdf(review._id)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
                {pdfBusy === review._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {t('Download PDF sheet', 'تحميل ورقة الإجازة PDF')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: React.ReactNode; danger?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className={danger ? 'text-red-600 font-medium' : 'text-slate-900'}>{v}</span></div>;
}
