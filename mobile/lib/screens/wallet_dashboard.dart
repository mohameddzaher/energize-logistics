import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// لوحة المحفظة — نظرة كل الفروع على عهدة اليوم: التحصيلات/المصروفات/المشتريات
/// والرصيد والفروقات لكل فرع. مطابقة لصفحة الويب /system/wallet-dashboard.
class WalletDashboardScreen extends StatefulWidget {
  const WalletDashboardScreen({super.key});
  @override
  State<WalletDashboardScreen> createState() => _WalletDashboardScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = n < 0;
  final s = n.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '${neg ? '-' : ''}$b';
}

class _WalletDashboardScreenState extends State<WalletDashboardScreen> {
  List<Map<String, dynamic>> _branches = [];
  String _date = '';
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('wallet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('wallet:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/wallet/dashboard');
      if (!mounted) return;
      setState(() {
        _branches = List<Map<String, dynamic>>.from(d['branches'] ?? []);
        _date = (d['date'] ?? '').toString();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  num _sum(String key) => _branches.fold<num>(0, (a, b) => a + ((b[key] is num) ? b[key] as num : 0));

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = q.isEmpty
        ? _branches
        : _branches.where((b) => _fold(((b['branch'] ?? const {})['name'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('لوحة المحفظة', 'Wallet Dashboard')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      if (_date.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text('${tr('تاريخ', 'Date')}: $_date', style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                        ),
                      // إجماليات كل الفروع
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        childAspectRatio: 1.7,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        children: [
                          _tile(tr('إجمالي التحصيلات', 'Collections'), _money(_sum('totalCollections')), T.success, Icons.payments_outlined),
                          _tile(tr('إجمالي المصروفات', 'Expenses'), _money(_sum('totalExpenses')), T.danger, Icons.money_off_outlined),
                          _tile(tr('إجمالي المشتريات', 'Purchases'), _money(_sum('totalPurchases')), T.warn, Icons.shopping_cart_outlined),
                          _tile(tr('صافي الحركة', 'Net movement'), _money(_sum('netMovement')), T.navy, Icons.swap_vert_rounded),
                          _tile(tr('الرصيد الختامي', 'Closing balance'), _money(_sum('closingBalance')), T.info, Icons.account_balance_wallet_outlined),
                          _tile(tr('فروقات النقد', 'Cash difference'), _money(_sum('totalDifference')), _sum('totalDifference') == 0 ? T.success : T.danger, Icons.rule_folder_outlined),
                        ],
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        onChanged: (v) => setState(() => _q = v),
                        decoration: InputDecoration(hintText: tr('ابحث باسم الفرع…', 'Search branch…'), prefixIcon: const Icon(Icons.search)),
                      ),
                      const SizedBox(height: 10),
                      Text(tr('الفروع', 'Branches'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      if (rows.isEmpty)
                        EmptyState(icon: Icons.store_mall_directory_outlined, title: tr('لا توجد فروع مطابقة', 'No matching branches'))
                      else
                        ...rows.map((b) {
                          final branch = Map<String, dynamic>.from(b['branch'] ?? {});
                          final diff = (b['totalDifference'] is num) ? b['totalDifference'] as num : 0;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: AppCard(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  const Icon(Icons.store_outlined, size: 18, color: T.navy),
                                  const SizedBox(width: 6),
                                  Expanded(child: Text((branch['name'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                  Chip2('${b['closedWallets'] ?? 0}/${b['activeWallets'] ?? 0} ${tr('مغلقة', 'closed')}', T.inkSoft),
                                ]),
                                const SizedBox(height: 8),
                                Wrap(spacing: 6, runSpacing: 6, children: [
                                  Chip2('${tr('تحصيل', 'Coll')} ${_money(b['totalCollections'])}', T.success),
                                  Chip2('${tr('مصروف', 'Exp')} ${_money(b['totalExpenses'])}', T.danger),
                                  Chip2('${tr('مشتريات', 'Purch')} ${_money(b['totalPurchases'])}', T.warn),
                                  Chip2('${tr('رصيد', 'Bal')} ${_money(b['closingBalance'])}', T.info),
                                  if (diff != 0) Chip2('${tr('فرق', 'Diff')} ${_money(diff)}', T.danger, icon: Icons.warning_amber_outlined),
                                ]),
                              ]),
                            ),
                          );
                        }),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(height: 8),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
              child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}
