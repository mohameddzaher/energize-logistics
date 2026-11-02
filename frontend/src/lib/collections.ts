// Collections section: types and permissions in one place.
// The gate is one rule: the fixed role list OR a grant from the permission matrix. Copying it into each page made sections open for a granted user yet read-only, because their buttons were guarded by a different list.
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';

export const SECTION = 'Collections';

export const COLLECTIONS_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'cfo', 'accounting_manager', 'accountant',
];

export const COLLECTIONS_EDIT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff', 'cfo', 'accounting_manager',
];

// Section settings and deleting parties are for its manager: disabling a party hides a debt from every report.
export const COLLECTIONS_ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'collections_manager'];

export const canViewCollections = (u: RoleOrUser): boolean =>
  COLLECTIONS_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), SECTION);

export const canEditCollections = (u: RoleOrUser): boolean =>
  COLLECTIONS_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), SECTION);

export const isCollectionsAdmin = (u: RoleOrUser): boolean =>
  COLLECTIONS_ADMIN_ROLES.includes(roleOf(u));

/** Editing an invoice's value is a financial decision, not daily collection work. Role-only: granting the section edit does not open it, and the server guards it with authorize.strict on the same list (collectionsDeptController.AMOUNT_EDIT_ROLES). */
export const AMOUNT_EDIT_ROLES = ['super_admin', 'admin', 'collections_manager', 'cfo', 'accounting_manager'];

export const canEditInvoiceAmount = (u: RoleOrUser): boolean =>
  AMOUNT_EDIT_ROLES.includes(roleOf(u));

/**
 * Who sees what we owe.
 * Collections collects and has nothing to do with supplier payments, net or profit, so amounts owed by us and the net are hidden from its two roles, not from the section: management, finance and the operations manager open the same section and see both sides. The rule is by role because the section is shared by people with different duties.
 */
const RECEIVABLES_ONLY_ROLES = ['collections_manager', 'collections_staff'];

/** Whether this user is limited to what is owed to us. */
export const receivablesOnly = (u: RoleOrUser): boolean =>
  RECEIVABLES_ONLY_ROLES.includes(roleOf(u));

export type PartyKind = 'customer' | 'supplier';

export interface CollectionsParty {
  _id: string;
  kind: PartyKind;
  name: string;
  nameKey?: string;
  phone?: string;
  email?: string;
  /** More than one email; `email` is the first. See backend utils/partyEmails. */
  emails?: string[];
  contactPerson?: string;
  contactPhone?: string;
  accountantName?: string;
  accountantPhone?: string;
  commercialRegister?: string;
  taxNumber?: string;
  iban?: string;
  bankName?: string;
  address?: string;
  city?: string;
  partyType?: string;
  // Account data in the collections ledger: accounting code (its identity, not its name), owner, rating, who sells to it from our side, and the agreed payment term.
  code?: string;
  aliases?: string[];
  collectionOfficer?: string;
  /** Effective officer: the named employee, otherwise the department manager (never unassigned). */
  effectiveOfficer?: string;
  /** The effective officer comes from the manager; the account was not assigned to an employee. */
  officerIsDefault?: boolean;
  hoLocation?: string;
  grade?: string;
  salesManagers?: string[];
  department?: string;
  region?: string;
  creditDays?: number;
  // Customer payment type; the payment type on its statements is filled from it.
  paymentType?: '' | 'cash' | 'tax';
  paymentTerms?: string;
  creditLimit?: number;
  status?: string;
  assignedTo?: { _id: string; firstName?: string; lastName?: string } | string | null;
  lastContactAt?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string;
  isActive?: boolean;
  source?: string;
  // Derived from statements, not stored on the record, so the file and the statement never show two numbers for one thing.
  reports: number;
  total: number;
  settled: number;
  outstanding: number;
  openReports: number;
  // For customers: from the invoice ledger (the money above comes from it too).
  invoices?: number;
  openInvoices?: number;
  invoiced: number;
  lastReportAt?: string | null;
  lastSettledAt?: string | null;
  nameVariants?: string[];
}

// Owed to us vs owed by us: the wording differs by party, and mixing them makes a debt we owe read as money owed to us.
export const kindWords = (kind: PartyKind, ar: boolean) =>
  kind === 'customer'
    ? {
      title: ar ? 'العملاء' : 'Customers',
      one: ar ? 'عميل' : 'customer',
      // From the invoice ledger: invoiced, collected and remaining.
      totalLabel: ar ? 'إجمالي المفوتَر' : 'Total invoiced',
      settledLabel: ar ? 'المحصَّل' : 'Collected',
      dueLabel: ar ? 'المستحق لنا' : 'Receivable',
      openLabel: ar ? 'فواتير لم تُحصَّل' : 'Open invoices',
      newOne: ar ? 'عميل جديد' : 'New customer',
    }
    : {
      title: ar ? 'الموردون' : 'Suppliers',
      one: ar ? 'مورد' : 'supplier',
      totalLabel: ar ? 'إجمالي المشتريات' : 'Total purchased',
      settledLabel: ar ? 'المسدَّد' : 'Paid',
      dueLabel: ar ? 'المستحق عليه' : 'Payable',
      openLabel: ar ? 'أوامر نقل لم تُسدَّد' : 'Unpaid reports',
      newOne: ar ? 'مورد جديد' : 'New supplier',
    };

export const money = (n?: number | null) =>
  (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

/** Payment type name as displayed. */
export const paymentTypeLabel = (t: string | undefined, ar: boolean) =>
  t === 'cash' ? (ar ? 'كاش' : 'Cash') : t === 'tax' ? (ar ? 'ضريبي' : 'Tax') : '—';

// Collections ledger

/** An age bucket as the team reads it in their sheet. */
export interface AgeBand { key: string; label: string; min: number | null }

export interface AgingRow extends CollectionsParty {
  /** Debt has two sides: tax invoices from the invoice ledger, and uncollected cash statements. Cash was not counted, so a cash account showed zero while owing tens of thousands. See cashAgingByParty on the server. */
  taxOutstanding?: number;
  cashOutstanding?: number;
  outstanding: number;
  invoiceCount: number;
  bands: Record<string, number>;
  bandCounts: Record<string, number>;
  /** Ratio of what is owed to the credit limit; null when there is no limit. */
  limitUsedPct: number | null;
}

export interface LedgerInvoice {
  _id: string;
  invoiceNumber: string;
  kind: 'tax' | 'cash';
  partyCode?: string;
  partyName?: string;
  party?: string;
  total: number;
  invoiceDate?: string | null;
  deliveryDate?: string | null;
  collectionDate?: string | null;
  status?: string;
  comments?: string;
  reportNumbers?: string[];
  // Computed at read time, not stored: a stored number is right the day it is written and wrong the next.
  ageDays?: number | null;
  band?: string;
  daysInvoiceToDelivery?: number | null;
  daysDeliveryToCollection?: number | null;
  daysTotal?: number | null;
  creditDays?: number;
  dueDate?: string | null;
  daysToDue?: number | null;
  overdue?: boolean;
}

export interface CollectionTask {
  _id: string;
  party?: string;
  partyCode?: string;
  partyName?: string;
  officerName?: string;
  date: string;
  requestType?: string;
  planned?: boolean;
  status?: string;
  collected?: number;
  action?: string;
  notes?: string;
}

export interface OfficerStat {
  officer: string;
  accounts: number;
  collectedCount: number;
  collectedAmount: number;
  openCount: number;
  openAmount: number;
  overdueCount: number;
  overdueAmount: number;
  withinTermsAmount: number;
  agedOver60Amount: number;
  avgDaysToCollect: number | null;
  collectionRate: number | null;
  withinTermsRate: number | null;
  agedOver60Rate: number | null;
  tasks?: number;
  tasksDone?: number;
  tasksCollected?: number;
}

/** Customer rating, coloured to be read at a glance. */
export const gradeTone = (g?: string) => {
  const k = String(g || '').toUpperCase();
  if (k.startsWith('A')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (k.startsWith('B')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (k.startsWith('C')) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

/** Colour for credit-limit usage. No colour when there is no limit: grey means no ceiling is set, which is information in itself and must not read as healthy. */
export const limitTone = (pct: number | null | undefined) => {
  if (pct == null) return 'text-slate-400';
  if (pct >= 100) return 'text-red-600 font-semibold';
  if (pct >= 80) return 'text-amber-600 font-semibold';
  return 'text-emerald-600';
};

/** Days until due, in words rather than a negative number. */
export const dueWords = (d: number | null | undefined, ar: boolean) => {
  if (d == null) return '—';
  if (d < 0) return ar ? `متأخّرة ${Math.abs(d)} يومًا` : `${Math.abs(d)}d overdue`;
  if (d === 0) return ar ? 'تستحقّ اليوم' : 'due today';
  return ar ? `بعد ${d} يومًا` : `in ${d}d`;
};

/**
 * Age bucket name in words, not the ledger code.
 * Codes like "15-" and "60+" mean up to 15 and from 60, but in Arabic they render reversed and stick to the preceding number (age 8 and bucket "15-" read as "-815"). So they are shown in words; the key stays the same in filters and on the server.
 */
const BAND_LABELS: Record<string, [string, string]> = {
  '15-': ['حتى 15 يومًا', 'Up to 15 days'],
  '30-': ['15 – 30 يومًا', '15 – 30 days'],
  '45-': ['30 – 45 يومًا', '30 – 45 days'],
  '60-': ['45 – 60 يومًا', '45 – 60 days'],
  '60+': ['60 – 90 يومًا', '60 – 90 days'],
  '90+': ['90 – 120 يومًا', '90 – 120 days'],
  '120+': ['120 يومًا – سنة', '120 days – 1 year'],
  '1Y+': ['أكثر من سنة', 'Over a year'],
  noDate: ['بلا تاريخ', 'No date'],
};
export const bandLabel = (key: string | null | undefined, ar: boolean) => {
  if (!key) return '';
  const l = BAND_LABELS[key];
  return l ? (ar ? l[0] : l[1]) : key;
};

/**
 * Collections officer name as displayed; never "unassigned".
 * Unassigned accounts belong to the department manager, and the server sends the effective officer (effectiveOfficer). If it still arrives empty (no manager exists), the department manager label is shown.
 */
export const officerLabel = (
  r: { effectiveOfficer?: string; collectionOfficer?: string; officer?: string } | null | undefined,
  ar: boolean,
) => (r?.effectiveOfficer || r?.collectionOfficer || r?.officer || (ar ? 'مدير القسم' : 'Dept. manager'));
