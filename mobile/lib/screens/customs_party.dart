import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/file_upload.dart';

/// أطرافُ التخليص — العميلُ ووكيلُ الشحن والناقل: ملفُّ الطرف (بياناتُه
/// ومرفقاتُه)، وبطاقةُ أطراف المعاملة في تفاصيلها. نظيرُ `PartyAttachments`
/// و`ClearanceParties` و`customs/parties/[id]` على الموقع.
///
/// السجلُّ التجاريُّ والشهادةُ الضريبيّةُ والعقدُ تُرفَق مرّةً في ملفّ الطرف،
/// وتُقرأ من كلّ معاملةٍ هو طرفٌ فيها — لا تُعاد في كلّ معاملة.

const _editRoles = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'];

/// مَن يعدّل في التخليص — القسمةُ نفسُها في الخادم (EDIT_ROLES) ومعها منحُ المصفوفة.
bool canEditCustoms(BuildContext context) {
  final auth = context.watch<AuthProvider>();
  return _editRoles.contains(auth.role) || auth.canEditSection('Customs');
}

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];

/// يفتح ملفًّا من `/api/uploads/...` للعرض (الصورةُ وPDF تُعرَضان) — لا يُفرَض
/// تنزيلُه. والمتصفّحُ داخل التطبيق أوّلًا، ثمّ متصفّحُ الجهاز إن تعذّر.
Future<void> customsOpenFile(BuildContext context, dynamic fileUrl) async {
  final u = '${fileUrl ?? ''}';
  if (u.isEmpty) return;
  final uri = Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u');
  final messenger = ScaffoldMessenger.of(context);
  var ok = false;
  try { ok = await launchUrl(uri, mode: LaunchMode.inAppBrowserView); } catch (_) {}
  if (!ok) {
    try { ok = await launchUrl(uri, mode: LaunchMode.externalApplication); } catch (_) {}
  }
  if (!ok) messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر فتح الملفّ', 'Could not open the file'))));
}

/// مرفقاتُ طرفٍ: قائمةٌ تُفتَح باللمس، ورفعُ ملفٍّ أو أكثر باسمٍ اختياريّ، وحذفٌ
/// بتأكيد — والكتابةُ لمن يعدّل في التخليص وحدَه. تردّ القائمةَ الجديدة بـ`onChanged`.
class CustomsPartyAttachments extends StatefulWidget {
  final String partyId;
  final List<Map<String, dynamic>> items;
  final bool canEdit;
  final bool compact;
  final void Function(List<Map<String, dynamic>>) onChanged;
  const CustomsPartyAttachments({
    super.key, required this.partyId, required this.items, required this.canEdit,
    required this.onChanged, this.compact = false,
  });
  @override
  State<CustomsPartyAttachments> createState() => _CustomsPartyAttachmentsState();
}

class _CustomsPartyAttachmentsState extends State<CustomsPartyAttachments> {
  final TextEditingController _title = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _say(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _bare(String name) => name.replaceAll(RegExp(r'\.[^.]+$'), '');

  Future<void> _upload() async {
    final files = await pickFilesAsDataUrls();
    if (files.isEmpty || !mounted) return;
    // الاسمُ المكتوبُ لملفٍّ واحد؛ وفي الدفعة يُسمّى كلُّ ملفٍّ باسمه.
    final title = _title.text.trim();
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/api/customs-clearance/parties/${widget.partyId}/attachments', {
        'files': [
          for (final f in files)
            {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': files.length == 1 && title.isNotEmpty ? title : _bare(f.fileName)},
        ],
      });
      final party = r is Map && r['party'] is Map ? r['party'] as Map : const {};
      widget.onChanged(_maps(party['attachments']));
      _title.clear();
      _say(tr('رُفع', 'Uploaded'));
    } catch (e) {
      _say(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المرفق؟', 'Delete attachment?')),
        content: Text('${a['title'] ?? a['fileName'] ?? ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await Api.instance.delete('/api/customs-clearance/parties/${widget.partyId}/attachments/${a['_id']}');
      final party = r is Map && r['party'] is Map ? r['party'] as Map : const {};
      widget.onChanged(_maps(party['attachments']));
    } catch (e) {
      _say(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (items.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(tr('لا مرفقات بعد.', 'No attachments yet.'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
        ),
      for (final a in items)
        InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => customsOpenFile(context, a['fileUrl']),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              const Icon(Icons.attach_file_rounded, size: 16, color: T.inkFaint),
              const SizedBox(width: 6),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${a['title'] ?? ''}'.trim().isNotEmpty ? '${a['title']}' : '${a['fileName'] ?? '—'}',
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.navy)),
                  if (!widget.compact && '${a['uploadedByName'] ?? ''}'.isNotEmpty)
                    Text('${a['uploadedByName']}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                ]),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: tr('فتح', 'Open'),
                icon: const Icon(Icons.visibility_outlined, size: 18, color: T.navy),
                onPressed: () => customsOpenFile(context, a['fileUrl']),
              ),
              if (widget.canEdit)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: tr('حذف', 'Delete'),
                  icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                  onPressed: _busy ? null : () => _remove(a),
                ),
            ]),
          ),
        ),
      if (widget.canEdit) ...[
        const SizedBox(height: 6),
        TextField(
          controller: _title,
          style: const TextStyle(fontSize: 12.5),
          decoration: InputDecoration(
            isDense: true,
            hintText: tr('اسم الملف (اختياري) — مثل: السجل التجاري', 'File name (optional) — e.g. CR'),
          ),
        ),
        const SizedBox(height: 6),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton.icon(
            onPressed: _busy ? null : _upload,
            icon: _busy
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.upload_rounded, size: 16),
            label: Text(tr('إرفاق ملفات', 'Attach files')),
          ),
        ),
      ],
    ]);
  }
}

/// اسمُ الدور وأيقونتُه.
(String, IconData) _kindMeta(String kind) => switch (kind) {
      'agent' => (tr('وكيل الشحن', 'Shipping agent'), Icons.directions_boat_outlined),
      'carrier' => (tr('الناقل', 'Carrier'), Icons.local_shipping_outlined),
      _ => (tr('العميل', 'Customer'), Icons.people_outline),
    };

/// بياناتُ الطرف: تواصلُه وسجلُّه ورقمُه الضريبيّ وعنوانُه — ما كُتب منها وحدَه.
List<Widget> _partyDetails(Map<String, dynamic> p) {
  String s(String k) => '${p[k] ?? ''}'.trim();
  Widget line(String text, {IconData? icon, VoidCallback? onTap, bool ltr = false}) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            if (icon != null) ...[Icon(icon, size: 13, color: T.inkFaint), const SizedBox(width: 5)],
            Expanded(
              child: Text(text, textDirection: ltr ? TextDirection.ltr : null,
                  textAlign: ltr && Lang.instance.ar ? TextAlign.right : null,
                  style: TextStyle(fontSize: 12, color: onTap != null ? T.navy : T.inkSoft)),
            ),
          ]),
        ),
      );
  final place = [s('city'), s('address')].where((x) => x.isNotEmpty).join(' — ');
  return [
    if (s('phone').isNotEmpty)
      line(s('phone'), icon: Icons.phone_outlined, ltr: true,
          onTap: () => launchUrl(Uri.parse('tel:${s('phone').replaceAll(RegExp(r'[^0-9+]'), '')}'), mode: LaunchMode.externalApplication)),
    if (s('email').isNotEmpty)
      line(s('email'), icon: Icons.mail_outline, ltr: true,
          onTap: () => launchUrl(Uri.parse('mailto:${s('email')}'), mode: LaunchMode.externalApplication)),
    if (s('contactPerson').isNotEmpty) line('${tr('المسؤول', 'Contact')}: ${s('contactPerson')}'),
    if (s('commercialRegister').isNotEmpty) line('${tr('السجل التجاري', 'CR')}: ${s('commercialRegister')}'),
    if (s('taxNumber').isNotEmpty) line('${tr('الرقم الضريبي', 'Tax no.')}: ${s('taxNumber')}'),
    if (place.isNotEmpty) line(place, icon: Icons.place_outlined),
    if (s('notes').isNotEmpty) line(s('notes')),
  ];
}

/// بطاقةُ أطراف المعاملة — «بيانات العملاء والناقلين ومرفقاتهم» في تفاصيلها.
/// تُقرأ من ملفّ كلّ طرف (`/:id/parties-card`)، فما يُرفَع هنا يُرفَع في ملفّه.
class CustomsClearanceParties extends StatefulWidget {
  final String clearanceId;
  const CustomsClearanceParties({super.key, required this.clearanceId});
  @override
  State<CustomsClearanceParties> createState() => _CustomsClearancePartiesState();
}

class _CustomsClearancePartiesState extends State<CustomsClearanceParties> {
  Map<String, dynamic>? _d;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}/parties-card');
      if (mounted && d is Map) setState(() => _d = Map<String, dynamic>.from(d));
    } catch (_) {
      // البطاقةُ زيادة: تعذُّرها لا يحجب المعاملة.
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return const SizedBox.shrink();
    final canEdit = canEditCustoms(context);
    final cards = [
      for (final k in const ['customer', 'agent', 'carrier'])
        if (d[k] is Map) (k, Map<String, dynamic>.from(d[k] as Map)),
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('بيانات العملاء والناقلين ومرفقاتهم', 'Customer, agent & carrier — details and files'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          if (cards.isEmpty)
            Text(tr('لا أطرافَ مختارةً لهذه المعاملة.', 'No parties picked for this clearance.'),
                style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
          for (final (k, c) in cards)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: T.inkFaint.withValues(alpha: 0.3)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Icon(_kindMeta(k).$2, size: 14, color: T.orange),
                  const SizedBox(width: 5),
                  Text(_kindMeta(k).$1, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
                ]),
                const SizedBox(height: 2),
                Row(children: [
                  Expanded(child: Text('${c['name'] ?? '—'}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800))),
                  if ('${c['_id'] ?? ''}'.isNotEmpty)
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: tr('ملفّه الكامل', 'Full profile'),
                      icon: const Icon(Icons.open_in_new, size: 16, color: T.inkFaint),
                      onPressed: () => Navigator.push(context, MaterialPageRoute(
                          builder: (_) => CustomsPartyScreen(partyId: '${c['_id']}', name: '${c['name'] ?? ''}'))),
                    ),
                ]),
                if (c['unlinked'] == true)
                  Text(tr('مكتوبٌ اسمًا بلا ملفّ — اختره من القائمة في بيانات المعاملة لتُرفَق ملفّاتُه.',
                          'Typed as text with no profile — pick it from the list to attach files.'),
                      style: const TextStyle(fontSize: 11.5, color: T.warn))
                else ...[
                  ..._partyDetails(c),
                  const Divider(height: 14),
                  CustomsPartyAttachments(
                    partyId: '${c['_id']}',
                    items: _maps(c['attachments']),
                    canEdit: canEdit,
                    compact: true,
                    onChanged: (items) => setState(() => (_d![k] as Map)['attachments'] = items),
                  ),
                ],
              ]),
            ),
        ]),
      ),
    );
  }
}

/// ملفُّ الطرف — بياناتُه وأرقامُ تعامله ومرفقاتُه (`GET /parties/:id`).
class CustomsPartyScreen extends StatefulWidget {
  final String partyId;
  final String name;
  const CustomsPartyScreen({super.key, required this.partyId, this.name = ''});
  @override
  State<CustomsPartyScreen> createState() => _CustomsPartyScreenState();
}

class _CustomsPartyScreenState extends State<CustomsPartyScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/parties/${widget.partyId}');
      if (!mounted) return;
      setState(() { _d = d is Map ? Map<String, dynamic>.from(d) : {}; _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = canEditCustoms(context);
    final p = _d?['party'] is Map ? Map<String, dynamic>.from(_d!['party'] as Map) : <String, dynamic>{};
    final totals = _d?['totals'] is Map ? Map<String, dynamic>.from(_d!['totals'] as Map) : <String, dynamic>{};
    final kind = '${p['kind'] ?? 'customer'}';
    final name = '${p['name'] ?? widget.name}';
    final details = _partyDetails(p);
    return AppScaffold(
      title: Text(name.isEmpty ? tr('ملفّ الطرف', 'Party profile') : name),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 160)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      topAccent: T.navy,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Row(children: [
                          Icon(_kindMeta(kind).$2, size: 16, color: T.orange),
                          const SizedBox(width: 6),
                          Text(_kindMeta(kind).$1, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
                        ]),
                        const SizedBox(height: 4),
                        Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 6),
                        if (details.isEmpty)
                          Text(tr('لا بيانات تواصل مسجَّلة', 'No contact details recorded'),
                              style: const TextStyle(fontSize: 12, color: T.inkFaint))
                        else
                          ...details,
                        if (totals.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2('${tr('معاملات', 'Deals')}: ${totals['deals'] ?? 0}', T.navy),
                            Chip2('${tr('حاويات', 'Containers')}: ${totals['containers'] ?? 0}', T.violet),
                            if ((totals['uninvoiced'] ?? 0) != 0)
                              Chip2('${tr('لم تُفوتَر', 'Not invoiced')}: ${totals['uninvoiced']}', T.warn),
                          ]),
                        ],
                      ]),
                    ),
                    const SizedBox(height: 12),
                    // مرفقاتُ الطرف — سجلُّه وشهادتُه وعقدُه؛ تُقرأ كذلك من كلّ معاملةٍ هو طرفٌ فيها.
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr('المرفقات', 'Attachments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 6),
                        CustomsPartyAttachments(
                          partyId: widget.partyId,
                          items: _maps(p['attachments']),
                          canEdit: canEdit,
                          onChanged: (items) => setState(() {
                            if (_d?['party'] is Map) (_d!['party'] as Map)['attachments'] = items;
                          }),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
