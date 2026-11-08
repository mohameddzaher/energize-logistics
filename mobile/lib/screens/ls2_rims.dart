import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import '../ui/hr_quick.dart';
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_common.dart';

/// Rims tab of the fleet assets screen: counted stock per brand/size/condition with an immutable ledger.
/// Same endpoints and rules as the web RimsPanel; a recorded movement is reversed, never edited.
class Ls2RimsTab extends StatefulWidget {
  final bool admin;
  final List<String> plates;
  const Ls2RimsTab({super.key, required this.admin, required this.plates});
  @override
  State<Ls2RimsTab> createState() => Ls2RimsTabState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

const _cond = {
  'new': ('جديد', 'New', T.cyan),
  'used': ('مستعمل', 'Used', T.info),
  'scrap': ('سكراب', 'Scrap', T.inkFaint),
};
String _today() => DateTime.now().toUtc().add(const Duration(hours: 3)).toIso8601String().substring(0, 10);
String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').replaceAll(RegExp(r'\s+'), ' ').toLowerCase().trim();

class Ls2RimsTabState extends State<Ls2RimsTab> with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>> _rims = [];
  Map<String, dynamic> _totals = {};
  List<Map<String, dynamic>> _inReasons = [];
  List<Map<String, dynamic>> _outReasons = [];
  List<Map<String, dynamic>> _issueReasons = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _filter = '';
  final _qCtl = TextEditingController();
  late final void Function(dynamic) _onLive;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    // The telemetry poller's pulse carries `vehicles`; only registry writes reload.
    _onLive = (p) { if (p is Map && p.containsKey('vehicles')) return; _load(); };
    Live.instance.onData('ls2:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('ls2:updated', _onLive);
    _qCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/assets/rims');
      if (!mounted) return;
      final reasons = d['reasons'] is Map ? Map<String, dynamic>.from(d['reasons']) : <String, dynamic>{};
      setState(() {
        _rims = _l(d['rims']);
        _totals = d['totals'] is Map ? Map<String, dynamic>.from(d['totals']) : {};
        _inReasons = _l(reasons['in']);
        _outReasons = _l(reasons['out']);
        _issueReasons = _l(reasons['issue']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _toast(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  List<Map<String, dynamic>> get _shown {
    final q = _fold(_q);
    return _rims.where((r) {
      if (_filter == 'low' && r['status'] == 'ok') return false;
      if (_filter.isNotEmpty && _filter != 'low' && r['condition'] != _filter) return false;
      if (q.isEmpty) return true;
      return [r['name'], r['brand'], r['size'], r['notes']].any((x) => _fold('${x ?? ''}').contains(q));
    }).toList();
  }

  static List<ExportCol> get rimExportCols => [
        ExportCol('الصنف', 'Rim', (r) => r['name'] ?? ''),
        ExportCol('النوع', 'Brand', (r) => r['brand'] ?? ''),
        ExportCol('المقاس', 'Size', (r) => r['size'] ?? ''),
        ExportCol('الحالة', 'Condition', (r) { final c = _cond[r['condition']]; return c == null ? '' : tr(c.$1, c.$2); }),
        ExportCol('الرصيد', 'Quantity', (r) => r['quantity'] ?? 0),
        ExportCol('سعر القطعة', 'Unit price', (r) => r['unitPrice'] ?? 0),
        ExportCol('القيمة', 'Value', (r) => r['value'] ?? 0),
        ExportCol('حد التنبيه', 'Alert at', (r) => r['minQuantity'] ?? 0),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ];
  static List<ExportCol> get _moveCols => [
        ExportCol('التاريخ', 'Date', (r) => r['date'] ?? ''),
        ExportCol('الصنف', 'Rim', (r) => r['rimName'] ?? ''),
        ExportCol('الحركة', 'Movement', (r) => r['type'] == 'in' ? tr('وارد', 'In') : r['type'] == 'out' ? tr('صادر', 'Out') : tr('تعديل', 'Edit')),
        ExportCol('السبب', 'Reason', (r) => tr('${r['reasonAr'] ?? ''}', '${r['reasonEn'] ?? ''}')),
        ExportCol('العدد', 'Qty', (r) => r['quantity'] ?? 0),
        ExportCol('الرصيد بعدها', 'Balance after', (r) => r['balanceAfter'] ?? 0),
        ExportCol('المركبة', 'Vehicle', (r) => r['vehiclePlate'] ?? ''),
        ExportCol('سبب الصرف', 'Issue reason', (r) => r['issueReasonLabel'] ?? ''),
        ExportCol('من / إلى صنف', 'Other rim', (r) => r['counterpartName'] ?? ''),
        ExportCol('المورد', 'Supplier', (r) => r['supplierName'] ?? ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
        ExportCol('تم التراجع', 'Reversed', (r) => r['reversed'] == true ? '${tr('نعم', 'Yes')} — ${r['reversalReason'] ?? ''}' : ''),
        ExportCol('بواسطة', 'By', (r) => r['performedByName'] ?? ''),
      ];

  /// Called by the parent screen's export button while this tab is open.
  Future<void> exportExcel() async {
    List<Map<String, dynamic>> moves = const [];
    try { moves = _l((await Api.instance.get('/api/ls2/assets/rims/movements?limit=5000'))['movements']); } catch (_) {}
    if (!mounted) return;
    await ls2ExportMenu(context, fileName: 'ls2-rims', options: [
      ('الجنوط المعروضة (بعد الفلتر)', 'Shown rims (filtered)', [(tr('الجنوط', 'Rims'), rimExportCols, _shown)]),
      ('كل الجنوط + سجل الحركات', 'All rims + movement log', [
        (tr('الجنوط', 'Rims'), rimExportCols, _rims),
        (tr('حركات الجنوط', 'Rim movements'), _moveCols, moves),
      ]),
    ]);
  }

  Future<void> _openSheet(Widget child) async {
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => child,
    );
    if (ok == true) { _toast(tr('تم التسجيل', 'Recorded')); _load(); }
  }

  Future<void> _hide(Map<String, dynamic> r) async {
    final go = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(((r['quantity'] as num?) ?? 0) > 0
          ? tr('حذف «${r['name']}» من القائمة؟ سيُلغى رصيده (${r['quantity']}) الذي أُضيف به. يبقى سجله محفوظًا.', 'Remove ${r['name']}? Its opening ${r['quantity']} is reversed. Its log is kept.')
          : tr('حذف «${r['name']}» من القائمة؟ يبقى سجله محفوظًا.', 'Remove ${r['name']}? Its log is kept.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Remove'))),
      ],
    ));
    if (go != true) return;
    try { await Api.instance.delete('/api/ls2/assets/rims/${r['_id']}'); _load(); }
    catch (e) { _toast(e is ApiException ? e.message : e.toString()); }
  }

  void _actions(Map<String, dynamic> r) {
    final qty = (r['quantity'] as num?)?.toInt() ?? 0;
    showModalBottomSheet(context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(title: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w900)), subtitle: Text(tr('الرصيد $qty', 'On hand $qty'))),
        if (widget.admin) ...[
          ListTile(leading: const Icon(Icons.add_circle_outline, color: T.success), title: Text(tr('وارد', 'In')),
              onTap: () { Navigator.pop(c); _openSheet(_MovementSheet(rim: r, type: 'in', reasons: _inReasons, issueReasons: _issueReasons, plates: widget.plates)); }),
          if (qty > 0) ListTile(leading: const Icon(Icons.remove_circle_outline, color: T.warn), title: Text(tr('صادر', 'Out')),
              onTap: () { Navigator.pop(c); _openSheet(_MovementSheet(rim: r, type: 'out', reasons: _outReasons, issueReasons: _issueReasons, plates: widget.plates)); }),
          if (qty > 0 && _rims.length > 1) ListTile(leading: const Icon(Icons.swap_horiz, color: T.info), title: Text(tr('تحويل إلى صنف آخر', 'Transfer to another type')),
              onTap: () { Navigator.pop(c); _openSheet(_TransferSheet(rim: r, rims: _rims)); }),
          ListTile(leading: const Icon(Icons.edit_outlined), title: Text(tr('تعديل', 'Edit')),
              onTap: () { Navigator.pop(c); _openSheet(_RimFormSheet(rim: r)); }),
        ],
        ListTile(leading: const Icon(Icons.history), title: Text(tr('سجل الحركات', 'Movement log')),
            onTap: () { Navigator.pop(c); _openLog(r); }),
        if (widget.admin && (qty == 0 || r['deletable'] == true)) ListTile(leading: const Icon(Icons.delete_outline, color: T.danger), title: Text(tr('حذف من القائمة', 'Remove')),
            onTap: () { Navigator.pop(c); _hide(r); }),
      ])),
    );
  }

  Future<void> _openLog(Map<String, dynamic>? rim) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => _RimLogScreen(rim: rim, admin: widget.admin)));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final byCond = _totals['byCondition'] is Map ? Map<String, dynamic>.from(_totals['byCondition']) : <String, dynamic>{};
    final shown = _shown;
    final chips = <(String, String, Color)>[
      ('', tr('الكل', 'All'), T.navy),
      ('new', tr('جديد', 'New'), T.cyan),
      ('used', tr('مستعمل', 'Used'), T.info),
      ('scrap', tr('سكراب', 'Scrap'), T.inkFaint),
      ('low', tr('ناقص أو نفد', 'Low or out'), T.danger),
    ];
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          for (final c in chips)
            Padding(padding: const EdgeInsets.only(left: 6), child: FilterChip(
              selected: _filter == c.$1,
              onSelected: (_) => setState(() => _filter = _filter == c.$1 ? '' : c.$1),
              label: Text(c.$2),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _filter == c.$1 ? Colors.white : c.$3),
              selectedColor: c.$3, backgroundColor: c.$3.withValues(alpha: 0.1), checkmarkColor: Colors.white, side: BorderSide.none,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            )),
        ])),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
        child: SearchField(controller: _qCtl, hint: tr('ابحث بالنوع أو المقاس…', 'Search brand or size…'), suffixText: '${shown.length}', onChanged: (v) => setState(() => _q = v)),
      ),
      Expanded(child: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      Chip2('${tr('كل الجنوط', 'All rims')}: ${_totals['units'] ?? 0}', T.navy),
                      Chip2('${tr('جديد', 'New')}: ${byCond['new'] ?? 0}', T.cyan),
                      Chip2('${tr('مستعمل', 'Used')}: ${byCond['used'] ?? 0}', T.info),
                      Chip2('${tr('سكراب', 'Scrap')}: ${byCond['scrap'] ?? 0}', T.inkFaint),
                      Chip2('${tr('القيمة', 'Value')}: ${_totals['value'] ?? 0}', T.success),
                    ]),
                    const SizedBox(height: 8),
                    Row(children: [
                      if (widget.admin) FilledButton.tonalIcon(
                        onPressed: () => _openSheet(const _RimFormSheet(rim: null)),
                        icon: const Icon(Icons.add, size: 18), label: Text(tr('إضافة صنف جنوط', 'Add rim type'))),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(onPressed: () => _openLog(null), icon: const Icon(Icons.history, size: 18), label: Text(tr('سجل الحركات', 'Movements'))),
                    ]),
                    if (widget.admin) ...[
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.orange),
                          onPressed: () => _openSheet(_VehicleMoveSheet(type: 'out', rims: _rims, issueReasons: _issueReasons, plates: widget.plates)),
                          icon: const Icon(Icons.local_shipping_outlined, size: 18), label: Text(tr('صادر على مركبة', 'Issue to vehicle')))),
                        const SizedBox(width: 8),
                        Expanded(child: OutlinedButton.icon(
                          onPressed: () => _openSheet(_VehicleMoveSheet(type: 'in', rims: _rims, issueReasons: _issueReasons, plates: widget.plates)),
                          icon: const Icon(Icons.assignment_return_outlined, size: 18), label: Text(tr('وارد من مركبة', 'Return from vehicle')))),
                      ]),
                    ],
                    const SizedBox(height: 10),
                    if (shown.isEmpty) EmptyState(icon: Icons.album_outlined, title: tr('لا توجد جنوط مطابقة', 'No matching rims')),
                    for (final r in shown) Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Pressable(onTap: () => _actions(r), child: AppCard(
                        topAccent: (_cond[r['condition']] ?? _cond['new']!).$3,
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const SizedBox(height: 5),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              if (_cond[r['condition']] != null) Chip2(tr(_cond[r['condition']]!.$1, _cond[r['condition']]!.$2), _cond[r['condition']]!.$3),
                              if ((r['unitPrice'] ?? 0) != 0) Chip2('${r['unitPrice']} ${tr('ريال', 'SAR')}', T.inkFaint),
                              if ((r['minQuantity'] ?? 0) != 0) Chip2('${tr('التنبيه عند', 'Alert at')} ${r['minQuantity']}', T.warn),
                              if ('${r['notes'] ?? ''}'.isNotEmpty) Chip2('${r['notes']}', T.inkFaint),
                            ]),
                          ])),
                          Text('${r['quantity'] ?? 0}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900,
                              color: r['status'] == 'out' ? T.danger : r['status'] == 'low' ? T.warn : T.ink)),
                        ]),
                      )),
                    ),
                  ]),
                )),
    ]);
  }
}

Widget _err(String m) => Padding(padding: const EdgeInsets.only(top: 8), child: Text(m, style: const TextStyle(color: T.danger, fontSize: 12.5, fontWeight: FontWeight.w700)));

Widget _sheet(BuildContext c, String title, List<Widget> children) => Padding(
  padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
  child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
    const SizedBox(height: 12),
    ...children,
  ])),
);

/// Add or edit a rim type; the quantity is set only when adding.
class _RimFormSheet extends StatefulWidget {
  final Map<String, dynamic>? rim;
  const _RimFormSheet({required this.rim});
  @override
  State<_RimFormSheet> createState() => _RimFormSheetState();
}

class _RimFormSheetState extends State<_RimFormSheet> {
  late final _brand = TextEditingController(text: '${widget.rim?['brand'] ?? ''}');
  late final _size = TextEditingController(text: '${widget.rim?['size'] ?? ''}');
  late String _condition = '${widget.rim?['condition'] ?? 'new'}';
  final _qty = TextEditingController();
  late final _price = TextEditingController(text: (widget.rim?['unitPrice'] ?? 0) == 0 ? '' : '${widget.rim?['unitPrice']}');
  late final _min = TextEditingController(text: (widget.rim?['minQuantity'] ?? 0) == 0 ? '' : '${widget.rim?['minQuantity']}');
  final _supplier = TextEditingController();
  late final _notes = TextEditingController(text: '${widget.rim?['notes'] ?? ''}');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_brand, _size, _qty, _price, _min, _supplier, _notes]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() { _busy = true; _error = null; });
    final body = <String, dynamic>{
      'brand': _brand.text.trim(), 'size': _size.text.trim(), 'condition': _condition,
      'unitPrice': num.tryParse(_price.text.trim()) ?? 0, 'minQuantity': int.tryParse(_min.text.trim()) ?? 0, 'notes': _notes.text.trim(),
    };
    try {
      if (widget.rim != null) {
        await Api.instance.patch('/api/ls2/assets/rims/${widget.rim!['_id']}', body);
      } else {
        await Api.instance.post('/api/ls2/assets/rims', {...body, 'quantity': int.tryParse(_qty.text.trim()) ?? 0, 'supplierName': _supplier.text.trim(), 'date': _today()});
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final edit = widget.rim != null;
    return _sheet(context, edit ? tr('تعديل ${widget.rim!['name']}', 'Edit ${widget.rim!['name']}') : tr('إضافة صنف جنوط', 'Add a rim type'), [
      Row(children: [
        Expanded(child: LookupField(type: 'ls2_rim_brand', controller: _brand, label: tr('النوع', 'Brand'), hint: tr('اختر النوع', 'Pick a brand'), onChanged: () => setState(() {}))),
        const SizedBox(width: 8),
        Expanded(child: LookupField(type: 'ls2_rim_size', controller: _size, label: tr('المقاس', 'Size'), hint: tr('اختر المقاس', 'Pick a size'), onChanged: () => setState(() {}))),
      ]),
      const SizedBox(height: 10),
      SegmentedButton<String>(
        segments: [for (final e in _cond.entries) ButtonSegment(value: e.key, label: Text(tr(e.value.$1, e.value.$2)))],
        selected: {_condition},
        onSelectionChanged: (s) => setState(() => _condition = s.first),
      ),
      const SizedBox(height: 10),
      if (!edit) TextField(controller: _qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('العدد الموجود', 'Quantity on hand'))),
      TextField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('سعر القطعة (ريال)', 'Unit price (SAR)'))),
      TextField(controller: _min, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('نبّهني عند (حد أدنى)', 'Alert at (minimum)'))),
      if (!edit) TextField(controller: _supplier, decoration: InputDecoration(labelText: tr('المورد (اختياري)', 'Supplier (optional)'))),
      TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
      if (edit) Padding(padding: const EdgeInsets.only(top: 8), child: Text(
          tr('الرصيد لا يُعدَّل من هنا — سجّل وارد أو صادر أو تسوية جرد.', 'The balance is not edited here — record an in, out or count adjustment.'),
          style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
      if (_error != null) _err(_error!),
      const SizedBox(height: 12),
      FilledButton(
        style: FilledButton.styleFrom(backgroundColor: T.orange),
        onPressed: _busy || _brand.text.trim().isEmpty || _size.text.trim().isEmpty ? null : _save,
        child: Text(_busy ? '…' : tr('حفظ', 'Save')),
      ),
    ]);
  }
}

/// Add stock (in) or reduce stock (out) on one rim type.
class _MovementSheet extends StatefulWidget {
  final Map<String, dynamic> rim;
  final String type;
  final List<Map<String, dynamic>> reasons;
  final List<Map<String, dynamic>> issueReasons;
  final List<String> plates;
  const _MovementSheet({required this.rim, required this.type, required this.reasons, required this.issueReasons, required this.plates});
  @override
  State<_MovementSheet> createState() => _MovementSheetState();
}

class _MovementSheetState extends State<_MovementSheet> {
  final _qty = TextEditingController(text: '1');
  late String _reason = widget.type == 'in' ? 'purchase' : '';
  String _plate = '';
  String _issueReason = '';
  late final _price = TextEditingController(text: (widget.rim['unitPrice'] ?? 0) == 0 ? '' : '${widget.rim['unitPrice']}');
  final _supplier = TextEditingController();
  final _notes = TextEditingController();
  String _date = _today();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_qty, _price, _supplier, _notes]) { c.dispose(); }
    super.dispose();
  }

  bool get _needsPlate => _reason == 'mounted' || _reason == 'returned';
  int get _onHand => (widget.rim['quantity'] as num?)?.toInt() ?? 0;

  Future<void> _save() async {
    setState(() { _busy = true; _error = null; });
    try {
      await Api.instance.post('/api/ls2/assets/rims/${widget.rim['_id']}/movement', {
        'type': widget.type, 'quantity': int.tryParse(_qty.text.trim()) ?? 0, 'reason': _reason,
        'vehiclePlate': _plate, 'date': _date, 'notes': _notes.text.trim(),
        if (_reason == 'mounted') 'issueReason': _issueReason,
        if (widget.type == 'in') 'unitPrice': _price.text.trim().isEmpty ? null : num.tryParse(_price.text.trim()),
        if (widget.type == 'in') 'supplierName': _supplier.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = int.tryParse(_qty.text.trim()) ?? 0;
    final valid = q >= 1 && _reason.isNotEmpty && (!_needsPlate || _plate.isNotEmpty)
        && (_reason != 'other' || _notes.text.trim().length >= 3) && (widget.type == 'in' || q <= _onHand)
        && (_reason != 'mounted' || _issueReason.isNotEmpty);
    return _sheet(context, '${widget.type == 'in' ? tr('وارد', 'In') : tr('صادر', 'Out')} — ${widget.rim['name']}', [
      Text(tr('الرصيد الحالي: $_onHand', 'On hand: $_onHand'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      TextField(controller: _qty, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('العدد', 'Quantity'))),
      const SizedBox(height: 8),
      DropdownButtonFormField<String>(
        initialValue: _reason.isEmpty ? null : _reason,
        decoration: InputDecoration(labelText: tr('السبب', 'Reason')),
        items: [for (final r in widget.reasons) DropdownMenuItem(value: '${r['key']}', child: Text(tr('${r['ar']}', '${r['en']}')))],
        onChanged: (v) => setState(() => _reason = v ?? ''),
      ),
      if (_needsPlate || _reason == 'sold' || _reason == 'damaged') ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(_plate.isEmpty ? tr(_needsPlate ? 'اختر الشاحنة *' : 'اختر الشاحنة (اختياري)', _needsPlate ? 'Choose truck *' : 'Choose truck (optional)') : _plate),
        trailing: _plate.isEmpty ? const Icon(Icons.chevron_left) : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _plate = '')),
        onTap: () async {
          final p = await pickFromList(context, title: tr('الشاحنة', 'Truck'), options: widget.plates, current: _plate);
          if (p != null) setState(() => _plate = p);
        },
      ),
      if (_reason == 'mounted') DropdownButtonFormField<String>(
        initialValue: _issueReason.isEmpty ? null : _issueReason,
        decoration: InputDecoration(labelText: tr('سبب الصرف', 'Issue reason')),
        items: [for (final r in widget.issueReasons) DropdownMenuItem(value: '${r['key']}', child: Text(tr('${r['ar']}', '${r['en']}')))],
        onChanged: (v) => setState(() => _issueReason = v ?? ''),
      ),
      if (widget.type == 'in') ...[
        TextField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('سعر القطعة (ريال)', 'Unit price (SAR)'))),
        TextField(controller: _supplier, decoration: InputDecoration(labelText: tr('المورد (اختياري)', 'Supplier (optional)'))),
      ],
      ListTile(
        contentPadding: EdgeInsets.zero, leading: const Icon(Icons.event_outlined), title: Text(_date),
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 1)));
          if (d != null) setState(() => _date = d.toIso8601String().substring(0, 10));
        },
      ),
      TextField(controller: _notes, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr(_reason == 'other' ? 'ملاحظات (مطلوبة)' : 'ملاحظات', _reason == 'other' ? 'Notes (required)' : 'Notes'))),
      if (widget.type == 'out' && q > _onHand) _err(tr('العدد أكبر من الرصيد المتاح', 'More than on hand')),
      if (_error != null) _err(_error!),
      const SizedBox(height: 12),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: T.orange), onPressed: _busy || !valid ? null : _save, child: Text(_busy ? '…' : tr('تسجيل', 'Record'))),
    ]);
  }
}

/// Out to a truck (fitted) or in from it (returned), several rim types at once, like the store's issue to a vehicle.
class _VehicleMoveSheet extends StatefulWidget {
  final String type;
  final List<Map<String, dynamic>> rims;
  final List<Map<String, dynamic>> issueReasons;
  final List<String> plates;
  const _VehicleMoveSheet({required this.type, required this.rims, required this.issueReasons, required this.plates});
  @override
  State<_VehicleMoveSheet> createState() => _VehicleMoveSheetState();
}

class _VehicleMoveSheetState extends State<_VehicleMoveSheet> {
  String _plate = '';
  String _issueReason = '';
  String _date = _today();
  final _notes = TextEditingController();
  final List<(String, TextEditingController)> _lines = [('', TextEditingController(text: '1'))];
  bool _busy = false;
  String? _error;

  bool get _out => widget.type == 'out';

  @override
  void dispose() {
    _notes.dispose();
    for (final l in _lines) { l.$2.dispose(); }
    super.dispose();
  }

  Map<String, dynamic>? _rim(String id) => widget.rims.where((r) => '${r['_id']}' == id).firstOrNull;
  int _onHand(String id) => ((_rim(id)?['quantity']) as num?)?.toInt() ?? 0;
  int _asked(String id) => _lines.where((l) => l.$1 == id).fold(0, (a, l) => a + (int.tryParse(l.$2.text.trim()) ?? 0));
  String _lineError((String, TextEditingController) l) {
    if (l.$1.isEmpty) return '';
    final q = int.tryParse(l.$2.text.trim()) ?? 0;
    if (q < 1) return tr('عدد غير صحيح', 'Bad quantity');
    if (_out && _asked(l.$1) > _onHand(l.$1)) return tr('أكبر من الرصيد (${_onHand(l.$1)})', 'More than on hand (${_onHand(l.$1)})');
    return '';
  }

  Future<void> _save() async {
    setState(() { _busy = true; _error = null; });
    try {
      await Api.instance.post('/api/ls2/assets/rims/vehicle-movement', {
        'type': widget.type, 'vehiclePlate': _plate, 'date': _date, 'notes': _notes.text.trim(),
        if (_out) 'issueReason': _issueReason,
        'items': [for (final l in _lines.where((l) => l.$1.isNotEmpty)) {'rimId': l.$1, 'quantity': int.tryParse(l.$2.text.trim()) ?? 0}],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final filled = _lines.where((l) => l.$1.isNotEmpty).toList();
    final valid = _plate.isNotEmpty && filled.isNotEmpty && filled.every((l) => _lineError(l).isEmpty) && (!_out || _issueReason.isNotEmpty);
    final pickable = widget.rims.where((r) => !_out || ((r['quantity'] as num?) ?? 0) > 0).toList();
    return _sheet(context, _out ? tr('صادر جنوط على مركبة', 'Issue rims to a vehicle') : tr('وارد جنوط من مركبة', 'Return rims from a vehicle'), [
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(_plate.isEmpty ? tr('اختر الشاحنة *', 'Choose truck *') : _plate),
        trailing: const Icon(Icons.chevron_left),
        onTap: () async {
          final p = await pickFromList(context, title: tr('الشاحنة', 'Truck'), options: widget.plates, current: _plate);
          if (p != null) setState(() => _plate = p);
        },
      ),
      if (_out) DropdownButtonFormField<String>(
        initialValue: _issueReason.isEmpty ? null : _issueReason,
        decoration: InputDecoration(labelText: tr('سبب الصرف', 'Issue reason')),
        items: [for (final r in widget.issueReasons) DropdownMenuItem(value: '${r['key']}', child: Text(tr('${r['ar']}', '${r['en']}')))],
        onChanged: (v) => setState(() => _issueReason = v ?? ''),
      ),
      const SizedBox(height: 8),
      Text(tr('الجنوط', 'Rims'), style: const TextStyle(fontWeight: FontWeight.w800)),
      for (var i = 0; i < _lines.length; i++) Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 3, child: InkWell(
            onTap: () async {
              final names = pickable.map((r) => '${r['name']}').toList();
              final v = await pickFromList(context, title: tr('الصنف', 'Rim'), options: names, current: '${_rim(_lines[i].$1)?['name'] ?? ''}');
              final hit = pickable.where((r) => '${r['name']}' == v).firstOrNull;
              if (hit != null) setState(() => _lines[i] = ('${hit['_id']}', _lines[i].$2));
            },
            child: InputDecorator(
              decoration: InputDecoration(labelText: tr('الصنف', 'Rim'), errorText: _lineError(_lines[i]).isEmpty ? null : _lineError(_lines[i]),
                  helperText: _lines[i].$1.isEmpty ? null : tr('الرصيد ${_onHand(_lines[i].$1)}', 'On hand ${_onHand(_lines[i].$1)}')),
              child: Text(_lines[i].$1.isEmpty ? tr('اختر…', 'Choose…') : '${_rim(_lines[i].$1)?['name'] ?? ''}', overflow: TextOverflow.ellipsis),
            ),
          )),
          const SizedBox(width: 8),
          SizedBox(width: 70, child: TextField(controller: _lines[i].$2, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: tr('العدد', 'Qty')))),
          IconButton(icon: const Icon(Icons.delete_outline), onPressed: _lines.length == 1 ? null : () => setState(() { _lines.removeAt(i).$2.dispose(); })),
        ]),
      ),
      Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
        onPressed: () => setState(() => _lines.add(('', TextEditingController(text: '1')))),
        icon: const Icon(Icons.add), label: Text(tr('صنف آخر', 'Another rim')))),
      ListTile(
        contentPadding: EdgeInsets.zero, leading: const Icon(Icons.event_outlined), title: Text(_date),
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 1)));
          if (d != null) setState(() => _date = d.toIso8601String().substring(0, 10));
        },
      ),
      TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات (اختياري)', 'Notes (optional)'))),
      if (_error != null) _err(_error!),
      const SizedBox(height: 12),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: T.orange), onPressed: _busy || !valid ? null : _save, child: Text(_busy ? '…' : tr('تسجيل', 'Record'))),
    ]);
  }
}

/// Move stock from one rim type to another (e.g. used declared scrap).
class _TransferSheet extends StatefulWidget {
  final Map<String, dynamic> rim;
  final List<Map<String, dynamic>> rims;
  const _TransferSheet({required this.rim, required this.rims});
  @override
  State<_TransferSheet> createState() => _TransferSheetState();
}

class _TransferSheetState extends State<_TransferSheet> {
  String _to = '';
  final _qty = TextEditingController(text: '1');
  final _notes = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() { _qty.dispose(); _notes.dispose(); super.dispose(); }

  Future<void> _save() async {
    setState(() { _busy = true; _error = null; });
    try {
      await Api.instance.post('/api/ls2/assets/rims/${widget.rim['_id']}/transfer', {
        'toRimId': _to, 'quantity': int.tryParse(_qty.text.trim()) ?? 0, 'date': _today(), 'notes': _notes.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final onHand = (widget.rim['quantity'] as num?)?.toInt() ?? 0;
    final q = int.tryParse(_qty.text.trim()) ?? 0;
    final targets = widget.rims.where((r) => r['_id'] != widget.rim['_id']).toList();
    return _sheet(context, tr('تحويل من ${widget.rim['name']}', 'Transfer from ${widget.rim['name']}'), [
      Text(tr('يُسجَّل صادر من هذا الصنف ووارد إلى الآخر معًا. الرصيد الحالي: $onHand', 'One out and one in, recorded together. On hand: $onHand'),
          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 8),
      DropdownButtonFormField<String>(
        initialValue: _to.isEmpty ? null : _to,
        isExpanded: true,
        decoration: InputDecoration(labelText: tr('إلى صنف', 'To rim type')),
        items: [for (final r in targets) DropdownMenuItem(value: '${r['_id']}', child: Text('${r['name']} (${r['quantity']})'))],
        onChanged: (v) => setState(() => _to = v ?? ''),
      ),
      TextField(controller: _qty, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('العدد', 'Quantity'))),
      TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
      if (q > onHand) _err(tr('العدد أكبر من الرصيد المتاح', 'More than on hand')),
      if (_error != null) _err(_error!),
      const SizedBox(height: 12),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: T.orange),
          onPressed: _busy || _to.isEmpty || q < 1 || q > onHand ? null : _save, child: Text(_busy ? '…' : tr('تحويل', 'Transfer'))),
    ]);
  }
}

/// Movement log for one rim type or all; reversal is the only correction.
class _RimLogScreen extends StatefulWidget {
  final Map<String, dynamic>? rim;
  final bool admin;
  const _RimLogScreen({required this.rim, required this.admin});
  @override
  State<_RimLogScreen> createState() => _RimLogScreenState();
}

class _RimLogScreenState extends State<_RimLogScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  bool _legacy = true;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = (p) { if (p is Map && p.containsKey('vehicles')) return; _load(); };
    Live.instance.onData('ls2:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.offData('ls2:updated', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/assets/rims/movements?limit=5000${widget.rim != null ? '&rim=${widget.rim!['_id']}' : ''}');
      if (mounted) setState(() { _rows = _l(d['movements']); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Future<void> _reverse(Map<String, dynamic> m) async {
    final reason = TextEditingController();
    final go = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c2, setInner) => AlertDialog(
      title: Text(tr('التراجع عن الحركة', 'Reverse movement'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${m['rimName']} · ${m['type'] == 'in' ? tr('وارد', 'In') : tr('صادر', 'Out')} ${m['quantity']}${m['reason'] == 'transfer' ? tr(' — يُتراجَع عن طرفي التحويل معًا', ' — both transfer legs') : ''}',
            style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
        const SizedBox(height: 12),
        TextField(controller: reason, autofocus: true, maxLines: 2, onChanged: (_) => setInner(() {}),
            decoration: InputDecoration(labelText: tr('سبب التراجع *', 'Reason *'))),
        const SizedBox(height: 10),
        Text(tr('الحركة الأصلية لا تُعدَّل ولا تُحذَف — تُسجَّل بجوارها حركة معاكسة باسمك وبسببك.', 'The original stays; an opposite entry is recorded under your name and reason.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint, height: 1.45)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c2, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: reason.text.trim().length < 3 ? null : () => Navigator.pop(c2, true), child: Text(tr('تأكيد التراجع', 'Confirm'))),
      ],
    )));
    if (go != true) return;
    try {
      await Api.instance.post('/api/ls2/assets/rims/movements/${m['_id']}/reverse', {'reason': reason.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التراجع', 'Reversed'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _legacy ? _rows : _rows.where((m) => m['legacy'] != true).toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.rim != null ? tr('سجل ${widget.rim!['name']}', '${widget.rim!['name']} log') : tr('سجل حركات الجنوط', 'Rim movements')),
        actions: [
          IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined),
              onPressed: () => exportExcel(context, fileName: 'ls2-rims-movements', sheets: [(tr('حركات الجنوط', 'Rim movements'), Ls2RimsTabState._moveCols, rows)])),
        ],
      ),
      body: Column(children: [
        SwitchListTile(dense: true, value: _legacy, onChanged: (v) => setState(() => _legacy = v),
            title: Text(tr('اعرض الحركات السابقة من المخزن', 'Show earlier store movements'), style: const TextStyle(fontSize: 13))),
        Expanded(child: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : RefreshIndicator(onRefresh: _load, child: rows.isEmpty
                    ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.history, title: tr('لا توجد حركات', 'No movements'))])
                    : ListView.separated(
                        padding: const EdgeInsets.all(14), itemCount: rows.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (c, i) {
                          final m = rows[i];
                          final isIn = m['type'] == 'in'; final isEdit = m['type'] == 'edit';
                          final color = isEdit ? T.inkFaint : isIn ? T.success : T.warn;
                          final details = [
                            if ('${m['vehiclePlate'] ?? ''}'.isNotEmpty) '${tr('المركبة', 'Vehicle')} ${m['vehiclePlate']}',
                            if ('${m['issueReasonLabel'] ?? ''}'.isNotEmpty) '${m['issueReasonLabel']}',
                            if ('${m['counterpartName'] ?? ''}'.isNotEmpty) '${isIn ? tr('من', 'from') : tr('إلى', 'to')} ${m['counterpartName']}',
                            if ('${m['supplierName'] ?? ''}'.isNotEmpty) '${tr('المورد', 'Supplier')} ${m['supplierName']}',
                            if ('${m['notes'] ?? ''}'.isNotEmpty) '${m['notes']}',
                          ].join(' · ');
                          return Opacity(opacity: m['reversed'] == true ? 0.6 : 1, child: AppCard(topAccent: color, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Chip2(isEdit ? tr('تعديل', 'Edit') : isIn ? tr('وارد', 'In') : tr('صادر', 'Out'), color),
                              const SizedBox(width: 6),
                              Expanded(child: Text(tr('${m['reasonAr'] ?? ''}', '${m['reasonEn'] ?? ''}'),
                                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, decoration: m['reversed'] == true ? TextDecoration.lineThrough : null))),
                              if (!isEdit) Text('${m['quantity']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                            ]),
                            const SizedBox(height: 4),
                            Text([
                              '${m['date'] ?? ''}',
                              if (widget.rim == null) '${m['rimName'] ?? ''}',
                              if (!isEdit) '${tr('الرصيد بعدها', 'Balance after')} ${m['balanceAfter']}',
                              if ('${m['performedByName'] ?? ''}'.isNotEmpty) '${m['performedByName']}',
                              if (m['legacy'] == true) tr('من المخزن', 'from store'),
                            ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            if (details.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(details, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                            if (m['reversed'] == true) Padding(padding: const EdgeInsets.only(top: 3), child: Text(
                                '${tr('تراجع', 'Reversed by')} ${m['reversedByName'] ?? ''}: ${m['reversalReason'] ?? ''}', style: const TextStyle(fontSize: 11.5, color: T.danger))),
                            if (widget.admin && m['canReverse'] == true) Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
                                onPressed: () => _reverse(m), icon: const Icon(Icons.undo, size: 16, color: T.danger),
                                label: Text(tr('تراجع', 'Reverse'), style: const TextStyle(color: T.danger)))),
                          ])));
                        },
                      ))),
      ]),
    );
  }
}
