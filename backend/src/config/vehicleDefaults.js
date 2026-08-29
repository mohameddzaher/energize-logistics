/**
 * القوائم المرجعيّة لقسم المركبات — القيم المسموح بها في الحقول ذات الاختيارات.
 *
 * ── لماذا قائمةٌ مغلقة أصلًا ─────────────────────────────────────────────────
 * الحقل الحرّ يُكتب بألف صيغة. «مرسيدس» و«MercedesBenz» و«MERCEDES» ثلاثةُ صفوف
 * لشيءٍ واحد في القاعدة، فيصير في الفلتر ثلاثةَ خيارات، وفي التحليل ثلاثَ
 * شركات، ولا يعرف أحدٌ أنّ عددها واحد. و«طرف ثالث / ضد الغير» يكفي أن يكتبها
 * أحدُهم «طرف ثالث - ضد الغير» ليخرج صفُّه من كلّ تقريرٍ عن تأمين الطرف الثالث.
 *
 * ── ولماذا تُخزَّن بالاسم العربيّ لا بالمفتاح ────────────────────────────────
 * الحقول هنا (`sectorAr`، `colorAr`، `insurance.coverageTypeAr`…) تحمل النصّ
 * العربيّ نفسه منذ أوّل استيراد، وتقرؤه الفلاتر والتصديرات والتقارير مباشرةً.
 * فتحويلها إلى مفاتيح يُبطل ذلك كلَّه دفعةً واحدة. والمقصود ليس تغييرَ ما
 * يُخزَّن، بل **حصرَ ما يُكتب** — فيبقى المخزَّن نصًّا عربيًّا، لكنّه لا يأتي
 * إلّا من هذه القائمة، ولا يُضاف إليها إلّا من إعدادات القسم.
 *
 * والمستخدم يزيد ما ينقص من داخل القائمة نفسها، فيراه كلُّ من بعده — وهذا هو
 * الفرق بين قائمةٍ تُدار وحقلٍ حرٍّ يتشعّب.
 */

/** ما يُبنى منه صفُّ القائمة: مفتاحٌ ثابت واسمٌ عربيّ وإنجليزيّ. */
const row = (key, ar, en) => ({ key, nameAr: ar, nameEn: en || ar });

module.exports = {
  // التأمين
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

  // التصنيف
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
  /**
   * الماركات: القائمة موحَّدةٌ بالعربيّة، وكلُّ صيغةٍ لاتينيّةٍ من الماركة نفسها
   * تُدمَج فيها بسكربت التنظيف. فـ«مرسيدس» واحدةٌ لا ثلاث.
   */
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

  // شريحة الوقود
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

  // التتبّع
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

  // الفحص والتفويض
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
