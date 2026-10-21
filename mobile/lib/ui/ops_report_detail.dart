import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';

/// كشفُ التشغيل كاملًا وتعديلُه — نظيرُ ReportDetail في
/// components/customs/LinkedOpsReports (الموقع) والحقولِ في lib/workflowFields.
///
/// ما يُعرض هو ما يصل من الخادم: يحجب قيمةَ البيع وأعمدةَ المال عمّن لا يملكها
/// بقاعدة سير العمل نفسِها (`stripRowFor`)، فلا تُحجب هنا بقائمةٍ ثانية. والتعديلُ
/// يُحفظ من `PUT /api/workflows/:id` بقفله وقواعده — والحقولُ القابلةُ للتعديل
/// هي التي يقول الخادمُ إنّه سيقبلها (`access.fields`).

typedef OpsField = (String key, String ar, String en, String type);

const List<(String, String, List<OpsField>)> opsReportSections = [
  ('بيانات الطلب', 'Application details', [
    ('reportNumber', 'رقم كشف التخريج', 'Report number', ''),
    ('reportDate', 'تاريخ الكشف', 'Report date', 'date'),
    ('loadingTime', 'وقت التحميل', 'Loading time', ''),
    ('fromLocation', 'عنوان الشحن', 'Shipping address', ''),
    ('toLocation', 'عنوان الوصول', 'Arrival address', ''),
    ('branch', 'الفرع', 'Branch', ''),
    ('carOwner', 'مالك السيارة', 'Car owner', ''),
    ('carNumber', 'رقم السيارة', 'Car number', ''),
    ('ownerType', 'نوع المالك', 'Owner type', ''),
    ('executionStatus', 'حالة التنفيذ', 'Execution status', ''),
    ('applicationStatus', 'الحالة', 'Status', ''),
    ('driverRentalType', 'نوع تأجير السائق', 'Driver rental type', ''),
    ('username', 'اسم المستخدم', 'Username', ''),
    ('paymentMethod', 'طريقة الدفع', 'Payment method', ''),
    ('purchaseValue', 'سعر الشراء', 'Purchase value', 'number'),
    ('sellingValue', 'سعر البيع', 'Selling value', 'number'),
    ('reference', 'رقم المرجع', 'Reference', ''),
    ('userPhone', 'هاتف المستخدم', 'User phone', ''),
    ('driverName', 'اسم السائق', 'Driver name', ''),
    ('driverPhone', 'هاتف السائق', 'Driver phone', ''),
    ('carName', 'اسم السيارة', 'Car name', ''),
    ('plateNumber', 'رقم اللوحة', 'Plate number', ''),
    ('truckType', 'نوع الشاحنة', 'Truck type', ''),
    ('truckSize', 'حجم الشاحنة', 'Truck size', ''),
    ('loadType', 'نوع الحمولة', 'Load type', ''),
    ('quantity', 'الكمية', 'Quantity', ''),
    ('goodsValue', 'قيمة البضائع', 'Goods value', 'number'),
    ('representativeName', 'اسم المندوب', 'Representative', ''),
    ('country', 'اسم الدولة', 'Country', ''),
  ]),
  ('مراجعه التشغيل', 'Operations review', [
    ('operationsReview', 'مراجعه التشغيل', 'Operations review', ''),
  ]),
  ('بيانات المودريتور', 'Manual moderator', [
    ('paymentDate', 'تاريخ السداد', 'Payment date', 'date'),
    ('payingBranch', 'الفرع المسدد', 'Paying branch', ''),
    ('paymentType', 'نوع الدفع', 'Payment type', 'ptype'),
    ('finalReportDestination', 'وجهه الكشف النهائي', 'Final report destination', ''),
    ('documentNumber', 'رقم السند', 'Document number', ''),
    ('sendingDate', 'تاريخ الارسال', 'Sending date', 'date'),
    ('deliveryDate', 'تاريخ التسليم', 'Delivery date', 'date'),
    ('accountingReview', 'مراجعه الحسابات', 'Accounting review', ''),
  ]),
  ('بيانات التحصيل', 'Collections', [
    ('invoiceNumber', 'رقم الفاتوره', 'Invoice number', ''),
    ('netInvoice', 'صافي الفاتوره', 'Net invoice', 'number'),
    ('tax', 'ضريبه', 'Tax', 'number'),
    ('totalInvoice', 'اجمالى الفاتوره', 'Total invoice', 'number'),
    ('invoiceDate', 'تاريخ الفاتوره', 'Invoice date', 'date'),
    ('invoiceNotes', 'ملاحظات الفاتوره', 'Invoice notes', ''),
    ('collectionDate', 'تاريخ التحصيل', 'Collection date', 'date'),
  ]),
];

/// نوعُ الدفع: ستُّ قيمٍ تُعرَض وأربعٌ تُختار — كـ lib/paymentKind في الويب.
const opsPaymentChoices = [
  ('deferred_invoice', 'آجل - فاتورة', 'Deferred – invoice'),
  ('deferred_cash', 'آجل - كاش', 'Deferred – cash'),
  ('cash_3pl', 'نقدي - 3PL', 'Cash – 3PL'),
  ('cash_ht', 'نقدي - HT', 'Cash – HT'),
];

String opsPaymentKindOf(Map d) {
  final t = '${d['paymentType'] ?? ''}';
  if (opsPaymentChoices.any((c) => c.$1 == t)) return t;
  final sub = '${d['paymentSubtype'] ?? ''}';
  if (opsPaymentChoices.any((c) => c.$1 == sub)) return sub;
  return t;
}

String opsPaymentKindLabel(String k) {
  for (final c in opsPaymentChoices) {
    if (c.$1 == k) return tr(c.$2, c.$3);
  }
  if (k == 'cash') return tr('كاش', 'Cash');
  if (k == 'tax') return tr('ضريبي', 'Tax');
  return k;
}

String _day(dynamic v) {
  final s = '${v ?? ''}';
  return s.length >= 10 ? s.substring(0, 10) : s;
}

String _shown(OpsField f, Map d) {
  final v = d[f.$1];
  switch (f.$4) {
    case 'ptype':
      return opsPaymentKindLabel(opsPaymentKindOf(d));
    case 'date':
      final x = v != null ? DateTime.tryParse('$v')?.toLocal() : null;
      return x == null ? '' : '${x.day}/${x.month}/${x.year}';
    case 'number':
      if (v == null || '$v'.isEmpty) return '';
      final n = v is num ? v : num.tryParse('$v') ?? 0;
      return n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
    default:
      return v == null ? '' : '$v';
  }
}

/// الأقسامُ بما وصل منها — قسمٌ لا خانةَ فيه للدور لا يُعرض.
List<(String, String, List<OpsField>)> visibleSections(Map d) => [
      for (final s in opsReportSections)
        if (s.$3.any((f) => d.containsKey(f.$1)))
          (s.$1, s.$2, s.$3.where((f) => d.containsKey(f.$1)).toList()),
    ];

class OpsReportFields extends StatelessWidget {
  final Map detail;
  const OpsReportFields({super.key, required this.detail});
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final s in visibleSections(detail)) ...[
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Text(tr(s.$1, s.$2), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
        ),
        for (final f in s.$3)
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 120, child: Text(tr(f.$2, f.$3), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
              Expanded(
                child: Text(_shown(f, detail).isEmpty ? '—' : _shown(f, detail),
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _shown(f, detail).isEmpty ? T.inkFaint : T.ink)),
              ),
            ]),
          ),
      ],
    ]);
  }
}

/// تعديلُ الكشف: يأخذ القفلَ، ويفتح نموذجَ الحقول المسموحة، ويحفظ ما تغيّر وحدَه.
/// يُرجع رسالةَ النجاح (أو ما رفضه الخادم) — و null إن أُلغي.
Future<String?> editOpsReport(BuildContext context, {required String workflowId, required Map detail, required List<String> fields}) async {
  final can = fields.toSet();
  final editable = [for (final s in visibleSections(detail)) for (final f in s.$3) if (can.contains(f.$1)) f];
  if (editable.isEmpty) return null;
  try {
    await Api.instance.post('/api/workflows/$workflowId/lock');
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    return null;
  }
  if (!context.mounted) return null;
  final res = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => FractionallySizedBox(heightFactor: 0.9, child: _EditSheet(workflowId: workflowId, detail: detail, fields: editable)),
  );
  // أُغلقت بلا حفظ: يُرفع القفل (الحفظُ يرفعه بنفسه).
  if (res == null) {
    try { await Api.instance.post('/api/workflows/$workflowId/unlock'); } catch (_) { /* القفلُ ينتهي وحدَه */ }
  }
  return res;
}

class _EditSheet extends StatefulWidget {
  final String workflowId;
  final Map detail;
  final List<OpsField> fields;
  const _EditSheet({required this.workflowId, required this.detail, required this.fields});
  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late final Map<String, String> _orig = {
    for (final f in widget.fields)
      f.$1: f.$4 == 'ptype' ? opsPaymentKindOf(widget.detail) : f.$4 == 'date' ? _day(widget.detail[f.$1]) : '${widget.detail[f.$1] ?? ''}',
  };
  late final Map<String, String> _val = {..._orig};
  late final Map<String, TextEditingController> _ctl = {
    for (final f in widget.fields)
      if (f.$4 == '' || f.$4 == 'number') f.$1: TextEditingController(text: _orig[f.$1]),
  };
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in _ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    for (final e in _ctl.entries) {
      _val[e.key] = e.value.text.trim();
    }
    final payload = <String, dynamic>{};
    for (final f in widget.fields) {
      final v = _val[f.$1] ?? '';
      if (v == (_orig[f.$1] ?? '')) continue;
      payload[f.$1] = f.$4 == 'number' ? (v.isEmpty ? '' : (num.tryParse(v) ?? v)) : v;
    }
    if (payload.isEmpty) { Navigator.pop(context); return; }
    setState(() { _saving = true; _error = null; });
    try {
      final out = await Api.instance.put('/api/workflows/${widget.workflowId}', payload);
      try { await Api.instance.post('/api/workflows/${widget.workflowId}/unlock'); } catch (_) { /* */ }
      if (!mounted) return;
      final refused = out is Map ? '${out['refusedMessage'] ?? ''}' : '';
      Navigator.pop(context, refused.isNotEmpty ? refused : tr('حُفظ التعديل', 'Saved'));
    } catch (e) {
      // رسالةُ الخادم كما هي: «لا يُسجَّل تاريخ السداد إلا بعد…».
      if (mounted) setState(() { _saving = false; _error = e.toString(); });
    }
  }

  Future<void> _pickDate(String key) async {
    final cur = DateTime.tryParse(_val[key] ?? '');
    final d = await showDatePicker(context: context, initialDate: cur ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2100));
    if (d != null && mounted) {
      setState(() => _val[key] = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${tr('تعديل الكشف', 'Edit report')} ${widget.detail['reportNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 4),
        Text(tr('تظهر هنا الحقولُ التي تملك تعديلَها وحدَها.', 'Only the fields you may edit are shown.'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        const SizedBox(height: 8),
        Expanded(
          child: ListView(children: [
            for (final f in widget.fields)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: f.$4 == 'ptype'
                    ? DropdownButtonFormField<String>(
                        initialValue: opsPaymentChoices.any((c) => c.$1 == _val[f.$1]) ? _val[f.$1] : null,
                        decoration: InputDecoration(labelText: tr(f.$2, f.$3), helperText: opsPaymentChoices.any((c) => c.$1 == _val[f.$1]) ? null : '${tr('الحالي', 'Current')}: ${opsPaymentKindLabel(_val[f.$1] ?? '')}'),
                        items: [for (final c in opsPaymentChoices) DropdownMenuItem(value: c.$1, child: Text(tr(c.$2, c.$3)))],
                        onChanged: (v) => setState(() => _val[f.$1] = v ?? ''),
                      )
                    : f.$4 == 'date'
                        ? InkWell(
                            onTap: () => _pickDate(f.$1),
                            child: InputDecorator(
                              decoration: InputDecoration(
                                labelText: tr(f.$2, f.$3),
                                suffixIcon: (_val[f.$1] ?? '').isEmpty
                                    ? const Icon(Icons.event_outlined, size: 18)
                                    : IconButton(icon: const Icon(Icons.close, size: 16), onPressed: () => setState(() => _val[f.$1] = '')),
                              ),
                              child: Text((_val[f.$1] ?? '').isEmpty ? '—' : _val[f.$1]!),
                            ),
                          )
                        : TextField(
                            controller: _ctl[f.$1],
                            keyboardType: f.$4 == 'number' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
                            decoration: InputDecoration(labelText: tr(f.$2, f.$3)),
                          ),
              ),
          ]),
        ),
        if (_error != null)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(fontSize: 12, color: T.danger))),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          label: Text(tr('حفظ', 'Save')),
        ),
      ]),
    );
  }
}
