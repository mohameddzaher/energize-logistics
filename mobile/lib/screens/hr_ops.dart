import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_reference_lists.dart';
import 'hr_common.dart';
import 'hr_master.dart';
import '../ui/search_field.dart';

/// HR operations screens, counterpart of /system/hr/contracts, /custody, /settings and "issue a stock item" on the web: same actions on the same endpoints.

// Custody and stock vocabulary: CUSTODY_TYPES/CONDITIONS (read from the lookups).
const _fallbackTypes = [
  ('laptop', 'حاسب محمول', 'Laptop'), ('desktop', 'حاسب مكتبي', 'Desktop'), ('phone', 'هاتف', 'Phone'),
  ('tablet', 'تابلت', 'Tablet'), ('sim', 'شريحة اتصال', 'SIM Card'), ('monitor', 'شاشة', 'Monitor'),
  ('keyboard', 'لوحة مفاتيح', 'Keyboard'), ('mouse', 'فأرة', 'Mouse'), ('headset', 'سماعة رأس', 'Headset'),
  ('printer', 'طابعة', 'Printer'), ('router', 'موجّه شبكة', 'Router'), ('charger', 'شاحن', 'Charger'),
  ('cable', 'كبل', 'Cable'), ('laptop_bag', 'حقيبة حاسب', 'Laptop Bag'), ('accessory', 'ملحق', 'Accessory'),
  ('access_card', 'بطاقة دخول', 'Access Card'), ('vehicle', 'مركبة', 'Vehicle'), ('tool', 'أداة', 'Tool'), ('other', 'أخرى', 'Other'),
];
const _fallbackConditions = [('new', 'جديد', 'New'), ('good', 'جيد', 'Good'), ('fair', 'مقبول', 'Fair'), ('damaged', 'تالف', 'Damaged')];

/// Item types and conditions from `/api/lookups` (asset_type/asset_condition), falling back to the constants.
class HrAssetVocab {
  static List<(String, String, String)> types = _fallbackTypes;
  static List<(String, String, String)> conditions = _fallbackConditions;
  static bool _loaded = false;
  static Future<void> load() async {
    if (_loaded) return;
    Future<List<(String, String, String)>> one(String type) async {
      try {
        final d = await Api.instance.get('/api/lookups?type=$type&active=true');
        return [for (final r in List<Map<String, dynamic>>.from((d as Map)['items'] ?? [])) ('${r['key']}', '${r['nameAr']}', '${r['nameEn']}')];
      } catch (_) { return const []; }
    }
    final t = await one('asset_type');
    final c = await one('asset_condition');
    // The retired "mouse and keyboard" type is not offered as an option (RETIRED_ASSET_TYPE_KEYS).
    if (t.isNotEmpty) types = t.where((x) => x.$1 != 'keyboard_mouse').toList();
    if (c.isNotEmpty) conditions = c;
    _loaded = true;
  }
  static String typeLabel(dynamic k) {
    for (final x in [...types, ..._fallbackTypes]) { if (x.$1 == '$k') return tr(x.$2, x.$3); }
    return '${k ?? '—'}';
  }
  static String conditionLabel(dynamic k) {
    for (final x in [...conditions, ..._fallbackConditions]) { if (x.$1 == '$k') return tr(x.$2, x.$3); }
    return '${k ?? '—'}';
  }
}

Widget _drop(String label, String value, List<(String, String, String)> opts, ValueChanged<String> onChanged, {bool allowEmpty = false}) {
  final has = opts.any((o) => o.$1 == value);
  return DropdownButtonFormField<String>(
    initialValue: has || (allowEmpty && value.isEmpty) ? value : (allowEmpty ? '' : (opts.isEmpty ? null : opts.first.$1)),
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      if (allowEmpty) DropdownMenuItem(value: '', child: Text(tr('— اختر —', '— choose —'))),
      for (final o in opts) DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3))),
    ],
    onChanged: (v) => onChanged(v ?? ''),
  );
}

// Issue an HR stock item to an employee: POST /api/hr/stock/:id/assign.
Future<bool> hrStockAssign(BuildContext context, Map<String, dynamic> item) async {
  await HrAssetVocab.load();
  if (!context.mounted) return false;
  Map<String, dynamic>? emp;
  DateTime? date = DateTime.now();
  String cond = '${item['condition'] ?? 'good'}';
  final notes = TextEditingController();
  final ok = await hrSheet(context, title: tr('تسليم لموظف', 'Assign to employee'), saveLabel: tr('تأكيد التسليم', 'Confirm handover'),
      body: (c, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text('${tr('تسليم', 'Handing over')} «${item['name'] ?? ''}»${'${item['serialNumber'] ?? ''}'.isNotEmpty ? ' (${item['serialNumber']})' : ''}', style: const TextStyle(color: T.inkSoft)),
    const SizedBox(height: 10),
    OutlinedButton.icon(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
      icon: const Icon(Icons.person_search_outlined),
      label: Text(emp == null ? tr('اختر الموظف *', 'Pick an employee *') : hrEmpName(emp)),
      onPressed: () async { final e = await pickHrEmployee(c); if (e != null) setS(() => emp = e); },
    ),
    const SizedBox(height: 10),
    HrDateButton(label: tr('تاريخ التسليم', 'Handover date'), value: date, onChanged: (d) => setS(() => date = d)),
    const SizedBox(height: 10),
    _drop(tr('الحالة عند التسليم', 'Condition at handover'), cond, HrAssetVocab.conditions, (v) => setS(() => cond = v)),
    const SizedBox(height: 10),
    TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
  ]));
  if (!ok) return false;
  if (emp == null) { if (context.mounted) hrSnack(context, tr('اختر الموظف', 'Pick an employee')); return false; }
  try {
    await Api.instance.post('/api/hr/stock/${item['_id']}/assign', {
      'employee': emp!['_id'], 'assignedDate': date == null ? '' : hrIso(date!), 'condition': cond, 'notes': notes.text.trim(),
    });
    if (context.mounted) hrSnack(context, tr('سُلِّم الصنف', 'Item handed over'));
    return true;
  } catch (e) {
    if (context.mounted) hrSnack(context, e.toString());
    return false;
  }
}

// Employee contracts: /system/hr/contracts (plus the contract data tab).
class HrContractsScreen extends StatelessWidget {
  const HrContractsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: Text(tr('عقود الموظفين', 'Employment Contracts')),
        appBarBottom: TabBar(
          indicatorColor: T.orange,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: [Tab(text: tr('العقود', 'Contracts')), Tab(text: tr('بيانات العقود', 'Contract data'))],
        ),
        body: const TabBarView(children: [
          _ContractsList(),
          HrMasterGroupScreen(group: 'contract', embedded: true),
        ]),
      ),
    );
  }
}

class _ContractsList extends StatefulWidget {
  const _ContractsList();
  @override
  State<_ContractsList> createState() => _ContractsListState();
}

class _ContractsListState extends State<_ContractsList> with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // The field is destroyed on load and scroll; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  String _status = '';
  String _type = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:contract', _onLive);
    Live.instance.on('hr:master', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:contract', _onLive);
    Live.instance.off('hr:master', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/hr/contracts');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from((d as Map)['contracts'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Map<String, dynamic> _emp(Map<String, dynamic> c) => c['employee'] is Map ? Map<String, dynamic>.from(c['employee']) : const {};
  String _name(Map<String, dynamic> c) { final n = hrEmpName(c['employee']); return n.isNotEmpty ? n : '${c['employeeNameAr'] ?? ''}'; }
  String _idNo(Map<String, dynamic> c) => '${c['iqamaNumber'] ?? ''}'.isNotEmpty ? '${c['iqamaNumber']}' : '${_emp(c)['iqamaNumber'] ?? _emp(c)['nationalId'] ?? ''}';

  /// Valid or expired; a contract past its term and not renewed reads expired (contractBadge).
  (String, Color) _badge(Map<String, dynamic> c) {
    final end = '${c['endDate'] ?? ''}';
    final today = hrIso(DateTime.now());
    if (c['status'] == 'active' && end.length >= 10 && end.substring(0, 10).compareTo(today) < 0) return (tr('منتهي', 'Expired'), T.danger);
    return c['status'] == 'active' ? (tr('ساري', 'Active'), T.success) : (tr('منتهي', 'Expired'), T.inkFaint);
  }

  List<Map<String, dynamic>> get _shown {
    final s = _q.trim().toLowerCase();
    return _rows.where((c) {
      if (_status.isNotEmpty && c['status'] != _status) return false;
      if (_type.isNotEmpty && (c['type'] == 'unlimited' ? 'unlimited' : 'fixed') != _type) return false;
      if (s.isEmpty) return true;
      final e = _emp(c);
      return _name(c).toLowerCase().contains(s) || '${e['iqamaNumber'] ?? ''}'.contains(s) || '${e['employeeNumber'] ?? ''}'.contains(s)
          || '${c['iqamaNumber'] ?? ''}'.contains(s) || '${c['sponsorRegistration'] ?? ''}'.contains(s)
          || '${c['employeeNameAr'] ?? ''}'.toLowerCase().contains(s) || '${c['contractNumber'] ?? ''}'.contains(s)
          || '${c['contractProfession'] ?? ''}'.toLowerCase().contains(s);
    }).toList();
  }

  List<ExportCol> get _cols => [
        ExportCol('الموظف', 'Employee', (r) => _name(r)),
        ExportCol('الهوية', 'ID number', (r) => _idNo(r).isEmpty ? '—' : _idNo(r)),
        ExportCol('القسم', 'Department', (r) => '${_emp(r)['department'] ?? ''}'.isEmpty ? '—' : _emp(r)['department']),
        ExportCol('رقم العقد', 'Contract no.', (r) => '${r['contractNumber'] ?? ''}'.isEmpty ? '—' : r['contractNumber']),
        ExportCol('المهنة في العقد', 'Contract profession', (r) => '${r['contractProfession'] ?? ''}'.isEmpty ? '—' : r['contractProfession']),
        ExportCol('النوع', 'Type', (r) => r['type'] ?? ''),
        ExportCol('تاريخ البداية الميلادي', 'Start date (Gregorian)', (r) => gregDay(r['startDate'])),
        ExportCol('تاريخ البداية الهجري', 'Start date (Hijri)', (r) => hijriDay(r['startDate'])),
        ExportCol('تاريخ النهاية الميلادي', 'End date (Gregorian)', (r) => gregDay(r['endDate'])),
        ExportCol('تاريخ النهاية الهجري', 'End date (Hijri)', (r) => hijriDay(r['endDate'])),
        ExportCol('الإجازة السنوية', 'Annual leave', (r) => '${r['annualLeaveText'] ?? ''}'.isNotEmpty ? r['annualLeaveText'] : r['annualLeaveDays']),
        ExportCol('فترة التجربة', 'Probation', (r) => '${r['probationText'] ?? ''}'.isNotEmpty ? r['probationText'] : (r['probationMonths'] != null && r['probationMonths'] != 0 ? '${r['probationMonths']}' : '—')),
        ExportCol('السجل', 'CR number', (r) => '${r['sponsorRegistration'] ?? ''}'.isEmpty ? '—' : r['sponsorRegistration']),
        ExportCol('الراتب الأساسي', 'Basic salary', (r) => r['basicSalary'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => r['status'] ?? ''),
      ];

  // Create or edit a contract: the web form with all its fields.
  Future<void> _form([Map<String, dynamic>? c]) async {
    Map<String, dynamic>? emp = c == null ? null : _emp(c);
    String type = '${c?['type'] ?? 'fixed'}' == 'unlimited' ? 'unlimited' : 'fixed';
    DateTime? start = hrParse(c?['startDate']) ?? (c == null ? DateTime.now() : null);
    DateTime? end = hrParse(c?['endDate']);
    TextEditingController t(dynamic v) => TextEditingController(text: v == null ? '' : '$v');
    final dur = t(c?['durationMonths'] ?? 12), leave = t(c?['annualLeaveDays'] ?? 21), prob = t(c?['probationMonths'] ?? 3);
    final job = t(c?['jobTitle']), salary = t(c?['basicSalary'] ?? 0), allow = t(c?['allowances'] ?? 0);
    final iqama = t(c?['iqamaNumber']), prof = t(c?['contractProfession']), numC = t(c?['contractNumber']), cr = t(c?['sponsorRegistration']), notes = t(c?['notes']);
    Widget row2(Widget a, Widget b) => Row(children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]);
    TextField tf(TextEditingController ctrl, String l, {bool n = false}) => TextField(controller: ctrl, keyboardType: n ? TextInputType.number : null, decoration: InputDecoration(labelText: l));
    final ok = await hrSheet(context, title: c == null ? tr('عقد جديد', 'New contract') : tr('تعديل العقد', 'Edit contract'), body: (s, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
        icon: const Icon(Icons.person_search_outlined),
        label: Text(emp == null || emp!.isEmpty ? tr('اختر الموظف *', 'Select an employee *') : hrEmpName(emp)),
        // The employee cannot be changed on an existing contract, like the web.
        onPressed: c != null ? null : () async { final e = await pickHrEmployee(s); if (e != null) setS(() => emp = e); },
      ),
      const SizedBox(height: 10),
      row2(_drop(tr('نوع العقد', 'Contract type'), type, const [('fixed', 'محدد المدة', 'Fixed-term'), ('unlimited', 'غير محدد المدة', 'Unlimited')], (v) => setS(() => type = v)),
          tf(dur, tr('مدة العقد (شهور)', 'Duration (months)'), n: true)),
      const SizedBox(height: 10),
      HrDateButton(label: tr('تاريخ البداية *', 'Start date *'), value: start, onChanged: (d) => setS(() => start = d)),
      const SizedBox(height: 8),
      HrDateButton(label: tr('تاريخ النهاية', 'End date'), value: end, onChanged: (d) => setS(() => end = d)),
      const SizedBox(height: 10),
      row2(tf(leave, tr('أيام الإجازة السنوية', 'Annual leave days'), n: true), tf(prob, tr('شهور التجربة', 'Probation (months)'), n: true)),
      const SizedBox(height: 10),
      tf(job, tr('المسمى الوظيفي', 'Job title')),
      const SizedBox(height: 10),
      row2(tf(salary, tr('الراتب الأساسي', 'Basic salary'), n: true), tf(allow, tr('البدلات', 'Allowances'), n: true)),
      const SizedBox(height: 10),
      row2(tf(iqama, tr('الهوية (كما في العقد)', 'ID number (as on the contract)')), tf(prof, tr('المهنة في العقد', 'Profession on the contract'))),
      const SizedBox(height: 10),
      row2(tf(numC, tr('رقم العقد', 'Contract number')), tf(cr, tr('السجل التجاري', 'CR number'))),
      const SizedBox(height: 10),
      TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
      const SizedBox(height: 6),
      Text(tr('عند إنشاء عقد جديد كـ «ساري» يتم إنهاء العقد الساري السابق تلقائيًا.', 'Creating a new active contract automatically expires the previous active one.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (!ok) return;
    if (emp == null || emp!.isEmpty || start == null) { if (mounted) hrSnack(context, tr('الموظف وتاريخ البداية مطلوبان', 'Employee and start date are required')); return; }
    final body = {
      'employee': emp!['_id'], 'type': type, 'startDate': hrIso(start!), 'endDate': end == null ? '' : hrIso(end!),
      'durationMonths': num.tryParse(dur.text) ?? 12, 'annualLeaveDays': num.tryParse(leave.text) ?? 21, 'probationMonths': num.tryParse(prob.text) ?? 0,
      'jobTitle': job.text.trim(), 'basicSalary': num.tryParse(salary.text) ?? 0, 'allowances': num.tryParse(allow.text) ?? 0,
      'iqamaNumber': iqama.text.trim(), 'contractProfession': prof.text.trim(), 'contractNumber': numC.text.trim(),
      'sponsorRegistration': cr.text.trim(), 'notes': notes.text.trim(),
    };
    try {
      if (c != null) { await Api.instance.put('/api/hr/contracts/${c['_id']}', body); } else { await Api.instance.post('/api/hr/contracts', body); }
      if (mounted) hrSnack(context, tr('تم الحفظ', 'Saved'));
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  // Renewal: the current contract is closed as expired, a new valid one follows it and is recorded in the log.
  Future<void> _renew(Map<String, dynamic> c) async {
    final endOld = hrParse(c['endDate']);
    DateTime? start = endOld?.add(const Duration(days: 1));
    DateTime? end = start?.add(const Duration(days: 364));
    final leave = TextEditingController(text: '${c['annualLeaveDays'] ?? ''}');
    final prof = TextEditingController(text: '${c['contractProfession'] ?? ''}');
    final numC = TextEditingController(text: '${c['contractNumber'] ?? ''}');
    bool carry = true;
    final ok = await hrSheet(context, title: tr('تجديد العقد', 'Renew contract'), saveLabel: tr('تجديد', 'Renew'), body: (s, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('يُقفَل العقد الحالي «منتهيًا» ولا يُحذف، ويُنشأ عقدٌ ساري يليه ويُقيَّد التجديد في سجلّ الموظف.',
          'The current contract is closed as "expired" (not deleted), an active successor is created, and the renewal is recorded.'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      const SizedBox(height: 10),
      HrDateButton(label: tr('تاريخ بداية العقد الجديد *', 'New start date *'), value: start, onChanged: (d) => setS(() => start = d)),
      const SizedBox(height: 8),
      HrDateButton(label: tr('تاريخ نهاية العقد الجديد', 'New end date'), value: end, onChanged: (d) => setS(() => end = d)),
      const SizedBox(height: 10),
      TextField(controller: leave, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('أيام الإجازة السنوية', 'Annual leave days'))),
      const SizedBox(height: 10),
      TextField(controller: prof, decoration: InputDecoration(labelText: tr('المهنة في العقد (اختياري)', 'Contract profession (optional)'))),
      const SizedBox(height: 10),
      TextField(controller: numC, decoration: InputDecoration(labelText: tr('رقم العقد (اختياري)', 'Contract number (optional)'))),
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        value: carry,
        onChanged: (v) => setS(() => carry = v ?? true),
        title: Text(tr('ترحيل رصيد الإجازات غير المستهلك', 'Carry unused leave balance forward'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        subtitle: Text(tr('مَن أخذ 15 يومًا من 30 يبدأ عامَه التالي بـ15 محفوظة.', 'Someone who used 15 of 30 starts the next year with 15 in hand.'), style: const TextStyle(fontSize: 11)),
      ),
    ]));
    if (!ok) return;
    if (start == null) { if (mounted) hrSnack(context, tr('تاريخ البداية مطلوب', 'Start date is required')); return; }
    try {
      final r = await Api.instance.post('/api/hr/contracts/${c['_id']}/renew', {
        'startDate': hrIso(start!), 'endDate': end == null ? '' : hrIso(end!),
        if (leave.text.trim().isNotEmpty) 'annualLeaveDays': num.tryParse(leave.text.trim()),
        'carryOver': carry, 'contractProfession': prof.text.trim(), 'contractNumber': numC.text.trim(),
      });
      if (mounted) hrSnack(context, (r is Map && r['message'] != null) ? '${r['message']}' : tr('جُدِّد العقد', 'Contract renewed'));
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  // Terminating a contract ends service, so the "not working" state is asked.
  Future<void> _terminate(Map<String, dynamic> c) async {
    String kind = '';
    final reason = TextEditingController();
    final ok = await hrSheet(context, title: tr('إنهاء العقد والخدمة', 'End contract and service'), saveLabel: tr('تأكيد', 'Confirm'), body: (s, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('فسخُ العقد يُنهي خدمة الموظف («لا يعمل»). اختر حالته — ومَن هو خارج النظام أو فريلانسر ينتقل إلى الأرشيف فورًا ولا يحتاج حالة.',
          'Ending the contract ends the service ("not working"). Pick the status — anyone out of the system or freelance goes straight to the archive.'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      for (final k in const [('transfer_pending', 'انتظار نقل الكفالة', 'Awaiting sponsorship transfer'), ('final_exit', 'خروج نهائي', 'Final exit')])
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(kind == k.$1 ? Icons.radio_button_checked : Icons.radio_button_off, color: kind == k.$1 ? T.danger : T.inkFaint),
          title: Text(tr(k.$2, k.$3), style: const TextStyle(fontWeight: FontWeight.w700)),
          onTap: () => setS(() => kind = k.$1),
        ),
      TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
      const SizedBox(height: 6),
      Text(tr('ملاحظة: لا يمكن إنهاء العقد قبل تسليم كل العهد المسجّلة على الموظف.', 'Note: a contract cannot be terminated until all custody items are returned.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (!ok) return;
    try {
      await Api.instance.post('/api/hr/contracts/${c['_id']}/terminate', {'reason': reason.text.trim(), if (kind.isNotEmpty) 'kind': kind});
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  Future<void> _remove(Map<String, dynamic> c) async {
    if (!await hrConfirm(context, tr('حذف عقد «${_name(c)}» نهائيًّا؟ إن كان العقد قد انتهى فعلًا فالأصحّ إنهاؤه لا حذفه.',
        'Permanently delete the contract for "${_name(c)}"? If it actually ended, terminate it instead.'), danger: true, ok: tr('حذف', 'Delete'))) { return; }
    try { await Api.instance.delete('/api/hr/contracts/${c['_id']}'); _load(); }
    catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  Future<void> _export(String scope) async {
    exportExcel(context, fileName: 'contracts', sheets: [('Contracts', _cols, scope == 'all' ? _rows : _shown)]);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    final shown = _shown;
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _form(), icon: const Icon(Icons.add), label: Text(tr('عقد جديد', 'New contract'))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          Row(children: [
            Expanded(child: SearchField(
              controller: _searchCtl, dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('ابحث بالاسم أو الهوية أو رقم العقد…', 'Search name, ID, contract no…'),
            )),
            PopupMenuButton<String>(
              icon: const Icon(Icons.file_download_outlined),
              tooltip: tr('تصدير Excel', 'Export to Excel'),
              onSelected: _export,
              itemBuilder: (_) => [
                PopupMenuItem(value: 'shown', child: Text(tr('المعروض (${shown.length})', 'Shown (${shown.length})'))),
                PopupMenuItem(value: 'all', child: Text(tr('الكل (${_rows.length})', 'All (${_rows.length})'))),
              ],
            ),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final s in const [('', 'كل الحالات', 'All statuses'), ('active', 'ساري', 'Active'), ('expired', 'منتهي', 'Expired')])
              ChoiceChip(selected: _status == s.$1, label: Text(tr(s.$2, s.$3)), onSelected: (_) => setState(() => _status = s.$1)),
            for (final s in const [('fixed', 'محدد المدة', 'Fixed-term'), ('unlimited', 'غير محدد', 'Unlimited')])
              FilterChip(selected: _type == s.$1, label: Text(tr(s.$2, s.$3)), onSelected: (v) => setState(() => _type = v ? s.$1 : '')),
          ]),
          const SizedBox(height: 6),
          Text('${shown.length} ${tr('عقد', 'contracts')}', style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          if (shown.isEmpty) EmptyState(icon: Icons.description_outlined, title: tr('لا توجد عقود', 'No contracts')),
          for (final c in shown)
            Builder(builder: (_) {
              final b = _badge(c);
              final e = _emp(c);
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Pressable(
                  onTap: e['_id'] == null ? null : () => hrOpenProfile(context, '${e['_id']}'),
                  child: AppCard(
                    topAccent: b.$2,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_name(c), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                        Text([e['employeeNumber'], _idNo(c), e['department']].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                        Text([
                          '${c['contractProfession'] ?? ''}'.isNotEmpty ? c['contractProfession'] : c['jobTitle'],
                          c['type'] == 'unlimited' ? tr('غير محدد المدة', 'Unlimited') : tr('محدد المدة', 'Fixed-term'),
                          if ('${c['contractNumber'] ?? ''}'.isNotEmpty) '${tr('عقد', 'No.')} ${c['contractNumber']}',
                          if ('${c['sponsorRegistration'] ?? ''}'.isNotEmpty) '${tr('سجل', 'CR')} ${c['sponsorRegistration']}',
                        ].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        Text('${bothDates(c['startDate'], ar: Lang.instance.ar)} ← ${bothDates(c['endDate'], ar: Lang.instance.ar)}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                        Text([
                          '${tr('الإجازة', 'Leave')}: ${'${c['annualLeaveText'] ?? ''}'.isNotEmpty ? c['annualLeaveText'] : '${c['annualLeaveDays'] ?? '—'} ${tr('يوم', 'd')}'}',
                          if ('${c['probationText'] ?? ''}'.isNotEmpty || (c['probationMonths'] ?? 0) != 0)
                            '${tr('التجربة', 'Probation')}: ${'${c['probationText'] ?? ''}'.isNotEmpty ? c['probationText'] : '${c['probationMonths']} ${tr('شهر', 'mo')}'}',
                        ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ])),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Chip2(b.$1, b.$2),
                        PopupMenuButton<String>(
                          icon: const Icon(Icons.more_vert, color: T.inkFaint),
                          onSelected: (v) {
                            if (v == 'edit') _form(c);
                            if (v == 'renew') _renew(c);
                            if (v == 'end') _terminate(c);
                            if (v == 'delete') _remove(c);
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(value: 'edit', child: Text(tr('تعديل', 'Edit'))),
                            if (c['status'] == 'active') PopupMenuItem(value: 'renew', child: Text(tr('تجديد العقد', 'Renew contract'))),
                            if (c['status'] == 'active') PopupMenuItem(value: 'end', child: Text(tr('إنهاء العقد', 'Terminate'), style: const TextStyle(color: T.danger))),
                            PopupMenuItem(value: 'delete', child: Text(tr('حذف العقد', 'Delete contract'), style: const TextStyle(color: T.danger))),
                          ],
                        ),
                      ]),
                    ]),
                  ),
                ),
              );
            }),
          const SizedBox(height: 70),
        ]),
      ),
    );
  }
}

// Employee custody: /system/hr/custody (/api/hr/assets, live on hr:asset).
class HrCustodyScreen extends StatefulWidget {
  const HrCustodyScreen({super.key});
  @override
  State<HrCustodyScreen> createState() => _HrCustodyScreenState();
}

class _HrCustodyScreenState extends State<HrCustodyScreen> {
  List<Map<String, dynamic>> _all = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // The field is destroyed on load and scroll; text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  String _status = '';
  String _source = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    HrAssetVocab.load().then((_) { if (mounted) setState(() {}); });
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:asset', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:asset', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/hr/assets');
      if (!mounted || mine != _seq) return;
      setState(() { _all = List<Map<String, dynamic>>.from((d as Map)['assets'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool _itOwned(Map<String, dynamic> a) => a['issuedBySection'] == 'it';
  /// What IT issued is read-only here (except the SIM), like the web.
  bool _locked(Map<String, dynamic> a) => _itOwned(a) && a['type'] != 'sim';
  String _idOf(dynamic e) => e is! Map ? '—' : '${(e['idType'] == 'national_id' ? (e['nationalId'] ?? e['iqamaNumber']) : (e['iqamaNumber'] ?? e['nationalId'])) ?? '—'}';

  List<Map<String, dynamic>> get _byStatus => _status.isEmpty ? _all : _all.where((a) => a['status'] == _status).toList();
  List<Map<String, dynamic>> get _shown {
    final s = _q.trim().toLowerCase();
    return _byStatus
        .where((a) => _source.isEmpty || (_source == 'it' ? _itOwned(a) : !_itOwned(a)))
        .where((a) => s.isEmpty || '${a['name'] ?? ''}'.toLowerCase().contains(s) || '${a['serialNumber'] ?? ''}'.toLowerCase().contains(s) || hrEmpName(a['employee']).toLowerCase().contains(s))
        .toList();
  }

  String _src(Map<String, dynamic> a) => _itOwned(a) ? tr('قسم التقنية', 'Issued by IT') : tr('الموارد البشرية', 'Issued by HR');

  List<ExportCol> get _cols => [
        ExportCol('Employee', 'Employee', (r) => hrEmpName(r['employee'])),
        ExportCol('Item', 'Item', (r) => r['name'] ?? ''),
        ExportCol('Type', 'Type', (r) => r['type'] ?? ''),
        ExportCol('Serial', 'Serial', (r) => r['serialNumber'] ?? ''),
        ExportCol('Brand', 'Brand', (r) => r['brand'] ?? ''),
        ExportCol('Condition', 'Condition', (r) => r['condition'] ?? ''),
        ExportCol('Status', 'Status', (r) => r['status'] ?? ''),
        ExportCol('تاريخ التسليم الميلادي', 'Assigned date (Gregorian)', (r) => gregDay(r['assignedDate'])),
        ExportCol('تاريخ التسليم الهجري', 'Assigned date (Hijri)', (r) => hijriDay(r['assignedDate'])),
        ExportCol('تاريخ الإرجاع الميلادي', 'Returned date (Gregorian)', (r) => gregDay(r['returnedDate'])),
        ExportCol('تاريخ الإرجاع الهجري', 'Returned date (Hijri)', (r) => hijriDay(r['returnedDate'])),
        ExportCol('Source', 'Source', (r) => _src(r)),
      ];

  Future<void> _form([Map<String, dynamic>? a]) async {
    await HrAssetVocab.load();
    if (!mounted) return;
    Map<String, dynamic>? emp = a?['employee'] is Map ? Map<String, dynamic>.from(a!['employee']) : null;
    TextEditingController t(dynamic v) => TextEditingController(text: v == null ? '' : '$v');
    final name = t(a?['name']), serial = t(a?['serialNumber']), brand = t(a?['brand']), model = t(a?['model']), value = t(a?['value'] ?? 0), notes = t(a?['notes']);
    String type = '${a?['type'] ?? ''}';
    String cond = '${a?['condition'] ?? 'good'}';
    DateTime? date = hrParse(a?['assignedDate']) ?? (a == null ? DateTime.now() : null);
    final ok = await hrSheet(context, title: a == null ? tr('إضافة عهدة', 'Add custody') : tr('تعديل العهدة', 'Edit custody'), body: (s, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
        icon: const Icon(Icons.person_search_outlined),
        label: Text(emp == null ? tr('اختر الموظف *', 'Pick an employee *') : hrEmpName(emp)),
        onPressed: a != null ? null : () async { final e = await pickHrEmployee(s); if (e != null) setS(() => emp = e); },
      ),
      const SizedBox(height: 10),
      TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم الصنف *', 'Item name *'))),
      const SizedBox(height: 10),
      _drop(tr('النوع *', 'Type *'), type, HrAssetVocab.types, (v) => setS(() => type = v), allowEmpty: true),
      const SizedBox(height: 10),
      TextField(controller: serial, decoration: InputDecoration(labelText: tr('الرقم التسلسلي', 'Serial number'))),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: TextField(controller: brand, decoration: InputDecoration(labelText: tr('الماركة', 'Brand')))),
        const SizedBox(width: 10),
        Expanded(child: TextField(controller: model, decoration: InputDecoration(labelText: tr('الموديل', 'Model')))),
      ]),
      const SizedBox(height: 10),
      _drop(tr('الحالة', 'Condition'), cond, HrAssetVocab.conditions, (v) => setS(() => cond = v)),
      const SizedBox(height: 10),
      HrDateButton(label: tr('تاريخ التسليم', 'Assigned date'), value: date, onChanged: (d) => setS(() => date = d)),
      const SizedBox(height: 10),
      TextField(controller: value, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('القيمة', 'Value'))),
      const SizedBox(height: 10),
      TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
    ]));
    if (!ok) return;
    if (emp == null || name.text.trim().isEmpty || type.isEmpty) { if (mounted) hrSnack(context, tr('الموظف والاسم والنوع مطلوبة', 'Employee, name and type are required')); return; }
    final body = {
      'employee': emp!['_id'], 'name': name.text.trim(), 'type': type, 'serialNumber': serial.text.trim(), 'brand': brand.text.trim(),
      'model': model.text.trim(), 'condition': cond, 'value': num.tryParse(value.text) ?? 0, 'assignedDate': date == null ? '' : hrIso(date!), 'notes': notes.text.trim(),
    };
    try {
      if (a != null) { await Api.instance.put('/api/hr/assets/${a['_id']}', body); } else { await Api.instance.post('/api/hr/assets', body); }
      _load();
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  Future<void> _return(Map<String, dynamic> a) async {
    String cond = '${a['condition'] ?? 'good'}';
    final ok = await hrSheet(context, title: tr('إرجاع العهدة', 'Return custody'), saveLabel: tr('إرجاع', 'Return'), body: (s, setS) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${a['name'] ?? ''} — ${hrEmpName(a['employee'])}'),
      const SizedBox(height: 10),
      _drop(tr('حالة الصنف عند الإرجاع', 'Condition on return'), cond, HrAssetVocab.conditions, (v) => setS(() => cond = v)),
    ]));
    if (!ok) return;
    try { await Api.instance.post('/api/hr/assets/${a['_id']}/return', {'returnedCondition': cond}); _load(); }
    catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  Future<void> _remove(Map<String, dynamic> a) async {
    if (!await hrConfirm(context, tr('حذف هذه العهدة؟', 'Delete this custody item?'), danger: true, ok: tr('حذف', 'Delete'))) return;
    try { await Api.instance.delete('/api/hr/assets/${a['_id']}'); _load(); }
    catch (e) { if (mounted) hrSnack(context, e.toString()); }
  }

  void _details(Map<String, dynamic> a) {
    final rows = <(String, String)>[
      (tr('الموظف', 'Employee'), hrEmpName(a['employee'])),
      (tr('الصنف', 'Item'), '${a['name'] ?? ''}'),
      (tr('النوع', 'Type'), HrAssetVocab.typeLabel(a['type'])),
      (tr('الماركة', 'Brand'), '${a['brand'] ?? ''}'),
      (tr('الموديل', 'Model'), '${a['model'] ?? ''}'),
      (tr('الرقم التسلسلي', 'Serial'), '${a['serialNumber'] ?? ''}'),
      (tr('المواصفات', 'Specs'), '${a['specs'] ?? ''}'),
      (tr('الفئة', 'Category'), '${a['category'] ?? ''}'),
      (tr('الحالة', 'Condition'), a['condition'] == null ? '' : HrAssetVocab.conditionLabel(a['condition'])),
      (tr('تاريخ التسليم', 'Assigned date'), bothDates(a['assignedDate'], ar: Lang.instance.ar, empty: '')),
      (tr('سلّمه', 'Assigned by'), hrEmpName(a['assignedBy'])),
      (tr('المصدر', 'Source'), _src(a)),
      (tr('الوضع', 'Status'), a['status'] == 'assigned' ? tr('بعهدة الموظف', 'Assigned') : tr('مُرجَعة', 'Returned')),
      if (a['status'] == 'returned') (tr('تاريخ الإرجاع', 'Returned date'), bothDates(a['returnedDate'], ar: Lang.instance.ar, empty: '')),
      if (a['returnedCondition'] != null) (tr('الحالة عند الإرجاع', 'Returned condition'), HrAssetVocab.conditionLabel(a['returnedCondition'])),
      (tr('ملاحظات', 'Notes'), '${a['notes'] ?? ''}'),
    ];
    showModalBottomSheet(context: context, isScrollControlled: true, builder: (c) => SafeArea(child: SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('تفاصيل العهدة', 'Custody details'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        if (_locked(a)) Padding(padding: const EdgeInsets.only(top: 6), child: Chip2(tr('سلّمها قسم التقنية — للعرض فقط', 'Issued by IT — read only'), T.info, icon: Icons.lock_outline)),
        const SizedBox(height: 8),
        for (final r in rows) Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 120, child: Text(r.$1, style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
            Expanded(child: Text(r.$2.isEmpty ? '—' : r.$2, style: const TextStyle(fontWeight: FontWeight.w700))),
          ]),
        ),
      ]),
    )));
  }

  @override
  Widget build(BuildContext context) {
    final shown = _shown;
    return AppScaffold(
      title: Text(tr('عهد الموظفين', 'Employee custody')),
      actions: [
        PopupMenuButton<String>(
          icon: const Icon(Icons.file_download_outlined),
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          onSelected: (v) => exportExcel(context, fileName: 'custody', sheets: [('Custody', _cols, v == 'all' ? _all : shown)]),
          itemBuilder: (_) => [
            PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _form(), icon: const Icon(Icons.add), label: Text(tr('إضافة عهدة', 'Add custody'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    Text('${_all.where((a) => a['status'] == 'assigned').length} ${tr('عهدة بيد الموظفين', 'items assigned')}', style: const TextStyle(fontWeight: FontWeight.w700, color: T.inkSoft)),
                    const SizedBox(height: 8),
                    SearchField(
                      controller: _searchCtl, dense: true,
                      onChanged: (v) => setState(() => _q = v),
                      hint: tr('ابحث بالصنف أو الرقم التسلسلي أو الموظف…', 'Search item, serial or employee…'),
                    ),
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final s in const [('', 'الكل', 'All'), ('assigned', 'بعهدة الموظف', 'Assigned'), ('returned', 'مُرجَعة', 'Returned')])
                        ChoiceChip(selected: _status == s.$1, label: Text(tr(s.$2, s.$3)), onSelected: (_) => setState(() => _status = s.$1)),
                      for (final s in const [('it', 'قسم التقنية', 'Issued by IT'), ('hr', 'الموارد البشرية', 'Issued by HR')])
                        FilterChip(selected: _source == s.$1, label: Text(tr(s.$2, s.$3)), onSelected: (v) => setState(() => _source = v ? s.$1 : '')),
                    ]),
                    const SizedBox(height: 8),
                    if (shown.isEmpty) EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد عهد', 'No custody items')),
                    for (final a in shown)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Pressable(
                          onTap: () => _details(a),
                          child: AppCard(
                            child: Row(children: [
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${a['name'] ?? ''}${'${a['brand'] ?? ''}'.isNotEmpty ? ' · ${a['brand']} ${a['model'] ?? ''}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
                                Text([hrEmpName(a['employee']), (a['employee'] is Map ? a['employee']['employeeNumber'] : null), _idOf(a['employee'])].where((x) => x != null && '$x'.isNotEmpty && '$x' != '—').join(' · '),
                                    style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                Text([HrAssetVocab.typeLabel(a['type']), a['serialNumber'], a['condition'] == null ? null : HrAssetVocab.conditionLabel(a['condition'])].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
                                    style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                const SizedBox(height: 4),
                                Wrap(spacing: 6, children: [
                                  a['status'] == 'assigned'
                                      ? Chip2(tr('بعهدة الموظف', 'Assigned'), T.warn)
                                      : Chip2('${tr('مُرجَعة', 'Returned')} ${gregDay(a['returnedDate'])}', T.success),
                                  Chip2(_src(a), _itOwned(a) ? T.info : T.inkSoft),
                                ]),
                              ])),
                              if (_locked(a))
                                const Padding(padding: EdgeInsets.all(8), child: Icon(Icons.lock_outline, color: T.inkFaint, size: 18))
                              else
                                PopupMenuButton<String>(
                                  icon: const Icon(Icons.more_vert, color: T.inkFaint),
                                  onSelected: (v) {
                                    if (v == 'return') _return(a);
                                    if (v == 'edit') _form(a);
                                    if (v == 'delete') _remove(a);
                                  },
                                  itemBuilder: (_) => [
                                    if (a['status'] == 'assigned') PopupMenuItem(value: 'return', child: Text(tr('إرجاع', 'Return'))),
                                    PopupMenuItem(value: 'edit', child: Text(tr('تعديل', 'Edit'))),
                                    PopupMenuItem(value: 'delete', child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
                                  ],
                                ),
                            ]),
                          ),
                        ),
                      ),
                    const SizedBox(height: 70),
                  ]),
                ),
    );
  }
}

// HR settings: /system/hr/settings.
class HrSettingsScreen extends StatefulWidget {
  const HrSettingsScreen({super.key});
  @override
  State<HrSettingsScreen> createState() => _HrSettingsScreenState();
}

const _alertDocs = [
  ('iqama', 'الإقامة', 'Iqama'), ('passport', 'جواز السفر', 'Passport'), ('workPermit', 'رخصة العمل', 'Work permit'),
  ('healthCertificate', 'الشهادة الصحية', 'Health certificate'), ('driverCard', 'بطاقة السائق', 'Driver card'),
  ('drivingLicense', 'رخصة القيادة', 'Driving licence'), ('medicalInsurance', 'التأمين الطبي', 'Medical insurance'),
  ('contract', 'العقد', 'Contract'), ('visa', 'التأشيرة', 'Visa'), ('ajeer', 'أجير', 'Ajeer'),
];

class _HrSettingsScreenState extends State<HrSettingsScreen> {
  List<Map<String, dynamic>> _types = [];
  final Map<String, TextEditingController> _alerts = {for (final d in _alertDocs) d.$1: TextEditingController(text: '30')};
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final lt = await Api.instance.get('/api/hr/leave-types');
      Map<String, dynamic> al = {};
      try { al = Map<String, dynamic>.from((await Api.instance.get('/api/hr/settings'))['alerts'] ?? {}); } catch (_) {}
      if (!mounted) return;
      setState(() {
        _types = List<Map<String, dynamic>>.from((lt as Map)['leaveTypes'] ?? []);
        for (final d in _alertDocs) { _alerts[d.$1]!.text = '${al[d.$1] ?? 30}'; }
        _loading = false;
      });
    } catch (e) {
      if (mounted) { setState(() => _loading = false); hrSnack(context, e.toString()); }
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/hr/settings', {'alerts': {for (final d in _alertDocs) d.$1: int.tryParse(_alerts[d.$1]!.text.trim()) ?? 0}});
      if (mounted) hrSnack(context, tr('حُفظت الإعدادات', 'Settings saved'));
    } catch (e) { if (mounted) hrSnack(context, e.toString()); }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    String yn(dynamic v) => v == false ? tr('لا', 'No') : tr('نعم', 'Yes');
    return AppScaffold(
      title: Text(tr('إعدادات الموارد البشرية', 'HR Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), children: [
                // Leave types (managed from their own page).
                AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.event_note_outlined, color: T.orange, size: 18),
                    const SizedBox(width: 6),
                    Expanded(child: Text('${tr('أنواع الإجازات', 'Leave types')} (${_types.length})', style: const TextStyle(fontWeight: FontWeight.w800))),
                  ]),
                  const SizedBox(height: 6),
                  for (final x in _types)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(children: [
                        Expanded(child: Text(Lang.instance.ar ? '${x['nameAr']}' : '${x['nameEn']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                        Chip2('${tr('رصيد', 'Bal.')}: ${yn(x['affectsBalance'])}', x['affectsBalance'] == false ? T.inkFaint : T.info),
                        const SizedBox(width: 4),
                        Chip2(x['requiresAdvanceNotice'] == false ? tr('معفاة', 'Exempt') : '${x['minAdvanceDays'] ?? 30} ${tr('يوم', 'd')}', T.warn),
                        Chip2(x['countsFridays'] == true ? tr('الجمعة تُحسب', 'Fridays counted') : tr('الجمعة لا تُحسب', 'Fridays off'), T.inkSoft),
                        if (x['active'] == false) ...[const SizedBox(width: 4), Chip2(tr('غير نشط', 'Inactive'), T.inkFaint)],
                      ]),
                    ),
                  if (_types.isEmpty) Text(tr('لا أنواع بعد', 'No types yet'), style: const TextStyle(color: T.inkFaint)),
                ])),
                const SizedBox(height: 12),
                // Alert thresholds.
                AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.notifications_active_outlined, color: T.orange, size: 18),
                    const SizedBox(width: 6),
                    Text(tr('تنبيه انتهاء المستندات', 'Document-expiry alerts'), style: const TextStyle(fontWeight: FontWeight.w800)),
                  ]),
                  Text(tr('كم يومًا قبل الانتهاء يظهر المستند في شاشة الانتهاءات؟', 'How many days before expiry should a document appear in the expiries screen?'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 10, runSpacing: 10, children: [
                    for (final d in _alertDocs)
                      SizedBox(width: 150, child: TextField(
                        controller: _alerts[d.$1],
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(isDense: true, labelText: tr(d.$2, d.$3), suffixText: tr('يوم', 'd')),
                      )),
                  ]),
                  const SizedBox(height: 10),
                  FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ', 'Save'))),
                ])),
                const SizedBox(height: 12),
                // Department lists, ReferenceDataManager module="hr" alsoType="jp_task_hr".
                const FleetReferenceLists(module: 'hr', alsoType: 'jp_task_hr'),
              ]),
            ),
    );
  }
}
