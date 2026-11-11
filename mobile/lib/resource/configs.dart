import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/person_docs.dart';
import '../screens/crm_company_profile.dart';
import '../screens/contracts_vendor_profile.dart';
import '../screens/contracts_customer_suggestions.dart';
import '../screens/contracts_agreement_files.dart';
import '../screens/customs_detail.dart';
import '../screens/customs_party.dart';
import '../screens/customs_contracts.dart' show manageCustomsContractFiles;
import '../screens/collection_attachments.dart';
import '../screens/collection_collect.dart';
import '../screens/collections_party.dart' show CollectionsPartyScreen, openCollectionsBulkAssign;
import '../ui/customs_contract_pricing.dart';
import '../screens/fleet_customer_profile.dart';
import '../screens/fleet_vehicle_analytics.dart';
import '../screens/fleet_vehicle_actions.dart';
import '../screens/customer_registry_profile.dart';
import '../screens/ops_customer_portal.dart';
import '../screens/bd_opportunity_detail.dart';
import '../screens/marketing_campaign_detail.dart';
import '../screens/light_transport_add.dart';
import '../screens/light_transport_profile.dart';
import '../screens/hr_ops.dart' show hrStockAssign, HrAssetVocab;
import '../screens/supplier_merge.dart' show openSupplierMerge;
import 'resource.dart';

/// Page definitions on the CRUD engine — each entry IS a full native page
/// (list + search + create + edit + delete + live), matching the web page of
/// the same name and the same API.

String _s(Map<String, dynamic> r, String k) => (r[k] ?? '').toString();

/// A number with thousands separators; a long number without them is unreadable on a phone screen.
String _n(dynamic v) {
  final n = v is num ? v : num.tryParse((v ?? '').toString()) ?? 0;
  final whole = n.round().abs().toString();
  final buf = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) buf.write(',');
    buf.write(whole[i]);
  }
  return buf.toString();
}

// Company relation field for CRM records (deal/contact/task/activity): links them to a company instead of leaving them orphaned. Shows the Arabic name if present, else the English.
FieldSpec _crmCompanyLookup() => FieldSpec('company', 'الشركة', 'Company',
    type: FieldType.lookup, lookupEndpoint: '/api/crm/companies', lookupListKey: 'companies',
    lookupLabel: (r) => _s(r, 'arabicName').isNotEmpty ? _s(r, 'arabicName') : _s(r, 'name'));

/// Vehicle document state as the server sends it: { state, days, expiryDate }. The same states are used in the vehicles section and on the web: one vocabulary, not three.
bool _docBad(dynamic d) {
  if (d is! Map) return false;
  return ['expired', 'critical', 'warning'].contains((d['state'] ?? '').toString());
}

String _docWord(dynamic d) {
  final st = (d is Map ? d['state'] : '').toString();
  return st == 'expired' ? 'منتهي' : st == 'critical' ? 'حرج' : 'قارب الانتهاء';
}

Color _docColor(dynamic d) {
  final st = (d is Map ? d['state'] : '').toString();
  return st == 'expired' ? T.danger : st == 'critical' ? T.orange : T.warn;
}

// Fleet management.
final fleetDriversCfg = ResourceConfig(
  arTitle: 'السائقون', enTitle: 'Drivers', icon: Icons.badge_outlined,
  // A driver edit is announced with fleet:drivers (fleet:updated for loads); the screen listened to the second only, so it did not refresh after a driver edit.
  endpoint: '/api/fleet/drivers', listKey: 'drivers', liveEvent: 'fleet:drivers',
  extraLiveEvents: const ['fleet:updated', 'fleet:vehicles', 'hr:employee', 'hr:master', 'vreg:updated'],
  // The mate's name is searchable too: someone typing a driver name wants his row and his truck-mate's row. The server sends mate with each row, so the local search reads it by dot path.
  searchFields: const ['name', 'phone', 'iqama', 'mate.name'],
  // Top-of-list chips: the worst of iqama expiry and driving license (like the website filter).
  filterField: 'docsState', filterOptions: personDocStates,
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'phone'), _s(r, 'iqama')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    r['working'] != false ? ('يعمل', T.success) : ('متوقف', T.inkFaint),
    r['hrLinked'] == true ? ('من الموارد البشرية', T.info) : ('غير مرتبط بموظف', T.warn),
    if (r['onSponsorship'] == true) ('على الكفالة', T.info),
    if (r['vehicle'] is Map) (_s(r['vehicle'] as Map<String, dynamic>, 'plate'), T.navy),
    // His rank on the truck.
    // Second driver is a rank read on the waybill and the shipment form, and the screen showed the plate without saying first or second, so the truck crew had to be guessed.
    if (r['vehicle'] is Map) (r['seat'] == 2 ? 'سائق ثانٍ' : 'سائق أول', r['seat'] == 2 ? T.violet : T.info),
    // And who else is on the truck.
    // A truck carries two drivers, and the question after the plate is always who is with him.
    if (r['mate'] is Map)
      ('مع ${_s(r['mate'] as Map<String, dynamic>, 'name')}', T.violet)
    else if (r['vehicle'] is Map)
      (r['seat'] == 2 ? 'المقعد الأول شاغر' : 'المقعد الثاني شاغر', T.inkFaint),
    // And his iqama and driving license expiry, from his HR file.
    ...personDocChips(r),
  ],
  // Quick toggle of work/sponsorship status from the row menu without opening the form.
  rowActions: (r) => [
    // Linking to his HR file.
    // A linked driver's name, mobile and ID are read from his file; unlinked ones (mostly written by first name) are linked from here as on the website page.
    ResourceAction(
      icon: Icons.link_rounded,
      ar: r['hrLinked'] == true ? 'تغيير الموظف المرتبط' : 'ربط بموظف',
      en: r['hrLinked'] == true ? 'Change linked employee' : 'Link to employee',
      color: T.navy,
      run: (ctx, row) => openFleetDriverLink(ctx, row),
    ),
    ResourceAction(
      icon: r['working'] != false ? Icons.pause_circle_outline : Icons.play_circle_outline,
      ar: r['working'] != false ? 'إيقاف عن العمل' : 'إعادة للعمل',
      en: r['working'] != false ? 'Set not working' : 'Set working',
      color: r['working'] != false ? T.warn : T.success,
      request: (row) => ('PUT', '/api/fleet/drivers/${row['_id']}', {'working': !(row['working'] != false)}),
    ),
    ResourceAction(
      icon: Icons.badge_outlined,
      ar: r['onSponsorship'] == true ? 'إزالة من الكفالة' : 'وضع على الكفالة',
      en: r['onSponsorship'] == true ? 'Remove sponsorship' : 'Put on sponsorship',
      color: T.info,
      request: (row) => ('PUT', '/api/fleet/drivers/${row['_id']}', {'onSponsorship': !(row['onSponsorship'] == true)}),
    ),
    // Moving him up or down between the two seats from the row.
    // The seat is changed on the web from the trucks table and on the phone from the driver row: the supervisor on the road decides who drives first today. The server performs the swap, so whoever is moved to first sends his mate to second.
    if (r['vehicle'] is Map)
      ResourceAction(
        icon: r['seat'] == 2 ? Icons.arrow_upward : Icons.arrow_downward,
        ar: r['seat'] == 2 ? 'ارفعه سائقًا أول' : 'اجعله سائقًا ثانيًا',
        en: r['seat'] == 2 ? 'Make first driver' : 'Make second driver',
        color: T.violet,
        request: (row) => ('PUT', '/api/fleet/drivers/${row['_id']}', {'seat': row['seat'] == 2 ? 1 : 2}),
      ),
  ],
  fields: [
    const FieldSpec('name', 'اسم السائق', 'Name', required: true),
    const FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    const FieldSpec('iqama', 'رقم الإقامة', 'Iqama', type: FieldType.number),
    // The HR nationality list, so the fleet and HR write one spelling.
    FieldSpec('nationality', 'الجنسية', 'Nationality', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=hr_nationality&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=300',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('vehicle', 'السيارة', 'Vehicle', type: FieldType.lookup,
        lookupEndpoint: '/api/fleet/vehicles', lookupListKey: 'vehicles',
        lookupLabel: (v) => [_s(v, 'plate'), _s(v, 'name')].where((x) => x.isNotEmpty).join(' · ')),
    const FieldSpec('seat', 'مقعده', 'Seat', type: FieldType.select, options: [
      ('1', 'سائق أول', 'First driver'),
      ('2', 'سائق ثانٍ', 'Second driver'),
    ]),
    const FieldSpec('working', 'يعمل حاليًا', 'Working', type: FieldType.checkbox),
    const FieldSpec('onSponsorship', 'على الكفالة', 'On sponsorship', type: FieldType.checkbox),
    const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final fleetVehiclesCfg = ResourceConfig(
  // Tapping the vehicle opens its analysis (like web /system/fleet/vehicles/[id]); editing is by long press.
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => FleetVehicleAnalyticsScreen(vehicleId: (r['_id'] ?? '').toString(), plate: (r['plate'] ?? '').toString()))),
  filterField: 'trailerType',
  arTitle: 'سيارات الأسطول', enTitle: 'Fleet Vehicles', icon: Icons.local_shipping_outlined,
  endpoint: '/api/fleet/vehicles', listKey: 'vehicles', liveEvent: 'fleet:vehicles',
  extraLiveEvents: const ['fleet:updated', 'fleet:drivers', 'vreg:updated'],
  searchFields: const ['plate', 'name', 'trailerType', 'supervisorName'],
  titleOf: (r) => _s(r, 'plate'),
  // Its crew by rank on the second line.
  // Who is on this truck is the supervisor's first question, and the line showed the truck name and supervisor but not the driver. The server sends drivers ordered by seat.
  subtitleOf: (r) {
    final crew = List<Map<String, dynamic>>.from((r['drivers'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
    final first = crew.firstWhere((d) => (d['seat'] ?? 1) == 1, orElse: () => const {});
    final second = crew.firstWhere((d) => d['seat'] == 2, orElse: () => const {});
    final who = [
      if (first.isNotEmpty) '${_s(first, 'name')} (أول)',
      if (second.isNotEmpty) '${_s(second, 'name')} (ثانٍ)',
    ].join(' · ');
    return [who.isEmpty ? 'بدون سائق' : who, _s(r, 'supervisorName')].where((x) => x.isNotEmpty).join(' — ');
  },
  chipsOf: (r) {
    final crew = (r['drivers'] as List? ?? const []).length;
    return [
      if (_s(r, 'trailerType').isNotEmpty) (_s(r, 'trailerType'), T.navy),
      if (_s(r, 'gpsType').isNotEmpty) ('GPS: ${_s(r, 'gpsType')}', T.cyan),
      if (crew == 0) ('بدون سائق', T.danger) else if (crew == 1) ('سائق واحد', T.warn) else ('سائقان', T.success),
    ];
  },
  fields: const [
    FieldSpec('plate', 'اللوحة', 'Plate', required: true),
    FieldSpec('name', 'اسم السيارة', 'Name'),
    FieldSpec('brand', 'الماركة', 'Brand'),
    FieldSpec('color', 'اللون', 'Color'),
    FieldSpec('trailerType', 'نوع المقطورة', 'Trailer type', type: FieldType.select, options: [
      ('سطحة', 'سطحة', 'Flatbed'), ('ستارة', 'ستارة', 'Curtain'), ('جوانب', 'جوانب', 'Sides'),
      ('براد', 'براد', 'Reefer'), ('صهريج', 'صهريج', 'Tanker'), ('لوبد', 'لوبد', 'Lowbed'),
    ]),
    FieldSpec('gpsType', 'نوع الـ GPS', 'GPS type', type: FieldType.select, options: [
      ('LS', 'LS', 'LS'), ('EX', 'EX', 'EX'),
    ]),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
  // The crew (both seats) and the supervisor from the row menu, like the drivers columns and supervisor button on the web.
  rowActions: (r) => const [
    ResourceAction(icon: Icons.groups_outlined, ar: 'الطاقم (السائقان)', en: 'Crew (drivers)', color: T.navy, run: openFleetVehicleCrew),
    ResourceAction(icon: Icons.manage_accounts_outlined, ar: 'تعيين المشرف', en: 'Assign supervisor', color: T.orange, run: openFleetVehicleSupervisor),
  ],
);

final fleetCustomersCfg = ResourceConfig(
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => FleetCustomerProfileScreen(customerId: (r['_id'] ?? '').toString()))),
  arTitle: 'عملاء الأسطول', enTitle: 'Fleet Customers', icon: Icons.people_outline,
  endpoint: '/api/fleet/customers', listKey: 'customers', liveEvent: 'fleet:customers',
  extraLiveEvents: const ['fleet:updated', 'customers:changed'],
  searchFields: const ['customerCode', 'name', 'phone', 'email', 'taxNumber'],
  // The code first: it identifies the customer in every section.
  titleOf: (r) => _s(r, 'customerCode').isEmpty ? _s(r, 'name') : '${_s(r, 'customerCode')} · ${_s(r, 'name')}',
  // The second line carries his numbers, not only contact data: two hundred customers in a list without numbers is an inventory to scroll, not a register to read from the most active.
  subtitleOf: (r) {
    final trips = (r['trips'] ?? 0).toString();
    final income = (r['income'] ?? 0);
    final parts = <String>[
      if ((r['trips'] ?? 0) != 0) 'حمولات: $trips',
      if (income != 0) 'الدخل: ${(income is num ? income : num.tryParse('$income') ?? 0).round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},')}',
      _s(r, 'phone'),
    ];
    return parts.where((x) => x.isNotEmpty).join(' · ');
  },
  chipsOf: (r) => [
    // Agreed payment type: auto-filled on every new load for him.
    if (r['paymentType'] == 'tax') ('ضريبي', T.violet),
    if (r['paymentType'] == 'cash') ('كاش', T.success),
    if ((r['openTrips'] ?? 0) != 0) ('${r['openTrips']} جارية', T.warn),
    if (r['crmCompany'] != null) ('مرتبط بالـCRM', T.info),
    if (r['isActive'] == false) ('معطَّل', T.inkFaint),
  ],
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Name', required: true),
    FieldSpec('paymentType', 'نوع الدفع المتفق عليه', 'Agreed payment type', type: FieldType.select,
        options: [('tax', 'ضريبي', 'Tax invoice'), ('cash', 'كاش', 'Cash')]),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    FieldSpec('taxNumber', 'الرقم الضريبي', 'Tax number'),
    FieldSpec('address', 'العنوان', 'Address'),
    FieldSpec('customerType', 'نوع العميل', 'Customer type', type: FieldType.select,
        options: [('heavy', 'نقل ثقيل', 'Heavy transport'), ('branch', 'عميل فروع', 'Branch customer')]),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
  // General delete only deactivates; the web permanently deletes a customer with no loads, so removal is a row action.
  canDelete: false,
  rowActions: (r) => const [
    ResourceAction(icon: Icons.delete_outline, ar: 'إزالة', en: 'Remove', color: T.danger, run: removeFleetCustomer),
  ],
);

/// Deactivated (archived) customers: the web shows them with the status filter inactive and restores them with a reactivate button; one with no loads is permanently deleted.
final fleetCustomersArchivedCfg = ResourceConfig(
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => FleetCustomerProfileScreen(customerId: (r['_id'] ?? '').toString()))),
  arTitle: 'العملاء المؤرشفون', enTitle: 'Archived Customers', icon: Icons.archive_outlined,
  endpoint: '/api/fleet/customers', listKey: 'customers', liveEvent: 'fleet:customers',
  listQuery: 'state=${Uri.encodeQueryComponent('معطَّل')}',
  searchFields: const ['customerCode', 'name', 'phone', 'email', 'taxNumber'],
  // The code first: it identifies the customer in every section.
  titleOf: (r) => _s(r, 'customerCode').isEmpty ? _s(r, 'name') : '${_s(r, 'customerCode')} · ${_s(r, 'name')}',
  subtitleOf: (r) => [if ((r['trips'] ?? 0) != 0) 'حمولات: ${r['trips']}', _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [('معطَّل', T.inkFaint)],
  canCreate: false, canEdit: false, canDelete: false,
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Name'),
    FieldSpec('phone', 'رقم الجوال', 'Phone'),
    FieldSpec('email', 'البريد الإلكتروني', 'Email'),
  ],
  rowActions: (r) => [
    const ResourceAction(icon: Icons.restore, ar: 'إعادة تفعيل', en: 'Restore', color: T.success, run: restoreFleetCustomer),
    if ((r['trips'] ?? 0) == 0)
      const ResourceAction(icon: Icons.delete_forever_outlined, ar: 'حذف نهائي', en: 'Delete permanently', color: T.danger, run: removeFleetCustomer),
  ],
);

// Contracts management.
final contractsVendorsCfg = ResourceConfig(
  filterField: 'vendorType',
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => ContractsVendorProfileScreen(vendorId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
  arTitle: 'سجل موردي 3PL', enTitle: '3PL Vendors', icon: Icons.business_outlined,
  endpoint: '/api/contracts/vendors', listKey: 'vendors',
  updateMethod: 'PATCH', liveEvent: 'contracts:updated',
  searchFields: const ['name', 'energizeRep', 'contactPerson', 'phone', 'headquarters'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'headquarters'), _s(r, 'energizeRep')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    r['status'] == 'signed'
        ? ('موقّع', T.success)
        : r['status'] == 'pending'
            ? ('قيد التوقيع', T.warn)
            : ('غير موقّع', T.inkFaint),
    ('${r['fleetSize'] ?? 0} سيارة', T.navy),
    if (r['status'] == 'signed' && r['documentsReceived'] != true) ('مستندات ناقصة', T.danger),
    if (r['rating'] != null) ('★ ${r['rating']}', T.warn),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Vendor name', required: true),
    FieldSpec('energizeRep', 'مندوب التنشيط', 'Energize rep'),
    FieldSpec('operationsRep', 'مسؤول العمليات', 'Operations rep'),
    FieldSpec('crNumber', 'السجل التجاري', 'CR number'),
    FieldSpec('vehicleTypes', 'أنواع المركبات', 'Vehicle types'),
    FieldSpec('paymentTermDays', 'مدة السداد (يوم)', 'Payment term (days)', type: FieldType.number),
    FieldSpec('ratingNotes', 'ملاحظات التقييم', 'Rating notes'),
    FieldSpec('vendorType', 'نوع المورد', 'Type', type: FieldType.select, options: [
      ('ضريبي', 'ضريبي', 'Tax'), ('آجل', 'آجل', 'Credit'), ('كاش', 'كاش', 'Cash'),
    ]),
    FieldSpec('contactPerson', 'ممثل المورد', 'Contact person'),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('headquarters', 'المقر الرئيسي', 'Headquarters'),
    FieldSpec('destinations', 'الوجهات', 'Destinations'),
    FieldSpec('fleetSize', 'عدد السيارات', 'Fleet size', type: FieldType.number),
    FieldSpec('contractDate', 'تاريخ العقد', 'Contract date', type: FieldType.date),
    FieldSpec('vendorSideContract', 'وقّع المورد', 'Vendor signed', type: FieldType.checkbox),
    FieldSpec('ourSideContract', 'وقّعنا نحن', 'We signed', type: FieldType.checkbox),
    FieldSpec('documentsReceived', 'المستندات مكتملة', 'Documents complete', type: FieldType.checkbox),
    FieldSpec('missingDocuments', 'المستندات الناقصة', 'Missing documents'),
    FieldSpec('rating', 'التقييم (1-5)', 'Rating (1-5)', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Contract customers.
// The other party of every deal. The row holds contract data; the numbers under it (shipments with us and their value) are read from the operations sheets and not written here.
final contractsCustomersCfg = ResourceConfig(
  filterField: 'status',
  // Add opens manual entry and suggestions of those who ship with us without a record, like the two web buttons.
  onCreate: openContractsCustomerCreate,
  arTitle: 'العملاء', enTitle: 'Customers', icon: Icons.handshake_outlined,
  endpoint: '/api/contracts/customers', listKey: 'customers',
  updateMethod: 'PATCH', liveEvent: 'contracts:updated',
  searchFields: const ['name', 'energizeRep', 'contactPerson', 'phone', 'headquarters'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'sector'), _s(r, 'headquarters'), _s(r, 'energizeRep')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    r['status'] == 'signed'
        ? ('موقّع', T.success)
        : r['status'] == 'pending'
            ? ('قيد التوقيع', T.warn)
            : ('غير موقّع', T.inkFaint),
    if ((r['loads'] ?? 0) != 0) ('${_n(r['loads'])} شحنة', T.navy),
    // A contract is renewed before it ends.
    // Near expiry is flagged two months ahead, leaving time to renew. After expiry the only option left is shipping without a contract.
    if (r['expiry'] == 'due') ('قارب على الانتهاء', T.warn),
    if (r['expiry'] == 'expired') ('منتهٍ', T.danger),
    if (r['status'] == 'signed' && r['documentsReceived'] != true) ('وثائق ناقصة', T.danger),
  ],
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Customer name', required: true),
    FieldSpec('sector', 'القطاع', 'Sector'),
    FieldSpec('customerType', 'نوع العميل', 'Type', type: FieldType.select, options: [
      ('ضريبي', 'ضريبي', 'Tax'), ('كاش', 'كاش', 'Cash'), ('آجل', 'آجل', 'Credit'),
    ]),
    FieldSpec('contactPerson', 'جهة الاتصال', 'Contact person'),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email'),
    FieldSpec('headquarters', 'المقر', 'Headquarters'),
    FieldSpec('energizeRep', 'مسؤول التنشيط لدينا', 'Our rep'),
    FieldSpec('crNumber', 'السجل التجاري', 'CR number'),
    FieldSpec('taxNumber', 'الرقم الضريبي', 'VAT number'),
    FieldSpec('customerSideContract', 'وقّع العميل', 'Customer signed', type: FieldType.checkbox),
    FieldSpec('ourSideContract', 'وقّعنا نحن', 'We signed', type: FieldType.checkbox),
    FieldSpec('documentsReceived', 'الوثائق مستلمة', 'Documents received', type: FieldType.checkbox),
    FieldSpec('missingDocuments', 'الوثائق الناقصة', 'Missing documents'),
    FieldSpec('contractDate', 'تاريخ التوقيع', 'Signed on', type: FieldType.date),
    FieldSpec('startDate', 'بداية العقد', 'Start date', type: FieldType.date),
    FieldSpec('endDate', 'نهاية العقد', 'End date', type: FieldType.date),
    FieldSpec('paymentTermDays', 'مهلة السداد (يوم)', 'Payment term (days)', type: FieldType.number),
    FieldSpec('pricingNotes', 'ملاحظات التسعير', 'Pricing notes', type: FieldType.textarea),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
  sortFields: const [('loads', 'الشحنات', 'Loads'), ('value', 'القيمة', 'Value')],
);

final contractsAgreementsCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'عقود الأقسام', enTitle: 'Department Contracts', icon: Icons.folder_copy_outlined,
  endpoint: '/api/contracts/agreements', listKey: 'contracts',
  updateMethod: 'PATCH', liveEvent: 'contracts:updated',
  searchFields: const ['partyName', 'contactPerson', 'phone', 'subject'],
  titleOf: (r) => _s(r, 'partyName'),
  subtitleOf: (r) => _s(r, 'subject'),
  // Contract attachments (upload, delete, open): the attachments dialog on the web.
  rowActions: (r) => [
    ResourceAction(icon: Icons.attach_file_rounded, ar: 'المرفقات (${(r['attachments'] as List? ?? const []).length})',
        en: 'Attachments (${(r['attachments'] as List? ?? const []).length})', color: T.cyan, run: openAgreementFiles),
  ],
  chipsOf: (r) => [
    switch (_s(r, 'department')) {
      '3pl' => ('موردو 3PL', T.cyan),
      'fleet' => ('عملاء الأسطول', T.navy),
      'b2c' => ('عملاء B2C', T.violet),
      _ => ('أخرى', T.inkSoft),
    },
    switch (_s(r, 'status')) {
      'active' => ('ساري', T.success),
      'expired' => ('منتهي', T.danger),
      'terminated' => ('مفسوخ', T.inkFaint),
      _ => ('مسودة', T.inkSoft),
    },
  ],
  fields: const [
    FieldSpec('department', 'القسم', 'Department', type: FieldType.select, required: true, options: [
      ('3pl', 'موردو 3PL', '3PL Vendors'), ('fleet', 'عملاء إدارة الأسطول', 'Fleet Customers'),
      ('b2c', 'عملاء B2C', 'B2C Customers'), ('other', 'أخرى', 'Other'),
    ]),
    FieldSpec('partyType', 'نوع الطرف', 'Party type', type: FieldType.select, required: true, options: [
      ('customer', 'عميل', 'Customer'), ('vendor', 'مورد', 'Vendor'),
    ]),
    FieldSpec('partyName', 'اسم الجهة', 'Party name', required: true),
    FieldSpec('subject', 'موضوع العقد', 'Subject'),
    FieldSpec('contactPerson', 'جهة الاتصال', 'Contact'),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email'),
    FieldSpec('renewalPolicy', 'سياسة التجديد', 'Renewal policy'),
    FieldSpec('contractDate', 'تاريخ العقد', 'Contract date', type: FieldType.date),
    FieldSpec('startDate', 'تاريخ البدء', 'Start date', type: FieldType.date),
    FieldSpec('endDate', 'تاريخ الانتهاء', 'End date', type: FieldType.date),
    FieldSpec('paymentTermDays', 'مدة السداد (يوم)', 'Payment days', type: FieldType.number),
    FieldSpec('value', 'قيمة العقد', 'Value', type: FieldType.number),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('active', 'ساري', 'Active'), ('draft', 'مسودة', 'Draft'),
      ('expired', 'منتهي', 'Expired'), ('terminated', 'مفسوخ', 'Terminated'),
    ]),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Customer relationship management (CRM).
String _crmCustomerLabel(Map<String, dynamic> r) => _s(r, 'companyName');

final crmCompaniesCfg = ResourceConfig(
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => CrmCompanyProfileScreen(companyId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
  arTitle: 'الشركات', enTitle: 'Companies', icon: Icons.apartment_outlined,
  endpoint: '/api/crm/companies', listKey: 'companies', liveEvent: 'crm:company',
  searchFields: const ['customerCode', 'name', 'arabicName', 'phone', 'email', 'city', 'industry'],
  titleOf: (r) => _s(r, 'arabicName').isNotEmpty ? _s(r, 'arabicName') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'industry'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    // The customer's code identifies it in every section.
    if (_s(r, 'customerCode').isNotEmpty) (_s(r, 'customerCode'), T.navy),
    if (_s(r, 'status').isNotEmpty) (_s(r, 'status'), T.cyan),
    if (r['rating'] != null && r['rating'] != 0) ('★ ${r['rating']}', T.warn),
  ],
  // Star rating from the list itself (PATCH /rate), like the stars column in the web table.
  rowActions: (r) => [
    const ResourceAction(icon: Icons.star_outline_rounded, ar: 'التقييم', en: 'Rate', color: T.warn, run: crmRateCompany),
  ],
  fields: const [
    FieldSpec('customerCode', 'كود العميل', 'Customer code'),
    FieldSpec('name', 'اسم الشركة', 'Company name', required: true),
    FieldSpec('arabicName', 'الاسم العربي', 'Arabic name'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('lead', 'عميل محتمل', 'Lead'), ('prospect', 'مهتم', 'Prospect'), ('active', 'نشط', 'Active'),
      ('inactive', 'غير نشط', 'Inactive'), ('churned', 'منسحب', 'Churned'),
    ]),
    // Link to a customer in the customers register (hybrid): /api/crm/customers-search as on the web.
    FieldSpec('linkedCustomer', 'العميل المرتبط (سجل العملاء)', 'Linked customer (registry)',
        type: FieldType.lookup, lookupEndpoint: '/api/crm/customers-search', lookupListKey: 'customers',
        lookupQuery: '', lookupServerSearch: true, lookupLabel: _crmCustomerLabel),
    FieldSpec('industry', 'المجال', 'Industry'),
    FieldSpec('phone', 'رقم الهاتف', 'Phone', type: FieldType.phone),
    FieldSpec('whatsapp', 'واتساب', 'WhatsApp', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('website', 'الموقع الإلكتروني', 'Website'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final crmContactsCfg = ResourceConfig(
  arTitle: 'جهات الاتصال', enTitle: 'Contacts', icon: Icons.contact_phone_outlined,
  endpoint: '/api/crm/contacts', listKey: 'contacts', liveEvent: 'crm:contact',
  searchFields: const ['firstName', 'lastName', 'arabicName', 'phone', 'mobile', 'email'],
  titleOf: (r) => _s(r, 'arabicName').isNotEmpty
      ? _s(r, 'arabicName')
      : '${_s(r, 'firstName')} ${_s(r, 'lastName')}'.trim(),
  subtitleOf: (r) => [_s(r, 'title'), _s(r, 'mobile'), _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  fields: [
    const FieldSpec('firstName', 'الاسم الأول', 'First name', required: true),
    const FieldSpec('lastName', 'اسم العائلة', 'Last name'),
    const FieldSpec('arabicName', 'الاسم العربي', 'Arabic name'),
    const FieldSpec('title', 'المسمى الوظيفي', 'Job title'),
    const FieldSpec('mobile', 'الجوال', 'Mobile', type: FieldType.phone),
    const FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    const FieldSpec('whatsapp', 'واتساب', 'WhatsApp', type: FieldType.phone),
    _crmCompanyLookup(),
    const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Business development.
final bdOpportunitiesCfg = ResourceConfig(
  filterField: 'stage',
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => BdOpportunityDetailScreen(opportunityId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
  arTitle: 'الفرص الاستراتيجية', enTitle: 'Opportunities', icon: Icons.explore_outlined,
  endpoint: '/api/business-development/opportunities', listKey: 'opportunities',
  liveEvent: 'bd:updated',
  searchFields: const ['name', 'nameAr', 'partnerName', 'region', 'city'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'partnerName'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'stage')) {
      'identified' => ('مرصودة', T.inkSoft),
      'researching' => ('قيد الدراسة', T.info),
      'qualified' => ('مؤهلة', T.cyan),
      'proposal' => ('عرض مقدم', T.violet),
      'negotiation' => ('تفاوض', T.warn),
      'won' => ('مكسوبة', T.success),
      'lost' => ('خاسرة', T.danger),
      _ => ('معلقة', T.inkFaint),
    },
    if (r['estimatedValue'] != null) ('${r['estimatedValue']}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم الفرصة', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('stage', 'المرحلة', 'Stage', type: FieldType.select, options: [
      ('identified', 'مرصودة', 'Identified'), ('researching', 'قيد الدراسة', 'Researching'),
      ('qualified', 'مؤهلة', 'Qualified'), ('proposal', 'عرض مقدم', 'Proposal'),
      ('negotiation', 'تفاوض', 'Negotiation'), ('won', 'مكسوبة', 'Won'),
      ('lost', 'خاسرة', 'Lost'), ('on_hold', 'معلقة', 'On hold'),
    ]),
    FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('high', 'مرتفعة', 'High'), ('medium', 'متوسطة', 'Medium'), ('low', 'منخفضة', 'Low'),
    ]),
    FieldSpec('estimatedValue', 'القيمة التقديرية', 'Estimated value', type: FieldType.number),
    FieldSpec('probability', 'الاحتمالية %', 'Probability %', type: FieldType.number),
    FieldSpec('partnerName', 'الشريك', 'Partner'),
    FieldSpec('source', 'المصدر', 'Source'),
    FieldSpec('region', 'المنطقة', 'Region'),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('expectedCloseDate', 'تاريخ الإغلاق المتوقع', 'Expected close', type: FieldType.date),
    FieldSpec('nextStepDate', 'تاريخ الخطوة التالية', 'Next step date', type: FieldType.date),
    FieldSpec('nextStep', 'الخطوة التالية', 'Next step'),
    FieldSpec('lostReason', 'سبب الخسارة', 'Lost reason'),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

final bdPartnersCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'الشراكات', enTitle: 'Partners', icon: Icons.handshake_outlined,
  endpoint: '/api/business-development/partners', listKey: 'partners',
  liveEvent: 'bd:updated',
  searchFields: const ['name', 'nameAr', 'contactName', 'contactPhone', 'city'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'contactName'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشطة', T.success),
      'in_discussion' => ('قيد النقاش', T.info),
      'prospect' => ('مرشحة', T.inkSoft),
      'paused' => ('متوقفة مؤقتًا', T.warn),
      _ => ('منتهية', T.inkFaint),
    },
  ],
  fields: const [
    FieldSpec('name', 'اسم الشريك', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('prospect', 'مرشحة', 'Prospect'), ('in_discussion', 'قيد النقاش', 'In discussion'),
      ('active', 'نشطة', 'Active'), ('paused', 'متوقفة مؤقتًا', 'Paused'), ('ended', 'منتهية', 'Ended'),
    ]),
    FieldSpec('contactName', 'جهة الاتصال', 'Contact'),
    FieldSpec('contactPhone', 'جوال جهة الاتصال', 'Contact phone', type: FieldType.phone),
    FieldSpec('contactEmail', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('services', 'الخدمات', 'Services'),
    FieldSpec('agreementStart', 'بداية الاتفاقية', 'Agreement start', type: FieldType.date),
    FieldSpec('agreementEnd', 'نهاية الاتفاقية', 'Agreement end', type: FieldType.date),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final bdTendersCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'المناقصات', enTitle: 'Tenders', icon: Icons.gavel_outlined,
  endpoint: '/api/business-development/tenders', listKey: 'tenders',
  liveEvent: 'bd:updated',
  searchFields: const ['title', 'titleAr', 'entity', 'referenceNumber'],
  titleOf: (r) => _s(r, 'titleAr').isNotEmpty ? _s(r, 'titleAr') : _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'entity'), _s(r, 'referenceNumber')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'watching' => ('قيد الرصد', T.inkSoft),
      'preparing' => ('قيد التجهيز', T.info),
      'submitted' => ('مقدمة', T.cyan),
      'shortlisted' => ('قائمة قصيرة', T.violet),
      'won' => ('مكسوبة', T.success),
      'lost' => ('خاسرة', T.danger),
      _ => ('ملغاة', T.inkFaint),
    },
    if (r['daysLeft'] != null && r['daysLeft'] >= 0) ('باقي ${r['daysLeft']} يوم', T.warn),
  ],
  fields: const [
    FieldSpec('title', 'عنوان المناقصة', 'Title', required: true),
    FieldSpec('titleAr', 'العنوان العربي', 'Arabic title'),
    FieldSpec('entity', 'الجهة الطارحة', 'Entity'),
    FieldSpec('referenceNumber', 'الرقم المرجعي', 'Reference no.'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('watching', 'قيد الرصد', 'Watching'), ('preparing', 'قيد التجهيز', 'Preparing'),
      ('submitted', 'مقدمة', 'Submitted'), ('shortlisted', 'قائمة قصيرة', 'Shortlisted'),
      ('won', 'مكسوبة', 'Won'), ('lost', 'خاسرة', 'Lost'), ('cancelled', 'ملغاة', 'Cancelled'),
    ]),
    FieldSpec('submissionDeadline', 'موعد التقديم', 'Deadline', type: FieldType.date),
    FieldSpec('estimatedValue', 'القيمة التقديرية', 'Estimated value', type: FieldType.number),
    FieldSpec('documentsReady', 'المستندات جاهزة', 'Documents ready', type: FieldType.checkbox),
    FieldSpec('scope', 'نطاق العمل', 'Scope', type: FieldType.textarea),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Marketing.
final marketingCampaignsCfg = ResourceConfig(
  filterField: 'status',
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => MarketingCampaignDetailScreen(campaignId: (r['_id'] ?? '').toString(), name: (r['nameAr'] ?? r['name'] ?? '').toString()))),
  arTitle: 'الحملات', enTitle: 'Campaigns', icon: Icons.flag_outlined,
  endpoint: '/api/marketing/campaigns', listKey: 'items',
  liveEvent: 'marketing:updated',
  searchFields: const ['name', 'nameAr', 'platform', 'objective'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'platform'), _s(r, 'objective')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشطة', T.success),
      'paused' => ('متوقفة', T.warn),
      'completed' => ('منتهية', T.inkSoft),
      _ => ('مخططة', T.info),
    },
    if (r['budget'] != null) ('الميزانية: ${r['budget']}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم الحملة', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('platform', 'المنصة', 'Platform'),
    FieldSpec('objective', 'الهدف', 'Objective'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('planned', 'مخططة', 'Planned'), ('active', 'نشطة', 'Active'),
      ('paused', 'متوقفة', 'Paused'), ('completed', 'منتهية', 'Completed'),
    ]),
    FieldSpec('startDate', 'تاريخ البدء', 'Start', type: FieldType.date),
    FieldSpec('endDate', 'تاريخ الانتهاء', 'End', type: FieldType.date),
    FieldSpec('budget', 'الميزانية', 'Budget', type: FieldType.number),
    FieldSpec('spend', 'المصروف', 'Spend', type: FieldType.number),
    FieldSpec('leads', 'العملاء المحتملون', 'Leads', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Workshop.

// CRM: deals, tasks and activities.
final crmDealsCfg = ResourceConfig(
  filterField: 'stage',
  arTitle: 'الصفقات', enTitle: 'Deals', icon: Icons.attach_money_outlined,
  endpoint: '/api/crm/deals', listKey: 'deals', liveEvent: 'crm:deal',
  searchFields: const ['title', 'stage', 'source'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'source')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    (crmDealStages.where((x) => x.$1 == _s(r, 'stage')).map((x) => tr(x.$2, x.$3)).firstOrNull ?? _s(r, 'stage'),
        crmDealStageColors[_s(r, 'stage')] ?? T.cyan),
    if (r['value'] != null) ('${r['value']} ${_s(r, 'currency')}', T.success),
    if (r['probability'] != null) ('${r['probability']}%', T.inkSoft),
  ],
  // Moving the stage, the counterpart of dragging a card between board columns (PATCH /deals/:id/move).
  rowActions: (r) => [
    const ResourceAction(icon: Icons.swap_horiz_rounded, ar: 'نقل المرحلة', en: 'Move stage', color: T.info, run: crmMoveDeal),
  ],
  fields: [
    const FieldSpec('title', 'عنوان الصفقة', 'Title', required: true),
    _crmCompanyLookup(),
    const FieldSpec('stage', 'المرحلة', 'Stage', type: FieldType.select, options: crmDealStages),
    const FieldSpec('value', 'القيمة', 'Value', type: FieldType.number),
    const FieldSpec('probability', 'الاحتمالية %', 'Probability %', type: FieldType.number),
    const FieldSpec('expectedCloseDate', 'تاريخ الإغلاق المتوقع', 'Expected close', type: FieldType.date),
    const FieldSpec('source', 'المصدر', 'Source'),
    const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final crmTasksCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'مهام العلاقات', enTitle: 'CRM Tasks', icon: Icons.task_alt_outlined,
  endpoint: '/api/crm/tasks', listKey: 'tasks', liveEvent: 'crm:task',
  searchFields: const ['title', 'status', 'priority'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => _s(r, 'description'),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'done' => (tr('مكتملة', 'Done'), T.success),
      'in_progress' => (tr('قيد التنفيذ', 'In Progress'), T.info),
      'cancelled' => (tr('ملغاة', 'Cancelled'), T.inkFaint),
      _ => (tr('للتنفيذ', 'To Do'), T.warn),
    },
    if (_s(r, 'dueDate').isNotEmpty) (_s(r, 'dueDate').split('T').first, T.inkSoft),
  ],
  fields: [
    const FieldSpec('title', 'العنوان', 'Title', required: true),
    _crmCompanyLookup(),
    const FieldSpec('description', 'التفاصيل', 'Details', type: FieldType.textarea),
    const FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('todo', 'للتنفيذ', 'To Do'), ('in_progress', 'قيد التنفيذ', 'In progress'),
      ('done', 'مكتملة', 'Done'), ('cancelled', 'ملغاة', 'Cancelled'),
    ]),
    const FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('low', 'منخفضة', 'Low'), ('medium', 'متوسطة', 'Medium'), ('high', 'عالية', 'High'), ('urgent', 'عاجلة', 'Urgent'),
    ]),
    const FieldSpec('dueDate', 'تاريخ الاستحقاق', 'Due date', type: FieldType.date),
  ],
);

final crmActivitiesCfg = ResourceConfig(
  filterField: 'type',
  arTitle: 'الأنشطة', enTitle: 'Activities', icon: Icons.history_outlined,
  endpoint: '/api/crm/activities', listKey: 'activities', liveEvent: 'crm:activity',
  searchFields: const ['subject', 'type', 'outcome'],
  titleOf: (r) => _s(r, 'subject'),
  subtitleOf: (r) => _s(r, 'body'),
  chipsOf: (r) => [
    (_s(r, 'type'), T.violet),
    if (_s(r, 'outcome').isNotEmpty) (_s(r, 'outcome'), T.success),
  ],
  fields: [
    const FieldSpec('subject', 'الموضوع', 'Subject', required: true),
    _crmCompanyLookup(),
    const FieldSpec('type', 'النوع', 'Type', type: FieldType.select, options: [
      ('call', 'مكالمة', 'Call'), ('meeting', 'اجتماع', 'Meeting'),
      ('email', 'بريد', 'Email'), ('visit', 'زيارة', 'Visit'), ('whatsapp', 'واتساب', 'WhatsApp'),
    ]),
    const FieldSpec('date', 'التاريخ', 'Date', type: FieldType.date),
    const FieldSpec('outcome', 'النتيجة', 'Outcome'),
    const FieldSpec('body', 'التفاصيل', 'Details', type: FieldType.textarea),
  ],
);

// Sales: sales targets.
// The form had no rep field, so every target saved from the phone became a team-wide target and the second replaced the first (key is rep + month). The row title was the month alone, so whose target was unknown.
// The manager sets the target: canEdit is passed from the list using the server's rule (canSetTargets in salesController).
String _repName(dynamic rep) => rep is Map
    ? '${rep['firstName'] ?? ''} ${rep['lastName'] ?? ''}'.trim()
    : '';

ResourceConfig salesTargetsCfg({required bool canEdit}) => ResourceConfig(
  canCreate: canEdit, canEdit: canEdit, canDelete: canEdit,
  arTitle: 'أهداف المبيعات', enTitle: 'Sales Targets', icon: Icons.track_changes_outlined,
  endpoint: '/api/sales/targets', listKey: 'targets', liveEvent: 'sales:updated',
  searchFields: const ['period', 'notes', 'rep.firstName', 'rep.lastName'],
  titleOf: (r) => _repName(r['rep']).isNotEmpty ? _repName(r['rep']) : tr('الفريق كلّه', 'Whole team'),
  subtitleOf: (r) => [_s(r, 'period'), _s(r, 'notes')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (r['amountTarget'] != null) ('${_n(r['amountTarget'])} ${tr('ر.س', 'SAR')}', T.success),
    if (r['dealsTarget'] != null) ('${r['dealsTarget']} ${tr('صفقة', 'deals')}', T.info),
  ],
  fields: const [
    // Empty means the whole team. Does not change after saving: the server fixes the rep and the month.
    FieldSpec('rep', 'المندوب (فارغ = الفريق كلّه)', 'Rep (empty = whole team)',
        type: FieldType.lookup, lookupEndpoint: '/api/sales/options', lookupListKey: 'reps',
        lookupLabel: _repName),
    FieldSpec('period', 'الشهر (مثال: 2026-10)', 'Month (e.g. 2026-10)', required: true),
    FieldSpec('amountTarget', 'هدف القيمة', 'Amount target', type: FieldType.number),
    FieldSpec('dealsTarget', 'هدف الصفقات', 'Deals target', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Administration (Admin).
final branchesCfg = ResourceConfig(
  arTitle: 'الفروع', enTitle: 'Branches', icon: Icons.store_mall_directory_outlined,
  endpoint: '/api/branches', listKey: 'branches', liveEvent: 'branch:updated',
  extraLiveEvents: const ['branch:created', 'branch:deleted'],
  searchFields: const ['name', 'code', 'city'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'code'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  fields: const [
    FieldSpec('name', 'اسم الفرع', 'Name', required: true),
    FieldSpec('code', 'الكود', 'Code'),
    FieldSpec('city', 'المدينة', 'City'),
  ],
);


// Location Solutions: repairs.
final ls2RepairsCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'الإصلاحات', enTitle: 'Repairs', icon: Icons.home_repair_service_outlined,
  endpoint: '/api/ls2/repairs', listKey: 'items', liveEvent: 'ls2:updated', updateMethod: 'PATCH',
  searchFields: const ['description', 'category', 'status', 'plate'],
  titleOf: (r) => _s(r, 'title').isNotEmpty ? _s(r, 'title') : (_s(r, 'description').isNotEmpty ? _s(r, 'description') : _s(r, 'category')),
  subtitleOf: (r) => [_s(r, 'plate'), _s(r, 'vehicleName')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'category').isNotEmpty) (_s(r, 'category'), T.violet),
    switch (_s(r, 'severity')) {
      'high' => ('خطيرة', T.danger),
      'low' => ('بسيطة', T.inkFaint),
      'medium' => ('متوسطة', T.warn),
      _ => ('', T.warn),
    },
    if (r['cost'] != null) ('${r['cost']} ر.س', T.success),
    switch (_s(r, 'status')) {
      'done' => ('منجز', T.success),
      'in_progress' => ('قيد التنفيذ', T.info),
      _ => (_s(r, 'status').isEmpty ? 'مفتوح' : _s(r, 'status'), T.warn),
    },
  ],
  fields: const [
    FieldSpec('unitId', 'رقم الوحدة (Unit ID)', 'Unit ID', type: FieldType.number, required: true),
    FieldSpec('title', 'ماذا حدث؟', 'What happened?', required: true),
    FieldSpec('category', 'التصنيف', 'Category', type: FieldType.select, options: [
      ('breakdown', 'عطل', 'Breakdown'), ('accident', 'حادث', 'Accident'), ('tires', 'كاوتش', 'Tires'),
      ('electrical', 'كهرباء', 'Electrical'), ('engine', 'موتور', 'Engine'), ('body', 'هيكل', 'Body'), ('other', 'أخرى', 'Other'),
    ]),
    FieldSpec('severity', 'الخطورة', 'Severity', type: FieldType.select, options: [
      ('low', 'بسيطة', 'Low'), ('medium', 'متوسطة', 'Medium'), ('high', 'خطيرة', 'High'),
    ]),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('open', 'مفتوح', 'Open'), ('in_progress', 'قيد التنفيذ', 'In progress'), ('done', 'منجز', 'Done'),
    ]),
    FieldSpec('repairDate', 'تاريخ الإصلاح', 'Repair date', type: FieldType.date),
    FieldSpec('odometerKm', 'العداد وقتها (كم)', 'Odometer (km)', type: FieldType.number),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('workshop', 'الورشة / الفني', 'Workshop', ),
    FieldSpec('partsReplaced', 'القطع المستبدلة', 'Parts replaced', type: FieldType.textarea),
    FieldSpec('driver', 'السائق وقتها', 'Driver'),
    FieldSpec('description', 'تفاصيل الإصلاح', 'Details', type: FieldType.textarea),
  ],
);

// HR: licenses and leave types.
final hrLicensesCfg = ResourceConfig(
  arTitle: 'التراخيص والاشتراكات', enTitle: 'Licenses', icon: Icons.workspace_premium_outlined,
  endpoint: '/api/hr/licenses', listKey: 'licenses', liveEvent: 'hr:license',
  hijriDates: true,
  searchFields: const ['name', 'category', 'location', 'duration'],
  titleOf: (r) => _s(r, 'name'),
  // Expiry date in both calendars on the line: Gregorian then its Hijri (services/hijri).
  subtitleOf: (r) => [_s(r, 'category'), _s(r, 'location'),
    if (_s(r, 'expiryDate').isNotEmpty) '${tr('ينتهي', 'Expires')} ${bothDates(_s(r, 'expiryDate'), ar: Lang.instance.ar)}',
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) {
    final end = DateTime.tryParse(_s(r, 'expiryDate'));
    final days = end?.difference(DateTime.now()).inDays;
    return [
      if (days != null)
        days < 0 ? ('منتهية', T.danger) : days <= 60 ? ('باقي $days يوم', T.warn) : ('سارية', T.success),
    ];
  },
  fields: const [
    FieldSpec('name', 'اسم الترخيص', 'Name', required: true),
    FieldSpec('category', 'التصنيف', 'Category', required: true),
    FieldSpec('duration', 'المدة', 'Duration'),
    FieldSpec('location', 'الموقع', 'Location'),
    FieldSpec('expiryDate', 'تاريخ الانتهاء', 'Expiry date', type: FieldType.date),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final hrLeaveTypesCfg = ResourceConfig(
  arTitle: 'أنواع الإجازات', enTitle: 'Leave Types', icon: Icons.event_note_outlined,
  endpoint: '/api/hr/leave-types', listKey: 'leaveTypes', liveEvent: 'hr:leave',
  searchFields: const ['nameAr', 'nameEn', 'code'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'nameEn'),
  subtitleOf: (r) => _s(r, 'code'),
  fields: const [
    FieldSpec('nameAr', 'الاسم بالعربية', 'Arabic name', required: true),
    FieldSpec('nameEn', 'الاسم بالإنجليزية', 'English name'),
    FieldSpec('code', 'الكود', 'Code'),
  ],
);

// Customs clearance.
String _customsCountLabel(Map<String, dynamic> v) =>
    v['cargoType'] == 'vehicles' ? tr('عدد السيّارات', 'Vehicles') : tr('عدد الحاويات', 'Containers');

final customsCfg = ResourceConfig(
  // No stage filter chips: stages are no longer a line, and where each transaction stands is read and filtered on the section dashboard.
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: (r['_id'] ?? '').toString(), ref: (r['refNumber'] ?? '').toString()))),
  arTitle: 'التخليص الجمركي', enTitle: 'Customs Clearance', icon: Icons.directions_boat_outlined,
  endpoint: '/api/customs-clearance', listKey: 'clearances', liveEvent: 'customs:updated',
  // Create and delete from another screen show here immediately, like the website.
  extraLiveEvents: const ['customs:created', 'customs:deleted'],
  // The list carries only what is displayed, and the form edits fields not in it (invoice amount, declaration date, note), so the full transaction is read before filling.
  editFullKey: 'clearance',
  // Server-side search over everything in the transaction.
  // The row is trimmed: no per-container data, return receipt, disbursement requests or all notes. So the text (q=) is sent and the server index answers, as on the website (see SEARCH_INDEX_FIELDS). searchFields remains for whoever reads the config, not for filtering.
  serverSearch: true,
  searchHint: ('ابحث بأيّ رقمٍ أو اسم: المعاملة، الحاوية، البوليصة، البيان، الفاتورة، العميل، الوكيل…',
      'Any number or name: ref, container, BL, declaration, invoice, customer, agent…'),
  searchFields: const ['refNumber', 'customerName', 'blNumber', 'declarationNumber', 'exporterCompany', 'city', 'saleInvoiceNumber', 'containerNumbers'],
  // Waybill number first: it identifies the transaction in the section; its reference number comes after.
  titleOf: (r) => _s(r, 'blNumber').isNotEmpty ? '${_s(r, 'blNumber')} — ${_s(r, 'customerName')}' : _s(r, 'customerName'),
  subtitleOf: (r) => [
    if (_s(r, 'refNumber').isNotEmpty) '${tr('رقم المعاملة', 'Transaction no.')}: ${_s(r, 'refNumber')}',
    if (_s(r, 'shippingAgent').isNotEmpty) _s(r, 'shippingAgent'),
    // The two table columns on the website: declaration number and unloading date.
    if (_s(r, 'declarationNumber').isNotEmpty) '${tr('رقم البيان', 'Declaration no.')}: ${_s(r, 'declarationNumber')}',
    if (_s(r, 'unloadingAppointment').isNotEmpty) '${tr('تاريخ التفريغ', 'Unloading date')}: ${_s(r, 'unloadingAppointment').length >= 10 ? _s(r, 'unloadingAppointment').substring(0, 10).split('-').reversed.join('/') : _s(r, 'unloadingAppointment')}',
    // The last note written on the transaction, like the notes column on the website.
    if ((r['lastNote'] is Map) && '${r['lastNote']['text'] ?? ''}'.isNotEmpty) '📝 ${r['lastNote']['text']}',
  ].join(' · '),
  chipsOf: (r) {
    // Percentage and next stage come from the server (pipeline); they are not derived from stage.
    final p = r['pipeline'] is Map ? r['pipeline'] as Map : const {};
    final next = '${p['next'] ?? ''}';
    final vehicles = _s(r, 'cargoType') == 'vehicles';
    final billing = r['billing'] is Map ? '${r['billing']['invoiceStatus'] ?? ''}' : '';
    return [
      // Invoiced but its transport invoice has not arrived: shown red and first so it is not forgotten.
      if (r['awaitingTransportInvoice'] == true) (tr('بانتظار فاتورة النقل', 'Awaiting transport invoice'), T.danger),
      if (r['cancelled'] == true) (tr('ملغاة', 'Cancelled'), T.danger)
      else if (r['isCompleted'] == true) (tr('مُقفلة', 'Closed'), T.success)
      else if (next.isNotEmpty) (customsStageLabel(next, _s(r, 'cargoType')), T.info),
      if (p['percent'] != null) ('${p['percent']}%', T.cyan),
      if (_s(r, 'saleInvoiceNumber').isNotEmpty) (tr('مفوترة', 'Invoiced'), T.success)
      else (billing.isNotEmpty ? billing : tr('غير مفوترة', 'Not invoiced'), T.inkSoft),
      if (r['containerCount'] != null) ('${r['containerCount']} ${vehicles ? tr('سيّارة', 'vehicles') : tr('حاوية', 'containers')}', T.navy),
      (_s(r, 'branch') == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'), T.inkSoft),
    ];
  },
  fields: const [
    // Transaction data fields as on the website: waybill, customer, units, shipping agent and customs item; anything else was added on the department's request.
    // Stage is not among them: it is marked from the transaction screen by its rules (PATCH /:id/stage), and the server ignores stage in the save body.
    FieldSpec('blNumber', 'رقم البوليصة BL', 'BL number'),
    FieldSpec('customerName', 'اسم العميل', 'Customer', required: true),
    FieldSpec('cargoType', 'نوع المعاملة', 'Transaction type', type: FieldType.select, options: [
      ('containers', 'حاويات', 'Containers'), ('vehicles', 'سيّارات', 'Vehicles'),
    ]),
    // The server opens a slot for each unit with this count (syncUnits).
    FieldSpec('containerCount', 'عدد الحاويات', 'Containers', type: FieldType.number, labelOf: _customsCountLabel),
    FieldSpec('shippingAgent', 'وكيل الشحن', 'Shipping agent'),
    FieldSpec('hsCode', 'البند الجمركي HS', 'HS code'),
    FieldSpec('declarationNumber', 'رقم البيان الجمركي', 'Declaration no.'),
    FieldSpec('branch', 'الفرع', 'Branch', type: FieldType.select, options: [
      ('jeddah', 'جدة', 'Jeddah'), ('dammam', 'الدمام', 'Dammam'),
    ]),
    FieldSpec('declarationDate', 'تاريخ البيان', 'Declaration date', type: FieldType.date),
    // Containers: derived by the server as unloading + 3 days (a typed value is ignored). Vehicles: default unloading + 15 days, editable.
    FieldSpec('demurrageStartDate', 'موعد الأرضيات', 'Demurrage date', type: FieldType.date),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Workshop: maintenance requests.

// Information technology.
final itTicketsCfg = ResourceConfig(
  filterField: 'status',
  arTitle: 'التذاكر والمشكلات', enTitle: 'IT Tickets', icon: Icons.confirmation_number_outlined,
  endpoint: '/api/it/tickets', listKey: 'tickets', liveEvent: 'it:updated',
  searchFields: const ['title', 'requesterName', 'category', 'status', 'device'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'requesterName'), _s(r, 'device')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'resolved' => ('محلولة', T.success),
      'closed' => ('مغلقة', T.inkFaint),
      'in_progress' => ('قيد الحل', T.info),
      _ => ('مفتوحة', T.warn),
    },
    switch (_s(r, 'priority')) {
      'high' => ('مرتفعة', T.danger),
      'low' => ('منخفضة', T.inkFaint),
      _ => ('متوسطة', T.warn),
    },
  ],
  fields: const [
    FieldSpec('title', 'عنوان المشكلة', 'Title', required: true),
    FieldSpec('requesterName', 'مقدم الطلب', 'Requester'),
    FieldSpec('category', 'التصنيف', 'Category'),
    FieldSpec('device', 'الجهاز', 'Device'),
    FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('high', 'مرتفعة', 'High'), ('medium', 'متوسطة', 'Medium'), ('low', 'منخفضة', 'Low'),
    ]),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('open', 'مفتوحة', 'Open'), ('in_progress', 'قيد الحل', 'In progress'),
      ('resolved', 'محلولة', 'Resolved'), ('closed', 'مغلقة', 'Closed'),
    ]),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
    FieldSpec('resolution', 'الحل', 'Resolution', type: FieldType.textarea),
    FieldSpec('rootCause', 'السبب الجذري', 'Root cause'),
  ],
);

final itSystemsCfg = ResourceConfig(
  arTitle: 'الأنظمة والخدمات', enTitle: 'Systems & Services', icon: Icons.dns_outlined,
  endpoint: '/api/it/systems', listKey: 'systems', liveEvent: 'it:updated',
  searchFields: const ['name', 'nameAr', 'type', 'vendor', 'url'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'type'), _s(r, 'vendor')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشط', T.success),
      'retired' => ('متوقف', T.inkFaint),
      _ => (_s(r, 'status').isEmpty ? 'نشط' : _s(r, 'status'), T.info),
    },
    if (r['cost'] != null) ('${r['cost']} ${_s(r, 'costPeriod')}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم النظام', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('type', 'النوع', 'Type'),
    FieldSpec('vendor', 'المزود', 'Vendor'),
    FieldSpec('url', 'الرابط', 'URL'),
    FieldSpec('renewalDate', 'تاريخ التجديد', 'Renewal date', type: FieldType.date),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

final itStockCfg = ResourceConfig(
  arTitle: 'مستودع الأجهزة', enTitle: 'IT Stock', icon: Icons.inventory_outlined,
  endpoint: '/api/it/stock', listKey: 'items', liveEvent: 'it:updated',
  searchFields: const ['name', 'type', 'serialNumber', 'brand', 'model'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'brand'), _s(r, 'model'), _s(r, 'serialNumber')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (r['quantity'] != null) ('الكمية: ${r['quantity']}', T.navy),
    if (_s(r, 'condition').isNotEmpty) (_s(r, 'condition'), T.cyan),
  ],
  fields: const [
    FieldSpec('name', 'اسم الجهاز', 'Name', required: true),
    FieldSpec('type', 'النوع', 'Type'),
    FieldSpec('brand', 'الماركة', 'Brand'),
    FieldSpec('model', 'الموديل', 'Model'),
    FieldSpec('serialNumber', 'السيريال', 'Serial', ),
    FieldSpec('quantity', 'الكمية', 'Quantity', type: FieldType.number),
    FieldSpec('condition', 'الحالة', 'Condition'),
    FieldSpec('location', 'المكان', 'Location'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── B2C ──────────────────────────────────────────────────────────────────────
final b2cProjectsCfg = ResourceConfig(
  arTitle: 'مشاريع B2C', enTitle: 'B2C Projects', icon: Icons.folder_special_outlined,
  endpoint: '/api/b2c/projects', listKey: 'projects', liveEvent: 'b2c:*',
  searchFields: const ['name', 'code'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'code'),
  chipsOf: (r) => [
    if (r['monthlyTarget'] != null) ('هدف شهري: ${r['monthlyTarget']}', T.navy),
    if (r['dailyTarget'] != null) ('يومي: ${r['dailyTarget']}', T.cyan),
  ],
  fields: const [
    FieldSpec('name', 'اسم المشروع', 'Name', required: true),
    FieldSpec('code', 'الكود', 'Code'),
    FieldSpec('monthlyTarget', 'الهدف الشهري', 'Monthly target', type: FieldType.number),
    FieldSpec('dailyTarget', 'الهدف اليومي', 'Daily target', type: FieldType.number),
    FieldSpec('expectedWorkingDays', 'أيام العمل المتوقعة', 'Working days', type: FieldType.number),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

// Delivery app accounts: reviewing unlinked ones.
// Matches the app accounts tab in section settings on the web: a linked account shows its owner's name from his file (displayName computed by the server), and unlinked ones are reviewed and suspended by hand. Suggested for suspension is only a suggestion, not a suspension: no orders for sixty days.
ResourceConfig b2cRepsCfg({required bool canEdit}) => ResourceConfig(
  arTitle: 'حسابات التطبيق', enTitle: 'App accounts', icon: Icons.sports_motorsports_outlined,
  endpoint: '/api/b2c/reps', listKey: 'reps', listQuery: 'review=1', liveEvent: 'b2c:*',
  canCreate: false, canEdit: false, canDelete: false,
  filterField: 'linkStatus',
  filterOptions: const [('unlinked', 'غير مرتبط', 'Unlinked'), ('linked', 'مرتبط', 'Linked')],
  searchFields: const ['displayName', 'arabicName', 'englishName', 'repId', 'displayPhone'],
  titleOf: (r) => _s(r, 'englishName'),
  subtitleOf: (r) => [
    _s(r, 'linkStatus') == 'linked' ? _s(r, 'displayName') : _s(r, 'arabicName'),
    _s(r, 'repId'),
    _s(r, 'lastOrderDate').isNotEmpty ? tr('آخر طلب ${_s(r, 'lastOrderDate')}', 'last order ${_s(r, 'lastOrderDate')}') : tr('لا طلبات', 'no orders'),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'linkStatus') != 'linked') (tr('غير مرتبط', 'Unlinked'), T.warn),
    if (r['suggestDeactivate'] == true) (tr('مقترحٌ إيقافُه', 'Suggest deactivate'), T.danger),
    if (r['isActive'] == false) (tr('موقوف', 'Inactive'), T.navy),
  ],
  rowActions: (r) => [
    if (canEdit)
      ResourceAction(
        icon: r['isActive'] != false ? Icons.power_settings_new : Icons.play_circle_outline,
        ar: r['isActive'] != false ? 'إيقاف الحساب' : 'تفعيل الحساب',
        en: r['isActive'] != false ? 'Deactivate' : 'Reactivate',
        color: r['isActive'] != false ? T.danger : T.success,
        confirmAr: r['isActive'] != false ? 'يُوقَف الحساب؟ تبقى طلباتُه في التاريخ.' : 'يُعاد تفعيل الحساب؟',
        confirmEn: r['isActive'] != false ? 'Deactivate this account? Its orders stay in the history.' : 'Reactivate this account?',
        request: (row) => ('PUT', '/api/b2c/reps/${row['_id']}', {'isActive': !(row['isActive'] != false)}),
      ),
  ],
  fields: const [],
);

// Shipment orders (standalone trial) and customers register.
// Read from the computed customers register (how many sheets, for how much, how many routes), not the raw customers table, so the row carries its numbers as on the web. Tapping opens the full file, the same as the web page.
// One register with three entry points: opened from shipment orders, operations and sales, with all reads and writes on /api/customer-registry. Writes used to go to the shipment-orders endpoint guarded by its section, so opening the register from another section gave 403 on first save. Who edits and who removes is decided by role as on the web (canEditCustomers) and passed from the list.
const customerEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'sales_manager', 'sales_rep',
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup', 'data_manager', 'data_analyst', 'data_entry'];
final customerRemoveRoles = customerEditRoles.where((r) => r != 'sales_rep').toList();

ResourceConfig customersRegisterCfg({required bool canEdit, required bool canDelete}) => ResourceConfig(
  canCreate: canEdit, canEdit: canEdit, canDelete: canDelete,
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(
      builder: (_) => CustomerRegistryProfileScreen(customerId: (r['_id'] ?? '').toString()))),
  arTitle: 'سجلّ العملاء', enTitle: 'Customer Register', icon: Icons.people_outline,
  endpoint: '/api/customer-registry',
  // The note has no column in the register so it is not carried in it; it is read from the customer file before editing.
  editFullKey: 'customer',
  listKey: 'customers', liveEvent: 'shipmentOrders:customers',
  // Portal account from the row, like the key button in the customers register on the web (all three entry points).
  rowActions: (r) => const [
    ResourceAction(icon: Icons.key_outlined, ar: 'حساب البوابة', en: 'Portal login', color: T.orange, run: openCustomerPortalLogin),
  ],
  searchFields: const ['customerCode', 'name', 'phone', 'email', 'branch'],
  sortFields: const [('sheets', 'أوامر النقل', 'Sheets'), ('routesCount', 'المسارات', 'Routes')],
  titleOf: (r) => _s(r, 'customerCode').isEmpty ? _s(r, 'name') : '${_s(r, 'customerCode')} · ${_s(r, 'name')}',
  // The second line carries its numbers: 670 customers without numbers are an inventory to scroll, not a register to read.
  subtitleOf: (r) {
    final parts = <String>[
      if ((r['sheets'] ?? 0) != 0) '${tr('رحلات', 'trips')}: ${_n(r['sheets'])}',
      if (r['purchaseTotal'] != null && (r['purchaseTotal'] ?? 0) != 0) '${tr('شراء', 'purchase')}: ${_n(r['purchaseTotal'])}',
      if (_s(r, 'phone').isNotEmpty) _s(r, 'phone'),
    ];
    return parts.join(' · ');
  },
  chipsOf: (r) => [
    if ((r['routesCount'] ?? 0) != 0) ('${tr('مسارات', 'routes')}: ${r['routesCount']}', T.navy),
    if ((r['unpricedRoutes'] ?? 0) != 0) ('${tr('بلا سعر', 'no price')}: ${r['unpricedRoutes']}', T.warn),
    if ((r['sheets'] ?? 0) == 0) (tr('بلا عمل', 'idle'), T.inkFaint),
  ],
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Name', required: true),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

/// Old form, for whoever edits and removes by role in shipment orders.
final shipmentOrdersCustomersCfg = customersRegisterCfg(canEdit: true, canDelete: true);

// Both registers are searched on the server.
// There are three thousand vendors and thirteen thousand trucks and the screen loads two hundred, so searching what arrived says no results for a registered row. serverSearch sends the text to the server, which searches the whole register, including plate, driver and operating card together.
final shipmentOrdersSuppliersCfg = ResourceConfig(
  filterField: 'type',
  arTitle: 'موردو الشاحنات', enTitle: 'SO Suppliers', icon: Icons.business_outlined,
  endpoint: '/api/shipment-orders/suppliers', listKey: 'suppliers', liveEvent: 'shipmentOrders:fleet',
  searchFields: const ['name', 'phone'],
  serverSearch: true,
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'phone'),
  chipsOf: (r) => [
    (r['type'] == 'freelancer' ? tr('مستقل', 'Freelancer') : tr('شركة', 'Company'), const Color(0xFF4F46E5)),
    // How many trucks and drivers: the two numbers asked about a vendor before opening his file.
    ('${r['vehicleCount'] ?? 0} شاحنة', T.navy),
    ('${r['driverCount'] ?? 0} سائق', T.cyan),
  ],
  // Merging a duplicate vendor into another: for managers by role, and the server rejects others.
  rowActions: (r) => [
    ResourceAction(
      icon: Icons.merge_type, ar: 'دمج مع مورّد آخر', en: 'Merge with another supplier', color: T.orange,
      run: (ctx, row) => openSupplierMerge(ctx, row),
    ),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Name', required: true),
    FieldSpec('type', 'النوع', 'Type', type: FieldType.select, options: [
      ('company', 'شركة', 'Company'),
      ('freelancer', 'مستقل', 'Freelancer'),
    ]),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final shipmentOrdersVehiclesCfg = ResourceConfig(
  arTitle: 'شاحنات طلبات الشحن', enTitle: 'SO Vehicles', icon: Icons.local_shipping_outlined,
  endpoint: '/api/shipment-orders/vehicles', listKey: 'vehicles', liveEvent: 'shipmentOrders:fleet',
  // Our trucks' identity is read from the vehicles register; editing it there shows here immediately, like the website.
  extraLiveEvents: const ['vreg:updated'],
  searchFields: const ['plate', 'name', 'defaultDriverName'],
  serverSearch: true,
  titleOf: (r) => _s(r, 'plate'),
  subtitleOf: (r) => '${_s(r, 'name')} ${_s(r, 'defaultDriverName')}'.trim(),
  // Truck owner as a badge; empty reads as unknown, not ours. A missing vendor used to mean from our fleet, so thousands of carrier trucks were imported with no reference and read as ours.
  chipsOf: (r) {
    final sup = r['supplier'];
    if (sup is Map && (sup['name'] ?? '').toString().isNotEmpty) {
      return [((sup['name']).toString(), const Color(0xFF2563EB))];
    }
    // Our truck linked to the vehicles register is labeled so as well; its make and color come from there.
    if (r['ownership'] == 'ours') {
      return [
        (tr('أسطولنا', 'Our fleet'), T.success),
        if (r['registry'] is Map) (tr('سجلّ المركبات: ${_s(r['registry'] as Map<String, dynamic>, 'plateNumber')}', 'Register: ${_s(r['registry'] as Map<String, dynamic>, 'plateNumber')}'), T.navy),
      ];
    }
    return [(tr('مالكٌ غير مسجَّل', 'Owner not recorded'), T.inkFaint)];
  },
  fields: const [
    FieldSpec('plate', 'اللوحة', 'Plate', required: true),
    FieldSpec('name', 'وصف الشاحنة', 'Description'),
    FieldSpec('truckType', 'نوع الشاحنة', 'Truck type'),
    // Make and color: the waybill prints them.
    // Vehicle data on the waybill has three items: plate, make and color. The last two used to print empty on a paper checked at gates.
    FieldSpec('brand', 'الماركة', 'Brand', required: true),
    FieldSpec('color', 'اللون', 'Color', required: true),
    FieldSpec('modelYear', 'سنة الصنع', 'Model year'),
    FieldSpec('operationCardNumber', 'رقم بطاقة التشغيل', 'Operation card no.'),
    FieldSpec('operationCardExpiry', 'انتهاء بطاقة التشغيل', 'Card expiry', type: FieldType.date),
    // Truck owner is corrected from the app as from the website: about 5,700 trucks had no owner known from order history, and whoever knows is usually on the road, not at the office.
    FieldSpec('supplier', 'المورّد المالك', 'Owner (supplier)', type: FieldType.lookup,
        lookupEndpoint: '/api/shipment-orders/suppliers', lookupListKey: 'suppliers',
        lookupQuery: 'limit=60', lookupServerSearch: true),
    FieldSpec('defaultDriverName', 'السائق الافتراضي', 'Default driver'),
    FieldSpec('defaultDriverPhone', 'هاتف السائق', 'Driver phone', type: FieldType.phone),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

/// Carrier truck drivers: a register that was entirely missing in both sections.
/// A driver was only a name on the truck row, with no file, iqama number, operating card or its expiry. The operations platform holds 17,563 drivers each with a file, so the register was imported from it.
/// Search is on the server: a register this size cannot be searched in an arrived page.
final shipmentOrdersDriversCfg = ResourceConfig(
  arTitle: 'سوّاق الناقلين', enTitle: 'Carrier Drivers', icon: Icons.badge_outlined,
  endpoint: '/api/shipment-orders/drivers', listKey: 'drivers', liveEvent: 'shipmentOrders:fleet',
  searchFields: const ['name', 'phone', 'residenceNumber', 'driverCardNumber'],
  serverSearch: true,
  filterField: 'docsState', filterOptions: personDocStates,
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [
    _s(r, 'phone'),
    if (_s(r, 'residenceNumber').isNotEmpty) 'إقامة ${_s(r, 'residenceNumber')}',
    if (r['vehicle'] is Map) _s(r['vehicle'] as Map<String, dynamic>, 'plate'),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) {
    final out = <(String, Color)>[];
    // Our employee: name, mobile and nationality from his HR file, like the web.
    if (r['hr'] is Map) out.add((tr('موظّف — من الموارد البشرية', 'Employee — from HR'), T.success));
    if (r['supplier'] is Map) out.add((_s(r['supplier'] as Map<String, dynamic>, 'name'), T.info));
    if (_s(r, 'nationality').isNotEmpty) out.add((_s(r, 'nationality'), T.navy));
    // The operating card is shown before assignment.
    // A driver with an expired card is stopped by the road, not by us, and knowing before loading him avoids a stalled load on the road.
    final exp = _s(r, 'driverCardExpiry');
    if (exp.isNotEmpty) {
      final d = DateTime.tryParse(exp);
      if (d != null) {
        final days = d.difference(DateTime.now()).inDays;
        if (days < 0) {
          out.add(('بطاقة التشغيل منتهية', T.danger));
        } else if (days <= 30) {
          out.add(('البطاقة تنتهي بعد $days يوم', T.warn));
        } else {
          out.add(('البطاقة سارية', T.success));
        }
      }
    } else {
      out.add(('بلا بطاقة تشغيل', T.inkFaint));
    }
    out.addAll(personDocChips(r));
    return out;
  },
  fields: [
    const FieldSpec('name', 'اسم السائق', 'Name', required: true),
    const FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    const FieldSpec('nationality', 'الجنسية', 'Nationality'),
    const FieldSpec('residenceNumber', 'رقم الإقامة', 'Iqama number'),
    const FieldSpec('driverCardNumber', 'رقم بطاقة التشغيل', 'Driver card number'),
    const FieldSpec('driverCardExpiry', 'انتهاء بطاقة التشغيل', 'Card expiry', type: FieldType.date),
    const FieldSpec('sponsorName', 'الكفيل', 'Sponsor'),
    const FieldSpec('supplier', 'المورّد', 'Supplier', type: FieldType.lookup,
        lookupEndpoint: '/api/shipment-orders/suppliers', lookupListKey: 'suppliers',
        lookupQuery: 'limit=60', lookupServerSearch: true),
    FieldSpec('vehicle', 'شاحنته', 'His truck', type: FieldType.lookup,
        lookupEndpoint: '/api/shipment-orders/vehicles', lookupListKey: 'vehicles',
        lookupQuery: 'limit=60', lookupServerSearch: true,
        lookupLabel: (v) => [_s(v, 'plate'), _s(v, 'name')].where((x) => x.isNotEmpty).join(' · ')),
    const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Collections parties.
// One register in two forms: the customer pays us and we pay the vendor. Figures (due and collected) are derived on the server from the operations sheets, so the app never states a number that differs from the website.
ResourceConfig _collectionsPartyCfg({required bool customer}) => ResourceConfig(
      arTitle: customer ? 'عملاء التحصيل' : 'موردو التحصيل',
      enTitle: customer ? 'Collections Customers' : 'Collections Suppliers',
      icon: customer ? Icons.people_outline : Icons.local_shipping_outlined,
      endpoint: '/api/collections-dept/parties',
      listKey: 'parties',
      listQuery: 'kind=${customer ? 'customer' : 'supplier'}',
      updateMethod: 'PUT',
      liveEvent: 'collections:party',
      // Three thousand vendors are not downloaded to a phone, so search runs on the server and not in the loaded set; otherwise a user searching the first two hundred would be told no results.
      serverSearch: true,
      searchFields: const ['name', 'code', 'phone', 'contactPerson', 'commercialRegister', 'taxNumber', 'iban', 'city', 'collectionOfficer'],
      titleOf: (r) => _s(r, 'name'),
      // Code first on the line: it is the account identity in accounting and in all correspondence, and who handles it is the first question when it is late.
      // The responsible person: if unassigned, the section manager, so the field is never empty.
      // The code comes from the register, else from the ledger invoices (codeShown on the server).
      subtitleOf: (r) => [_s(r, 'codeShown').isNotEmpty ? _s(r, 'codeShown') : _s(r, 'code'), _s(r, 'effectiveOfficer').isNotEmpty ? _s(r, 'effectiveOfficer') : _s(r, 'collectionOfficer'), _s(r, 'city'), _s(r, 'phone')]
          .where((x) => x.isNotEmpty)
          .join(' · '),
      chipsOf: (r) {
        final due = (r['outstanding'] as num?)?.toDouble() ?? 0;
        final limit = (r['creditLimit'] as num?)?.toDouble() ?? 0;
        return [
          if (due > 0) ('${_n(due)} ${customer ? 'لنا' : 'علينا'}', T.danger),
          // Limit consumption read on the line.
          // Near its limit is a decision made before loading the next shipment, and someone opening the list on the road needs it here and not two taps away.
          if (limit > 0) ('${(due / limit * 100).round()}% من الحد', due > limit ? T.danger : due >= limit * 0.8 ? T.warn : T.success),
          if (_s(r, 'grade').isNotEmpty) (_s(r, 'grade'), T.cyan),
          if (r['creditDays'] != null && r['creditDays'] != 0) ('${r['creditDays']} يوم سداد', T.navy),
          if (_s(r, 'status').isNotEmpty) (_s(r, 'status'), T.info),
          if (r['isActive'] == false) ('معطَّل', T.inkFaint),
        ];
      },
      fields: [
        const FieldSpec('name', 'الاسم', 'Name', required: true),
        // Type is fixed by the page it was opened from: the customers page does not create a vendor.
        FieldSpec('kind', 'النوع', 'Kind', type: FieldType.select, required: true, options: [
          customer ? ('customer', 'عميل', 'Customer') : ('supplier', 'مورد', 'Supplier'),
        ]),
        const FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
        const FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
        const FieldSpec('contactPerson', 'مسؤول التواصل', 'Contact person'),
        const FieldSpec('contactPhone', 'جوال المسؤول', 'Contact phone', type: FieldType.phone),
        const FieldSpec('accountantName', 'محاسب الطرف', 'Their accountant'),
        const FieldSpec('accountantPhone', 'جوال المحاسب', 'Accountant phone', type: FieldType.phone),
        const FieldSpec('commercialRegister', 'السجل التجاري', 'Commercial register'),
        const FieldSpec('taxNumber', 'الرقم الضريبي', 'Tax number'),
        const FieldSpec('iban', 'الآيبان', 'IBAN'),
        const FieldSpec('bankName', 'البنك', 'Bank'),
        const FieldSpec('city', 'المدينة', 'City'),
        const FieldSpec('address', 'العنوان', 'Address'),
        const FieldSpec('paymentTerms', 'شروط السداد', 'Payment terms'),
        const FieldSpec('status', 'حالة التحصيل', 'Collection status'),
        const FieldSpec('creditLimit', 'حد الائتمان', 'Credit limit', type: FieldType.number),
        // Collections ledger fields.
        // The code is left empty for a new one and generated following the ledger sequence (C#### for cash and 1104#### for tax). The credit term counts from invoice delivery, not its date; the title says so because the difference is the difference between overdue and not yet received.
        const FieldSpec('code', 'الكود', 'Code'),
        const FieldSpec('collectionOfficer', 'موظف التحصيل', 'Collection officer'),
        const FieldSpec('grade', 'التقييم', 'Grade'),
        const FieldSpec('department', 'القسم', 'Department'),
        const FieldSpec('hoLocation', 'فرع العميل', 'Location'),
        const FieldSpec('creditDays', 'مهلة السداد (من التسليم)', 'Credit days (from delivery)', type: FieldType.number),
        const FieldSpec('nextFollowUpAt', 'المتابعة القادمة', 'Next follow-up', type: FieldType.date),
        const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
      ],
      sortFields: const [
        ('outstanding', 'المستحق', 'Outstanding'),
        ('reports', 'عدد أوامر النقل', 'Reports'),
      ],
      // The row opens the party file (editing from the pencil), like its name on the website.
      onOpen: (ctx, r) => Navigator.push(ctx, MaterialPageRoute(builder: (_) => CollectionsPartyScreen(id: _s(r, '_id')))),
      // Assigning the collections employee: to this account or to several accounts together.
      rowActions: (r) => [
        if (collectionsCanEdit)
          ResourceAction(
            icon: Icons.group_add_outlined, ar: 'إسناد إلى موظف تحصيل', en: 'Assign to an officer', color: T.navy,
            run: (ctx, r) => openCollectionsBulkAssign(ctx, kind: customer ? 'customer' : 'supplier', initial: r),
          ),
      ],
    );

// Collections ledger on mobile.
// The aging register and invoice ledger are read on the road and before a visit: how much he owes and since when, and which invoice is due. They are read-only here: editing happens on the screen where all columns are seen side by side.
final collectionsAgingCfg = ResourceConfig(
  arTitle: 'أعمار الديون', enTitle: 'Aging', icon: Icons.layers_outlined,
  endpoint: '/api/collections-dept/ledger/aging', listKey: 'rows', liveEvent: 'collections:party',
  canCreate: false, canEdit: false, canDelete: false,
  serverSearch: true,
  searchFields: const ['name', 'code', 'collectionOfficer'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'code'), _s(r, 'effectiveOfficer').isNotEmpty ? _s(r, 'effectiveOfficer') : _s(r, 'collectionOfficer'), _s(r, 'hoLocation')]
      .where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) {
    final out = (r['outstanding'] as num?)?.toDouble() ?? 0;
    final pct = (r['limitUsedPct'] as num?)?.toDouble();
    final bands = (r['bands'] as Map?) ?? const {};
    final old = ((bands['120+'] as num?)?.toDouble() ?? 0) + ((bands['1Y+'] as num?)?.toDouble() ?? 0);
    return [
      (_n(out), T.danger),
      // Four months old or more gets its own color: it is pursued first.
      if (old > 0) ('${_n(old)} فوق 120 يوم', T.warn),
      if (pct != null) ('${pct.round()}% من الحد', pct >= 100 ? T.danger : pct >= 80 ? T.warn : T.success),
      if (_s(r, 'grade').isNotEmpty) (_s(r, 'grade'), T.cyan),
    ];
  },
  fields: const [],
  sortFields: const [
    ('outstanding', 'المديونية', 'Outstanding'),
    ('limitUsedPct', 'استهلاك الحد', 'Limit used'),
    ('creditDays', 'مهلة السداد', 'Credit days'),
  ],
);

final collectionsLedgerCfg = ResourceConfig(
  arTitle: 'دفتر الفواتير', enTitle: 'Invoice Ledger', icon: Icons.menu_book_outlined,
  endpoint: '/api/collections-dept/ledger/invoices', listKey: 'rows', liveEvent: 'collections:party',
  canCreate: false, canEdit: false, canDelete: false,
  serverSearch: true,
  searchFields: const ['invoiceNumber', 'partyName', 'partyCode'],
  titleOf: (r) => '${_s(r, 'invoiceNumber')} · ${_s(r, 'partyName')}',
  subtitleOf: (r) => [
    if (_s(r, 'invoiceDate').isNotEmpty) 'فُوترت ${_s(r, 'invoiceDate').split('T').first}',
    // Invoice delivery to the customer: his term starts from it, and it differs from delivering the sheet to the branch.
    if (_s(r, 'deliveryDate').isNotEmpty) 'سُلّمت للعميل ${_s(r, 'deliveryDate').split('T').first}',
    if (_s(r, 'collectionDate').isNotEmpty) 'حُصّلت ${_s(r, 'collectionDate').split('T').first}',
  ].join(' · '),
  chipsOf: (r) {
    final d = (r['daysToDue'] as num?)?.toInt();
    return [
      (_n(r['total']), T.navy),
      if (_s(r, 'band').isNotEmpty && _s(r, 'band') != 'noDate') (_s(r, 'band'), T.cyan),
      // Due date in words, not a negative number: "12 days overdue" is read at a glance while a negative twelve needs a pause.
      if (d != null && d < 0) ('متأخّرة ${-d} يومًا', T.danger)
      else if (d != null && d <= 3) ('تستحق بعد $d', T.warn),
      if (_s(r, 'status').isNotEmpty) (_s(r, 'status'), _s(r, 'status') == 'Collected' ? T.success : T.info),
    ];
  },
  fields: const [],
);

// Collections invoices.
// The section works by invoices, not sheets. A cash row is a sheet collected the same day; a tax row is an invoice that may contain sheets and its amount is written on it.
final collectionsCashInvoicesCfg = ResourceConfig(
  arTitle: 'فواتير الكاش', enTitle: 'Cash Invoices', icon: Icons.payments_outlined,
  endpoint: '/api/collections-dept/invoices/cash', listKey: 'invoices',
  // collections:changed carries the sheet-to-customs link (services/customsOpsLink).
  liveEvent: 'workflow:updated', extraLiveEvents: const ['collections:attachments', 'collections:changed'], serverSearch: true,
  canCreate: false, canDelete: false,
  // Three states as on the website, computed by the server with the row (collectionState).
  filterField: 'collectionState', filterOptions: _collectionStates,
  searchFields: const ['reportNumber', 'customer', 'payingBranch'],
  titleOf: (r) => _s(r, 'reportNumber'),
  subtitleOf: (r) => [_s(r, 'customer'), _s(r, 'payingBranch')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (r['ageDays'] != null) ('${r['ageDays']} يوم', _ageColor(r['ageDays'])),
    // Collected in the ledger even if its day was not written, as the website screen says.
    if (r['collectedNoDate'] == true) ('محصَّل — بلا تاريخ', T.success)
    else if (_s(r, 'collectionState') == 'partial') ('جزئي — باقٍ ${_n(r['remaining'])}', T.warn)
    else if (_s(r, 'collectionDate').isEmpty) ('لم يُحصَّل', T.danger)
    else ('${_n(r['collectedAmount'])} محصَّل', T.success),
    // Delivery is a step before collection, and the customer's term is counted from it.
    if (_s(r, 'deliveryDate').isEmpty) ('لم تُسلَّم', T.warn) else ('سُلِّمت', T.info),
    if (_s(r, 'collectionDetail').isNotEmpty) (_s(r, 'collectionDetail'), T.navy),
    if (_attachCount(r) > 0) ('${_attachCount(r)} مرفقات', T.orange),
    // The customs transaction the sheet serves, like the website badge.
    if (_customsChip(r['customs'] is Map ? [r['customs']] : const []) != null) _customsChip([r['customs']])!,
  ],
  // Collection is done from the collect button, not the edit sheet.
  // Full or partial, each payment having an amount, a day and a writer (see collection_collect). Writing the amount and date in the sheet bypassed payments and erased the rest.
  fields: [
    // Delivery to the customer is here as on the screen.
    // It was on the tax page only, and cash is carried to the customer the same way.
    const FieldSpec('deliveryDate', 'تاريخ التسليم للعميل', 'Delivered to customer', type: FieldType.date),
    // The list comes from section settings, and its Arabic text is stored, not its id.
    FieldSpec('collectionDetail', 'التفاصيل', 'Detail', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=collections_detail&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
  ],
  sortFields: const [('ageDays', 'العمر', 'Age')],
  rowActions: (r) => [
    if (collectionsCanEdit) _collectAction(true),
    _attachmentsAction('cash', (r) => _s(r, '_id'), (r) => _s(r, 'reportNumber')),
    if (collectionsCanEdit && (_s(r, 'collectionDate').isNotEmpty || ((r['collectedAmount'] is num) && (r['collectedAmount'] as num) > 0)))
      _uncollectAction((r) => {'ids': [_s(r, '_id')]}),
  ],
);

/// Customs badge in a collections row: transaction number and container count, with +n for others.
(String, Color)? _customsChip(List links) {
  final list = links.whereType<Map>().where((l) => '${l['refNumber'] ?? ''}'.isNotEmpty).toList();
  if (list.isEmpty) return null;
  final first = list.first;
  final n = (first['containers'] is List) ? (first['containers'] as List).length : 0;
  final more = list.length > 1 ? ' +${list.length - 1}' : '';
  return ('تخليص ${first['refNumber']}${n > 0 ? ' · $n حاوية' : ''}$more', T.cyan);
}

/// The three collection states: filter chips above the two lists.
const _collectionStates = [
  ('none', 'لم تُحصَّل بعد', 'Not collected'),
  ('partial', 'تم تحصيلها جزئيًّا', 'Partially collected'),
  ('full', 'تم تحصيلها', 'Collected'),
];

/// Collect: full or partial, like the website dialog.
ResourceAction _collectAction(bool isCash) => ResourceAction(
      icon: Icons.check_circle_outline_rounded, ar: 'تحصيل', en: 'Collect', color: T.orange,
      run: (ctx, r) => openCollectSheet(ctx, isCash: isCash, row: r),
    );

/// Who writes in collections invoices: set by sectionsFor from the user's role and section grant (EDIT_ROLES in routes/collectionsDept). Reading is broader than writing here, so not-collected is not shown to someone the server would reject.
bool collectionsCanEdit = true;

/// Edit amount: by role alone, like the server guard (authorize.strict on collectionsDeptController.AMOUNT_EDIT_ROLES); a section edit grant does not open it.
const collectionsAmountEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'collections_manager', 'cfo', 'accounting_manager'];
bool collectionsCanEditAmount = false;

/// Not collected: reverting a recorded collection. The reason is optional and recorded under the user's name. A tax invoice is identified by its number, a cash sheet by its workflow id.
ResourceAction _uncollectAction(Map<String, dynamic> Function(Map<String, dynamic>) target) => ResourceAction(
      icon: Icons.undo_rounded, ar: 'لم تُحصَّل', en: 'Not collected', color: T.danger,
      confirmAr: 'يُمحى تاريخُ التحصيل ومبلغُه من أوامر النقل ومن سير عمل التشغيل وتعود غيرَ محصَّلة — يُقيَّد باسمك وسببك.',
      confirmEn: 'The collection date and amount are cleared from the reports and the operations workflow, and it returns to not collected — recorded under your name and reason.',
      reasonKey: 'reason', reasonAr: 'سبب الرجوع عن التحصيل', reasonEn: 'Reason for undoing the collection', reasonOptional: true,
      request: (r) => ('POST', '/api/collections-dept/invoices/uncollect', target(r)),
    );

final collectionsTaxInvoicesCfg = ResourceConfig(
  arTitle: 'الفواتير الضريبية', enTitle: 'Tax Invoices', icon: Icons.receipt_long_outlined,
  endpoint: '/api/collections-dept/invoices/tax', listKey: 'invoices',
  liveEvent: 'workflow:updated', extraLiveEvents: const ['collections:attachments', 'collections:changed'], serverSearch: true,
  canCreate: false, canEdit: false, canDelete: false,
  filterField: 'collectionState', filterOptions: _collectionStates,
  searchFields: const ['invoiceNumber', 'customer'],
  titleOf: (r) => _s(r, 'invoiceNumber'),
  subtitleOf: (r) => [_s(r, 'customer'), '${_n(r['value'])} ر.س'].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    // Sheet count: one invoice may contain more than one sheet.
    ('${r['reports'] ?? 0} أمر نقل', T.navy),
    // Customs transactions served by the invoice's sheets.
    if (_customsChip(r['customs'] is List ? r['customs'] as List : const []) != null) _customsChip(r['customs'] as List)!,
    if (r['ageDays'] != null) ('${r['ageDays']} يوم', _ageColor(r['ageDays'])),
    if (r['fullyCollected'] == true) ('محصَّلة', T.success)
    else if (_s(r, 'collectionState') == 'partial') ('جزئية — باقٍ ${_n(r['remaining'])}', T.warn)
    else ('لم تُحصَّل', T.danger),
    if (_attachCount(r) > 0) ('${_attachCount(r)} مرفقات', T.orange),
  ],
  fields: const [],
  rowActions: (r) => [
    if (collectionsCanEdit) _collectAction(false),
    _attachmentsAction('tax', (r) => _s(r, 'invoiceNumber'), (r) => _s(r, 'invoiceNumber')),
    if (collectionsCanEdit && (r['fullyCollected'] == true || _s(r, 'collectionDate').isNotEmpty || _s(r, 'collectionState') == 'partial'))
      _uncollectAction((r) => {'invoiceNumber': _s(r, 'invoiceNumber')}),
    // Correcting the invoice amount in the ledger (negative allowed), like the website and for its roles only.
    if (collectionsCanEditAmount)
      ResourceAction(
        icon: Icons.edit_note_rounded, ar: 'تعديل القيمة', en: 'Edit amount', color: T.navy,
        run: (ctx, r) async {
          final ctrl = TextEditingController(text: '${r['value'] ?? ''}');
          final v = await showDialog<String>(
            context: ctx,
            builder: (c) => AlertDialog(
              title: Text('${tr('تعديل قيمة الفاتورة', 'Edit invoice amount')} ${_s(r, 'invoiceNumber')}'),
              content: TextField(controller: ctrl, autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(signed: true, decimal: true),
                  decoration: InputDecoration(labelText: tr('القيمة الجديدة (ويجوز بالسالب)', 'New amount (negative allowed)'))),
              actions: [
                TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
                FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
              ],
            ),
          );
          if (v == null || v.isEmpty) return false;
          final n = num.tryParse(v.replaceAll(',', ''));
          if (n == null) return false;
          await Api.instance.put('/api/collections-dept/invoices/tax/${Uri.encodeComponent(_s(r, 'invoiceNumber'))}/amount', {'total': n});
          return true;
        },
      ),
  ],
);

/// Invoice attachment count as returned by the server with the row.
int _attachCount(Map<String, dynamic> r) => (r['attachments'] is num) ? (r['attachments'] as num).toInt() : 0;

/// Attachments: opens the invoice files. Open and download, plus upload and delete for whoever has them (decided by the server). Tax by number and cash by its sheet id, like the website.
ResourceAction _attachmentsAction(String kind, String Function(Map<String, dynamic>) keyOf, String Function(Map<String, dynamic>) labelOf) =>
    ResourceAction(
      icon: Icons.attach_file_rounded, ar: 'المرفقات', en: 'Attachments', color: T.orange,
      run: (ctx, r) => openCollectionAttachments(ctx, kind: kind, key: keyOf(r), label: labelOf(r)),
    );

/// Age color: older is more severe; the number alone does not convey the danger.
Color _ageColor(dynamic d) {
  final n = (d is num) ? d : num.tryParse('$d') ?? 0;
  if (n > 60) return T.danger;
  if (n > 45) return T.orange;
  if (n > 30) return T.warn;
  if (n > 15) return T.info;
  return T.inkSoft;
}

final collectionsCustomersCfg = _collectionsPartyCfg(customer: true);
final collectionsSuppliersCfg = _collectionsPartyCfg(customer: false);

final vendorsCfg = ResourceConfig(
  arTitle: 'الموردون', enTitle: 'Vendors', icon: Icons.store_outlined,
  endpoint: '/api/vendors', listKey: 'vendors', liveEvent: 'vendor:updated',
  searchFields: const ['name', 'contactPerson', 'phone', 'category'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'contactPerson'), _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'category').isNotEmpty) (_s(r, 'category'), T.navy),
    if ((r['totalOutstanding'] ?? 0) != 0) ('مستحق: ${r['totalOutstanding']}', T.danger),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Name', required: true),
    FieldSpec('contactPerson', 'جهة الاتصال', 'Contact person'),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('category', 'الفئة', 'Category'),
    FieldSpec('address', 'العنوان', 'Address'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final shipmentOrdersFieldsCfg = ResourceConfig(
  filterField: 'group',
  arTitle: 'إعدادات النموذج', enTitle: 'Form Settings', icon: Icons.tune_outlined,
  endpoint: '/api/shipment-orders/fields', listQuery: 'all=1', listKey: 'fields', liveEvent: 'shipmentOrders:fields',
  searchFields: const ['labelAr', 'labelEn', 'group'],
  titleOf: (r) => _s(r, 'labelAr'),
  subtitleOf: (r) => [_s(r, 'labelEn'), _s(r, 'inputType')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'group')) {
      'pickup_delivery' => ('الاستلام والتسليم', T.info),
      'shipment' => ('الشحنة', T.navy),
      'pricing_time' => ('التسعير والمواعيد', T.violet),
      'payment' => ('الدفع', T.orange),
      _ => (_s(r, 'group'), T.inkFaint),
    },
    r['active'] != false ? ('مُفعّل', T.success) : ('معطّل', T.inkFaint),
    if (r['required'] == true) ('إلزامي', T.danger),
    if (r['isSystem'] == true) ('نظامي', T.cyan),
  ],
  fields: const [
    FieldSpec('labelAr', 'التسمية بالعربية', 'Arabic label', required: true),
    FieldSpec('labelEn', 'التسمية بالإنجليزية', 'English label'),
    FieldSpec('group', 'المجموعة', 'Group', type: FieldType.select, options: [
      ('pickup_delivery', 'الاستلام والتسليم', 'Pickup & delivery'),
      ('shipment', 'الشحنة', 'Shipment'),
      ('pricing_time', 'التسعير والمواعيد', 'Pricing & times'),
      ('payment', 'الدفع', 'Payment'),
    ]),
    FieldSpec('inputType', 'نوع الحقل', 'Input type', type: FieldType.select, options: [
      ('text', 'نص', 'Text'), ('number', 'رقم', 'Number'), ('textarea', 'نص طويل', 'Textarea'),
      ('select', 'قائمة', 'Select'), ('cards', 'بطاقات', 'Cards'), ('datetime', 'تاريخ ووقت', 'Datetime'),
    ]),
    FieldSpec('required', 'إلزامي', 'Required', type: FieldType.checkbox),
    FieldSpec('active', 'مُفعّل', 'Active', type: FieldType.checkbox),
    FieldSpec('order', 'الترتيب', 'Order', type: FieldType.number),
  ],
);

// CRM vendors (3PL).
final crmVendorsCfg = ResourceConfig(
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => CrmVendorDetailScreen(vendor: r))),
  arTitle: 'الموردون (3PL)', enTitle: 'CRM Vendors', icon: Icons.local_shipping_outlined,
  endpoint: '/api/crm-vendors', listKey: 'items', updateMethod: 'PUT', liveEvent: 'crm:vendor',
  searchFields: const ['name', 'energizeRep', 'representative', 'mobile', 'headOffice', 'vendorType'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'vendorType'), _s(r, 'representative'), _s(r, 'mobile')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'followUpStatus').isNotEmpty) (_s(r, 'followUpStatus'), T.info),
    if (r['carsCount'] != null) ('${r['carsCount']} ${'سيارة'}', T.navy),
    if (r['ourSideSigned'] == true && r['vendorSideSigned'] == true) ('موقّع', T.success),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Name', required: true),
    FieldSpec('vendorType', 'النوع', 'Type'),
    FieldSpec('energizeRep', 'مندوبنا', 'Our rep'),
    FieldSpec('representative', 'ممثل المورد', 'Their rep'),
    FieldSpec('mobile', 'الجوال', 'Mobile', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('headOffice', 'المقر', 'Head office'),
    FieldSpec('destinations', 'الوجهات', 'Destinations'),
    FieldSpec('carsCount', 'عدد السيارات', 'Cars', type: FieldType.number),
    FieldSpec('followUpStatus', 'حالة المتابعة', 'Follow-up'),
    FieldSpec('hasPapers', 'لديه أوراق', 'Has papers', type: FieldType.checkbox),
    FieldSpec('vendorSideSigned', 'وقّع المورد', 'Vendor signed', type: FieldType.checkbox),
    FieldSpec('ourSideSigned', 'وقّعنا', 'We signed', type: FieldType.checkbox),
    FieldSpec('isNewVendor', 'مورد جديد', 'New vendor', type: FieldType.checkbox),
    FieldSpec('contractDate', 'تاريخ العقد', 'Contract date'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Employee contracts, HR Contracts (read-only; creation happens from the employee file).
final hrContractsCfg = ResourceConfig(
  arTitle: 'عقود الموظفين', enTitle: 'Employment Contracts', icon: Icons.description_outlined,
  // The live event is the one the server actually broadcasts.
  // It used to be hr:updated, a name the server never emits, so the list refreshed only by pull. Every contract write (create, edit, renew, terminate, delete) and every employee file edit broadcasts hr:master to everyone, which the web page listens to.
  endpoint: '/api/hr/contracts', listKey: 'contracts', liveEvent: 'hr:master',
  canCreate: false, canEdit: false, canDelete: false,
  // Data of the contract paper itself: identity as written in it, the profession as in the contract (differs from the iqama profession and the job title), and the register issued under it. These are what is actually searched by, not the contract status.
  searchFields: const ['jobTitle', 'type', 'status', 'iqamaNumber', 'contractProfession', 'sponsorRegistration', 'employeeNameAr', 'contractNumber'],
  titleOf: (r) => (r['employee'] is Map ? (r['employee']['arabicName'] ?? r['employee']['englishName'] ?? r['employee']['name']) : null)?.toString()
      ?? (_s(r, 'employeeNameAr').isNotEmpty ? _s(r, 'employeeNameAr') : _s(r, 'jobTitle')),
  subtitleOf: (r) => [
    _s(r, 'contractProfession').isNotEmpty ? _s(r, 'contractProfession') : _s(r, 'jobTitle'),
    _s(r, 'iqamaNumber'),
    // Department as in the web table, read from the employee file attached to the contract.
    if (r['employee'] is Map) (r['employee']['department'] ?? '').toString(),
    // Contract start and end, each in both calendars: Gregorian then Hijri.
    [_s(r, 'startDate'), _s(r, 'endDate')].where((x) => x.isNotEmpty).map((x) => bothDates(x, ar: Lang.instance.ar)).join(' → '),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    // Valid or expired only, like the website badge, not the database key.
    if (_s(r, 'status').isNotEmpty) (r['status'] == 'active' ? 'ساري' : 'منتهي', r['status'] == 'active' ? T.success : T.inkFaint),
    // Not required is a healthy state, not a missing zero; written as it is.
    if (_s(r, 'annualLeaveText').isNotEmpty) (_s(r, 'annualLeaveText'), T.warn)
    else if (r['annualLeaveDays'] != null) ('إجازة ${r['annualLeaveDays']}', T.cyan),
    // Contract number in Qiwa: asked for in inspection and office correspondence, so it is read from mobile as on the screen.
    if (_s(r, 'contractNumber').isNotEmpty) ('عقد ${_s(r, 'contractNumber')}', T.navy),
    if (_s(r, 'sponsorRegistration').isNotEmpty) ('سجل ${_s(r, 'sponsorRegistration')}', T.inkFaint),
    if (r['basicSalary'] != null && r['basicSalary'] != 0) ('${r['basicSalary']}', T.navy),
  ],
  fields: const [],
);

// HR stock.
final hrStockCfg = ResourceConfig(
  arTitle: 'مخزون الموارد البشرية', enTitle: 'HR Stock', icon: Icons.inventory_2_outlined,
  endpoint: '/api/hr/stock', listKey: 'items', liveEvent: 'hr:asset',
  searchFields: const ['name', 'type', 'brand', 'model', 'serialNumber', 'specs', 'location'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [HrAssetVocab.typeLabel(r['type']), _s(r, 'brand'), _s(r, 'model'), _s(r, 'serialNumber'), _s(r, 'location')].where((x) => x.isNotEmpty && x != 'null').join(' · '),
  chipsOf: (r) => [
    ('الكمية: ${(r['quantity'] is num && r['quantity'] > 0) ? r['quantity'] : 1}', T.navy),
    if (_s(r, 'condition').isNotEmpty) (HrAssetVocab.conditionLabel(r['condition']), _s(r, 'condition') == 'damaged' ? T.danger : T.cyan),
  ],
  // Damaged is a chip opened like the Damaged card on the website.
  filterField: 'condition',
  // Hand over to an employee: POST /api/hr/stock/:id/assign as on the website (employee, date and condition are chosen).
  rowActions: (r) => [
    ResourceAction(icon: Icons.person_add_alt_outlined, ar: 'تسليم لموظف', en: 'Assign to employee', color: T.orange,
        run: (c, row) => hrStockAssign(c, row)),
  ],
  fields: const [
    FieldSpec('name', 'اسم الصنف', 'Name', required: true),
    FieldSpec('type', 'النوع', 'Type', type: FieldType.select, options: [
      ('laptop', 'حاسب محمول', 'Laptop'), ('desktop', 'حاسب مكتبي', 'Desktop'), ('phone', 'هاتف', 'Phone'),
      ('tablet', 'تابلت', 'Tablet'), ('sim', 'شريحة اتصال', 'SIM Card'), ('monitor', 'شاشة', 'Monitor'),
      ('keyboard', 'لوحة مفاتيح', 'Keyboard'), ('mouse', 'فأرة', 'Mouse'), ('headset', 'سماعة رأس', 'Headset'),
      ('printer', 'طابعة', 'Printer'), ('router', 'موجّه شبكة', 'Router'), ('charger', 'شاحن', 'Charger'),
      ('cable', 'كبل', 'Cable'), ('laptop_bag', 'حقيبة حاسب', 'Laptop Bag'), ('accessory', 'ملحق', 'Accessory'),
      ('access_card', 'بطاقة دخول', 'Access Card'), ('vehicle', 'مركبة', 'Vehicle'), ('tool', 'أداة', 'Tool'), ('other', 'أخرى', 'Other'),
    ]),
    FieldSpec('serialNumber', 'السيريال', 'Serial'),
    FieldSpec('condition', 'الحالة', 'Condition', type: FieldType.select, options: [
      ('new', 'جديد', 'New'), ('good', 'جيد', 'Good'), ('fair', 'مقبول', 'Fair'), ('damaged', 'تالف', 'Damaged'),
    ]),
    FieldSpec('brand', 'الماركة', 'Brand'),
    FieldSpec('model', 'الموديل', 'Model'),
    FieldSpec('quantity', 'الكمية', 'Quantity', type: FieldType.number),
    FieldSpec('location', 'المكان', 'Location'),
    FieldSpec('value', 'القيمة', 'Value', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Vehicle work orders, Workshop Work Orders.

// Audit log, read-only.
// The row used to show the action and entity keys as stored (update_workflow · OperationsWorkflow) without saying what changed. The server now writes the same sentence the website shows: action name, the record it hit and what changed from X to Y, so it is displayed as is and not rebuilt.
final auditCfg = ResourceConfig(
  arTitle: 'سجل التدقيق', enTitle: 'Audit Log', icon: Icons.fact_check_outlined,
  endpoint: '/api/audit', listKey: 'logs', liveEvent: '',
  canCreate: false, canEdit: false, canDelete: false,
  searchFields: const ['actionLabel', 'entityLabel', 'sectionLabel', 'subject', 'summary', 'userName'],
  titleOf: (r) => [_s(r, 'actionLabel'), _s(r, 'subject')].where((x) => x.isNotEmpty).join(' — '),
  // The second line is a single line in the general list, so it holds only the sentence of what changed; who and when are in the chips under it, so the sentence is not cut to make room.
  subtitleOf: (r) => _s(r, 'summary'),
  chipsOf: (r) => [
    if (_s(r, 'sectionLabel').isNotEmpty) (_s(r, 'sectionLabel'), T.navy),
    if (_s(r, 'userName').isNotEmpty) (_s(r, 'userName'), T.info),
    if (_s(r, 'createdAt').isNotEmpty) (_s(r, 'createdAt').split('T').first, T.inkFaint),
    if (_s(r, 'kind') == 'delete') ('حذف', T.danger),
    if (_s(r, 'kind') == 'bulk') ('إجراء جماعي', T.info),
  ],
  fields: const [],
);


// Customs parties: customers, shipping agents and carriers.
// One register with three roles (CustomsParty.kind): the structure is the same and only the role differs, so one config is cloned per role instead of three configs that drift on the first edit.
ResourceConfig _customsPartyCfg(String kind, String ar, String en, IconData icon) => ResourceConfig(
      arTitle: ar, enTitle: en, icon: icon,
      // deep=1 plus server search: a party is also found by a container or waybill number from its transactions, like the parties page on the website.
      endpoint: '/api/customs-clearance/parties', listKey: 'parties', listQuery: 'kind=$kind&deep=1',
      serverSearch: true,
      searchHint: ('ابحث بالاسم أو الجوال أو السجل — أو برقم حاويةٍ أو بوليصةٍ من معاملاته…',
          'Name, phone, CR — or a container / BL number from their deals…'),
      updateMethod: 'PUT', liveEvent: 'customs:updated',
      // Tapping the row opens its file (data and attachments); editing is from the pencil icon.
      onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(
          builder: (_) => CustomsPartyScreen(partyId: _s(r, '_id'), name: _s(r, 'name')))),
      searchFields: const ['name', 'email', 'phone', 'contactPerson', 'city', 'commercialRegister', 'taxNumber'],
      titleOf: (r) => _s(r, 'name'),
      subtitleOf: (r) => [_s(r, 'contactPerson'), _s(r, 'phone'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
      chipsOf: (r) => [
        if (r['deals'] != null) ('${r['deals']} معاملة', T.navy),
        if ((r['revenue'] ?? 0) != 0) ('${r['revenue']}', T.success),
        if (r['isActive'] == false) ('معطَّل', T.inkFaint),
      ],
      fields: [
        const FieldSpec('name', 'الاسم', 'Name', required: true),
        // The role is sent with create, otherwise a customer is created whatever the page.
        FieldSpec('kind', 'الدور', 'Role', type: FieldType.select, options: [(kind, ar, en)]),
        const FieldSpec('contactPerson', 'مسؤول التواصل', 'Contact person'),
        const FieldSpec('phone', 'الجوال', 'Phone'),
        const FieldSpec('email', 'البريد', 'Email'),
        const FieldSpec('city', 'المدينة', 'City'),
        const FieldSpec('commercialRegister', 'السجل التجاري', 'CR number'),
        const FieldSpec('taxNumber', 'الرقم الضريبي', 'Tax number'),
        const FieldSpec('address', 'العنوان', 'Address'),
        const FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
      ],
    );

final customsCustomersCfg = _customsPartyCfg('customer', 'عملاء التخليص', 'Customs Customers', Icons.people_outline);
final customsAgentsCfg = _customsPartyCfg('agent', 'وكلاء الشحن', 'Shipping Agents', Icons.directions_boat_outlined);
final customsCarriersCfg = _customsPartyCfg('carrier', 'الناقلون', 'Carriers', Icons.local_shipping_outlined);

/// Party name with its role: the name alone does not say whether it is a customer or a carrier.
String _partyLabel(Map<String, dynamic> r) {
  final kind = switch (_s(r, 'kind')) { 'agent' => 'وكيل شحن', 'carrier' => 'ناقل', _ => 'عميل' };
  return '${_s(r, 'name')} — $kind';
}

/// A contract has at least one agreed price.
bool _hasContractPricing(Map<String, dynamic> r) {
  final p = r['pricing'];
  if (p is! Map) return false;
  return p['clearanceFeePerContainer'] != null || p['portToYard'] != null || p['yardToCustomer'] != null
      || (p['routes'] is List && (p['routes'] as List).isNotEmpty);
}

// Customs contracts.
// Our contract with a customer, agent or carrier: read, created and edited, with its attachment uploaded from its row.
final customsContractsCfg = ResourceConfig(
  arTitle: 'عقود التخليص', enTitle: 'Customs Contracts', icon: Icons.assignment_outlined,
  endpoint: '/api/customs-clearance/contracts', listKey: 'contracts',
  updateMethod: 'PUT', liveEvent: 'customs:contract',
  searchFields: const ['title', 'partyName', 'contractNumber', 'scope'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'partyName'), if (_s(r, 'contractNumber').isNotEmpty) '#${_s(r, 'contractNumber')}'].join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'state').isNotEmpty ? _s(r, 'state') : _s(r, 'status')) {
      'active' => ('ساري', T.success),
      'expired' => ('منتهٍ', T.danger),
      'terminated' => ('مفسوخ', T.warn),
      _ => ('مسودّة', T.inkSoft),
    },
    switch (_s(r, 'partyKind')) {
      'agent' => ('وكيل شحن', T.info),
      'carrier' => ('ناقل', T.violet),
      _ => ('عميل', T.navy),
    },
    if ((r['attachments'] is List) && (r['attachments'] as List).isNotEmpty)
      ('${(r['attachments'] as List).length} مرفق', T.cyan),
    if (_s(r, 'partyKind') == 'customer' && _hasContractPricing(r)) (tr('بأسعار', 'Priced'), T.success),
  ],
  // Customer prices (clearance fees and transport destinations) are a nested array the generic form does not write, so they have their own sheet, for the customer contract only.
  rowActions: (r) => [
    // Contract attachment (the signed file itself) is uploaded, opened and deleted from its row, like the website.
    ResourceAction(
      icon: Icons.attach_file_rounded, ar: 'مرفقات العقد', en: 'Contract files', color: T.cyan,
      run: (c, row) => manageCustomsContractFiles(c, row),
    ),
    if (_s(r, 'partyKind') == 'customer')
      const ResourceAction(
        icon: Icons.price_change_outlined, ar: 'أسعار التعاقد مع العميل', en: 'Customer contract prices', color: T.navy,
        run: editCustomsContractPricing,
      ),
  ],
  fields: const [
    FieldSpec('title', 'اسم العقد', 'Contract name', required: true),
    FieldSpec('party', 'الطرف', 'Party', required: true, type: FieldType.lookup,
        lookupEndpoint: '/api/customs-clearance/parties', lookupListKey: 'parties',
        lookupQuery: 'kind=all',
        lookupLabel: _partyLabel),
    FieldSpec('contractNumber', 'رقم العقد', 'Contract no.'),
    FieldSpec('startDate', 'يبدأ', 'Starts', type: FieldType.date),
    FieldSpec('endDate', 'ينتهي', 'Ends', type: FieldType.date),
    FieldSpec('value', 'القيمة', 'Value', type: FieldType.number),
    FieldSpec('valueBasis', 'أساس القيمة', 'Value basis', type: FieldType.select, options: [
      ('', '—', '—'), ('total', 'إجمالي العقد', 'Total'), ('per_container', 'للحاوية', 'Per container'),
      ('per_month', 'شهريًّا', 'Per month'), ('per_shipment', 'للشحنة', 'Per shipment'),
    ]),
    FieldSpec('paymentTermDays', 'مهلة السداد (يوم)', 'Payment terms (days)', type: FieldType.number),
    FieldSpec('autoRenew', 'تجديد تلقائي', 'Auto-renews', type: FieldType.checkbox),
    FieldSpec('status', 'الحالة', 'State', type: FieldType.select, options: [
      ('active', 'ساري', 'Active'), ('draft', 'مسودّة', 'Draft'),
      ('expired', 'منتهٍ', 'Expired'), ('terminated', 'مفسوخ', 'Terminated'),
    ]),
    FieldSpec('scope', 'ما يغطّيه العقد', 'Scope'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// Light transport: the whole section register (reps, supervisors, administrators, technicians), unlike the B2C reps above which read B2CRep.
// The person lives in HR and the vehicle in the vehicles register; nothing is copied (see backend/models/LightTransport). Displayed status is derived by the server in workStatusShown.
// Adding creates an HR file, limited to the sector manager, deputy, system admin and finance (canAdd, matching authorize.strict in routes/lightTransport), with its own form that carries documents.
// User rentals match the web page /system/b2c/user-rentals: the server writes the date, a rental is ended not erased.
ResourceConfig ltUserRentalsCfg({required bool canWrite, required bool canDelete}) => ResourceConfig(
  arTitle: 'تأجير اليوزرات', enTitle: 'User Rentals',
  icon: Icons.key_outlined,
  endpoint: '/api/light-transport/user-rentals', listKey: 'items',
  liveEvent: 'lt:*',
  canCreate: canWrite, canEdit: canWrite, canDelete: canDelete,
  searchFields: const ['renterName', 'idNumber', 'userAccount', 'projectAr'],
  filterField: 'projectAr',
  sortFields: const [('startDate', 'تاريخ التأجير', 'Rented on')],
  titleOf: (r) => _s(r, 'renterName'),
  subtitleOf: (r) => [
    _s(r, 'projectAr'),
    // The user's row is in light transport staff: the link to the dashboard cards (like the website).
    if (r['rep'] is Map) '${tr('اليوزر', 'User')}: ${[(r['rep'] as Map)['name'], (r['rep'] as Map)['vehiclePlate']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ')}',
    _s(r, 'renterType') == 'company' ? tr('شركة', 'Company') : tr('شخص', 'Person'),
    _s(r, 'idNumber'),
    _s(r, 'startDate').split('-').reversed.join('/'),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    _s(r, 'status') == 'active' ? (tr('مؤجَّر', 'Active'), T.success) : (tr('منتهٍ', 'Ended'), T.inkFaint),
    if (r['rep'] == null) (tr('غير مربوط بيوزر', 'Not linked'), T.warn),
  ],
  fields: [
    // The user is chosen from light transport staff so the rental links to the dashboard cards: his project follows him, and his contract type is users while rented (backend utils/ltRental).
    FieldSpec('ltEmployee', 'اليوزر (من موظفي النقل الخفيف)', 'User (light-transport staff)', type: FieldType.lookup,
        lookupEndpoint: '/api/light-transport/people?only=lt', lookupListKey: 'people',
        lookupLabel: (r) => [_s(r, 'name'), _s(r, 'idNumber'), _s(r, 'projectAr')].where((x) => x.isNotEmpty).join(' · '),
        lookupValue: (r) => _s(r, 'ltId')),
    // With a linked user, his project is taken from his row (the server writes it), so it is not asked for here.
    FieldSpec('projectAr', 'المشروع', 'Project', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_project&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    const FieldSpec('renterType', 'مؤجَّر لـ', 'Rented to', type: FieldType.select, required: true, options: [
      ('person', 'شخص', 'Person'),
      ('company', 'شركة', 'Company'),
    ]),
    const FieldSpec('renterName', 'اسم الشركة أو الشخص', 'Company or person name', required: true),
    const FieldSpec('idNumber', 'رقم الإقامة', 'Iqama number', required: true),
    const FieldSpec('phone', 'الجوال', 'Phone'),
    const FieldSpec('userAccount', 'اليوزر (اسم الحساب أو رقمه)', 'User account'),
    const FieldSpec('notes', 'ملاحظات', 'Notes'),
  ],
  rowActions: (r) => [
    if (canWrite && _s(r, 'status') == 'active')
      ResourceAction(
        icon: Icons.block_outlined, ar: 'إنهاء التأجير', en: 'End rental', color: T.warn,
        confirmAr: 'يُسجَّل منتهيًا اليوم ويخرج من أرقام اللوحة، ويبقى في السجلّ.',
        confirmEn: 'It is recorded as ended today, leaves the dashboard counts and stays in the register.',
        request: (r) => ('POST', '/api/light-transport/user-rentals/${_s(r, '_id')}/end', <String, dynamic>{}),
      ),
  ],
);

/// listQuery opens the register filtered: the total reps numbers on the section dashboard open their owners (staffKind/project/contractKind/inService), like the website link.
ResourceConfig lightTransportCfg({required bool canAdd, bool canTransfer = false, String listQuery = '', String? arTitle, String? enTitle}) => ResourceConfig(
  canCreate: canAdd,
  // Move project from the list itself: only for whoever holds it (like the website).
  rowActions: canTransfer ? (r) => [const ResourceAction(icon: Icons.swap_horiz, ar: 'نقل المشروع', en: 'Transfer project', color: T.orange, run: transferLtProject)] : null,
  listQuery: listQuery,
  onCreate: showLtAddEmployee,
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(
      builder: (_) => LightTransportProfileScreen(id: (r['_id'] ?? '').toString()))),
  arTitle: arTitle ?? 'موظفون النقل الخفيف', enTitle: enTitle ?? 'Light-transport Employees',
  icon: Icons.two_wheeler_outlined,
  endpoint: '/api/light-transport/employees', listKey: 'employees',
  liveEvent: 'lt:*',
  // Server search, which also reaches the vehicles register: the serial number and authorization number are not on the employee row, so a local search says no results while we have the vehicle.
  serverSearch: true,
  searchFields: const ['name', 'idNumber', 'vehiclePlate', 'supervisorName', 'projectAr'],
  // Top-of-list chips: project is the most common filter in this section.
  filterField: 'projectAr',
  sortFields: const [('name', 'الاسم', 'Name'), ('hireDate', 'تاريخ التعيين', 'Hire date')],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [
    _s(r, 'idNumber'), _s(r, 'jobTitleAr'), _s(r, 'projectAr'), _s(r, 'cityAr'),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) {
    final st = _s(r, 'workStatusShown');
    final kind = _s(r, 'staffKind');
    return [
      if (_s(r, 'vehiclePlate').isNotEmpty) (_s(r, 'vehiclePlate'), T.navy),
      if (kind.isNotEmpty) (kind == 'rep' ? 'مندوب' : 'إداري', kind == 'rep' ? T.orange : T.navy),
      if (st.isNotEmpty)
        (st, st == 'إنهاء خدمة' || st == 'حادث' ? T.danger : st == 'موقوف' || st == 'متوقف' ? T.warn : st == 'إجازة' ? T.navy : T.success),
      // No HR file: the section owns its register, twelve freelancers.
      if (r['hrLinked'] == false) ('بلا ملفّ HR', T.warn),
      // Operating card and inspection: shown only when they are news.
      // The badge says what stops the man in the morning. Valid is not news, so it does not crowd other badges on a phone screen.
      if (_docBad(r['operatingCard'])) ('كارت التشغيل ${_docWord(r['operatingCard'])}', _docColor(r['operatingCard'])),
      if (_docBad(r['inspection'])) ('الفحص ${_docWord(r['inspection'])}', _docColor(r['inspection'])),
      ...personDocChips(r),
    ];
  },
  fields: [
    const FieldSpec('idNumber', 'رقم الهوية', 'ID number', required: true),
    const FieldSpec('name', 'الاسم', 'Name', required: true),
    // Fixed values are managed lists from section settings, stored by their Arabic text: a free field writes one value a thousand ways and reports then show several projects.
    FieldSpec('projectAr', 'المشروع', 'Project', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_project&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('cityAr', 'الفرع', 'Branch', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_city&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('jobTitleAr', 'الوظيفة', 'Job title', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_job_title&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('contractTypeAr', 'نوع التعاقد', 'Contract type', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_contract_type&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('registerNumber', 'رقم السجل', 'Commercial register', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_register&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    FieldSpec('vehicleTypeAr', 'نوع المركبة', 'Vehicle type', type: FieldType.lookup,
        lookupEndpoint: '/api/lookups?type=lt_vehicle_type&active=true',
        lookupListKey: 'items', lookupQuery: 'limit=200',
        lookupLabel: (r) => _s(r, 'nameAr'), lookupValue: (r) => _s(r, 'nameAr')),
    // Work status today: working, leave, suspended, accident.
    // Written from here (opStatus) and seen in his HR file and on his vehicle. Suspended is an operational stop by the section alone; HR leave is read and not written here, and end of service is HR alone. The displayed value is derived on the server (workStatusShown).
    const FieldSpec('opStatus', 'حالة العمل اليوم', 'Work status today', type: FieldType.select, options: [
      ('', 'يعمل', 'Working'),
      ('leave', 'إجازة', 'On leave'),
      ('suspended', 'موقوف', 'Suspended'),
      ('accident', 'حادث', 'Accident'),
    ]),
    const FieldSpec('opStatusNote', 'سبب الحالة', 'Status reason'),
    // The supervisor is a system account, not a typed name.
    // It was a free field, so one man was written with two different names in two places and the register could not tell the name had an account to check his men. It is now a choice among the section's supervision accounts, and whoever is chosen sees this man in the start-of-shift duty check. See backend/utils/b2cSupervisors.
    FieldSpec('supervisorUser', 'المشرف', 'Supervisor', type: FieldType.lookup,
        lookupEndpoint: '/api/light-transport/supervisors', lookupListKey: 'supervisors',
        lookupLabel: (r) => '${_s(r, 'name')} — ${_s(r, 'roleAr')}',
        lookupValue: (r) => _s(r, '_id')),
    const FieldSpec('nationalityAr', 'الجنسية', 'Nationality'),
    const FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    const FieldSpec('hireDate', 'تاريخ التعيين', 'Hire date', type: FieldType.date),
    const FieldSpec('notesAr', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
  // No employee delete: the record is deactivated and its trail kept, as in the HR rule.
  canDelete: false,
);

// Operating orders.
// "This employee works on this vehicle, in this project and branch." Read here and created on the web: the form picks an employee, vehicle and housing under rules (one vehicle per rider, a room's capacity not exceeded) that do not reduce to a phone sheet.
final lightTransportOrdersCfg = ResourceConfig(
  arTitle: 'أوامر التشغيل', enTitle: 'Operating Orders', icon: Icons.assignment_ind_outlined,
  endpoint: '/api/light-transport/orders', listKey: 'orders', liveEvent: 'lt:*',
  serverSearch: true,
  searchFields: const ['orderNumber', 'employeeName', 'employeeIdNumber', 'vehiclePlate'],
  sortFields: const [('startDate', 'تاريخ البداية', 'Start date')],
  titleOf: (r) => _s(r, 'employeeName'),
  subtitleOf: (r) => [
    _s(r, 'orderNumber'), _s(r, 'vehiclePlate'), _s(r, 'projectAr'), _s(r, 'cityAr'),
  ].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    (r['status'] == 'active' ? 'سارٍ' : r['status'] == 'hold' ? 'معلَّق' : 'مُغلَق', r['status'] == 'active' ? T.success : r['status'] == 'hold' ? T.warn : T.inkFaint),
    // A paper in a name other than the rider's is shown.
    // Twenty-four vehicles are authorized to one person with another as the actual driver. That is not an error to fix without asking, but it is only discovered at a violation unless it is shown.
    if (r['authorizationMismatch'] == true)
      ('التفويض باسم ${_s(r, 'authorizedNowName')}', T.warn),
  ],
  fields: const [],
  canCreate: false, canEdit: false, canDelete: false,
);


/// Link-to-employee dialog for a fleet driver: server suggestions (heavy transport and fleet first, closest by name and ID), search across all files, and unlinking.
Future<bool> openFleetDriverLink(BuildContext ctx, Map<String, dynamic> row) async {
  final id = '${row['_id']}';
  final picked = await showModalBottomSheet<Map<String, dynamic>>(
    context: ctx,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => _FleetDriverLinkSheet(driverId: id, driverName: _s(row, 'name'), linked: row['hrLinked'] == true),
  );
  if (picked == null) return false;
  try {
    await Api.instance.patch('/api/fleet/drivers/$id/employee', {'employee': picked['_id']});
    if (ctx.mounted) {
      ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(picked['_id'] == null ? tr('فُكّ الربط', 'Unlinked') : tr('رُبط بـ ${picked['name']}', 'Linked to ${picked['name']}'))));
    }
    return true;
  } catch (e) {
    if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    return false;
  }
}

class _FleetDriverLinkSheet extends StatefulWidget {
  final String driverId;
  final String driverName;
  final bool linked;
  const _FleetDriverLinkSheet({required this.driverId, required this.driverName, required this.linked});
  @override
  State<_FleetDriverLinkSheet> createState() => _FleetDriverLinkSheetState();
}

class _FleetDriverLinkSheetState extends State<_FleetDriverLinkSheet> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String _q = '';
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final mine = ++_seq;
    setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/fleet/drivers/hr-candidates?driver=${widget.driverId}${_q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(_q)}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from((d as Map)['candidates'] ?? const []); _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.8,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(tr('ربط «${widget.driverName}» بموظف', 'Link "${widget.driverName}" to an employee'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), isDense: true, hintText: tr('ابحث بالاسم أو رقم الهوية', 'Search name or ID'),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
              onSubmitted: (v) { _q = v.trim(); _load(); },
            ),
          ),
          if (widget.linked)
            TextButton.icon(onPressed: () => Navigator.pop(context, <String, dynamic>{'_id': null}),
                icon: const Icon(Icons.link_off, color: T.danger), label: Text(tr('فكّ الربط', 'Unlink'), style: const TextStyle(color: T.danger))),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.separated(
                    itemCount: _rows.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final e = _rows[i];
                      final taken = e['linkedTo'] is Map;
                      return ListTile(
                        enabled: !taken,
                        title: Text('${e['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([_s(e, 'idNumber'), _s(e, 'department'), _s(e, 'jobTitle'),
                          if (taken) tr('مربوط بـ ${(e['linkedTo'] as Map)['name']}', 'linked to ${(e['linkedTo'] as Map)['name']}')]
                            .where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12)),
                        trailing: const Icon(Icons.chevron_left),
                        onTap: taken ? null : () => Navigator.pop(context, e),
                      );
                    },
                  ),
          ),
        ]),
      ),
    );
  }
}
