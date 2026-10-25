import '../ui/export_sheet.dart';
import 'vehicle_registry_form.dart' show hijriPlain;

/// ── أعمدةُ سجل المركبات — توأمُ lib/vehicleColumns.ts في الموقع ─────────────
///
/// الترتيبُ والأسماءُ كما في الموقع حرفًا بحرف، فالملفّ المصدَّر من التطبيق هو
/// نفسُه المصدَّر من الموقع. و`base` هي «الأعمدة الأساسيّة» التي تُعرض أوّلًا.

class VCol {
  final String key, ar, en;
  final dynamic Function(Map v) get;
  final bool base, date;
  const VCol(this.key, this.ar, this.en, this.get, {this.base = false, this.date = false});
}

Map _o(Map v, String k) => v[k] is Map ? v[k] as Map : const {};
String _d(dynamic x) => x == null || x.toString().isEmpty ? '' : x.toString().split('T').first;
dynamic _days(dynamic x) {
  final t = x == null ? null : DateTime.tryParse(x.toString());
  if (t == null) return '';
  return (t.difference(DateTime.now()).inSeconds / 86400).ceil();
}

final List<VCol> registryColumns = [
  VCol('sectorAr', 'القطاع', 'Sector', (v) => v['sectorAr'], base: true),
  VCol('departmentAr', 'القسم', 'Department', (v) => v['departmentAr'], base: true),
  VCol('cityAr', 'المدينة', 'City', (v) => v['cityAr'], base: true),
  VCol('ltCityAr', 'مدينة التشغيل (نقل خفيف)', 'Operating city (light)', (v) => v['ltCityAr'] ?? ''),
  VCol('ltProjectAr', 'المشروع (نقل خفيف)', 'Project (light)', (v) => v['ltProjectAr'] ?? ''),
  VCol('ltRiderName', 'الراكب (نقل خفيف)', 'Rider (light)', (v) => v['ltRiderName'] ?? ''),
  VCol('ownerNameAr', 'المالك', 'Owner', (v) => v['ownerNameAr'], base: true),
  VCol('tamStatusAr', 'حالة تم', 'Tam status', (v) => v['tamStatusAr']),
  VCol('commercialRegistration', 'السجل', 'CR', (v) => v['commercialRegistration']),
  VCol('plateNumber', 'رقم اللوحة', 'Plate', (v) => v['plateNumber'], base: true),
  VCol('chassisNumber', 'رقم الهيكل', 'Chassis', (v) => v['chassisNumber'], base: true),
  VCol('serialNumber', 'الرقم التسلسلي', 'Serial', (v) => v['serialNumber'], base: true),
  VCol('registrationTypeAr', 'نوع التسجيل', 'Registration type', (v) => v['registrationTypeAr'], base: true),
  VCol('ownerCompanyAr', 'الشركة المالكة', 'Owning company', (v) => v['ownerCompanyAr'], base: true),
  VCol('brandAr', 'ماركة المركبة', 'Brand', (v) => v['brandAr'], base: true),
  VCol('modelAr', 'طراز المركبة', 'Model', (v) => v['modelAr'], base: true),
  VCol('modelYear', 'الموديل', 'Year', (v) => v['modelYear'], base: true),
  VCol('colorAr', 'اللون', 'Colour', (v) => v['colorAr'], base: true),
  VCol('authName', 'اسم المفوض', 'Authorised person', (v) => _o(v, 'authorizedPerson')['name'], base: true),
  VCol('authIqama', 'رقم الاقامة', 'Iqama number', (v) => _o(v, 'authorizedPerson')['iqamaNumber']),
  VCol('authNumber', 'رقم التفويض', 'Authorisation no.', (v) => _o(v, 'authorizedPerson')['authorizationNumber']),
  VCol('authPhone', 'جوال المفوض', 'Authorised phone', (v) => _o(v, 'authorizedPerson')['phone'] ?? ''),
  VCol('actualDriverName', 'القائد الفعلي', 'Actual driver', (v) => _o(v, 'actualDriver')['name'] ?? ''),
  VCol('actualDriverId', 'هوية القائد الفعلي', 'Actual driver ID', (v) => _o(v, 'actualDriver')['idNumber'] ?? ''),
  VCol('authStart', 'تاريخ بداية التفويض', 'Auth. start', (v) => _d(_o(v, 'authorizedPerson')['startDate']), date: true),
  VCol('authEnd', 'تاريخ نهاية التفويض', 'Auth. end', (v) => _d(_o(v, 'authorizedPerson')['expiryDate']), date: true),
  VCol('authDays', 'الايام المتبقية علي نهاية التفويض', 'Days to auth. end', (v) => _days(_o(v, 'authorizedPerson')['expiryDate'])),
  VCol('insPolicy', 'رقم وثيقة التأمين', 'Policy no.', (v) => _o(v, 'insurance')['policyNumber']),
  VCol('insExpiry', 'تاريخ انتهاء التأمين', 'Insurance expiry', (v) => _d(_o(v, 'insurance')['expiryDate']), base: true, date: true),
  VCol('insDays', 'الايام المتبقية علي انتهاء التأمين', 'Days to insurance expiry', (v) => _days(_o(v, 'insurance')['expiryDate'])),
  VCol('insCompany', 'شركة التأمين', 'Insurer', (v) => _o(v, 'insurance')['companyAr']),
  VCol('insCoverage', 'نوع التأمين', 'Coverage type', (v) => _o(v, 'insurance')['coverageTypeAr']),
  VCol('insPremium', 'قيمة التأمين', 'Premium', (v) => _o(v, 'insurance')['premiumSar'] ?? (_o(v, 'insurance')['premiumStatusAr'] ?? '')),
  VCol('fuelCardNumber', 'شريحة بترو اب', 'Petro App chip', (v) => _o(v, 'fuelCard')['cardNumber'], base: true),
  VCol('fuelPlateOnInvoice', 'رقم اللوحة في فاتورة بترو اب', 'Plate on Petro App invoice', (v) => _o(v, 'fuelCard')['plateOnInvoiceAr']),
  VCol('fuelStatus', 'حالة الشريحة', 'Chip status', (v) => _o(v, 'fuelCard')['statusAr']),
  VCol('fuelConsumptionType', 'نوع الاستهلاك', 'Consumption type', (v) => _o(v, 'fuelCard')['consumptionTypeAr']),
  VCol('fuelLimit', 'حد الاستهلاك', 'Consumption limit',
      (v) => _o(v, 'fuelCard')['limitStatus'] == 'open' ? 'مفتوح' : (_o(v, 'fuelCard')['limitSar'] ?? '')),
  VCol('gpsDevice', 'جهاز GPS', 'GPS device', (v) => _o(v, 'gps')['deviceModel']),
  VCol('gpsDeviceStatus', 'حالة جهاز GPS', 'GPS device status', (v) => _o(v, 'gps')['deviceStatusAr']),
  VCol('gpsProvider', 'شركة ال GPS', 'GPS provider', (v) => _o(v, 'gps')['provider']),
  VCol('gpsSerial', 'سريال GPS', 'GPS serial', (v) => _o(v, 'gps')['serialImei']),
  VCol('gpsExpiry', 'تاريخ انتهاء ال GPS', 'GPS expiry', (v) => _d(_o(v, 'gps')['expiryDate']), date: true),
  VCol('gpsDays', 'الايام المتبقية علي انتهاء ال GPS', 'Days to GPS expiry', (v) => _days(_o(v, 'gps')['expiryDate'])),
  VCol('operatingCardNumber', 'بطاقة التشغيل', 'Operating card', (v) => _o(v, 'operatingCard')['cardNumber']),
  VCol('operatingCardExpiry', 'تاريخ انتهاء بطاقة التشغيل', 'Operating card expiry', (v) => _d(_o(v, 'operatingCard')['expiryDate']), date: true),
  VCol('operatingCardDays', 'الايام المتبقية علي انتهاء بطاقة التشغيل', 'Days to operating card expiry', (v) => _days(_o(v, 'operatingCard')['expiryDate'])),
  VCol('licenseHijri', 'تاريخ انتهاء رخصة السير هجري', 'Licence expiry (Hijri)',
      (v) => (_o(v, 'vehicleLicense')['expiryDateHijri'] ?? '').toString().isNotEmpty ? _o(v, 'vehicleLicense')['expiryDateHijri'] : hijriPlain(_d(_o(v, 'vehicleLicense')['expiryDate']))),
  VCol('licenseExpiry', 'تاريخ انتهاء رخصة السير ميلادي', 'Licence expiry', (v) => _d(_o(v, 'vehicleLicense')['expiryDate'])),
  VCol('licenseDays', 'الايام المتبقية علي انتهاء رخصة السير', 'Days to licence expiry', (v) => _days(_o(v, 'vehicleLicense')['expiryDate'])),
  VCol('inspectionHijri', 'تاريخ انتهاء الفحص هجري', 'Inspection expiry (Hijri)',
      (v) => (_o(v, 'inspection')['expiryDateHijri'] ?? '').toString().isNotEmpty ? _o(v, 'inspection')['expiryDateHijri'] : hijriPlain(_d(_o(v, 'inspection')['expiryDate']))),
  VCol('inspectionExpiry', 'تاريخ انتهاء الفحص ميلادي', 'Inspection expiry', (v) => _d(_o(v, 'inspection')['expiryDate'])),
  VCol('inspectionDays', 'الايام المتبقية علي انتهاء الفحص', 'Days to inspection expiry', (v) => _days(_o(v, 'inspection')['expiryDate'])),
  VCol('notesAr', 'الملاحظات', 'Notes', (v) => v['notesAr']),
  VCol('serviceStatusAr', 'حالة التشغيل', 'Service status', (v) => v['serviceStatusAr']),
  VCol('possessionStatusAr', 'حالة الحيازة', 'Possession', (v) => v['possessionStatusAr']),
  VCol('authJobTitle', 'وظيفة المفوض', 'Authorised job title', (v) => _o(v, 'authorizedPerson')['jobTitleAr']),
  VCol('gpsDeviceId', 'رقم جهاز GPS', 'GPS device id', (v) => _o(v, 'gps')['deviceId']),
  VCol('gpsSim', 'رقم شريحة GPS', 'GPS SIM', (v) => _o(v, 'gps')['simNumber']),
  VCol('inspectionStatus', 'حالة الفحص', 'Inspection status', (v) => _o(v, 'inspection')['statusAr']),
  VCol('premiumStatus', 'حالة القسط', 'Premium status', (v) => _o(v, 'insurance')['premiumStatusAr']),
];

final List<String> baseColumnKeys = registryColumns.where((c) => c.base).map((c) => c.key).toList();

/// أعمدةُ التصدير — ويُضاف بجانب كلِّ تاريخٍ ميلاديٍّ هجريُّه (withHijri في الموقع)،
/// إلّا حيث يجاوره عمودٌ هجريٌّ مكتوب.
List<ExportCol> registryExportCols(List<VCol> cols) {
  final out = <ExportCol>[];
  for (var i = 0; i < cols.length; i++) {
    final c = cols[i];
    out.add(ExportCol(c.ar, c.en, (r) => c.get(r) ?? ''));
    if (!c.date) continue;
    final near = [if (i > 0) cols[i - 1], if (i + 1 < cols.length) cols[i + 1]].any((n) => n.ar.contains('هجري'));
    if (near) continue;
    out.add(ExportCol('${c.ar} (هجري)', '${c.en} (Hijri)', (r) => hijriPlain((c.get(r) ?? '').toString())));
  }
  return out;
}
