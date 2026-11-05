import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/api_picker.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/file_upload.dart';
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show VehicleRegistryDetailScreen;

// Accidents and insurance claims, mirrors /system/vehicles/registry/claims and claims/[id] on web. The question here is money: what we paid and what we will recover.
// Permissions mirror lib/vehicleRegistry.ts exactly:
// canEditVehicles: register a new accident and attach its papers.
// canEditClaims: edit and delete the accident and rename or delete an attachment (guarded by authorize.strict on the server, so a section grant does not open it).

const _editRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'];
const _claimEditRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'vehicles_manager'];

bool _canEditVehicles(AuthProvider a) =>
    a.user != null && (_editRoles.contains(a.role) || a.canEditSection('Vehicles'));
bool _canEditClaims(AuthProvider a) => a.user != null && _claimEditRoles.contains(a.role);

const _base = '/api/vehicle-registry/claims';

String _money(dynamic v) {
  final nn = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = nn < 0;
  final s = nn.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return '${neg ? '-' : ''}$b';
}
String _fmtDate(dynamic d) {
  if (d == null || d.toString().isEmpty) return '—';
  return d.toString().split('T').first;
}
String _ymd(dynamic d) => (d == null || d.toString().isEmpty) ? '' : d.toString().split('T').first;
Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic v) =>
    v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
String _s(dynamic v) => v == null ? '' : v.toString();
num? _num(dynamic v) => v is num ? v : num.tryParse(_s(v));
bool _closed(Map r) => r['statusCode'] == 'closed';
String _statusText(Map r) => _closed(r) ? tr('مقفولة', 'Closed') : tr('قيد المتابعة', 'Pending');
String _err(Object e) => e is ApiException ? e.message : e.toString();

/// Days since the last insurer reply; null if no reply is recorded.
int? _staleDays(Map r) {
  final d = DateTime.tryParse(_s(_m(r['claim'])['lastInsurerUpdateDate']));
  if (d == null) return null;
  return DateTime.now().difference(d).inMilliseconds ~/ 86400000;
}

// Funnel columns and the reader of each, mirrors COL_DEFS/GETTERS on web.
final List<(String, String, String, String Function(Map<String, dynamic>))> _cols = [
  ('plate', 'اللوحة', 'Plate', (r) => _s(r['vehiclePlate']).isNotEmpty ? _s(r['vehiclePlate']) : _s(r['incidentSubjectAr'])),
  ('date', 'التاريخ', 'Date', (r) => _fmtDate(r['accidentDate'])),
  ('driver', 'اسم السائق', 'Driver', (r) => _s(r['driverNameAr'])),
  ('driverId', 'رقم الإقامة', 'Iqama', (r) => _s(r['driverIdNumber'])),
  ('vehicleType', 'نوع السيارة', 'Vehicle type', (r) => _s(r['vehicleTypeAr'])),
  ('estimateNo', 'رقم التقدير', 'Estimate no.', (r) => _s(r['reportOrEstimateNumber'])),
  ('reportedVia', 'تم الإبلاغ عبر', 'Reported via', (r) => _s(r['reportedViaAr'])),
  ('claimNumber', 'رقم المطالبة', 'Claim no.', (r) => _s(_m(r['claim'])['claimNumber'])),
  ('fault', 'نسبة الخطأ', 'Fault', (r) => r['faultPercent'] == null ? '' : '${r['faultPercent']}%'),
  ('insurer', 'شركة التأمين', 'Insurer', (r) => _s(_m(r['claim'])['insurerAr'])),
  ('estimated', 'مبلغ التقدير', 'Estimate amount',
      (r) => (_num(_m(r['claim'])['estimatedAmountSar']) ?? 0) != 0 ? _money(_m(r['claim'])['estimatedAmountSar']) : ''),
  ('recovery', 'المبلغ المسترد', 'Recovered amount',
      (r) => (_num(_m(r['claim'])['expectedRecoverySar']) ?? 0) != 0 ? _money(_m(r['claim'])['expectedRecoverySar']) : ''),
  ('gap', 'الفرق', 'Difference', (r) => _m(r['claim'])['recoveryGapSar'] != null ? _money(_m(r['claim'])['recoveryGapSar']) : ''),
  ('status', 'الحالة', 'Status', (r) => _closed(r) ? 'مقفولة' : 'قيد المتابعة'),
  ('lastReply', 'آخر رد', 'Last reply', (r) => _fmtDate(_m(r['claim'])['lastInsurerUpdateDate'])),
  ('files', 'المرفقات', 'Files', (r) => _list(r['attachments']).isEmpty ? '' : '${_list(r['attachments']).length}'),
  ('notes', 'الملاحظات', 'Notes', (r) => _s(_m(r['claim'])['notesAr'])),
];

// Export columns, the same as the web ExportMenu columns.
List<ExportCol> _exportCols() => [
  ExportCol('رقم الحادث', 'Accident no.', (r) => _s(r['accidentNumber'])),
  ExportCol('اللوحة', 'Plate', (r) => _s(r['vehiclePlate'])),
  ExportCol('التاريخ', 'Date', (r) => _fmtDate(r['accidentDate'])),
  // Empty stays empty: a zero fault is a result, and absence is not zero.
  ExportCol('نسبة الخطأ %', 'Fault %', (r) => r['faultPercent'] ?? ''),
  ExportCol('شركة التأمين', 'Insurer', (r) => _s(_m(r['claim'])['insurerAr'])),
  ExportCol('مبلغ التقدير', 'Estimate amount', (r) => _m(r['claim'])['estimatedAmountSar'] ?? ''),
  ExportCol('المبلغ المسترد', 'Recovered amount', (r) => _m(r['claim'])['expectedRecoverySar'] ?? ''),
  ExportCol('الحالة', 'Status', (r) => _statusText(r)),
  ExportCol('اسم السائق', 'Driver', (r) => _s(r['driverNameAr'])),
  ExportCol('رقم الإقامة', 'Iqama', (r) => _s(r['driverIdNumber'])),
  ExportCol('نوع السيارة', 'Vehicle type', (r) => _s(r['vehicleTypeAr'])),
  ExportCol('رقم التقدير', 'Estimate no.', (r) => _s(r['reportOrEstimateNumber'])),
  ExportCol('تم الإبلاغ عبر', 'Reported via', (r) => _s(r['reportedViaAr'])),
  ExportCol('رقم المطالبة', 'Claim no.', (r) => _s(_m(r['claim'])['claimNumber'])),
  ExportCol('الفرق', 'Difference', (r) => _m(r['claim'])['recoveryGapSar'] ?? ''),
  ExportCol('عدد المرفقات', 'Attachments', (r) => _list(r['attachments']).length),
  ExportCol('سجّلها', 'Recorded by', (r) => _s(r['createdByName'])),
  ExportCol('آخر من عدّلها', 'Last edited by', (r) => _s(r['lastModifiedByName'])),
  ExportCol('الملاحظات', 'Notes', (r) => _s(_m(r['claim'])['notesAr'])),
];

// List
class VehicleClaimsScreen extends StatefulWidget {
  /// What web reads from the URL (?q=&status=&stale=1&fault=ours): the vehicle profile and overview cards open this screen on their rows.
  final String? initialQuery;
  final String? initialStatus;
  final bool initialStale;
  final String? initialFault;
  const VehicleClaimsScreen({super.key, this.initialQuery, this.initialStatus, this.initialStale = false, this.initialFault});
  @override
  State<VehicleClaimsScreen> createState() => _VehicleClaimsScreenState();
}

class _VehicleClaimsScreenState extends State<VehicleClaimsScreen> {
  late final TextEditingController _q = TextEditingController(text: widget.initialQuery ?? '');
  late String _status = widget.initialStatus ?? '';
  late bool _stale = widget.initialStale;
  late String _fault = widget.initialFault ?? '';
  String _reportedVia = '', _insurer = '', _files = '', _from = '', _to = '';
  final Map<String, Set<String>> _cf = {};

  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  Timer? _deb;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('vreg:updated', _load);
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _load);
    _deb?.cancel();
    _q.dispose();
    super.dispose();
  }

  String _qs(Map<String, String> p) =>
      p.entries.where((e) => e.value.isNotEmpty).map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');

  // A stale response does not overwrite a newer one; equivalent to useLatestRequest.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = _qs({'q': _q.text.trim(), 'status': _status});
      final res = await Api.instance.get('$_base${qs.isEmpty ? '' : '?$qs'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = _m(res); _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = _err(e); _loading = false; });
    }
  }

  void _debounced() { _deb?.cancel(); _deb = Timer(const Duration(milliseconds: 350), _load); }

  List<Map<String, dynamic>> get _all => _list(_d?['claims']);

  List<Map<String, dynamic>> get _rows {
    var out = _all;
    if (_stale) {
      final cutoff = DateTime.now().subtract(const Duration(days: 30));
      out = out.where((r) {
        if (_closed(r)) return false;
        final d = DateTime.tryParse(_s(_m(r['claim'])['lastInsurerUpdateDate']));
        return d != null && d.isBefore(cutoff);
      }).toList();
    }
    // Half the fault is ours: the same threshold as the server (>= 50%).
    if (_fault == 'ours') out = out.where((r) => (_num(r['faultPercent']) ?? 0) >= 50).toList();
    if (_reportedVia.isNotEmpty) out = out.where((r) => _s(r['reportedViaAr']) == _reportedVia).toList();
    if (_insurer.isNotEmpty) out = out.where((r) => _s(_m(r['claim'])['insurerAr']) == _insurer).toList();
    if (_files == 'with') out = out.where((r) => _list(r['attachments']).isNotEmpty).toList();
    if (_files == 'without') out = out.where((r) => _list(r['attachments']).isEmpty).toList();
    // The range is on the accident date itself.
    if (_from.isNotEmpty) out = out.where((r) => _ymd(r['accidentDate']).isNotEmpty && _ymd(r['accidentDate']).compareTo(_from) >= 0).toList();
    if (_to.isNotEmpty) out = out.where((r) => _ymd(r['accidentDate']).isNotEmpty && _ymd(r['accidentDate']).compareTo(_to) <= 0).toList();
    // Column filters last.
    if (_cf.isNotEmpty) {
      out = out.where((r) => _cf.entries.every((e) {
        final g = _cols.firstWhere((c) => c.$1 == e.key).$4;
        return e.value.contains(g(r));
      })).toList();
    }
    return out;
  }

  List<String> _distinct(String Function(Map<String, dynamic>) g) {
    final s = <String>{};
    for (final r in _all) { final v = g(r).trim(); if (v.isNotEmpty) s.add(v); }
    return s.toList()..sort();
  }

  bool get _hasActiveFilters => _q.text.trim().isNotEmpty || _status.isNotEmpty || _stale || _fault.isNotEmpty;
  bool get _hasPageFilters => _reportedVia.isNotEmpty || _insurer.isNotEmpty || _files.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty;

  Future<void> _export(bool all) async {
    var rows = _rows;
    if (all) {
      try { rows = _list(_m(await Api.instance.get(_base))['claims']); }
      catch (e) { _snack(_err(e)); return; }
    }
    if (!mounted) return;
    if (rows.isEmpty) { _snack(tr('لا صفوف للتصدير', 'Nothing to export')); return; }
    await exportExcel(context, fileName: 'vehicle-claims', sheets: [(tr('الحوادث', 'Claims'), _exportCols(), rows)]);
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<void> _openForm([Map<String, dynamic>? claim]) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => _ClaimFormScreen(claim: claim)));
    _load();
  }

  Future<void> _delete(Map<String, dynamic> r) async {
    final label = _s(r['accidentNumber']).isNotEmpty ? _s(r['accidentNumber']) : _s(r['claimId']);
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف الحادث $label؟ هيتشال من القوايم والتقارير.', 'Delete accident $label?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        TextButton(onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('$_base/${r['_id']}'); _snack(tr('اتشال', 'Deleted')); _load(); }
    catch (e) { _snack(_err(e)); }
  }

  Future<String?> _pickDate(String cur) async {
    final d = await showDatePicker(context: context,
        initialDate: DateTime.tryParse(cur) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
    return d?.toIso8601String().substring(0, 10);
  }

  Future<String?> _choose(String title, List<(String, String)> opts, String cur) => showModalBottomSheet<String>(
    context: context, backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => SafeArea(child: ListView(shrinkWrap: true, children: [
      Padding(padding: const EdgeInsets.all(14), child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
      for (final o in opts)
        ListTile(title: Text(o.$2), trailing: o.$1 == cur ? const Icon(Icons.check, color: T.orange) : null,
            onTap: () => Navigator.pop(c, o.$1)),
    ])),
  );

  Future<void> _columnFilters() async {
    await showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => DraggableScrollableSheet(
        expand: false, initialChildSize: 0.75, maxChildSize: 0.95,
        builder: (c, scroll) => ListView(controller: scroll, children: [
          Padding(padding: const EdgeInsets.all(14), child: Row(children: [
            Expanded(child: Text(tr('فلاتر الأعمدة', 'Column filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            if (_cf.isNotEmpty) TextButton(onPressed: () { setState(_cf.clear); setS(() {}); }, child: Text(tr('مسح', 'Clear'))),
          ])),
          for (final col in _cols)
            ExpansionTile(
              title: Text(tr(col.$2, col.$3)),
              subtitle: _cf[col.$1] == null ? null : Text('${_cf[col.$1]!.length} ${tr('مختار', 'selected')}', style: const TextStyle(color: T.orange)),
              children: [
                for (final v in [..._distinct(col.$4), if (_all.any((r) => col.$4(r).isEmpty)) ''])
                  CheckboxListTile(
                    dense: true,
                    value: _cf[col.$1]?.contains(v) ?? false,
                    title: Text(v.isEmpty ? tr('(فارغ)', '(blank)') : v),
                    onChanged: (on) {
                      setState(() {
                        final sel = _cf[col.$1] ?? <String>{};
                        on == true ? sel.add(v) : sel.remove(v);
                        if (sel.isEmpty) { _cf.remove(col.$1); } else { _cf[col.$1] = sel; }
                      });
                      setS(() {});
                    },
                  ),
              ],
            ),
          const SizedBox(height: 20),
        ]),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canEdit = _canEditVehicles(auth);
    final canManage = _canEditClaims(auth);
    final rows = _rows;
    final totals = _m(_d?['totals']);
    return AppScaffold(
      title: Text(tr('الحوادث والمطالبات', 'Accidents & Claims')),
      actions: [
        PopupMenuButton<bool>(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onSelected: _export,
          itemBuilder: (_) => [
            PopupMenuItem(value: false, child: Text(tr('المعروض (${rows.length})', 'Shown (${rows.length})'))),
            // Search and status run on the server, so 'all' is a second call with no parameters.
            if (_hasActiveFilters) PopupMenuItem(value: true, child: Text(tr('السجل كله', 'Everything'))),
          ],
        ),
      ],
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              backgroundColor: T.orange, foregroundColor: Colors.white,
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add), label: Text(tr('تسجيل حادث', 'New accident')))
          : null,
      body: _loading && _d == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _d == null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(12, 12, 12, 90), children: [
                    Text(tr('متابعة المطالبة من الحادث لحد الاسترداد', 'From the accident to the money back'),
                        style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
                    const SizedBox(height: 10),
                    _stats(totals),
                    const SizedBox(height: 10),
                    _filters(),
                    const SizedBox(height: 8),
                    if (rows.isEmpty)
                      EmptyState(icon: Icons.car_crash_outlined, title: _q.text.trim().isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد حوادث', 'No claims'))
                    else
                      for (final r in rows) _card(r, canManage),
                  ]),
                ),
    );
  }

  Widget _stats(Map<String, dynamic> t) {
    Widget stat(String label, String value, Color c, {VoidCallback? onTap, bool on = false}) {
      final body = Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: on ? T.orange : T.line, width: on ? 1.6 : 1),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(color: c, fontSize: 20, fontWeight: FontWeight.w900))),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: T.inkFaint, fontSize: 11)),
        ]),
      );
      return onTap == null ? body : InkWell(borderRadius: BorderRadius.circular(12), onTap: onTap, child: body);
    }
    return _eqGrid([
        stat(tr('إجمالي الحوادث', 'Total'), '${t['total'] ?? 0}', T.ink,
            onTap: () { setState(() { _status = ''; _stale = false; }); _load(); }, on: _status.isEmpty && !_stale),
        stat(tr('مفتوحة', 'Open'), '${t['open'] ?? 0}', const Color(0xFFF59E0B),
            onTap: () { setState(() { _status = 'pending'; _stale = false; }); _load(); }, on: _status == 'pending' && !_stale),
        stat(tr('مبلغ التقدير (ر.س)', 'Estimate amount (SAR)'), _money(t['estimatedSar']), const Color(0xFF0EA5E9)),
        stat(tr('المبلغ المسترد (ر.س)', 'Recovered amount'), _money(t['expectedRecoverySar']), const Color(0xFF16A34A)),
        stat(tr('الفرق — المقفلة (ر.س)', 'Difference — closed (SAR)'), _money(t['gapSar']), T.danger),
        stat(tr('بدون رد من التأمين +30 يوم', 'No insurer reply 30d+'), '${t['stale'] ?? 0}', const Color(0xFFEA580C),
            onTap: () { setState(() { _stale = !_stale; _status = ''; }); _load(); }, on: _stale),
    ]);
  }

  Widget _chip(String label, bool active, VoidCallback onTap, {VoidCallback? onClear}) => Padding(
    padding: const EdgeInsetsDirectional.only(end: 6),
    child: InputChip(
      label: Text(label, style: TextStyle(fontSize: 12.5, color: active ? const Color(0xFFD95F13) : T.inkSoft,
          fontWeight: active ? FontWeight.w700 : FontWeight.w500)),
      backgroundColor: active ? const Color(0xFFFFF7ED) : Colors.white,
      side: BorderSide(color: active ? T.orange : T.line),
      onPressed: onTap,
      onDeleted: active ? onClear : null,
      deleteIconColor: const Color(0xFFD95F13),
    ),
  );

  Widget _filters() {
    final statusLabel = _status == 'pending' ? tr('قيد المتابعة', 'Pending')
        : _status == 'closed' ? tr('مقفولة', 'Closed') : tr('كل الحالات', 'All statuses');
    final filesLabel = _files == 'with' ? tr('لها مرفقات', 'With files')
        : _files == 'without' ? tr('بلا مرفقات', 'Without files') : tr('المرفقات: الكل', 'Files: all');
    return AppCard(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SearchField(
        controller: _q,
        dense: true,
        onChanged: (_) { setState(() {}); _debounced(); },
        hint: tr('لوحة / رقم حادث / شركة تأمين / الطرف الآخر…', 'plate / accident no / insurer…'),
      ),
      const SizedBox(height: 8),
      SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
        _chip(statusLabel, _status.isNotEmpty, () async {
          final v = await _choose(tr('الحالة', 'Status'),
              [('', tr('كل الحالات', 'All statuses')), ('pending', tr('قيد المتابعة', 'Pending')), ('closed', tr('مقفولة', 'Closed'))], _status);
          if (v != null) { setState(() => _status = v); _load(); }
        }, onClear: () { setState(() => _status = ''); _load(); }),
        if (_fault == 'ours') _chip(tr('الخطأ علينا', 'Our fault'), true, () {}, onClear: () => setState(() => _fault = '')),
        if (_stale) _chip(tr('بدون رد +30 يوم', 'No reply 30d+'), true, () {}, onClear: () => setState(() => _stale = false)),
        _chip(_reportedVia.isEmpty ? tr('كل طرق الإبلاغ', 'All report channels') : _reportedVia, _reportedVia.isNotEmpty, () async {
          final v = await _choose(tr('تم الإبلاغ عبر', 'Reported via'),
              [('', tr('كل طرق الإبلاغ', 'All report channels')), for (final x in _distinct((r) => _s(r['reportedViaAr']))) (x, x)], _reportedVia);
          if (v != null) setState(() => _reportedVia = v);
        }, onClear: () => setState(() => _reportedVia = '')),
        _chip(_insurer.isEmpty ? tr('كل شركات التأمين', 'All insurers') : _insurer, _insurer.isNotEmpty, () async {
          final v = await _choose(tr('شركة التأمين', 'Insurer'),
              [('', tr('كل شركات التأمين', 'All insurers')), for (final x in _distinct((r) => _s(_m(r['claim'])['insurerAr']))) (x, x)], _insurer);
          if (v != null) setState(() => _insurer = v);
        }, onClear: () => setState(() => _insurer = '')),
        _chip(filesLabel, _files.isNotEmpty, () async {
          final v = await _choose(tr('المرفقات', 'Attachments'),
              [('', tr('المرفقات: الكل', 'Files: all')), ('with', tr('لها مرفقات', 'With files')), ('without', tr('بلا مرفقات', 'Without files'))], _files);
          if (v != null) setState(() => _files = v);
        }, onClear: () => setState(() => _files = '')),
        _chip(_from.isEmpty ? tr('من تاريخ', 'From') : '${tr('من', 'From')} $_from', _from.isNotEmpty, () async {
          final v = await _pickDate(_from); if (v != null) setState(() => _from = v);
        }, onClear: () => setState(() => _from = '')),
        _chip(_to.isEmpty ? tr('إلى تاريخ', 'To') : '${tr('إلى', 'To')} $_to', _to.isNotEmpty, () async {
          final v = await _pickDate(_to); if (v != null) setState(() => _to = v);
        }, onClear: () => setState(() => _to = '')),
        _chip(_cf.isEmpty ? tr('فلاتر الأعمدة', 'Column filters') : tr('فلاتر الأعمدة (${_cf.length})', 'Column filters (${_cf.length})'),
            _cf.isNotEmpty, _columnFilters, onClear: () => setState(_cf.clear)),
      ])),
      Row(children: [
        if (_hasPageFilters)
          TextButton(onPressed: () => setState(() { _reportedVia = ''; _insurer = ''; _files = ''; _from = ''; _to = ''; }),
              child: Text(tr('مسح الفلاتر', 'Clear filters'))),
        const Spacer(),
        Text('${_rows.length} ${tr('حادث', 'claims')}', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
      ]),
    ]));
  }

  Widget _card(Map<String, dynamic> r, bool canManage) {
    final c = _m(r['claim']);
    final days = _staleDays(r);
    final stale = !_closed(r) && days != null && days > 30;
    final fault = _num(r['faultPercent']);
    final files = _list(r['attachments']).length;
    final plate = _s(r['vehiclePlate']).isNotEmpty ? _s(r['vehiclePlate']) : _s(r['incidentSubjectAr']);
    final ids = [_s(r['claimId']), _s(r['accidentNumber'])].where((x) => x.isNotEmpty).join(' · ');
    Widget kv(String k, String v, {Color? color, bool bold = false}) => Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Row(children: [
        Text('$k: ', style: const TextStyle(color: T.inkFaint, fontSize: 12)),
        Expanded(child: Text(v.isEmpty ? '—' : v, overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12.5, color: color ?? T.ink, fontWeight: bold ? FontWeight.w700 : FontWeight.w500))),
      ]),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleClaimDetailScreen(id: _s(r['_id']))));
          _load();
        },
        child: AppCard(
          topAccent: stale ? T.danger : (_closed(r) ? T.inkFaint : T.warn),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(plate.isEmpty ? '—' : plate, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                if (ids.isNotEmpty) Text(ids, style: const TextStyle(color: T.inkFaint, fontSize: 11)),
              ])),
              Chip2(_statusText(r), _closed(r) ? T.inkFaint : T.warn),
              if (canManage)
                PopupMenuButton<String>(
                  onSelected: (v) => v == 'edit' ? _openForm(r) : _delete(r),
                  itemBuilder: (_) => [
                    PopupMenuItem(value: 'edit', child: Text(tr('تعديل', 'Edit'))),
                    PopupMenuItem(value: 'delete', child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
                  ],
                ),
            ]),
            const SizedBox(height: 4),
            Wrap(spacing: 6, runSpacing: 4, children: [
              Chip2(_fmtDate(r['accidentDate']), T.inkSoft, icon: Icons.event_outlined),
              if (fault != null) Chip2('${tr('الخطأ', 'Fault')} $fault%', fault >= 50 ? T.danger : T.success),
              if (days != null)
                Chip2('${tr('آخر رد', 'Last reply')} $days ${tr('يوم', 'd')}', stale ? T.danger : T.inkFaint,
                    icon: stale ? Icons.schedule : null),
              if (files > 0) Chip2('$files', T.inkSoft, icon: Icons.attach_file),
            ]),
            kv(tr('اسم السائق', 'Driver'), [_s(r['driverNameAr']), _s(r['driverIdNumber'])].where((x) => x.isNotEmpty).join(' · ')),
            kv(tr('نوع السيارة', 'Vehicle type'), _s(r['vehicleTypeAr'])),
            kv(tr('رقم التقدير', 'Estimate no.'), _s(r['reportOrEstimateNumber'])),
            kv(tr('تم الإبلاغ عبر', 'Reported via'), _s(r['reportedViaAr'])),
            kv(tr('شركة التأمين', 'Insurer'), [_s(c['insurerAr']), _s(c['claimNumber'])].where((x) => x.isNotEmpty).join(' · ')),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(children: [
                Expanded(child: _amount(tr('مبلغ التقدير', 'Estimate'),
                    (_num(c['estimatedAmountSar']) ?? 0) != 0 ? _money(c['estimatedAmountSar']) : '—', T.ink)),
                Expanded(child: _amount(tr('المسترد', 'Recovered'),
                    (_num(c['expectedRecoverySar']) ?? 0) != 0 ? _money(c['expectedRecoverySar']) : '—', T.success)),
                // The difference is computed when the claim is closed; before that there is none.
                Expanded(child: _amount(tr('الفرق', 'Difference'),
                    c['recoveryGapSar'] != null ? _money(c['recoveryGapSar']) : '—', T.danger)),
              ]),
            ),
            if (_s(c['notesAr']).isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(_s(c['notesAr']), maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: T.inkSoft, fontSize: 12)),
              ),
          ]),
        ),
      ),
    );
  }

  Widget _amount(String label, String v, Color c) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(label, style: const TextStyle(color: T.inkFaint, fontSize: 10.5)),
    Text(v, style: TextStyle(color: c, fontWeight: FontWeight.w800, fontSize: 13)),
  ]);
}

// Register / edit an accident: only the hand-typed fields. The server computes the difference.
class _ClaimFormScreen extends StatefulWidget {
  final Map<String, dynamic>? claim;
  const _ClaimFormScreen({this.claim});
  @override
  State<_ClaimFormScreen> createState() => _ClaimFormScreenState();
}

class _ClaimFormScreenState extends State<_ClaimFormScreen> {
  Map<String, dynamic>? _claim;
  late List<Map<String, dynamic>> _attachments;
  final _c = <String, TextEditingController>{};
  String _accidentDate = '', _lastReply = '', _statusCode = 'pending';
  bool _busy = false;
  final _personQ = TextEditingController();
  bool _personBusy = false;
  int _personSeq = 0;

  static const _keys = ['vehiclePlate', 'incidentSubjectAr', 'accidentNumber', 'driverNameAr', 'driverIdNumber',
    'vehicleTypeAr', 'reportOrEstimateNumber', 'faultPercent', 'reportedViaAr',
    'insurerAr', 'claimNumber', 'estimatedAmountSar', 'expectedRecoverySar', 'notesAr'];

  bool get _isNew => _s(_claim?['_id']).isEmpty;
  TextEditingController c(String k) => _c[k]!;

  @override
  void initState() {
    super.initState();
    _fill(widget.claim);
  }

  void _fill(Map<String, dynamic>? claim) {
    _claim = claim;
    final cl = _m(claim?['claim']);
    String v(dynamic x) => x == null ? '' : x.toString();
    final init = {
      'vehiclePlate': v(claim?['vehiclePlate']),
      'incidentSubjectAr': v(claim?['incidentSubjectAr']),
      'accidentNumber': v(claim?['accidentNumber']),
      'driverNameAr': v(claim?['driverNameAr']),
      'driverIdNumber': v(claim?['driverIdNumber']),
      'vehicleTypeAr': v(claim?['vehicleTypeAr']),
      'reportOrEstimateNumber': v(claim?['reportOrEstimateNumber']),
      'faultPercent': v(claim?['faultPercent']),
      'reportedViaAr': v(claim?['reportedViaAr']),
      'insurerAr': v(cl['insurerAr']),
      'claimNumber': v(cl['claimNumber']),
      'estimatedAmountSar': v(cl['estimatedAmountSar']),
      'expectedRecoverySar': v(cl['expectedRecoverySar']),
      'notesAr': v(cl['notesAr']),
    };
    for (final k in _keys) {
      (_c[k] ??= TextEditingController()).text = init[k] ?? '';
    }
    _accidentDate = _ymd(claim?['accidentDate']);
    _lastReply = _ymd(cl['lastInsurerUpdateDate']);
    _statusCode = _s(claim?['statusCode']).isEmpty ? 'pending' : _s(claim?['statusCode']);
    _attachments = _list(claim?['attachments']);
  }

  @override
  void dispose() {
    for (final x in _c.values) { x.dispose(); }
    _personQ.dispose();
    super.dispose();
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  num? _n(String k) { final t = c(k).text.trim(); return t.isEmpty ? null : num.tryParse(t); }

  // The difference exists only at close; mirrors claimDifference on the server.
  num? get _gap => _statusCode == 'closed' && _n('estimatedAmountSar') != null && _n('expectedRecoverySar') != null
      ? _n('estimatedAmountSar')! - _n('expectedRecoverySar')! : null;

  Future<void> _pickPlate() async {
    final hit = await pickFromApi(context,
      endpoint: '/api/vehicle-registry/plate-options', listKey: 'plates',
      title: tr('اللوحة أو الرقم التسلسلي أو الماركة', 'Plate, serial or brand'),
      label: (x) => [
        _s(x['plate']),
        [_s(x['typeAr']), _s(x['sectorAr']), _s(x['ownerCompanyAr']), if (_s(x['serial']).isNotEmpty) '#${x['serial']}']
            .where((e) => e.isNotEmpty).join(' · '),
      ].where((e) => e.isNotEmpty).join('  —  '),
    );
    if (hit == null || !mounted) return;
    setState(() {
      c('vehiclePlate').text = _s(hit['plate']);
      // Filled from the vehicle row unless already typed.
      if (c('vehicleTypeAr').text.isEmpty) c('vehicleTypeAr').text = _s(hit['typeAr']);
      if (c('driverNameAr').text.isEmpty) {
        c('driverNameAr').text = _s(hit['actualDriverName']).isNotEmpty ? _s(hit['actualDriverName']) : _s(hit['authorizedName']);
      }
      if (c('driverIdNumber').text.isEmpty) c('driverIdNumber').text = _s(hit['actualDriverId']);
    });
  }

  // Mirrors PersonLookup: HR, the light transport register and driver cards.
  Future<void> _findPerson() async {
    final term = _personQ.text.trim();
    if (term.length < 3) { _snack(tr('اكتب 3 أحرف على الأقل', 'Type at least 3 characters')); return; }
    final mine = ++_personSeq;
    setState(() => _personBusy = true);
    List<Map<String, dynamic>> people = [];
    try {
      people = _list(_m(await Api.instance.get('/api/vehicle-registry/person-lookup?q=${Uri.encodeQueryComponent(term)}'))['people']);
    } catch (_) {}
    if (!mounted || mine != _personSeq) return;
    setState(() => _personBusy = false);
    if (people.isEmpty) { _snack(tr('لا أحد يطابق', 'No match')); return; }
    final p = await showModalBottomSheet<Map<String, dynamic>>(
      context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (cx) => SafeArea(child: ListView(shrinkWrap: true, children: [
        for (final x in people)
          ListTile(
            title: Text(_s(x['name']), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text([
              _s(x['idNumber']),
              _s(x['phone']).isNotEmpty ? _s(x['phone']) : _s(x['absherPhone']),
              if (_s(x['employeeNumber']).isNotEmpty) '#${x['employeeNumber']}',
            ].where((e) => e.isNotEmpty).join(' · ')),
            onTap: () => Navigator.pop(cx, x),
          ),
      ])),
    );
    if (p == null || !mounted) return;
    setState(() {
      if (_s(p['name']).isNotEmpty) c('driverNameAr').text = _s(p['name']);
      if (_s(p['idNumber']).isNotEmpty) c('driverIdNumber').text = _s(p['idNumber']);
      _personQ.clear();
    });
  }

  Future<void> _save() async {
    String t(String k) => c(k).text.trim();
    if (t('vehiclePlate').isEmpty && t('incidentSubjectAr').isEmpty) {
      _snack(tr('اكتب اللوحة أو موضوع الواقعة', 'Enter the plate or the subject'));
      return;
    }
    setState(() => _busy = true);
    try {
      final body = {
        'vehiclePlate': t('vehiclePlate'),
        'incidentSubjectAr': t('incidentSubjectAr'),
        'isVehicleIncident': t('vehiclePlate').isNotEmpty,
        'accidentDate': _accidentDate.isEmpty ? null : _accidentDate,
        'accidentNumber': t('accidentNumber'),
        'driverNameAr': t('driverNameAr'),
        'driverIdNumber': t('driverIdNumber'),
        'vehicleTypeAr': t('vehicleTypeAr'),
        'reportOrEstimateNumber': t('reportOrEstimateNumber'),
        'faultPercent': _n('faultPercent'),
        'reportedViaAr': t('reportedViaAr'),
        'statusCode': _statusCode,
        // The text is not stored; it is derived from the code at display time.
        'statusAr': '',
        'claim': {
          'insurerAr': t('insurerAr'),
          'claimNumber': t('claimNumber'),
          'estimatedAmountSar': _n('estimatedAmountSar'),
          'expectedRecoverySar': _n('expectedRecoverySar'),
          'lastInsurerUpdateDate': _lastReply.isEmpty ? null : _lastReply,
          'notesAr': t('notesAr'),
        },
      };
      if (_isNew) {
        // After registering, the form stays open on the same accident so its papers can be uploaded.
        final res = _m(await Api.instance.post(_base, body));
        _snack(tr('اتسجّل الحادث — تقدر ترفع الملفات دلوقتي', 'Recorded — you can attach files now'));
        final created = _m(res['claim']);
        if (mounted) setState(() { if (created.isNotEmpty) { _fill(created); } });
        if (created.isEmpty && mounted) Navigator.pop(context, true);
      } else {
        await Api.instance.put('$_base/${_claim!['_id']}', body);
        _snack(tr('اتعدّل', 'Updated'));
        if (mounted) Navigator.pop(context, true);
      }
    } catch (e) {
      _snack(_err(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  Widget _f(String k, String ar, String en, {TextInputType? type, String? hint, int lines = 1}) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: TextField(
      controller: c(k), keyboardType: type, maxLines: lines,
      onChanged: (_) => setState(() {}),
      decoration: InputDecoration(labelText: tr(ar, en), hintText: hint),
    ),
  );

  Widget _date(String label, String value, ValueChanged<String> set) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: InkWell(
      onTap: () async {
        final d = await showDatePicker(context: context,
            initialDate: DateTime.tryParse(value) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
        if (d != null) setState(() => set(d.toIso8601String().substring(0, 10)));
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label,
            suffixIcon: value.isEmpty ? const Icon(Icons.event_outlined)
                : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => set('')))),
        child: Text(value.isEmpty ? '—' : value),
      ),
    ),
  );

  Widget _box(String title, List<Widget> children) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
      const SizedBox(height: 10),
      ...children,
    ])),
  );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final replies = _list(_claim?['insurerReplies'])
      ..sort((a, b) => _s(b['at']).compareTo(_s(a['at'])));
    final gap = _gap;
    final head = _s(_claim?['accidentNumber']).isNotEmpty ? _s(_claim?['accidentNumber']) : _s(_claim?['claimId']);
    return Scaffold(
      appBar: AppBar(title: Text(_isNew ? tr('تسجيل حادث جديد', 'New accident') : tr('تعديل $head', 'Edit $head'))),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        _box(tr('الواقعة', 'The incident'), [
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InkWell(
              onTap: _pickPlate,
              child: InputDecorator(
                decoration: InputDecoration(labelText: tr('لوحة المركبة', 'Plate'),
                    suffixIcon: c('vehiclePlate').text.isEmpty ? const Icon(Icons.arrow_drop_down)
                        : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => c('vehiclePlate').clear()))),
                child: Text(c('vehiclePlate').text.isEmpty ? tr('— اختر اللوحة —', '— pick the plate —') : c('vehiclePlate').text),
              ),
            ),
          ),
          _f('incidentSubjectAr', 'موضوع الواقعة (إن لم تكن مركبة)', 'Subject (if not a vehicle)'),
          _date(tr('تاريخ الحادث', 'Accident date'), _accidentDate, (v) => _accidentDate = v),
          _f('accidentNumber', 'رقم الحادث', 'Accident no.'),
          // Looking up the driver fills his fields.
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(12),
                border: Border.all(color: T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('ابحث عن السائق فتُملأ خاناته', 'Find the driver to fill his fields'),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
              Row(children: [
                Expanded(child: TextField(controller: _personQ, onSubmitted: (_) => _findPerson(),
                    decoration: InputDecoration(isDense: true,
                        hintText: tr('بالاسم أو رقم الهوية أو الإقامة', 'By name, national ID or iqama')))),
                IconButton(onPressed: _personBusy ? null : _findPerson,
                    icon: _personBusy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.person_search_outlined, color: T.orange)),
              ]),
            ]),
          ),
          _f('driverNameAr', 'اسم السائق', 'Driver name', hint: tr('يُملأ تلقائيًّا من المركبة', 'auto-filled from the vehicle')),
          _f('driverIdNumber', 'رقم إقامة السائق', 'Driver iqama'),
          _f('vehicleTypeAr', 'نوع السيارة', 'Vehicle type'),
          _f('reportOrEstimateNumber', 'رقم التقدير', 'Estimate number'),
          _f('faultPercent', 'نسبة الخطأ علينا %', 'Our fault %', type: TextInputType.number),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: LookupField(type: 'vehicle_reported_via', controller: c('reportedViaAr'),
                label: tr('تم الإبلاغ عبر', 'Reported via'), hint: tr('اختر…', 'Select…')),
          ),
          DropdownButtonFormField<String>(
            initialValue: _statusCode,
            decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
            items: [
              DropdownMenuItem(value: 'pending', child: Text(tr('قيد المتابعة', 'Pending'))),
              DropdownMenuItem(value: 'closed', child: Text(tr('مقفولة', 'Closed'))),
            ],
            onChanged: (v) => setState(() => _statusCode = v ?? 'pending'),
          ),
        ]),
        // Papers can also be uploaded from here, once the accident has an id.
        if (!_isNew)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ClaimAttachments(
              claimId: _s(_claim!['_id']), attachments: _attachments,
              canEdit: true, canManage: _canEditClaims(auth),
              onChange: (cl) => setState(() => _attachments = _list(cl['attachments'])),
            ),
          ),
        _box('${tr('ردود شركة التأمين', 'Insurer replies')}${replies.isEmpty ? '' : ' (${replies.length})'}', [
          if (replies.isEmpty) const Text('—', style: TextStyle(color: T.inkFaint)),
          for (final rep in replies) _replyTile(rep),
        ]),
        _box(tr('المطالبة التأمينية', 'Insurance claim'), [
          _f('insurerAr', 'شركة التأمين', 'Insurer'),
          _f('claimNumber', 'رقم المطالبة', 'Claim no.'),
          _date(tr('آخر رد من التأمين', 'Last insurer reply'), _lastReply, (v) => _lastReply = v),
          _f('estimatedAmountSar', 'مبلغ التقدير', 'Estimate amount (SAR)', type: const TextInputType.numberWithOptions(decimal: true)),
          _f('expectedRecoverySar', 'المبلغ المسترد', 'Recovered amount', type: const TextInputType.numberWithOptions(decimal: true)),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InputDecorator(
              decoration: InputDecoration(labelText: tr('الفرق (محسوب عند الإقفال)', 'Difference (computed on close)'),
                  filled: true, fillColor: const Color(0xFFF8FAFC)),
              child: Text(
                gap == null ? (_statusCode == 'closed' ? '—' : tr('يُحسب عند الإقفال', 'On close')) : _money(gap),
                style: TextStyle(fontWeight: FontWeight.w800, color: gap != null && gap > 0 ? const Color(0xFFBE123C) : T.inkSoft),
              ),
            ),
          ),
          _f('notesAr', 'ملاحظات', 'Notes', lines: 2),
        ]),
        SizedBox(
          height: 48,
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.orange),
            onPressed: _busy ? null : _save,
            child: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…')
                : _isNew ? tr('تسجيل الحادث', 'Record accident') : tr('حفظ التعديل', 'Save')),
          ),
        ),
        const SizedBox(height: 30),
      ]),
    );
  }
}

Widget _replyTile(Map<String, dynamic> rep) => Container(
  margin: const EdgeInsets.only(bottom: 6),
  padding: const EdgeInsets.all(10),
  decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Row(children: [
      Expanded(child: Text('${_fmtDate(rep['at'])}${_s(rep['byName']).isNotEmpty ? ' · ${rep['byName']}' : ''}',
          style: const TextStyle(color: T.inkFaint, fontSize: 11.5))),
      if (rep['amountSar'] != null)
        Text('${_money(rep['amountSar'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
    ]),
    const SizedBox(height: 3),
    Text(_s(rep['text']), style: const TextStyle(fontSize: 13)),
  ]),
);

// Claim attachments, mirrors components/vehicles/ClaimAttachments.
const _maxBytes = 20 * 1024 * 1024; // Server limit (utils/fileStore)

String _sizeText(dynamic v) {
  final n = _num(v)?.toInt() ?? 0;
  if (n == 0) return '';
  if (n < 1024) return '$n B';
  if (n < 1024 * 1024) return '${(n / 1024).round()} KB';
  return '${(n / (1024 * 1024)).toStringAsFixed(1)} MB';
}

class _ClaimAttachments extends StatefulWidget {
  final String claimId;
  final List<Map<String, dynamic>> attachments;
  final bool canEdit;
  /// Renaming or deleting an attachment is for administration and finance only (canEditClaims).
  final bool canManage;
  final ValueChanged<Map<String, dynamic>> onChange;
  const _ClaimAttachments({required this.claimId, required this.attachments, required this.canEdit,
    required this.canManage, required this.onChange});
  @override
  State<_ClaimAttachments> createState() => _ClaimAttachmentsState();
}

class _ClaimAttachmentsState extends State<_ClaimAttachments> {
  bool _busy = false;
  String get _url => '$_base/${widget.claimId}/attachments';
  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<void> _pick() async {
    final picked = await pickFilesAsDataUrls();
    if (picked.isEmpty) return;
    final files = <Map<String, String>>[];
    for (final f in picked) {
      if (f.sizeBytes > _maxBytes) { _snack(tr('«${f.fileName}» أكبر من 20 ميجابايت', '"${f.fileName}" exceeds 20 MB')); continue; }
      // Suggested name is the file name without its extension; the owner corrects it after upload.
      files.add({'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': f.fileName.replaceFirst(RegExp(r'\.[^.]+$'), '')});
    }
    if (files.isEmpty) return;
    setState(() => _busy = true);
    try {
      final d = _m(await Api.instance.post(_url, {'files': files}));
      if (d['claim'] is Map) widget.onChange(_m(d['claim']));
      _snack(tr('أُرفق ${files.length} ملفًّا', '${files.length} file(s) attached'));
    } catch (e) {
      _snack(_err(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _rename(Map<String, dynamic> a) async {
    final ctrl = TextEditingController(text: _s(a['title']).isNotEmpty ? _s(a['title']) : _s(a['fileName']));
    final next = await showDialog<String>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('اسم المرفق', 'Attachment name')),
      content: TextField(controller: ctrl, autofocus: true),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
        TextButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    ctrl.dispose();
    if (next == null || next == _s(a['title'])) return;
    try {
      final d = _m(await Api.instance.put('$_url/${a['_id']}', {'title': next}));
      if (d['claim'] is Map) widget.onChange(_m(d['claim']));
    } catch (e) { _snack(_err(e)); }
  }

  Future<void> _remove(Map<String, dynamic> a) async {
    final name = _s(a['title']).isNotEmpty ? _s(a['title']) : _s(a['fileName']);
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('يُحذف «$name» نهائيًّا؟', 'Delete "$name" permanently?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        TextButton(onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
      ],
    ));
    if (ok != true) return;
    try {
      final d = _m(await Api.instance.delete('$_url/${a['_id']}'));
      if (d['claim'] is Map) widget.onChange(_m(d['claim']));
    } catch (e) { _snack(_err(e)); }
  }

  void _open(Map<String, dynamic> a) {
    final u = _s(a['fileUrl']);
    if (u.isEmpty) return;
    launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final list = [...widget.attachments]..sort((a, b) => _s(b['uploadedAt']).compareTo(_s(a['uploadedAt'])));
    return AppCard(
      topAccent: T.inkFaint,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.attach_file, size: 18, color: T.inkFaint),
          const SizedBox(width: 4),
          Expanded(child: Text('${tr('المرفقات', 'Attachments')}${list.isEmpty ? '' : ' (${list.length})'}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (widget.canEdit)
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.orange, visualDensity: VisualDensity.compact),
              onPressed: _busy ? null : _pick,
              icon: _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.upload_outlined, size: 16),
              label: Text(tr('إرفاق ملفات', 'Attach files')),
            ),
        ]),
        const SizedBox(height: 8),
        if (list.isEmpty)
          Text(widget.canEdit
              ? tr('لا مرفقات — أرفق تقرير نجم وصور الضرر وعرض الورشة وخطابات الشركة.',
                  'No attachments yet — attach the Najm report, damage photos, the workshop quote and insurer letters.')
              : tr('لا مرفقات', 'No attachments'),
              style: const TextStyle(color: T.inkFaint, fontSize: 12.5))
        else
          for (final a in list)
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
              child: Row(children: [
                const Icon(Icons.description_outlined, size: 18, color: T.inkFaint),
                const SizedBox(width: 6),
                Expanded(child: InkWell(
                  onTap: widget.canManage ? () => _rename(a) : null,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Flexible(child: Text(_s(a['title']).isNotEmpty ? _s(a['title']) : _s(a['fileName']),
                          overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                      if (widget.canManage) const Padding(padding: EdgeInsetsDirectional.only(start: 4),
                          child: Icon(Icons.edit_outlined, size: 13, color: T.inkFaint)),
                    ]),
                    Text([_s(a['fileName']), _sizeText(a['size']), _s(a['uploadedByName']),
                      if (_s(a['uploadedAt']).isNotEmpty) _fmtDate(a['uploadedAt'])].where((x) => x.isNotEmpty).join(' · '),
                        overflow: TextOverflow.ellipsis, style: const TextStyle(color: T.inkFaint, fontSize: 11)),
                  ]),
                )),
                TextButton(onPressed: () => _open(a), child: Text(tr('فتح', 'Open'))),
                if (widget.canManage)
                  IconButton(tooltip: tr('حذف', 'Delete'), onPressed: () => _remove(a),
                      icon: const Icon(Icons.delete_outline, size: 18, color: T.danger)),
              ]),
            ),
      ]),
    );
  }
}

// Accident and claim file
const _auditLabels = {
  'create_vehicle_claim': ('تسجيل الحادثة', 'Claim opened'),
  'update_vehicle_claim': ('تعديل المطالبة', 'Claim edited'),
  'delete_vehicle_claim': ('حذف المطالبة', 'Claim removed'),
  'add_claim_attachment': ('إرفاق ملفّ', 'Attachment added'),
  'delete_claim_attachment': ('حذف مرفق', 'Attachment removed'),
};

class VehicleClaimDetailScreen extends StatefulWidget {
  final String id;
  const VehicleClaimDetailScreen({super.key, required this.id});
  @override
  State<VehicleClaimDetailScreen> createState() => _VehicleClaimDetailScreenState();
}

class _VehicleClaimDetailScreenState extends State<VehicleClaimDetailScreen> {
  Map<String, dynamic>? _c;
  bool _loading = true;
  List<Map<String, dynamic>>? _audit;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
    _loadAudit();
    // Anything touching the section broadcasts this event, so the claim refreshes even when edited from the table.
    Live.instance.on('vreg:updated', _load);
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _load);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = _m(await Api.instance.get('$_base/${widget.id}'));
      if (!mounted || mine != _seq) return;
      setState(() => _c = _m(d['claim']).isEmpty ? null : _m(d['claim']));
    } catch (_) {/* The screen keeps what it has */}
    if (mounted && mine == _seq) setState(() => _loading = false);
  }

  // The history is requested once: it is for review, not live follow-up.
  Future<void> _loadAudit() async {
    try {
      final d = _m(await Api.instance.get('$_base/${widget.id}/audit'));
      if (mounted) setState(() => _audit = _list(d['logs']));
    } catch (_) {
      if (mounted) setState(() => _audit = []);
    }
  }

  void _export(Map<String, dynamic> c, num est, num rec, num? gap) {
    final cl = _m(c['claim']);
    final flat = <(String, String, dynamic)>[
      ('رقم الحادثة', 'Claim no.', c['claimId']),
      ('موضوع الواقعة', 'Subject', c['incidentSubjectAr']),
      ('اللوحة', 'Plate', c['vehiclePlate']),
      ('التاريخ', 'Date', _fmtDate(c['accidentDate'])),
      ('نسبة الخطأ', 'Fault', c['faultPercent'] == null ? '' : '${c['faultPercent']}%'),
      ('اسم السائق', 'Driver', c['driverNameAr']),
      ('رقم إقامة السائق', 'Driver iqama', c['driverIdNumber']),
      ('نوع السيارة', 'Vehicle type', c['vehicleTypeAr']),
      ('رقم التقدير', 'Estimate no.', c['reportOrEstimateNumber']),
      ('الطرف الآخر', 'Counterparty', c['counterpartyNameAr']),
      ('هوية الطرف الآخر', 'Counterparty ID', c['counterpartyNationalId']),
      ('مصدر البلاغ', 'Reported via', c['reportedViaAr']),
      ('رقم نجم', 'Najm no.', c['accidentNumber']),
      ('رقم التقرير/التقدير', 'Report/estimate no.', c['reportOrEstimateNumber']),
      ('شركة التأمين', 'Insurer', cl['insurerAr']),
      ('رقم المطالبة', 'Claim number', cl['claimNumber']),
      ('المقدَّر', 'Estimated', est == 0 ? '' : est),
      ('متوقع استرداده', 'Expected recovery', rec == 0 ? '' : rec),
      ('الفرق', 'Difference', gap ?? ''),
      ('الحالة', 'Status', _closed(c) ? tr('مقفولة', 'Closed') : tr('قيد المتابعة', 'Open')),
      ('الملاحظات', 'Notes', cl['notesAr']),
      ('المرفقات', 'Attachments', _list(c['attachments']).length),
    ];
    final rows = [for (final f in flat) <String, dynamic>{'field': tr(f.$1, f.$2), 'value': f.$3 ?? ''}];
    exportExcel(context, fileName: 'claim-${_s(c['claimId'])}', sheets: [
      ('Claim', [ExportCol('البند', 'Field', (r) => r['field']), ExportCol('القيمة', 'Value', (r) => r['value'])], rows),
    ]);
  }

  Widget _row(String label, dynamic v, {bool mono = false}) {
    final s = v == null ? '' : v.toString();
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFF1F5F9)))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: T.inkFaint, fontSize: 12)),
        const SizedBox(width: 12),
        Expanded(child: Text(s.isEmpty ? '—' : s, textAlign: TextAlign.end,
            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: s.isEmpty ? T.line : T.ink,
                fontFamily: mono ? 'monospace' : null))),
      ]),
    );
  }

  Widget _section(String title, IconData icon, Color accent, List<Widget> rows, {Widget? link}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: AppCard(topAccent: accent, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Container(width: 28, height: 28, alignment: Alignment.center,
            decoration: BoxDecoration(color: accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
            child: Icon(icon, size: 16, color: accent)),
        const SizedBox(width: 8),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5)),
      ]),
      const SizedBox(height: 4),
      ...rows,
      if (link != null) link,
    ])),
  );

  Widget _kpi(String label, String value, Color c) => AppCard(
    padding: const EdgeInsets.all(12),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: T.inkFaint, fontSize: 11.5)),
      const SizedBox(height: 2),
      FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(color: c, fontWeight: FontWeight.w900, fontSize: 18))),
    ]),
  );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final c = _c;
    if (_loading) {
      return AppScaffold(title: Text(tr('ملفّ الحادثة', 'Claim file')), body: const Center(child: CircularProgressIndicator()));
    }
    if (c == null) {
      return AppScaffold(
        title: Text(tr('ملفّ الحادثة', 'Claim file')),
        body: EmptyState(icon: Icons.car_crash_outlined, title: tr('الحادثة غير موجودة', 'Claim not found')),
      );
    }
    final cl = _m(c['claim']);
    final closed = _closed(c);
    final est = _num(cl['estimatedAmountSar']) ?? 0;
    final rec = _num(cl['expectedRecoverySar']) ?? 0;
    // The difference exists only at close; computed by the server.
    final gap = cl['recoveryGapSar'] != null ? _num(cl['recoveryGapSar']) : null;
    final atts = _list(c['attachments']);
    final replies = _list(c['insurerReplies'])..sort((a, b) => _s(b['at']).compareTo(_s(a['at'])));
    final vehicle = c['vehicle'];
    final vehicleId = vehicle is Map ? _s(vehicle['_id']) : _s(vehicle);
    final sub = [
      _s(c['vehiclePlate']).isNotEmpty ? _s(c['vehiclePlate']) : _s(c['incidentSubjectAr']),
      _ymd(c['accidentDate']),
      _s(cl['insurerAr']),
      c['faultPercent'] != null ? '${tr('خطؤنا', 'our fault')} ${c['faultPercent']}%' : '',
    ].where((x) => x.isNotEmpty).join(' · ');
    final sar = tr('ر.س', 'SAR');

    return AppScaffold(
      title: Text(_s(c['claimId']).isEmpty ? tr('ملفّ الحادثة', 'Claim file') : _s(c['claimId'])),
      actions: [
        IconButton(tooltip: tr('ملفّ الحادثة (Excel)', 'Claim file (Excel)'),
            icon: const Icon(Icons.file_download_outlined), onPressed: () => _export(c, est, rec, gap)),
      ],
      body: RefreshIndicator(
        onRefresh: () async { await _load(); await _loadAudit(); },
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 40), children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: T.ink, borderRadius: BorderRadius.circular(16)),
            child: Row(children: [
              Container(width: 44, height: 44, alignment: Alignment.center,
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.warning_amber_rounded, color: T.orange)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Text(_s(c['claimId']), style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900, fontFamily: 'monospace')),
                  Chip2(closed ? tr('مقفولة', 'Closed') : tr('قيد المتابعة', 'Open'), closed ? const Color(0xFF6EE7B7) : const Color(0xFFFDE68A)),
                ]),
                if (sub.isNotEmpty) Text(sub, style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12.5)),
              ])),
            ]),
          ),
          const SizedBox(height: 12),
          // The financial question first.
          _eqGrid([
              _kpi(tr('المقدَّر (ر.س)', 'Estimated (SAR)'), _money(est), T.ink),
              _kpi(tr('متوقع استرداده', 'Expected recovery'), _money(rec), const Color(0xFF047857)),
              _kpi(tr('الفرق', 'Difference'), gap == null ? tr('يُحسب عند الإقفال', 'On close') : _money(gap),
                  gap != null && gap > 0 ? T.danger : T.ink),
              _kpi(tr('المرفقات', 'Attachments'), '${atts.length}', T.ink),
          ]),
          const SizedBox(height: 12),
          _section(tr('الواقعة', 'The incident'), Icons.warning_amber_rounded, T.danger, [
            _row(tr('التاريخ', 'Date'), _ymd(c['accidentDate']), mono: true),
            _row(tr('موضوع الواقعة', 'Subject'), c['incidentSubjectAr']),
            _row(tr('نسبة الخطأ علينا', 'Our fault'), c['faultPercent'] == null ? '' : '${c['faultPercent']}%'),
            _row(tr('مصدر البلاغ', 'Reported via'), c['reportedViaAr']),
            _row(tr('رقم نجم', 'Najm no.'), c['accidentNumber'], mono: true),
            _row(tr('رقم التقرير/التقدير', 'Report/estimate no.'), c['reportOrEstimateNumber'], mono: true),
          ]),
          _section(tr('المركبة', 'Vehicle'), Icons.directions_car_outlined, T.cyan, [
            _row(tr('اللوحة', 'Plate'), c['vehiclePlate'], mono: true),
            _row(tr('القطاع', 'Sector'), c['vehicleSectorAr']),
            _row(tr('النوع', 'Type'), c['vehicleTypeAr']),
            _row(tr('الفئة', 'Category'), c['vehicleCategoryAr']),
            _row(tr('الماركة', 'Brand'), c['vehicleBrandAr']),
            _row(tr('السجل المالك', 'Owner registration'), c['ownerRegistrationAr']),
          ], link: vehicleId.isEmpty ? null : Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: () => Navigator.push(context, MaterialPageRoute(
                  builder: (_) => VehicleRegistryDetailScreen(id: vehicleId, plate: _s(c['vehiclePlate'])))),
              icon: const Icon(Icons.chevron_right, size: 16),
              label: Text(tr('ملفّ المركبة', 'Vehicle file')),
            ),
          )),
          _section(tr('السائق والمركبة', 'Driver & vehicle'), Icons.people_outline, T.orange, [
            _row(tr('اسم السائق', 'Driver name'), c['driverNameAr']),
            _row(tr('رقم الإقامة', 'Iqama number'), c['driverIdNumber'], mono: true),
            _row(tr('نوع السيارة', 'Vehicle type'),
                _s(c['vehicleTypeAr']).isNotEmpty ? c['vehicleTypeAr'] : (vehicle is Map ? vehicle['registrationTypeAr'] : null)),
            _row(tr('رقم التقدير', 'Estimate number'), c['reportOrEstimateNumber'], mono: true),
          ]),
          if (_s(c['counterpartyNameAr']).isNotEmpty || _s(c['counterpartyNationalId']).isNotEmpty || c['faultRatio'] != null)
            _section(tr('الطرف الآخر', 'Counterparty'), Icons.people_outline, T.inkFaint, [
              _row(tr('الاسم', 'Name'), c['counterpartyNameAr']),
              _row(tr('رقم الهوية', 'National ID'), c['counterpartyNationalId'], mono: true),
              _row(tr('نسبة الخطأ', 'Fault ratio'), c['faultRatio']),
            ]),
          _section(tr('المطالبة', 'The claim'), Icons.apartment_outlined, T.orange, [
            _row(tr('شركة التأمين', 'Insurer'), cl['insurerAr']),
            _row(tr('رقم المطالبة', 'Claim number'), cl['claimNumber'], mono: true),
            _row(tr('حالة الرقم', 'Number status'), cl['claimNumberStatus']),
            _row(tr('آخر تحديث من الشركة', 'Last insurer update'), _ymd(cl['lastInsurerUpdateDate']), mono: true),
            _row(tr('آخر ملاحظة', 'Last note'), _ymd(cl['lastNoteDate']), mono: true),
          ]),
          _section(tr('الأرقام', 'The money'), Icons.payments_outlined, const Color(0xFF16A34A), [
            _row(tr('المقدَّر', 'Estimated'), est != 0 ? '${_money(est)} $sar' : null, mono: true),
            _row(tr('متوقع استرداده', 'Expected recovery'), rec != 0 ? '${_money(rec)} $sar' : null, mono: true),
            _row(tr('الفرق', 'Difference'),
                gap != null ? '${_money(gap)} $sar' : (closed ? null : tr('يُحسب عند الإقفال', 'Computed on close')), mono: true),
          ]),
          if (_s(cl['notesAr']).isNotEmpty)
            _section(tr('ملاحظات', 'Notes'), Icons.description_outlined, T.inkFaint, [
              Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text(_s(cl['notesAr']), style: const TextStyle(fontSize: 13))),
            ]),
          // The papers the figures are built on.
          _ClaimAttachments(
            claimId: widget.id, attachments: atts,
            canEdit: _canEditVehicles(auth), canManage: _canEditClaims(auth),
            onChange: (cl2) => setState(() => _c = cl2),
          ),
          const SizedBox(height: 12),
          if (replies.isNotEmpty)
            _section('${tr('ردود شركة التأمين', 'Insurer replies')} (${replies.length})', Icons.apartment_outlined, T.inkFaint,
                [for (final rep in replies) _replyTile(rep)]),
          _section('${tr('سجلّ الملفّ', 'File history')}${(_audit?.isNotEmpty ?? false) ? ' (${_audit!.length})' : ''}',
              Icons.history, T.inkFaint, [
            if (_audit == null)
              Text(tr('جارٍ التحميل…', 'Loading…'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))
            else if (_audit!.isEmpty)
              Text(tr('لا قيود بعد — ما يُعدَّل من الآن يُسجَّل هنا باسم من عدّله ووقته.',
                  'No entries yet — changes from now on are recorded here with who and when.'),
                  style: const TextStyle(color: T.inkFaint, fontSize: 12.5))
            else
              for (final a in _audit!) _auditTile(a),
          ]),
        ]),
      ),
    );
  }

  Widget _auditTile(Map<String, dynamic> a) {
    final l = _auditLabels[_s(a['action'])];
    final when = DateTime.tryParse(_s(a['createdAt']))?.toLocal();
    final whenText = when == null ? '' : '${when.toIso8601String().substring(0, 10)} ${when.toIso8601String().substring(11, 16)}';
    final after = _m(a['changes'])['after'];
    String detail = '';
    if (after is List && after.isNotEmpty) {
      detail = after.take(10).map((e) => '$e').join('، ');
    } else if (after is Map) {
      detail = after.entries.take(6).map((e) => '${e.key}: ${e.value is List ? (e.value as List).join('، ') : (e.value ?? '')}').join(' · ');
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(margin: const EdgeInsets.only(top: 4), width: 10, height: 10,
            decoration: const BoxDecoration(color: T.orange, shape: BoxShape.circle)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l == null ? _s(a['action']) : tr(l.$1, l.$2), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          Text('$whenText${_s(a['userName']).isNotEmpty ? ' · ${a['userName']}' : ''}',
              style: const TextStyle(color: T.inkFaint, fontSize: 11.5)),
          if (detail.isNotEmpty) Text(detail, style: const TextStyle(color: T.inkSoft, fontSize: 11.5)),
        ])),
      ]),
    );
  }
}

// Cards in equal-height rows that grow with the text (instead of a fixed-ratio GridView that clips content).
Widget _eqGrid(List<Widget> tiles) => StatGrid(spacing: 8, minTileWidth: 150, minColumns: 2, maxColumns: tiles.length % 3 == 0 ? 3 : 4, children: tiles);
