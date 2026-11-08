import 'dart:async';

import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'so_driver_picker.dart';

/// Create/edit a shipment order, same form as the web: fields are built from the form settings (/fields), choosing the customer pulls the agreed route price and its defaults, choosing the truck fills the driver and his phone, and a new customer or truck can be created in place.

const _systemKeys = {
  'fromCity', 'toCity', 'addressFrom', 'addressTo', 'truckType', 'cargoType',
  'truckLength', 'quantity', 'driverName', 'driverPhone', 'vehicleName',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  // Payment kind (paymentSubtype) replaced the driver rental type in the form; its four options arrive from the server (/fields) with the operations workflow keys.
  'paymentSubtype', 'driverRentType', 'paymentMethod', 'branch', 'notes',
  // Waybill and container (linked to clearance) and advance.
  'advanceAmount', 'blNumber', 'containerNumber',
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
  List<Map<String, dynamic>> _suppliers = [];
  bool _loading = true;
  String? _error;
  bool _saving = false;

  Map<String, dynamic>? _customer;
  // Operational sales: who brought the load, from the sales team or operations.
  Map<String, dynamic>? _salesRep;
  List<Map<String, dynamic>> _salesReps = const [];
  // Supplier first, then its truck. As on the web: the supplier is known first and then which of its trucks, so the list is limited to its own instead of hundreds of plates together.
  Map<String, dynamic>? _supplier;
  Map<String, dynamic>? _vehicle;
  bool _savingSupplier = false;
  bool _newCustomer = false;
  final _ncName = TextEditingController();
  final _ncPhone = TextEditingController();
  bool _newVehicle = false;
  final _nvPlate = TextEditingController();
  final _nvName = TextEditingController();

  /// One load on several trucks. The customer asks for a load leaving on five trucks: customer, route, price and date are the same, while supplier, truck and driver differ. Employees used to leave the form and retype twenty fields five times.
  /// Each truck becomes an independent order with its waybill number from the same counter, with no parent order or link between them: each truck goes, arrives and is billed on its own.
  final List<Map<String, dynamic>> _extraTrucks = [];

  final Map<String, dynamic> _form = {};
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _missing = {};

  bool get _editing => widget.order != null;
  // Money after saving, for whoever the server allows (/money-editors, as on the web): `editable` is written directly, `byRequest` goes to approval (the data team's selling price).
  List<String> _moneyFields = const [];
  List<String> _moneyEditable = const [];
  List<String> _moneyByRequest = const [];
  bool _canEditMoney = true;
  // Customer of a saved shipment: fixed for the team, editable by management and the operations manager.
  bool _customerLockedRole = false;
  bool get _customerLocked => _editing && _customerLockedRole;
  bool _moneyLocked(String k) => _editing && !_canEditMoney && _moneyFields.contains(k) && !_moneyEditable.contains(k) && !_moneyByRequest.contains(k);
  bool _moneyNeedsApproval(String k) => _editing && _moneyByRequest.contains(k);
  Future<void> _loadMoneyEditors() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/money-editors');
      if (!mounted || d is! Map) return;
      setState(() {
        _moneyFields = [for (final x in (d['fields'] as List? ?? const [])) '$x'];
        _canEditMoney = d['canEdit'] == true;
        _customerLockedRole = d['customerLocked'] == true;
        _moneyEditable = [for (final x in (d['editable'] as List? ?? const [])) '$x'];
        _moneyByRequest = [for (final x in (d['byRequest'] as List? ?? const [])) '$x'];
      });
    } catch (_) {}
  }

  // An option a colleague adds appears here without reopening (`shipmentOrders:fields`).
  late final void Function() _onFields = _reloadFields;
  // An edit on the customers or suppliers page reaches the open form at once.
  late final void Function() _onRegisters = _reloadRegisters;
  // Drivers of the selected truck; if none is registered for it, its supplier's drivers.
  List<Map<String, dynamic>> _drivers = [];
  bool _savingCustomer = false;

  @override
  void initState() {
    super.initState();
    _load().then((_) {
      _loadDrivers();
      // Editing: show what the waybill will print.
      final v = widget.order?['vehicle'];
      if (v is Map && mounted) {
        setState(() { _form['vehicleBrand'] = soRealVal(v['brand']); _form['vehicleColor'] = soRealVal(v['color']); });
      }
      // The order's own driver details are what its waybill prints; the register fills them only when the order has none.
      final o = widget.order;
      if (o != null && ('${o['driverNationality'] ?? ''}'.isNotEmpty || '${o['driverIqama'] ?? ''}'.isNotEmpty)) {
        if (mounted) setState(() { _form['driverNationality'] = '${o['driverNationality'] ?? ''}'; _form['driverIqama'] = '${o['driverIqama'] ?? ''}'; });
      } else {
        _fillDriverDetails();
      }
    });
    _loadMoneyEditors();
    Live.instance.on('shipmentOrders:fields', _onFields);
    for (final e in const ['shipmentOrders:customers', 'customers:changed', 'shipmentOrders:fleet']) {
      Live.instance.on(e, _onRegisters);
    }
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:fields', _onFields);
    for (final e in const ['shipmentOrders:customers', 'customers:changed', 'shipmentOrders:fleet']) {
      Live.instance.off(e, _onRegisters);
    }
    super.dispose();
  }

  Future<void> _reloadRegisters() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/shipment-orders/customers?picker=1'),
        Api.instance.get('/api/shipment-orders/suppliers?limit=60&fresh=1'),
      ]);
      if (!mounted) return;
      setState(() {
        _customers = List<Map<String, dynamic>>.from(r[0]['customers'] ?? []);
        _suppliers = List<Map<String, dynamic>>.from(r[1]['suppliers'] ?? []);
      });
    } catch (_) {}
  }

  Future<void> _reloadFields() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/fields');
      if (mounted) setState(() => _fields = List<Map<String, dynamic>>.from(d['fields'] ?? []));
    } catch (_) {}
  }

  /// As on the web: the truck's drivers first; if it has none, the supplier's drivers.
  Future<void> _chooseDriver({bool startWithNew = false}) async {
    final d = await pickShipmentDriver(context,
        local: _drivers, supplierId: _supplier?['_id']?.toString(), vehicleId: _vehicle?['_id']?.toString(), startWithNew: startWithNew);
    if (d == null || !mounted) return;
    setState(() {
      if (!_drivers.any((x) => x['_id'] == d['_id'])) _drivers = [d, ..._drivers];
      _form['driverName'] = d['name'];
      _ctrls.remove('driverName');
      if (soRealVal(d['phone']).isNotEmpty) { _form['driverPhone'] = soRealVal(d['phone']); _ctrls.remove('driverPhone'); }
    });
    _fillDriverDetails();
  }

  /// Fills what the waybill prints from the chosen driver's record.
  Future<void> _fillDriverDetails() async {
    final name = (_form['driverName'] ?? '').toString().trim();
    if (name.isEmpty) return;
    try {
      final r = await Api.instance.get('/api/shipment-orders/drivers?q=${Uri.encodeQueryComponent(name)}&limit=10');
      final hit = List<Map<String, dynamic>>.from(r['drivers'] ?? []).where((x) => '${x['name'] ?? ''}'.trim() == name).firstOrNull;
      if (hit == null || !mounted) return;
      setState(() {
        _form['driverNationality'] = soRealVal(hit['nationality']);
        _form['driverIqama'] = soRealVal(hit['residenceNumber']);
        _ctrls.remove('driverNationality');
        _ctrls.remove('driverIqama');
      });
    } catch (_) { /* the boxes stay as typed */ }
  }

  Future<void> _loadDrivers() async {
    final vId = _vehicle?['_id'];
    final sId = _supplier?['_id'];
    if (vId == null && sId == null) { if (mounted) setState(() => _drivers = []); return; }
    try {
      final d = await Api.instance.get('/api/shipment-orders/drivers?${vId != null ? 'vehicle=$vId' : 'supplier=$sId'}&limit=200');
      var rows = List<Map<String, dynamic>>.from(d['drivers'] ?? []);
      if (rows.isEmpty && sId != null && vId != null) {
        final alt = await Api.instance.get('/api/shipment-orders/drivers?supplier=$sId&limit=200');
        rows = List<Map<String, dynamic>>.from(alt['drivers'] ?? []);
      }
      if (mounted) setState(() => _drivers = rows);
    } catch (_) {
      if (mounted) setState(() => _drivers = []);
    }
  }

  /// A new customer is registered when the name is typed, not when the shipment is saved, so collections, the customers page and colleagues see it at once.
  Future<void> _saveCustomer() async {
    final name = _ncName.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب اسم العميل.', 'Name the customer.'))));
      return;
    }
    setState(() => _savingCustomer = true);
    try {
      final d = await Api.instance.post('/api/shipment-orders/customers', {'name': name, 'phone': saPhone(_ncPhone.text)});
      final c = Map<String, dynamic>.from(d['customer'] ?? {});
      if (!mounted) return;
      setState(() {
        _customers = [..._customers, c]..sort((a, b) => '${a['name'] ?? ''}'.compareTo('${b['name'] ?? ''}'));
        _savingCustomer = false;
        _ncName.clear();
        _ncPhone.clear();
      });
      _applyCustomer(c);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('سُجِّل العميل «${c['name']}»', 'Customer “${c['name']}” registered'))));
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingCustomer = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  /// A new option in a list: saved in the field definition (section settings) and selected immediately.
  /// A searchable sheet over a field's options; returns the chosen key.
  Future<String?> _searchOption(String label, List<Map<String, dynamic>> options, String current) async {
    final ctl = TextEditingController();
    String fold(String v) => v.toLowerCase().replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي');
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) {
        final q = fold(ctl.text.trim());
        final list = options.where((o) => q.isEmpty || fold('${o['ar'] ?? ''} ${o['en'] ?? ''} ${o['key'] ?? ''}').contains(q)).toList();
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.8,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
                child: TextField(controller: ctl, autofocus: true, onChanged: (_) => setSt(() {}),
                    decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('ابحث في $label…', 'Search $label…'), isDense: true, border: const OutlineInputBorder())),
              ),
              Expanded(child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final o = list[i];
                  final key = '${o['key'] ?? ''}';
                  return ListTile(
                    dense: true,
                    selected: key == current,
                    title: Text(tr('${o['ar'] ?? key}', '${o['en'] ?? o['ar'] ?? key}')),
                    onTap: () => Navigator.pop(c, key),
                  );
                },
              )),
            ]),
          ),
        );
      }),
    );
    ctl.dispose();
    return picked;
  }

  Future<void> _addOption(Map<String, dynamic> f, String label) async {
    final c = TextEditingController();
    final v = await showDialog<String>(context: context, builder: (dc) => AlertDialog(
      title: Text(tr('إضافة $label', 'Add $label')),
      content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: tr('$label الجديد…', 'New $label…'))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dc), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dc, c.text.trim()), child: Text(tr('إضافة', 'Add'))),
      ],
    ));
    if (v == null || v.isEmpty) return;
    try {
      final d = await Api.instance.post('/api/shipment-orders/fields/${f['_id']}/options', {'ar': v});
      final nf = Map<String, dynamic>.from(d['field'] ?? {});
      if (!mounted) return;
      final opts = List<Map<String, dynamic>>.from(nf['options'] ?? []);
      final hit = opts.firstWhere((o) => o['ar'] == v || o['key'] == v, orElse: () => const {});
      setState(() {
        _fields = _fields.map((x) => x['_id'] == f['_id'] ? nf : x).toList();
        _form['${f['key']}'] = hit.isEmpty ? v : '${hit['key']}';
        if (f['key'] == 'fromCity' || f['key'] == 'toCity') _applyRoutePrice();
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّرت الإضافة', 'Could not add'))));
    }
  }

  TextEditingController _ctrl(String key) =>
      _ctrls.putIfAbsent(key, () => TextEditingController(text: (_form[key] ?? '').toString()));

  /// Saudi mobile controller: displayed locally ("5XXXXXXXX") and stored in full.
  TextEditingController _phoneCtrl(String key) =>
      _ctrls.putIfAbsent(key, () => TextEditingController(text: saLocal((_form[key] ?? '').toString())));

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/shipment-orders/fields'),
        Api.instance.get('/api/shipment-orders/customers?picker=1').catchError((_) => <String, dynamic>{}),
        // The two lists are not both loaded. The registry holds 13 thousand trucks and 3 thousand suppliers; everything used to be requested, hit the server cap (1000), and was searched among what arrived, so someone who picked a supplier whose trucks were not in the thousand saw an empty list. Search now happens on the server, and a supplier's trucks are requested by its id.
        Api.instance.get('/api/shipment-orders/vehicles?limit=80&ownership=supplier').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/shipment-orders/suppliers?limit=60&fresh=1').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _fields = List<Map<String, dynamic>>.from(results[0]['fields'] ?? []);
        _customers = List<Map<String, dynamic>>.from(results[1]['customers'] ?? []);
        _vehicles = List<Map<String, dynamic>>.from(results[2]['vehicles'] ?? []);
        _suppliers = List<Map<String, dynamic>>.from(results[3]['suppliers'] ?? []);
        // Pickup and start default to today until changed. A shipment is recorded when it is booked, so its day is today almost every time.
        if (!_editing) {
          final t = DateTime.now();
          final iso = '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
          _form['pickupTime'] = iso;
          _form['startTime'] = iso;
        }
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
          // The truck and supplier arrive named from `getOrder`, so seed them into the two lists; otherwise two empty fields would show while both are selected.
          if (o['vehicle'] is Map) {
            _vehicle = Map<String, dynamic>.from(o['vehicle']);
            if (!_vehicles.any((x) => x['_id'] == _vehicle!['_id'])) _vehicles = [_vehicle!, ..._vehicles];
          }
          if (o['supplier'] is Map) {
            _supplier = Map<String, dynamic>.from(o['supplier']);
            if (!_suppliers.any((x) => x['_id'] == _supplier!['_id'])) _suppliers = [_supplier!, ..._suppliers];
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

  // Choosing the customer pulls the defaults and the agreed route price immediately.
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
      // A price already typed stays; the route only fills an empty box.
      final typed = (_ctrls['sellPrice']?.text ?? '${_form['sellPrice'] ?? ''}').trim();
      if (typed.isEmpty && r['fromCity'] == from && r['toCity'] == to && r['price'] != null) {
        _form['sellPrice'] = r['price'];
        _ctrls.remove('sellPrice');
      }
    }
  }

  void _applyVehicle(Map<String, dynamic> v) {
    setState(() {
      _vehicle = v;
      _newVehicle = false;
      // Choosing a truck names its owner but does not replace the chosen supplier. The supplier is filled from the owner only if none is chosen yet. A supplier chosen first is a deal decision, and it used to be silently replaced by the truck owner, saving the shipment on a supplier nobody agreed with.
      final sup = v['supplier'];
      if (sup is Map && _supplier == null) {
        // The supplier arrives with the truck named (`populate`), so it is not searched in a page it may not be in; it used to be searched there and stayed empty though the supplier was known.
        _supplier = Map<String, dynamic>.from(sup);
        if (!_suppliers.any((x) => x['_id'] == _supplier!['_id'])) _suppliers = [_supplier!, ..._suppliers];
      } else if (sup != null && _supplier == null) {
        for (final sp in _suppliers) {
          if (sp['_id'] == sup) _supplier = sp;
        }
      }
      if (soRealVal(v['defaultDriverName']).isNotEmpty) {
        _form['driverName'] = soRealVal(v['defaultDriverName']);
        _ctrls.remove('driverName');
      }
      if (soRealVal(v['defaultDriverPhone']).isNotEmpty) {
        _form['driverPhone'] = soRealVal(v['defaultDriverPhone']);
        _ctrls.remove('driverPhone');
      }
      if ((v['truckType'] ?? '').toString().isNotEmpty && (_form['truckType'] ?? '').toString().isEmpty) {
        _form['truckType'] = v['truckType'];
        _ctrls.remove('truckType');
      }
      _form['vehicleBrand'] = soRealVal(v['brand']);
      _form['vehicleColor'] = soRealVal(v['color']);
      _ctrls.remove('vehicleBrand');
      _ctrls.remove('vehicleColor');
    });
    _fillDriverDetails();
  }

  /// A list that is not fully loaded: search is sent to the server.
  /// `_pickSheet` searches a list in hand, which is right for a hundred customers. Thirteen thousand trucks and three thousand suppliers are not loaded, so searching them is searching the arrived page, which says "no results" about a registered row. This asks the server after typing pauses and shows its reply as is.
  /// `seq` prevents reply races: a late reply for a short prefix does not wipe the results for the full name.
  Future<Map<String, dynamic>?> _pickRemote(
    String title,
    Future<List<Map<String, dynamic>>> Function(String q) fetch,
    String Function(Map<String, dynamic>) label, {
    String Function(Map<String, dynamic>)? sub,
    String? hint,
    List<Map<String, dynamic>> initial = const [],
  }) {
    // State kept outside the builder: rebuilding the dialog does not reset it while the field still has text.
    var rows = List<Map<String, dynamic>>.from(initial);
    var busy = false;
    var seq = 0;
    var typed = '';
    Timer? debounce;
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        return StatefulBuilder(builder: (c, setS) {
          Future<void> run(String q) async {
            final mine = ++seq;
            if (!c.mounted) return;
            setS(() => busy = true);
            try {
              final r = await fetch(q);
              if (mine != seq || !c.mounted) return;
              setS(() { rows = r; busy = false; });
            } catch (_) {
              if (mine == seq && c.mounted) setS(() => busy = false);
            }
          }
          if (rows.isEmpty && !busy && seq == 0) run('');
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.72,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: SearchField(
                      autofocus: true,
                      hint: hint ?? '${tr('ابحث في', 'Search')} $title…',
                      onChanged: (v) {
                        typed = v.trim();
                        debounce?.cancel();
                        debounce = Timer(const Duration(milliseconds: 350), () => run(typed));
                      },
                    ),
                  ),
                  if (busy) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: rows.isEmpty
                        ? Center(child: Text(busy ? '…' : tr('لا نتائج', 'No matches'), style: const TextStyle(fontSize: 13)))
                        : ListView.builder(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            itemCount: rows.length,
                            itemBuilder: (c, i) => ListTile(
                              title: Text(label(rows[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                              subtitle: sub == null ? null : Text(sub(rows[i]), style: const TextStyle(fontSize: 12)),
                              onTap: () => Navigator.pop(c, rows[i]),
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

  /// Add another truck to the same load: its supplier, truck and driver.
  /// The two questions are in the same order as the card above (supplier, then its truck); the driver is filled from the registered truck and stays correctable.
  Future<void> _addExtraTruck() async {
    final sup = await _pickRemote(
      tr('الموردين', 'suppliers'),
      (q) async {
        final d = await Api.instance.get('/api/shipment-orders/suppliers?limit=60&fresh=1${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(d['suppliers'] ?? []);
      },
      (x) => (x['name'] ?? '').toString(),
      hint: tr('الاسم أو الجوّال…', 'Name or phone…'),
    );
    if (sup == null || !mounted) return;
    final veh = await _pickRemote(
      tr('شاحنات المورّد', 'his trucks'),
      (q) async {
        final d = await Api.instance.get(
            '/api/shipment-orders/vehicles?limit=80${q.isEmpty ? '&supplier=${sup['_id']}' : ''}${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
        return List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
      },
      (v) => (v['plate'] ?? '').toString(),
      // Its owner and driver, as read in the truck-owner card.
      sub: (v) {
        final sup = v['supplier'];
        final owner = sup is Map ? (sup['name'] ?? '').toString() : '';
        return [v['name'], owner, v['defaultDriverName']].where((e) => (e ?? '').toString().isNotEmpty).join(' · ');
      },
      hint: tr('اللوحة أو السائق…', 'Plate or driver…'),
    );
    if (!mounted) return;
    var dName = soRealVal(veh?['defaultDriverName']);
    var dPhone = soRealVal(veh?['defaultDriverPhone']);
    // The driver works like the first truck's. A truck with no registered driver opens the same driver field: search by name, phone and residence number, and "new driver". Closing without a choice adds it with no driver.
    if (dName.isEmpty) {
      final d = await pickShipmentDriver(context, local: const [], supplierId: sup['_id']?.toString(), vehicleId: veh?['_id']?.toString());
      if (!mounted) return;
      if (d != null) { dName = '${d['name'] ?? ''}'; dPhone = soRealVal(d['phone']); }
    }
    setState(() => _extraTrucks.add({
          'supplier': sup,
          'vehicle': veh,
          'newPlate': '',
          'driverName': dName,
          'driverPhone': dPhone,
        }));
  }

  /// A B/L and a container belong to one truck, so each extra truck has its own.
  Future<void> _extraDocs(int i) async {
    final t = _extraTrucks[i];
    final bl = TextEditingController(text: '${t['blNumber'] ?? ''}');
    final cn = TextEditingController(text: '${t['containerNumber'] ?? ''}');
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('رقم البوليصة والحاوية', 'B/L and container')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: bl, decoration: InputDecoration(labelText: tr('رقم البوليصة (اختياري)', 'B/L number (optional)'))),
        TextField(controller: cn, decoration: InputDecoration(labelText: tr('رقم الحاوية (اختياري)', 'Container number (optional)'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    if (ok == true && mounted) setState(() { t['blNumber'] = bl.text.trim(); t['containerNumber'] = cn.text.trim(); });
  }

  /// Change the driver of an additional truck, using the same field.
  Future<void> _changeExtraDriver(int i) async {
    final t = _extraTrucks[i];
    final d = await pickShipmentDriver(context, local: const [],
        supplierId: (t['supplier'] as Map?)?['_id']?.toString(), vehicleId: (t['vehicle'] as Map?)?['_id']?.toString());
    if (d == null || !mounted) return;
    setState(() { t['driverName'] = '${d['name'] ?? ''}'; t['driverPhone'] = soRealVal(d['phone']); });
  }

  Future<P?> _pickSheet<P>(String title, List<P> items, String Function(P) label, {String Function(P)? sub}) {
    String q = ''; // Outside the builder so it is not reset while the field has text
    return showModalBottomSheet<P>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
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
                    child: SearchField(
                      autofocus: true,
                      onChanged: (v) => setS(() => q = v),
                      hint: '${tr('ابحث في', 'Search')} $title…',
                    ),
                  ),
                  Expanded(
                    child: list.isEmpty && q.trim().isNotEmpty
                        ? Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(fontSize: 13)))
                        : ListView.builder(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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

  /// A new supplier is registered immediately, not when the shipment is saved.
  /// Whoever added it and then left the form must find it on the suppliers page, and so must a colleague.
  Future<void> _addSupplier() async {
    final nameC = TextEditingController();
    final phoneC = TextEditingController();
    // Its driver is registered with it; a freelancer with no driver name is himself the driver.
    final dNameC = TextEditingController();
    final dPhoneC = TextEditingController();
    final dIqamaC = TextEditingController();
    var type = 'company';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text(tr('مورّد جديد', 'New supplier')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: nameC, autofocus: true, decoration: InputDecoration(labelText: tr('الاسم *', 'Name *'))),
          const SizedBox(height: 8),
          PhoneSA(controller: phoneC, label: tr('الجوال', 'Phone')),
          const SizedBox(height: 10),
          Row(children: [
            for (final t in const [('company', 'شركة', 'Company'), ('freelancer', 'فريلانسر', 'Freelancer')])
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: ChoiceChip(
                  selected: type == t.$1,
                  onSelected: (_) => setS(() => type = t.$1),
                  label: Text(tr(t.$2, t.$3)),
                ),
              ),
          ]),
          const Divider(height: 20),
          Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('سائقُه (اختياري)', 'Its driver (optional)'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
          TextField(controller: dNameC, decoration: InputDecoration(labelText: tr('اسم السائق', 'Driver name'))),
          const SizedBox(height: 6),
          PhoneSA(controller: dPhoneC, label: tr('جوال السائق', 'Driver phone')),
          const SizedBox(height: 6),
          TextField(controller: dIqamaC, decoration: InputDecoration(labelText: tr('رقم الإقامة', 'Residence number'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      )),
    );
    if (ok != true || nameC.text.trim().isEmpty) return;
    setState(() => _savingSupplier = true);
    try {
      final d = await Api.instance.post('/api/shipment-orders/suppliers', {
        'name': nameC.text.trim(), 'phone': saPhone(phoneC.text), 'type': type,
      });
      final sup = Map<String, dynamic>.from(d['supplier'] ?? {});
      if (!mounted) return;
      setState(() {
        _suppliers = [..._suppliers, sup];
        _supplier = sup;
        _vehicle = null;
        _savingSupplier = false;
      });
      final drvName = dNameC.text.trim().isNotEmpty ? dNameC.text.trim() : (type == 'freelancer' ? nameC.text.trim() : '');
      Map<String, dynamic>? savedDriver;
      if (drvName.isNotEmpty) {
        try {
          final dd = await Api.instance.post('/api/shipment-orders/drivers', {
            'name': drvName,
            'phone': dPhoneC.text.trim().isNotEmpty ? saPhone(dPhoneC.text) : (type == 'freelancer' ? saPhone(phoneC.text) : ''),
            'residenceNumber': dIqamaC.text.trim(),
            'supplier': sup['_id'],
          });
          savedDriver = Map<String, dynamic>.from(dd['driver'] ?? {});
          if (!mounted) return;
          setState(() {
            _drivers = [savedDriver!, ..._drivers];
            _form['driverName'] = savedDriver['name'];
            _ctrls.remove('driverName');
            if ('${savedDriver['phone'] ?? ''}'.isNotEmpty) { _form['driverPhone'] = savedDriver['phone']; _ctrls.remove('driverPhone'); }
          });
        } catch (e) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('سُجِّل المورّد ولم يُسجَّل السائق', 'Supplier saved, driver did not'))));
        }
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr(
          'سُجِّل المورد «${sup['name']}»${savedDriver != null ? ' وسائقُه «${savedDriver['name']}»' : ''} — تجدهما في صفحة المورّدين',
          'Supplier “${sup['name']}”${savedDriver != null ? ' and driver “${savedDriver['name']}”' : ''} registered'))));
      }
      _loadDrivers();
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingSupplier = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
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
    // Fixed boxes on the form, not configured fields, so the loop above misses them.
    for (final k in ['blNumber', 'containerNumber']) {
      payload[k] = (_form[k] ?? '').toString().trim();
    }
    final details = {for (final k in ['driverNationality', 'driverIqama', 'vehicleBrand', 'vehicleColor']) k: (_form[k] ?? '').toString().trim()};
    payload['waybillDetails'] = details;
    if (_customer != null) payload['customer'] = _customer!['_id'];
    if (_salesRep != null) payload['salesRep'] = _salesRep!['value'];
    if (_newCustomer && _ncName.text.trim().isNotEmpty) {
      payload['newCustomer'] = {'name': _ncName.text.trim(), 'phone': saPhone(_ncPhone.text)};
    }
    // The chosen supplier is sent even if the truck is registered: thousands of trucks have an unknown owner, and whoever books the load knows it, so the server writes it to the registry once.
    if (_supplier != null) payload['supplierChoice'] = _supplier!['_id'];
    if (_vehicle != null) payload['vehicle'] = _vehicle!['_id'];
    if (_newVehicle && _nvPlate.text.trim().isNotEmpty) {
      payload['newVehicle'] = {
        'plate': _nvPlate.text.trim(),
        'name': _nvName.text.trim(),
        'supplierId': _supplier?['_id'],
      };
    }
    // Manual driver values are kept if they did not come from a registered truck.
    for (final k in ['driverName', 'driverPhone']) {
      if ((_form[k] ?? '').toString().isNotEmpty) payload[k] = _form[k];
    }
    try {
      if (_editing) {
        final out = await Api.instance.put('/api/shipment-orders/orders/${widget.order!['_id']}', payload);
        // Held for approval: the old price stays until an approver applies it.
        if (out is Map && out['sellingRequestMessage'] != null && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${out['sellingRequestMessage']}')));
      } else if (_extraTrucks.isNotEmpty) {
        // The first row is a truck like the rest and is sent with them in the same list. If it were created alone and the rest sent after, the first would be saved and the second rejected, and the employee would not know where it stopped.
        final body = Map<String, dynamic>.from(payload)
          ..remove('waybillDetails')
          ..remove('vehicle')
          ..remove('newVehicle')
          ..remove('supplierChoice');
        body['trucks'] = [
          {
            if (_vehicle != null) 'vehicle': _vehicle!['_id'],
            if (_newVehicle && _nvPlate.text.trim().isNotEmpty)
              'newVehicle': {'plate': _nvPlate.text.trim(), 'name': _nvName.text.trim(), 'supplierId': _supplier?['_id']},
            if (_supplier != null) 'supplierChoice': _supplier!['_id'],
            if ((_form['driverName'] ?? '').toString().isNotEmpty) 'driverName': _form['driverName'],
            if ((_form['driverPhone'] ?? '').toString().isNotEmpty) 'driverPhone': _form['driverPhone'],
            'blNumber': (_form['blNumber'] ?? '').toString().trim(),
            'containerNumber': (_form['containerNumber'] ?? '').toString().trim(),
            'waybillDetails': details,
          },
          ..._extraTrucks.map((t) => {
                if (t['vehicle'] != null) 'vehicle': (t['vehicle'] as Map)['_id'],
                if ((t['newPlate'] ?? '').toString().isNotEmpty)
                  'newVehicle': {'plate': t['newPlate'], 'name': '', 'supplierId': (t['supplier'] as Map?)?['_id']},
                if (t['supplier'] != null) 'supplierChoice': (t['supplier'] as Map)['_id'],
                if ((t['driverName'] ?? '').toString().isNotEmpty) 'driverName': t['driverName'],
                if ((t['driverPhone'] ?? '').toString().isNotEmpty) 'driverPhone': t['driverPhone'],
                'blNumber': (t['blNumber'] ?? '').toString().trim(),
                'containerNumber': (t['containerNumber'] ?? '').toString().trim(),
              }),
        ];
        final d = await Api.instance.post('/api/shipment-orders/orders/batch', body);
        final nums = (d['waybills'] as List? ?? const []).join('، ');
        final failedN = (d['failed'] as List? ?? const []).length;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(tr('أُنشئت ${d['created']} شحنة — أوامر نقل $nums${failedN > 0 ? ' · تعذّرت $failedN' : ''}',
                '${d['created']} created — waybills $nums${failedN > 0 ? ' · $failedN failed' : ''}')),
          ));
        }
        if (failedN > 0) { if (mounted) setState(() => _saving = false); return; }
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
      helperText: _moneyNeedsApproval(k) ? tr('التعديل يُرسَل للاعتماد', 'A change needs approval') : null,
      labelStyle: miss ? const TextStyle(color: T.danger, fontWeight: FontWeight.w700) : null,
      enabledBorder: miss ? OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: T.danger)) : null,
    );
    final type = (f['inputType'] ?? 'text').toString();

    if (_moneyLocked(k)) {
      final v = _form[k];
      final n = v == null || '$v'.isEmpty ? null : num.tryParse('$v');
      return InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.lock_outline, size: 18), helperText: tr('التعديل لمدير النظام والإدارة ومدير التشغيل فقط', 'Only admins and the operations manager can change it')),
        child: Text(n == null ? '—' : (n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(2)),
            style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink)),
      );
    }

    // Payment method is read, not chosen. It follows the driver rental type: return means deferred, forward means cash. The rule lives on the option itself in the section settings (`option.paymentMethod`).
    if (k == 'paymentMethod') {
      final options = List<Map<String, dynamic>>.from(f['options'] ?? []);
      final cur = (_form[k] ?? '').toString();
      final opt = options.firstWhere((o) => o['key'] == cur, orElse: () => const {});
      return InputDecorator(
        decoration: deco,
        child: Text(
          opt.isEmpty ? tr('تُحدَّد من نوع تأجير السائق', 'Set by the rental type')
              : tr('${opt['ar'] ?? opt['key']}', '${opt['en'] ?? opt['ar'] ?? opt['key']}'),
          style: TextStyle(fontWeight: opt.isEmpty ? FontWeight.w400 : FontWeight.w700,
              color: opt.isEmpty ? T.inkFaint : T.ink),
        ),
      );
    }

    if (type == 'select' || type == 'cards') {
      final options = List<Map<String, dynamic>>.from(f['options'] ?? []);
      final current = (_form[k] ?? '').toString();
      // What is not in the list is added in place (as on the web), written to the settings themselves.
      // Long lists (e.g. the From / To cities) open a searchable sheet instead of a dropdown.
      if (options.length > 15) {
        final cur = options.firstWhere((o) => o['key'] == current, orElse: () => const {});
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          InkWell(
            onTap: () async {
              final v = await _searchOption(label, options, current);
              if (v == null) return;
              setState(() {
                _form[k] = v;
                if (k == 'fromCity' || k == 'toCity') _applyRoutePrice();
              });
            },
            child: InputDecorator(
              decoration: deco.copyWith(suffixIcon: const Icon(Icons.search)),
              child: Text(cur.isEmpty ? (current.isEmpty ? tr('اختر', 'Choose') : current) : tr('${cur['ar'] ?? cur['key']}', '${cur['en'] ?? cur['ar'] ?? cur['key']}'),
                  overflow: TextOverflow.ellipsis, style: TextStyle(color: current.isEmpty ? T.inkFaint : T.ink)),
            ),
          ),
        ]);
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [DropdownButtonFormField<String>(
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
          // The rental type writes the payment method with it.
          if (k == 'driverRentType') {
            final opt = options.firstWhere((o) => o['key'] == v, orElse: () => const {});
            final pay = (opt['paymentMethod'] ?? '').toString();
            if (pay.isNotEmpty) _form['paymentMethod'] = pay;
          }
        }),
      ),
        // Branch is the company's branches; nothing is added to them from here (`locked`).
        if (f['locked'] != true) Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: const EdgeInsets.symmetric(horizontal: 4)),
            onPressed: () => _addOption(f, label),
            child: Text('+ ${tr('إضافة $label', 'Add $label')}', style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w700)),
          ),
        ),
      ]);
    }

    // A day, not a moment. Shipment dates are written by day: nobody knows the pickup was at 7:42, and anyone asked for an hour wrote one to move on.
    if (type == 'date') {
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
          setState(() => _form[k] = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
        },
        icon: Icon(Icons.event, size: 17, color: miss ? T.danger : T.navy),
        label: Text(
          dt == null ? (f['required'] == true ? '$label *' : label) : '$label: ${dt.day}/${dt.month}/${dt.year}',
          style: TextStyle(fontSize: 13, color: miss ? T.danger : T.ink),
        ),
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
                  // Customer
                  FadeSlideIn(
                    child: AppCard(
                      topAccent: _missing.contains('customer') ? T.danger : T.navy,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.person_outline, size: 18, color: T.navy),
                          const SizedBox(width: 6),
                          Text(tr('العميل والمورّد', 'Customer & supplier'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          if (!_customerLocked) TextButton(
                            onPressed: () => setState(() { _newCustomer = !_newCustomer; if (_newCustomer) _customer = null; }),
                            child: Text(_newCustomer ? tr('اختيار من القائمة', 'Pick existing') : tr('+ عميل جديد', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 44)),
                          onPressed: () async {
                            if (_salesReps.isEmpty) {
                              try { final d = await Api.instance.get('/api/shipment-orders/sales-reps'); _salesReps = List<Map<String, dynamic>>.from(d['options'] ?? []); } catch (_) {}
                            }
                            if (!mounted) return;
                            final u = await _pickSheet<Map<String, dynamic>>(tr('السيلز التشغيلي', 'operational sales'), _salesReps, (u) => (u['label'] ?? '').toString(), sub: (u) => (u['roleAr'] ?? '').toString());
                            if (u != null) setState(() => _salesRep = u);
                          },
                          icon: const Icon(Icons.badge_outlined, size: 17),
                          label: Text(_salesRep == null ? tr('السيلز التشغيلي — مَن جاء بالحمولة…', 'Operational sales — who brought the load…') : (_salesRep!['label'] ?? '').toString(),
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                        ),
                        const SizedBox(height: 8),
                        if (_customerLocked)
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                            decoration: BoxDecoration(color: T.line.withValues(alpha: 0.35), borderRadius: BorderRadius.circular(10)),
                            child: Row(children: [
                              Expanded(child: Text((_customer?['name'] ?? '—').toString(), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700))),
                              const Icon(Icons.lock_outline, size: 15, color: T.inkFaint),
                              const SizedBox(width: 4),
                              Text(tr('مقفول', 'locked'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            ]),
                          )
                        else if (!_newCustomer)
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
                          PhoneSA(controller: _ncPhone, label: tr('الهاتف', 'Phone')),
                          const SizedBox(height: 6),
                          Align(
                            alignment: AlignmentDirectional.centerEnd,
                            child: FilledButton.icon(
                              onPressed: _savingCustomer ? null : _saveCustomer,
                              icon: _savingCustomer ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.person_add_alt, size: 17),
                              label: Text(tr('تسجيل العميل', 'Register customer')),
                            ),
                          ),
                        ],
                        const Divider(height: 18),
                        // Supplier below it, as on the web. The two parties of the deal are in one card: who it is hauled for and who it is hauled from. The supplier used to sit in the truck card, so it read as a description of the truck rather than a party to the contract.
                        Row(children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                              onPressed: () async {
                                final sp = await _pickRemote(
                                  tr('الموردين', 'suppliers'),
                                  (q) async {
                                    final d = await Api.instance.get(
                                        '/api/shipment-orders/suppliers?limit=60&fresh=1${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}');
                                    return List<Map<String, dynamic>>.from(d['suppliers'] ?? []);
                                  },
                                  (x) => (x['name'] ?? '').toString(),
                                  sub: (x) => [x['phone'], x['type'] == 'freelancer' ? tr('فريلانسر', 'Freelancer') : tr('شركة', 'Company')]
                                      .where((e) => (e ?? '').toString().isNotEmpty).join(' · '),
                                  hint: tr('الاسم أو الجوّال أو السجل…', 'Name, phone or CR…'),
                                  initial: _suppliers,
                                );
                                if (sp != null) { setState(() { _supplier = sp; _vehicle = null; }); _loadDrivers(); }
                              },
                              icon: const Icon(Icons.storefront_outlined, size: 17),
                              label: Text(_supplier == null ? tr('اختر المورّد…', 'Choose supplier…') : (_supplier!['name'] ?? '').toString(),
                                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                            ),
                          ),
                          IconButton(
                            tooltip: tr('مورّد جديد', 'New supplier'),
                            onPressed: _savingSupplier ? null : _addSupplier,
                            icon: _savingSupplier
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.add_circle_outline, color: T.orange),
                          ),
                        ]),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Truck
                  FadeSlideIn(
                    delayMs: 40,
                    child: AppCard(
                      topAccent: T.orange,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.local_shipping_outlined, size: 18, color: T.orange),
                          const SizedBox(width: 6),
                          Text(tr('مالك السيارة', 'Truck owner'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const Spacer(),
                          TextButton(
                            onPressed: () => setState(() { _newVehicle = !_newVehicle; if (_newVehicle) _vehicle = null; }),
                            child: Text(_newVehicle ? tr('اختيار من السجل', 'Pick existing') : tr('+ شاحنة جديدة', '+ New'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        if (!_newVehicle)
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 46)),
                            onPressed: () async {
                              // The chosen supplier's trucks, or every truck including our own fleet.
                              final sid = _supplier?['_id'];
                              final v = await _pickRemote(
                                tr('الشاحنات', 'vehicles'),
                                (q) async {
                                  final qs = StringBuffer('limit=80');
                                  if (sid != null && q.isEmpty) qs.write('&supplier=$sid');
                                  if (q.isNotEmpty) qs.write('&q=${Uri.encodeQueryComponent(q)}');
                                  final d = await Api.instance.get('/api/shipment-orders/vehicles?$qs');
                                  return List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
                                },
                                (v) => (v['plate'] ?? '').toString(),
                                sub: (v) {
                                  final sup = v['supplier'];
                                  final owner = sup is Map
                                      ? (sup['name'] ?? '').toString()
                                      : (v['ownership'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('مالكٌ غير مسجَّل', 'Owner not recorded'));
                                  return [v['name'], owner, v['defaultDriverName']]
                                      .where((e) => (e ?? '').toString().isNotEmpty).join(' · ');
                                },
                                hint: tr('اللوحة أو السائق أو بطاقة التشغيل…', 'Plate, driver or operation card…'),
                              );
                              if (v != null) { _applyVehicle(v); _loadDrivers(); }
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
                        // Its owner is read, not written. The truck owner in the registry is a fact about the truck, while the supplier agreed with is a deal decision, and they may differ (a supplier hauling on another's truck), so say so before saving, not after.
                        if (_vehicle != null) ...[
                          Builder(builder: (_) {
                            final sup = _vehicle!['supplier'];
                            final ownerId = sup is Map ? (sup['_id'] ?? '').toString() : (sup ?? '').toString();
                            final owner = sup is Map
                                ? (sup['name'] ?? '').toString()
                                : (_vehicle!['ownership'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('مالكٌ غير مسجَّل', 'Owner not recorded'));
                            final chosen = (_supplier?['_id'] ?? '').toString();
                            final differs = ownerId.isNotEmpty && chosen.isNotEmpty && ownerId != chosen;
                            return Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: differs ? const Color(0xFFFEF3C7) : const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                differs
                                    ? '${tr('مالك السيارة', 'Owner')}: $owner · ${tr('المتّفقُ معه', 'Agreed with')}: ${(_supplier?['name'] ?? '').toString()}'
                                    : '${tr('مالك السيارة', 'Owner')}: $owner',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: differs ? const Color(0xFF92400E) : T.inkSoft),
                              ),
                            );
                          }),
                          const SizedBox(height: 8),
                        ],
                        // Name on a full line with the mobile below it: they were two halves of one row, and the search and "new driver" icons ate half the name and clipped it.
                        TextField(
                              controller: _ctrl('driverName'),
                              onChanged: (v) => _form['driverName'] = v,
                              decoration: InputDecoration(
                                labelText: tr('اسم السائق', 'Driver name'),
                                // Registered drivers are suggestions, not a restriction: someone not in the registry has his name typed. Search covers all drivers by name, mobile and residence number, and "new driver" registers him (see so_driver_picker).
                                suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                                  IconButton(
                                    icon: const Icon(Icons.person_search, size: 21),
                                    tooltip: tr('بحث بالاسم أو الجوال أو الإقامة', 'Search name, phone or iqama'),
                                    onPressed: () => _chooseDriver(),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.person_add_alt_1, size: 21, color: T.orange),
                                    tooltip: tr('سائق جديد', 'New driver'),
                                    onPressed: () => _chooseDriver(startWithNew: true),
                                  ),
                                ]),
                              ),
                            ),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(
                            // Country code to the left of the digits in every language. One `PhoneSA` for every mobile in the app: the field is `ltr`, so "+966" stays on the left with the digits after it, nine digits at most, and the stored value is always the full number.
                            child: PhoneSA(
                              controller: _phoneCtrl('driverPhone'),
                              label: tr('هاتف السائق', 'Driver phone'),
                              onChanged: (full) => setState(() => _form['driverPhone'] = full),
                            ),
                          ),
                          const SizedBox(width: 4),
                          // Call/WhatsApp directly on the driver's number.
                          ContactButtons(phone: (_form['driverPhone'] ?? _ctrls['driverPhone']?.text ?? '').toString(), compact: true),
                        ]),
                      ]),
                    ),
                  ),
                  // Fields from the settings, group by group
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
                            // Waybill and container, linked to clearance. Optional: written here, the shipment is linked to the clearance transaction carrying them, and when the shipment is written in the transaction they are filled here on their own.
                            if (g.$1 == 'pickup_delivery') ...[
                              TextField(
                                controller: _ctrl('blNumber'),
                                textDirection: TextDirection.ltr,
                                onChanged: (v) => _form['blNumber'] = v.trim(),
                                decoration: InputDecoration(labelText: tr('رقم البوليصة (اختياري)', 'B/L number (optional)')),
                              ),
                              const SizedBox(height: 10),
                              TextField(
                                controller: _ctrl('containerNumber'),
                                textDirection: TextDirection.ltr,
                                onChanged: (v) => _form['containerNumber'] = v.trim(),
                                decoration: InputDecoration(labelText: tr('رقم الحاوية (اختياري)', 'Container number (optional)')),
                              ),
                              for (final d in [('driverNationality', 'جنسية السائق', 'Driver nationality'), ('driverIqama', 'رقم إقامة السائق', 'Driver iqama no.'), ('vehicleBrand', 'ماركة الشاحنة', 'Truck brand'), ('vehicleColor', 'لون الشاحنة', 'Truck colour')]) ...[
                                const SizedBox(height: 10),
                                TextField(
                                  controller: _ctrl(d.$1),
                                  onChanged: (v) => _form[d.$1] = v.trim(),
                                  decoration: InputDecoration(labelText: tr(d.$2, d.$3)),
                                ),
                              ],
                              const SizedBox(height: 6),
                              if (_form['customsLink'] is Map && (_form['customsLink'] as Map)['clearance'] != null)
                                Text(tr('مربوطة بمعاملة التخليص ${(_form['customsLink'] as Map)['refNumber'] ?? ''}',
                                        'Linked to customs clearance ${(_form['customsLink'] as Map)['refNumber'] ?? ''}'),
                                    style: const TextStyle(fontSize: 12.5, color: T.success, fontWeight: FontWeight.w700))

                            ],
                          ]),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 16),
                  // One load on several trucks. A truck is added and seen before saving, and each becomes an independent shipment with its own waybill number: same customer, route, price and date.
                  if (!_editing) ...[
                    if (_extraTrucks.isNotEmpty)
                      AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('الحمولة على ${_extraTrucks.length + 1} شاحنات', 'This load on ${_extraTrucks.length + 1} trucks'),
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text(tr('كلُّ شاحنةٍ شحنةٌ مستقلّةٌ برقم أمر نقل خاصّ — نفسُ بقيّة البيانات',
                                  'each truck becomes its own shipment with its own waybill'),
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          const Divider(height: 18),
                          // The first truck is shown for information; it is edited in its card above.
                          Row(children: [
                            const Text('1 · ', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                            Expanded(child: Text(
                              [(_supplier?['name'] ?? tr('بلا مورّد', 'no supplier')).toString(),
                               (_vehicle?['plate'] ?? (_nvPlate.text.trim().isEmpty ? tr('بلا شاحنة', 'no truck') : _nvPlate.text.trim())).toString()].join(' · '),
                              style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis)),
                          ]),
                          for (var i = 0; i < _extraTrucks.length; i++)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Row(children: [
                                Text('${i + 2} · ', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                                Expanded(child: Text(
                                  [((_extraTrucks[i]['supplier'] as Map?)?['name'] ?? tr('بلا مورّد', 'no supplier')).toString(),
                                   ((_extraTrucks[i]['vehicle'] as Map?)?['plate'] ?? (_extraTrucks[i]['newPlate'] ?? tr('بلا شاحنة', 'no truck'))).toString(),
                                   if ((_extraTrucks[i]['driverName'] ?? '').toString().isNotEmpty) _extraTrucks[i]['driverName'].toString()]
                                      .join(' · '),
                                  style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis)),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  tooltip: tr('السائق', 'Driver'),
                                  icon: Icon((_extraTrucks[i]['driverName'] ?? '').toString().isEmpty ? Icons.person_add_alt_1 : Icons.person_search,
                                      size: 18, color: T.orange),
                                  onPressed: () => _changeExtraDriver(i),
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  tooltip: tr('رقم البوليصة والحاوية', 'B/L and container'),
                                  icon: Icon(Icons.description_outlined, size: 18, color: ('${_extraTrucks[i]['blNumber'] ?? ''}${_extraTrucks[i]['containerNumber'] ?? ''}').isEmpty ? T.inkFaint : T.orange),
                                  onPressed: () => _extraDocs(i),
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: const Icon(Icons.close, size: 16, color: T.inkFaint),
                                  onPressed: () => setState(() => _extraTrucks.removeAt(i)),
                                ),
                              ]),
                            ),
                        ]),
                      ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 46,
                      child: OutlinedButton.icon(
                        onPressed: _saving ? null : _addExtraTruck,
                        icon: const Icon(Icons.local_shipping_outlined, size: 18),
                        label: Text(tr('+ شاحنة أخرى بنفس التفاصيل', '+ Another truck, same details'),
                            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  SizedBox(
                    height: 50,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.check_rounded),
                      label: Text(
                          _editing
                              ? tr('حفظ التعديلات', 'Save changes')
                              : (_extraTrucks.isEmpty
                                  ? tr('إنشاء الطلب', 'Create order')
                                  : tr('إنشاء ${_extraTrucks.length + 1} شحنات', 'Create ${_extraTrucks.length + 1} shipments')),
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                    ),
                  ),
                  const SizedBox(height: 30),
                ]),
    );
  }
}
