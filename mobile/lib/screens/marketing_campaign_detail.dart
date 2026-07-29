import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تفاصيل الحملة (التسويق) — الميزانية والإنفاق والعائد ومقاييسها المشتقة
/// (CTR/CPL/ROAS)، مع أنشطة الحملة.
class MarketingCampaignDetailScreen extends StatefulWidget {
  final String campaignId;
  final String name;
  const MarketingCampaignDetailScreen({super.key, required this.campaignId, required this.name});
  @override
  State<MarketingCampaignDetailScreen> createState() => _MarketingCampaignDetailScreenState();
}

const _campaignStatus = {
  'planned': ('مخططة', 'Planned', T.inkFaint),
  'active': ('نشطة', 'Active', T.success),
  'paused': ('متوقفة', 'Paused', T.warn),
  'completed': ('مكتملة', 'Completed', T.info),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _MarketingCampaignDetailScreenState extends State<MarketingCampaignDetailScreen> {
  Map<String, dynamic>? _campaign;
  List<Map<String, dynamic>> _activities = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('marketing:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('marketing:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/marketing/campaigns/${widget.campaignId}');
      if (!mounted) return;
      setState(() {
        _campaign = d['campaign'] is Map ? Map<String, dynamic>.from(d['campaign']) : {};
        _activities = _l(d['activities']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    final c = _campaign ?? {};
    final st = _campaignStatus[c['status']] ?? ('—', '—', T.inkFaint);
    final budget = _n(c['budget']), spend = _n(c['spend']);

    return AppScaffold(
      title: Text(widget.name),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 150), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: st.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((c['nameAr'] ?? c['name'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                            Chip2(tr(st.$1, st.$2), st.$3),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((c['platform'] ?? '').toString().isNotEmpty) Chip2(c['platform'].toString(), T.navy),
                            if ((c['objective'] ?? '').toString().isNotEmpty) Chip2(c['objective'].toString(), T.violet),
                            if (c['startDate'] != null) Chip2('${_d(c['startDate'])}${c['endDate'] != null ? ' ← ${_d(c['endDate'])}' : ''}', T.info, icon: Icons.event),
                          ]),
                          if ((c['description'] ?? '').toString().isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text(c['description'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // budget vs spend
                    FadeSlideIn(
                      delayMs: 40,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('الميزانية والإنفاق', 'Budget & spend'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            Text('${_money(spend)} / ${_money(budget)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                          ]),
                          const SizedBox(height: 8),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: budget > 0 ? (spend / budget).clamp(0, 1).toDouble() : 0,
                              minHeight: 10,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              color: spend > budget ? T.danger : T.success,
                            ),
                          ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // derived metrics
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 1.5,
                      children: [
                        _metric(tr('العملاء المحتملون', 'Leads'), _n(c['leads']).toStringAsFixed(0), T.success),
                        _metric('CTR %', _n(c['ctr']).toStringAsFixed(1), T.violet),
                        _metric('CPL', _money(c['cpl']), T.orange),
                        _metric(tr('الظهور', 'Impressions'), _money(c['impressions']), T.info),
                        _metric(tr('النقرات', 'Clicks'), _money(c['clicks']), T.navy),
                        _metric('ROAS', _n(c['roas']).toStringAsFixed(2), T.cyan),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Text('${tr('أنشطة الحملة', 'Campaign activities')} (${_activities.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_activities.isEmpty) EmptyState(icon: Icons.bolt_outlined, title: tr('لا توجد أنشطة', 'No activities')),
                    ..._activities.take(30).map((a) {
                      final metrics = a['metrics'] is Map ? Map<String, dynamic>.from(a['metrics']) : {};
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text((a['title'] ?? a['type'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                              Chip2(_d(a['date']), T.inkFaint, icon: Icons.event),
                            ]),
                            if (metrics.isNotEmpty && [metrics['impressions'], metrics['clicks'], metrics['leads']].any((x) => (x ?? 0) != 0)) ...[
                              const SizedBox(height: 5),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                if ((metrics['impressions'] ?? 0) != 0) Chip2('${tr('ظهور', 'Impr')}: ${metrics['impressions']}', T.info),
                                if ((metrics['clicks'] ?? 0) != 0) Chip2('${tr('نقرات', 'Clicks')}: ${metrics['clicks']}', T.violet),
                                if ((metrics['leads'] ?? 0) != 0) Chip2('${tr('عملاء', 'Leads')}: ${metrics['leads']}', T.success),
                              ]),
                            ],
                          ]),
                        ),
                      );
                    }),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _metric(String label, String value, Color color) => AppCard(
        topAccent: color,
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(label, style: const TextStyle(fontSize: 10, color: T.inkSoft, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
        ]),
      );
}
