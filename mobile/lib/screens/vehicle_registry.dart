import 'package:flutter/material.dart';
import '../services/api.dart';
import '../ui/filter_sheet.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../services/flex_match.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/auth.dart';
import '../ui/export_sheet.dart';
import '../ui/file_upload.dart';
import '../ui/report_button.dart';
import 'jp.dart' show JpTaskPanel;
import 'vehicle_claims.dart' show VehicleClaimsScreen;
import 'vehicle_documents.dart';
import 'vehicle_registry_columns.dart';
import 'vehicle_registry_dash.dart' show VehicleRegistryDashboardScreen, VehicleRegistryAlertsScreen;
import 'vehicle_registry_form.dart';
import 'vehicle_renew.dart';

/// سجل المركبات (Vehicle Registry) — قائمة/تفاصيل/تحليلات/تنبيهات/إعدادات،
/// مبنيّة على ماستر Vehicles_2026 (326 مركبة) عبر /api/vehicle-registry.
/// الموبايل بلا رسوم بيانية: بطاقات + أشرطة نسبية + شرائح.

String money(dynamic v) {
  final nn = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = nn < 0;
  final s = nn.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return '${neg ? '-' : ''}$b';
}

// توأمُ STATUS_META في الموقع — بالسبع حالاتٍ التي يبعثها الخادم، وما لا يُعرَف
// يُعرض رماديًّا باسمه (statusMeta) لا يُسقط الشاشة.
const _statusMeta = {
  'expired': ('منتهي', 'Expired', T.danger),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('قريب الانتهاء', 'Expiring soon', Color(0xFFCA8A04)),
  'valid': ('ساري', 'Valid', T.success),
  'none': ('غير مسجّل', 'None', Color(0xFF94A3B8)),
  'not_required': ('غير مطلوب', 'Not required', Color(0xFF64748B)),
  'upcoming': ('قارب على الانتهاء', 'Due soon', Color(0xFF0EA5E9)),
};

// ── مَن يكتب ومَن يحذف — canEditVehicles / canAdminVehicles في الموقع ─────────
const _vehEditRoles = {'super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'};
const _vehAdminRoles = {'super_admin', 'admin', 'vehicles_manager', 'hr_manager'};
bool canEditVehicles(AuthProvider a) => _vehEditRoles.contains(a.role) || a.canEditSection('Vehicles');
bool canAdminVehicles(AuthProvider a) => _vehAdminRoles.contains(a.role) || (a.role != 'client' && a.canEditSection('Vehicles'));

/// صفحةُ عائلة المستند — يفتحها ملفُّ المركبة على لوحتها.
DocFamily? familyOf(String docKey) => switch (docKey) {
      'insurance' => vehicleInsuranceFamily,
      'operatingCard' => vehicleOperatingCardFamily,
      'vehicleLicense' => vehicleLicenceFamily,
      'inspection' => vehicleInspectionFamily,
      'gps' => vehicleGpsFamily,
      'authorization' => vehicleAuthorizationFamily,
      _ => null,
    };
Color statusColor(String s) => _statusMeta[s]?.$3 ?? T.inkFaint;
String statusLabel(String s) { final m = _statusMeta[s]; return m == null ? s : tr(m.$1, m.$2); }

const docTypes = [
  ('insurance', 'التأمين', 'Insurance'),
  ('operatingCard', 'بطاقة التشغيل', 'Operating Card'),
  ('vehicleLicense', 'رخصة السير', 'Vehicle License'),
  ('inspection', 'الفحص', 'Inspection'),
  ('gps', 'اشتراك GPS', 'GPS'),
  // التفويض مستندٌ له تاريخ انتهاء كسائر المستندات — الخادم يرسله، وبدونه هنا
  // يرى مستخدم الويب مستندًا لا يراه مستخدم الموبايل على نفس المركبة.
  ('authorization', 'التفويض', 'Authorisation'),
];
String docLabel(String k) { for (final d in docTypes) { if (d.$1 == k) return tr(d.$2, d.$3); } return k; }

String fmtDate(dynamic d) {
  if (d == null || d.toString().isEmpty) return '—';
  return d.toString().split('T').first;
}
String daysText(dynamic n) {
  if (n == null) return '—';
  final v = (n is num) ? n.toInt() : int.tryParse(n.toString()) ?? 0;
  if (v < 0) return tr('انتهى منذ ${-v} يوم', 'expired ${-v}d ago');
  if (v == 0) return tr('ينتهي اليوم', 'expires today');
  if (v == 1) return tr('باقي يوم واحد', '1 day left');
  return tr('باقي $v يوم', '$v days left');
}
/// الطيُّ الموحَّد — راجع services/flex_match. كان هذا يطوي الهمزةَ ولا يطوي
/// المسافة، فاللوحةُ المنسوخة بمسافتين لا تجد نفسَها المخزَّنة بواحدة.
String _fold(String s) => flexFold(s);

// ══════════════════ القائمة ══════════════════
class VehicleRegistryListScreen extends StatefulWidget {
  final String? sector, expiringDoc, expiredDoc;
  final Map<String, String>? filters; // فلاتر إضافية من كروت اللوحة
  final String? filterLabel; // شارة توضّح الفلتر المطبّق
  final String? initialQuery;
  const VehicleRegistryListScreen({super.key, this.sector, this.expiringDoc, this.expiredDoc, this.filters, this.filterLabel, this.initialQuery});
  @override
  State<VehicleRegistryListScreen> createState() => _VehicleRegistryListScreenState();
}

class _VehicleRegistryListScreenState extends State<VehicleRegistryListScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _total = 0;
  bool _loading = true;
  String? _error;
  late String _q = widget.initialQuery ?? '';
  // نصُّ البحث في متحكِّمٍ يملكه الشاشة: الظاهرُ = المُرشِّح دائمًا
  late final _searchCtl = TextEditingController(text: _q);
  int _seq = 0;
  // الأعمدةُ المعروضة في البطاقة وفي «تصدير المعروض» — «الأساسيّة» أوّلًا كالموقع.
  List<String> _visible = List.of(baseColumnKeys);
  // الفلتر الحيّ للشاشة — يبدأ بما جاء من بطاقة اللوحة، ثم يعدّله المستخدم من
  // اللوحة نفسها. مصدر واحد للفلترة بدل ثلاثة حقول منفصلة، فما تراه الشرائح هو
  // ما يُرسل إلى الخادم حرفيًّا.
  late Map<String, String> _filters = {
    ...?widget.filters,
    if (widget.sector != null) 'sector': widget.sector!,
    if (widget.expiringDoc != null) ...{'expiringDoc': widget.expiringDoc!, 'expiringWithin': '60'},
    if (widget.expiredDoc != null) 'expiredDoc': widget.expiredDoc!,
  };
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); _searchCtl.dispose(); super.dispose(); }

  // البحثُ والفلاترُ على الخادم، وردٌّ قديمٌ لا يكتب فوق أحدث.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>['limit=2000'];
      if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeComponent(_q.trim())}');
      _filters.forEach((k, v) { if (v.isNotEmpty) p.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/vehicle-registry?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []); _total = (d['total'] ?? 0) as int; _loading = false; _error = null; });
    } catch (e) { if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); }); }
  }

  List<VCol> get _shownCols => registryColumns.where((c) => _visible.contains(c.key)).toList();

  Future<void> _export(List<Map<String, dynamic>> shown) async {
    final scope = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض (بعد الفلتر)', 'Shown (filtered)')),
          subtitle: Text(tr('${shown.length} صفًّا · ${_shownCols.length} عمودًا', '${shown.length} rows · ${_shownCols.length} cols')), onTap: () => Navigator.pop(c, 'shown')),
      ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكلّ', 'Everything')),
          subtitle: Text(tr('كل المركبات · ${registryColumns.length} عمودًا', 'all vehicles · ${registryColumns.length} cols')), onTap: () => Navigator.pop(c, 'all')),
    ])));
    if (scope == null || !mounted) return;
    if (scope == 'shown') {
      await exportExcel(context, fileName: 'vehicle-registry', sheets: [(tr('المركبات', 'Vehicles'), registryExportCols(_shownCols), shown)]);
      return;
    }
    try {
      final d = await Api.instance.get('/api/vehicle-registry?limit=5000');
      if (!mounted) return;
      await exportExcel(context, fileName: 'vehicle-registry', sheets: [(tr('المركبات', 'Vehicles'), registryExportCols(registryColumns), List<Map<String, dynamic>>.from(d['vehicles'] ?? []))]);
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Future<void> _pickColumns() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(child: SizedBox(
        height: MediaQuery.of(c).size.height * 0.75,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.all(10),
            child: Row(children: [
              Text('${tr('الأعمدة', 'Columns')} ${_visible.length}/${registryColumns.length}', style: const TextStyle(fontWeight: FontWeight.w800)),
              const Spacer(),
              TextButton(onPressed: () { setState(() => _visible = registryColumns.map((x) => x.key).toList()); setS(() {}); }, child: Text(tr('إظهار الكل', 'Show all'))),
              TextButton(onPressed: () { setState(() => _visible = List.of(baseColumnKeys)); setS(() {}); }, child: Text(tr('الأساسية فقط', 'Essentials'))),
            ]),
          ),
          Expanded(child: ListView(children: registryColumns.map((col) => CheckboxListTile(
            dense: true,
            value: _visible.contains(col.key),
            title: Text(tr(col.ar, col.en), style: const TextStyle(fontSize: 13)),
            onChanged: (x) { setState(() { if (x == true) { _visible.add(col.key); } else { _visible.remove(col.key); } }); setS(() {}); },
          )).toList())),
        ]),
      ))),
    );
  }

  Future<void> _delete(Map<String, dynamic> v) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف المركبة ${v['plateNumber']}؟', 'Delete ${v['plateNumber']}?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/vehicle-registry/${v['_id']}');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحذف', 'Deleted'))));
      _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canEdit = canEditVehicles(auth), canDelete = canAdminVehicles(auth);
    final q = _fold(_q.trim());
    final rows = q.isEmpty ? _rows : _rows.where((v) => [v['plateNumber'], v['chassisNumber'], v['ownerNameAr'], v['brandAr'], v['serialNumber'],
        (v['insurance'] as Map?)?['policyNumber'], (v['authorizedPerson'] as Map?)?['name']].any((x) => _fold((x ?? '').toString()).contains(q))).toList();
    // ما يُعرض في البطاقة من الأعمدة المختارة — عدا ما في رأسها أصلًا.
    const inHeader = {'plateNumber', 'brandAr', 'modelAr', 'sectorAr', 'ownerNameAr'};
    final extra = _shownCols.where((c) => !inHeader.contains(c.key)).toList();
    return AppScaffold(
      title: Text(tr('سجل المركبات', 'Vehicle Registry')),
      actions: [
        IconButton(tooltip: tr('التحليلات', 'Analytics'), icon: const Icon(Icons.bar_chart_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryDashboardScreen()))),
        IconButton(tooltip: tr('الانتهاءات والتجديد', 'Expiries & Renewals'), icon: const Icon(Icons.event_busy_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistryAlertsScreen()))),
        IconButton(tooltip: tr('الأعمدة', 'Columns'), icon: const Icon(Icons.view_column_outlined), onPressed: _pickColumns),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _loading ? null : () => _export(rows)),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () async { if (await showVehicleRegistryForm(context, null)) _load(); },
        icon: const Icon(Icons.add),
        label: Text(tr('إضافة', 'Add')),
      ),
      body: Column(children: [
          // البحثُ خارج فرع التحميل/الخطأ — لا يُعاد رسمُه فارغًا
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(
                        child: SearchField(
                          controller: _searchCtl,
                          onChanged: (v) {
                            setState(() => _q = v);
                            final mine = ++_seq;
                            Future.delayed(const Duration(milliseconds: 350), () { if (mounted && mine == _seq) _load(); });
                          },
                          hint: tr('ابحث بلوحة/هيكل/مالك/بوليصة…', 'plate / chassis / owner…'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // نفس لوحة الموقع: أي عدد من القيم في أي عدد من الحقول،
                      // وأعدادها محسوبة بعد بقيّة الفلاتر.
                      Badge(
                        isLabelVisible: _filters.isNotEmpty,
                        label: Text('${_filters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                          icon: const Icon(Icons.tune),
                          tooltip: tr('التصفية', 'Filter'),
                          onPressed: () async {
                            final r = await showFilterSheet(
                              context: context,
                              optionsUrl: '/api/vehicle-registry/filters',
                              value: _filters,
                              extraLabels: {
                                'missing': tr('ينقصها بيانات', 'Missing data'),
                                'hasGps': tr('التتبّع', 'GPS'),
                                'logistiGaps': tr('نواقص لوجستي', 'Logisti gaps'),
                                'missingDoc': tr('بدون مستند', 'Missing document'),
                                'missingDocDate': tr('بلا تاريخ انتهاء', 'No expiry date'),
                                'expiringDoc': tr('قارب انتهاؤه', 'Expiring'),
                                'expiringWithin': tr('خلال (يوم)', 'Within (days)'),
                                'expiredDoc': tr('منتهٍ', 'Expired'),
                                'expiryDoc': tr('المستند', 'Document'),
                                'expiryFrom': tr('الانتهاء من', 'Expiry from'),
                                'expiryTo': tr('الانتهاء إلى', 'Expiry to'),
                                'yearFrom': tr('سنة الصنع من', 'Year from'),
                                'yearTo': tr('سنة الصنع إلى', 'Year to'),
                                'missingItem': tr('البند الناقص', 'Missing item'),
                                'missingReason': tr('سبب النقص', 'Missing reason'),
                                'logistiGap': tr('شرط لوجستي', 'Logisti requirement'),
                                'insurancePolicy': tr('وثيقة التأمين', 'Policy'),
                              },
                            );
                            if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                          },
                        ),
                      ),
                    ]),
                  ),
          Expanded(child: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  if (widget.filterLabel != null)
                    Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Align(alignment: AlignmentDirectional.centerStart, child: Chip2(widget.filterLabel!, T.navy))),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.directions_car_outlined, title: tr('لا توجد مركبات مطابقة', 'No matching vehicles'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 10, 14, 90),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final st = (v['overallStatus'] ?? 'valid').toString();
                                final gaps = (v['logistiGaps'] is List) ? (v['logistiGaps'] as List) : const [];
                                final shown = extra.map((col) => (col, col.get(v))).where((x) => x.$2 != null && '${x.$2}'.isNotEmpty).toList();
                                return Pressable(
                                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: (v['_id'] ?? '').toString(), plate: (v['plateNumber'] ?? '').toString()))),
                                  child: AppCard(
                                    topAccent: statusColor(st),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                        // النقطةُ تقول «هنا عمل» لمنصّة لوجستي — وتفصيلُه في الملفّ.
                                        if (gaps.isNotEmpty)
                                          Tooltip(
                                            message: tr('ينقصها لمنصّة لوجستي: ${gaps.join(' · ')}', 'Logisti gaps: ${gaps.join(' · ')}'),
                                            child: Container(margin: const EdgeInsetsDirectional.only(start: 6), width: 7, height: 7, decoration: const BoxDecoration(color: T.violet, shape: BoxShape.circle)),
                                          ),
                                        const Spacer(),
                                        Chip2(statusLabel(st) + (v['overallDays'] != null && st != 'valid' ? ' · ${daysText(v['overallDays'])}' : ''), statusColor(st)),
                                        if (canEdit)
                                          IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                              onPressed: () async { if (await showVehicleRegistryForm(context, v)) _load(); }),
                                        if (canDelete)
                                          IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => _delete(v)),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('${v['brandAr'] ?? ''} ${v['modelAr'] ?? ''} · ${v['sectorAr'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                      // راكبُها من قسم الأفراد في إجازةٍ أو موقوفٌ أو في حادث.
                                      if (b2cOpChip((v['b2cRider'] as Map?)?['opStatus']) != null)
                                        Padding(padding: const EdgeInsets.only(top: 4), child: b2cOpChip((v['b2cRider'] as Map?)?['opStatus'], who: ((v['b2cRider'] as Map?)?['name'] ?? '').toString())!),
                                      if ((v['ownerNameAr'] ?? '').toString().isNotEmpty)
                                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(v['ownerNameAr'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                      if (shown.isNotEmpty)
                                        Padding(
                                          padding: const EdgeInsets.only(top: 6),
                                          child: Wrap(spacing: 10, runSpacing: 2, children: shown.map((x) {
                                            final days = x.$1.key.endsWith('Days') ? num.tryParse('${x.$2}') : null;
                                            return Text('${tr(x.$1.ar, x.$1.en)}: ${x.$2}', style: TextStyle(fontSize: 11,
                                                color: days == null ? T.inkSoft : days < 0 ? T.danger : days <= 30 ? T.warn : T.inkSoft,
                                                fontWeight: days != null && days <= 30 ? FontWeight.w700 : FontWeight.w400));
                                          }).toList()),
                                        ),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                  Padding(padding: const EdgeInsets.all(8), child: Text(tr('$_total مركبة', '$_total vehicles'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                ])),
        ]),
    );
  }
}

// ══════════════════ التفاصيل ══════════════════
class VehicleRegistryDetailScreen extends StatefulWidget {
  final String id, plate;
  const VehicleRegistryDetailScreen({super.key, required this.id, required this.plate});
  @override
  State<VehicleRegistryDetailScreen> createState() => _VehicleRegistryDetailScreenState();
}

class _VehicleRegistryDetailScreenState extends State<VehicleRegistryDetailScreen> {
  Map<String, dynamic>? _v;
  bool _loading = true;
  String? _error;
  final _note = TextEditingController();
  bool _noteTouched = false, _savingNote = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vreg:updated', _onLive); _note.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicle-registry/${widget.id}');
      if (!mounted) return;
      setState(() {
        _v = Map<String, dynamic>.from(d['vehicle'] ?? {});
        _loading = false; _error = null;
        if (!_noteTouched) _note.text = (_v!['notesAr'] ?? '').toString();
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  Future<void> _saveNote() async {
    setState(() => _savingNote = true);
    try {
      await Api.instance.put('/api/vehicle-registry/${widget.id}', {'notesAr': _note.text});
      _noteTouched = false;
      await _load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    if (mounted) setState(() => _savingNote = false);
  }

  Widget _row(String label, dynamic value, {Color? color, bool mono = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 2, child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(flex: 3, child: Text((value == null || value.toString().isEmpty) ? '—' : value.toString(), textAlign: TextAlign.end,
              textDirection: mono ? TextDirection.ltr : null,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color))),
        ]),
      );

  // سطرُ تاريخٍ بشارة الأيام بلون حالة المستند.
  Widget _dateRow(String label, dynamic date, String docKey) {
    final st = (_v?['docStatuses']?[docKey]) as Map?;
    if (date == null || '$date'.isEmpty) return _row(label, null);
    final s = (st?['status'] ?? 'none').toString();
    return _row(label, '${fmtDate(date)}${st?['days'] != null ? '  ·  ${daysText(st!['days'])}' : ''}', color: statusColor(s));
  }

  void _openFamily(String docKey) {
    final f = familyOf(docKey);
    if (f == null) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleDocumentsScreen(family: f, initialQuery: (_v?['plateNumber'] ?? '').toString())));
  }

  Widget _section(String title, IconData icon, Color accent, List<Widget> children, {String? docKey, String? linkLabel}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          topAccent: accent,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(icon, size: 18, color: accent),
              const SizedBox(width: 6),
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            ]),
            const SizedBox(height: 6),
            ...children,
            if (docKey != null && linkLabel != null)
              Align(alignment: AlignmentDirectional.centerStart, child: TextButton(onPressed: () => _openFamily(docKey), child: Text('$linkLabel ←', style: const TextStyle(fontSize: 12)))),
          ]),
        ),
      );

  // نواقصُ المركبة: ما يُعمَل لا ما كُتب في الشيت — كلُّ بندٍ مستندٌ معروفٌ يفتح صفحتَه.
  List<(String, String, String?)> _gaps(Map v) {
    final out = <(String, String, String?)>[];
    final seen = <String>{};
    for (final mi in (v['missingItems'] is List ? v['missingItems'] as List : const [])) {
      final item = (mi is Map ? (mi['item'] ?? '') : '').toString().trim();
      if (item.isEmpty || item.length > 34 || item.contains(':')) continue;
      final doc = docTypes.where((d) => item.contains(d.$2) || d.$2.contains(item)).firstOrNull;
      if (doc == null || seen.contains(doc.$1)) continue;
      seen.add(doc.$1);
      final reason = ((mi as Map)['reason'] ?? '').toString().trim();
      out.add((doc.$1, tr(doc.$2, doc.$3), reason.isEmpty ? null : reason));
    }
    for (final d in docTypes) {
      if (seen.contains(d.$1)) continue;
      final st = (v['docStatuses']?[d.$1]?['status'] ?? '').toString();
      if (!['expired', 'missing', 'required'].contains(st)) continue;
      seen.add(d.$1);
      out.add((d.$1, tr(d.$2, d.$3), st == 'expired' ? tr('منتهٍ', 'expired') : tr('غير مسجَّل', 'not recorded')));
    }
    return out;
  }

  List<Map<String, dynamic>> _flat(Map v) {
    Map o(String k) => v[k] is Map ? v[k] as Map : const {};
    final pairs = <(String, String, dynamic)>[
      ('رقم اللوحة', 'Plate', v['plateNumber']), ('رقم الهيكل', 'Chassis', v['chassisNumber']), ('الرقم التسلسلي', 'Serial', v['serialNumber']),
      ('القطاع', 'Sector', v['sectorAr']), ('الإدارة', 'Department', v['departmentAr']), ('المدينة', 'City', v['cityAr']),
      ('المالك', 'Owner', v['ownerNameAr']), ('حالة التشغيل', 'Service status', v['serviceStatusAr']),
      ('الماركة', 'Brand', v['brandAr']), ('الطراز', 'Model', v['modelAr']), ('سنة الصنع', 'Year', v['modelYear']), ('اللون', 'Colour', v['colorAr']),
      ('رقم وثيقة التأمين', 'Policy no.', o('insurance')['policyNumber']), ('شركة التأمين', 'Insurer', o('insurance')['companyAr']),
      ('انتهاء التأمين', 'Insurance expiry', fmtDate(o('insurance')['expiryDate'])),
      ('رقم بطاقة التشغيل', 'Operating card no.', o('operatingCard')['cardNumber']), ('انتهاء بطاقة التشغيل', 'Op. card expiry', fmtDate(o('operatingCard')['expiryDate'])),
      ('انتهاء رخصة السير', 'Licence expiry', fmtDate(o('vehicleLicense')['expiryDate'])), ('انتهاء الفحص', 'Inspection expiry', fmtDate(o('inspection')['expiryDate'])),
      ('جهاز GPS', 'GPS device', o('gps')['deviceModel']), ('سريال GPS', 'GPS serial', o('gps')['serialImei']), ('شركة الـGPS', 'GPS provider', o('gps')['provider']),
      ('انتهاء اشتراك GPS', 'GPS expiry', fmtDate(o('gps')['expiryDate'])),
      ('اسم المفوَّض', 'Authorised person', o('authorizedPerson')['name']), ('رقم الإقامة', 'Iqama', o('authorizedPerson')['iqamaNumber']),
      ('رقم التفويض', 'Authorisation no.', o('authorizedPerson')['authorizationNumber']), ('نهاية التفويض', 'Authorisation expiry', fmtDate(o('authorizedPerson')['expiryDate'])),
      ('رقم شريحة الوقود', 'Fuel card no.', o('fuelCard')['cardNumber']), ('الحوادث والمطالبات', 'Accidents & claims', v['accidentCount'] ?? 0),
    ];
    return pairs.map((p) => {'field': tr(p.$1, p.$2), 'value': p.$3 ?? ''}).toList();
  }

  @override
  Widget build(BuildContext context) {
    final v = _v;
    final canEdit = canEditVehicles(context.watch<AuthProvider>());
    Map o(String k) => v?[k] is Map ? v![k] as Map : const {};
    const neutral = Color(0xFF64748B);
    Color docAccent(String k) => statusColor((v?['docStatuses']?[k]?['status'] ?? 'none').toString());
    final gpsOn = ['deviceModel', 'serialImei', 'provider'].any((k) => (o('gps')[k] ?? '').toString().isNotEmpty);
    final auth = o('authorizedPerson');
    final authOn = (auth['name'] ?? '').toString().isNotEmpty || (auth['authorizationNumber'] ?? '').toString().isNotEmpty;
    final service = (v?['serviceStatusAr'] ?? '').toString();
    final outOfService = service.isNotEmpty && !RegExp('في الخدمة|مستخدم').hasMatch(service);
    final worst = (v?['overallStatus'] ?? 'none').toString();
    final renewals = v?['renewals'] is List ? (v!['renewals'] as List).whereType<Map>().toList() : const <Map>[];
    return AppScaffold(
      title: Text(widget.plate),
      actions: [
        if (v != null) ...[
          ReportButton(subject: 'vehicle', id: (v['plateNumber'] ?? widget.plate).toString(), label: tr('تقرير PDF شامل', 'Full PDF report'), compact: true),
          ExportButton(
            fileName: 'vehicle-${v['plateNumber'] ?? widget.plate}',
            sheetName: 'Vehicle',
            columns: [ExportCol('البند', 'Field', (r) => r['field']), ExportCol('القيمة', 'Value', (r) => r['value'])],
            rows: () => _flat(v),
          ),
        ],
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140)])
          : _error != null || v == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // الترويسة: اللوحة والحالة الأسوأ وحالة التشغيل.
                    AppCard(
                      topAccent: statusColor(worst),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text((v['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20))),
                          Chip2(statusLabel(worst), statusColor(worst)),
                          if (outOfService) ...[const SizedBox(width: 6), Chip2(service, T.inkSoft)],
                        ]),
                        Text([v['brandAr'], v['modelAr'], v['sectorAr'], v['cityAr']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                            style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                        // راكبُها من قسم الأفراد وحالتُه اليوم — تُكتب في «موظفو النقل الخفيف».
                        if (b2cOpChip((v['b2cRider'] as Map?)?['opStatus']) != null)
                          Padding(padding: const EdgeInsets.only(top: 6), child: b2cOpChip((v['b2cRider'] as Map?)?['opStatus'], who: ((v['b2cRider'] as Map?)?['name'] ?? '').toString())!),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    // حالة المستندات — البطاقةُ مدخلٌ لصفحة عائلتها، وزرُّ التجديد من مكانها.
                    GridView.count(
                      crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: canEdit ? 1.45 : 1.9, mainAxisSpacing: 8, crossAxisSpacing: 8,
                      children: docTypes.map((d) {
                        final st = (v['docStatuses']?[d.$1]) as Map<String, dynamic>?;
                        final s = (st?['status'] ?? 'none').toString();
                        final date = docDateOf(v, d.$1);
                        return AppCard(
                          padding: EdgeInsets.zero,
                          topAccent: statusColor(s),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Expanded(child: InkWell(
                              onTap: () => _openFamily(d.$1),
                              child: Padding(
                                padding: const EdgeInsets.all(10),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                                  Text(tr(d.$2, d.$3), style: const TextStyle(fontSize: 11, color: T.inkFaint, fontWeight: FontWeight.w700)),
                                  const SizedBox(height: 2),
                                  Text(statusLabel(s), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: statusColor(s))),
                                  Text(date == null ? '—' : fmtDate(date), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                                  if (st?['days'] != null) Text(daysText(st!['days']), style: TextStyle(fontSize: 10.5, color: statusColor(s), fontWeight: FontWeight.w700)),
                                ]),
                              ),
                            )),
                            if (canEdit)
                              InkWell(
                                onTap: () async { if (await showRenewSheet(context, renewTargetOf(v, d.$1))) _load(); },
                                child: Container(
                                  color: const Color(0xFFECFDF5),
                                  padding: const EdgeInsets.symmetric(vertical: 6),
                                  child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                                    const Icon(Icons.autorenew, size: 14, color: T.success),
                                    const SizedBox(width: 4),
                                    Text(tr('تجديد', 'Renew'), style: const TextStyle(fontSize: 11.5, color: T.success, fontWeight: FontWeight.w800)),
                                  ]),
                                ),
                              ),
                          ]),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 10),
                    ...(() {
                      final gaps = _gaps(v);
                      if (gaps.isEmpty) return <Widget>[];
                      return [
                        Container(
                          padding: const EdgeInsets.all(12),
                          margin: const EdgeInsets.only(bottom: 10),
                          decoration: BoxDecoration(color: const Color(0xFFFFFBEB), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFFCD34D), width: 2)),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('نواقص هذه المركبة (${gaps.length})', 'What this vehicle is missing (${gaps.length})'), style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF78350F))),
                            const SizedBox(height: 8),
                            Wrap(spacing: 6, runSpacing: 6, children: gaps.map((g) => ActionChip(
                              backgroundColor: Colors.white,
                              side: const BorderSide(color: Color(0xFFFCD34D)),
                              label: Text('${g.$2}${g.$3 == null ? '' : ' · ${g.$3}'}', style: const TextStyle(fontSize: 12, color: Color(0xFF78350F))),
                              onPressed: () => _openFamily(g.$1),
                            )).toList()),
                          ]),
                        ),
                      ];
                    })(),
                    _section(tr('الهوية والتصنيف', 'Identity & classification'), Icons.directions_car_outlined, neutral, [
                      _row(tr('رقم اللوحة', 'Plate'), v['plateNumber'], mono: true),
                      _row(tr('رقم الهيكل', 'Chassis'), v['chassisNumber'], mono: true),
                      _row(tr('الرقم التسلسلي', 'Serial'), v['serialNumber'], mono: true),
                      _row(tr('القطاع', 'Sector'), v['sectorAr']),
                      _row(tr('الإدارة', 'Department'), v['departmentAr']),
                      _row(tr('المدينة', 'City'), v['cityAr']),
                      _row(tr('نوع التسجيل', 'Registration type'), v['registrationTypeAr']),
                      _row(tr('الماركة / الطراز', 'Brand / model'), [v['brandAr'], v['modelAr']].where((x) => (x ?? '').toString().isNotEmpty).join(' ')),
                      _row(tr('سنة الصنع', 'Year'), v['modelYear']),
                      _row(tr('اللون', 'Colour'), v['colorAr']),
                      _row(tr('حالة التشغيل', 'Service status'), v['serviceStatusAr'], color: outOfService ? T.danger : T.success),
                    ]),
                    _section(tr('الملكية والحيازة', 'Ownership'), Icons.business_outlined, neutral, [
                      // المجموعةُ شركتان والأسطولُ مشتركُ التشغيلِ مفصولُ الملكيّة.
                      _row(tr('الشركة المالكة', 'Owning company'), v['ownerCompanyAr']),
                      _row(tr('المالك', 'Owner'), v['ownerNameAr']),
                      _row(tr('السجل التجاري', 'Commercial reg.'), v['commercialRegistration'], mono: true),
                      _row(tr('حالة الحيازة', 'Possession'), v['possessionStatusAr']),
                      _row(tr('حالة تم', 'Tam status'), v['tamStatusAr']),
                      // الحوادث تُقرأ من مطالبات هذا القسم — والرقمُ يفتح ما يعدّه.
                      InkWell(
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleClaimsScreen(initialQuery: (v['plateNumber'] ?? '').toString()))),
                        child: _row(tr('الحوادث والمطالبات', 'Accidents & claims'), '${v['accidentCount'] ?? 0}  ↗', color: (v['accidentCount'] ?? 0) != 0 ? T.danger : null),
                      ),
                    ]),
                    _section(tr('جهاز التتبّع GPS', 'GPS tracking'), Icons.satellite_alt_outlined, gpsOn ? docAccent('gps') : neutral, [
                      _row(tr('جهاز GPS', 'GPS device'), (o('gps')['deviceModel'] ?? '').toString().isNotEmpty ? o('gps')['deviceModel'] : (gpsOn ? null : tr('غير مركّب', 'Not installed'))),
                      // حالةُ الجهاز غيرُ حالة الاشتراك.
                      _row(tr('حالة جهاز GPS', 'Device status'), o('gps')['deviceStatusAr'] ?? o('gps')['status']),
                      _row(tr('شركة الـGPS', 'Provider'), o('gps')['provider']),
                      _row(tr('سريال GPS', 'Serial / IMEI'), o('gps')['serialImei'], mono: true),
                      _row(tr('رقم الشريحة', 'SIM number'), o('gps')['simNumber'], mono: true),
                      _dateRow(tr('انتهاء الاشتراك', 'Subscription expiry'), o('gps')['expiryDate'], 'gps'),
                    ], docKey: gpsOn ? 'gps' : null, linkLabel: tr('صفحة أجهزة التتبّع', 'GPS page')),
                    _section(tr('التفويض بالقيادة', 'Driving authorisation'), Icons.badge_outlined, authOn ? docAccent('authorization') : neutral, [
                      _row(tr('اسم المفوَّض', 'Authorised person'), auth['name']),
                      _row(tr('الوظيفة', 'Job title'), auth['jobTitleAr']),
                      _row(tr('رقم الإقامة', 'Iqama number'), auth['iqamaNumber'], mono: true),
                      _row(tr('رقم التفويض', 'Authorisation number'), auth['authorizationNumber'], mono: true),
                      _row(tr('بداية التفويض', 'Start date'), auth['startDate'] == null ? null : fmtDate(auth['startDate'])),
                      _dateRow(tr('نهاية التفويض', 'End date'), auth['expiryDate'], 'authorization'),
                    ], docKey: authOn ? 'authorization' : null, linkLabel: tr('صفحة التفاويض', 'Authorisations page')),
                    _section(tr('التأمين', 'Insurance'), Icons.verified_user_outlined, docAccent('insurance'), [
                      _row(tr('رقم الوثيقة', 'Policy no.'), o('insurance')['policyNumber'], mono: true),
                      _row(tr('الشركة', 'Company'), o('insurance')['companyAr']),
                      _row(tr('نوع التغطية', 'Coverage'), o('insurance')['coverageTypeAr']),
                      _dateRow(tr('تاريخ الانتهاء', 'Expiry'), o('insurance')['expiryDate'], 'insurance'),
                      _row(tr('القسط', 'Premium'), o('insurance')['premiumSar'] != null && o('insurance')['premiumSar'] != 0 ? '${money(o('insurance')['premiumSar'])} ${tr('ر.س', 'SAR')}' : null),
                      _row(tr('حالة القسط', 'Premium status'), o('insurance')['premiumStatusAr']),
                    ], docKey: 'insurance', linkLabel: tr('صفحة تأمين المركبات', 'Vehicle-insurance page')),
                    _section(tr('شريحة الوقود', 'Fuel card'), Icons.local_gas_station_outlined, T.cyan, [
                      _row(tr('المزوّد', 'Provider'), o('fuelCard')['provider']),
                      _row(tr('رقم الشريحة', 'Card no.'), o('fuelCard')['cardNumber'], mono: true),
                      _row(tr('اللوحة على الفاتورة', 'Plate on invoice'), o('fuelCard')['plateOnInvoiceAr']),
                      _row(tr('الحالة', 'Status'), o('fuelCard')['statusAr']),
                      _row(tr('نوع الاستهلاك', 'Consumption'), o('fuelCard')['consumptionTypeAr']),
                      _row(tr('الحد', 'Limit'), o('fuelCard')['limitStatus'] == 'open' ? tr('بدون سقف', 'Open') : (o('fuelCard')['limitSar'] != null && o('fuelCard')['limitSar'] != 0 ? money(o('fuelCard')['limitSar']) : null),
                          color: o('fuelCard')['limitStatus'] == 'open' ? T.success : null),
                    ]),
                    Align(alignment: AlignmentDirectional.centerStart, child: TextButton(
                        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleDocumentsScreen(family: vehicleFuelCardFamily, initialQuery: (v['plateNumber'] ?? '').toString()))),
                        child: Text('${tr('صفحة بترو اب', 'Fuel-cards page')} ←', style: const TextStyle(fontSize: 12)))),
                    _section(tr('بطاقة التشغيل', 'Operating card'), Icons.credit_card_outlined, docAccent('operatingCard'), [
                      _row(tr('رقم البطاقة', 'Card no.'), o('operatingCard')['cardNumber'], mono: true),
                      _dateRow(tr('تاريخ الانتهاء', 'Expiry'), o('operatingCard')['expiryDate'], 'operatingCard'),
                    ], docKey: 'operatingCard', linkLabel: tr('صفحة بطاقات التشغيل', 'Operating-cards page')),
                    _section(tr('رخصة السير', 'Vehicle licence'), Icons.description_outlined, docAccent('vehicleLicense'), [
                      _dateRow(tr('تاريخ الانتهاء', 'Expiry'), o('vehicleLicense')['expiryDate'], 'vehicleLicense'),
                      // الهجريُّ المكتوبُ في الرخصة أوّلًا — والمحسوبُ إن لم يُسجَّل.
                      _row(tr('تاريخ الانتهاء (هجري)', 'Expiry (Hijri)'), (o('vehicleLicense')['expiryDateHijri'] ?? '').toString().isNotEmpty
                          ? o('vehicleLicense')['expiryDateHijri'] : hijriPlain(fmtDate(o('vehicleLicense')['expiryDate'])), mono: true),
                    ], docKey: 'vehicleLicense', linkLabel: tr('صفحة رخص السير', 'Licences page')),
                    _section(tr('الفحص الدوري', 'Periodic inspection'), Icons.fact_check_outlined, docAccent('inspection'), [
                      _row(tr('حالة الفحص', 'Status'), o('inspection')['statusAr']),
                      _dateRow(tr('انتهاء الفحص', 'Expiry'), o('inspection')['expiryDate'], 'inspection'),
                      _row(tr('انتهاء الفحص (هجري)', 'Expiry (Hijri)'), (o('inspection')['expiryDateHijri'] ?? '').toString().isNotEmpty
                          ? o('inspection')['expiryDateHijri'] : hijriPlain(fmtDate(o('inspection')['expiryDate'])), mono: true),
                    ], docKey: 'inspection', linkLabel: tr('صفحة الفحص', 'Inspection page')),
                    // الملاحظةُ تُكتب حيث تُقرأ — والكارتُ يظهر ولو كانت فارغة.
                    _section(tr('ملاحظات', 'Notes'), Icons.notes_outlined, neutral, [
                      if (!canEdit)
                        Text((v['notesAr'] ?? '').toString().isEmpty ? '—' : v['notesAr'].toString(), style: const TextStyle(fontSize: 13))
                      else ...[
                        TextField(
                          controller: _note,
                          maxLines: 3,
                          onChanged: (_) => setState(() => _noteTouched = true),
                          decoration: InputDecoration(hintText: tr('اكتب ملاحظةً عن هذه المركبة…', 'Write a note about this vehicle…')),
                        ),
                        if (_note.text != (v['notesAr'] ?? '').toString())
                          Row(children: [
                            FilledButton(onPressed: _savingNote ? null : _saveNote, child: Text(_savingNote ? tr('يُحفظ…', 'Saving…') : tr('حفظ الملاحظة', 'Save note'))),
                            const SizedBox(width: 8),
                            TextButton(onPressed: () => setState(() { _note.text = (v['notesAr'] ?? '').toString(); _noteTouched = false; }), child: Text(tr('تراجع', 'Undo'))),
                          ]),
                      ],
                    ]),
                    // ملفّات المركبة — صورُ ما سبق من مستندات.
                    _VehicleFiles(vehicleId: (v['_id'] ?? widget.id).toString(), canEdit: canEdit),
                    // سجلّ التجديدات — الأثر يُقرأ إلى الوراء.
                    if (renewals.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text('${tr('سجلّ التجديدات', 'Renewal history')} (${renewals.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                      const SizedBox(height: 6),
                      ...renewals.map((r) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: AppCard(
                          padding: const EdgeInsets.all(10),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text(docLabel((r['document'] ?? '').toString()), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                              Text(r['at'] == null ? '—' : fmtDate(r['at']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            ]),
                            const SizedBox(height: 3),
                            Text.rich(TextSpan(children: [
                              TextSpan(text: r['previousExpiry'] == null ? '—' : fmtDate(r['previousExpiry']), style: const TextStyle(decoration: TextDecoration.lineThrough, color: T.inkFaint)),
                              const TextSpan(text: '  →  '),
                              TextSpan(text: fmtDate(r['newExpiry']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
                            ]), style: const TextStyle(fontSize: 12)),
                            if ((r['previousNumber'] ?? '').toString().isNotEmpty || (r['newNumber'] ?? '').toString().isNotEmpty)
                              Text.rich(TextSpan(children: [
                                TextSpan(text: (r['previousNumber'] ?? '—').toString(), style: const TextStyle(decoration: TextDecoration.lineThrough, color: T.inkFaint)),
                                const TextSpan(text: '  →  '),
                                TextSpan(text: (r['newNumber'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                              ]), style: const TextStyle(fontSize: 12)),
                            Text([
                              if (r['cost'] != null) '${tr('التكلفة', 'Cost')}: ${money(r['cost'])}',
                              if ((r['reference'] ?? '').toString().isNotEmpty) '${tr('رقم الإيصال', 'Reference')}: ${r['reference']}',
                              if ((r['byName'] ?? '').toString().isNotEmpty) '${tr('بواسطة', 'By')}: ${r['byName']}',
                            ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                            if ((r['note'] ?? '').toString().isNotEmpty) Text(r['note'].toString(), style: const TextStyle(fontSize: 11.5)),
                          ]),
                        ),
                      )),
                    ],
                    const SizedBox(height: 10),
                    // مهامّ JP المربوطة بهذه المركبة — تُضاف من هنا.
                    JpTaskPanel(section: 'vehicles', kind: 'vehicle', refId: '${v['_id'] ?? widget.id}'),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }
}

// ══════════════════ ملفّات المركبة — توأمُ VehicleDocuments في الموقع ══════════════════
class _VehicleFiles extends StatefulWidget {
  final String vehicleId;
  final bool canEdit;
  const _VehicleFiles({required this.vehicleId, required this.canEdit});
  @override
  State<_VehicleFiles> createState() => _VehicleFilesState();
}

class _VehicleFilesState extends State<_VehicleFiles> {
  List<Map<String, dynamic>> _docs = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vehicle-registry/${widget.vehicleId}/documents');
      if (mounted) setState(() { _docs = List<Map<String, dynamic>>.from(d['documents'] ?? []); _loading = false; });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  String _cat(String k) => k == 'other' ? tr('أخرى', 'Other') : docLabel(k);

  Future<void> _form(Map<String, dynamic>? doc) async {
    final title = TextEditingController(text: (doc?['title'] ?? '').toString());
    final notes = TextEditingController(text: (doc?['notes'] ?? '').toString());
    String category = (doc?['category'] ?? 'other').toString();
    if (category != 'other' && !docTypes.any((d) => d.$1 == category)) category = 'other';
    String expiry = (doc?['expiryDate'] ?? '').toString().split('T').first;
    PickedFile? file;
    bool busy = false;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(doc == null ? tr('رفع ملفّ', 'Upload a file') : tr('تعديل الملفّ', 'Edit file'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 12),
          if (doc == null) ...[
            OutlinedButton.icon(
              icon: const Icon(Icons.attach_file),
              label: Text(file == null ? tr('اختر ملفًّا', 'Pick a file') : file!.fileName, overflow: TextOverflow.ellipsis),
              onPressed: () async {
                final f = await pickFileAsDataUrl();
                if (f == null) return;
                if (f.sizeBytes > 20 * 1024 * 1024) { if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('الملفّ أكبر من ٢٠ ميغا', 'File is larger than 20MB')))); return; }
                setS(() { file = f; if (title.text.trim().isEmpty) title.text = f.fileName.replaceFirst(RegExp(r'\.[^.]+$'), ''); });
              },
            ),
            const SizedBox(height: 10),
          ],
          TextField(controller: title, decoration: InputDecoration(labelText: tr('اسم الملفّ *', 'File name *'))),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: category,
            decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
            items: [
              ...docTypes.map((d) => DropdownMenuItem(value: d.$1, child: Text(tr(d.$2, d.$3)))),
              DropdownMenuItem(value: 'other', child: Text(tr('أخرى', 'Other'))),
            ],
            onChanged: (x) => setS(() => category = x ?? category),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.event, size: 18),
            label: Text('${tr('تاريخ الانتهاء', 'Expiry date')}: ${expiry.isEmpty ? '—' : expiry}'),
            onPressed: () async {
              final d = await showDatePicker(context: c, initialDate: DateTime.tryParse(expiry) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
              if (d != null) setS(() => expiry = d.toIso8601String().split('T').first);
            },
          ),
          const SizedBox(height: 10),
          TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: busy ? null : () async {
              if (title.text.trim().isEmpty) { ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اكتب اسمًا للملفّ', 'Give the file a name')))); return; }
              if (doc == null && file == null) { ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اختر ملفًّا', 'Pick a file')))); return; }
              setS(() => busy = true);
              final form = {'title': title.text.trim(), 'category': category, 'expiryDate': expiry, 'notes': notes.text.trim()};
              try {
                if (doc != null) {
                  await Api.instance.put('/api/vehicle-registry/documents/${doc['_id']}', form);
                } else {
                  await Api.instance.post('/api/vehicle-registry/${widget.vehicleId}/documents', {...form, 'dataUrl': file!.dataUrl, 'fileName': file!.fileName});
                }
                if (c.mounted) Navigator.pop(c, true);
              } catch (e) {
                setS(() => busy = false);
                if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
              }
            },
            child: Text(busy ? tr('يُحفظ…', 'Saving…') : tr('حفظ', 'Save')),
          ),
        ])),
      ))),
    );
    if (ok == true) { _snack(tr('حُفظ', 'Saved')); _load(); }
  }

  Future<void> _remove(Map<String, dynamic> d) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف «${d['title']}» نهائيًّا؟ يُمسح الملفّ نفسه من الخادم.', 'Delete "${d['title']}" permanently? The file itself is removed from the server.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/vehicle-registry/documents/${d['_id']}'); _load(); } catch (e) { _snack(e.toString()); }
  }

  void _open(Map<String, dynamic> d) {
    final u = (d['fileUrl'] ?? '').toString();
    if (u.isEmpty) return;
    launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.attach_file, size: 18, color: T.inkSoft),
            const SizedBox(width: 6),
            Expanded(child: Text('${tr('ملفّات المركبة', 'Vehicle files')} (${_docs.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            if (widget.canEdit)
              TextButton.icon(onPressed: () => _form(null), icon: const Icon(Icons.upload_file, size: 18), label: Text(tr('رفع', 'Upload'))),
          ]),
          if (_loading)
            const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator()))
          else if (_docs.isEmpty)
            Padding(padding: const EdgeInsets.all(8), child: Text(tr('لا ملفّات بعد', 'No files yet'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)))
          else
            ..._docs.map((d) {
              final size = d['size'] is num ? '${((d['size'] as num) / 1024).round().clamp(1, 1 << 30)} KB' : '';
              return ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Icon((d['mimeType'] ?? '').toString().startsWith('image/') ? Icons.image_outlined : Icons.insert_drive_file_outlined),
                title: Text((d['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  _cat((d['category'] ?? 'other').toString()),
                  if ((d['expiryDate'] ?? '').toString().isNotEmpty) '${tr('ينتهي', 'expires')} ${d['expiryDate']}',
                  size, (d['uploadedByName'] ?? '').toString(), fmtDate(d['createdAt']),
                  if ((d['notes'] ?? '').toString().isNotEmpty) d['notes'].toString(),
                ].where((x) => x.isNotEmpty && x != '—').join(' · '), style: const TextStyle(fontSize: 11)),
                onTap: () => _open(d),
                trailing: widget.canEdit
                    ? Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(icon: const Icon(Icons.edit_outlined, size: 18), tooltip: tr('تعديل الاسم', 'Rename'), onPressed: () => _form(d)),
                        IconButton(icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), tooltip: tr('حذف', 'Delete'), onPressed: () => _remove(d)),
                      ])
                    : const Icon(Icons.open_in_new, size: 18),
              );
            }),
        ]),
      ),
    );
  }
}
