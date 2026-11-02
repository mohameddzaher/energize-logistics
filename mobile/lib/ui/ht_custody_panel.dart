import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import 'theme.dart';
import 'widgets.dart';

/// Heavy-transport custody on the truck and employee profile, like HtCustodyPanel on the web: reads the same ledger with a filter (location unit number or employee file) and updates live on `ht:custody`. Shown to those who can open the ledger, hidden when empty.
class HtCustodyPanel extends StatefulWidget {
  final String? vehicleUnitId;
  final String? employeeId;
  final bool showVehicle;
  const HtCustodyPanel({super.key, this.vehicleUnitId, this.employeeId, this.showVehicle = false});

  @override
  State<HtCustodyPanel> createState() => _HtCustodyPanelState();
}

// Matches CUSTODY_ROLES in htCustodyController.
const _roles = ['super_admin', 'admin', 'location_manager', 'cfo', 'accounting_manager', 'accountant'];
const _acc = {'cash': ('الكاش', 'Cash'), 'card': ('الكارت', 'Card'), 'workshop': ('الورشة', 'Workshop')};
const _src = {
  'card': ('الكارت', 'Card'), 'workshop': ('الورشة', 'Workshop'), 'bank': ('البنك', 'Bank'),
  'maintenance': ('الصيانة', 'Maintenance'), 'rep': ('موظف', 'Employee'), 'opening': ('رصيد افتتاحي', 'Opening'),
};

class _HtCustodyPanelState extends State<HtCustodyPanel> {
  List<Map<String, dynamic>> _rows = [];
  int _seq = 0;
  late final void Function() _onLive;

  String get _query {
    if ((widget.vehicleUnitId ?? '').isNotEmpty) return 'vehicle=${Uri.encodeComponent(widget.vehicleUnitId!)}';
    if ((widget.employeeId ?? '').isNotEmpty) return 'employee=${Uri.encodeComponent(widget.employeeId!)}';
    return '';
  }

  bool get _allowed => _roles.contains(context.read<AuthProvider>().role);

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('ht:custody', _onLive);
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    Live.instance.off('ht:custody', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted || !_allowed || _query.isEmpty) return;
    final mine = ++_seq; // Only the latest is shown.
    try {
      final d = await Api.instance.get('/api/ls2/custody?$_query');
      if (!mounted || mine != _seq) return;
      setState(() => _rows = List<Map<String, dynamic>>.from((d as Map)['entries'] ?? []));
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _rows = []);
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
  String _money(num v) => v.toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  String _date(dynamic v) {
    final s = '${v ?? ''}';
    return s.length >= 10 ? s.substring(0, 10).split('-').reversed.join('/') : '—';
  }

  String _party(Map<String, dynamic> e) {
    final rep = '${e['repName'] ?? ''} (${e['repIdNumber'] ?? ''})';
    if (e['direction'] == 'in') {
      if (e['source'] == 'rep') return rep;
      final s = _src['${e['source'] ?? ''}'];
      return s == null ? '${e['source'] ?? '—'}' : tr(s.$1, s.$2);
    }
    return e['target'] == 'rep' ? rep : ('${e['detail'] ?? ''}'.isNotEmpty ? '${e['detail']}' : tr('الشركة', 'Company'));
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const SizedBox.shrink();
    final inSum = _rows.where((e) => e['direction'] == 'in').fold<num>(0, (a, e) => a + _n(e['amount']));
    final outSum = _rows.where((e) => e['direction'] == 'out').fold<num>(0, (a, e) => a + _n(e['amount']));
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.account_balance_wallet_outlined, color: T.orange, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text(tr('عهدة النقل الثقيل', 'Heavy transport custody'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          Text('${_rows.length} ${tr('قيد', 'entries')}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        ]),
        const SizedBox(height: 6),
        Wrap(spacing: 14, children: [
          Text('${tr('وارد', 'In')} ${_money(inSum)}', style: const TextStyle(color: T.success, fontWeight: FontWeight.w700)),
          Text('${tr('صادر', 'Out')} ${_money(outSum)}', style: const TextStyle(color: T.orange, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 8),
        ..._rows.take(30).map((e) {
          final isIn = e['direction'] == 'in';
          final acc = _acc['${e['account'] ?? ''}'];
          final car = '${e['vehiclePlate'] ?? ''}'.isNotEmpty ? '${e['vehiclePlate']}' : '${e['vehicleName'] ?? ''}';
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${isIn ? tr('وارد', 'In') : tr('صادر', 'Out')} · ${acc == null ? '' : tr(acc.$1, acc.$2)} · ${_date(e['date'])}',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: isIn ? T.success : T.orange)),
                  Text([_party(e), if (widget.showVehicle && car.isNotEmpty) car].join(' · '),
                      style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ]),
              ),
              Text(_money(_n(e['amount'])), style: TextStyle(fontWeight: FontWeight.w800, color: isIn ? T.success : T.orange)),
            ]),
          );
        }),
      ]),
    );
  }
}
