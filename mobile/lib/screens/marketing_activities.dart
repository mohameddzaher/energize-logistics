import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// أنشطة التسويق — منشورات وإعلانات وحملات عبر المنصات، بمقاييسها
/// (ظهور/نقرات/عملاء محتملون) — إنشاء وعرض مع الفلاتر.
class MarketingActivitiesScreen extends StatefulWidget {
  const MarketingActivitiesScreen({super.key});
  @override
  State<MarketingActivitiesScreen> createState() => _MarketingActivitiesScreenState();
}

const _platforms = {
  'facebook': ('فيسبوك', 'Facebook'),
  'instagram': ('إنستغرام', 'Instagram'),
  'twitter': ('تويتر / X', 'Twitter / X'),
  'linkedin': ('لينكدإن', 'LinkedIn'),
  'tiktok': ('تيك توك', 'TikTok'),
  'snapchat': ('سناب شات', 'Snapchat'),
  'google_ads': ('إعلانات جوجل', 'Google Ads'),
  'youtube': ('يوتيوب', 'YouTube'),
  'website': ('الموقع', 'Website'),
  'email': ('البريد', 'Email'),
  'whatsapp': ('واتساب', 'WhatsApp'),
  'offline': ('خارج الإنترنت', 'Offline'),
  'other': ('أخرى', 'Other'),
};

const _actTypes = {
  'post': ('منشور', 'Post'),
  'story': ('ستوري', 'Story'),
  'reel': ('ريل', 'Reel'),
  'video': ('فيديو', 'Video'),
  'ad': ('إعلان', 'Ad'),
  'article': ('مقال', 'Article'),
  'email': ('بريد', 'Email'),
  'event': ('فعالية', 'Event'),
  'design': ('تصميم', 'Design'),
  'other': ('أخرى', 'Other'),
};

class _MarketingActivitiesScreenState extends State<MarketingActivitiesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _platform = '';
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
      final qs = _platform.isEmpty ? '' : '?platform=$_platform';
      final d = await Api.instance.get('/api/marketing/activities$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
  }

  Future<void> _create() async {
    final title = TextEditingController();
    final description = TextEditingController();
    final impressions = TextEditingController();
    final clicks = TextEditingController();
    final leads = TextEditingController();
    String platform = 'instagram';
    String type = 'post';
    DateTime date = DateTime.now();
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('نشاط تسويقي جديد', 'New activity'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final v = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2023), lastDate: DateTime.now().add(const Duration(days: 30)));
                  if (v != null) setS(() => date = v);
                },
                icon: const Icon(Icons.event, size: 17),
                label: Text('${tr('التاريخ', 'Date')}: ${date.day}/${date.month}/${date.year}'),
              ),
              const SizedBox(height: 10),
              TextField(controller: title, decoration: InputDecoration(labelText: tr('العنوان', 'Title'))),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: platform, isExpanded: true,
                    decoration: InputDecoration(labelText: tr('المنصة', 'Platform')),
                    items: _platforms.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2), overflow: TextOverflow.ellipsis))).toList(),
                    onChanged: (v) => setS(() => platform = v ?? platform),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: type, isExpanded: true,
                    decoration: InputDecoration(labelText: tr('النوع', 'Type')),
                    items: _actTypes.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2), overflow: TextOverflow.ellipsis))).toList(),
                    onChanged: (v) => setS(() => type = v ?? type),
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: description, maxLines: 2, decoration: InputDecoration(labelText: tr('الوصف', 'Description'))),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: impressions, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('ظهور', 'Impressions'), isDense: true))),
                const SizedBox(width: 6),
                Expanded(child: TextField(controller: clicks, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('نقرات', 'Clicks'), isDense: true))),
                const SizedBox(width: 6),
                Expanded(child: TextField(controller: leads, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('عملاء', 'Leads'), isDense: true))),
              ]),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    try {
                      await Api.instance.post('/api/marketing/activities', {
                        'date': '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
                        'platform': platform, 'type': type,
                        if (title.text.trim().isNotEmpty) 'title': title.text.trim(),
                        if (description.text.trim().isNotEmpty) 'description': description.text.trim(),
                        'metrics': {
                          'impressions': num.tryParse(impressions.text) ?? 0,
                          'clicks': num.tryParse(clicks.text) ?? 0,
                          'leads': num.tryParse(leads.text) ?? 0,
                        },
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['title'], r['description'], r['campaign'] is Map ? r['campaign']['name'] : '']
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('أنشطة التسويق', 'Marketing Activities')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.add),
        label: Text(tr('نشاط', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _platforms.entries.take(8).map((e) {
                          final selected = _platform == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _platform = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : T.navy),
                              selectedColor: T.navy,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
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
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.campaign_outlined, title: tr('لا توجد أنشطة', 'No activities'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final metrics = r['metrics'] is Map ? Map<String, dynamic>.from(r['metrics']) : {};
                                final plat = _platforms[r['platform']];
                                final ty = _actTypes[r['type']];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: T.violet,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((r['title'] ?? (ty != null ? tr(ty.$1, ty.$2) : '—')).toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(_d(r['date']), T.inkFaint, icon: Icons.event),
                                      ]),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if (plat != null) Chip2(tr(plat.$1, plat.$2), T.navy),
                                        if (ty != null) Chip2(tr(ty.$1, ty.$2), T.cyan),
                                        if (r['campaign'] is Map) Chip2((r['campaign']['name'] ?? '').toString(), T.orange, icon: Icons.flag_outlined),
                                      ]),
                                      if (metrics.isNotEmpty && [metrics['impressions'], metrics['clicks'], metrics['leads']].any((x) => (x ?? 0) != 0)) ...[
                                        const SizedBox(height: 6),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if ((metrics['impressions'] ?? 0) != 0) Chip2('${tr('ظهور', 'Impr')}: ${metrics['impressions']}', T.info),
                                          if ((metrics['clicks'] ?? 0) != 0) Chip2('${tr('نقرات', 'Clicks')}: ${metrics['clicks']}', T.violet),
                                          if ((metrics['leads'] ?? 0) != 0) Chip2('${tr('عملاء', 'Leads')}: ${metrics['leads']}', T.success),
                                        ]),
                                      ],
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
