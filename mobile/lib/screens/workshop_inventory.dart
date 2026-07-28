import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مستودع الورشة — قطع الغيار: بحث الخادم، إضافة صنف، وصرف قطعة على شاحنة
/// مع مصير القطعة المستبدلة (تالفة/تحت التجديد/لا توجد) كما على الويب.
class WorkshopInventoryScreen extends StatefulWidget {
  const WorkshopInventoryScreen({super.key});
  @override
  State<WorkshopInventoryScreen> createState() => _WorkshopInventoryScreenState();
}

class _WorkshopInventoryScreenState extends State<WorkshopInventoryScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('inventory:*', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('inventory:*', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _q.trim().isEmpty ? '' : '&search=${Uri.encodeQueryComponent(_q.trim())}';
      final d = await Api.instance.get('/api/workshop/inventory?limit=100$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _createItem() async {
    final name = TextEditingController();
    final code = TextEditingController();
    final category = TextEditingController();
    final quantity = TextEditingController(text: '1');
    final price = TextEditingController();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('صنف جديد', 'New item'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم الصنف *', 'Name *'))),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: code, decoration: InputDecoration(labelText: tr('الكود', 'Code')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: category, decoration: InputDecoration(labelText: tr('الفئة', 'Category')))),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: quantity, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الكمية', 'Quantity')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سعر الوحدة', 'Unit price')))),
            ]),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if (name.text.trim().isEmpty) return;
                  try {
                    await Api.instance.post('/api/workshop/inventory', {
                      'name': name.text.trim(),
                      if (code.text.trim().isNotEmpty) 'code': code.text.trim(),
                      if (category.text.trim().isNotEmpty) 'category': category.text.trim(),
                      'quantity': num.tryParse(quantity.text) ?? 1,
                      if (price.text.trim().isNotEmpty) 'unitPrice': num.tryParse(price.text),
                    });
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('إضافة', 'Add')),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _issue(Map<String, dynamic> item) async {
    final quantity = TextEditingController(text: '1');
    final vehicle = TextEditingController();
    final notes = TextEditingController();
    String fate = 'none';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tr('صرف', 'Issue')} — ${item['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            Text('${tr('المتوفر', 'In stock')}: ${item['quantity'] ?? 0}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: quantity, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الكمية *', 'Quantity *')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: vehicle, decoration: InputDecoration(labelText: tr('رقم الشاحنة', 'Vehicle #')))),
            ]),
            const SizedBox(height: 12),
            Text(tr('مصير القطعة المستبدلة *', 'Replaced part fate *'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'none', label: Text(tr('لا توجد', 'None'), style: const TextStyle(fontSize: 11.5))),
                ButtonSegment(value: 'damaged', label: Text(tr('تالفة', 'Damaged'), style: const TextStyle(fontSize: 11.5))),
                ButtonSegment(value: 'under_renewal', label: Text(tr('تحت التجديد', 'Renewal'), style: const TextStyle(fontSize: 11.5))),
              ],
              selected: {fate},
              onSelectionChanged: (s) => setS(() => fate = s.first),
            ),
            const SizedBox(height: 10),
            TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  try {
                    await Api.instance.post('/api/workshop/inventory/${item['_id']}/issue', {
                      'quantity': num.tryParse(quantity.text) ?? 1,
                      'replacedFate': fate,
                      if (vehicle.text.trim().isNotEmpty) 'vehicleNumber': vehicle.text.trim(),
                      if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                    });
                    if (c.mounted) Navigator.pop(c);
                    _load();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('صرف', 'Issue')),
              ),
            ),
          ]),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('مستودع الورشة', 'Workshop Store')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createItem,
        icon: const Icon(Icons.add),
        label: Text(tr('صنف', 'Item')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: TextField(
            onSubmitted: (v) { setState(() { _q = v; _loading = true; }); _load(); },
            onChanged: (v) => _q = v,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(hintText: tr('ابحث بالاسم أو الكود ثم إدخال…', 'Search then enter…'), prefixIcon: const Icon(Icons.search)),
          ),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.inventory_outlined, title: tr('لا توجد أصناف', 'No items'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = _rows[i];
                                final qty = (r['quantity'] ?? 0) as num;
                                final low = qty <= ((r['minQuantity'] ?? 2) as num);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: low ? T.danger : T.success,
                                    child: Row(children: [
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                          Text([r['code'], r['category']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                          const SizedBox(height: 4),
                                          Wrap(spacing: 6, children: [
                                            Chip2('${tr('المتوفر', 'Stock')}: $qty', low ? T.danger : T.success),
                                            if ((r['underRenewalQty'] ?? 0) != 0) Chip2('${tr('تحت التجديد', 'Renewing')}: ${r['underRenewalQty']}', T.warn),
                                            if (r['approvalStatus'] == 'pending') Chip2(tr('بانتظار الاعتماد', 'Pending approval'), T.orange),
                                          ]),
                                        ]),
                                      ),
                                      FilledButton.tonal(
                                        onPressed: qty > 0 ? () => _issue(r) : null,
                                        child: Text(tr('صرف', 'Issue'), style: const TextStyle(fontSize: 12.5)),
                                      ),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}
