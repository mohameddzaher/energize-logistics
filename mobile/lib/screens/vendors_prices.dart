import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Approved routes and purchase prices (web: /system/vendors-mgmt/routes). A range per route, optionally for one
/// customer (their own price wins over the route's general one); places come from the section settings lists, and
/// places with no approved route are flagged. Every request on a route shows the range live.
class VendorsPricesScreen extends StatefulWidget {
  const VendorsPricesScreen({super.key});
  @override
  State<VendorsPricesScreen> createState() => _VendorsPricesScreenState();
}

/// Same editors as the server (routes/vendorsMgmt LEADS).
const _priceEditors = {
  'super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'business_consultant', 'transition_account', 'backup_account',
  'vendors_manager', 'vendors_team_leader', 'operations_manager', 'operations_team_leader', 'data_manager',
};

class _VendorsPricesScreenState extends State<VendorsPricesScreen> {
  List<Map<String, dynamic>> _prices = [];
  List<String> _from = [], _to = [], _gapFrom = [], _gapTo = [];
  List<Map<String, dynamic>> _customers = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('vendors:changed', _onLive);
    Live.instance.on('shipmentOrders:fields', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vendors:changed', _onLive); Live.instance.off('shipmentOrders:fields', _onLive); super.dispose(); }

  List<String> _strs(dynamic v) => List<String>.from(((v as List?) ?? const []).map((e) => '$e'));

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/vendors-mgmt/prices'));
      if (!mounted) return;
      setState(() {
        _prices = List<Map<String, dynamic>>.from((d['prices'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
        final p = Map<String, dynamic>.from(d['places'] ?? {});
        final u = Map<String, dynamic>.from(d['uncovered'] ?? {});
        _from = _strs(p['from']); _to = _strs(p['to']);
        _gapFrom = _strs(u['from']); _gapTo = _strs(u['to']);
        _customers = List<Map<String, dynamic>>.from((d['customers'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _edit(Map<String, dynamic>? p, {String from = '', String to = ''}) async {
    final f = <String, dynamic>{
      'fromCity': p?['fromCity'] ?? from, 'toCity': p?['toCity'] ?? to, 'customer': p?['customer'] == null ? '' : '${p!['customer']}',
      'truckType': p?['truckType'] ?? '', 'notes': p?['notes'] ?? '',
    };
    final mn = TextEditingController(text: p?['min'] == null ? '' : '${p!['min']}');
    final mx = TextEditingController(text: p?['max'] == null ? '' : '${p!['max']}');
    final tt = TextEditingController(text: '${f['truckType']}');
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        final a = num.tryParse(mn.text) ?? 0, b = num.tryParse(mx.text) ?? 0;
        final valid = '${f['fromCity']}'.isNotEmpty && '${f['toCity']}'.isNotEmpty && a > 0 && b > 0 && a <= b;
        DropdownMenuItem<String> item(String v, String label) => DropdownMenuItem(value: v, child: Text(label, overflow: TextOverflow.ellipsis));
        List<DropdownMenuItem<String>> places(List<String> list, String cur) => [
          for (final v in {if (cur.isNotEmpty) cur, ...list}) item(v, v),
        ];
        return Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(p == null ? tr('مسارٌ معتمدٌ جديد', 'New approved route') : tr('تعديل السعر المعتمد', 'Edit approved price'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              isExpanded: true, initialValue: '${f['fromCity']}'.isEmpty ? null : '${f['fromCity']}',
              decoration: InputDecoration(labelText: tr('من (مكان التحميل)', 'From'), border: const OutlineInputBorder()),
              items: places(_from, '${f['fromCity']}'), onChanged: (v) => set(() => f['fromCity'] = v ?? ''),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              isExpanded: true, initialValue: '${f['toCity']}'.isEmpty ? null : '${f['toCity']}',
              decoration: InputDecoration(labelText: tr('إلى (الوجهة)', 'To'), border: const OutlineInputBorder()),
              items: places(_to, '${f['toCity']}'), onChanged: (v) => set(() => f['toCity'] = v ?? ''),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              isExpanded: true, initialValue: '${f['customer']}',
              decoration: InputDecoration(labelText: tr('العميل (اختياري)', 'Customer (optional)'), border: const OutlineInputBorder()),
              items: [item('', tr('— كلّ العملاء —', '— all customers —')), for (final cu in _customers) item('${cu['_id']}', '${cu['name']}')],
              onChanged: (v) => set(() => f['customer'] = v ?? ''),
            ),
            const SizedBox(height: 10),
            TextField(controller: tt, decoration: InputDecoration(labelText: tr('نوع الشاحنة (اختياري)', 'Truck type (optional)'), border: const OutlineInputBorder())),
            const SizedBox(height: 12),
            Text(tr('سعر الشراء المعتمد للرحلة', 'Approved purchase per trip'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: TextField(controller: mn, keyboardType: TextInputType.number, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('من', 'From'), border: const OutlineInputBorder()))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: mx, keyboardType: TextInputType.number, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('إلى', 'To'), border: const OutlineInputBorder()))),
            ]),
            if (a > 0 && b > 0 && a > b) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('سعر «من» أكبر من «إلى»', '“From” is above “to”'), style: const TextStyle(color: T.danger, fontSize: 12))),
            const SizedBox(height: 14),
            FilledButton(onPressed: valid ? () => Navigator.pop(c, true) : null, child: Text(tr('حفظ', 'Save'))),
          ])),
        );
      }),
    );
    if (ok != true) return;
    final body = {
      'fromCity': f['fromCity'], 'toCity': f['toCity'], 'customer': '${f['customer']}'.isEmpty ? null : f['customer'],
      'truckType': tt.text.trim(), 'minPrice': num.tryParse(mn.text), 'maxPrice': num.tryParse(mx.text), 'notes': f['notes'],
    };
    try {
      if (p == null) {
        await Api.instance.post('/api/vendors-mgmt/prices', body);
      } else {
        await Api.instance.put('/api/vendors-mgmt/prices/${p['_id']}', body);
      }
      await _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Future<void> _delete(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف السعر المعتمد', 'Delete approved price')),
      content: Text('${p['fromCity']} ← ${p['toCity']}'),
      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete')))],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/vendors-mgmt/prices/${p['_id']}'); await _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final lead = _priceEditors.contains(context.watch<AuthProvider>().role);
    final shown = _prices.where((p) => _q.isEmpty || '${p['fromCity']} ${p['toCity']} ${p['customerName'] ?? ''} ${p['truckType'] ?? ''}'.contains(_q)).toList();
    return AppScaffold(
      title: Text(tr('المسارات والأسعار المعتمدة', 'Approved routes & prices')),
      floatingActionButton: lead ? FloatingActionButton.extended(onPressed: () => _edit(null), icon: const Icon(Icons.add), label: Text(tr('مسار', 'Route'))) : null,
      body: _loading ? const Center(child: CircularProgressIndicator()) : _error != null ? ErrorRetry(message: _error!, onRetry: _load) : RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 90), children: [
          TextField(onChanged: (v) => setState(() => _q = v.trim()), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('بحث بالمسار أو العميل…', 'Search route or customer…'), isDense: true, border: const OutlineInputBorder())),
          if (_gapFrom.isNotEmpty || _gapTo.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 10), padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.warn.withValues(alpha: 0.4))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('أماكن في إعدادات القسم بلا سعر شراءٍ معتمد', 'Places in settings with no approved price'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.warn)),
                for (final g in [(_gapFrom, 'from', 'من', 'From'), (_gapTo, 'to', 'إلى', 'To')]) if (g.$1.isNotEmpty) Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Text('${tr(g.$3, g.$4)}:', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                    for (final c in g.$1) ActionChip(label: Text(c), onPressed: lead ? () => _edit(null, from: g.$2 == 'from' ? c : '', to: g.$2 == 'to' ? c : '') : null),
                  ]),
                ),
              ]),
            ),
          const SizedBox(height: 10),
          if (shown.isEmpty) Padding(padding: const EdgeInsets.all(30), child: Text(tr('لا مسارات معتمدة', 'No approved routes'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
          for (final p in shown) Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${p['fromCity']} ← ${p['toCity']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 2),
                Text('${p['customer'] != null ? p['customerName'] : tr('كلّ العملاء', 'All customers')} · ${'${p['truckType'] ?? ''}'.isEmpty ? tr('كلّ الأنواع', 'Any truck') : p['truckType']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              ])),
              Text(p['min'] == null ? tr('بلا سعر', 'No price') : '${p['min']} – ${p['max']}', style: TextStyle(fontWeight: FontWeight.w900, color: p['min'] == null ? T.warn : T.success)),
              if (lead) PopupMenuButton<String>(
                onSelected: (v) => v == 'edit' ? _edit(p) : _delete(p),
                itemBuilder: (_) => [PopupMenuItem(value: 'edit', child: Text(tr('تعديل', 'Edit'))), PopupMenuItem(value: 'del', child: Text(tr('حذف', 'Delete')))],
              ),
            ])),
          ),
        ]),
      ),
    );
  }
}
