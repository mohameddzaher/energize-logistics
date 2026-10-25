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
import 'vehicle_documents.dart' show stateMetaOf;
import 'vehicle_registry.dart' show fmtDate, daysText, canEditVehicles, VehicleRegistryDetailScreen;
import 'vehicle_renew.dart';
import 'vehicle_registry_dash.dart' show VehicleRegistrySettingsScreen;

/// ── الانتهاءات والتجديد — توأمُ /system/vehicles/registry/expiring ─────────────
///
/// كلُّ مستندٍ له تاريخ في صفٍّ واحد (`/api/vehicle-registry/expiring`): المدّةُ
/// والمستندُ والحالةُ على الخادم، والبحثُ و«تنبيهه متقفول» هنا. وتجديدُ صفٍّ أو
/// تجديدُ المختار كلِّه بتاريخٍ واحد — بنافذتَي vehicle_renew نفسيهما.

const _states = ['expired', 'critical', 'warning', 'upcoming', 'valid'];
const _quick = [7, 15, 30, 60, 90, 180];

class VehicleExpiringScreen extends StatefulWidget {
  final String? doc, state, withinDays;
  const VehicleExpiringScreen({super.key, this.doc, this.state, this.withinDays});
  @override
  State<VehicleExpiringScreen> createState() => _VehicleExpiringScreenState();
}

class _VehicleExpiringScreenState extends State<VehicleExpiringScreen> {
  late String _within = widget.withinDays ?? '60';
  late final _withinCtl = TextEditingController(text: _within);
  late String _doc = widget.doc ?? '';
  late String _state = widget.state ?? '';
  bool _includeExpired = true;
  String _q = '';
  bool _mutedOnly = false;
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  final Set<String> _picked = {};
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    _withinCtl.dispose();
    super.dispose();
  }

  String _rowKey(Map r) => (r['rowId'] ?? '${r['vehicleId']}:${r['docKey']}').toString();

  Future<void> _load({bool debounce = false}) async {
    final mine = ++_seq;
    if (debounce) {
      await Future.delayed(const Duration(milliseconds: 250));
      if (mine != _seq) return;
    }
    try {
      final p = <String>[
        if (_within.isNotEmpty) 'withinDays=$_within',
        if (_doc.isNotEmpty) 'doc=$_doc',
        if (_state.isNotEmpty) 'state=$_state',
        'includeExpired=${_includeExpired ? '1' : '0'}',
      ];
      final d = await Api.instance.get('/api/vehicle-registry/expiring?${p.join('&')}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _all => List<Map<String, dynamic>>.from(((_d?['rows'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));

  List<Map<String, dynamic>> _rows() {
    final needle = _q.trim().toLowerCase();
    return _all.where((r) {
      if (_mutedOnly && r['alertEnabled'] != false) return false;
      if (needle.isEmpty) return true;
      return ['plateNumber', 'chassisNumber', 'serialNumber', 'driverCardNumber', 'holder', 'brandAr', 'modelAr', 'modelYear', 'sectorAr', 'ownerNameAr', 'docAr', 'docEn', 'reference']
          .any((k) => (r[k] ?? '').toString().toLowerCase().contains(needle));
    }).toList();
  }

  RenewTarget _target(Map r) => RenewTarget(
        vehicleId: (r['vehicleId'] ?? '').toString(),
        driverCardId: r['driverCardId']?.toString(),
        plateNumber: (r['plateNumber'] ?? r['holder'] ?? '').toString(),
        docKey: (r['docKey'] ?? '').toString(),
        expiryDate: r['expiryDate']?.toString(),
      );

  List<ExportCol> get _cols => [
        ExportCol('رقم اللوحة', 'Plate', (r) => r['plateNumber'] ?? ''),
        ExportCol('رقم الهيكل', 'Chassis', (r) => r['chassisNumber'] ?? ''),
        ExportCol('الرقم التسلسلي', 'Serial', (r) => r['serialNumber'] ?? ''),
        ExportCol('نوع التسجيل', 'Registration type', (r) => r['registrationTypeAr'] ?? ''),
        ExportCol('ماركة المركبة', 'Brand', (r) => r['brandAr'] ?? ''),
        ExportCol('طراز المركبة', 'Model', (r) => r['modelAr'] ?? ''),
        ExportCol('الموديل', 'Year', (r) => r['modelYear'] ?? ''),
        ExportCol('اللون', 'Colour', (r) => r['colorAr'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['holder'] ?? ''),
        ExportCol('رقم البطاقة', 'Driver card no.', (r) => r['driverCardNumber'] ?? ''),
        ExportCol('المستند', 'Document', (r) => r['docAr'] ?? ''),
        ExportCol('ينتهي في', 'Expires', (r) => fmtDate(r['expiryDate'])),
        ExportCol('الأيام المتبقية', 'Days left', (r) => r['daysRemaining'] ?? ''),
        ExportCol('الحالة', 'State', (r) => stateMetaOf(r['state']?.toString()).$1),
        ExportCol('القطاع', 'Sector', (r) => r['sectorAr'] ?? ''),
        ExportCol('المالك', 'Owner', (r) => r['ownerNameAr'] ?? ''),
        ExportCol('المرجع', 'Reference', (r) => r['reference'] ?? ''),
        ExportCol('التنبيه مفعّل', 'Alert on', (r) => r['alertEnabled'] == false ? tr('لا', 'No') : tr('نعم', 'Yes')),
      ];

  Future<void> _export(List<Map<String, dynamic>> shown) async {
    final filtered = _q.trim().isNotEmpty || _mutedOnly || _doc.isNotEmpty || _state.isNotEmpty || _within.isNotEmpty || !_includeExpired;
    String scope = 'shown';
    if (filtered) {
      final s = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض (بعد الفلتر)', 'Shown (filtered)')), onTap: () => Navigator.pop(c, 'shown')),
        ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكلّ', 'Everything')), onTap: () => Navigator.pop(c, 'all')),
      ])));
      if (s == null) return;
      scope = s;
    }
    var rows = shown;
    if (scope == 'all') {
      try {
        final d = await Api.instance.get('/api/vehicle-registry/expiring?includeExpired=1');
        rows = List<Map<String, dynamic>>.from(((d['rows'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
        return;
      }
    }
    if (!mounted) return;
    if (rows.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export')))); return; }
    await exportExcel(context, fileName: 'vehicle-expiries', sheets: [(tr('الانتهاءات', 'Expiries'), _cols, rows)]);
  }

  Widget _chip(String label, bool on, VoidCallback onTap, {Color tone = T.orange}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 5),
        child: ChoiceChip(
          visualDensity: VisualDensity.compact,
          label: Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
          selected: on,
          selectedColor: tone,
          showCheckmark: false,
          onSelected: (_) => onTap(),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final canEdit = canEditVehicles(context.watch<AuthProvider>());
    final rows = _rows();
    final all = _all;
    final summary = <String, int>{for (final k in _states) k: 0};
    final byDocCount = <String, int>{};
    for (final r in rows) {
      final k = (r['state'] ?? '').toString();
      summary[k] = (summary[k] ?? 0) + 1;
      final dk = (r['docKey'] ?? '').toString();
      byDocCount[dk] = (byDocCount[dk] ?? 0) + 1;
    }
    final byDoc = ((_d?['byDoc'] as List?) ?? const []).whereType<Map>().toList();
    final docs = ((_d?['docs'] as List?) ?? const []).whereType<Map>().toList();
    final muted = all.where((r) => r['alertEnabled'] == false).length;
    final pickedRows = rows.where((r) => _picked.contains(_rowKey(r))).toList();
    final allPicked = rows.isNotEmpty && rows.every((r) => _picked.contains(_rowKey(r)));

    return AppScaffold(
      title: Text(tr('الانتهاءات والتجديد', 'Expiries & Renewals')),
      actions: [
        IconButton(tooltip: tr('إعدادات التنبيهات', 'Alert settings'), icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleRegistrySettingsScreen()))),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _d == null ? null : () => _export(rows)),
      ],
      floatingActionButton: !canEdit || pickedRows.isEmpty ? null : FloatingActionButton.extended(
        backgroundColor: T.success,
        icon: const Icon(Icons.autorenew),
        label: Text(tr('تجديدها بتاريخ واحد (${pickedRows.length})', 'Renew to one date (${pickedRows.length})')),
        onPressed: () async {
          if (await showBulkRenewSheet(context, pickedRows.map(_target).toList())) {
            setState(() => _picked.clear());
            _load();
          }
        },
      ),
      body: _loading && _d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer()])
          : _error != null && _d == null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Text(tr('ينتهي خلال', 'Expiring within'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                        const SizedBox(width: 8),
                        SizedBox(width: 70, child: TextField(
                          controller: _withinCtl,
                          keyboardType: TextInputType.number,
                          textAlign: TextAlign.center,
                          decoration: const InputDecoration(isDense: true),
                          onChanged: (x) { setState(() => _within = x.trim()); _load(debounce: true); },
                        )),
                        const SizedBox(width: 6),
                        Text(tr('يوم', 'days'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      ]),
                      const SizedBox(height: 6),
                      SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                        for (final n in _quick) _chip('$n', _within == '$n', () { setState(() { _within = '$n'; _withinCtl.text = '$n'; }); _load(); }),
                        _chip(tr('الكل', 'All'), _within.isEmpty, () { setState(() { _within = ''; _withinCtl.clear(); }); _load(); }, tone: T.ink),
                      ])),
                      const Divider(height: 18),
                      TextField(
                        onChanged: (x) => setState(() => _q = x),
                        decoration: InputDecoration(isDense: true, hintText: tr('لوحة · اسم · مالك · قطاع · ماركة…', 'Plate · name · owner · sector · brand…'), prefixIcon: const Icon(Icons.search)),
                      ),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: DropdownButtonFormField<String>(
                          initialValue: docs.any((x) => x['key'] == _doc) ? _doc : '',
                          isExpanded: true,
                          decoration: const InputDecoration(isDense: true),
                          items: [
                            DropdownMenuItem(value: '', child: Text(tr('كل المستندات', 'All documents'))),
                            ...docs.map((x) => DropdownMenuItem(value: (x['key'] ?? '').toString(), child: Text(tr('${x['ar']}', '${x['en']}')))),
                          ],
                          onChanged: (x) { setState(() => _doc = x ?? ''); _load(); },
                        )),
                        const SizedBox(width: 8),
                        Expanded(child: DropdownButtonFormField<String>(
                          initialValue: _states.contains(_state) ? _state : '',
                          isExpanded: true,
                          decoration: const InputDecoration(isDense: true),
                          items: [
                            DropdownMenuItem(value: '', child: Text(tr('كل الحالات', 'All states'))),
                            ..._states.map((s) => DropdownMenuItem(value: s, child: Text(stateMetaOf(s).$1))),
                          ],
                          onChanged: (x) { setState(() => _state = x ?? ''); _load(); },
                        )),
                      ]),
                      Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          Checkbox(value: _includeExpired, onChanged: (x) { setState(() => _includeExpired = x == true); _load(); }),
                          Text(tr('اعرض المنتهي بالفعل', 'Include already expired'), style: const TextStyle(fontSize: 12)),
                        ]),
                        // ما أُقفل تنبيهُه يبقى معروضًا ومعلَّمًا — لا يُحذف في صمت.
                        if (muted > 0)
                          _chip('${tr('تنبيهه متقفول', 'Alert muted')} $muted', _mutedOnly, () => setState(() => _mutedOnly = !_mutedOnly), tone: T.ink),
                      ]),
                      Align(alignment: AlignmentDirectional.centerEnd, child: Text('${rows.length}${rows.length != all.length ? ' / ${all.length}' : ''} ${tr('صف', 'rows')}',
                          style: const TextStyle(fontSize: 11, color: T.inkFaint))),
                    ])),
                    const SizedBox(height: 10),
                    // كروت الحالات — الضغطُ يفلتر عليها.
                    GridView.count(
                      crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 1.7, mainAxisSpacing: 8, crossAxisSpacing: 8,
                      children: [
                        ..._states.map((k) {
                          final m = stateMetaOf(k);
                          final on = _state == k;
                          return InkWell(
                            onTap: () { setState(() => _state = on ? '' : k); _load(); },
                            child: Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: on ? T.orange : const Color(0xFFE2E8F0), width: on ? 2 : 1)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                                Text('${summary[k] ?? 0}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: m.$2)),
                                Text(m.$1, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                              ]),
                            ),
                          );
                        }),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(12)),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text('${rows.length}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
                            Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontSize: 11, color: Color(0xFFCBD5E1))),
                          ]),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(children: byDoc.map((x) {
                      final k = (x['key'] ?? '').toString();
                      return _chip('${tr('${x['ar']}', '${x['en']}')} ${byDocCount[k] ?? 0}', _doc == k, () { setState(() => _doc = _doc == k ? '' : k); _load(); }, tone: T.navy);
                    }).toList()),
                    if (canEdit && rows.isNotEmpty)
                      Row(children: [
                        Checkbox(
                          value: allPicked,
                          onChanged: (x) => setState(() {
                            for (final r in rows) { x == true ? _picked.add(_rowKey(r)) : _picked.remove(_rowKey(r)); }
                          }),
                        ),
                        Text(tr('اختيار كل المعروض', 'Select all shown'), style: const TextStyle(fontSize: 12)),
                        const Spacer(),
                        if (_picked.isNotEmpty) TextButton(onPressed: () => setState(() => _picked.clear()), child: Text(tr('إلغاء الاختيار', 'Clear'))),
                      ]),
                    if (rows.isEmpty)
                      Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.event_available_outlined, title: tr('لا شيء ينتهي خلال هذه المدة', 'Nothing expires in this window'))),
                    ...rows.map((r) {
                      final m = stateMetaOf(r['state']?.toString());
                      final key = _rowKey(r);
                      final vid = (r['vehicleId'] ?? '').toString();
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          topAccent: m.$2,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              if (canEdit)
                                SizedBox(width: 30, height: 24, child: Checkbox(
                                  value: _picked.contains(key),
                                  onChanged: (x) => setState(() => x == true ? _picked.add(key) : _picked.remove(key)),
                                )),
                              Expanded(child: vid.isEmpty
                                  ? Text((r['holder'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))
                                  : InkWell(
                                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: vid, plate: (r['plateNumber'] ?? '').toString()))),
                                      child: Text((r['plateNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: T.navy)),
                                    )),
                              Chip2(m.$1, m.$2),
                            ]),
                            const SizedBox(height: 4),
                            Row(children: [
                              Text(tr('${r['docAr'] ?? ''}', '${r['docEn'] ?? ''}'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                              if (r['alertEnabled'] == false) ...[const SizedBox(width: 4), const Icon(Icons.notifications_off_outlined, size: 14, color: T.inkFaint)],
                              const Spacer(),
                              Text('${fmtDate(r['expiryDate'])} · ', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              Text(daysText(r['daysRemaining']), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: m.$2)),
                            ]),
                            const SizedBox(height: 3),
                            Text([
                              [r['brandAr'], r['modelAr'], r['modelYear']].where((x) => (x ?? '').toString().isNotEmpty).join(' '),
                              (r['holder'] ?? '').toString(),
                              if ((r['driverCardNumber'] ?? '').toString().isNotEmpty) '${tr('بطاقة', 'Card')} ${r['driverCardNumber']}',
                              (r['sectorAr'] ?? '').toString(),
                              (r['ownerNameAr'] ?? '').toString(),
                            ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                            if (canEdit)
                              Align(
                                alignment: AlignmentDirectional.centerEnd,
                                child: TextButton.icon(
                                  style: TextButton.styleFrom(foregroundColor: T.success),
                                  icon: const Icon(Icons.autorenew, size: 17),
                                  label: Text(tr('تجديد', 'Renew')),
                                  onPressed: () async {
                                    if (await showRenewSheet(context, _target(r))) { setState(() => _picked.clear()); _load(); }
                                  },
                                ),
                              ),
                          ]),
                        ),
                      );
                    }),
                  ]),
                ),
    );
  }
}
