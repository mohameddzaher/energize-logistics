import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Heavy-transport maintenance records (periodic / preventive / roadside / accident), the store parts editor they share,
/// and the maintenance analytics screen. Mirrors the web components under components/ls2 and the page /system/ls2/maintenance-analytics.

/// Minimum deferral for a checklist task marked deferred; the server enforces the same (config/ls2Config MIN_DEFER_KM).
const int kMinDeferKm = 10000;

const kMaintTypes = <(String, String, String, Color)>[
  ('periodic', 'الصيانة الدورية', 'Periodic', Color(0xFF059669)),
  ('preventive', 'الصيانة الوقائية', 'Preventive', Color(0xFF2563EB)),
  ('roadside', 'الصيانة على الطريق', 'Roadside', Color(0xFFD97706)),
  ('accident', 'الحوادث', 'Accidents', Color(0xFFBE123C)),
];
String maintTypeLabel(String key) {
  for (final t in kMaintTypes) {
    if (t.$1 == key) return tr(t.$2, t.$3);
  }
  return key;
}

Color maintTypeColor(String key) => kMaintTypes.firstWhere((t) => t.$1 == key, orElse: () => kMaintTypes.first).$4;

String _money(dynamic v) {
  final n = v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
  final s = n.round().toString();
  return s.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .toLowerCase();

String _today() => DateTime.now().toUtc().add(const Duration(hours: 3)).toIso8601String().substring(0, 10);

/// One picked part: the store item and the typed quantity.
class PartLine {
  final Map<String, dynamic> item;
  final TextEditingController qty;
  PartLine(this.item) : qty = TextEditingController(text: '1');
  num get quantity => num.tryParse(qty.text.trim()) ?? 0;
  num get left => (item['quantity'] as num?) ?? 0;
  num get price => (item['unitPrice'] as num?) ?? 0;
}

/// Problem with the picked parts, or null when every line is within its balance.
String? partsProblem(List<PartLine> lines) {
  for (final l in lines) {
    if (l.quantity <= 0) return tr('اكتب كمية «${l.item['name']}»', 'Enter the quantity of ${l.item['name']}');
    if (l.quantity > l.left) return tr('«${l.item['name']}»: المتبقّي ${l.left} فقط', '${l.item['name']}: only ${l.left} left');
  }
  return null;
}

/// Parts from the heavy store: a search sheet lists only items in the store (out-of-stock ones disabled),
/// each line shows the remaining balance and refuses more than it.
class StorePartsEditor extends StatefulWidget {
  final List<PartLine> lines;
  final VoidCallback onChanged;
  const StorePartsEditor({super.key, required this.lines, required this.onChanged});
  @override
  State<StorePartsEditor> createState() => _StorePartsEditorState();
}

class _StorePartsEditorState extends State<StorePartsEditor> {
  List<Map<String, dynamic>> _items = [];
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:store', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/store');
      if (!mounted) return;
      final items = _l(d['items']);
      final byId = {for (final i in items) '${i['_id']}': i};
      // Balances follow the store while the form is open.
      for (final l in widget.lines) {
        final fresh = byId['${l.item['_id']}'];
        if (fresh != null) l.item.addAll(fresh);
      }
      setState(() => _items = items);
      widget.onChanged();
    } catch (_) {/* keep */}
  }

  Future<void> _add() async {
    final chosen = widget.lines.map((l) => '${l.item['_id']}').toSet();
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) => _ItemSearchSheet(items: _items.where((i) => !chosen.contains('${i['_id']}')).toList()),
    );
    if (picked == null) return;
    setState(() => widget.lines.add(PartLine(Map<String, dynamic>.from(picked))));
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.lines.fold<num>(0, (a, l) => a + l.quantity * l.price);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < widget.lines.length; i++)
        Builder(builder: (_) {
          final l = widget.lines[i];
          final bad = l.quantity <= 0 || l.quantity > l.left;
          return Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${l.item['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  Text('${tr('المتبقّي', 'Left')}: ${l.left} ${l.item['unit'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                ]),
              ),
              SizedBox(
                width: 72,
                child: TextField(
                  controller: l.qty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  textAlign: TextAlign.center,
                  onChanged: (_) { setState(() {}); widget.onChanged(); },
                  decoration: InputDecoration(isDense: true, labelText: tr('الكمية', 'Qty'), errorText: bad ? '!' : null),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 19, color: T.danger),
                onPressed: () { setState(() => widget.lines.removeAt(i)); widget.onChanged(); },
              ),
            ]),
          );
        }),
      if (widget.lines.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text('${tr('قيمة قطع الغيار', 'Parts value')}: ${_money(total)} ${tr('ر.س', 'SAR')}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        ),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: OutlinedButton.icon(
          onPressed: _add,
          icon: const Icon(Icons.add, size: 17),
          label: Text(tr('إضافة قطعة من المخزن', 'Add part from store')),
        ),
      ),
    ]);
  }
}

class _ItemSearchSheet extends StatefulWidget {
  final List<Map<String, dynamic>> items;
  const _ItemSearchSheet({required this.items});
  @override
  State<_ItemSearchSheet> createState() => _ItemSearchSheetState();
}

class _ItemSearchSheetState extends State<_ItemSearchSheet> {
  final _q = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final t = _fold(_q.text.trim());
    final rows = widget.items
        .where((i) => t.isEmpty || [i['name'], i['code'], i['categoryAr']].any((x) => _fold('${x ?? ''}').contains(t)))
        .toList()
      ..sort((a, b) => ((b['quantity'] ?? 0) > 0 ? 1 : 0) - ((a['quantity'] ?? 0) > 0 ? 1 : 0));
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(14, 14, 14, MediaQuery.of(context).viewInsets.bottom + 10),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: Column(children: [
            TextField(
              controller: _q,
              autofocus: true,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('ابحث عن صنف في مخزن النقل الثقيل…', 'Search the heavy store…')),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: rows.isEmpty
                  ? Center(child: Text(tr('لا يوجد صنف مطابق في المخزن', 'No matching item in the store'), style: const TextStyle(color: T.inkFaint)))
                  : ListView.builder(
                      itemCount: rows.length,
                      itemBuilder: (_, i) {
                        final it = rows[i];
                        final left = (it['quantity'] as num?) ?? 0;
                        final empty = left <= 0;
                        return ListTile(
                          dense: true,
                          enabled: !empty,
                          title: Text('${it['name']}'),
                          subtitle: Text([it['code'], it['categoryAr']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                          trailing: Text(empty ? tr('نفد', 'Out') : '$left ${it['unit'] ?? ''}',
                              style: TextStyle(fontWeight: FontWeight.w800, color: empty ? T.danger : T.success)),
                          onTap: empty ? null : () => Navigator.pop(context, it),
                        );
                      },
                    ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// New preventive / roadside / accident record.
class MaintenanceRecordSheet extends StatefulWidget {
  final int unitId;
  final String type;
  final num? odometer;
  const MaintenanceRecordSheet({super.key, required this.unitId, required this.type, this.odometer});
  @override
  State<MaintenanceRecordSheet> createState() => _MaintenanceRecordSheetState();
}

class _MaintenanceRecordSheetState extends State<MaintenanceRecordSheet> {
  late final _date = TextEditingController(text: _today());
  late final _odo = TextEditingController(text: widget.odometer != null ? '${widget.odometer!.round()}' : '');
  final _title = TextEditingController();
  final _location = TextEditingController();
  final _labour = TextEditingController();
  final _towing = TextEditingController();
  final _notes = TextEditingController();
  final List<PartLine> _parts = [];
  bool _saving = false;

  Future<void> _save() async {
    final problem = partsProblem(_parts);
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/ls2/maintenance/records', {
        'unitId': widget.unitId,
        'type': widget.type,
        'date': _date.text.trim(),
        if (_odo.text.trim().isNotEmpty) 'odometerKm': num.tryParse(_odo.text.trim()),
        if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
        if (_location.text.trim().isNotEmpty) 'location': _location.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        'labourCost': num.tryParse(_labour.text.trim()) ?? 0,
        'towingCost': num.tryParse(_towing.text.trim()) ?? 0,
        'parts': [for (final p in _parts) {'item': p.item['_id'], 'quantity': p.quantity}],
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      final lines = _l(e.data['errors']).map((x) => x['message']).join(' · ');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text([e.message, lines].where((x) => x.isNotEmpty).join(' — '))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date.text) ?? now, firstDate: DateTime(now.year - 3), lastDate: now);
    if (d != null) setState(() => _date.text = d.toIso8601String().substring(0, 10));
  }

  @override
  Widget build(BuildContext context) {
    final preventive = widget.type == 'preventive';
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('${tr('تسجيل', 'New')} ${maintTypeLabel(widget.type)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: _date, readOnly: true, onTap: _pickDate, decoration: InputDecoration(labelText: tr('التاريخ *', 'Date *')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _odo, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('العداد (كم)', 'Odometer (km)')))),
            ]),
            const SizedBox(height: 8),
            TextField(controller: _title, decoration: InputDecoration(labelText: preventive ? tr('وصف العمل', 'Work description') : widget.type == 'accident' ? tr('وصف الحادث', 'Accident description') : tr('وصف العطل', 'Fault description'))),
            if (!preventive) ...[
              const SizedBox(height: 8),
              TextField(controller: _location, decoration: InputDecoration(labelText: tr('الموقع', 'Location'))),
            ],
            const SizedBox(height: 14),
            Text(tr('قطع الغيار من المخزن', 'Spare parts from the store'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 6),
            StorePartsEditor(lines: _parts, onChanged: () => setState(() {})),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: _labour, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('تكلفة العمالة (اختياري)', 'Labour cost (optional)')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _towing, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('تكلفة السحب (اختياري)', 'Towing cost (optional)')))),
            ]),
            const SizedBox(height: 8),
            TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _saving || partsProblem(_parts) != null ? null : _save,
              child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(tr('حفظ', 'Save')),
            ),
          ]),
        ),
      ),
    );
  }
}

/// One record card: costs split, parts and work lines, cancel action.
class MaintenanceRecordCard extends StatelessWidget {
  final Map<String, dynamic> r;
  final VoidCallback onCancel;
  const MaintenanceRecordCard({super.key, required this.r, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final cancelled = r['status'] == 'cancelled';
    final parts = _l(r['parts']);
    final work = _l(r['work']);
    final title = '${r['intervalName'] ?? ''}'.isNotEmpty ? '${r['intervalName']}' : ('${r['title'] ?? ''}'.isNotEmpty ? '${r['title']}' : tr('بدون وصف', 'No description'));
    return Opacity(
      opacity: cancelled ? 0.55 : 1,
      child: AppCard(
        topAccent: maintTypeColor('${r['type']}'),
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(title, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, decoration: cancelled ? TextDecoration.lineThrough : null))),
            Text('${_money(r['totalCost'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          ]),
          Text(
            [r['date'], if (r['odometerKm'] != null) '${_money(r['odometerKm'])} ${tr('كم', 'km')}', r['location'], if ('${r['issueRequestNo'] ?? ''}'.isNotEmpty) '${tr('طلب صرف', 'Issue')} ${r['issueRequestNo']}', r['createdByName']]
                .where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
            style: const TextStyle(fontSize: 11, color: T.inkSoft),
          ),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('قطع', 'Parts')} ${_money(r['partsCost'])}', const Color(0xFF0369A1), icon: Icons.inventory_2_outlined),
            Chip2('${tr('عمالة', 'Labour')} ${_money(r['labourCost'])}', const Color(0xFF7C3AED), icon: Icons.handyman_outlined),
            if (((r['towingCost'] as num?) ?? 0) > 0) Chip2('${tr('سحب', 'Towing')} ${_money(r['towingCost'])}', const Color(0xFFD97706), icon: Icons.local_shipping_outlined),
          ]),
          if (parts.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(parts.map((p) => '${p['itemName']} × ${p['quantity']}').join('، '), style: const TextStyle(fontSize: 11.5)),
          ],
          if (work.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(work.map((w) => '${w['label']}${w['cost'] != null ? ' (${_money(w['cost'])})' : ''}').join('، '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ],
          if ('${r['notes'] ?? ''}'.isNotEmpty) Text('${r['notes']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          if (cancelled)
            Text('${tr('ملغى', 'Cancelled')}: ${r['cancelReason'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.danger, fontWeight: FontWeight.w700))
          else
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: onCancel,
                icon: const Icon(Icons.block, size: 15, color: T.danger),
                label: Text(tr('إلغاء السجل', 'Cancel record'), style: const TextStyle(fontSize: 12, color: T.danger)),
              ),
            ),
        ]),
      ),
    );
  }
}

/// Asks for a reason and cancels a record; its parts return to the store.
Future<bool> cancelMaintenanceRecord(BuildContext context, Map<String, dynamic> r) async {
  final reason = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(tr('إلغاء سجل الصيانة', 'Cancel maintenance record')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tr('تعود قطع الغيار إلى المخزن ويبقى السجل ظاهرًا كملغى.', 'Parts return to the store and the record stays as cancelled.'), style: const TextStyle(fontSize: 12.5)),
        TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب *', 'Reason *'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع', 'Back'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إلغاء السجل', 'Cancel record'))),
      ],
    ),
  );
  if (ok != true || reason.text.trim().length < 3) return false;
  try {
    await Api.instance.post('/api/ls2/maintenance/records/${r['_id']}/cancel', {'reason': reason.text.trim()});
    return true;
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    return false;
  }
}

/// Maintenance analytics: totals split, per type, vehicle ranking, tyre consumption, trend.
class Ls2MaintenanceAnalyticsScreen extends StatefulWidget {
  const Ls2MaintenanceAnalyticsScreen({super.key});
  @override
  State<Ls2MaintenanceAnalyticsScreen> createState() => _Ls2MaintenanceAnalyticsScreenState();
}

class _Ls2MaintenanceAnalyticsScreenState extends State<Ls2MaintenanceAnalyticsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  int _days = 180;
  String _type = '';
  String _unit = '';
  int _seq = 0;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // The poller's pulse carries `vehicles`; only real writes reload.
    _onLive = (d) { if (d is! Map || d['vehicles'] == null) _load(); };
    Live.instance.onData('ls2:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('ls2:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final now = DateTime.now();
    final from = now.subtract(Duration(days: _days - 1)).toIso8601String().substring(0, 10);
    final qs = 'from=$from&to=${_today()}${_type.isNotEmpty ? '&type=$_type' : ''}${_unit.isNotEmpty ? '&unitId=$_unit' : ''}';
    try {
      final d = await Api.instance.get('/api/ls2/maintenance/analytics?$qs');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Widget _bar(String label, num value, num max, Color color, {String? trailing}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))),
            Text(trailing ?? _money(value), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 3),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: max > 0 ? (value / max).clamp(0, 1).toDouble() : 0, minHeight: 7, color: color, backgroundColor: T.line.withValues(alpha: 0.4)),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final totals = Map<String, dynamic>.from(d?['totals'] ?? {});
    final byType = _l(d?['byType']);
    final byVehicle = _l(d?['byVehicle']);
    final trend = _l(d?['trend']);
    final tires = Map<String, dynamic>.from(d?['tires'] ?? {});
    final vehicles = _l(d?['vehicles']);
    final topParts = _l(d?['topParts']);
    final total = (totals['total'] as num?) ?? 0;
    final maxType = byType.fold<num>(0, (a, b) => (b['total'] as num) > a ? b['total'] as num : a);
    final maxVeh = byVehicle.isEmpty ? 0 : byVehicle.first['total'] as num;
    final maxTrend = trend.fold<num>(0, (a, b) => (b['total'] as num) > a ? b['total'] as num : a);

    return AppScaffold(
      title: Text(tr('تحليلات الصيانة', 'Maintenance analytics')),
      body: d == null && _error == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null && d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // Filters in one row.
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      DropdownButton<int>(
                        value: _days,
                        items: [30, 90, 180, 365].map((n) => DropdownMenuItem(value: n, child: Text(tr('آخر $n يوم', 'Last $n days')))).toList(),
                        onChanged: (v) { setState(() => _days = v ?? 180); _load(); },
                      ),
                      DropdownButton<String>(
                        value: _type,
                        items: [
                          DropdownMenuItem(value: '', child: Text(tr('كل الأنواع', 'All types'))),
                          ...kMaintTypes.map((t) => DropdownMenuItem(value: t.$1, child: Text(tr(t.$2, t.$3)))),
                        ],
                        onChanged: (v) { setState(() => _type = v ?? ''); _load(); },
                      ),
                      DropdownButton<String>(
                        value: _unit,
                        items: [
                          DropdownMenuItem(value: '', child: Text(tr('كل المركبات', 'All vehicles'))),
                          ...vehicles.map((v) => DropdownMenuItem(value: '${v['unitId']}', child: Text('${v['plate']}'))),
                        ],
                        onChanged: (v) { setState(() => _unit = v ?? ''); _load(); },
                      ),
                    ]),
                    const SizedBox(height: 10),
                    AppCard(
                      topAccent: T.orange,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('إجمالي تكلفة الصيانة', 'Total maintenance cost'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                        Text('${_money(total)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                        Text('${totals['count'] ?? 0} ${tr('سجل', 'records')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        const SizedBox(height: 10),
                        _bar(tr('قطع الغيار', 'Spare parts'), (totals['parts'] as num?) ?? 0, total, const Color(0xFF0369A1)),
                        _bar(tr('العمالة', 'Labour'), (totals['labour'] as num?) ?? 0, total, const Color(0xFF7C3AED)),
                        _bar(tr('السحب', 'Towing'), (totals['towing'] as num?) ?? 0, total, const Color(0xFFD97706)),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('التكلفة حسب نوع الصيانة', 'Cost by type'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        ...byType.map((b) => _bar('${maintTypeLabel('${b['type']}')} (${b['count']})', b['total'] as num, maxType, maintTypeColor('${b['type']}'))),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(d?['granularity'] == 'day' ? tr('الاتجاه اليومي', 'Daily trend') : tr('الاتجاه الشهري', 'Monthly trend'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        if (trend.isEmpty) Text(tr('لا توجد سجلات في هذه الفترة', 'No records in this period'), style: const TextStyle(color: T.inkFaint)),
                        ...trend.map((t) => _bar('${t['bucket']}', t['total'] as num, maxTrend, T.navy)),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('ترتيب المركبات حسب التكلفة', 'Vehicles ranked by cost'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        if (byVehicle.isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
                        ...byVehicle.take(15).map((v) => _bar('${v['plate']} (${v['count']})', v['total'] as num, maxVeh, T.orange)),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('استهلاك الكاوتشات', 'Tyre consumption'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          Chip2('${tr('من المخزن', 'From store')}: ${tires['storeQty'] ?? 0}', T.info),
                          Chip2('${tr('قيمتها', 'Value')}: ${_money(tires['storeCost'])}', T.info),
                          Chip2('${tr('مركّبة', 'Fitted')}: ${tires['fitted'] ?? 0}', T.success),
                          Chip2('${tr('تالفة', 'Scrapped')}: ${tires['scrapped'] ?? 0}', T.danger),
                        ]),
                        const SizedBox(height: 6),
                        ..._l(tires['byVehicle']).take(20).map((t) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(children: [
                                Expanded(child: Text('${t['plate']}', style: const TextStyle(fontSize: 12))),
                                Text('${tr('مخزن', 'Store')} ${t['storeQty']} · ${tr('مركّبة', 'Fitted')} ${t['fitted']} · ${tr('تالفة', 'Scrapped')} ${t['scrapped']}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                              ]),
                            )),
                      ]),
                    ),
                    if (topParts.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('قطع الغيار الأكثر استهلاكًا', 'Most consumed parts'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          ...topParts.take(15).map((p) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 3),
                                child: Row(children: [
                                  Expanded(child: Text('${p['name']}', style: const TextStyle(fontSize: 12))),
                                  Text('${p['quantity']} ${p['unit'] ?? ''} · ${_money(p['cost'])}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                                ]),
                              )),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
