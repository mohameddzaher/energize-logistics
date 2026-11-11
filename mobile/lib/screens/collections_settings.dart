import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../resource/configs.dart' show collectionsCanEdit, collectionsCustomersCfg, collectionsSuppliersCfg;
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ops_workflows.dart';
import 'reference_data.dart' show LookupValuesScreen;

/// Collections section settings, like the web page /system/collections-dept/settings: the section's dropdown lists, registers, and the account statement email template.
class CollectionsSettingsScreen extends StatefulWidget {
  const CollectionsSettingsScreen({super.key});
  @override
  State<CollectionsSettingsScreen> createState() => _CollectionsSettingsScreenState();
}

class _CollectionsSettingsScreenState extends State<CollectionsSettingsScreen> {
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: AppScaffold(
        title: Text(tr('إعدادات قسم التحصيل', 'Collections settings')),
        appBarBottom: TabBar(
          isScrollable: true,
          labelColor: T.orange,
          indicatorColor: T.orange,
          tabs: [
            Tab(icon: const Icon(Icons.sell_outlined, size: 18), text: tr('القوائم المنسدلة', 'Dropdown lists')),
            Tab(icon: const Icon(Icons.people_outline, size: 18), text: tr('السجلّات', 'Registers')),
            Tab(icon: const Icon(Icons.mail_outline, size: 18), text: tr('قالب البريد', 'Email template')),
          ],
        ),
        body: const TabBarView(children: [_ListsTab(), _RegistersTab(), EmailTemplateTab()]),
      ),
    );
  }
}

/// Lists of this section only, not the whole system (module=collections, plus the section's JP task list, like ReferenceDataManager on the web).
class _ListsTab extends StatefulWidget {
  const _ListsTab();
  @override
  State<_ListsTab> createState() => _ListsTabState();
}

class _ListsTabState extends State<_ListsTab> {
  List<Map<String, dynamic>> _types = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/lookups/types');
      if (!mounted) return;
      setState(() {
        _types = List<Map<String, dynamic>>.from(d['types'] ?? const [])
            .where((t) => t['module'] == 'collections' || t['type'] == 'jp_task_collections').toList();
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _name(Map<String, dynamic> t) => '${(Lang.instance.ar ? t['nameAr'] : t['nameEn']) ?? t['type'] ?? ''}';

  @override
  Widget build(BuildContext context) {
    if (_loading) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 50), SizedBox(height: 8), Shimmer(height: 50)]);
    if (_error != null) return ErrorRetry(message: _error!, onRetry: _load);
    if (_types.isEmpty) return EmptyState(icon: Icons.list_alt_outlined, title: tr('لا قوائم', 'No lists'));
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text(tr('كلُّ قائمةٍ منسدلةٍ في القسم تُضبط من هنا — والتغيير يظهر فورًا', 'Every dropdown in the section is set here — changes apply at once'),
          style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
      const SizedBox(height: 10),
      for (final t in _types)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Pressable(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                type: '${t['type'] ?? ''}', title: _name(t), canManage: t['canManage'] == true))),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Row(children: [
                const Icon(Icons.sell_outlined, color: T.orange, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(_name(t), style: const TextStyle(fontWeight: FontWeight.w700))),
                const Icon(Icons.chevron_right, color: T.inkFaint),
              ]),
            ),
          ),
        ),
    ]);
  }
}

class _RegistersTab extends StatelessWidget {
  const _RegistersTab();
  @override
  Widget build(BuildContext context) {
    final cards = <(IconData, String, String, String, String, Widget Function())>[
      (Icons.people_outline, 'العملاء', 'Customers',
        'مَن نحصّل منهم: بياناتُهم وشروطُ سدادهم وكلُّ كشوفهم وما بقي لنا عندهم.', 'Who we collect from: details, terms, all their reports and what is still due.',
        () => ResourceScreen(config: collectionsCustomersCfg)),
      (Icons.local_shipping_outlined, 'الموردون', 'Suppliers',
        'مَن نسدّد لهم: الآيبانُ والسجلُّ التجاريُّ ومحاسبُ المورّد وما بقي عليه.', 'Who we pay: IBAN, CR, their accountant, and what is still owed.',
        () => ResourceScreen(config: collectionsSuppliersCfg)),
      (Icons.assignment_outlined, 'سير عمل التشغيل', 'Operations workflow',
        'أوامر النقل نفسُها — منها تُقرأ الأرقام، وفيها تُكتب الفاتورةُ وتاريخُ التحصيل.', 'The reports themselves — the source of every figure here.',
        () => const OpsWorkflowsScreen()),
    ];
    return ListView(padding: const EdgeInsets.all(14), children: [
      for (final c in cards)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Pressable(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => c.$6())),
            child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 38, height: 38,
                  decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                  child: Icon(c.$1, color: T.orange, size: 20),
                ),
                const SizedBox(width: 10),
                Text(tr(c.$2, c.$3), style: const TextStyle(fontWeight: FontWeight.w800)),
              ]),
              const SizedBox(height: 6),
              Text(tr(c.$4, c.$5), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
            ])),
          ),
        ),
    ]);
  }
}

/// Department email template: placeholders in braces are filled on send, and a save applies from the next message (EmailTemplateEditor on the web).
/// Collections by default; customs passes its own endpoint, live event, title and edit right.
class EmailTemplateTab extends StatefulWidget {
  final String endpoint;
  final String liveEvent;
  final String? titleAr;
  final String? titleEn;
  final bool? canEdit;
  final bool embedded;
  const EmailTemplateTab({super.key, this.endpoint = '/api/collections-dept/email-template', this.liveEvent = 'collections:changed', this.titleAr, this.titleEn, this.canEdit, this.embedded = false});
  @override
  State<EmailTemplateTab> createState() => _EmailTemplateTabState();
}

class _EmailTemplateTabState extends State<EmailTemplateTab> {
  Map<String, dynamic>? _tpl;
  final _subject = TextEditingController();
  final _body = TextEditingController();
  final _sig = TextEditingController();
  // Standing CC: addresses copied on every message, comma or space separated.
  final _cc = TextEditingController();
  String _sigImg = '', _sigImgName = '';
  bool _saving = false;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    for (final c in [_subject, _body, _sig, _cc]) { c.addListener(_changed); }
    // A colleague saved the template from another screen; the new one is read unless there is an unsaved local edit.
    _onLive = () { if (!_dirty) _load(); };
    Live.instance.on(widget.liveEvent, _onLive);
  }

  @override
  void dispose() {
    Live.instance.off(widget.liveEvent, _onLive);
    _subject.dispose(); _body.dispose(); _sig.dispose(); _cc.dispose();
    super.dispose();
  }

  void _changed() { if (mounted) setState(() {}); }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get(widget.endpoint));
      if (!mounted) return;
      setState(() {
        _tpl = d;
        _subject.text = '${d['subject'] ?? ''}';
        _body.text = '${d['body'] ?? ''}';
        _sig.text = '${d['signature'] ?? ''}';
        _cc.text = ((d['cc'] as List?) ?? const []).join(', ');
        _sigImg = '${d['signatureImage'] ?? ''}';
        _sigImgName = '${d['signatureImageName'] ?? ''}';
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  bool get _dirty {
    final t = _tpl;
    if (t == null) return false;
    return _subject.text != '${t['subject'] ?? ''}' || _body.text != '${t['body'] ?? ''}'
        || _sig.text != '${t['signature'] ?? ''}' || _cc.text != ((t['cc'] as List?) ?? const []).join(', ') || _sigImg != '${t['signatureImage'] ?? ''}';
  }

  void _toast(String s, {bool err = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s), backgroundColor: err ? T.danger : T.success));

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final r = await Api.instance.put(widget.endpoint, {
        'subject': _subject.text, 'body': _body.text, 'signature': _sig.text,
        'cc': _cc.text.split(RegExp(r'[\s,;،]+')).where((e) => e.trim().isNotEmpty).toList(),
        'signatureImage': _sigImg, 'signatureImageName': _sigImgName,
      });
      if (!mounted) return;
      setState(() => _tpl = {...?_tpl, ...Map<String, dynamic>.from(r as Map)});
      _toast(tr('حُفظ القالب — يصل أوّلَ رسالةٍ تُرسَل الآن', 'Template saved — used by the next email'));
    } catch (e) {
      if (mounted) _toast('${tr('تعذّر الحفظ', 'Save failed')}: $e', err: true);
    }
    if (mounted) setState(() => _saving = false);
  }

  /// Inserts the placeholder at the cursor position in the message text.
  void _insert(String token) {
    final sel = _body.selection;
    final text = _body.text;
    final a = sel.isValid ? sel.start : text.length;
    final b = sel.isValid ? sel.end : text.length;
    _body.value = TextEditingValue(
      text: text.replaceRange(a, b, token),
      selection: TextSelection.collapsed(offset: a + token.length),
    );
  }

  Future<void> _pickImage() async {
    final res = await FilePicker.platform.pickFiles(withData: true, type: FileType.custom, allowedExtensions: const ['png', 'jpg', 'jpeg']);
    final f = res?.files.single;
    if (f == null || f.bytes == null) return;
    if (f.size > 300 * 1024) { _toast(tr('الصورة أكبر من 300 ك.ب — صغّرها', 'Image over 300 KB'), err: true); return; }
    final ext = (f.extension ?? 'png').toLowerCase();
    final mime = ext == 'png' ? 'image/png' : 'image/jpeg';
    setState(() { _sigImg = 'data:$mime;base64,${base64Encode(f.bytes!)}'; _sigImgName = f.name; });
  }

  Widget? _sigPreview() {
    if (_sigImg.isEmpty) return null;
    final i = _sigImg.indexOf(',');
    try {
      return Image.memory(base64Decode(i >= 0 ? _sigImg.substring(i + 1) : _sigImg), height: 80, fit: BoxFit.contain);
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _tpl == null) return ErrorRetry(message: _error!, onRetry: _load);
    final t = _tpl;
    if (t == null) return const Center(child: CircularProgressIndicator());
    final canEdit = widget.canEdit ?? collectionsCanEdit;
    final placeholders = (t['placeholders'] as List? ?? const []).whereType<List>().where((p) => p.isNotEmpty).toList();
    final defaults = (t['defaults'] as Map?) ?? const {};
    final preview = _sigPreview();
    final children = <Widget>[
      AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.mail_outline, color: T.orange),
          const SizedBox(width: 8),
          Expanded(child: Text(tr(widget.titleAr ?? 'قالب بريد كشف الحساب', widget.titleEn ?? 'Statement email template'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
        ]),
        const SizedBox(height: 4),
        Text('${tr('يُرسَل من', 'Sent from')} ${t['mailbox'] ?? ''}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft), textDirection: TextDirection.ltr),
        if ('${t['updatedByName'] ?? ''}'.isNotEmpty)
          Text('${tr('آخر تعديل', 'Last edited')}: ${t['updatedByName']}${'${t['updatedAt'] ?? ''}'.isNotEmpty ? ' · ${'${t['updatedAt']}'.replaceFirst('T', ' ').split('.').first}' : ''}',
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        const SizedBox(height: 12),
        TextField(controller: _subject, enabled: canEdit, decoration: InputDecoration(labelText: tr('الموضوع', 'Subject'))),
        const SizedBox(height: 10),
        TextField(controller: _body, enabled: canEdit, minLines: 8, maxLines: 18, decoration: InputDecoration(labelText: tr('نصّ الرسالة', 'Message'), alignLabelWithHint: true)),
        const SizedBox(height: 10),
        // One plain button with readable labels; the field fills itself when the email is sent.
        if (canEdit)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: PopupMenuButton<String>(
              onSelected: _insert,
              itemBuilder: (_) => [for (final p in placeholders) PopupMenuItem(value: '${p[0]}', child: Text('${p.length > 1 ? p[1] : p[0]}'))],
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.08), border: Border.all(color: T.orange), borderRadius: BorderRadius.circular(10)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.add, size: 18, color: T.orange), const SizedBox(width: 4),
                  Text(tr('إدراج معلومة من المعاملة', 'Insert a field'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
                ]),
              ),
            ),
          ),
        const SizedBox(height: 4),
        Text(tr('ضع المؤشّر حيث تريد ثمّ أدرج المعلومة — تُملأ وحدها عند الإرسال.', 'Place the cursor, then insert — it fills itself on send.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ])),
      const SizedBox(height: 10),
      AppCard(child: TextField(controller: _cc, enabled: canEdit, textDirection: TextDirection.ltr, decoration: InputDecoration(
          labelText: tr('نسخة CC دائمة — تُضاف إلى كلّ رسالة تلقائيًّا', 'Standing CC — added to every message'),
          hintText: 'name@energize-logistics.com, …'))),
      const SizedBox(height: 10),
      // Signature: appended to the end of every message
      AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(tr('التوقيع — يُضاف في آخر كلّ رسالة', 'Signature — added to the end of every email'),
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
        const SizedBox(height: 6),
        TextField(controller: _sig, enabled: canEdit, minLines: 3, maxLines: 6, decoration: InputDecoration(
            hintText: tr('مثال: إدارة التحصيل — إنرجايز للخدمات اللوجستية\nهاتف: 920031911', 'e.g. Collections — Energize Logistics'))),
        const SizedBox(height: 10),
        if (preview != null)
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(6), color: Colors.white),
            child: preview,
          )
        else
          Text(tr('لا صورة توقيع', 'No signature image'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        if (canEdit) Wrap(spacing: 8, children: [
          TextButton.icon(
            onPressed: _pickImage,
            icon: const Icon(Icons.image_outlined, size: 18),
            label: Text(_sigImg.isNotEmpty ? tr('تغيير الصورة', 'Change image') : tr('إضافة صورة (شعار/توقيع)', 'Add an image (logo/signature)')),
          ),
          if (_sigImg.isNotEmpty)
            TextButton(onPressed: () => setState(() { _sigImg = ''; _sigImgName = ''; }),
                child: Text(tr('إزالة الصورة', 'Remove image'), style: const TextStyle(color: T.danger))),
        ]),
      ])),
      if (canEdit) ...[
        const SizedBox(height: 12),
        Row(children: [
          TextButton.icon(
            onPressed: () { _subject.text = '${defaults['subject'] ?? ''}'; _body.text = '${defaults['body'] ?? ''}'; },
            icon: const Icon(Icons.restart_alt, size: 18),
            label: Text(tr('النصّ الافتراضي', 'Default text')),
          ),
          const Spacer(),
          FilledButton.icon(
            onPressed: !_dirty || _saving ? null : _save,
            style: FilledButton.styleFrom(backgroundColor: T.orange),
            icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined),
            label: Text(tr('حفظ القالب', 'Save template')),
          ),
        ]),
      ],
    ];
    // Embedded inside another scrolling page (customs settings) it must not scroll by itself.
    return widget.embedded ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children) : ListView(padding: const EdgeInsets.all(14), children: children);
  }
}
