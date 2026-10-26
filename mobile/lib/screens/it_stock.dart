import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';
import 'it_common.dart';
import 'it_custody.dart';

/// مستودع تقنية المعلومات — نظيرُ /system/it/stock: فلترا النوع والحالة الفنّية
/// على الخادم، وبحثٌ في الشاشة، والمتاحُ حسب النوع (الأقلّ من ثلاث وحداتٍ بالأحمر)،
/// والإضافةُ والتعديلُ والحذف، والتسليمُ لموظّف، والتصدير.
class ItStockScreen extends StatefulWidget {
  const ItStockScreen({super.key});
  @override
  State<ItStockScreen> createState() => _ItStockScreenState();
}

// الأنواعُ المعروضة في «المتاح حسب النوع» — بلا النوع الملغى keyboard_mouse.
final _itTypes = custodyTypes.keys.where((k) => k != 'keyboard_mouse').toList();

int unitsOf(Map a) {
  final q = a['quantity'];
  final n = q is num ? q.toInt() : int.tryParse('$q') ?? 1;
  return n < 1 ? 1 : n;
}

List<ExportCol> _cols() => [
      ExportCol('الجهاز', 'Item', (r) => r['name'] ?? ''),
      ExportCol('النوع', 'Type', (r) => custodyTypeLabel(r['type'])),
      ExportCol('الرقم التسلسلي', 'Serial', (r) => r['serialNumber'] ?? ''),
      ExportCol('الماركة', 'Brand', (r) => r['brand'] ?? ''),
      ExportCol('المواصفات', 'Specs', (r) => r['specs'] ?? ''),
      ExportCol('الحالة الفنية', 'Condition', (r) => conditionLabel(r['condition'])),
      ExportCol('الكمية', 'Quantity', (r) => r['quantity'] ?? 1),
      ExportCol('القيمة للقطعة', 'Value (per unit)', (r) => r['value'] ?? 0),
    ];

class _ItStockScreenState extends State<ItStockScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: النصُّ الظاهر = الكلمةُ المرشِّحة دائمًا.
  final _searchCtl = TextEditingController();
  String _type = '';
  String _condition = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
    Live.instance.on('hr:asset', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    Live.instance.off('hr:asset', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final qs = [if (_type.isNotEmpty) 'type=$_type', if (_condition.isNotEmpty) 'condition=$_condition'].join('&');
      final d = await Api.instance.get('/api/it/stock?$qs');
      if (!mounted || my != _seq) return;
      setState(() { _items = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final s = _q.trim().toLowerCase();
    if (s.isEmpty) return _items;
    return _items.where((a) => [a['name'], a['serialNumber'], a['brand'], a['specs']].any((v) => '${v ?? ''}'.toLowerCase().contains(s))).toList();
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<void> _export() async {
    final filtered = _type.isNotEmpty || _condition.isNotEmpty || _q.trim().isNotEmpty;
    final scope = await pickExportScope(context, filtered: filtered);
    if (scope == null || !mounted) return;
    var rows = _filtered;
    if (scope == 'all' && filtered) {
      try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/it/stock'))['items'] ?? []); } catch (_) {}
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'it-stock', sheets: [('Stock', _cols(), rows)]);
  }

  Future<void> _delete(Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف هذا الصنف من المستودع؟', 'Delete this item from stock?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/it/stock/${a['_id']}'); _load(); } catch (e) { _snack(e is ApiException ? e.message : '$e'); }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final canEdit = canEditIt(context);
    final totalUnits = _items.fold<int>(0, (s, a) => s + unitsOf(a));
    final totalValue = _items.fold<num>(0, (s, a) => s + ((a['value'] as num?) ?? 0) * unitsOf(a));
    final byType = <String, int>{};
    for (final a in _items) { byType['${a['type']}'] = (byType['${a['type']}'] ?? 0) + unitsOf(a); }
    final lowTypes = _itTypes.where((t) => (byType[t] ?? 0) < 3).length;

    return AppScaffold(
      title: Text(tr('مستودع تقنية المعلومات', 'IT Stock')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () => _form(null), icon: const Icon(Icons.add), label: Text(tr('إضافة للمستودع', 'Add to stock')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                    StatGrid(
                      spacing: 8,
                      children: [
                        StatCard(label: tr('إجمالي الوحدات', 'Total units'), value: totalUnits, color: T.orange, icon: Icons.inventory_2_outlined),
                        StatCard(label: tr('عدد الأصناف', 'Line items'), value: _items.length, color: T.navy, icon: Icons.list_alt),
                        StatCard(label: tr('أنواع شبه منتهية', 'Low-stock types'), value: lowTypes, color: lowTypes > 0 ? T.danger : T.success, icon: Icons.warning_amber_rounded),
                        StatCard(label: tr('قيمة المستودع', 'Stock value'), value: totalValue, color: T.navy, icon: Icons.payments_outlined),
                      ],
                    ),
                    const SizedBox(height: 10),
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('المتاح حسب النوع', 'Available by type'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
                      const SizedBox(height: 8),
                      Wrap(spacing: 6, runSpacing: 6, children: _itTypes.map((k) {
                        final n = byType[k] ?? 0;
                        return Chip2('${custodyTypeLabel(k)}  $n', n < 3 ? T.danger : T.navy);
                      }).toList()),
                    ])),
                    const SizedBox(height: 10),
                    SearchField(
                      controller: _searchCtl, dense: true,
                      onChanged: (v) => setState(() => _q = v),
                      hint: tr('بحث بالجهاز أو الرقم التسلسلي أو الماركة...', 'Search item, serial or brand...'),
                    ),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(child: ItFilterDropdown(label: tr('النوع', 'Type'), value: _type,
                          options: {for (final k in _itTypes) k: custodyTypes[k]!}, allAr: 'كل الأنواع', allEn: 'All types',
                          onChanged: (v) { setState(() => _type = v); _load(); })),
                      const SizedBox(width: 8),
                      Expanded(child: ItFilterDropdown(label: tr('الحالة الفنية', 'Condition'), value: _condition,
                          options: custodyConditions, allAr: 'كل الحالات الفنية', allEn: 'All conditions',
                          onChanged: (v) { setState(() => _condition = v); _load(); })),
                    ]),
                    const SizedBox(height: 10),
                    if (rows.isEmpty) EmptyState(icon: _q.trim().isNotEmpty ? Icons.search_off : Icons.inventory_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث.', 'No matches.') : tr('المستودع فارغ.', 'No items in stock.')),
                    for (final a in rows) Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text('${a['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                          Text('× ${unitsOf(a)}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
                        ]),
                        if ('${a['specs'] ?? ''}'.isNotEmpty) Text('${a['specs']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          Chip2(custodyTypeLabel(a['type']), T.navy),
                          if ('${a['serialNumber'] ?? ''}'.isNotEmpty) Chip2('${a['serialNumber']}', T.inkFaint, icon: Icons.qr_code_2),
                          if ('${a['condition'] ?? ''}'.isNotEmpty) Chip2(conditionLabel(a['condition']), T.cyan),
                          if (a['value'] is num && (a['value'] as num) > 0) Chip2(fmtMoney(a['value']), T.success),
                        ]),
                        if (canEdit) Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                          TextButton.icon(onPressed: () => _assign(a), icon: const Icon(Icons.person_add_alt_1, size: 16), label: Text(tr('تسليم', 'Assign'))),
                          IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 19), onPressed: () => _form(a)),
                          IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 19, color: T.danger), onPressed: () => _delete(a)),
                        ]),
                      ])),
                    ),
                  ]),
                ),
    );
  }

  // ── إضافة / تعديل — الاسمُ مشتقٌّ من النوع والماركة ──
  Future<void> _form(Map<String, dynamic>? editing) async {
    String type = '${editing?['type'] ?? 'laptop'}';
    String condition = '${editing?['condition'] ?? 'new'}';
    final brand = TextEditingController(text: '${editing?['brand'] ?? ''}');
    final serial = TextEditingController(text: '${editing?['serialNumber'] ?? ''}');
    final specs = TextEditingController(text: '${editing?['specs'] ?? ''}');
    final notes = TextEditingController(text: '${editing?['notes'] ?? ''}');
    final qty = TextEditingController(text: '${editing?['quantity'] ?? 1}');
    final value = TextEditingController(text: '${editing?['value'] ?? 0}');
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(editing == null ? tr('إضافة صنف للمستودع', 'Add item to stock') : tr('تعديل صنف المستودع', 'Edit stock item'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: bucketOf(type),
            decoration: InputDecoration(labelText: tr('النوع', 'Type'), isDense: true),
            items: custodyBuckets.map((b) => DropdownMenuItem(value: b.key, child: Text(b.label))).toList(),
            onChanged: (v) => setS(() => type = custodyBuckets.firstWhere((x) => x.key == v, orElse: () => custodyBuckets.last).canonicalType),
          ),
          if (bucketOf(type) == 'other') ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: otherBucketTypes.contains(type) ? type : 'other',
              decoration: InputDecoration(labelText: tr('أي نوع من «أخرى»؟', 'Which kind of "Other"?'), isDense: true),
              items: otherBucketTypes.map((t) => DropdownMenuItem(value: t, child: Text(custodyTypeLabel(t)))).toList(),
              onChanged: (v) => setS(() => type = v ?? type),
            ),
          ],
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: TextField(controller: brand, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('الماركة', 'Brand'), hintText: tr('مثال: Dell', 'e.g. Dell')))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: serial, decoration: InputDecoration(labelText: tr('الرقم التسلسلي', 'Serial number')))),
          ]),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.line.withValues(alpha: 0.30), borderRadius: BorderRadius.circular(10)),
            child: Row(children: [
              Text(tr('سيُسجَّل باسم', 'Will be recorded as'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              const SizedBox(width: 8),
              Expanded(child: Text(deriveAssetName(type, brand.text), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800))),
            ]),
          ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: custodyConditions.containsKey(condition) ? condition : null,
              decoration: InputDecoration(labelText: tr('الحالة الفنية', 'Condition'), isDense: true),
              items: custodyConditions.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (v) => setS(() => condition = v ?? condition),
            )),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الكمية', 'Quantity')))),
          ]),
          const SizedBox(height: 10),
          // القيمةُ للقطعة الواحدة صراحةً — لا تُقرأ على الوجهين.
          TextField(controller: value, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('القيمة للقطعة الواحدة', 'Value per single unit'))),
          const SizedBox(height: 10),
          TextField(controller: specs, decoration: InputDecoration(labelText: tr('المواصفات', 'Specs'), hintText: 'i7 / 16GB / 512GB SSD')),
          const SizedBox(height: 10),
          TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          const SizedBox(height: 14),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ])),
      ))),
    );
    if (ok != true) return;
    final body = {
      'type': type, 'condition': condition, 'brand': brand.text.trim(), 'serialNumber': serial.text.trim(),
      'specs': specs.text.trim(), 'notes': notes.text.trim(),
      'quantity': int.tryParse(qty.text.trim()) ?? 1, 'value': num.tryParse(value.text.trim()) ?? 0,
    };
    try {
      if (editing == null) { await Api.instance.post('/api/it/stock', body); }
      else { await Api.instance.put('/api/it/stock/${editing['_id']}', body); }
      _load();
    } catch (e) { _snack(e is ApiException ? e.message : '$e'); }
  }

  // ── تسليمٌ لموظّف — بلا حالةٍ فنّية: الصنفُ يحملها من المستودع ──
  Future<void> _assign(Map<String, dynamic> a) async {
    final emp = await pickItEmployee(context);
    if (emp == null || !mounted) return;
    String date = todayYmd();
    final notes = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
      title: Text(tr('تسليم لموظف', 'Assign to employee')),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('تسليم «${a['name']}»${'${a['serialNumber'] ?? ''}'.isEmpty ? '' : ' (${a['serialNumber']})'} من المستودع إلى ${itEmpName(emp)}',
                'Handing over "${a['name']}"${'${a['serialNumber'] ?? ''}'.isEmpty ? '' : ' (${a['serialNumber']})'} from stock to ${itEmpName(emp)}'),
            style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
        const SizedBox(height: 10),
        ItDateField(label: tr('تاريخ التسليم', 'Handover date'), value: date, onChanged: (v) => setS(() => date = v)),
        const SizedBox(height: 8),
        TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        const SizedBox(height: 8),
        Text(tr('سيظهر هذا الجهاز فوراً ضمن عهد الموظف في ملفه بالموارد البشرية، ولن يمكن إنهاء عقده قبل استرجاعه.',
                'This device will appear on the employee\'s HR profile immediately, and their contract cannot be terminated until it is returned.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد التسليم', 'Confirm handover'))),
      ],
    )));
    if (ok != true) return;
    try {
      await Api.instance.post('/api/it/stock/${a['_id']}/assign', {'employee': emp['_id'], 'assignedDate': date, 'notes': notes.text});
      _snack(tr('سُلِّم إلى ${itEmpName(emp)}', 'Assigned to ${itEmpName(emp)}'));
      _load();
    } catch (e) { _snack(e is ApiException ? e.message : '$e'); }
  }
}
