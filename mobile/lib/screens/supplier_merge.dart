import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// Merging two suppliers, mirrors SupplierMergeModal on web: two suppliers with the same name are the same person, unify and combine their data. Pick the other supplier (the same-named duplicate first), then which one stays, then the server merges: empty fields are filled, differing ones are appended to notes, and trucks, drivers and shipments move to the survivor (POST /suppliers/:id/merge).
String supplierNameKey(dynamic v) => '${v ?? ''}'
    .replaceAll(RegExp('[ً-ْـ]'), '')
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي')
    .replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();

/// Merge is role-only, like authorize.strict on the server (irreversible).
const _mergeRoles = {'super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'shipment_orders_manager'};

Future<bool> openSupplierMerge(BuildContext context, Map<String, dynamic> supplier) async {
  if (!_mergeRoles.contains(context.read<AuthProvider>().role)) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('دمج المورّدين لمدير القسم.', 'Merging suppliers is for the section manager.'))));
    return false;
  }
  final r = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _MergeSheet(supplier: supplier),
  );
  return r == true;
}

class _MergeSheet extends StatefulWidget {
  final Map<String, dynamic> supplier;
  const _MergeSheet({required this.supplier});
  @override
  State<_MergeSheet> createState() => _MergeSheetState();
}

class _MergeSheetState extends State<_MergeSheet> {
  final _q = TextEditingController();
  List<Map<String, dynamic>> _found = [];
  Map<String, dynamic>? _other;
  String _keepId = '';
  bool _busy = false;
  bool _loading = false;
  Timer? _t;

  Map<String, dynamic> get _me => widget.supplier;
  String _id(Map m) => '${m['_id'] ?? ''}';
  num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

  @override
  void initState() {
    super.initState();
    _keepId = _id(_me);
    // The same-named duplicate is suggested first.
    _search('${_me['name'] ?? ''}', twins: true);
  }

  @override
  void dispose() { _t?.cancel(); _q.dispose(); super.dispose(); }

  Future<void> _search(String term, {bool twins = false}) async {
    if (term.trim().isEmpty) { setState(() => _found = []); return; }
    setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/shipment-orders/suppliers?limit=30&q=${Uri.encodeQueryComponent(term.trim())}');
      var list = List<Map<String, dynamic>>.from(((d is Map ? d['suppliers'] : null) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)))
          .where((s) => _id(s) != _id(_me)).toList();
      if (twins) list = list.where((s) => supplierNameKey(s['name']) == supplierNameKey(_me['name'])).toList();
      if (!mounted) return;
      setState(() { _found = list; _loading = false; });
      if (twins && list.length == 1) _pick(list.first);
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  void _pick(Map<String, dynamic> s) => setState(() {
        _other = s;
        _keepId = _n(s['vehicleCount']) > _n(_me['vehicleCount']) ? _id(s) : _id(_me);
      });

  Future<void> _run() async {
    final other = _other;
    if (other == null) return;
    final keep = _keepId == _id(_me) ? _me : other;
    final drop = _keepId == _id(_me) ? other : _me;
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('دمج المورّدَين؟', 'Merge suppliers?')),
      content: Text(tr('يُدمَج «${drop['name']}» في «${keep['name']}»: تنتقل شاحناته وسائقوه وشحناته وتُضاف بياناته. لا يُتراجَع عن الدمج.',
          '“${drop['name']}” is merged into “${keep['name']}”: its trucks, drivers and shipments move and its details are added. This cannot be undone.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('دمج', 'Merge'))),
      ],
    ));
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/api/shipment-orders/suppliers/${_id(keep)}/merge', {'from': _id(drop)});
      final m = r is Map ? r['moved'] : null;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
          'تم الدمج — انتقل ${m?['vehicles'] ?? 0} شاحنة و${m?['drivers'] ?? 0} سائق و${m?['orders'] ?? 0} شحنة',
          'Merged — moved ${m?['vehicles'] ?? 0} trucks, ${m?['drivers'] ?? 0} drivers, ${m?['orders'] ?? 0} shipments'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  Widget _card(Map<String, dynamic> s) {
    final on = _id(s) == _keepId;
    String v(String k) => '${s[k] ?? ''}'.trim();
    return Expanded(child: InkWell(
      onTap: () => setState(() => _keepId = _id(s)),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: on ? T.success.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: on ? T.success : T.line, width: 2),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(on ? tr('يبقى', 'Keep') : tr('يُدمَج فيه', 'Merged in'),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: on ? T.success : T.inkFaint)),
          const SizedBox(height: 4),
          Text(v('name'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
          Text(tr('${s['vehicleCount'] ?? 0} شاحنة · ${s['driverCount'] ?? 0} سائق', '${s['vehicleCount'] ?? 0} trucks · ${s['driverCount'] ?? 0} drivers'),
              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          for (final f in [('phone', 'هاتف', 'Phone'), ('commercialRegister', 'سجل', 'CR'), ('iban', 'آيبان', 'IBAN'), ('managerName', 'المدير', 'Manager')])
            if (v(f.$1).isNotEmpty) Text('${tr(f.$2, f.$3)}: ${v(f.$1)}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        ]),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('دمج مورّدَين', 'Merge two suppliers'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          Text(tr('نفس المورّد مسجَّل مرّتين؟ يصيران سجلًّا واحدًا ببيانات الاثنين.', 'Same supplier recorded twice? They become one record.'),
              style: const TextStyle(fontSize: 13, color: T.inkSoft)),
          const SizedBox(height: 12),
          if (_other == null) ...[
            TextField(
              controller: _q,
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('ابحث باسم المورّد الآخر…', 'Search the other supplier…')),
              onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 300), () => _search(v)); },
            ),
            const SizedBox(height: 8),
            if (_loading) const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
            for (final s in _found)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${s['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${s['vehicleCount'] ?? 0} ${tr('شاحنة', 'trucks')}${'${s['phone'] ?? ''}'.isNotEmpty ? ' · ${s['phone']}' : ''}'),
                trailing: const Icon(Icons.chevron_left),
                onTap: () => _pick(s),
              ),
          ] else ...[
            Text(tr('اضغط على البطاقة التي تبقى:', 'Tap the card to keep:'), style: const TextStyle(fontSize: 13.5)),
            const SizedBox(height: 8),
            IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [_card(_me), const SizedBox(width: 8), _card(_other!)])),
            const SizedBox(height: 10),
            Text(tr('الفارغ يُملأ من الآخر والمختلف يُحفظ في الملاحظات · الشاحنات والسائقون والشحنات تنتقل للباقي · رقمه في منصة التشغيل يُحفظ فلا يتكرر مع الاستيراد.',
                'Empty fields are filled, differing ones go to notes · trucks, drivers and shipments move · its platform ID is kept so imports do not split it again.'),
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            TextButton(onPressed: () => setState(() => _other = null), child: Text(tr('اختيار مورّد آخر', 'Pick another supplier'))),
          ],
          const SizedBox(height: 8),
          SizedBox(height: 50, child: FilledButton.icon(
            onPressed: _other == null || _busy ? null : _run,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.merge_type),
            label: Text(tr('دمج', 'Merge'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          )),
        ])),
      ),
    ));
  }
}
