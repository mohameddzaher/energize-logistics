/**
 * A carrier truck or driver may work for several suppliers (`supplier` = primary, `suppliers` = all, primary included).
 * Pickers list the chosen supplier's own trucks and drivers first and, when searching, the rest of the register marked
 * «من خارج سجلّ هذا المورد». Picking one of those asks once whether to link it; declining uses it for this order only.
 */
import api from '@/lib/api';

type Ref = { _id?: string; name?: string } | string | null | undefined;
type Linkable = { _id?: string; supplier?: Ref; suppliers?: Ref[] };

const idOf = (r: Ref) => (r && typeof r === 'object' ? String(r._id || '') : String(r || ''));

export const supplierIdsOf = (row: Linkable | null | undefined): string[] => {
  const out: string[] = [];
  for (const r of [row?.supplier, ...(row?.suppliers || [])]) {
    const k = idOf(r);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
};

export const isLinkedTo = (row: Linkable | null | undefined, supplierId: string) =>
  !!supplierId && supplierIdsOf(row).includes(String(supplierId));

/** Names of the suppliers a row is linked to, for the «من خارج سجلّ هذا المورد» hint. */
export const supplierNamesOf = (row: Linkable | null | undefined): string[] => {
  const out: string[] = [];
  for (const r of [row?.supplier, ...(row?.suppliers || [])]) {
    const n = r && typeof r === 'object' ? String(r.name || '') : '';
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
};

export const outsideHint = (row: Linkable, ar: boolean) => {
  const names = supplierNamesOf(row);
  const base = ar ? 'من خارج سجلّ هذا المورد' : 'Outside this supplier';
  return names.length ? `${base} — ${ar ? 'مسجَّل على' : 'with'} ${names.join('، ')}` : base;
};

type Confirm = (o: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;

/**
 * Asks whether a truck or driver from outside the supplier's register should be linked to it. Returns true when linked.
 * A refusal or a failed link never blocks the pick: the order still uses it.
 */
export async function offerSupplierLink(opts: {
  kind: 'vehicle' | 'driver'; id: string; label: string; supplierId: string; supplierName: string; ar: boolean;
  confirm: Confirm; notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
}): Promise<boolean> {
  const { kind, id, label, supplierId, supplierName, ar, confirm, notify } = opts;
  if (!id || !supplierId) return false;
  const what = kind === 'vehicle' ? (ar ? 'الشاحنة' : 'truck') : (ar ? 'السائق' : 'driver');
  const yes = await confirm({
    title: ar ? 'ربطٌ بالمورد' : 'Link to supplier',
    message: ar
      ? (kind === 'vehicle'
        ? `الشاحنة «${label}» ليست في سجلّ المورد «${supplierName}». هل تُربط به لتظهر ضمن شاحناته من الآن؟`
        : `السائق «${label}» ليس في سجلّ المورد «${supplierName}». هل يُربط به ليظهر ضمن سائقيه من الآن؟`)
      : `This ${what} “${label}” is not in “${supplierName}”'s register. Link it so it shows under this supplier from now on?`,
    confirmLabel: ar ? 'ربط بالمورد' : 'Link',
    cancelLabel: ar ? 'لهذه الشحنة فقط' : 'This order only',
  });
  if (!yes) return false;
  try {
    await api.post(kind === 'vehicle' ? `/api/shipment-orders/vehicles/${id}/suppliers` : `/api/shipment-orders/drivers/${id}/suppliers`, { supplier: supplierId });
    notify(ar ? `${kind === 'vehicle' ? 'رُبطت الشاحنة' : 'رُبط السائق'} بالمورد «${supplierName}»` : `Linked to “${supplierName}”`, 'success');
    return true;
  } catch (e: any) {
    notify(e?.message || (ar ? 'تعذّر الربط' : 'Could not link'), 'error');
    return false;
  }
}
