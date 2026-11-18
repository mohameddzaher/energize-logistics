// Deleting a customer anywhere moves it to the customers archive (backend services/customerArchive); these strings say so on every page.
export const archiveConfirmText = (name: string, ar: boolean) => (ar
  ? `حذف «${name}»؟ يُنقل العميل إلى «أرشيف العملاء» ويختفي من كلّ الأقسام والقوائم، وتبقى معاملاته كما هي. يُستعاد من الأرشيف، أو يُحذف منه نهائيًّا.`
  : `Delete “${name}”? The customer moves to the customers archive and leaves every section and list; its transactions stay. It can be restored from the archive, or deleted there for good.`);
export const archivedText = (ar: boolean) => (ar ? 'نُقل العميل إلى أرشيف العملاء' : 'Moved to the customers archive');
export const vendorArchiveConfirmText = (name: string, ar: boolean) => (ar
  ? `حذف «${name}»؟ يُنقل المورّد إلى «أرشيف الموردين»، وتبقى أوامر النقل كما هي. يُستعاد من الأرشيف أو يُحذف منه نهائيًّا.`
  : `Delete “${name}”? The vendor moves to the vendors archive; transport orders stay. Restore or delete it for good there.`);
export const CUSTOMERS_ARCHIVE_PATH = '/system/operations/customers-archive';
export const VENDORS_ARCHIVE_PATH = '/system/operations/vendors-archive';
