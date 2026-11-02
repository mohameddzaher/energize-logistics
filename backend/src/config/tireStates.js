/**
 * Tire states: one definition read by the server, web and mobile.
 * Location is a single axis (status); condition (new/used) describes the tire, not where it is. Previously two axes overlapped and a tire at the retread plant read as in the factory before arriving.
 * Under retread is a decision (tire is off and in workshop custody, recoverable today); In factory is a physical location (left the company, return unknown). They must stay separate or the workshop promises tires it does not hold.
 */

/** Per state: key, name, whether it counts as in stock, and color. Order is the card order on screen, a ladder from mounted to finished, not a count sort. */
const TIRE_STATES = [
  { key: 'mounted', ar: 'مركَّبة', en: 'Mounted', inStore: false, tone: 'emerald' },
  { key: 'new', ar: 'الجديد', en: 'New', inStore: true, tone: 'sky', grade: 'new' },
  { key: 'used', ar: 'المستعمل', en: 'Used', inStore: true, tone: 'slate', grade: 'used' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal', inStore: true, tone: 'amber' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory', inStore: true, tone: 'violet' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap', inStore: true, tone: 'orange' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged', inStore: false, tone: 'red' },
  { key: 'sold', ar: 'المباع', en: 'Sold', inStore: false, tone: 'zinc' },
];

/** Allowed status values in the model (includes legacy ones so old rows are not rejected). */
const STATUS_ENUM = ['mounted', 'spare', 'under_renewal', 'at_factory', 'scrap', 'damaged', 'sold', 'retired', 'in_repair'];

/** The bucket a tire falls in, used by both the counter and the filter. On shelf splits by condition (new or used), so no bucket named spare is shown. */
function tireState(tire) {
  const s = String(tire?.status || '');
  if (s === 'mounted') return 'mounted';
  if (s === 'in_repair') return 'under_renewal';          // Old name
  if (['under_renewal', 'at_factory', 'scrap', 'damaged', 'sold'].includes(s)) return s;
  if (s === 'retired') return 'scrap';                     // Legacy
  return tire?.condition === 'new' ? 'new' : 'used';       // spare
}

/** Whether it counts as in stock. */
const IN_STORE = new Set(TIRE_STATES.filter((x) => x.inStore).map((x) => x.key));
const isInStore = (tire) => IN_STORE.has(tireState(tire));

/** Destinations when removing a tire from a vehicle: six, not four. New vs used and retread vs factory were previously merged; each destination describes a genuinely different state that only the person removing the tire knows. */
const DISMOUNT_DESTINATIONS = [
  { key: 'new', ar: 'الجديد (على الرفّ)', en: 'New (shelf)', status: 'spare', condition: 'new', action: 'removed' },
  { key: 'used', ar: 'المستعمل (على الرفّ)', en: 'Used (shelf)', status: 'spare', condition: 'used', action: 'removed' },
  { key: 'under_renewal', ar: 'تحت التجديد', en: 'Under renewal', status: 'under_renewal', action: 'to_repair' },
  { key: 'at_factory', ar: 'في المصنع', en: 'At the factory', status: 'at_factory', action: 'to_repair' },
  { key: 'scrap', ar: 'السكراب', en: 'Scrap', status: 'scrap', action: 'scrapped' },
  { key: 'damaged', ar: 'التالف', en: 'Damaged', status: 'damaged', action: 'damaged' },
];

/** Movement-log action recorded for each state a tire is manually moved to. */
const STATUS_ACTION = {
  spare: 'to_store',
  under_renewal: 'to_repair',
  at_factory: 'to_repair',
  scrap: 'scrapped',
  damaged: 'damaged',
  sold: 'sold',
  retired: 'retired',
};

module.exports = { TIRE_STATES, STATUS_ENUM, tireState, isInStore, DISMOUNT_DESTINATIONS, STATUS_ACTION, IN_STORE };
