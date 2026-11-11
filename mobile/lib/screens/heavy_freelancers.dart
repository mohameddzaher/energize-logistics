import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_requests.dart';

/// Heavy-transport freelancers: one person with his own truck. Matches the web page `/system/vendors-mgmt/drivers`;
/// adding one registers the person, his truck and the driver in one step (`POST /api/vendors-mgmt/freelancers`).
class HeavyFreelancersScreen extends StatefulWidget {
  const HeavyFreelancersScreen({super.key});
  @override
  State<HeavyFreelancersScreen> createState() => _HeavyFreelancersScreenState();
}

class _HeavyFreelancersScreenState extends State<HeavyFreelancersScreen> {
  List<Map<String, dynamic>>? _rows;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('vendors:changed', _onLive);
  }

  @override
  void dispose() { Live.instance.off('vendors:changed', _onLive); super.dispose(); }

  void _onLive() => _load();

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/freelancers');
      if (mounted) setState(() => _rows = List<Map<String, dynamic>>.from((d['freelancers'] as List?) ?? const []));
    } catch (_) { if (mounted) setState(() => _rows = const []); }
  }

  String _join(dynamic list, String k) => List.from(list ?? const []).map((x) => '${(x as Map)[k] ?? ''}').where((s) => s.isNotEmpty).join('، ');

  Future<void> _add() async {
    final name = TextEditingController(), phone = TextEditingController(), iqama = TextEditingController(), plate = TextEditingController(), type = TextEditingController();
    String follow = '';
    final helpers = await srTeamMembers('helpers').catchError((_) => <Map<String, dynamic>>[]);
    if (!mounted) return;
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('إضافة فريلانسر نقل ثقيل', 'Add a heavy-transport freelancer'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        const SizedBox(height: 12),
        TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم الفريلانسر (السائق) *', 'Freelancer (driver) name *'))),
        const SizedBox(height: 8),
        TextField(controller: phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('رقم الجوال *', 'Mobile *'))),
        const SizedBox(height: 8),
        TextField(controller: iqama, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('رقم الإقامة / الهوية *', 'Iqama / ID *'), helperText: tr('10 أرقام تبدأ بـ1 أو 2', '10 digits starting with 1 or 2'))),
        const SizedBox(height: 8),
        TextField(controller: plate, decoration: InputDecoration(labelText: tr('رقم لوحة الشاحنة *', 'Truck plate *'))),
        const SizedBox(height: 8),
        TextField(controller: type, decoration: InputDecoration(labelText: tr('نوع الشاحنة', 'Truck type'))),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () async { final p = await srPickPerson(c, tr('مسؤول المتابعة', 'Follow-up owner'), helpers); if (p != null) setS(() => follow = '${p['label'] ?? ''}'); },
          icon: const Icon(Icons.person_outline), label: Text(follow.isEmpty ? tr('مسؤول المتابعة (اختياري)', 'Follow-up owner (optional)') : follow),
        ),
        const SizedBox(height: 14),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إضافة', 'Add'))),
      ])),
    )));
    if (ok != true) return;
    try {
      await Api.instance.post('/api/vendors-mgmt/freelancers', {
        'name': name.text.trim(), 'phone': phone.text.trim(), 'residenceNumber': iqama.text.trim(), 'plate': plate.text.trim(), 'truckType': type.text.trim(), 'followOwner': follow,
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُضيف الفريلانسر بسيارته', 'Freelancer added'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final rows = (_rows ?? const <Map<String, dynamic>>[]).where((r) => q.isEmpty || '${r['name']} ${r['phone']} ${_join(r['vehicles'], 'plate')} ${_join(r['drivers'], 'residenceNumber')}'.toLowerCase().contains(q)).toList();
    return AppScaffold(
      title: Text(tr('الفريلانسرز — نقل ثقيل', 'Freelancers — heavy')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add), label: Text(tr('فريلانسر نقل ثقيل', 'Heavy freelancer'))),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), child: SearchField(hint: tr('الاسم، الجوال، اللوحة، الإقامة…', 'Name, phone, plate, iqama…'), onChanged: (v) => setState(() => _q = v))),
        Expanded(child: _rows == null
            ? const Center(child: CircularProgressIndicator())
            : rows.isEmpty
                ? Center(child: Text(tr('لا فريلانسرز بعد', 'No freelancers yet'), style: const TextStyle(color: T.inkFaint)))
                : RefreshIndicator(onRefresh: _load, child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 90), itemCount: rows.length, separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final r = rows[i];
                      return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
                        const SizedBox(height: 4),
                        Wrap(spacing: 6, runSpacing: 4, children: [
                          if ('${r['phone'] ?? ''}'.isNotEmpty) Chip2('${r['phone']}', T.info, icon: Icons.phone_outlined),
                          if (_join(r['vehicles'], 'plate').isNotEmpty) Chip2(_join(r['vehicles'], 'plate'), T.navy, icon: Icons.local_shipping_outlined),
                          if (_join(r['drivers'], 'residenceNumber').isNotEmpty) Chip2(_join(r['drivers'], 'residenceNumber'), T.inkSoft, icon: Icons.badge_outlined),
                          if ('${r['followOwner'] ?? ''}'.isNotEmpty) Chip2('${r['followOwner']}', T.success, icon: Icons.person_outline),
                        ]),
                      ]));
                    },
                  ))),
      ]),
    );
  }
}
