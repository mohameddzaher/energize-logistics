/**
 * Operations sheet fields with their groups, as shown by the sheet page.
 * Extracted from the sheet page because the customs clearance transaction page also shows and edits the full sheet (components/customs/LinkedOpsReports), so one list avoids drift. Who sees and writes what comes from the server per field (stripRowFor, fieldsForRole in workflowController).
 */
export type WorkflowFieldType = 'date' | 'number' | 'ptype' | undefined;
export interface WorkflowField { key: string; label: string; labelEn: string; type?: WorkflowFieldType }
export interface WorkflowSection {
  title: string; titleAr: string; group: string; color: string; headerColor: string;
  fields: WorkflowField[];
}

export const WORKFLOW_SECTIONS: WorkflowSection[] = [
  {
    title: 'Application Details', titleAr: 'بيانات الطلب', group: 'application', color: 'border-cyan-600', headerColor: 'text-cyan-700',
    fields: [
      { key: 'reportNumber', label: 'رقم أمر النقل', labelEn: 'Report Number' },
      { key: 'reportDate', label: 'تاريخ أمر النقل', labelEn: 'Report Date', type: 'date' },
      { key: 'loadingTime', label: 'وقت التحميل', labelEn: 'Loading Time' },
      { key: 'fromLocation', label: 'عنوان الشحن', labelEn: 'Shipping Address' },
      { key: 'toLocation', label: 'عنوان الوصول', labelEn: 'Arrival Address' },
      { key: 'branch', label: 'الفرع', labelEn: 'Branch' },
      { key: 'carOwner', label: 'مالك السيارة', labelEn: 'Car Owner' },
      { key: 'carNumber', label: 'رقم السيارة', labelEn: 'Car Number' },
      { key: 'ownerType', label: 'نوع المالك', labelEn: 'Owner Type' },
      { key: 'executionStatus', label: 'حالة التنفيذ', labelEn: 'Execution Status' },
      { key: 'applicationStatus', label: 'الحالة', labelEn: 'Status' },
      { key: 'driverRentalType', label: 'نوع تأجير السائق', labelEn: 'Driver Rental Type' },
      { key: 'username', label: 'اسم العميل', labelEn: 'Customer name' },
      { key: 'paymentMethod', label: 'طريقة الدفع', labelEn: 'Payment Method' },
      { key: 'purchaseValue', label: 'سعر الشراء', labelEn: 'Purchase Value', type: 'number' },
      { key: 'sellingValue', label: 'سعر البيع', labelEn: 'Selling Value', type: 'number' },
      { key: 'reference', label: 'رقم المرجع', labelEn: 'Reference' },
      { key: 'userPhone', label: 'هاتف العميل', labelEn: 'Customer phone' },
      { key: 'driverName', label: 'اسم السائق', labelEn: 'Driver Name' },
      { key: 'driverPhone', label: 'هاتف السائق', labelEn: 'Driver Phone' },
      { key: 'carName', label: 'اسم السيارة', labelEn: 'Car Name' },
      { key: 'plateNumber', label: 'رقم اللوحة', labelEn: 'Plate Number' },
      { key: 'truckType', label: 'نوع الشاحنة', labelEn: 'Truck Type' },
      { key: 'truckSize', label: 'حجم الشاحنة', labelEn: 'Truck Size' },
      { key: 'loadType', label: 'نوع الحمولة', labelEn: 'Load Type' },
      { key: 'quantity', label: 'الكمية', labelEn: 'Quantity' },
      { key: 'goodsValue', label: 'قيمة البضائع', labelEn: 'Goods Value', type: 'number' },
      { key: 'representativeName', label: 'اسم المندوب', labelEn: 'Representative' },
      { key: 'country', label: 'اسم الدولة', labelEn: 'Country' },
    ],
  },
  {
    title: 'Operations Review', titleAr: 'مراجعه التشغيل', group: 'operations', color: 'border-teal-600', headerColor: 'text-teal-700',
    fields: [
      { key: 'operationsReview', label: 'مراجعه التشغيل', labelEn: 'Operations Review' },
    ],
  },
  {
    title: 'Manual Moderator', titleAr: 'بيانات المودريتور', group: 'manual_moderator', color: 'border-orange-600', headerColor: 'text-orange-600',
    fields: [
      { key: 'paymentDate', label: 'تاريخ السداد', labelEn: 'Payment Date', type: 'date' },
      { key: 'payingBranch', label: 'الفرع المسدد', labelEn: 'Paying Branch' },
      // Six are shown and four are selectable; see lib/paymentKind.
      { key: 'paymentType', label: 'نوع الدفع', labelEn: 'Payment Type', type: 'ptype' },
      { key: 'finalReportDestination', label: 'وجهه أمر النقل النهائي', labelEn: 'Final Report Dest.' },
      { key: 'documentNumber', label: 'رقم السند', labelEn: 'Document Number' },
      { key: 'sendingDate', label: 'تاريخ الارسال', labelEn: 'Sending Date', type: 'date' },
      { key: 'deliveryDate', label: 'تاريخ التسليم', labelEn: 'Delivery Date', type: 'date' },
      { key: 'accountingReview', label: 'مراجعه الحسابات', labelEn: 'Accounting Review' },
    ],
  },
  {
    title: 'Collections', titleAr: 'بيانات التحصيل', group: 'collections', color: 'border-blue-600', headerColor: 'text-blue-600',
    fields: [
      { key: 'invoiceNumber', label: 'رقم الفاتوره', labelEn: 'Invoice Number' },
      { key: 'netInvoice', label: 'صافي الفاتوره', labelEn: 'Net Invoice', type: 'number' },
      { key: 'tax', label: 'ضريبه', labelEn: 'Tax', type: 'number' },
      { key: 'totalInvoice', label: 'اجمالى الفاتوره', labelEn: 'Total Invoice', type: 'number' },
      { key: 'invoiceDate', label: 'تاريخ الفاتوره', labelEn: 'Invoice Date', type: 'date' },
      { key: 'invoiceNotes', label: 'ملاحظات الفاتوره', labelEn: 'Invoice Notes' },
      { key: 'collectionDate', label: 'تاريخ التحصيل', labelEn: 'Collection Date', type: 'date' },
    ],
  },
];
