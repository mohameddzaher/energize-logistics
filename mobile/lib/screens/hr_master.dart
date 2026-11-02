import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/filter_sheet.dart';
import '../ui/hr_quick.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_common.dart';
import 'hr_employee_profile.dart';
import '../ui/search_field.dart';

/// HR master in the app: counterpart of /system/hr/master/[group], /master/expiring, /master/grid and department analysis on the web.
/// All read from the same server endpoints (the /api/hr/master endpoints) with the same filters and write through the same paths (PATCH .../fields, POST renew and renew-bulk), so the server broadcasts `hr:master` and `hr:employee` and web and app refresh together.

// Field states and date states; STATUS_META/STATE_META in lib/hrMaster.
const hrStatusMeta = {
  'required': ('مطلوب', 'Required', T.danger),
  'not_required': ('غير مطلوب', 'Not required', T.inkSoft),
  'none': ('لا يوجد', 'None', T.inkFaint),
  'filled': ('مُدخَل', 'Filled', T.success),
  'cash_payroll': ('راتب نقدي', 'Cash payroll', T.violet),
  'inactive': ('غير نشط', 'Inactive', T.warn),
  'unparseable': ('تاريخ غير مقروء', 'Unreadable', T.warn),
};
const hrStateMeta = {
  'valid': ('ساري', 'Valid', T.success),
  'warning': ('قارب على الانتهاء', 'Due soon', Color(0xFFF59E0B)),
  'critical': ('ينتهي قريبًا جدًا', 'Critical', Color(0xFFEA580C)),
  'expired': ('منتهي', 'Expired', T.danger),
  'missing': ('بدون تاريخ', 'No date', T.inkFaint),
  'not_applicable': ('لا ينطبق', 'Not applicable', T.inkSoft),
  'attention': ('يحتاج انتباهًا', 'Needs attention', T.danger),
};
String hrStatusLabel(String k) { final m = hrStatusMeta[k]; return m == null ? k : tr(m.$1, m.$2); }
String hrStateLabel(String k) { final m = hrStateMeta[k]; return m == null ? k : tr(m.$1, m.$2); }
Color hrStateColor(String? k) => hrStateMeta[k ?? '']?.$3 ?? T.inkSoft;

/// Groups with an expiry date, so renewal applies; RENEWABLE_GROUPS.
const hrRenewableGroups = {'iqama', 'passport', 'contract', 'workPermit', 'medicalInsurance', 'healthCertificate', 'driverCard', 'drivingLicense', 'visa', 'ajeer'};

/// Remaining-days column name per expiry; EXPIRY_FIELDS.
const hrExpiryFields = {
  'iqamaExpiry': ('المدة بالأيام — الإقامة', 'Days left — Iqama'),
  'passportExpiry': ('المدة بالأيام — الجواز', 'Days left — Passport'),
  'contractEndDate': ('المدة بالأيام — العقد', 'Days left — Contract'),
  'workPermitExpiry': ('المدة بالأيام — رخصة العمل', 'Days left — Work permit'),
  'insuranceExpiry': ('المدة بالأيام — التأمين', 'Days left — Insurance'),
  'healthCertExpiry': ('المدة بالأيام — الشهادة الصحية', 'Days left — Health certificate'),
  'driverCardExpiry': ('المدة بالأيام — بطاقة السائق', 'Days left — Driver card'),
  'licenseExpiry': ('المدة بالأيام — رخصة القيادة', 'Days left — Driving licence'),
};

/// Days until the date: negative if past, `null` if it has no date.
int? hrDaysUntil(dynamic v) {
  final d = hrParse(v);
  if (d == null) return null;
  final a = DateTime(d.year, d.month, d.day);
  final n = DateTime.now();
  return a.difference(DateTime(n.year, n.month, n.day)).inDays;
}

String hrDaysText(dynamic n) {
  if (n is! num) return '—';
  if (n < 0) return tr('متأخر ${n.abs()} يوم', '${n.abs()}d overdue');
  return tr('$n يوم', '${n}d');
}

Color hrDaysColor(int? n) => n == null ? T.inkFaint : n < 0 ? T.danger : n <= 30 ? const Color(0xFFEA580C) : n <= 90 ? const Color(0xFFF59E0B) : T.success;

String _fmtDate(dynamic v) {
  final d = hrParse(v);
  return d == null ? (v == null || '$v'.isEmpty ? '—' : '$v') : hrIso(d);
}

/// Cell value as displayed; displayValue in MasterCell.
String hrDisplayValue(Map<String, dynamic> f, dynamic raw) {
  if (f['type'] == 'date') return _fmtDate(raw);
  if (f['type'] == 'number') { final n = num.tryParse('${raw ?? ''}'); return n == null || n == 0 ? '—' : '$n'; }
  if (f['type'] == 'bool') return raw == true ? tr('نعم', 'Yes') : raw == false ? tr('لا', 'No') : '—';
  if (f['cashPayroll'] == true && '${raw ?? ''}'.trim().toLowerCase() == 'cash') return tr('راتب نقدي', 'Cash payroll');
  return raw == null || '$raw'.isEmpty ? '—' : '$raw';
}

const _lockedKeys = {'workStatusText', 'systemStatus', 'employmentStatus'};

/// Edit a single field, like MasterCell. The value and its status ("not required", ...) are chosen together; save is PATCH .../fields. Work status and in-system are not written from the cell, and "not working" is reverted through reactivation. Returns true if anything changed.
Future<bool> hrEditCell(BuildContext context, {
  required String employeeId,
  required Map<String, dynamic> field,
  required dynamic raw,
  required Map<String, List<String>> choices,
}) async {
  final key = '${field['key']}';
  final label = Lang.instance.ar ? '${field['ar']}' : '${field['en']}';
  // Leave statuses are not a termination: no reinstate.
  if (key == 'workStatusText' && RegExp(r'^لا يعمل').hasMatch('${raw ?? ''}') && !'${raw ?? ''}'.contains('إجازة')) {
    if (!await hrConfirm(context, tr('إعادة هذا الموظف إلى الخدمة؟ تصير حالته «يعمل» ويعود عقده كما كان.', 'Return this employee to service? Status becomes "working" and the contract is restored.'), ok: tr('إعادته للخدمة', 'Reinstate'))) return false;
    try {
      await Api.instance.post('/api/hr/employees/$employeeId/reactivate', {});
      if (context.mounted) hrSnack(context, tr('عاد إلى الخدمة', 'Back in service'));
      return true;
    } catch (e) { if (context.mounted) hrSnack(context, e.toString()); return false; }
  }
  if (_lockedKeys.contains(key) || field['readOnly'] == true) {
    hrSnack(context, field['readOnly'] == true ? tr('يُقرأ من سجل المركبات', 'Read from the vehicle registry') : tr('تتغيّر بإنهاء الخدمة أو إعادة التفعيل من ملفّ الموظّف', 'Changes via end of service / reactivation in the employee file'));
    return false;
  }
  final type = '${field['type']}';
  final isChoice = field['choice'] == true;
  final strict = field['strict'] == true;
  final ctrl = TextEditingController(text: type == 'date' ? (hrParse(raw) == null ? '' : hrIso(hrParse(raw)!)) : '${raw ?? ''}');
  DateTime? date = type == 'date' ? hrParse(raw) : null;
  String boolVal = raw == true ? '1' : raw == false ? '0' : '';
  String mark = '';
  final opts = [...(choices[key] ?? const <String>[])]..removeWhere((o) => field['cashPayroll'] == true && o.toLowerCase() == 'cash');
  if (field['cashPayroll'] == true) opts.insert(0, 'cash');
  final ok = await hrSheet(context, title: label, body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    if (type == 'date')
      HrDateButton(label: label, value: date, onChanged: (d) => setS(() => date = d))
    else if (type == 'bool')
      DropdownButtonFormField<String>(
        initialValue: boolVal,
        items: [
          const DropdownMenuItem(value: '', child: Text('—')),
          DropdownMenuItem(value: '1', child: Text(tr('نعم', 'Yes'))),
          DropdownMenuItem(value: '0', child: Text(tr('لا', 'No'))),
        ],
        onChanged: (v) => setS(() => boolVal = v ?? ''),
      )
    else ...[
      TextField(
        controller: ctrl,
        readOnly: isChoice && strict,
        keyboardType: type == 'number' ? const TextInputType.numberWithOptions(decimal: true) : null,
        decoration: InputDecoration(labelText: label, hintText: type == 'hijri' ? '1448-05-07' : null),
      ),
      if (isChoice)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            icon: const Icon(Icons.list_alt_outlined, size: 18),
            label: Text(tr('اختر من القائمة', 'Pick from the list')),
            onPressed: () async {
              final v = await pickFromList(c, title: label, options: opts, current: ctrl.text);
              if (v != null) setS(() => ctrl.text = v);
            },
          ),
        ),
    ],
    const SizedBox(height: 10),
    DropdownButtonFormField<String>(
      initialValue: mark,
      decoration: InputDecoration(labelText: tr('حالة الخانة', 'Field status')),
      items: [
        DropdownMenuItem(value: '', child: Text(tr('الحالة: كما هي', 'Status: unchanged'))),
        DropdownMenuItem(value: 'required', child: Text(tr('مطلوب', 'Required'))),
        DropdownMenuItem(value: 'not_required', child: Text(tr('غير مطلوب', 'Not required'))),
        DropdownMenuItem(value: 'none', child: Text(tr('لا يوجد', 'None'))),
        DropdownMenuItem(value: 'inactive', child: Text(tr('غير نشط', 'Inactive'))),
        DropdownMenuItem(value: 'clear', child: Text(tr('بلا علامة', 'Clear'))),
      ],
      onChanged: (v) => setS(() => mark = v ?? ''),
    ),
  ]));
  if (!ok) return false;
  final value = type == 'date' ? (date == null ? '' : hrIso(date!)) : type == 'bool' ? boolVal : ctrl.text.trim();
  try {
    await Api.instance.patch('/api/hr/master/employees/$employeeId/fields', {
      'fields': {key: value},
      if (mark.isNotEmpty) 'markStatus': {key: mark},
    });
    if (context.mounted) hrSnack(context, tr('تم الحفظ', 'Saved'));
    return true;
  } catch (e) {
    if (context.mounted) hrSnack(context, e.toString());
    return false;
  }
}

Future<Map<String, List<String>>> hrLoadChoices() async {
  try {
    final c = Map<String, dynamic>.from((await Api.instance.get('/api/hr/master/choices'))['choices'] ?? {});
    return { for (final e in c.entries) e.key: [for (final x in List<Map<String, dynamic>>.from(e.value)) '${x['value']}'] };
  } catch (_) { return {}; }
}

void hrOpenProfile(BuildContext context, String id) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: id)));

const _filterLabels = {
  'employment': ('حالة التوظيف', 'Employment'),
  'outsideKingdom': ('خارج المملكة', 'Outside kingdom'),
  'freelancer': ('عمل حر', 'Freelancer'),
};
Map<String, String> get _extraLabels => {for (final e in _filterLabels.entries) e.key: tr(e.value.$1, e.value.$2)};

// Group page: residences, passports, contracts, insurance, banks, ... at /master/[group].
class HrMasterGroupScreen extends StatefulWidget {
  final String group;
  /// Carried from the tapped number: dashboard filters plus field/status/state/withinDays.
  final Map<String, String> initial;
  /// Inside a tab (contract data): no title bar of its own.
  final bool embedded;
  const HrMasterGroupScreen({super.key, required this.group, this.initial = const {}, this.embedded = false});
  @override
  State<HrMasterGroupScreen> createState() => _HrMasterGroupScreenState();
}

const _ctrlKeys = ['field', 'status', 'state', 'withinDays', 'sort', 'dir', 'includeExpired', 'q'];
const _statusKeys = ['required', 'not_required', 'filled', 'none', 'cash_payroll', 'inactive', 'unparseable'];
const _empMeta = {
  'terminated': ('أُنهيت خدمته', 'Terminated', T.danger),
  'on_leave': ('في إجازة', 'On leave', T.warn),
  'suspended': ('موقوف', 'Suspended', Color(0xFFEA580C)),
  'active': ('على رأس العمل', 'Active', T.success),
};

class _HrMasterGroupScreenState extends State<HrMasterGroupScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  late Map<String, String> _filters;
  String _q = '';
  String _field = '';
  String _status = '';
  String _state = '';
  String _within = '';
  bool _includeExpired = true;
  final Set<String> _picked = {};
  Map<String, List<String>> _choices = {};
  int _seq = 0;
  Timer? _debounce;
  final _withinCtrl = TextEditingController();
  // The field sits in a list that collapses on scroll; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  late final void Function() _onLive;

  String get g => widget.group;
  bool get _canEdit => hrCanEdit(context);
  bool get _renewable => hrRenewableGroups.contains(g);
  Map<String, dynamic> get _group => Map<String, dynamic>.from((_d?['group'] as Map?) ?? const {});
  List<Map<String, dynamic>> get _fields => List<Map<String, dynamic>>.from(_group['fields'] ?? const []);
  List<Map<String, dynamic>> get _rows => List<Map<String, dynamic>>.from(_d?['rows'] ?? const []);
  Map<String, dynamic> get _summary => Map<String, dynamic>.from((_d?['summary'] as Map?) ?? const {});
  bool get _showWhyInactive => _filters['employment'] == 'inactive' && g != 'contract';
  String get _title => _group.isEmpty ? g : (Lang.instance.ar ? '${_group['ar']}' : '${_group['en']}');

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    _filters = {for (final e in i.entries) if (!_ctrlKeys.contains(e.key) && e.value.isNotEmpty) e.key: e.value};
    _field = i['field'] ?? '';
    _status = i['status'] ?? '';
    _state = i['state'] ?? '';
    _within = i['withinDays'] ?? '';
    _withinCtrl.text = _within;
    _load();
    hrLoadChoices().then((c) { if (mounted) setState(() => _choices = c); });
    _onLive = () => _load();
    // What is written on the contracts page (create, terminate, delete) changes the contract status here.
    Live.instance.on('hr:master', _onLive);
    Live.instance.on('hr:contract', _onLive);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    Live.instance.off('hr:master', _onLive);
    Live.instance.off('hr:contract', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Map<String, String> _params({bool bare = false}) => bare ? {} : {
    'q': _q.trim(), 'field': _field, 'status': _status, 'state': _state, 'withinDays': _within,
    // "Inactive" here is a field state, not an employment status; see legacyEmploymentStatus on the server.
    'statusKind': 'cell',
    'includeExpired': _includeExpired ? '1' : '0',
    ..._filters,
  };

  /// Counters and table come from one guarded response; an older one never overwrites a newer one.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/hr/master/records/$g${hrQs(_params())}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  /// Selection is cleared when filters change, so a row that left the result is not left selected unseen.
  void _changed(VoidCallback f) {
    setState(() { f(); _picked.clear(); });
    _load();
  }

  // Export: what is shown, or the whole group without filters.
  List<ExportCol> get _exportCols {
    final fields = _fields;
    final keys = fields.map((f) => '${f['key']}').toSet();
    String? daysAfter(Map<String, dynamic> f) {
      final k = '${f['key']}';
      if (k.endsWith('Hijri')) { final base = k.substring(0, k.length - 5); return hrExpiryFields.containsKey(base) ? base : null; }
      if (!hrExpiryFields.containsKey(k)) return null;
      return keys.contains('${k}Hijri') ? null : k;
    }
    return [
      ExportCol('الرقم الوظيفي', 'Employee no.', (r) => r['employeeNumber'] ?? ''),
      ExportCol('الاسم', 'Name', (r) => r['name'] ?? ''),
      ExportCol('رقم الهوية', 'ID number', (r) => r['iqamaNumber'] ?? ''),
      // The commercial registration the employee is on, like the web. Uses the same link rule (backend utils/hrEngagement).
      ExportCol('السجل', 'Commercial register', (r) {
        final v = '${r['registerNumber'] ?? ''}'.trim();
        if (v.isEmpty) return tr('غير محدّد', 'Not specified');
        if (RegExp(r'فري\s*لانس|فريلانس|freelanc', caseSensitive: false).hasMatch(v)) return tr('فريلانسر', 'Freelancer');
        if (RegExp(r'تدريب|متدرب|trainee', caseSensitive: false).hasMatch(v)) return tr('متدرّب', 'Trainee');
        return v;
      }),
      ExportCol('القسم', 'Department', (r) => r['department'] ?? ''),
      if (_showWhyInactive) ...[
        ExportCol('حالة التوظيف', 'Employment', (r) { final m = _empMeta['${r['employmentStatus']}']; return m == null ? '${r['employmentStatus'] ?? '—'}' : tr(m.$1, m.$2); }),
        ExportCol('حالة العقد', 'Contract status', (r) { final v = '${((r['values'] as Map?) ?? const {})['contractStatusText'] ?? ''}'.trim(); return v.isNotEmpty ? v : tr('غير مسجَّلة', 'not recorded'); }),
      ],
      for (final f in fields) ...[
        ExportCol('${f['ar']}', '${f['en']}', (r) {
          final st = '${((r['statuses'] as Map?) ?? const {})[f['key']] ?? ''}';
          if (st == 'required') return tr('مطلوب', 'Required');
          if (st == 'not_required') return tr('غير مطلوب', 'Not required');
          final raw = ((r['values'] as Map?) ?? const {})[f['key']];
          return f['type'] == 'date' ? _fmtDate(raw) : (raw ?? '');
        }),
        if (daysAfter(f) != null)
          ExportCol(hrExpiryFields[daysAfter(f)]!.$1, hrExpiryFields[daysAfter(f)]!.$2,
              (r) => hrDaysUntil(((r['values'] as Map?) ?? const {})[daysAfter(f)]) ?? ''),
      ],
    ];
  }

  Future<void> _export(String scope) async {
    var rows = _rows;
    if (scope == 'all') {
      try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/master/records/$g'))['rows'] ?? []); }
      catch (e) { if (mounted) hrSnack(context, e.toString()); return; }
    }
    if (!mounted) return;
    exportExcel(context, fileName: 'hr-$g', sheets: [(_title, _exportCols, rows)]);
  }

  // Renew a single document: writes the new date and records who renewed it and from which date.
  Future<void> _renew(Map<String, dynamic> r) async {
    final ef = '${_group['expiryField'] ?? ''}';
    final cur = ef.isEmpty ? null : hrParse(((r['values'] as Map?) ?? const {})[ef]);
    // One year from the existing expiry if it is in the future, otherwise one year from today.
    final now = DateTime.now();
    final from = cur != null && cur.isAfter(now) ? cur : now;
    DateTime? when = DateTime(from.year + 1, from.month, from.day);
    final num = TextEditingController();
    final note = TextEditingController();
    final ok = await hrSheet(context, title: tr('تجديد المستند', 'Renew document'), saveLabel: tr('تجديد', 'Renew'), body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${r['name']} · $_title${cur != null ? ' · ${tr('ينتهي', 'expires')} ${bothDates(cur, ar: Lang.instance.ar)}' : ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      const SizedBox(height: 10),
      HrDateButton(label: '${tr('تاريخ الانتهاء الجديد', 'New expiry')} *', value: when, clearable: false, onChanged: (d) => setS(() => when = d)),
      const SizedBox(height: 10),
      TextField(controller: num, decoration: InputDecoration(labelText: tr('رقم المستند الجديد', 'New document number'), hintText: tr('اتركه فارغًا إن لم يتغيّر', 'Leave blank if unchanged'))),
      const SizedBox(height: 10),
      TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
      const SizedBox(height: 8),
      Text(tr('يُحفَظ التجديد في سجلّ الموظف: التاريخ السابق والجديد ومَن سجّله ومتى.', 'The renewal is kept on the employee record: previous and new date, who logged it and when.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (!ok || when == null) return;
    try {
      await Api.instance.post('/api/hr/master/renew', {
        'employee': r['_id'], 'group': g, 'newExpiry': hrIso(when!),
        'documentNumber': num.text.trim(), 'notes': note.text.trim(),
      });
      if (mounted) hrSnack(context, tr('تم التجديد حتى ${hrIso(when!)}', 'Renewed to ${hrIso(when!)}'));
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  // Bulk renewal with one date: all or nothing, with rejection reasons by row number.
  Future<void> _bulkRenew() async {
    final rows = _rows.where((r) => _picked.contains('${r['_id']}')).toList();
    if (rows.isEmpty) return;
    DateTime? when;
    final note = TextEditingController();
    final today = DateTime.now();
    final ok = await hrSheet(context, title: tr('تجديد جماعي', 'Bulk renewal'),
        saveLabel: tr('تجديد ${rows.length} مستند', 'Renew ${rows.length} documents'),
        body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('${rows.length} مستند من «$_title» سيُجدَّد إلى التاريخ نفسه.', '${rows.length} "$_title" documents will be renewed to the same date.')),
      const SizedBox(height: 10),
      HrDateButton(label: '${tr('تاريخ الانتهاء الجديد', 'New expiry')} *', value: when, first: DateTime(today.year, today.month, today.day), onChanged: (d) => setS(() => when = d)),
      const SizedBox(height: 10),
      TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
    ]));
    if (!ok) return;
    if (when == null) { if (mounted) hrSnack(context, tr('اختر التاريخ أولًا', 'Pick a date first')); return; }
    try {
      final r = await Api.instance.post('/api/hr/master/renew-bulk', {
        'items': [for (final x in rows) {'employee': x['_id'], 'group': g}],
        'newExpiry': hrIso(when!), 'notes': note.text.trim(),
      });
      final s = (r is Map ? r['summary'] : null) as Map? ?? const {};
      if (mounted) hrSnack(context, tr('جُدِّد ${s['count'] ?? rows.length} مستندًا لـ${s['employees'] ?? rows.length} موظفًا', 'Renewed ${s['count'] ?? rows.length} documents for ${s['employees'] ?? rows.length} employees'));
      setState(_picked.clear);
      _load();
    } on ApiException catch (e) {
      final list = e.data['errors'];
      if (list is List && list.isNotEmpty && mounted) {
        await showDialog(context: context, builder: (c) => AlertDialog(
          title: Text(tr('رُفضت العملية كاملةً — لم يُجدَّد أي مستند', 'Rejected in full — nothing was renewed')),
          content: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final x in list) Text(tr('سطر ${(x as Map)['line']}: ${x['message']}', 'Row ${x['line']}: ${x['message']}'), style: const TextStyle(fontSize: 12, color: T.danger)),
          ])),
          actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('حسنًا', 'OK')))],
        ));
      } else if (mounted) { hrSnack(context, e.message); }
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  // Add or edit group data, HrGroupFormModal.
  Future<void> _groupForm(Map<String, dynamic>? row) async {
    final fields = _fields.where((f) => f['readOnly'] != true && f['type'] != 'hijri' && !_lockedKeys.contains(f['key'])).toList();
    Map<String, dynamic>? target = row;
    if (target == null) {
      // The list ignores the screen filters: an employee missing the document is often outside the current filter.
      List<Map<String, dynamic>> pool;
      try { pool = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/master/records/$g'))['rows'] ?? []); }
      catch (e) { if (mounted) hrSnack(context, e.toString()); return; }
      int filled(Map<String, dynamic> r) => fields.where((f) => ((r['statuses'] as Map?) ?? const {})[f['key']] == 'filled').length;
      int req(Map<String, dynamic> r) => fields.where((f) => ((r['statuses'] as Map?) ?? const {})[f['key']] == 'required').length;
      // Employees with no data in the group come first; that is the screen's purpose.
      pool.sort((a, b) { final x = filled(a) - filled(b); return x != 0 ? x : ((b['missing'] as List?)?.length ?? 0) - ((a['missing'] as List?)?.length ?? 0); });
      if (!mounted) return;
      target = await pickHrEmployee(context, rows: pool,
          hintOf: (r) => [r['employeeNumber'], r['iqamaNumber'], r['department']].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
          badgeOf: (r) {
            final d = filled(r); final q = req(r);
            return d == 0 ? (tr('لا بيانات في هذه المجموعة', 'No data in this group'), T.info)
                : q > 0 ? (tr('ناقص $q', '$q required'), T.warn) : (tr('مكتمل $d/${fields.length}', '$d/${fields.length} filled'), T.success);
          });
      if (target == null || !mounted) return;
    }
    final t = target;
    final vals = Map<String, dynamic>.from((t['values'] as Map?) ?? const {});
    final sts = Map<String, dynamic>.from((t['statuses'] as Map?) ?? const {});
    String asInput(Map<String, dynamic> f) {
      final v = vals[f['key']];
      if (f['type'] == 'date') { final d = hrParse(v); return d == null ? '' : hrIso(d); }
      if (f['type'] == 'bool') return v == true ? '1' : v == false ? '0' : '';
      return v == null ? '' : '$v';
    }
    final base = {for (final f in fields) '${f['key']}': asInput(f)};
    final form = Map<String, String>.from(base);
    final marks = <String, String>{};
    final ctrls = {for (final f in fields) if (f['type'] != 'date' && f['type'] != 'bool') '${f['key']}': TextEditingController(text: base['${f['key']}'])};
    final ok = await hrSheet(context,
        title: row == null ? tr('إضافة بيانات — $_title', 'Add data — $_title') : tr('تعديل — $_title', 'Edit — $_title'),
        body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text([t['name'], t['employeeNumber'], t['department']].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 8),
      for (final f in fields) Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(Lang.instance.ar ? '${f['ar']}' : '${f['en']}', style: const TextStyle(fontSize: 12, color: T.inkSoft))),
            if ('${sts[f['key']] ?? ''}'.isNotEmpty) Chip2(hrStatusLabel('${sts[f['key']]}'), hrStatusMeta['${sts[f['key']]}']?.$3 ?? T.inkSoft),
          ]),
          const SizedBox(height: 4),
          if (f['type'] == 'date')
            HrDateButton(label: Lang.instance.ar ? '${f['ar']}' : '${f['en']}', value: hrParse(form['${f['key']}']),
                onChanged: (d) => setS(() => form['${f['key']}'] = d == null ? '' : hrIso(d)))
          else if (f['type'] == 'bool')
            DropdownButtonFormField<String>(
              initialValue: form['${f['key']}'],
              items: [const DropdownMenuItem(value: '', child: Text('—')), DropdownMenuItem(value: '1', child: Text(tr('نعم', 'Yes'))), DropdownMenuItem(value: '0', child: Text(tr('لا', 'No')))],
              onChanged: (v) => setS(() => form['${f['key']}'] = v ?? ''),
            )
          else
            TextField(
              controller: ctrls['${f['key']}'],
              readOnly: f['choice'] == true && f['strict'] == true,
              keyboardType: f['type'] == 'number' ? const TextInputType.numberWithOptions(decimal: true) : null,
              onChanged: (v) => form['${f['key']}'] = v,
              decoration: InputDecoration(isDense: true, suffixIcon: f['choice'] == true ? IconButton(
                icon: const Icon(Icons.list_alt_outlined, size: 18),
                onPressed: () async {
                  final v = await pickFromList(c, title: Lang.instance.ar ? '${f['ar']}' : '${f['en']}', options: _choices['${f['key']}'] ?? const [], current: form['${f['key']}'] ?? '');
                  if (v != null) setS(() { form['${f['key']}'] = v; ctrls['${f['key']}']!.text = v; });
                },
              ) : null),
            ),
          // The administrative flag next to the field: "does not apply to this employee" is a decision made at the field.
          DropdownButtonFormField<String>(
            initialValue: marks['${f['key']}'] ?? 'keep',
            isDense: true,
            items: [
              DropdownMenuItem(value: 'keep', child: Text(tr('الحالة: كما هي', 'Status: unchanged'), style: const TextStyle(fontSize: 12))),
              DropdownMenuItem(value: 'required', child: Text(tr('علّمه: مطلوب', 'Mark: required'), style: const TextStyle(fontSize: 12))),
              DropdownMenuItem(value: 'not_required', child: Text(tr('علّمه: غير مطلوب', 'Mark: not required'), style: const TextStyle(fontSize: 12))),
              DropdownMenuItem(value: 'inactive', child: Text(tr('علّمه: غير نشط', 'Mark: inactive'), style: const TextStyle(fontSize: 12))),
              DropdownMenuItem(value: 'clear', child: Text(tr('ارفع العلامة (بحسب القيمة)', 'Clear the flag (derive from value)'), style: const TextStyle(fontSize: 12))),
            ],
            onChanged: (v) => setS(() => marks['${f['key']}'] = v ?? 'keep'),
          ),
        ]),
      ),
    ]));
    if (!ok) return;
    // Only changed fields are sent, and a flagged field is sent with its current value (the server rejects a request with no fields).
    final changed = fields.where((f) => (form['${f['key']}'] ?? '') != (base['${f['key']}'] ?? '')).map((f) => '${f['key']}').toSet();
    final marked = marks.entries.where((e) => e.value != 'keep').map((e) => e.key).toSet();
    if (changed.isEmpty && marked.isEmpty) { if (mounted) hrSnack(context, tr('لا يوجد تغيير لحفظه', 'Nothing changed')); return; }
    try {
      final res = await Api.instance.patch('/api/hr/master/employees/${t['_id']}/fields', {
        'fields': {for (final k in {...changed, ...marked}) k: form[k] ?? ''},
        if (marked.isNotEmpty) 'markStatus': {for (final k in marked) k: marks[k]},
      });
      final rej = (res is Map ? res['rejected'] : null) as List? ?? const [];
      if (mounted) hrSnack(context, rej.isNotEmpty ? tr('حقول لم تُقبل: ${rej.join('، ')}', 'Rejected: ${rej.join(', ')}') : tr('تم الحفظ', 'Saved'));
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  // Clear the group's data for one employee; this does not delete the employee.
  Future<void> _clear(Map<String, dynamic> r) async {
    final fields = _fields.where((f) => f['readOnly'] != true && f['type'] != 'hijri' && !_lockedKeys.contains(f['key'])).toList();
    final vals = Map<String, dynamic>.from((r['values'] as Map?) ?? const {});
    final sts = Map<String, dynamic>.from((r['statuses'] as Map?) ?? const {});
    final has = fields.where((f) { final v = vals[f['key']]; return !(v == null || '$v'.isEmpty || (v is List && v.isEmpty)); }).toList();
    if (has.isEmpty) { hrSnack(context, tr('لا بيانات في هذه المجموعة لتُفرَّغ.', 'There is no data in this group to clear.')); return; }
    bool reRequire = true;
    final ok = await hrSheet(context, title: tr('تفريغ بيانات $_title', 'Clear $_title data'),
        saveLabel: tr('تفريغ ${has.length} حقل', 'Clear ${has.length} fields'),
        body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('ستُفرَّغ بيانات «$_title» عند ${r['name']} وحدَه.', '"$_title" data for ${r['name']} will be emptied.')),
      const SizedBox(height: 8),
      for (final f in has) Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(Lang.instance.ar ? '${f['ar']}' : '${f['en']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
          Flexible(child: Text(hrDisplayValue(f, vals[f['key']]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), overflow: TextOverflow.ellipsis)),
        ]),
      ),
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        value: reRequire,
        onChanged: (v) => setS(() => reRequire = v ?? true),
        title: Text(tr('أعِد الحقول المُفرَّغة إلى «مطلوب»', 'Put the emptied fields back to "Required"'), style: const TextStyle(fontSize: 13)),
        subtitle: Text(tr('لا يمسّ ما هو مُعلَّم «غير مطلوب» — ذاك قرار إداريّ.', 'Fields marked "Not required" are left alone.'), style: const TextStyle(fontSize: 11)),
      ),
      Text(tr('هذا تفريغ بياناتٍ لا حذفُ موظّف.', 'This clears data, it does not delete the employee.'), style: const TextStyle(fontSize: 11.5, color: T.warn)),
    ]));
    if (!ok) return;
    try {
      final mark = {for (final f in has) if (reRequire && sts[f['key']] == 'filled') '${f['key']}': 'required'};
      await Api.instance.patch('/api/hr/master/employees/${r['_id']}/fields', {
        'fields': {for (final f in has) '${f['key']}': ''},
        if (mark.isNotEmpty) 'markStatus': mark,
      });
      if (mounted) hrSnack(context, tr('تم تفريغ بيانات المجموعة', 'Group data cleared'));
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  Future<void> _openFilter() async {
    final r = await showFilterSheet(context: context, optionsUrl: '/api/hr/master/filters', value: _filters, extraLabels: _extraLabels);
    if (r != null && mounted) _changed(() => _filters = r);
  }

  Widget _rowCard(Map<String, dynamic> r) {
    final id = '${r['_id']}';
    final vals = Map<String, dynamic>.from((r['values'] as Map?) ?? const {});
    final sts = Map<String, dynamic>.from((r['statuses'] as Map?) ?? const {});
    final isDoc = _group['document'] == true;
    final sel = _renewable && _canEdit;
    final on = _picked.contains(id);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        topAccent: isDoc && r['state'] != null ? hrStateColor('${r['state']}') : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (sel) Checkbox(value: on, activeColor: T.orange, onChanged: (_) => setState(() => on ? _picked.remove(id) : _picked.add(id))),
            Expanded(child: InkWell(
              onTap: () => hrOpenProfile(context, id),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                Text([r['employeeNumber'], r['iqamaNumber'], r['department']].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ]),
            )),
            if (isDoc) Text(r['daysRemaining'] == null ? '—' : hrDaysText(r['daysRemaining']),
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: hrStateColor('${r['state']}'))),
            if (_canEdit)
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert, color: T.inkFaint, size: 20),
                onSelected: (v) {
                  if (v == 'renew') _renew(r);
                  if (v == 'edit') _groupForm(r);
                  if (v == 'clear') _clear(r);
                },
                itemBuilder: (_) => [
                  if (sel) PopupMenuItem(value: 'renew', child: Row(children: [const Icon(Icons.autorenew_rounded, size: 18, color: T.success), const SizedBox(width: 10), Text(tr('تجديد', 'Renew'))])),
                  PopupMenuItem(value: 'edit', child: Row(children: [const Icon(Icons.edit_outlined, size: 18, color: T.navy), const SizedBox(width: 10), Text(tr('تعديل بيانات المجموعة', 'Edit this group\'s data'))])),
                  PopupMenuItem(value: 'clear', child: Row(children: [const Icon(Icons.delete_sweep_outlined, size: 18, color: T.danger), const SizedBox(width: 10), Text(tr('تفريغ بيانات المجموعة', 'Clear this group\'s data'))])),
                ],
              ),
          ]),
          if (_showWhyInactive)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Wrap(spacing: 6, children: [
                Builder(builder: (_) { final m = _empMeta['${r['employmentStatus']}']; return Chip2(m == null ? '${r['employmentStatus'] ?? '—'}' : tr(m.$1, m.$2), m?.$3 ?? T.inkSoft); }),
                Builder(builder: (_) {
                  final cs = '${vals['contractStatusText'] ?? ''}'.trim();
                  return Chip2(cs.isNotEmpty ? cs : tr('غير مسجَّلة', 'not recorded'), RegExp('انهاء|إنهاء|فسخ|غير ساري|منته').hasMatch(cs) ? T.danger : T.inkFaint);
                }),
              ]),
            ),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final f in _fields)
              Builder(builder: (_) {
                final st = '${sts[f['key']] ?? ''}';
                final raw = vals[f['key']];
                final flagged = ['required', 'not_required', 'none', 'cash_payroll', 'inactive'].contains(st) && (raw == null || '$raw'.isEmpty);
                final text = flagged ? hrStatusLabel(st) : hrDisplayValue(f, raw);
                final color = flagged ? (hrStatusMeta[st]?.$3 ?? T.inkSoft) : T.ink;
                final days = hrExpiryFields.containsKey(f['key']) ? hrDaysUntil(raw) : null;
                return InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: !_canEdit ? null : () async {
                    final changed = await hrEditCell(context, employeeId: id, field: f, raw: raw, choices: _choices);
                    if (changed) _load();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                    decoration: BoxDecoration(
                      color: st == 'required' ? T.danger.withValues(alpha: 0.06) : const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      Text(Lang.instance.ar ? '${f['ar']}' : '${f['en']}', style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                      Text(text, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
                      if (days != null) Text(hrDaysText(days), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: hrDaysColor(days))),
                    ]),
                  ),
                );
              }),
          ]),
        ]),
      ),
    );
  }

  Widget _body() {
    final d = _d;
    if (d == null) {
      return _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    }
    final rows = _rows;
    final sum = _summary;
    final isDoc = _group['document'] == true;
    final states = sum['states'] is Map ? Map<String, dynamic>.from(sum['states']) : null;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
        HrQuickFilters(value: _filters, onChanged: (v) => _changed(() => _filters = Map.of(v))),
        if (_filters.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final e in _filters.entries)
                InputChip(
                  label: Text('${_filterLabels[e.key] == null ? e.key : tr(_filterLabels[e.key]!.$1, _filterLabels[e.key]!.$2)}: ${e.value}', style: const TextStyle(fontSize: 11.5)),
                  onDeleted: () => _changed(() => _filters.remove(e.key)),
                ),
            ]),
          ),
        const SizedBox(height: 8),
        // Status counters per field; tapping drills into its owners.
        Text(tr('حالة كل حقل لدى ${sum['population'] ?? rows.length} موظفًا — اضغط أي رقم لعرض أصحابه', 'Status of every field across ${sum['population'] ?? rows.length} employees — tap a number to list them'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        const SizedBox(height: 6),
        for (final f in _fields)
          Builder(builder: (_) {
            final s = (sum['${f['key']}'] as Map?) ?? const {};
            final chips = [for (final k in _statusKeys) if (((s[k] ?? 0) as num) > 0) k];
            if (chips.isEmpty) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: AppCard(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                // Name and numbers on one line; a two-line card per field filled the screen with empty space.
                child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                  Expanded(child: Text(Lang.instance.ar ? '${f['ar']}' : '${f['en']}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                  const SizedBox(width: 8),
                  Flexible(child: Wrap(alignment: WrapAlignment.end, spacing: 6, runSpacing: 6, children: [
                    for (final k in chips)
                      ChoiceChip(
                        visualDensity: VisualDensity.compact,
                        selected: _field == f['key'] && _status == k,
                        selectedColor: (hrStatusMeta[k]?.$3 ?? T.navy).withValues(alpha: 0.25),
                        label: Text('${hrStatusLabel(k)} ${s[k]}', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: hrStatusMeta[k]?.$3 ?? T.ink)),
                        onSelected: (_) {
                          final off = _status == k && _field == f['key'];
                          _changed(() { _field = '${f['key']}'; _status = off ? '' : k; });
                        },
                      ),
                  ])),
                ]),
              ),
            );
          }),
        if (_state == 'attention')
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              Expanded(child: Text(tr('المعروض: المنتهي والقريب من الانتهاء فقط', 'Showing expired and nearing expiry only'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.danger, fontSize: 12.5))),
              TextButton(onPressed: () => _changed(() => _state = ''), child: Text(tr('عرض الكل', 'Show all'))),
            ]),
          ),
        if (isDoc && states != null)
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final k in const ['expired', 'critical', 'warning', 'valid', 'missing', 'not_applicable'])
              ChoiceChip(
                selected: _state == k,
                selectedColor: hrStateColor(k).withValues(alpha: 0.25),
                label: Text('${hrStateLabel(k)} ${states[k] ?? 0}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: hrStateColor(k))),
                onSelected: (_) => _changed(() => _state = _state == k ? '' : k),
              ),
          ]),
        const SizedBox(height: 10),
        // Search, field, status and window.
        SearchField(
          controller: _searchCtl, dense: true,
          onChanged: (v) {
            _q = v;
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), () { if (mounted) _changed(() {}); });
          },
          hint: tr('اسم / رقم وظيفي / رقم هوية…', 'name / employee no / ID…'),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: DropdownButtonFormField<String>(
            initialValue: _fields.any((f) => f['key'] == _field) ? _field : '',
            isExpanded: true,
            isDense: true,
            items: [
              DropdownMenuItem(value: '', child: Text(tr('كل الحقول', 'All fields'))),
              for (final f in _fields) DropdownMenuItem(value: '${f['key']}', child: Text(Lang.instance.ar ? '${f['ar']}' : '${f['en']}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => _changed(() => _field = v ?? ''),
          )),
          const SizedBox(width: 8),
          Expanded(child: DropdownButtonFormField<String>(
            initialValue: _status,
            isExpanded: true,
            isDense: true,
            items: [
              DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All statuses'))),
              for (final k in _statusKeys)
                if (_status == k || _fields.any((f) => ((((sum['${f['key']}'] as Map?) ?? const {})[k] ?? 0) as num) > 0))
                  DropdownMenuItem(value: k, child: Text(hrStatusLabel(k))),
            ],
            onChanged: (v) => _changed(() => _status = v ?? ''),
          )),
        ]),
        if (isDoc) ...[
          const SizedBox(height: 8),
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 6, runSpacing: 6, children: [
            Text(tr('ينتهي خلال', 'Within'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            SizedBox(width: 70, child: TextField(
              controller: _withinCtrl,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              decoration: const InputDecoration(isDense: true),
              onChanged: (v) {
                _within = v.trim();
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 400), () => _changed(() {}));
              },
            )),
            for (final n in const [30, 60, 90, 180])
              ChoiceChip(
                visualDensity: VisualDensity.compact,
                selected: _within == '$n',
                selectedColor: T.orange.withValues(alpha: 0.3),
                label: Text('$n', style: const TextStyle(fontSize: 11.5)),
                onSelected: (_) => _changed(() { _within = '$n'; _withinCtrl.text = '$n'; }),
              ),
            FilterChip(
              visualDensity: VisualDensity.compact,
              selected: _includeExpired,
              label: Text(tr('مع المنتهي', 'incl. expired'), style: const TextStyle(fontSize: 11.5)),
              onSelected: (v) => _changed(() => _includeExpired = v),
            ),
          ]),
        ],
        Row(children: [
          if (_q.isNotEmpty || _field.isNotEmpty || _status.isNotEmpty || _state.isNotEmpty || _within.isNotEmpty)
            // "Clear filters" also clears the search word; it used to show because of it without clearing it.
            TextButton(onPressed: () => _changed(() { _debounce?.cancel(); _q = ''; _searchCtl.clear(); _field = ''; _status = ''; _state = ''; _within = ''; _withinCtrl.clear(); }), child: Text(tr('إلغاء الفلترة', 'Clear'))),
          const Spacer(),
          Text('${rows.length} ${tr('موظف', 'people')}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
          if (_renewable && _canEdit && rows.isNotEmpty)
            TextButton(
              onPressed: () => setState(() {
                final all = rows.every((x) => _picked.contains('${x['_id']}'));
                for (final x in rows) { all ? _picked.remove('${x['_id']}') : _picked.add('${x['_id']}'); }
              }),
              child: Text(tr('تحديد الكل', 'Select all')),
            ),
        ]),
        if (rows.isEmpty) EmptyState(icon: Icons.search_off, title: tr('لا نتائج تطابق هذه الفلاتر', 'Nothing matches these filters')),
        for (final r in rows) _rowCard(r),
        const SizedBox(height: 70),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bar = _picked.isEmpty ? null : SafeArea(
      child: Container(
        color: T.success.withValues(alpha: 0.08),
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
        child: Row(children: [
          Expanded(child: Text(tr('${_picked.length} مستند محدَّد — يُسجَّل لها تاريخ تجديد واحد', '${_picked.length} selected — all get one renewal date'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
          TextButton(onPressed: () => setState(_picked.clear), child: Text(tr('إلغاء', 'Clear'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: _bulkRenew,
              child: Text(tr('تجديد (${_picked.length})', 'Renew (${_picked.length})'))),
        ]),
      ),
    );
    final actions = [
      IconButton(
        tooltip: tr('التصفية', 'Filter'),
        icon: Badge(isLabelVisible: _filters.isNotEmpty, label: Text('${_filters.length}'), child: const Icon(Icons.tune)),
        onPressed: _openFilter,
      ),
      PopupMenuButton<String>(
        icon: const Icon(Icons.file_download_outlined),
        tooltip: tr('تصدير Excel', 'Export to Excel'),
        onSelected: _export,
        itemBuilder: (_) => [
          PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
          PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
        ],
      ),
      if (_canEdit) IconButton(tooltip: tr('إضافة بيانات', 'Add data'), icon: const Icon(Icons.add_circle_outline), onPressed: () => _groupForm(null)),
    ];
    if (widget.embedded) {
      return Column(children: [
        Align(alignment: AlignmentDirectional.centerEnd, child: Row(mainAxisSize: MainAxisSize.min, children: actions)),
        Expanded(child: _body()),
        if (bar != null) bar,
      ]);
    }
    return AppScaffold(
      title: Text(_title),
      actions: actions,
      body: Column(children: [Expanded(child: _body()), if (bar != null) bar]),
    );
  }
}

// Expiries section, /master/expiring.
class HrExpiringScreen extends StatefulWidget {
  final Map<String, String> initial;
  const HrExpiringScreen({super.key, this.initial = const {}});
  @override
  State<HrExpiringScreen> createState() => _HrExpiringScreenState();
}

const _facets = [
  ('registerNumber', 'السجل', 'Register'), ('engagement', 'نوع التعاقد', 'Engagement'), ('department', 'القسم', 'Department'),
  ('project', 'المشروع', 'Project'), ('nationality', 'الجنسية', 'Nationality'), ('branchName', 'الفرع', 'Branch'), ('workState', 'حالة العمل', 'Work status'),
];
const _workLabel = {'working': ('يعمل', 'Working'), 'notWorking': ('لا يعمل', 'Not working')};
const _engLabel = {'sponsored': ('على الكفالة', 'Sponsored'), 'freelance': ('فري لانسر', 'Freelance'), 'trainee': ('متدرّب', 'Trainee'), 'none': ('غير محدّد', 'Not set')};

class _HrExpiringScreenState extends State<HrExpiringScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  late String _within;
  late String _doc;
  late String _state;
  late bool _includeExpired;
  late Map<String, String> _filters;
  String _q = '';
  int _seq = 0;
  Timer? _debounce;
  final _withinCtrl = TextEditingController();
  final _qCtrl = TextEditingController();
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    _qCtrl.text = i['q'] ?? '';
    _within = i['withinDays'] ?? '60';
    _withinCtrl.text = _within;
    _doc = i['doc'] ?? '';
    _state = i['state'] ?? '';
    _includeExpired = i['includeExpired'] != '0';
    _q = i['q'] ?? '';
    _filters = {for (final e in i.entries) if (!['withinDays', 'doc', 'state', 'includeExpired', 'q'].contains(e.key) && e.value.isNotEmpty) e.key: e.value};
    _load();
    _onLive = () => _load();
    for (final e in ['hr:master', 'hr:employee', 'hr:contract']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final e in ['hr:master', 'hr:employee', 'hr:contract']) { Live.instance.off(e, _onLive); }
    _qCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/hr/master/expiring${hrQs({
        ..._filters, 'q': _q.trim(), 'withinDays': _within, 'doc': _doc, 'state': _state, 'includeExpired': _includeExpired ? '1' : '0',
      })}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  void _set(VoidCallback f) { setState(f); _load(); }

  List<ExportCol> get _cols => [
        ExportCol('الرقم الوظيفي', 'Employee no.', (r) => r['employeeNumber'] ?? ''),
        ExportCol('الاسم', 'Name', (r) => r['name'] ?? ''),
        ExportCol('رقم الهوية', 'ID number', (r) => r['iqamaNumber'] ?? ''),
        ExportCol('المستند', 'Document', (r) => r['docAr'] ?? ''),
        ExportCol('تاريخ الانتهاء الميلادي', 'Expiry date (Gregorian)', (r) => gregDay(r['expiryDate'])),
        ExportCol('تاريخ الانتهاء الهجري', 'Expiry date (Hijri)', (r) => hijriDay(r['expiryDate'])),
        ExportCol('المتبقي', 'Days left', (r) => r['daysRemaining'] ?? ''),
        ExportCol('الحالة', 'State', (r) => hrStateLabel('${r['state'] ?? ''}')),
        ExportCol('القسم', 'Department', (r) => r['department'] ?? ''),
      ];

  Future<void> _export(String scope) async {
    var rows = List<Map<String, dynamic>>.from(_d?['rows'] ?? const []);
    if (scope == 'all') {
      try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/master/expiring?includeExpired=1'))['rows'] ?? []); }
      catch (e) { if (mounted) hrSnack(context, e.toString()); return; }
    }
    if (!mounted) return;
    exportExcel(context, fileName: 'hr-expiries', sheets: [(tr('الانتهاءات', 'Expiries'), _cols, rows)]);
  }

  Future<void> _pickFacet(String key, String title) async {
    final opts = List<Map<String, dynamic>>.from(((_d?['options'] as Map?) ?? const {})[key] ?? const []);
    String label(String v) => key == 'engagement' ? (_engLabel[v] == null ? v : tr(_engLabel[v]!.$1, _engLabel[v]!.$2))
        : key == 'workState' ? (_workLabel[v] == null ? v : tr(_workLabel[v]!.$1, _workLabel[v]!.$2)) : (v == '—' ? tr('(فارغ)', '(blank)') : v);
    final v = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(child: ListView(shrinkWrap: true, children: [
        ListTile(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
        ListTile(title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, '')),
        for (final o in opts)
          ListTile(
            title: Text(label('${o['value']}')),
            trailing: Text('${o['count'] ?? ''}'),
            selected: _filters[key] == '${o['value']}',
            onTap: () => Navigator.pop(c, '${o['value']}'),
          ),
      ])),
    );
    if (v == null) return;
    _set(() { if (v.isEmpty) { _filters.remove(key); } else { _filters[key] = v; } });
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final rows = List<Map<String, dynamic>>.from(d?['rows'] ?? const []);
    final sum = Map<String, dynamic>.from((d?['summary'] as Map?) ?? const {});
    final byDoc = List<Map<String, dynamic>>.from(d?['byDoc'] ?? const []);
    return AppScaffold(
      title: Text(tr('انتهاءات المستندات', 'Document expiries')),
      actions: [
        PopupMenuButton<String>(
          icon: const Icon(Icons.file_download_outlined),
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
      ],
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                if (_filters.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(color: T.info.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
                    child: Row(children: [
                      Expanded(child: Text(tr('المعروض مقصور على الفلاتر المختارة', 'Limited to the selected filters'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                      TextButton(onPressed: () => _set(() => _filters.clear()), child: Text(tr('عرض الكل', 'Show all'))),
                    ]),
                  ),
                SearchField(
                  controller: _qCtrl, dense: true,
                  onChanged: (v) {
                    _q = v;
                    _debounce?.cancel();
                    _debounce = Timer(const Duration(milliseconds: 300), _load);
                  },
                  hint: tr('ابحث بالاسم أو رقم الهوية أو الرقم الوظيفي', 'Name, ID or employee no.'),
                ),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final f in _facets)
                    ActionChip(
                      backgroundColor: _filters[f.$1] != null ? T.orange : Colors.white,
                      label: Text(_filters[f.$1] != null ? '${tr(f.$2, f.$3)}: ${_filters[f.$1]}' : tr(f.$2, f.$3),
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _filters[f.$1] != null ? Colors.white : T.inkSoft)),
                      onPressed: () => _pickFacet(f.$1, tr(f.$2, f.$3)),
                    ),
                ]),
                const SizedBox(height: 8),
                Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 6, runSpacing: 6, children: [
                  Text(tr('ينتهي خلال', 'Expiring within'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  SizedBox(width: 70, child: TextField(
                    controller: _withinCtrl,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    decoration: const InputDecoration(isDense: true),
                    onChanged: (v) { _within = v.trim(); _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 400), _load); },
                  )),
                  for (final n in const [7, 15, 30, 60, 90, 180])
                    ChoiceChip(
                      visualDensity: VisualDensity.compact,
                      selected: _within == '$n',
                      selectedColor: T.orange.withValues(alpha: 0.3),
                      label: Text('$n', style: const TextStyle(fontSize: 11.5)),
                      onSelected: (_) => _set(() { _within = '$n'; _withinCtrl.text = '$n'; }),
                    ),
                  ChoiceChip(
                    visualDensity: VisualDensity.compact,
                    selected: _within.isEmpty,
                    label: Text(tr('الكل', 'All'), style: const TextStyle(fontSize: 11.5)),
                    onSelected: (_) => _set(() { _within = ''; _withinCtrl.clear(); }),
                  ),
                  FilterChip(
                    visualDensity: VisualDensity.compact,
                    selected: _includeExpired,
                    label: Text(tr('اعرض المنتهي بالفعل', 'Include expired'), style: const TextStyle(fontSize: 11.5)),
                    onSelected: (v) => _set(() => _includeExpired = v),
                  ),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final x in byDoc)
                    ChoiceChip(
                      selected: _doc == x['key'],
                      selectedColor: T.navy.withValues(alpha: 0.2),
                      label: Text('${Lang.instance.ar ? x['ar'] : x['en']} ${x['count'] ?? 0}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                      onSelected: (_) => _set(() => _doc = _doc == x['key'] ? '' : '${x['key']}'),
                    ),
                ]),
                const SizedBox(height: 10),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final k in const ['expired', 'critical', 'warning', 'valid'])
                    ChoiceChip(
                      selected: _state == k,
                      selectedColor: hrStateColor(k).withValues(alpha: 0.25),
                      label: Text('${hrStateLabel(k)} ${sum[k] ?? 0}', style: TextStyle(fontWeight: FontWeight.w800, color: hrStateColor(k))),
                      onSelected: (_) => _set(() => _state = _state == k ? '' : k),
                    ),
                  ChoiceChip(
                    selected: _state.isEmpty,
                    selectedColor: T.navy.withValues(alpha: 0.2),
                    label: Text('${tr('الإجمالي', 'Total')} ${sum['total'] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w800)),
                    onSelected: (_) => _set(() => _state = ''),
                  ),
                ]),
                const SizedBox(height: 8),
                Text('${tr('المعروض', 'Shown')}: ${d['shown'] ?? rows.length}${((d['shown'] ?? 0) as num) > rows.length ? tr(' (أوّل ${rows.length})', ' (first ${rows.length})') : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: T.inkSoft)),
                const SizedBox(height: 6),
                if (rows.isEmpty) EmptyState(icon: Icons.event_available_outlined, title: tr('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window')),
                for (final r in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Pressable(
                      onTap: () => hrOpenProfile(context, '${r['employeeId']}'),
                      child: AppCard(
                        topAccent: hrStateColor('${r['state']}'),
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                            Text([r['employeeNumber'], r['iqamaNumber'], r['department']].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                            InkWell(
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HrMasterGroupScreen(group: '${r['docKey']}'))),
                              child: Text('${Lang.instance.ar ? r['docAr'] : r['docEn']} · ${bothDates(r['expiryDate'], ar: Lang.instance.ar)}',
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.navy)),
                            ),
                          ])),
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text(hrDaysText(r['daysRemaining']), style: TextStyle(fontWeight: FontWeight.w800, color: hrStateColor('${r['state']}'))),
                            Chip2(hrStateLabel('${r['state'] ?? ''}'), hrStateColor('${r['state']}')),
                          ]),
                        ]),
                      ),
                    ),
                  ),
              ]),
            ),
    );
  }
}

// Master grid: a row per employee with all columns, /master/grid.
class HrMasterGridScreen extends StatefulWidget {
  const HrMasterGridScreen({super.key});
  @override
  State<HrMasterGridScreen> createState() => _HrMasterGridScreenState();
}

/// Default columns for someone who picked none: the basics asked about daily (as on the web).
const _defaultGridCols = [
  'employeeNumber', 'name', 'iqamaNumber', 'nationality', 'jobTitle', 'department', 'branchName', 'project', 'systemStatus',
  'hireDate', 'hireDateHijri', 'iqamaExpiry', 'iqamaExpiryHijri', 'iqamaExpiry__days',
  'contractEndDate', 'contractEndDateHijri', 'contractEndDate__days',
];
// Column selection persists while the app stays open.
List<String>? _gridVisibleMemo;

class _GCol {
  final String key;
  final String label;
  final String type;
  final String? hijriOf;
  final String? daysOf;
  final Map<String, dynamic>? field;
  const _GCol(this.key, this.label, this.type, {this.hijriOf, this.daysOf, this.field});
}

class _HrMasterGridScreenState extends State<HrMasterGridScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _cols = [];
  int _total = 0;
  int _pages = 1;
  int _page = 1;
  String _q = '';
  Map<String, String> _quick = {};
  final Map<String, Set<String>> _colFilters = {};
  bool _loading = true;
  bool _busy = false;
  String? _error;
  Map<String, List<String>> _choices = {};
  List<String> _visible = _gridVisibleMemo ?? _defaultGridCols;
  int _seq = 0;
  Timer? _debounce;
  // The field is destroyed on error; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    hrLoadChoices().then((c) { if (mounted) setState(() => _choices = c); });
    _onLive = () => _load();
    Live.instance.on('hr:master', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    Live.instance.off('hr:master', _onLive);
    Live.instance.off('hr:employee', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  String _params({int? page, int limit = 50, String? skipQuick}) {
    final p = <String>['page=${page ?? _page}', 'limit=$limit'];
    if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
    for (final e in _colFilters.entries) { for (final v in e.value) { p.add('cf_${e.key}=${Uri.encodeQueryComponent(v)}'); } }
    // Strip filters are sent, unless the column itself has a header filter.
    for (final e in _quick.entries) {
      if (e.value.isEmpty || e.key == skipQuick || _colFilters.containsKey(e.key)) continue;
      p.add('${e.key}=${Uri.encodeQueryComponent(e.value)}');
    }
    return p.join('&');
  }

  Future<void> _load() async {
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.get('/api/hr/master/grid?${_params()}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from((d as Map)['rows'] ?? []);
        _cols = List<Map<String, dynamic>>.from(d['columns'] ?? []);
        _total = (d['total'] as num?)?.toInt() ?? 0;
        _pages = (d['pages'] as num?)?.toInt() ?? 1;
        _loading = false; _busy = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _busy = false; _error = e.toString(); });
    }
  }

  void _refilter(VoidCallback f) { setState(() { f(); _page = 1; }); _load(); }

  List<_GCol> get _allCols {
    final ar = Lang.instance.ar;
    final out = <_GCol>[
      _GCol('employeeNumber', tr('الرقم الوظيفي', 'Employee no.'), 'text'),
      _GCol('name', tr('الموظف', 'Employee'), 'text'),
      _GCol('iqamaNumber', tr('رقم الهوية / الإقامة', 'ID / Iqama no.'), 'text'),
    ];
    const pinned = {'employeeNumber', 'arabicName', 'name', 'iqamaNumber'};
    final serverHijri = _cols.where((c) => c['type'] == 'hijri').map((c) => '${c['key']}').toSet();
    for (final c in _cols) {
      final k = '${c['key']}';
      if (pinned.contains(k)) continue;
      final label = ar ? '${c['ar']}' : '${c['en']}';
      if (c['type'] == 'hijri') {
        out.add(_GCol(k, label, 'hijri', hijriOf: '${c['of'] ?? k.replaceAll(RegExp(r'Hijri$'), '')}'));
        continue;
      }
      out.add(_GCol(k, label, '${c['type']}', field: c));
      if (c['type'] == 'date' && !serverHijri.contains('${k}Hijri')) {
        final b = label.replaceAll(' الميلادي', '').replaceAll(' (ميلادي)', '').replaceAll(' (Gregorian)', '');
        out.add(_GCol('${k}Hijri', ar ? '$b الهجري' : '$b (Hijri)', 'hijri', hijriOf: k));
      }
      if (c['type'] == 'date' && hrExpiryFields.containsKey(k)) {
        final m = hrExpiryFields[k]!;
        out.add(_GCol('${k}__days', tr(m.$1, m.$2), 'number', daysOf: k));
      }
    }
    out.add(_GCol('custodyCount', tr('عدد العهد', 'Custody items'), 'number'));
    return out;
  }

  dynamic _cell(Map<String, dynamic> r, _GCol c) {
    final v = Map<String, dynamic>.from((r['values'] as Map?) ?? const {});
    if (c.key == 'employeeNumber') return r['employeeNumber'] ?? '—';
    if (c.key == 'name') return r['name'] ?? '—';
    if (c.key == 'custodyCount') return r['custodyCount'] ?? 0;
    if (c.key == 'iqamaNumber') return v['iqamaNumber'] ?? v['nationalId'] ?? '';
    if (c.hijriOf != null) { final h = '${v[c.key] ?? ''}'; return h.isNotEmpty ? h : hijriDay(v[c.hijriOf]); }
    if (c.daysOf != null) return hrDaysUntil(v[c.daysOf]) ?? '';
    final x = v[c.key];
    if (x == true) return tr('نعم', 'Yes');
    if (x == false) return tr('لا', 'No');
    if (c.type == 'date') return x == null ? '' : _fmtDate(x);
    return x ?? '';
  }

  List<_GCol> get _shown { final all = _allCols; return [for (var i = 0; i < all.length; i++) if (i < 3 || _visible.contains(all[i].key)) all[i]]; }

  Future<void> _chooseColumns() async {
    final all = _allCols;
    final sel = {..._visible};
    String q = '';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final list = all.skip(3).where((x) => q.isEmpty || x.label.contains(q)).toList();
        return SizedBox(
          height: MediaQuery.of(c).size.height * 0.85,
          child: Column(children: [
            Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Row(children: [
              Expanded(child: Text(tr('الأعمدة', 'Columns'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              TextButton(onPressed: () => setS(() { sel..clear()..addAll(_defaultGridCols); }), child: Text(tr('الافتراضي', 'Default'))),
              TextButton(onPressed: () => setS(() => sel.addAll(all.map((x) => x.key))), child: Text(tr('الكل', 'All'))),
            ])),
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: SearchField(
              dense: true,
              onChanged: (v) => setS(() => q = v.trim()),
              hint: tr('ابحث…', 'Search…'),
            )),
            Expanded(child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
              if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
              for (final x in list)
                CheckboxListTile(
                  dense: true,
                  value: sel.contains(x.key),
                  activeColor: T.orange,
                  title: Text(x.label, style: const TextStyle(fontSize: 13)),
                  onChanged: (v) => setS(() {
                    // Gregorian and its Hijri date are chosen together, like the web.
                    final twin = x.hijriOf ?? (all.any((y) => y.hijriOf == x.key) ? all.firstWhere((y) => y.hijriOf == x.key).key : null);
                    if (v == true) { sel.add(x.key); if (twin != null) sel.add(twin); } else { sel.remove(x.key); if (twin != null) sel.remove(twin); }
                  }),
                ),
            ])),
            SafeArea(top: false, child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تطبيق', 'Apply')))),
            )),
          ]),
        );
      }),
    );
    if (ok == true && mounted) setState(() { _visible = [for (final x in all) if (sel.contains(x.key)) x.key]; _gridVisibleMemo = _visible; });
  }

  /// Values of a column for the filter: from all employees matching the other filters, not from the page.
  Future<void> _filterColumn(_GCol c) async {
    final p = <String>['field=${Uri.encodeQueryComponent(c.key)}'];
    if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
    for (final e in _colFilters.entries) { if (e.key != c.key) { for (final v in e.value) { p.add('cf_${e.key}=${Uri.encodeQueryComponent(v)}'); } } }
    for (final e in _quick.entries) { if (e.value.isNotEmpty && e.key != c.key && !_colFilters.containsKey(e.key)) p.add('${e.key}=${Uri.encodeQueryComponent(e.value)}'); }
    List<Map<String, dynamic>> opts = [];
    try { opts = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/master/grid/options?${p.join('&')}'))['values'] ?? []); }
    catch (e) { if (mounted) hrSnack(context, e.toString()); return; }
    if (!mounted) return;
    final sel = {...?_colFilters[c.key]};
    String q = '';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (s) => StatefulBuilder(builder: (s, setS) {
        final list = opts.where((o) => q.isEmpty || '${o['label'] ?? o['value']}'.contains(q)).toList();
        return SizedBox(
          height: MediaQuery.of(s).size.height * 0.75,
          child: Column(children: [
            Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Row(children: [
              Expanded(child: Text(c.label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              if (sel.isNotEmpty) TextButton(onPressed: () => setS(sel.clear), child: Text(tr('مسح', 'Clear'))),
            ])),
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: SearchField(
              dense: true,
              onChanged: (v) => setS(() => q = v.trim()),
              hint: tr('ابحث…', 'Search…'),
            )),
            Expanded(child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
              if (list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
              for (final o in list)
                CheckboxListTile(
                  dense: true,
                  value: sel.contains('${o['value']}'),
                  activeColor: T.orange,
                  title: Text('${o['label'] ?? o['value']}'.isEmpty ? tr('(فارغ)', '(blank)') : '${o['label'] ?? o['value']}'),
                  secondary: Text('${o['count'] ?? ''}', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
                  onChanged: (v) => setS(() => v == true ? sel.add('${o['value']}') : sel.remove('${o['value']}')),
                ),
            ])),
            SafeArea(top: false, child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(s, true), child: Text(tr('تطبيق', 'Apply')))),
            )),
          ]),
        );
      }),
    );
    if (ok == true) _refilter(() { if (sel.isEmpty) { _colFilters.remove(c.key); } else { _colFilters[c.key] = sel; } });
  }

  Future<void> _export(String scope) async {
    var rows = _rows;
    if (scope == 'all') {
      try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/master/grid?limit=100000'))['rows'] ?? []); }
      catch (e) { if (mounted) hrSnack(context, e.toString()); return; }
    }
    if (!mounted) return;
    final cols = [for (final c in _shown) ExportCol(c.label, c.label, (r) => _cell(r, c))];
    exportExcel(context, fileName: 'hr-master', sheets: [(tr('الماستر', 'Master'), cols, rows)]);
  }

  DataCell _dataCell(Map<String, dynamic> r, _GCol c, bool canEdit) {
    final sts = (r['statuses'] as Map?) ?? const {};
    final st = '${sts[c.hijriOf ?? c.key] ?? ''}';
    final v = '${_cell(r, c)}';
    final text = st == 'not_required' ? '—' : (v.isEmpty ? (st == 'required' ? tr('مطلوب', 'Required') : '—') : v);
    final editable = canEdit && c.field != null && c.key != 'name';
    return DataCell(
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 200),
        child: Text(text, overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontWeight: c.key == 'name' ? FontWeight.w800 : FontWeight.w500,
              color: c.daysOf != null ? hrDaysColor(int.tryParse(v)) : st == 'required' ? T.danger : st == 'not_required' ? T.inkFaint : T.ink,
            )),
      ),
      onTap: c.key == 'name' || c.key == 'employeeNumber'
          ? () => hrOpenProfile(context, '${r['_id']}')
          : editable
              ? () async {
                  final changed = await hrEditCell(context, employeeId: '${r['_id']}', field: c.field!, raw: ((r['values'] as Map?) ?? const {})[c.key], choices: _choices);
                  if (changed) _load();
                }
              : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final shown = _shown;
    final canEdit = hrCanEdit(context);
    return AppScaffold(
      title: Text(tr('ماستر الموارد البشرية', 'HR master')),
      actions: [
        IconButton(tooltip: tr('الأعمدة', 'Columns'), icon: const Icon(Icons.view_column_outlined), onPressed: _cols.isEmpty ? null : _chooseColumns),
        PopupMenuButton<String>(
          icon: const Icon(Icons.file_download_outlined),
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: _load)
              : Column(children: [
                  if (_busy) const LinearProgressIndicator(minHeight: 2),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
                    child: HrQuickFilters(value: _quick, onChanged: (v) => _refilter(() => _quick = v)),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                    child: Row(children: [
                      Expanded(child: SearchField(
                        controller: _searchCtl, dense: true,
                        onChanged: (v) { _q = v; _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 300), () { if (mounted) _refilter(() {}); }); },
                        hint: tr('بحث بالاسم أو الرقم الوظيفي أو الهوية…', 'name, employee no., ID…'),
                      )),
                      if (_colFilters.isNotEmpty)
                        TextButton(onPressed: () => _refilter(_colFilters.clear), child: Text(tr('مسح فلاتر الأعمدة (${_colFilters.length})', 'Clear column filters (${_colFilters.length})'), style: const TextStyle(fontSize: 11.5))),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(tr('$_total موظفًا · ${_allCols.length} عمودًا — اضغط رأس العمود لفلترته، والخانة لتعديلها', '$_total employees · ${_allCols.length} columns — tap a header to filter, a cell to edit'),
                        style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ),
                  Expanded(
                    child: _rows.isEmpty
                        ? EmptyState(icon: Icons.search_off, title: tr('لا نتائج', 'No results'))
                        : SingleChildScrollView(
                            child: SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: DataTable(
                                headingRowColor: WidgetStateProperty.all(T.navy),
                                headingTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12),
                                dataTextStyle: const TextStyle(fontSize: 12, color: T.ink),
                                columnSpacing: 18,
                                horizontalMargin: 10,
                                dataRowMinHeight: 36,
                                dataRowMaxHeight: 48,
                                columns: [
                                  for (final c in shown)
                                    DataColumn(label: InkWell(
                                      onTap: () => _filterColumn(c),
                                      child: Row(children: [
                                        Text(c.label),
                                        Icon(_colFilters.containsKey(c.key) ? Icons.filter_alt : Icons.filter_alt_outlined, size: 14, color: _colFilters.containsKey(c.key) ? T.orange : Colors.white54),
                                      ]),
                                    )),
                                ],
                                rows: [
                                  for (final r in _rows)
                                    DataRow(cells: [
                                      for (final c in shown) _dataCell(r, c, canEdit),
                                    ]),
                                ],
                              ),
                            ),
                          ),
                  ),
                  if (_pages > 1)
                    SafeArea(top: false, child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      child: Row(children: [
                        Expanded(child: Text(tr('صفحة $_page من $_pages · $_total موظفًا', 'Page $_page of $_pages · $_total employees'), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                        IconButton(onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); }, icon: const Icon(Icons.chevron_right)),
                        IconButton(onPressed: _page >= _pages ? null : () { setState(() => _page++); _load(); }, icon: const Icon(Icons.chevron_left)),
                      ]),
                    )),
                ]),
    );
  }
}

// Department analysis, DepartmentAnalysis: which departments are worst.
const _deptSorts = [
  ('total', 'الكل', 'All'), ('active', 'على رأس العمل', 'Active'), ('ended', 'منتهي خدماته', 'Ended'),
  ('contracts', 'عقود سارية', 'Contracts'), ('completeness', 'اكتمال البيانات', 'Data complete'),
  ('missing', 'خانات ناقصة', 'Missing fields'), ('peopleWithMissing', 'موظفون ناقصون', 'People missing data'),
  ('docsExpired', 'مستندات منتهية', 'Docs expired'), ('docsSoon', 'تنتهي قريبًا', 'Docs due soon'),
  ('leavesApproved', 'إجازات معتمدة', 'Leaves approved'), ('leavesPending', 'إجازات منتظرة', 'Leaves pending'),
  ('custody', 'عهد', 'Custody'), ('saudi', 'سعوديون', 'Saudis'), ('outside', 'خارج المملكة', 'Outside KSA'),
];

class HrDeptAnalysis extends StatefulWidget {
  final Map<String, dynamic> data;
  /// Opens the rows behind one number: the department plus any other condition.
  final void Function(Map<String, String> q) onOpen;
  /// Restricts the whole dashboard to one department (a second tap lifts it).
  final void Function(String dept) onFilter;
  final String active;
  const HrDeptAnalysis({super.key, required this.data, required this.onOpen, required this.onFilter, this.active = ''});
  @override
  State<HrDeptAnalysis> createState() => _HrDeptAnalysisState();
}

class _HrDeptAnalysisState extends State<HrDeptAnalysis> {
  String _sort = 'total';
  bool _desc = true;

  @override
  Widget build(BuildContext context) {
    final rows = List<Map<String, dynamic>>.from(widget.data['departments'] ?? const []);
    rows.sort((a, b) {
      final x = a[_sort]; final y = b[_sort];
      final n = x is num && y is num ? x.compareTo(y) : '$x'.compareTo('$y');
      return _desc ? -n : n;
    });
    final tot = Map<String, dynamic>.from((widget.data['totals'] as Map?) ?? const {});
    Widget num0(String label, dynamic n, Map<String, String>? q, Color c) {
      final v = (n is num ? n : 0).toInt();
      return InkWell(
        onTap: v > 0 && q != null ? () => widget.onOpen(q) : null,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
          decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('$v', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: v > 0 ? c : T.inkFaint)),
            Text(label, style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
          ]),
        ),
      );
    }
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.apartment_outlined, size: 18, color: T.navy),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('تحليل الأقسام', 'By department'), style: const TextStyle(fontWeight: FontWeight.w800))),
          DropdownButton<String>(
            value: _sort,
            underline: const SizedBox.shrink(),
            style: const TextStyle(fontSize: 12, color: T.ink),
            items: [for (final s in _deptSorts) DropdownMenuItem(value: s.$1, child: Text(tr(s.$2, s.$3)))],
            onChanged: (v) => setState(() => _sort = v ?? _sort),
          ),
          IconButton(visualDensity: VisualDensity.compact, icon: Icon(_desc ? Icons.arrow_downward : Icons.arrow_upward, size: 18), onPressed: () => setState(() => _desc = !_desc)),
        ]),
        Text(tr('اضغط أيّ رقم لعرض مَن فيه · واضغط اسمَ القسم لقصر اللوحة كلّها عليه', 'Tap any number to see who is in it · tap a department to scope the whole board'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 8),
        for (final r in rows)
          Builder(builder: (_) {
            final dept = '${r['department'] ?? ''}';
            final q = {'department': dept.isEmpty ? '—' : dept};
            final on = widget.active.split(',').contains(dept) && dept.isNotEmpty;
            final pct = (r['completeness'] as num?)?.toDouble() ?? 0;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: on ? T.orange.withValues(alpha: 0.06) : null,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: on ? T.orange : const Color(0xFFE2E8F0)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: InkWell(
                    onTap: () => widget.onFilter(dept),
                    child: Text(dept.isEmpty ? tr('(بلا قسم)', '(no department)') : dept,
                        style: TextStyle(fontWeight: FontWeight.w800, color: on ? T.orange : T.ink)),
                  )),
                  Text('${pct.toStringAsFixed(pct == pct.roundToDouble() ? 0 : 1)}%', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 6),
                  SizedBox(width: 60, child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: (pct / 100).clamp(0.02, 1.0),
                      minHeight: 6,
                      backgroundColor: const Color(0xFFF1F5F9),
                      valueColor: AlwaysStoppedAnimation(pct >= 99 ? T.success : pct >= 95 ? T.warn : T.danger),
                    ),
                  )),
                ]),
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  num0(tr('الكل', 'All'), r['total'], q, T.ink),
                  num0(tr('على رأس العمل', 'Active'), r['active'], {...q, 'employment': 'active'}, T.success),
                  num0(tr('منتهي خدماته', 'Ended'), r['ended'], {...q, 'employment': 'inactive'}, T.inkSoft),
                  num0(tr('عقود سارية', 'Contracts'), r['contracts'], q, T.ink),
                  num0(tr('خانات ناقصة', 'Missing'), r['missing'], {...q, 'status': 'required'}, T.danger),
                  num0(tr('موظفون ناقصون', 'People missing'), r['peopleWithMissing'], {...q, 'status': 'required'}, T.danger),
                  num0(tr('مستندات منتهية', 'Docs expired'), r['docsExpired'], {...q, 'state': 'expired'}, T.danger),
                  num0(tr('تنتهي قريبًا', 'Due soon'), r['docsSoon'], {...q, 'state': 'attention'}, T.warn),
                  num0(tr('إجازات معتمدة', 'Leaves approved'), r['leavesApproved'], q, T.ink),
                  num0(tr('إجازات منتظرة', 'Leaves pending'), r['leavesPending'], q, T.info),
                  num0(tr('عهد', 'Custody'), r['custody'], q, T.ink),
                  num0(tr('سعوديون', 'Saudis'), r['saudi'], {...q, 'nationality': 'سعودي'}, T.ink),
                  num0(tr('خارج المملكة', 'Outside KSA'), r['outside'], {...q, 'outsideKingdom': '1'}, T.ink),
                ]),
              ]),
            );
          }),
        Text(
          tr('الإجمالي: ${tot['total'] ?? 0} · على رأس العمل ${tot['active'] ?? 0} · ناقص ${tot['missing'] ?? 0} · منتهي ${tot['docsExpired'] ?? 0} · قريب ${tot['docsSoon'] ?? 0}',
             'Total: ${tot['total'] ?? 0} · active ${tot['active'] ?? 0} · missing ${tot['missing'] ?? 0} · expired ${tot['docsExpired'] ?? 0} · soon ${tot['docsSoon'] ?? 0}'),
          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft),
        ),
        Text(tr('«اكتمال البيانات» من ${widget.data['fieldsPerEmployee'] ?? '—'} خانةً لكلّ موظّف — وما عُلِّم «غير مطلوب» لا يُحسب ناقصًا.',
            '"Data complete" is out of ${widget.data['fieldsPerEmployee'] ?? '—'} fields per employee — a field marked not-required is not counted missing.'),
            style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      ]),
    );
  }
}
