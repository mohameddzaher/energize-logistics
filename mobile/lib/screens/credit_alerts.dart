import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// تنبيهاتُ الائتمان — نظيرُ /system/credit-alerts في الموقع: العملاءُ الذين
/// قاربوا حدَّهم أو تجاوزوه، من `/api/analytics/credit-alerts` نفسِها.
/// وتُعاد قراءتُها مع كلِّ دفعةٍ أو فاتورةٍ أو تعديلِ عميل — الأخبارُ نفسُها.
class CreditAlertsScreen extends StatefulWidget {
  const CreditAlertsScreen({super.key});
  @override
  State<CreditAlertsScreen> createState() => _CreditAlertsScreenState();
}

const _events = ['payment:logged', 'invoice:created', 'customer:updated'];

String _sar(dynamic v) {
  final n = (v is num ? v : num.tryParse('${v ?? ''}') ?? 0).round();
  return 'SAR ${n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',')}';
}

String _collector(dynamic c) => c is Map ? '${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'.trim() : '';

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

class _CreditAlertsScreenState extends State<CreditAlertsScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  String _q = '';
  final _searchCtl = TextEditingController(); // النصُّ يبقى مطابقًا لـ_q
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    for (final e in _events) {
      Live.instance.on(e, _onLive);
    }
  }

  @override
  void dispose() {
    for (final e in _events) {
      Live.instance.off(e, _onLive);
    }
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/analytics/credit-alerts');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  List<Map<String, dynamic>> get _all => List<Map<String, dynamic>>.from(_d?['alerts'] ?? const []);

  List<Map<String, dynamic>> get _shown {
    final n = _fold(_q.trim());
    if (n.isEmpty) return _all;
    return _all.where((r) => _fold([r['companyName'], r['customerNumber'], r['grade'], _collector(r['assignedCollector'])].join(' ')).contains(n)).toList();
  }

  // أعمدةُ تصدير الموقع نفسُها (ExportMenu في credit-alerts/page.tsx).
  static final _cols = [
    ExportCol('العميل', 'Customer', (r) => r['companyName'] ?? ''),
    ExportCol('رقم العميل', 'Customer #', (r) => r['customerNumber'] ?? ''),
    ExportCol('حد الائتمان', 'Credit Limit', (r) => r['creditLimit'] ?? 0),
    ExportCol('المستحق', 'Outstanding', (r) => r['currentOutstanding'] ?? 0),
    ExportCol('المتبقي', 'Remaining', (r) => r['remaining'] ?? 0),
    ExportCol('نسبة الاستخدام %', 'Usage %', (r) => r['usagePercent'] ?? ''),
    ExportCol('التصنيف الائتماني', 'Grade', (r) => r['grade'] ?? ''),
    ExportCol('مدة الائتمان', 'Credit Term', (r) => r['creditTerm'] ?? ''),
    ExportCol('المحصل', 'Collector', (r) => _collector(r['assignedCollector'])),
    ExportCol('تاريخ آخر دفعة', 'Last Payment Date', (r) => '${r['lastPaymentDate'] ?? ''}'.split('T').first),
    ExportCol('مبلغ آخر دفعة', 'Last Payment Amount', (r) => r['lastPaymentAmount'] ?? ''),
  ];

  Color _usageColor(num v) => v > 100 ? T.danger : v >= 90 ? T.orange : v >= 80 ? T.warn : T.success;

  Widget _card(String label, dynamic value, String sub, Color c) => Expanded(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: c.withValues(alpha: 0.3))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: c)),
            Text('${value ?? 0}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: c)),
            Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, color: c.withValues(alpha: 0.7))),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final rows = _shown;
    return AppScaffold(
      title: Text(tr('تنبيهات الائتمان', 'Credit Alerts')),
      actions: [
        ExportButton(fileName: 'Credit_Alerts', sheetName: 'Credit Alerts', columns: _cols, rows: () => _all),
        IconButton(tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: () { setState(() => _loading = true); _load(); }),
      ],
      body: _loading && _d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null && _d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    children: [
                      Text(tr('العملاء الذين يقتربون من حد الائتمان أو تجاوزوه', 'Customers approaching or exceeding credit limits'),
                          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                      const SizedBox(height: 10),
                      Row(children: [
                        _card(tr('تجاوز الحد', 'Over Limit'), _d?['exceeded'], tr('استخدام أكثر من 100%', 'Over 100% usage'), T.danger),
                        _card(tr('قرب الحد', 'Near Limit'), _d?['nearLimit'], tr('استخدام 80-100%', '80-100% usage'), T.warn),
                        _card(tr('إجمالي التنبيهات', 'Total Alerts'), _d?['total'], tr('استخدام ائتماني 70%+', '70%+ credit usage'), T.orange),
                      ]),
                      const SizedBox(height: 10),
                      SearchField(
                        controller: _searchCtl,
                        dense: true,
                        onChanged: (v) => setState(() => _q = v),
                        hint: '${tr('بحث', 'Search')}...',
                      ),
                      const SizedBox(height: 8),
                      if (rows.isEmpty)
                        EmptyState(icon: Icons.shield_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد تنبيهات', 'No credit alerts'))
                      else
                        ...rows.map((r) {
                          final usage = (r['usagePercent'] as num?) ?? 0;
                          final remaining = (r['remaining'] as num?) ?? 0;
                          final limit = (r['creditLimit'] as num?) ?? 0;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: AppCard(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${r['companyName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                    if ('${r['customerNumber'] ?? ''}'.isNotEmpty)
                                      Text('${r['customerNumber']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ])),
                                  Chip2('${r['grade'] ?? '-'}', const {'A': T.success, 'B': T.info, 'C': T.warn, 'D': T.danger}['${r['grade']}'] ?? T.inkFaint),
                                ]),
                                const SizedBox(height: 8),
                                Row(children: [
                                  Expanded(child: ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(value: (usage / 100).clamp(0, 1).toDouble(), minHeight: 7,
                                        color: _usageColor(usage), backgroundColor: T.canvas),
                                  )),
                                  const SizedBox(width: 8),
                                  Text('$usage%', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5, color: _usageColor(usage))),
                                ]),
                                const SizedBox(height: 8),
                                _line(tr('حد الائتمان', 'Credit Limit'), _sar(limit), T.ink),
                                _line(tr('المستحق', 'Outstanding'), _sar(r['currentOutstanding']), T.danger),
                                _line(tr('المتبقي', 'Remaining'), _sar(remaining),
                                    remaining < 0 ? T.danger : remaining < limit * 0.2 ? T.warn : T.success),
                                _line(tr('مدة الائتمان', 'Credit Term'), '${r['creditTerm'] ?? 0} ${tr('يوم', 'days')}', T.ink),
                                _line(tr('المحصل', 'Collector'), _collector(r['assignedCollector']).isEmpty ? '-' : _collector(r['assignedCollector']), T.ink),
                                _line(tr('آخر دفعة', 'Last Payment'),
                                    '${r['lastPaymentDate'] ?? ''}'.isEmpty
                                        ? tr('لا توجد مدفوعات', 'No payments')
                                        : '${'${r['lastPaymentDate']}'.split('T').first}${r['lastPaymentAmount'] != null ? ' · ${_sar(r['lastPaymentAmount'])}' : ''}',
                                    T.inkSoft),
                              ]),
                            ),
                          );
                        }),
                    ],
                  ),
                ),
    );
  }

  Widget _line(String k, String v, Color c) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(children: [
          Expanded(child: Text(k, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
          Text(v, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: c)),
        ]),
      );
}
