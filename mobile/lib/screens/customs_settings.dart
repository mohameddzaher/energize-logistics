import 'package:flutter/material.dart';
import '../resource/configs.dart' show customsCustomersCfg, customsAgentsCfg;
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'reference_data.dart' show LookupValuesScreen;
import 'collections_settings.dart' show EmailTemplateTab;
import 'package:provider/provider.dart';
import '../services/auth.dart';

/// Customs section settings, counterpart of `/system/customs/settings` on the web.
/// Three areas as on the web: dropdown lists (lists of the `customs` module plus the work-plan tasks `jp_task_customs`), customers and agents (files, not lists), and the upcoming-transactions alert period (`PUT /api/customs-clearance/settings`).
class CustomsSettingsScreen extends StatefulWidget {
  const CustomsSettingsScreen({super.key});
  @override
  State<CustomsSettingsScreen> createState() => _CustomsSettingsScreenState();
}

class _CustomsSettingsScreenState extends State<CustomsSettingsScreen> {
  String _tab = 'lists';
  List<Map<String, dynamic>> _types = [];
  bool _loadingTypes = true;
  String? _error;
  final TextEditingController _days = TextEditingController();
  bool _loadedDays = false;
  bool _savingDays = false;

  @override
  void initState() {
    super.initState();
    _loadTypes();
    _loadSettings();
  }

  @override
  void dispose() {
    _days.dispose();
    super.dispose();
  }

  Future<void> _loadTypes() async {
    try {
      final d = await Api.instance.get('/api/lookups/types');
      if (!mounted) return;
      final all = List<Map<String, dynamic>>.from(d['types'] ?? const []);
      setState(() {
        _types = all.where((t) => t['module'] == 'customs' || t['type'] == 'jp_task_customs').toList();
        _loadingTypes = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loadingTypes = false; _error = e.toString(); });
    }
  }

  Future<void> _loadSettings() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/settings');
      final s = d is Map && d['settings'] is Map ? d['settings'] as Map : const {};
      _days.text = '${s['upcomingAlertDays'] ?? 2}';
    } catch (_) {/* */}
    if (mounted) setState(() => _loadedDays = true);
  }

  Future<void> _saveDays() async {
    final n = int.tryParse(_days.text.trim());
    if (n == null) return;
    setState(() => _savingDays = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.put('/api/customs-clearance/settings', {'upcomingAlertDays': n});
      messenger.showSnackBar(SnackBar(content: Text(tr('حُفظ', 'Saved'))));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _savingDays = false);
    }
  }

  String _name(Map<String, dynamic> t) => (Lang.instance.ar ? t['nameAr'] : t['nameEn'])?.toString() ?? '${t['type'] ?? ''}';

  Widget _lists() {
    if (_loadingTypes) return const Padding(padding: EdgeInsets.all(14), child: Shimmer(height: 120));
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loadingTypes = true); _loadTypes(); });
    if (_types.isEmpty) return EmptyState(icon: Icons.list_alt_outlined, title: tr('لا قوائم', 'No lists'));
    return Column(children: [
      for (final t in _types)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Pressable(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                type: '${t['type'] ?? ''}', title: _name(t), canManage: t['canManage'] == true))),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Row(children: [
                const Icon(Icons.list_alt_outlined, color: T.navy, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(_name(t), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                if (t['canManage'] != true) const Icon(Icons.lock_outline, size: 15, color: T.inkFaint),
                Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
              ]),
            ),
          ),
        ),
    ]);
  }

  Widget _parties() => Column(children: [
        for (final c in [
          (customsCustomersCfg, Icons.people_outline, tr('عملاء التخليص', 'Customs customers'),
              tr('ملفُّ كلّ عميل: بياناتُه وسجلُّه التجاريّ وكلُّ معاملاته وأرقامُه.', 'Each customer: details, CR, all their deals and figures.')),
          (customsAgentsCfg, Icons.directions_boat_outlined, tr('وكلاء الشحن', 'Shipping agents'),
              tr('ملفُّ كلّ وكيل — والبريدُ يُملأ وحدَه في المعاملة حين يُختار.', 'Each agent — their email autofills on the transaction.')),
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Pressable(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: c.$1))),
              child: AppCard(
                child: Row(children: [
                  Icon(c.$2, color: T.orange),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(c.$3, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                      const SizedBox(height: 3),
                      Text(c.$4, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
      ]);

  Widget _alerts() => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('تنبيه المعاملات القادمة', 'Upcoming transaction alerts'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 4),
          Text(tr('قبل كم يومٍ تظهر المعاملةُ القادمة في شارة التنبيه أعلى شاشة القسم؟ وما فات موعدُه يبقى فيها.',
                  'How many days ahead should an upcoming transaction appear in the alert badge? Overdue ones stay in it.'),
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 12),
          Row(children: [
            SizedBox(
              width: 120,
              child: TextField(
                controller: _days,
                enabled: _loadedDays,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(isDense: true, labelText: tr('عدد الأيّام', 'Days ahead')),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton.icon(
              onPressed: !_loadedDays || _savingDays ? null : _saveDays,
              icon: _savingDays
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check, size: 16),
              label: Text(tr('حفظ', 'Save')),
            ),
          ]),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('إعدادات قسم التخليص الجمركي', 'Customs settings')),
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
        Text(tr('كلُّ قائمةٍ منسدلةٍ في القسم تُضبط من هنا — والتغيير يظهر فورًا', 'Every dropdown in the section is set here — changes apply at once'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 10),
        Wrap(spacing: 6, children: [
          for (final t in [
            ('lists', tr('القوائم المنسدلة', 'Dropdown lists')),
            ('parties', tr('العملاء والوكلاء', 'Customers & agents')),
            ('alerts', tr('التنبيهات', 'Alerts')),
            ('email', tr('قالب البريد', 'Email template')),
          ])
            ChoiceChip(label: Text(t.$2), selected: _tab == t.$1, onSelected: (_) => setState(() => _tab = t.$1)),
        ]),
        const SizedBox(height: 12),
        if (_tab == 'lists') _lists(),
        if (_tab == 'parties') _parties(),
        if (_tab == 'alerts') _alerts(),
        // Customer follow-up email template, sent from the customs mailbox; edited by the section heads only.
        if (_tab == 'email')
          EmailTemplateTab(
            endpoint: '/api/customs-clearance/email-template', liveEvent: 'customs:email-template', embedded: true,
            titleAr: 'قالب بريد المتابعة للعميل', titleEn: 'Customer follow-up email template',
            canEdit: const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'customs_manager'].contains(context.watch<AuthProvider>().role),
          ),
      ]),
    );
  }
}
