'use client';
// بريد الشركة — سجل صناديق البريد المُنشأة على هوستنجر (@energize-logistics.com).
//
// ⚠️ الصفحة دي مالهاش أي علاقة بحسابات الدخول للسيستم. الموظف ممكن يكون له
// الاتنين بكلمتين مرور مختلفتين، وتغيير واحدة ما بيمسّش التانية. الصفحة بتقول
// كده صراحة فوق عشان محدش يخلط بينهم ويغيّر الحاجة الغلط.
//
// كلمة المرور مشفّرة على السيرفر ومش بترجع مع القائمة — فيه زر «إظهار» بينده
// endpoint مستقل، وكل كشف بيتسجّل باسم اللي عمله.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  Mail, Plus, Search, Edit, Trash2, X, Eye, EyeOff, Copy,
  ShieldAlert, KeyRound, Loader2, UserRound,
} from 'lucide-react';
import {
  canViewIt, canEditIt, COMPANY_DOMAIN, MAILBOX_STATUS,
  listCompanyEmails, searchEmailEmployees, createCompanyEmail, updateCompanyEmail,
  deleteCompanyEmail, revealCompanyEmailPassword, exportCompanyEmailsWithPasswords,
  type CompanyEmail, type EmailEmployee,
} from '@/lib/it';

export default function CompanyEmailsPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify, confirm } = useDialog();

  const [rows, setRows] = useState<CompanyEmail[]>([]);
  const [counts, setCounts] = useState<any>(null);
  const [vaultReady, setVaultReady] = useState(true);
  const [canReveal, setCanReveal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [linked, setLinked] = useState('');
  const [editing, setEditing] = useState<CompanyEmail | null>(null);
  const [adding, setAdding] = useState(false);

  const canEdit = canEditIt(user as any);

  const load = useCallback(async () => {
    try {
      const d = await listCompanyEmails({ q: q.trim(), status, mailboxType: type, linked });
      setRows(d.emails || []);
      setCounts(d.counts);
      setVaultReady(d.vaultReady);
      setCanReveal(d.canReveal);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [q, status, type, linked, notify]);

  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useSocket('it:emails', useCallback(() => { load(); }, [load]));

  const baseCols: ExportColumn[] = [
    { header: t('الاسم', 'Name'), key: 'displayName', width: 28 },
    { header: t('البريد', 'Email'), key: 'email', width: 38 },
    { header: t('الموظف', 'Employee'), key: 'employeeName', width: 28 },
    { header: t('القسم', 'Department'), key: 'department', width: 20 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30 },
  ];
  const pwCols: ExportColumn[] = [...baseCols, { header: t('كلمة المرور', 'Password'), key: 'password', width: 22 }];

  // كلمات المرور مش موجودة في الصفحة أصلاً — بتتجاب لحظة ما المستخدم يختار
  // الخيار ده، فالصفحة ما بتحملش أسرار هو ممكن ما يطلبهاش.
  const resolveWithPasswords = async () => {
    const d = await exportCompanyEmailsWithPasswords({ q: q.trim(), status, mailboxType: type, linked });
    return [{ name: t('بريد الشركة', 'Company email'), rows: d.rows || [], columns: pwCols }];
  };

  if (!canViewIt(user as any)) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Mail className="w-5 h-5" />}
        title={t('بريد الشركة', 'Company Email')}
        subtitle={t(`صناديق البريد على @${COMPANY_DOMAIN} — الإنشاء والربط بالموظفين`, `Mailboxes on @${COMPANY_DOMAIN} — accounts and who they belong to`)}
      >
        <div className="flex items-center gap-2">
          <ExportMenu fileName="company-emails" lang={lang as 'ar' | 'en'}
            options={[
              { key: 'plain', label: t('بدون كلمات المرور', 'Without passwords'),
                sheets: [{ name: t('بريد الشركة', 'Company email'), rows, columns: baseCols }] },
              // بتتجاب لما تتختار بس، والجلب نفسه بيتسجّل في سجل التدقيق.
              { key: 'withpw', label: t('مع كلمات المرور', 'With passwords'),
                resolve: resolveWithPasswords, hint: t('مسجَّل', 'recorded'), disabled: !canReveal },
            ]} />
          {canEdit && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm">
              <Plus className="w-4 h-4" /> {t('بريد جديد', 'New mailbox')}
            </button>
          )}
        </div>
      </PageHeader>

      {/* الفرق اللي لازم يكون واضح من أول نظرة */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[12px] text-amber-900 leading-relaxed">
          {t(
            'هذا سجل صناديق بريد الشركة المُنشأة على هوستنجر — وليست حسابات الدخول إلى النظام. قد يكون للموظف الاثنان بكلمتَي مرور مختلفتين، وتغيير كلمة المرور هنا لا يغيّر دخوله إلى النظام ولا العكس.',
            'These are company mailboxes created on Hostinger — not system logins. A person may have both, with different passwords; changing one here does not affect the other.'
          )}
        </p>
      </div>

      {!vaultReady && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <KeyRound className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-900 leading-relaxed">
            {t('خزنة كلمات المرور غير مهيأة على السيرفر (EMAIL_VAULT_KEY) — تقدر تسجّل الصناديق لكن حفظ كلمات المرور موقوف حتى لا تُخزَّن بشكل غير آمن.',
               'The password vault is not configured (EMAIL_VAULT_KEY). Mailboxes can be recorded, but storing passwords is disabled rather than saving them unsafely.')}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <button onClick={() => { setStatus(''); setType(''); setLinked(''); }} className="text-start">
          <StatCard label={t('إجمالي الصناديق', 'Mailboxes')} value={counts?.total ?? 0} accent="text-[#f37121]" />
        </button>
        <button onClick={() => setStatus(status === 'active' ? '' : 'active')} className="text-start">
          <StatCard label={t('نشط', 'Active')} value={counts?.active ?? 0} accent="text-emerald-600" />
        </button>
        <button onClick={() => setLinked(linked === 'yes' ? '' : 'yes')} className="text-start">
          <StatCard label={t('مربوط بموظف', 'Linked to HR')} value={counts?.linked ?? 0} />
        </button>
        <button onClick={() => setLinked(linked === 'no' ? '' : 'no')} className="text-start">
          <StatCard label={t('غير مربوط', 'Not linked')} value={counts?.unlinked ?? 0} accent="text-amber-600" />
        </button>
        <button onClick={() => setType(type === 'functional' ? '' : 'functional')} className="text-start">
          <StatCard label={t('بدون كلمة مرور', 'No password yet')} value={counts?.withoutPassword ?? 0} accent="text-red-600" />
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('ابحث بالاسم / البريد / الرقم الوظيفي…', 'name / email / employee no…')}
            className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          {Object.entries(MAILBOX_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('كل الأنواع', 'All types')}</option>
          <option value="personal">{t('شخصي', 'Personal')}</option>
          <option value="functional">{t('وظيفي', 'Functional')}</option>
        </select>
        <select value={linked} onChange={(e) => setLinked(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">{t('مربوط وغير مربوط', 'Linked & unlinked')}</option>
          <option value="yes">{t('مربوط بموظف', 'Linked')}</option>
          <option value="no">{t('غير مربوط', 'Not linked')}</option>
        </select>
        {(q || status || type || linked) && (
          <button onClick={() => { setQ(''); setStatus(''); setType(''); setLinked(''); }}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 hover:text-slate-800">
            {t('إلغاء الفلترة', 'Clear')}
          </button>
        )}
        <span className="text-xs text-slate-400 ms-auto">{rows.length} {t('صندوق', 'shown')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>{[t('الاسم', 'Name'), t('البريد', 'Email'), t('الموظف', 'Employee'), t('كلمة المرور', 'Password'), ''].map((h, i) => (
                <th key={i} className="px-3 py-3 text-center font-bold whitespace-nowrap tracking-wide">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Row key={r._id} r={r} ar={ar} t={t} canEdit={canEdit} canReveal={canReveal}
                  onEdit={() => setEditing(r)} onChanged={load} notify={notify} confirm={confirm} />
              ))}
              {!rows.length && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">{t('لا توجد صناديق مطابقة', 'No mailboxes')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(adding || editing) && (
        <EmailModal row={editing} ar={ar} t={t} vaultReady={vaultReady}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }} notify={notify} />
      )}
    </div>
  );
}

// ── صف واحد ─────────────────────────────────────────────────────────────────
// سطر واحد لكل صندوق. أي بيان تاني (الرقم الوظيفي، القسم، النوع، الحالة، آخر
// عرض) موجود في نموذج التعديل — حشره في الجدول كان بيخلّي الصف سطرين والعين
// تتوه بين الصفوف.
function Row({ r, ar, t, canEdit, canReveal, onEdit, onChanged, notify, confirm }: any) {
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setBusy(true);
    try {
      const d = await revealCompanyEmailPassword(r._id);
      setShown(d.password);
      // بتختفي لوحدها — شاشة سايبة كلمة مرور ظاهرة هي أكتر طريقة بتتسرب بيها.
      setTimeout(() => setShown(''), 30000);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  const del = async () => {
    const ok = await confirm({
      title: ar ? `حذف «${r.email}» من السجل؟` : `Remove "${r.email}"?`,
      message: ar
        ? 'هذا يزيله من سجل النظام فقط — أما صندوق البريد نفسه على هوستنجر فلن يُحذَف، ويجب إغلاقه من هناك.'
        : 'This removes it from the register only — the mailbox itself on Hostinger is untouched.',
      confirmLabel: ar ? 'حذف' : 'Delete', tone: 'danger',
    });
    if (!ok) return;
    try { await deleteCompanyEmail(r._id); notify(ar ? 'تم الحذف' : 'Deleted', 'success'); onChanged(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  const cell = 'px-3 py-2.5 text-center align-middle whitespace-nowrap';

  return (
    <tr className="hover:bg-slate-50">
      <td className={`${cell} font-semibold text-slate-800 text-[13.5px]`}>{r.displayName || '—'}</td>

      {/* البريد لاتيني دايمًا — dir=ltr عشان النقطة والـ @ ما يتقلبوش في صفحة عربية */}
      <td className={`${cell} text-slate-700 text-[13px]`} dir="ltr">{r.email}</td>

      <td className={cell}>
        {r.employee
          ? <span className="text-slate-700 text-[13px]">{r.employeeName || '—'}</span>
          : <span className="text-slate-300 text-[13px]">—</span>}
      </td>

      <td className={cell}>
        {!r.passwordSetAt ? (
          <span className="text-[12px] text-slate-300">—</span>
        ) : shown ? (
          <span className="inline-flex items-center gap-1.5">
            <code className="px-2 py-0.5 rounded bg-slate-900 text-emerald-300 text-[12.5px]" dir="ltr">{shown}</code>
            <button onClick={() => { navigator.clipboard?.writeText(shown); notify(ar ? 'تم النسخ' : 'Copied', 'success'); }}
              className="p-1 rounded hover:bg-slate-100 text-slate-400" title={t('نسخ', 'Copy')}><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={() => setShown('')} className="p-1 rounded hover:bg-slate-100 text-slate-400"><EyeOff className="w-3.5 h-3.5" /></button>
          </span>
        ) : canReveal ? (
          <button onClick={reveal} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}{t('إظهار', 'Show')}
          </button>
        ) : (
          <span className="text-[12px] text-slate-400">••••••••</span>
        )}
      </td>

      <td className={cell}>
        {canEdit && (
          <div className="inline-flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Edit className="w-3.5 h-3.5" /></button>
            <button onClick={del} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── إضافة / تعديل ────────────────────────────────────────────────────────────
// الشاشة بتسأل التلات حاجات اللي بيتعملوا فعلاً وقت إنشاء البريد: مين الموظف،
// إيه البريد، وإيه كلمة المرور. الباقي (الاسم الظاهر، النوع، الحالة، الملاحظات)
// اتحط تحت «خيارات إضافية» — موجود لما تحتاجه، مش قدامك كل مرة.
function EmailModal({ row, ar, t, vaultReady, onClose, onSaved, notify }: any) {
  const [local, setLocal] = useState(row ? (row.localPart || row.email?.split('@')[0] || '') : '');
  const [displayName, setDisplayName] = useState(row?.displayName || '');
  const [mailboxType, setMailboxType] = useState<'personal' | 'functional'>(row?.mailboxType || 'personal');
  const [functionAr, setFunctionAr] = useState(row?.functionAr || '');
  const [status, setStatus] = useState(row?.status || 'active');
  const [notes, setNotes] = useState(row?.notes || '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [more, setMore] = useState(false);
  const [emp, setEmp] = useState<{ _id: string; name: string; employeeNumber?: string } | null>(
    row?.employee ? { _id: row.employee, name: row.employeeName, employeeNumber: row.employeeNumber } : null
  );
  const [busy, setBusy] = useState(false);

  // اختيار الموظف بيملا الاسم الظاهر لوحده — حاجة أقل تتكتب.
  const pickEmployee = (e: any) => {
    setEmp(e);
    if (e?.name && !displayName.trim()) setDisplayName(e.name);
  };

  const save = async () => {
    const localPart = local.trim().toLowerCase();
    if (!localPart) { notify(ar ? 'اكتب اسم البريد' : 'Email is required', 'error'); return; }
    setBusy(true);
    try {
      const body: any = {
        email: localPart.includes('@') ? localPart : `${localPart}@${COMPANY_DOMAIN}`,
        displayName, mailboxType, functionAr, status, notes,
        employee: emp?._id || null,
      };
      if (password) body.password = password;
      if (row) await updateCompanyEmail(row._id, body);
      else await createCompanyEmail(body);
      notify(ar ? 'تم الحفظ' : 'Saved', 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';
  const L = ({ children }: any) => <label className="block text-xs font-semibold text-slate-600 mb-1">{children}</label>;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">{row ? t('تعديل بريد', 'Edit mailbox') : t('بريد جديد', 'New mailbox')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="space-y-3.5">
          <div>
            <L>{t('الموظف', 'Employee')}</L>
            <EmployeePicker value={emp} onChange={pickEmployee} ar={ar} t={t} />
            <p className="text-[11px] text-slate-400 mt-1">
              {t('إذا لم يُضَف بعد في الموارد البشرية، اتركها «بدون ربط» واربطه لاحقًا.',
                 'Not in HR yet? Leave it unlinked and link later.')}
            </p>
          </div>

          <div>
            <L>{t('البريد', 'Email')} *</L>
            {/* الدومين ثابت وظاهر جنب الخانة — أقل حاجة تتكتب غلط. */}
            <div className="flex items-stretch" dir="ltr">
              <input value={local} onChange={(e) => setLocal(e.target.value)} autoFocus placeholder="first.last"
                className="flex-1 px-3 py-2 rounded-s-lg border border-slate-200 text-sm" />
              <span className="inline-flex items-center px-2.5 rounded-e-lg border border-s-0 border-slate-200 bg-slate-50 text-slate-500 text-[12px]">
                @{COMPANY_DOMAIN}
              </span>
            </div>
          </div>

          <div>
            <L>{row ? t('كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)', 'New password (blank keeps current)') : t('كلمة المرور', 'Password')}</L>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                disabled={!vaultReady} className={`${inp} pe-9`} dir="ltr" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute top-1/2 -translate-y-1/2 end-2 p-1 text-slate-400">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {!vaultReady && (
              <p className="text-[11px] text-red-500 mt-1">
                {t('الحفظ موقوف — خزنة كلمات المرور غير مهيأة على السيرفر.', 'Disabled — the vault is not configured.')}
              </p>
            )}
          </div>

          {/* الباقي مش بيتكتب كل مرة، فمش لازم ياخد مساحة كل مرة. */}
          <button type="button" onClick={() => setMore((v) => !v)}
            className="text-[12px] text-slate-500 hover:text-slate-800 underline underline-offset-2">
            {more ? t('إخفاء الخيارات الإضافية', 'Hide extra options') : t('خيارات إضافية', 'More options')}
          </button>

          {more && (
            <div className="space-y-3 pt-1 border-t border-slate-100">
              <div><L>{t('الاسم الظاهر', 'Display name')}</L>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inp} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><L>{t('النوع', 'Type')}</L>
                  <select value={mailboxType} onChange={(e) => setMailboxType(e.target.value as any)} className={inp}>
                    <option value="personal">{t('شخصي', 'Personal')}</option>
                    <option value="functional">{t('وظيفي', 'Functional')}</option>
                  </select></div>
                <div><L>{t('الحالة', 'Status')}</L>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
                    {Object.entries(MAILBOX_STATUS).map(([k, v]: any) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
                  </select></div>
              </div>
              {mailboxType === 'functional' && (
                <div><L>{t('وظيفة الصندوق', 'What it is for')}</L>
                  <input value={functionAr} onChange={(e) => setFunctionAr(e.target.value)} className={inp} /></div>
              )}
              <div><L>{t('ملاحظات', 'Notes')}</L>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inp} /></div>
            </div>
          )}
        </div>

        <button onClick={save} disabled={busy}
          className="w-full mt-5 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-50">
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}
        </button>
      </div>
    </div>
  );
}

// ── اختيار موظف بالبحث ───────────────────────────────────────────────────────
// دروب-ليست جواها سيرش: الشركة فيها مئات الموظفين، فقائمة ساكنة مش هتنفع.
function EmployeePicker({ value, onChange, ar, t }: any) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<EmailEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    setLoading(true);
    const h = setTimeout(() => {
      searchEmailEmployees(q.trim())
        .then((d) => { if (!dead) setItems(d.employees || []); })
        .catch(() => { if (!dead) setItems([]); })
        .finally(() => { if (!dead) setLoading(false); });
    }, 250);
    return () => { dead = true; clearTimeout(h); };
  }, [q, open]);

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-start flex items-center justify-between gap-2">
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>
          {value ? (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="w-3.5 h-3.5 text-slate-400" />
              {value.name}{value.employeeNumber ? ` · #${value.employeeNumber}` : ''}
            </span>
          ) : t('بدون ربط', 'Not linked')}
        </span>
        <span className="text-slate-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder={t('ابحث بالاسم أو الرقم الوظيفي…', 'name or employee no…')}
              className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-sm" />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button type="button" onClick={() => { onChange(null); setOpen(false); }}
              className="w-full text-start px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
              {t('بدون ربط', 'Not linked')}
            </button>
            {loading && <p className="px-3 py-2 text-xs text-slate-400">{t('جارٍ البحث…', 'Searching…')}</p>}
            {!loading && !items.length && <p className="px-3 py-2 text-xs text-slate-400">{t('لا نتائج', 'No results')}</p>}
            {items.map((e) => (
              <button key={e._id} type="button"
                onClick={() => { onChange({ _id: e._id, name: e.name, employeeNumber: e.employeeNumber }); setOpen(false); }}
                className="w-full text-start px-3 py-1.5 hover:bg-slate-50">
                <span className="block text-sm text-slate-800">{e.name} {e.inactive && <span className="text-[10px] text-red-500">({t('غير نشط', 'inactive')})</span>}</span>
                <span className="block text-[11px] text-slate-400">
                  {e.employeeNumber ? `#${e.employeeNumber}` : ''}{e.department ? ` · ${e.department}` : ''}{e.jobTitle ? ` · ${e.jobTitle}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
