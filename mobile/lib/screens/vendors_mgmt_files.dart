import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'insight_kit.dart';
import 'shipment_orders_common.dart';
import 'vendors_mgmt.dart';

/// Vendors management: carrier papers, official contract, approval of new carriers, register stats and the monthly
/// ranking — counterpart of the web components/vendors (NewVendorModal, VendorFilesPanel, VendorRegisterStats,
/// VendorRanking) and /system/vendors-mgmt/approvals.

List<Map<String, dynamic>> _rows(dynamic v) => List<Map<String, dynamic>>.from(((v as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
String _err(Object e) => e is ApiException ? e.message : '$e';
void _snack(BuildContext c, String m) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m)));
void _openFile(dynamic f) {
  final u = '${f['fileUrl'] ?? ''}';
  if (u.isEmpty) return;
  launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
}

/// Required company papers (mirrors DOC_KINDS in the vendors controller).
const vmDocKinds = [('cr', 'السجل التجاري', 'Commercial register'), ('nationalAddress', 'العنوان الوطني', 'National address'), ('iban', 'الآيبان', 'IBAN'), ('taxCard', 'البطاقة الضريبية', 'Tax card')];
String vmDocLabel(dynamic k) {
  for (final d in vmDocKinds) { if (d.$1 == '$k') return tr(d.$2, d.$3); }
  return tr('مستند إضافي', 'Extra paper');
}

/// Approval of a carrier; a missing status is a legacy row and reads as approved.
const vmApproval = <String, (String, String, Color)>{
  'pending': ('بانتظار الاعتماد', 'Pending approval', T.warn),
  'approved': ('معتمَد', 'Approved', T.success),
  'rejected': ('مرفوض', 'Rejected', T.danger),
  'returned': ('أُعيد للتعديل', 'Returned for edits', T.info),
};
Widget vmApprovalChip(dynamic s) { final x = vmApproval['${s ?? 'approved'}'] ?? vmApproval['approved']!; return Chip2(tr(x.$1, x.$2), x.$3); }

List<Map<String, dynamic>> _picked(List<PickedFile> f, {List<String>? titles}) => [
  for (var i = 0; i < f.length; i++) {'dataUrl': f[i].dataUrl, 'fileName': f[i].fileName, if (titles != null) 'title': titles[i]},
];

mixin _Live<W extends StatefulWidget> on State<W> {
  Timer? _t;
  void _onEvt() { _t?.cancel(); _t = Timer(const Duration(milliseconds: 700), reload); }
  late final void Function() _cb = _onEvt;
  Future<void> reload();
  void startLive() { for (final e in const [vmEvent, 'shipmentOrders:updated']) { Live.instance.on(e, _cb); } }
  void stopLive() { _t?.cancel(); for (final e in const [vmEvent, 'shipmentOrders:updated']) { Live.instance.off(e, _cb); } }
}

// ── Drill-down list ─────────────────────────────────────────────────────────

/// The carriers behind a number: searchable, each opens its card.
class VmDrillScreen extends StatefulWidget {
  final String title;
  final List<Map<String, dynamic>> rows;
  final String Function(Map<String, dynamic>) subtitle;
  const VmDrillScreen({super.key, required this.title, required this.rows, required this.subtitle});
  @override
  State<VmDrillScreen> createState() => _VmDrillScreenState();
}

class _VmDrillScreenState extends State<VmDrillScreen> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final rows = widget.rows.where((r) => _q.isEmpty || '${r['name']} ${r['owner'] ?? ''}'.contains(_q)).toList();
    return AppScaffold(
      title: Text('${widget.title} (${widget.rows.length})'),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), child: SearchField(hint: tr('بحث…', 'Search…'), onChanged: (v) => setState(() => _q = v.trim()))),
        Expanded(child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 30),
          itemCount: rows.length,
          itemBuilder: (_, i) {
            final r = rows[i];
            return ListTile(
              dense: true, contentPadding: EdgeInsets.zero,
              title: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(widget.subtitle(r), style: const TextStyle(fontSize: 11.5)),
              trailing: r['kind'] == null ? null : vmKindChip(r['kind']),
              onTap: () => openVendor(context, id: r['id'], name: r['name']),
            );
          },
        )),
      ]),
    );
  }
}

void vmDrill(BuildContext context, String title, List<Map<String, dynamic>> rows, String Function(Map<String, dynamic>) sub) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => VmDrillScreen(title: title, rows: rows, subtitle: sub)));

Widget vmTapTile(VoidCallback onTap, Widget tile) => Pressable(onTap: onTap, child: tile);

// ── Register stats ──────────────────────────────────────────────────────────

/// Papers and contracts of the company register; every number opens its list.
class VmRegisterStats extends StatefulWidget {
  final String query;
  const VmRegisterStats({super.key, this.query = ''});
  @override
  State<VmRegisterStats> createState() => _VmRegisterStatsState();
}

class _VmRegisterStatsState extends State<VmRegisterStats> with _Live {
  Map<String, dynamic>? _d;
  int _seq = 0;
  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void didUpdateWidget(covariant VmRegisterStats old) { super.didUpdateWidget(old); if (old.query != widget.query) reload(); }
  @override
  void dispose() { stopLive(); super.dispose(); }
  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/register-stats${widget.query.isEmpty ? '' : '?${widget.query}'}');
      if (mounted && mine == _seq) setState(() => _d = Map<String, dynamic>.from(d));
    } catch (_) {}
  }

  String _sub(Map<String, dynamic> r) => [
    if ('${r['owner'] ?? ''}'.isNotEmpty) r['owner'],
    if ('${r['docsMissingLabels'] ?? ''}'.isNotEmpty) '${tr('ناقص', 'Missing')}: ${r['docsMissingLabels']}',
    if (r['contracted'] == true) '${tr('متعاقَد', 'Contracted')}${r['contractEndDate'] != null ? ' ${tr('حتى', 'to')} ${r['contractEndDate']}' : ''}',
    if (r['daysLeft'] != null) '${tr('متبقٍّ', 'left')} ${r['daysLeft']}',
    if (r['approvalStatus'] != null && r['approvalStatus'] != 'approved') tr(vmApproval[r['approvalStatus']]!.$1, vmApproval[r['approvalStatus']]!.$2),
    '${tr('رحلات', 'Trips')} ${r['trips'] ?? 0}',
  ].join(' · ');

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return const SizedBox.shrink();
    final t = Map<String, dynamic>.from(d['totals'] ?? {});
    final rows = _rows(d['rows']);
    void open(String title, bool Function(Map<String, dynamic>) f) => vmDrill(context, title, rows.where(f).toList(), _sub);
    return SectionCard(
      title: tr('سجلّ الموردين: المستندات والعقود', 'Register: papers and contracts'),
      note: tr('اضغط أيَّ رقمٍ لعرض قائمته · التنبيه قبل نهاية العقد بـ${d['contractDays']} يومًا', 'Tap any number for its list · contract alert ${d['contractDays']} days ahead'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TileWrap([
          vmTapTile(() => open(tr('موردو السجلّ', 'Register carriers'), (_) => true), KpiTile(tr('موردو السجلّ', 'Register carriers'), fmtNum(t['vendors']), color: T.navy)),
          vmTapTile(() => open(tr('تنقصهم مستنداتٌ مطلوبة', 'Missing papers'), (r) => (r['docsMissing'] as List? ?? const []).isNotEmpty), KpiTile(tr('مستنداتٌ ناقصة', 'Missing papers'), fmtNum(t['missingDocs']), color: T.warn)),
          vmTapTile(() => open(tr('متعاقَدٌ معهم رسميًّا', 'Contracted'), (r) => r['contracted'] == true), KpiTile(tr('متعاقَدٌ معهم', 'Contracted'), fmtNum(t['contracted']), color: T.success)),
          vmTapTile(() => open(tr('غير متعاقَدٍ معهم', 'Not contracted'), (r) => r['contracted'] != true), KpiTile(tr('غير متعاقَد', 'Not contracted'), fmtNum(t['notContracted']), color: T.warn)),
          vmTapTile(() => open(tr('عقودٌ تنتهي أو انتهت', 'Contracts ending'), (r) => r['contractState'] == 'expiring' || r['contractState'] == 'expired'), KpiTile(tr('تنتهي قريبًا / منتهية', 'Ending / ended'), '${t['expiring'] ?? 0} / ${t['expired'] ?? 0}', color: T.danger)),
          vmTapTile(() => open(tr('بانتظار الاعتماد', 'Pending approval'), (r) => r['approvalStatus'] == 'pending' || r['approvalStatus'] == 'returned'), KpiTile(tr('بانتظار الاعتماد', 'Pending'), '${t['pending'] ?? 0}', color: T.violet)),
        ]),
        const SizedBox(height: 6),
        Text(tr('معتمَد ${t['approved'] ?? 0} · مرفوض ${t['rejected'] ?? 0} · مُعاد ${t['returned'] ?? 0}', 'Approved ${t['approved'] ?? 0} · rejected ${t['rejected'] ?? 0} · returned ${t['returned'] ?? 0}'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        const SizedBox(height: 6),
        BarList([for (final k in _rows(d['docsByKind'])) (tr('${k['label']}', '${k['labelEn']}'), inum(k['missing']), '${tr('ينقص', 'missing')} ${k['missing']}')], color: T.warn,
          onTap: (i) { final k = _rows(d['docsByKind'])[i]; open('${tr('ينقصهم', 'Missing')}: ${tr('${k['label']}', '${k['labelEn']}')}', (r) => (r['docsMissing'] as List? ?? const []).contains(k['key'])); }),
      ]),
    );
  }
}

// ── Monthly ranking ─────────────────────────────────────────────────────────

/// Carriers ranked by trips in a chosen month, and the first-time carriers of that month.
class VmRanking extends StatefulWidget {
  final String month;
  final String query;
  const VmRanking({super.key, required this.month, this.query = ''});
  @override
  State<VmRanking> createState() => _VmRankingState();
}

class _VmRankingState extends State<VmRanking> with _Live {
  Map<String, dynamic>? _d;
  late String _month = widget.month;
  int _seq = 0;
  bool _first = false;
  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void didUpdateWidget(covariant VmRanking old) {
    super.didUpdateWidget(old);
    if (old.month != widget.month) { _month = widget.month; reload(); } else if (old.query != widget.query) { reload(); }
  }
  @override
  void dispose() { stopLive(); super.dispose(); }
  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/ranking?month=$_month${widget.query.isEmpty ? '' : '&${widget.query}'}');
      if (mounted && mine == _seq) setState(() => _d = Map<String, dynamic>.from(d));
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return const SizedBox.shrink();
    final rows = _rows(d['rows']);
    final first = _rows(d['firstTime']);
    final y = _month.substring(0, 4);
    return SectionCard(
      title: tr('ترتيب الموردين شهريًّا', 'Monthly carrier ranking'),
      note: tr('${fmtNum(d['vendors'])} مورّد · ${fmtNum(d['trips'])} رحلة (دون أسطول تنشيط) · ✦ أوّل تعامل', '${fmtNum(d['vendors'])} carriers · ${fmtNum(d['trips'])} trips · ✦ first time'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          for (final m in _rows(d['firstByMonth']))
            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
              label: Text('${tr(const ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][inum(m['month']).toInt() - 1], const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][inum(m['month']).toInt() - 1])} ✦${m['n']}'),
              selected: inum(m['month']) == inum(d['month']),
              onSelected: (_) { setState(() => _month = '$y-${inum(m['month']).toInt().toString().padLeft(2, '0')}'); reload(); },
            )),
        ])),
        Row(children: [
          ChoiceChip(label: Text(tr('الترتيب', 'Ranking')), selected: !_first, onSelected: (_) => setState(() => _first = false)),
          const SizedBox(width: 6),
          ChoiceChip(label: Text('${tr('أوّل تعامل', 'First time')} (${first.length})'), selected: _first, onSelected: (_) => setState(() => _first = true)),
        ]),
        if (!_first)
          for (final r in rows.take(30))
            ListTile(dense: true, contentPadding: EdgeInsets.zero,
              leading: Text('#${r['rank']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
              title: Text('${r['name']}${r['firstTime'] == true ? ' ✦' : ''}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
              subtitle: Text('${tr('رحلات', 'Trips')} ${r['trips']} · ${r['share']}%${has(r, 'buy') ? ' · ${soMoney(r['buy'])}' : ''} · ${r['prevRank'] == null ? tr('جديد', 'new') : '${tr('الشهر السابق', 'last month')} #${r['prevRank']}'}'),
              trailing: vmKindChip(r['kind']),
              onTap: () => openVendor(context, id: r['id'], name: r['name'])),
        if (!_first && rows.length > 30)
          TextButton(onPressed: () => vmDrill(context, tr('ترتيب الموردين', 'Ranking'), rows, (r) => '#${r['rank']} · ${tr('رحلات', 'Trips')} ${r['trips']} · ${r['share']}%'), child: Text(tr('عرض الكلّ (${rows.length})', 'Show all (${rows.length})'))),
        if (_first)
          for (final r in first)
            ListTile(dense: true, contentPadding: EdgeInsets.zero,
              title: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${tr('أوّل رحلة', 'First trip')} ${r['first']} · ${tr('رحلات الشهر', 'Month')} ${r['monthTrips']}'),
              trailing: vmKindChip(r['kind']),
              onTap: () => openVendor(context, id: r['id'], name: r['name'])),
      ]),
    );
  }
}

// ── New company ─────────────────────────────────────────────────────────────

/// «إضافة مورد» for a company: the four required papers (several files each), optional named extras, the owner's
/// mobile and the operator. A freelance driver is added from the freelancers page instead.
class VendorNewScreen extends StatefulWidget {
  final String name;
  final List<String> aliases;
  const VendorNewScreen({super.key, this.name = '', this.aliases = const []});
  @override
  State<VendorNewScreen> createState() => _VendorNewScreenState();
}

class _VendorNewScreenState extends State<VendorNewScreen> {
  late final _c = {
    for (final k in ['name', 'ownerName', 'ownerPhone', 'operatorName', 'operatorPhone', 'phone', 'followOwner']) k: TextEditingController(text: k == 'name' ? widget.name : ''),
  };
  final Map<String, List<PickedFile>> _docs = {};
  final List<(TextEditingController, List<PickedFile>)> _extra = [];
  bool _inMaster = true;
  bool _busy = false;

  @override
  void dispose() { for (final c in _c.values) { c.dispose(); } for (final e in _extra) { e.$1.dispose(); } super.dispose(); }

  Future<void> _save() async {
    final missing = vmDocKinds.where((k) => (_docs[k.$1] ?? const []).isEmpty).map((k) => tr(k.$2, k.$3)).toList();
    if (_c['name']!.text.trim().isEmpty) { _snack(context, tr('اسمُ المورد مطلوب', 'Name is required')); return; }
    if (missing.isNotEmpty) { _snack(context, '${tr('أرفِق', 'Attach')}: ${missing.join('، ')}'); return; }
    if (_extra.any((e) => e.$2.isNotEmpty && e.$1.text.trim().isEmpty)) { _snack(context, tr('اكتب اسم كلّ مستندٍ إضافي', 'Name every extra paper')); return; }
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/api/vendors-mgmt/vendors', {
        for (final e in _c.entries) e.key: e.value.text.trim(),
        'type': 'company', 'inMaster': _inMaster, 'aliases': widget.aliases,
        'documents': [
          for (final k in vmDocKinds) {'kind': k.$1, 'files': _picked(_docs[k.$1] ?? const [])},
          for (final e in _extra) if (e.$2.isNotEmpty) {'kind': 'other', 'title': e.$1.text.trim(), 'files': _picked(e.$2)},
        ],
      });
      if (!mounted) return;
      _snack(context, r['vendor']?['approvalStatus'] == 'pending' ? tr('أُضيف المورّد وأُرسل للاعتماد', 'Added and sent for approval') : tr('أُضيف المورّد', 'Carrier added'));
      Navigator.pop(context, '${r['vendor']?['_id'] ?? ''}');
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _snack(context, _err(e)); }
    }
  }

  Widget _files(List<PickedFile> list, void Function(List<PickedFile>) set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    for (var i = 0; i < list.length; i++)
      Row(children: [
        const Icon(Icons.description_outlined, size: 16, color: T.inkSoft), const SizedBox(width: 6),
        Expanded(child: Text(list[i].fileName, style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis)),
        IconButton(icon: const Icon(Icons.close, size: 16), onPressed: () => set([...list]..removeAt(i))),
      ]),
    Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
      onPressed: () async { final f = await pickFilesAsDataUrls(); if (f.isNotEmpty) set([...list, ...f]); },
      icon: const Icon(Icons.attach_file, size: 18), label: Text(tr('إرفاق ملفّات', 'Attach files')))),
  ]);

  @override
  Widget build(BuildContext context) => AppScaffold(
    title: Text(tr('إضافة مورّد', 'Add a carrier')),
    floatingActionButton: FloatingActionButton.extended(onPressed: _busy ? null : _save, icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check), label: Text(tr('إضافة وإرسال للاعتماد', 'Add and send for approval'))),
    body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
      Text(tr('للشركات والمؤسسات فقط — السائق الفرد يُضاف من صفحة «السائقون الأفراد».', 'Companies only — a freelance driver is added from the freelancers page.'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
      for (final f in [('name', 'اسم المنشأة *', 'Company name *'), ('ownerName', 'اسم صاحب المنشأة', 'Owner name'), ('ownerPhone', 'رقم جوال صاحب المنشأة', 'Owner mobile'), ('operatorName', 'اسم المشغّل (من نتعامل معه)', 'Operator'), ('operatorPhone', 'رقم جوال المشغّل', 'Operator mobile'), ('phone', 'جوال المنشأة', 'Company phone'), ('followOwner', 'مسؤول المتابعة', 'Follow-up owner')])
        Padding(padding: const EdgeInsets.only(bottom: 6), child: TextField(controller: _c[f.$1], keyboardType: f.$1.endsWith('Phone') || f.$1 == 'phone' ? TextInputType.phone : null, decoration: InputDecoration(labelText: tr(f.$2, f.$3)))),
      SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('ضمن القائمة المعتمدة (الماستر)', 'On the master list')), value: _inMaster, onChanged: (v) => setState(() => _inMaster = v)),
      const SizedBox(height: 6),
      Text(tr('المستندات المطلوبة (يجوز أكثر من ملفّ)', 'Required papers (several files allowed)'), style: const TextStyle(fontWeight: FontWeight.w800)),
      for (final k in vmDocKinds)
        Padding(padding: const EdgeInsets.only(top: 6), child: AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${tr(k.$2, k.$3)} *', style: TextStyle(fontWeight: FontWeight.w700, color: (_docs[k.$1] ?? const []).isEmpty ? T.danger : T.ink)),
          _files(_docs[k.$1] ?? const [], (l) => setState(() => _docs[k.$1] = l)),
        ]))),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: Text(tr('مستنداتٌ إضافية (اختياري)', 'Extra papers (optional)'), style: const TextStyle(fontWeight: FontWeight.w800))),
        TextButton.icon(onPressed: () => setState(() => _extra.add((TextEditingController(), <PickedFile>[]))), icon: const Icon(Icons.add), label: Text(tr('مستند', 'Paper'))),
      ]),
      for (var i = 0; i < _extra.length; i++)
        Padding(padding: const EdgeInsets.only(top: 6), child: AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: TextField(controller: _extra[i].$1, decoration: InputDecoration(labelText: tr('اسم المستند', 'Paper name')))),
            IconButton(icon: const Icon(Icons.delete_outline), onPressed: () => setState(() => _extra.removeAt(i))),
          ]),
          _files(_extra[i].$2, (l) => setState(() => _extra[i] = (_extra[i].$1, l))),
        ]))),
    ]),
  );
}

// ── Carrier card: approval, papers, contract ───────────────────────────────

Future<String?> _askNote(BuildContext context, String title, {bool required = true}) async {
  final c = TextEditingController();
  final r = await showDialog<String>(context: context, builder: (ctx) => AlertDialog(
    title: Text(title),
    content: TextField(controller: c, maxLines: 3, decoration: InputDecoration(labelText: required ? tr('الملاحظة *', 'Note *') : tr('ملاحظة (اختياري)', 'Note (optional)'))),
    actions: [
      TextButton(onPressed: () => Navigator.pop(ctx), child: Text(tr('إلغاء', 'Cancel'))),
      FilledButton(onPressed: () { if (required && c.text.trim().isEmpty) return; Navigator.pop(ctx, c.text.trim()); }, child: Text(tr('تأكيد', 'Confirm'))),
    ],
  ));
  c.dispose();
  return r;
}

/// Approval state with the approver's buttons (approve / return / reject) or the submitter's resubmit.
class VmApprovalCard extends StatelessWidget {
  final String vendorId;
  final Map<String, dynamic> approval;
  final VoidCallback onChanged;
  const VmApprovalCard({super.key, required this.vendorId, required this.approval, required this.onChanged});

  Future<void> _act(BuildContext context, String action) async {
    String note = '';
    if (action != 'approve') {
      final n = await _askNote(context, action == 'reject' ? tr('سبب الرفض', 'Reject reason') : action == 'return' ? tr('المطلوب تعديله', 'What to fix') : tr('إعادة التقديم', 'Resubmit'), required: action != 'resubmit');
      if (n == null) return;
      note = n;
    }
    try {
      if (action == 'resubmit') { await Api.instance.post('/api/vendors-mgmt/vendors/$vendorId/resubmit', {'note': note}); }
      else { await Api.instance.post('/api/vendors-mgmt/vendors/$vendorId/approval', {'action': action, 'note': note}); }
      onChanged();
    } catch (e) { if (context.mounted) _snack(context, _err(e)); }
  }

  @override
  Widget build(BuildContext context) {
    final s = '${approval['status'] ?? 'approved'}';
    final log = _rows(approval['log']);
    if (s == 'approved' && log.isEmpty) return const SizedBox.shrink();
    const acts = {'submit': ('قدّمه', 'submitted'), 'resubmit': ('أعاد تقديمه', 'resubmitted'), 'approve': ('اعتمده', 'approved'), 'reject': ('رفضه', 'rejected'), 'return': ('أعاده للتعديل', 'returned')};
    return SectionCard(
      title: tr('اعتماد المورّد', 'Carrier approval'),
      accent: (vmApproval[s] ?? vmApproval['approved']!).$3,
      trailing: vmApprovalChip(s),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if ('${approval['note'] ?? ''}'.isNotEmpty && s != 'approved') Text('${approval['note']}', style: const TextStyle(fontWeight: FontWeight.w700)),
        for (final l in log.reversed)
          Text('${soFmtDate(l['at'])} · ${l['byName'] ?? ''} · ${tr((acts[l['action']] ?? ('${l['action']}', '${l['action']}')).$1, (acts[l['action']] ?? ('${l['action']}', '${l['action']}')).$2)}${'${l['note'] ?? ''}'.isEmpty ? '' : ' — ${l['note']}'}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          if (s == 'pending' && approval['canApprove'] == true) ...[
            FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => _act(context, 'approve'), icon: const Icon(Icons.check_circle_outline), label: Text(tr('اعتماد', 'Approve'))),
            OutlinedButton.icon(onPressed: () => _act(context, 'return'), icon: const Icon(Icons.undo), label: Text(tr('إعادة للتعديل', 'Return'))),
            OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: T.danger), onPressed: () => _act(context, 'reject'), icon: const Icon(Icons.cancel_outlined), label: Text(tr('رفض', 'Reject'))),
          ],
          if (s == 'returned' || s == 'rejected') FilledButton.icon(onPressed: () => _act(context, 'resubmit'), icon: const Icon(Icons.send), label: Text(tr('إعادة التقديم للاعتماد', 'Resubmit'))),
        ]),
      ]),
    );
  }
}

/// The carrier's papers by kind, with add and delete.
class VmPapersCard extends StatelessWidget {
  final Map<String, dynamic> card;
  final VoidCallback onChanged;
  const VmPapersCard({super.key, required this.card, required this.onChanged});

  Future<void> _add(BuildContext context, String kind) async {
    String? title;
    if (kind == 'other') { title = await _askNote(context, tr('اسم المستند', 'Paper name')); if (title == null) return; }
    final files = await pickFilesAsDataUrls();
    if (files.isEmpty) return;
    try {
      await Api.instance.post('/api/vendors-mgmt/vendors/${card['vendor']['_id']}/documents', {'documents': [{'kind': kind, if (title != null) 'title': title, 'files': _picked(files)}]});
      onChanged();
    } catch (e) { if (context.mounted) _snack(context, _err(e)); }
  }

  Future<void> _remove(BuildContext context, Map<String, dynamic> f) async {
    try { await Api.instance.delete('/api/vendors-mgmt/vendors/${card['vendor']['_id']}/documents/${f['_id']}'); onChanged(); }
    catch (e) { if (context.mounted) _snack(context, _err(e)); }
  }

  @override
  Widget build(BuildContext context) {
    final docs = _rows(card['vendor']['documents']);
    final missing = _rows(card['missingDocs']);
    return SectionCard(
      title: '${tr('المستندات', 'Papers')} (${docs.length})',
      note: missing.isEmpty ? tr('المستندات المطلوبة مكتملة', 'Required papers complete') : '${tr('ناقص', 'Missing')}: ${missing.map((m) => tr('${m['label']}', '${m['labelEn']}')).join('، ')}',
      accent: missing.isEmpty ? null : T.danger,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final k in [...vmDocKinds.map((k) => k.$1), 'other']) ...[
          Row(children: [
            Expanded(child: Text(vmDocLabel(k), style: TextStyle(fontWeight: FontWeight.w800, color: k != 'other' && !docs.any((d) => d['kind'] == k) ? T.danger : T.ink))),
            IconButton(tooltip: tr('إضافة ملفّات', 'Add files'), icon: const Icon(Icons.upload_file, size: 20), onPressed: () => _add(context, k)),
          ]),
          for (final f in docs.where((d) => d['kind'] == k))
            ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.description_outlined, size: 18),
              title: Text('${(f['title'] ?? '').toString().isNotEmpty && k == 'other' ? '${f['title']} · ' : ''}${f['fileName'] ?? ''}', style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis),
              subtitle: Text('${soFmtDate(f['uploadedAt'])} · ${f['uploadedByName'] ?? ''}', style: const TextStyle(fontSize: 11)),
              onTap: () => _openFile(f),
              trailing: IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () => _remove(context, f))),
        ],
      ]),
    );
  }
}

/// Official contract: yes/no, optional end date (feeds alerts and notifications), named contract files.
class VmContractCard extends StatelessWidget {
  final Map<String, dynamic> card;
  final VoidCallback onChanged;
  const VmContractCard({super.key, required this.card, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = Map<String, dynamic>.from(card['contract'] ?? {});
    final files = _rows(c['files']);
    final state = '${c['state'] ?? 'none'}';
    final left = c['daysLeft'];
    return SectionCard(
      title: tr('التعاقد الرسميّ', 'Official contract'),
      accent: state == 'expired' ? T.danger : state == 'expiring' ? T.warn : null,
      trailing: IconButton(icon: const Icon(Icons.edit_outlined), tooltip: tr('تحديث العقد', 'Update contract'), onPressed: () async {
        final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, backgroundColor: Colors.white,
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
          builder: (_) => _ContractSheet(vendorId: '${card['vendor']['_id']}', contract: c));
        if (ok == true) onChanged();
      }),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${tr('تمّ التعاقد معه رسميًّا', 'Officially contracted')}: ${c['contracted'] == true ? tr('نعم', 'Yes') : tr('لا', 'No')}', style: TextStyle(fontWeight: FontWeight.w800, color: c['contracted'] == true ? T.success : T.inkSoft)),
        Text('${tr('نهاية العقد', 'Contract end')}: ${c['endDate'] ?? '—'}${left == null ? '' : inum(left) < 0 ? ' (${tr('انتهى منذ', 'ended')} ${-inum(left)} ${tr('يوم', 'd')})' : ' (${tr('باقي', 'left')} $left ${tr('يوم', 'd')})'}',
          style: TextStyle(color: state == 'expired' ? T.danger : state == 'expiring' ? T.warn : T.ink, fontWeight: FontWeight.w700)),
        for (final f in files)
          ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.description_outlined, size: 18),
            title: Text('${f['title'] ?? f['fileName']}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            subtitle: Text('${f['fileName'] ?? ''} · ${soFmtDate(f['uploadedAt'])}', style: const TextStyle(fontSize: 11)),
            onTap: () => _openFile(f),
            trailing: IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () async {
              try { await Api.instance.delete('/api/vendors-mgmt/vendors/${card['vendor']['_id']}/contract-files/${f['_id']}'); onChanged(); }
              catch (e) { if (context.mounted) _snack(context, _err(e)); }
            })),
      ]),
    );
  }
}

class _ContractSheet extends StatefulWidget {
  final String vendorId;
  final Map<String, dynamic> contract;
  const _ContractSheet({required this.vendorId, required this.contract});
  @override
  State<_ContractSheet> createState() => _ContractSheetState();
}

class _ContractSheetState extends State<_ContractSheet> {
  late bool? _yes = widget.contract['marked'] == true ? widget.contract['contracted'] == true : null;
  late String _end = '${widget.contract['endDate'] ?? ''}';
  final List<(PickedFile, TextEditingController)> _files = [];
  bool _busy = false;
  @override
  void dispose() { for (final f in _files) { f.$2.dispose(); } super.dispose(); }

  Future<void> _save() async {
    if (_yes == null) { _snack(context, tr('حدِّد: تمّ التعاقد رسميًّا أم لا', 'Choose yes or no')); return; }
    if (_files.any((f) => f.$2.text.trim().isEmpty)) { _snack(context, tr('اكتب اسمًا لكلّ ملفّ عقد', 'Name every contract file')); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.put('/api/vendors-mgmt/vendors/${widget.vendorId}/contract', {
        'contracted': _yes, 'contractEndDate': _end,
        'files': [for (final f in _files) {'dataUrl': f.$1.dataUrl, 'fileName': f.$1.fileName, 'title': f.$2.text.trim()}],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _snack(context, _err(e)); }
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
    child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('العقد الرسميّ', 'Official contract'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
      const SizedBox(height: 6),
      Text(tr('تمّ التعاقد معه رسميًّا؟', 'Officially contracted?')),
      Wrap(spacing: 6, children: [
        ChoiceChip(label: Text(tr('نعم', 'Yes')), selected: _yes == true, onSelected: (_) => setState(() => _yes = true)),
        ChoiceChip(label: Text(tr('لا', 'No')), selected: _yes == false, onSelected: (_) => setState(() => _yes = false)),
      ]),
      Row(children: [
        Expanded(child: OutlinedButton.icon(
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_end) ?? DateTime.now().add(const Duration(days: 365)), firstDate: DateTime(2020), lastDate: DateTime(2040));
            if (d != null) setState(() => _end = ymd(d));
          },
          icon: const Icon(Icons.event), label: Text(_end.isEmpty ? tr('تاريخ نهاية العقد (اختياري)', 'Contract end (optional)') : _end))),
        if (_end.isNotEmpty) IconButton(icon: const Icon(Icons.clear), onPressed: () => setState(() => _end = '')),
      ]),
      const SizedBox(height: 6),
      for (var i = 0; i < _files.length; i++)
        Row(children: [
          Expanded(child: TextField(controller: _files[i].$2, decoration: InputDecoration(labelText: '${tr('اسم الملفّ', 'File name')} — ${_files[i].$1.fileName}'))),
          IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _files.removeAt(i))),
        ]),
      TextButton.icon(onPressed: () async {
        final f = await pickFilesAsDataUrls();
        if (f.isNotEmpty) setState(() => _files.addAll(f.map((x) => (x, TextEditingController(text: x.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''))))));
      }, icon: const Icon(Icons.attach_file), label: Text(tr('إرفاق ملفّات العقد', 'Attach contract files'))),
      const SizedBox(height: 8),
      FilledButton(onPressed: _busy ? null : _save, child: Text(tr('حفظ', 'Save'))),
    ])),
  );
}

// ── Approvals ───────────────────────────────────────────────────────────────

/// «اعتماد الموردين»: carriers waiting for the operations manager or a delegated member, with their papers.
class VendorsApprovalsScreen extends StatefulWidget {
  const VendorsApprovalsScreen({super.key});
  @override
  State<VendorsApprovalsScreen> createState() => _VendorsApprovalsScreenState();
}

class _VendorsApprovalsScreenState extends State<VendorsApprovalsScreen> with _Live {
  Map<String, dynamic>? _d;
  String? _error;
  String _status = 'pending';
  int _seq = 0;
  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }
  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/approvals?status=$_status');
      if (mounted && mine == _seq) setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) { if (mounted && mine == _seq) setState(() => _error = _err(e)); }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final counts = Map<String, dynamic>.from(d?['counts'] ?? {});
    return AppScaffold(
      title: Text(tr('اعتماد الموردين', 'Carrier approvals')),
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: reload, child: ListView(padding: const EdgeInsets.all(12), children: [
              SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                for (final s in ['pending', 'returned', 'rejected', 'approved'])
                  Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                    label: Text('${tr(vmApproval[s]!.$1, vmApproval[s]!.$2)}${s == 'approved' ? '' : ' (${counts[s] ?? 0})'}'),
                    selected: _status == s, onSelected: (_) { setState(() => _status = s); reload(); })),
              ])),
              if (_rows(d['vendors']).isEmpty) Padding(padding: const EdgeInsets.all(30), child: Text(tr('لا موردين في هذه القائمة', 'Nobody in this list'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
              for (final v in _rows(d['vendors'])) ...[
                AppCard(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  InkWell(onTap: () => openVendor(context, id: '${v['_id']}'), child: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: T.orange))),
                  Text([
                    if ('${v['ownerName'] ?? ''}${v['ownerPhone'] ?? ''}'.isNotEmpty) '${tr('صاحب المنشأة', 'Owner')}: ${v['ownerName'] ?? ''} ${v['ownerPhone'] ?? ''}',
                    if ('${v['operatorName'] ?? ''}'.isNotEmpty) '${tr('المشغّل', 'Operator')}: ${v['operatorName']} ${v['operatorPhone'] ?? ''}',
                    if ('${v['submittedByName'] ?? ''}'.isNotEmpty) '${tr('أضافه', 'Added by')}: ${v['submittedByName']} · ${soFmtDate(v['submittedAt'])}',
                  ].join('\n'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                  if (_rows(v['missingDocs']).isNotEmpty) Text('${tr('ناقص', 'Missing')}: ${_rows(v['missingDocs']).map((m) => tr('${m['label']}', '${m['labelEn']}')).join('، ')}', style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700, fontSize: 12)),
                  Wrap(spacing: 5, runSpacing: 4, children: [
                    for (final f in _rows(v['documents']))
                      ActionChip(avatar: const Icon(Icons.description_outlined, size: 15), label: Text(f['kind'] == 'other' ? '${f['title']}' : vmDocLabel(f['kind']), style: const TextStyle(fontSize: 11.5)), onPressed: () => _openFile(f)),
                  ]),
                ])),
                VmApprovalCard(vendorId: '${v['_id']}', onChanged: reload, approval: {
                  'status': v['approvalStatus'], 'note': v['rejectNote'], 'log': v['approvalLog'], 'canApprove': d['canApprove'],
                }),
                const SizedBox(height: 8),
              ],
            ])),
    );
  }
}
