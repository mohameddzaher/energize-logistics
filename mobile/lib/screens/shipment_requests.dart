import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/customer_prefs.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/ops_report_detail.dart' show opsPaymentKindLabel;
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'insight_kit.dart';
import 'shipment_orders_common.dart';

/// Shipment requests: sales asks («طلب شحنة») and the vendors team places each truck («الطلبات من المبيعات»).
/// Counterpart of the web pages under shipment-orders, sales and vendors; one API (/api/shipment-requests) and one live event.

const srEvent = 'shipmentRequests:changed';

const srStatuses = <String, (String, String, Color)>{
  'pending': ('بانتظار الموردين', 'Waiting for vendors', T.warn),
  'in_progress': ('قيد الإكمال', 'In progress', T.info),
  'completed': ('مكتمل', 'Completed', T.success),
  'rejected': ('مرفوض', 'Rejected', T.danger),
  'cancelled': ('مسحوب', 'Withdrawn', T.inkFaint),
};
/// On the vendors list a pending request is simply new, and a withdrawn one was withdrawn by sales.
Widget srStatusChip(dynamic s, {bool vendors = false}) {
  var x = srStatuses['$s'] ?? ('$s', '$s', T.inkFaint);
  if (vendors && '$s' == 'pending') x = ('جديد', 'New', T.warn);
  if (vendors && '$s' == 'cancelled') x = ('سحبه فريق المبيعات', 'Withdrawn by sales', T.inkFaint);
  // Plain text with a small square marker: a work system, not coloured pills.
  return Row(mainAxisSize: MainAxisSize.min, children: [
    Container(width: 8, height: 8, decoration: BoxDecoration(color: x.$3, borderRadius: BorderRadius.circular(2))),
    const SizedBox(width: 6),
    Text(tr(x.$1, x.$2), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
  ]);
}

/// Where the vendors team stands on a request, one line for sales (twin of web `vendorProgress`): label, colour, 0..1.
(String, Color, double) srVendorProgress(Map<String, dynamic> r, {bool vendors = false}) {
  final n = (r['placed'] as List?)?.length ?? 0;
  final of = inum(r['trucks']).toInt();
  final pct = of > 0 ? n / of : 0.0;
  // A Latin name inside an Arabic sentence is isolated (FSI…PDI) so the words keep their order.
  final handler = '${r['handlerName'] ?? ''}'.isEmpty ? '' : '\u2068${r['handlerName']}\u2069';
  switch ('${r['status']}') {
    case 'completed': return (vendors ? tr('اكتمل ($n من $of)', 'Done ($n of $of)') : tr('أنجزها الموردون ($n من $of)', 'Done by vendors ($n of $of)'), T.success, 1.0);
    case 'in_progress': return (tr('جارٍ: أُسندت $n من $of', 'In progress: $n of $of'), T.info, pct);
    case 'rejected': return (n > 0 ? tr('رُفض الباقي بعد إسناد $n من $of', 'Rest rejected after $n of $of') : (vendors ? tr('مرفوض', 'Rejected') : tr('رفضها الموردون', 'Rejected by vendors')), T.danger, pct);
    case 'cancelled': return (n > 0 ? tr('سحب فريق المبيعات الباقي بعد إسناد $n من $of', 'Sales withdrew the rest after $n of $of') : tr('سحبه فريق المبيعات', 'Withdrawn by sales'), T.inkFaint, pct);
    default: return handler.isNotEmpty
        ? (tr('يعمل عليه $handler — 0 من $of', 'With $handler — 0 of $of'), T.warn, 0.0)
        : (vendors ? tr('لم يبدأ بعد — 0 من $of', 'Not started — 0 of $of') : tr('لم يبدأ الموردون — 0 من $of', 'Not started by vendors — 0 of $of'), T.warn, 0.0);
  }
}

Widget srProgressLine(Map<String, dynamic> r, {bool vendors = false}) {
  final p = srVendorProgress(r, vendors: vendors);
  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text(p.$1, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: p.$2)),
    const SizedBox(height: 3),
    ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: p.$3, minHeight: 5, backgroundColor: T.line, color: T.success)),
  ]);
}

const _logLabels = <String, (String, String)>{
  'created': ('أُنشئ الطلب', 'Created'),
  'edited': ('عُدّل', 'Edited'),
  'resubmitted': ('أُعيد إرساله', 'Resent'),
  'claimed': ('تولّاه', 'Taken'),
  'released': ('تُرك', 'Released'),
  'placed': ('أُنشئ أمر نقل', 'Truck placed'),
  'completed': ('اكتمل', 'Completed'),
  'rejected': ('رُفض', 'Rejected'),
  'cancelled': ('سُحب', 'Withdrawn'),
  'expired': ('انتهت ساعة التولّي', 'Claim expired'),
  'sourced': ('سجّل تحصيل سيارات', 'Trucks sourced'),
  'sourcing_edited': ('عُدّل تحصيل السيارات', 'Sourcing edited'),
  'sourcing_deleted': ('حُذف تحصيل سيارات', 'Sourcing deleted'),
  'approval_requested': ('أُرسل للاعتماد', 'Sent for approval'),
  'approved': ('اعتمده مدير المبيعات', 'Approved'),
  'returned': ('أُعيد للتعديل', 'Returned for edits'),
  'declined': ('رفضه مدير المبيعات', 'Declined by the sales manager'),
};

/// Sales-manager approval of a sales rep's request; a missing status means approved.
const srApproval = <String, (String, String, Color)>{
  'pending': ('بانتظار اعتماد المدير', 'Awaiting manager approval', T.warn),
  'approved': ('معتمَد', 'Approved', T.success),
  'returned': ('أُعيد للتعديل', 'Returned for edits', T.violet),
  'rejected': ('رفضه مدير المبيعات', 'Declined by the manager', T.danger),
};
String srApprovalOf(Map r) => '${r['approvalStatus'] ?? ''}'.isEmpty ? 'approved' : '${r['approvalStatus']}';

/// «تحصيل السيارات»: trucks the team reported finding (a follow-up aid, not completions).
(int, int, int) srSourced(Map r) {
  final trucks = inum(r['trucks']).toInt();
  final sourced = inum(r['sourced'] ?? ((r['sourcing'] as List?) ?? const []).fold<num>(0, (n, e) => n + inum((e as Map)['count']))).toInt();
  return (sourced, trucks, (trucks - sourced) < 0 ? 0 : trucks - sourced);
}

/// "HH:MM" of a date, local time.
String srHm(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  return d == null ? '' : '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Team members for a «بمساعدة» picker: team = vendors | fleet | helpers.
Future<List<Map<String, dynamic>>> srTeamMembers(String team) async {
  final d = await Api.instance.get('/api/shipment-requests/team-members?team=$team');
  return List<Map<String, dynamic>>.from(((d['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
}

/// Searchable person picker over a loaded list; returns the option or null.
Future<Map<String, dynamic>?> srPickPerson(BuildContext context, String title, List<Map<String, dynamic>> options) => pickRemote(context,
    title: title,
    fetch: (q) async {
      final f = q.trim().toLowerCase();
      return options.where((x) => f.isEmpty || '${x['label']}'.toLowerCase().contains(f)).toList();
    },
    label: (x) => '${x['label'] ?? ''}',
    sub: (x) => '${x['roleAr'] ?? ''}');

/// Keys of the shipment form that belong to the vendors half or are derived; the request form leaves them out.
/// Truck types sales accepts on a request (any of them); old rows carry only the joined `truckType`.
List<String> srTruckTypes(Map r) {
  final l = [for (final x in (r['truckTypes'] as List?) ?? const []) if ('$x'.trim().isNotEmpty) '$x'.trim()];
  if (l.isNotEmpty) return l;
  return '${r['truckType'] ?? ''}'.split(' / ').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
}

/// Types actually sent by the vendors team, from the placed trucks.
String srTypesSent(Map r) => {for (final p in (r['placed'] as List?) ?? const []) if ('${(p as Map)['truckType'] ?? ''}'.isNotEmpty) '${p['truckType']}'}.join('، ');

const _vendorKeys = {'buyPrice', 'advanceAmount', 'driverRentPrice', 'driverName', 'driverPhone', 'vehicleName', 'driverRentType', 'status', 'paymentMethod'};
/// Keys written on the request itself; any other configured field goes in customFields.
const _salesKeys = {'fromCity', 'toCity', 'branch', 'notes', 'blNumber', 'containerNumber', 'truckType', 'cargoType', 'truckLength', 'quantity', 'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'paymentSubtype'};
const _timeKeys = {'pickupTime', 'startTime', 'arrivalTime'};
const _groups = [('pickup_delivery', 'الاستلام والتسليم', 'Pickup & delivery'), ('shipment', 'تفاصيل الشحنة', 'Shipment details'), ('pricing_time', 'الأسعار والتوقيت', 'Prices & timing'), ('payment', 'المدفوعات', 'Payments')];

String _dateOnly(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  return d == null ? '' : ymd(d);
}

/// Searchable list read from the server as the user types (the supplier and truck registers are thousands of rows).
Future<Map<String, dynamic>?> pickRemote(BuildContext context, {
  required String title,
  required Future<List<Map<String, dynamic>>> Function(String q) fetch,
  required String Function(Map<String, dynamic>) label,
  String Function(Map<String, dynamic>)? sub,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _RemotePicker(title: title, fetch: fetch, label: label, sub: sub),
  );
}

class _RemotePicker extends StatefulWidget {
  final String title;
  final Future<List<Map<String, dynamic>>> Function(String q) fetch;
  final String Function(Map<String, dynamic>) label;
  final String Function(Map<String, dynamic>)? sub;
  const _RemotePicker({required this.title, required this.fetch, required this.label, this.sub});
  @override
  State<_RemotePicker> createState() => _RemotePickerState();
}

class _RemotePickerState extends State<_RemotePicker> {
  List<Map<String, dynamic>> _rows = [];
  bool _busy = true;
  int _seq = 0;
  Timer? _t;
  @override
  void initState() { super.initState(); _run(''); }
  @override
  void dispose() { _t?.cancel(); super.dispose(); }
  Future<void> _run(String q) async {
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final r = await widget.fetch(q);
      if (mounted && mine == _seq) setState(() { _rows = r; _busy = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _busy = false);
    }
  }
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.75,
          child: Column(children: [
            Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: SearchField(autofocus: true, hint: tr('اكتب للبحث…', 'Type to search…'),
                onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 350), () => _run(v.trim())); })),
            if (_busy) const LinearProgressIndicator(minHeight: 2),
            Expanded(child: _rows.isEmpty && !_busy
                ? Center(child: Text(tr('لا نتائج', 'No results'), style: const TextStyle(color: T.inkFaint)))
                : ListView.builder(
                    itemCount: _rows.length,
                    itemBuilder: (_, i) => ListTile(
                      dense: true,
                      title: Text(widget.label(_rows[i]), style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: widget.sub == null || widget.sub!(_rows[i]).isEmpty ? null : Text(widget.sub!(_rows[i])),
                      onTap: () => Navigator.pop(context, _rows[i]),
                    ),
                  )),
          ]),
        ),
      );
}

// ── Sales: the request form ────────────────────────────────────────────────

class ShipmentRequestFormScreen extends StatefulWidget {
  final Map<String, dynamic>? request;
  const ShipmentRequestFormScreen({super.key, this.request});
  @override
  State<ShipmentRequestFormScreen> createState() => _ShipmentRequestFormScreenState();
}

class _ShipmentRequestFormScreenState extends State<ShipmentRequestFormScreen> {
  List<Map<String, dynamic>> _fields = [];
  List<Map<String, dynamic>> _reps = [];
  Map<String, dynamic>? _customer;
  bool _newCustomer = false;
  final _ncName = TextEditingController();
  final _ncPhone = TextEditingController();
  String? _salesRep;
  int _trucks = 1;
  final Map<String, dynamic> _form = {};
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _missing = {};
  List<String> get _types => [for (final x in (_form['truckTypes'] as List?) ?? const []) '$x'];
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool get _editing => widget.request != null;
  bool get _rejected => widget.request?['status'] == 'rejected' || widget.request?['approvalStatus'] == 'returned';
  bool get _returned => widget.request?['approvalStatus'] == 'returned';

  @override
  void initState() {
    super.initState();
    final r = widget.request;
    if (r != null) {
      for (final k in _salesKeys) {
        final v = r[k];
        if (v == null) continue;
        _form[k] = const {'pickupTime', 'startTime', 'arrivalTime'}.contains(k) ? _dateOnly(v) : v;
      }
      (r['customFields'] as Map?)?.forEach((k, v) => _form['$k'] = v);
      _form['truckTypes'] = srTruckTypes(r);
      _trucks = inum(r['trucks']).toInt().clamp(1, 25);
      if (r['customer'] != null) _customer = {'_id': r['customer'] is Map ? r['customer']['_id'] : r['customer'], 'name': r['customerName']};
      _salesRep = r['salesRep'] == null ? null : '${r['salesRep'] is Map ? r['salesRep']['_id'] : r['salesRep']}';
    }
    _load();
    Live.instance.on('shipmentOrders:fields', _reloadFields);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:fields', _reloadFields);
    for (final c in _ctrls.values) { c.dispose(); }
    _ncName.dispose();
    _ncPhone.dispose();
    super.dispose();
  }

  void _reloadFields() => _loadFields();

  Future<void> _loadFields() async {
    final f = await Api.instance.get('/api/shipment-orders/fields');
    final all = List<Map<String, dynamic>>.from(((f['fields'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
    if (!mounted) return;
    // Pickup, start and arrival times are written by whoever completes the truck, not by sales.
    setState(() => _fields = all.where((x) => x['active'] != false && x['deleted'] != true && !_vendorKeys.contains(x['key']) && !_timeKeys.contains(x['key'])).toList()
      ..sort((a, b) => inum(a['order']).compareTo(inum(b['order']))));
  }

  Future<void> _load() async {
    try {
      await _loadFields();
      final reps = await Api.instance.get('/api/shipment-orders/sales-reps');
      if (!mounted) return;
      setState(() { _reps = List<Map<String, dynamic>>.from(((reps['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e))); _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  TextEditingController _ctrl(String k) => _ctrls.putIfAbsent(k, () => TextEditingController(text: _form[k] == null ? '' : '${_form[k]}'));

  Future<void> _pickCustomer() async {
    final c = await pickRemote(context,
      title: tr('العملاء', 'Customers'),
      fetch: (q) async {
        final d = await Api.instance.get('/api/shipment-orders/customers?picker=1${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        final rows = List<Map<String, dynamic>>.from(((d['customers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        if (q.isEmpty) return rows.take(200).toList();
        final f = q.replaceAll(RegExp('[أإآ]'), 'ا');
        return rows.where((r) => '${r['name']}'.replaceAll(RegExp('[أإآ]'), 'ا').contains(f) || '${r['phone'] ?? ''}'.contains(q)).take(200).toList();
      },
      label: (c) => '${c['name'] ?? ''}',
      sub: (c) => '${c['phone'] ?? ''}',
    );
    if (c == null) return;
    setState(() {
      _customer = c;
      _newCustomer = false;
      // One agreed value fills; several are left for the user to choose.
      final d = (c['defaults'] as Map?) ?? const {};
      for (final k in ['cargoType', 'branch', 'paymentSubtype']) {
        final one = prefOnly(d[k]);
        if (one.isNotEmpty && '${_form[k] ?? ''}'.isEmpty) { _form[k] = one; _ctrls.remove(k); }
      }
      final trucks = prefList(d['truckType']);
      if (_types.isEmpty && trucks.length == 1) _form['truckTypes'] = trucks;
      _routePrice();
    });
  }

  /// The customer's price for the route fills an empty selling price, on a new request only.
  void _routePrice() {
    if (_editing || _customer == null) return;
    final from = '${_form['fromCity'] ?? ''}';
    final to = '${_form['toCity'] ?? ''}';
    if (from.isEmpty || to.isEmpty || '${_form['sellPrice'] ?? ''}'.trim().isNotEmpty) return;
    for (final r in List<Map>.from(_customer!['routes'] ?? const [])) {
      if (r['fromCity'] == from && r['toCity'] == to && r['price'] != null) { _form['sellPrice'] = r['price']; _ctrls.remove('sellPrice'); }
    }
  }

  Future<void> _addOption(Map<String, dynamic> f, String label) async {
    final c = TextEditingController();
    final v = await showDialog<String>(context: context, builder: (d) => AlertDialog(
      title: Text(tr('إضافة $label', 'Add $label')),
      content: TextField(controller: c, autofocus: true),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: Text(tr('إضافة', 'Add'))),
      ],
    ));
    if (v == null || v.isEmpty) return;
    try {
      final d = await Api.instance.post('/api/shipment-orders/fields/${f['_id']}/options', {'ar': v});
      final nf = Map<String, dynamic>.from(d['field'] ?? {});
      if (!mounted) return;
      setState(() {
        final i = _fields.indexWhere((x) => x['_id'] == f['_id']);
        if (i >= 0 && nf.isNotEmpty) _fields[i] = nf;
        final opt = List<Map>.from(nf['options'] ?? const []).firstWhere((o) => o['ar'] == v, orElse: () => {'key': v});
        _form['${f['key']}'] = opt['key'];
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Widget _field(Map<String, dynamic> f) {
    final k = '${f['key']}';
    final label = tr('${f['labelAr'] ?? k}', '${f['labelEn'] ?? f['labelAr'] ?? k}');
    final req = f['required'] == true || k == 'sellPrice';
    final miss = _missing.contains(k);
    final deco = InputDecoration(
      labelText: req ? '$label *' : label,
      labelStyle: miss ? const TextStyle(color: T.danger, fontWeight: FontWeight.w700) : null,
      enabledBorder: miss ? OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: T.danger)) : null,
    );
    final type = '${f['inputType'] ?? 'text'}';
    // Truck type on a request is a multi-choice: any ticked type suits the load; vendors fix the final one per truck.
    if (k == 'truckType') {
      final options = List<Map<String, dynamic>>.from(((f['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(req ? '$label *' : label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: miss ? T.danger : T.ink)),
        const SizedBox(height: 2),
        Text(tr('اختر نوعًا أو أكثر يصلح لهذه الحمولة، ويحدّد فريق الموردين النوعَ النهائيّ لكلّ شاحنة.', 'Tick one or more types that suit this load; the vendors team fixes the final type per truck.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final o in options)
            FilterChip(
              label: Text(tr('${o['ar'] ?? o['key']}', '${o['en'] ?? o['ar'] ?? o['key']}')),
              selected: _types.contains('${o['key']}'),
              selectedColor: T.orange.withValues(alpha: 0.18),
              checkmarkColor: T.orange,
              side: BorderSide(color: miss ? T.danger : Colors.black12),
              onSelected: (on) => setState(() {
                final l = [..._types];
                if (on) { if (!l.contains('${o['key']}')) l.add('${o['key']}'); } else { l.remove('${o['key']}'); }
                _form['truckTypes'] = l;
                _missing.remove(k);
              }),
            ),
        ]),
      ]);
    }
    if (type == 'select' || type == 'cards') {
      final options = List<Map<String, dynamic>>.from(((f['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      final cur = '${_form[k] ?? ''}';
      final hit = options.firstWhere((o) => o['key'] == cur, orElse: () => const {});
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(
          onTap: () async {
            final v = await pickRemote(context, title: label,
                fetch: (q) async => options.where((o) => q.isEmpty || '${o['ar']} ${o['en']}'.contains(q)).toList(),
                label: (o) => tr('${o['ar'] ?? o['key']}', '${o['en'] ?? o['ar'] ?? o['key']}'));
            if (v == null) return;
            setState(() { _form[k] = v['key']; _missing.remove(k); if (k == 'fromCity' || k == 'toCity') _routePrice(); });
          },
          child: InputDecorator(decoration: deco.copyWith(suffixIcon: const Icon(Icons.arrow_drop_down)),
              child: Text(hit.isEmpty ? (cur.isEmpty ? tr('اختر', 'Choose') : cur) : tr('${hit['ar'] ?? hit['key']}', '${hit['en'] ?? hit['ar'] ?? hit['key']}'),
                  style: TextStyle(color: cur.isEmpty ? T.inkFaint : T.ink))),
        ),
        if (f['locked'] != true && type == 'select')
          Align(alignment: AlignmentDirectional.centerStart, child: TextButton(
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
            onPressed: () => _addOption(f, label),
            child: Text('+ ${tr('إضافة $label', 'Add $label')}', style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w700)),
          )),
      ]);
    }
    if (type == 'date' || type == 'datetime') {
      final cur = '${_form[k] ?? ''}';
      return OutlinedButton.icon(
        style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14), side: BorderSide(color: miss ? T.danger : Colors.black12)),
        onPressed: () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(cur) ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 365)));
          if (d != null) setState(() { _form[k] = ymd(d); _missing.remove(k); });
        },
        icon: Icon(Icons.event, size: 17, color: miss ? T.danger : T.navy),
        label: Text(cur.isEmpty ? (req ? '$label *' : label) : '$label: $cur', style: TextStyle(fontSize: 13, color: miss ? T.danger : T.ink)),
      );
    }
    return TextField(
      controller: _ctrl(k),
      maxLines: type == 'textarea' ? 3 : 1,
      keyboardType: type == 'number' ? TextInputType.number : null,
      onChanged: (v) => _form[k] = type == 'number' ? (num.tryParse(v) ?? v) : v,
      decoration: deco,
    );
  }

  Future<void> _save({bool resubmit = false}) async {
    if (_saving) return;
    _missing.clear();
    for (final f in _fields) {
      final k = '${f['key']}';
      if (k == 'truckType') { if (f['required'] == true && _types.isEmpty) _missing.add(k); continue; }
      if ((f['required'] == true || k == 'sellPrice') && '${_form[k] ?? ''}'.trim().isEmpty) _missing.add(k);
    }
    if (!((num.tryParse('${_form['sellPrice'] ?? ''}') ?? 0) > 0)) _missing.add('sellPrice');
    if (_customer == null && !(_newCustomer && _ncName.text.trim().isNotEmpty)) _missing.add('customer');
    if (_missing.isNotEmpty) {
      setState(() {});
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أكمِل الحقول المحدّدة بالأحمر', 'Fill the highlighted fields'))));
      return;
    }
    setState(() => _saving = true);
    final body = <String, dynamic>{'customFields': <String, dynamic>{}, 'trucks': _trucks};
    for (final f in _fields) {
      final k = '${f['key']}';
      if (k == 'truckType') continue;
      final v = _form[k];
      if (v == null || '$v'.trim().isEmpty) continue;
      if (_salesKeys.contains(k)) { body[k] = v; } else { body['customFields'][k] = v; }
    }
    body['truckTypes'] = _types;
    for (final k in ['notes', 'blNumber', 'containerNumber']) {
      if (_form.containsKey(k)) body[k] = '${_form[k] ?? ''}'.trim();
    }
    if (body['sellPrice'] != null) body['sellPrice'] = num.tryParse('${body['sellPrice']}');
    if (_customer != null) body['customer'] = _customer!['_id'];
    if (_newCustomer && _ncName.text.trim().isNotEmpty) body['newCustomer'] = {'name': _ncName.text.trim(), 'phone': _ncPhone.text.trim()};
    if (_salesRep != null) body['salesRep'] = _salesRep;
    if (resubmit) body['resubmit'] = true;
    try {
      if (_editing) {
        await Api.instance.put('/api/shipment-requests/${widget.request!['_id']}', body);
      } else {
        final d = await Api.instance.post('/api/shipment-requests', body);
        final wait = d['request']?['approvalStatus'] == 'pending';
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(wait
              ? tr('أُرسل طلب الشحنة رقم ${d['request']?['number']} إلى مدير المبيعات للاعتماد', 'Request ${d['request']?['number']} sent to the sales manager for approval')
              : tr('أُرسل طلب الشحنة رقم ${d['request']?['number']} إلى فريق الموردين', 'Request ${d['request']?['number']} sent to the vendors team'))));
        }
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Widget _plainText(String k, String label) => TextField(controller: _ctrl(k), onChanged: (v) => _form[k] = v, decoration: InputDecoration(labelText: label));

  @override
  Widget build(BuildContext context) {
    final placed = (widget.request?['placed'] as List?)?.length ?? 0;
    return AppScaffold(
      title: Text(_editing ? tr('تعديل طلب الشحنة رقم ${widget.request!['number']}', 'Edit request ${widget.request!['number']}') : tr('طلب شحنة', 'Shipment request')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
                  if (_returned)
                    Padding(padding: const EdgeInsets.only(bottom: 10), child: AppCard(topAccent: T.violet, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(tr('أعاده مدير المبيعات للتعديل', 'Returned by the sales manager for edits'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.violet)),
                      Text('${widget.request!['approvalReason'] ?? ''}'),
                      Text(tr('عدّل ما يلزم ثم اضغط «حفظ وإعادة الإرسال» ليعود إلى الاعتماد.', 'Amend it, then press “Save and resend” to send it back for approval.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    ])))
                  else if (_rejected)
                    Padding(padding: const EdgeInsets.only(bottom: 10), child: AppCard(topAccent: T.danger, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(tr('رفضه فريق الموردين', 'Rejected by the vendors team'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                      Text('${widget.request!['rejectReason'] ?? ''}${'${widget.request!['rejectNote'] ?? ''}'.isEmpty ? '' : ' — ${widget.request!['rejectNote']}'}'),
                      Text(tr('عدّل ما يلزم ثم اضغط «حفظ وإعادة الإرسال».', 'Amend what is needed, then press “Save and resend”.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    ]))),
                  AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(tr('العميل ومندوب المبيعات', 'Customer & operational sales'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    if (!_newCustomer)
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46),
                            side: BorderSide(color: _missing.contains('customer') ? T.danger : Colors.black12)),
                        onPressed: placed > 0 ? null : _pickCustomer,
                        icon: const Icon(Icons.search, size: 17),
                        label: Text(_customer == null ? tr('اختر العميل… *', 'Choose customer… *') : '${_customer!['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      )
                    else ...[
                      TextField(controller: _ncName, decoration: InputDecoration(labelText: tr('اسم العميل الجديد *', 'New customer name *'))),
                      const SizedBox(height: 6),
                      TextField(controller: _ncPhone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('الجوال', 'Phone'))),
                    ],
                    if (placed == 0)
                      Align(alignment: AlignmentDirectional.centerStart, child: TextButton(
                        onPressed: () => setState(() { _newCustomer = !_newCustomer; if (_newCustomer) _customer = null; }),
                        child: Text(_newCustomer ? tr('اختيار من السجل', 'Pick existing') : tr('+ عميلٌ جديد', '+ New customer')),
                      )),
                    DropdownButtonFormField<String>(
                      initialValue: _reps.any((r) => '${r['value']}' == _salesRep) ? _salesRep : null,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('مندوب المبيعات — من جاء بهذه الحمولة', 'Operational sales — who brought this load')),
                      items: [for (final r in _reps) DropdownMenuItem(value: '${r['value']}', child: Text('${r['label']} · ${r['roleAr'] ?? ''}', overflow: TextOverflow.ellipsis))],
                      onChanged: (v) => setState(() => _salesRep = v),
                    ),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(child: Text(tr('عدد الشاحنات بالمواصفات نفسها', 'Trucks with the same specs'), style: const TextStyle(fontWeight: FontWeight.w700))),
                      IconButton(onPressed: _trucks > (placed > 0 ? placed : 1) ? () => setState(() => _trucks--) : null, icon: const Icon(Icons.remove_circle_outline)),
                      Text('$_trucks', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                      IconButton(onPressed: _trucks < 25 ? () => setState(() => _trucks++) : null, icon: const Icon(Icons.add_circle_outline, color: T.orange)),
                    ]),
                  ])),
                  for (final g in _groups)
                    if (_fields.any((f) => f['group'] == g.$1))
                      Padding(padding: const EdgeInsets.only(top: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr(g.$2, g.$3), style: const TextStyle(fontWeight: FontWeight.w800)),
                        for (final f in _fields.where((f) => f['group'] == g.$1)) Padding(padding: const EdgeInsets.only(top: 8), child: _field(f)),
                        if (g.$1 == 'pickup_delivery') ...[
                          const SizedBox(height: 8),
                          _plainText('notes', tr('ملاحظة الرحلة', 'Trip note')),
                          const SizedBox(height: 8),
                          _plainText('blNumber', tr('رقم البوليصة (اختياري)', 'B/L number (optional)')),
                          const SizedBox(height: 8),
                          _plainText('containerNumber', tr('رقم الحاوية (اختياري)', 'Container number (optional)')),
                        ],
                      ]))),
                  const SizedBox(height: 12),
                  Text(tr('سعرُ الشراء والمورّدُ والسيارةُ والسائقُ وأوقاتُ الاستلام والبداية والوصول يكملها فريقُ الموردين.', 'The vendors team adds the buying price, supplier, truck, driver and the pickup/start/arrival times.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                ]),
      floatingActionButton: _loading ? null : Row(mainAxisSize: MainAxisSize.min, children: [
        if (_rejected) ...[
          FloatingActionButton.extended(
            heroTag: 'resend',
            onPressed: _saving ? null : () => _save(resubmit: true),
            icon: const Icon(Icons.send),
            label: Text(tr('حفظ وإعادة الإرسال', 'Save and resend')),
          ),
          const SizedBox(width: 8),
        ],
        FloatingActionButton.extended(
          heroTag: 'save',
          backgroundColor: _rejected ? T.inkSoft : null,
          onPressed: _saving ? null : () => _save(),
          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
          label: Text(_editing ? tr('حفظ', 'Save') : tr('إرسال الطلب', 'Send request')),
        ),
      ]),
    );
  }
}

// ── Lists: sales («طلباتي») and vendors («الطلبات من المبيعات») ─────────────

class ShipmentRequestsScreen extends StatefulWidget {
  /// 'ask' = sales view (own requests, create, approvals), 'place' = vendors inbox, 'fleet' = the fleet's inbox (our trucks).
  final String mode;
  const ShipmentRequestsScreen({super.key, required this.mode});
  @override
  State<ShipmentRequestsScreen> createState() => _ShipmentRequestsScreenState();
}

class _ShipmentRequestsScreenState extends State<ShipmentRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _by = {};
  Map<String, dynamic> _can = {};
  bool _loading = true;
  String? _error;
  int _seq = 0;
  bool get _work => widget.mode != 'ask';
  late String _status = _work ? 'pending,in_progress' : '';
  // Standalone branch filter (server side), saved on the account per board.
  late final String _branchKey = 'shipmentRequests.branch.${widget.mode}';
  String _branch = '';
  List<String> _branches = const [];
  // Open requests per branch (server branchList), shown on each chip.
  Map<String, int> _branchOpen = const {};
  // Approvals view on the sales page (sales manager and his delegates).
  bool _approvals = false;
  String _approval = 'pending';
  Map<String, dynamic> _ac = {};
  String _q = '';
  Timer? _t;
  late final void Function() _onLive = _load;
  // Date range goes to the server; the other filters narrow the loaded rows, as on web.
  String _from = '';
  String _to = '';
  final Map<String, String> _flt = {};
  late final String _viewKey = 'shipmentRequests.view.${widget.mode}';
  String _view = 'list';

  @override
  void initState() {
    super.initState();
    // The list is the default view; cards only when the user chose them (web saves 'table', mobile 'list').
    _view = context.read<AuthProvider>().pref(_viewKey) == 'cards' ? 'cards' : 'list';
    _branch = context.read<AuthProvider>().pref(_branchKey);
    _load();
    Live.instance.on(srEvent, _onLive);
  }

  /// Switches at once and saves on the account in the background.
  Future<void> _setView(String v) async {
    if (v == _view) return;
    setState(() => _view = v);
    final auth = context.read<AuthProvider>();
    try {
      await Api.instance.patch('/api/auth/me/prefs', {'key': _viewKey, 'value': v});
      auth.setPref(_viewKey, v);
    } catch (_) {}
  }

  /// Client-side filters: (key, Arabic, English, reader).
  List<(String, String, String, String Function(Map<String, dynamic>))> get _filters => [
        ('customer', 'العميل', 'Customer', (r) => '${r['customerName'] ?? ''}'),
        ('salesRep', 'السيلز', 'Sales rep', (r) => '${r['salesRepName'] ?? r['createdByName'] ?? ''}'),
        ('handler', 'مسؤول الموردين', 'Vendors handler', (r) => '${r['handlerName'] ?? ''}'),
        ('progress', _work ? 'الإنجاز' : 'إنجاز الموردين', 'Progress', (r) => srVendorProgress(r, vendors: _work).$1),
        ('fromCity', 'من', 'From', (r) => '${r['fromCity'] ?? ''}'),
        ('toCity', 'إلى', 'To', (r) => '${r['toCity'] ?? ''}'),
        ('truckType', 'نوع الشاحنة', 'Truck type', (r) => '${r['truckType'] ?? ''}'),
        ('branch', 'الفرع', 'Branch', (r) => '${r['branch'] ?? ''}'),
        ('supplier', 'المورّد', 'Supplier', (r) => _suppliers(r).join('، ')),
      ];

  static List<String> _suppliers(Map<String, dynamic> r) =>
      {for (final p in (r['placed'] as List?) ?? const []) if ('${(p as Map)['supplierName'] ?? ''}'.isNotEmpty) '${p['supplierName']}'}.toList();
  static List<String> _placedField(Map<String, dynamic> r, String k) =>
      [for (final p in (r['placed'] as List?) ?? const []) if ('${(p as Map)[k] ?? ''}'.isNotEmpty) '${p[k]}'];

  Future<void> _setBranch(String b) async {
    setState(() => _branch = b);
    _load();
    final auth = context.read<AuthProvider>();
    try {
      await Api.instance.patch('/api/auth/me/prefs', {'key': _branchKey, 'value': b});
      auth.setPref(_branchKey, b);
    } catch (_) {}
  }

  static bool _isOpen(Map r) => const ['pending', 'in_progress'].contains('${r['status']}');

  List<Map<String, dynamic>> get _shown {
    final out = _rows.where((r) {
      for (final f in _filters) {
        final want = _flt[f.$1];
        if (want == null || want.isEmpty) continue;
        if (f.$1 == 'supplier' ? !_suppliers(r).contains(want) : f.$4(r) != want) return false;
      }
      return true;
    }).toList();
    // Working board: open requests first, grouped by branch then newest; finished ones after, newest first.
    if (_work) {
      out.sort((a, b) {
        final oa = _isOpen(a), ob = _isOpen(b);
        if (oa != ob) return oa ? -1 : 1;
        if (oa) {
          final c = '${a['branch'] ?? ''}'.compareTo('${b['branch'] ?? ''}');
          if (c != 0) return c;
        }
        return '${b['createdAt'] ?? ''}'.compareTo('${a['createdAt'] ?? ''}');
      });
    }
    return out;
  }

  int get _filterCount => _flt.values.where((v) => v.isNotEmpty).length + (_from.isNotEmpty ? 1 : 0) + (_to.isNotEmpty ? 1 : 0);

  static int _openCount(Map<String, dynamic> r) => inum(r['open'] ?? (inum(r['trucks']) - ((r['placed'] as List?)?.length ?? 0))).toInt();

  List<ExportCol> get _exportCols {
    final sell = _rows.any((r) => r.containsKey('sellPrice'));
    return [
      ExportCol('رقم الطلب', 'Request', (r) => r['number']),
      ExportCol('الحالة', 'Status', (r) { final x = srStatuses['${r['status']}']; return x == null ? '${r['status']}' : tr(x.$1, x.$2); }),
      ExportCol(_work ? 'الإنجاز' : 'إنجاز الموردين', 'Progress', (r) => srVendorProgress(r, vendors: _work).$1),
      ExportCol('الشاحنات المطلوبة', 'Trucks asked', (r) => inum(r['trucks'])),
      ExportCol('أُسندت', 'Placed', (r) => (r['placed'] as List?)?.length ?? 0),
      ExportCol('تحصيل السيارات', 'Trucks sourced', (r) => srSourced(r).$1),
      ExportCol('متبقّية', 'Remaining', (r) => ['pending', 'in_progress'].contains('${r['status']}') ? _openCount(r) : 0),
      ExportCol('مرفوضة/مسحوبة', 'Rejected/withdrawn', (r) => ['rejected', 'cancelled'].contains('${r['status']}') ? _openCount(r) : 0),
      ExportCol('العميل', 'Customer', (r) => r['customerName']),
      ExportCol('من', 'From', (r) => r['fromCity']),
      ExportCol('إلى', 'To', (r) => r['toCity']),
      ExportCol('نوع الشاحنة', 'Truck type', (r) => r['truckType']),
      ExportCol('النوع المنفَّذ', 'Type sent', (r) => srTypesSent(r)),
      ExportCol('الطول', 'Length', (r) => r['truckLength']),
      ExportCol('نوع الحمولة', 'Cargo', (r) => r['cargoType']),
      ExportCol('موعد التحميل', 'Pickup', (r) => _dateOnly(r['pickupTime'])),
      if (sell) ExportCol('سعر البيع للشاحنة', 'Sell / truck', (r) => r['sellPrice']),
      ExportCol('طريقة الدفع', 'Payment', (r) => '${r['paymentSubtype'] ?? ''}'.isEmpty ? '' : opsPaymentKindLabel('${r['paymentSubtype']}')),
      ExportCol('السيلز', 'Sales rep', (r) => r['salesRepName']),
      ExportCol('أنشأه', 'Created by', (r) => r['createdByName']),
      ExportCol('تاريخ الطلب', 'Requested', (r) => _dateOnly(r['createdAt'])),
      ExportCol('مسؤول الموردين', 'Vendors handler', (r) => r['handlerName']),
      ExportCol('أوامر النقل', 'Transport orders', (r) => _placedField(r, 'waybillNumber').join('، ')),
      ExportCol('المورّدون', 'Suppliers', (r) => _suppliers(r).join('، ')),
      ExportCol('السيارات', 'Trucks', (r) => _placedField(r, 'vehiclePlate').join('، ')),
      ExportCol('السائقون', 'Drivers', (r) => _placedField(r, 'driverName').join('، ')),
      ExportCol('سبب الرفض', 'Reject reason', (r) => r['rejectReason']),
      ExportCol('الفرع', 'Branch', (r) => r['branch']),
      ExportCol('رقم البوليصة', 'BL', (r) => r['blNumber']),
      ExportCol('رقم الحاوية', 'Container', (r) => r['containerNumber']),
      ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
    ];
  }

  Future<void> _pickDate(bool from, StateSetter setSheet) async {
    final cur = DateTime.tryParse(from ? _from : _to) ?? DateTime.now();
    final d = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime(2100));
    if (d == null) return;
    setState(() => from ? _from = ymd(d) : _to = ymd(d));
    setSheet(() {});
    _load();
  }

  /// Filter sheet: dates (server) and one value per detail (from the loaded rows).
  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => StatefulBuilder(builder: (sheetCtx, setSheet) {
        final rows = _rows;
        return SafeArea(child: Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(sheetCtx).viewInsets.bottom + 14),
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(tr('فلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              if (_filterCount > 0)
                TextButton(onPressed: () { setState(() { _flt.clear(); _from = ''; _to = ''; }); setSheet(() {}); _load(); }, child: Text(tr('مسح الفلاتر', 'Clear filters'))),
            ]),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_from.isEmpty ? tr('من تاريخ', 'From date') : _from), onPressed: () => _pickDate(true, setSheet)),
              ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(_to.isEmpty ? tr('إلى تاريخ', 'To date') : _to), onPressed: () => _pickDate(false, setSheet)),
              if (_from.isNotEmpty || _to.isNotEmpty)
                IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () { setState(() { _from = ''; _to = ''; }); setSheet(() {}); _load(); }),
            ]),
            for (final f in _filters) ...[
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _flt[f.$1] ?? '',
                decoration: InputDecoration(labelText: tr(f.$2, f.$3), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                  // The picked value stays listed even if a reload dropped it, or the dropdown would assert.
                  for (final v in ({
                    for (final r in rows)
                      ...(f.$1 == 'supplier' ? _suppliers(r) : [f.$4(r)]).where((x) => x.isNotEmpty),
                    if ((_flt[f.$1] ?? '').isNotEmpty) _flt[f.$1]!,
                  }.toList()..sort()))
                    DropdownMenuItem(value: v, child: Text(v, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) { setState(() => _flt[f.$1] = v ?? ''); setSheet(() {}); },
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(height: 48, child: FilledButton(
              onPressed: () => Navigator.pop(sheetCtx),
              child: Text(tr('عرض ${_shown.length} طلب', 'Show ${_shown.length} requests')),
            )),
          ])),
        ));
      }),
    );
  }

  @override
  void dispose() {
    Live.instance.off(srEvent, _onLive);
    _t?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = ['limit=1000', if (_status.isNotEmpty && !_approvals) 'status=$_status', if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
        if (_from.isNotEmpty) 'from=$_from', if (_to.isNotEmpty) 'to=$_to',
        if (_work) 'view=work', if (_branch.isNotEmpty) 'branch=${Uri.encodeQueryComponent(_branch)}',
        if (_approvals) 'approval=$_approval', if (!_work) 'approvalCounts=1'];
      final d = await Api.instance.get('/api/shipment-requests?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d['requests'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _by = Map<String, dynamic>.from(d['byStatus'] ?? {});
        _can = Map<String, dynamic>.from(d['can'] ?? {});
        _branches = [for (final b in (d['branches'] as List?) ?? const []) if ('$b'.isNotEmpty) '$b'];
        _branchOpen = {for (final b in (d['branchList'] as List?) ?? const []) if (b is Map) '${b['name']}': (b['open'] as num?)?.toInt() ?? 0};
        _ac = Map<String, dynamic>.from(d['approvalCounts'] ?? {});
        if (_approvals && _can['approve'] != true) _approvals = false;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _open(Map<String, dynamic> r) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentRequestDetailScreen(id: '${r['_id']}', mode: widget.mode)));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final tabs = _work
        ? [('pending,in_progress', 'المفتوحة', 'Open', inum(_by['pending']) + inum(_by['in_progress'])), ('completed', 'مكتملة', 'Completed', inum(_by['completed'])), ('rejected', 'مرفوضة', 'Rejected', inum(_by['rejected'])), ('cancelled', 'مسحوبة', 'Withdrawn', inum(_by['cancelled'])), ('', 'الكل', 'All', -1)]
        : [('', 'الكل', 'All', -1), ('pending,in_progress', 'المفتوحة', 'Open', inum(_by['pending']) + inum(_by['in_progress'])), ('rejected', 'مرفوضة', 'Rejected', inum(_by['rejected'])), ('completed', 'مكتملة', 'Completed', inum(_by['completed'])), ('cancelled', 'مسحوبة', 'Withdrawn', inum(_by['cancelled']))];
    return AppScaffold(
      title: Text(widget.mode == 'fleet' ? tr('طلبات من المبيعات', 'Requests from sales') : _work ? tr('الطلبات من المبيعات', 'Requests from sales') : tr('طلبات الشحن', 'Shipment requests')),
      actions: [
        if (!_work && _can['manageApprovers'] == true)
          IconButton(tooltip: tr('المفوَّضون بالاعتماد', 'Approval delegates'), icon: const Icon(Icons.how_to_reg_outlined), onPressed: () => showApproversSheet(context)),
        IconButton(
          tooltip: _view == 'cards' ? tr('عرض القائمة', 'List view') : tr('عرض البطاقات', 'Cards view'),
          icon: Icon(_view == 'cards' ? Icons.view_list_rounded : Icons.view_agenda_outlined),
          onPressed: () => _setView(_view == 'cards' ? 'list' : 'cards'),
        ),
        IconButton(
          tooltip: tr('فلاتر', 'Filters'),
          icon: Badge(isLabelVisible: _filterCount > 0, label: Text('$_filterCount'), child: const Icon(Icons.filter_alt_outlined)),
          onPressed: _openFilters,
        ),
        ExportButton(fileName: _work ? 'shipment-requests-vendors' : 'shipment-requests', sheetName: tr('طلبات الشحن', 'Requests'), columns: _exportCols, rows: () => _shown),
      ],
      floatingActionButton: widget.mode == 'ask' && _can['ask'] == true
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ShipmentRequestFormScreen()));
                if (ok == true) _load();
              },
              icon: const Icon(Icons.add),
              label: Text(tr('طلب شحنة', 'New request')),
            )
          : null,
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: SearchField(
          hint: tr('رقم الطلب، العميل، المدينة، المورّد…', 'Request no., customer, city, supplier…'),
          onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 350), () { _q = v; _load(); }); },
        )),
        if (!_work && _can['approve'] == true)
          Padding(padding: const EdgeInsets.fromLTRB(12, 6, 12, 0), child: SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text(tr('الطلبات', 'Requests'))),
              ButtonSegment(value: true, label: Text('${tr('الاعتمادات', 'Approvals')}${inum(_ac['pending']) > 0 ? ' (${inum(_ac['pending'])})' : ''}')),
            ],
            selected: {_approvals},
            onSelectionChanged: (v) { setState(() => _approvals = v.first); _load(); },
          )),
        if (_approvals)
          SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), child: Row(children: [
            for (final k in const ['pending', 'approved', 'returned', 'rejected'])
              Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                label: Text('${tr(srApproval[k]!.$1, srApproval[k]!.$2)} (${inum(_ac[k])})'),
                selected: _approval == k,
                onSelected: (_) { setState(() => _approval = k); _load(); },
              )),
          ]))
        else
        SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), child: Row(children: [
          for (final t in tabs)
            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
              label: Text(t.$4 < 0 ? tr(t.$2, t.$3) : '${tr(t.$2, t.$3)} (${t.$4})'),
              selected: _status == t.$1,
              onSelected: (_) { setState(() => _status = t.$1); _load(); },
            )),
        ])),
        // Branch: used constantly, so it stands outside the filter sheet.
        if (_branches.isNotEmpty || _branch.isNotEmpty)
          SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(12, 0, 12, 6), child: Row(children: [
            Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: Icon(Icons.store_mall_directory_outlined, size: 18, color: _branch.isEmpty ? T.inkFaint : T.orange)),
            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(label: Text('${tr('كلّ الفروع', 'All branches')} (${_branchOpen.values.fold<int>(0, (a, b) => a + b)})'), selected: _branch.isEmpty, onSelected: (_) => _setBranch(''))),
            for (final b in {..._branches, if (_branch.isNotEmpty) _branch})
              Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                label: Text('$b (${_branchOpen[b] ?? 0})'), selected: _branch == b,
                selectedColor: T.orange.withValues(alpha: 0.18),
                onSelected: (_) => _setBranch(_branch == b ? '' : b),
              )),
          ])),
        // Quick days on the request date (Riyadh); tapping the active one clears it.
        SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(12, 0, 12, 6), child: Row(children: [
          for (final q in _quickDays())
            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
              label: Text(q.$1),
              selected: _from == q.$2 && _to == q.$3,
              onSelected: (_) {
                final on = _from == q.$2 && _to == q.$3;
                setState(() { _from = on ? '' : q.$2; _to = on ? '' : q.$3; });
                _load();
              },
            )),
        ])),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: Builder(builder: (_) {
                      final shown = _shown;
                      if (shown.isEmpty) {
                        return ListView(children: [Padding(padding: const EdgeInsets.all(40), child: Text(_rows.isEmpty ? tr('لا طلبات هنا', 'No requests here') : tr('لا طلبات تطابق الفلاتر', 'No requests match the filters'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))]);
                      }
                      // Trucks: asked, done by vendors, rejected/withdrawn (closed requests), still waiting (open requests).
                      num asked = 0, placed = 0, closed = 0, waiting = 0;
                      for (final r in shown) {
                        final n = inum(r['trucks']);
                        final p = (r['placed'] as List?)?.length ?? 0;
                        final rest = (n - p) < 0 ? 0 : n - p;
                        asked += n; placed += p;
                        if (const ['pending', 'in_progress'].contains('${r['status']}')) { waiting += rest; } else { closed += rest; }
                      }
                      return ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 0, 12, 90),
                        itemCount: shown.length + 1,
                        itemBuilder: (_, i) => i == 0
                            ? Padding(padding: const EdgeInsets.only(bottom: 6), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                                Wrap(spacing: 6, runSpacing: 6, children: [
                                  _tile(tr('طلبات', 'Requests'), shown.length, T.orange),
                                  _tile(tr('شاحنات مطلوبة', 'Trucks asked'), asked, T.warn),
                                  _tile(tr('نُفِّذت (أوامر نقل)', 'Done (orders)'), placed, T.success),
                                  _tile(tr('رُفضت أو سُحبت', 'Rejected or withdrawn'), closed, T.danger),
                                  _tile(tr('لم تُنفَّذ بعد', 'Not done yet'), waiting, T.warn),
                                ]),
                                if (_filterCount > 0)
                                  Align(alignment: AlignmentDirectional.centerEnd, child: TextButton(onPressed: () { setState(() { _flt.clear(); _from = ''; _to = ''; }); _load(); }, child: Text(tr('مسح الفلاتر ($_filterCount)', 'Clear filters ($_filterCount)')))),
                              ]))
                            : _view == 'list' ? _row(shown[i - 1]) : _card(shown[i - 1]),
                      );
                    }),
                  )),
      ]),
    );
  }

  /// Riyadh calendar day, `back` days ago, as YYYY-MM-DD.
  String _rDay([int back = 0]) {
    final d = DateTime.now().toUtc().add(const Duration(hours: 3)).subtract(Duration(days: back));
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  List<(String, String, String)> _quickDays() {
    final today = _rDay();
    return [
      (tr('اليوم', 'Today'), today, today),
      (tr('أمس', 'Yesterday'), _rDay(1), _rDay(1)),
      (tr('آخر 7 أيام', 'Last 7 days'), _rDay(6), today),
      (tr('هذا الشهر', 'This month'), '${today.substring(0, 8)}01', today),
    ];
  }

  Widget _tile(String label, num value, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: color.withValues(alpha: 0.25))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          Text(fmtNum(value), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: color)),
        ]),
      );

  Widget _card(Map<String, dynamic> r) {
    final placed = (r['placed'] as List?)?.length ?? 0;
    final trucks = inum(r['trucks']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(onTap: () => _open(r), child: AppCard(
        topAccent: (srStatuses['${r['status']}'] ?? ('', '', T.line)).$3,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text('${r['number']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.ink)),
            const SizedBox(width: 8),
            Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
            srStatusChip(r['status'], vendors: _work),
          ]),
          const SizedBox(height: 4),
          Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'} · ${r['truckType'] ?? ''}${'${r['branch'] ?? ''}'.isEmpty ? '' : ' · ${r['branch']}'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Chip2('${tr('الشاحنات', 'Trucks')} $placed/${fmtNum(trucks)}', placed >= trucks ? T.success : T.navy, icon: Icons.local_shipping_outlined),
            if (r['pickupTime'] != null) Chip2(soFmtDate(r['pickupTime']), T.inkFaint, icon: Icons.event),
            if (r.containsKey('sellPrice') && r['sellPrice'] != null) Chip2('${tr('بيع', 'Sell')} ${soMoney(r['sellPrice'])}', T.success),
            if ('${r['handlerName'] ?? ''}'.isNotEmpty) Chip2('${tr('يعمل عليه', 'Handled by')} ${r['handlerName']}${srHm(r['claimedUntil']).isEmpty ? '' : ' ${tr('حتى', 'until')} ${srHm(r['claimedUntil'])}'}', T.violet),
            if (!_work && srApprovalOf(r) != 'approved') Chip2(tr(srApproval[srApprovalOf(r)]!.$1, srApproval[srApprovalOf(r)]!.$2), srApproval[srApprovalOf(r)]!.$3, icon: Icons.verified_outlined),
            if ('${r['createdByName'] ?? ''}'.isNotEmpty && _work) Chip2('${tr('من', 'By')} ${r['createdByName']}', T.inkSoft),
          ]),
          const SizedBox(height: 6),
          srProgressLine(r, vendors: _work),
          _sourcedLine(r),
          if (!_work && srApprovalOf(r) == 'returned' && '${r['approvalReason'] ?? ''}'.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 6), child: Text('${tr('ملاحظة المدير', 'Manager note')}: ${r['approvalReason']}', style: const TextStyle(fontSize: 12, color: T.violet, fontWeight: FontWeight.w700))),
          if (r['status'] == 'rejected')
            Padding(padding: const EdgeInsets.only(top: 6), child: Text('${tr('سبب الرفض', 'Reason')}: ${r['rejectReason'] ?? ''}${'${r['rejectNote'] ?? ''}'.isEmpty ? '' : ' — ${r['rejectNote']}'}',
                style: const TextStyle(fontSize: 12, color: T.danger, fontWeight: FontWeight.w700))),
        ]),
      )),
    );
  }
}

extension on _ShipmentRequestsScreenState {
  /// Dense one-row view: number, status, progress, asked/placed/remaining, customer, route, pickup.
  Widget _row(Map<String, dynamic> r) {
    final n = (r['placed'] as List?)?.length ?? 0;
    final open = ['pending', 'in_progress'].contains('${r['status']}') ? _ShipmentRequestsScreenState._openCount(r) : 0;
    final pickup = _dateOnly(r['pickupTime']);
    return InkWell(
      onTap: () => _open(r),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: T.line))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text('${r['number']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.ink, fontSize: 13)),
            const SizedBox(width: 6),
            Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13), overflow: TextOverflow.ellipsis)),
            srStatusChip(r['status'], vendors: _work),
          ]),
          const SizedBox(height: 3),
          Row(children: [
            Expanded(child: Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'}${pickup.isEmpty ? '' : ' · $pickup'}',
                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), overflow: TextOverflow.ellipsis)),
            Text(tr('مطلوبة ${fmtNum(inum(r['trucks']))} · أُسندت $n · متبقّية $open', 'Asked ${fmtNum(inum(r['trucks']))} · placed $n · left $open'),
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.navy)),
          ]),
          const SizedBox(height: 4),
          srProgressLine(r, vendors: _work),
          _sourcedLine(r),
          if (!_work && srApprovalOf(r) != 'approved')
            Padding(padding: const EdgeInsets.only(top: 3), child: Text(tr(srApproval[srApprovalOf(r)]!.$1, srApproval[srApprovalOf(r)]!.$2), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: srApproval[srApprovalOf(r)]!.$3))),
        ]),
      ),
    );
  }

  /// «تحصيل السيارات» line: sourced/asked and what is left to find; tapping opens who reported what.
  Widget _sourcedLine(Map<String, dynamic> r) {
    final x = srSourced(r);
    if (!_work && x.$1 == 0) return const SizedBox.shrink();
    return InkWell(
      onTap: () async {
        await showSourcingSheet(context, r, team: widget.mode == 'fleet' ? 'fleet' : 'vendors', canAdd: _work && _can['work'] == true, canLead: _can['lead'] == true);
        _load();
      },
      child: Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [
        const Icon(Icons.travel_explore, size: 15, color: T.navy),
        const SizedBox(width: 4),
        Expanded(child: Text(tr('تحصيل السيارات: ${x.$1}/${x.$2} · بقي ${x.$3}', 'Sourced: ${x.$1}/${x.$2} · ${x.$3} left'),
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.navy))),
        const Icon(Icons.chevron_left, size: 16, color: T.inkFaint),
      ])),
    );
  }
}

// ── Detail ──────────────────────────────────────────────────────────────────

class ShipmentRequestDetailScreen extends StatefulWidget {
  final String id;
  final String mode;
  const ShipmentRequestDetailScreen({super.key, required this.id, required this.mode});
  @override
  State<ShipmentRequestDetailScreen> createState() => _ShipmentRequestDetailScreenState();
}

class _ShipmentRequestDetailScreenState extends State<ShipmentRequestDetailScreen> {
  Map<String, dynamic>? _r;
  List<Map<String, dynamic>> _orders = [];
  Map<String, dynamic> _can = {};
  bool _loading = true;
  bool _busy = false;
  String? _error;
  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Live.instance.on(srEvent, _onLive);
  }

  @override
  void dispose() {
    Live.instance.off(srEvent, _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/shipment-requests/${widget.id}');
      if (!mounted) return;
      setState(() {
        _r = Map<String, dynamic>.from(d['request'] ?? {});
        _orders = List<Map<String, dynamic>>.from(((d['orders'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _can = Map<String, dynamic>.from(d['can'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _act(String path, [Map<String, dynamic>? body, String? ok]) async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/shipment-requests/${widget.id}/$path', body ?? {});
      if (mounted && ok != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok)));
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _withdraw() async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
      title: Text(tr('سحب الطلب', 'Withdraw the request')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tr('أوامرُ النقل التي أُنشئت تبقى، ويُسحب ما لم يُكمَل.', 'Transport orders already created stay; the rest is withdrawn.')),
        TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('رجوع', 'Back'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(d, true), child: Text(tr('سحب', 'Withdraw'))),
      ],
    ));
    if (ok == true) await _act('cancel', {'note': note.text.trim()}, tr('سُحب الطلب', 'Withdrawn'));
  }

  Future<void> _reject() async {
    final res = await showModalBottomSheet<(String, String)>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => const _RejectSheet(),
    );
    if (res == null) return;
    await _act('reject', {'reason': res.$1, 'note': res.$2}, tr('رُفض الطلب وأُبلغ فريق المبيعات', 'Rejected; sales was notified'));
  }

  Map<String, dynamic> get _team => widget.mode == 'fleet' ? {'team': 'fleet'} : {};

  Future<void> _claim() async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/shipment-requests/${widget.id}/claim', _team);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تولّيتَ الطلب لمدّة ساعة', 'Taken for one hour'))));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status != 409) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
        await _load();
        if (mounted) setState(() => _busy = false);
        return;
      }
      final take = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
        content: Text(e.message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('رجوع', 'Back'))),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('تولِّيه بدلًا منه', 'Take it over'))),
        ],
      ));
      if (take == true) await Api.instance.post('/api/shipment-requests/${widget.id}/claim', {'takeOver': true, ..._team}).catchError((_) => null);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    await _load();
    if (mounted) setState(() => _busy = false);
  }

  /// Sales manager (or delegate): approve, return for edits, or decline with a reason.
  Future<void> _decide(String kind) async {
    String reason = '';
    if (kind != 'approve') {
      final c = TextEditingController();
      final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
        title: Text(kind == 'return' ? tr('إعادة الطلب للتعديل', 'Return for edits') : tr('رفض الطلب', 'Decline the request')),
        content: TextField(controller: c, autofocus: true, maxLines: 3, decoration: InputDecoration(labelText: kind == 'return' ? tr('ما الذي يجب تعديله؟ *', 'What must change? *') : tr('سبب الرفض *', 'Reason *'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('رجوع', 'Back'))),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ));
      reason = c.text.trim();
      c.dispose();
      if (ok != true) return;
      if (reason.isEmpty) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب السبب', 'Write the reason'))));
        return;
      }
    }
    await _act(kind, {'reason': reason}, kind == 'approve' ? tr('اعتُمد الطلب وأُرسل إلى فريق الموردين', 'Approved and sent to vendors') : kind == 'return' ? tr('أُعيد الطلب إلى المندوب', 'Returned to the rep') : tr('رُفض الطلب', 'Declined'));
  }

  Widget _kv(String k, dynamic v) => '${v ?? ''}'.trim().isEmpty ? const SizedBox.shrink() : Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(k, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(child: Text('$v', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final st = '${r?['status'] ?? ''}';
    final open = const ['pending', 'in_progress'].contains(st);
    final left = r == null ? 0 : inum(r['open'] ?? (inum(r['trucks']) - ((r['placed'] as List?)?.length ?? 0))).toInt();
    final ask = widget.mode == 'ask' && _can['ask'] == true;
    final place = widget.mode == 'place' && _can['place'] == true;
    final fleet = widget.mode == 'fleet' && _can['fleet'] == true;
    final work = widget.mode != 'ask' && _can['work'] == true;
    final appr = r == null ? 'approved' : srApprovalOf(r);
    final me = '${context.read<AuthProvider>().user?['_id'] ?? ''}';
    final heldByMe = r != null && '${r['handler'] ?? ''}'.isNotEmpty && ('${r['handler']}' == me || (widget.mode == 'fleet' && r['handlerTeam'] == 'fleet'));
    return AppScaffold(
      title: Text(r == null ? tr('طلب شحنة', 'Shipment request') : '${tr('طلب شحنة رقم', 'Request')} ${r['number']}'),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null || r == null
              ? ErrorRetry(message: _error ?? '', onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
                    AppCard(topAccent: (srStatuses[st] ?? ('', '', T.line)).$3, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15))),
                        srStatusChip(st),
                      ]),
                      const SizedBox(height: 6),
                      _kv(tr('المسار', 'Route'), '${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'}'),
                      _kv(tr('الفرع', 'Branch'), r['branch']),
                      _kv(tr('الشاحنات', 'Trucks'), '${(r['placed'] as List?)?.length ?? 0} ${tr('من', 'of')} ${r['trucks']}${left > 0 && open ? ' · ${tr('بقي', 'left')} $left' : ''}'),
                      _kv(tr('نوع الشاحنة', 'Truck type'), r['truckType']),
                      if (srTypesSent(r).isNotEmpty) _kv(tr('النوع المنفَّذ', 'Type sent'), srTypesSent(r)),
                      _kv(tr('نوع الحمولة', 'Cargo'), r['cargoType']),
                      _kv(tr('طول الشاحنة', 'Truck length'), r['truckLength']),
                      _kv(tr('الكمية', 'Quantity'), r['quantity']),
                      _kv(tr('الاستلام', 'Pickup'), soFmtDate(r['pickupTime'])),
                      if (r['arrivalTime'] != null) _kv(tr('الوصول', 'Arrival'), soFmtDate(r['arrivalTime'])),
                      if (r.containsKey('sellPrice')) _kv(tr('سعر البيع', 'Selling price'), soMoney(r['sellPrice'])),
                      _kv(tr('نوع الدفع', 'Payment'), '${r['paymentSubtype'] ?? ''}'.isEmpty ? '' : soPaymentKindLabel(r['paymentSubtype'])),
                      _kv(tr('مندوب المبيعات', 'Operational sales'), r['salesRepName']),
                      _kv(tr('طلبه', 'Requested by'), r['createdByName']),
                      _kv(tr('ملاحظة الرحلة', 'Trip note'), r['notes']),
                      _kv(tr('رقم البوليصة', 'B/L'), r['blNumber']),
                      _kv(tr('رقم الحاوية', 'Container'), r['containerNumber']),
                      _kv(tr('يعمل عليه', 'Handled by'), '${r['handlerName'] ?? ''}'.isEmpty ? '' : '${r['handlerName']}${srHm(r['claimedUntil']).isEmpty ? '' : ' · ${tr('حتى', 'until')} ${srHm(r['claimedUntil'])}'}'),
                      if (appr != 'approved' || '${r['approvalByName'] ?? ''}'.isNotEmpty)
                        _kv(tr('اعتماد المدير', 'Manager approval'), [tr(srApproval[appr]!.$1, srApproval[appr]!.$2), r['approvalByName'], r['approvalReason']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                      if (st == 'rejected') ...[
                        const Divider(),
                        Text('${tr('سبب الرفض', 'Rejection reason')}: ${r['rejectReason'] ?? ''}', style: const TextStyle(color: T.danger, fontWeight: FontWeight.w800)),
                        if ('${r['rejectNote'] ?? ''}'.isNotEmpty) Text('${r['rejectNote']}', style: const TextStyle(color: T.danger)),
                        Text('${r['rejectedByName'] ?? ''} · ${soFmtDT(r['rejectedAt'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ],
                    ])),
                    if (_orders.isNotEmpty)
                      SectionCard(
                        title: tr('أوامر النقل المُنشأة', 'Transport orders created'),
                        child: Column(children: [
                          for (final o in _orders)
                            ListTile(
                              dense: true, contentPadding: EdgeInsets.zero,
                              leading: Text('${o['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
                              title: Text('${o['supplierName'] ?? '—'} · ${o['vehiclePlate'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text([o['truckType'], o['driverName'], soPriceLine(o)].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                              trailing: Chip2(tr(soStatusOf(_vocab, o['status']).$2, soStatusOf(_vocab, o['status']).$3), soStatusOf(_vocab, o['status']).$4),
                            ),
                        ]),
                      ),
                    if (appr == 'approved')
                      SectionCard(
                        title: '${tr('تحصيل السيارات', 'Trucks sourced')} · ${srSourced(r).$1}/${srSourced(r).$2}',
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          for (final e in List<Map>.from(r['sourcing'] ?? const []))
                            Text('${e['byName']}: ${e['count']} · ${soFmtDT(e['at'])}${'${e['helperName'] ?? ''}'.isEmpty ? '' : ' · ${tr('بمساعدة', 'helped by')} ${e['helperName']}'}', style: const TextStyle(fontSize: 12.5)),
                          Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
                            onPressed: () async { await showSourcingSheet(context, r, team: widget.mode == 'fleet' ? 'fleet' : 'vendors', canAdd: work && open, canLead: _can['lead'] == true); _load(); },
                            icon: const Icon(Icons.travel_explore, size: 18),
                            label: Text(work && open ? tr('تسجيل / تعديل التحصيل', 'Record / edit') : tr('التفاصيل', 'Details')),
                          )),
                        ]),
                      ),
                    SectionCard(
                      title: tr('السجل', 'History'),
                      child: Column(children: [
                        for (final l in List<Map>.from(r['log'] ?? const []).reversed)
                          ListTile(
                            dense: true, contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.history, size: 18, color: T.inkFaint),
                            title: Text('${tr((_logLabels['${l['action']}'] ?? ('${l['action']}', '${l['action']}')).$1, (_logLabels['${l['action']}'] ?? ('${l['action']}', '${l['action']}')).$2)}${l['waybillNumber'] != null ? ' ${l['waybillNumber']}' : ''}',
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                            subtitle: Text([l['byName'], soFmtDT(l['at']), l['reason'], l['note']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 12),
                    if (widget.mode == 'ask' && _can['approve'] == true && appr == 'pending')
                      Padding(padding: const EdgeInsets.only(bottom: 8), child: Wrap(spacing: 8, runSpacing: 8, children: [
                        FilledButton.icon(onPressed: _busy ? null : () => _decide('approve'), style: FilledButton.styleFrom(backgroundColor: T.success), icon: const Icon(Icons.verified_outlined), label: Text(tr('اعتماد', 'Approve'))),
                        OutlinedButton.icon(onPressed: _busy ? null : () => _decide('return'), icon: const Icon(Icons.undo), label: Text(tr('إعادة للتعديل', 'Return for edits'))),
                        OutlinedButton.icon(onPressed: _busy ? null : () => _decide('decline'), style: OutlinedButton.styleFrom(foregroundColor: T.danger), icon: const Icon(Icons.block), label: Text(tr('رفض', 'Decline'))),
                      ])),
                    if (ask && appr != 'rejected' && const ['pending', 'in_progress', 'rejected'].contains(st))
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        FilledButton.icon(
                          onPressed: _busy ? null : () async {
                            final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ShipmentRequestFormScreen(request: r)));
                            if (ok == true) _load();
                          },
                          icon: const Icon(Icons.edit_outlined),
                          label: Text(st == 'rejected' || appr == 'returned' ? tr('تعديل وإعادة الإرسال', 'Amend and resend') : tr('تعديل', 'Edit')),
                        ),
                        if (st == 'rejected')
                          OutlinedButton.icon(onPressed: _busy ? null : () => _act('resubmit', {}, tr('أُعيد إرسال الطلب', 'Resent')), icon: const Icon(Icons.send), label: Text(tr('إعادة الإرسال كما هو', 'Resend as is'))),
                        OutlinedButton.icon(onPressed: _busy ? null : _withdraw, style: OutlinedButton.styleFrom(foregroundColor: T.danger), icon: const Icon(Icons.undo), label: Text(tr('سحب الطلب', 'Withdraw'))),
                      ]),
                    if ((place || fleet || work) && open)
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        if (place || fleet)
                          FilledButton.icon(
                            onPressed: _busy ? null : () async {
                              final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => fleet ? FleetPlaceScreen(request: r) : PlaceTrucksScreen(request: r)));
                              if (ok == true) _load();
                            },
                            icon: const Icon(Icons.local_shipping_outlined),
                            label: Text(tr('إكمال الشحنة', 'Complete the shipment')),
                          ),
                        // A claim holds the request for one hour; then it is released and must be taken again.
                        if (work) OutlinedButton.icon(onPressed: _busy ? null : _claim, icon: const Icon(Icons.pan_tool_outlined),
                            label: Text('${r['handlerName'] ?? ''}'.isEmpty ? tr('أتولّاه (ساعة)', 'Take it (1 hour)') : heldByMe ? tr('تجديد التولّي', 'Renew') : tr('تولِّيه بدلًا من زميل', 'Take over'))),
                        if (work && '${r['handlerName'] ?? ''}'.isNotEmpty)
                          OutlinedButton.icon(onPressed: _busy ? null : () => _act('release', _team), icon: const Icon(Icons.logout), label: Text(tr('تخلٍّ', 'Release'))),
                        if (place)
                          OutlinedButton.icon(onPressed: _busy ? null : _reject, style: OutlinedButton.styleFrom(foregroundColor: T.danger), icon: const Icon(Icons.block), label: Text(tr('رفض', 'Reject'))),
                      ]),
                  ]),
                ),
    );
  }
}

class _RejectSheet extends StatefulWidget {
  const _RejectSheet();
  @override
  State<_RejectSheet> createState() => _RejectSheetState();
}

class _RejectSheetState extends State<_RejectSheet> {
  final _reason = TextEditingController();
  final _note = TextEditingController();
  // A reason missing from the list is typed and joins the list on submit.
  bool _typed = false;
  @override
  void dispose() { _reason.dispose(); _note.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('رفض الطلب', 'Reject the request'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 4),
          Text(tr('يصل السببُ إلى فريق المبيعات ليعدّل الطلب ويعيده.', 'The reason reaches sales, who can amend and resend.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          const SizedBox(height: 10),
          // The list is managed in section settings and extended here (search, then add).
          if (_typed)
            TextField(controller: _reason, autofocus: true, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('سبب الرفض *', 'Reason *'), helperText: tr('يُضاف إلى القائمة', 'Joins the list')))
          else
            LookupField(type: 'sr_reject_reason', controller: _reason, label: tr('سبب الرفض *', 'Reason *'), onChanged: () => setState(() {})),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: () => setState(() { _typed = !_typed; _reason.clear(); }),
              icon: Icon(_typed ? Icons.list_rounded : Icons.add_rounded, size: 18),
              label: Text(_typed ? tr('الاختيار من القائمة', 'Pick from the list') : tr('سببٌ غير موجود في القائمة', 'Reason not in the list')),
            ),
          ),
          const SizedBox(height: 8),
          TextField(controller: _note, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة للمبيعات', 'Note to sales'))),
          const SizedBox(height: 12),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: _reason.text.trim().isEmpty ? null : () => Navigator.pop(context, (_reason.text.trim(), _note.text.trim())),
            child: Text(tr('رفض الطلب', 'Reject')),
          ),
        ]),
      );
}

// ── Completion: times shared by the vendors and the fleet forms ─────────────

/// Pickup (required), start and arrival: written by whoever completes the trucks, applied to each truck sent.
class _Times {
  String pickup = '';
  String start = '';
  String arrival = '';
  _Times(Map r) {
    pickup = _dateOnly(r['pickupTime']);
    if (pickup.isEmpty) pickup = ymd(DateTime.now());
    start = _dateOnly(r['startTime']);
    arrival = _dateOnly(r['arrivalTime']);
  }
  Map<String, dynamic> body() => {
        if (pickup.isNotEmpty) 'pickupTime': '${pickup}T12:00:00',
        if (start.isNotEmpty) 'startTime': '${start}T12:00:00',
        if (arrival.isNotEmpty) 'arrivalTime': '${arrival}T12:00:00',
      };
}

Widget _timesCard(BuildContext context, _Times t, void Function(void Function()) set) {
  Widget one(String label, String value, void Function(String) write, {bool req = false}) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 44),
              side: BorderSide(color: req && value.isEmpty ? T.danger : Colors.black12)),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(value) ?? DateTime.now(),
                firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 365)));
            if (d != null) set(() => write(ymd(d)));
          },
          icon: const Icon(Icons.event, size: 17),
          label: Text(value.isEmpty ? (req ? '$label *' : label) : '$label: $value', style: const TextStyle(fontSize: 13, color: T.ink)),
        ),
      );
  return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Text(tr('التوقيت', 'Timing'), style: const TextStyle(fontWeight: FontWeight.w800)),
    one(tr('وقت الاستلام', 'Pickup time'), t.pickup, (v) => t.pickup = v, req: true),
    one(tr('وقت البداية', 'Start time'), t.start, (v) => t.start = v),
    one(tr('وقت الوصول', 'Arrival time'), t.arrival, (v) => t.arrival = v),
  ]));
}

Widget _pickBtn(String text, IconData icon, VoidCallback? onTap, {bool miss = false}) => OutlinedButton.icon(
      style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46),
          side: BorderSide(color: miss ? T.danger : Colors.black12)),
      onPressed: onTap,
      icon: Icon(icon, size: 17),
      label: Text(text, style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
    );

final _iqamaRe = RegExp(r'^[12]\d{9}$');
String _digits(String v) => v.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${'٠١٢٣٤٥٦٧٨٩'.indexOf(m[0]!)}').replaceAll(RegExp(r'\s'), '');

// ── Vendors: completing the trucks ──────────────────────────────────────────

class PlaceTrucksScreen extends StatefulWidget {
  final Map<String, dynamic> request;
  const PlaceTrucksScreen({super.key, required this.request});
  @override
  State<PlaceTrucksScreen> createState() => _PlaceTrucksScreenState();
}

class _Truck {
  // 'vendor' = a registered carrier company, 'freelancer' = an individual driver-owner.
  String kind = 'vendor';
  String truckType = '';
  String? sourcingRep;
  String? helper;
  Map<String, dynamic>? supplier;
  // A freelancer typed in place (not yet in the register).
  bool newFreelancer = false;
  final flName = TextEditingController();
  final flPhone = TextEditingController();
  Map<String, dynamic>? vehicle;
  final plate = TextEditingController();
  Map<String, dynamic>? driver;
  bool newDriver = false;
  final drName = TextEditingController();
  final drPhone = TextEditingController();
  final drIqama = TextEditingController();
  final buy = TextEditingController();
  final advance = TextEditingController();
  List<Map<String, dynamic>> vehicles = [];
  List<Map<String, dynamic>> drivers = [];
  void dispose() { for (final c in [flName, flPhone, plate, drName, drPhone, drIqama, buy, advance]) { c.dispose(); } }
}

class _PlaceTrucksScreenState extends State<PlaceTrucksScreen> {
  final List<_Truck> _trucks = [];
  bool _saving = false;
  List<Map<String, dynamic>> _reps = const [];
  List<Map<String, dynamic>> _helpers = const [];
  String _me = '';
  late final _Times _times = _Times(widget.request);

  List<String> get _reqTypes => srTruckTypes(widget.request);

  int get _open {
    final r = widget.request;
    return inum(r['open'] ?? (inum(r['trucks']) - ((r['placed'] as List?)?.length ?? 0))).toInt().clamp(1, 25);
  }

  @override
  void initState() {
    super.initState();
    _me = '${context.read<AuthProvider>().user?['_id'] ?? context.read<AuthProvider>().user?['id'] ?? ''}';
    _add();
    _loadReps();
  }

  Future<void> _loadReps() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/sourcing-reps');
      final rows = List<Map<String, dynamic>>.from(((d['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      final helpers = await srTeamMembers('helpers').catchError((_) => <Map<String, dynamic>>[]);
      if (!mounted) return;
      setState(() {
        _reps = rows;
        _helpers = helpers;
        if (rows.any((o) => '${o['value']}' == _me)) {
          for (final t in _trucks) { t.sourcingRep ??= _me; }
        }
      });
    } catch (_) {/* optional fields */}
  }

  String _labelOf(List<Map<String, dynamic>> list, String? id) {
    final o = list.where((x) => '${x['value']}' == id);
    return o.isEmpty ? '' : '${o.first['label'] ?? ''}';
  }

  @override
  void dispose() { for (final t in _trucks) { t.dispose(); } super.dispose(); }

  void _add() {
    if (_trucks.length >= _open) return;
    final t = _Truck();
    if (_reqTypes.length == 1) t.truckType = _reqTypes.first;
    // A second truck usually goes to the same supplier at the same price.
    if (_trucks.isNotEmpty) {
      final last = _trucks.last;
      t.kind = last.kind; t.supplier = last.supplier; t.buy.text = last.buy.text; t.sourcingRep = _trucks.first.sourcingRep;
      t.vehicles = last.vehicles; t.drivers = last.drivers;
    } else if (_reps.any((o) => '${o['value']}' == _me)) { t.sourcingRep = _me; }
    setState(() => _trucks.add(t));
  }

  Future<void> _loadLists(_Truck t) async {
    final sid = t.supplier?['_id'];
    if (sid == null) { setState(() { t.vehicles = []; t.drivers = []; }); return; }
    try {
      final res = await Future.wait([
        Api.instance.get('/api/shipment-orders/vehicles?supplier=$sid&limit=200'),
        Api.instance.get('/api/shipment-orders/drivers?supplier=$sid&limit=200'),
      ]);
      if (!mounted) return;
      setState(() {
        t.vehicles = List<Map<String, dynamic>>.from(((res[0]['vehicles'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        t.drivers = List<Map<String, dynamic>>.from(((res[1]['drivers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        // A freelancer usually has one truck and drives it himself: both are prefilled.
        if (t.kind == 'freelancer') {
          if (t.vehicle == null && t.vehicles.length == 1) t.vehicle = t.vehicles.first;
          if (t.driver == null && t.drivers.length == 1) t.driver = t.drivers.first;
        }
      });
    } catch (_) {/* the inline add still works */}
  }

  Future<void> _pickSupplier(_Truck t) async {
    final type = t.kind == 'freelancer' ? 'freelancer' : 'company';
    final s = await pickRemote(context,
      title: t.kind == 'freelancer' ? tr('الفريلانسر', 'Freelancer') : tr('المورّد', 'Vendor'),
      // Only approved carriers are offered (missing status = approved).
      fetch: (q) async {
        final d = await Api.instance.get('/api/shipment-orders/suppliers?approved=1&type=$type&limit=60&fresh=1${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(((d['suppliers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      },
      label: (x) => '${x['name'] ?? ''}',
      sub: (x) => [x['phone'], '${tr('سيارات', 'trucks')} ${x['vehicleCount'] ?? 0}', '${tr('سائقون', 'drivers')} ${x['driverCount'] ?? 0}'].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
    );
    if (s == null) return;
    setState(() { t.supplier = s; t.newFreelancer = false; t.vehicle = null; t.driver = null; });
    _loadLists(t);
  }

  Future<void> _pickVehicle(_Truck t) async {
    final v = await pickRemote(context,
      title: tr('سيارات المورّد', "Vendor's trucks"),
      fetch: (q) async => t.vehicles.where((x) => q.isEmpty || '${x['plate']} ${x['defaultDriverName'] ?? ''}'.contains(q)).toList(),
      label: (x) => '${x['plate'] ?? ''}',
      sub: (x) => [x['truckType'], x['defaultDriverName']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
    );
    if (v == null) return;
    setState(() {
      t.vehicle = v;
      t.plate.clear();
      // The truck's usual driver is suggested when he is in the register.
      final dn = '${v['defaultDriverName'] ?? ''}';
      if (t.driver == null && dn.isNotEmpty) {
        final hit = t.drivers.where((d) => '${d['name']}' == dn);
        if (hit.isNotEmpty) t.driver = hit.first;
      }
    });
  }

  Future<void> _pickDriver(_Truck t) async {
    final v = await pickRemote(context,
      title: tr('السائق', 'Driver'),
      fetch: (q) async {
        if (q.isEmpty) return t.drivers;
        final d = await Api.instance.get('/api/shipment-orders/drivers?limit=40&q=${Uri.encodeQueryComponent(q)}');
        return List<Map<String, dynamic>>.from(((d['drivers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      },
      label: (x) => '${x['name'] ?? ''}',
      sub: (x) => [x['phone'], x['residenceNumber']].where((e) => '${e ?? ''}'.isNotEmpty && '$e' != '0').join(' · '),
    );
    if (v != null) setState(() { t.driver = v; t.newDriver = false; });
  }

  List<String> _problems() {
    final out = <String>[];
    if (_times.pickup.isEmpty) out.add(tr('وقت الاستلام مطلوب', 'Pickup time is required'));
    for (var i = 0; i < _trucks.length; i++) {
      final t = _trucks[i];
      final n = i + 1;
      if (_reqTypes.length > 1 && t.truckType.isEmpty) out.add(tr('الشاحنة $n: حدّد نوعَ الشاحنة المنفَّذ', 'Truck $n: truck type sent'));
      if (t.newFreelancer ? t.flName.text.trim().isEmpty : t.supplier == null) out.add(tr('الشاحنة $n: ${t.kind == 'freelancer' ? 'اختر الفريلانسر' : 'اختر المورّد'}', 'Truck $n: carrier'));
      if (t.vehicle == null && t.plate.text.trim().isEmpty) out.add(tr('الشاحنة $n: اختر السيارة أو أضِف لوحتها', 'Truck $n: truck or plate'));
      if (t.newDriver) {
        if (t.drName.text.trim().isEmpty) out.add(tr('الشاحنة $n: اسم السائق الجديد', 'Truck $n: new driver name'));
        if (!_iqamaRe.hasMatch(_digits(t.drIqama.text))) out.add(tr('الشاحنة $n: رقم الإقامة/الهوية عشرة أرقام يبدأ بـ 1 أو 2', 'Truck $n: iqama is 10 digits starting with 1 or 2'));
      } else if (t.driver == null) {
        out.add(tr('الشاحنة $n: اختر السائق أو سجّل سائقًا جديدًا', 'Truck $n: driver'));
      }
      if (!((num.tryParse(t.buy.text.trim()) ?? 0) > 0)) out.add(tr('الشاحنة $n: سعر الشراء مطلوب', 'Truck $n: buying price required'));
    }
    return out;
  }

  Future<void> _save() async {
    final problems = _problems();
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problems.join('\n'))));
      return;
    }
    setState(() => _saving = true);
    try {
      final d = await Api.instance.post('/api/shipment-requests/${widget.request['_id']}/place', {
        'trucks': [
          for (final t in _trucks)
            {
              'kind': t.kind,
              if (t.truckType.isNotEmpty) 'truckType': t.truckType,
              if (t.newFreelancer) 'newFreelancer': {'name': t.flName.text.trim(), 'phone': t.flPhone.text.trim()} else 'supplierChoice': t.supplier!['_id'],
              if (t.vehicle != null) 'vehicle': t.vehicle!['_id'] else 'newVehicle': {'plate': t.plate.text.trim()},
              if (t.newDriver) 'newDriver': {'name': t.drName.text.trim(), 'phone': t.drPhone.text.trim(), 'residenceNumber': _digits(t.drIqama.text)} else 'driverId': t.driver!['_id'],
              'sourcingRep': (t.sourcingRep ?? '').isEmpty ? null : t.sourcingRep,
              if ((t.helper ?? '').isNotEmpty) 'helper': t.helper,
              'buyPrice': num.tryParse(t.buy.text.trim()),
              if (t.advance.text.trim().isNotEmpty) 'advanceAmount': num.tryParse(t.advance.text.trim()),
              ..._times.body(),
            },
        ],
      });
      final failed = (d['failed'] as List?) ?? const [];
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
          'أُنشئت أوامر النقل: ${(d['waybills'] as List? ?? const []).join('، ')}${failed.isNotEmpty ? ' · تعذّرت ${failed.length}: ${(failed.first as Map)['message']}' : ''}',
          'Transport orders: ${(d['waybills'] as List? ?? const []).join(', ')}${failed.isNotEmpty ? ' · ${failed.length} failed' : ''}'))));
        if (failed.isEmpty) { Navigator.pop(context, true); } else { setState(() => _saving = false); }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Widget _truckCard(int i) {
    final t = _trucks[i];
    final fl = t.kind == 'freelancer';
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: AppCard(topAccent: T.orange, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('${tr('الشاحنة', 'Truck')} ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w900)),
          const Spacer(),
          if (_trucks.length > 1) IconButton(onPressed: () => setState(() { _trucks.removeAt(i).dispose(); }), icon: const Icon(Icons.delete_outline, color: T.danger)),
        ]),
        // First: a registered company or a freelancer.
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'vendor', label: Text(tr('مورد', 'Vendor')), icon: const Icon(Icons.business_outlined)),
            ButtonSegment(value: 'freelancer', label: Text(tr('فريلانسر', 'Freelancer')), icon: const Icon(Icons.person_outline)),
          ],
          selected: {t.kind},
          onSelectionChanged: (v) => setState(() { t.kind = v.first; t.supplier = null; t.newFreelancer = false; t.vehicle = null; t.driver = null; t.vehicles = []; t.drivers = []; }),
        ),
        const SizedBox(height: 8),
        if (_reqTypes.isNotEmpty) ...[
          Text('${tr('نوع الشاحنة المنفَّذ', 'Truck type sent')}${_reqTypes.length > 1 ? ' *' : ''}',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: _reqTypes.length > 1 && t.truckType.isEmpty ? T.danger : T.ink)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final ty in _reqTypes)
              ChoiceChip(label: Text(ty), selected: t.truckType == ty, selectedColor: T.orange.withValues(alpha: 0.18), onSelected: (_) => setState(() => t.truckType = ty)),
          ]),
          const SizedBox(height: 8),
        ],
        _pickBtn(_labelOf(_reps, t.sourcingRep).isEmpty ? tr('مسؤول التوريد — مَن جاء بالمورّد ومالك السيارة…', 'Sourcing — who found the carrier…') : '${tr('مسؤول التوريد', 'Sourcing')}: ${_labelOf(_reps, t.sourcingRep)}',
            Icons.person_search_outlined, _reps.isEmpty ? null : () async {
          final v = await srPickPerson(context, tr('مسؤول التوريد', 'Sourcing'), _reps);
          if (v != null) setState(() => t.sourcingRep = '${v['value']}');
        }),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _pickBtn(_labelOf(_helpers, t.helper).isEmpty ? tr('بمساعدة أحد (اختياري)…', 'Helped by (optional)…') : '${tr('بمساعدة', 'Helped by')}: ${_labelOf(_helpers, t.helper)}',
              Icons.group_add_outlined, _helpers.isEmpty ? null : () async {
            final v = await srPickPerson(context, tr('بمساعدة', 'Helped by'), _helpers);
            if (v != null) setState(() => t.helper = '${v['value']}');
          })),
          if ((t.helper ?? '').isNotEmpty) IconButton(onPressed: () => setState(() => t.helper = null), icon: const Icon(Icons.close, size: 18)),
        ]),
        const SizedBox(height: 8),
        if (!t.newFreelancer)
          _pickBtn(t.supplier == null ? (fl ? tr('اختر الفريلانسر… *', 'Choose freelancer… *') : tr('اختر المورّد… *', 'Choose vendor… *')) : '${t.supplier!['name']}',
              fl ? Icons.person_search_outlined : Icons.storefront_outlined, () => _pickSupplier(t))
        else ...[
          TextField(controller: t.flName, decoration: InputDecoration(labelText: tr('اسم الفريلانسر *', 'Freelancer name *'))),
          const SizedBox(height: 6),
          TextField(controller: t.flPhone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('جواله', 'Phone'))),
        ],
        if (fl)
          Align(alignment: AlignmentDirectional.centerStart, child: TextButton(
            onPressed: () => setState(() { t.newFreelancer = !t.newFreelancer; t.supplier = null; t.vehicle = null; t.driver = null; t.vehicles = []; t.drivers = []; t.newDriver = t.newFreelancer; }),
            child: Text(t.newFreelancer ? tr('الاختيار من المسجَّلين', 'Pick a registered one') : tr('+ فريلانسر جديد', '+ New freelancer')),
          )),
        const SizedBox(height: 6),
        // Truck: one registered on this carrier, or a new plate added in place.
        if (t.vehicle != null)
          _pickBtn('${t.vehicle!['plate']}', Icons.local_shipping_outlined, () => _pickVehicle(t))
        else ...[
          if (t.vehicles.isNotEmpty) _pickBtn(tr('اختر من سيارات المورّد…', "Pick from the carrier's trucks…"), Icons.local_shipping_outlined, () => _pickVehicle(t)),
          Padding(padding: const EdgeInsets.only(top: 6), child: TextField(controller: t.plate, decoration: InputDecoration(labelText: t.vehicles.isEmpty ? tr('لوحة السيارة *', 'Plate *') : tr('أو أضِف لوحة جديدة', 'Or add a new plate')))),
        ],
        if (t.vehicle != null) Align(alignment: AlignmentDirectional.centerStart, child: TextButton(onPressed: () => setState(() => t.vehicle = null), child: Text(tr('لوحة جديدة بدلًا منها', 'Use a new plate instead')))),
        const SizedBox(height: 6),
        // Driver: registered, or new with his iqama (required).
        if (!t.newDriver)
          _pickBtn(t.driver == null ? tr('اختر السائق… *', 'Choose driver… *') : '${t.driver!['name']}${'${t.driver!['phone'] ?? ''}'.isEmpty ? '' : ' · ${t.driver!['phone']}'}',
              Icons.badge_outlined, () => _pickDriver(t))
        else ...[
          TextField(controller: t.drName, decoration: InputDecoration(labelText: tr('اسم السائق الجديد *', 'New driver name *'))),
          const SizedBox(height: 6),
          TextField(controller: t.drPhone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('جوال السائق', 'Driver phone'))),
          const SizedBox(height: 6),
          TextField(controller: t.drIqama, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('رقم الإقامة / الهوية *', 'Iqama / ID number *'), helperText: tr('عشرة أرقام يبدأ بـ 1 أو 2', '10 digits starting with 1 or 2'))),
        ],
        Align(alignment: AlignmentDirectional.centerStart, child: TextButton(
          onPressed: () => setState(() { t.newDriver = !t.newDriver; t.driver = null; }),
          child: Text(t.newDriver ? tr('اختيار سائق مسجَّل', 'Pick a registered driver') : tr('+ سائق جديد', '+ New driver')),
        )),
        Row(children: [
          Expanded(child: TextField(controller: t.buy, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سعر الشراء *', 'Buying price *')))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: t.advance, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('السلفة', 'Advance')))),
        ]),
      ])),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    return AppScaffold(
      title: Text('${tr('إكمال الطلب رقم', 'Complete request')} ${r['number']}'),
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${r['customerName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900)),
          Text('${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''} · ${r['truckType'] ?? ''}${'${r['branch'] ?? ''}'.isEmpty ? '' : ' · ${r['branch']}'}', style: const TextStyle(color: T.inkSoft)),
          Text(tr('بقي $_open ${_open == 1 ? 'شاحنة' : 'شاحنات'} — كلّ شاحنة تصير أمرَ نقلٍ بالرقم التسلسلي.', '$_open truck(s) left — each becomes a transport order.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        ])),
        const SizedBox(height: 10),
        _timesCard(context, _times, setState),
        for (var i = 0; i < _trucks.length; i++) _truckCard(i),
        if (_trucks.length < _open)
          Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: Text(tr('شاحنة أخرى', 'Another truck')))),
      ]),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _saving ? null : _save,
        icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
        label: Text(tr('إتمام إنشاء الشحنة', 'Create transport orders')),
      ),
    );
  }
}

// ── Fleet: completing on our own trucks ─────────────────────────────────────

/// Each truck becomes a transport order with supplier «تنشيط» and its linked fleet load; the request already holds
/// customer, route and selling price, so only what a fleet load needs is asked.
class FleetPlaceScreen extends StatefulWidget {
  final Map<String, dynamic> request;
  const FleetPlaceScreen({super.key, required this.request});
  @override
  State<FleetPlaceScreen> createState() => _FleetPlaceScreenState();
}

class _FleetTruck {
  String truckType = '';
  Map<String, dynamic>? vehicle;
  Map<String, dynamic>? driver;
  Map<String, dynamic>? second;
  String rentType = '';
  String loadType = '';
  String expected = '';
  bool friday = false;
  String? helper;
  final price = TextEditingController();
  final expense = TextEditingController();
  final notes = TextEditingController();
  void dispose() { for (final c in [price, expense, notes]) { c.dispose(); } }
}

class _FleetPlaceScreenState extends State<FleetPlaceScreen> {
  final List<_FleetTruck> _trucks = [];
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _drivers = [];
  List<Map<String, dynamic>> _rentTypes = [];
  List<Map<String, dynamic>> _loadTypes = [];
  List<Map<String, dynamic>> _helpers = [];
  bool _loading = true;
  bool _saving = false;
  String? _error;
  late final _Times _times = _Times(widget.request);

  List<String> get _reqTypes => srTruckTypes(widget.request);
  int get _open {
    final r = widget.request;
    return inum(r['open'] ?? (inum(r['trucks']) - ((r['placed'] as List?)?.length ?? 0))).toInt().clamp(1, 25);
  }

  @override
  void initState() { super.initState(); _add(); _load(); }
  @override
  void dispose() { for (final t in _trucks) { t.dispose(); } super.dispose(); }

  Future<void> _load() async {
    try {
      final res = await Future.wait([
        Api.instance.get('/api/fleet/vehicles'),
        Api.instance.get('/api/fleet/drivers'),
        Api.instance.get('/api/lookups?type=fleet_rent_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
        Api.instance.get('/api/lookups?type=fleet_load_type&active=true').catchError((_) => <String, dynamic>{'items': []}),
      ]);
      final helpers = await srTeamMembers('helpers').catchError((_) => <Map<String, dynamic>>[]);
      if (!mounted) return;
      setState(() {
        _vehicles = List<Map<String, dynamic>>.from(res[0]['vehicles'] ?? []);
        _drivers = List<Map<String, dynamic>>.from(res[1]['drivers'] ?? []);
        _rentTypes = List<Map<String, dynamic>>.from(res[2]['items'] ?? []);
        _loadTypes = List<Map<String, dynamic>>.from(res[3]['items'] ?? []);
        _helpers = helpers;
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _add() {
    if (_trucks.length >= _open) return;
    final t = _FleetTruck();
    if (_reqTypes.length == 1) t.truckType = _reqTypes.first;
    if (_trucks.isNotEmpty) { t.price.text = _trucks.last.price.text; t.rentType = _trucks.last.rentType; t.loadType = _trucks.last.loadType; }
    setState(() => _trucks.add(t));
  }

  /// What the truck is doing now, as on the fleet's new-load form.
  (String, Color) _availability(Map<String, dynamic> v) {
    final trip = v['trip'] as Map<String, dynamic>?;
    if (trip != null) {
      if (v['atDestination'] == true) return (tr('وصلت نطاق ${trip['toCity']} — تفريغ', 'Reached ${trip['toCity']} — unloading'), T.success);
      return (tr('عليها حمولة إلى ${trip['toCity'] ?? '—'} (${trip['waybillNumber'] ?? ''})', 'Carrying to ${trip['toCity'] ?? '—'}'), T.warn);
    }
    final city = (v['live'] as Map<String, dynamic>?)?['city'];
    if (city != null && '$city'.isNotEmpty) return (tr('متاحة — في $city', 'Available — in $city'), T.success);
    return (tr('متاحة', 'Available'), T.success);
  }

  String _seated(Map<String, dynamic> v) => [for (final d in (v['drivers'] as List?) ?? const []) '${(d as Map)['name'] ?? ''}'].where((x) => x.isNotEmpty).join(' + ');

  Future<void> _pickVehicle(_FleetTruck t) async {
    final v = await pickRemote(context,
      title: tr('سياراتنا', 'Our trucks'),
      fetch: (q) async => _vehicles.where((x) => q.isEmpty || '${x['plate']} ${_seated(x)} ${_availability(x).$1}'.contains(q)).toList(),
      label: (x) => '${x['plate'] ?? ''}',
      sub: (x) => [_availability(x).$1, _seated(x), x['trailerType'], x['status']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
    );
    if (v == null) return;
    setState(() {
      t.vehicle = v;
      // The truck's seated drivers fill the two driver slots.
      final seated = [for (final d in (v['drivers'] as List?) ?? const []) Map<String, dynamic>.from(d as Map)];
      Map<String, dynamic>? find(Map d) => _drivers.where((x) => '${x['_id']}' == '${d['_id']}').firstOrNull;
      if (seated.isNotEmpty) t.driver = find(seated.first) ?? seated.first;
      t.second = seated.length > 1 ? (find(seated[1]) ?? seated[1]) : null;
    });
  }

  Future<Map<String, dynamic>?> _pickDriver(String title) => pickRemote(context,
        title: title,
        fetch: (q) async => _drivers.where((x) => q.isEmpty || '${x['name']} ${x['phone'] ?? ''}'.contains(q)).toList(),
        label: (x) => '${x['name'] ?? ''}',
        sub: (x) => [x['working'] == false ? tr('لا يعمل', 'Off duty') : '', x['vehicle'] is Map ? '${tr('على', 'on')} ${x['vehicle']['plate']}' : '', x['phone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
      );

  Future<String?> _pickLookup(String title, List<Map<String, dynamic>> items) async {
    final v = await pickRemote(context, title: title,
        fetch: (q) async => items.where((x) => q.isEmpty || '${x['nameAr']} ${x['nameEn']}'.contains(q)).toList(),
        label: (x) => tr('${x['nameAr'] ?? x['key']}', '${x['nameEn'] ?? x['nameAr'] ?? x['key']}'));
    return v == null ? null : '${v['key']}';
  }
  String _lookupLabel(List<Map<String, dynamic>> items, String key) {
    final hit = items.where((x) => '${x['key']}' == key);
    return hit.isEmpty ? key : tr('${hit.first['nameAr'] ?? key}', '${hit.first['nameEn'] ?? hit.first['nameAr'] ?? key}');
  }

  Future<void> _save() async {
    final problems = <String>[];
    if (_times.pickup.isEmpty) problems.add(tr('وقت الاستلام مطلوب', 'Pickup time is required'));
    for (var i = 0; i < _trucks.length; i++) {
      final t = _trucks[i];
      final n = i + 1;
      if (_reqTypes.length > 1 && t.truckType.isEmpty) problems.add(tr('الشاحنة $n: حدّد نوعَ الشاحنة المنفَّذ', 'Truck $n: truck type'));
      if (t.vehicle == null) problems.add(tr('الشاحنة $n: اختر السيارة', 'Truck $n: truck'));
      if (t.driver == null) problems.add(tr('الشاحنة $n: اختر السائق', 'Truck $n: driver'));
      if (!((num.tryParse(t.price.text.trim()) ?? 0) > 0)) problems.add(tr('الشاحنة $n: إيجار السيارة مطلوب', 'Truck $n: vehicle rent required'));
    }
    if (problems.isNotEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problems.join('\n')))); return; }
    setState(() => _saving = true);
    try {
      final d = await Api.instance.post('/api/shipment-requests/${widget.request['_id']}/fleet-place', {
        'trucks': [
          for (final t in _trucks)
            {
              if (t.truckType.isNotEmpty) 'truckType': t.truckType,
              'vehicle': t.vehicle!['_id'],
              'driver': t.driver!['_id'],
              if (t.second != null) 'secondDriver': t.second!['_id'],
              'price': num.tryParse(t.price.text.trim()),
              if (t.expense.text.trim().isNotEmpty) 'driverExpense': num.tryParse(t.expense.text.trim()),
              'fridayBonus': t.friday,
              if (t.rentType.isNotEmpty) 'rentType': t.rentType,
              if (t.loadType.isNotEmpty) 'loadType': t.loadType,
              if (t.expected.isNotEmpty) 'expectedArrival': '${t.expected}T12:00:00',
              if (t.notes.text.trim().isNotEmpty) 'notes': t.notes.text.trim(),
              if ((t.helper ?? '').isNotEmpty) 'helper': t.helper,
              ..._times.body(),
            },
        ],
      });
      final failed = (d['failed'] as List?) ?? const [];
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
          'أُنشئت أوامر النقل وحمولات الأسطول: ${(d['waybills'] as List? ?? const []).join('، ')}${failed.isNotEmpty ? ' · تعذّرت ${failed.length}: ${(failed.first as Map)['message']}' : ''}',
          'Orders and fleet loads: ${(d['waybills'] as List? ?? const []).join(', ')}${failed.isNotEmpty ? ' · ${failed.length} failed' : ''}'))));
        if (failed.isEmpty) { Navigator.pop(context, true); } else { setState(() => _saving = false); }
      }
    } catch (e) {
      if (mounted) { setState(() => _saving = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  String _labelOf(List<Map<String, dynamic>> list, String? id) {
    final o = list.where((x) => '${x['value']}' == id);
    return o.isEmpty ? '' : '${o.first['label'] ?? ''}';
  }

  Widget _card(int i) {
    final t = _trucks[i];
    final av = t.vehicle == null ? null : _availability(t.vehicle!);
    final isFriday = DateTime.now().weekday == DateTime.friday;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: AppCard(topAccent: T.navy, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('${tr('الشاحنة', 'Truck')} ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w900)),
          const Spacer(),
          if (_trucks.length > 1) IconButton(onPressed: () => setState(() { _trucks.removeAt(i).dispose(); }), icon: const Icon(Icons.delete_outline, color: T.danger)),
        ]),
        if (_reqTypes.isNotEmpty) ...[
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final ty in _reqTypes)
              ChoiceChip(label: Text(ty), selected: t.truckType == ty, selectedColor: T.orange.withValues(alpha: 0.18), onSelected: (_) => setState(() => t.truckType = ty)),
          ]),
          const SizedBox(height: 8),
        ],
        _pickBtn(t.vehicle == null ? tr('اختر من سياراتنا… *', 'Pick one of our trucks… *') : '${t.vehicle!['plate']}', Icons.local_shipping_outlined, () => _pickVehicle(t)),
        if (av != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${av.$1}${_seated(t.vehicle!).isEmpty ? '' : ' · ${_seated(t.vehicle!)}'}', style: TextStyle(fontSize: 12, color: av.$2, fontWeight: FontWeight.w700))),
        const SizedBox(height: 6),
        _pickBtn(t.driver == null ? tr('السائق الأول… *', 'First driver… *') : '${tr('السائق الأول', 'First driver')}: ${t.driver!['name']}', Icons.badge_outlined, () async {
          final v = await _pickDriver(tr('السائق الأول', 'First driver'));
          if (v != null) setState(() => t.driver = v);
        }),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _pickBtn(t.second == null ? tr('السائق الثاني (اختياري)…', 'Second driver (optional)…') : '${tr('السائق الثاني', 'Second driver')}: ${t.second!['name']}', Icons.badge_outlined, () async {
            final v = await _pickDriver(tr('السائق الثاني', 'Second driver'));
            if (v != null) setState(() => t.second = v);
          })),
          if (t.second != null) IconButton(onPressed: () => setState(() => t.second = null), icon: const Icon(Icons.close, size: 18)),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(controller: t.price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('إيجار السيارة *', 'Vehicle rent *')))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: t.expense, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('مصروف السائق (السلفة)', 'Driver expense (advance)')))),
        ]),
        SwitchListTile(
          contentPadding: EdgeInsets.zero, value: t.friday, onChanged: (v) => setState(() => t.friday = v),
          title: Text(tr('بونص الجمعة للسائق${isFriday ? ' (اليوم جمعة)' : ''}', 'Friday driver bonus${isFriday ? ' (today is Friday)' : ''}'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        ),
        Row(children: [
          Expanded(child: _pickBtn(t.rentType.isEmpty ? tr('نوع الإيجار', 'Rent type') : _lookupLabel(_rentTypes, t.rentType), Icons.swap_horiz, () async {
            final v = await _pickLookup(tr('نوع الإيجار', 'Rent type'), _rentTypes);
            if (v != null) setState(() => t.rentType = v);
          })),
          const SizedBox(width: 8),
          Expanded(child: _pickBtn(t.loadType.isEmpty ? tr('نوع الحمولة', 'Load type') : _lookupLabel(_loadTypes, t.loadType), Icons.inventory_2_outlined, () async {
            final v = await _pickLookup(tr('نوع الحمولة', 'Load type'), _loadTypes);
            if (v != null) setState(() => t.loadType = v);
          })),
        ]),
        const SizedBox(height: 6),
        _pickBtn(t.expected.isEmpty ? tr('متوقع الوصول (اختياري)', 'Expected arrival (optional)') : '${tr('متوقع الوصول', 'Expected arrival')}: ${t.expected}', Icons.schedule, () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(t.expected) ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime.now().add(const Duration(days: 60)));
          if (d != null) setState(() => t.expected = ymd(d));
        }),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: _pickBtn(_labelOf(_helpers, t.helper).isEmpty ? tr('بمساعدة أحد (اختياري)…', 'Helped by (optional)…') : '${tr('بمساعدة', 'Helped by')}: ${_labelOf(_helpers, t.helper)}',
              Icons.group_add_outlined, _helpers.isEmpty ? null : () async {
            final v = await srPickPerson(context, tr('بمساعدة', 'Helped by'), _helpers);
            if (v != null) setState(() => t.helper = '${v['value']}');
          })),
          if ((t.helper ?? '').isNotEmpty) IconButton(onPressed: () => setState(() => t.helper = null), icon: const Icon(Icons.close, size: 18)),
        ]),
        const SizedBox(height: 6),
        TextField(controller: t.notes, decoration: InputDecoration(labelText: tr('ملاحظة الحمولة', 'Load note'))),
      ])),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    return AppScaffold(
      title: Text('${tr('إكمال الطلب على سياراتنا', 'Complete on our trucks')} ${r['number']}'),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
                  AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('${r['customerName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text('${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''} · ${r['truckType'] ?? ''}${'${r['branch'] ?? ''}'.isEmpty ? '' : ' · ${r['branch']}'}', style: const TextStyle(color: T.inkSoft)),
                    Text(tr('كلّ شاحنة تصير أمرَ نقلٍ بمورّد «تنشيط» وحمولةً في إدارة الأسطول مرتبطتين.', 'Each truck becomes a transport order with supplier «تنشيط» and a linked fleet load.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                  ])),
                  const SizedBox(height: 10),
                  _timesCard(context, _times, setState),
                  for (var i = 0; i < _trucks.length; i++) _card(i),
                  if (_trucks.length < _open)
                    Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: Text(tr('شاحنة أخرى', 'Another truck')))),
                ]),
      floatingActionButton: _loading ? null : FloatingActionButton.extended(
        onPressed: _saving ? null : _save,
        icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
        label: Text(tr('إتمام إنشاء الشحنة', 'Create transport orders')),
      ),
    );
  }
}

// ── «تحصيل السيارات» sheet ──────────────────────────────────────────────────

/// Who reported finding how many trucks, when and with whose help; members add theirs, authors (and leads) edit or delete.
Future<void> showSourcingSheet(BuildContext context, Map<String, dynamic> request, {required String team, required bool canAdd, required bool canLead}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _SourcingSheet(request: request, team: team, canAdd: canAdd, canLead: canLead),
    );

class _SourcingSheet extends StatefulWidget {
  final Map<String, dynamic> request;
  final String team;
  final bool canAdd;
  final bool canLead;
  const _SourcingSheet({required this.request, required this.team, required this.canAdd, required this.canLead});
  @override
  State<_SourcingSheet> createState() => _SourcingSheetState();
}

class _SourcingSheetState extends State<_SourcingSheet> {
  late Map<String, dynamic> _r = widget.request;
  List<Map<String, dynamic>> _members = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // «بمساعدة» lists sales, operations (vendors and follow-up), the data team and the fleet.
    if (widget.canAdd) srTeamMembers('helpers').then((v) { if (mounted) setState(() => _members = v); }).catchError((_) {});
  }

  String get _me => '${context.read<AuthProvider>().user?['_id'] ?? ''}';

  Future<void> _edit([Map? e]) async {
    final count = TextEditingController(text: e == null ? '' : '${e['count']}');
    final note = TextEditingController(text: '${e?['note'] ?? ''}');
    String? helper = e?['helper'] == null ? null : '${e!['helper']}';
    String helperName = '${e?['helperName'] ?? ''}';
    final ok = await showDialog<bool>(context: context, builder: (d) => StatefulBuilder(builder: (d, setD) => AlertDialog(
      title: Text(e == null ? tr('تسجيل سيارات حصّلتها', 'Record trucks you found') : tr('تعديل التحصيل', 'Edit')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: count, autofocus: true, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('عدد السيارات *', 'Number of trucks *'))),
        const SizedBox(height: 10),
        Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('بمساعدة مَن؟ (اختياري)', 'Helped by whom? (optional)'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft))),
        const SizedBox(height: 4),
        Row(children: [
          Expanded(child: _pickBtn(helperName.isEmpty ? tr('اختر الشخص الذي ساعد…', 'Pick who helped…') : '${tr('بمساعدة', 'Helped by')}: $helperName', Icons.group_add_outlined,
              _members.isEmpty ? null : () async {
            final v = await srPickPerson(context, tr('بمساعدة', 'Helped by'), _members.where((m) => '${m['value']}' != _me).toList());
            if (v != null) setD(() { helper = '${v['value']}'; helperName = '${v['label']}'; });
          })),
          if (helperName.isNotEmpty) IconButton(onPressed: () => setD(() { helper = null; helperName = ''; }), icon: const Icon(Icons.close, size: 18)),
        ]),
        const SizedBox(height: 8),
        TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('رجوع', 'Back'))),
        FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('حفظ', 'Save'))),
      ],
    )));
    final n = int.tryParse(_digits(count.text));
    final body = {'count': n, 'helper': helper ?? '', 'note': note.text.trim(), if (widget.team == 'fleet') 'team': 'fleet'};
    count.dispose();
    note.dispose();
    if (ok != true) return;
    if (n == null || n < 1 || n > 25) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('عدد السيارات بين 1 و25', 'Between 1 and 25'))));
      return;
    }
    await _call(() => e == null
        ? Api.instance.post('/api/shipment-requests/${_r['_id']}/sourcing', body)
        : Api.instance.put('/api/shipment-requests/${_r['_id']}/sourcing/${e['_id']}', body));
  }

  Future<void> _call(Future<dynamic> Function() fn) async {
    setState(() => _busy = true);
    try {
      final d = await fn();
      if (mounted && d is Map && d['request'] is Map) setState(() => _r = Map<String, dynamic>.from(d['request']));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final x = srSourced(_r);
    final entries = List<Map>.from(_r['sourcing'] ?? const []).reversed.toList();
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 14, 16, 14 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${tr('تحصيل السيارات', 'Trucks sourced')} — ${tr('طلب', 'Request')} ${_r['number']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        const SizedBox(height: 4),
        Text(tr('حُصّلت ${x.$1} من ${x.$2} · بقي ${x.$3}', '${x.$1} of ${x.$2} found · ${x.$3} left'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.navy)),
        Text(tr('للمتابعة فقط؛ لا يغيّر عدد أوامر النقل المنجزة.', 'Follow-up only; it does not change completed orders.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        const SizedBox(height: 6),
        if (entries.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(tr('لا تسجيلات بعد', 'Nothing recorded yet'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
        ConstrainedBox(constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.45), child: ListView(shrinkWrap: true, children: [
          for (final e in entries)
            ListTile(
              dense: true, contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(radius: 15, backgroundColor: T.navy.withValues(alpha: 0.1), child: Text('${e['count']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.navy))),
              title: Text('${e['byName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([soFmtDT(e['at']), if ('${e['helperName'] ?? ''}'.isNotEmpty) '${tr('بمساعدة', 'helped by')} ${e['helperName']}', e['note']].where((v) => '${v ?? ''}'.isNotEmpty).join(' · ')),
              trailing: ('${e['by']}' == _me || widget.canLead) && widget.canAdd
                  ? Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(icon: const Icon(Icons.edit_outlined, size: 18), onPressed: _busy ? null : () => _edit(e)),
                      IconButton(icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: _busy ? null : () => _call(() => Api.instance.delete('/api/shipment-requests/${_r['_id']}/sourcing/${e['_id']}${widget.team == 'fleet' ? '?team=fleet' : ''}'))),
                    ])
                  : null,
            ),
        ])),
        if (widget.canAdd) ...[
          const SizedBox(height: 8),
          FilledButton.icon(onPressed: _busy ? null : () => _edit(), icon: const Icon(Icons.add), label: Text(tr('حصّلتُ سيارات لهذا الطلب', 'I found trucks for this request'))),
        ],
      ]),
    ));
  }
}

// ── Approval delegates (sales manager only) ─────────────────────────────────

Future<void> showApproversSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => const _ApproversSheet(),
    );

class _ApproversSheet extends StatefulWidget {
  const _ApproversSheet();
  @override
  State<_ApproversSheet> createState() => _ApproversSheetState();
}

class _ApproversSheetState extends State<_ApproversSheet> {
  List<Map<String, dynamic>> _options = [];
  final Set<String> _picked = {};
  bool _canEdit = false;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/api/shipment-requests/approvers').then((d) {
      if (!mounted) return;
      setState(() {
        _options = List<Map<String, dynamic>>.from(((d['options'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _picked.addAll([for (final x in (d['approvers'] as List?) ?? const []) '$x']);
        _canEdit = d['canEdit'] == true;
        _loading = false;
      });
    }).catchError((_) { if (mounted) setState(() => _loading = false); });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await Api.instance.put('/api/shipment-requests/approvers', {'approvers': _picked.toList()});
      if (mounted) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ المفوَّضون', 'Delegates saved')))); Navigator.pop(context); }
    } catch (e) {
      if (mounted) { setState(() => _saving = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('المفوَّضون بالاعتماد', 'Approval delegates'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          Text(tr('أعضاء فريق المبيعات الذين يعتمدون طلبات الشحن مع مدير المبيعات.', 'Sales members who approve shipment requests with the sales manager.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          if (_loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
          ConstrainedBox(constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.5), child: ListView(shrinkWrap: true, children: [
            for (final o in _options)
              CheckboxListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                value: _picked.contains('${o['value']}'),
                onChanged: _canEdit ? (v) => setState(() => v == true ? _picked.add('${o['value']}') : _picked.remove('${o['value']}')) : null,
                title: Text('${o['label']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${o['roleAr'] ?? ''}'),
              ),
          ])),
          if (_canEdit) FilledButton(onPressed: _saving ? null : _save, child: Text(tr('حفظ', 'Save'))),
        ]),
      ));
}
