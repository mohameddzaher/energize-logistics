import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show VehicleRegistryDetailScreen, canEditVehicles;

/// Vehicle lifecycle actions, twin of web components/vehicles/VehicleLifecycle: cancel authorization, end service (archive), restore.
/// One server path each (backend services/vehicleLifecycle); B2C passes its own revoke route, which runs the same service.

String _s(dynamic v) => (v ?? '').toString().trim();
Map _sub(Map v, String k) => (v[k] is Map) ? v[k] as Map : const {};

void _snack(BuildContext context, String msg) {
  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

/// Cancels the vehicle's authorization everywhere. [endpoint] overrides the registry route (B2C).
Future<bool> revokeVehicleAuthorization(BuildContext context, Map v, {String? endpoint, String source = 'mobile'}) async {
  final who = _s(_sub(v, 'authorizedPerson')['name']);
  final plate = _s(v['plateNumber']);
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(tr('إلغاء التفويض', 'Cancel authorisation')),
      content: Text(tr(
        'سيُلغى تفويضُ ${who.isNotEmpty ? '«$who»' : 'المفوَّض'} على المركبة $plate: يزول اسمُ المفوَّض ورقمُ التفويض وتاريخُه من سجلّ المركبات ومن ملفّ الموظّف ومن النقل الخفيف. المركبة تبقى في السجلّ.',
        'The authorisation of ${who.isNotEmpty ? '"$who"' : 'the holder'} on $plate will be cancelled everywhere. The vehicle stays.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع', 'Back'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إلغاء التفويض', 'Cancel authorisation'))),
      ],
    ),
  );
  if (ok != true) return false;
  try {
    final r = endpoint != null
        ? await Api.instance.post(endpoint, {})
        : await Api.instance.post('/api/vehicle-registry/${v['_id']}/authorization', {'action': 'revoke', 'source': source});
    if (context.mounted) _snack(context, _s(r is Map ? r['message'] : null).isEmpty ? tr('أُلغي التفويض', 'Cancelled') : r['message'].toString());
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e.toString());
    return false;
  }
}

/// End of service: reason + date; refused by the server while authorized, offering to cancel the authorization first.
Future<bool> endVehicleService(BuildContext context, Map v) async {
  final done = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (c) => _EndServiceSheet(v: v),
  );
  return done == true;
}

class _EndServiceSheet extends StatefulWidget {
  final Map v;
  const _EndServiceSheet({required this.v});
  @override
  State<_EndServiceSheet> createState() => _EndServiceSheetState();
}

class _EndServiceSheetState extends State<_EndServiceSheet> {
  final _reason = TextEditingController();
  String _date = DateTime.now().toIso8601String().substring(0, 10);
  String _err = '';
  late String _blocked;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final a = _sub(widget.v, 'authorizedPerson');
    final who = _s(a['name']).isNotEmpty ? _s(a['name']) : _s(a['iqamaNumber']);
    _blocked = who.isEmpty ? '' : tr('المركبة ما زالت مفوَّضة لـ $who — ألغِ التفويض أولًا', 'The vehicle is still authorised to $who — cancel the authorisation first');
  }

  @override
  void dispose() { _reason.dispose(); super.dispose(); }

  Future<void> _save() async {
    if (_reason.text.trim().isEmpty) { setState(() => _err = tr('اكتب سبب إنهاء الخدمة', 'Enter the reason')); return; }
    setState(() { _saving = true; _err = ''; });
    try {
      final r = await Api.instance.post('/api/vehicle-registry/${widget.v['_id']}/end-service', {'reason': _reason.text.trim(), 'date': _date});
      if (!mounted) return;
      _snack(context, _s(r is Map ? r['message'] : null).isEmpty ? tr('أُنهيت خدمة المركبة', 'Service ended') : r['message'].toString());
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { if (e.data['code'] == 'VEHICLE_AUTHORIZED') { _blocked = e.message; } else { _err = e.message; } _saving = false; });
    } catch (e) {
      if (mounted) setState(() { _err = e.toString(); _saving = false; });
    }
  }

  Future<void> _cancelFirst() async {
    if (await revokeVehicleAuthorization(context, widget.v) && mounted) setState(() => _blocked = '');
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('إنهاء خدمة المركبة', 'End vehicle service'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          const SizedBox(height: 2),
          Text(_s(widget.v['plateNumber']), style: const TextStyle(color: T.inkSoft)),
          const SizedBox(height: 12),
          if (_blocked.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.danger.withValues(alpha: 0.3))),
              child: Text(_blocked, style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.danger, minimumSize: const Size.fromHeight(46)),
              icon: const Icon(Icons.person_remove_outlined), label: Text(tr('إلغاء التفويض', 'Cancel authorisation')),
              onPressed: _cancelFirst,
            ),
          ] else ...[
            Text(tr('تنتقل المركبة إلى «الأرشيف» بكلّ بياناتها وسجلّها، وتخرج من السجلّ والتحليلات والتنبيهات وقوائم النقل الخفيف. ويمكن إعادتها لاحقًا.',
                'The vehicle moves to the Archive with all its data and history and leaves every active list. It can be restored.'),
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 10),
            TextField(controller: _reason, maxLines: 3, decoration: InputDecoration(labelText: tr('سبب إنهاء الخدمة *', 'Reason *'), border: const OutlineInputBorder())),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              icon: const Icon(Icons.event, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('تاريخ إنهاء الخدمة', 'End date')}: $_date'),
              onPressed: () async {
                final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
                if (d != null) setState(() => _date = d.toIso8601String().substring(0, 10));
              },
            ),
            if (_err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err, style: const TextStyle(color: T.danger))),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.navy, minimumSize: const Size.fromHeight(46)),
              icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.archive_outlined),
              label: Text(tr('إنهاء الخدمة', 'End service')),
              onPressed: _saving ? null : _save,
            ),
          ],
        ]),
      ),
    );
  }
}

/// Back to the active registry.
Future<bool> restoreVehicle(BuildContext context, Map v) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(tr('إعادة المركبة', 'Restore vehicle')),
      content: Text(tr('ستعود المركبة ${_s(v['plateNumber'])} إلى سجلّ المركبات وتُحسب في التحليلات والقوائم من جديد.', '${_s(v['plateNumber'])} will return to the registry.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع', 'Back'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إعادة إلى السجلّ', 'Restore'))),
      ],
    ),
  );
  if (ok != true) return false;
  try {
    final r = await Api.instance.post('/api/vehicle-registry/${v['_id']}/restore', {});
    if (context.mounted) _snack(context, _s(r is Map ? r['message'] : null).isEmpty ? tr('أُعيدت المركبة', 'Restored') : r['message'].toString());
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e.toString());
    return false;
  }
}

/// Archive: vehicles whose service ended; open read-only, restore by section editors.
class VehicleArchiveScreen extends StatefulWidget {
  const VehicleArchiveScreen({super.key});
  @override
  State<VehicleArchiveScreen> createState() => _VehicleArchiveScreenState();
}

class _VehicleArchiveScreenState extends State<VehicleArchiveScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  final _searchCtl = TextEditingController();
  int _seq = 0;
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

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vehicle-registry/archive');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = ((d is Map ? d['vehicles'] : null) as List? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = canEditVehicles(context.watch<AuthProvider>());
    final q = _q.trim().toLowerCase();
    final rows = q.isEmpty ? _rows : _rows.where((v) => [v['plateNumber'], v['serialNumber'], v['brandAr'], v['sectorAr'], _sub(v, 'archive')['reason']]
        .any((x) => _s(x).toLowerCase().contains(q))).toList();
    return AppScaffold(
      title: Text(tr('الأرشيف', 'Archive')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
          child: SearchField(controller: _searchCtl, onChanged: (v) => setState(() => _q = v), hint: tr('اللوحة / الماركة / السبب…', 'plate / brand / reason…')),
        ),
        Expanded(child: _loading
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : RefreshIndicator(
                    onRefresh: _load,
                    child: rows.isEmpty
                        ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.archive_outlined, title: tr('لا مركباتَ في الأرشيف', 'No archived vehicles'))])
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(14, 10, 14, 40),
                            itemCount: rows.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (c, i) {
                              final v = rows[i];
                              final a = _sub(v, 'archive');
                              final end = _s(a['endDate']);
                              return Pressable(
                                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => VehicleRegistryDetailScreen(id: _s(v['_id']), plate: _s(v['plateNumber'])))),
                                child: AppCard(
                                  topAccent: T.inkSoft,
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(child: Text(_s(v['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
                                      if (canEdit)
                                        TextButton.icon(
                                          icon: const Icon(Icons.unarchive_outlined, size: 18),
                                          label: Text(tr('إعادة', 'Restore')),
                                          onPressed: () async { if (await restoreVehicle(context, v)) _load(); },
                                        ),
                                    ]),
                                    Text('${_s(v['brandAr'])} ${_s(v['modelAr'])} · ${_s(v['sectorAr'])}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                    const SizedBox(height: 4),
                                    Text('${tr('انتهت الخدمة', 'Ended')}: ${end.length >= 10 ? end.substring(0, 10) : '—'} · ${_s(a['reason'])}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                    if (_s(a['byName']).isNotEmpty) Text('${tr('بواسطة', 'By')}: ${_s(a['byName'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ]),
                                ),
                              );
                            },
                          ),
                  )),
      ]),
    );
  }
}
