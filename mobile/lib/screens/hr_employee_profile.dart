import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملف الموظف الكامل — the same profile the web opens: identity + job data,
/// contracts, leaves, custody assets, documents & renewals — in tabs, with
/// an edit sheet for the main fields.
class HrEmployeeProfileScreen extends StatefulWidget {
  final String employeeId;
  const HrEmployeeProfileScreen({super.key, required this.employeeId});

  @override
  State<HrEmployeeProfileScreen> createState() => _HrEmployeeProfileScreenState();
}

const _empStatus = {
  'active': ('على رأس العمل', 'Active', T.success),
  'on_leave': ('في إجازة', 'On leave', T.info),
  'suspended': ('موقوف', 'Suspended', T.warn),
  'terminated': ('منتهي الخدمة', 'Terminated', T.danger),
};

class _HrEmployeeProfileScreenState extends State<HrEmployeeProfileScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/employees/${widget.employeeId}');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Map<String, dynamic> get _emp => (_d?['employee'] as Map<String, dynamic>?) ?? {};

  String get _name {
    final ar = (_emp['arabicName'] ?? '').toString();
    final en = '${_emp['firstName'] ?? ''} ${_emp['lastName'] ?? ''}'.trim();
    return Lang.instance.ar ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);
  }

  String _date(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString()) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
  }

  void _edit() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _EditEmployeeSheet(employee: _emp, onDone: _load),
    );
  }

  Widget _info(String label, dynamic value, {bool ltr = false}) {
    final text = (value ?? '').toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 118, child: Text(label, style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
        Expanded(
          child: Text(text.isEmpty ? '—' : text,
              textDirection: ltr ? TextDirection.ltr : null,
              textAlign: Lang.instance.ar && ltr ? TextAlign.right : null,
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final st = _empStatus[_emp['employmentStatus']] ?? _empStatus['active']!;
    final contracts = List<Map<String, dynamic>>.from(_d?['contracts'] ?? []);
    final leaves = List<Map<String, dynamic>>.from(_d?['leaves'] ?? []);
    final assets = List<Map<String, dynamic>>.from(_d?['assets'] ?? []);
    final documents = List<Map<String, dynamic>>.from(_d?['documents'] ?? []);
    final balance = _d?['balance'] as Map<String, dynamic>?;

    return DefaultTabController(
      length: 5,
      child: AppScaffold(
        title: Text(_loading ? tr('ملف الموظف', 'Employee') : _name),
        actions: [
          IconButton(icon: const Icon(Icons.edit_outlined), tooltip: tr('تعديل', 'Edit'), onPressed: _loading ? null : _edit),
        ],
        appBarBottom: TabBar(
          isScrollable: true,
          indicatorColor: T.orange,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: [
            Tab(text: tr('البيانات', 'Info')),
            Tab(text: '${tr('العقود', 'Contracts')} (${contracts.length})'),
            Tab(text: '${tr('الإجازات', 'Leaves')} (${leaves.length})'),
            Tab(text: '${tr('العهد', 'Custody')} (${assets.length})'),
            Tab(text: '${tr('المستندات', 'Documents')} (${documents.length})'),
          ],
        ),
        body: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [
                Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 220), SizedBox(height: 10), Shimmer(height: 120),
              ])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : TabBarView(children: [
                    // ── البيانات ──
                    RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(14), children: [
                        FadeSlideIn(
                          child: AppCard(
                            child: Row(children: [
                              CircleAvatar(
                                radius: 26,
                                backgroundColor: st.$3.withValues(alpha: 0.12),
                                child: Text(_name.isNotEmpty ? _name.characters.first : '؟',
                                    style: TextStyle(color: st.$3, fontSize: 22, fontWeight: FontWeight.w800)),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(_name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                                  Text([_emp['jobTitle'], _emp['department']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                      style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                ]),
                              ),
                              Chip2(tr(st.$1, st.$2), st.$3),
                            ]),
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (balance != null)
                          FadeSlideIn(
                            delayMs: 60,
                            child: Row(children: [
                              Expanded(child: StatCard(label: tr('الاستحقاق', 'Entitled'), value: (balance['entitlement'] ?? 0) as num, color: T.navy, icon: Icons.beach_access_outlined)),
                              const SizedBox(width: 8),
                              Expanded(child: StatCard(label: tr('المستخدم', 'Taken'), value: (balance['taken'] ?? 0) as num, color: T.warn, icon: Icons.event_busy_outlined)),
                              const SizedBox(width: 8),
                              Expanded(child: StatCard(label: tr('المتاح', 'Available'), value: (balance['available'] ?? 0) as num, color: T.success, icon: Icons.event_available_outlined)),
                            ]),
                          ),
                        const SizedBox(height: 10),
                        FadeSlideIn(
                          delayMs: 120,
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(tr('البيانات الوظيفية', 'Job details'), style: const TextStyle(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 6),
                              _info(tr('رقم الموظف', 'Employee no.'), _emp['employeeNumber'], ltr: true),
                              _info(tr('المسمى الوظيفي', 'Job title'), _emp['jobTitle']),
                              _info(tr('القسم', 'Department'), _emp['department']),
                              _info(tr('المشروع', 'Project'), _emp['project']),
                              _info(tr('الفرع', 'Branch'), (_emp['branch'] as Map<String, dynamic>?)?['name']),
                              _info(tr('تاريخ التعيين', 'Hire date'), _date(_emp['hireDate'])),
                              _info(tr('المدير المباشر', 'Manager'),
                                  _emp['directManager'] is Map
                                      ? '${_emp['directManager']['firstName'] ?? ''} ${_emp['directManager']['lastName'] ?? ''}'.trim()
                                      : null),
                            ]),
                          ),
                        ),
                        const SizedBox(height: 10),
                        FadeSlideIn(
                          delayMs: 180,
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(tr('الهوية والاتصال', 'Identity & contact'), style: const TextStyle(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 6),
                              _info(tr('الجنسية', 'Nationality'), _emp['nationality']),
                              _info(tr('رقم الإقامة', 'Iqama'), _emp['iqamaNumber'], ltr: true),
                              _info(tr('انتهاء الإقامة', 'Iqama expiry'), _date(_emp['iqamaExpiry'])),
                              _info(tr('الجوال', 'Mobile'), _emp['mobileNumber'] ?? _emp['phone'], ltr: true),
                              _info(tr('البريد', 'Email'), _emp['email'], ltr: true),
                              _info(tr('انتهاء الجواز', 'Passport expiry'), _date(_emp['passportExpiry'])),
                              _info(tr('انتهاء العقد', 'Contract expiry'), _date(_emp['contractExpiry'])),
                            ]),
                          ),
                        ),
                      ]),
                    ),
                    // ── العقود ──
                    _listTab(contracts, Icons.description_outlined, tr('لا توجد عقود', 'No contracts'), (c0) {
                      return AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((c0['contractType'] ?? c0['type'] ?? tr('عقد', 'Contract')).toString(), style: const TextStyle(fontWeight: FontWeight.w800))),
                            Chip2((c0['status'] ?? '—').toString(), c0['status'] == 'active' ? T.success : T.inkFaint),
                          ]),
                          const SizedBox(height: 6),
                          Text('${_date(c0['startDate'])} ← ${_date(c0['endDate'])}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          if (c0['basicSalary'] != null)
                            Text('${tr('الراتب الأساسي', 'Basic salary')}: ${c0['basicSalary']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                        ]),
                      );
                    }),
                    // ── الإجازات ──
                    _listTab(leaves, Icons.beach_access_outlined, tr('لا توجد إجازات', 'No leaves'), (l) {
                      final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                      return AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text(type.toString(), style: const TextStyle(fontWeight: FontWeight.w800))),
                            Chip2((l['status'] ?? '—').toString(), l['status'] == 'approved' ? T.success : l['status'] == 'rejected' ? T.danger : T.warn),
                          ]),
                          const SizedBox(height: 4),
                          Text('${_date(l['startDate'])} ← ${_date(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                              style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                        ]),
                      );
                    }),
                    // ── العهد ──
                    _listTab(assets, Icons.devices_other_outlined, tr('لا توجد عهد', 'No custody items'), (a) {
                      return AppCard(
                        child: Row(children: [
                          const Icon(Icons.devices_other_outlined, color: T.cyan, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text((a['name'] ?? a['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                              Text([a['type'], a['serialNumber']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                            ]),
                          ),
                          Chip2((a['status'] ?? '—').toString(), T.navy),
                        ]),
                      );
                    }),
                    // ── المستندات ──
                    _listTab(documents, Icons.folder_open_outlined, tr('لا توجد مستندات مرفوعة', 'No documents'), (doc) {
                      return AppCard(
                        child: Row(children: [
                          const Icon(Icons.insert_drive_file_outlined, color: T.violet, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text((doc['title'] ?? doc['fileName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                              Text(_date(doc['createdAt']), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            ]),
                          ),
                        ]),
                      );
                    }),
                  ]),
      ),
    );
  }

  Widget _listTab(List<Map<String, dynamic>> items, IconData icon, String empty, Widget Function(Map<String, dynamic>) card) {
    if (items.isEmpty) return EmptyState(icon: icon, title: empty);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(14),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (c, i) => FadeSlideIn(delayMs: (i * 20).clamp(0, 200), child: card(items[i])),
      ),
    );
  }
}

/// تعديل الحقول الأساسية — PUT /api/hr/employees/:id (الخادم يتجاهل ما لا يعرفه).
class _EditEmployeeSheet extends StatefulWidget {
  final Map<String, dynamic> employee;
  final Future<void> Function() onDone;
  const _EditEmployeeSheet({required this.employee, required this.onDone});

  @override
  State<_EditEmployeeSheet> createState() => _EditEmployeeSheetState();
}

class _EditEmployeeSheetState extends State<_EditEmployeeSheet> {
  late final Map<String, TextEditingController> _c;
  String _status = 'active';
  bool _busy = false;

  static const _fields = [
    ('firstName', 'الاسم الأول', 'First name'),
    ('lastName', 'اسم العائلة', 'Last name'),
    ('arabicName', 'الاسم العربي', 'Arabic name'),
    ('jobTitle', 'المسمى الوظيفي', 'Job title'),
    ('department', 'القسم', 'Department'),
    ('project', 'المشروع', 'Project'),
    ('mobileNumber', 'الجوال', 'Mobile'),
    ('email', 'البريد', 'Email'),
    ('iqamaNumber', 'رقم الإقامة', 'Iqama'),
    ('nationality', 'الجنسية', 'Nationality'),
  ];

  @override
  void initState() {
    super.initState();
    _c = {for (final f in _fields) f.$1: TextEditingController(text: (widget.employee[f.$1] ?? '').toString())};
    _status = (widget.employee['employmentStatus'] ?? 'active').toString();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await Api.instance.put('/api/hr/employees/${widget.employee['_id']}', {
        for (final f in _fields) f.$1: _c[f.$1]!.text.trim(),
        'employmentStatus': _status,
      });
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(18),
          children: [
            Text(tr('تعديل بيانات الموظف', 'Edit employee'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            ..._fields.map((f) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TextField(controller: _c[f.$1], decoration: InputDecoration(labelText: tr(f.$2, f.$3))),
                )),
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: InputDecoration(labelText: tr('حالة الموظف', 'Status')),
              items: _empStatus.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (v) => setState(() => _status = v ?? _status),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(tr('حفظ التعديلات', 'Save changes')),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }
}
