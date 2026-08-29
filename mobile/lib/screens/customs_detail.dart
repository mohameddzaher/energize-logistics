import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/file_upload.dart';

/// تفاصيل التخليص الجمركي — مسار الـ١١ مرحلة (تقدّم بلمسة)، مهام الإنجاز
/// (stageDone) بتواريخها، مستندات البوليصة وأوراق الوكيل، وملخص التكاليف.
class CustomsDetailScreen extends StatefulWidget {
  final String clearanceId;
  final String ref;
  const CustomsDetailScreen({super.key, required this.clearanceId, required this.ref});
  @override
  State<CustomsDetailScreen> createState() => _CustomsDetailScreenState();
}

/// المراحل الـ١١ بالترتيب.
const customsStages = [
  ('papers_received', 'استلام الأوراق', 'Papers received'),
  ('declaration_paid', 'طباعة البيان وسداده', 'Declaration paid'),
  ('do_requested', 'طلب إذن التسليم', 'DO requested'),
  ('do_linked', 'ربط إذن التسليم', 'DO linked'),
  ('port_fees_paid', 'سداد أجور الموانئ', 'Port fees paid'),
  ('unloading_fees_paid', 'سداد أجور التفريغ', 'Unloading fees paid'),
  ('transport_order', 'أمر النقل', 'Transport order'),
  ('containers_transported', 'نقل الحاويات', 'Containers transported'),
  ('unloaded_stored', 'التفريغ والتخزين', 'Unloaded & stored'),
  ('containers_returned', 'إرجاع الحاويات', 'Containers returned'),
  ('invoiced', 'عمل الفواتير', 'Invoiced'),
];

const _stageDoneItems = [
  ('doInvoiceEmailed', 'ميل فاتورة إذن التسليم', 'DO invoice emailed'),
  ('doInvoicePaid', 'سداد فاتورة إذن التسليم', 'DO invoice paid'),
  ('doLinkEmailed', 'ميل ربط إذن التسليم', 'DO link emailed'),
  ('dutyPaid', 'سداد الرسوم الجمركية', 'Duty paid'),
  ('portFeesPaid', 'سداد الموانئ', 'Port fees paid'),
  ('unloadingFeesPaid', 'سداد التفريغ', 'Unloading fees paid'),
  ('containersReturned', 'إرجاع الحاويات', 'Containers returned'),
  ('returnInvoiceDate', 'فاتورة الإرجاع', 'Return invoice'),
];

const _documentItems = [
  ('bl', 'البوليصة', 'Bill of lading'),
  ('commercialInvoice', 'الفاتورة التجارية', 'Commercial invoice'),
  ('certificateOfOrigin', 'شهادة المنشأ', 'Certificate of origin'),
  ('packingList', 'بيان التعبئة', 'Packing list'),
  ('saber', 'شهادة سابر', 'Saber certificate'),
];

const _agentPaperItems = [
  ('blStamped', 'البوليصة بختم التخليص + رقم المستورد', 'BL stamped + importer no.'),
  ('customerAuthorization', 'تفويض العميل للشركة', 'Customer authorization'),
  ('companyAuthorization', 'تفويض الشركة للمندوب', 'Company authorization'),
];

/// بنود المصروفات — مبالغُ تُدفع للغير وتُمرَّر على العميل كما هي. الترتيب
/// والمحتوى مطابقان لـCOST_KEYS في الخادم؛ نقصانُ بندٍ هنا يجعل إجماليَّ
/// الجوّال أقلَّ من إجمالي الويب في المعاملة نفسها.
const _costItems = [
  ('deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'),
  ('customsDuty', 'الرسوم الجمركية', 'Customs duty'),
  ('portFees', 'أجور الموانئ', 'Port fees'),
  ('unloadingFees', 'أجور التفريغ', 'Unloading fees'),
  ('inspection', 'أجور الكشف', 'Inspection'),
  ('transport', 'أجور النقل', 'Transport'),
  ('transportToYard', 'النقل إلى الساحة', 'Transport to yard'),
  ('appointmentBooking', 'حجز الموعد', 'Appointment booking'),
  ('storage', 'تخزين', 'Storage'),
  ('yardFees', 'أجور الساحة', 'Yard fees'),
  ('exitPermit', 'تصريح الخروج', 'Exit permit'),
  ('demurrage', 'أرضيات', 'Demurrage'),
  ('extension', 'تمديد', 'Extension'),
  ('consolidator', 'الدامج', 'Consolidator'),
  ('commissions', 'عمولات', 'Commissions'),
  ('returnInvoice', 'فاتورة الإرجاع', 'Return invoice'),
];

/// بنود الهامش — مجموعُها هو الربح، والفاتورة = المصروفات + الهامش.
const _marginItems = [
  ('clearanceFee', 'أجور التخليص', 'Clearance fee'),
  ('transportNet', 'صافي النقل', 'Transport net'),
  ('transportToYardNet', 'صافي النقل إلى الساحة', 'Transport-to-yard net'),
  ('yardNet', 'صافي الساحة', 'Yard net'),
  ('storageNet', 'صافي التخزين', 'Storage net'),
  ('securityScan', 'فحص أمني', 'Security scan'),
  ('labour', 'عمال', 'Labour'),
];

Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : {};

class _CustomsDetailScreenState extends State<CustomsDetailScreen> {
  Map<String, dynamic>? _c;
  bool _loading = true;
  String? _error;
  bool _saving = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}');
      if (!mounted) return;
      setState(() {
        _c = d['clearance'] is Map ? Map<String, dynamic>.from(d['clearance']) : Map<String, dynamic>.from(d);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _patch(Map<String, dynamic> body, String okMsg) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/customs-clearance/${widget.clearanceId}', body);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  num _nz(Map<String, dynamic> m, String k) {
    final v = m[k];
    return v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  }

  String _money(dynamic v) {
    final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
    return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  }

  @override
  Widget build(BuildContext context) {
    final c = _c ?? {};
    final stageIndex = customsStages.indexWhere((s) => s.$1 == c['stage']);
    final stageDone = _m(c['stageDone']);
    final stageDates = _m(c['stageDates']);
    final costs = _m(c['costs']);
    final documents = _m(c['documents']);
    final agentPapers = _m(c['agentPapers']);
    final revenue = _m(c['revenue']);
    final attachments = List<Map<String, dynamic>>.from(
        (c['attachments'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final totalCost = _costItems.fold<num>(0, (s, it) => s + _nz(costs, it.$1));
    final profit = _marginItems.fold<num>(0, (s, it) => s + _nz(revenue, it.$1));
    final invoiced = totalCost + profit;

    return AppScaffold(
      title: Text('${tr('تخليص', 'Clearance')} ${widget.ref}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 220)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // ── معلومات أساسية ──
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: c['cancelled'] == true ? T.danger : T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text((c['customerName'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((c['blNumber'] ?? '').toString().isNotEmpty) Chip2('BL: ${c['blNumber']}', T.navy),
                            Chip2(c['branch'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'), T.info),
                            if (c['containerCount'] != null) Chip2('${c['containerCount']} ${tr('حاوية', 'containers')}', T.violet),
                            if ((c['shippingAgent'] ?? '').toString().isNotEmpty) Chip2(c['shippingAgent'].toString(), T.cyan, icon: Icons.directions_boat_outlined),
                            if (c['cancelled'] == true) Chip2(tr('ملغى', 'Cancelled'), T.danger),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مسار المراحل ──
                    FadeSlideIn(
                      delayMs: 40,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('مسار التخليص', 'Clearance pipeline'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            Text('${stageIndex + 1}/${customsStages.length}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.navy)),
                          ]),
                          const SizedBox(height: 10),
                          ...customsStages.asMap().entries.map((e) {
                            final done = e.key <= stageIndex;
                            final current = e.key == stageIndex;
                            return InkWell(
                              onTap: _saving || current ? null : () => _patch({'stage': e.value.$1}, tr('تم تحديث المرحلة', 'Stage updated')),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 3),
                                child: Row(children: [
                                  Column(children: [
                                    Container(
                                      width: 22, height: 22,
                                      decoration: BoxDecoration(
                                        color: done ? T.success : Colors.transparent,
                                        shape: BoxShape.circle,
                                        border: Border.all(color: done ? T.success : T.inkFaint, width: 2),
                                      ),
                                      child: done ? const Icon(Icons.check, size: 13, color: Colors.white) : null,
                                    ),
                                    if (e.key < customsStages.length - 1)
                                      Container(width: 2, height: 20, color: done ? T.success.withValues(alpha: 0.4) : T.inkFaint.withValues(alpha: 0.25)),
                                  ]),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      tr(e.value.$2, e.value.$3),
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: current ? FontWeight.w900 : FontWeight.w600,
                                        color: current ? T.navy : done ? T.ink : T.inkSoft,
                                      ),
                                    ),
                                  ),
                                  if (current) Chip2(tr('الحالية', 'Current'), T.navy),
                                  if (!done && !current) const Icon(Icons.chevron_left, size: 18, color: T.inkFaint),
                                ]),
                              ),
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مهام الإنجاز ──
                    FadeSlideIn(
                      delayMs: 80,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('مهام الإنجاز', 'Completion tasks'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._stageDoneItems.map((it) {
                            final done = stageDone[it.$1] == true;
                            final date = (stageDates[it.$1] ?? '').toString();
                            return CheckboxListTile(
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                              controlAffinity: ListTileControlAffinity.leading,
                              value: done,
                              onChanged: _saving ? null : (v) => _patch({
                                'stageDone': {it.$1: v},
                                if (v == true && date.isEmpty)
                                  'stageDates': {it.$1: DateTime.now().toIso8601String().split('T').first},
                              }, tr('تم التحديث', 'Updated')),
                              title: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              subtitle: date.isNotEmpty ? Text(date, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)) : null,
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مستندات البوليصة ──
                    FadeSlideIn(
                      delayMs: 90,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('المستندات', 'Documents'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._documentItems.map((it) => CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                controlAffinity: ListTileControlAffinity.leading,
                                value: documents[it.$1] == true,
                                onChanged: _saving ? null : (v) => _patch({'documents': {it.$1: v}}, tr('تم التحديث', 'Updated')),
                                title: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── أوراق الوكيل ──
                    FadeSlideIn(
                      delayMs: 105,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('أوراق الوكيل', 'Agent papers'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._agentPaperItems.map((it) => CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                controlAffinity: ListTileControlAffinity.leading,
                                value: agentPapers[it.$1] == true,
                                onChanged: _saving ? null : (v) => _patch({'agentPapers': {it.$1: v}}, tr('تم التحديث', 'Updated')),
                                title: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── التكاليف ──
                    FadeSlideIn(
                      delayMs: 120,
                      child: AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('التكاليف', 'Costs'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            IconButton(icon: const Icon(Icons.edit_outlined, size: 18, color: T.navy), onPressed: () => _editCosts(costs)),
                          ]),
                          ..._costItems.where((it) => (costs[it.$1] ?? 0) != 0).map((it) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [
                              Expanded(child: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5))),
                              Text('${_money(costs[it.$1])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                            ]),
                          )),
                          const Divider(height: 18),
                          Row(children: [
                            Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                            const Spacer(),
                            Text('${_money(totalCost)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: T.orange)),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── الهامش والفاتورة ──
                    // في التخليص لا تُباع الرسوم بل تُمرَّر: ما دُفع للموانى
                    // والجمارك يُسترد كما هو، والربحُ هو ما أُضيف فوقه. لذلك
                    // الفاتورةُ محسوبةٌ لا مكتوبة: مصروفات + هامش.
                    FadeSlideIn(
                      delayMs: 140,
                      child: AppCard(
                        topAccent: T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('الهامش والفاتورة', 'Margin & invoice'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            IconButton(icon: const Icon(Icons.edit_outlined, size: 18, color: T.navy), onPressed: () => _editMargin(revenue)),
                          ]),
                          ..._marginItems.where((it) => _nz(revenue, it.$1) != 0).map((it) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [
                              Expanded(child: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5))),
                              Text('${_money(_nz(revenue, it.$1))} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                            ]),
                          )),
                          const Divider(height: 18),
                          Row(children: [
                            Text(tr('صافي الربح', 'Net profit'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                            const Spacer(),
                            Text('${_money(profit)} ${tr('ر.س', 'SAR')}',
                                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: profit >= 0 ? T.success : T.danger)),
                          ]),
                          const SizedBox(height: 4),
                          Row(children: [
                            Text(tr('إجمالي الفاتورة', 'Total invoiced'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                            const Spacer(),
                            Text('${_money(invoiced)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: T.navy)),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── المرفقات ──
                    // ورقُ كلِّ مرحلةٍ موسومًا بها، يُفتح ويُنزَّل من الجوّال
                    // كما من الويب: من في الميناء أحوجُ إليه ممّن في المكتب.
                    FadeSlideIn(
                      delayMs: 160,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text('${tr('المرفقات', 'Attachments')} (${attachments.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            TextButton.icon(onPressed: _saving ? null : _uploadAttachment, icon: const Icon(Icons.attach_file_rounded, size: 16), label: Text(tr('إرفاق', 'Attach'))),
                          ]),
                          if (attachments.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(tr('لا مرفقات بعد. اختر المرحلة ثمّ أرفق ورقَها.', 'No attachments yet. Pick a stage, then attach its paperwork.'),
                                  style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
                            ),
                          ...attachments.map((att) {
                            final st = (att['stage'] ?? '').toString();
                            final meta = customsStages.where((x) => x.$1 == st).toList();
                            final stLabel = meta.isEmpty ? tr('عامّ', 'General') : tr(meta.first.$2, meta.first.$3);
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(children: [
                                const Icon(Icons.description_outlined, size: 17, color: T.navy),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text((att['title'] ?? att['fileName'] ?? '—').toString(),
                                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                                    Text(stLabel, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ]),
                                ),
                                IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.download_rounded, size: 18, color: T.navy),
                                    tooltip: tr('فتح/تنزيل', 'Open / download'), onPressed: () => _openAttachment(att)),
                                IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                                    onPressed: _saving ? null : () => _deleteAttachment(att)),
                              ]),
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Future<void> _editMargin(Map<String, dynamic> revenue) async {
    final ctrls = {for (final it in _marginItems) it.$1: TextEditingController(text: _nz(revenue, it.$1) == 0 ? '' : _nz(revenue, it.$1).toString())};
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تعديل بنود الهامش', 'Edit margin lines'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 4),
              Text(tr('الفاتورة تُحسب: المصروفات + هذه البنود.', 'The invoice is derived: costs + these lines.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              const SizedBox(height: 12),
              ..._marginItems.map((it) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: TextField(controller: ctrls[it.$1], keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr(it.$2, it.$3))),
              )),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final body = {'revenue': {for (final it in _marginItems) it.$1: num.tryParse(ctrls[it.$1]!.text) ?? 0}};
                    Navigator.pop(c);
                    _patch(body, tr('حُفظ الهامش', 'Margin saved'));
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  /// إرفاقُ ملفٍّ موسومًا بالمرحلة التي أُنتج فيها — يُقرأ بعدُ في موضعه من
  /// دورة الإجراءات لا في كومةٍ واحدة.
  Future<void> _uploadAttachment() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    String stage = (_c?['stage'] ?? '').toString();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setSt) => AlertDialog(
          title: Text(tr('إرفاق ملفّ', 'Attach file')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(picked.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 8),
            TextField(controller: title, autofocus: true, decoration: InputDecoration(labelText: tr('اسم الملفّ', 'Title'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: customsStages.any((x) => x.$1 == stage) ? stage : '',
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('المرحلة', 'Stage')),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('مرفق عامّ', 'General'))),
                ...customsStages.map((x) => DropdownMenuItem(value: x.$1, child: Text(tr(x.$2, x.$3), overflow: TextOverflow.ellipsis))),
              ],
              onChanged: (v) => setSt(() => stage = v ?? ''),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('رفع', 'Upload'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/customs-clearance/${widget.clearanceId}/attachments', {
        'files': [
          {'dataUrl': picked.dataUrl, 'fileName': picked.fileName, 'title': title.text.trim(), 'stage': stage},
        ],
      });
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُرفق الملفّ', 'File attached'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// المرفقُ يُقدَّم على `/api/uploads/...` من الخادم نفسِه، فيُفتح بمتصفّح
  /// الجهاز فينزّله أو يعرضه — لا حاجة لتنزيلٍ داخل التطبيق.
  Future<void> _openAttachment(Map<String, dynamic> att) async {
    final u = (att['fileUrl'] ?? '').toString();
    if (u.isEmpty) return;
    final uri = Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تعذّر فتح الملفّ', 'Could not open the file'))));
    }
  }

  Future<void> _deleteAttachment(Map<String, dynamic> att) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المرفق', 'Delete attachment')),
        content: Text('${att['title'] ?? att['fileName'] ?? ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _saving = true);
    try {
      await Api.instance.delete('/api/customs-clearance/${widget.clearanceId}/attachments/${att['_id']}');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _editCosts(Map<String, dynamic> costs) async {
    final ctrls = {for (final it in _costItems) it.$1: TextEditingController(text: ((costs[it.$1] ?? 0) as num) == 0 ? '' : costs[it.$1].toString())};
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تعديل التكاليف', 'Edit costs'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              ..._costItems.map((it) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: TextField(controller: ctrls[it.$1], keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr(it.$2, it.$3))),
              )),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final body = {'costs': {for (final it in _costItems) it.$1: num.tryParse(ctrls[it.$1]!.text) ?? 0}};
                    Navigator.pop(c);
                    _patch(body, tr('حُفظت التكاليف', 'Costs saved'));
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
