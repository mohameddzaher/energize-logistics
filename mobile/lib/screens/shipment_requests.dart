import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
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
Widget srStatusChip(dynamic s) {
  final x = srStatuses['$s'] ?? ('$s', '$s', T.inkFaint);
  return Chip2(tr(x.$1, x.$2), x.$3);
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
};

/// Keys of the shipment form that belong to the vendors half or are derived; the request form leaves them out.
const _vendorKeys = {'buyPrice', 'advanceAmount', 'driverRentPrice', 'driverName', 'driverPhone', 'vehicleName', 'driverRentType', 'status', 'paymentMethod'};
/// Keys written on the request itself; any other configured field goes in customFields.
const _salesKeys = {'fromCity', 'toCity', 'branch', 'notes', 'blNumber', 'containerNumber', 'truckType', 'cargoType', 'truckLength', 'quantity', 'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'paymentSubtype'};
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
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool get _editing => widget.request != null;
  bool get _rejected => widget.request?['status'] == 'rejected';

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
      _trucks = inum(r['trucks']).toInt().clamp(1, 25);
      if (r['customer'] != null) _customer = {'_id': r['customer'] is Map ? r['customer']['_id'] : r['customer'], 'name': r['customerName']};
      _salesRep = r['salesRep'] == null ? null : '${r['salesRep'] is Map ? r['salesRep']['_id'] : r['salesRep']}';
    } else {
      final t = ymd(DateTime.now());
      _form['pickupTime'] = t;
      _form['startTime'] = t;
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
    setState(() => _fields = all.where((x) => x['active'] != false && x['deleted'] != true && !_vendorKeys.contains(x['key'])).toList()
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
      final d = (c['defaults'] as Map?) ?? const {};
      for (final k in ['truckType', 'cargoType', 'branch', 'paymentSubtype']) {
        if ('${d[k] ?? ''}'.isNotEmpty && '${_form[k] ?? ''}'.isEmpty) { _form[k] = d[k]; _ctrls.remove(k); }
      }
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
      final v = _form[k];
      if (v == null || '$v'.trim().isEmpty) continue;
      if (_salesKeys.contains(k)) { body[k] = v; } else { body['customFields'][k] = v; }
    }
    for (final k in ['notes', 'blNumber', 'containerNumber']) {
      if (_form.containsKey(k)) body[k] = '${_form[k] ?? ''}'.trim();
    }
    for (final k in ['pickupTime', 'startTime', 'arrivalTime']) {
      if ('${body[k] ?? ''}'.isNotEmpty) body[k] = '${body[k]}T12:00:00';
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
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُرسل طلب الشحنة رقم ${d['request']?['number']} إلى فريق الموردين', 'Request ${d['request']?['number']} sent to the vendors team'))));
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
                  if (_rejected)
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
                  Text(tr('سعرُ الشراء والمورّدُ والسيارةُ والسائق يكملها فريقُ الموردين.', 'The vendors team adds the buying price, supplier, truck and driver.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
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
  /// 'ask' = sales view (own requests, create), 'place' = vendors inbox.
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
  late String _status = widget.mode == 'place' ? 'pending,in_progress' : '';
  String _q = '';
  Timer? _t;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on(srEvent, _onLive);
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
      final p = ['limit=100', if (_status.isNotEmpty) 'status=$_status', if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}'];
      final d = await Api.instance.get('/api/shipment-requests?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d['requests'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
        _by = Map<String, dynamic>.from(d['byStatus'] ?? {});
        _can = Map<String, dynamic>.from(d['can'] ?? {});
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
    final tabs = widget.mode == 'place'
        ? [('pending,in_progress', 'المفتوحة', 'Open', inum(_by['pending']) + inum(_by['in_progress'])), ('completed', 'مكتملة', 'Completed', inum(_by['completed'])), ('rejected', 'مرفوضة', 'Rejected', inum(_by['rejected'])), ('cancelled', 'مسحوبة', 'Withdrawn', inum(_by['cancelled'])), ('', 'الكل', 'All', -1)]
        : [('', 'الكل', 'All', -1), ('pending,in_progress', 'المفتوحة', 'Open', inum(_by['pending']) + inum(_by['in_progress'])), ('rejected', 'مرفوضة', 'Rejected', inum(_by['rejected'])), ('completed', 'مكتملة', 'Completed', inum(_by['completed'])), ('cancelled', 'مسحوبة', 'Withdrawn', inum(_by['cancelled']))];
    return AppScaffold(
      title: Text(widget.mode == 'place' ? tr('الطلبات من المبيعات', 'Requests from sales') : tr('طلبات الشحن', 'Shipment requests')),
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
        SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), child: Row(children: [
          for (final t in tabs)
            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
              label: Text(t.$4 < 0 ? tr(t.$2, t.$3) : '${tr(t.$2, t.$3)} (${t.$4})'),
              selected: _status == t.$1,
              onSelected: (_) { setState(() => _status = t.$1); _load(); },
            )),
        ])),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _rows.isEmpty
                        ? ListView(children: [Padding(padding: const EdgeInsets.all(40), child: Text(tr('لا طلبات هنا', 'No requests here'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))])
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 90),
                            itemCount: _rows.length,
                            itemBuilder: (_, i) => _card(_rows[i]),
                          ),
                  )),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> r) {
    final placed = (r['placed'] as List?)?.length ?? 0;
    final trucks = inum(r['trucks']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(onTap: () => _open(r), child: AppCard(
        topAccent: (srStatuses['${r['status']}'] ?? ('', '', T.line)).$3,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text('#${r['number']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
            const SizedBox(width: 8),
            Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
            srStatusChip(r['status']),
          ]),
          const SizedBox(height: 4),
          Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'} · ${r['truckType'] ?? ''}${'${r['branch'] ?? ''}'.isEmpty ? '' : ' · ${r['branch']}'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Chip2('${tr('الشاحنات', 'Trucks')} $placed/${fmtNum(trucks)}', placed >= trucks ? T.success : T.navy, icon: Icons.local_shipping_outlined),
            if (r['pickupTime'] != null) Chip2(soFmtDate(r['pickupTime']), T.inkFaint, icon: Icons.event),
            if (r.containsKey('sellPrice') && r['sellPrice'] != null) Chip2('${tr('بيع', 'Sell')} ${soMoney(r['sellPrice'])}', T.success),
            if ('${r['handlerName'] ?? ''}'.isNotEmpty) Chip2('${tr('يعمل عليه', 'Handled by')} ${r['handlerName']}', T.violet),
            if ('${r['createdByName'] ?? ''}'.isNotEmpty && widget.mode == 'place') Chip2('${tr('من', 'By')} ${r['createdByName']}', T.inkSoft),
          ]),
          if (r['status'] == 'rejected')
            Padding(padding: const EdgeInsets.only(top: 6), child: Text('${tr('سبب الرفض', 'Reason')}: ${r['rejectReason'] ?? ''}${'${r['rejectNote'] ?? ''}'.isEmpty ? '' : ' — ${r['rejectNote']}'}',
                style: const TextStyle(fontSize: 12, color: T.danger, fontWeight: FontWeight.w700))),
        ]),
      )),
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

  Future<void> _claim() async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/shipment-requests/${widget.id}/claim', {});
    } on ApiException catch (e) {
      if (!mounted) return;
      final take = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
        content: Text(e.message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('رجوع', 'Back'))),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('تولِّيه بدلًا منه', 'Take it over'))),
        ],
      ));
      if (take == true) await Api.instance.post('/api/shipment-requests/${widget.id}/claim', {'takeOver': true}).catchError((_) => null);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    await _load();
    if (mounted) setState(() => _busy = false);
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
    return AppScaffold(
      title: Text(r == null ? tr('طلب شحنة', 'Shipment request') : '${tr('طلب شحنة', 'Request')} #${r['number']}'),
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
                      _kv(tr('يعمل عليه', 'Handled by'), r['handlerName']),
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
                              subtitle: Text([o['driverName'], soPriceLine(o)].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
                              trailing: Chip2(tr(soStatusOf(_vocab, o['status']).$2, soStatusOf(_vocab, o['status']).$3), soStatusOf(_vocab, o['status']).$4),
                            ),
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
                    if (ask && const ['pending', 'in_progress', 'rejected'].contains(st))
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        FilledButton.icon(
                          onPressed: _busy ? null : () async {
                            final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ShipmentRequestFormScreen(request: r)));
                            if (ok == true) _load();
                          },
                          icon: const Icon(Icons.edit_outlined),
                          label: Text(st == 'rejected' ? tr('تعديل وإعادة الإرسال', 'Amend and resend') : tr('تعديل', 'Edit')),
                        ),
                        if (st == 'rejected')
                          OutlinedButton.icon(onPressed: _busy ? null : () => _act('resubmit', {}, tr('أُعيد إرسال الطلب', 'Resent')), icon: const Icon(Icons.send), label: Text(tr('إعادة الإرسال كما هو', 'Resend as is'))),
                        OutlinedButton.icon(onPressed: _busy ? null : _withdraw, style: OutlinedButton.styleFrom(foregroundColor: T.danger), icon: const Icon(Icons.undo), label: Text(tr('سحب الطلب', 'Withdraw'))),
                      ]),
                    if (place && open)
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        FilledButton.icon(
                          onPressed: _busy ? null : () async {
                            final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => PlaceTrucksScreen(request: r)));
                            if (ok == true) _load();
                          },
                          icon: const Icon(Icons.local_shipping_outlined),
                          label: Text(tr('إكمال الشحنة', 'Complete the shipment')),
                        ),
                        if ('${r['handlerName'] ?? ''}'.isEmpty)
                          OutlinedButton.icon(onPressed: _busy ? null : _claim, icon: const Icon(Icons.pan_tool_outlined), label: Text(tr('تولِّي الطلب', 'Take it')))
                        else
                          OutlinedButton.icon(onPressed: _busy ? null : () => _act('release'), icon: const Icon(Icons.logout), label: Text(tr('ترك الطلب', 'Release'))),
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
          LookupField(type: 'sr_reject_reason', controller: _reason, label: tr('سبب الرفض *', 'Reason *'), onChanged: () => setState(() {})),
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

// ── Vendors: placing the trucks ─────────────────────────────────────────────

class PlaceTrucksScreen extends StatefulWidget {
  final Map<String, dynamic> request;
  const PlaceTrucksScreen({super.key, required this.request});
  @override
  State<PlaceTrucksScreen> createState() => _PlaceTrucksScreenState();
}

class _Truck {
  // Who found the carrier and the truck owner; defaults to the placer.
  String? sourcingRep;
  Map<String, dynamic>? supplier;
  Map<String, dynamic>? vehicle;
  final plate = TextEditingController();
  final driver = TextEditingController();
  final phone = TextEditingController();
  final buy = TextEditingController();
  final advance = TextEditingController();
  final bl = TextEditingController();
  final container = TextEditingController();
  List<Map<String, dynamic>> drivers = [];
  void dispose() { for (final c in [plate, driver, phone, buy, advance, bl, container]) { c.dispose(); } }
}

class _PlaceTrucksScreenState extends State<PlaceTrucksScreen> {
  final List<_Truck> _trucks = [];
  bool _saving = false;
  List<Map<String, dynamic>> _reps = const [];
  String _me = '';

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
      if (!mounted) return;
      setState(() {
        _reps = rows;
        if (rows.any((o) => '${o['value']}' == _me)) {
          for (final t in _trucks) { t.sourcingRep ??= _me; }
        }
      });
    } catch (_) {/* optional field */}
  }

  String _repLabel(String? id) {
    final o = _reps.where((x) => '${x['value']}' == id);
    return o.isEmpty ? '' : '${o.first['label'] ?? ''}';
  }

  Future<void> _pickRep(_Truck t) async {
    final v = await pickRemote(context,
      title: tr('مسؤول التوريد', 'Sourcing'),
      fetch: (q) async {
        final f = q.trim().toLowerCase();
        return _reps.where((x) => f.isEmpty || '${x['label']}'.toLowerCase().contains(f)).toList();
      },
      label: (x) => '${x['label'] ?? ''}',
      sub: (x) => '${x['roleAr'] ?? ''}',
    );
    if (v != null) setState(() => t.sourcingRep = '${v['value']}');
  }

  @override
  void dispose() { for (final t in _trucks) { t.dispose(); } super.dispose(); }

  void _add() {
    if (_trucks.length >= _open) return;
    final t = _Truck();
    t.bl.text = '${widget.request['blNumber'] ?? ''}';
    t.container.text = '${widget.request['containerNumber'] ?? ''}';
    // A second truck usually goes to the same supplier at the same price.
    if (_trucks.isNotEmpty) { t.supplier = _trucks.last.supplier; t.buy.text = _trucks.last.buy.text; t.sourcingRep = _trucks.first.sourcingRep; }
    else if (_reps.any((o) => '${o['value']}' == _me)) { t.sourcingRep = _me; }
    setState(() => _trucks.add(t));
  }

  Future<void> _loadDrivers(_Truck t) async {
    final q = t.vehicle != null ? 'vehicle=${t.vehicle!['_id']}' : t.supplier != null ? 'supplier=${t.supplier!['_id']}' : '';
    if (q.isEmpty) return;
    try {
      var d = await Api.instance.get('/api/shipment-orders/drivers?$q&limit=200');
      var rows = List<Map<String, dynamic>>.from(((d['drivers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      if (rows.isEmpty && t.supplier != null && t.vehicle != null) {
        d = await Api.instance.get('/api/shipment-orders/drivers?supplier=${t.supplier!['_id']}&limit=200');
        rows = List<Map<String, dynamic>>.from(((d['drivers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      }
      if (mounted) setState(() => t.drivers = rows);
    } catch (_) {/* typed driver still works */}
  }

  Future<void> _pickSupplier(_Truck t) async {
    final s = await pickRemote(context,
      title: tr('المورّد', 'Supplier'),
      fetch: (q) async {
        final d = await Api.instance.get('/api/shipment-orders/suppliers?limit=60&fresh=1${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(((d['suppliers'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      },
      label: (x) => '${x['name'] ?? ''}',
      sub: (x) => [x['phone'], x['type'] == 'freelancer' ? tr('سائق فرد', 'Freelancer') : tr('شركة', 'Company')].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
    );
    if (s == null) return;
    setState(() { t.supplier = s; t.vehicle = null; });
    _loadDrivers(t);
  }

  Future<void> _pickVehicle(_Truck t) async {
    final v = await pickRemote(context,
      title: tr('السيارة', 'Truck'),
      fetch: (q) async {
        final qs = StringBuffer('limit=80');
        if (t.supplier != null && q.isEmpty) qs.write('&supplier=${t.supplier!['_id']}');
        if (q.isNotEmpty) qs.write('&q=${Uri.encodeQueryComponent(q)}');
        final d = await Api.instance.get('/api/shipment-orders/vehicles?$qs');
        return List<Map<String, dynamic>>.from(((d['vehicles'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));
      },
      label: (x) => '${x['plate'] ?? ''}',
      sub: (x) => [x['truckType'], x['supplier'] is Map ? x['supplier']['name'] : '', x['defaultDriverName']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '),
    );
    if (v == null) return;
    setState(() {
      t.vehicle = v;
      t.plate.clear();
      if (t.driver.text.isEmpty) t.driver.text = '${v['defaultDriverName'] ?? ''}';
      if (t.phone.text.isEmpty) t.phone.text = '${v['defaultDriverPhone'] ?? ''}';
      if (t.supplier == null && v['supplier'] is Map) t.supplier = Map<String, dynamic>.from(v['supplier']);
    });
    _loadDrivers(t);
  }

  Future<void> _save() async {
    final problems = <String>[];
    for (var i = 0; i < _trucks.length; i++) {
      final t = _trucks[i];
      final n = i + 1;
      if (t.supplier == null) problems.add(tr('الشاحنة $n: اختر المورّد', 'Truck $n: supplier'));
      if (t.vehicle == null && t.plate.text.trim().isEmpty) problems.add(tr('الشاحنة $n: اختر السيارة أو اكتب لوحتها', 'Truck $n: truck or plate'));
      if (t.driver.text.trim().isEmpty) problems.add(tr('الشاحنة $n: اسم السائق', 'Truck $n: driver'));
      if (!((num.tryParse(t.buy.text.trim()) ?? 0) > 0)) problems.add(tr('الشاحنة $n: سعر الشراء مطلوب', 'Truck $n: buying price required'));
    }
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
              'supplierChoice': t.supplier!['_id'],
              if (t.vehicle != null) 'vehicle': t.vehicle!['_id'] else 'newVehicle': {'plate': t.plate.text.trim()},
              'driverName': t.driver.text.trim(),
              'driverPhone': t.phone.text.trim(),
              'sourcingRep': (t.sourcingRep ?? '').isEmpty ? null : t.sourcingRep,
              'buyPrice': num.tryParse(t.buy.text.trim()),
              if (t.advance.text.trim().isNotEmpty) 'advanceAmount': num.tryParse(t.advance.text.trim()),
              'blNumber': t.bl.text.trim(),
              'containerNumber': t.container.text.trim(),
            },
        ],
      });
      final failed = (d['failed'] as List?)?.length ?? 0;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
          'أُنشئت أوامر النقل: ${(d['waybills'] as List? ?? const []).join('، ')}${failed > 0 ? ' · تعذّرت $failed' : ''}',
          'Transport orders: ${(d['waybills'] as List? ?? const []).join(', ')}${failed > 0 ? ' · $failed failed' : ''}'))));
        if (failed == 0) { Navigator.pop(context, true); } else { setState(() => _saving = false); }
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
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: AppCard(topAccent: T.orange, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('${tr('الشاحنة', 'Truck')} ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w900)),
          const Spacer(),
          if (_trucks.length > 1) IconButton(onPressed: () => setState(() { _trucks.removeAt(i).dispose(); }), icon: const Icon(Icons.delete_outline, color: T.danger)),
        ]),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
          onPressed: _reps.isEmpty ? null : () => _pickRep(t),
          icon: const Icon(Icons.person_search_outlined, size: 17),
          label: Text(_repLabel(t.sourcingRep).isEmpty ? tr('مسؤول التوريد — مَن جاء بالمورّد ومالك السيارة…', 'Sourcing — who found the carrier…') : '${tr('مسؤول التوريد', 'Sourcing')}: ${_repLabel(t.sourcingRep)}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
          onPressed: () => _pickSupplier(t),
          icon: const Icon(Icons.storefront_outlined, size: 17),
          label: Text(t.supplier == null ? tr('اختر المورّد… *', 'Choose supplier… *') : '${t.supplier!['name']}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
          onPressed: () => _pickVehicle(t),
          icon: const Icon(Icons.local_shipping_outlined, size: 17),
          label: Text(t.vehicle == null ? tr('اختر السيارة من السجلّ…', 'Pick truck from the register…') : '${t.vehicle!['plate']}', style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
        if (t.vehicle == null)
          Padding(padding: const EdgeInsets.only(top: 6), child: TextField(controller: t.plate, decoration: InputDecoration(labelText: tr('أو اكتب لوحة جديدة', 'Or type a new plate')))),
        if (t.vehicle != null) Align(alignment: AlignmentDirectional.centerStart, child: TextButton(onPressed: () => setState(() => t.vehicle = null), child: Text(tr('لوحة جديدة بدلًا منها', 'Use a new plate instead')))),
        const SizedBox(height: 6),
        if (t.drivers.isNotEmpty)
          Wrap(spacing: 5, runSpacing: 5, children: [
            for (final dr in t.drivers.take(12))
              ActionChip(label: Text('${dr['name']}', style: const TextStyle(fontSize: 11.5)), onPressed: () => setState(() { t.driver.text = '${dr['name'] ?? ''}'; t.phone.text = '${dr['phone'] ?? ''}'; })),
          ]),
        TextField(controller: t.driver, decoration: InputDecoration(labelText: tr('اسم السائق *', 'Driver name *'))),
        const SizedBox(height: 6),
        TextField(controller: t.phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('جوال السائق', 'Driver phone'))),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(controller: t.buy, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سعر الشراء *', 'Buying price *')))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: t.advance, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('السلفة', 'Advance')))),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(controller: t.bl, decoration: InputDecoration(labelText: tr('رقم البوليصة', 'B/L')))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: t.container, decoration: InputDecoration(labelText: tr('رقم الحاوية', 'Container')))),
        ]),
      ])),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    return AppScaffold(
      title: Text('${tr('إكمال الطلب', 'Complete request')} #${r['number']}'),
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${r['customerName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900)),
          Text('${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''} · ${r['truckType'] ?? ''} · ${soFmtDate(r['pickupTime'])}', style: const TextStyle(color: T.inkSoft)),
          Text(tr('بقي $_open ${_open == 1 ? 'شاحنة' : 'شاحنات'} — كلّ شاحنة تصير أمرَ نقلٍ بالرقم التسلسلي.', '$_open truck(s) left — each becomes a transport order.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        ])),
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
