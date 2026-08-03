import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مخزن النقل الثقيل (LS2) — قطع الغيار: أصناف برصيد وسعر وحالة، حركات وارد/صادر
/// (صادر على عربية / وارد من عربية)، إضافة أصناف، وسجل حركات. مطابق للويب.
class Ls2StoreScreen extends StatefulWidget {
  const Ls2StoreScreen({super.key});
  @override
  State<Ls2StoreScreen> createState() => _Ls2StoreScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final s = n.round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return b.toString();
}

const _statusMeta = {
  'ok': ('متوفر', 'In stock', T.success),
  'low': ('منخفض', 'Low', T.warn),
  'out': ('نافد', 'Out', T.danger),
};

class _Ls2StoreScreenState extends State<Ls2StoreScreen> {
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _totals = {};
  List<Map<String, dynamic>> _cats = [];
  List<String> _plates = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _statusF = '';
  String _catF = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('/api/ls2/vehicles').then((d) {
      if (mounted) setState(() => _plates = List<Map<String, dynamic>>.from(d['vehicles'] ?? []).map((v) => (v['plate'] ?? '').toString()).where((p) => p.isNotEmpty).toList());
    }).catchError((_) {});
    _onLive = () => _load();
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() { Live.instance.off('ls2:store', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ls2/store${_q.trim().isEmpty ? '' : '?q=${Uri.encodeComponent(_q.trim())}'}'),
        Api.instance.get('/api/ls2/store/dashboard'),
      ]);
      if (!mounted) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from(res[0]['items'] ?? []);
        _totals = Map<String, dynamic>.from(res[1]['totals'] ?? {});
        _cats = List<Map<String, dynamic>>.from(res[1]['byCategory'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  String _sLabel(String s) { final m = _statusMeta[s]; return m == null ? s : tr(m.$1, m.$2); }
  Color _sColor(String s) => _statusMeta[s]?.$3 ?? T.inkFaint;

  @override
  Widget build(BuildContext context) {
    final items = _items.where((i) => (_statusF.isEmpty || i['status'] == _statusF) && (_catF.isEmpty || i['category'] == _catF)).toList();
    return AppScaffold(
      title: Text(tr('مخزن النقل الثقيل', 'Heavy Transport Store')),
      actions: [IconButton(icon: const Icon(Icons.history), tooltip: tr('سجل الحركات', 'Movements'), onPressed: _openLog)],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF12325C), foregroundColor: Colors.white,
        icon: const Icon(Icons.add), label: Text(tr('صنف', 'Item')), onPressed: () => _openItemForm(null),
      ),
      body: _loading && _items.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // بطاقات
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    child: Row(children: [
                      Expanded(child: _tile(tr('الأصناف', 'Items'), '${_totals['items'] ?? _items.length}', T.orange)),
                      const SizedBox(width: 6),
                      Expanded(child: _tile(tr('القيمة', 'Value'), _money(_totals['totalValue']), T.success)),
                      const SizedBox(width: 6),
                      Expanded(child: _tileTap(tr('منخفض', 'Low'), '${_totals['lowStock'] ?? 0}', T.warn, 'low')),
                      const SizedBox(width: 6),
                      Expanded(child: _tileTap(tr('نافد', 'Out'), '${_totals['outOfStock'] ?? 0}', T.danger, 'out')),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: Row(children: [
                      Expanded(child: TextField(onChanged: (v) { _q = v; _load(); }, decoration: InputDecoration(hintText: tr('ابحث بالاسم/الكود/الموديل…', 'name / code / model…'), prefixIcon: const Icon(Icons.search), isDense: true))),
                      if (_statusF.isNotEmpty) Padding(padding: const EdgeInsets.only(right: 6, left: 6), child: InputChip(label: Text(_sLabel(_statusF)), onDeleted: () => setState(() => _statusF = ''))),
                    ]),
                  ),
                  if (_cats.isNotEmpty)
                    SizedBox(
                      height: 38,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
                        Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(selected: _catF.isEmpty, label: Text(tr('الكل', 'All')), onSelected: (_) => setState(() => _catF = ''), labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _catF.isEmpty ? Colors.white : T.navy), selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), side: BorderSide.none, checkmarkColor: Colors.white)),
                        ..._cats.map((c) {
                          final k = (c['key'] ?? '').toString();
                          final sel = _catF == k;
                          return Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(selected: sel, label: Text('${Lang.instance.ar ? (c['ar'] ?? k) : k} (${c['count']})'), onSelected: (_) => setState(() => _catF = sel ? '' : k), labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy), selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), side: BorderSide.none, checkmarkColor: Colors.white));
                        }),
                      ]),
                    ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: items.isEmpty
                          ? EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد أصناف', 'No items'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(12),
                              itemCount: items.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final it = items[i];
                                final st = (it['status'] ?? 'ok').toString();
                                return Pressable(
                                  onTap: () => _openItemForm(it),
                                  child: AppCard(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((it['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(_sLabel(st), _sColor(st)),
                                      ]),
                                      if ((it['categoryAr'] ?? it['category'] ?? '').toString().isNotEmpty || (it['compatibleModels'] as List?)?.isNotEmpty == true)
                                        Padding(padding: const EdgeInsets.only(top: 2), child: Text([it['categoryAr'] ?? it['category'], ...((it['compatibleModels'] as List?) ?? [])].where((x) => (x ?? '').toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                      const SizedBox(height: 8),
                                      Row(children: [
                                        Text('${tr('الرصيد', 'Qty')}: ', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                        Text('${it['quantity']} ${it['unit'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                        const SizedBox(width: 12),
                                        Text('${_money(it['unitPrice'])} × = ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                        Text(_money(it['value']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: T.success)),
                                        const Spacer(),
                                      ]),
                                      const SizedBox(height: 8),
                                      Row(children: [
                                        Expanded(child: OutlinedButton.icon(
                                          style: OutlinedButton.styleFrom(foregroundColor: T.success, side: const BorderSide(color: T.success), padding: const EdgeInsets.symmetric(vertical: 6)),
                                          icon: const Icon(Icons.south, size: 16), label: Text(tr('وارد', 'In')),
                                          onPressed: () => _openMovement(it, 'in'),
                                        )),
                                        const SizedBox(width: 8),
                                        Expanded(child: OutlinedButton.icon(
                                          style: OutlinedButton.styleFrom(foregroundColor: T.orange, side: const BorderSide(color: T.orange), padding: const EdgeInsets.symmetric(vertical: 6)),
                                          icon: const Icon(Icons.north, size: 16), label: Text(tr('صادر', 'Out')),
                                          onPressed: () => _openMovement(it, 'out'),
                                        )),
                                      ]),
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

  Widget _tile(String label, String value, Color color) => AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
  Widget _tileTap(String label, String value, Color color, String status) => Pressable(
        onTap: () => setState(() => _statusF = _statusF == status ? '' : status),
        child: _tile(label, value, color),
      );

  // ── حركة وارد/صادر ──
  Future<void> _openMovement(Map<String, dynamic> it, String type) async {
    final isIn = type == 'in';
    final qtyC = TextEditingController(text: '1');
    final plateC = TextEditingController();
    final reasonC = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => Padding(
        padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(isIn ? tr('وارد للمخزن', 'Stock in') : tr('صادر من المخزن', 'Stock out'), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: isIn ? T.success : T.orange)),
          const SizedBox(height: 2),
          Text('${it['name']} · ${tr('الرصيد', 'balance')}: ${it['quantity']} ${it['unit'] ?? ''}', style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          const SizedBox(height: 14),
          TextField(controller: qtyC, keyboardType: TextInputType.number, autofocus: true, decoration: InputDecoration(labelText: tr('الكمية', 'Quantity'))),
          const SizedBox(height: 10),
          Autocomplete<String>(
            optionsBuilder: (v) => v.text.isEmpty ? _plates : _plates.where((p) => p.contains(v.text)),
            onSelected: (s) => plateC.text = s,
            fieldViewBuilder: (ctx, tc, fn, onSubmit) {
              tc.text = plateC.text;
              return TextField(controller: tc, focusNode: fn, onChanged: (v) => plateC.text = v,
                decoration: InputDecoration(labelText: isIn ? tr('واردة من عربية (اختياري)', 'In from vehicle (optional)') : tr('صادرة على عربية', 'Out to vehicle'), prefixIcon: const Icon(Icons.local_shipping_outlined)));
            },
          ),
          const SizedBox(height: 10),
          TextField(controller: reasonC, decoration: InputDecoration(labelText: tr('ملاحظة / سبب', 'Reason'))),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: isIn ? T.success : T.orange),
            onPressed: () => Navigator.pop(c, true), child: Text(tr('تسجيل الحركة', 'Record')))),
        ]),
      ),
    );
    if (ok != true) return;
    final qty = num.tryParse(qtyC.text.trim()) ?? 0;
    if (qty <= 0) return;
    try {
      await Api.instance.post('/api/ls2/store/${it['_id']}/movement', {'type': type, 'quantity': qty, 'vehiclePlate': plateC.text.trim(), 'reason': reasonC.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التسجيل', 'Recorded'))));
      _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  // ── إضافة/تعديل صنف ──
  Future<void> _openItemForm(Map<String, dynamic>? item) async {
    final name = TextEditingController(text: item?['name']?.toString() ?? '');
    final cat = TextEditingController(text: item?['category']?.toString() ?? '');
    final qty = TextEditingController(text: item?['quantity']?.toString() ?? '0');
    final unit = TextEditingController(text: item?['unit']?.toString() ?? 'قطعة');
    final price = TextEditingController(text: item?['unitPrice']?.toString() ?? '0');
    final minQ = TextEditingController(text: item?['minQuantity']?.toString() ?? '0');
    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => Padding(
        padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(item == null ? tr('صنف جديد', 'New item') : tr('تعديل الصنف', 'Edit item'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 12),
          TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم الصنف *', 'Name *'))),
          const SizedBox(height: 10),
          TextField(controller: cat, decoration: InputDecoration(labelText: tr('التصنيف', 'Category'))),
          const SizedBox(height: 10),
          Row(children: [
            if (item == null) Expanded(child: TextField(controller: qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الرصيد', 'Qty')))),
            if (item == null) const SizedBox(width: 10),
            Expanded(child: TextField(controller: unit, decoration: InputDecoration(labelText: tr('الوحدة', 'Unit')))),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('السعر', 'Price')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: minQ, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('حد التنبيه', 'Min qty')))),
          ]),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton.icon(icon: const Icon(Icons.save_outlined, size: 18), onPressed: () => Navigator.pop(c, true), label: Text(tr('حفظ', 'Save')))),
        ])),
      ),
    );
    if (saved != true || name.text.trim().isEmpty) return;
    final body = {'name': name.text.trim(), 'category': cat.text.trim(), 'unit': unit.text.trim(), 'unitPrice': num.tryParse(price.text.trim()) ?? 0, 'minQuantity': num.tryParse(minQ.text.trim()) ?? 0, if (item == null) 'quantity': num.tryParse(qty.text.trim()) ?? 0};
    try {
      if (item == null) { await Api.instance.post('/api/ls2/store', body); }
      else { await Api.instance.put('/api/ls2/store/${item['_id']}', body); }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
      _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  // ── سجل الحركات ──
  Future<void> _openLog() async {
    List<Map<String, dynamic>> movs = [];
    try { final d = await Api.instance.get('/api/ls2/store/movements?limit=300'); movs = List<Map<String, dynamic>>.from(d['movements'] ?? []); } catch (_) {}
    if (!mounted) return;
    showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => DraggableScrollableSheet(
        expand: false, initialChildSize: 0.8, maxChildSize: 0.95,
        builder: (c2, scroll) => Column(children: [
          Padding(padding: const EdgeInsets.all(16), child: Text('${tr('سجل الحركات', 'Movement log')} (${movs.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
          Expanded(child: movs.isEmpty
              ? EmptyState(icon: Icons.history, title: tr('لا حركات', 'No movements'))
              : ListView.separated(
                  controller: scroll, padding: const EdgeInsets.symmetric(horizontal: 14),
                  itemCount: movs.length, separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (c3, i) {
                    final m = movs[i]; final isIn = m['type'] == 'in';
                    final dt = DateTime.tryParse((m['createdAt'] ?? '').toString())?.toLocal();
                    return ListTile(
                      dense: true,
                      leading: CircleAvatar(radius: 16, backgroundColor: (isIn ? T.success : T.orange).withValues(alpha: 0.12), child: Icon(isIn ? Icons.south : Icons.north, size: 15, color: isIn ? T.success : T.orange)),
                      title: Text((m['itemName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      subtitle: Text([
                        '${isIn ? '+' : '−'}${m['quantity']}',
                        if ((m['vehiclePlate'] ?? '').toString().isNotEmpty) '${tr('عربية', 'vehicle')} ${m['vehiclePlate']}',
                        if ((m['reason'] ?? '').toString().isNotEmpty) m['reason'].toString(),
                      ].join(' · '), style: const TextStyle(fontSize: 11.5)),
                      trailing: Text(dt == null ? '' : '${dt.day}/${dt.month} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    );
                  },
                )),
        ]),
      ),
    );
  }
}
