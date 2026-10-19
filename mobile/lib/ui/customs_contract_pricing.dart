import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';

/// «أسعار التعاقد مع العميل» — ورقةٌ تُفتح من عقد العميل وحدَه (partyKind ==
/// 'customer'). نموذجُ العقود العامّ لا يكتب مصفوفاتٍ متداخلة (وجهاتُ النقل)،
/// فالأسعارُ هنا: تُقرأ من صفّ العقد في القائمة، وتُحفَظ PUT بـ`{pricing}` وحدَه.
/// تردّ true إن حُفظ شيء.
Future<bool> editCustomsContractPricing(BuildContext context, Map<String, dynamic> contract) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _PricingSheet(contract: contract),
  );
  return saved == true;
}

class _PricingSheet extends StatefulWidget {
  final Map<String, dynamic> contract;
  const _PricingSheet({required this.contract});
  @override
  State<_PricingSheet> createState() => _PricingSheetState();
}

class _Route {
  final TextEditingController from;
  final TextEditingController to;
  final TextEditingController price;
  _Route(dynamic r)
      : from = TextEditingController(text: '${r is Map ? r['from'] ?? '' : ''}'),
        to = TextEditingController(text: '${r is Map ? r['to'] ?? '' : ''}'),
        price = TextEditingController(text: r is Map && r['price'] != null ? '${r['price']}' : '');
  void dispose() { from.dispose(); to.dispose(); price.dispose(); }
}

class _PricingSheetState extends State<_PricingSheet> {
  late final Map<String, dynamic> _p =
      widget.contract['pricing'] is Map ? Map<String, dynamic>.from(widget.contract['pricing']) : {};
  // الفارغُ (null) غيرُ متّفقٍ عليه — يبقى فارغًا لا صفرًا.
  late final TextEditingController _fee = TextEditingController(text: _p['clearanceFeePerContainer'] == null ? '' : '${_p['clearanceFeePerContainer']}');
  late final TextEditingController _toYard = TextEditingController(text: _p['portToYard'] == null ? '' : '${_p['portToYard']}');
  late final TextEditingController _yardToCustomer = TextEditingController(text: _p['yardToCustomer'] == null ? '' : '${_p['yardToCustomer']}');
  late final List<_Route> _routes = [for (final r in (_p['routes'] is List ? _p['routes'] as List : const [])) _Route(r)];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (_routes.isEmpty) _routes.add(_Route(null));
  }

  @override
  void dispose() {
    _fee.dispose();
    _toYard.dispose();
    _yardToCustomer.dispose();
    for (final r in _routes) { r.dispose(); }
    super.dispose();
  }

  // '' يعود null في الخادم (cleanPricing) — «لم يُتّفق على سعر».
  dynamic _num(TextEditingController c) {
    final t = c.text.trim();
    return t.isEmpty ? '' : (num.tryParse(t) ?? '');
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await Api.instance.put('/api/customs-clearance/contracts/${widget.contract['_id']}', {
        'pricing': {
          'clearanceFeePerContainer': _num(_fee),
          'portToYard': _num(_toYard),
          'yardToCustomer': _num(_yardToCustomer),
          'routes': [
            for (final r in _routes)
              if (r.from.text.trim().isNotEmpty || r.to.text.trim().isNotEmpty || r.price.text.trim().isNotEmpty)
                {'from': r.from.text.trim(), 'to': r.to.text.trim(), 'price': _num(r.price)},
          ],
        },
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  InputDecoration _dec(String label) => InputDecoration(labelText: label, isDense: true);

  @override
  Widget build(BuildContext context) {
    const numKb = TextInputType.numberWithOptions(decimal: true);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('أسعار التعاقد مع العميل', 'Customer contract prices'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            Text('${widget.contract['title'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 4),
            Text(tr('تُملأ هذه الأسعار تلقائيًّا في «الإيرادات والفوترة» لكل معاملة لهذا العميل، وتبقى قابلة للتعديل هناك.',
                    'These prices fill “Revenue & invoice” automatically on every transaction for this customer, and stay editable there.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            TextField(controller: _fee, keyboardType: numKb, textDirection: TextDirection.ltr,
                decoration: _dec(tr('أجور التخليص (للحاوية الواحدة)', 'Clearance fee (per container)'))),
            const SizedBox(height: 14),
            Text(tr('النقل من الميناء إلى العميل', 'Transport: port → customer'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            for (final e in _routes.asMap().entries)
              Padding(
                key: ObjectKey(e.value),
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  Expanded(flex: 3, child: TextField(controller: e.value.from, decoration: _dec(tr('من', 'From')))),
                  const SizedBox(width: 6),
                  Expanded(flex: 3, child: TextField(controller: e.value.to, decoration: _dec(tr('إلى', 'To')))),
                  const SizedBox(width: 6),
                  Expanded(flex: 2, child: TextField(controller: e.value.price, keyboardType: numKb, textDirection: TextDirection.ltr,
                      decoration: _dec(tr('السعر', 'Price')))),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.remove_circle_outline, size: 20, color: T.danger),
                    tooltip: tr('حذف الوجهة', 'Remove route'),
                    onPressed: () {
                      final gone = _routes.removeAt(e.key);
                      setState(() {});
                      // تُتلَف ضوابطُه بعد أن تُرفع خاناتُه من الشجرة، لا قبلها.
                      WidgetsBinding.instance.addPostFrameCallback((_) => gone.dispose());
                    },
                  ),
                ]),
              ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () => setState(() => _routes.add(_Route(null))),
                icon: const Icon(Icons.add, size: 16),
                label: Text(tr('إضافة وجهة', 'Add route')),
              ),
            ),
            const SizedBox(height: 8),
            TextField(controller: _toYard, keyboardType: numKb, textDirection: TextDirection.ltr,
                decoration: _dec(tr('النقل من الميناء إلى الساحة', 'Transport: port → yard'))),
            const SizedBox(height: 10),
            TextField(controller: _yardToCustomer, keyboardType: numKb, textDirection: TextDirection.ltr,
                decoration: _dec(tr('النقل من الساحة إلى العميل', 'Transport: yard → customer'))),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: _busy ? null : _save, child: Text(tr('حفظ', 'Save'))),
            ),
          ]),
        ),
      ),
    );
  }
}
