import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/customer_prefs.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_orders.dart';
import 'shipment_orders_common.dart';

/// Shipment creation assistant, mirrors /system/shipment-orders/chat on web. The create form as a chat: one question per turn, shaped as configured in the form settings, and finally the same payload goes to the same endpoint (POST /orders). No AI or extra server, just a scripted walk over the slot definitions.
class ShipmentOrdersChatScreen extends StatefulWidget {
  const ShipmentOrdersChatScreen({super.key});
  @override
  State<ShipmentOrdersChatScreen> createState() => _ShipmentOrdersChatScreenState();
}

const _systemKeys = {
  'fromCity', 'toCity', 'truckType', 'cargoType', 'truckLength', 'quantity',
  'pickupTime', 'startTime', 'arrivalTime', 'sellPrice', 'buyPrice',
  'paymentSubtype', 'driverRentType', 'paymentMethod', 'branch', 'notes',
};
const _fixedKeys = {'customer', 'waybillNumber', 'status', 'agentName', 'vehicleName', 'driverName', 'driverPhone'};

String _fold(String x) => x.toLowerCase()
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').replaceAll('ؤ', 'و').replaceAll('ئ', 'ي');

/// Chat step: customer, then truck, then each configured slot, then the summary.
class _Step {
  final String kind; // customer · vehicle · field · summary
  final Map<String, dynamic>? field;
  const _Step(this.kind, [this.field]);
}

class _ShipmentOrdersChatScreenState extends State<ShipmentOrdersChatScreen> {
  List<Map<String, dynamic>> _fields = [];
  List<Map<String, dynamic>> _customers = [];
  List<Map<String, dynamic>> _vehicles = [];
  bool _loading = true;
  bool _saving = false;

  final List<(bool bot, String text)> _msgs = [];
  int _stepIdx = 0;
  int _asked = -1;
  final Map<String, dynamic> _answers = {};
  String _customerId = '';
  String _vehicleId = '';
  String? _doneWaybill;

  final _draft = TextEditingController();
  final _search = TextEditingController();
  bool _newCustMode = false;
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _draft.dispose();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/shipment-orders/fields'),
        Api.instance.get('/api/shipment-orders/customers'),
        Api.instance.get('/api/shipment-orders/vehicles'),
      ]);
      _fields = List<Map<String, dynamic>>.from(r[0]['fields'] ?? const []);
      _customers = List<Map<String, dynamic>>.from(r[1]['customers'] ?? const []);
      _vehicles = List<Map<String, dynamic>>.from(r[2]['vehicles'] ?? const []);
    } catch (e) {
      // With no slots the chat jumps to the summary and would read as success while failing, so the failure is stated.
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر تحميل النموذج', 'Failed to load the form'))));
    }
    if (!mounted) return;
    setState(() { _loading = false; _askIfNeeded(); });
  }

  List<_Step> get _steps {
    final qs = <_Step>[const _Step('customer'), const _Step('vehicle')];
    for (final g in const ['pickup_delivery', 'shipment', 'pricing_time', 'payment']) {
      for (final f in _fields) {
        if (f['group'] == g && !_fixedKeys.contains(f['key'])) qs.add(_Step('field', f));
      }
    }
    qs.add(const _Step('summary'));
    return qs;
  }

  _Step? get _step => _stepIdx < _steps.length ? _steps[_stepIdx] : null;

  String _label(Map f) => tr('${f['labelAr'] ?? f['key']}', '${(f['labelEn'] ?? '').toString().isEmpty ? (f['labelAr'] ?? f['key']) : f['labelEn']}');
  String _optLabel(Map o) => tr('${o['ar'] ?? o['key']}', '${o['en'] ?? o['ar'] ?? o['key']}');

  String _botAsk(_Step s) {
    if (s.kind == 'customer') return tr('أهلاً بك 👋 — لمن هذه الشحنة؟ اكتب اسم العميل أو اختره:', 'Hi! 👋 Who is this shipment for?');
    if (s.kind == 'vehicle') return tr('حسناً — أي سيارة ستحمل الشحنة؟ اكتب رقم اللوحة أو اسم السائق:', 'Which truck carries it? Type a plate or driver:');
    if (s.kind == 'summary') return tr('اكتملت البيانات ✅ — راجع الملخص ثم أكّد:', 'All set ✅ — review and confirm:');
    final f = s.field!;
    final label = _label(f);
    final t = f['inputType'];
    if (t == 'cards' || t == 'select') return tr('اختر $label:', 'Pick $label:');
    if (t == 'date' || t == 'datetime') return tr('$label — متى؟', '$label — when?');
    return '$label؟';
  }

  void _askIfNeeded() {
    if (_loading || _doneWaybill != null || _asked == _stepIdx) return;
    _asked = _stepIdx;
    final s = _step;
    if (s != null) _msgs.add((true, _botAsk(s)));
    _draft.clear();
    _search.clear();
    _scrollDown();
  }

  void _scrollDown() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      });

  void _say(bool bot, String text) => _msgs.add((bot, text));

  /// Always called inside setState; moves to the step and asks its question.
  void _next() {
    _stepIdx = (_stepIdx + 1).clamp(0, _steps.length - 1);
    _askIfNeeded();
  }

  void _pickCustomer(Map<String, dynamic> c) {
    _customerId = '${c['_id']}';
    _say(false, '${c['name']}');
    _answers['customerName'] = c['name'];
    final d = c['defaults'] is Map ? c['defaults'] as Map : const {};
    // Only a single agreed value is filled; with several the step still asks.
    for (final k in customerPrefKeys) {
      final one = prefOnly(d[k]);
      if ((_answers[k] ?? '').toString().isEmpty && one.isNotEmpty) _answers[k] = one;
    }
    final routes = List.from(c['routes'] ?? const []);
    if (routes.isNotEmpty) {
      _say(true, tr('لدى هذا العميل ${routes.length} مسارات مسعّرة — عند اختيار أحدها يُضاف السعر تلقائياً.', 'They have ${routes.length} priced routes — matching ones auto-price.'));
    }
    _next();
  }

  void _createCustomerInline() {
    final name = _draft.text.trim();
    if (name.isEmpty) return;
    _answers['newCustomerName'] = name;
    _answers['customerName'] = name;
    _customerId = '';
    _say(false, name);
    _say(true, tr('سيُسجَّل «$name» كعميل جديد مع الشحنة ✅', '“$name” will be registered as a new customer ✅'));
    _newCustMode = false;
    _next();
  }

  void _pickVehicle(Map<String, dynamic>? v) {
    if (v == null) {
      _say(false, tr('بدون سيارة حالياً', 'No truck yet'));
      _next();
      return;
    }
    _vehicleId = '${v['_id']}';
    _say(false, [v['plate'], v['name']].where((x) => '${x ?? ''}'.isNotEmpty).join(' — '));
    if ('${_answers['driverName'] ?? ''}'.isEmpty) _answers['driverName'] = v['defaultDriverName'] ?? '';
    if ('${_answers['driverPhone'] ?? ''}'.isEmpty) _answers['driverPhone'] = v['defaultDriverPhone'] ?? '';
    if ('${_answers['truckType'] ?? ''}'.isEmpty) _answers['truckType'] = v['truckType'] ?? '';
    if ('${v['defaultDriverName'] ?? ''}'.isNotEmpty) _say(true, tr('السائق: ${v['defaultDriverName']} ✓ (من بيانات السيارة)', 'Driver: ${v['defaultDriverName']} ✓'));
    _next();
  }

  void _answerField(Map f, dynamic value, String display) {
    _say(false, display);
    _answers['${f['key']}'] = value;
    // Priced route for this customer? The selling price is seeded as soon as both cities are known.
    final c = _customers.firstWhere((x) => '${x['_id']}' == _customerId, orElse: () => const {});
    if (c.isNotEmpty && (f['key'] == 'fromCity' || f['key'] == 'toCity')) {
      final from = _answers['fromCity'], to = _answers['toCity'];
      for (final r in List.from(c['routes'] ?? const [])) {
        if (r['fromCity'] == from && r['toCity'] == to && r['price'] != null && _answers['sellPrice'] == null) {
          _answers['sellPrice'] = r['price'];
          _say(true, tr('سعر هذا المسار مسجَّل: ${soMoney(r['price'])} — أُضيف كسعر بيع ✓', 'Known route price ${soMoney(r['price'])} applied ✓'));
          break;
        }
      }
    }
    _next();
  }

  void _skip() { _say(false, tr('تخطٍّ', 'skip')); _next(); }

  Future<void> _submit() async {
    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{'customFields': <String, dynamic>{}};
      for (final f in _fields) {
        final k = '${f['key']}';
        if (!_answers.containsKey(k)) continue;
        if (_systemKeys.contains(k)) { payload[k] = _answers[k]; } else { (payload['customFields'] as Map)[k] = _answers[k]; }
      }
      payload['driverName'] = _answers['driverName'] ?? '';
      payload['driverPhone'] = _answers['driverPhone'] ?? '';
      payload['status'] = 'requesting';
      if (_customerId.isNotEmpty) {
        payload['customer'] = _customerId;
      } else if ('${_answers['newCustomerName'] ?? ''}'.isNotEmpty) {
        payload['newCustomer'] = {'name': _answers['newCustomerName'], 'phone': ''};
      }
      if (_vehicleId.isNotEmpty) payload['vehicle'] = _vehicleId;
      // The day is sent at noon: a bare date like 2026-09-05 is read as midnight GMT.
      for (final k in const ['pickupTime', 'startTime', 'arrivalTime']) {
        final v = '${_answers[k] ?? ''}';
        if (v.isEmpty) { payload[k] = null; continue; }
        final dt = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) ? DateTime.parse('${v}T12:00:00') : DateTime.tryParse(v);
        payload[k] = dt?.toUtc().toIso8601String();
      }
      for (final k in const ['quantity', 'sellPrice', 'buyPrice']) {
        final v = payload[k];
        if (v == null || '$v'.isEmpty) { payload[k] = null; } else { payload[k] = num.tryParse('$v'); }
      }
      final d = await Api.instance.post('/api/shipment-orders/orders', payload);
      final wb = '${(d['order'] as Map?)?['waybillNumber'] ?? ''}';
      if (!mounted) return;
      setState(() {
        _doneWaybill = wb;
        _say(true, tr('تم إنشاء الشحنة 🎉 برقم أمر نقل $wb', 'Done! 🎉 Waybill $wb'));
      });
      _scrollDown();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _restart() => setState(() {
        _msgs.clear(); _answers.clear(); _customerId = ''; _vehicleId = '';
        _doneWaybill = null; _stepIdx = 0; _asked = -1; _draft.clear(); _search.clear(); _newCustMode = false;
        _askIfNeeded();
      });

  Widget _chip(String label, VoidCallback onTap, {IconData? icon, bool dashed = false}) => ActionChip(
        avatar: icon == null ? null : Icon(icon, size: 16),
        label: Text(label),
        onPressed: onTap,
        side: BorderSide(color: dashed ? T.inkFaint : T.line, style: BorderStyle.solid),
        backgroundColor: dashed ? T.canvas : Colors.white,
      );

  Widget _searchBox(String hint) => SearchField(
        controller: _search,
        onChanged: (_) => setState(() {}),
        hint: hint,
        dense: true,
      );

  String _fmtDate(String v, bool withTime) {
    final d = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) ? DateTime.tryParse('${v}T12:00:00') : DateTime.tryParse(v);
    if (d == null) return v;
    final l = d.toLocal();
    return withTime ? '${l.day}/${l.month}/${l.year} ${l.hour}:${l.minute.toString().padLeft(2, '0')}' : '${l.day}/${l.month}/${l.year}';
  }

  Widget _controls() {
    if (_doneWaybill != null) {
      return Wrap(alignment: WrapAlignment.center, spacing: 8, children: [
        _chip(tr('شحنة جديدة', 'New shipment'), _restart, icon: Icons.restart_alt),
        _chip(tr('افتح القائمة', 'Open the list'), () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const ShipmentOrdersScreen())), icon: Icons.open_in_new),
      ]);
    }
    final s = _step;
    if (s == null) return const SizedBox.shrink();
    final q = _fold(_search.text.trim());

    if (s.kind == 'customer') {
      if (_newCustMode) {
        return Row(children: [
          Expanded(child: TextField(controller: _draft, autofocus: true, onSubmitted: (_) => _createCustomerInline(),
              decoration: InputDecoration(hintText: tr('اسم العميل الجديد…', 'New customer name…'), isDense: true))),
          IconButton.filled(onPressed: _createCustomerInline, icon: const Icon(Icons.send)),
        ]);
      }
      final list = _customers.where((c) => q.isEmpty || _fold('${c['name'] ?? ''}').contains(q)).take(8).toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _searchBox(tr('اكتب اسم العميل للبحث…', 'Type to search customers…')),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final c in list) _chip('${c['name']}', () => setState(() => _pickCustomer(c))),
          _chip(tr('عميل جديد', 'New customer'), () => setState(() { _newCustMode = true; _draft.text = _search.text; }), icon: Icons.person_add_alt, dashed: true),
        ]),
      ]);
    }

    if (s.kind == 'vehicle') {
      // Supplier trucks only; our own fleet is outside this path for now (as on web).
      final list = _vehicles.where((v) => v['supplier'] != null).where((v) {
        if (q.isEmpty) return true;
        final sup = v['supplier'] is Map ? v['supplier']['name'] : '';
        return _fold([v['plate'], v['name'], v['defaultDriverName'], sup].where((x) => '${x ?? ''}'.isNotEmpty).join(' ')).contains(q);
      }).take(8).toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _searchBox(tr('اكتب رقم اللوحة أو اسم السائق…', 'Type plate or driver…')),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final v in list) _chip('${v['plate']}${'${v['defaultDriverName'] ?? ''}'.isNotEmpty ? ' · ${v['defaultDriverName']}' : ''}', () => setState(() => _pickVehicle(v))),
          _chip(tr('أحددها لاحقاً', 'Decide later'), () => setState(() => _pickVehicle(null)), icon: Icons.skip_next, dashed: true),
        ]),
      ]);
    }

    if (s.kind == 'summary') {
      final rows = <(String, String)>[];
      if ('${_answers['customerName'] ?? ''}'.isNotEmpty) rows.add((tr('العميل', 'Customer'), '${_answers['customerName']}'));
      final veh = _vehicles.firstWhere((v) => '${v['_id']}' == _vehicleId, orElse: () => const {});
      if (veh.isNotEmpty) rows.add((tr('السيارة', 'Vehicle'), '${veh['plate']}'));
      if ('${_answers['driverName'] ?? ''}'.isNotEmpty) rows.add((tr('السائق', 'Driver'), '${_answers['driverName']}'));
      for (final f in _fields) {
        if (_fixedKeys.contains(f['key'])) continue;
        final v = _answers['${f['key']}'];
        if (v == null || '$v'.isEmpty) continue;
        final t = f['inputType'];
        final disp = (t == 'select' || t == 'cards')
            ? _optLabel(List<Map>.from(f['options'] ?? const []).firstWhere((o) => o['key'] == v, orElse: () => {'key': v, 'ar': v, 'en': v}))
            : t == 'date' ? _fmtDate('$v', false) : t == 'datetime' ? _fmtDate('$v', true) : '$v';
        rows.add((_label(f), disp));
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.3),
          child: AppCard(child: ListView(shrinkWrap: true, children: [
            for (final r in rows)
              Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                Expanded(child: Text(r.$1, style: const TextStyle(fontSize: 12.5, color: T.inkFaint))),
                Flexible(child: Text(r.$2, textAlign: TextAlign.end, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
              ])),
          ])),
        ),
        const SizedBox(height: 8),
        Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 8, children: [
          _chip(tr('البدء من جديد', 'Start over'), _restart, icon: Icons.restart_alt),
          FilledButton.icon(
            onPressed: _saving ? null : _submit,
            icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
            label: Text(tr('تأكيد وإنشاء الشحنة', 'Confirm & create')),
          ),
        ]),
      ]);
    }

    // Settings slots
    final f = s.field!;
    final required = f['required'] == true;
    final t = f['inputType'];
    if (t == 'cards' || t == 'select') {
      final opts = List<Map<String, dynamic>>.from(f['options'] ?? const []);
      final list = opts.where((o) => q.isEmpty || _fold(_optLabel(o)).contains(q)).toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (opts.length > 10) ...[_searchBox(tr('اكتب للبحث…', 'Type to filter…')), const SizedBox(height: 6)],
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 180),
          child: SingleChildScrollView(child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final o in list) _chip(_optLabel(o), () => setState(() => _answerField(f, o['key'], _optLabel(o)))),
            if (!required) _chip(tr('تخطٍّ', 'Skip'), () => setState(_skip), icon: Icons.skip_next, dashed: true),
          ])),
        ),
      ]);
    }
    if (t == 'date' || t == 'datetime') {
      return Row(children: [
        Expanded(child: OutlinedButton.icon(
          icon: const Icon(Icons.event),
          label: Text(_label(f)),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 365)));
            if (d == null || !mounted) return;
            String v = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
            if (t == 'datetime') {
              final tm = await showTimePicker(context: context, initialTime: TimeOfDay.now());
              v = DateTime(d.year, d.month, d.day, tm?.hour ?? 0, tm?.minute ?? 0).toIso8601String();
            }
            setState(() => _answerField(f, v, _fmtDate(v, t == 'datetime')));
          },
        )),
        if (!required) IconButton(tooltip: tr('تخطٍّ', 'Skip'), onPressed: () => setState(_skip), icon: const Icon(Icons.skip_next)),
      ]);
    }
    void sendTyped() {
      final v = _draft.text.trim();
      if (v.isEmpty) { if (!required) setState(_skip); return; }
      setState(() => _answerField(f, v, v));
    }
    return Row(children: [
      Expanded(child: TextField(
        controller: _draft,
        autofocus: true,
        keyboardType: t == 'number' ? TextInputType.number : null,
        onSubmitted: (_) => sendTyped(),
        decoration: InputDecoration(hintText: _label(f), isDense: true),
      )),
      if (!required) IconButton(tooltip: tr('تخطٍّ', 'Skip'), onPressed: () => setState(_skip), icon: const Icon(Icons.skip_next)),
      IconButton.filled(onPressed: sendTyped, icon: const Icon(Icons.send)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    if (!canEditOrders(context)) {
      return AppScaffold(title: Text(tr('مساعد إنشاء الشحنة', 'Shipment assistant')),
          body: EmptyState(icon: Icons.lock_outline, title: tr('لا تملك صلاحية.', 'Not authorized.')));
    }
    final steps = _steps;
    final progress = _doneWaybill != null ? 1.0 : (_stepIdx.clamp(0, steps.length - 1)) / ((steps.length - 1).clamp(1, 1 << 30));
    return AppScaffold(
      title: Text(tr('مساعد إنشاء الشحنة', 'Shipment assistant')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              LinearProgressIndicator(value: progress, minHeight: 4, color: T.orange, backgroundColor: T.line),
              Expanded(child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.all(14),
                itemCount: _msgs.length,
                itemBuilder: (_, i) {
                  final (bot, text) = _msgs[i];
                  return Align(
                    alignment: bot ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                    child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (bot) ...[
                        CircleAvatar(radius: 15, backgroundColor: T.orange.withValues(alpha: 0.15), child: const Icon(Icons.smart_toy_outlined, size: 16, color: T.orange)),
                        const SizedBox(width: 6),
                      ],
                      Flexible(child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
                        decoration: BoxDecoration(
                          color: bot ? Colors.white : T.orange,
                          borderRadius: BorderRadius.circular(16),
                          border: bot ? Border.all(color: T.line) : null,
                        ),
                        child: Text(text, style: TextStyle(fontSize: 13.5, color: bot ? T.ink : Colors.white)),
                      )),
                    ]),
                  );
                },
              )),
              Container(
                width: double.infinity,
                padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.of(context).padding.bottom),
                decoration: const BoxDecoration(color: T.canvas, border: Border(top: BorderSide(color: T.line))),
                // The input panel does not eat the chat on short screens; it scrolls inside itself.
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.35),
                  child: SingleChildScrollView(child: _controls()),
                ),
              ),
            ]),
    );
  }
}
