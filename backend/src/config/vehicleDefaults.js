/**
 * Reference lists for the vehicles section: allowed values for choice fields.
 * A free field gets written many ways (three spellings of one make become three filter options and three companies; a small change to the third-party insurance label drops a row from reports). Values are stored as the Arabic text (sectorAr, colorAr, insurance.coverageTypeAr...) because filters, exports and reports read it directly; the list restricts what may be written, and is extended only from section settings. Users add missing items from the list itself.
 */

/** Row shape: stable key plus Arabic and English names. */
const row = (key, ar, en) => ({ key, nameAr: ar, nameEn: en || ar });

module.exports = {
  // Insurance
  coverageTypes: [
    row('third_party', 'طرف ثالث / ضد الغير', 'Third party'),
    row('comprehensive', 'شامل', 'Comprehensive'),
  ],
  insuranceCompanies: [
    row('alwalaa', 'الولاء', 'Al Walaa'),
    row('medgulf', 'ميد غلف', 'MedGulf'),
    row('alettihad', 'الإتحاد', 'Al Ettihad'),
    row('rajhi_takaful', 'تكافل الراجحي', 'Al Rajhi Takaful'),
    row('tawuniya', 'التعاونية للتأمين', 'Tawuniya'),
    row('saico', 'سايكو', 'SAICO'),
    row('wataniya', 'الوطنية للتأمين', 'Al Wataniya'),
  ],
  premiumStatuses: [
    row('bank_rajhi', 'ملكية بنك الراجحي', 'Owned by Al Rajhi Bank'),
    row('aljabr', 'ملكية شركة الجبر', 'Owned by Al Jabr'),
    row('snb', 'ملكية البنك الأهلي السعودي', 'Owned by SNB'),
  ],

  // Classification
  sectors: [
    row('light', 'النقل الخفيف', 'Light transport'),
    row('heavy', 'النقل الثقيل', 'Heavy transport'),
    row('branches', 'الفروع', 'Branches'),
    row('workshop', 'الورشة', 'Workshop'),
    row('stolen', 'مسروق', 'Stolen'),
    row('other', 'اخري', 'Other'),
  ],
  registrationTypes: [
    row('motorcycle', 'دراجة آلية', 'Motorcycle'),
    row('public_transport', 'نقل عام', 'Public transport'),
    row('private', 'خاص', 'Private'),
    row('private_transport', 'نقل خاص', 'Private transport'),
  ],
  // The two group companies. Operation is shared but ownership is split: license, insurance and violation belong to a specific company. A managed list, so a third company needs no code.
  ownerCompanies: [
    row('tanshit_logistics', 'تنشيط الخدمات اللوجيستية', 'Tanshit Logistics Services'),
    row('tanshit_future', 'تنشيط المستقبل', 'Tanshit Al-Mustaqbal'),
  ],
  possessionStatuses: [
    row('owner', 'مالك', 'Owner'),
    row('user', 'مستخدم', 'User'),
  ],
  serviceStatuses: [
    row('in_service', 'في الخدمة', 'In service'),
    row('unused', 'غير مستخدمة', 'Not in use'),
    row('stolen', 'مسروقة', 'Stolen'),
  ],
  colors: [
    row('white', 'ابيض', 'White'), row('black', 'اسود', 'Black'), row('red', 'احمر', 'Red'),
    row('silver', 'فضي', 'Silver'), row('grey', 'رمادي', 'Grey'), row('lead', 'رصاصي', 'Lead grey'),
    row('lead_light', 'رصاصي فاتح', 'Light lead grey'), row('beige', 'بيج', 'Beige'),
    row('orange', 'برتقالي', 'Orange'), row('blue', 'ازرق', 'Blue'), row('green', 'اخضر', 'Green'),
    row('yellow', 'اصفر', 'Yellow'),
  ],
  /** Makes: one canonical Arabic list; Latin spellings of the same make are merged into it by the cleanup script. */
  brands: [
    row('bajaj_boxer', 'بجاج بوكسر', 'Bajaj Boxer'), row('bajaj', 'بجي', 'Bajaj'),
    row('mercedes', 'مرسيدس', 'Mercedes-Benz'), row('cnht', 'سي ان اتش تي', 'CNHTC'),
    row('kia', 'كيا', 'Kia'), row('toyota', 'تويوتا', 'Toyota'), row('suzuki', 'سوزوكي', 'Suzuki'),
    row('sino', 'سينو', 'Sinotruk'), row('motorcycle', 'دراجة نارية', 'Motorcycle'),
    row('isuzu', 'ايسوزو', 'Isuzu'), row('changan', 'شنجان', 'Changan'), row('haval', 'هافال', 'Haval'),
    row('fiat', 'فيات', 'Fiat'), row('mazda', 'مازدا', 'Mazda'), row('renault', 'رينو', 'Renault'),
    row('honda', 'هوندا', 'Honda'), row('dodge', 'دودج', 'Dodge'), row('porsche', 'بورش', 'Porsche'),
    row('mg', 'ام جي', 'MG'), row('bmw', 'بي ام دبليو', 'BMW'), row('chevrolet', 'شيفروليه', 'Chevrolet'),
    row('maxus', 'ماكسوس', 'Maxus'), row('man', 'مان', 'MAN'), row('volkswagen', 'فولكسفاجن', 'Volkswagen'),
    row('landrover', 'لاند روفر', 'Land Rover'),
  ],

  // Fuel chip
  fuelProviders: [row('petroapp', 'بترو اب', 'PetroApp')],
  fuelCardStatuses: [
    row('active', 'نشط', 'Active'), row('inactive', 'غير نشط', 'Inactive'),
    row('not_required', 'غير مطلوب', 'Not required'), row('suspended', 'موقوف', 'Suspended'),
  ],
  consumptionTypes: [
    row('opened', 'Opened', 'Opened'),
    row('monthly', 'Monthly', 'Monthly'),
    row('limited', 'محدود', 'Limited'),
  ],

  // Tracking
  gpsProviders: [
    row('express', 'Express', 'Express'),
    row('location_solutions', 'Location solutions', 'Location Solutions'),
  ],
  gpsDevices: [
    row('fmc920', 'TELTONIKA - FMC 920', 'Teltonika FMC 920'),
    row('fmc130', 'TELTONIKA - FMC 130', 'Teltonika FMC 130'),
    row('fmb920', 'TELTONIKA - FMB 920', 'Teltonika FMB 920'),
    row('lc617', 'LC-617', 'LC-617'),
  ],
  gpsDeviceStatuses: [
    row('active', 'نشط', 'Active'), row('inactive', 'غير نشط', 'Inactive'),
    row('required', 'مطلوب', 'Required'), row('not_required', 'غير مطلوب', 'Not required'),
  ],

  // Inspection and authorization
  inspectionStatuses: [
    row('valid', 'ساري المفعول', 'Valid'), row('expired', 'منتهي', 'Expired'),
    row('not_required', 'غير مطلوب', 'Not required'),
  ],
  jobTitles: [
    row('heavy_driver', 'سائق نقل ثقيل', 'Heavy-transport driver'),
    row('delivery_rep', 'مندوب توصيل', 'Delivery rep'),
    row('rep', 'مندوب', 'Representative'),
    row('employee', 'موظف', 'Employee'),
    row('owner', 'مالك', 'Owner'),
  ],
};
