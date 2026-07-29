import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// المحفظة اليومية (النقدية) — محفظة الفرع اليومية: التحصيلات والمصروفات
/// والمشتريات، مع تسجيل حركة وإغلاق اليوم — /api/wallet/daily.
class CashWalletScreen extends StatefulWidget {
  const CashWalletScreen({super.key});
  @override
  State<CashWalletScreen> createState() => _CashWalletScreenState();
}

const _txTypes = {
  'collection': ('تحصيل', 'Collection', T.success, Icons.south_west),
  'expense': ('مصروف', 'Expense', T.danger, Icons.north_east),
  'purchase': ('شراء', 'Purchase', T.orange, Icons.shopping_bag_outlined),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

class _CashWalletScreenState extends State<CashWalletScreen> {
  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _transactions = [];
  bool _loading = true;
  String? _error;
  DateTime _date = DateTime.now();
  late final void Function() _onLive;

  String get _dateKey => '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('wallet:transaction', _onLive);
    Live.instance.on('wallet:dayClosed', _onLive);
    Live.instance.on('wallet:dayReopened', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('wallet:transaction', _onLive);
    Live.instance.off('wallet:dayClosed', _onLive);
    Live.instance.off('wallet:dayReopened', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/wallet/daily?date=$_dateKey');
      if (!mounted) return;
      setState(() {
        _wallet = d['wallet'] is Map ? Map<String, dynamic>.from(d['wallet']) : {};
        _transactions = List<Map<String, dynamic>>.from(d['transactions'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  Future<void> _addTransaction() async {
    String type = 'collection';
    final amount = TextEditingController();
    final desc = TextEditingController();
    final dsNumber = TextEditingController();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('حركة نقدية', 'Cash entry'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: _txTypes.entries.map((e) => ButtonSegment(value: e.key, label: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontSize: 11.5)), icon: Icon(e.value.$4, size: 15))).toList(),
                selected: {type},
                onSelectionChanged: (s) => setS(() => type = s.first),
              ),
              const SizedBox(height: 12),
              TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ *', 'Amount *'))),
              const SizedBox(height: 10),
              if (type == 'collection' || type == 'purchase')
                TextField(controller: dsNumber, decoration: InputDecoration(labelText: tr('رقم كشف التخريج (يربط تلقائيًا)', 'Delivery statement # (auto-links)'))),
              if (type == 'collection' || type == 'purchase') const SizedBox(height: 10),
              TextField(controller: desc, decoration: InputDecoration(labelText: tr('البيان / الوصف', 'Description'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if ((num.tryParse(amount.text) ?? 0) <= 0) return;
                    final body = <String, dynamic>{
                      'type': type,
                      'amount': num.tryParse(amount.text),
                      'date': _dateKey,
                      if (desc.text.trim().isNotEmpty) 'description': desc.text.trim(),
                    };
                    if (type == 'collection' && dsNumber.text.trim().isNotEmpty) body['deliveryStatementNumber'] = dsNumber.text.trim();
                    if (type == 'purchase' && dsNumber.text.trim().isNotEmpty) body['purchaseDeliveryStatementNumber'] = dsNumber.text.trim();
                    try {
                      await Api.instance.post('/api/wallet/transactions', body);
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل', 'Record')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  Future<void> _closeDay() async {
    final actualCash = TextEditingController(text: _n(_wallet?['closingBalance']).toStringAsFixed(0));
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إغلاق اليوم', 'Close day')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('${tr('الرصيد المتوقع', 'Expected')}: ${_money(_wallet?['closingBalance'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 10),
          TextField(controller: actualCash, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('النقد الفعلي', 'Actual cash'))),
          const SizedBox(height: 10),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('سبب الفرق (إن وُجد)', 'Difference reason'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إغلاق', 'Close'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/wallet/close-day', {
        'date': _dateKey,
        if (actualCash.text.trim().isNotEmpty) 'actualCash': num.tryParse(actualCash.text),
        if (reason.text.trim().isNotEmpty) 'differenceReason': reason.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = _wallet ?? {};
    final closed = w['isClosed'] == true;

    return AppScaffold(
      title: Text(tr('المحفظة اليومية', 'Daily Wallet')),
      floatingActionButton: closed
          ? null
          : FloatingActionButton.extended(onPressed: _addTransaction, icon: const Icon(Icons.add), label: Text(tr('حركة', 'Entry'))),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // date picker
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final v = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2024), lastDate: DateTime.now());
                            if (v != null) { setState(() { _date = v; _loading = true; }); _load(); }
                          },
                          icon: const Icon(Icons.event, size: 17),
                          label: Text(_dateKey, style: const TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Chip2(closed ? tr('مُغلق', 'Closed') : tr('مفتوح', 'Open'), closed ? T.inkFaint : T.success),
                    ]),
                    const SizedBox(height: 12),
                    // wallet summary
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: closed ? T.inkFaint : T.navy,
                        child: Column(children: [
                          Text(tr('الرصيد الختامي', 'Closing balance'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text('${_money(w['closingBalance'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                          const SizedBox(height: 12),
                          Row(children: [
                            _sumCol(tr('افتتاحي', 'Opening'), _money(w['openingBalance']), T.inkFaint),
                            _sumCol(tr('تحصيلات', 'Collections'), _money(w['totalCollections']), T.success),
                            _sumCol(tr('مصروفات', 'Expenses'), _money(w['totalExpenses']), T.danger),
                            _sumCol(tr('مشتريات', 'Purchases'), _money(w['totalPurchases']), T.orange),
                          ]),
                          if (w['actualCash'] != null) ...[
                            const Divider(height: 18),
                            Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                              Text('${tr('الفعلي', 'Actual')}: ${_money(w['actualCash'])}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                              Text('${tr('الفرق', 'Diff')}: ${_money(w['cashDifference'])}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _n(w['cashDifference']) == 0 ? T.success : T.danger)),
                            ]),
                          ],
                        ]),
                      ),
                    ),
                    if (!closed) ...[
                      const SizedBox(height: 10),
                      SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: _closeDay, icon: const Icon(Icons.lock_outline, size: 17), label: Text(tr('إغلاق اليوم', 'Close day')))),
                    ],
                    const SizedBox(height: 14),
                    Text('${tr('الحركات', 'Transactions')} (${_transactions.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_transactions.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد حركات', 'No transactions')),
                    ..._transactions.map((t) {
                      final ty = _txTypes[t['type']] ?? ('—', '—', T.inkFaint, Icons.help_outline);
                      final isIn = t['type'] == 'collection';
                      final label = t['customer'] is Map ? (t['customer']['companyName'] ?? '') : (t['description'] ?? t['itemName'] ?? t['vendorName'] ?? '');
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(children: [
                            Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: ty.$3.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)), child: Icon(ty.$4, size: 17, color: ty.$3)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(label.toString().isEmpty ? tr(ty.$1, ty.$2) : label.toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                Text('${tr(ty.$1, ty.$2)}${(t['deliveryStatementNumber'] ?? '').toString().isNotEmpty ? ' · ${t['deliveryStatementNumber']}' : ''}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                              ]),
                            ),
                            Text('${isIn ? '+' : '−'}${_money(t['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: ty.$3)),
                          ]),
                        ),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _sumCol(String label, String value, Color color) => Expanded(
        child: Column(children: [
          Text(label, style: const TextStyle(fontSize: 9.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
          Text(value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: color)),
        ]),
      );
}
