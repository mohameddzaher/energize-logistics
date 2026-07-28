import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import 'hr_employee_profile.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الموظفون — native register: server-side search (name / iqama / number),
/// status chips and a detail sheet per employee.
class HrEmployeesScreen extends StatefulWidget {
  const HrEmployeesScreen({super.key});
  @override
  State<HrEmployeesScreen> createState() => _HrEmployeesScreenState();
}

const _empStatus = {
  'active': ('على رأس العمل', 'Active', T.success),
  'on_leave': ('في إجازة', 'On leave', T.info),
  'suspended': ('موقوف', 'Suspended', T.warn),
  'terminated': ('منتهي الخدمة', 'Terminated', T.danger),
};

class _HrEmployeesScreenState extends State<HrEmployeesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  Timer? _debounce;
  final _qCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() { _debounce?.cancel(); super.dispose(); }

  Future<void> _load() async {
    try {
      final params = <String>[];
      if (_qCtrl.text.trim().isNotEmpty) params.add('q=${Uri.encodeComponent(_qCtrl.text.trim())}');
      if (_status.isNotEmpty) params.add('status=$_status');
      final d = await Api.instance.get('/api/hr/employees${params.isEmpty ? '' : '?${params.join('&')}'}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['employees'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () { setState(() => _loading = true); _load(); });
  }

  String _name(Map<String, dynamic> e) {
    final ar = (e['arabicName'] ?? '').toString();
    final en = '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
    return Lang.instance.ar ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);
  }

  void _open(Map<String, dynamic> e) {
    Navigator.push(context, MaterialPageRoute(
        builder: (c) => HrEmployeeProfileScreen(employeeId: e['_id'].toString())));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('الموظفون', 'Employees')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          builder: (c) => EditEmployeeSheet(onDone: () async => _load()),
        ),
        icon: const Icon(Icons.person_add_alt_outlined),
        label: Text(tr('موظف جديد', 'New')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: TextField(
            controller: _qCtrl,
            onChanged: _onSearch,
            decoration: InputDecoration(
              hintText: tr('ابحث بالاسم أو الإقامة أو رقم الموظف…', 'Search name, iqama, number…'),
              prefixIcon: const Icon(Icons.search),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _empStatus.entries.map((e) {
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
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [
                  Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
                ])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? EmptyState(icon: Icons.people_alt_outlined, title: tr('لا يوجد موظفون مطابقون', 'No matching employees'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final e = _rows[i];
                                final st = _empStatus[e['employmentStatus']] ?? _empStatus['active']!;
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => _open(e),
                                    child: AppCard(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                                      child: Row(children: [
                                        CircleAvatar(
                                          radius: 19,
                                          backgroundColor: st.$3.withValues(alpha: 0.12),
                                          child: Text(_name(e).isNotEmpty ? _name(e).characters.first : '؟',
                                              style: TextStyle(color: st.$3, fontWeight: FontWeight.w800)),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text(_name(e), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                            Text([e['jobTitle'], e['department']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ]),
                                        ),
                                        Chip2(tr(st.$1, st.$2), st.$3),
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
