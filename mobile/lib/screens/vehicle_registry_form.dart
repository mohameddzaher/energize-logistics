import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../ui/api_picker.dart';
import '../ui/app_scaffold.dart';
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_documents.dart' show ReqToggle;

/// ── نموذجُ مركبةٍ في السجلّ — توأمُ VehicleForm في صفحة سجل المركبات ─────────
///
/// نفسُ البطاقات ونفسُ الحقول ونفسُ القوائم المُدارة (`/api/lookups`). والتعديلُ
/// يرسل **الفرقَ وحدَه** كما يفعل الموقع (`patchOf`): الخادمُ يدمج الكائنَ
/// الفرعيّ ولا يستبدله، فإرسالُ النموذج كاملًا كان يكتب فوق ما عدّله غيرُك.

class _F {
  final String path, ar, en;
  final String kind; // text · number · date · flag · hijri
  final String? lookup;
  final bool mono;
  const _F(this.path, this.ar, this.en, {this.kind = 'text', this.lookup, this.mono = false});
}

const _vehicleFields = [
  _F('plateNumber', 'رقم اللوحة *', 'Plate *', mono: true),
  _F('chassisNumber', 'رقم الهيكل', 'Chassis', mono: true),
  _F('serialNumber', 'الرقم التسلسلي', 'Serial', mono: true),
  _F('sectorAr', 'القطاع', 'Sector', lookup: 'vehicle_sector'),
  _F('registrationTypeAr', 'نوع التسجيل', 'Registration type', lookup: 'vehicle_registration_type'),
  _F('ownerCompanyAr', 'الشركة المالكة', 'Owning company', lookup: 'vehicle_owner_company'),
  _F('brandAr', 'الماركة', 'Brand', lookup: 'vehicle_brand'),
  _F('modelAr', 'الطراز', 'Model'),
  _F('modelYear', 'سنة الصنع', 'Year', kind: 'number'),
  _F('colorAr', 'اللون', 'Colour', lookup: 'vehicle_color'),
  _F('serviceStatusAr', 'حالة التشغيل', 'Service status', lookup: 'vehicle_service_status'),
  _F('possessionStatusAr', 'حالة الحيازة', 'Possession', lookup: 'vehicle_possession_status'),
  _F('departmentAr', 'الإدارة', 'Department', lookup: 'vehicle_department'),
  _F('cityAr', 'المدينة', 'City', lookup: 'vehicle_city'),
];
const _ownerFields = [
  _F('ownerNameAr', 'المالك', 'Owner'),
  _F('commercialRegistration', 'السجل التجاري', 'Commercial register', mono: true),
  _F('tamStatusAr', 'حالة تم', 'Tam status', lookup: 'vehicle_possession_status'),
];
const _insuranceFields = [
  _F('insurance.companyAr', 'شركة التأمين', 'Insurer', lookup: 'vehicle_insurance_company'),
  _F('insurance.coverageTypeAr', 'نوع التغطية', 'Coverage type', lookup: 'vehicle_coverage_type'),
  _F('insurance.policyNumber', 'رقم الوثيقة', 'Policy no.', mono: true),
  _F('insurance.expiryDate', 'تاريخ انتهاء التأمين', 'Insurance expiry', kind: 'date'),
  _F('insurance.premiumSar', 'قسط التأمين', 'Premium', kind: 'number'),
  _F('insurance.premiumStatusAr', 'حالة القسط', 'Premium status', lookup: 'vehicle_premium_status'),
];
const _docFields = [
  _F('operatingCard.cardNumber', 'رقم بطاقة التشغيل', 'Operating card no.', mono: true),
  _F('operatingCard.expiryDate', 'انتهاء بطاقة التشغيل', 'Operating card expiry', kind: 'date'),
  _F('vehicleLicense.expiryDate', 'انتهاء رخصة السير', 'Licence expiry', kind: 'date'),
  _F('inspection.statusAr', 'حالة الفحص', 'Inspection status', lookup: 'vehicle_inspection_status'),
  _F('inspection.expiryDate', 'انتهاء الفحص', 'Inspection expiry', kind: 'date'),
  _F('vehicleLicense.expiryDateHijri', 'انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', kind: 'hijri', mono: true),
  _F('inspection.expiryDateHijri', 'انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', kind: 'hijri', mono: true),
];
const _fuelFields = [
  _F('fuelCard.provider', 'مزوّد شريحة الوقود', 'Fuel provider', lookup: 'vehicle_fuel_provider'),
  _F('fuelCard.cardNumber', 'رقم شريحة الوقود', 'Fuel card no.', mono: true),
  _F('fuelCard.statusAr', 'حالة الشريحة', 'Card status', lookup: 'vehicle_fuel_card_status'),
  _F('fuelCard.consumptionTypeAr', 'نوع الاستهلاك', 'Consumption type', lookup: 'vehicle_consumption_type'),
  _F('fuelCard.plateOnInvoiceAr', 'رقم اللوحة في فاتورة بترو اب', 'Plate on Petro App invoice'),
  _F('fuelCard.limitSar', 'حد الاستهلاك (ر.س)', 'Consumption limit (SAR)', kind: 'number'),
  _F('fuelCard.limitStatus', 'مفتوح — بلا سقف صرف', 'Open — no spending ceiling', kind: 'flag'),
];
const _gpsFields = [
  _F('gps.deviceId', 'رقم جهاز GPS', 'GPS device id', mono: true),
  _F('gps.simNumber', 'رقم الشريحة (SIM)', 'SIM number', mono: true),
  _F('gps.provider', 'شركة الـGPS', 'GPS provider', lookup: 'vehicle_gps_provider'),
  _F('gps.deviceModel', 'جهاز GPS', 'GPS device', lookup: 'vehicle_gps_device'),
  _F('gps.serialImei', 'سريال GPS', 'GPS serial', mono: true),
  _F('gps.deviceStatusAr', 'حالة جهاز GPS', 'GPS device status', lookup: 'vehicle_gps_device_status'),
  _F('gps.expiryDate', 'انتهاء اشتراك GPS', 'GPS expiry', kind: 'date'),
];
const _authFields = [
  _F('authorizedPerson.jobTitleAr', 'الوظيفة', 'Job title', lookup: 'vehicle_job_title'),
  _F('authorizedPerson.authorizationNumber', 'رقم التفويض', 'Authorisation no.', mono: true),
  _F('authorizedPerson.startDate', 'بداية التفويض', 'Auth. start', kind: 'date'),
  _F('authorizedPerson.expiryDate', 'نهاية التفويض', 'Auth. expiry', kind: 'date'),
];
// تُكتب من منتقي الموظّفين لا باليد.
const _authPersonPaths = ['authorizedPerson.name', 'authorizedPerson.iqamaNumber', 'authorizedPerson.phone'];
const _reqPaths = ['insurance.statusCode', 'operatingCard.statusCode', 'vehicleLicense.statusCode', 'inspection.statusCode',
  'fuelCard.statusCode', 'gps.statusCode', 'authorizedPerson.statusCode'];

List<_F> get _allFields => [..._vehicleFields, ..._ownerFields, ..._insuranceFields, ..._docFields, ..._fuelFields, ..._gpsFields, ..._authFields,
  const _F('notesAr', 'ملاحظات', 'Notes')];

dynamic _read(Map? v, String path) {
  dynamic cur = v;
  for (final p in path.split('.')) {
    if (cur is! Map) return null;
    cur = cur[p];
  }
  return cur;
}

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _p2(int n) => n.toString().padLeft(2, '0');

/// الهجريُّ كما يكتبه الموقع: «DD/MM/YYYY».
String hijriPlain(String greg) {
  final h = hijriParts(greg);
  return h == null ? '' : '${_p2(h.$3)}/${_p2(h.$2)}/${h.$1}';
}

/// «04/04/1448» أو «1448-04-04» أو بالأرقام العربيّة ← ميلاديٌّ YYYY-MM-DD، أو فارغ.
/// يُبحث حول تقديرٍ تقريبيّ حتى يطابق الهجريُّ المحسوبُ المكتوب — كـ fromHijri في الموقع.
String fromHijriText(String text) {
  var t = text.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}')
      .replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06f0}')
      .replaceAll(RegExp('هـ|AH|H', caseSensitive: false), '').trim();
  final n = t.split(RegExp(r'[^\d]+')).where((x) => x.isNotEmpty).map(int.parse).toList();
  if (n.length < 3) return '';
  final y = n[0] > 1000 ? n[0] : n[2], d = n[0] > 1000 ? n[2] : n[0], m = n[1];
  if (m < 1 || m > 12 || d < 1 || d > 30) return '';
  final approx = DateTime.utc(622, 7, 16).add(Duration(days: ((y - 1) * 354.367 + (m - 1) * 29.53 + (d - 1)).round()));
  for (var step = 0; step <= 40; step++) {
    for (final dir in step == 0 ? [0] : [step, -step]) {
      final cand = approx.add(Duration(days: dir));
      final g = _ymd(cand);
      final h = hijriParts(g);
      if (h != null && h.$1 == y && h.$2 == m && h.$3 == d) return g;
    }
  }
  return '';
}

/// يفتح النموذج؛ يعيد true إن حُفظ.
Future<bool> showVehicleRegistryForm(BuildContext context, Map<String, dynamic>? vehicle) async {
  final r = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _VehicleRegistryForm(vehicle: vehicle)));
  return r == true;
}

class _VehicleRegistryForm extends StatefulWidget {
  final Map<String, dynamic>? vehicle;
  const _VehicleRegistryForm({this.vehicle});
  @override
  State<_VehicleRegistryForm> createState() => _VehicleRegistryFormState();
}

class _VehicleRegistryFormState extends State<_VehicleRegistryForm> {
  final _ctrl = <String, TextEditingController>{};
  final _vals = <String, dynamic>{}; // date · flag · statusCode · المفوَّض
  final _orig = <String, dynamic>{};
  bool _saving = false;

  Map<String, dynamic>? get v => widget.vehicle;

  @override
  void initState() {
    super.initState();
    for (final f in _allFields) {
      final raw = _read(v, f.path);
      if (f.kind == 'date') {
        _vals[f.path] = raw == null ? '' : raw.toString().split('T').first;
      } else if (f.kind == 'flag') {
        _vals[f.path] = raw == 'open';
      } else {
        _ctrl[f.path] = TextEditingController(text: raw == null ? '' : raw.toString());
      }
      _orig[f.path] = _current(f);
    }
    for (final p in [..._reqPaths, ..._authPersonPaths]) {
      final raw = _read(v, p);
      _vals[p] = raw == null ? '' : raw.toString();
      _orig[p] = _vals[p];
    }
  }

  @override
  void dispose() {
    for (final c in _ctrl.values) { c.dispose(); }
    super.dispose();
  }

  dynamic _current(_F f) {
    if (f.kind == 'date') { final s = (_vals[f.path] ?? '') as String; return s.isEmpty ? null : s; }
    if (f.kind == 'flag') return _vals[f.path] == true ? 'open' : '';
    final t = _ctrl[f.path]!.text.trim();
    if (f.kind == 'number') return t.isEmpty ? null : num.tryParse(t);
    return t;
  }

  bool _same(dynamic a, dynamic b) {
    String n(dynamic x) => (x == null || x == '') ? '' : x.toString();
    return n(a) == n(b);
  }

  void _write(Map<String, dynamic> out, String path, dynamic value) {
    final parts = path.split('.');
    if (parts.length == 1) { out[path] = value; return; }
    final sub = (out[parts[0]] as Map<String, dynamic>?) ?? <String, dynamic>{};
    sub[parts[1]] = value;
    out[parts[0]] = sub;
  }

  // ── التاريخان يتبعان أحدهما الآخر (كالموقع) ─────────────────────────────
  // الهجريُّ المكتوب يُملي الميلاديَّ متى صار مقروءًا، والميلاديُّ يملأ الهجريَّ
  // الفارغَ وحده — لا يُطمَس هجريٌّ مكتوبٌ باليد.
  void _onHijri(String root, String text) {
    final g = fromHijriText(text);
    setState(() { if (g.isNotEmpty) _vals['$root.expiryDate'] = g; });
  }

  void _onGreg(String path, String date) {
    setState(() => _vals[path] = date);
    for (final root in ['vehicleLicense', 'inspection']) {
      if (path == '$root.expiryDate' && date.isNotEmpty) {
        final h = _ctrl['$root.expiryDateHijri']!;
        if (h.text.trim().isEmpty) h.text = hijriPlain(date);
      }
    }
  }

  Future<void> _save() async {
    final plate = _ctrl['plateNumber']!.text.trim();
    if (plate.isEmpty) { _snack(tr('رقم اللوحة مطلوب', 'Plate required')); return; }
    final out = <String, dynamic>{};
    for (final f in _allFields) {
      final cur = _current(f);
      if (v == null || !_same(_orig[f.path], cur)) _write(out, f.path, cur);
    }
    for (final p in [..._reqPaths, ..._authPersonPaths]) {
      if (v == null || !_same(_orig[p], _vals[p])) _write(out, p, _vals[p]);
    }
    if (v != null && out.isEmpty) { _snack(tr('لا تغييرات للحفظ', 'Nothing changed')); Navigator.pop(context, false); return; }
    setState(() => _saving = true);
    try {
      if (v != null) {
        await Api.instance.put('/api/vehicle-registry/${v!['_id']}', out);
      } else {
        await Api.instance.post('/api/vehicle-registry', out);
      }
      if (!mounted) return;
      _snack(tr('تم الحفظ', 'Saved'));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _saving = false); _snack(e.toString()); }
    }
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Widget _field(_F f) {
    final label = tr(f.ar, f.en);
    Widget w;
    if (f.kind == 'date') {
      final val = (_vals[f.path] ?? '') as String;
      w = InkWell(
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(val) ?? DateTime.now(), firstDate: DateTime(1990), lastDate: DateTime(2100));
          if (d != null) _onGreg(f.path, _ymd(d));
        },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            helperText: val.isEmpty ? null : hijriHint(val, ar: Lang.instance.ar),
            suffixIcon: val.isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() => _vals[f.path] = '')),
          ),
          child: Text(val.isEmpty ? '—' : val),
        ),
      );
    } else if (f.kind == 'flag') {
      w = CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        value: _vals[f.path] == true,
        title: Text(label, style: const TextStyle(fontSize: 13)),
        onChanged: (x) => setState(() => _vals[f.path] = x == true),
      );
    } else if (f.lookup != null) {
      w = LookupField(type: f.lookup!, controller: _ctrl[f.path]!, label: label);
    } else if (f.kind == 'hijri') {
      final root = f.path.split('.').first;
      final t = _ctrl[f.path]!.text.trim();
      final g = t.isEmpty ? '' : fromHijriText(t);
      w = TextField(
        controller: _ctrl[f.path],
        textDirection: TextDirection.ltr,
        onChanged: (x) => _onHijri(root, x),
        decoration: InputDecoration(
          labelText: label, hintText: '1447/07/22',
          helperText: t.isEmpty ? null : (g.isNotEmpty ? tr('الميلادي: $g', 'Gregorian: $g') : tr('تاريخ غير موجود في التقويم — راجعه', 'no such date in the calendar')),
          helperStyle: TextStyle(color: g.isNotEmpty ? T.success : T.warn),
        ),
      );
    } else {
      w = TextField(
        controller: _ctrl[f.path],
        maxLines: f.path == 'notesAr' ? 3 : 1,
        keyboardType: f.kind == 'number' ? TextInputType.number : TextInputType.text,
        textDirection: f.mono ? TextDirection.ltr : null,
        decoration: InputDecoration(labelText: label),
      );
    }
    return Padding(padding: const EdgeInsets.only(bottom: 10), child: w);
  }

  Widget _req(String root, String ar, String en) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: ReqToggle(label: tr(ar, en), code: (_vals['$root.statusCode'] ?? '') as String, onChanged: (x) => setState(() => _vals['$root.statusCode'] = x)),
      );

  Widget _card(String ar, String en, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr(ar, en), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 10),
          ...children,
        ])),
      );

  // المالكُ قد يكون موظّفًا عندنا — يُبحث عنه فيُملأ اسمُه كما في ملفّه.
  Future<void> _findOwner() async {
    final p = await _personSearch(context, tr('ابحث عن المالك (موظف عندنا)', 'Find the owner (our employee)'));
    if (p != null) setState(() => _ctrl['ownerNameAr']!.text = (p['name'] ?? '').toString());
  }

  Future<void> _pickAuthorised() async {
    final p = await pickFromApi(context,
        endpoint: '/api/vehicle-registry/people', listKey: 'people',
        label: (r) => ['${r['name'] ?? ''}', '${r['idNumber'] ?? ''}', '${r['jobTitleAr'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '),
        title: tr('المفوَّض', 'Authorised person'));
    if (p == null) return;
    setState(() {
      _vals['authorizedPerson.name'] = (p['name'] ?? '').toString();
      _vals['authorizedPerson.iqamaNumber'] = (p['idNumber'] ?? '').toString();
      _vals['authorizedPerson.phone'] = (p['phone'] ?? '').toString();
      final jt = _ctrl['authorizedPerson.jobTitleAr']!;
      if (jt.text.trim().isEmpty) jt.text = (p['jobTitleAr'] ?? '').toString();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authName = (_vals['authorizedPerson.name'] ?? '') as String;
    return AppScaffold(
      title: Text(v == null ? tr('إضافة مركبة', 'Add vehicle') : tr('تعديل مركبة', 'Edit vehicle')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        _card('بيانات المركبة', 'Vehicle', [
          ..._vehicleFields.map(_field),
          OutlinedButton.icon(
            icon: const Icon(Icons.person_search_outlined, size: 18),
            label: Text(tr('ابحث عن المالك (موظف عندنا) فيُملأ اسمه', 'Find the owner (our employee)')),
            onPressed: _findOwner,
          ),
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 10),
            child: Text(tr('اختياري — المالك قد يكون جهةً لا شخصًا، ويُكتب يدويًّا كما هو.', 'Optional — the owner may be a company; typing by hand still works.'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ),
          ..._ownerFields.map(_field),
        ]),
        _card('التأمين', 'Insurance', [_req('insurance', 'هل نطلبه؟', 'Do we need it?'), ..._insuranceFields.map(_field)]),
        _card('المستندات', 'Documents', [
          _req('operatingCard', 'بطاقة التشغيل', 'Operating card'),
          _req('vehicleLicense', 'رخصة السير', 'Licence'),
          _req('inspection', 'الفحص الدوري', 'Inspection'),
          ..._docFields.map(_field),
        ]),
        _card('شريحة الوقود — بترو اب', 'Fuel card — Petro App', [_req('fuelCard', 'شريحة الوقود', 'Fuel card'), ..._fuelFields.map(_field)]),
        _card('التتبّع — GPS', 'Tracking — GPS', [_req('gps', 'اشتراك التتبّع', 'Tracking subscription'), ..._gpsFields.map(_field)]),
        _card('التفويض بالقيادة', 'Driving authorisation', [
          _req('authorizedPerson', 'هل نطلبه؟', 'Do we need it?'),
          // المفوَّضُ يُختار من الموظّفين: إقامتُه وجوالُه من ملفّه.
          Row(children: [
            Expanded(child: OutlinedButton.icon(
              icon: const Icon(Icons.person_search_outlined, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('اسم المفوَّض', 'Authorised person')}: ${authName.isEmpty ? tr('اختر من الموظّفين', 'Pick an employee') : authName}', overflow: TextOverflow.ellipsis),
              onPressed: _pickAuthorised,
            )),
            if (authName.isNotEmpty)
              IconButton(tooltip: tr('بلا تفويض', 'No authorisation'), icon: const Icon(Icons.close),
                  onPressed: () => setState(() { for (final p in _authPersonPaths) { _vals[p] = ''; } })),
          ]),
          const SizedBox(height: 10),
          InputDecorator(decoration: InputDecoration(labelText: tr('رقم الإقامة', 'Iqama number'), filled: true, fillColor: const Color(0xFFF8FAFC)),
              child: Text(((_vals['authorizedPerson.iqamaNumber'] ?? '') as String).isEmpty ? '—' : _vals['authorizedPerson.iqamaNumber'] as String, textDirection: TextDirection.ltr)),
          const SizedBox(height: 10),
          ..._authFields.map(_field),
        ]),
        _card('ملاحظات', 'Notes', [_field(const _F('notesAr', 'ملاحظات', 'Notes'))]),
        FilledButton.icon(
          icon: const Icon(Icons.save_outlined),
          label: Text(_saving ? tr('يُحفظ…', 'Saving…') : tr('حفظ', 'Save')),
          onPressed: _saving ? null : _save,
        ),
        const SizedBox(height: 30),
      ]),
    );
  }
}

/// بحثٌ عن شخصٍ في الموظّفين وملفّات القسم (`/person-lookup`) — نظيرُ PersonLookup.
Future<Map<String, dynamic>?> _personSearch(BuildContext context, String title) {
  // الحالةُ خارج builder: إعادةُ بناء النافذة لا تُصفِّرها والخانةُ مكتوبة
  List<Map<String, dynamic>> rows = [];
  bool loading = false;
  int seq = 0;
  String typed = '';
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) {
      return StatefulBuilder(builder: (c, setS) {
        Future<void> search(String q) async {
          final mine = ++seq;
          typed = q.trim();
          if (q.trim().length < 2) { setS(() { rows = []; loading = false; }); return; }
          setS(() => loading = true);
          await Future.delayed(const Duration(milliseconds: 350));
          if (!c.mounted) return;
          if (mine != seq) return;
          try {
            final d = await Api.instance.get('/api/vehicle-registry/person-lookup?q=${Uri.encodeQueryComponent(q.trim())}');
            if (mine != seq) return;
            rows = List<Map<String, dynamic>>.from(((d is Map ? d['people'] : null) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
          } catch (_) { rows = []; }
          if (c.mounted && mine == seq) setS(() => loading = false);
        }
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.7,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: SearchField(autofocus: true, onChanged: search, hint: title),
                ),
                Expanded(
                  child: loading
                      ? const Center(child: CircularProgressIndicator())
                      : rows.isEmpty && typed.length >= 2
                          ? Center(child: Text(tr('لا نتائج مطابقة', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                          : ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: rows.map((p) => ListTile(
                            title: Text('${p['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text([p['idNumber'], p['phone'], p['jobTitleAr'] ?? p['source']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ')),
                            onTap: () => Navigator.pop(c, p),
                          )).toList()),
                ),
              ]),
            ),
          ),
        );
      });
    },
  );
}
