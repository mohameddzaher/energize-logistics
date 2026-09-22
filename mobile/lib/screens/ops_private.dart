import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها بسعر بيعنا الحقيقيّ.
///
/// سعرُ البيع في سير عمل التشغيل يأتي من منصّةٍ ليست لنا وهو مساوٍ لسعر
/// الشراء — فريقُهم لا يعرف هامشَنا. فهذه الشاشةُ تقرأ الكشوفَ من موضعها
/// وتملك منها عمودًا واحدًا: سعرَ البيع، محفوظًا عندنا ولا يُرسَل إلى أحد.
/// نفسُ نقطة الويب حرفًا بحرف (/api/operations-private) — فالرقمُ واحد.
class OpsPrivateScreen extends StatefulWidget {
  const OpsPrivateScreen({super.key});
  @override
  State<OpsPrivateScreen> createState() => _OpsPrivateScreenState();
}

String _money(dynamic v) {
  if (v == null) return '—';
  final n = (v is num) ? v : num.tryParse(v.toString()) ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

class _OpsPrivateScreenState extends State<OpsPrivateScreen> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _stats = const {};
  bool _loading = true;
  String? _error;
  String _q = '';
  int _page = 1;
  int _pages = 1;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    // كلُّ ما يحدث في التشغيل يظهر هنا — نفسُ أحداث تلك الشاشة.
    Live.instance.on('workflow:bulkImported', _onLive);
    Live.instance.on('workflow:updated', _onLive);
    Live.instance.on('operationsPrivate:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('workflow:bulkImported', _onLive);
    Live.instance.off('workflow:updated', _onLive);
    Live.instance.off('operationsPrivate:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = ['page=$_page', 'limit=40', if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}'];
      final results = await Future.wait([
        Api.instance.get('/api/operations-private?${qs.join('&')}'),
        Api.instance.get('/api/operations-private/stats${_q.trim().isEmpty ? '' : '?search=${Uri.encodeQueryComponent(_q.trim())}'}')
            .catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['workflows'] ?? const []);
        _pages = ((results[0]['pages'] ?? 1) as num).toInt();
        _stats = Map<String, dynamic>.from(results[1]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// سعرُ البيع وحدَه يُعدَّل — ويصير آخرَ سعرٍ في ملفّ العميل على هذا المسار.
  Future<void> _editPrice(Map<String, dynamic> w) async {
    final ctrl = TextEditingController(
      text: (w['sellingValue'] ?? 0) == 0 ? '' : '${w['sellingValue']}',
    );
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('سعر البيع الحقيقي', 'Real selling price'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 2),
            Text('${w['reportNumber'] ?? ''} · ${w['username'] ?? ''}\n${w['fromLocation'] ?? ''} ← ${w['toLocation'] ?? ''} · ${tr('شراء', 'purchase')} ${_money(w['purchaseValue'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            TextField(controller: ctrl, keyboardType: TextInputType.number, autofocus: true,
                decoration: InputDecoration(labelText: tr('سعر البيع', 'Selling price'))),
            const SizedBox(height: 6),
            Text(tr('يُحفَظ عندنا فقط — لا يصل منصّة التشغيل. ويصير آخرَ سعرٍ لهذا المسار في ملفّ العميل.',
                    'Kept here only — never sent to the platform. Becomes the latest price for this route on the customer profile.'),
                style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 12),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final v = num.tryParse(ctrl.text.trim());
    if (v == null || v < 0) return;
    try {
      await Api.instance.put('/api/operations-private/${w['_id']}', {'sellingValue': v});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Widget _stat(String label, String value, Color tone) => Expanded(
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, maxLines: 2, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: tone)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التشغيل — خاصّ', 'Operations — private')),
      body: _loading && _rows.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 180)])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  if (_stats.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: Row(children: [
                        _stat(tr('البيع', 'Selling'), _money(_stats['sumSelling']), T.success),
                        const SizedBox(width: 8),
                        _stat(tr('الشراء', 'Purchase'), _money(_stats['sumPurchase']), T.inkSoft),
                        const SizedBox(width: 8),
                        _stat(tr('الربح', 'Profit'), _money(_stats['profit']), T.navy),
                        const SizedBox(width: 8),
                        _stat(tr('الهامش', 'Margin'), '${_stats['margin'] ?? 0}%', T.violet),
                      ]),
                    ),
                  if ((_stats['unpriced'] ?? 0) is num && (_stats['unpriced'] ?? 0) > 0)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
                        child: Text(
                          tr('${_stats['unpriced']} كشفًا بلا سعر بيع — الربح محسوبٌ على المسعَّر وحدَه.',
                              '${_stats['unpriced']} sheets with no selling price — profit counts priced rows only.'),
                          style: const TextStyle(fontSize: 11.5, color: T.warn, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: TextField(
                      onSubmitted: (v) { setState(() { _q = v; _page = 1; _loading = true; }); _load(); },
                      onChanged: (v) => _q = v,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(hintText: tr('كشف أو عميل أو مدينة…', 'Sheet, customer or city…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 70), EmptyState(icon: Icons.lock_outline, title: tr('لا كشوف', 'No sheets'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final w = _rows[i];
                                final priced = ((w['sellingValue'] ?? 0) as num) > 0;
                                final profit = w['profit'];
                                return AppCard(
                                  topAccent: priced ? T.success : T.warn,
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(child: Text('${w['username'] ?? '—'}', maxLines: 1, overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                                      Text('${w['reportNumber'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                    ]),
                                    const SizedBox(height: 3),
                                    Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'} · ${_d(w['reportDate'])}',
                                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                                    const SizedBox(height: 8),
                                    Row(children: [
                                      Chip2('${tr('شراء', 'buy')} ${_money(w['purchaseValue'])}', T.inkSoft),
                                      const SizedBox(width: 6),
                                      Pressable(
                                        onTap: () => _editPrice(w),
                                        child: Chip2(
                                          priced ? '${tr('بيع', 'sell')} ${_money(w['sellingValue'])}' : tr('بلا سعر', 'not priced'),
                                          priced ? T.success : T.warn,
                                          icon: Icons.edit_outlined,
                                        ),
                                      ),
                                      const Spacer(),
                                      if (profit != null)
                                        Text(_money(profit),
                                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13,
                                                color: (profit as num) >= 0 ? T.success : T.danger)),
                                    ]),
                                  ]),
                                );
                              },
                            ),
                    ),
                  ),
                  if (_pages > 1)
                    SafeArea(
                      top: false,
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        IconButton(onPressed: _page > 1 ? () { setState(() { _page--; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_right)),
                        Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w800)),
                        IconButton(onPressed: _page < _pages ? () { setState(() { _page++; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_left)),
                      ]),
                    ),
                ]),
    );
  }
}
