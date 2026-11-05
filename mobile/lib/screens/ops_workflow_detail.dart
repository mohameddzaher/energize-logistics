import 'package:flutter/material.dart';
import '../ui/ops_customer_field.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/customs_link.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/report_follow_ups.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'jp.dart' show JpTaskPanel;
import 'ops_common.dart';

/// A single operations statement, counterpart of /system/operations/[id]: its grouped fields, editing with a row lock (lock/unlock), stage buttons, delete, export, the clearance transaction, follow-ups and JP tasks.
/// Which fields may be edited is stated by the server field by field (`/api/workflows/permissions`).

/// Fields by group, same as lib/workflowFields.ts.
/// Types: '' text, 'date', 'number', 'ptype' payment kind.
const opsWorkflowSections = [
  ('application', 'بيانات الطلب', 'Application Details', T.cyan, [
    ('reportNumber', 'رقم أمر النقل', 'Report Number', ''),
    ('reportDate', 'تاريخ أمر النقل', 'Report Date', 'date'),
    ('loadingTime', 'وقت التحميل', 'Loading Time', ''),
    ('fromLocation', 'عنوان الشحن', 'Shipping Address', ''),
    ('toLocation', 'عنوان الوصول', 'Arrival Address', ''),
    ('branch', 'الفرع', 'Branch', ''),
    ('carOwner', 'مالك السيارة', 'Car Owner', ''),
    ('carNumber', 'رقم السيارة', 'Car Number', ''),
    ('ownerType', 'نوع المالك', 'Owner Type', ''),
    ('executionStatus', 'حالة التنفيذ', 'Execution Status', ''),
    ('applicationStatus', 'الحالة', 'Status', ''),
    ('driverRentalType', 'نوع تأجير السائق', 'Driver Rental Type', ''),
    ('username', 'اسم العميل', 'Customer name', ''),
    ('paymentMethod', 'طريقة الدفع', 'Payment Method', ''),
    ('purchaseValue', 'سعر الشراء', 'Purchase Value', 'number'),
    ('sellingValue', 'سعر البيع', 'Selling Value', 'number'),
    ('reference', 'رقم المرجع', 'Reference', ''),
    ('userPhone', 'هاتف العميل', 'Customer phone', ''),
    ('driverName', 'اسم السائق', 'Driver Name', ''),
    ('driverPhone', 'هاتف السائق', 'Driver Phone', ''),
    ('carName', 'اسم السيارة', 'Car Name', ''),
    ('plateNumber', 'رقم اللوحة', 'Plate Number', ''),
    ('truckType', 'نوع الشاحنة', 'Truck Type', ''),
    ('truckSize', 'حجم الشاحنة', 'Truck Size', ''),
    ('loadType', 'نوع الحمولة', 'Load Type', ''),
    ('quantity', 'الكمية', 'Quantity', ''),
    ('goodsValue', 'قيمة البضائع', 'Goods Value', 'number'),
    ('representativeName', 'اسم المندوب', 'Representative', ''),
    ('country', 'اسم الدولة', 'Country', ''),
  ]),
  ('operations', 'مراجعه التشغيل', 'Operations Review', Color(0xFF0D9488), [
    ('operationsReview', 'مراجعه التشغيل', 'Operations Review', ''),
  ]),
  ('manual_moderator', 'بيانات المودريتور', 'Manual Moderator', T.orange, [
    ('paymentDate', 'تاريخ السداد', 'Payment Date', 'date'),
    ('payingBranch', 'الفرع المسدد', 'Paying Branch', ''),
    ('paymentType', 'نوع الدفع', 'Payment Type', 'ptype'),
    ('finalReportDestination', 'وجهه أمر النقل النهائي', 'Final Report Dest.', ''),
    ('documentNumber', 'رقم السند', 'Document Number', ''),
    ('sendingDate', 'تاريخ الارسال', 'Sending Date', 'date'),
    ('deliveryDate', 'تاريخ التسليم', 'Delivery Date', 'date'),
    ('accountingReview', 'مراجعه الحسابات', 'Accounting Review', ''),
  ]),
  ('collections', 'بيانات التحصيل', 'Collections', T.info, [
    ('invoiceNumber', 'رقم الفاتوره', 'Invoice Number', ''),
    ('netInvoice', 'صافي الفاتوره', 'Net Invoice', 'number'),
    ('tax', 'ضريبه', 'Tax', 'number'),
    ('totalInvoice', 'اجمالى الفاتوره', 'Total Invoice', 'number'),
    ('invoiceDate', 'تاريخ الفاتوره', 'Invoice Date', 'date'),
    ('invoiceNotes', 'ملاحظات الفاتوره', 'Invoice Notes', ''),
    ('collectionDate', 'تاريخ التحصيل', 'Collection Date', 'date'),
  ]),
];

const _stageLabels = {
  'draft': ('مسودة', 'Draft'),
  'submitted_to_ops': ('مرسل للتشغيل', 'Submitted to Ops'),
  'ops_completed': ('التشغيل مكتمل', 'Ops Completed'),
  'submitted_to_collections': ('للتحصيلات', 'To Collections'),
  'completed': ('مكتمل', 'Completed'),
};

class OpsWorkflowDetailScreen extends StatefulWidget {
  final String id;
  final Map<String, dynamic>? initial;
  /// Opens straight into edit mode, counterpart of `?edit=1` on the web.
  final bool startInEdit;
  const OpsWorkflowDetailScreen({super.key, required this.id, this.initial, this.startInEdit = false});
  @override
  State<OpsWorkflowDetailScreen> createState() => _OpsWorkflowDetailScreenState();
}

class _OpsWorkflowDetailScreenState extends State<OpsWorkflowDetailScreen> {
  Map<String, dynamic>? _w;
  bool _loading = true;
  String? _error;
  bool _editing = false;
  bool _saving = false;
  bool _transitioning = false;
  /// `null` means the list has not arrived yet (or system admin: everything).
  Set<String>? _myFields;
  // Invoice amounts (net invoice onward) are shown only when the server says so.
  bool _seesAmounts = false;
  static const _amountKeys = {'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate'};
  bool _canLinkCustoms = false;
  final Map<String, TextEditingController> _ctrl = {};
  String _ptype = '';

  late final void Function(dynamic) _onUpdated;
  late final void Function(dynamic) _onLocked;
  late final void Function(dynamic) _onUnlocked;
  late final void Function(dynamic) _onBulk;

  String get _role => context.read<AuthProvider>().role;
  String get _myId => (context.read<AuthProvider>().user?['_id'] ?? '').toString();

  @override
  void initState() {
    super.initState();
    _w = widget.initial;
    if (_w != null) _fillForm(_w!);
    _load();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadPerms());
    _onUpdated = (d) {
      if (d is! Map || '${d['_id']}' != widget.id || !mounted) return;
      // The whole row is replaced; the short notification triggers a refetch.
      if (d.containsKey('reportNumber')) {
        setState(() {
          _w = Map<String, dynamic>.from(d);
          if (!_editing) _fillForm(_w!);
        });
      } else {
        _load();
      }
    };
    _onLocked = (d) {
      if (d is! Map || '${d['_id']}' != widget.id || !mounted || _w == null) return;
      setState(() => _w = {..._w!, 'lockedBy': d['lockedBy'], 'lockedByName': d['lockedByName'], 'lockedAt': d['lockedAt']});
    };
    _onUnlocked = (d) {
      if (d is! Map || '${d['_id']}' != widget.id || !mounted || _w == null) return;
      setState(() => _w = {..._w!, 'lockedBy': null, 'lockedByName': '', 'lockedAt': null});
    };
    // The clearance link also changes from the transaction page.
    _onBulk = (d) {
      if (_editing || _w == null || d is! Map || d['customsLink'] == null) return;
      final nums = (d['reportNumbers'] is List) ? (d['reportNumbers'] as List).map((e) => '$e').toList() : const <String>[];
      if (nums.contains('${_w!['reportNumber']}')) _load();
    };
    Live.instance.onData('workflow:updated', _onUpdated);
    Live.instance.onData('workflow:stageChanged', _onUpdated);
    Live.instance.onData('workflow:locked', _onLocked);
    Live.instance.onData('workflow:unlocked', _onUnlocked);
    Live.instance.onData('workflow:bulkImported', _onBulk);
  }

  @override
  void dispose() {
    Live.instance.offData('workflow:updated', _onUpdated);
    Live.instance.offData('workflow:stageChanged', _onUpdated);
    Live.instance.offData('workflow:locked', _onLocked);
    Live.instance.offData('workflow:unlocked', _onUnlocked);
    Live.instance.offData('workflow:bulkImported', _onBulk);
    // Leaving during edit must not leave the row locked for colleagues.
    if (_editing) Api.instance.post('/api/workflows/${widget.id}/unlock').catchError((_) => null);
    for (final c in _ctrl.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _loadPerms() async {
    if (const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(_role)) {
      setState(() { _myFields = null; _canLinkCustoms = true; _seesAmounts = true; });
      return;
    }
    try {
      final d = await Api.instance.get('/api/workflows/permissions');
      if (!mounted) return;
      final list = (d is Map ? (d['myFields'] ?? (d['roleAccess'] is Map ? d['roleAccess'][_role] : null)) : null) as List?;
      setState(() {
        _myFields = Set<String>.from((list ?? const []).map((e) => '$e'));
        _canLinkCustoms = d is Map && d['canLinkCustoms'] == true;
        _seesAmounts = d is Map && d['view'] is Map && d['view']['amounts'] == true;
      });
    } catch (_) {
      if (mounted) setState(() => _myFields = <String>{});
    }
  }

  bool _canEditField(String k) => const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(_role) || _myFields == null || _myFields!.contains(k);
  bool _canEditGroup(List<(String, String, String, String)> fields) => fields.any((f) => _canEditField(f.$1));

  void _fillForm(Map<String, dynamic> w) {
    for (final s in opsWorkflowSections) {
      for (final f in s.$5) {
        var v = (w[f.$1] ?? '').toString();
        if (f.$4 == 'date' && v.isNotEmpty) v = v.split('T').first;
        (_ctrl[f.$1] ??= TextEditingController()).text = v;
      }
    }
    _ptype = opsPaymentKindOf(w);
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/workflows/${widget.id}');
      if (!mounted) return;
      setState(() {
        _w = Map<String, dynamic>.from(d);
        if (!_editing) _fillForm(_w!);
        _loading = false;
        _error = null;
      });
      if (widget.startInEdit && !_editing && !_startedEdit) { _startedEdit = true; _startEdit(); }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = opsErr(e); });
    }
  }
  bool _startedEdit = false;

  bool get _lockedByOther {
    final w = _w;
    if (w == null || w['lockedBy'] == null) return false;
    final lb = w['lockedBy'];
    final lid = lb is Map ? '${lb['_id']}' : '$lb';
    if (lid == _myId) return false;
    final at = DateTime.tryParse('${w['lockedAt'] ?? ''}');
    return at == null || DateTime.now().difference(at).inMinutes < 5;
  }

  Future<void> _startEdit() async {
    try {
      await Api.instance.post('/api/workflows/${widget.id}/lock');
      if (!mounted) return;
      setState(() => _editing = true);
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e).isEmpty ? tr('تعذّر قفل الصفّ', 'Failed to lock') : opsErr(e), error: true);
    }
  }

  Future<void> _cancelEdit() async {
    try { await Api.instance.post('/api/workflows/${widget.id}/unlock'); } catch (_) {}
    if (!mounted) return;
    setState(() { _editing = false; if (_w != null) _fillForm(_w!); });
  }

  Future<void> _save() async {
    if (_w == null) return;
    setState(() => _saving = true);
    final payload = <String, dynamic>{};
    for (final s in opsWorkflowSections) {
      for (final f in s.$5) {
        if (f.$4 == 'ptype') continue;
        final t = _ctrl[f.$1]?.text ?? '';
        payload[f.$1] = f.$4 == 'number' ? (num.tryParse(t.trim()) ?? 0) : t;
      }
    }
    // Payment kind is sent only if it changed: sending it unchanged stamps it as a manual choice.
    if (_ptype != opsPaymentKindOf(_w!)) payload['paymentType'] = _ptype;
    try {
      final out = await Api.instance.put('/api/workflows/${widget.id}', payload);
      try { await Api.instance.post('/api/workflows/${widget.id}/unlock'); } catch (_) {}
      if (!mounted) return;
      setState(() => _editing = false);
      // A selling-price edit held for approval is said so; the old price stays.
      opsSnack(context, out is Map && out['sellingRequestMessage'] != null ? '${out['sellingRequestMessage']}' : tr('تم حفظ التعديلات', 'Changes saved'));
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Stage transitions as on the web statement page ("send to operations" was removed).
  List<(String, String, String)> get _transitions {
    final stage = (_w?['stage'] ?? 'draft').toString();
    const opsRoles = ['operations_manager', 'super_admin', 'admin', 'it_manager', 'it_specialist'];
    const colRoles = ['admin', 'employee', 'super_admin'];
    final map = <String, List<(String, String, String, List<String>)>>{
      'submitted_to_ops': [
        ('ops_completed', 'إتمام التشغيل', 'Mark Ops Complete', opsRoles),
        ('draft', 'إرجاع للمسودة', 'Return to Draft', opsRoles),
      ],
      'ops_completed': [
        ('submitted_to_collections', 'إرسال للتحصيلات', 'Submit to Collections', opsRoles),
        ('submitted_to_ops', 'إرجاع للتشغيل', 'Return to Ops', opsRoles),
      ],
      'submitted_to_collections': [
        ('completed', 'إتمام', 'Mark Complete', colRoles),
        ('ops_completed', 'إرجاع للتشغيل', 'Return to Ops', colRoles),
      ],
    };
    return [for (final t in map[stage] ?? const <(String, String, String, List<String>)>[]) if (t.$4.contains(_role)) (t.$1, t.$2, t.$3)];
  }

  Future<void> _transition(String stage) async {
    setState(() => _transitioning = true);
    try {
      await Api.instance.put('/api/workflows/${widget.id}/stage', {'stage': stage});
      if (!mounted) return;
      opsSnack(context, tr('تم تحديث المرحلة', 'Stage updated'));
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _transitioning = false);
    }
  }

  Future<void> _delete() async {
    final ok = await opsConfirm(context,
        tr('حذف أمر النقل ${_w?['reportNumber'] ?? ''} نهائيًّا؟ يختفي من تقارير التشغيل والتحصيل.',
            'Permanently delete report ${_w?['reportNumber'] ?? ''}? It leaves the operations and collections reports.'),
        danger: true);
    if (!ok) return;
    try {
      await Api.instance.delete('/api/workflows/${widget.id}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    }
  }

  void _export() {
    final w = _w;
    if (w == null) return;
    final cols = <ExportCol>[
      for (final s in opsWorkflowSections)
        for (final f in s.$5)
          ExportCol(f.$2, f.$3, (r) {
            final v = r[f.$1];
            switch (f.$4) {
              case 'date': return v == null || '$v'.isEmpty ? '' : opsDate(v);
              case 'number': return v is num ? v : num.tryParse('${v ?? ''}');
              case 'ptype': return opsPaymentKindLabel(opsPaymentKindOf(r));
              default: return v?.toString() ?? '';
            }
          }),
    ];
    exportExcel(context, fileName: 'operation-${w['reportNumber'] ?? w['_id']}', sheets: [(tr('تفاصيل أمر النقل', 'Workflow details'), cols, [w])]);
  }

  String _personName(dynamic p) {
    if (p is Map) return '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim();
    return '';
  }

  Widget _fieldView((String, String, String, String) f) {
    final w = _w!;
    final editable = _editing && _canEditField(f.$1);
    final label = tr(f.$2, f.$3);
    if (editable && f.$4 == 'ptype') {
      return DropdownButtonFormField<String>(
        initialValue: _ptype.isEmpty ? null : _ptype,
        isExpanded: true,
        decoration: InputDecoration(labelText: label, isDense: true),
        items: [
          // An existing tax/cash value is shown but not selectable.
          if (_ptype == 'cash' || _ptype == 'tax')
            DropdownMenuItem(value: _ptype, enabled: false, child: Text(opsPaymentKindLabel(_ptype), style: const TextStyle(color: T.inkFaint))),
          for (final c in opsPaymentChoices) DropdownMenuItem(value: c.$1, child: Text(tr(c.$2, c.$3))),
        ],
        onChanged: (v) => setState(() => _ptype = v ?? ''),
      );
    }
    if (editable) {
      final ctrl = _ctrl[f.$1]!;
      if (f.$1 == 'username') return OpsCustomerField(controller: ctrl, label: label);
      if (f.$1 == 'branch' || f.$1 == 'payingBranch') return LookupField(type: 'workflow_paying_branch', controller: ctrl, label: label, noAdd: true);
      if (f.$4 == 'date') {
        return TextField(
          controller: ctrl,
          readOnly: true,
          decoration: InputDecoration(labelText: label, isDense: true, suffixIcon: const Icon(Icons.calendar_month_outlined, size: 18)),
          onTap: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(ctrl.text) ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2040));
            if (d != null) setState(() => ctrl.text = opsYmd(d));
          },
        );
      }
      return TextField(
        controller: ctrl,
        keyboardType: f.$4 == 'number' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
        decoration: InputDecoration(labelText: label, isDense: true),
      );
    }
    final v = w[f.$1];
    final text = switch (f.$4) {
      'ptype' => opsPaymentKindLabel(opsPaymentKindOf(w)),
      'date' => v == null || '$v'.isEmpty ? '' : opsDate(v),
      'number' => v == null || v == 0 ? '' : opsMoney(v),
      _ => f.$1 == 'applicationStatus' || f.$1 == 'executionStatus' ? opsStatusLabel(v) : (v ?? '').toString(),
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
      const SizedBox(height: 2),
      Text(text.isEmpty ? '-' : text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: text.isEmpty ? T.inkFaint : T.ink)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final w = _w;
    final role = context.watch<AuthProvider>().role;
    return PopScope(
      canPop: !_editing,
      onPopInvokedWithResult: (didPop, _) { if (!didPop && _editing) _cancelEdit(); },
      child: AppScaffold(
        title: Text(w == null ? tr('أمر النقل', 'Report') : '${w['reportNumber'] ?? ''}'),
        actions: [
          if (w != null && !_editing) IconButton(tooltip: tr('تصدير Excel', 'Export'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
          if (w != null && !_editing && !_lockedByOther)
            IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined), onPressed: _startEdit),
          if (w != null && !_editing && !_lockedByOther && const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'].contains(role))
            IconButton(tooltip: tr('حذف أمر النقل', 'Delete report'), icon: const Icon(Icons.delete_outline), onPressed: _delete),
        ],
        body: w == null
            ? (_loading
                ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 200)])
                : ErrorRetry(message: _error ?? tr('أمر النقل غير موجود', 'Report not found'), onRetry: () { setState(() => _loading = true); _load(); }))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
                  // Header: stage, owner and lock
                  Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Chip2(tr(_stageLabels[w['stage']]?.$1 ?? 'مسودة', _stageLabels[w['stage']]?.$2 ?? 'Draft'), T.inkSoft),
                    if ((w['applicationStatus'] ?? '').toString().isNotEmpty)
                      Chip2(opsStatusLabel(w['applicationStatus']), opsAppStatuses[w['applicationStatus']]?.$3 ?? T.inkFaint),
                    if ((w['carOwner'] ?? '').toString().isNotEmpty) Text('${w['carOwner']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    if (_lockedByOther)
                      Chip2(tr('يحرّره ${w['lockedByName'] ?? ''}', 'Being edited by ${w['lockedByName'] ?? ''}'), T.danger, icon: Icons.lock_outline),
                  ]),
                  const SizedBox(height: 10),
                  // Stage buttons
                  if (_transitions.isNotEmpty && !_editing) ...[
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final t in _transitions)
                        OutlinedButton.icon(
                          onPressed: _transitioning ? null : () => _transition(t.$1),
                          icon: _transitioning
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.arrow_forward, size: 16),
                          label: Text(tr(t.$2, t.$3)),
                        ),
                    ]),
                    const SizedBox(height: 10),
                  ],
                  if (_editing)
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.orange.withValues(alpha: 0.4))),
                      child: Text(tr('وضع التعديل — الصفّ مقفلٌ باسمك حتى تحفظ أو تلغي.', 'Editing — the row is locked to you until you save or cancel.'),
                          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ),
                  // Clearance transaction and follow-ups
                  if (!_editing) ...[
                    WorkflowCustomsSection(
                      workflow: w,
                      canLink: _canLinkCustoms,
                      onChanged: (wf) {
                        if (!mounted) return;
                        setState(() => _w = wf);
                        opsSnack(context, tr('حُفظ الربط', 'Link saved'));
                      },
                    ),
                    Text(tr('متابعات أمر النقل', 'Report follow-ups'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                    const SizedBox(height: 6),
                    ReportFollowUpsView(workflowId: widget.id, basePath: '/api/workflows/${widget.id}/follow-ups'),
                    const SizedBox(height: 10),
                  ],
                  // Groups
                  for (final s in opsWorkflowSections)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AppCard(
                        topAccent: s.$4,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: Text(tr(s.$2, s.$3), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: s.$4))),
                            if (_editing && !_canEditGroup(s.$5))
                              Row(children: [const Icon(Icons.lock_outline, size: 13, color: T.inkFaint), const SizedBox(width: 3), Text(tr('للقراءة فقط', 'Read only'), style: const TextStyle(fontSize: 11, color: T.inkFaint))]),
                          ]),
                          const SizedBox(height: 8),
                          for (final f in s.$5)
                            // Selling value only for those on its list; the server does not send it to anyone else.
                            if ((f.$1 != 'sellingValue' || const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(role) || (_myFields?.contains('sellingValue') ?? false))
                                && (_seesAmounts || !_amountKeys.contains(f.$1)))
                              Padding(padding: const EdgeInsets.only(bottom: 10), child: _fieldView(f)),
                        ]),
                      ),
                    ),
                  if (!_editing) JpTaskPanel(section: 'operations', kind: 'workflow', refId: widget.id),
                  const SizedBox(height: 10),
                  // Record information
                  AppCard(
                    child: Wrap(spacing: 18, runSpacing: 10, children: [
                      _meta(tr('أنشأه', 'Created by'), _personName(w['createdBy']).isNotEmpty
                          ? _personName(w['createdBy'])
                          : ((w['externalSource'] ?? '').toString().isNotEmpty ? tr('النظام', 'System') : '-')),
                      _meta(tr('تاريخ الإنشاء', 'Created at'), opsDate(w['createdAt'])),
                      _meta(tr('آخر تعديل بواسطة', 'Last modified by'), _personName(w['lastModifiedBy']).isEmpty ? '-' : _personName(w['lastModifiedBy'])),
                      _meta(tr('آخر تحديث', 'Updated at'), opsDate(w['updatedAt'])),
                    ]),
                  ),
                ]),
              ),
        floatingActionButton: _editing
            ? Row(mainAxisSize: MainAxisSize.min, children: [
                FloatingActionButton.extended(
                  heroTag: 'wf-cancel',
                  backgroundColor: Colors.white,
                  foregroundColor: T.ink,
                  onPressed: _saving ? null : _cancelEdit,
                  icon: const Icon(Icons.close),
                  label: Text(tr('إلغاء', 'Cancel')),
                ),
                const SizedBox(width: 10),
                FloatingActionButton.extended(
                  heroTag: 'wf-save',
                  backgroundColor: T.orange,
                  foregroundColor: Colors.white,
                  onPressed: _saving ? null : _save,
                  icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined),
                  label: Text(tr('حفظ', 'Save')),
                ),
              ])
            : null,
      ),
    );
  }

  Widget _meta(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        Text(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
      ]);
}
