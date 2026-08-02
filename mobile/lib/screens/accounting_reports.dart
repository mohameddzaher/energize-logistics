import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقارير الحسابات — أعمار الديون (المدينون/الدائنون)، ميزان المراجعة، وقائمة
/// الدخل. مطابقة لصفحات الويب /system/accounting/{receivables,payables,
/// trial-balance,profit-loss}.

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

// ── أعمار الديون (المدينون/الدائنون) ────────────────────────────────────────
class AgingReportScreen extends StatefulWidget {
  final String endpoint;   // /api/accounting/receivables | /payables
  final String arTitle, enTitle;
  final String partyKey;   // 'customer' | 'vendor'
  final String docKey;     // 'invoice' | 'bill'
  final bool partyIsCompany; // customer has companyName, vendor has name
  const AgingReportScreen({
    super.key, required this.endpoint, required this.arTitle, required this.enTitle,
    required this.partyKey, required this.docKey, this.partyIsCompany = false,
  });
  @override
  State<AgingReportScreen> createState() => _AgingReportScreenState();
}

class _AgingReportScreenState extends State<AgingReportScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(widget.endpoint);
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  String _party(Map<String, dynamic> r) {
    final p = r[widget.partyKey];
    if (p is Map) return (p['companyName'] ?? p['name'] ?? '—').toString();
    return (p ?? '—').toString();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = List<Map<String, dynamic>>.from(d?['rows'] ?? []);
    final buckets = Map<String, dynamic>.from(d?['buckets'] ?? {});
    final q = _fold(_q.trim());
    final filtered = q.isEmpty ? rows : rows.where((r) => _fold('${_party(r)} ${r[widget.docKey] ?? ''}').contains(q)).toList();

    return AppScaffold(
      title: Text(tr(widget.arTitle, widget.enTitle)),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 120)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(tr('الإجمالي المستحق', 'Total outstanding'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                          Text(_money(d?['total']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: T.navy)),
                        ]),
                        const Divider(height: 20),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          _bucket(tr('جاري', 'Current'), buckets['current'], T.success),
                          _bucket('1-30', buckets['d30'], T.info),
                          _bucket('31-60', buckets['d60'], T.warn),
                          _bucket('61-90', buckets['d90'], T.orange),
                          _bucket('+90', buckets['over90'], T.danger),
                        ]),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                    const SizedBox(height: 10),
                    if (filtered.isEmpty)
                      EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد مستحقات', 'Nothing outstanding'))
                    else
                      ...filtered.map((r) {
                        final days = (r['daysOverdue'] is num) ? (r['daysOverdue'] as num).toInt() : 0;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Row(children: [
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(_party(r), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                Text('${widget.docKey == 'invoice' ? tr('فاتورة', 'Invoice') : tr('فاتورة مورد', 'Bill')} ${r[widget.docKey] ?? ''}${days > 0 ? ' · ${tr('متأخر', 'overdue')} $days ${tr('يوم', 'd')}' : ''}',
                                    style: TextStyle(fontSize: 11, color: days > 90 ? T.danger : T.inkFaint)),
                              ])),
                              Text(_money(r['balance']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.navy)),
                            ]),
                          ),
                        );
                      }),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Widget _bucket(String label, dynamic v, Color c) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: c.withValues(alpha: 0.25))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: TextStyle(fontSize: 10.5, color: c, fontWeight: FontWeight.w700)),
          Text(_money(v), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
        ]),
      );
}

// ── ميزان المراجعة ──────────────────────────────────────────────────────────
class TrialBalanceScreen extends StatefulWidget {
  const TrialBalanceScreen({super.key});
  @override
  State<TrialBalanceScreen> createState() => _TrialBalanceScreenState();
}

class _TrialBalanceScreenState extends State<TrialBalanceScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/accounting/trial-balance');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = List<Map<String, dynamic>>.from(d?['rows'] ?? []);
    final balanced = d?['balanced'] == true;

    return AppScaffold(
      title: Text(tr('ميزان المراجعة', 'Trial Balance')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('إجمالي المدين', 'Total debit'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                          Text(_money(d?['totalDebit']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: T.info)),
                        ])),
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('إجمالي الدائن', 'Total credit'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                          Text(_money(d?['totalCredit']), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: T.warn)),
                        ])),
                        Chip2(balanced ? tr('متزن', 'Balanced') : tr('غير متزن', 'Off'), balanced ? T.success : T.danger),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    if (rows.isEmpty)
                      EmptyState(icon: Icons.account_tree_outlined, title: tr('لا توجد أرصدة', 'No balances'))
                    else
                      ...rows.map((r) {
                        final acc = Map<String, dynamic>.from(r['account'] ?? {});
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                            child: Row(children: [
                              Expanded(child: Text('${acc['code'] ?? ''} · ${acc['name'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                              SizedBox(width: 70, child: Text(_money(r['debit']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, color: T.info, fontWeight: FontWeight.w700))),
                              const SizedBox(width: 6),
                              SizedBox(width: 70, child: Text(_money(r['credit']), textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, color: T.warn, fontWeight: FontWeight.w700))),
                            ]),
                          ),
                        );
                      }),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }
}

// ── قائمة الدخل (الأرباح والخسائر) ──────────────────────────────────────────
class ProfitLossScreen extends StatefulWidget {
  const ProfitLossScreen({super.key});
  @override
  State<ProfitLossScreen> createState() => _ProfitLossScreenState();
}

class _ProfitLossScreenState extends State<ProfitLossScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/accounting/profit-loss');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final revenue = List<Map<String, dynamic>>.from(d?['revenue'] ?? []);
    final expenses = List<Map<String, dynamic>>.from(d?['expenses'] ?? []);
    final net = (d?['netIncome'] is num) ? d!['netIncome'] as num : 0;

    return AppScaffold(
      title: Text(tr('قائمة الدخل', 'Profit & Loss')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      child: Column(children: [
                        _totalRow(tr('الإيرادات', 'Revenue'), d?['totalRevenue'], T.success),
                        const Divider(height: 16),
                        _totalRow(tr('المصروفات', 'Expenses'), d?['totalExpenses'], T.danger),
                        const Divider(height: 16),
                        _totalRow(tr('صافي الدخل', 'Net income'), net, net >= 0 ? T.success : T.danger, big: true),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    _group(tr('الإيرادات', 'Revenue'), revenue, T.success),
                    const SizedBox(height: 12),
                    _group(tr('المصروفات', 'Expenses'), expenses, T.danger),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Widget _totalRow(String label, dynamic v, Color c, {bool big = false}) => Row(children: [
        Expanded(child: Text(label, style: TextStyle(fontWeight: FontWeight.w800, fontSize: big ? 15 : 13))),
        Text(_money(v), style: TextStyle(fontWeight: FontWeight.w900, fontSize: big ? 20 : 15, color: c)),
      ]);

  Widget _group(String title, List<Map<String, dynamic>> rows, Color c) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          if (rows.isEmpty)
            Text(tr('لا يوجد', 'None'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))
          else
            ...rows.map((r) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(children: [
                    Expanded(child: Text((r['name'] ?? r['account']?['name'] ?? '—').toString(), style: const TextStyle(fontSize: 12.5))),
                    Text(_money(r['amount'] ?? r['total'] ?? r['balance']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: c)),
                  ]),
                )),
        ]),
      );
}
