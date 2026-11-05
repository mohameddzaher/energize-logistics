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
import '../ui/export_sheet.dart';
import '../ui/file_upload.dart';
import '../ui/portal_account_card.dart';
import 'customs_contracts.dart' show CustomsPartyContracts;
import 'customs_detail.dart' show CustomsDetailScreen, customsStageLabel;
import 'fleet_customer_presence.dart' show CustomerPresence;
import 'jp.dart' show JpTaskPanel;

/// Customs parties: customer, shipping agent and carrier. The party profile (data and attachments) and the transaction parties card in its details. Counterpart of `PartyAttachments`, `ClearanceParties` and `customs/parties/[id]` on the web.
/// The commercial register, tax certificate and contract are attached once in the party profile and read from every transaction the party is in; they are not repeated per transaction.

const _editRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'customs_manager', 'customs_officer'];

/// Who edits customs: the same split as on the server (EDIT_ROLES) plus the matrix grant.
bool canEditCustoms(BuildContext context) {
  final auth = context.watch<AuthProvider>();
  return _editRoles.contains(auth.role) || auth.canEditSection('Customs');
}

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];

/// Opens a file from `/api/uploads/...` for viewing (images and PDF display), not forced to download. The in-app browser first, then the device browser if that fails.
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

/// Party attachments: a list opened by tap, upload of one or more files with an optional name, and delete with confirmation; writing is for customs editors only. Returns the new list via `onChanged`.
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
    // The typed name applies to a single file; in a batch each file is named by its own name.
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

/// Role name and icon.
(String, IconData) _kindMeta(String kind) => switch (kind) {
      'agent' => (tr('وكيل الشحن', 'Shipping agent'), Icons.directions_boat_outlined),
      'carrier' => (tr('الناقل', 'Carrier'), Icons.local_shipping_outlined),
      _ => (tr('العميل', 'Customer'), Icons.people_outline),
    };

/// Party data: contact, register, tax number and address; only what was written.
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
    // All contacts: each contact person with email, mobile and description.
    for (final c in (p['contacts'] is List && (p['contacts'] as List).isNotEmpty
        ? List<Map>.from(p['contacts'] as List)
        : [{'name': s('contactPerson'), 'email': s('email'), 'phone': s('phone')}])) ...[
      if ('${c['name'] ?? ''}'.isNotEmpty) line('${tr('المسؤول', 'Contact')}: ${c['name']}${'${c['description'] ?? ''}'.isNotEmpty ? ' (${c['description']})' : ''}'),
      if ('${c['phone'] ?? ''}'.isNotEmpty)
        line('${c['phone']}', icon: Icons.phone_outlined, ltr: true,
            onTap: () => launchUrl(Uri.parse('tel:${'${c['phone']}'.replaceAll(RegExp(r'[^0-9+]'), '')}'), mode: LaunchMode.externalApplication)),
      if ('${c['email'] ?? ''}'.isNotEmpty)
        line('${c['email']}', icon: Icons.mail_outline, ltr: true,
            onTap: () => launchUrl(Uri.parse('mailto:${c['email']}'), mode: LaunchMode.externalApplication)),
    ],
    if (s('yardLocationUrl').isNotEmpty)
      line(tr('موقع الساحة', 'Yard location'), icon: Icons.map_outlined,
          onTap: () => launchUrl(Uri.parse(s('yardLocationUrl')), mode: LaunchMode.externalApplication)),
    if (s('commercialRegister').isNotEmpty) line('${tr('السجل التجاري', 'CR')}: ${s('commercialRegister')}'),
    if (s('taxNumber').isNotEmpty) line('${tr('الرقم الضريبي', 'Tax no.')}: ${s('taxNumber')}'),
    if (place.isNotEmpty) line(place, icon: Icons.place_outlined),
    if (s('notes').isNotEmpty) line(s('notes')),
  ];
}

/// Transaction parties card: customer, carrier data and their attachments in its details. Read from each party's file (`/:id/parties-card`), so what is uploaded here is uploaded in its file.
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
      // The card is an extra: its failure does not block the transaction.
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

/// Party profile: data, dealing numbers and attachments (`GET /parties/:id`).
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

  String _crmId(Map<String, dynamic> p) {
    final c = p['crmCompany'];
    return c is Map ? '${c['_id'] ?? ''}' : '${c ?? ''}';
  }

  static String _money(dynamic v) {
    final n = v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
    return n.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  }

  static String _dt(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    return d == null ? '—' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  String _stageText(Map c) => c['cancelled'] == true
      ? tr('ملغاة', 'Cancelled')
      : c['isCompleted'] == true
          ? tr('مغلقة', 'Closed')
          : customsStageLabel(
              '${(c['pipeline'] is Map ? c['pipeline']['next'] : null) ?? c['stage'] ?? ''}', '${c['cargoType'] ?? 'containers'}');

  num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;

  /// Party numbers, monthly growth, aggregations, and all its transactions, like the party profile on the web.
  List<Widget> _profileExtras(String kind, Map<String, dynamic> t) {
    final d = _d ?? const {};
    final seesMoney = d['money'] == true;
    final isAgent = kind == 'agent';
    final deals = _maps(d['deals']);
    Widget stat(String label, String value, {Color? color}) => AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color ?? T.ink))),
          ]),
        );
    Widget bars(String title, List<Map<String, dynamic>> rows) {
      if (rows.isEmpty) return const SizedBox.shrink();
      final max = rows.fold<num>(1, (a, r) => _num(r['n']) > a ? _num(r['n']) : a);
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 6),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  SizedBox(width: 120, child: Text('${r['name'] ?? ''}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(value: (_num(r['n']) / max).clamp(0, 1).toDouble(), minHeight: 6, backgroundColor: T.line, color: T.orange),
                    ),
                  ),
                  SizedBox(width: 34, child: Text('${r['n'] ?? 0}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: T.inkSoft))),
                ]),
              ),
          ]),
        ),
      );
    }
    final cols = [
      ExportCol('المرجع', 'Ref', (r) => r['refNumber'] ?? ''),
      ExportCol('البوليصة', 'BL', (r) => r['blNumber'] ?? ''),
      isAgent ? ExportCol('العميل', 'Customer', (r) => r['customerName'] ?? '') : ExportCol('وكيل الشحن', 'Agent', (r) => r['shippingAgent'] ?? ''),
      ExportCol('الميناء', 'Port', (r) => r['port'] ?? ''),
      ExportCol('المرحلة', 'Stage', (r) => _stageText(r)),
      ExportCol('حاويات', 'Containers', (r) => _num(r['containerCount'])),
      ExportCol('الإيراد', 'Revenue', (r) => _num(r['revenue'] is Map ? r['revenue']['totalInvoiced'] : 0)),
      ExportCol('التكلفة', 'Cost', (r) => _num(r['costs'] is Map ? r['costs']['total'] : 0)),
      if (seesMoney) ExportCol('الربح', 'Profit', (r) => _num(r['revenue'] is Map ? r['revenue']['profit'] : 0)),
      ExportCol('التاريخ', 'Date', (r) => _dt(r['createdAt'])),
    ];
    final byMonth = _maps(d['byMonth']);
    final maxMonth = byMonth.fold<num>(1, (a, r) => _num(r['revenue']) > a ? _num(r['revenue']) : a);
    return [
      const SizedBox(height: 12),
      GridView.count(
        crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 8, mainAxisSpacing: 8, childAspectRatio: 1.45,
        children: [
          stat(tr('معاملات', 'Deals'), _money(t['deals'])),
          stat(tr('حاويات', 'Containers'), _money(t['containers'])),
          stat(tr('الإيراد', 'Revenue'), _money(t['revenue']), color: T.success),
          stat(tr('التكلفة', 'Cost'), _money(t['cost'])),
          if (seesMoney) stat(tr('الربح', 'Profit'), _money(t['profit']), color: _num(t['profit']) >= 0 ? T.success : T.danger),
          if (seesMoney) stat(tr('الهامش', 'Margin'), '${t['margin'] ?? 0}%', color: _num(t['margin']) >= 0 ? T.success : T.danger),
          stat(tr('لم تُفوتَر', 'Uninvoiced'), _money(t['uninvoiced']), color: _num(t['uninvoiced']) != 0 ? T.warn : null),
          if (seesMoney) stat(tr('متوسط الربح للمعاملة', 'Avg profit / deal'), _money(t['avgProfit'])),
          stat(tr('إجمالي الوزن', 'Total weight'), _money(t['weight'])),
          stat(tr('أول معاملة', 'First deal'), _dt(t['firstDealAt'])),
          stat(tr('آخر معاملة', 'Last deal'), _dt(t['lastDealAt'])),
        ],
      ),
      if (byMonth.length > 1)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('بالشهر', 'By month'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              const SizedBox(height: 6),
              for (final m in byMonth)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(children: [
                    SizedBox(width: 64, child: Text('${m['key']}', style: const TextStyle(fontSize: 11, color: T.inkSoft))),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(value: (_num(m['revenue']) / maxMonth).clamp(0, 1).toDouble(), minHeight: 6, backgroundColor: T.line, color: T.success),
                      ),
                    ),
                    SizedBox(
                      width: 120,
                      child: Text('${_money(m['revenue'])}${seesMoney ? ' · ${_money(m['profit'])}' : ''}',
                          textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                    ),
                  ]),
                ),
            ]),
          ),
        ),
      bars(tr('حسب المرحلة', 'By stage'), _maps(d['byStage'])),
      bars(tr('حسب الميناء', 'By port'), _maps(d['byPort'])),
      bars(isAgent ? tr('أكثر العملاء معه', 'Top customers') : tr('أكثر الوكلاء معه', 'Top agents'), _maps(d['byCounterparty'])),
      const SizedBox(height: 12),
      AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text('${tr('كلّ المعاملات', 'All deals')} (${deals.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            ExportButton(fileName: 'customs-${_d?['party']?['name'] ?? widget.name}', sheetName: tr('معاملات', 'Deals'), columns: cols, rows: () => deals),
          ]),
          if (deals.isEmpty) Text(tr('لا معاملات', 'No deals'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          for (final c in deals)
            InkWell(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: '${c['_id']}', ref: '${c['refNumber'] ?? ''}'))),
              child: Opacity(
                opacity: c['cancelled'] == true ? 0.5 : 1,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${c['refNumber'] ?? '—'}${'${c['blNumber'] ?? ''}'.isNotEmpty ? ' · ${c['blNumber']}' : ''}',
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                      Text(_money(c['revenue'] is Map ? c['revenue']['totalInvoiced'] : 0), style: const TextStyle(fontSize: 12, color: T.success, fontWeight: FontWeight.w700)),
                    ]),
                    Text([
                      '${(isAgent ? c['customerName'] : c['shippingAgent']) ?? ''}',
                      if ('${c['port'] ?? ''}'.isNotEmpty) '${c['port']}',
                      _stageText(c),
                      '${c['containerCount'] ?? 0} ${tr('حاوية', 'cntrs')}',
                      if (seesMoney) '${tr('الربح', 'Profit')} ${_money(c['revenue'] is Map ? c['revenue']['profit'] : 0)}',
                      _dt(c['createdAt']),
                    ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  ]),
                ),
              ),
            ),
        ]),
      ),
    ];
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
                    // The same customer in other sections, and its portal account, like the web.
                    if (kind == 'customer') ...[
                      CustomerPresence(reg: 'customs', id: '${p['_id'] ?? widget.partyId}', onChanged: _load),
                      if (_crmId(p).isNotEmpty) ...[
                        PortalAccountCard(source: 'crm_company', refId: _crmId(p), name: name),
                        const SizedBox(height: 12),
                      ],
                    ],
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
                      ]),
                    ),
                    const SizedBox(height: 12),
                    // Party attachments: register, certificate and contract; also read from every transaction the party is in.
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
                    ..._profileExtras(kind, totals),
                    // Our contracts with them; there are no contracts between us and shipping agents.
                    if (kind != 'agent') ...[
                      const SizedBox(height: 12),
                      CustomsPartyContracts(partyId: '${p['_id'] ?? widget.partyId}', partyName: name, partyKind: kind, canEdit: canEdit),
                    ],
                    const SizedBox(height: 12),
                    JpTaskPanel(section: 'customs', kind: kind, refId: '${p['_id'] ?? widget.partyId}'),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
