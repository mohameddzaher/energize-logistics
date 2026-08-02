import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// إنشاء/تعديل طلب شحنة — نفس نموذج الويب: الحقول تُبنى من إعدادات النموذج
/// (/fields)، اختيار العميل يسحب سعر المسار المتفق عليه وقيمه الافتراضية،
/// واختيار الشاحنة يملأ السائق وهاتفه، مع إنشاء عميل أو شاحنة جديدة في المكان.

const _systemKeys = {
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'driverRentType', 'paymentMethod', 'driverRentPrice', 'branch', 'notes',
};

const _fixedKeys = {'customer', 'waybillNumber', 'status', 'agentName', 'vehicleName', 'driverName', 'driverPhone'};

const _groups = [
  ('pickup_delivery', 'الاستلام والتسليم', 'Pickup & delivery', Icons.location_on_outlined),
  ('shipment', 'الشحنة', 'Shipment', Icons.inventory_2_outlined),
  ('pricing_time', 'التسعير والمواعيد', 'Pricing & times', Icons.schedule_outlined),
  ('payment', 'الدفع', 'Payment', Icons.account_balance_wallet_outlined),
];

class ShipmentOrderCreateScreen extends StatefulWidget {
  final Map<String, dynamic>? order;
  const ShipmentOrderCreateScreen({super.key, this.order});
  @override
  State<ShipmentOrderCreateScreen> createState() => _ShipmentOrderCreateScreenState();
}

class _ShipmentOrderCreateScreenState extends State<ShipmentOrderCreateScreen> {
  List<Map<String, dynamic>> _fields = [];
  List<Map<String, dynamic>> _customers = [];
  List<Map<String, dynamic>> _vehicles = [];
  bool _loading = true;
  String? _error;
  bool _saving = false;

  Map<String, dynamic>? _customer;
  Map<String, dynamic>? _vehicle;
  bool _newCustomer = false;
  final _ncName = TextEditingController();
  final _ncPhone = TextEditingController();
  bool _newVehicle = false;
  final _nvPlate = TextEditingController();
  final _nvName = TextEditingController();

  final Map<String, dynamic> _form = {};
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _missing = {};

  bool get _editing => widget.order != null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  TextEditingController _ctrl(String key) =>
      _ctrls.putIfAbsent(key, () => TextEditingController(text: (_form[key] ?? '').toString()));

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/shipment-orders/fields'),
        Api.instance.get('/api/shipment-orders/customers').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/shipment-orders/vehicles').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _fields = List<Map<String, dynamic>>.from(results[0]['fields'] ?? []);
        _customers = List<Map<String, dynamic>>.from(results[1]['customers'] ?? []);
        _vehicles = List<Map<String, dynamic>>.from(results[2]['vehicles'] ?? []);
        if (_editing) {
          final o = widget.order!;
          for (final f in _fields) {
            final k = (f['key'] ?? '').toString();
            _form[k] = o[k] ?? (o['customFields'] is Map ? o['customFields'][k] : null);
          }
          final cid = o['customer'] is Map ? o['customer']['_id'] : o['customer'];
          if (cid != null) {
            for (final c in _customers) {
              if (c['_id'] == cid) _customer = c;
            }
          }
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  // اختيار العميل يسحب الافتراضيات وسعر المسار المتفق عليه فورًا.
  void _applyCustomer(Map<String, dynamic> c) {
    setState(() {
      _customer = c;
      _newCustomer = false;
      final d = c['defaults'] as Map<String, dynamic>? ?? {};
      for (final k in ['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch']) {
        if ((d[k] ?? '').toString().isNotEmpty && (_form[k] ?? '').toString().isEmpty) {
          _form[k] = d[k];
          _ctrls.remove(k);
        }
      }
      _applyRoutePrice();
    });
  }

  void _applyRoutePrice() {
    final c = _customer;
    if (c == null) return;
    final from = (_form['fromCity'] ?? '').toString();
    final to = (_form['toCity'] ?? '').toString();
    if (from.isEmpty || to.isEmpty) return;
    for (final r in List<Map<String, dynamic>>.from(c['routes'] ?? [])) {
      if (r['fromCity'] == from && r['toCity'] == to && r['price'] != null) {
        _form['sellPrice'] = r['price'];
        _ctrls.remove('sellPrice');
      }
    }
  }

  void _applyVehicle(Map<String, dynamic> v) {
    setState(() {
      _vehicle = v;
      _newVehicle = false;
      if ((v['defaultDriverName'] ?? '').toString().isNotEmpty) {
        _form['driverName'] = v['defaultDriverName'];
        _ctrls.remove('driverName');
      }
      if ((v['defaultDriverPhone'] ?? '').toString().isNotEmpty) {
        _form['driverPhone'] = v['defaultDriverPhone'];
        _ctrls.remove('driverPhone');
      }
      if ((v['truckType'] ?? '').toString().isNotEmpty && (_form['truckType'] ?? '').toString().isEmpty) {
        _form['truckType'] = v['truckType'];
        _ctrls.remove('truckType');
      }
    });
  }

  Future<P?> _pickSheet<P>(String title, List<P> items, String Function(P) label, {String Function(P)? sub}) {
    return showModalBottomSheet<P>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = items.where((x) => fq.isEmpty || _fold('${label(x)} ${sub?.call(x) ?? ''}').contains(fq)).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.72,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      autofocus: true,
                      onChanged: (v) => setS(() => q = v),
                      decoration: InputDecoration(hintText: '${tr('ابحث في', 'Search')} $title…', prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) => ListTile(
                        title: Text(label(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                        subtitle: sub == null ? null : Text(sub(list[i]), style: const TextStyle(fontSize: 12)),
                        onTap: () => Navigator.pop(c, list[i]),
                      ),
                    ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  Future<void> _save() async {
    if (_saving) return;
    _missing.clear();
    for (final f in _fields) {
      final k = (f['key'] ?? '').toString();
      if (f['required'] == true && !_fixedKeys.contains(k) && (_form[k] ?? '').toString().trim().isEmpty) {
        _missing.add(k);
      }
    }
    if (_customer == null && !(_newCustomer && _ncName.text.trim().isNotEmpty)) _missing.add('customer');
    if (_missing.isNotEmpty) {
      setState(() {});
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أكمل الحقول المحددة بالأحمر', 'Fill the highlighted fields'))));
      return;
    }
    setState(() => _saving = true);
    final payload = <String, dynamic>{'customFields': <String, dynamic>{}};
    for (final f in _fields) {
      final k = (f['key'] ?? '').toString();
      if (_fixedKeys.contains(k)) continue;
      final v = _form[k];
      if (v == null || v.toString().isEmpty) continue;
      if (_systemKeys.contains(k)) {
        payload[k] = v;
      } else {
        payload['customFields'][k] = v;
      }
    }
    if (_customer != null) payload['customer'] = _customer!['_id'];
    if (_newCustomer && _ncName.text.trim().isNotEmpty) {
      payload['newCustomer'] = {'name': _ncName.text.trim(), 'phone': _ncPhone.text.trim()};
    }
    if (_vehicle != null) payload['vehicle'] = _vehicle!['_id'];
    if (_newVehicle && _nvPlate.text.trim().isNotEmpty) {
      payload['newVehicle'] = {'plate': _nvPlate.text.trim(), 'name': _nvName.text.trim()};
    }
    // القيم اليدوية للسائق تبقى إن لم تأتِ من شاحنة مسجلة.
    for (final k in ['driverName', 'driverPhone']) {
      if ((_form[k] ?? '').toString().isNotEmpty) payload[k] = _form[k];
    }
    try {
      if (_editing) {
        await Api.instance.put('/api/shipment-orders/orders/${widget.order!['_id']}', payload);
      } else {
        await Api.instance.post('/api/shipment-orders/orders', payload);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Widget _fieldInput(Map<String, dynamic> f) {
    final k = (f['key'] ?? '').toString();
    final label = tr((f['labelAr'] ?? k).toString(), (f['labelEn'] ?? '').toString().isEmpty ? (f['labelAr'] ?? k).toString() : (f['labelEn'] ?? '').toString());
    final miss = _missing.contains(k);
    final deco = InputDecoration(
      labelText: f['required'] == true ? '$label *' : label,
      labelStyle: miss ? const TextStyle(color: T.danger, fontWeight: FontWeight.w700) : null,
      enabledBorder: miss ? OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: T.danger)) : null,
    );
    final type = (f['inputType'] ?? 'text').toString();

    if (type == 'select' || type == 'cards') {
      final options = List<Map<String, dynamic>>.from(f['options'] ?? []);
      final current = (_form[k] ?? '').toString();
      return DropdownButtonFormField<String>(
        initialValue: options.any((o) => o['key'] == current) ? current : null,
        isExpanded: true,
        decoration: deco,
        items: options
            .map((o) => DropdownMenuItem(
                value: (o['key'] ?? '').toString(),
                child: Text(tr((o['ar'] ?? o['key'] ?? '').toString(), (o['en'] ?? o['ar'] ?? o['key'] ?? '').toString()), overflow: TextOverflow.ellipsis)))
            .toList(),
        onChanged: (v) => setState(() {
          _form[k] = v;
          if (k == 'fromCity' || k == 'toCity') _applyRoutePrice();
        }),
      );
    }

    if (type == 'datetime') {
      final current = (_form[k] ?? '').toString();
      final dt = DateTime.tryParse(current)?.toLocal();
      return OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          alignment: AlignmentDirectional.centerStart,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          side: BorderSide(color: miss ? T.danger : Colors.black12),
        ),
        onPressed: () async {
          final d = await showDatePicker(
            context: context,
            initialDate: dt ?? DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (d == null || !mounted) return;
          final t = await showTimePicker(context: context, initialTime: dt != null ? TimeOfDay.fromDateTime(dt) : TimeOfDay.now());
          final full = DateTime(d.year, d.month, d.day, t?.hour ?? 0, t?.minute ?? 0);
          setState(() => _form[k] = full.toIso8601String());
        },
        icon: Icon(Icons.event, size: 17, color: miss ? T.danger : T.navy),
        label: Text(
          dt == null ? (f['required'] == true ? '$label *' : label) : '$label: ${dt.day}/${dt.month} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}',
          style: TextStyle(fontSize: 13, color: miss ? T.danger : T.ink),
        ),
      );
    }

    return TextField(
      controller: _ctrl(k),
      maxLines: type == 'textarea' ? 3 : 1,
      keyboardType: type == 'number' ? TextInputType.number : null,
      onChanged: (v) {
        _form[k] = type == 'number' ? (num.tryParse(v) ?? v) : v;
        if (k == 'fromCity' || k == 'toCity') setState(_applyRoutePrice);
      },
      decoration: deco,
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(_editing ? tr('تعديل طلب الشحنة', 'Edit Order') : tr('طلب شحنة جديد', 'New Shipment Order')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 180)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: [
                  // ── العميل ──
                  FadeSlideIn(
                    child: AppCard(
                      topAccent: _missing.contains('customer') ? T.danger : T.navy,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.person_outline, size: 18, color: T.navy),
                          const SizedBox(width: 6),
                          Text(tr('العميل', 'Customer'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          TextButton(
                            onPressed: () => setState(() { _newCustomer = !_newCustomer; if (_newCustomer) _customer = null; }),
                            child: Text(_newCustomer ? tr('اختيار من القائمة', 'Pick existing') : tr('+ عميل جديد', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        if (!_newCustomer)
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                            onPressed: () async {
                              final c = await _pickSheet<Map<String, dynamic>>(tr('العملاء', 'customers'), _customers, (c) => (c['name'] ?? '').toString(), sub: (c) => (c['phone'] ?? '').toString());
                              if (c != null) _applyCustomer(c);
                            },
                            icon: const Icon(Icons.search, size: 17),
                            label: Text(_customer == null ? tr('اختر العميل…', 'Choose customer…') : (_customer!['name'] ?? '').toString(),
                                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                          )
                        else ...[
                          TextField(controller: _ncName, decoration: InputDecoration(labelText: tr('اسم العميل الجديد *', 'New customer name *'))),
                          const SizedBox(height: 8),
                          TextField(controller: _ncPhone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('الهاتف', 'Phone'))),
                        ],
                      ]),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // ── الشاحنة ──
                  FadeSlideIn(
                    delayMs: 40,
                    child: AppCard(
                      topAccent: T.orange,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.local_shipping_outlined, size: 18, color: T.orange),
                          const SizedBox(width: 6),
                          Text(tr('الشاحنة والسائق', 'Truck & driver'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          TextButton(
                            onPressed: () => setState(() { _newVehicle = !_newVehicle; if (_newVehicle) _vehicle = null; }),
                            child: Text(_newVehicle ? tr('اختيار من السجل', 'Pick existing') : tr('+ شاحنة جديدة', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        if (!_newVehicle)
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                            onPressed: () async {
                              final v = await _pickSheet<Map<String, dynamic>>(tr('الشاحنات', 'vehicles'), _vehicles, (v) => (v['plate'] ?? '').toString(),
                                  sub: (v) => '${v['name'] ?? ''} ${v['defaultDriverName'] ?? ''}'.trim());
                              if (v != null) _applyVehicle(v);
                            },
                            icon: const Icon(Icons.search, size: 17),
                            label: Text(_vehicle == null ? tr('اختر الشاحنة… (اختياري)', 'Choose truck… (optional)') : (_vehicle!['plate'] ?? '').toString(),
                                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                          )
                        else ...[
                          TextField(controller: _nvPlate, decoration: InputDecoration(labelText: tr('اللوحة *', 'Plate *'))),
                          const SizedBox(height: 8),
                          TextField(controller: _nvName, decoration: InputDecoration(labelText: tr('وصف الشاحنة', 'Truck description'))),
                        ],
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(
                            child: TextField(
                              controller: _ctrl('driverName'),
                              onChanged: (v) => _form['driverName'] = v,
                              decoration: InputDecoration(labelText: tr('اسم السائق', 'Driver name')),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              controller: _ctrl('driverPhone'),
                              keyboardType: TextInputType.phone,
                              onChanged: (v) => setState(() => _form['driverPhone'] = v),
                              decoration: InputDecoration(labelText: tr('هاتف السائق', 'Driver phone')),
                            ),
                          ),
                          // اتصال/واتساب على رقم السائق مباشرة.
                          ContactButtons(phone: (_form['driverPhone'] ?? _ctrls['driverPhone']?.text ?? '').toString(), compact: true),
                        ]),
                      ]),
                    ),
                  ),
                  // ── الحقول من الإعدادات، مجموعة مجموعة ──
                  ..._groups.map((g) {
                    final gf = _fields.where((f) => f['group'] == g.$1 && !_fixedKeys.contains(f['key'])).toList();
                    if (gf.isEmpty) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: FadeSlideIn(
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Icon(g.$4, size: 18, color: T.navy),
                              const SizedBox(width: 6),
                              Text(tr(g.$2, g.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            ]),
                            const SizedBox(height: 10),
                            ...gf.map((f) => Padding(padding: const EdgeInsets.only(bottom: 10), child: _fieldInput(f))),
                          ]),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 50,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.check_rounded),
                      label: Text(_editing ? tr('حفظ التعديلات', 'Save changes') : tr('إنشاء الطلب', 'Create order'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                    ),
                  ),
                  const SizedBox(height: 30),
                ]),
    );
  }
}
