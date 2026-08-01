import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
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

  static const _renewables = [
    ('iqama', 'الإقامة', 'Iqama'), ('passport', 'الجواز', 'Passport'),
    ('workPermit', 'رخصة العمل', 'Work permit'), ('insurance', 'التأمين', 'Insurance'),
    ('visa', 'التأشيرة', 'Visa'), ('license', 'رخصة القيادة', 'Driving license'),
    ('driverCard', 'بطاقة التشغيل', 'Driver card'), ('ajeer', 'أجير', 'Ajeer'),
  ];

  // تجديد مستند: اختيار النوع + تاريخ انتهاء جديد (+ رقم اختياري) → POST renew.
  Future<void> _renewDoc() async {
    String docType = 'iqama';
    DateTime? newExpiry;
    final number = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تجديد مستند', 'Renew document'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: docType,
              decoration: InputDecoration(labelText: tr('نوع المستند', 'Document type')),
              items: _renewables.map((t) => DropdownMenuItem(value: t.$1, child: Text(tr(t.$2, t.$3)))).toList(),
              onChanged: (v) => setSheet(() => docType = v ?? 'iqama'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: ${newExpiry == null ? tr('اختر', 'Pick') : newExpiry!.toIso8601String().split('T').first}'),
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 365)), firstDate: DateTime(2020), lastDate: DateTime(2040));
                if (d != null) setSheet(() => newExpiry = d);
              },
            ),
            const SizedBox(height: 10),
            TextField(controller: number, decoration: InputDecoration(labelText: tr('رقم المستند (اختياري)', 'Document number (optional)'))),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: newExpiry == null ? null : () => Navigator.pop(c, true),
              child: Text(tr('تجديد', 'Renew')),
            ),
          ]),
        ),
      ),
    );
    if (ok != true || newExpiry == null) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/renew', {
        'docType': docType,
        'newExpiry': newExpiry!.toIso8601String().split('T').first,
        if (number.text.trim().isNotEmpty) 'documentNumber': number.text.trim(),
      });
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التجديد', 'Renewed'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // رفع مستند: اختيار ملف (PDF/صورة/…) → base64 + العنوان والتصنيف → POST.
  Future<void> _uploadDocument() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    final category = TextEditingController();
    DateTime? expiry;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('رفع مستند', 'Upload document'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.insert_drive_file_outlined, size: 18, color: T.navy),
            const SizedBox(width: 8),
            Expanded(child: Text(picked.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
            Text('${(picked.sizeBytes / 1024).toStringAsFixed(0)} KB', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
          const SizedBox(height: 12),
          TextField(controller: title, decoration: InputDecoration(labelText: tr('اسم المستند *', 'Document name *'))),
          const SizedBox(height: 10),
          TextField(controller: category, decoration: InputDecoration(labelText: tr('التصنيف', 'Category'))),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
            label: Text('${tr('تاريخ الانتهاء (اختياري)', 'Expiry (optional)')}: ${expiry == null ? '—' : expiry!.toIso8601String().split('T').first}'),
            onPressed: () async {
              final d = await showDatePicker(context: c, initialDate: DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2040));
              if (d != null) setS(() => expiry = d);
            },
          ),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('رفع', 'Upload')))),
        ]),
      )),
    );
    if (ok != true || title.text.trim().isEmpty) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/documents', {
        'title': title.text.trim(),
        'fileName': picked.fileName,
        'dataUrl': picked.dataUrl,
        if (category.text.trim().isNotEmpty) 'category': category.text.trim(),
        if (expiry != null) 'expiryDate': expiry!.toIso8601String().split('T').first,
      });
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم رفع المستند', 'Document uploaded'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _deleteDocument(Map<String, dynamic> doc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المستند', 'Delete document')),
        content: Text(tr('حذف «${doc['title'] ?? doc['fileName']}»؟', 'Delete this document?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/hr/documents/${doc['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  // إنهاء الخدمة: سبب + تاريخ → POST terminate.
  Future<void> _terminate() async {
    final reason = TextEditingController();
    DateTime when = DateTime.now();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setD) => AlertDialog(
          title: Text(tr('إنهاء خدمة الموظف', 'End of service')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 16),
              label: Text('${tr('التاريخ', 'Date')}: ${when.toIso8601String().split('T').first}'),
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: when, firstDate: DateTime(2015), lastDate: DateTime(2035));
                if (d != null) setD(() => when = d);
              },
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إنهاء الخدمة', 'End service'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/terminate', {
        'reason': reason.text.trim(),
        'date': when.toIso8601String().split('T').first,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // إعادة تفعيل موظف منتهي الخدمة.
  Future<void> _reactivate() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إعادة تفعيل الموظف', 'Reactivate employee')),
        content: Text(tr('سيعود الموظف إلى حالة «على رأس العمل».', 'The employee returns to active status.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => Navigator.pop(c, true), child: Text(tr('تفعيل', 'Reactivate'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/reactivate', {});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

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
      builder: (c) => EditEmployeeSheet(employee: _emp, onDone: _load),
    );
  }

  // عقد جديد للموظف — نوع/تواريخ/راتب/بدلات/إجازة سنوية، بنفس حقول نموذج الويب.
  void _newContract() {
    final jobTitle = TextEditingController(text: (_emp['jobTitle'] ?? '').toString());
    final basicSalary = TextEditingController();
    final allowances = TextEditingController();
    final annualLeave = TextEditingController(text: '21');
    final duration = TextEditingController(text: '12');
    String type = 'fixed';
    DateTime start = DateTime.now();
    DateTime end = DateTime.now().add(const Duration(days: 365));
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        String fmt(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${tr('عقد جديد', 'New contract')} — $_name', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: InputDecoration(labelText: tr('نوع العقد', 'Contract type')),
                  items: [
                    DropdownMenuItem(value: 'fixed', child: Text(tr('محدد المدة', 'Fixed-term'))),
                    DropdownMenuItem(value: 'unlimited', child: Text(tr('غير محدد المدة', 'Unlimited'))),
                  ],
                  onChanged: (v) => setS(() => type = v ?? type),
                ),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () async {
                    final v = await showDatePicker(context: c, initialDate: start, firstDate: DateTime(2015), lastDate: DateTime(2100));
                    if (v != null) setS(() => start = v);
                  }, icon: const Icon(Icons.event, size: 16), label: Text('${tr('من', 'From')} ${fmt(start)}', style: const TextStyle(fontSize: 11.5)))),
                  if (type == 'fixed') ...[
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton.icon(onPressed: () async {
                      final v = await showDatePicker(context: c, initialDate: end, firstDate: DateTime(2015), lastDate: DateTime(2100));
                      if (v != null) setS(() => end = v);
                    }, icon: const Icon(Icons.event, size: 16), label: Text('${tr('إلى', 'To')} ${fmt(end)}', style: const TextStyle(fontSize: 11.5)))),
                  ],
                ]),
                const SizedBox(height: 10),
                TextField(controller: jobTitle, decoration: InputDecoration(labelText: tr('المسمى الوظيفي', 'Job title'))),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: TextField(controller: basicSalary, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الراتب الأساسي', 'Basic salary')))),
                  const SizedBox(width: 10),
                  Expanded(child: TextField(controller: allowances, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('البدلات', 'Allowances')))),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: TextField(controller: annualLeave, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الإجازة السنوية (يوم)', 'Annual leave (days)')))),
                  const SizedBox(width: 10),
                  Expanded(child: TextField(controller: duration, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المدة (شهر)', 'Duration (months)')))),
                ]),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () async {
                      try {
                        await Api.instance.post('/api/hr/contracts', {
                          'employee': widget.employeeId,
                          'type': type,
                          'startDate': fmt(start),
                          if (type == 'fixed') 'endDate': fmt(end),
                          'durationMonths': num.tryParse(duration.text) ?? 12,
                          'jobTitle': jobTitle.text.trim(),
                          'basicSalary': num.tryParse(basicSalary.text) ?? 0,
                          'allowances': num.tryParse(allowances.text) ?? 0,
                          'annualLeaveDays': num.tryParse(annualLeave.text) ?? 21,
                          'status': 'active',
                        });
                        if (c.mounted) Navigator.pop(c);
                        _load();
                      } catch (e) {
                        if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    },
                    child: Text(tr('إنشاء العقد', 'Create contract')),
                  ),
                ),
              ]),
            ),
          ),
        );
      }),
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
    final renewals = List<Map<String, dynamic>>.from(_d?['renewals'] ?? []);
    final balance = _d?['balance'] as Map<String, dynamic>?;

    return DefaultTabController(
      length: 7,
      child: AppScaffold(
        title: Text(_loading ? tr('ملف الموظف', 'Employee') : _name),
        actions: [
          IconButton(icon: const Icon(Icons.post_add_outlined), tooltip: tr('عقد جديد', 'New contract'), onPressed: _loading ? null : _newContract),
          IconButton(icon: const Icon(Icons.edit_outlined), tooltip: tr('تعديل', 'Edit'), onPressed: _loading ? null : _edit),
          if (!_loading)
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert),
              onSelected: (v) {
                if (v == 'renew') _renewDoc();
                if (v == 'upload') _uploadDocument();
                if (v == 'terminate') _terminate();
                if (v == 'reactivate') _reactivate();
              },
              itemBuilder: (c) => [
                PopupMenuItem(value: 'renew', child: Row(children: [
                  const Icon(Icons.autorenew_rounded, size: 18, color: T.info), const SizedBox(width: 10),
                  Text(tr('تجديد مستند', 'Renew document')),
                ])),
                PopupMenuItem(value: 'upload', child: Row(children: [
                  const Icon(Icons.upload_file_outlined, size: 18, color: T.navy), const SizedBox(width: 10),
                  Text(tr('رفع مستند', 'Upload document')),
                ])),
                if (_emp['employmentStatus'] != 'terminated')
                  PopupMenuItem(value: 'terminate', child: Row(children: [
                    const Icon(Icons.person_off_outlined, size: 18, color: T.danger), const SizedBox(width: 10),
                    Text(tr('إنهاء الخدمة', 'End of service')),
                  ]))
                else
                  PopupMenuItem(value: 'reactivate', child: Row(children: [
                    const Icon(Icons.restart_alt_rounded, size: 18, color: T.success), const SizedBox(width: 10),
                    Text(tr('إعادة تفعيل', 'Reactivate')),
                  ])),
              ],
            ),
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
            Tab(text: tr('المركبات', 'Vehicles')),
            Tab(text: '${tr('السجل', 'History')} (${renewals.length})'),
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
                    _listTab(documents, Icons.folder_open_outlined, tr('لا توجد مستندات — استخدم «رفع مستند» من القائمة', 'No documents — use "Upload document" from the menu'), (doc) {
                      return Pressable(
                        onLongPress: () => _deleteDocument(doc),
                        child: AppCard(
                          child: Row(children: [
                            const Icon(Icons.insert_drive_file_outlined, color: T.violet, size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text((doc['title'] ?? doc['fileName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text([_date(doc['createdAt']), if ((doc['category'] ?? '').toString().isNotEmpty) doc['category']].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                              ]),
                            ),
                            const Icon(Icons.delete_outline, size: 17, color: T.inkFaint),
                          ]),
                        ),
                      );
                    }),
                    // ── المركبات ──
                    _EmployeeVehiclesTab(employeeId: widget.employeeId),
                    // ── السجل (التجديدات) ──
                    _listTab(renewals, Icons.history_rounded, tr('لا يوجد سجل تجديدات', 'No renewal history'), (rn) {
                      return AppCard(
                        child: Row(children: [
                          const Icon(Icons.autorenew_rounded, color: T.info, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text((rn['docType'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                              Text('${tr('من', 'from')} ${_date(rn['previousExpiry'])} ${tr('إلى', 'to')} ${_date(rn['newExpiry'])}',
                                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                            ]),
                          ),
                          Text(_date(rn['createdAt']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
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
class EditEmployeeSheet extends StatefulWidget {
  final Map<String, dynamic>? employee;
  final Future<void> Function() onDone;
  const EditEmployeeSheet({super.key, this.employee, required this.onDone});

  @override
  State<EditEmployeeSheet> createState() => _EditEmployeeSheetState();
}

class _EditEmployeeSheetState extends State<EditEmployeeSheet> {
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
    _c = {for (final f in _fields) f.$1: TextEditingController(text: (widget.employee?[f.$1] ?? '').toString())};
    _status = (widget.employee?['employmentStatus'] ?? 'active').toString();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final body = {
        for (final f in _fields) f.$1: _c[f.$1]!.text.trim(),
        'employmentStatus': _status,
      };
      if (widget.employee == null) {
        await Api.instance.post('/api/hr/employees', body);
      } else {
        await Api.instance.put('/api/hr/employees/${widget.employee!['_id']}', body);
      }
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

// تبويب مركبات الموظف: التفويض الحالي + سجل التفاويض + الحوادث.
// /api/vehicles/by-employee/:id → { current, authorizations, accidents }
class _EmployeeVehiclesTab extends StatefulWidget {
  final String employeeId;
  const _EmployeeVehiclesTab({required this.employeeId});
  @override
  State<_EmployeeVehiclesTab> createState() => _EmployeeVehiclesTabState();
}

class _EmployeeVehiclesTabState extends State<_EmployeeVehiclesTab> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicles/by-employee/${widget.employeeId}');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _plate(dynamic v) => v is Map ? (v['plateNumber'] ?? '—').toString() : '—';
  String _dt(dynamic v) {
    final x = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return x == null ? '—' : '${x.day}/${x.month}/${x.year}';
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)]);
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    final current = _d?['current'];
    final auths = List<Map<String, dynamic>>.from(_d?['authorizations'] ?? []);
    final accidents = List<Map<String, dynamic>>.from(_d?['accidents'] ?? []);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        if (current is Map) AppCard(
          topAccent: T.success,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('التفويض الحالي', 'Current authorization'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 6),
            Row(children: [
              const Icon(Icons.local_shipping_outlined, size: 18, color: T.navy),
              const SizedBox(width: 8),
              Text(_plate(current['vehicle']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const Spacer(),
              Chip2(tr('نشط', 'Active'), T.success),
            ]),
          ]),
        ),
        const SizedBox(height: 12),
        Text('${tr('سجل التفاويض', 'Authorization history')} (${auths.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 8),
        if (auths.isEmpty) EmptyState(icon: Icons.assignment_ind_outlined, title: tr('لا توجد تفاويض', 'No authorizations')),
        ...auths.map((a) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: AppCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                child: Row(children: [
                  Expanded(child: Text(_plate(a['vehicle']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                  Text('${_dt(a['startDate'])} → ${a['endDate'] != null ? _dt(a['endDate']) : '…'}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  const SizedBox(width: 8),
                  Chip2(a['status'] == 'active' ? tr('نشط', 'Active') : tr('منتهٍ', 'Ended'), a['status'] == 'active' ? T.success : T.inkFaint),
                ]),
              ),
            )),
        if (accidents.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('${tr('الحوادث', 'Accidents')} (${accidents.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          ...accidents.map((a) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  child: Row(children: [
                    const Icon(Icons.car_crash_outlined, size: 18, color: T.danger),
                    const SizedBox(width: 8),
                    Expanded(child: Text(_plate(a['vehicle']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                    Text(_dt(a['date']), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ]),
                ),
              )),
        ],
        const SizedBox(height: 20),
      ]),
    );
  }
}
