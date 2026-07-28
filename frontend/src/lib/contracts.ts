// إدارة العقود — types, vocabulary and access gates.
// Mirrors backend/src/routes/contracts.js + models/ContractModels.js.
import { canAccessSection, canEditSection, roleOf, permsOf, type RoleOrUser } from './sections';

export const CONTRACTS_STAFF_ROLES = ['super_admin', 'admin', 'contracts_manager', 'it_manager', 'it_specialist', 'operations_manager'];
export const CONTRACTS_EDIT_ROLES = ['super_admin', 'admin', 'contracts_manager', 'it_manager', 'it_specialist'];

export const canViewContracts = (u: RoleOrUser) => CONTRACTS_STAFF_ROLES.includes(roleOf(u)) || canAccessSection(permsOf(u), 'Contracts');
export const canEditContracts = (u: RoleOrUser) => CONTRACTS_EDIT_ROLES.includes(roleOf(u)) || canEditSection(permsOf(u), 'Contracts');

export interface ContractAttachment {
  _id: string; fileUrl: string; fileName: string; mimeType: string; size: number;
  title: string; uploadedByName: string; uploadedAt: string;
}

export interface ContractVendor {
  _id: string;
  name: string;
  energizeRep?: string;
  operationsRep?: string;
  vendorType?: string;
  contactPerson?: string;
  phone?: string;
  headquarters?: string;
  destinations?: string;
  coverage?: string;
  fleetSize?: number;
  vehicleTypes?: string;
  avgMonthlyLoadsPerVehicle?: number;
  monthlyCapacity?: number;
  crNumber?: string;
  vendorSideContract?: boolean;
  ourSideContract?: boolean;
  documentsReceived?: boolean;
  missingDocuments?: string;
  contractDate?: string | null;
  renewalPolicy?: string;
  paymentTermDays?: number;
  pricingNotes?: string;
  operationalStatus?: string;
  followUpNotes?: string;
  notes?: string;
  rating?: number | null;
  ratingNotes?: string;
  attachments?: ContractAttachment[];
  profileTables?: any[];
  status?: 'signed' | 'pending' | 'unsigned';
}

export interface UtilisationRow {
  _id: string; vendor?: string | null; vendorName: string; year: number; month: number;
  orders: number; fleetSize: number; expectedMonthlyCapacity: number;
  hasContract: boolean; vendorType: string; operationsRep: string; isExternal: boolean;
}

export interface ContractProspect {
  _id: string; companyName: string; contactPerson?: string; phone?: string;
  headquarters?: string; destinations?: string; vehicleType?: string;
  interestStatus?: string; isInterested?: boolean | null; contactDate?: string | null;
  assignedTo?: string; notes?: string; convertedVendor?: string | null;
}

export interface DeptContract {
  _id: string; department: string; partyType: 'vendor' | 'customer'; partyName: string;
  contactPerson?: string; phone?: string; email?: string; subject?: string;
  contractDate?: string | null; startDate?: string | null; endDate?: string | null;
  renewalPolicy?: string; paymentTermDays?: number | null; value?: number | null;
  status: 'draft' | 'active' | 'expired' | 'terminated'; notes?: string;
  attachments?: ContractAttachment[]; createdByName?: string;
}

export type Lang = 'en' | 'ar';

export const VENDOR_STATUS = {
  signed: { ar: 'موقّع', en: 'Signed', cls: 'bg-emerald-100 text-emerald-700' },
  pending: { ar: 'قيد التوقيع', en: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  unsigned: { ar: 'غير موقّع', en: 'Unsigned', cls: 'bg-slate-100 text-slate-600' },
} as const;

export const CATEGORY_LABELS = {
  signed: { ar: 'موقّعون — أجل ضريبي', en: 'Signed (tax credit)', cls: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  credit: { ar: 'غير موقّعين — أجل', en: 'Unsigned (credit)', cls: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
  cash: { ar: 'غير موقّعين — كاش', en: 'Unsigned (cash)', cls: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  external: { ar: 'أفراد خارجية', en: 'External individuals', cls: 'bg-red-100 text-red-700', bar: 'bg-red-500' },
} as const;
export type CategoryKey = keyof typeof CATEGORY_LABELS;

export const DEPT_LABELS: Record<string, { ar: string; en: string }> = {
  '3pl': { ar: 'موردو 3PL', en: '3PL Vendors' },
  fleet: { ar: 'عملاء إدارة الأسطول', en: 'Fleet Customers' },
  b2c: { ar: 'عملاء B2C', en: 'B2C Customers' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const DEPT_CONTRACT_STATUS = {
  draft: { ar: 'مسودة', en: 'Draft', cls: 'bg-slate-100 text-slate-600' },
  active: { ar: 'ساري', en: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { ar: 'منتهي', en: 'Expired', cls: 'bg-red-100 text-red-700' },
  terminated: { ar: 'مفسوخ', en: 'Terminated', cls: 'bg-slate-200 text-slate-700' },
} as const;

export const MONTH_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthLabel = (ym: string, ar: boolean) => {
  const [y, m] = ym.split('-').map(Number);
  return ar ? `${MONTH_AR[m]} ${y}` : new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
};

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const fmtN = (n?: number | null) => (n ?? 0).toLocaleString('en-US');
export const fmtD = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

export const foldAr = (x: string) => x.toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
