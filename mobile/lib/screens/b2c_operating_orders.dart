import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'b2c_column_filter.dart';
import 'light_transport_list.dart' show canEditLtUser;
import 'light_transport_profile.dart';

/// Operating orders, matching `/system/b2c/orders`: "this employee works on this vehicle, in this project and branch". Create an order (asking where the current vehicle driver goes), unassign and close (optionally revoking authorization), and transfer vehicle authorization.
class LtOperatingOrdersScreen extends StatefulWidget {
  /// Opens on a single employee's orders (like ?employee= on the web).
  final String? employee;
  const LtOperatingOrdersScreen({super.key, this.employee});
  @override
  State<LtOperatingOrdersScreen> createState() => _LtOperatingOrdersScreenState();
}

String _s(Map<String, dynamic>? m, String k) => (m?[k] ?? '').toString().trim();
String _ymd(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString());
  return d == null ? '' : d.toIso8601String().substring(0, 10);
}
String _today() => DateTime.now().toIso8601String().substring(0, 10);
String _err(Object e) => e is ApiException ? e.message : '$e';

String _statusAr(String s) => s == 'active' ? 'سارٍ' : s == 'hold' ? 'معلَّق' : 'مُغلَق';

final _cols = <ColDef>[
  ColDef('orderNumber', 'رقم الأمر', 'Order no.', (o) => _s(o, 'orderNumber')),
  ColDef('employeeName', 'الموظف', 'Employee', (o) => _s(o, 'employeeName')),
  ColDef('employeeIdNumber', 'رقم الهوية', 'ID', (o) => _s(o, 'employeeIdNumber')),
  ColDef('vehiclePlate', 'رقم اللوحة', 'Plate', (o) => _s(o, 'vehiclePlate')),
  ColDef('vehicleTypeAr', 'نوع المركبة', 'Vehicle type', (o) => _s(o, 'vehicleTypeAr')),
  ColDef('projectAr', 'المشروع', 'Project', (o) => _s(o, 'projectAr')),
  ColDef('cityAr', 'الفرع', 'Branch', (o) => _s(o, 'cityAr')),
  ColDef('supervisorName', 'المشرف', 'Supervisor', (o) => _s(o, 'supervisorName')),
  ColDef('housing', 'السكن', 'Housing', (o) => o['housing'] is Map ? _s((o['housing'] as Map).cast<String, dynamic>(), 'name') : ''),
  ColDef('startDate', 'من', 'From', (o) => _ymd(o['startDate'])),
  ColDef('endDate', 'إلى', 'To', (o) => _ymd(o['endDate'])),
  ColDef('status', 'الحالة', 'Status', (o) => _statusAr(_s(o, 'status'))),
  ColDef('authorization', 'التفويض', 'Authorisation', (o) => o['authorizationMoved'] == true ? 'نُقل' : ''),
  ColDef('authorizedNow', 'التفويض باسم', 'Authorised to', (o) => _s(o, 'authorizedNowName')),
  ColDef('createdByName', 'أنشأه', 'Created by', (o) => _s(o, 'createdByName')),
];

class _LtOperatingOrdersScreenState extends State<LtOperatingOrdersScreen> {
  List<Map<String, dynamic>> _orders = [];
  int _serverTotal = 0;
  Map<String, dynamic>? _opts;
  bool _loading = true;
  String? _error;
  String _q = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _q after a reload.
  Timer? _debounce;
  String _status = '';
  String _from = '', _to = '';
  bool _onlyMismatch = false;
  Map<String, Set<String>> _cf = {};
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('lt:*', _onLive);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    Live.instance.off('lt:*', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  void _onLive() { if (mounted) _load(); }

  Future<void> _load() async {
    final mine = ++_seq;
    final qp = {
      if (_from.isNotEmpty) 'from': _from,
      if (_to.isNotEmpty) 'to': _to,
      if (_q.isNotEmpty) 'q': _q,
      if ((widget.employee ?? '').isNotEmpty) 'employee': widget.employee!,
    };
    final qs = qp.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
    try {
      final d = await Api.instance.get('/api/light-transport/orders${qs.isEmpty ? '' : '?$qs'}') as Map;
      if (!mounted || mine != _seq) return;
      final rows = List<Map<String, dynamic>>.from(((d['orders'] as List?) ?? const []).map((x) => (x as Map).cast<String, dynamic>()));
      setState(() {
        _orders = rows;
        _serverTotal = ((d['totals'] as Map?)?['total'] as num?)?.toInt() ?? rows.length;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = _err(e); _loading = false; });
    }
  }

  Future<Map<String, dynamic>?> _options() async {
    if (_opts != null) return _opts;
    try {
      final d = await Api.instance.get('/api/light-transport/orders/options') as Map;
      _opts = d.cast<String, dynamic>();
      return _opts;
    } catch (e) {
      _say(tr('تعذّر تحميل الخيارات', 'Could not load options'));
      return null;
    }
  }

  List<Map<String, dynamic>> _list(String k) => List<Map<String, dynamic>>.from(((_opts?[k] as List?) ?? const []).map((x) => (x as Map).cast<String, dynamic>()));

  void _say(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  // Unassign and close
  Future<void> _end(Map<String, dynamic> o) async {
    final reason = TextEditingController();
    bool release = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
        title: Text(tr('إنزال وإغلاق الأمر', 'Take off & close')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('يُنزَل ${_s(o, 'employeeName')} عن ${_s(o, 'vehiclePlate').isEmpty ? 'المركبة' : _s(o, 'vehiclePlate')}؟',
              'Take ${_s(o, 'employeeName')} off ${_s(o, 'vehiclePlate').isEmpty ? 'the vehicle' : _s(o, 'vehiclePlate')}?')),
          const SizedBox(height: 10),
          TextField(controller: reason, decoration: InputDecoration(labelText: tr('السبب (اختياري)', 'Reason (optional)'))),
          const SizedBox(height: 6),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero, value: release,
            title: Text(tr('يُرفَع التفويضُ عن المركبة أيضًا (يُكتب في سجلّ المركبات)', 'Also release the vehicle authorisation (written in the vehicle registry)'), style: const TextStyle(fontSize: 13)),
            onChanged: (v) => setD(() => release = v == true),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إنزال', 'Take off'))),
        ],
      )),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (ok != true) return;
    try {
      await Api.instance.post('/api/light-transport/orders/${o['_id']}/end', {'reason': why, 'releaseAuthorization': release});
      _load();
    } catch (e) { _say(_err(e)); }
  }

  // Transfer vehicle authorization
  Future<void> _move(Map<String, dynamic> o) async {
    if (await _options() == null || !mounted) return;
    final vid = o['vehicle'] is Map ? '${o['vehicle']['_id']}' : '${o['vehicle'] ?? ''}';
    final v = _list('vehicles').firstWhere((x) => _s(x, '_id') == vid, orElse: () => {});
    final moved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (_) => _MoveSheet(
        vehicle: vid, plate: _s(o, 'vehiclePlate').isNotEmpty ? _s(o, 'vehiclePlate') : _s(v, 'plateNumber'),
        currentName: _s(v, 'authorizedName'), currentId: _s(v, 'authorizedId'),
        toEmployee: _s(o, 'ltEmployee'), authorizationNumber: _s(o, 'authorizationNumber'),
        expiryDate: _ymd(o['authorizationEnd']), employees: _list('employees'),
      ),
    );
    if (moved == true) _load();
  }

  Future<void> _create() async {
    if (await _options() == null || !mounted) return;
    final created = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (_) => _CreateSheet(opts: _opts!, employee: widget.employee),
    );
    if (created == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = canEditLtUser(context.read<AuthProvider>());
    final colRows = applyColumnFilters(_orders, _cols, _cf);
    bool statusOk(Map<String, dynamic> o) => _status.isEmpty || o['status'] == _status;
    bool mismatchOk(Map<String, dynamic> o) => !_onlyMismatch || o['authorizationMismatch'] == true;
    final shown = colRows.where((o) => statusOk(o) && mismatchOk(o)).toList();
    final noStatus = colRows.where(mismatchOk).toList();
    final active = noStatus.where((o) => o['status'] == 'active').length;
    final ended = noStatus.where((o) => o['status'] == 'ended').length;
    final moved = shown.where((o) => o['authorizationMoved'] == true).length;
    final mismatch = colRows.where((o) => statusOk(o) && o['authorizationMismatch'] == true).length;

    Widget stat(String label, int v, Color c, {VoidCallback? onTap, bool on = false}) => Expanded(
          child: InkWell(
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: on ? T.orange : T.line, width: on ? 2 : 1)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, maxLines: 2, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, height: 1.2)),
                Text('$v', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: c)),
              ]),
            ),
          ),
        );

    Widget date(String label, String value, ValueChanged<String> on) => Expanded(
          child: InkWell(
            onTap: () async {
              final d = await showDatePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime(2100), initialDate: DateTime.tryParse(value) ?? DateTime.now());
              if (d != null) { on(d.toIso8601String().substring(0, 10)); _load(); }
            },
            child: InputDecorator(
              decoration: InputDecoration(isDense: true, labelText: label,
                  suffixIcon: value.isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () { on(''); _load(); })),
              child: Text(value),
            ),
          ),
        );

    return AppScaffold(
      title: Text(tr('أوامر التشغيل', 'Operating orders')),
      actions: [
        ExportButton(fileName: 'lt-orders', sheetName: 'Orders', columns: [for (final c in _cols) ExportCol(c.ar, c.en, c.get)], rows: () => shown),
      ],
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: Text(tr('إنشاء أمر تشغيل', 'New operating order')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 300)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 90), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    Row(children: [
                      stat(tr('الإجمالي', 'Total'), shown.length, T.ink, onTap: () => setState(() => _status = ''), on: _status.isEmpty),
                      const SizedBox(width: 6),
                      stat(tr('سارية', 'Active'), active, T.success, onTap: () => setState(() => _status = _status == 'active' ? '' : 'active'), on: _status == 'active'),
                      const SizedBox(width: 6),
                      stat(tr('مُغلَقة', 'Ended'), ended, T.inkFaint, onTap: () => setState(() => _status = _status == 'ended' ? '' : 'ended'), on: _status == 'ended'),
                    ]),
                    const SizedBox(height: 6),
                    Row(children: [
                      stat(tr('نُقل معها التفويض', 'Authorisation moved'), moved, T.info),
                      const SizedBox(width: 6),
                      // The paper is in a name other than the rider's; shown explicitly, otherwise it is found only at a violation.
                      stat(tr('التفويض باسم غير الراكب', 'Authorised to someone else'), mismatch, mismatch > 0 ? T.warn : T.ink,
                          onTap: () => setState(() => _onlyMismatch = !_onlyMismatch), on: _onlyMismatch),
                    ]),
                    const SizedBox(height: 10),
                    SearchField(
                      controller: _searchCtl,
                      dense: true,
                      hint: tr('رقم الأمر · الموظف · الهوية · اللوحة…', 'order no., employee, ID, plate…'),
                      onChanged: (v) { _q = v.trim(); _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), _load); },
                    ),
                    const SizedBox(height: 8),
                    Row(children: [
                      date(tr('من تاريخ', 'From'), _from, (v) => setState(() => _from = v)),
                      const SizedBox(width: 8),
                      date(tr('إلى تاريخ', 'To'), _to, (v) => setState(() => _to = v)),
                    ]),
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      OutlinedButton.icon(
                        onPressed: () async {
                          final r = await showColumnFilters(context, cols: _cols, rows: _orders, current: _cf);
                          if (r != null) setState(() => _cf = r);
                        },
                        icon: const Icon(Icons.view_column_outlined, size: 16),
                        label: Text(_cf.isEmpty ? tr('فلاتر الأعمدة', 'Column filters') : tr('فلاتر الأعمدة (${_cf.length})', 'Column filters (${_cf.length})')),
                      ),
                      if (_cf.isNotEmpty || _status.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty || _onlyMismatch)
                        TextButton(onPressed: () { setState(() { _cf = {}; _status = ''; _from = ''; _to = ''; _onlyMismatch = false; }); _load(); }, child: Text(tr('مسح', 'Clear'))),
                      Text('${shown.length} / $_serverTotal', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    ]),
                    const SizedBox(height: 6),
                    if (shown.isEmpty)
                      EmptyState(icon: Icons.assignment_ind_outlined, title: _q.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا أوامر تشغيل', 'No operating orders'))
                    else
                      for (final o in shown) _tile(o, canEdit),
                  ]),
                ),
    );
  }

  Widget _tile(Map<String, dynamic> o, bool canEdit) {
    final st = _s(o, 'status');
    final open = st == 'active' || st == 'hold';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: InkWell(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LightTransportProfileScreen(id: _s(o, 'ltEmployee')))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_s(o, 'employeeName'), style: const TextStyle(fontWeight: FontWeight.w800)),
                Text([_s(o, 'orderNumber'), _s(o, 'employeeIdNumber'), _s(o, 'vehiclePlate'), _s(o, 'vehicleTypeAr')].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                Text([_s(o, 'projectAr'), _s(o, 'cityAr'), _s(o, 'supervisorName'), _cols[8].get(o)].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                Text('${_ymd(o['startDate'])} → ${_ymd(o['endDate']).isEmpty ? '—' : _ymd(o['endDate'])}${_s(o, 'createdByName').isEmpty ? '' : ' · ${_s(o, 'createdByName')}'}',
                    style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                const SizedBox(height: 4),
                Wrap(spacing: 5, runSpacing: 5, children: [
                  Chip2(tr(_statusAr(st), st == 'active' ? 'Active' : st == 'hold' ? 'On hold' : 'Ended'), st == 'active' ? T.success : st == 'hold' ? T.warn : T.inkFaint),
                  if (o['authorizationMoved'] == true)
                    Chip2('${tr('نُقل التفويض', 'auth. moved')}${_s(o, 'authorizationNumber').isEmpty ? '' : ' · ${_s(o, 'authorizationNumber')}'}', T.success),
                  if (_s(o, 'authorizedNowName').isNotEmpty)
                    Chip2('${tr('التفويض باسم', 'Authorised to')} ${_s(o, 'authorizedNowName')}${o['authorizationMismatch'] == true ? ' ⚠' : ''}',
                        o['authorizationMismatch'] == true ? T.warn : T.inkFaint),
                ]),
              ]),
            ),
          ),
          if (canEdit && (o['vehicle'] != null || open))
            PopupMenuButton<String>(
              onSelected: (a) { if (a == 'move') _move(o); if (a == 'end') _end(o); },
              itemBuilder: (_) => [
                if (o['vehicle'] != null) PopupMenuItem(value: 'move', child: ListTile(dense: true, leading: const Icon(Icons.swap_horiz, color: T.info), title: Text(tr('نقل تفويض المركبة', 'Move the vehicle authorisation')))),
                if (open) PopupMenuItem(value: 'end', child: ListTile(dense: true, leading: const Icon(Icons.stop_circle_outlined, color: T.danger), title: Text(tr('إنزال وإغلاق الأمر', 'Take off & close')))),
              ],
            ),
        ]),
      ),
    );
  }
}

/// Pick from a long list with search, the counterpart of SearchableSelect.
Future<String?> _pick(BuildContext context, String title, List<(String, String)> options) => showModalBottomSheet<String>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (c) {
        var q = '';
        return StatefulBuilder(builder: (c, setD) {
          final list = q.isEmpty ? options : options.where((o) => o.$2.toLowerCase().contains(q.toLowerCase())).toList();
          return SafeArea(
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.8,
              child: Column(children: [
                Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SearchField(autofocus: true, dense: true, hint: tr('ابحث…', 'Search…'), onChanged: (v) => setD(() => q = v.trim())),
                ),
                Expanded(child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                  for (final o in list) ListTile(dense: true, title: Text(o.$2), onTap: () => Navigator.pop(c, o.$1)),
                ])),
              ]),
            ),
          );
        });
      },
    );

Widget _pickerField(BuildContext context, String label, String shown, VoidCallback onTap) => InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.arrow_drop_down)),
        child: Text(shown.isEmpty ? '—' : shown, maxLines: 2, overflow: TextOverflow.ellipsis),
      ),
    );

Widget _dateField(BuildContext context, String label, String value, ValueChanged<String> on) => InkWell(
      onTap: () async {
        final d = await showDatePicker(context: context, firstDate: DateTime(2015), lastDate: DateTime(2100), initialDate: DateTime.tryParse(value) ?? DateTime.now());
        if (d != null) on(d.toIso8601String().substring(0, 10));
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, isDense: true,
            suffixIcon: value.isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => on(''))),
        child: Text(value),
      ),
    );

class _MoveSheet extends StatefulWidget {
  final String vehicle, plate, currentName, currentId, toEmployee, authorizationNumber, expiryDate;
  final List<Map<String, dynamic>> employees;
  const _MoveSheet({required this.vehicle, required this.plate, required this.currentName, required this.currentId,
      required this.toEmployee, required this.authorizationNumber, required this.expiryDate, required this.employees});
  @override
  State<_MoveSheet> createState() => _MoveSheetState();
}

class _MoveSheetState extends State<_MoveSheet> {
  late String _to = widget.toEmployee;
  late final _num = TextEditingController(text: widget.authorizationNumber);
  final _reason = TextEditingController();
  String _start = _today();
  late String _end = widget.expiryDate;
  bool _saving = false;

  @override
  void dispose() { _num.dispose(); _reason.dispose(); super.dispose(); }

  String _label(String id) {
    if (id.isEmpty) return tr('— رفع التفويض بلا بديل —', '— release with no replacement —');
    final e = widget.employees.firstWhere((x) => _s(x, '_id') == id, orElse: () => {});
    return e.isEmpty ? id : '${_s(e, 'name')} — ${_s(e, 'idNumber')}';
  }

  Future<void> _submit() async {
    setState(() => _saving = true);
    try {
      final r = await Api.instance.post('/api/light-transport/authorization/move', {
        'vehicle': widget.vehicle, 'toEmployee': _to, 'authorizationNumber': _num.text.trim(),
        'startDate': _start, 'expiryDate': _end, 'reason': _reason.text.trim(),
      });
      if (!mounted) return;
      final v = (r['vehicle'] as Map?) ?? const {};
      final name = (v['authorizedPerson'] as Map?)?['name'];
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تفويض ${v['plateNumber']} → ${name ?? '(رُفع)'}', '${v['plateNumber']} → ${name ?? '(released)'}'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_err(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('نقل تفويض المركبة', 'Move vehicle authorisation'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          gap,
          Container(
            width: double.infinity, padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('المركبة', 'Vehicle')}: ${widget.plate}', style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${tr('التفويض الآن باسم', 'Currently authorised to')}: ${widget.currentName.isEmpty ? tr('(لا أحد)', '(nobody)') : widget.currentName}${widget.currentId.isEmpty ? '' : ' · ${widget.currentId}'}',
                  style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            ]),
          ),
          gap,
          _pickerField(context, tr('يُنقَل إلى', 'Move to'), _label(_to), () async {
            final v = await _pick(context, tr('يُنقَل إلى', 'Move to'), [
              ('', tr('— رفع التفويض بلا بديل —', '— release with no replacement —')),
              for (final e in widget.employees) (_s(e, '_id'), '${_s(e, 'name')} — ${_s(e, 'idNumber')}'),
            ]);
            if (v != null) setState(() => _to = v);
          }),
          gap,
          TextField(controller: _num, decoration: InputDecoration(labelText: tr('رقم التفويض', 'Authorisation no.'))),
          gap,
          Row(children: [
            Expanded(child: _dateField(context, tr('من تاريخ', 'Starts'), _start, (v) => setState(() => _start = v))),
            const SizedBox(width: 10),
            Expanded(child: _dateField(context, tr('إلى تاريخ', 'Ends'), _end, (v) => setState(() => _end = v))),
          ]),
          gap,
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('السبب', 'Reason'))),
          gap,
          Text(tr('يُكتب في سجلّ المركبات ويُقيَّد في سجلّ تجديداتها وفي سجلّ الموظفين — عند مَن أخذها ومَن فقدها.',
                  'Written into the vehicle registry, its renewal trail, and both employees’ history — the one who gained it and the one who lost it.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _submit, child: Text(tr('نقل التفويض', 'Move it')))),
        ]),
      ),
    );
  }
}

class _CreateSheet extends StatefulWidget {
  final Map<String, dynamic> opts;
  final String? employee;
  const _CreateSheet({required this.opts, this.employee});
  @override
  State<_CreateSheet> createState() => _CreateSheetState();
}

class _CreateSheetState extends State<_CreateSheet> {
  List<Map<String, dynamic>> _l(String k) => List<Map<String, dynamic>>.from(((widget.opts[k] as List?) ?? const []).map((x) => (x as Map).cast<String, dynamic>()));
  late final _emps = _l('employees');
  late final _vehs = _l('vehicles');
  late final _houses = _l('housing');
  late final _sups = _l('supervisors');

  String _emp = '', _veh = '', _sup = '', _house = '', _room = '';
  final _project = TextEditingController();
  final _city = TextEditingController();
  final _authNum = TextEditingController();
  final _notes = TextEditingController();
  String _start = _today(), _authStart = '', _authEnd = '';
  bool _moveAuth = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final pre = (widget.employee ?? '').isEmpty ? null : _emps.firstWhere((x) => _s(x, '_id') == widget.employee, orElse: () => {});
    if (pre != null && pre.isNotEmpty) {
      _emp = _s(pre, '_id');
      _project.text = _s(pre, 'projectAr');
      _city.text = _s(pre, 'cityAr');
      _sup = _s(pre, 'supervisorUser');
    }
  }

  @override
  void dispose() { _project.dispose(); _city.dispose(); _authNum.dispose(); _notes.dispose(); super.dispose(); }

  Map<String, dynamic> _find(List<Map<String, dynamic>> l, String id) => l.firstWhere((x) => _s(x, '_id') == id, orElse: () => {});

  void _onEmployee(String id) {
    final e = _find(_emps, id);
    setState(() {
      _emp = id;
      if (_s(e, 'vehicle').isNotEmpty) _veh = _s(e, 'vehicle');
      if (_project.text.trim().isEmpty) _project.text = _s(e, 'projectAr');
      if (_city.text.trim().isEmpty) _city.text = _s(e, 'cityAr');
      if (_sup.isEmpty) _sup = _s(e, 'supervisorUser');
    });
  }

  /// The vehicle has an actual driver other than this employee: where does he go? (stays without a vehicle or moves to a vehicle with no driver)
  Future<String?> _askDriver(Map<String, dynamic> v) async {
    String to = 'none';
    return showDialog<String>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
        title: Text(tr('للمركبة قائدٌ فعليّ', 'This vehicle has a driver')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(tr('المركبة ${_s(v, 'plateNumber')} قائدُها الفعليّ ${_s(v, 'driverName')}. أين يذهب؟', '${_s(v, 'plateNumber')} is driven by ${_s(v, 'driverName')}. Where does he go?')),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            isExpanded: true, initialValue: to,
            items: [
              DropdownMenuItem(value: 'none', child: Text(tr('يبقى بلا مركبة', 'No vehicle'))),
              for (final x in _vehs.where((x) => _s(x, 'driverId').isEmpty && _s(x, '_id') != _veh))
                DropdownMenuItem(value: _s(x, '_id'), child: Text('${tr('ينتقل إلى', 'Moves to')} ${_s(x, 'plateNumber')}${_s(x, 'typeAr').isEmpty ? '' : ' · ${_s(x, 'typeAr')}'}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setD(() => to = v ?? 'none'),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, to), child: Text(tr('متابعة', 'Continue'))),
        ],
      )),
    );
  }

  Future<void> _submit() async {
    if (_emp.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اختر الموظف', 'Pick the employee'))));
      return;
    }
    String? driverTo;
    final v = _find(_vehs, _veh);
    if (_s(v, 'driverId').isNotEmpty && _s(v, 'driverId') != _emp) {
      driverTo = await _askDriver(v);
      if (driverTo == null) return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/light-transport/orders', {
        'ltEmployee': _emp, 'projectAr': _project.text.trim(), 'cityAr': _city.text.trim(),
        'supervisorUser': _sup, 'vehicle': _veh, 'housing': _house, 'housingRoom': _room,
        'startDate': _start, 'moveAuthorization': _moveAuth,
        'authorizationNumber': _authNum.text.trim(), 'authorizationStart': _authStart, 'authorizationEnd': _authEnd,
        'notesAr': _notes.text.trim(),
        if (driverTo != null) 'currentDriverTo': driverTo,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('صدر أمر التشغيل', 'Operating order created'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_err(e))));
    }
  }

  String _vehLabel(Map<String, dynamic> v) =>
      '${_s(v, 'plateNumber')}${_s(v, 'typeAr').isEmpty ? '' : ' · ${_s(v, 'typeAr')}'}${_s(v, 'driverName').isNotEmpty ? ' — ${tr('قائدها الفعلي', 'driver')} ${_s(v, 'driverName')}' : ' — ${tr('بلا قائد', 'no driver')}'}';

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    final emp = _find(_emps, _emp);
    final veh = _find(_vehs, _veh);
    final house = _find(_houses, _house);
    // Rooms: those that fit the employee type (rider/administrative) or "any".
    final rooms = List<Map<String, dynamic>>.from(((house['rooms'] as List?) ?? const []).map((x) => (x as Map).cast<String, dynamic>()))
        .where((r) => r['kind'] == 'any' || emp.isEmpty || r['kind'] == emp['staffKind']).toList();
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('إنشاء أمر تشغيل', 'New operating order'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          gap,
          _pickerField(context, tr('الموظف', 'Employee'), emp.isEmpty ? '' : '${_s(emp, 'name')} — ${_s(emp, 'idNumber')}', () async {
            final v = await _pick(context, tr('الموظف', 'Employee'), [
              for (final e in _emps) (_s(e, '_id'), '${_s(e, 'name')} — ${_s(e, 'idNumber')}${_s(e, 'jobTitleAr').isEmpty ? '' : ' · ${_s(e, 'jobTitleAr')}'}'),
            ]);
            if (v != null) _onEmployee(v);
          }),
          gap,
          _pickerField(context, tr('المركبة', 'Vehicle'), veh.isEmpty ? '' : _vehLabel(veh), () async {
            final v = await _pick(context, tr('المركبة', 'Vehicle'), [for (final x in _vehs) (_s(x, '_id'), _vehLabel(x))]);
            if (v != null) setState(() => _veh = v);
          }),
          gap,
          Row(children: [
            Expanded(child: TextField(controller: _project, decoration: InputDecoration(labelText: tr('المشروع', 'Project')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _city, decoration: InputDecoration(labelText: tr('الفرع', 'Branch')))),
          ]),
          gap,
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _sups.any((s) => _s(s, '_id') == _sup) ? _sup : '',
            decoration: InputDecoration(labelText: tr('المشرف', 'Supervisor')),
            items: [
              DropdownMenuItem(value: '', child: Text(tr('— كما هو على الموظّف —', '— keep the employee’s —'))),
              for (final s in _sups) DropdownMenuItem(value: _s(s, '_id'), child: Text('${_s(s, 'name')} — ${_s(s, 'roleAr')}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _sup = v ?? ''),
          ),
          gap,
          _dateField(context, tr('تاريخ البداية', 'Start date'), _start, (v) => setState(() => _start = v)),
          gap,
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              isExpanded: true, initialValue: _house,
              decoration: InputDecoration(labelText: tr('السكن', 'Housing')),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('— بلا سكن —', '— none —'))),
                for (final h in _houses) DropdownMenuItem(value: _s(h, '_id'), child: Text(_s(h, 'name'), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() { _house = v ?? ''; _room = ''; }),
            )),
            const SizedBox(width: 10),
            Expanded(child: DropdownButtonFormField<String>(
              key: ValueKey('room-$_house'),
              isExpanded: true, initialValue: rooms.any((r) => r['name'] == _room) ? _room : '',
              decoration: InputDecoration(labelText: tr('الغرفة', 'Room')),
              items: [
                DropdownMenuItem(value: '', child: Text(_house.isEmpty ? tr('اختر السكن أولًا', 'pick housing first') : tr('— اختر الغرفة —', '— pick a room —'))),
                for (final r in rooms) DropdownMenuItem(value: '${r['name']}', child: Text('${r['name']} (${r['capacity']})')),
              ],
              onChanged: _house.isEmpty ? null : (v) => setState(() => _room = v ?? ''),
            )),
          ]),
          gap,
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              CheckboxListTile(
                contentPadding: EdgeInsets.zero, value: _moveAuth,
                title: Text(tr('نقل تفويض المركبة إلى هذا الموظف', 'Move the vehicle authorisation to this employee'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                onChanged: (v) => setState(() => _moveAuth = v == true),
              ),
              Text(tr('يُكتب في سجلّ المركبات ويُقيَّد في سجلّ تجديداتها — فلا يبقى للمركبة مفوَّضان، أحدهما عند هذا القسم والآخر عند قسم المركبات.',
                      'Written into the vehicle registry and recorded in that vehicle’s renewal trail, so a vehicle can never have two authorised holders.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              if (_moveAuth && _s(veh, 'authorizedName').isNotEmpty)
                Text(tr('المركبة مفوَّضة الآن لـ${_s(veh, 'authorizedName')} — سيُستبدَل بالتفويض الجديد.', 'Currently authorised to ${_s(veh, 'authorizedName')} — it will be replaced.'),
                    style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w700)),
              if (_moveAuth) ...[
                gap,
                TextField(controller: _authNum, decoration: InputDecoration(labelText: tr('رقم التفويض', 'Authorisation no.'))),
                gap,
                Row(children: [
                  Expanded(child: _dateField(context, tr('بداية التفويض', 'Starts'), _authStart, (v) => setState(() => _authStart = v))),
                  const SizedBox(width: 10),
                  Expanded(child: _dateField(context, tr('نهاية التفويض', 'Ends'), _authEnd, (v) => setState(() => _authEnd = v))),
                ]),
              ],
            ]),
          ),
          gap,
          TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _submit, child: Text(tr('إصدار الأمر', 'Create order')))),
        ]),
      ),
    );
  }
}
