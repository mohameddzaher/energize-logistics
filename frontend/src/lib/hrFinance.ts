/**
 * ماليّاتُ الموارد البشريّة — رسومُ الإقامات ورخص العمل، وطلباتُ القسم إلى الماليّة.
 * الشكلُ كما يردّه backend/src/controllers/hrFinanceController.js.
 */
export interface HrFile { fileUrl: string; fileName: string; mimeType?: string; size?: number }

export interface HrDocPaymentInfo {
  _id: string; amount: number | null; note: string; files: HrFile[]; paidAt: string; paidByName: string;
}
export interface HrDocRow {
  key: string; employeeId: string; employeeNumber: string; name: string; idNumber: string;
  docType: 'iqama' | 'workPermit'; docAr: string; docEn: string;
  expiryDate: string; daysLeft: number; expired: boolean;
  department: string; staffCategory: string; project: string; nationality: string; branchName: string;
  registerNumber: string; workStatusText: string;
  paid: boolean; payment: HrDocPaymentInfo | null;
}
export type Opt = { value: string; count: number };
export interface HrDocsPayload {
  rows: HrDocRow[]; total: number; unpaidShown: number;
  counts: {
    windows: Record<string, number>;
    docs: Record<string, number>;
    paid: { all: number; paid: number; unpaid: number };
  };
  filters: { key: string; values: Opt[] }[];
  columnOptions: Record<string, Opt[]>;
  horizon: number; windows: number[]; today: string;
  can: { pay: boolean; undo: boolean };
}

export interface HrFinanceItem {
  _id: string; employee: string; name: string; employeeNumber: string; idNumber: string; department: string; note: string;
}
export interface HrFinanceRequest {
  _id: string; number: number; items: HrFinanceItem[]; files: HrFile[];
  status: 'pending' | 'done' | 'not_done';
  answerNote: string; answerFiles: HrFile[]; answeredByName: string; answeredAt: string | null;
  history: { status: string; note: string; files: HrFile[]; byName: string; at: string }[];
  createdByName: string; createdAt: string;
}

export const DOC_LABEL: Record<string, [string, string]> = {
  iqama: ['إقامة', 'Iqama'],
  workPermit: ['رخصة عمل', 'Work permit'],
};
export const PAID_LABEL: Record<string, [string, string]> = {
  paid: ['مدفوع', 'Paid'],
  unpaid: ['غير مدفوع', 'Unpaid'],
};
export const REQ_STATUS: Record<string, { ar: string; en: string; cls: string }> = {
  pending: { ar: 'قيد الانتظار', en: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  done: { ar: 'تمّ', en: 'Done', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  not_done: { ar: 'لم يتمّ', en: 'Not done', cls: 'bg-red-50 text-red-700 border-red-200' },
};

/** «متبقٍّ ٣ أيام» / «منتهية منذ ١٠ أيام». */
export const daysLeftText = (n: number, ar: boolean): string => {
  if (n < 0) return ar ? `منتهية منذ ${-n} يوم` : `Expired ${-n}d ago`;
  if (n === 0) return ar ? 'تنتهي اليوم' : 'Expires today';
  return ar ? `متبقٍّ ${n} يوم` : `${n}d left`;
};

export const fmtStamp = (v: string | null | undefined, ar: boolean): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
