import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملف الشركة (CRM) — نفس صفحة الويب: بيانات الشركة، جهات الاتصال،
/// الصفقات بمراحلها، المهام، وسجل الأنشطة.
class CrmCompanyProfileScreen extends StatefulWidget {
  final String companyId;
  final String name;
  const CrmCompanyProfileScreen({super.key, required this.companyId, required this.name});
  @override
  State<CrmCompanyProfileScreen> createState() => _CrmCompanyProfileScreenState();
}

const _dealStages = {
  'new': ('جديدة', 'New', T.info),
  'contacted': ('تم التواصل', 'Contacted', T.cyan),
  'qualified': ('مؤهلة', 'Qualified', T.violet),
  'proposal': ('عرض سعر', 'Proposal', T.warn),
  'negotiation': ('تفاوض', 'Negotiation', T.orange),
  'won': ('مكسوبة', 'Won', T.success),
  'lost': ('خاسرة', 'Lost', T.danger),
};

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}

class _CrmCompanyProfileScreenState extends State<CrmCompanyProfileScreen> {
  Map<String, dynamic>? _d0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('crm:company', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('crm:company', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/crm/companies/${widget.companyId}');
      if (!mounted) return;
      setState(() { _d0 = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final company = _d0?['company'] is Map ? Map<String, dynamic>.from(_d0!['company']) : <String, dynamic>{};
    final contacts = _l(_d0?['contacts']);
    final deals = _l(_d0?['deals']);
    final tasks = _l(_d0?['tasks']);
    final activities = _l(_d0?['activities']);

    return AppScaffold(
      title: Text(widget.name),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text((company['name'] ?? widget.name).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((company['status'] ?? '').toString().isNotEmpty) Chip2(company['status'].toString(), T.info),
                            if ((company['industry'] ?? '').toString().isNotEmpty) Chip2(company['industry'].toString(), T.violet),
                            if ((company['city'] ?? '').toString().isNotEmpty) Chip2(company['city'].toString(), T.navy, icon: Icons.location_on_outlined),
                            if (company['rating'] != null) Chip2('★ ${company['rating']}', T.orange),
                          ]),
                          const SizedBox(height: 8),
                          ...[
                            (Icons.phone_outlined, company['phone']),
                            (Icons.email_outlined, company['email']),
                            (Icons.language_outlined, company['website']),
                            (Icons.notes_outlined, company['notes']),
                          ].where((x) => (x.$2 ?? '').toString().isNotEmpty).map((x) => Padding(
                                padding: const EdgeInsets.only(bottom: 5),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Icon(x.$1, size: 15, color: T.inkFaint),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(x.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                                ]),
                              )),
                        ]),
                      ),
                    ),
                    if (contacts.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('${tr('جهات الاتصال', 'Contacts')} (${contacts.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ...contacts.map((c) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(children: [
                            CircleAvatar(radius: 15, backgroundColor: T.navy.withValues(alpha: 0.1), child: const Icon(Icons.person_outline, size: 17, color: T.navy)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text((c['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                Text([c['position'], c['phone'], c['email']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                    style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                              ]),
                            ),
                          ]),
                        ),
                      )),
                    ],
                    if (deals.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('${tr('الصفقات', 'Deals')} (${deals.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ...deals.map((d) {
                        final st = _dealStages[d['stage']] ?? ('—', '—', T.inkFaint);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            topAccent: st.$3,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Row(children: [
                              Expanded(child: Text((d['title'] ?? d['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                              if (d['value'] != null) Chip2('${d['value']} ${tr('ر.س', 'SAR')}', T.navy),
                              const SizedBox(width: 6),
                              Chip2(tr(st.$1, st.$2), st.$3),
                            ]),
                          ),
                        );
                      }),
                    ],
                    if (tasks.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('${tr('المهام', 'Tasks')} (${tasks.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ...tasks.map((t) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(children: [
                            Icon(t['status'] == 'done' ? Icons.check_circle : Icons.radio_button_unchecked, size: 17, color: t['status'] == 'done' ? T.success : T.warn),
                            const SizedBox(width: 8),
                            Expanded(child: Text((t['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                            if (t['dueDate'] != null) Chip2(_d(t['dueDate']), T.info, icon: Icons.event),
                          ]),
                        ),
                      )),
                    ],
                    if (activities.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('${tr('سجل الأنشطة', 'Activity log')} (${activities.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ...activities.take(20).map((a) => Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Column(children: [
                            Container(width: 10, height: 10, decoration: const BoxDecoration(color: T.orange, shape: BoxShape.circle)),
                            Container(width: 2, height: 38, color: T.navy.withValues(alpha: 0.1)),
                          ]),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('${a['type'] ?? ''} — ${a['subject'] ?? a['notes'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 2, overflow: TextOverflow.ellipsis),
                              Text(_d(a['date'] ?? a['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                            ]),
                          ),
                        ]),
                      )),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
