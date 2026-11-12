import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/search_field.dart';

/// Vehicle row actions in the fleet vehicles page: counterpart of the two driver columns and the assign-supervisor button on web page /system/fleet/vehicles.

const _fleetEditRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_team_leader', 'fleet_supervisor', 'data_manager', 'data_analyst', 'data_entry'];
const _fleetAdminRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'operations_manager', 'operations_team_leader', 'fleet_manager', 'fleet_team_leader'];

bool _canEdit(BuildContext c) { final a = c.read<AuthProvider>(); return _fleetEditRoles.contains(a.role) || a.canEditSection('Fleet Management'); }
bool _canAdmin(BuildContext c) { final a = c.read<AuthProvider>(); return _fleetAdminRoles.contains(a.role) || a.canEditSection('Fleet Management'); }

void _snack(BuildContext c, String m) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m)));

Map<String, dynamic>? _seat(Map<String, dynamic> v, int n) {
  for (final d in (v['drivers'] as List? ?? const []).whereType<Map>()) {
    final s = (d['seat'] ?? 1) as num;
    if (s.toInt() == n) return Map<String, dynamic>.from(d);
  }
  return null;
}

/// Searchable picker: (value, text, hint). Returns the value, or null if cancelled.
Future<String?> _pick(BuildContext context, String title, List<(String, String, String)> options, String current) {
  // The search word is in a controller outside the builder, so a rebuild of the sheet (the keyboard appears) does not lose it.
  final ctl = TextEditingController();
  return showModalBottomSheet<String>(
    context: context, isScrollControlled: true, backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (c) {
      return StatefulBuilder(builder: (c, set) {
        final q = ctl.text.trim();
        final shown = options.where((o) => q.isEmpty || o.$2.toLowerCase().contains(q.toLowerCase()) || o.$3.toLowerCase().contains(q.toLowerCase())).toList();
        return SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SearchField(
                controller: ctl,
                hint: tr('بحث…', 'Search…'),
                onChanged: (_) => set(() {}),
              ),
            ),
            Expanded(child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
              if (shown.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
              for (final o in shown)
                ListTile(
                  title: Text(o.$2, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: o.$3.isEmpty ? null : Text(o.$3, style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                  trailing: o.$1 == current ? const Icon(Icons.check_circle, color: T.orange) : null,
                  onTap: () => Navigator.pop(c, o.$1),
                ),
            ])),
          ]),
        );
      });
    },
  ).whenComplete(ctl.dispose);
}

/// Crew: the two seats are written in one call PATCH /vehicles/:id/drivers {first, second}, so the rule never passes through a moment with two men in one seat.
Future<bool> openFleetVehicleCrew(BuildContext context, Map<String, dynamic> v) async {
  if (!_canEdit(context)) { _snack(context, tr('لا تملك صلاحية تعديل الطاقم', 'Not allowed to change the crew')); return false; }
  List<Map<String, dynamic>> drivers;
  try {
    final d = await Api.instance.get('/api/fleet/drivers');
    drivers = List<Map<String, dynamic>>.from((d['drivers'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
  if (!context.mounted) return false;
  // Driver option: their name and where they are now, so a man is not pulled from a truck unknowingly.
  final opts = <(String, String, String)>[
    ('', tr('المقعد شاغر', 'Seat empty'), ''),
    for (final d in drivers)
      ((d['_id'] ?? '').toString(), (d['name'] ?? '').toString(), [
        d['vehicle'] is Map && (d['vehicle']['plate'] ?? '').toString().isNotEmpty
            ? tr('على ${d['vehicle']['plate']}${d['seat'] == 2 ? ' (ثانٍ)' : ''}', 'on ${d['vehicle']['plate']}${d['seat'] == 2 ? ' (2nd)' : ''}')
            : tr('بلا شاحنة', 'unassigned'),
        if (d['working'] == false) tr('لا يعمل', 'off'),
      ].join(' · ')),
  ];
  var first = (_seat(v, 1)?['_id'] ?? '').toString();
  var second = (_seat(v, 2)?['_id'] ?? '').toString();
  String nameOf(String id) => id.isEmpty ? tr('المقعد شاغر', 'Seat empty') : opts.firstWhere((o) => o.$1 == id, orElse: () => (id, id, '')).$2;

  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Text('${tr('طاقم الشاحنة', 'Truck crew')} — ${v['plate'] ?? ''}'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        for (final seat in [1, 2])
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(seat == 1 ? Icons.looks_one_outlined : Icons.looks_two_outlined, color: T.navy),
            title: Text(seat == 1 ? tr('السائق الأول', 'First driver') : tr('السائق الثاني', 'Second driver'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
            subtitle: Text(nameOf(seat == 1 ? first : second), style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink)),
            trailing: const Icon(Icons.edit_outlined, size: 18),
            onTap: () async {
              final p = await _pick(c, seat == 1 ? tr('السائق الأول', 'First driver') : tr('السائق الثاني', 'Second driver'), opts, seat == 1 ? first : second);
              if (p == null) return;
              set(() {
                if (seat == 1) { first = p; if (p.isNotEmpty && p == second) second = ''; }
                else { second = p; if (p.isNotEmpty && p == first) first = ''; }
              });
            },
          ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
      ],
    )),
  );
  if (ok != true || !context.mounted) return false;
  try {
    await Api.instance.patch('/api/fleet/vehicles/${v['_id']}/drivers', {'first': first, 'second': second});
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
}

/// Assign supervisor: the section manager distributes vehicles to supervisors (PATCH /vehicles/:id/supervisor).
Future<bool> openFleetVehicleSupervisor(BuildContext context, Map<String, dynamic> v) async {
  if (!_canAdmin(context)) { _snack(context, tr('تعيين المشرف لمدير القسم', 'Only the section manager assigns supervisors')); return false; }
  List<Map<String, dynamic>> users;
  try {
    final d = await Api.instance.get('/api/fleet/supervisors');
    users = List<Map<String, dynamic>>.from((d['users'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
  if (!context.mounted) return false;
  if (users.isEmpty) {
    _snack(context, tr('لا يوجد مستخدمون بدور «مشرف أسطول» بعد — أنشئهم من إدارة المستخدمين أولًا.', 'No users with the fleet_supervisor role yet — create them in user management first.'));
  }
  final cur = v['supervisor'] is Map ? (v['supervisor']['_id'] ?? '').toString() : (v['supervisor'] ?? '').toString();
  final picked = await _pick(context, '${tr('تعيين المشرف', 'Assign supervisor')} — ${v['plate'] ?? ''}', [
    ('', tr('بدون مشرف', 'No supervisor'), ''),
    for (final u in users)
      ((u['_id'] ?? '').toString(), '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim().isEmpty ? (u['email'] ?? '').toString() : '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim(), (u['email'] ?? '').toString()),
  ], cur);
  if (picked == null || !context.mounted) return false;
  try {
    await Api.instance.patch('/api/fleet/vehicles/${v['_id']}/supervisor', {'supervisor': picked.isEmpty ? null : picked});
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
}

/// Customer removal as on the web: with no loads it is deleted permanently (?purge=1); with loads it is only disabled, since deleting would leave waybills pointing at a nonexistent customer.
Future<bool> removeFleetCustomer(BuildContext context, Map<String, dynamic> c) async {
  if (!_canAdmin(context)) { _snack(context, tr('لا تملك صلاحية الإزالة', 'Not allowed')); return false; }
  final trips = (c['trips'] as num? ?? 0).toInt();
  final hard = trips == 0;
  final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
    content: Text(hard
        ? tr('حذف «${c['name']}» نهائيًّا؟ لا حمولة له.', 'Delete “${c['name']}” permanently? No shipments.')
        : tr('تعطيل «${c['name']}»؟ حمولاته الـ$trips تبقى كما هي.', 'Disable “${c['name']}”? Their $trips shipments stay.')),
    actions: [
      TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('إلغاء', 'Cancel'))),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(d, true), child: Text(hard ? tr('حذف', 'Delete') : tr('تعطيل', 'Disable'))),
    ],
  ));
  if (ok != true || !context.mounted) return false;
  try {
    await Api.instance.delete('/api/fleet/customers/${c['_id']}${hard ? '?purge=1' : ''}');
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
}

/// Reactivate a disabled customer.
Future<bool> restoreFleetCustomer(BuildContext context, Map<String, dynamic> c) async {
  if (!_canAdmin(context)) { _snack(context, tr('لا تملك صلاحية الاستعادة', 'Not allowed')); return false; }
  try {
    await Api.instance.post('/api/fleet/customers/${c['_id']}/restore', {});
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e is ApiException ? e.message : e.toString());
    return false;
  }
}
