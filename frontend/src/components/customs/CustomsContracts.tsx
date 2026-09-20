'use client';
/**
 * عقودُ التخليص — عقدُنا مع عميلٍ أو وكيلِ شحنٍ أو ناقل.
 *
 * ── لماذا مكوّنٌ واحد ───────────────────────────────────────────────────────
 * العقدُ يُقرأ في موضعين: صفحةُ العقود (كلُّها معًا) وملفُّ الطرف (عقودُه هو).
 * وهو في الموضعين الشيءُ نفسُه — فلو كُتب مرّتين لاختلف عمودٌ هنا عن هناك عند
 * أوّل تعديل. فالقائمةُ والنموذجُ هنا، و`party` يحصرها بطرفٍ واحد.
 *
 * ── والعقدُ ورقةٌ قبل أن يكون صفًّا ─────────────────────────────────────────
 * فمرفقاتُه جزءٌ منه لا زينة: الموقَّعُ نفسُه يُرفَع ويُفتَح من صفّه. والحالةُ
 * تُقرأ من التاريخ لا من الخانة — عقدٌ انتهى أمسِ يُقرأ «منتهيًا» وإن بقي
 * مكتوبًا «ساري».
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Modal, Field, TextInput, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import { FileSignature, Plus, Pencil, Trash2, Paperclip, Upload, X } from 'lucide-react';

export type CustomsContract = {
  _id: string; party: string; partyKind: 'customer' | 'agent' | 'carrier'; partyName?: string;
  title: string; contractNumber?: string; startDate?: string | null; endDate?: string | null;
  value?: number | null; valueBasis?: string; paymentTermDays?: number; autoRenew?: boolean;
  status: 'draft' | 'active' | 'expired' | 'terminated'; scope?: string; notes?: string;
  attachments?: { _id: string; fileUrl: string; fileName?: string; title?: string }[];
  state?: string; daysLeft?: number | null; createdByName?: string; createdAt?: string;
};

export const KIND_LABEL: Record<string, [string, string]> = {
  customer: ['عميل', 'Customer'], agent: ['وكيل شحن', 'Agent'], carrier: ['ناقل', 'Carrier'],
};
const STATE_META: Record<string, { ar: string; en: string; cls: string }> = {
  active: { ar: 'ساري', en: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  draft: { ar: 'مسودّة', en: 'Draft', cls: 'bg-slate-100 text-slate-600' },
  expired: { ar: 'منتهٍ', en: 'Expired', cls: 'bg-red-100 text-red-700' },
  terminated: { ar: 'مفسوخ', en: 'Terminated', cls: 'bg-amber-100 text-amber-700' },
};
const BASIS: [string, string, string][] = [
  ['', '—', '—'], ['total', 'إجمالي العقد', 'Total'], ['per_container', 'للحاوية', 'Per container'],
  ['per_month', 'شهريًّا', 'Per month'], ['per_shipment', 'للشحنة', 'Per shipment'],
];
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');
const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

const EMPTY = { title: '', contractNumber: '', party: '', startDate: '', endDate: '', value: '', valueBasis: '', paymentTermDays: 0, status: 'active', scope: '', notes: '' };

export default function CustomsContracts({ ar, canEdit, party, parties, notify, embedded }: {
  ar: boolean; canEdit: boolean;
  /** ملفُّ طرفٍ بعينه: تُعرض عقودُه وحدَها ويُملأ الطرفُ تلقائيًّا. */
  party?: { _id: string; name: string; kind: string } | null;
  /** قائمةُ الأطراف لاختيارِ صاحب العقد — تُمرَّر في صفحة العقود. */
  parties?: { _id: string; name: string; kind: string }[];
  notify: (m: string, tone?: any) => void;
  embedded?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [rows, setRows] = useState<CustomsContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [kindFilter, setKindFilter] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (party?._id) qs.set('party', party._id);
      if (!party && kindFilter) qs.set('kind', kindFilter);
      const d = await api.get<{ contracts: CustomsContract[] }>(`/api/customs-clearance/contracts?${qs.toString()}`);
      setRows(d.contracts || []);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?._id, kindFilter]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = {
      ...editing,
      party: party?._id || editing.party,
      value: editing.value === '' ? null : Number(editing.value),
      paymentTermDays: Number(editing.paymentTermDays) || 0,
      startDate: editing.startDate || null,
      endDate: editing.endDate || null,
    };
    if (!body.title?.trim()) return notify(t('اكتب اسم العقد', 'Name the contract'), 'error');
    if (!body.party) return notify(t('اختر الطرف', 'Choose the party'), 'error');
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/customs-clearance/contracts/${editing._id}`, body);
      else await api.post('/api/customs-clearance/contracts', body);
      setEditing(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (c: CustomsContract) => {
    if (!window.confirm(t(`حذف العقد «${c.title}»؟ يُحذف معه مرفقُه.`, `Delete "${c.title}"? Its files go with it.`))) return;
    try { await api.delete(`/api/customs-clearance/contracts/${c._id}`); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  // المرفقُ يُرسَل كما تُرسَل بقيّةُ مرفقات النظام: data URL لا multipart.
  const onFiles = async (list: FileList | null) => {
    if (!list?.length || !uploadFor) return;
    const files: any[] = [];
    for (const f of Array.from(list)) {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      files.push({ dataUrl, fileName: f.name, title: f.name });
    }
    try {
      await api.post(`/api/customs-clearance/contracts/${uploadFor}/files`, { files });
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر رفع الملف', 'Upload failed'), 'error'); }
    setUploadFor(null);
    if (file.current) file.current.value = '';
  };

  const dropFile = async (c: CustomsContract, attId: string) => {
    try { await api.delete(`/api/customs-clearance/contracts/${c._id}/files/${attId}`); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const openNew = () => setEditing({ ...EMPTY, party: party?._id || '' });

  const table = (
    <ScrollX>
      <table className="w-full text-sm">
        <thead className="table-head">
          <tr>
            {[t('العقد', 'Contract'), ...(party ? [] : [t('الطرف', 'Party')]), t('الرقم', 'No.'), t('يبدأ', 'Starts'), t('ينتهي', 'Ends'),
              t('القيمة', 'Value'), t('السداد', 'Terms'), t('الحالة', 'State'), t('المرفقات', 'Files'), ''].map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">{t('لا عقود بعد', 'No contracts yet')}</td></tr>
          ) : rows.map((c) => {
            const st = STATE_META[c.state || c.status] || STATE_META.draft;
            return (
              <tr key={c._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-slate-900">{c.title}</p>
                  {c.scope && <p className="text-[11.5px] text-slate-500 max-w-[260px] truncate" title={c.scope}>{c.scope}</p>}
                </td>
                {!party && (
                  <td className="px-3 py-2.5">
                    <Link href={`/system/customs/parties/${c.party}`} className="text-slate-800 hover:text-[#f37121] font-medium">{c.partyName}</Link>
                    <p className="text-[11px] text-slate-400">{KIND_LABEL[c.partyKind]?.[ar ? 0 : 1]}</p>
                  </td>
                )}
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.contractNumber || '—'}</td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dt(c.startDate)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={c.state === 'expired' ? 'text-red-600 font-semibold' : 'text-slate-600'}>{dt(c.endDate)}</span>
                  {/* ما بقي من مدّته — الرقمُ الذي يُتصرَّف بناءً عليه. */}
                  {typeof c.daysLeft === 'number' && c.daysLeft >= 0 && c.daysLeft <= 60 && (
                    <span className="block text-[11px] text-amber-600">{t(`${c.daysLeft} يومًا`, `${c.daysLeft} days left`)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700">
                  {money(c.value)}
                  {c.valueBasis && <span className="block text-[11px] text-slate-400">{BASIS.find((b) => b[0] === c.valueBasis)?.[ar ? 1 : 2]}</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.paymentTermDays ? t(`${c.paymentTermDays} يومًا`, `${c.paymentTermDays} days`) : '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${st.cls}`}>{ar ? st.ar : st.en}</span>
                  {c.autoRenew && <span className="block text-[10.5px] text-slate-400">{t('تجديد تلقائي', 'auto-renews')}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {(c.attachments || []).map((a) => (
                      <span key={a._id} className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[11.5px] text-slate-700">
                        <a href={a.fileUrl} target="_blank" rel="noreferrer" className="hover:text-[#f37121] max-w-[120px] truncate">{a.title || a.fileName}</a>
                        {canEdit && (
                          <button type="button" onClick={() => dropFile(c, a._id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {canEdit && (
                      <button type="button" onClick={() => { setUploadFor(c._id); file.current?.click(); }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-slate-300 text-[11.5px] text-slate-500 hover:border-[#f37121] hover:text-[#f37121]">
                        <Upload className="w-3 h-3" />{t('إرفاق', 'Attach')}
                      </button>
                    )}
                    {!canEdit && !(c.attachments || []).length && <span className="text-slate-300">—</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-end whitespace-nowrap">
                  {canEdit && (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => setEditing({ ...EMPTY, ...c, startDate: (c.startDate || '').slice(0, 10), endDate: (c.endDate || '').slice(0, 10), value: c.value ?? '' })}
                        className="p-1.5 rounded-md text-slate-500 hover:text-[#f37121] hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => remove(c)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );

  const form = (
    <Modal open={!!editing} onClose={() => setEditing(null)} wide
      title={editing?._id ? t('تعديل العقد', 'Edit contract') : t('عقد جديد', 'New contract')}
      footer={<>
        <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
        <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
      </>}>
      {editing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('اسم العقد *', 'Contract name *')} span2>
            <TextInput value={editing.title} onChange={(e: any) => setEditing({ ...editing, title: e.target.value })} />
          </Field>
          {!party && (
            <Field label={t('الطرف *', 'Party *')} span2>
              <select value={editing.party} onChange={(e) => setEditing({ ...editing, party: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
                <option value="">{t('— اختر —', '— choose —')}</option>
                {(parties || []).map((p) => (
                  <option key={p._id} value={p._id}>{p.name} — {KIND_LABEL[p.kind]?.[ar ? 0 : 1]}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('رقم العقد', 'Contract no.')}>
            <TextInput value={editing.contractNumber} onChange={(e: any) => setEditing({ ...editing, contractNumber: e.target.value })} />
          </Field>
          <Field label={t('الحالة', 'State')}>
            <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
              {(['active', 'draft', 'expired', 'terminated'] as const).map((k) => (
                <option key={k} value={k}>{ar ? STATE_META[k].ar : STATE_META[k].en}</option>
              ))}
            </select>
          </Field>
          <Field label={t('يبدأ', 'Starts')}>
            <TextInput type="date" value={editing.startDate || ''} onChange={(e: any) => setEditing({ ...editing, startDate: e.target.value })} />
          </Field>
          <Field label={t('ينتهي', 'Ends')}>
            <TextInput type="date" value={editing.endDate || ''} onChange={(e: any) => setEditing({ ...editing, endDate: e.target.value })} />
          </Field>
          <Field label={t('القيمة', 'Value')}>
            <TextInput type="number" value={editing.value} onChange={(e: any) => setEditing({ ...editing, value: e.target.value })} />
          </Field>
          <Field label={t('أساس القيمة', 'Value basis')}>
            <select value={editing.valueBasis} onChange={(e) => setEditing({ ...editing, valueBasis: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
              {BASIS.map(([v, a, e2]) => <option key={v} value={v}>{ar ? a : e2}</option>)}
            </select>
          </Field>
          <Field label={t('مهلة السداد (يوم)', 'Payment terms (days)')}>
            <TextInput type="number" value={editing.paymentTermDays} onChange={(e: any) => setEditing({ ...editing, paymentTermDays: e.target.value })} />
          </Field>
          <Field label={t('تجديد تلقائي', 'Auto renew')}>
            <select value={editing.autoRenew ? '1' : ''} onChange={(e) => setEditing({ ...editing, autoRenew: !!e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm">
              <option value="">{t('لا', 'No')}</option>
              <option value="1">{t('نعم', 'Yes')}</option>
            </select>
          </Field>
          <Field label={t('ما يغطّيه العقد', 'Scope')} span2>
            <TextInput value={editing.scope} onChange={(e: any) => setEditing({ ...editing, scope: e.target.value })} />
          </Field>
          <Field label={t('ملاحظات', 'Notes')} span2>
            <TextInput value={editing.notes} onChange={(e: any) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
          {!editing._id && (
            <p className="sm:col-span-2 text-[12px] text-slate-500">
              {t('احفظ العقد أوّلًا ثمّ أرفق ملفَّه من الجدول.', 'Save the contract first, then attach its file from the table.')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );

  const addBtn = canEdit && (
    <button type="button" onClick={openNew}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold hover:bg-[#e06010]">
      <Plus className="w-4 h-4" />{t('عقد جديد', 'New contract')}
    </button>
  );

  const hidden = <input ref={file} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />;

  if (embedded) {
    return (
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-[14px] font-bold text-slate-900 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#f37121]/10 text-[#f37121] flex items-center justify-center"><FileSignature className="w-4 h-4" /></span>
            {t('العقود', 'Contracts')}{rows.length ? ` (${rows.length})` : ''}
          </h3>
          {addBtn}
        </header>
        {loading ? <p className="p-5 text-slate-400 text-sm">…</p> : table}
        {form}{hidden}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {[['', 'الكل', 'All'], ['customer', 'عملاء', 'Customers'], ['agent', 'وكلاء', 'Agents'], ['carrier', 'ناقلون', 'Carriers']].map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                kindFilter === k ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>
              {ar ? a : e}
            </button>
          ))}
        </div>
        <span className="ms-auto">{addBtn}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? <p className="p-5 text-slate-400 text-sm">…</p> : table}
      </div>
      {form}{hidden}
    </div>
  );
}
