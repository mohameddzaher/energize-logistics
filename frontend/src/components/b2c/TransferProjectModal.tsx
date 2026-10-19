'use client';
/**
 * «نقل مشروع» — الطريقُ الوحيدُ لتغيير مشروع المندوب (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * يُختار المشروعُ الجديدُ من قائمة مشاريع القسم، ومعه سببٌ يُكتب في سجلّ المندوب.
 * ومن يومه تُكتب أوردراتُه على مشروعه الجديد، وتبقى القديمةُ على القديم.
 * ولا يظهر الزرُّ إلّا لمن يملكه (`canTransferLT`)، والخادمُ يحسمه أيضًا.
 */
import { useState } from 'react';
import { Modal, Field, TextInput, PrimaryButton, Loader2 } from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import { useDialog } from '@/components/system/DialogProvider';
import { transferLTProject } from '@/lib/lightTransport';
import { ArrowLeftRight } from 'lucide-react';

export default function TransferProjectModal({ open, onClose, id, name, current, ar, onDone }: {
  open: boolean; onClose: () => void; id: string; name: string; current: string; ar: boolean; onDone: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!to || to === current) return;
    if (!(await confirm(t(`نقل ${name} من «${current || '—'}» إلى «${to}»؟ أوردراتُه من اليوم تُكتب على المشروع الجديد.`, `Move ${name} from “${current}” to “${to}”?`)))) return;
    setBusy(true);
    try {
      await transferLTProject(id, to, note);
      notify(t(`نُقل إلى ${to}`, `Moved to ${to}`), 'success');
      setTo(''); setNote(''); onDone(); onClose();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('نقل مشروع', 'Transfer project')}
      footer={<PrimaryButton onClick={submit} disabled={!to || to === current || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}{t('نقل', 'Transfer')}</PrimaryButton>}>
      <p className="mb-3 text-sm text-slate-600">{t(`${name} — المشروع الحالي: «${current || '—'}»`, `${name} — current project: “${current || '—'}”`)}</p>
      <Field label={t('المشروع الجديد', 'New project')}>
        <ManagedSelect storeLabel strict noAdd type="lt_project" value={to} onChange={setTo} />
      </Field>
      <Field label={t('السبب (يُكتب في سجلّه)', 'Reason (kept in his history)')}>
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}
