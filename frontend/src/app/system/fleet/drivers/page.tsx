'use client';
// السائقون — the fleet's driver register. The one flow that must be effortless
// here is MOVING a driver between trucks: the vehicle picker sits inline in the
// row, the server enforces the two-seat rule, and its Arabic 400 message is
// surfaced as-is. Benching (sick / vacation) is just `vehicle: null`.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Users, Plus, Pencil, Trash2, Check, Loader2, UserMinus } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea,
  Select, SearchableSelect, SmallBadge, ErrorNotice,
} from '@/components/hr/HRKit';
import { FleetDriver, FleetVehicle, foldAr, canEditFleet, canAdminFleet } from '@/lib/fleet';

const EMPTY = { name: '', phone: '', iqama: '', working: true, onSponsorship: true, vehicle: '', notes: '' };

// The list endpoint populates `vehicle` — but after an edit it can transiently
// be a bare id, so both shapes are handled.
const vehId = (d: FleetDriver) => (typeof d.vehicle === 'object' && d.vehicle ? d.vehicle._id : (d.vehicle || ''));
const vehPlate = (d: FleetDriver) => (typeof d.vehicle === 'object' && d.vehicle ? d.vehicle.plate : '');

export default function FleetDriversPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditFleet(user);
  const admin = canAdminFleet(user);

  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignFilter, setAssignFilter] = useState('');
  const [rowBusy, setRowBusy] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FleetDriver | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([
        api.get<{ drivers: FleetDriver[] }>('/api/fleet/drivers'),
        api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles'),
      ]);
      setDrivers(d.drivers || []);
      setVehicles(v.vehicles || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:drivers', useCallback(() => load(), [load]));
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));

  // The seat hint tells the mover whether the target truck is already full
  // BEFORE the server has to say no.
  const vehicleOptions = useMemo(() => [
    { value: '', label: ar ? 'بدون سيارة' : 'No vehicle' },
    ...vehicles.map((v) => ({
      value: v._id,
      label: v.plate,
      hint: (v.drivers || []).length
        ? (v.drivers || []).map((x) => x.name).join(' · ')
        : (ar ? 'شاغرة' : 'Empty'),
    })),
  ], [vehicles, ar]);

  const assignVehicle = async (d: FleetDriver, vehicleId: string) => {
    if (vehicleId === vehId(d)) return;
    setRowBusy(d._id);
    try {
      await api.put(`/api/fleet/drivers/${d._id}`, { vehicle: vehicleId || null });
      await load();
    } catch (e: any) { notify(e.message, 'error'); } // «السيارة … عليها سائقان بالفعل»
    setRowBusy('');
  };

  // Benching now ASKS WHY — an accidental one-click bench already happened, and
  // the reason (مرضية/إجازة) is what the dashboard reports.
  const [benching, setBenching] = useState<FleetDriver | null>(null);
  const [benchReason, setBenchReason] = useState<'sick' | 'leave' | 'other' | ''>('');
  const [benchNote, setBenchNote] = useState('');
  const [benchSaving, setBenchSaving] = useState(false);

  const openBench = (d: FleetDriver) => { setBenching(d); setBenchReason(''); setBenchNote(''); };

  const confirmBench = async () => {
    if (!benching) return;
    setBenchSaving(true);
    try {
      const payload: any = { vehicle: null };
      if (benchReason) { payload.offReason = benchReason; payload.offNote = benchNote.trim(); }
      await api.put(`/api/fleet/drivers/${benching._id}`, payload);
      notify(ar ? `أُنزل السائق «${benching.name}» من السيارة.` : `“${benching.name}” was benched.`, 'success');
      setBenching(null);
      await load();
    } catch (e: any) { notify(e.message, 'error'); }
    setBenchSaving(false);
  };

  const toggle = async (d: FleetDriver, key: 'working' | 'onSponsorship') => {
    setRowBusy(d._id);
    try {
      await api.put(`/api/fleet/drivers/${d._id}`, { [key]: !d[key] });
      await load();
    } catch (e: any) { notify(e.message, 'error'); }
    setRowBusy('');
  };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setShowModal(true); };
  const openEdit = (d: FleetDriver) => {
    setEditing(d);
    setForm({
      name: d.name, phone: d.phone || '', iqama: d.iqama || '',
      working: !!d.working, onSponsorship: !!d.onSponsorship,
      vehicle: vehId(d), notes: d.notes || '',
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, vehicle: form.vehicle || null };
      if (editing) await api.put(`/api/fleet/drivers/${editing._id}`, payload);
      else await api.post('/api/fleet/drivers', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (d: FleetDriver) => {
    if (!(await confirm(ar
      ? `إزالة السائق «${d.name}»؟ يُنزَل من سيارته وتبقى شحناته السابقة كما هي.`
      : `Remove “${d.name}”? He is taken off his vehicle; past shipments keep his name.`))) return;
    try { await api.delete(`/api/fleet/drivers/${d._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = drivers.filter((d) => {
    if (statusFilter === 'working' && !d.working) return false;
    if (statusFilter === 'off' && d.working) return false;
    if (statusFilter === 'sick' && d.offReason !== 'sick') return false;
    if (statusFilter === 'leave' && d.offReason !== 'leave') return false;
    if (assignFilter === 'assigned' && !vehId(d)) return false;
    if (assignFilter === 'unassigned' && vehId(d)) return false;
    const s = foldAr(search.trim());
    if (!s) return true;
    return [d.name, d.phone, d.iqama, vehPlate(d)].some((v) => foldAr(String(v || '')).includes(s));
  });

  if (loading) return <Spinner />;

  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';
  const working = drivers.filter((d) => d.working).length;
  const unassigned = drivers.filter((d) => !vehId(d)).length;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Users className="w-5 h-5" />} title={ar ? 'السائقون' : 'Drivers'}
        subtitle={ar
          ? `${drivers.length} سائقاً · ${working} يعملون · ${unassigned} بلا سيارة — نقل السائق إلى سيارة أخرى يتم من الجدول مباشرة`
          : `${drivers.length} drivers · ${working} working · ${unassigned} unassigned — move a driver between trucks right from the table`}>
        {editor && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة سائق' : 'Add driver'}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* Wrapping row + fixed-width filter boxes: HRKit's Select is w-full, and
          bare in a flex row it eats the search; a forced single row is what
          makes whole pages scroll sideways. */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px] basis-72">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث بالاسم أو الجوال أو الإقامة أو اللوحة…' : 'Search name, phone, iqama or plate…'} />
        </div>
        <div className="w-44 grow sm:grow-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="working">{ar ? 'يعمل' : 'Working'}</option>
            <option value="off">{ar ? 'لا يعمل' : 'Not working'}</option>
            <option value="sick">{ar ? 'إجازة مرضية' : 'Sick leave'}</option>
            <option value="leave">{ar ? 'إجازة' : 'On leave'}</option>
          </Select>
        </div>
        <div className="w-44 grow sm:grow-0">
          <Select value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)}>
            <option value="">{ar ? 'الجميع' : 'All'}</option>
            <option value="assigned">{ar ? 'على سيارة' : 'Assigned'}</option>
            <option value="unassigned">{ar ? 'بلا سيارة' : 'Unassigned'}</option>
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className={th}>{ar ? 'الاسم' : 'Name'}</th>
            <th className={th}>{ar ? 'الجوال' : 'Phone'}</th>
            <th className={th}>{ar ? 'الإقامة' : 'Iqama'}</th>
            <th className={th}>{ar ? 'الحالة' : 'Status'}</th>
            <th className={th}>{ar ? 'الكفالة' : 'Sponsorship'}</th>
            <th className={th}>{ar ? 'السيارة' : 'Vehicle'}</th>
            <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d._id} className={`border-b border-slate-200/70 hover:bg-slate-50 ${rowBusy === d._id ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-slate-900 font-semibold whitespace-nowrap">{d.name}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap" dir="ltr">{d.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-700 font-mono">{d.iqama || '—'}</td>
                <td className="px-4 py-3">
                  {/* The badge itself is the toggle — one click flips يعمل/لا يعمل. */}
                  <button type="button" disabled={!editor || rowBusy === d._id}
                    onClick={() => editor && toggle(d, 'working')}
                    className={editor ? 'cursor-pointer' : 'cursor-default'}
                    title={editor ? (ar ? 'اضغط لتغيير الحالة' : 'Click to toggle') : undefined}>
                    {d.working
                      ? <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={ar ? 'يعمل' : 'Working'} />
                      : <SmallBadge bg="bg-slate-500/15" text="text-slate-600" label={ar ? 'لا يعمل' : 'Not working'} />}
                  </button>
                
                  {!d.working && d.offReason && (
                    <span className="ms-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-700">
                      {d.offReason === 'sick' ? (ar ? 'مرضية' : 'Sick') : d.offReason === 'leave' ? (ar ? 'إجازة' : 'On leave') : (ar ? 'سبب آخر' : 'Other')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button type="button" disabled={!editor || rowBusy === d._id}
                    onClick={() => editor && toggle(d, 'onSponsorship')}
                    className={editor ? 'cursor-pointer' : 'cursor-default'}
                    title={editor ? (ar ? 'اضغط لتغيير الكفالة' : 'Click to toggle') : undefined}>
                    {d.onSponsorship
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={ar ? 'على الكفالة' : 'On sponsorship'} />
                      : <SmallBadge bg="bg-amber-500/15" text="text-amber-700" label={ar ? 'خارج الكفالة' : 'Off sponsorship'} />}
                  </button>
                </td>
                <td className="px-4 py-3">
                  {editor ? (
                    <div className="min-w-[180px]">
                      <SearchableSelect value={vehId(d)} onChange={(x) => assignVehicle(d, x)} searchAfter={0}
                        placeholder={ar ? 'بدون سيارة' : 'No vehicle'}
                        searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
                        options={vehicleOptions} disabled={rowBusy === d._id} />
                    </div>
                  ) : (
                    vehPlate(d)
                      ? <span className="font-mono text-slate-700">{vehPlate(d)}</span>
                      : <SmallBadge bg="bg-red-500/15" text="text-red-700" label={ar ? 'بدون سيارة' : 'Unassigned'} />
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {editor && vehId(d) && (
                      <button type="button" onClick={() => openBench(d)} disabled={rowBusy === d._id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-slate-100"
                        title={ar ? 'إنزال من السيارة' : 'Take off vehicle'}>
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                    {editor && <button type="button" onClick={() => openEdit(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                    {admin && <button type="button" onClick={() => remove(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">
                {drivers.length === 0
                  ? (ar ? 'لا يوجد سائقون بعد.' : 'No drivers yet.')
                  : (ar ? 'لا نتائج مطابقة للبحث.' : 'No matches.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? (ar ? 'تعديل سائق' : 'Edit driver') : (ar ? 'إضافة سائق' : 'Add driver')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الاسم *' : 'Name *'} span2><TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label={ar ? 'رقم الإقامة' : 'Iqama'}><TextInput value={form.iqama} onChange={(e) => setForm((f: any) => ({ ...f, iqama: e.target.value }))} /></Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.working ? 'yes' : 'no'} onChange={(e) => setForm((f: any) => ({ ...f, working: e.target.value === 'yes' }))}>
              <option value="yes">{ar ? 'يعمل' : 'Working'}</option>
              <option value="no">{ar ? 'لا يعمل' : 'Not working'}</option>
            </Select>
          </Field>
          <Field label={ar ? 'الكفالة' : 'Sponsorship'}>
            <Select value={form.onSponsorship ? 'yes' : 'no'} onChange={(e) => setForm((f: any) => ({ ...f, onSponsorship: e.target.value === 'yes' }))}>
              <option value="yes">{ar ? 'على الكفالة' : 'On sponsorship'}</option>
              <option value="no">{ar ? 'خارج الكفالة' : 'Off sponsorship'}</option>
            </Select>
          </Field>
          <Field label={ar ? 'السيارة — إن كان سائقها على سيارة أخرى فإنه يُنقل تلقائياً' : 'Vehicle — picking one moves him automatically'} span2>
            <SearchableSelect value={form.vehicle} onChange={(x) => setForm((f: any) => ({ ...f, vehicle: x }))} searchAfter={0}
              placeholder={ar ? 'بدون سيارة' : 'No vehicle'} searchPlaceholder={ar ? 'ابحث باللوحة…' : 'Search plate…'}
              options={vehicleOptions} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>
      {/* لماذا يُنزَل؟ — the reason feeds the dashboard's sick/leave counts. */}
      <Modal open={!!benching} onClose={() => setBenching(null)}
        title={benching ? (ar ? `إنزال «${benching.name}» من السيارة` : `Bench “${benching.name}”`) : ''}
        footer={<>
          <button type="button" onClick={() => setBenching(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={confirmBench} disabled={benchSaving}>
            {benchSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {ar ? 'تأكيد الإنزال' : 'Confirm'}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{ar ? 'ما سبب الإنزال؟' : 'Why is he coming off?'}</p>
          <div className="flex flex-wrap gap-2">
            {([
              { k: 'sick' as const, label: ar ? 'مرضية' : 'Sick' },
              { k: 'leave' as const, label: ar ? 'إجازة' : 'On leave' },
              { k: 'other' as const, label: ar ? 'سبب آخر' : 'Other' },
              { k: '' as const, label: ar ? 'نقل فقط — ما زال يعمل' : 'Just a move — still working' },
            ]).map((o) => (
              <button key={o.k || 'none'} type="button" onClick={() => setBenchReason(o.k)}
                className={`px-3.5 py-2 rounded-full border text-sm font-semibold transition-all ${benchReason === o.k
                  ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                {o.label}
              </button>
            ))}
          </div>
          {benchReason !== '' && (
            <input value={benchNote} onChange={(e) => setBenchNote(e.target.value)}
              placeholder={ar ? 'ملاحظة (اختياري) — مثل مدة الإجازة' : 'Note (optional)'}
              className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          )}
          <p className="text-xs text-slate-500">
            {ar
              ? 'اختيار مرضية أو إجازة يجعل حالته «لا يعمل» ويظهر في لوحة التحليلات؛ «نقل فقط» يُبقيه عاملاً بلا سيارة.'
              : 'Sick/leave marks him off-duty and shows on the dashboard; “just a move” keeps him working, unassigned.'}
          </p>
        </div>
      </Modal>

    </div>
  );
}
