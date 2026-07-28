import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

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

const _costItems = [
  ('deliveryOrder', 'إذن التسليم', 'Delivery order'),
  ('customsDuty', 'الرسوم الجمركية', 'Customs duty'),
  ('portFees', 'أجور الموانئ', 'Port fees'),
  ('unloadingFees', 'أجور التفريغ', 'Unloading fees'),
  ('transport', 'النقل', 'Transport'),
  ('yardFees', 'أجور الساحة', 'Yard fees'),
  ('demurrage', 'أرضيات', 'Demurrage'),
  ('inspection', 'الكشف', 'Inspection'),
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
    final totalCost = _costItems.fold<num>(0, (s, it) => s + ((costs[it.$1] ?? 0) as num));

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
                    const SizedBox(height: 20),
                  ]),
                ),
    );
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
