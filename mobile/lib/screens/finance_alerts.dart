import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تنبيهات الائتمان والمتأخرات — العملاء قرب/تجاوز حد الائتمان،
/// والفواتير المتأخرة السداد، من نقاط نهاية التحليلات.

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _customerName(dynamic c) => c is Map ? (c['companyName'] ?? '—').toString() : (c ?? '—').toString();
String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

// ── تنبيهات الائتمان ────────────────────────────────────────────────────────
class CreditAlertsScreen extends StatefulWidget {
  const CreditAlertsScreen({super.key});
  @override
  State<CreditAlertsScreen> createState() => _CreditAlertsScreenState();
}

class _CreditAlertsScreenState extends State<CreditAlertsScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _exceeded = 0, _nearLimit = 0;
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
      final d = await Api.instance.get('/api/analytics/credit-alerts');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['alerts'] ?? []);
        _exceeded = ((d['exceeded'] ?? 0) as num).toInt();
        _nearLimit = ((d['nearLimit'] ?? 0) as num).toInt();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تنبيهات الائتمان', 'Credit Alerts')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: Row(children: [
                      Expanded(child: StatCard(label: tr('تجاوزوا الحد', 'Exceeded'), value: _exceeded, color: T.danger, icon: Icons.error_outline)),
                      const SizedBox(width: 10),
                      Expanded(child: StatCard(label: tr('قرب الحد', 'Near limit'), value: _nearLimit, color: T.warn, icon: Icons.warning_amber_outlined)),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.verified_user_outlined, title: tr('لا توجد تنبيهات ائتمان 👌', 'No credit alerts 👌'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final a = _rows[i];
                                final pct = ((a['usagePercent'] ?? 0) as num).toDouble();
                                final exceeded = a['isExceeded'] == true;
                                final color = exceeded ? T.danger : pct >= 90 ? T.orange : T.warn;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: color,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((a['companyName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2('${pct.round()}%', color),
                                      ]),
                                      const SizedBox(height: 6),
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(4),
                                        child: LinearProgressIndicator(
                                          value: (pct / 100).clamp(0, 1).toDouble(),
                                          minHeight: 8,
                                          backgroundColor: color.withValues(alpha: 0.1),
                                          color: color,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        Chip2('${tr('المستحق', 'Outstanding')}: ${_money(a['currentOutstanding'])}', T.danger),
                                        Chip2('${tr('الحد', 'Limit')}: ${_money(a['creditLimit'])}', T.info),
                                        Chip2('${tr('المتبقي', 'Remaining')}: ${_money(a['remaining'])}', a['remaining'] != null && (a['remaining'] as num) < 0 ? T.danger : T.success),
                                      ]),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}

// ── الفواتير المتأخرة ───────────────────────────────────────────────────────
class OverdueScreen extends StatefulWidget {
  const OverdueScreen({super.key});
  @override
  State<OverdueScreen> createState() => _OverdueScreenState();
}

class _OverdueScreenState extends State<OverdueScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
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
      final d = await Api.instance.get('/api/analytics/overdue');
      if (!mounted) return;
      final rows = d['invoices'] ?? d['overdue'] ?? (d is List ? d : []);
      setState(() { _rows = List<Map<String, dynamic>>.from(rows as List); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  int _daysLate(dynamic due) {
    final d = due != null ? DateTime.tryParse(due.toString()) : null;
    if (d == null) return 0;
    return DateTime.now().difference(d).inDays;
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['invoiceNumber'], _customerName(r['customer'])].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();
    final total = filtered.fold<num>(0, (s, r) => s + ((r['balance'] ?? r['amount'] ?? 0) as num));

    return AppScaffold(
      title: Text(tr('الفواتير المتأخرة', 'Overdue Invoices')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالفاتورة أو العميل…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                        suffixText: '${_money(total)} ${tr('ر.س', 'SAR')}',
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.event_available_outlined, title: tr('لا توجد فواتير متأخرة 👌', 'No overdue invoices 👌'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final late = _daysLate(r['dueDate']);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: late > 60 ? T.danger : T.orange,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(_customerName(r['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2('$late ${tr('يوم تأخير', 'd late')}', late > 60 ? T.danger : T.orange),
                                      ]),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        Chip2((r['invoiceNumber'] ?? '').toString(), T.navy),
                                        Chip2('${tr('متبقي', 'Balance')}: ${_money(r['balance'] ?? r['amount'])}', T.danger),
                                        Chip2('${tr('استحقاق', 'Due')}: ${_d(r['dueDate'])}', T.inkFaint, icon: Icons.event),
                                      ]),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
