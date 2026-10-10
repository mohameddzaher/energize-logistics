import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// المبيعات — الأداء (هدف مقابل تحقيق لكل مندوب) ومسار البيع (الصفقات
/// مجمّعة بالمرحلة). نفس بيانات /api/sales/performance و /api/sales/pipeline.

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

// ── أداء المناديب ───────────────────────────────────────────────────────────
class SalesPerformanceScreen extends StatefulWidget {
  const SalesPerformanceScreen({super.key});
  @override
  State<SalesPerformanceScreen> createState() => _SalesPerformanceScreenState();
}

class _SalesPerformanceScreenState extends State<SalesPerformanceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  // `sales:updated` نداءُ القسم: صفقةٌ تغيّرت أو هدفٌ وُضع — كما على الويب.
  @override
  void initState() { super.initState(); _load(); Live.instance.on('sales:updated', _load); }

  @override
  void dispose() { Live.instance.off('sales:updated', _load); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/sales/performance');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Color _attColor(num a) => a >= 100 ? T.success : a >= 70 ? T.info : a >= 40 ? T.warn : T.danger;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('أداء المبيعات', 'Sales Performance')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.leaderboard_outlined, title: tr('لا يوجد مناديب', 'No reps'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
                            final rep = r['rep'] is Map ? Map<String, dynamic>.from(r['rep']) : {};
                            final att = (r['attainment'] ?? 0) as num;
                            final color = _attColor(att);
                            return FadeSlideIn(
                              delayMs: (i * 20).clamp(0, 200),
                              child: AppCard(
                                topAccent: color,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    CircleAvatar(radius: 16, backgroundColor: color.withValues(alpha: 0.12), child: Text('${i + 1}', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 13))),
                                    const SizedBox(width: 10),
                                    Expanded(child: Text((rep['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Text('${att.toStringAsFixed(0)}%', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: color)),
                                  ]),
                                  const SizedBox(height: 8),
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(6),
                                    child: LinearProgressIndicator(
                                      value: (att / 100).clamp(0.0, 1.0).toDouble(),
                                      minHeight: 7,
                                      backgroundColor: color.withValues(alpha: 0.12),
                                      valueColor: AlwaysStoppedAnimation(color),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    Chip2('${tr('المحقَّق', 'Won')}: ${_money(r['wonValue'])} (${r['wonCount'] ?? 0})', T.success),
                                    Chip2('${tr('الهدف', 'Target')}: ${_money(r['target'])}', T.navy),
                                    Chip2('${tr('مفتوحة', 'Open')}: ${_money(r['openValue'])} (${r['openCount'] ?? 0})', T.info),
                                  ]),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// ── خط الأنابيب ─────────────────────────────────────────────────────────────
// ── المراحلُ كما في الخادم (config/crmDefaults PIPELINE_STAGES) ─────────────
// كانت القائمةُ هنا تبدأ بـ«lead» — مفتاحٌ لا وجودَ له — وتخلو من «new»
// و«contacted» و«won» و«lost»: فالصفقةُ الجديدةُ (وهي أوّلُ ما تُنشأ عليه) لا
// تظهر في الهاتف أصلًا، والشاشةُ تُعرَض وكأنّها كاملة.
const _pipeStages = {
  'new': ('جديدة', 'New', T.inkSoft),
  'contacted': ('تمّ التواصل', 'Contacted', T.info),
  'qualified': ('مؤهَّلة', 'Qualified', T.cyan),
  'proposal': ('عرض سعر', 'Proposal', T.violet),
  'negotiation': ('تفاوض', 'Negotiation', T.warn),
  'won': ('رابحة', 'Won', T.success),
  'lost': ('خاسرة', 'Lost', T.danger),
};

class SalesPipelineScreen extends StatefulWidget {
  const SalesPipelineScreen({super.key});
  @override
  State<SalesPipelineScreen> createState() => _SalesPipelineScreenState();
}

class _SalesPipelineScreenState extends State<SalesPipelineScreen> {
  List<Map<String, dynamic>> _deals = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); Live.instance.on('sales:updated', _load); }

  @override
  void dispose() { Live.instance.off('sales:updated', _load); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/sales/pipeline');
      if (!mounted) return;
      setState(() { _deals = List<Map<String, dynamic>>.from(d['deals'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    // تجميع الصفقات بالمرحلة.
    final byStage = <String, List<Map<String, dynamic>>>{};
    for (final d in _deals) {
      // مرحلةٌ لا تعرفها القائمةُ تُعرَض مع «جديدة» — لا تُخفى.
      final st = (d['stage'] ?? 'new').toString();
      (byStage[_pipeStages.containsKey(st) ? st : 'new'] ??= []).add(d);
    }
    return AppScaffold(
      title: Text(tr('مسار البيع', 'Pipeline')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 120)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _deals.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.view_kanban_outlined, title: tr('لا توجد صفقات', 'No deals'))])
                      : ListView(
                          padding: const EdgeInsets.all(14),
                          children: [
                            for (final entry in _pipeStages.entries)
                              if ((byStage[entry.key] ?? []).isNotEmpty) ...[
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6, top: 4),
                                  child: Row(children: [
                                    Container(width: 10, height: 10, decoration: BoxDecoration(color: entry.value.$3, shape: BoxShape.circle)),
                                    const SizedBox(width: 8),
                                    Text(tr(entry.value.$1, entry.value.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                    const SizedBox(width: 6),
                                    Chip2('${(byStage[entry.key] ?? []).length}', entry.value.$3),
                                    const Spacer(),
                                    Text('${_money((byStage[entry.key] ?? []).fold<num>(0, (s, d) => s + ((d['value'] ?? 0) as num)))} ${tr('ر.س', 'SAR')}',
                                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: entry.value.$3)),
                                  ]),
                                ),
                                ...(byStage[entry.key] ?? []).map((d) {
                                  final company = d['company'] is Map ? (Lang.instance.ar ? (d['company']['arabicName'] ?? d['company']['name']) : d['company']['name']) : null;
                                  final owner = d['owner'] is Map ? '${d['owner']['firstName'] ?? ''} ${d['owner']['lastName'] ?? ''}'.trim() : '';
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: AppCard(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((d['title'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                                          if (d['value'] != null) Text(_money(d['value']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: T.success)),
                                        ]),
                                        if ((company ?? '').toString().isNotEmpty || owner.isNotEmpty) ...[
                                          const SizedBox(height: 3),
                                          Text([if ((company ?? '').toString().isNotEmpty) company, if (owner.isNotEmpty) owner].join(' · '),
                                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                        ],
                                      ]),
                                    ),
                                  );
                                }),
                                const SizedBox(height: 8),
                              ],
                          ],
                        ),
                ),
    );
  }
}
