'use client';
/**
 * «إضافة مورد»: a carrier company joins with its four required papers (each may be several files), optional extra
 * papers named by the user, the owner's mobile and the operator the team deals with. A heavy-transport freelancer is not added
 * here; he belongs to the freelancers page. The server enforces the same rules and puts the carrier in approval.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Modal, TextInput } from '@/components/hr/HRKit';
import SearchSelect from '@/components/system/SearchSelect';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';
import { DOC_KINDS } from '@/lib/vendors';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type Row = Record<string, any>;

/** A labelled field with a clear, readable label (the shared Field label is small grey). Defined at module level so inputs keep focus. */
function L({ label, req, span2, children }: { label: string; req?: boolean; span2?: boolean; children: ReactNode }) {
  return (
    <label className={`block ${span2 ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1.5 block text-[13px] font-bold text-slate-800">{label}{req && <span className="text-red-600"> *</span>}</span>
      {children}
    </label>
  );
}
type Extra = { title: string; files: PickedFile[] };
const toBody = (files: PickedFile[]) => files.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title }));

export default function NewVendorModal({ ar, owners = [], initialName = '', aliases = [], onClose, onCreated }: {
  ar: boolean; owners?: string[]; initialName?: string; aliases?: string[]; onClose: () => void; onCreated: (v: Row) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [v, setV] = useState({ name: initialName, phone: '', ownerName: '', ownerPhone: '', operatorName: '', operatorPhone: '', followOwner: '' });
  // «مسؤول المتابعة» is a person from operations, sales or the data team (or the fleet), picked from the same list as «بمساعدة».
  const [people, setPeople] = useState<{ value: string; label: string; roleAr?: string }[]>([]);
  useEffect(() => { api.get<{ options: any[] }>('/api/shipment-requests/team-members?team=helpers').then((d) => setPeople(d.options || [])).catch(() => {}); }, []);
  const [docs, setDocs] = useState<Record<string, PickedFile[]>>({});
  const [extra, setExtra] = useState<Extra[]>([]);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string[]>([]);

  const save = async () => {
    const missing = DOC_KINDS.filter((k) => !(docs[k.key] || []).length).map((k) => `doc_${k.key}`);
    const noName = !v.name.trim() ? ['name'] : [];
    const extraNoTitle = extra.some((x) => x.files.length && !x.title.trim());
    if (missing.length || noName.length || extraNoTitle) {
      setBad([...missing, ...noName, ...(extraNoTitle ? ['extra'] : [])]);
      notify(noName.length ? t('اسمُ المورد مطلوب', 'Name is required') : missing.length ? t('أرفِق المستندات المطلوبة الأربعة', 'Attach the four required papers') : t('اكتب اسم كلّ مستندٍ إضافي', 'Name every extra paper'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ vendor: Row }>('/api/vendors-mgmt/vendors', {
        ...v, type: 'company', aliases,
        documents: [
          ...DOC_KINDS.map((k) => ({ kind: k.key, files: toBody(docs[k.key] || []) })),
          ...extra.filter((x) => x.files.length).map((x) => ({ kind: 'other', title: x.title.trim(), files: toBody(x.files) })),
        ],
      });
      notify(r.vendor.approvalStatus === 'pending' ? t('أُضيف المورّد وأُرسل للاعتماد', 'Added and sent for approval') : t('أُضيف المورّد', 'Carrier added'), 'success');
      onCreated(r.vendor);
    } catch (e: any) {
      if (e?.data?.fields) setBad(e.data.fields);
      notify(e?.message || t('تعذّرت الإضافة', 'Could not add'), 'error');
      if (e?.data?.id) onCreated({ _id: e.data.id });
    }
    setBusy(false);
  };
  const err = (k: string) => bad.includes(k);

  return (
    <Modal open wide onClose={onClose} title={t('إضافة مورّد', 'Add a carrier')}
      footer={<button type="button" onClick={save} disabled={busy} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('إضافة وإرسال للاعتماد', 'Add and send for approval')}</button>}>
      <p className="text-[12.5px] text-slate-600 rounded-lg bg-slate-100 px-3 py-2">
        {t('هنا تُضاف الشركات والمؤسسات. الفريلانسر (نقل ثقيل) يُضاف من ', 'Companies only. A heavy-transport freelancer is added from ')}
        <Link href="/system/vendors-mgmt/drivers" className="text-[#f37121] font-semibold hover:underline">{t('صفحة الفريلانسرز', 'the freelancers page')}</Link>.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <L label={t('اسم المنشأة', 'Company name')} req span2><TextInput value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={err('name') ? 'border-red-400' : ''} /></L>
        <L label={t('اسم صاحب المنشأة', 'Owner name')}><TextInput value={v.ownerName} onChange={(e) => setV({ ...v, ownerName: e.target.value })} /></L>
        <L label={t('رقم جوال صاحب المنشأة', 'Owner mobile')}><TextInput dir="ltr" value={v.ownerPhone} onChange={(e) => setV({ ...v, ownerPhone: e.target.value })} /></L>
        <L label={t('اسم المشغّل (من نتعامل معه مباشرةً)', 'Operator (our direct contact)')}><TextInput value={v.operatorName} onChange={(e) => setV({ ...v, operatorName: e.target.value })} /></L>
        <L label={t('رقم جوال المشغّل', 'Operator mobile')}><TextInput dir="ltr" value={v.operatorPhone} onChange={(e) => setV({ ...v, operatorPhone: e.target.value })} /></L>
        <L label={t('جوال المنشأة', 'Company phone')}><TextInput dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></L>
        <div>
          <span className="mb-1.5 block text-[13px] font-bold text-slate-800">{t('مسؤول المتابعة', 'Follow-up owner')}</span>
          <SearchSelect ar={ar} value={v.followOwner} onChange={(x) => setV({ ...v, followOwner: x })} placeholder={t('اختر الشخص…', 'Pick a person…')}
            options={[...people.map((p) => ({ value: p.label, label: p.label, hint: p.roleAr || '' })), ...(v.followOwner && !people.some((p) => p.label === v.followOwner) ? [{ value: v.followOwner, label: v.followOwner }] : [])]} />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-bold text-slate-800">{t('المستندات المطلوبة (يجوز أكثر من ملفّ لكلّ مستند)', 'Required papers (several files allowed each)')}</p>
        {DOC_KINDS.map((k) => (
          <div key={k.key} className={`rounded-xl border bg-white p-3 ${err(`doc_${k.key}`) ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
            <p className="text-[13.5px] font-bold text-slate-900 mb-1.5">{ar ? k.ar : k.en} <span className="text-red-600">*</span></p>
            <FilePicker files={docs[k.key] || []} onChange={(f) => setDocs((d) => ({ ...d, [k.key]: f }))} max={10} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-800">{t('مستنداتٌ إضافية (اختياري)', 'Extra papers (optional)')}</p>
          <button type="button" onClick={() => setExtra((x) => [...x, { title: '', files: [] }])} className="ms-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[12.5px] font-semibold"><Plus className="w-3.5 h-3.5" />{t('مستندٌ إضافي', 'Extra paper')}</button>
        </div>
        {extra.map((x, i) => (
          <div key={i} className={`rounded-xl border bg-white p-3 space-y-2 ${err('extra') && x.files.length && !x.title.trim() ? 'border-red-300' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2">
              <TextInput placeholder={t('اسم المستند (مثلًا: رخصة النقل)', 'Paper name (e.g. transport licence)')} value={x.title} onChange={(e) => setExtra((l) => l.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
              <button type="button" onClick={() => setExtra((l) => l.filter((_, j) => j !== i))} className="p-2 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>
            <FilePicker files={x.files} onChange={(f) => setExtra((l) => l.map((y, j) => (j === i ? { ...y, files: f } : y)))} max={10} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
