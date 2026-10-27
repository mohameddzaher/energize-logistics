import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import '../ui/person_docs.dart';
import 'b2c_column_filter.dart';
import 'light_transport_add.dart';
import 'light_transport_profile.dart';

/// موظفو النقل الخفيف — سجلُّ القسم كلِّه، مطابقٌ لـ `/system/b2c/light-transport`:
/// كروتٌ تُفلتِر وتُعاد أعدادُها على ما بقي، فلاترُ الخادم والمحلّية، فلاترُ
/// الأعمدة، تحديدٌ جماعيٌّ لإسناد المشرفين، تعديلٌ، نقلُ مشروع، وإخراجٌ من القسم.
class LightTransportListScreen extends StatefulWidget {
  /// فلاترٌ يُفتَح عليها (من رقمٍ في اللوحة — كرابط الويب `?project=…&inService=1`).
  final Map<String, String> initial;
  final String? title;
  const LightTransportListScreen({super.key, this.initial = const {}, this.title});
  @override
  State<LightTransportListScreen> createState() => _LightTransportListScreenState();
}

String _s(Map<String, dynamic>? m, String k) => (m?[k] ?? '').toString().trim();
Map<String, dynamic>? _m(dynamic v) => v is Map ? v.cast<String, dynamic>() : null;
String _ymd(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString());
  return d == null ? '' : d.toIso8601String().substring(0, 10);
}
String _idOf(dynamic v) => v == null ? '' : v is Map ? '${v['_id'] ?? ''}' : '$v';

const _ended = 'إنهاء خدمة';
const _kindAr = {'rep': 'مندوب', 'admin': 'إداري'};
const _kindEn = {'rep': 'Rep', 'admin': 'Admin'};
// المفاتيحُ التي تُفلتَر في التطبيق — الباقي يُرسَل إلى الخادم (كـ LOCAL_KEYS في الويب).
const _localKeys = ['contractKind', 'doc', 'staffKind', 'status', 'hasVehicle', 'housing', 'dutySupervisor'];

/// أعمدةُ الجدول والتصدير — LT_COLUMNS في الويب بترتيبها.
final ltColumns = <ColDef>[
  ColDef('plate', 'رقم اللوحة', 'Plate', (e) => _s(e, 'vehiclePlate').isEmpty ? '' : '${_s(e, 'vehiclePlate')}${_s(_m(e['vehicleHold']), 'at').isNotEmpty ? ' — معلّقة' : ''}'),
  ColDef('name', 'الاسم (القائد الفعلي)', 'Name (actual driver)', (e) => _s(e, 'name')),
  ColDef('idNumber', 'رقم الهوية', 'ID number', (e) => _s(e, 'idNumber')),
  ColDef('jobTitleAr', 'الوظيفة', 'Job', (e) => _s(e, 'jobTitleAr')),
  ColDef('staffKind', 'النوع', 'Kind', (e) => _kindAr[_s(e, 'staffKind')] ?? ''),
  ColDef('projectAr', 'المشروع', 'Project', (e) => _s(e, 'projectAr')),
  ColDef('cityAr', 'الفرع', 'Branch', (e) => _s(e, 'cityAr')),
  ColDef('supervisorName', 'المشرف التشغيلي', 'Ops supervisor', (e) => _s(e, 'supervisorName')),
  ColDef('dutySupervisorName', 'مشرف التفقد', 'Duty supervisor', (e) => _s(e, 'dutySupervisorName')),
  ColDef('vehicleTypeAr', 'نوع المركبة', 'Vehicle type', (e) => _s(e, 'vehicleTypeAr')),
  ColDef('contractTypeAr', 'نوع التعاقد', 'Contract', (e) => _s(e, 'contractTypeAr')),
  ColDef('registerNumber', 'رقم السجل', 'Register', (e) => _s(e, 'registerNumber')),
  ColDef('workStatus', 'حالة العمل', 'Status', (e) => _s(e, 'workStatusShown')),
  ColDef('nationalityAr', 'الجنسية', 'Nationality', (e) => _s(e, 'nationalityAr')),
  ColDef('hireDate', 'تاريخ التعيين', 'Hire date', (e) => _ymd(e['hireDate'])),
  ColDef('phone', 'الجوال', 'Phone', (e) => _s(e, 'phone')),
  ColDef('housing', 'السكن', 'Housing', (e) => _s(_m(e['housing']), 'name')),
  ColDef('housingRoom', 'الغرفة', 'Room', (e) => _s(e, 'housingRoom')),
  ColDef('serialNumber', 'الرقم التسلسلي', 'Serial', (e) => _s(_m(e['vehicle']), 'serialNumber')),
  ColDef('authorizedName', 'المفوَّض', 'Authorised person', (e) => _s(_m(_m(e['vehicle'])?['authorizedPerson']), 'name')),
  ColDef('authorizedId', 'هوية المفوَّض', 'Authorised ID', (e) => _s(_m(_m(e['vehicle'])?['authorizedPerson']), 'iqamaNumber')),
  ColDef('authorizedPhone', 'جوال المفوَّض', 'Authorised phone', (e) => _s(_m(_m(e['vehicle'])?['authorizedPerson']), 'phone')),
  ColDef('authorizationNumber', 'رقم التفويض', 'Authorisation no.', (e) => _s(_m(_m(e['vehicle'])?['authorizedPerson']), 'authorizationNumber')),
  ColDef('authorizationStart', 'بداية التفويض', 'Auth. start', (e) => _ymd(_m(_m(e['vehicle'])?['authorizedPerson'])?['startDate'])),
  ColDef('authorizationEnd', 'نهاية التفويض', 'Auth. end', (e) => _ymd(_m(_m(e['vehicle'])?['authorizedPerson'])?['expiryDate'])),
  ColDef('actualDriverName', 'القائد الفعلي', 'Actual driver', (e) => _s(_m(_m(e['vehicle'])?['actualDriver']), 'name')),
  ColDef('actualDriverId', 'هوية القائد الفعلي', 'Actual driver ID', (e) => _s(_m(_m(e['vehicle'])?['actualDriver']), 'idNumber')),
  ColDef('operatingCardNumber', 'رقم كارت التشغيل', 'Operating card no.', (e) => _s(_m(e['operatingCard']), 'number')),
  ColDef('operatingCardExpiry', 'انتهاء كارت التشغيل', 'Operating card expiry', (e) => _ymd(_m(e['operatingCard'])?['expiryDate'])),
  ColDef('inspectionExpiry', 'انتهاء الفحص', 'Inspection expiry', (e) => _ymd(_m(e['inspection'])?['expiryDate'])),
  // انتهاءُ الإقامة ورخصةِ القيادة من ملفّه في الموارد البشريّة، وحالتُهما للفلترة.
  ColDef('iqamaExpiry', 'انتهاء الإقامة', 'Iqama expiry', (e) => personDocDate(e, 'iqama')),
  ColDef('iqamaState', 'حالة الإقامة', 'Iqama status', (e) => personDocState(e, 'iqama')),
  ColDef('licenseExpiry', 'انتهاء رخصة القيادة', 'Licence expiry', (e) => personDocDate(e, 'license')),
  ColDef('licenseState', 'حالة رخصة القيادة', 'Licence status', (e) => personDocState(e, 'license')),
  ColDef('hrLinked', 'ملفّ الموارد البشرية', 'HR file', (e) => e['hrLinked'] == true ? (_s(e, 'employeeNumber').isEmpty ? 'مربوط' : _s(e, 'employeeNumber')) : 'لا ملفّ'),
  ColDef('notesAr', 'ملاحظات', 'Notes', (e) => _s(e, 'notesAr')),
];

String _normStatus(String v) {
  final x = v.trim();
  if (x == 'متوقف') return 'موقوف';
  if (x == 'اجازه' || x == 'في إجازة') return 'إجازة';
  return x;
}

/// ltPasses في الويب — الفلاترُ المحلّيّة (skip لحساب الكرت على ما سواه).
bool _passes(Map<String, dynamic> r, Map<String, String> f, [String? skip]) {
  bool on(String k) => k != skip && (f[k] ?? '').isNotEmpty;
  if (on('staffKind')) {
    final kind = _s(r, 'staffKind').isEmpty ? 'rep' : _s(r, 'staffKind');
    if (f['staffKind'] == 'unknown' ? !(kind == 'unknown' || _s(r, 'jobTitleAr').isEmpty) : kind != f['staffKind']) return false;
  }
  if (on('status') && !f['status']!.split(',').map(_normStatus).contains(_s(r, 'workStatusShown'))) return false;
  if (on('hasVehicle') && (f['hasVehicle'] == 'yes' ? r['vehicle'] == null : f['hasVehicle'] == 'no' ? r['vehicle'] != null : false)) return false;
  if (on('housing')) {
    final h = _idOf(r['housing']);
    if (f['housing'] == 'none' ? h.isNotEmpty : h != f['housing']) return false;
  }
  if (on('contractKind')) {
    final want = const {'sponsored': 'كفالة', 'freelance': 'فري لانسر', 'users': 'يوزرات', 'none': ''}[f['contractKind']];
    if (want != null && _s(r, 'contractTypeShown') != want) return false;
  }
  if (on('doc')) {
    final parts = f['doc']!.split('-');
    final d = _m(parts[0] == 'card' ? r['operatingCard'] : r['inspection']);
    final st = _s(d, 'state').isEmpty ? 'missing' : _s(d, 'state');
    if (parts.length > 1 && parts[1] == 'gap' && !['expired', 'critical'].contains(st)) return false;
    if (parts.length > 1 && parts[1] == 'soon' && !['warning', 'upcoming'].contains(st)) return false;
  }
  if (on('dutySupervisor')) {
    final v = f['dutySupervisor']!;
    final id = _idOf(r['dutySupervisorUser']);
    final looksId = RegExp(r'^[0-9a-f]{24}$', caseSensitive: false).hasMatch(v);
    if (v == 'none' ? id.isNotEmpty : looksId ? id != v : _s(r, 'dutySupervisorName') != v) return false;
  }
  return true;
}

/// ltTotalsOf في الويب.
Map<String, int> _totalsOf(List<Map<String, dynamic>> rows) {
  final reps = rows.where((r) => (_s(r, 'staffKind').isEmpty ? 'rep' : _s(r, 'staffKind')) == 'rep').toList();
  int count(bool Function(Map<String, dynamic>) fn) => reps.where(fn).length;
  bool gap(dynamic d) => d is Map && ['expired', 'critical'].contains(d['state']);
  bool soon(dynamic d) => d is Map && ['warning', 'upcoming'].contains(d['state']);
  return {
    'total': rows.length,
    'sponsored': count((r) => _s(r, 'contractTypeShown') == 'كفالة'),
    'freelance': count((r) => _s(r, 'contractTypeShown') == 'فري لانسر'),
    'noDutySupervisor': count((r) => _idOf(r['dutySupervisorUser']).isEmpty),
    'cardGap': count((r) => gap(r['operatingCard'])),
    'cardSoon': count((r) => soon(r['operatingCard'])),
    'inspectionGap': count((r) => gap(r['inspection'])),
    'inspectionSoon': count((r) => soon(r['inspection'])),
    'reps': reps.length,
    'admins': rows.where((r) => _s(r, 'staffKind') == 'admin').length,
    'drivers': rows.where((r) => _s(r, 'staffKind') == 'driver').length,
    'unknownKind': rows.where((r) => _s(r, 'staffKind') == 'unknown' || _s(r, 'jobTitleAr').isEmpty).length,
    'working': count((r) => _s(r, 'workStatusShown') == 'يعمل'),
    'onLeave': count((r) => ['إجازة', 'اجازه'].contains(_s(r, 'workStatusShown'))),
    'withVehicle': count((r) => r['vehicle'] != null),
    'withoutVehicle': count((r) => r['vehicle'] == null),
    'hrLinked': count((r) => r['hrLinked'] == true),
    'ownedHere': count((r) => r['hrLinked'] != true),
    'housed': count((r) => r['housing'] != null),
    'unhoused': count((r) => r['housing'] == null),
  };
}

/// ltFacetedTotals: كلُّ كرتٍ محسوبٌ على ما بعد الفلاتر سوى فلتره هو.
Map<String, int> _faceted(List<Map<String, dynamic>> rows, Map<String, String> f) {
  final base = (f['status'] ?? '').split(',').contains(_ended) ? rows : rows.where((r) => _s(r, 'workStatusShown') != _ended).toList();
  List<Map<String, dynamic>> pass([String? skip]) => base.where((r) => _passes(r, f, skip)).toList();
  final t = _totalsOf(pass());
  void over(String k, List<String> keys) {
    if ((f[k] ?? '').isEmpty) return;
    final o = _totalsOf(pass(k));
    for (final key in keys) { t[key] = o[key] ?? 0; }
  }
  over('staffKind', ['reps', 'admins', 'drivers', 'unknownKind']);
  over('status', ['working', 'onLeave']);
  over('hasVehicle', ['withVehicle', 'withoutVehicle']);
  over('housing', ['housed', 'unhoused']);
  over('contractKind', ['sponsored', 'freelance']);
  over('doc', ['cardGap', 'cardSoon', 'inspectionGap', 'inspectionSoon']);
  over('dutySupervisor', ['noDutySupervisor']);
  return t;
}

/// مَن يعدّل السجلّ (canEditLT في الويب).
bool canEditLtUser(AuthProvider a) =>
    const ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager'].contains(a.role) || a.canEditSection('B2C');

class _LightTransportListScreenState extends State<LightTransportListScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _serverTotal = 0;
  Map<String, dynamic> _options = const {};
  bool _loading = true;
  String? _error;
  String _q = '';
  Timer? _debounce;
  // متحكِّمُ البحث عند الشاشة: يبقى نصُّه بعد التحميل/الخطأ، و«مسح الكل» يمسحه.
  final _searchCtl = TextEditingController();
  final Map<String, String> _f = {};
  Map<String, Set<String>> _cf = {};
  final Map<String, Map<String, dynamic>> _picked = {};
  int _seq = 0;

  List<Map<String, dynamic>> get _supervisors => List<Map<String, dynamic>>.from(_options['supervisor'] ?? const []);
  List<Map<String, dynamic>> get _housing => List<Map<String, dynamic>>.from(_options['housing'] ?? const []);
  List<String> _opt(String k) => List<String>.from((_options[k] as List? ?? const []).map((x) => '$x'));

  @override
  void initState() {
    super.initState();
    _f.addAll(widget.initial);
    _load();
    Live.instance.on('lt:*', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtl.dispose();
    Live.instance.off('lt:*', _onLive);
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
  }

  void _onLive() { if (mounted) _load(); }

  Future<void> _load() async {
    final mine = ++_seq;
    final qp = <String, String>{
      for (final e in _f.entries) if (e.value.isNotEmpty && !_localKeys.contains(e.key)) e.key: e.value,
      if (_q.isNotEmpty) 'q': _q,
    };
    final qs = qp.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
    try {
      final d = await Api.instance.get('/api/light-transport/employees${qs.isEmpty ? '' : '?$qs'}') as Map;
      if (!mounted || mine != _seq) return;
      final rows = List<Map<String, dynamic>>.from(((d['employees'] as List?) ?? const []).map((x) => (x as Map).cast<String, dynamic>()));
      setState(() {
        _rows = rows;
        _serverTotal = ((d['totals'] as Map?)?['total'] as num?)?.toInt() ?? rows.length;
        if (d['options'] is Map) _options = (d['options'] as Map).cast<String, dynamic>();
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e is ApiException ? e.message : '$e'; _loading = false; });
    }
  }

  bool _isServerKey(String k) => !_localKeys.contains(k);

  void _set(String k, String v) {
    final had = _f[k] ?? '';
    setState(() => _f[k] = had == v ? '' : v);
    if (_isServerKey(k)) _load();
  }

  /// كروتُ المناديب تُفلتِر على المناديب أيضًا (repFilter).
  void _repSet(String k, String v) {
    setState(() {
      if (_f[k] == v) { _f[k] = ''; _f['staffKind'] = ''; } else { _f[k] = v; _f['staffKind'] = 'rep'; }
    });
  }

  void _clear() {
    _debounce?.cancel();
    _searchCtl.clear();
    setState(() { _f.clear(); _q = ''; });
    _load();
  }

  int get _activeCount => _f.values.where((v) => v.isNotEmpty).length + (_q.isNotEmpty ? 1 : 0);

  List<Map<String, dynamic>> get _shown => applyColumnFilters(_rows.where((r) => _passes(r, _f)).toList(), ltColumns, _cf);

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  // ── إخراجٌ من القسم: السجلُّ يبقى وأثرُه محفوظ ──────────────────────────
  Future<void> _deactivate(Map<String, dynamic> e) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إخراج من القسم', 'Remove from section')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(tr('يُخرَج «${_s(e, 'name')}» من سجلّ القسم؟ السجلُّ يبقى وأثرُه محفوظ.',
              'Remove "${_s(e, 'name')}" from the section register? The record and its trail are kept.')),
          const SizedBox(height: 10),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إخراج', 'Remove'))),
        ],
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (ok != true) return;
    try {
      await Api.instance.post('/api/light-transport/employees/${e['_id']}/deactivate', {'reason': why});
      _load();
    } catch (err) {
      _say(err is ApiException ? err.message : tr('تعذّر', 'Failed'));
    }
  }

  // ── إسنادُ مشرفٍ لعدّة موظفين: ما يُترك على «لا تغيير» لا يُمَسّ ────────
  Future<void> _assign() async {
    String ops = '', duty = '';
    bool busy = false;
    final sups = _supervisors;
    List<DropdownMenuItem<String>> items(String clearAr, String clearEn) => [
          DropdownMenuItem(value: '', child: Text(tr('— لا تغيير —', '— leave as is —'))),
          DropdownMenuItem(value: 'none', child: Text(tr(clearAr, clearEn))),
          for (final s in sups) DropdownMenuItem(value: _s(s, '_id'), child: Text('${_s(s, 'name')} — ${_s(s, 'roleAr')}', overflow: TextOverflow.ellipsis)),
        ];
    await showDialog<void>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
        title: Text(tr('إسناد مشرف لـ${_picked.length} موظفًا', 'Assign a supervisor to ${_picked.length} employees')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            isExpanded: true, initialValue: ops,
            decoration: InputDecoration(labelText: tr('المشرف التشغيلي', 'Ops supervisor')),
            items: items('— رفع الإشراف التشغيلي —', '— clear it —'),
            onChanged: (v) => setD(() => ops = v ?? ''),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            isExpanded: true, initialValue: duty,
            decoration: InputDecoration(labelText: tr('مشرف التفقد', 'Duty supervisor')),
            items: items('— رفع مشرف التفقد —', '— clear it —'),
            onChanged: (v) => setD(() => duty = v ?? ''),
          ),
          const SizedBox(height: 8),
          Text(tr('ما يُترك على «لا تغيير» لا يُمَسّ. ومشرف التفقد هو الذي يرى هؤلاء في شاشة تفقّد بداية الدوام.',
                  'Anything left on “leave as is” is untouched. The duty supervisor is who sees these riders in the duty check.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            onPressed: busy || (ops.isEmpty && duty.isEmpty) ? null : () async {
              setD(() => busy = true);
              try {
                final r = await Api.instance.post('/api/light-transport/employees/assign-supervisors', {
                  'ids': _picked.keys.toList(),
                  if (ops.isNotEmpty) 'supervisorUser': ops,
                  if (duty.isNotEmpty) 'dutySupervisorUser': duty,
                });
                if (c.mounted) Navigator.pop(c);
                _say(tr('أُسند ${r['updated']} موظفًا', '${r['updated']} employees assigned'));
                setState(_picked.clear);
                _load();
              } catch (e) {
                setD(() => busy = false);
                _say(e is ApiException ? e.message : tr('تعذّر الإسناد', 'Could not assign'));
              }
            },
            child: Text(busy ? tr('يُسند…', 'Assigning…') : tr('إسناد', 'Assign')),
          ),
        ],
      )),
    );
  }

  Future<void> _edit(Map<String, dynamic> e) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => LtEditEmployeeSheet(employee: e, supervisors: _supervisors, housing: _housing),
    );
    if (saved == true) _load();
  }

  // ── لوحةُ الفلاتر: فلاترُ الخادم (المشروع…) والمحلّيّة (الحالة، السكن…) ──
  Future<void> _filters() async {
    final draft = Map<String, String>.of(_f);
    final statuses = {for (final r in _rows) _s(r, 'workStatusShown')}.where((x) => x.isNotEmpty).toList()..sort();
    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => StatefulBuilder(builder: (c, setD) {
        Widget drop(String k, String ar, String en, List<(String, String)> opts) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: opts.any((o) => o.$1 == (draft[k] ?? '')) ? (draft[k] ?? '') : '',
                decoration: InputDecoration(labelText: tr(ar, en), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                  for (final o in opts) if (o.$1.isNotEmpty) DropdownMenuItem(value: o.$1, child: Text(o.$2, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setD(() => draft[k] = v ?? ''),
              ),
            );
        List<(String, String)> plain(String k) => [for (final x in _opt(k)) (x, x)];
        final sup = [for (final s in _supervisors) (_s(s, '_id'), '${_s(s, 'name')} — ${_s(s, 'roleAr')}')];
        Widget date(String k, String ar, String en) => Expanded(
              child: InkWell(
                onTap: () async {
                  final d = await showDatePicker(context: c, firstDate: DateTime(2000), lastDate: DateTime(2100),
                      initialDate: DateTime.tryParse(draft[k] ?? '') ?? DateTime.now());
                  if (d != null) setD(() => draft[k] = d.toIso8601String().substring(0, 10));
                },
                child: InputDecorator(
                  decoration: InputDecoration(labelText: tr(ar, en), isDense: true,
                      suffixIcon: (draft[k] ?? '').isEmpty ? const Icon(Icons.event, size: 18)
                          : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setD(() => draft[k] = ''))),
                  child: Text(draft[k] ?? ''),
                ),
              ),
            );
        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.85,
            child: Column(children: [
              Expanded(
                child: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), children: [
                  Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  const SizedBox(height: 10),
                  drop('project', 'المشروع', 'Project', plain('project')),
                  drop('city', 'الفرع', 'Branch', plain('city')),
                  drop('jobTitle', 'الوظيفة', 'Job', plain('jobTitle')),
                  drop('contractType', 'نوع التعاقد', 'Contract', plain('contractType')),
                  drop('register', 'السجل', 'Register', plain('register')),
                  drop('vehicleType', 'نوع المركبة', 'Vehicle type', plain('vehicleType')),
                  drop('dutySupervisor', 'مشرف التفقد', 'Duty supervisor', [('none', tr('— بلا مشرف تفقد —', '— no duty supervisor —')), ...sup]),
                  drop('supervisor', 'المشرف التشغيلي', 'Ops supervisor', [
                    ('none', tr('— بلا مشرف —', '— no supervisor —')), ...sup,
                    for (final n in _opt('supervisorsUnlinked')) (n, '$n ${tr('(بلا حساب)', '(no account)')}'),
                  ]),
                  drop('status', 'الحالة', 'Status', [for (final x in statuses) (x, x)]),
                  drop('housing', 'السكن', 'Housing', [('none', tr('بلا سكن', 'Unhoused')), for (final h in _housing) (_s(h, '_id'), _s(h, 'name'))]),
                  Row(children: [date('hiredFrom', 'التعيين من', 'Hired from'), const SizedBox(width: 10), date('hiredTo', 'التعيين إلى', 'Hired to')]),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  TextButton(onPressed: () => setD(draft.clear), child: Text(tr('مسح', 'Clear'))),
                  const Spacer(),
                  FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تطبيق', 'Apply'))),
                ]),
              ),
            ]),
          ),
        );
      }),
    );
    if (applied != true) return;
    setState(() { _f..clear()..addAll(draft); });
    _load();
  }

  String _chipValue(String k, String v) {
    switch (k) {
      case 'contractKind':
        return const {'sponsored': 'على الكفالة', 'freelance': 'فري لانسر', 'users': 'يوزرات', 'none': 'بلا نوع عقد'}[v] ?? v;
      case 'staffKind':
        return const {'rep': 'مندوب', 'admin': 'إداري', 'driver': 'سائق', 'unknown': 'بلا وظيفة'}[v] ?? v;
      case 'doc':
        return const {'card-gap': 'كارت تشغيل منتهي/حرج', 'card-soon': 'كارت تشغيل قريب', 'inspection-gap': 'فحص منتهي/حرج', 'inspection-soon': 'فحص قريب'}[v] ?? v;
      case 'inService':
        return tr('بلا المنتهين', 'excluding ended');
      case 'auth':
        return v.split(',').map((x) => const {'authorized': 'مفوَّض', 'expired': 'تفويض منتهٍ', 'none': 'بلا تفويض'}[x] ?? x).join('، ');
      case 'engagement':
        return v.split(',').map((x) => const {'sponsored': 'على الكفالة', 'freelance': 'فريلانسر', 'trainee': 'متدرّب', 'users': 'يوزرات', 'none': 'غير محدد'}[x] ?? x).join('، ');
      case 'category':
        return v.split(',').map((x) => const {'rep': 'مندوب', 'admin': 'إداري', 'tech': 'فني', 'none': 'غير مصنَّف'}[x] ?? x).join('، ');
      case 'rep':
        final ids = v.split(',');
        return ids.length == 1 ? _s(_rows.firstWhere((r) => r['_id'] == ids.first, orElse: () => {}), 'name').ifEmpty(tr('مندوب واحد', 'one rep')) : tr('${ids.length} مناديب', '${ids.length} reps');
      case 'vehicle':
        final ids = v.split(',');
        return ids.length == 1 ? tr('مركبة واحدة', 'one vehicle') : tr('${ids.length} مركبات', '${ids.length} vehicles');
      case 'hasVehicle':
        return v == 'yes' ? tr('له مركبة', 'has a vehicle') : tr('بلا مركبة', 'no vehicle');
      case 'housing':
        return v == 'none' ? tr('بلا سكن', 'unhoused') : _s(_housing.firstWhere((h) => _s(h, '_id') == v, orElse: () => {}), 'name').ifEmpty(v);
      case 'supervisor':
      case 'dutySupervisor':
        return v == 'none' ? tr('بلا مشرف', 'none') : _s(_supervisors.firstWhere((s) => _s(s, '_id') == v, orElse: () => {}), 'name').ifEmpty(v);
    }
    return v;
  }

  static const _chipKey = {
    'project': ('المشروع', 'Project'), 'city': ('الفرع', 'Branch'), 'jobTitle': ('الوظيفة', 'Job'), 'contractType': ('نوع التعاقد', 'Contract'),
    'register': ('السجل', 'Register'), 'vehicleType': ('نوع المركبة', 'Vehicle type'), 'supervisor': ('المشرف', 'Supervisor'),
    'dutySupervisor': ('مشرف التفقد', 'Duty supervisor'), 'staffKind': ('النوع', 'Kind'), 'status': ('الحالة', 'Status'),
    'housing': ('السكن', 'Housing'), 'hasVehicle': ('المركبة', 'Vehicle'), 'hiredFrom': ('التعيين من', 'Hired from'),
    'hiredTo': ('التعيين إلى', 'Hired to'), 'contractKind': ('العقد', 'Contract'), 'doc': ('الوثيقة', 'Document'),
    'inService': ('الخدمة', 'Service'), 'rep': ('المندوب', 'Rep'), 'vehicle': ('المركبة', 'Vehicle'), 'auth': ('التفويض', 'Authorisation'),
    'cr': ('السجل التجاري', 'Register'), 'engagement': ('الارتباط', 'Engagement'), 'category': ('الفئة', 'Category'),
  };

  Widget _stat(String label, int v, Color c, {VoidCallback? onTap, bool on = false}) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: 112,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: on ? T.orange : T.line, width: on ? 2 : 1),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, maxLines: 2, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, height: 1.2)),
            const SizedBox(height: 2),
            Text('$v', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: c)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final role = auth.role;
    final canEdit = canEditLtUser(auth);
    final canAdd = const ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'].contains(role);
    final canTransfer = ltTransferRoles.contains(role);
    final colFiltered = applyColumnFilters(_rows, ltColumns, _cf);
    final t = _faceted(colFiltered, _f);
    final shown = _shown;
    final endedShown = shown.where((r) => _s(r, 'workStatusShown') == _ended).length;

    return AppScaffold(
      title: Text(widget.title ?? tr('موظفون النقل الخفيف', 'Light-transport employees')),
      actions: [
        ExportButton(
          fileName: 'light-transport', sheetName: 'LightTransport',
          columns: [for (final c in ltColumns) ExportCol(c.ar, c.en, c.get)],
          rows: () => shown,
        ),
      ],
      floatingActionButton: canAdd
          ? FloatingActionButton.extended(
              onPressed: () async { if (await showLtAddEmployee(context) == true) _load(); },
              icon: const Icon(Icons.person_add_alt_1),
              label: Text(tr('إضافة موظف', 'Add employee')),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 300)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, slivers: [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                      sliver: SliverList.list(children: [
                        Text(tr('$_serverTotal موظفًا — المندوبون والإداريون معًا', '$_serverTotal employees — reps and admin together'),
                            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                        const SizedBox(height: 8),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          _stat(tr('الإجمالي', 'Total'), t['total']!, T.ink, onTap: _clear, on: _activeCount == 0),
                          _stat(tr('مناديب', 'Reps'), t['reps']!, T.info, onTap: () => _set('staffKind', 'rep'), on: _f['staffKind'] == 'rep'),
                          _stat(tr('سائقون', 'Drivers'), t['drivers']!, T.cyan, onTap: () => _set('staffKind', 'driver'), on: _f['staffKind'] == 'driver'),
                          _stat(tr('إداريون وفنيون', 'Admin & technical'), t['admins']!, T.success, onTap: () => _set('staffKind', 'admin'), on: _f['staffKind'] == 'admin'),
                          _stat(tr('بلا وظيفة مكتوبة', 'No job title'), t['unknownKind']!, T.danger, onTap: () => _set('staffKind', 'unknown'), on: _f['staffKind'] == 'unknown'),
                        ]),
                        const SizedBox(height: 6),
                        Text(tr('البطاقات التالية محسوبةٌ على المناديب (${t['reps']}) — وضغطُ أيٍّ منها يفلتر على المناديب أيضًا.',
                                'The cards below are computed on reps (${t['reps']}) — pressing one also filters to reps.'),
                            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          _stat(tr('على رأس العمل', 'Working'), t['working']!, T.success, onTap: () => _repSet('status', 'يعمل'), on: _f['status'] == 'يعمل'),
                          _stat(tr('لهم مركبة', 'With a vehicle'), t['withVehicle']!, T.ink, onTap: () => _repSet('hasVehicle', 'yes'), on: _f['hasVehicle'] == 'yes'),
                          _stat(tr('بلا مركبة', 'No vehicle'), t['withoutVehicle']!, T.warn, onTap: () => _repSet('hasVehicle', 'no'), on: _f['hasVehicle'] == 'no'),
                          _stat(tr('في إجازة', 'On leave'), t['onLeave']!, T.info, onTap: () => _repSet('status', 'إجازة'), on: _f['status'] == 'إجازة'),
                          _stat(tr('لهم ملفّ في الموارد البشرية', 'Have an HR file'), t['hrLinked']!, T.ink),
                          _stat(tr('بلا ملفّ (القسم يملكهم)', 'Owned by the section'), t['ownedHere']!, T.violet),
                          _stat(tr('لهم سكن', 'Housed'), t['housed']!, T.ink, onTap: () => _repSet('housing', '')),
                          _stat(tr('بلا سكن', 'Unhoused'), t['unhoused']!, T.warn, onTap: () => _repSet('housing', 'none'), on: _f['housing'] == 'none'),
                          _stat(tr('على الكفالة', 'On sponsorship'), t['sponsored']!, T.ink, onTap: () => _repSet('contractKind', 'sponsored'), on: _f['contractKind'] == 'sponsored'),
                          _stat(tr('فري لانسر', 'Freelance'), t['freelance']!, T.violet, onTap: () => _repSet('contractKind', 'freelance'), on: _f['contractKind'] == 'freelance'),
                          _stat(tr('كارت تشغيل منتهي/حرج', 'Operating card expired/critical'), t['cardGap']!, T.danger, onTap: () => _repSet('doc', 'card-gap'), on: _f['doc'] == 'card-gap'),
                          _stat(tr('كارت تشغيل قريب', 'Operating card due soon'), t['cardSoon']!, T.warn, onTap: () => _repSet('doc', 'card-soon'), on: _f['doc'] == 'card-soon'),
                          _stat(tr('فحص منتهي/حرج', 'Inspection expired/critical'), t['inspectionGap']!, T.danger, onTap: () => _repSet('doc', 'inspection-gap'), on: _f['doc'] == 'inspection-gap'),
                          _stat(tr('فحص قريب', 'Inspection due soon'), t['inspectionSoon']!, T.warn, onTap: () => _repSet('doc', 'inspection-soon'), on: _f['doc'] == 'inspection-soon'),
                          _stat(tr('بلا مشرف تفقد', 'No duty supervisor'), t['noDutySupervisor']!, T.danger, onTap: () => _repSet('dutySupervisor', 'none'), on: _f['dutySupervisor'] == 'none'),
                        ]),
                        const SizedBox(height: 10),
                        // البحثُ في الخادم: يصل سجلَّ المركبات أيضًا (التسلسليّ ورقمُ التفويض).
                        SearchField(
                          controller: _searchCtl, dense: true,
                          hint: tr('اسم · هوية · لوحة · مشرف · مشروع · سجل…', 'name, ID, plate, supervisor, project, register…'),
                          onChanged: (v) {
                            _q = v.trim();
                            _debounce?.cancel();
                            _debounce = Timer(const Duration(milliseconds: 350), _load);
                          },
                        ),
                        const SizedBox(height: 8),
                        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                          OutlinedButton.icon(onPressed: _filters, icon: const Icon(Icons.tune, size: 16), label: Text(tr('الفلاتر', 'Filters'))),
                          OutlinedButton.icon(
                            onPressed: () async {
                              final r = await showColumnFilters(context, cols: ltColumns, rows: _rows, current: _cf);
                              if (r != null) setState(() => _cf = r);
                            },
                            icon: const Icon(Icons.view_column_outlined, size: 16),
                            label: Text(_cf.isEmpty ? tr('فلاتر الأعمدة', 'Column filters') : tr('فلاتر الأعمدة (${_cf.length})', 'Column filters (${_cf.length})')),
                          ),
                          if (_cf.isNotEmpty) TextButton(onPressed: () => setState(() => _cf = {}), child: Text(tr('مسح فلاتر الأعمدة', 'Clear column filters'))),
                          Text(tr('${shown.length} من $_serverTotal', '${shown.length} of $_serverTotal'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          if (_f['status'] != _ended && endedShown > 0)
                            Text(tr('منهم $endedShown منتهي الخدمة — لا يُعَدّون في الكروت', '$endedShown of them ended — not counted in the cards'),
                                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ]),
                        // الفلاترُ الشغّالةُ مكتوبةً — وكلٌّ يُرفَع بضغطة.
                        if (_f.values.any((v) => v.isNotEmpty)) ...[
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            for (final e in _f.entries.where((e) => e.value.isNotEmpty))
                              InputChip(
                                label: Text('${tr(_chipKey[e.key]?.$1 ?? e.key, _chipKey[e.key]?.$2 ?? e.key)}: ${_chipValue(e.key, e.value)}', style: const TextStyle(fontSize: 12)),
                                onDeleted: () { setState(() => _f[e.key] = ''); if (_isServerKey(e.key)) _load(); },
                              ),
                            ActionChip(label: Text(tr('مسح الكل', 'Clear all')), onPressed: _clear),
                          ]),
                        ],
                        if (canEdit && _picked.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.orange.withValues(alpha: 0.4), width: 2)),
                            child: Row(children: [
                              Expanded(child: Text(
                                [tr('${_picked.length} موظفًا محدَّدًا', '${_picked.length} selected'),
                                  if (_picked.keys.where((id) => !shown.any((e) => e['_id'] == id)).isNotEmpty)
                                    tr('منهم ${_picked.keys.where((id) => !shown.any((e) => e['_id'] == id)).length} خارج الفلتر — محفوظون', 'some outside the filter — kept'),
                                ].join(' · '),
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                              )),
                              FilledButton(onPressed: _assign, child: Text(tr('إسناد مشرف', 'Assign supervisor'))),
                              TextButton(onPressed: () => setState(_picked.clear), child: Text(tr('إلغاء', 'Clear'), style: const TextStyle(color: T.danger))),
                            ]),
                          ),
                        ],
                        if (canEdit && shown.isNotEmpty)
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: TextButton.icon(
                              onPressed: () => setState(() {
                                final all = shown.every((e) => _picked.containsKey(e['_id']));
                                for (final e in shown) { all ? _picked.remove(e['_id']) : _picked['${e['_id']}'] = e; }
                              }),
                              icon: const Icon(Icons.select_all, size: 18),
                              label: Text(shown.every((e) => _picked.containsKey(e['_id'])) ? tr('إلغاء تحديد المعروض', 'Unselect shown') : tr('تحديد كل المعروض', 'Select everything shown')),
                            ),
                          ),
                      ]),
                    ),
                    if (shown.isEmpty)
                      SliverFillRemaining(
                        hasScrollBody: false,
                        child: Column(children: [
                          EmptyState(icon: Icons.two_wheeler_outlined, title: tr('لا نتائج', 'No results')),
                          if (_activeCount + _cf.length > 0)
                            FilledButton.icon(
                              onPressed: () { setState(() => _cf = {}); _clear(); },
                              icon: const Icon(Icons.restart_alt),
                              label: Text(tr('فيه ${_activeCount + _cf.length} فلترًا شغّالًا — امسحها', '${_activeCount + _cf.length} filters active — clear them')),
                            ),
                        ]),
                      )
                    else
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
                        sliver: SliverList.builder(
                          itemCount: shown.length,
                          itemBuilder: (c, i) => _tile(shown[i], canEdit: canEdit, canTransfer: canTransfer),
                        ),
                      ),
                  ]),
                ),
    );
  }

  Color _statusColor(String st) => st == _ended || st == 'حادث' ? T.danger : st == 'موقوف' || st == 'متوقف' ? T.warn : st == 'إجازة' ? T.info : T.success;

  String? _docBadge(dynamic d, String ar) {
    if (d is! Map) return null;
    final st = '${d['state']}';
    const words = {'expired': 'منتهية', 'critical': 'حرج', 'warning': 'تحذير', 'upcoming': 'قريبًا'};
    return words.containsKey(st) ? '$ar ${words[st]}' : null;
  }

  Widget _tile(Map<String, dynamic> e, {required bool canEdit, required bool canTransfer}) {
    final id = '${e['_id']}';
    final st = _s(e, 'workStatusShown');
    final kind = _s(e, 'staffKind');
    final card = _docBadge(e['operatingCard'], 'كارت التشغيل');
    final insp = _docBadge(e['inspection'], 'الفحص');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(6, 8, 4, 8),
        child: InkWell(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LightTransportProfileScreen(id: id))),
          onLongPress: canEdit ? () => setState(() => _picked.containsKey(id) ? _picked.remove(id) : _picked[id] = e) : null,
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (canEdit)
              Checkbox(
                visualDensity: VisualDensity.compact,
                value: _picked.containsKey(id),
                onChanged: (v) => setState(() => v == true ? _picked[id] = e : _picked.remove(id)),
              ),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_s(e, 'name'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 2),
                Text([_s(e, 'idNumber'), _s(e, 'jobTitleAr'), _s(e, 'projectAr'), _s(e, 'cityAr')].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                if (_s(e, 'supervisorName').isNotEmpty || _s(e, 'dutySupervisorName').isNotEmpty)
                  Text([
                    if (_s(e, 'supervisorName').isNotEmpty) '${tr('تشغيلي', 'Ops')}: ${_s(e, 'supervisorName')}',
                    if (_s(e, 'dutySupervisorName').isNotEmpty) '${tr('تفقد', 'Duty')}: ${_s(e, 'dutySupervisorName')}',
                  ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                const SizedBox(height: 5),
                Wrap(spacing: 5, runSpacing: 5, children: [
                  if (_s(e, 'vehiclePlate').isNotEmpty) Chip2(ltColumns.first.get(e), T.navy),
                  if (kind.isNotEmpty) Chip2(tr(_kindAr[kind] ?? kind, _kindEn[kind] ?? kind), kind == 'rep' ? T.info : T.success),
                  if (st.isNotEmpty) Chip2('$st${_s(e, 'statusSource') == 'hr' ? ' ⚑' : ''}', _statusColor(st)),
                  if (e['hrLinked'] == false) const Chip2('بلا ملفّ HR', T.warn),
                  if (card != null) Chip2(card, T.danger),
                  if (insp != null) Chip2(insp, T.danger),
                  for (final c in personDocChips(e)) Chip2(c.$1, c.$2),
                ]),
              ]),
            ),
            if (canEdit)
              PopupMenuButton<String>(
                onSelected: (a) async {
                  if (a == 'edit') await _edit(e);
                  if (a == 'transfer' && mounted && await transferLtProject(context, e)) _load();
                  if (a == 'deactivate') await _deactivate(e);
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'edit', child: ListTile(dense: true, leading: const Icon(Icons.edit_outlined), title: Text(tr('تعديل', 'Edit')))),
                  if (canTransfer) PopupMenuItem(value: 'transfer', child: ListTile(dense: true, leading: const Icon(Icons.swap_horiz), title: Text(tr('نقل المشروع', 'Transfer project')))),
                  PopupMenuItem(value: 'deactivate', child: ListTile(dense: true, leading: const Icon(Icons.person_remove_outlined, color: T.danger), title: Text(tr('إخراج من القسم', 'Remove from section')))),
                ],
              ),
          ]),
        ),
      ),
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// تعديلُ موظفٍ — نموذجُ «تعديل موظف» في الويب بحقوله كلّها: المشرفان، السكنُ
/// والغرفة، وحالةُ العمل وسببُها. المشروعُ لا يتغيّر هنا إن كان له مشروع
/// (يُنقَل بـ«نقل المشروع»)، والكفالةُ لمن له ملفٌّ تُقرأ من الموارد البشريّة.
class LtEditEmployeeSheet extends StatefulWidget {
  final Map<String, dynamic> employee;
  final List<Map<String, dynamic>> supervisors;
  final List<Map<String, dynamic>> housing;
  const LtEditEmployeeSheet({super.key, required this.employee, required this.supervisors, required this.housing});
  @override
  State<LtEditEmployeeSheet> createState() => _LtEditEmployeeSheetState();
}

class _LtEditEmployeeSheetState extends State<LtEditEmployeeSheet> {
  Map<String, dynamic> get e => widget.employee;
  late final _name = TextEditingController(text: _s(e, 'name'));
  late final _project = TextEditingController(text: _s(e, 'projectAr'));
  late final _city = TextEditingController(text: _s(e, 'cityAr'));
  late final _job = TextEditingController(text: _s(e, 'jobTitleAr'));
  late final _contract = TextEditingController(text: _s(e, 'contractTypeAr'));
  late final _register = TextEditingController(text: _s(e, 'registerNumber'));
  late final _vtype = TextEditingController(text: _s(e, 'vehicleTypeAr'));
  late final _note = TextEditingController(text: _s(e, 'opStatusNote'));
  late final _nat = TextEditingController(text: _s(e, 'nationalityAr'));
  late final _phone = TextEditingController(text: _s(e, 'phone'));
  late final _room = TextEditingController(text: _s(e, 'housingRoom'));
  late final _notes = TextEditingController(text: _s(e, 'notesAr'));
  late String _op = _s(e, 'opStatus');
  late String _sup = _idOf(e['supervisorUser']);
  late String _duty = _idOf(e['dutySupervisorUser']);
  late String _housing = _idOf(e['housing']);
  late String _hire = _ymd(e['hireDate']);
  bool _saving = false;

  bool get _hasProject => _s(e, 'projectAr').isNotEmpty;
  bool get _ended => _s(e, 'workStatusShown') == 'إنهاء خدمة';

  @override
  void dispose() {
    for (final c in [_name, _project, _city, _job, _contract, _register, _vtype, _note, _nat, _phone, _room, _notes]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/light-transport/employees/${e['_id']}', {
        'name': _name.text.trim(),
        if (!_hasProject) 'projectAr': _project.text.trim(),
        'cityAr': _city.text.trim(),
        'jobTitleAr': _job.text.trim(),
        if (e['hrLinked'] != true) 'contractTypeAr': _contract.text.trim(),
        'registerNumber': _register.text.trim(),
        'vehicleTypeAr': _vtype.text.trim(),
        if (!_ended) 'opStatus': _op,
        if (!_ended) 'opStatusNote': _op.isEmpty ? '' : _note.text.trim(),
        'supervisorUser': _sup,
        'dutySupervisorUser': _duty,
        'nationalityAr': _nat.text.trim(),
        'phone': _phone.text.trim(),
        'hireDate': _hire.isEmpty ? null : _hire,
        'housing': _housing,
        'housingRoom': _room.text.trim(),
        'notesAr': _notes.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ', 'Saved'))));
      Navigator.pop(context, true);
    } catch (err) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err is ApiException ? err.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  Widget _supDrop(String label, String noneAr, String value, ValueChanged<String> on) => DropdownButtonFormField<String>(
        isExpanded: true,
        initialValue: widget.supervisors.any((s) => _s(s, '_id') == value) ? value : '',
        decoration: InputDecoration(labelText: label),
        items: [
          DropdownMenuItem(value: '', child: Text(noneAr)),
          for (final s in widget.supervisors)
            DropdownMenuItem(value: _s(s, '_id'), child: Text('${_s(s, 'name')} — ${_s(s, 'roleAr')}', overflow: TextOverflow.ellipsis)),
        ],
        onChanged: (v) => setState(() => on(v ?? '')),
      );

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('تعديل موظف', 'Edit employee'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 12),
          TextField(enabled: false, controller: TextEditingController(text: _s(e, 'idNumber')), decoration: InputDecoration(labelText: tr('رقم الهوية', 'ID number'))),
          gap,
          TextField(controller: _name, decoration: InputDecoration(labelText: tr('الاسم', 'Name'))),
          gap,
          if (_hasProject) ...[
            TextField(enabled: false, controller: _project, decoration: InputDecoration(labelText: tr('المشروع', 'Project'))),
            Text(tr('لتغيير المشروع: «نقل مشروع» من صفحة المندوب', 'To change the project use “Transfer project” on the rep’s page'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ] else
            LookupField(type: 'lt_project', controller: _project, label: tr('المشروع', 'Project')),
          gap,
          LookupField(type: 'lt_city', controller: _city, label: tr('الفرع', 'Branch')),
          gap,
          LookupField(type: 'lt_job_title', controller: _job, label: tr('الوظيفة', 'Job title')),
          gap,
          if (e['hrLinked'] == true)
            InputDecorator(
              decoration: InputDecoration(labelText: tr('على الكفالة / فري لانسر', 'Sponsored / freelance'),
                  helperText: tr('من «رقم السجل التجاري» في الموارد البشرية', 'From the commercial register number in HR')),
              child: Text(_s(e, 'contractTypeShown').isEmpty ? tr('غير محدد', 'Not set') : _s(e, 'contractTypeShown')),
            )
          else
            LookupField(type: 'lt_contract_type', controller: _contract, label: tr('على الكفالة / فري لانسر', 'Sponsored / freelance')),
          gap,
          LookupField(type: 'lt_register', controller: _register, label: tr('رقم السجل', 'Commercial register')),
          gap,
          LookupField(type: 'lt_vehicle_type', controller: _vtype, label: tr('نوع المركبة', 'Vehicle type')),
          gap,
          if (_ended)
            InputDecorator(decoration: InputDecoration(labelText: tr('حالة العمل', 'Work status')), child: Text(tr('إنهاء خدمة (الموارد البشرية)', 'Ended (HR)')))
          else ...[
            DropdownButtonFormField<String>(
              initialValue: const ['', 'leave', 'suspended', 'accident'].contains(_op) ? _op : '',
              decoration: InputDecoration(labelText: tr('حالة العمل', 'Work status'),
                  helperText: tr('تظهر في ملفه بالموارد البشرية وعلى مركبته — ولا تُنشئ طلب إجازة.', 'Shown on his HR file and on his vehicle — it does not create a leave request.'),
                  helperMaxLines: 2),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('يعمل', 'Working'))),
                DropdownMenuItem(value: 'leave', child: Text(tr('إجازة', 'On leave'))),
                DropdownMenuItem(value: 'suspended', child: Text(tr('موقوف', 'Suspended'))),
                DropdownMenuItem(value: 'accident', child: Text(tr('حادث', 'Accident'))),
              ],
              onChanged: (v) => setState(() => _op = v ?? ''),
            ),
            if (_op.isNotEmpty) ...[
              gap,
              TextField(controller: _note, decoration: InputDecoration(labelText: tr('سبب الحالة (اختياري)', 'Reason (optional)'))),
            ],
            if (_op.isEmpty && _s(e, 'statusSource') == 'hr')
              Text(tr('في إجازة من الموارد البشرية.', 'On leave in HR.'), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          ],
          gap,
          _supDrop(tr('المشرف التشغيلي', 'Ops supervisor'), tr('— بلا مشرف —', '— none —'), _sup, (v) => _sup = v),
          if (_sup.isEmpty && _s(e, 'supervisorName').isNotEmpty)
            Text(tr('مكتوبٌ في السجلّ: «${_s(e, 'supervisorName')}» — بلا حساب على النظام.', 'Recorded as "${_s(e, 'supervisorName')}" with no system account.'),
                style: const TextStyle(fontSize: 11.5, color: T.warn)),
          gap,
          _supDrop(tr('مشرف التفقد', 'Duty supervisor'), tr('— بلا مشرف تفقد —', '— none —'), _duty, (v) => _duty = v),
          Text(tr('هو الذي يراه في «تفقّد بداية الدوام» ويُسأل عن تفقّده.', 'He is the one who sees this rider in the duty check and answers for it.'),
              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          gap,
          Row(children: [
            Expanded(child: TextField(controller: _nat, decoration: InputDecoration(labelText: tr('الجنسية', 'Nationality')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _phone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('الجوال', 'Phone')))),
          ]),
          gap,
          InkWell(
            onTap: () async {
              final d = await showDatePicker(context: context, firstDate: DateTime(2000), lastDate: DateTime(DateTime.now().year + 1),
                  initialDate: DateTime.tryParse(_hire) ?? DateTime.now());
              if (d != null) setState(() => _hire = d.toIso8601String().substring(0, 10));
            },
            child: InputDecorator(
              decoration: InputDecoration(labelText: tr('تاريخ التعيين', 'Hire date'),
                  suffixIcon: _hire.isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _hire = ''))),
              child: Text(_hire),
            ),
          ),
          gap,
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: widget.housing.any((h) => _s(h, '_id') == _housing) ? _housing : '',
            decoration: InputDecoration(labelText: tr('السكن', 'Housing')),
            items: [
              DropdownMenuItem(value: '', child: Text(tr('— بلا سكن —', '— none —'))),
              for (final h in widget.housing) DropdownMenuItem(value: _s(h, '_id'), child: Text(_s(h, 'name'))),
            ],
            onChanged: (v) => setState(() => _housing = v ?? ''),
          ),
          gap,
          TextField(controller: _room, decoration: InputDecoration(labelText: tr('الغرفة', 'Room'))),
          gap,
          TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          gap,
          Text(tr('المركبة والمشرف والسكن تُسنَد أيضًا بأمر تشغيل — فيُقيَّد التاريخ ويُنقَل التفويض في سجلّ المركبات.',
                  'Vehicle, supervisor and housing are also assigned by an operating order, which records the move and transfers authorisation in the vehicle registry.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _save, child: Text(tr('حفظ', 'Save')))),
        ]),
      ),
    );
  }
}
