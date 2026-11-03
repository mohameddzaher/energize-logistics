import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/ht_custody_panel.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/leave_return.dart';
import '../ui/leave_record.dart';
import '../ui/hr_quick.dart';
import '../ui/report_button.dart';
import '../ui/export_sheet.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import 'hr_all_fields.dart';
import 'jp.dart' show JpTaskPanel;

/// Full employee file, the same profile the web opens: identity and job data, contracts, leaves, custody assets, documents and renewals in tabs, with an edit sheet for the main fields.
class HrEmployeeProfileScreen extends StatefulWidget {
  final String employeeId;
  const HrEmployeeProfileScreen({super.key, required this.employeeId});

  @override
  State<HrEmployeeProfileScreen> createState() => _HrEmployeeProfileScreenState();
}

const _empStatus = {
  // Work status: working or not working (not working = service ended, with one of three states), like the web.
  'active': ('يعمل', 'Working', T.success),
  'on_leave': ('إجازة', 'On leave', T.info),
  'suspended': ('موقوف (قديم)', 'Suspended (legacy)', T.warn),
  'terminated': ('لا يعمل', 'Not working', T.danger),
};

class _HrEmployeeProfileScreenState extends State<HrEmployeeProfileScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    // A master edit, employee file edit or driver card edit from vehicles arrives here immediately.
    Live.instance.on('hr:master', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  void _onLive() => _load();

  @override
  void dispose() {
    Live.instance.off('hr:master', _onLive);
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
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

  // Renew a document: pick the type and a new expiry date (optional number), then POST renew.
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
              label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: ${newExpiry == null ? tr('اختر', 'Pick') : newExpiry!.toIso8601String().split('T').first}${newExpiry == null ? '' : '\n${hijriHint(newExpiry, ar: Lang.instance.ar)}'}'),
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

  // Upload a document: pick a file (PDF, image, ...), send base64 with title and category, then POST.
  Future<void> _uploadDocument() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    String category = 'other';
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
          DropdownButtonFormField<String>(
            initialValue: category,
            decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
            items: [for (final c in hrDocCategories) DropdownMenuItem(value: c.$1, child: Text(tr(c.$2, c.$3)))],
            onChanged: (v) => setS(() => category = v ?? category),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
            label: Text('${tr('تاريخ الانتهاء (اختياري)', 'Expiry (optional)')}: ${expiry == null ? '—' : expiry!.toIso8601String().split('T').first}${expiry == null ? '' : '\n${hijriHint(expiry, ar: Lang.instance.ar)}'}'),
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
        'category': category,
        if (expiry != null) 'expiryDate': expiry!.toIso8601String().split('T').first,
      });
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم رفع المستند', 'Document uploaded'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Opens the uploaded file (served from `/api/uploads/...`) in the device browser.
  Future<void> _openDocument(Map<String, dynamic> doc) async {
    final u = '${doc['fileUrl'] ?? ''}';
    if (u.isEmpty) return;
    final ok = await launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
    if (!ok && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تعذّر فتح الملف', 'Could not open the file'))));
  }

  /// Edit file metadata (name, category, expiry, notes): PUT /api/hr/documents/:id, like the web edit-file form. The file itself cannot be replaced from here or on the web.
  Future<void> _editDocument(Map<String, dynamic> doc) async {
    final title = TextEditingController(text: '${doc['title'] ?? ''}');
    final notes = TextEditingController(text: '${doc['notes'] ?? ''}');
    String category = hrDocCategories.any((c) => c.$1 == doc['category']) ? '${doc['category']}' : 'other';
    DateTime? expiry = DateTime.tryParse('${doc['expiryDate'] ?? ''}');
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('تعديل ملف', 'Edit file'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          TextField(controller: title, decoration: InputDecoration(labelText: tr('اسم الملف / الوصف', 'Name / description'))),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: category,
            decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
            items: [for (final x in hrDocCategories) DropdownMenuItem(value: x.$1, child: Text(tr(x.$2, x.$3)))],
            onChanged: (v) => setS(() => category = v ?? category),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('تاريخ انتهاء المستند', 'Document expiry')}: ${expiry == null ? '—' : expiry!.toIso8601String().split('T').first}${expiry == null ? '' : '\n${hijriHint(expiry, ar: Lang.instance.ar)}'}'),
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: expiry ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2060));
                if (d != null) setS(() => expiry = d);
              },
            )),
            if (expiry != null) IconButton(tooltip: tr('مسح', 'Clear'), onPressed: () => setS(() => expiry = null), icon: const Icon(Icons.close)),
          ]),
          const SizedBox(height: 10),
          TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
        ]),
      )),
    );
    if (ok != true || title.text.trim().isEmpty) return;
    try {
      await Api.instance.put('/api/hr/documents/${doc['_id']}', {
        'title': title.text.trim(),
        'category': category,
        'expiryDate': expiry == null ? '' : expiry!.toIso8601String().split('T').first,
        'notes': notes.text.trim(),
      });
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
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

  // End of service: reason and date, then POST terminate.
  // Clearance is asked first: the employee may hold custody or a vehicle authorization, and ending service before settling them leaves the vehicle under a non-employee. So show what he holds before a reason is written.
  Future<void> _terminate() async {
    Map<String, dynamic>? clearance;
    try {
      clearance = await Api.instance.get('/api/hr/employees/${widget.employeeId}/clearance') as Map<String, dynamic>;
    } catch (_) { clearance = null; }
    final blockers = ((clearance?['blockers'] as List?) ?? []).cast<Map<String, dynamic>>();
    if (blockers.isNotEmpty) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(tr('لا يمكن إنهاء الخدمة', 'Cannot end service')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تُسوَّى هذه البنود أوّلًا:', 'Settle these first:'),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            ...blockers.map((b) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${b['ar']} — ${b['section']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text(((b['items'] as List?) ?? []).join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              ]),
            )),
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('حسنًا', 'OK')))],
        ),
      );
      return;
    }
    if (!mounted) return;
    final reason = TextEditingController();
    DateTime when = DateTime.now();
    // "Not working" with its three states is required for termination, except for someone outside the system or a freelancer (archived immediately). Matches the web and TERMINATION_KINDS on the server.
    final archivesNow = _outOfSystem || _freelance;
    String kind = '';
    const kinds = [
      ('transfer_pending', 'انتظار نقل الكفالة', 'Awaiting sponsorship transfer'),
      ('final_exit', 'خروج نهائي', 'Final exit'),
    ];
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setD) => AlertDialog(
          title: Text(tr('إنهاء خدمة الموظف', 'End of service')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (archivesNow)
              Text(tr('خارج النظام أو فريلانسر — بإنهاء خدمته ينتقل إلى الأرشيف فورًا.', 'Out of the system or freelancer — ending his service archives him at once.'),
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft))
            else ...[
              Text(tr('حالة «لا يعمل» *', '“Not working” status *'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
              for (final k in kinds)
                ListTile(
                  dense: true, contentPadding: EdgeInsets.zero,
                  onTap: () => setD(() => kind = k.$1),
                  leading: Icon(kind == k.$1 ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: kind == k.$1 ? T.danger : T.inkFaint, size: 20),
                  title: Text(tr(k.$2, k.$3), style: const TextStyle(fontSize: 13)),
                  subtitle: k.$1 == 'transfer_pending' ? Text(tr('شهر واحد — وتنبيهات يومية لإخراجه من النظام', 'One month — daily reminders to exit the system'), style: const TextStyle(fontSize: 11)) : null,
                ),
            ],
            const SizedBox(height: 6),
            TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 16),
              label: Text('${tr('التاريخ', 'Date')}: ${when.toIso8601String().split('T').first}\n${hijriHint(when, ar: Lang.instance.ar)}'),
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: when, firstDate: DateTime(2015), lastDate: DateTime(2035));
                if (d != null) setD(() => when = d);
              },
            ),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: (!archivesNow && kind.isEmpty) ? null : () => Navigator.pop(c, true), child: Text(tr('إنهاء الخدمة', 'End service'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/terminate', {
        if (kind.isNotEmpty) 'kind': kind,
        'reason': reason.text.trim(),
        'date': when.toIso8601String().split('T').first,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Reactivate an employee whose service ended.
  // Permanent delete: for a record entered by mistake or duplicated, not for someone who left. The server refuses (EXIT_BLOCKED, with its message) anyone holding custody or a vehicle authorization.
  Future<void> _deleteEmployee() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف سجلّ «$_name» نهائيًّا؟', 'Delete the record of "$_name" permanently?')),
        content: Text(tr(
          'يُحذَف السجلُّ ومستنداتُه وتجديداتُه ولا يظهر في أيّ قائمة. لمن ترك العمل استعمل «إنهاء الخدمة» — الحذفُ لسجلٍّ أُدخل خطأً أو مكرَّرًا. تُحفَظ نسخةٌ منه في سجلّ المراجعة.',
          'The record, its documents and renewals are deleted and it disappears from every list. For someone who left, use "End of service" — deletion is for a record entered by mistake or duplicated. A copy is kept in the audit log.',
        )),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف نهائيّ', 'Delete permanently'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/hr/employees/${widget.employeeId}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

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

  // Archive flow: end of service, then out of the system, then archive, like the web. A freelancer has no exit step: ending service archives him (utils/hrEngagement on the server).
  bool get _terminated => _emp['employmentStatus'] == 'terminated';
  /// HR team by role or department grant; isHRStaff on the web.
  bool get _hrStaff {
    final a = context.read<AuthProvider>();
    return const ['super_admin', 'admin', 'hr_manager', 'hr_specialist'].contains(a.role) || a.canAccessSection('HR');
  }
  bool get _freelance => RegExp(r'فري\s*لانس|فريلانس|freelanc', caseSensitive: false).hasMatch('${_emp['registerNumber'] ?? ''}');
  bool get _outOfSystem => '${_emp['systemStatus'] ?? ''}'.trim() == 'خارج النظام';
  bool get _archived => _terminated && (_outOfSystem || _freelance);

  Future<void> _setWorkStatus(String status) async {
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/work-status', {'status': status});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// Not on our sponsorship (freelancer, trainee, unspecified): the registration number is not a commercial registration.
  bool get _notSponsored => !RegExp(r'^\s*\d{6,}\s*$').hasMatch('${_emp['registerNumber'] ?? ''}');

  /// Convert to our sponsorship: pick one of our commercial registrations, like the web.
  Future<void> _sponsor() async {
    final regs = await loadLookupNamesHr('hr_register');
    if (!mounted) return;
    final r = await pickFromList(context, title: tr('على أي سجل من سجلاتنا؟', 'Which of our registers?'), options: regs);
    if (r == null || r.isEmpty) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/sponsor', {'registerNumber': r});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('صار على كفالتنا — السجل $r', 'Now sponsored — register $r'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _systemAction(bool exit) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(exit ? tr('خروج من النظام', 'Exit the system') : tr('إعادة إلى النظام', 'Return to the system')),
        content: Text(exit
            ? tr('ينتقل الموظف إلى الأرشيف ولا يظهر في أي شاشة أو رقم آخر.', 'The employee moves to the archive and disappears from every other screen and number.')
            : tr('يعود داخل النظام ويخرج من الأرشيف.', 'He returns to the system and leaves the archive.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: exit ? T.danger : T.success), onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/hr/employees/${widget.employeeId}/${exit ? 'exit-system' : 'return-system'}', {});
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
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}${hijriDay(v).isEmpty ? '' : ' · ${hijriDay(v)} ${tr('هـ', 'AH')}'}';
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

  // New employee contract: type, dates, salary, allowances, annual leave, same fields as the web form.
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
                  }, icon: const Icon(Icons.event, size: 16), label: Text('${tr('من', 'From')} ${fmt(start)}\n${hijriHint(start, ar: Lang.instance.ar)}', style: const TextStyle(fontSize: 11.5)))),
                  if (type == 'fixed') ...[
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton.icon(onPressed: () async {
                      final v = await showDatePicker(context: c, initialDate: end, firstDate: DateTime(2015), lastDate: DateTime(2100));
                      if (v != null) setS(() => end = v);
                    }, icon: const Icon(Icons.event, size: 16), label: Text('${tr('إلى', 'To')} ${fmt(end)}\n${hijriHint(end, ar: Lang.instance.ar)}', style: const TextStyle(fontSize: 11.5)))),
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
    final noShow = (_emp['leaveViolation'] is Map && '${_emp['leaveViolation']['since'] ?? ''}'.isNotEmpty) && _emp['employmentStatus'] != 'terminated';
    final st = noShow ? ('مخالفة — لم يعد من الإجازة', 'Violation — did not return', T.danger) : (_empStatus[_emp['employmentStatus'] == 'on_leave' && _emp['leaveStatusSource'] != 'leave' ? 'active' : _emp['employmentStatus']] ?? _empStatus['active']!);
    final contracts = List<Map<String, dynamic>>.from(_d?['contracts'] ?? []);
    final leaves = List<Map<String, dynamic>>.from(_d?['leaves'] ?? []);
    final assets = List<Map<String, dynamic>>.from(_d?['assets'] ?? []);
    final documents = List<Map<String, dynamic>>.from(_d?['documents'] ?? []);
    final renewals = List<Map<String, dynamic>>.from(_d?['renewals'] ?? []);
    final balance = _d?['balance'] as Map<String, dynamic>?;

    return DefaultTabController(
      length: 8,
      child: AppScaffold(
        title: Text(_loading ? tr('ملف الموظف', 'Employee') : _name),
        actions: [
          // Employee report PDF, for the HR team as on the web.
          if (!_loading && _hrStaff) ReportButton(subject: 'employee', id: '${_emp['_id'] ?? widget.employeeId}', compact: true),
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
                if (v == 'exit') _systemAction(true);
                if (v == 'sponsor') _sponsor();
                if (v == 'sister') _setWorkStatus(_emp['sisterCompany'] == true ? 'working' : 'sister_company');
                if (v == 'return') _systemAction(false);
                if (v == 'delete') _deleteEmployee();
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
                if (!_terminated && _notSponsored)
                  PopupMenuItem(value: 'sponsor', child: Row(children: [
                    const Icon(Icons.verified_outlined, size: 18, color: T.navy), const SizedBox(width: 10),
                    Text(tr('تحويل على كفالتنا', 'Move to our sponsorship')),
                  ])),
                // Working vs sister company; the third state, not working, is end of service. Like the web.
                if (!_terminated)
                  PopupMenuItem(value: 'sister', child: Row(children: [
                    const Icon(Icons.apartment_outlined, size: 18, color: T.cyan), const SizedBox(width: 10),
                    Text(_emp['sisterCompany'] == true ? tr('إرجاعه: يعمل', 'Back to working') : tr('شركة شقيقة', 'Sister company')),
                  ])),
                if (_terminated && !_archived)
                  PopupMenuItem(value: 'exit', child: Row(children: [
                    const Icon(Icons.archive_outlined, size: 18, color: T.danger), const SizedBox(width: 10),
                    Text(tr('خروج من النظام', 'Exit the system')),
                  ])),
                if (_archived && _outOfSystem)
                  PopupMenuItem(value: 'return', child: Row(children: [
                    const Icon(Icons.unarchive_outlined, size: 18, color: T.success), const SizedBox(width: 10),
                    Text(tr('إعادة إلى النظام', 'Return to the system')),
                  ])),
                // Delete is for the system admin only; the server answers others with 405.
                if (const ['super_admin', 'admin'].contains(context.read<AuthProvider>().role))
                  PopupMenuItem(value: 'delete', child: Row(children: [
                    const Icon(Icons.delete_forever_outlined, size: 18, color: T.danger), const SizedBox(width: 10),
                    Text(tr('حذف السجلّ نهائيًّا', 'Delete record permanently'), style: const TextStyle(color: T.danger)),
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
            // All master fields, like the "Data" tab on the web for the HR team.
            Tab(text: tr('كل البيانات', 'All data')),
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
                    // Data tab.
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
                              // "Not working" carries its state: awaiting sponsorship transfer, sister company or final exit.
                              Chip2(_terminated && '${_emp['workStatusText'] ?? ''}'.contains('—') ? '${_emp['workStatusText']}'
                                  : (_emp['sisterCompany'] == true && !_terminated ? tr('شركة شقيقة', 'Sister company') : tr(st.$1, st.$2)), st.$3),
                              if (_archived) Chip2(tr('في الأرشيف', 'Archived'), T.inkFaint, icon: Icons.archive_outlined),
                              // His status today in the personnel section; written there, shown here.
                              if (b2cOpChip(_emp['b2cOpStatus']) != null) b2cOpChip(_emp['b2cOpStatus'])!,
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
                                  (_emp['directManagerName'] ?? '').toString().isNotEmpty ? _emp['directManagerName'] : _emp['directManager'] is Map
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
                              _info(tr('انتهاء العقد', 'Contract expiry'), _date(_emp['contractEndDate'])),
                            ]),
                          ),
                        ),
                        const SizedBox(height: 10),
                        JpTaskPanel(section: 'hr', kind: 'employee', refId: '${_emp['_id'] ?? widget.employeeId}'),
                      ]),
                    ),
                    // Contracts tab.
                    HrAllFieldsTab(employeeId: widget.employeeId, canEdit: true),
                    _listTab(contracts, Icons.description_outlined, tr('لا توجد عقود', 'No contracts'), (c0) {
                      return AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((c0['contractType'] ?? c0['type'] ?? tr('عقد', 'Contract')).toString(), style: const TextStyle(fontWeight: FontWeight.w800))),
                            _contractChip(c0),
                          ]),
                          const SizedBox(height: 6),
                          Text('${_date(c0['startDate'])} ← ${_date(c0['endDate'])}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          if (c0['basicSalary'] != null)
                            Text('${tr('الراتب الأساسي', 'Basic salary')}: ${c0['basicSalary']}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                        ]),
                      );
                    }),
                    // Leaves tab.
                    Column(children: [
                      if (_hrStaff)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                          child: SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () async { if (await showLeaveRecordSheet(context, employeeId: widget.employeeId)) _load(); },
                              icon: const Icon(Icons.event_available_outlined, size: 18),
                              label: Text(tr('تسجيل إجازة', 'Record a leave')),
                            ),
                          ),
                        ),
                      Expanded(child: _listTab(leaves, Icons.beach_access_outlined, tr('لا توجد إجازات', 'No leaves'), (l) {
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
                          if (l['status'] == 'approved') ...[
                            const SizedBox(height: 6),
                            Row(children: [
                              Expanded(child: Align(alignment: AlignmentDirectional.centerStart, child: LeaveReturnChip(l))),
                              if (_hrStaff)
                                TextButton(onPressed: () => showLeaveReturnSheet(context, l, _load), child: Text(tr('عودة / تمديد', 'Return / extend'))),
                            ]),
                          ],
                        ]),
                      );
                    })),
                    ]),
                    // Custody tab. Money custody from the heavy-transport ledger is shown above in-kind custody, live with the ledger.
                    Column(children: [
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 320),
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                          child: HtCustodyPanel(employeeId: widget.employeeId, showVehicle: true),
                        ),
                      ),
                      Expanded(child: _listTab(assets, Icons.devices_other_outlined, tr('لا توجد عهد', 'No custody items'), (a) {
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
                    })),
                    ]),
                    // Documents tab.
                    _listTab(documents, Icons.folder_open_outlined, tr('لا توجد مستندات — استخدم «رفع مستند» من القائمة', 'No documents — use "Upload document" from the menu'), (doc) {
                      final cat = hrDocCategories.where((x) => x.$1 == doc['category']).toList();
                      return Pressable(
                        onTap: () => _openDocument(doc),
                        onLongPress: _hrStaff ? () => _deleteDocument(doc) : null,
                        child: AppCard(
                          child: Row(children: [
                            const Icon(Icons.insert_drive_file_outlined, color: T.violet, size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text((doc['title'] ?? doc['fileName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text([_date(doc['createdAt']), cat.isNotEmpty ? tr(cat.first.$2, cat.first.$3) : (doc['category'] ?? '')].where((x) => '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                if ('${doc['expiryDate'] ?? ''}'.isNotEmpty)
                                  Text('${tr('الانتهاء', 'Expiry')}: ${_date(doc['expiryDate'])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                              ]),
                            ),
                            if (_hrStaff) ...[
                              IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 18, color: T.navy), onPressed: () => _editDocument(doc)),
                              IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 18, color: T.inkFaint), onPressed: () => _deleteDocument(doc)),
                            ],
                          ]),
                        ),
                      );
                    }),
                    // Vehicles tab.
                    _EmployeeVehiclesTab(employeeId: widget.employeeId),
                    // History tab: renewals plus the change log (/audit), like the web.
                    _HistoryTab(employeeId: widget.employeeId, renewals: renewals, staff: _hrStaff, fileName: 'employee-${_emp['employeeNumber'] ?? widget.employeeId}'),
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

/// Edit the main fields: PUT /api/hr/employees/:id (the server ignores unknown fields).
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
    ('mobileNumber', 'الجوال', 'Mobile'),
    ('email', 'البريد', 'Email'),
    ('iqamaNumber', 'رقم الإقامة', 'Iqama'),
  ];

  // Documents: a value, or a status explaining why there is none, like the web form. A new employee's empty documents are marked "required" on the server; one who needs no document picks "not required". Choice fields are lists of used values (/api/hr/master/choices); the bank allows "cash salary".
  static const _docs = [
    ('passportNumber', 'رقم الجواز', 'Passport no.', false),
    ('passportExpiry', 'انتهاء الجواز', 'Passport expiry', true),
    ('iqamaExpiry', 'انتهاء الإقامة', 'Iqama expiry', true),
    ('insuranceCompany', 'شركة التأمين', 'Insurer', false),
    ('insuranceExpiry', 'انتهاء التأمين', 'Insurance expiry', true),
    ('licenseType', 'نوع الرخصة', 'Licence type', false),
    ('licenseExpiry', 'انتهاء الرخصة', 'Licence expiry', true),
    ('driverCardNumber', 'رقم بطاقة السائق', 'Driver card no.', false),
    ('driverCardExpiry', 'انتهاء بطاقة السائق', 'Driver card expiry', true),
  ];
  static const _choiceKeys = {'insuranceCompany', 'licenseType', 'bank', 'socialInsuranceStatus'};
  static const _statusOpts = [
    ('', 'الحالة: تلقائي', 'Status: auto'), ('required', 'مطلوب', 'Required'),
    ('not_required', 'غير مطلوب', 'Not required'), ('none', 'لا يوجد', 'None'), ('inactive', 'غير نشط', 'Inactive'),
  ];
  late final Map<String, TextEditingController> _d;
  final Map<String, String> _marks = {};
  final Map<String, String> _pick = {};
  Map<String, List<String>> _choices = {};

  @override
  void initState() {
    super.initState();
    _c = {for (final f in _fields) f.$1: TextEditingController(text: (widget.employee?[f.$1] ?? '').toString())};
    _status = (widget.employee?['employmentStatus'] ?? 'active').toString();
    String asText(dynamic v) {
      final t = (v ?? '').toString();
      return RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(t) ? t.substring(0, 10) : t;
    }
    _d = {for (final f in _docs) f.$1: TextEditingController(text: asText(widget.employee?[f.$1]))};
    // Department comes only from the department list (added by the super admin); it cannot be typed.
    for (final k in ['department', 'staffCategory', 'registerNumber', 'nationality', 'branchName', 'project', 'bank', 'socialInsuranceStatus', 'insuranceCompany', 'licenseType']) {
      _pick[k] = (widget.employee?[k] ?? '').toString();
    }
    final fs = Map<String, dynamic>.from(widget.employee?['fieldStatus'] ?? {});
    for (final f in _docs) {
      final v = (fs['${f.$1}Status'] ?? '').toString();
      if (v.isNotEmpty && v != 'filled') _marks[f.$1] = v;
    }
    Api.instance.get('/api/hr/master/choices').then((d) {
      final raw = Map<String, dynamic>.from(d['choices'] ?? {});
      if (!mounted) return;
      setState(() => _choices = {
        for (final e in raw.entries) e.key: List<Map<String, dynamic>>.from(e.value).map((x) => '${x['value']}').toList(),
      });
    }).catchError((_) {});
  }

  Widget _choiceField(String k, String ar, String en) {
    final opts = [...(_choices[k] ?? const <String>[])]..removeWhere((x) => k == 'bank' && x.toLowerCase() == 'cash');
    final cur = _pick[k] ?? '';
    final items = <DropdownMenuItem<String>>[
      DropdownMenuItem(value: '', child: Text(tr('— اختر —', '— choose —'))),
      if (k == 'bank') DropdownMenuItem(value: 'cash', child: Text(tr('راتب نقدي', 'Cash payroll'))),
      ...opts.map((o) => DropdownMenuItem(value: o, child: Text(o, overflow: TextOverflow.ellipsis))),
      if (cur.isNotEmpty && cur.toLowerCase() != 'cash' && !opts.contains(cur)) DropdownMenuItem(value: cur, child: Text(cur)),
    ];
    return DropdownButtonFormField<String>(
      initialValue: k == 'bank' && cur.toLowerCase() == 'cash' ? 'cash' : cur,
      isExpanded: true,
      menuMaxHeight: 360,
      decoration: InputDecoration(labelText: tr(ar, en)),
      items: items,
      onChanged: (v) => setState(() => _pick[k] = v ?? ''),
    );
  }

  Widget _docField((String, String, String, bool) f) {
    final k = f.$1;
    final value = _choiceKeys.contains(k)
        ? _choiceField(k, f.$2, f.$3)
        : TextField(
            controller: _d[k],
            readOnly: f.$4,
            decoration: InputDecoration(
              labelText: tr(f.$2, f.$3),
              // The matching Hijri date shows under the chosen date; only the Gregorian value is sent.
              helperText: f.$4 && hijriHint(_d[k]!.text, ar: Lang.instance.ar).isNotEmpty ? hijriHint(_d[k]!.text, ar: Lang.instance.ar) : null,
              suffixIcon: f.$4 ? const Icon(Icons.calendar_today_outlined, size: 18) : null,
            ),
            onTap: f.$4 ? () async {
              final now = DateTime.now();
              final init = DateTime.tryParse(_d[k]!.text) ?? now;
              final picked = await showDatePicker(context: context, initialDate: init, firstDate: DateTime(1990), lastDate: DateTime(now.year + 20));
              if (picked != null) setState(() => _d[k]!.text = picked.toIso8601String().substring(0, 10));
            } : null,
          );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Expanded(flex: 3, child: value),
        const SizedBox(width: 8),
        Expanded(flex: 2, child: DropdownButtonFormField<String>(
          initialValue: _marks[k] ?? '',
          isExpanded: true,
          decoration: const InputDecoration(isDense: true),
          style: const TextStyle(fontSize: 12, color: T.inkSoft),
          items: _statusOpts.map((o) => DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3)))).toList(),
          onChanged: (v) => setState(() { if ((v ?? '').isEmpty) { _marks.remove(k); } else { _marks[k] = v!; } }),
        )),
      ]),
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final isNew = widget.employee == null;
      final body = <String, dynamic>{
        for (final f in _fields) f.$1: _c[f.$1]!.text.trim(),
        'employmentStatus': _status,
        for (final f in _docs) if (!_choiceKeys.contains(f.$1)) f.$1: _d[f.$1]!.text.trim(),
        for (final e in _pick.entries) e.key: e.value,
        // "Auto" on an existing file clears the flag; on a new one nothing is sent so the default applies.
        'markStatus': {
          for (final f in _docs)
            if (_marks[f.$1] != null) f.$1: _marks[f.$1]! else if (!isNew) f.$1: 'clear',
        },
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
            // Department, nationality, city and project are closed, searchable lists (utils/hrLists on the server). The commercial registration number is picked too: our registrations, freelancer and training; the engagement type derives from it.
            for (final k in const [('department', 'القسم', 'Department'), ('staffCategory', 'الفئة الوظيفية', 'Staff category'), ('registerNumber', 'رقم السجل التجاري', 'Commercial register'), ('nationality', 'الجنسية', 'Nationality'), ('branchName', 'المدينة', 'City'), ('project', 'المشروع', 'Project')])
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: PickField(label: tr(k.$2, k.$3), value: _pick[k.$1] ?? '', options: _choices[k.$1] ?? const [],
                    onChanged: (v) => setState(() => _pick[k.$1] = v)),
              ),
            const SizedBox(height: 6),
            Text(tr('المستندات والبنك', 'Documents & bank'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
            const SizedBox(height: 8),
            ..._docs.map(_docField),
            Padding(padding: const EdgeInsets.only(bottom: 10), child: _choiceField('bank', 'البنك', 'Bank')),
            Padding(padding: const EdgeInsets.only(bottom: 10), child: _choiceField('socialInsuranceStatus', 'التأمينات الاجتماعية', 'Social insurance')),
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

// Employee vehicles tab: current authorization, authorization history and accidents.
// /api/vehicles/by-employee/:id returns { current, authorizations, accidents }.
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
  void initState() {
    super.initState();
    _load();
    // Authorizations are written from vehicles, B2C vehicles and the vehicle page, so they arrive here immediately.
    for (final e in _liveEvents) { Live.instance.on(e, _onLive); }
  }

  static const _liveEvents = ['vehicle:authorization', 'vehicle:accident', 'vreg:updated', 'lt:updated', 'hr:employee'];
  void _onLive() => _load();

  @override
  void dispose() {
    for (final e in _liveEvents) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

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
    return x == null ? '—' : '${x.day}/${x.month}/${x.year}${hijriDay(v).isEmpty ? '' : ' · ${hijriDay(v)} ${tr('هـ', 'AH')}'}';
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)]);
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    // The current one comes from the authorization sheet in the vehicle register (the authority), as on the web.
    final currents = _d?['currents'] is List
        ? List<Map<String, dynamic>>.from(_d!['currents'])
        : (_d?['current'] is Map ? [Map<String, dynamic>.from(_d!['current'])] : <Map<String, dynamic>>[]);
    final auths = List<Map<String, dynamic>>.from(_d?['authorizations'] ?? []);
    final accidents = List<Map<String, dynamic>>.from(_d?['accidents'] ?? []);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        if (currents.isNotEmpty) AppCard(
          topAccent: T.success,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('التفويض الحالي', 'Current authorization'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            for (final current in currents) ...[
              const SizedBox(height: 6),
              Row(children: [
                const Icon(Icons.local_shipping_outlined, size: 18, color: T.navy),
                const SizedBox(width: 8),
                Text(_plate(current['vehicle']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                if ((current['documentNumber'] ?? '').toString().isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Flexible(child: Text(current['documentNumber'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft), overflow: TextOverflow.ellipsis)),
                ],
                const Spacer(),
                Chip2(tr('نشط', 'Active'), T.success),
              ]),
            ],
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
                  // "Valid" in the old log that the authorization sheet contradicts: not valid.
                  a['stale'] == true
                      ? Chip2(tr('غير سارٍ', 'Not current'), T.inkFaint)
                      : Chip2(a['status'] == 'active' ? tr('نشط', 'Active') : tr('منتهٍ', 'Ended'), a['status'] == 'active' ? T.success : T.inkFaint),
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

/// Contract state as displayed: the stored "valid" never changes with time, so a contract past its end and not renewed is shown as expired. Matches `contractBadge` on the web.
Widget _contractChip(Map c) {
  final status = (c['status'] ?? '').toString();
  final end = (c['endDate'] ?? '').toString();
  final today = DateTime.now().toUtc().add(const Duration(hours: 3)).toIso8601String().substring(0, 10);
  if (status == 'active' && end.length >= 10 && end.substring(0, 10).compareTo(today) < 0) {
    return Chip2(tr('منتهي', 'Expired'), T.danger);
  }
  // Only two states: valid or expired; the old "terminated" and "renewed" count as expired.
  if (status.isEmpty) return const Chip2('—', T.inkFaint);
  return status == 'active' ? Chip2(tr('ساري', 'Active'), T.success) : Chip2(tr('منتهي', 'Expired'), T.inkFaint);
}


/// Employee file categories; DOCUMENT_CATEGORIES on the web.
const hrDocCategories = [
  ('iqama', 'صورة الإقامة', 'Iqama'), ('passport', 'صورة الجواز', 'Passport'),
  ('license', 'رخصة القيادة', 'Driving License'), ('driverCard', 'كارت السائق', 'Driver Card'),
  ('contract', 'العقد', 'Contract'), ('insurance', 'التأمين', 'Insurance'),
  ('national_id', 'الهوية الوطنية', 'National ID'), ('photo', 'صورة شخصية', 'Photo'), ('other', 'أخرى', 'Other'),
];

const _auditActions = {
  'create_employee': ('إنشاء الملف', 'Created profile'),
  'update_employee': ('تعديل البيانات', 'Edited profile'),
  'delete_employee': ('حذف الملف', 'Deleted profile'),
  'renew_document': ('تجديد مستند', 'Renewed document'),
  'terminate_employee': ('إنهاء الخدمة', 'Ended service'),
  'reactivate_employee': ('إعادة تفعيل', 'Reactivated'),
  'add_employee_document': ('إضافة ملف', 'Added file'),
  'update_employee_document': ('تعديل ملف', 'Edited file'),
  'delete_employee_document': ('حذف ملف', 'Removed file'),
  'create_vehicle_claim': ('تسجيل الحادثة', 'Claim opened'),
  'update_vehicle_claim': ('تعديل المطالبة', 'Claim edited'),
  'delete_vehicle_claim': ('حذف المطالبة', 'Claim removed'),
  'add_claim_attachment': ('إرفاق ملفّ', 'Attachment added'),
  'delete_claim_attachment': ('حذف مرفق', 'Attachment removed'),
};
String _auditLabel(dynamic k) { final m = _auditActions['$k']; return m == null ? '${k ?? ''}' : tr(m.$1, m.$2); }
String _userName(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';
String _dd(dynamic v) { final g = gregDay(v); final h = hijriDay(v); return g.isEmpty ? '—' : (h.isEmpty ? g : '$g · $h ${tr('هـ', 'AH')}'); }

/// History tab: renewals and the change log from GET /api/hr/employees/:id/audit (HR team only, the server refuses others), with export.
class _HistoryTab extends StatefulWidget {
  final String employeeId;
  final List<Map<String, dynamic>> renewals;
  final bool staff;
  final String fileName;
  const _HistoryTab({required this.employeeId, required this.renewals, required this.staff, required this.fileName});
  @override
  State<_HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<_HistoryTab> with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>> _logs = [];
  bool _loading = true;
  late final void Function() _onLive;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:employee', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    if (!widget.staff) { if (mounted) setState(() => _loading = false); return; }
    try {
      final d = await Api.instance.get('/api/hr/employees/${widget.employeeId}/audit');
      if (mounted) setState(() { _logs = List<Map<String, dynamic>>.from((d as Map)['logs'] ?? []); _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _export() {
    exportExcel(context, fileName: widget.fileName, sheets: [
      (tr('التجديدات', 'Renewals'), [
        ExportCol('المستند', 'Document', (r) => r['docType'] ?? ''),
        ExportCol('الانتهاء السابق الميلادي', 'Previous expiry (Gregorian)', (r) => gregDay(r['previousExpiry'])),
        ExportCol('الانتهاء السابق الهجري', 'Previous expiry (Hijri)', (r) => hijriDay(r['previousExpiry'])),
        ExportCol('الانتهاء الجديد الميلادي', 'New expiry (Gregorian)', (r) => gregDay(r['newExpiry'])),
        ExportCol('الانتهاء الجديد الهجري', 'New expiry (Hijri)', (r) => hijriDay(r['newExpiry'])),
        ExportCol('الرقم الجديد', 'New number', (r) => r['documentNumber'] ?? ''),
        ExportCol('تاريخ التجديد', 'Renewed at', (r) => gregDay(r['renewedAt'] ?? r['createdAt'])),
        ExportCol('نفّذه', 'Renewed by', (r) => _userName(r['renewedBy'])),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ], widget.renewals),
      if (widget.staff)
        (tr('سجل التغييرات', 'Change log'), [
          ExportCol('الإجراء', 'Action', (r) => _auditLabel(r['action'])),
          ExportCol('التاريخ الميلادي', 'Changed (Gregorian)', (r) => '${r['createdAt'] ?? ''}'.replaceFirst('T', ' ').split('.').first),
          ExportCol('التاريخ الهجري', 'Changed (Hijri)', (r) => hijriDay(r['createdAt'])),
          ExportCol('المستخدم', 'User', (r) => _userName(r['user'])),
          ExportCol('الحقول المتغيّرة', 'Changed fields', (r) {
            final a = (r['changes'] is Map) ? (r['changes'] as Map)['after'] : null;
            return a is Map ? a.keys.join('، ') : '';
          }),
        ], _logs),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(child: Text(tr('سجل التجديدات', 'Renewals'), style: const TextStyle(fontWeight: FontWeight.w800))),
          IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        ]),
        if (widget.renewals.isEmpty)
          Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا توجد تجديدات', 'No renewals yet'), style: const TextStyle(color: T.inkFaint))),
        for (final rn in widget.renewals)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              child: Row(children: [
                const Icon(Icons.autorenew_rounded, color: T.info, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${rn['docType'] ?? ''}${'${rn['documentNumber'] ?? ''}'.isNotEmpty ? ' · ${rn['documentNumber']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  Text('${_dd(rn['previousExpiry'])} ← ${_dd(rn['newExpiry'])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  if ('${rn['notes'] ?? ''}'.isNotEmpty) Text('${rn['notes']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  Text([gregDay(rn['renewedAt'] ?? rn['createdAt']), _userName(rn['renewedBy'])].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                ])),
              ]),
            ),
          ),
        if (widget.staff) ...[
          const SizedBox(height: 10),
          Text(tr('سجل التغييرات', 'Change Log'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          if (_loading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          if (!_loading && _logs.isEmpty)
            Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا يوجد سجل بعد', 'No history yet'), style: const TextStyle(color: T.inkFaint))),
          for (final a in _logs)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: AppCard(
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Padding(padding: EdgeInsets.only(top: 4), child: Icon(Icons.circle, size: 10, color: T.orange)),
                  const SizedBox(width: 10),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(_auditLabel(a['action']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    Text([
                      '${a['createdAt'] ?? ''}'.replaceFirst('T', ' ').split('.').first,
                      if (hijriDay(a['createdAt']).isNotEmpty) '${hijriDay(a['createdAt'])} ${tr('هـ', 'AH')}',
                      _userName(a['user']),
                    ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    if (a['changes'] is Map && (a['changes'] as Map)['after'] is Map)
                      Text(((a['changes'] as Map)['after'] as Map).keys.take(8).join('، '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ])),
                ]),
              ),
            ),
        ],
      ]),
    );
  }
}
