import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import '../ui/export_sheet.dart';
import '../ui/api_picker.dart';

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

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];


// ── الأدوار — نظيرُ isVehicleStaff / isVehicleAdmin في lib/vehicles.ts ──────
const _vehicleAdminRoles = ['super_admin', 'admin', 'hr_manager', 'cfo', 'accounting_manager'];
bool isVehicleAdmin(AuthProvider a) => _vehicleAdminRoles.contains(a.role) || a.canEditSection('Vehicles');

String _dd(dynamic v) {
  if (v == null || v.toString().isEmpty) return '—';
  final d = DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? v.toString() : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _todayYmd() => _ymd(DateTime.now());
String _plateOf(dynamic v) => v is Map ? (v['plateNumber'] ?? '—').toString() : '—';
String _faultLabel(dynamic f) { final e = faultParty[f]; return e == null ? (f ?? '—').toString() : tr(e.$1, e.$2); }
String _metaLabel(Map<String, (String, String, Color)> m, dynamic k) { final e = m[k]; return e == null ? (k ?? '—').toString() : tr(e.$1, e.$2); }
String _empNameOrBlank(dynamic e) => e is Map ? empName(e) : '';

void _snack(BuildContext c, String m) { if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m))); }

/// خانةُ تاريخٍ تُكتب YYYY-MM-DD كما يرسلها الموقع.
class _DateBox extends StatelessWidget {
  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final bool clearable;
  const _DateBox({required this.label, required this.value, required this.onChanged, this.clearable = true});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final init = DateTime.tryParse(value) ?? DateTime.now();
        final d = await showDatePicker(context: context, initialDate: init, firstDate: DateTime(2000), lastDate: DateTime(2100));
        if (d != null) onChanged(_ymd(d));
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: clearable && value.isNotEmpty
              ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => onChanged(''))
              : const Icon(Icons.event, size: 18),
        ),
        child: Text(value.isEmpty ? '—' : value),
      ),
    );
  }
}

// ── قائمة المركبات ──────────────────────────────────────────────────────────
class VehiclesListScreen extends StatefulWidget {
  final String? initialStatus, initialType, initialSearch;
  const VehiclesListScreen({super.key, this.initialStatus, this.initialType, this.initialSearch});
  @override
  State<VehiclesListScreen> createState() => _VehiclesListScreenState();
}

class _VehiclesListScreenState extends State<VehiclesListScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late String _q = widget.initialSearch ?? '';
  // نصُّ البحث في متحكِّمٍ يملكه الشاشة
  late final _searchCtl = TextEditingController(text: _q);
  late String _status = widget.initialStatus ?? '';
  late String _type = widget.initialType ?? '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:updated', _onLive);
    Live.instance.on('vehicle:authorization', _onLive);
    // المفوَّضُ واللوحةُ من سجلّ المركبات — تعديلُه يصل هنا، كالموقع.
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    Live.instance.off('vehicle:updated', _onLive);
    Live.instance.off('vehicle:authorization', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  // البحثُ والنوعُ والحالةُ على الخادم كالموقع — وردٌّ قديمٌ لا يكتب فوق أحدث.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>[
        if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
        if (_type.isNotEmpty) 'type=$_type',
        if (_status.isNotEmpty) 'status=$_status',
      ];
      final d = await Api.instance.get('/api/vehicles${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = _l(d['vehicles']); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<ExportCol> get _cols => [
        ExportCol('رقم اللوحة', 'Plate number', (r) => r['plateNumber'] ?? ''),
        ExportCol('النوع', 'Type', (r) => vTypeLabel(r['type'])),
        ExportCol('الصانع', 'Make', (r) => r['make'] ?? ''),
        ExportCol('الموديل', 'Model', (r) => r['model'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => _metaLabel(vehicleStatus, r['status'])),
        ExportCol('مُفوَّضة إلى', 'Authorized to', (r) => r['currentEmployee'] is Map ? empName(r['currentEmployee']) : '—'),
        ExportCol('القسم', 'Department', (r) => r['department'] ?? ''),
        ExportCol('المشروع', 'Project', (r) => r['project'] ?? ''),
      ];

  Future<void> _export() async {
    final filtered = _q.trim().isNotEmpty || _type.isNotEmpty || _status.isNotEmpty;
    String scope = 'shown';
    if (filtered) {
      final s = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض (بعد الفلتر)', 'Shown (filtered)')), onTap: () => Navigator.pop(c, 'shown')),
        ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكلّ', 'Everything')), onTap: () => Navigator.pop(c, 'all')),
      ])));
      if (s == null) return;
      scope = s;
    }
    var rows = _rows;
    if (scope == 'all') {
      try { rows = _l((await Api.instance.get('/api/vehicles'))['vehicles']); } catch (e) { if (mounted) _snack(context, e.toString()); return; }
    }
    if (!mounted) return;
    if (rows.isEmpty) { _snack(context, tr('لا صفوف للتصدير', 'Nothing to export')); return; }
    await exportExcel(context, fileName: 'vehicles', sheets: [('Vehicles', _cols, rows)]);
  }

  Future<void> _remove(Map<String, dynamic> v) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف ${v['plateNumber']}؟', 'Delete ${v['plateNumber']}?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/vehicles/${v['_id']}'); _load(); } catch (e) { if (mounted) _snack(context, e.toString()); }
  }

  Widget _chips<T2>(Map<String, T2> m, String selectedKey, String Function(T2) label, Color Function(T2) color, ValueChanged<String> onPick) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: m.entries.map((e) {
        final selected = selectedKey == e.key;
        final col = color(e.value);
        return Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: FilterChip(
            selected: selected,
            onSelected: (_) => onPick(selected ? '' : e.key),
            label: Text(label(e.value)),
            labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : col),
            selectedColor: col,
            backgroundColor: col.withValues(alpha: 0.1),
            checkmarkColor: Colors.white,
            side: BorderSide.none,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          ),
        );
      }).toList()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final admin = isVehicleAdmin(context.watch<AuthProvider>());
    return AppScaffold(
      title: Text(tr('المركبات', 'Vehicles')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => editVehicleSheet(context, null, _load),
        icon: const Icon(Icons.add),
        label: Text(tr('إضافة مركبة', 'Add vehicle')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: SearchField(
            controller: _searchCtl,
            onChanged: (v) {
              _q = v;
              final s = ++_seq;
              Future.delayed(const Duration(milliseconds: 350), () { if (mounted && s == _seq) _load(); });
            },
            hint: tr('ابحث باللوحة أو الموظف…', 'Search…'), suffixText: '${_rows.length}',
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: _chips<(String, String)>(vehicleTypes, _type, (e) => tr(e.$1, e.$2), (_) => T.navy, (k) { setState(() { _type = k; _loading = true; }); _load(); }),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 6, 14, 4),
          child: _chips<(String, String, Color)>(vehicleStatus, _status, (e) => tr(e.$1, e.$2), (e) => e.$3, (k) { setState(() { _status = k; _loading = true; }); _load(); }),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.directions_car_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد مركبات', 'No vehicles'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 10, 14, 90),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = _rows[i];
                                final st = vehicleStatus[v['status']] ?? ('—', '—', T.inkFaint);
                                return Pressable(
                                  onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => VehicleDetailScreen(vehicleId: (v['_id'] ?? '').toString(), plate: (v['plateNumber'] ?? '').toString()))),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                        IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft), tooltip: tr('تعديل', 'Edit'), onPressed: () => editVehicleSheet(context, v, _load)),
                                        if (admin) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), tooltip: tr('حذف', 'Delete'), onPressed: () => _remove(v)),
                                      ]),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        Chip2(vTypeLabel(v['type']), T.navy),
                                        if ([v['make'], v['model']].any((x) => (x ?? '').toString().isNotEmpty))
                                          Chip2([v['make'], v['model']].where((x) => (x ?? '').toString().isNotEmpty).join(' '), T.inkFaint),
                                        Chip2(v['currentEmployee'] != null ? empName(v['currentEmployee']) : tr('غير مفوَّضة', 'Not authorized'), v['currentEmployee'] != null ? T.info : T.inkFaint, icon: Icons.person_outline),
                                        if ((v['department'] ?? '').toString().isNotEmpty) Chip2(v['department'].toString(), T.violet),
                                        if ((v['accidentCount'] ?? 0) != 0) Chip2('${v['accidentCount']} ${tr('حادث', 'accidents')}', T.danger, icon: Icons.car_crash_outlined),
                                      ]),
                                    ]),
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

// إنشاء/تعديل مركبة — مشترك بين القائمة وشاشة التفاصيل. نفسُ حقول نموذج الموقع.
Future<void> editVehicleSheet(BuildContext context, Map<String, dynamic>? v, Future<void> Function() onDone) async {
  final plate = TextEditingController(text: (v?['plateNumber'] ?? '').toString());
  final make = TextEditingController(text: (v?['make'] ?? '').toString());
  final model = TextEditingController(text: (v?['model'] ?? '').toString());
  final year = TextEditingController(text: (v?['year'] ?? '').toString());
  final color = TextEditingController(text: (v?['color'] ?? '').toString());
  final department = TextEditingController(text: (v?['department'] ?? '').toString());
  final project = TextEditingController(text: (v?['project'] ?? '').toString());
  final notes = TextEditingController(text: (v?['notes'] ?? '').toString());
  String type = (v?['type'] ?? 'car').toString();
  if (!vehicleTypes.containsKey(type)) type = 'other';
  String status = (v?['status'] ?? 'available').toString();
  if (!vehicleStatus.containsKey(status)) status = 'available';
  String branch = v?['branch'] is Map ? (v!['branch']['_id'] ?? '').toString() : (v?['branch'] ?? '').toString();
  String regExp = v?['registrationExpiry'] == null ? '' : v!['registrationExpiry'].toString().split('T').first;
  String insExp = v?['insuranceExpiry'] == null ? '' : v!['insuranceExpiry'].toString().split('T').first;
  List<Map<String, dynamic>> branches = [];
  try { branches = _l((await Api.instance.get('/api/branches'))['branches']); } catch (_) {}
  if (branch.isNotEmpty && !branches.any((b) => b['_id'] == branch)) branch = '';
  if (!context.mounted) return;
  bool saving = false;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(v == null ? tr('إضافة مركبة', 'Add vehicle') : tr('تعديل المركبة', 'Edit vehicle'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: plate, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('رقم اللوحة *', 'Plate number *'))),
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
            DropdownButtonFormField<String>(
              initialValue: branch,
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('الفرع', 'Branch')),
              items: [
                const DropdownMenuItem(value: '', child: Text('—')),
                ...branches.map((b) => DropdownMenuItem(value: (b['_id'] ?? '').toString(), child: Text((b['name'] ?? '').toString()))),
              ],
              onChanged: (x) => setS(() => branch = x ?? ''),
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: department, decoration: InputDecoration(labelText: tr('القسم', 'Department')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: project, decoration: InputDecoration(labelText: tr('المشروع', 'Project')))),
            ]),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
              items: vehicleStatus.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (x) => setS(() => status = x ?? status),
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _DateBox(label: tr('انتهاء الاستمارة', 'Registration expiry'), value: regExp, onChanged: (x) => setS(() => regExp = x))),
              const SizedBox(width: 10),
              Expanded(child: _DateBox(label: tr('انتهاء التأمين', 'Insurance expiry'), value: insExp, onChanged: (x) => setS(() => insExp = x))),
            ]),
            const SizedBox(height: 10),
            TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: saving || plate.text.trim().isEmpty ? null : () async {
                  setS(() => saving = true);
                  final body = {
                    'plateNumber': plate.text.trim(), 'type': type, 'status': status,
                    'make': make.text.trim(), 'model': model.text.trim(),
                    if (year.text.trim().isNotEmpty) 'year': num.tryParse(year.text.trim()),
                    'color': color.text.trim(), 'branch': branch, 'department': department.text.trim(),
                    'project': project.text.trim(), 'registrationExpiry': regExp, 'insuranceExpiry': insExp,
                    'notes': notes.text.trim(),
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
                    setS(() => saving = false);
                    if (c.mounted) _snack(c, e.toString());
                  }
                },
                child: Text(tr('حفظ', 'Save')),
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
  // الحالةُ خارج builder: إعادةُ بناء النافذة لا تُصفِّرها والخانةُ مكتوبة
  String q = '';
  List<Map<String, dynamic>> emps = [];
  bool loading = true;
  int seq = 0;
  Timer? debounce;
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) {
      return StatefulBuilder(builder: (c, setS) {
        Future<void> search() async {
          final mine = ++seq;
          try {
            final d = await Api.instance.get('/api/vehicles/employees${q.trim().isEmpty ? '' : '?q=${Uri.encodeQueryComponent(q.trim())}'}');
            if (mine != seq || !c.mounted) return;
            emps = _l(d['employees']);
          } catch (_) {}
          if (c.mounted && mine == seq) setS(() => loading = false);
        }
        if (loading && emps.isEmpty && seq == 0) search();
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
                    onChanged: (v) {
                      q = v;
                      setS(() => loading = true);
                      debounce?.cancel();
                      debounce = Timer(const Duration(milliseconds: 350), () { if (c.mounted) search(); });
                    },
                    hint: tr('ابحث عن الموظف…', 'Search employee…'),
                  ),
                ),
                Expanded(
                  child: loading
                      ? const Center(child: CircularProgressIndicator())
                      : emps.isEmpty && q.trim().isNotEmpty
                          ? Center(child: Text(tr('لا نتائج مطابقة', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                          : ListView.builder(
                          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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

/// خانةُ موظّفٍ تفتح المنتقي — قيمةٌ ظاهرةٌ وزرُّ تفريغ.
class _EmpBox extends StatelessWidget {
  final String label;
  final Map<String, dynamic>? emp;
  final ValueChanged<Map<String, dynamic>?> onChanged;
  const _EmpBox({required this.label, required this.emp, required this.onChanged});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () async { final e = await pickVehicleEmployee(context); if (e != null) onChanged(e); },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: emp != null ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => onChanged(null)) : const Icon(Icons.person_search_outlined, size: 18),
          ),
          child: Text(emp == null ? tr('اختر موظفًا…', 'Select employee…') : empName(emp)),
        ),
      );
}

// ── نموذجُ الحادث: تسجيلٌ وتعديل، من ملفّ المركبة أو من شاشة الحوادث ──────────
// نفسُ حقول الموقع: التاريخ، الموظف (من ملفّ المركبة)، الموقع، رقم المحضر،
// المتسبّب، الخطورة، الحالة، التكلفتان، الوصف، الطرف الثالث، الإجراء، التسوية.
Future<bool> accidentFormSheet(
  BuildContext context, {
  Map<String, dynamic>? accident,
  String? vehicleId,
  bool pickVehicle = false,
  bool withEmployee = false,
  Map<String, dynamic>? defaultEmployee,
}) async {
  final a = accident ?? {};
  final editing = accident != null;
  String date = (a['date'] ?? _todayYmd()).toString().split('T').first;
  String fault = faultParty.containsKey(a['faultParty']) ? a['faultParty'] : 'unknown';
  String severity = accidentSeverity.containsKey(a['severity']) ? a['severity'] : 'minor';
  String status = accidentStatus.containsKey(a['status']) ? a['status'] : 'reported';
  String num0(dynamic x) => (x == null || x == 0 || x == '') ? '' : x.toString();
  final location = TextEditingController(text: (a['location'] ?? '').toString());
  final reportNumber = TextEditingController(text: (a['reportNumber'] ?? '').toString());
  final estimated = TextEditingController(text: num0(a['estimatedCost']));
  final actual = TextEditingController(text: num0(a['actualCost']));
  final desc = TextEditingController(text: (a['description'] ?? '').toString());
  final third = TextEditingController(text: (a['thirdPartyDetails'] ?? '').toString());
  final action = TextEditingController(text: (a['actionTaken'] ?? '').toString());
  final resolution = TextEditingController(text: (a['resolution'] ?? '').toString());
  Map<String, dynamic>? employee = defaultEmployee;
  Map<String, dynamic>? vehicle;
  bool saving = false;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(builder: (c, setS) {
      Widget dd(String label, String value, Map<String, dynamic> m, ValueChanged<String> on) => DropdownButtonFormField<String>(
            initialValue: value,
            isExpanded: true,
            decoration: InputDecoration(labelText: label),
            items: m.entries.map((e) {
              final t = e.value as dynamic;
              return DropdownMenuItem(value: e.key, child: Text(tr(t.$1 as String, t.$2 as String)));
            }).toList(),
            onChanged: (x) => setS(() => on(x ?? value)),
          );
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(editing ? tr('تعديل الحادث', 'Edit accident') : tr('تسجيل حادث', 'Report accident'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              if (pickVehicle) ...[
                InkWell(
                  onTap: () async {
                    final r = await pickFromApi(c, endpoint: '/api/vehicles?limit=2000', listKey: 'vehicles', title: tr('اختر المركبة', 'Pick the vehicle'),
                        label: (v) => [v['plateNumber'], v['make'], v['model'], v['department']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '));
                    if (r != null) setS(() => vehicle = r);
                  },
                  child: InputDecorator(
                    decoration: InputDecoration(labelText: tr('رقم اللوحة *', 'Plate number *'), suffixIcon: const Icon(Icons.directions_car_outlined, size: 18)),
                    child: Text(vehicle == null ? tr('اختر المركبة — اكتب اللوحة للبحث…', 'Pick the vehicle — type the plate…') : _plateOf(vehicle)),
                  ),
                ),
                const SizedBox(height: 10),
              ],
              _DateBox(label: tr('التاريخ', 'Date'), value: date, clearable: false, onChanged: (x) => setS(() => date = x)),
              const SizedBox(height: 10),
              if (withEmployee) ...[
                _EmpBox(label: tr('الموظف', 'Employee'), emp: employee, onChanged: (e) => setS(() => employee = e)),
                const SizedBox(height: 10),
              ],
              TextField(controller: location, decoration: InputDecoration(labelText: tr('الموقع', 'Location'))),
              const SizedBox(height: 10),
              TextField(controller: reportNumber, decoration: InputDecoration(labelText: tr('رقم المحضر', 'Report number'))),
              const SizedBox(height: 10),
              dd(tr('المتسبب', 'Fault party'), fault, faultParty, (x) => fault = x),
              const SizedBox(height: 10),
              dd(tr('الخطورة', 'Severity'), severity, accidentSeverity, (x) => severity = x),
              const SizedBox(height: 10),
              dd(tr('الحالة', 'Status'), status, accidentStatus, (x) => status = x),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: estimated, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة التقديرية', 'Estimated cost')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: actual, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة الفعلية', 'Actual cost')))),
              ]),
              const SizedBox(height: 10),
              TextField(controller: desc, maxLines: 3, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('وصف الحادث *', 'Description *'))),
              const SizedBox(height: 10),
              TextField(controller: third, maxLines: 2, decoration: InputDecoration(labelText: tr('بيانات الطرف الثالث', 'Third-party details'))),
              const SizedBox(height: 10),
              TextField(controller: action, maxLines: 2, decoration: InputDecoration(labelText: tr('الإجراء المتخذ', 'Action taken'))),
              if (!withEmployee) ...[
                const SizedBox(height: 10),
                TextField(controller: resolution, maxLines: 2, decoration: InputDecoration(labelText: tr('التسوية', 'Resolution'))),
              ],
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: saving || desc.text.trim().isEmpty ? null : () async {
                    if (pickVehicle && vehicle == null) { _snack(c, tr('اختر المركبة أولًا.', 'Pick the vehicle first.')); return; }
                    setS(() => saving = true);
                    final body = <String, dynamic>{
                      'date': date, 'location': location.text.trim(), 'description': desc.text.trim(),
                      'faultParty': fault, 'severity': severity, 'status': status,
                      'thirdPartyDetails': third.text.trim(), 'actionTaken': action.text.trim(), 'reportNumber': reportNumber.text.trim(),
                      'estimatedCost': num.tryParse(estimated.text.trim()) ?? 0, 'actualCost': num.tryParse(actual.text.trim()) ?? 0,
                      if (!withEmployee) 'resolution': resolution.text.trim(),
                      if (withEmployee) 'employee': employee?['_id'] ?? '',
                    };
                    try {
                      if (editing) {
                        await Api.instance.put('/api/vehicles/accidents/${a['_id']}', body);
                      } else {
                        await Api.instance.post('/api/vehicles/${pickVehicle ? vehicle!['_id'] : vehicleId}/accidents', body);
                      }
                      if (c.mounted) Navigator.pop(c, true);
                    } catch (e) {
                      setS(() => saving = false);
                      if (c.mounted) _snack(c, e.toString());
                    }
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      );
    }),
  );
  return ok == true;
}

/// تعديلُ حادثٍ (اسمٌ قديمٌ تبقيه الشاشات) — النموذجُ الكامل نفسُه.
Future<void> editAccident(BuildContext context, Map<String, dynamic> a, Future<void> Function() onDone) async {
  if (await accidentFormSheet(context, accident: a)) await onDone();
}

Future<bool> _confirmDeleteAccident(BuildContext context, Map<String, dynamic> a) async {
  final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
    content: Text(tr('حذف هذا الحادث؟', 'Delete this accident?')),
    actions: [
      TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
    ],
  ));
  if (ok != true) return false;
  try { await Api.instance.delete('/api/vehicles/accidents/${a['_id']}'); return true; }
  catch (e) { if (context.mounted) _snack(context, e.toString()); return false; }
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
  int _tab = 0; // 0 نظرة عامة · 1 التفويضات · 2 الحوادث
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:updated', _onLive);
    Live.instance.on('vehicle:authorization', _onLive);
    Live.instance.on('vehicle:accident', _onLive);
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vehicle:updated', _onLive);
    Live.instance.off('vehicle:authorization', _onLive);
    Live.instance.off('vehicle:accident', _onLive);
    Live.instance.off('vreg:updated', _onLive);
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

  Map<String, dynamic>? get _active {
    for (final a in _auths) { if (a['status'] == 'active') return a; }
    return null;
  }

  // ── تفويض / نقل: نفسُ حقول الموقع ─────────────────────────────────────────
  Future<void> _authForm(String action) async {
    Map<String, dynamic>? emp;
    String start = _todayYmd(), docExpiry = '';
    final authType = TextEditingController(), docNumber = TextEditingController(), issuedBy = TextEditingController(), notes = TextEditingController();
    bool saving = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(action == 'authorize' ? tr('تفويض المركبة', 'Authorize vehicle') : tr('نقل التفويض', 'Transfer authorization'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              _EmpBox(label: action == 'transfer' ? tr('المفوَّض الجديد *', 'New holder *') : tr('الموظف *', 'Employee *'), emp: emp, onChanged: (e) => setS(() => emp = e)),
              const SizedBox(height: 10),
              _DateBox(label: tr('تاريخ البداية', 'Start date'), value: start, onChanged: (x) => setS(() => start = x)),
              const SizedBox(height: 10),
              TextField(controller: authType, decoration: InputDecoration(labelText: tr('نوع التفويض', 'Authorization type'))),
              const SizedBox(height: 10),
              TextField(controller: docNumber, decoration: InputDecoration(labelText: tr('رقم الوثيقة', 'Document number'))),
              const SizedBox(height: 10),
              _DateBox(label: tr('انتهاء الوثيقة', 'Document expiry'), value: docExpiry, onChanged: (x) => setS(() => docExpiry = x)),
              const SizedBox(height: 10),
              TextField(controller: issuedBy, decoration: InputDecoration(labelText: tr('جهة الإصدار', 'Issued by'))),
              const SizedBox(height: 10),
              TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: saving || emp == null ? null : () async {
                    setS(() => saving = true);
                    try {
                      await Api.instance.post('/api/vehicles/${widget.vehicleId}/$action', {
                        'employee': emp!['_id'], 'startDate': start, 'authorizationType': authType.text.trim(),
                        'documentNumber': docNumber.text.trim(), 'documentExpiry': docExpiry, 'issuedBy': issuedBy.text.trim(),
                        'notes': notes.text.trim(),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) { setS(() => saving = false); if (c.mounted) _snack(c, e.toString()); }
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  Future<void> _revoke() async {
    String end = _todayYmd();
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text(tr('إلغاء التفويض', 'Revoke authorization')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          _DateBox(label: tr('تاريخ النهاية', 'End date'), value: end, onChanged: (x) => setS(() => end = x)),
          const SizedBox(height: 10),
          TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: tr('سبب الإلغاء', 'Revoked reason'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.warn), onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/vehicles/${widget.vehicleId}/revoke', {'endDate': end, 'revokedReason': reason.text.trim()});
      _load();
    } catch (e) { if (mounted) _snack(context, e.toString()); }
  }

  Future<void> _addAccident() async {
    final act = _active;
    final ok = await accidentFormSheet(context, vehicleId: widget.vehicleId, withEmployee: true,
        defaultEmployee: act?['employee'] is Map ? Map<String, dynamic>.from(act!['employee']) : null);
    if (ok) _load();
  }

  // ── تصدير ملفّ المركبة: «التبويب الحالي» أو الملفّ كاملًا ──────────────────
  List<Map<String, dynamic>> _infoRows() {
    final v = _vehicle ?? {};
    final a = _active;
    final pairs = <(String, String, dynamic)>[
      ('رقم اللوحة', 'Plate number', v['plateNumber']), ('النوع', 'Type', vTypeLabel(v['type'])),
      ('الحالة', 'Status', _metaLabel(vehicleStatus, v['status'])),
      ('الصانع', 'Make', v['make']), ('الموديل', 'Model', v['model']), ('السنة', 'Year', v['year']), ('اللون', 'Color', v['color']),
      ('الفرع', 'Branch', v['branch'] is Map ? v['branch']['name'] : v['branch']),
      ('القسم', 'Department', v['department']), ('المشروع', 'Project', v['project']),
      ('انتهاء الاستمارة', 'Registration expiry', v['registrationExpiry'] == null ? null : _dd(v['registrationExpiry'])),
      ('انتهاء التأمين', 'Insurance expiry', v['insuranceExpiry'] == null ? null : _dd(v['insuranceExpiry'])),
      ('الحوادث', 'Accidents', v['accidentCount'] ?? 0),
      ('مُفوَّضة إلى', 'Authorized to', a != null ? empName(a['employee']) : tr('مركونة — بلا مفوَّض', 'Parked — no holder')),
      ('تاريخ البداية', 'Start date', a != null ? _dd(a['startDate']) : ''),
      ('نوع التفويض', 'Authorization type', a?['authorizationType']), ('رقم الوثيقة', 'Document number', a?['documentNumber']),
      ('انتهاء الوثيقة', 'Document expiry', a != null && a['documentExpiry'] != null ? _dd(a['documentExpiry']) : ''),
      ('جهة الإصدار', 'Issued by', a?['issuedBy']), ('ملاحظات', 'Notes', v['notes']),
    ];
    return pairs.where((p) => p.$3 != null && p.$3.toString().isNotEmpty && p.$3 != '—').map((p) => {'item': tr(p.$1, p.$2), 'value': p.$3}).toList();
  }

  List<ExportCol> get _infoCols => [ExportCol('البند', 'Field', (r) => r['item']), ExportCol('القيمة', 'Value', (r) => r['value'])];
  List<ExportCol> get _authCols => [
        ExportCol('الموظف', 'Employee', (r) => r['employee'] is Map ? empName(r['employee']) : '—'),
        ExportCol('الحالة', 'Status', (r) => _metaLabel(authStatus, r['status'])),
        ExportCol('تاريخ البداية', 'Start date', (r) => _dd(r['startDate'])),
        ExportCol('تاريخ النهاية', 'End date', (r) => r['endDate'] == null ? tr('حتى الآن', 'now') : _dd(r['endDate'])),
        ExportCol('نوع التفويض', 'Authorization type', (r) => r['authorizationType'] ?? ''),
        ExportCol('رقم الوثيقة', 'Document number', (r) => r['documentNumber'] ?? ''),
        ExportCol('انتهاء الوثيقة', 'Document expiry', (r) => _dd(r['documentExpiry'])),
        ExportCol('جهة الإصدار', 'Issued by', (r) => r['issuedBy'] ?? ''),
        ExportCol('منقول من', 'Transferred from', (r) => r['transferredFrom'] is Map ? empName(r['transferredFrom']) : '—'),
        ExportCol('منقول إلى', 'Transferred to', (r) => r['transferredTo'] is Map ? empName(r['transferredTo']) : '—'),
        ExportCol('سبب الإلغاء', 'Revoked reason', (r) => r['revokedReason'] ?? ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ];

  @override
  Widget build(BuildContext context) {
    final v = _vehicle ?? {};
    final st = vehicleStatus[v['status']] ?? ('—', '—', T.inkFaint);
    final active = _active;
    final infoSheet = (tr('تفاصيل المركبة', 'Vehicle details'), _infoCols, _infoRows());
    final authSheet = (tr('التفويضات', 'Authorizations'), _authCols, _auths);
    final accSheet = (tr('الحوادث', 'Accidents'), accidentExportCols(), _accidents);
    final tabSheet = _tab == 1 ? authSheet : _tab == 2 ? accSheet : infoSheet;

    return AppScaffold(
      title: Text(widget.plate),
      actions: [
        PopupMenuButton<String>(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          enabled: !_loading && _vehicle != null,
          onSelected: (k) => exportExcel(context, fileName: 'vehicle-${v['plateNumber'] ?? widget.vehicleId}', sheets: k == 'tab' ? [tabSheet] : [infoSheet, authSheet, accSheet]),
          itemBuilder: (_) => [
            PopupMenuItem(value: 'tab', child: Text(tr('التبويب الحالي', 'Current tab'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكلّ — ملفّ المركبة', 'Everything — full vehicle file'))),
          ],
        ),
        IconButton(icon: const Icon(Icons.edit_outlined), onPressed: _loading || _vehicle == null ? null : () => editVehicleSheet(context, v, _load)),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      topAccent: st.$3,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                          Chip2(tr(st.$1, st.$2), st.$3),
                        ]),
                        const SizedBox(height: 4),
                        Text([vTypeLabel(v['type']), [v['make'], v['model']].where((x) => (x ?? '').toString().isNotEmpty).join(' '), v['department'], v['project']]
                            .where((x) => (x ?? '').toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                        const SizedBox(height: 6),
                        active != null
                            ? Text('${tr('مُفوَّضة إلى', 'Authorized to')}: ${empName(active['employee'])} · ${tr('منذ', 'since')} ${_dd(active['startDate'])}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))
                            : Text(tr('مركونة — بلا مفوَّض', 'Parked — no holder'), style: const TextStyle(fontSize: 12.5, color: T.warn, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 10),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          if (active == null) _actBtn(Icons.how_to_reg_outlined, tr('تفويض', 'Authorize'), T.success, () => _authForm('authorize')),
                          if (active != null) _actBtn(Icons.swap_horiz_rounded, tr('نقل التفويض', 'Transfer'), T.info, () => _authForm('transfer')),
                          if (active != null) _actBtn(Icons.block, tr('إلغاء التفويض', 'Revoke'), T.warn, _revoke),
                          _actBtn(Icons.car_crash_outlined, tr('تسجيل حادث', 'Report accident'), T.danger, _addAccident),
                        ]),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    SegmentedButton<int>(
                      segments: [
                        ButtonSegment(value: 0, label: Text(tr('نظرة عامة', 'Overview'))),
                        ButtonSegment(value: 1, label: Text('${tr('التفويضات', 'Authorizations')}${_auths.isEmpty ? '' : ' (${_auths.length})'}')),
                        ButtonSegment(value: 2, label: Text('${tr('الحوادث', 'Accidents')}${_accidents.isEmpty ? '' : ' (${_accidents.length})'}')),
                      ],
                      selected: {_tab},
                      showSelectedIcon: false,
                      onSelectionChanged: (s) => setState(() => _tab = s.first),
                    ),
                    const SizedBox(height: 10),
                    if (_tab == 0) ..._overview(v, active),
                    if (_tab == 1) ..._authList(),
                    if (_tab == 2) ..._accidentList(),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  Widget _rows(String title, List<(String, dynamic)> rows, {Widget? footer}) {
    final shown = rows.where((r) => r.$2 != null && r.$2.toString().isNotEmpty && r.$2 != '—').toList();
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.orange)),
        const SizedBox(height: 6),
        ...shown.map((r) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(child: Text(r.$1, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
                Flexible(child: Text(r.$2.toString(), textAlign: TextAlign.end, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
              ]),
            )),
        if (footer != null) footer,
      ]),
    );
  }

  List<Widget> _overview(Map<String, dynamic> v, Map<String, dynamic>? a) => [
        _rows(tr('تفاصيل المركبة', 'Vehicle details'), [
          (tr('رقم اللوحة', 'Plate number'), v['plateNumber']), (tr('النوع', 'Type'), vTypeLabel(v['type'])),
          (tr('الصانع', 'Make'), v['make']), (tr('الموديل', 'Model'), v['model']), (tr('السنة', 'Year'), v['year']), (tr('اللون', 'Color'), v['color']),
          (tr('الفرع', 'Branch'), v['branch'] is Map ? v['branch']['name'] : ''),
          (tr('القسم', 'Department'), v['department']), (tr('المشروع', 'Project'), v['project']),
          (tr('انتهاء الاستمارة', 'Registration expiry'), _dd(v['registrationExpiry'])), (tr('انتهاء التأمين', 'Insurance expiry'), _dd(v['insuranceExpiry'])),
          (tr('الحوادث', 'Accidents'), v['accidentCount'] ?? 0),
        ], footer: (v['notes'] ?? '').toString().isEmpty ? null : Padding(padding: const EdgeInsets.only(top: 8), child: Text(v['notes'].toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)))),
        const SizedBox(height: 10),
        a == null
            ? AppCard(child: Text(tr('مركونة — بلا مفوَّض', 'Parked — no holder'), style: const TextStyle(color: T.inkFaint)))
            : _rows(tr('التفويض الحالي', 'Current authorization'), [
                (tr('الموظف', 'Employee'), empName(a['employee'])), (tr('تاريخ البداية', 'Start date'), _dd(a['startDate'])),
                (tr('نوع التفويض', 'Authorization type'), a['authorizationType']), (tr('رقم الوثيقة', 'Document number'), a['documentNumber']),
                (tr('انتهاء الوثيقة', 'Document expiry'), _dd(a['documentExpiry'])), (tr('جهة الإصدار', 'Issued by'), a['issuedBy']),
                (tr('منقول من', 'Transferred from'), _empNameOrBlank(a['transferredFrom'])),
              ]),
      ];

  List<Widget> _authList() => _auths.isEmpty
      ? [EmptyState(icon: Icons.assignment_ind_outlined, title: tr('لا توجد تفويضات', 'No authorizations'))]
      : _auths.map((a) {
          final ast = authStatus[a['status']] ?? ('—', '—', T.inkFaint);
          final lines = <String>[
            if ((a['authorizationType'] ?? '').toString().isNotEmpty) '${tr('نوع التفويض', 'Authorization type')}: ${a['authorizationType']}',
            if ((a['documentNumber'] ?? '').toString().isNotEmpty) '${tr('رقم الوثيقة', 'Document number')}: ${a['documentNumber']}',
            if (a['transferredTo'] is Map) '${tr('منقول إلى', 'Transferred to')}: ${empName(a['transferredTo'])}',
            if (a['transferredFrom'] is Map) '${tr('منقول من', 'Transferred from')}: ${empName(a['transferredFrom'])}',
            if ((a['revokedReason'] ?? '').toString().isNotEmpty) '${tr('سبب الإلغاء', 'Revoked reason')}: ${a['revokedReason']}',
            if ((a['notes'] ?? '').toString().isNotEmpty) a['notes'].toString(),
          ];
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: AppCard(
              topAccent: ast.$3,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(empName(a['employee']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                  Chip2(tr(ast.$1, ast.$2), ast.$3),
                ]),
                const SizedBox(height: 4),
                Text('${tr('الفترة', 'Period')}: ${_dd(a['startDate'])} ← ${a['endDate'] != null ? _dd(a['endDate']) : tr('حتى الآن', 'now')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                ...lines.map((l) => Text(l, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
              ]),
            ),
          );
        }).toList();

  List<Widget> _accidentList() => _accidents.isEmpty
      ? [EmptyState(icon: Icons.car_crash_outlined, title: tr('لا توجد حوادث', 'No accidents'))]
      : _accidents.map((a) => Padding(padding: const EdgeInsets.only(bottom: 8), child: _AccidentCard(a: a, showPlate: false))).toList();

  Widget _actBtn(IconData icon, String label, Color color, VoidCallback onTap) => ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: onTap,
      );
}

/// أعمدةُ تصدير الحوادث في ملفّ المركبة (كالموقع).
List<ExportCol> accidentExportCols() => [
      ExportCol('التاريخ', 'Date', (r) => _dd(r['date'])),
      ExportCol('الموظف', 'Employee', (r) => r['employee'] is Map ? empName(r['employee']) : '—'),
      ExportCol('الوصف', 'Description', (r) => r['description'] ?? ''),
      ExportCol('الموقع', 'Location', (r) => r['location'] ?? ''),
      ExportCol('رقم المحضر', 'Report number', (r) => r['reportNumber'] ?? ''),
      ExportCol('المتسبب', 'Fault party', (r) => _faultLabel(r['faultParty'])),
      ExportCol('الخطورة', 'Severity', (r) => _metaLabel(accidentSeverity, r['severity'] ?? 'minor')),
      ExportCol('الحالة', 'Status', (r) => _metaLabel(accidentStatus, r['status'] ?? 'reported')),
      ExportCol('التكلفة التقديرية', 'Estimated cost', (r) => r['estimatedCost'] ?? ''),
      ExportCol('التكلفة الفعلية', 'Actual cost', (r) => r['actualCost'] ?? ''),
      ExportCol('بيانات الطرف الثالث', 'Third-party details', (r) => r['thirdPartyDetails'] ?? ''),
      ExportCol('الإجراء المتخذ', 'Action taken', (r) => r['actionTaken'] ?? ''),
      ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
    ];

class _AccidentCard extends StatelessWidget {
  final Map<String, dynamic> a;
  final bool showPlate;
  final VoidCallback? onEdit, onDelete, onPlate;
  const _AccidentCard({required this.a, this.showPlate = true, this.onEdit, this.onDelete, this.onPlate});
  @override
  Widget build(BuildContext context) {
    final sev = accidentSeverity[a['severity'] ?? 'minor'] ?? ('—', '—', T.inkFaint);
    final ast = accidentStatus[a['status'] ?? 'reported'] ?? ('—', '—', T.inkFaint);
    return AppCard(
      topAccent: sev.$3,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (showPlate)
            InkWell(onTap: onPlate, child: Text(_plateOf(a['vehicle']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.navy)))
          else
            Text(_dd(a['date']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
          const Spacer(),
          Chip2(tr(ast.$1, ast.$2), ast.$3),
          if (onEdit != null) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft), onPressed: onEdit),
          if (onDelete != null) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: onDelete),
        ]),
        const SizedBox(height: 4),
        Text((a['description'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 5),
        Wrap(spacing: 6, runSpacing: 6, children: [
          if (showPlate) Chip2(_dd(a['date']), T.inkFaint, icon: Icons.event),
          Chip2(tr(sev.$1, sev.$2), sev.$3),
          Chip2(_faultLabel(a['faultParty']), T.violet),
          if (a['employee'] is Map) Chip2(empName(a['employee']), T.info, icon: Icons.person_outline),
          if ((a['actualCost'] ?? 0) != 0) Chip2('${tr('فعلي', 'Actual')}: ${a['actualCost']} ${tr('ر.س', 'SAR')}', T.danger)
          else if ((a['estimatedCost'] ?? 0) != 0) Chip2('${a['estimatedCost']} ${tr('ر.س', 'SAR')}', T.orange),
        ]),
      ]),
    );
  }
}

// ── قائمة الحوادث المستقلة ──────────────────────────────────────────────────
class AccidentsListScreen extends StatefulWidget {
  final String? initialStatus;
  const AccidentsListScreen({super.key, this.initialStatus});
  @override
  State<AccidentsListScreen> createState() => _AccidentsListScreenState();
}

class _AccidentsListScreenState extends State<AccidentsListScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late String _status = widget.initialStatus ?? '';
  String _q = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vehicle:accident', _onLive);
    // تصحيحُ اللوحة في السجلّ يُكتب في نسخ الحوادث — فتُعاد القراءة.
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vehicle:accident', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>[
        if (_q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
        if (_status.isNotEmpty) 'status=$_status',
      ];
      final d = await Api.instance.get('/api/vehicles/accidents${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = _l(d['accidents']); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<ExportCol> get _cols => [
        ExportCol('التاريخ', 'Date', (r) => _dd(r['date'])),
        ExportCol('رقم اللوحة', 'Plate number', (r) => _plateOf(r['vehicle'])),
        ExportCol('الموظف', 'Employee', (r) => r['employee'] is Map ? empName(r['employee']) : '—'),
        ExportCol('الوصف', 'Description', (r) => r['description'] ?? ''),
        ExportCol('المتسبب', 'Fault party', (r) => _faultLabel(r['faultParty'])),
        ExportCol('الخطورة', 'Severity', (r) => _metaLabel(accidentSeverity, r['severity'])),
        ExportCol('الحالة', 'Status', (r) => _metaLabel(accidentStatus, r['status'])),
        ExportCol('التكلفة الفعلية', 'Actual cost', (r) => r['actualCost'] ?? ''),
      ];

  Future<void> _export() async {
    String scope = 'shown';
    if (_q.trim().isNotEmpty || _status.isNotEmpty) {
      final s = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض (بعد الفلتر)', 'Shown (filtered)')), onTap: () => Navigator.pop(c, 'shown')),
        ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكلّ', 'Everything')), onTap: () => Navigator.pop(c, 'all')),
      ])));
      if (s == null) return;
      scope = s;
    }
    var rows = _rows;
    if (scope == 'all') {
      try { rows = _l((await Api.instance.get('/api/vehicles/accidents'))['accidents']); } catch (e) { if (mounted) _snack(context, e.toString()); return; }
    }
    if (!mounted) return;
    if (rows.isEmpty) { _snack(context, tr('لا صفوف للتصدير', 'Nothing to export')); return; }
    await exportExcel(context, fileName: 'accidents', sheets: [('Accidents', _cols, rows)]);
  }

  @override
  Widget build(BuildContext context) {
    final admin = isVehicleAdmin(context.watch<AuthProvider>());
    return AppScaffold(
      title: Text(tr('الحوادث', 'Accidents')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async { if (await accidentFormSheet(context, pickVehicle: true)) { _load(); if (context.mounted) _snack(context, tr('حُفظ.', 'Saved.')); } },
        icon: const Icon(Icons.add),
        label: Text(tr('تسجيل حادث', 'Report accident')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: TextField(
            onChanged: (v) {
              _q = v;
              final s = ++_seq;
              Future.delayed(const Duration(milliseconds: 300), () { if (mounted && s == _seq) _load(); });
            },
            decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${_rows.length}'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: accidentStatus.entries.map((e) {
                final selected = _status == e.key;
                return Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
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
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.car_crash_outlined, title: tr('لا توجد حوادث', 'No accidents'))])
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 10, 14, 90),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final a = _rows[i];
                                final vid = a['vehicle'] is Map ? (a['vehicle']['_id'] ?? '').toString() : (a['vehicle'] ?? '').toString();
                                return _AccidentCard(
                                  a: a,
                                  onPlate: vid.isEmpty ? null : () => Navigator.push(c, MaterialPageRoute(builder: (_) => VehicleDetailScreen(vehicleId: vid, plate: _plateOf(a['vehicle'])))),
                                  onEdit: () async { if (await accidentFormSheet(context, accident: a)) { _load(); if (context.mounted) _snack(context, tr('حُفظ.', 'Saved.')); } },
                                  onDelete: admin ? () async { if (await _confirmDeleteAccident(context, a)) _load(); } : null,
                                );
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}
