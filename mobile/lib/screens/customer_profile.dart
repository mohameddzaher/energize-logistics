import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملف العميل — الأرصدة وشروط الائتمان، وفواتيره ومدفوعاته في تبويبين،
/// كما في صفحة العميل على الويب.
class CustomerProfileScreen extends StatefulWidget {
  final String customerId;
  final String name;
  const CustomerProfileScreen({super.key, required this.customerId, required this.name});
  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

const _invStatuses = {
  'pending': ('قيد السداد', 'Pending', T.warn),
  'partial': ('سداد جزئي', 'Partial', T.info),
  'paid': ('مسددة', 'Paid', T.success),
  'overdue': ('متأخرة', 'Overdue', T.danger),
  'frozen': ('مجمدة', 'Frozen', T.inkFaint),
  'refunded': ('مستردة', 'Refunded', T.violet),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  Map<String, dynamic>? _customer;
  List<Map<String, dynamic>> _invoices = [];
  List<Map<String, dynamic>> _payments = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('invoice:updated', _onLive);
    Live.instance.on('payment:logged', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('invoice:updated', _onLive);
    Live.instance.off('payment:logged', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/customers?limit=1000').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/invoices?customer=${widget.customerId}&limit=200').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/payments/customer/${widget.customerId}').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final customers = List<Map<String, dynamic>>.from(results[0]['customers'] ?? []);
      setState(() {
        _customer = customers.firstWhere((c) => c['_id'] == widget.customerId, orElse: () => {});
        _invoices = List<Map<String, dynamic>>.from(results[1]['invoices'] ?? []);
        _payments = List<Map<String, dynamic>>.from(results[2]['payments'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _customer ?? {};
    final outstanding = (c['outstandingBalance'] ?? c['currentOutstanding'] ?? 0) as num;

    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: Text(widget.name),
        appBarBottom: TabBar(
          indicatorColor: T.orange,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: [
            Tab(text: '${tr('الفواتير', 'Invoices')} (${_invoices.length})'),
            Tab(text: '${tr('المدفوعات', 'Payments')} (${_payments.length})'),
          ],
        ),
        body: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : Column(children: [
                    // header card
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: AppCard(
                        topAccent: outstanding > 0 ? T.danger : T.success,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((c['companyName'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                            if (c['isStopped'] == true) Chip2(tr('موقوف', 'Stopped'), T.danger),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2('${tr('المستحق', 'Outstanding')}: ${_money(outstanding)}', outstanding > 0 ? T.danger : T.success, icon: Icons.account_balance_wallet_outlined),
                            if (c['creditLimit'] != null) Chip2('${tr('حد الائتمان', 'Credit limit')}: ${_money(c['creditLimit'])}', T.info),
                            if (c['creditTerm'] != null) Chip2('${tr('مدة السداد', 'Term')}: ${c['creditTerm']} ${tr('يوم', 'd')}', T.violet),
                            if ((c['contactPerson'] ?? '').toString().isNotEmpty) Chip2(c['contactPerson'].toString(), T.navy, icon: Icons.person_outline),
                            if ((c['phone'] ?? '').toString().isNotEmpty) Chip2(c['phone'].toString(), T.cyan, icon: Icons.phone_outlined),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: TabBarView(children: [
                        // invoices
                        RefreshIndicator(
                          onRefresh: _load,
                          child: _invoices.isEmpty
                              ? ListView(children: [const SizedBox(height: 60), EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد فواتير', 'No invoices'))])
                              : ListView.separated(
                                  padding: const EdgeInsets.all(14),
                                  itemCount: _invoices.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                                  itemBuilder: (c, i) {
                                    final inv = _invoices[i];
                                    final st = _invStatuses[inv['status']] ?? ('—', '—', T.inkFaint);
                                    return AppCard(
                                      topAccent: st.$3,
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                      child: Row(children: [
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text((inv['invoiceNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                            Text('${_d(inv['invoiceDate'])} · ${tr('استحقاق', 'due')} ${_d(inv['dueDate'])}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                                          ]),
                                        ),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Text('${_money(inv['amount'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                                          if ((inv['balance'] ?? 0) != 0) Text('${tr('متبقي', 'bal')}: ${_money(inv['balance'])}', style: const TextStyle(fontSize: 10.5, color: T.danger)),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                      ]),
                                    );
                                  },
                                ),
                        ),
                        // payments
                        RefreshIndicator(
                          onRefresh: _load,
                          child: _payments.isEmpty
                              ? ListView(children: [const SizedBox(height: 60), EmptyState(icon: Icons.payments_outlined, title: tr('لا توجد مدفوعات', 'No payments'))])
                              : ListView.separated(
                                  padding: const EdgeInsets.all(14),
                                  itemCount: _payments.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                                  itemBuilder: (c, i) {
                                    final p = _payments[i];
                                    return AppCard(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                      child: Row(children: [
                                        Container(
                                          padding: const EdgeInsets.all(8),
                                          decoration: BoxDecoration(color: T.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                                          child: const Icon(Icons.payments_outlined, size: 17, color: T.success),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text('${_money(p['amount'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                            Text('${_d(p['paymentDate'] ?? p['createdAt'])}${(p['paymentMethod'] ?? '').toString().isNotEmpty ? ' · ${p['paymentMethod']}' : ''}${(p['reference'] ?? '').toString().isNotEmpty ? ' · ${p['reference']}' : ''}',
                                                style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                                          ]),
                                        ),
                                        if (p['invoice'] is Map) Chip2((p['invoice']['invoiceNumber'] ?? '').toString(), T.navy),
                                      ]),
                                    );
                                  },
                                ),
                        ),
                      ]),
                    ),
                  ]),
      ),
    );
  }
}
