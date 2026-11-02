import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import 'crm_form.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'jp.dart' show JpTaskPanel;

/// Marketing campaign details: budget, spend, return and derived metrics (CTR/CPL/ROAS), with the campaign's activities.
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

// Marketing roles as on the web (lib/marketing.ts); editing needs canEditMarketing.
const _mktAdminRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist', 'bd_manager'];
bool canEditMarketing(AuthProvider a) => _mktAdminRoles.contains(a.role) || a.canEditSection('Marketing');

const _platforms = <(String, String, String)>[
  ('facebook', 'فيسبوك', 'Facebook'), ('instagram', 'إنستغرام', 'Instagram'), ('twitter', 'إكس / تويتر', 'X / Twitter'),
  ('linkedin', 'لينكد إن', 'LinkedIn'), ('tiktok', 'تيك توك', 'TikTok'), ('snapchat', 'سناب شات', 'Snapchat'),
  ('google_ads', 'إعلانات جوجل', 'Google Ads'), ('youtube', 'يوتيوب', 'YouTube'), ('website', 'الموقع الإلكتروني', 'Website'),
  ('email', 'البريد الإلكتروني', 'Email'), ('whatsapp', 'واتساب', 'WhatsApp'), ('offline', 'خارج الإنترنت', 'Offline'), ('other', 'أخرى', 'Other'),
];
const _objectives = <(String, String, String)>[
  ('awareness', 'الوعي بالعلامة', 'Awareness'), ('leads', 'جذب عملاء محتملين', 'Leads'), ('engagement', 'التفاعل', 'Engagement'),
  ('traffic', 'زيارات الموقع', 'Traffic'), ('sales', 'المبيعات', 'Sales'), ('recruitment', 'التوظيف', 'Recruitment'), ('other', 'أخرى', 'Other'),
];
const _statuses = <(String, String, String)>[
  ('planned', 'مخططة', 'Planned'), ('active', 'نشطة', 'Active'), ('paused', 'متوقفة مؤقتاً', 'Paused'),
  ('completed', 'مكتملة', 'Completed'), ('cancelled', 'ملغاة', 'Cancelled'),
];

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

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  /// Edit campaign: same fields as the web edit page (PUT /campaigns/:id).
  Future<void> _edit() async {
    final c = Map<String, dynamic>.from(_campaign ?? {});
    await showCrmForm(
      context,
      title: tr('تعديل الحملة', 'Edit campaign'),
      initial: c,
      fields: const [
        CrmField('name', 'اسم الحملة (إنجليزي)', 'Campaign name (EN)', required: true),
        CrmField('nameAr', 'اسم الحملة (عربي)', 'Campaign name (AR)'),
        CrmField('platform', 'المنصة', 'Platform', kind: CrmFieldKind.select, options: _platforms),
        CrmField('objective', 'الهدف', 'Objective', kind: CrmFieldKind.select, options: _objectives),
        CrmField('status', 'الحالة', 'Status', kind: CrmFieldKind.select, options: _statuses),
        CrmField('targetAudience', 'الجمهور المستهدف', 'Target audience'),
        CrmField('startDate', 'تاريخ البداية', 'Start date', kind: CrmFieldKind.date),
        CrmField('endDate', 'تاريخ النهاية', 'End date', kind: CrmFieldKind.date),
        CrmField('budget', 'الميزانية', 'Budget', kind: CrmFieldKind.number),
        CrmField('spend', 'الإنفاق', 'Spend', kind: CrmFieldKind.number),
        CrmField('revenue', 'الإيراد', 'Revenue', kind: CrmFieldKind.number),
        CrmField('impressions', 'مرات الظهور', 'Impressions', kind: CrmFieldKind.number),
        CrmField('reach', 'الوصول', 'Reach', kind: CrmFieldKind.number),
        CrmField('clicks', 'النقرات', 'Clicks', kind: CrmFieldKind.number),
        CrmField('engagements', 'التفاعلات', 'Engagements', kind: CrmFieldKind.number),
        CrmField('leads', 'العملاء المحتملون', 'Leads', kind: CrmFieldKind.number),
        CrmField('conversions', 'التحويلات', 'Conversions', kind: CrmFieldKind.number),
        CrmField('description', 'الوصف', 'Description', kind: CrmFieldKind.multiline),
        CrmField('notes', 'ملاحظات', 'Notes', kind: CrmFieldKind.multiline),
      ],
      onSave: (v) async {
        final body = <String, dynamic>{...c, ...v};
        body.remove('_id');
        if (body['owner'] is Map) body['owner'] = body['owner']['_id'];
        try {
          await Api.instance.put('/api/marketing/campaigns/${widget.campaignId}', body);
          await _load();
          return null;
        } catch (e) { return e is ApiException ? e.message : e.toString(); }
      },
    );
  }

  /// Delete from the campaign page; its activities and figures are deleted with it.
  Future<void> _remove() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف الحملة', 'Delete campaign')),
      content: Text(tr('حذف هذه الحملة نهائيًّا؟ تُحذف معها أنشطتها وأرقامها.', 'Delete this campaign permanently? Its activities and numbers go with it.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/marketing/campaigns/${widget.campaignId}');
      if (mounted) Navigator.pop(context);
    } catch (e) { if (mounted) _snack(e is ApiException ? e.message : e.toString()); }
  }

  String _lbl(List<(String, String, String)> l, dynamic k) {
    for (final o in l) { if (o.$1 == '$k') return tr(o.$2, o.$3); }
    return '${k ?? ''}';
  }

  /// Full campaign file: data and figures on one sheet, activities on another.
  void _export() {
    final c = _campaign ?? {};
    final brief = <Map<String, dynamic>>[
      for (final e in <(String, String, dynamic)>[
        ('الاسم', 'Name', c['name']), ('الاسم العربي', 'Arabic name', c['nameAr']),
        ('المنصة', 'Platform', _lbl(_platforms, c['platform'])), ('الهدف', 'Objective', _lbl(_objectives, c['objective'])),
        ('الحالة', 'Status', _lbl(_statuses, c['status'])), ('الجمهور المستهدف', 'Target audience', c['targetAudience']),
        ('تاريخ البداية', 'Start date', c['startDate']), ('تاريخ النهاية', 'End date', c['endDate']),
        ('الميزانية', 'Budget', c['budget']), ('الإنفاق', 'Spend', c['spend']), ('الإيراد', 'Revenue', c['revenue']),
        ('مرات الظهور', 'Impressions', c['impressions']), ('الوصول', 'Reach', c['reach']), ('النقرات', 'Clicks', c['clicks']),
        ('التفاعلات', 'Engagements', c['engagements']), ('العملاء المحتملون', 'Leads', c['leads']), ('التحويلات', 'Conversions', c['conversions']),
        ('CTR %', 'CTR %', c['ctr']), ('CPL', 'CPL', c['cpl']), ('ROAS', 'ROAS', c['roas']),
        ('الوصف', 'Description', c['description']), ('ملاحظات', 'Notes', c['notes']),
      ]) {'k': tr(e.$1, e.$2), 'v': e.$3},
    ];
    exportExcel(context, fileName: 'campaign-${'${c['name'] ?? widget.campaignId}'.toLowerCase().replaceAll(RegExp(r'\s+'), '-')}', sheets: [
      (tr('الحملة', 'Campaign'), [ExportCol('البند', 'Field', (r) => r['k']), ExportCol('القيمة', 'Value', (r) => r['v'])], brief),
      if (_activities.isNotEmpty)
        (tr('أنشطة الحملة', 'Activities'), [
          ExportCol('التاريخ', 'Date', (r) => _d(r['date'])),
          ExportCol('العنوان', 'Title', (r) => r['title'] ?? r['type']),
          ExportCol('النوع', 'Type', (r) => r['type']),
          ExportCol('المنصة', 'Platform', (r) => _lbl(_platforms, r['platform'])),
          ExportCol('مرات الظهور', 'Impressions', (r) => r['metrics'] is Map ? r['metrics']['impressions'] : null),
          ExportCol('النقرات', 'Clicks', (r) => r['metrics'] is Map ? r['metrics']['clicks'] : null),
          ExportCol('العملاء المحتملون', 'Leads', (r) => r['metrics'] is Map ? r['metrics']['leads'] : null),
          ExportCol('الإنفاق', 'Spend', (r) => r['spend']),
        ], _activities),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final c = _campaign ?? {};
    final st = _campaignStatus[c['status']] ?? ('—', '—', T.inkFaint);
    final budget = _n(c['budget']), spend = _n(c['spend']);

    final canEdit = canEditMarketing(context.watch<AuthProvider>());
    return AppScaffold(
      title: Text(widget.name),
      actions: [
        if (_campaign != null) IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), onPressed: _export, icon: const Icon(Icons.file_download_outlined)),
        if (_campaign != null && canEdit) IconButton(tooltip: tr('تعديل', 'Edit'), onPressed: _edit, icon: const Icon(Icons.edit_outlined)),
        if (_campaign != null && canEdit) IconButton(tooltip: tr('حذف الحملة', 'Delete campaign'), onPressed: _remove, icon: const Icon(Icons.delete_outline)),
      ],
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
                    const SizedBox(height: 12),
                    JpTaskPanel(section: 'marketing', kind: 'campaign', refId: '${c['_id'] ?? widget.campaignId}'),
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
