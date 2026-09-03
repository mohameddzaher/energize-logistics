import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/flex_match.dart';

/// المركبات والتفويضات — أسطول الشركة الإداري: تسجيل المركبات، تفويض موظف،
/// نقل التفويض، إلغاؤه، وتسجيل الحوادث — بنفس مفردات صفحة الويب.

const vehicleTypes = {
  'car': ('سيارة', 'Car'),
  'motorcycle': ('دراجة نارية', 'Motorcycle'),
  'heavy_truck': ('نقل ثقيل', 'Heavy Truck'),
  'trailer': ('مقطورة', 'Trailer'),
  'van': ('فان', 'Van'),
  'equipment': ('معدة', 'Equipment'),
  'other': ('أخرى', 'Other'),
};

const vehicleStatus = {
  'available': ('متاحة', 'Available', T.inkFaint),
  'authorized': ('مُفوَّضة', 'Authorized', T.success),
  'parked': ('مركونة', 'Parked', T.warn),
  'maintenance': ('صيانة', 'Maintenance', T.info),
  'out_of_service': ('خارج الخدمة', 'Out of Service', T.danger),
};

const authStatus = {
  'active': ('سارٍ', 'Active', T.success),
  'transferred': ('تم نقله', 'Transferred', T.info),
  'revoked': ('ملغى', 'Revoked', T.danger),
};

const accidentSeverity = {
  'minor': ('بسيط', 'Minor', T.inkFaint),
  'moderate': ('متوسط', 'Moderate', T.warn),
  'severe': ('بالغ', 'Severe', T.danger),
  'total_loss': ('خسارة كلية', 'Total Loss', Color(0xFF991B1B)),
};

const accidentStatus = {
  'reported': ('مُبلّغ عنه', 'Reported', T.warn),
  'investigating': ('قيد التحقيق', 'Investigating', T.info),
  'resolved': ('تمت تسويته', 'Resolved', T.success),
  'closed': ('مغلق', 'Closed', T.inkFaint),
};

const faultParty = {
  'employee': ('الموظف', 'Employee'),
  'third_party': ('طرف ثالث', 'Third Party'),
  'shared': ('مشترك', 'Shared'),
  'none': ('بدون خطأ', 'No Fault'),
  'unknown': ('غير محدد', 'Unknown'),
};

String vTypeLabel(dynamic t) { final e = vehicleTypes[t]; return e == null ? (t ?? '—').toString() : tr(e.$1, e.$2); }

String empName(dynamic e) {
  if (e is! Map) return '—';
  final ar = (e['arabicName'] ?? '').toString();
  if (ar.isNotEmpty) return ar;
  return '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
}

/// الطيُّ الموحَّد — راجع services/flex_match. كان هذا يطوي الهمزةَ ولا يطوي
/// المسافة، فاللوحةُ المنسوخة بمسافتين لا تجد نفسَها المخزَّنة بواحدة.
String _fold(String s) => flexFold(s);
List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

// ── قائمة المركبات ──────────────────────────────────────────────────────────
class VehiclesListScreen extends StatefulWidget {
  const VehiclesListScreen({super.key});
  @override
  State<VehiclesListScreen> createState() => _VehiclesListScreenState();
}

class _VehiclesListScreenState extends State<VehiclesListScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:updated', _onLive);
    Live.instance.on('vehicle:authorization', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vehicle:updated', _onLive);
    Live.instance.off('vehicle:authorization', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/vehicles$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((v) {
      if (q.isEmpty) return true;
      return [v['plateNumber'], v['make'], v['model'], empName(v['currentEmployee'])].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('المركبات', 'Vehicles')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editVehicle(context, null),
        icon: const Icon(Icons.add),
        label: Text(tr('مركبة', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث باللوحة أو الموظف…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: vehicleStatus.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.directions_car_outlined, title: tr('لا توجد مركبات', 'No vehicles'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = filtered[i];
                                final st = vehicleStatus[v['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => VehicleDetailScreen(vehicleId: (v['_id'] ?? '').toString(), plate: (v['plateNumber'] ?? '').toString()))),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          Chip2(vTypeLabel(v['type']), T.navy),
                                          if ([v['make'], v['model']].any((x) => (x ?? '').toString().isNotEmpty))
                                            Chip2([v['make'], v['model']].where((x) => (x ?? '').toString().isNotEmpty).join(' '), T.inkFaint),
                                          if (v['currentEmployee'] != null) Chip2(empName(v['currentEmployee']), T.info, icon: Icons.person_outline),
                                          if ((v['accidentCount'] ?? 0) != 0) Chip2('${v['accidentCount']} ${tr('حادث', 'accidents')}', T.danger, icon: Icons.car_crash_outlined),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }

  Future<void> _editVehicle(BuildContext context, Map<String, dynamic>? v) => editVehicleSheet(context, v, _load);
}

// إنشاء/تعديل مركبة — مشترك بين القائمة وشاشة التفاصيل.
Future<void> editVehicleSheet(BuildContext context, Map<String, dynamic>? v, Future<void> Function() onDone) async {
  final plate = TextEditingController(text: (v?['plateNumber'] ?? '').toString());
  final make = TextEditingController(text: (v?['make'] ?? '').toString());
  final model = TextEditingController(text: (v?['model'] ?? '').toString());
  final year = TextEditingController(text: (v?['year'] ?? '').toString());
  final color = TextEditingController(text: (v?['color'] ?? '').toString());
  final department = TextEditingController(text: (v?['department'] ?? '').toString());
  String type = (v?['type'] ?? 'car').toString();
  String status = (v?['status'] ?? 'available').toString();
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(v == null ? tr('مركبة جديدة', 'New vehicle') : tr('تعديل المركبة', 'Edit vehicle'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: plate, decoration: InputDecoration(labelText: tr('رقم اللوحة *', 'Plate number *'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: type,
              decoration: InputDecoration(labelText: tr('النوع', 'Type')),
              items: vehicleTypes.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (x) => setS(() => type = x ?? type),
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: make, decoration: InputDecoration(labelText: tr('الصانع', 'Make')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: model, decoration: InputDecoration(labelText: tr('الموديل', 'Model')))),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: year, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('السنة', 'Year')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: color, decoration: InputDecoration(labelText: tr('اللون', 'Color')))),
            ]),
            const SizedBox(height: 10),
            TextField(controller: department, decoration: InputDecoration(labelText: tr('القسم', 'Department'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
              items: vehicleStatus.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (x) => setS(() => status = x ?? status),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  if (plate.text.trim().isEmpty) return;
                  final body = {
                    'plateNumber': plate.text.trim(), 'type': type, 'status': status,
                    'make': make.text.trim(), 'model': model.text.trim(),
                    if (year.text.trim().isNotEmpty) 'year': num.tryParse(year.text),
                    'color': color.text.trim(), 'department': department.text.trim(),
                  };
                  try {
                    if (v == null) {
                      await Api.instance.post('/api/vehicles', body);
                    } else {
                      await Api.instance.put('/api/vehicles/${v['_id']}', body);
                    }
                    if (c.mounted) Navigator.pop(c);
                    await onDone();
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(v == null ? tr('إنشاء', 'Create') : tr('حفظ', 'Save')),
              ),
            ),
          ]),
        ),
      ),
    )),
  );
}

// searchable employee picker shared by authorize/transfer/accident
Future<Map<String, dynamic>?> pickVehicleEmployee(BuildContext context) async {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) {
      String q = '';
      List<Map<String, dynamic>> emps = [];
      bool loading = true;
      return StatefulBuilder(builder: (c, setS) {
        Future<void> search() async {
          try {
            final d = await Api.instance.get('/api/vehicles/employees${q.trim().isEmpty ? '' : '?q=${Uri.encodeQueryComponent(q.trim())}'}');
            emps = List<Map<String, dynamic>>.from(d['employees'] ?? []);
          } catch (_) {}
          if (c.mounted) setS(() => loading = false);
        }
        if (loading && emps.isEmpty) search();
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
                    onChanged: (v) { q = v; setS(() => loading = true); search(); },
                    decoration: InputDecoration(hintText: tr('ابحث عن الموظف…', 'Search employee…'), prefixIcon: const Icon(Icons.search)),
                  ),
                ),
                Expanded(
                  child: loading
                      ? const Center(child: CircularProgressIndicator())
                      : ListView.builder(
                          itemCount: emps.length,
                          itemBuilder: (c, i) => ListTile(
                            title: Text(empName(emps[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                            subtitle: Text('${emps[i]['employeeNumber'] ?? ''} · ${emps[i]['jobTitle'] ?? ''}', style: const TextStyle(fontSize: 12)),
                            onTap: () => Navigator.pop(c, emps[i]),
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

// ── تفاصيل المركبة ──────────────────────────────────────────────────────────
class VehicleDetailScreen extends StatefulWidget {
  final String vehicleId;
  final String plate;
  const VehicleDetailScreen({super.key, required this.vehicleId, required this.plate});
  @override
  State<VehicleDetailScreen> createState() => _VehicleDetailScreenState();
}

class _VehicleDetailScreenState extends State<VehicleDetailScreen> {
  Map<String, dynamic>? _vehicle;
  List<Map<String, dynamic>> _auths = [];
  List<Map<String, dynamic>> _accidents = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:updated', _onLive);
    Live.instance.on('vehicle:authorization', _onLive);
    Live.instance.on('vehicle:accident', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vehicle:updated', _onLive);
    Live.instance.off('vehicle:authorization', _onLive);
    Live.instance.off('vehicle:accident', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicles/${widget.vehicleId}');
      if (!mounted) return;
      setState(() {
        _vehicle = d['vehicle'] is Map ? Map<String, dynamic>.from(d['vehicle']) : {};
        _auths = _l(d['authorizations']);
        _accidents = _l(d['accidents']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
  }

  Future<void> _authAction(String action) async {
    // authorize / transfer need an employee; revoke asks a reason.
    if (action == 'revoke') {
      final reason = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(tr('إلغاء التفويض', 'Revoke authorization')),
          content: TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إلغاء التفويض', 'Revoke'))),
          ],
        ),
      );
      if (ok != true) return;
      await _post('/api/vehicles/${widget.vehicleId}/revoke', {if (reason.text.trim().isNotEmpty) 'revokedReason': reason.text.trim()}, tr('أُلغي التفويض', 'Revoked'));
      return;
    }
    final emp = await pickVehicleEmployee(context);
    if (emp == null || !mounted) return;
    final docNumber = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(action == 'authorize' ? tr('تفويض إلى ${empName(emp)}', 'Authorize to ${empName(emp)}') : tr('نقل إلى ${empName(emp)}', 'Transfer to ${empName(emp)}')),
        content: TextField(controller: docNumber, decoration: InputDecoration(labelText: tr('رقم الوثيقة (اختياري)', 'Document number (optional)'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(action == 'authorize' ? tr('تفويض', 'Authorize') : tr('نقل', 'Transfer'))),
        ],
      ),
    );
    if (ok != true) return;
    await _post('/api/vehicles/${widget.vehicleId}/$action', {
      'employee': emp['_id'],
      if (docNumber.text.trim().isNotEmpty) 'documentNumber': docNumber.text.trim(),
    }, action == 'authorize' ? tr('تم التفويض', 'Authorized') : tr('تم النقل', 'Transferred'));
  }

  Future<void> _post(String path, Map<String, dynamic> body, String okMsg) async {
    try {
      await Api.instance.post(path, body);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _addAccident() async {
    final desc = TextEditingController();
    final location = TextEditingController();
    final estCost = TextEditingController();
    DateTime date = DateTime.now();
    String severity = 'minor';
    String fault = 'unknown';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تسجيل حادث', 'Record accident'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final v = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2020), lastDate: DateTime.now());
                  if (v != null) setS(() => date = v);
                },
                icon: const Icon(Icons.event, size: 17),
                label: Text('${tr('التاريخ', 'Date')}: ${date.day}/${date.month}/${date.year}'),
              ),
              const SizedBox(height: 10),
              TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('وصف الحادث *', 'Description *'))),
              const SizedBox(height: 10),
              TextField(controller: location, decoration: InputDecoration(labelText: tr('الموقع', 'Location'))),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: severity,
                decoration: InputDecoration(labelText: tr('الخطورة', 'Severity')),
                items: accidentSeverity.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                onChanged: (v) => setS(() => severity = v ?? severity),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: fault,
                decoration: InputDecoration(labelText: tr('المتسبب', 'Fault party')),
                items: faultParty.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                onChanged: (v) => setS(() => fault = v ?? fault),
              ),
              const SizedBox(height: 10),
              TextField(controller: estCost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة التقديرية', 'Estimated cost'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (desc.text.trim().isEmpty) return;
                    try {
                      await Api.instance.post('/api/vehicles/${widget.vehicleId}/accidents', {
                        'date': '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
                        'description': desc.text.trim(),
                        if (location.text.trim().isNotEmpty) 'location': location.text.trim(),
                        'severity': severity, 'faultParty': fault,
                        if (estCost.text.trim().isNotEmpty) 'estimatedCost': num.tryParse(estCost.text),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسجيل', 'Record')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final v = _vehicle ?? {};
    final st = vehicleStatus[v['status']] ?? ('—', '—', T.inkFaint);
    final authorized = v['status'] == 'authorized';

    return AppScaffold(
      title: Text(widget.plate),
      actions: [
        IconButton(icon: const Icon(Icons.edit_outlined, color: Colors.white), onPressed: _loading ? null : () => editVehicleSheet(context, v, _load)),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: st.$3,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                            Chip2(tr(st.$1, st.$2), st.$3),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            Chip2(vTypeLabel(v['type']), T.navy),
                            if ([v['make'], v['model'], v['year']].any((x) => (x ?? '').toString().isNotEmpty))
                              Chip2([v['make'], v['model'], v['year']].where((x) => (x ?? '').toString().isNotEmpty).join(' '), T.inkFaint),
                            if ((v['color'] ?? '').toString().isNotEmpty) Chip2(v['color'].toString(), T.violet),
                            if (v['branch'] is Map) Chip2(v['branch']['name'].toString(), T.cyan, icon: Icons.store_outlined),
                          ]),
                          if (v['currentEmployee'] != null) ...[
                            const SizedBox(height: 8),
                            Chip2('${tr('مُفوَّضة إلى', 'Authorized to')}: ${empName(v['currentEmployee'])}', T.success, icon: Icons.person_outline),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(height: 10),
                    // actions
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      if (!authorized)
                        _actBtn(Icons.assignment_ind_outlined, tr('تفويض', 'Authorize'), T.success, () => _authAction('authorize')),
                      if (authorized) ...[
                        _actBtn(Icons.swap_horiz_rounded, tr('نقل', 'Transfer'), T.navy, () => _authAction('transfer')),
                        _actBtn(Icons.cancel_outlined, tr('إلغاء التفويض', 'Revoke'), T.danger, () => _authAction('revoke')),
                      ],
                      _actBtn(Icons.car_crash_outlined, tr('تسجيل حادث', 'Record accident'), T.orange, _addAccident),
                    ]),
                    // authorizations history
                    if (_auths.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text(tr('سجل التفويضات', 'Authorization history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ..._auths.map((a) {
                        final ast = authStatus[a['status']] ?? ('—', '—', T.inkFaint);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            topAccent: ast.$3,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text(empName(a['employee']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                                Chip2(tr(ast.$1, ast.$2), ast.$3),
                              ]),
                              const SizedBox(height: 4),
                              Text('${_d(a['startDate'])}${a['endDate'] != null ? ' ← ${_d(a['endDate'])}' : ''}${a['transferredTo'] != null ? ' · ${tr('نُقل إلى', 'to')} ${empName(a['transferredTo'])}' : ''}',
                                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                            ]),
                          ),
                        );
                      }),
                    ],
                    // accidents
                    if (_accidents.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text('${tr('الحوادث', 'Accidents')} (${_accidents.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ..._accidents.map((a) {
                        final sev = accidentSeverity[a['severity']] ?? ('—', '—', T.inkFaint);
                        final ast = accidentStatus[a['status']] ?? ('—', '—', T.inkFaint);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Pressable(
                            onTap: () => editAccident(context, a, _load),
                            child: AppCard(
                            topAccent: sev.$3,
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text((a['description'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 2, overflow: TextOverflow.ellipsis)),
                                const Icon(Icons.edit_outlined, size: 15, color: T.inkFaint),
                              ]),
                              const SizedBox(height: 5),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                Chip2(_d(a['date']), T.inkFaint, icon: Icons.event),
                                Chip2(tr(sev.$1, sev.$2), sev.$3),
                                Chip2(tr(ast.$1, ast.$2), ast.$3),
                                if ((a['actualCost'] ?? 0) != 0) Chip2('${tr('فعلي', 'Actual')}: ${a['actualCost']} ${tr('ر.س', 'SAR')}', T.danger)
                                else if ((a['estimatedCost'] ?? 0) != 0) Chip2('${a['estimatedCost']} ${tr('ر.س', 'SAR')}', T.orange),
                              ]),
                            ]),
                          ),
                          ),
                        );
                      }),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _actBtn(IconData icon, String label, Color color, VoidCallback onTap) => ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: onTap,
      );
}

// تعديل حادث: الحالة + الخطورة + التكلفة الفعلية + التسوية، مع حذف.
// endpoint: PUT/DELETE /api/vehicles/accidents/:accId
Future<void> editAccident(BuildContext context, Map<String, dynamic> a, Future<void> Function() onDone) async {
  String status = (a['status'] ?? 'reported').toString();
  String severity = (a['severity'] ?? 'minor').toString();
  final actualCost = TextEditingController(text: (a['actualCost'] == null || a['actualCost'] == 0) ? '' : a['actualCost'].toString());
  final resolution = TextEditingController(text: (a['resolution'] ?? '').toString());
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(c).viewInsets.bottom + 18),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(tr('تعديل الحادث', 'Edit accident'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: T.danger),
            onPressed: () async {
              Navigator.pop(c, false);
              try { await Api.instance.delete('/api/vehicles/accidents/${a['_id']}'); await onDone(); }
              catch (e) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
            },
          ),
        ]),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: status,
          decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
          items: accidentStatus.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
          onChanged: (v) => setS(() => status = v ?? status),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: severity,
          decoration: InputDecoration(labelText: tr('الخطورة', 'Severity')),
          items: accidentSeverity.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
          onChanged: (v) => setS(() => severity = v ?? severity),
        ),
        const SizedBox(height: 10),
        TextField(controller: actualCost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة الفعلية (ر.س)', 'Actual cost (SAR)'))),
        const SizedBox(height: 10),
        TextField(controller: resolution, maxLines: 2, decoration: InputDecoration(labelText: tr('التسوية / الإجراء', 'Resolution'))),
        const SizedBox(height: 14),
        SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
      ]),
    )),
  );
  if (ok != true) return;
  try {
    await Api.instance.put('/api/vehicles/accidents/${a['_id']}', {
      'status': status,
      'severity': severity,
      'actualCost': actualCost.text.trim().isEmpty ? null : num.tryParse(actualCost.text.trim()),
      'resolution': resolution.text.trim(),
    });
    await onDone();
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
  }
}

// ── قائمة الحوادث المستقلة ──────────────────────────────────────────────────
class AccidentsListScreen extends StatefulWidget {
  const AccidentsListScreen({super.key});
  @override
  State<AccidentsListScreen> createState() => _AccidentsListScreenState();
}

class _AccidentsListScreenState extends State<AccidentsListScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:accident', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vehicle:accident', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/vehicles/accidents$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['accidents'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('الحوادث', 'Accidents')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: accidentStatus.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.car_crash_outlined, title: tr('لا توجد حوادث', 'No accidents'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final a = _rows[i];
                                final sev = accidentSeverity[a['severity']] ?? ('—', '—', T.inkFaint);
                                final ast = accidentStatus[a['status']] ?? ('—', '—', T.inkFaint);
                                final veh = a['vehicle'] is Map ? (a['vehicle']['plateNumber'] ?? '').toString() : '';
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => editAccident(context, a, _load),
                                    child: AppCard(
                                    topAccent: sev.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(veh.isEmpty ? (a['description'] ?? '').toString() : veh, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(tr(ast.$1, ast.$2), ast.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text((a['description'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        Chip2(_d(a['date']), T.inkFaint, icon: Icons.event),
                                        Chip2(tr(sev.$1, sev.$2), sev.$3),
                                        if (a['employee'] != null) Chip2(empName(a['employee']), T.info, icon: Icons.person_outline),
                                        if ((a['actualCost'] ?? 0) != 0) Chip2('${tr('فعلي', 'Actual')}: ${a['actualCost']} ${tr('ر.س', 'SAR')}', T.danger)
                                        else if ((a['estimatedCost'] ?? 0) != 0) Chip2('${a['estimatedCost']} ${tr('ر.س', 'SAR')}', T.orange),
                                      ]),
                                    ]),
                                  ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
