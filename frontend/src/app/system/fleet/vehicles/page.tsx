'use client';
// سياراتنا — the 57 trucks of our own fleet. Every row arrives with its seated
// drivers embedded (max two, server-enforced), so the "who is on what" picture
// is one glance. Assignment itself happens on the drivers page — here the
// vehicle's own facts (plate, trailer, GPS) get corrected.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Truck, Plus, Pencil, Trash2, Check, Loader2, UserCog } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, TextArea, Select, SmallBadge, StatCard, ErrorNotice, SearchableSelect,
} from '@/components/hr/HRKit';
import { FleetVehicle, TRAILER_TYPES, GPS_TYPES, foldAr, canEditFleet, canAdminFleet } from '@/lib/fleet';

const EMPTY = { plate: '', name: '', brand: '', color: '', trailerType: '', gpsType: '', notes: '' };

export default function FleetVehiclesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const editor = canEditFleet(user);
  const admin = canAdminFleet(user);

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [gpsFilter, setGpsFilter] = useState('');
  const [seatsFilter, setSeatsFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // تعيين المشرف — مدير القسم يوزّع السيارات على المشرفين من هنا.
  const [supervisors, setSupervisors] = useState<{ _id: string; firstName: string; lastName: string; email: string }[]>([]);
  const [assigning, setAssigning] = useState<FleetVehicle | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  useEffect(() => {
    if (!admin) return;
    api.get<{ users: any[] }>('/api/fleet/supervisors').then((d) => setSupervisors(d.users || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);
  const saveAssign = async () => {
    if (!assigning) return;
    setAssignSaving(true);
    try {
      await api.patch(`/api/fleet/vehicles/${assigning._id}/supervisor`, { supervisor: assignTo || null });
      setAssigning(null); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setAssignSaving(false);
  };

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vehicles: FleetVehicle[] }>('/api/fleet/vehicles');
      setVehicles(d.vehicles || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:vehicles', useCallback(() => load(), [load]));
  // Driver moves change the chips on this page too.
  useSocket('fleet:drivers', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setShowModal(true); };
  const openEdit = (v: FleetVehicle) => {
    setEditing(v);
    setForm({ plate: v.plate, name: v.name || '', brand: v.brand || '', color: v.color || '', trailerType: v.trailerType || '', gpsType: v.gpsType || '', notes: v.notes || '' });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.plate.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/fleet/vehicles/${editing._id}`, form);
      else await api.post('/api/fleet/vehicles', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (v: FleetVehicle) => {
    if (!(await confirm(ar
      ? `إزالة السيارة «${v.plate}»؟ يُنزَل سائقوها منها وتبقى شحناتها السابقة كما هي.`
      : `Remove “${v.plate}”? Its drivers are unseated; past shipments keep their snapshot.`))) return;
    try { await api.delete(`/api/fleet/vehicles/${v._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = vehicles.filter((v) => {
    if (gpsFilter && (v.gpsType || '') !== gpsFilter) return false;
    const seats = (v.drivers || []).length;
    if (seatsFilter === '0' && seats !== 0) return false;
    if (seatsFilter === '1' && seats !== 1) return false;
    if (seatsFilter === '2' && seats < 2) return false;
    const s = foldAr(search.trim());
    if (!s) return true;
    const names = (v.drivers || []).map((d) => d.name).join(' ');
    return [v.plate, v.name, v.trailerType, names].some((x) => foldAr(String(x || '')).includes(s));
  });

  if (loading) return <Spinner />;

  const seatCount = (v: FleetVehicle) => (v.drivers || []).length;
  const withNone = vehicles.filter((v) => seatCount(v) === 0).length;
  const withOne = vehicles.filter((v) => seatCount(v) === 1).length;
  const withTwo = vehicles.filter((v) => seatCount(v) >= 2).length;

  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={ar ? 'سياراتنا' : 'Our vehicles'}
        subtitle={ar
          ? `${vehicles.length} سيارة — تُدار مقاعد السائقين من صفحة السائقين، وتُصحَّح بيانات السيارة هنا`
          : `${vehicles.length} vehicles — driver seats are managed on the drivers page; vehicle facts are corrected here`}>
        {admin && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة سيارة' : 'Add vehicle'}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'إجمالي السيارات' : 'Total vehicles'} value={vehicles.length} />
        <StatCard label={ar ? 'بدون سائق' : 'No driver'} value={withNone} accent={withNone > 0 ? 'text-red-600' : 'text-slate-900'} />
        <StatCard label={ar ? 'بسائق واحد' : 'One driver'} value={withOne} />
        <StatCard label={ar ? 'بسائقين' : 'Two drivers'} value={withTwo} accent="text-emerald-600" />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[240px] basis-72">
          <SearchInput value={search} onChange={setSearch}
            placeholder={ar ? 'بحث باللوحة أو السائق أو نوع التيدر…' : 'Search plate, driver or trailer…'} />
        </div>
        <div className="w-36 grow sm:grow-0">
          <Select value={gpsFilter} onChange={(e) => setGpsFilter(e.target.value)}>
            <option value="">{ar ? 'كل أنواع GPS' : 'All GPS'}</option>
            {GPS_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </div>
        <div className="w-44 grow sm:grow-0">
          <Select value={seatsFilter} onChange={(e) => setSeatsFilter(e.target.value)}>
            <option value="">{ar ? 'كل السيارات' : 'All vehicles'}</option>
            <option value="0">{ar ? 'بدون سائق' : 'No driver'}</option>
            <option value="1">{ar ? 'بسائق واحد' : 'One driver'}</option>
            <option value="2">{ar ? 'بسائقين' : 'Two drivers'}</option>
          </Select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className={th}>{ar ? 'اللوحة' : 'Plate'}</th>
            <th className={th}>{ar ? 'نوع التيدر' : 'Trailer type'}</th>
            <th className={th}>GPS</th>
            <th className={th}>{ar ? 'السائقون عليها' : 'Drivers'}</th>
            <th className={th}>{ar ? 'المشرف المسؤول' : 'Supervisor'}</th>
            <th className={th}>{ar ? 'ملاحظات' : 'Notes'}</th>
            <th className={th}>{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-slate-900 font-bold font-mono">{v.plate}</span>
                  {v.name && <span className="block text-xs text-slate-500">{v.name}</span>}
                </td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{v.trailerType || '—'}</td>
                <td className="px-4 py-3">
                  {v.gpsType
                    ? <SmallBadge bg={v.gpsType === 'LS' ? 'bg-emerald-500/15' : 'bg-blue-500/15'}
                        text={v.gpsType === 'LS' ? 'text-emerald-700' : 'text-blue-700'} label={v.gpsType} />
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {seatCount(v) === 0 ? (
                    <SmallBadge bg="bg-red-500/15" text="text-red-700" label={ar ? 'بدون سائق' : 'No driver'} />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(v.drivers || []).map((d) => (
                        // A seated-but-off driver is a truck that will not move — tint him amber.
                        <span key={d._id}
                          className={`px-2 py-1 rounded-lg text-xs whitespace-nowrap ${d.working === false ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}
                          title={d.phone || undefined}>
                          {d.name}{d.working === false ? (ar ? ' · لا يعمل' : ' · off') : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {v.supervisorName
                    ? <SmallBadge bg="bg-[#f37121]/10" text="text-[#f37121]" label={v.supervisorName} />
                    : <span className="text-slate-400 text-xs">{ar ? 'غير مُسند' : 'Unassigned'}</span>}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-[220px] truncate" title={v.notes || undefined}>{v.notes || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {admin && (
                      <button type="button" onClick={() => { setAssigning(v); setAssignTo(v.supervisor || ''); }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعيين المشرف' : 'Assign supervisor'}>
                        <UserCog className="w-4 h-4" />
                      </button>
                    )}
                    {editor && <button type="button" onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>}
                    {admin && <button type="button" onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={ar ? 'إزالة' : 'Remove'}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-500 py-12">
                {vehicles.length === 0
                  ? (ar ? 'لا توجد سيارات بعد.' : 'No vehicles yet.')
                  : (ar ? 'لا نتائج مطابقة للبحث.' : 'No matches.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* تعيين المشرف: هذه السيارة مسؤول عنها مَن؟ */}
      <Modal open={!!assigning} onClose={() => setAssigning(null)}
        title={assigning ? (ar ? `المشرف المسؤول عن ${assigning.plate}` : `Supervisor for ${assigning.plate}`) : ''}
        footer={<>
          <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={saveAssign} disabled={assignSaving}>
            {assignSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="space-y-2">
          <Field label={ar ? 'المشرف' : 'Supervisor'}>
            <SearchableSelect
              value={assignTo} onChange={setAssignTo}
              placeholder={ar ? 'بدون مشرف' : 'No supervisor'}
              searchPlaceholder={ar ? 'ابحث بالاسم…' : 'Search name…'}
              options={[
                { value: '', label: ar ? 'بدون مشرف' : 'No supervisor' },
                ...supervisors.map((u) => ({ value: u._id, label: `${u.firstName} ${u.lastName}`.trim() || u.email, hint: u.email })),
              ]}
            />
          </Field>
          {supervisors.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {ar ? 'لا يوجد مستخدمون بدور «مشرف أسطول» بعد — أنشئهم من إدارة المستخدمين أولًا.' : 'No users with the fleet_supervisor role yet — create them in user management first.'}
            </p>
          )}
        </div>
      </Modal>

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editing ? (ar ? 'تعديل سيارة' : 'Edit vehicle') : (ar ? 'إضافة سيارة' : 'Add vehicle')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.plate.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'رقم اللوحة *' : 'Plate *'}><TextInput value={form.plate} onChange={(e) => setForm((f: any) => ({ ...f, plate: e.target.value }))} /></Field>
          <Field label={ar ? 'الوصف' : 'Description'}><TextInput value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={ar ? 'الماركة' : 'Brand'}><TextInput value={form.brand} onChange={(e) => setForm((f: any) => ({ ...f, brand: e.target.value }))} /></Field>
          <Field label={ar ? 'اللون' : 'Color'}><TextInput value={form.color} onChange={(e) => setForm((f: any) => ({ ...f, color: e.target.value }))} /></Field>
          <Field label={ar ? 'نوع التيدر' : 'Trailer type'}>
            <Select value={form.trailerType} onChange={(e) => setForm((f: any) => ({ ...f, trailerType: e.target.value }))}>
              <option value="">—</option>
              {TRAILER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'نوع التتبع (GPS)' : 'GPS type'}>
            <Select value={form.gpsType} onChange={(e) => setForm((f: any) => ({ ...f, gpsType: e.target.value }))}>
              <option value="">—</option>
              {GPS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
