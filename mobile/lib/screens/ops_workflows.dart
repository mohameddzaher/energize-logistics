import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// التشغيل — كشوف التخريج (Operations Workflows): قائمة بمراحلها الخمس،
/// إحصائيات علوية، تقدّم المرحلة، وشاشة تفاصيل بكل الحقول.
class OpsWorkflowsScreen extends StatefulWidget {
  const OpsWorkflowsScreen({super.key});
  @override
  State<OpsWorkflowsScreen> createState() => _OpsWorkflowsScreenState();
}

const _wfStages = {
  'draft': ('مسودة', 'Draft', T.inkFaint),
  'submitted_to_ops': ('للتشغيل', 'To Ops', T.warn),
  'ops_completed': ('اكتمل التشغيل', 'Ops done', T.info),
  'submitted_to_collections': ('للتحصيل', 'To Collections', T.violet),
  'completed': ('مكتمل', 'Completed', T.success),
};

const _wfStageOrder = ['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'];

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _OpsWorkflowsScreenState extends State<OpsWorkflowsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _stats = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  String _stage = '';
  int _page = 1;
  int _pages = 1;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('workflow:stageChanged', _onLive);
    Live.instance.on('workflow:created', _onLive);
    Live.instance.on('workflow:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('workflow:stageChanged', _onLive);
    Live.instance.off('workflow:created', _onLive);
    Live.instance.off('workflow:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final params = ['page=$_page', 'limit=40', if (_stage.isNotEmpty) 'stage=$_stage', if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}'];
      final results = await Future.wait([
        Api.instance.get('/api/workflows?${params.join('&')}'),
        Api.instance.get('/api/workflows/stats').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['workflows'] ?? []);
        _pages = ((results[0]['pages'] ?? 1) as num).toInt();
        _stats = Map<String, dynamic>.from(results[1]);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _advance(Map<String, dynamic> w) async {
    final idx = _wfStageOrder.indexOf((w['stage'] ?? 'draft').toString());
    if (idx < 0 || idx >= _wfStageOrder.length - 1) return;
    final next = _wfStageOrder[idx + 1];
    final nextMeta = _wfStages[next]!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('نقل المرحلة', 'Advance stage')),
        content: Text('${w['reportNumber'] ?? ''} → ${tr(nextMeta.$1, nextMeta.$2)}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('نقل', 'Advance'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/workflows/${w['_id']}', {'stage': next});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _detail(Map<String, dynamic> w) {
    final fields = [
      (tr('رقم الكشف', 'Report #'), w['reportNumber']),
      (tr('تاريخ الكشف', 'Report date'), _d(w['reportDate'])),
      (tr('من', 'From'), w['fromLocation']),
      (tr('إلى', 'To'), w['toLocation']),
      (tr('الفرع', 'Branch'), w['branch']),
      (tr('مالك السيارة', 'Car owner'), w['carOwner']),
      (tr('رقم السيارة', 'Car #'), w['carNumber']),
      (tr('اللوحة', 'Plate'), w['plateNumber']),
      (tr('السائق', 'Driver'), w['driverName']),
      (tr('هاتف السائق', 'Driver phone'), w['driverPhone']),
      (tr('حالة التنفيذ', 'Execution status'), w['executionStatus']),
      (tr('طريقة الدفع', 'Payment method'), w['paymentMethod']),
      (tr('قيمة الشراء', 'Purchase value'), w['purchaseValue'] != null ? '${_money(w['purchaseValue'])} ر.س' : null),
      (tr('قيمة البيع', 'Selling value'), w['sellingValue'] != null ? '${_money(w['sellingValue'])} ر.س' : null),
      (tr('رقم الفاتورة', 'Invoice #'), w['invoiceNumber']),
      (tr('تاريخ الدفع', 'Payment date'), w['paymentDate']),
      (tr('المرجع', 'Reference'), w['reference']),
    ].where((x) => (x.$2 ?? '').toString().isNotEmpty).toList();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text('${tr('كشف', 'Sheet')} ${w['reportNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 12),
            ...fields.map((f) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 130, child: Text(f.$1, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                Expanded(child: Text(f.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
              ]),
            )),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التشغيل', 'Operations')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  if (_stats.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: Row(children: [
                        Expanded(child: _statCard(tr('الإجمالي', 'Total'), '${_stats['total'] ?? 0}', T.navy)),
                        const SizedBox(width: 8),
                        Expanded(child: _statCard(tr('فواتير معلّقة', 'Pending inv.'), '${_stats['pendingInvoices'] ?? 0}', T.warn)),
                        const SizedBox(width: 8),
                        Expanded(child: _statCard(tr('قيمة الشراء', 'Purchase'), _money(_stats['sumPurchaseValue']), T.violet)),
                      ]),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: TextField(
                      onSubmitted: (v) { setState(() { _q = v; _page = 1; _loading = true; }); _load(); },
                      onChanged: (v) => _q = v,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(hintText: tr('ابحث بالكشف أو المالك ثم إدخال…', 'Search then enter…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _wfStages.entries.map((e) {
                          final selected = _stage == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _stage = selected ? '' : e.key; _page = 1; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.workspaces_outline, title: tr('لا توجد كشوف', 'No sheets'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final w = _rows[i];
                                final st = _wfStages[w['stage']] ?? ('—', '—', T.inkFaint);
                                final canAdvance = _wfStageOrder.indexOf((w['stage'] ?? 'draft').toString()) < _wfStageOrder.length - 1;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _detail(w),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((w['reportNumber'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 4),
                                        Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'}${(w['carOwner'] ?? '').toString().isNotEmpty ? ' · ${w['carOwner']}' : ''}',
                                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 6),
                                        Row(children: [
                                          if ((w['plateNumber'] ?? '').toString().isNotEmpty) Chip2(w['plateNumber'], T.navy, icon: Icons.local_shipping_outlined),
                                          const Spacer(),
                                          if (canAdvance)
                                            TextButton.icon(
                                              onPressed: () => _advance(w),
                                              icon: const Icon(Icons.arrow_forward, size: 16),
                                              label: Text(tr('نقل المرحلة', 'Advance'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                                            ),
                                        ]),
                                      ]),
                                    ),
                                  ),
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

  Widget _statCard(String label, String value, Color color) => AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        topAccent: color,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
        ]),
      );
}
