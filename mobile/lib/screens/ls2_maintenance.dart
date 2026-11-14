import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/export_sheet.dart';

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

// Maintenance ledger entries (GET /api/ls2/maintenance/entries): records plus older service logs, repairs and store
// issues, each counted once on the server. Cancelled records arrive only with includeCancelled and are never summed.

const kMaintIcons = <String, IconData>{
  'periodic': Icons.event_repeat_outlined,
  'preventive': Icons.health_and_safety_outlined,
  'roadside': Icons.car_repair_outlined,
  'accident': Icons.car_crash_outlined,
};

num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

String _price(dynamic v) {
  final n = _n(v);
  final whole = n.truncate();
  final frac = (n - whole).abs();
  final s = _money(whole);
  return frac < 0.005 ? s : '$s.${(frac * 100).round().toString().padLeft(2, '0')}';
}

/// Badge for entries that come from an older source rather than a maintenance record.
(String, Color)? _sourceBadge(String source) => switch (source) {
      'service_log' => (tr('سجل خدمة سابق', 'Earlier service log'), T.inkFaint),
      'repair' => (tr('إصلاح سابق', 'Earlier repair'), T.violet),
      'store_issue' => (tr('صرف مخزن', 'Store issue'), T.cyan),
      _ => null,
    };

/// Count, last date and total per type, non-cancelled entries only.
Map<String, (int, String, num)> maintenanceTypeSummary(List<Map<String, dynamic>> entries) {
  final out = <String, (int, String, num)>{};
  for (final t in kMaintTypes) {
    final rows = entries.where((e) => e['type'] == t.$1 && e['cancelled'] != true);
    var last = '';
    num total = 0;
    for (final e in rows) {
      final d = '${e['date'] ?? ''}';
      if (d.compareTo(last) > 0) last = d;
      total += _n(e['totalCost']);
    }
    out[t.$1] = (rows.length, last, total);
  }
  return out;
}

Future<List<Map<String, dynamic>>> loadMaintenanceEntries({int? unitId, String from = '', String to = '', String type = '', bool includeCancelled = false}) async {
  final qs = [
    if (unitId != null) 'unitId=$unitId',
    if (from.isNotEmpty) 'from=$from',
    if (to.isNotEmpty) 'to=$to',
    if (type.isNotEmpty) 'type=$type',
    if (includeCancelled) 'includeCancelled=1',
  ].join('&');
  final d = await Api.instance.get('/api/ls2/maintenance/entries?$qs');
  return _l(d['entries']);
}

/// One large type tile: icon, name, entry count, last date, total cost.
class MaintenanceTypeTile extends StatelessWidget {
  final String type;
  final (int, String, num) summary;
  final bool open;
  final VoidCallback onTap;
  const MaintenanceTypeTile({super.key, required this.type, required this.summary, required this.open, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = maintTypeColor(type);
    final (count, last, total) = summary;
    return Pressable(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: open ? color.withValues(alpha: 0.08) : T.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: open ? color : T.line, width: open ? 2 : 1),
          boxShadow: T.softShadow,
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(10)),
              child: Icon(kMaintIcons[type], size: 20, color: color),
            ),
            const Spacer(),
            Icon(open ? Icons.expand_less : Icons.expand_more, color: T.inkFaint),
          ]),
          const SizedBox(height: 8),
          Text(maintTypeLabel(type), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: T.ink)),
          const SizedBox(height: 2),
          Text('${_money(total)} ${tr('ر.س', 'SAR')}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: color)),
          Text('$count ${tr('سجل', 'entries')} · ${last.isEmpty ? tr('لا يوجد', 'none') : last}',
              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

/// 2x2 grid of the four type tiles (one row of four on wide screens).
class MaintenanceTypeGrid extends StatelessWidget {
  final Map<String, (int, String, num)> summary;
  final Set<String> open;
  final void Function(String) onToggle;
  const MaintenanceTypeGrid({super.key, required this.summary, required this.open, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (c, box) {
      final cols = box.maxWidth >= 720 ? 4 : 2;
      final w = (box.maxWidth - (cols - 1) * 10) / cols;
      return Wrap(spacing: 10, runSpacing: 10, children: [
        for (final t in kMaintTypes)
          SizedBox(width: w, child: MaintenanceTypeTile(type: t.$1, summary: summary[t.$1] ?? (0, '', 0), open: open.contains(t.$1), onTap: () => onToggle(t.$1))),
      ]);
    });
  }
}

/// One ledger entry in full: what was done, parts with quantity × unit price, work lines, cost split, who and notes.
class MaintenanceEntryCard extends StatelessWidget {
  final Map<String, dynamic> e;
  final VoidCallback? onCancel;
  const MaintenanceEntryCard({super.key, required this.e, this.onCancel});

  @override
  Widget build(BuildContext context) {
    final cancelled = e['cancelled'] == true;
    final parts = _l(e['parts']);
    final work = _l(e['work']);
    final checklist = _l(e['checklist']);
    final badge = _sourceBadge('${e['source']}');
    final title = '${e['title'] ?? ''}'.isNotEmpty ? '${e['title']}' : tr('بدون وصف', 'No description');
    final meta = [
      e['date'],
      if (e['odometerKm'] != null) '${_money(e['odometerKm'])} ${tr('كم', 'km')}',
      e['location'],
      if ('${e['ref'] ?? ''}'.isNotEmpty && '${e['source']}' == 'record') '${tr('طلب صرف', 'Issue')} ${e['ref']}',
      e['issueReasonAr'],
    ].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ');
    return Opacity(
      opacity: cancelled ? 0.55 : 1,
      child: AppCard(
        topAccent: maintTypeColor('${e['type']}'),
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Text(title, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, decoration: cancelled ? TextDecoration.lineThrough : null))),
            const SizedBox(width: 8),
            Text('${_price(e['totalCost'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5)),
          ]),
          const SizedBox(height: 2),
          Text(meta, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          if (badge != null) ...[const SizedBox(height: 5), Chip2(badge.$1, badge.$2, icon: Icons.history)],
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (_n(e['partsCost']) > 0) Chip2('${tr('قطع', 'Parts')} ${_price(e['partsCost'])}', const Color(0xFF0369A1), icon: Icons.inventory_2_outlined),
            if (_n(e['labourCost']) > 0) Chip2('${tr('عمالة', 'Labour')} ${_price(e['labourCost'])}', const Color(0xFF7C3AED), icon: Icons.handyman_outlined),
            if (_n(e['towingCost']) > 0) Chip2('${tr('سحب', 'Towing')} ${_price(e['towingCost'])}', const Color(0xFFD97706), icon: Icons.local_shipping_outlined),
            if (_n(e['unsplitCost']) > 0) Chip2('${tr('تكلفة غير مفصّلة', 'Unitemised')} ${_price(e['unsplitCost'])}', T.inkFaint, icon: Icons.receipt_long_outlined),
          ]),
          if (parts.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(tr('قطع الغيار', 'Spare parts'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
            for (final p in parts)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Row(children: [
                  Expanded(child: Text('${p['name']}${p['isTire'] == true ? ' (${tr('كاوتش', 'tyre')})' : ''}', style: const TextStyle(fontSize: 12))),
                  Text('${_price(p['quantity'])} ${p['unit'] ?? ''} × ${_price(p['unitPrice'])} = ${_price(p['total'])}',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ]),
              ),
          ],
          if (work.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(tr('أعمال الفني', 'Technician work'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
            for (final w in work)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Row(children: [
                  Expanded(child: Text('${w['label']}${'${w['note'] ?? ''}'.isNotEmpty ? ' — ${w['note']}' : ''}', style: const TextStyle(fontSize: 12))),
                  if (w['cost'] != null) Text(_price(w['cost']), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ]),
              ),
          ],
          if (checklist.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(tr('قائمة الفحص', 'Checklist'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
            const SizedBox(height: 4),
            Wrap(spacing: 5, runSpacing: 5, children: [
              for (final c in checklist)
                Chip2(
                  '${c['label']}${c['status'] == 'deferred' && c['deferKm'] != null ? ' +${_money(c['deferKm'])} ${tr('كم', 'km')}' : ''}${c['status'] == 'deferred' && c['resolved'] == true ? ' · ${tr('أُنجز', 'done')}' : ''}',
                  c['status'] == 'done' ? T.success : c['status'] == 'deferred' ? T.warn : T.inkFaint,
                  icon: c['status'] == 'done' ? Icons.check_circle_outline : c['status'] == 'deferred' ? Icons.schedule : Icons.remove_circle_outline,
                ),
            ]),
          ],
          if ('${e['notes'] ?? ''}'.isNotEmpty) ...[const SizedBox(height: 6), Text('${e['notes']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint))],
          if ('${e['by'] ?? ''}'.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('${tr('سجّله', 'Recorded by')}: ${e['by']}', style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
          ],
          if (cancelled)
            Text('${tr('ملغى', 'Cancelled')}: ${e['cancelReason'] ?? ''}${'${e['cancelledByName'] ?? ''}'.isNotEmpty ? ' — ${e['cancelledByName']}' : ''}',
                style: const TextStyle(fontSize: 11, color: T.danger, fontWeight: FontWeight.w700))
          else if (onCancel != null && e['source'] == 'record')
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

/// Asks for a reason and cancels a record entry; its parts return to the store.
Future<bool> cancelMaintenanceRecord(BuildContext context, Map<String, dynamic> e) async {
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
    await Api.instance.post('/api/ls2/maintenance/records/${e['id'] ?? e['_id']}/cancel', {'reason': reason.text.trim()});
    return true;
  } catch (err) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
    return false;
  }
}

/// One vehicle's entries for a period, opened from the analytics ranking.
class _VehicleEntriesSheet extends StatelessWidget {
  final String plate;
  final List<Map<String, dynamic>> entries;
  const _VehicleEntriesSheet({required this.plate, required this.entries});

  @override
  Widget build(BuildContext context) {
    final total = entries.fold<num>(0, (a, e) => a + _n(e['totalCost']));
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(children: [
              Expanded(child: Text('$plate · ${entries.length} ${tr('سجل', 'entries')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
              Text('${_price(total)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: T.orange)),
            ]),
          ),
          const Divider(height: 1),
          Expanded(
            child: entries.isEmpty
                ? EmptyState(icon: Icons.build_outlined, title: tr('لا توجد سجلات في هذه الفترة', 'No entries in this period'))
                : ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: entries.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => MaintenanceEntryCard(e: entries[i]),
                  ),
          ),
        ]),
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final Color color;
  const _Kpi(this.label, this.value, this.icon, this.color, {this.sub});

  @override
  Widget build(BuildContext context) => AppCard(
        padding: const EdgeInsets.all(11),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 5),
            Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w700))),
          ]),
          const SizedBox(height: 4),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: T.ink)),
          if (sub != null) Text(sub!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        ]),
      );
}

class _Block extends StatelessWidget {
  final String title;
  final Widget child;
  final VoidCallback? onExport;
  const _Block(this.title, this.child, {this.onExport});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14))),
              if (onExport != null)
                IconButton(
                  visualDensity: VisualDensity.compact, tooltip: tr('تصدير Excel', 'Export Excel'),
                  onPressed: onExport, icon: const Icon(Icons.file_download_outlined, size: 20, color: T.success),
                ),
            ]),
            const SizedBox(height: 6),
            child,
          ]),
        ),
      );
}

/// Horizontal stacked bar of the four types for one trend bucket.
class _StackBar extends StatelessWidget {
  final Map<String, dynamic> row;
  final num max;
  const _StackBar(this.row, this.max);

  @override
  Widget build(BuildContext context) {
    final total = _n(row['total']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(children: [
        SizedBox(width: 62, child: Text('${row['bucket']}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
        Expanded(
          child: LayoutBuilder(builder: (c, box) {
            final width = max > 0 ? box.maxWidth * (total / max) : 0.0;
            return Align(
              alignment: AlignmentDirectional.centerStart,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox(
                  width: width.toDouble(), height: 12,
                  child: Row(children: [
                    for (final t in kMaintTypes)
                      if (_n(row[t.$1]) > 0) Expanded(flex: (_n(row[t.$1]) * 1000 / (total == 0 ? 1 : total)).round().clamp(1, 1000000), child: Container(color: t.$4)),
                  ]),
                ),
              ),
            );
          }),
        ),
        SizedBox(width: 70, child: Text(_money(total), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800))),
      ]),
    );
  }
}

/// Maintenance analytics on the ledger: every number is a sum of entries the drill-down lists.
class Ls2MaintenanceAnalyticsScreen extends StatefulWidget {
  const Ls2MaintenanceAnalyticsScreen({super.key});
  @override
  State<Ls2MaintenanceAnalyticsScreen> createState() => _Ls2MaintenanceAnalyticsScreenState();
}

class _Ls2MaintenanceAnalyticsScreenState extends State<Ls2MaintenanceAnalyticsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _preset = '180';
  late String _from = _daysBack(180);
  late String _to = _today();
  String _type = '';
  String _unit = '';
  int _seq = 0;
  late final void Function(dynamic) _onLive;
  late final void Function() _onStore;

  static String _daysBack(int n) => DateTime.now().toUtc().add(const Duration(hours: 3)).subtract(Duration(days: n - 1)).toIso8601String().substring(0, 10);

  @override
  void initState() {
    super.initState();
    _load();
    // The poller's pulse carries `vehicles`; only real writes reload.
    _onLive = (d) { if (d is! Map || d['vehicles'] == null) _load(); };
    _onStore = () => _load();
    Live.instance.onData('ls2:updated', _onLive);
    Live.instance.on('ls2:store', _onStore);
  }

  @override
  void dispose() {
    Live.instance.offData('ls2:updated', _onLive);
    Live.instance.off('ls2:store', _onStore);
    super.dispose();
  }

  String get _qs => 'from=$_from&to=$_to${_type.isNotEmpty ? '&type=$_type' : ''}${_unit.isNotEmpty ? '&unitId=$_unit' : ''}';

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/ls2/maintenance/analytics?$_qs');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Future<void> _setPreset(String p) async {
    if (p == 'custom') {
      final now = DateTime.now();
      final r = await showDateRangePicker(
        context: context, firstDate: DateTime(now.year - 5), lastDate: now,
        initialDateRange: DateTimeRange(start: DateTime.tryParse(_from) ?? now, end: DateTime.tryParse(_to) ?? now),
      );
      if (r == null) return;
      setState(() { _preset = 'custom'; _from = r.start.toIso8601String().substring(0, 10); _to = r.end.toIso8601String().substring(0, 10); });
    } else if (p == 'year') {
      setState(() { _preset = p; _from = '${_today().substring(0, 4)}-01-01'; _to = _today(); });
    } else {
      setState(() { _preset = p; _from = _daysBack(int.parse(p)); _to = _today(); });
    }
    _load();
  }

  Future<void> _openVehicle(Map<String, dynamic> v) async {
    List<Map<String, dynamic>> entries = [];
    try {
      entries = await loadMaintenanceEntries(unitId: (v['unitId'] as num).toInt(), from: _from, to: _to, type: _type);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet(context: context, isScrollControlled: true, builder: (_) => _VehicleEntriesSheet(plate: '${v['plate']}', entries: entries));
  }

  void _export(String name, List<ExportCol> cols, List<Map<String, dynamic>> rows) =>
      exportExcel(context, fileName: 'ls2-maintenance-$name-$_from-$_to', sheets: [(name, cols, rows)]);

  Widget _bar(String label, num value, num max, Color color, {String? trailing, VoidCallback? onTap}) {
    final body = Padding(
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
    return onTap == null ? body : InkWell(onTap: onTap, child: body);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final totals = Map<String, dynamic>.from(d?['totals'] ?? {});
    final byType = _l(d?['byType']);
    final byVehicle = _l(d?['byVehicle']);
    final trend = _l(d?['trend']);
    final tires = Map<String, dynamic>.from(d?['tires'] ?? {});
    final services = Map<String, dynamic>.from(d?['services'] ?? {});
    final unmatched = Map<String, dynamic>.from(d?['unmatchedIssues'] ?? {});
    final vehicles = _l(d?['vehicles']);
    final byCost = _l(d?['topPartsByCost']);
    final byQty = _l(d?['topPartsByQty']);
    final total = _n(totals['total']);
    final sar = tr('ر.س', 'SAR');
    final maxType = byType.fold<num>(0, (a, b) => _n(b['total']) > a ? _n(b['total']) : a);
    final maxVeh = byVehicle.isEmpty ? 0 : _n(byVehicle.first['total']);
    final maxTrend = trend.fold<num>(0, (a, b) => _n(b['total']) > a ? _n(b['total']) : a);
    final presets = [('30', tr('30 يومًا', '30 days')), ('90', tr('90 يومًا', '90 days')), ('180', tr('180 يومًا', '180 days')), ('365', tr('سنة', '1 year')), ('year', tr('هذه السنة', 'This year')), ('custom', tr('فترة مخصّصة', 'Custom'))];
    String? share(num v) => total > 0 ? '${(v * 100 / total).round()}% ${tr('من الإجمالي', 'of total')}' : null;

    return AppScaffold(
      title: Text(tr('تحليلات الصيانة', 'Maintenance analytics')),
      body: d == null && _error == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null && d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final p in presets)
                          Padding(
                            padding: const EdgeInsetsDirectional.only(end: 6),
                            child: ChoiceChip(label: Text(p.$2), selected: _preset == p.$1, onSelected: (_) => _setPreset(p.$1)),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 4),
                    Text('$_from → $_to', style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
                    Row(children: [
                      Expanded(
                        child: DropdownButton<String>(
                          isExpanded: true, value: _type,
                          items: [
                            DropdownMenuItem(value: '', child: Text(tr('كل الأنواع', 'All types'))),
                            ...kMaintTypes.map((t) => DropdownMenuItem(value: t.$1, child: Text(tr(t.$2, t.$3)))),
                          ],
                          onChanged: (v) { setState(() => _type = v ?? ''); _load(); },
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: DropdownButton<String>(
                          isExpanded: true, value: vehicles.any((v) => '${v['unitId']}' == _unit) ? _unit : '',
                          items: [
                            DropdownMenuItem(value: '', child: Text(tr('كل المركبات', 'All vehicles'))),
                            ...vehicles.map((v) => DropdownMenuItem(value: '${v['unitId']}', child: Text('${v['plate']}', overflow: TextOverflow.ellipsis))),
                          ],
                          onChanged: (v) { setState(() => _unit = v ?? ''); _load(); },
                        ),
                      ),
                    ]),
                    const SizedBox(height: 6),
                    LayoutBuilder(builder: (c, box) {
                      final cols = box.maxWidth >= 600 ? 3 : 2;
                      final w = (box.maxWidth - (cols - 1) * 8) / cols;
                      final kpis = [
                        _Kpi(tr('إجمالي تكلفة الصيانة', 'Total maintenance cost'), '${_money(total)} $sar', Icons.account_balance_wallet_outlined, T.orange, sub: '${totals['count'] ?? 0} ${tr('سجل', 'entries')}'),
                        _Kpi(tr('قطع الغيار', 'Spare parts'), _money(totals['parts']), Icons.inventory_2_outlined, const Color(0xFF0369A1), sub: share(_n(totals['parts']))),
                        _Kpi(tr('العمالة', 'Labour'), _money(totals['labour']), Icons.handyman_outlined, const Color(0xFF7C3AED), sub: share(_n(totals['labour']))),
                        _Kpi(tr('السحب', 'Towing'), _money(totals['towing']), Icons.local_shipping_outlined, const Color(0xFFD97706), sub: share(_n(totals['towing']))),
                        _Kpi(tr('تكلفة غير مفصّلة', 'Unitemised'), _money(totals['unsplit']), Icons.receipt_long_outlined, T.inkFaint, sub: tr('سجلات سابقة بمبلغ واحد', 'Older entries with one amount')),
                        _Kpi(tr('المركبات التي صينت', 'Vehicles serviced'), '${totals['vehicles'] ?? 0}', Icons.local_shipping, T.navy, sub: '${tr('المتوسط لكل مركبة', 'Avg per vehicle')} ${_money(totals['avgPerVehicle'])}'),
                        _Kpi(tr('التكلفة لكل 1,000 كم', 'Cost per 1,000 km'), totals['costPer1000Km'] == null ? '—' : _money(totals['costPer1000Km']), Icons.speed, T.cyan,
                            sub: '${_money(totals['km'])} ${tr('كم', 'km')} · ${totals['kmVehicles'] ?? 0} ${tr('مركبة لها عداد', 'vehicles with odometer')}'),
                        _Kpi(tr('صيانات دورية متأخرة', 'Overdue services'), '${services['overdue'] ?? 0}', Icons.error_outline, T.danger, sub: '${services['vehiclesOverdue'] ?? 0} ${tr('مركبة', 'vehicles')}'),
                        _Kpi(tr('صيانات دورية قريبة', 'Services due soon'), '${services['due'] ?? 0}', Icons.schedule, T.warn, sub: '${services['vehiclesDue'] ?? 0} ${tr('مركبة', 'vehicles')}'),
                      ];
                      return Wrap(spacing: 8, runSpacing: 8, children: [for (final k in kpis) SizedBox(width: w, child: k)]);
                    }),
                    _Block(
                      tr('التكلفة حسب نوع الصيانة', 'Cost by maintenance type'),
                      Column(children: [
                        for (final b in byType)
                          _bar('${maintTypeLabel('${b['type']}')} (${b['count']})', _n(b['total']), maxType, maintTypeColor('${b['type']}'),
                              trailing: '${_money(b['total'])}${'${b['lastDate'] ?? ''}'.isNotEmpty ? ' · ${b['lastDate']}' : ''}'),
                      ]),
                      onExport: () => _export('by-type', [
                        ExportCol('النوع', 'Type', (r) => maintTypeLabel('${r['type']}')),
                        ExportCol('عدد السجلات', 'Entries', (r) => r['count']),
                        ExportCol('قطع الغيار', 'Parts', (r) => r['parts']),
                        ExportCol('العمالة', 'Labour', (r) => r['labour']),
                        ExportCol('السحب', 'Towing', (r) => r['towing']),
                        ExportCol('غير مفصّلة', 'Unitemised', (r) => r['unsplit']),
                        ExportCol('الإجمالي', 'Total', (r) => r['total']),
                        ExportCol('آخر تاريخ', 'Last date', (r) => r['lastDate']),
                      ], byType),
                    ),
                    _Block(
                      d?['granularity'] == 'day' ? tr('الاتجاه اليومي حسب النوع', 'Daily trend by type') : tr('الاتجاه الشهري حسب النوع', 'Monthly trend by type'),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Wrap(spacing: 10, runSpacing: 4, children: [
                          for (final t in kMaintTypes)
                            Row(mainAxisSize: MainAxisSize.min, children: [
                              Container(width: 10, height: 10, decoration: BoxDecoration(color: t.$4, borderRadius: BorderRadius.circular(2))),
                              const SizedBox(width: 4),
                              Text(tr(t.$2, t.$3), style: const TextStyle(fontSize: 11)),
                            ]),
                        ]),
                        const SizedBox(height: 8),
                        if (maxTrend == 0) Text(tr('لا توجد تكاليف في هذه الفترة', 'No cost in this period'), style: const TextStyle(color: T.inkFaint)),
                        if (maxTrend > 0) ...trend.map((t) => _StackBar(t, maxTrend)),
                      ]),
                      onExport: () => _export('trend', [
                        ExportCol('الفترة', 'Period', (r) => r['bucket']),
                        for (final t in kMaintTypes) ExportCol(t.$2, t.$3, (r) => r[t.$1]),
                        ExportCol('عدد السجلات', 'Entries', (r) => r['count']),
                        ExportCol('الإجمالي', 'Total', (r) => r['total']),
                      ], trend),
                    ),
                    _Block(
                      tr('ترتيب المركبات حسب التكلفة', 'Vehicles ranked by cost'),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('اضغط على المركبة لعرض سجلاتها في الفترة.', 'Tap a vehicle to see its entries in the period.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        if (byVehicle.isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
                        ...byVehicle.take(30).map((v) => _bar(
                              '${v['plate']} · ${v['count']} ${tr('سجل', 'entries')}${v['costPer1000Km'] != null ? ' · ${_money(v['costPer1000Km'])}/${tr('1000 كم', '1000 km')}' : ''}',
                              _n(v['total']), maxVeh, T.orange, onTap: () => _openVehicle(v))),
                      ]),
                      onExport: () => _export('by-vehicle', [
                        ExportCol('اللوحة', 'Plate', (r) => r['plate']),
                        ExportCol('السائق', 'Driver', (r) => r['driver']),
                        ExportCol('عدد السجلات', 'Entries', (r) => r['count']),
                        for (final t in kMaintTypes) ExportCol(t.$2, t.$3, (r) => (r['byType'] ?? {})[t.$1]),
                        ExportCol('قطع الغيار', 'Parts', (r) => r['parts']),
                        ExportCol('العمالة', 'Labour', (r) => r['labour']),
                        ExportCol('السحب', 'Towing', (r) => r['towing']),
                        ExportCol('غير مفصّلة', 'Unitemised', (r) => r['unsplit']),
                        ExportCol('الإجمالي', 'Total', (r) => r['total']),
                        ExportCol('المسافة (كم)', 'Distance (km)', (r) => r['km']),
                        ExportCol('التكلفة لكل 1000 كم', 'Cost per 1000 km', (r) => r['costPer1000Km']),
                        ExportCol('مرات لكل 10,000 كم', 'Visits per 10,000 km', (r) => r['per10kKm']),
                        ExportCol('متوسط الأيام بين الزيارات', 'Avg days between visits', (r) => r['avgDaysBetween']),
                        ExportCol('آخر تاريخ', 'Last date', (r) => r['lastDate']),
                      ], byVehicle),
                    ),
                    _Block(
                      tr('تكرار الصيانة لكل مركبة', 'Maintenance frequency per vehicle'),
                      Column(children: [
                        if (byVehicle.isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
                        for (final v in [...byVehicle]..sort((a, b) => _n(b['count']).compareTo(_n(a['count']))))
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [
                              Expanded(child: Text('${v['plate']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))),
                              Text(
                                '${v['count']} ${tr('سجل', 'entries')}'
                                '${v['avgDaysBetween'] != null ? ' · ${tr('كل', 'every')} ${_price(v['avgDaysBetween'])} ${tr('يوم', 'days')}' : ''}'
                                '${v['per10kKm'] != null ? ' · ${_price(v['per10kKm'])}/${tr('10,000 كم', '10,000 km')}' : ''}',
                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                              ),
                            ]),
                          ),
                      ]),
                    ),
                    _Block(
                      tr('قطع الغيار الأعلى تكلفة', 'Top parts by cost'),
                      Column(children: [
                        if (byCost.isEmpty) Text(tr('لا توجد قطع مصروفة في هذه الفترة', 'No parts issued in this period'), style: const TextStyle(color: T.inkFaint)),
                        for (final p in byCost.take(15))
                          _bar('${p['name']}${p['isTire'] == true ? ' (${tr('كاوتش', 'tyre')})' : ''}', _n(p['cost']), byCost.isEmpty ? 0 : _n(byCost.first['cost']), const Color(0xFF0369A1),
                              trailing: '${_price(p['quantity'])} ${p['unit'] ?? ''} · ${_money(p['cost'])}'),
                      ]),
                      onExport: () => _export('parts-by-cost', _partCols, byCost),
                    ),
                    _Block(
                      tr('قطع الغيار الأكثر كمية', 'Top parts by quantity'),
                      Column(children: [
                        if (byQty.isEmpty) Text(tr('لا توجد قطع مصروفة في هذه الفترة', 'No parts issued in this period'), style: const TextStyle(color: T.inkFaint)),
                        for (final p in byQty.take(15))
                          _bar('${p['name']}', _n(p['quantity']), byQty.isEmpty ? 0 : _n(byQty.first['quantity']), T.cyan,
                              trailing: '${_price(p['quantity'])} ${p['unit'] ?? ''} · ${_money(p['cost'])}'),
                      ]),
                      onExport: () => _export('parts-by-qty', _partCols, byQty),
                    ),
                    _Block(
                      tr('استهلاك الكاوتشات لكل مركبة', 'Tyre consumption per vehicle'),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          Chip2('${tr('مصروفة من المخزن', 'Issued from store')}: ${tires['storeQty'] ?? 0} · ${_money(tires['storeCost'])} $sar', T.info),
                          Chip2('${tr('مركّبة', 'Fitted')}: ${tires['fitted'] ?? 0}', T.success),
                          Chip2('${tr('منزلة', 'Removed')}: ${tires['removed'] ?? 0}', T.warn),
                          Chip2('${tr('تالفة/سكراب', 'Scrapped')}: ${tires['scrapped'] ?? 0}', T.danger),
                        ]),
                        const SizedBox(height: 6),
                        if (_l(tires['byVehicle']).isEmpty) Text(tr('لا يوجد استهلاك في هذه الفترة', 'No consumption in this period'), style: const TextStyle(color: T.inkFaint)),
                        ..._l(tires['byVehicle']).take(30).map((t) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(children: [
                                Expanded(child: Text('${t['plate']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))),
                                Text('${tr('مخزن', 'Store')} ${t['storeQty']} · ${tr('مركّبة', 'Fitted')} ${t['fitted']} · ${tr('منزلة', 'Removed')} ${t['removed']} · ${tr('تالفة', 'Scrap')} ${t['scrapped']}',
                                    style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                              ]),
                            )),
                      ]),
                      onExport: () => _export('tyres', [
                        ExportCol('اللوحة', 'Plate', (r) => r['plate']),
                        ExportCol('مصروفة من المخزن', 'Issued from store', (r) => r['storeQty']),
                        ExportCol('قيمتها', 'Value', (r) => r['storeCost']),
                        ExportCol('مركّبة', 'Fitted', (r) => r['fitted']),
                        ExportCol('منزلة', 'Removed', (r) => r['removed']),
                        ExportCol('تالفة/سكراب', 'Scrapped', (r) => r['scrapped']),
                      ], _l(tires['byVehicle'])),
                    ),
                    _Block(
                      tr('الصيانات الدورية المتأخرة والقريبة', 'Periodic services overdue and due'),
                      Column(children: [
                        if (_l(services['rows']).isEmpty) Text(tr('لا توجد صيانات مستحقة', 'No services due'), style: const TextStyle(color: T.inkFaint)),
                        ..._l(services['rows']).take(40).map((s) {
                          final over = s['status'] == 'overdue';
                          final rem = _n(s['remaining']);
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [
                              Expanded(child: Text('${s['plate']} · ${s['service']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))),
                              Chip2(over ? '${tr('متأخرة', 'Overdue')} ${_money(rem.abs())} ${s['unit']}' : '${tr('باقي', 'Left')} ${_money(rem)} ${s['unit']}', over ? T.danger : T.warn),
                            ]),
                          );
                        }),
                      ]),
                      onExport: () => _export('services-due', [
                        ExportCol('اللوحة', 'Plate', (r) => r['plate']),
                        ExportCol('الخدمة', 'Service', (r) => r['service']),
                        ExportCol('الحالة', 'Status', (r) => r['status'] == 'overdue' ? tr('متأخرة', 'Overdue') : tr('قريبة', 'Due')),
                        ExportCol('المتبقي', 'Remaining', (r) => r['remaining']),
                        ExportCol('الوحدة', 'Unit', (r) => r['unit']),
                        ExportCol('آخر صيانة', 'Last service', (r) => '${r['lastServiceAt'] ?? ''}'.length >= 10 ? '${r['lastServiceAt']}'.substring(0, 10) : ''),
                        ExportCol('عداد آخر صيانة', 'Last service km', (r) => r['lastServiceKm']),
                      ], _l(services['rows'])),
                    ),
                    if (_n(unmatched['count']) > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          tr('صرف من المخزن إلى لوحات ليست ضمن الأسطول (غير محسوب أعلاه): ${unmatched['count']} سطر بقيمة ${_money(unmatched['cost'])} ر.س.',
                              'Store issues to plates outside the fleet (not counted above): ${unmatched['count']} lines worth ${_money(unmatched['cost'])} SAR.'),
                          style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                        ),
                      ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}

final _partCols = [
  ExportCol('الصنف', 'Item', (r) => r['name']),
  ExportCol('الكود', 'Code', (r) => r['code']),
  ExportCol('الكمية', 'Quantity', (r) => r['quantity']),
  ExportCol('الوحدة', 'Unit', (r) => r['unit']),
  ExportCol('التكلفة', 'Cost', (r) => r['cost']),
  ExportCol('عدد السجلات', 'Entries', (r) => r['entries']),
  ExportCol('عدد المركبات', 'Vehicles', (r) => r['vehicles']),
  ExportCol('كاوتش', 'Tyre', (r) => r['isTire'] == true),
];
