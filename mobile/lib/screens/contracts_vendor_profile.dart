import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'jp.dart' show JpTaskPanel;

/// Analytical profile of a 3PL vendor: vendor data, contract state and capacity, and the monthly operations table (order count and capacity utilization).
class ContractsVendorProfileScreen extends StatefulWidget {
  final String vendorId;
  final String name;
  const ContractsVendorProfileScreen({super.key, required this.vendorId, required this.name});
  @override
  State<ContractsVendorProfileScreen> createState() => _ContractsVendorProfileScreenState();
}

// canEditContracts on the web: the role or an edit permission on the section.
const _contractsEditRoles = ['super_admin', 'admin', 'contracts_manager', 'contracts_staff', 'it_manager', 'it_specialist', 'sales_manager', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'];

// Fields edited in place, the same ones saved by PATCH /api/contracts/vendors/:id.
const _editFields = <(String, String, String, bool)>[
  ('name', 'اسم المورد', 'Vendor name', false),
  ('crNumber', 'السجل التجاري', 'CR number', false),
  ('vendorType', 'نوع المورد', 'Type', false),
  ('energizeRep', 'مندوب التنشيط', 'Energize rep', false),
  ('operationsRep', 'مندوب التشغيل', 'Operations rep', false),
  ('contactPerson', 'ممثل المورد', 'Contact person', false),
  ('phone', 'الجوال', 'Phone', false),
  ('headquarters', 'المقر الرئيسي', 'Headquarters', false),
  ('destinations', 'الوجهات', 'Destinations', false),
  ('vehicleTypes', 'أنواع السيارات', 'Vehicle types', false),
  ('fleetSize', 'عدد السيارات', 'Fleet size', true),
  ('monthlyCapacity', 'الطاقة الشهرية المتوقعة', 'Monthly capacity', true),
  ('paymentTermDays', 'مدة السداد (يوم)', 'Payment term (days)', true),
  ('renewalPolicy', 'سياسة التجديد', 'Renewal policy', false),
  ('pricingNotes', 'التسعير', 'Pricing', false),
  ('operationalStatus', 'الحالة التشغيلية', 'Operational status', false),
  ('missingDocuments', 'المستندات الناقصة', 'Missing documents', false),
  ('followUpNotes', 'ملاحظات المتابعة', 'Follow-up notes', false),
  ('notes', 'ملاحظات', 'Notes', false),
];

const _monthsAr = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class _ContractsVendorProfileScreenState extends State<ContractsVendorProfileScreen> {
  Map<String, dynamic>? _vendor;
  List<Map<String, dynamic>> _util = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/contracts/vendors/${widget.vendorId}');
      if (!mounted) return;
      setState(() {
        _vendor = d['vendor'] is Map ? Map<String, dynamic>.from(d['vendor']) : {};
        _util = List<Map<String, dynamic>>.from((d['utilisation'] ?? []) as List);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  Future<void> _uploadAttachment() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('رفع مرفق', 'Upload attachment')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(picked.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 8),
          TextField(controller: title, autofocus: true, decoration: InputDecoration(labelText: tr('العنوان', 'Title'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('رفع', 'Upload'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/contracts/vendors/${widget.vendorId}/attachments', {
        'dataUrl': picked.dataUrl, 'fileName': picked.fileName, 'title': title.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  bool get _canEdit {
    final a = context.read<AuthProvider>();
    return _contractsEditRoles.contains(a.role) || a.canEditSection('Contracts');
  }

  void _snack(Object e) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
  }

  /// Vendor rating (stars and notes), the web rate-vendor dialog.
  Future<void> _rate() async {
    final v = _vendor ?? {};
    var rating = (_n(v['rating'])).toInt();
    final notes = TextEditingController(text: (v['ratingNotes'] ?? '').toString());
    final can = _canEdit;
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Text(tr('تقييم المورد', 'Rate vendor')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (final n in [1, 2, 3, 4, 5])
            IconButton(
              onPressed: can ? () => set(() => rating = n == rating ? 0 : n) : null,
              icon: Icon(n <= rating ? Icons.star_rounded : Icons.star_outline_rounded, color: n <= rating ? const Color(0xFFF59E0B) : T.inkFaint, size: 30),
            ),
        ]),
        TextField(controller: notes, enabled: can, maxLines: 3, decoration: InputDecoration(labelText: tr('ملاحظات التقييم', 'Rating notes'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        if (can) FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ التقييم', 'Save'))),
      ],
    )));
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/contracts/vendors/${widget.vendorId}', {'rating': rating == 0 ? null : rating, 'ratingNotes': notes.text.trim()});
      _load();
    } catch (e) { _snack(e); }
  }

  /// Edit vendor data in place (PATCH), without going back to the register.
  Future<void> _edit() async {
    final v = _vendor ?? {};
    final ctrls = {for (final f in _editFields) f.$1: TextEditingController(text: v[f.$1] == null ? '' : v[f.$1].toString())};
    var docs = v['documentsReceived'] == true, vendorSide = v['vendorSideContract'] == true, ourSide = v['ourSideContract'] == true;
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.85,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Text(tr('تعديل بيانات المورد', 'Edit vendor'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            for (final f in _editFields)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: TextField(
                  controller: ctrls[f.$1],
                  keyboardType: f.$4 ? TextInputType.number : TextInputType.text,
                  maxLines: f.$1.endsWith('Notes') || f.$1 == 'notes' ? 3 : 1,
                  decoration: InputDecoration(labelText: tr(f.$2, f.$3)),
                ),
              ),
            CheckboxListTile(contentPadding: EdgeInsets.zero, value: vendorSide, onChanged: (x) => set(() => vendorSide = x == true), title: Text(tr('وقّع المورد', 'Vendor signed'))),
            CheckboxListTile(contentPadding: EdgeInsets.zero, value: ourSide, onChanged: (x) => set(() => ourSide = x == true), title: Text(tr('وقّعنا نحن', 'We signed'))),
            CheckboxListTile(contentPadding: EdgeInsets.zero, value: docs, onChanged: (x) => set(() => docs = x == true), title: Text(tr('المستندات مكتملة', 'Documents complete'))),
            const SizedBox(height: 8),
            FilledButton.icon(onPressed: () => Navigator.pop(c, true), icon: const Icon(Icons.save_outlined), label: Text(tr('حفظ', 'Save'))),
          ]),
        ),
      )),
    );
    if (ok != true) return;
    final body = <String, dynamic>{
      for (final f in _editFields)
        f.$1: f.$4 ? (ctrls[f.$1]!.text.trim().isEmpty ? null : num.tryParse(ctrls[f.$1]!.text.trim())) : ctrls[f.$1]!.text.trim(),
      'vendorSideContract': vendorSide, 'ourSideContract': ourSide, 'documentsReceived': docs,
    };
    if ((body['name'] as String).isEmpty) { _snack(tr('اسم المورد مطلوب', 'Vendor name is required')); return; }
    try {
      await Api.instance.patch('/api/contracts/vendors/${widget.vendorId}', body);
      _load();
    } catch (e) { _snack(e); }
  }

  /// Export the whole vendor file, one sheet per table, as on the web.
  void _export() {
    final v = _vendor ?? {};
    final orders = _util.fold<num>(0, (a, r) => a + _n(r['orders']));
    final cap = _util.fold<num>(0, (a, r) => a + _n(r['expectedMonthlyCapacity']));
    final info = <Map<String, dynamic>>[
      {'l': tr('المورد', 'Vendor'), 'v': v['name']},
      {'l': tr('حالة العقد', 'Contract status'), 'v': v['status']},
      for (final f in _editFields) {'l': tr(f.$2, f.$3), 'v': v[f.$1]},
      {'l': tr('إجمالي الطلبات المسجلة', 'Total recorded orders'), 'v': orders},
      {'l': tr('متوسط الاستغلال', 'Avg utilisation'), 'v': cap > 0 ? '${(orders / cap * 100).toStringAsFixed(0)}%' : '—'},
      {'l': tr('أشهر مسجلة', 'Months on record'), 'v': _util.length},
      {'l': tr('مستندات مستلمة', 'Documents received'), 'v': v['documentsReceived'] == true},
      {'l': tr('التقييم', 'Rating'), 'v': v['rating'] != null ? '${v['rating']}/5' : '—'},
      {'l': tr('ملاحظات التقييم', 'Rating notes'), 'v': v['ratingNotes']},
    ];
    final atts = List<Map<String, dynamic>>.from((v['attachments'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
    exportExcel(context, fileName: 'vendor-${v['crNumber'] ?? widget.vendorId}', sheets: [
      (tr('بيانات المورد', 'Vendor'), [ExportCol('البند', 'Item', (r) => r['l']), ExportCol('القيمة', 'Value', (r) => r['v'])], info),
      if (atts.isNotEmpty)
        (tr('المرفقات', 'Attachments'), [
          ExportCol('الوصف', 'Title', (r) => (r['title'] ?? r['fileName'] ?? '').toString()),
          ExportCol('اسم الملف', 'File', (r) => r['fileName']),
          ExportCol('الحجم (ك.ب)', 'Size (KB)', (r) => (_n(r['size']) / 1024).round()),
          ExportCol('تاريخ الرفع', 'Uploaded', (r) => (r['uploadedAt'] ?? '').toString().split('T').first),
          ExportCol('رفعه', 'Uploaded by', (r) => r['uploadedByName']),
        ], atts),
      if (_util.isNotEmpty)
        (tr('التاريخ التشغيلي', 'Monthly history'), [
          ExportCol('الشهر', 'Month', (r) => '${r['year']}-${r['month'].toString().padLeft(2, '0')}'),
          ExportCol('الطلبات', 'Orders', (r) => _n(r['orders'])),
          ExportCol('الطاقة المتوقعة', 'Capacity', (r) => _n(r['expectedMonthlyCapacity'])),
          ExportCol('الاستغلال', 'Utilisation', (r) => _n(r['expectedMonthlyCapacity']) > 0 ? '${(_n(r['orders']) / _n(r['expectedMonthlyCapacity']) * 100).toStringAsFixed(0)}%' : '—'),
          ExportCol('مندوب التشغيل', 'Ops rep', (r) => r['operationsRep']),
        ], _util),
    ]);
  }

  Future<void> _deleteAttachment(Map<String, dynamic> att) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف هذا المرفق نهائيًا؟', 'Delete this attachment?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/contracts/vendors/${widget.vendorId}/attachments/${att['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final v = _vendor ?? {};
    final status = (v['status'] ?? '').toString();
    final statusMeta = {
      'signed': ('موقّع الطرفين', 'Signed', T.success),
      'pending': ('عقد ناقص', 'Pending', T.warn),
      'unsigned': ('بلا عقد', 'Unsigned', T.danger),
    }[status] ?? ('—', '—', T.inkFaint);
    final capacity = _n(v['monthlyCapacity']);
    final maxOrders = _util.fold<num>(1, (m, r) => _n(r['orders']) > m ? _n(r['orders']) : m);

    final attachments = List<Map<String, dynamic>>.from(v['attachments'] ?? []);
    return AppScaffold(
      title: Text(widget.name),
      actions: [
        if (!_loading && _vendor != null) ...[
          IconButton(icon: const Icon(Icons.file_download_outlined), tooltip: tr('تصدير Excel', 'Export to Excel'), onPressed: _export),
          IconButton(icon: const Icon(Icons.star_outline_rounded), tooltip: tr('تقييم المورد', 'Rate'), onPressed: _rate),
          if (_canEdit) IconButton(icon: const Icon(Icons.edit_outlined), tooltip: tr('تعديل', 'Edit'), onPressed: _edit),
          if (_canEdit) IconButton(icon: const Icon(Icons.upload_file_outlined), tooltip: tr('رفع مرفق', 'Upload attachment'), onPressed: _uploadAttachment),
        ],
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(height: 220)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: statusMeta.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((v['name'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                            Chip2(tr(statusMeta.$1, statusMeta.$2), statusMeta.$3),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if (v['fleetSize'] != null) Chip2('${tr('الأسطول', 'Fleet')}: ${v['fleetSize']}', T.navy, icon: Icons.local_shipping_outlined),
                            if (capacity > 0) Chip2('${tr('السعة الشهرية', 'Capacity')}: ${capacity.round()}', T.violet),
                            if (v['paymentType'] != null && v['paymentType'].toString().isNotEmpty) Chip2(v['paymentType'].toString(), T.info),
                            if (v['rating'] != null) Chip2('★ ${v['rating']}', T.orange),
                            Chip2(v['vendorSideContract'] == true ? tr('عقد المورد ✓', 'Vendor side ✓') : tr('عقد المورد ✗', 'Vendor side ✗'), v['vendorSideContract'] == true ? T.success : T.danger),
                            Chip2(v['ourSideContract'] == true ? tr('عقدنا ✓', 'Our side ✓') : tr('عقدنا ✗', 'Our side ✗'), v['ourSideContract'] == true ? T.success : T.danger),
                          ]),
                          ...[
                            (Icons.badge_outlined, v['crNumber'] == null ? null : '${tr('السجل التجاري', 'CR')}: ${v['crNumber']}'),
                            (Icons.support_agent_outlined, v['energizeRep'] == null ? null : '${tr('مندوب التنشيط', 'Energize rep')}: ${v['energizeRep']}'),
                            (Icons.engineering_outlined, v['operationsRep'] == null ? null : '${tr('مندوب التشغيل', 'Operations rep')}: ${v['operationsRep']}'),
                            (Icons.location_city_outlined, v['headquarters']),
                            (Icons.alt_route, v['destinations'] == null ? null : '${tr('الوجهات', 'Destinations')}: ${v['destinations']}'),
                            (Icons.local_shipping_outlined, v['vehicleTypes']),
                            (Icons.payments_outlined, v['paymentTermDays'] == null ? null : '${tr('مدة السداد', 'Payment term')}: ${v['paymentTermDays']}'),
                            (Icons.sell_outlined, v['pricingNotes']),
                            (Icons.star_half_rounded, v['ratingNotes']),
                            (Icons.person_outline, v['contactPerson']),
                            (Icons.phone_outlined, v['phone']),
                            (Icons.email_outlined, v['email']),
                            (Icons.notes_outlined, v['notes']),
                          ].where((x) => (x.$2 ?? '').toString().isNotEmpty).map((x) => Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Icon(x.$1, size: 15, color: T.inkFaint),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(x.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                                ]),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    FadeSlideIn(
                      delayMs: 50,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('التشغيل الشهري', 'Monthly utilisation'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 10),
                          if (_util.isEmpty)
                            Text(tr('لا يوجد تشغيل مسجل لهذا المورد', 'No utilisation recorded'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ..._util.reversed.take(18).map((r) {
                            final orders = _n(r['orders']);
                            final pct = capacity > 0 ? (orders / capacity * 100) : null;
                            final month = _n(r['month']).toInt();
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 7),
                              child: Row(children: [
                                SizedBox(
                                  width: 86,
                                  child: Text('${tr(_monthsAr[month.clamp(0, 12)], _monthsEn[month.clamp(0, 12)])} ${r['year'] ?? ''}',
                                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                ),
                                Expanded(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: (orders / maxOrders).clamp(0.02, 1).toDouble(),
                                      minHeight: 12,
                                      backgroundColor: T.navy.withValues(alpha: 0.06),
                                      color: pct != null && pct > 100 ? T.danger : T.navy,
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  width: 92,
                                  child: Text(' ${orders.round()}${pct != null ? ' · ${pct.toStringAsFixed(0)}%' : ''}',
                                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                                ),
                              ]),
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // Attachments
                    FadeSlideIn(
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text('${tr('المرفقات', 'Attachments')} (${attachments.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            if (_canEdit) TextButton.icon(onPressed: _uploadAttachment, icon: const Icon(Icons.add, size: 16), label: Text(tr('رفع', 'Upload'))),
                          ]),
                          if (attachments.isEmpty)
                            Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(tr('لا توجد مرفقات', 'No attachments'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))),
                          ...attachments.map((att) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Row(children: [
                                  const Icon(Icons.attach_file_rounded, size: 17, color: T.navy),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text((att['title'] ?? att['fileName'] ?? att['originalName'] ?? '—').toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                  if (_canEdit) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => _deleteAttachment(att)),
                                ]),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    JpTaskPanel(section: 'contracts', kind: 'vendor', refId: '${v['_id'] ?? widget.vendorId}'),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
