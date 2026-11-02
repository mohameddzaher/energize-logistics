import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// Assign vehicles to supervisors, same as web screen /system/fleet/assign: pick the supervisor, mark vehicles, and save the assignment in one batch. Each vehicle can also be moved alone from its dropdown without bulk selection.
class FleetAssignScreen extends StatefulWidget {
  const FleetAssignScreen({super.key});
  @override
  State<FleetAssignScreen> createState() => _FleetAssignScreenState();
}

// Same list as canAdminFleet on the web (lib/fleet.ts) and ADMIN_ROLES in routes/fleet.js.
const _adminRoles = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

String _supName(Map<String, dynamic> u) {
  final n = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
  return n.isEmpty ? (u['email'] ?? '').toString() : n;
}

/// The vehicle's supervisor may arrive as an id or an object; always read as an id.
String _supId(Map<String, dynamic> v) {
  final s = v['supervisor'];
  if (s == null) return '';
  if (s is Map) return (s['_id'] ?? '').toString();
  return s.toString();
}

String _fold(String x) => x
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

class _FleetAssignScreenState extends State<FleetAssignScreen> {
  List<Map<String, dynamic>> _vehicles = [];
  List<Map<String, dynamic>> _supervisors = [];
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String _target = '';       // Target supervisor.
  final Set<String> _selected = {};
  String _q = '';
  // The field is destroyed on loading and scrolling; text kept in a controller survives with the word.
  final _searchCtl = TextEditingController();
  String _owner = '';        // '' all, 'none' unassigned, or a supervisor id.
  int _seq = 0;              // An old reply does not overwrite a newer one.
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('fleet:vehicles', _onLive);
    Live.instance.on('fleet:updated', _onLive);
    // The truck is from the vehicle register and the driver from HR, as on the web.
    Live.instance.on('vreg:updated', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:vehicles', _onLive);
    Live.instance.off('fleet:updated', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    _searchCtl.dispose();
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final r = await Future.wait([
        Api.instance.get('/api/fleet/vehicles'),
        Api.instance.get('/api/fleet/supervisors'),
      ]);
      if (!mounted || mine != _seq) return;
      setState(() {
        _vehicles = List<Map<String, dynamic>>.from(r[0]['vehicles'] ?? const []);
        _supervisors = List<Map<String, dynamic>>.from(r[1]['users'] ?? const []);
        // A supervisor archived after being chosen does not remain a dangling target.
        if (_target.isNotEmpty && !_supervisors.any((s) => s['_id'] == _target)) _target = '';
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _toast(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(m),
      backgroundColor: error ? T.danger : T.success,
    ));
  }

  bool _isDeptManager(Map<String, dynamic> s) => s['role'] == 'fleet_manager';

  List<Map<String, dynamic>> get _filtered {
    var r = _vehicles;
    if (_owner == 'none') {
      r = r.where((v) => _supId(v).isEmpty).toList();
    } else if (_owner.isNotEmpty && !_supervisors.any((s) => s['_id'] == _owner && _isDeptManager(s))) {
      // A section manager's name shows the whole fleet: their scope, not an assignment list for them.
      r = r.where((v) => _supId(v) == _owner).toList();
    }
    final q = _fold(_q.trim());
    if (q.isNotEmpty) {
      r = r.where((v) => [
            v['plate'], v['name'], v['supervisorName'],
            ...List<Map<String, dynamic>>.from(v['drivers'] ?? const []).map((d) => d['name']),
          ].any((x) => _fold((x ?? '').toString()).contains(q))).toList();
    }
    return r;
  }

  Future<void> _assign(String? to) async {
    if (_selected.isEmpty) { _toast(tr('حدد السيارات أولًا.', 'Select vehicles first.'), error: true); return; }
    if (to == null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(tr('إلغاء إسناد ${_selected.length} سيارة؟', 'Unassign ${_selected.length} vehicles?')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع', 'Back'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _saving = true);
    try {
      final d = await Api.instance.post('/api/fleet/vehicles/assign-supervisor-bulk', {
        'supervisor': to,
        'vehicleIds': _selected.toList(),
      });
      final n = d['modified'] ?? 0;
      final name = (d['supervisorName'] ?? '').toString();
      _toast(to != null
          ? tr('أُسندت $n سيارة إلى $name.', '$n vehicles assigned to $name.')
          : tr('أُلغي إسناد $n سيارة.', '$n vehicles unassigned.'));
      setState(() => _selected.clear());
      _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString(), error: true);
    }
    if (mounted) setState(() => _saving = false);
  }

  // Quick assign for a single vehicle directly, the easiest way to change one vehicle's supervisor.
  Future<void> _quickAssign(String vehicleId, String supervisorId) async {
    try {
      await Api.instance.patch('/api/fleet/vehicles/$vehicleId/supervisor', {
        'supervisor': supervisorId.isEmpty ? null : supervisorId,
      });
      _load();
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Same as canAdminFleet on the web: an admin role or edit on the section from the permission matrix.
    final admin = _adminRoles.contains(auth.role) || auth.canEditSection('Fleet Management');
    final title = Text(tr('توزيع السيارات على المشرفين', 'Assign vehicles to supervisors'));

    if (!admin) {
      return AppScaffold(
        title: title,
        body: EmptyState(icon: Icons.lock_outline, title: tr('هذه الصفحة لمدير القسم فقط.', 'Section manager only.')),
      );
    }

    return AppScaffold(
      title: title,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 44), SizedBox(height: 10), Shimmer(height: 110),
              SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final filtered = _filtered;
    final allSel = filtered.isNotEmpty && filtered.every((v) => _selected.contains(v['_id']));
    final counts = <String, int>{};
    for (final v in _vehicles) {
      final k = _supId(v).isEmpty ? 'none' : _supId(v);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    // A section manager's scope is the whole fleet, so their count is the fleet, not zero.
    int scopeCount(Map<String, dynamic> s) => _isDeptManager(s) ? _vehicles.length : (counts[s['_id']] ?? 0);

    return ListView(
      padding: const EdgeInsets.all(14),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: [
        if (_supervisors.isEmpty) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: T.warn.withValues(alpha: 0.08),
              border: Border.all(color: T.warn.withValues(alpha: 0.35)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              tr('لا يوجد مستخدمون بدور «مشرف أسطول» بعد. أنشئهم أولًا من إدارة المستخدمين (الدور: مشرف أسطول)، ثم عد إلى هنا للتوزيع.',
                  'No users with the fleet_supervisor role yet. Create them in user management first, then come back to assign.'),
              style: const TextStyle(fontSize: 12.5, color: T.warn, fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 10),
        ],

        // Current distribution summary: each supervisor and vehicle count; tapping filters.
        Row(children: [
          const Icon(Icons.groups_outlined, size: 16, color: T.orange),
          const SizedBox(width: 4),
          Text(tr('التوزيع الحالي:', 'Current split:'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
        ]),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            _ownerChip('', '${tr('الكل', 'All')} ${_vehicles.length}', T.orange),
            for (final s in _supervisors)
              _ownerChip((s['_id'] ?? '').toString(),
                  '${_supName(s)} ${scopeCount(s)}${_isDeptManager(s) ? tr(' · المدير', ' · manager') : ''}', T.orange),
            _ownerChip('none', '${tr('غير مُسند', 'Unassigned')} ${counts['none'] ?? 0}', T.inkSoft),
          ]),
        ),
        const SizedBox(height: 12),

        // Action bar: target supervisor plus assign/clear the selection.
        AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _supDropdown(
              value: _target,
              hint: tr('— اختر المشرف —', '— choose supervisor —'),
              includeEmpty: false,
              onChanged: (v) => setState(() => _target = v),
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.orange),
                  onPressed: _saving || _target.isEmpty || _selected.isEmpty ? null : () => _assign(_target),
                  icon: _saving
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check_rounded, size: 18),
                  label: Text(tr('إسناد المحدد (${_selected.length})', 'Assign selected (${_selected.length})')),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger, side: BorderSide(color: T.danger.withValues(alpha: 0.4))),
                onPressed: _saving || _selected.isEmpty ? null : () => _assign(null),
                child: Text(tr('إلغاء الإسناد', 'Unassign')),
              ),
            ]),
            const SizedBox(height: 10),
            SearchField(
              controller: _searchCtl, dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('ابحث باللوحة أو السائق…', 'Search plate / driver…'),
            ),
          ]),
        ),
        const SizedBox(height: 10),

        // Select all within what is displayed.
        Row(children: [
          Checkbox(
            value: allSel,
            activeColor: T.orange,
            onChanged: filtered.isEmpty ? null : (_) => setState(() {
              if (allSel) {
                for (final v in filtered) { _selected.remove(v['_id']); }
              } else {
                for (final v in filtered) { _selected.add((v['_id'] ?? '').toString()); }
              }
            }),
          ),
          Text(tr('تحديد الكل (${filtered.length})', 'Select all (${filtered.length})'),
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          const Spacer(),
          Text(tr('محدد: ${_selected.length}', 'Selected: ${_selected.length}'),
              style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        ]),
        if (filtered.isEmpty)
          EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد سيارات مطابقة.', 'No matching vehicles.')),
        ...filtered.map(_vehicleCard),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _ownerChip(String key, String label, Color color) {
    final sel = _owner == key;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: FilterChip(
        selected: sel,
        onSelected: (_) => setState(() => _owner = (sel && key.isNotEmpty) ? '' : key),
        label: Text(label),
        labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.ink),
        selectedColor: color,
        backgroundColor: T.navy.withValues(alpha: 0.06),
        checkmarkColor: Colors.white,
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
  }

  /// Supervisor list. A current supervisor outside the list (archived) stays visible by name so the dropdown does not break on a missing value.
  Widget _supDropdown({
    required String value,
    required String hint,
    required bool includeEmpty,
    required ValueChanged<String> onChanged,
    String? orphanName,
  }) {
    final items = <DropdownMenuItem<String>>[
      if (includeEmpty) DropdownMenuItem(value: '', child: Text(tr('— بدون مشرف —', '— unassigned —'))),
      for (final s in _supervisors)
        DropdownMenuItem(value: (s['_id'] ?? '').toString(), child: Text(_supName(s), overflow: TextOverflow.ellipsis)),
      if (value.isNotEmpty && !_supervisors.any((s) => s['_id'] == value))
        DropdownMenuItem(value: value, child: Text(orphanName?.isNotEmpty == true ? orphanName! : value, overflow: TextOverflow.ellipsis)),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: T.line),
        borderRadius: BorderRadius.circular(10),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isExpanded: true,
          isDense: true,
          value: (value.isEmpty && !includeEmpty) ? null : value,
          hint: Text(hint, style: const TextStyle(fontSize: 13, color: T.inkFaint)),
          style: const TextStyle(fontSize: 13, color: T.ink),
          items: items,
          onChanged: (v) { if (v != null) onChanged(v); },
        ),
      ),
    );
  }

  Widget _vehicleCard(Map<String, dynamic> v) {
    final id = (v['_id'] ?? '').toString();
    final on = _selected.contains(id);
    final drivers = List<Map<String, dynamic>>.from(v['drivers'] ?? const []);
    final supName = (v['supervisorName'] ?? '').toString();
    final trailer = (v['trailerType'] ?? '').toString();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => setState(() => on ? _selected.remove(id) : _selected.add(id)),
        child: Container(
          decoration: BoxDecoration(
            color: on ? T.orange.withValues(alpha: 0.05) : T.card,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: on ? T.orange : T.line),
          ),
          padding: const EdgeInsets.fromLTRB(4, 8, 12, 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Checkbox(
              value: on,
              activeColor: T.orange,
              onChanged: (_) => setState(() => on ? _selected.remove(id) : _selected.add(id)),
            ),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.local_shipping_outlined, size: 15, color: T.inkFaint),
                  const SizedBox(width: 5),
                  Text((v['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                  const Spacer(),
                  if (supName.isNotEmpty)
                    Flexible(child: Chip2(supName, T.orange))
                  else
                    Text(tr('غير مُسند', 'Unassigned'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                ]),
                const SizedBox(height: 4),
                Text(
                  '${drivers.isNotEmpty ? drivers.map((d) => d['name']).join(' · ') : tr('بدون سائق', 'No driver')}'
                  '${trailer.isNotEmpty ? ' · $trailer' : ''}',
                  style: const TextStyle(fontSize: 12, color: T.inkSoft),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                // Quick assign for this vehicle alone; does not go through bulk selection.
                _supDropdown(
                  value: _supId(v),
                  hint: tr('— بدون مشرف —', '— unassigned —'),
                  includeEmpty: true,
                  orphanName: supName,
                  onChanged: (sid) { if (sid != _supId(v)) _quickAssign(id, sid); },
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
