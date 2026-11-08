import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';

/// Which branches each data and follow-up user sees on the Shipments page.
/// Counterpart of /system/shipment-orders/permissions.
class ShipmentBranchAccessScreen extends StatefulWidget {
  const ShipmentBranchAccessScreen({super.key});
  @override
  State<ShipmentBranchAccessScreen> createState() => _ShipmentBranchAccessScreenState();
}

class _ShipmentBranchAccessScreenState extends State<ShipmentBranchAccessScreen> {
  List<Map<String, dynamic>> _branches = [];
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  bool _selfLocked = false;
  String? _error;
  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    Live.instance.on('shipmentOrders:branchAccess', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:branchAccess', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/shipment-orders/branch-access'));
      if (!mounted) return;
      setState(() {
        _branches = List<Map<String, dynamic>>.from((d['branches'] as List).map((e) => Map<String, dynamic>.from(e)));
        _users = List<Map<String, dynamic>>.from((d['users'] as List).map((e) => Map<String, dynamic>.from(e)));
        _selfLocked = d['selfLocked'] == true;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = '$e'; });
    }
  }

  Future<void> _toggle(Map<String, dynamic> u, String key) async {
    final now = List<String>.from(u['branches'] ?? const []);
    now.contains(key) ? now.remove(key) : now.add(key);
    setState(() => u['branches'] = now);
    try {
      await Api.instance.put('/api/shipment-orders/branch-access/${u['_id']}', {'branches': now});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('الصلاحيات', 'Permissions')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : ListView(padding: const EdgeInsets.all(12), children: [
                  Text(tr('الفروع المفتوحة لكل مستخدم في صفحة الشحنات. من بدون فرع يرى كل الفروع.',
                      'Branches each user sees on the Shipments page. No branch selected means all branches.'),
                      style: const TextStyle(color: T.inkSoft, fontSize: 13)),
                  const SizedBox(height: 10),
                  for (final u in _users)
                    Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${u['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      Text('${u['roleAr'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                      if (_selfLocked && u['self'] == true)
                        Text(tr('حسابك — يعدّله مديرك أو الإدارة', 'Your account — set by your manager or management'),
                            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      const SizedBox(height: 8),
                      Wrap(spacing: 6, runSpacing: 6, children: [
                        for (final b in _branches)
                          FilterChip(
                            label: Text(tr('${b['ar']}', '${b['en']}')),
                            selected: List.from(u['branches'] ?? const []).contains(b['key']),
                            onSelected: _selfLocked && u['self'] == true ? null : (_) => _toggle(u, '${b['key']}'),
                          ),
                      ]),
                    ]))),
                ]),
    );
  }
}
