import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/leave_record.dart';
import '../ui/leave_return.dart';
import '../ui/search_field.dart';
import '../ui/leave_chain.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';

/// The leave register: every approved leave (from a request or recorded by HR), its state,
/// who approved it and the employee's balance. Mirrors web /system/hr/leave-register.
class HrLeaveRegisterScreen extends StatefulWidget {
  const HrLeaveRegisterScreen({super.key});
  @override
  State<HrLeaveRegisterScreen> createState() => _HrLeaveRegisterScreenState();
}

const _states = [
  ('current', 'في الإجازة الآن', 'On leave now', T.info),
  ('upcoming', 'قادمة', 'Upcoming', T.inkFaint),
  ('ended', 'بانتظار العودة', 'Return pending', T.warn),
  ('returned', 'عاد', 'Returned', T.success),
  ('no_show', 'مخالفة — لم يعد', 'No-show', T.danger),
];
const _sources = {
  'request': ('طلب من الموظف', 'Employee request'),
  'manual': ('تسجيل الموارد البشرية', 'Recorded by HR'),
  'backdated': ('قيد رجعي', 'Back-dated'),
};

String _foldAr(String v) => v.toLowerCase().replaceAll(RegExp('[أإآٱ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي');
String _ymd(dynamic v) {
  final s = '${v ?? ''}';
  return s.length >= 10 ? s.substring(0, 10) : s;
}

class _HrLeaveRegisterScreenState extends State<HrLeaveRegisterScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _balances = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  String _state = '';
  String _source = '';
  String _type = '';
  final _searchCtl = TextEditingController();
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
    Live.instance.on('hr:employee', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    Live.instance.off('hr:employee', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/leave-register');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d as Map)['leaves'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _balances = Map<String, dynamic>.from(d['balances'] as Map? ?? const {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _emp(Map<String, dynamic> l) {
    final e = l['employee'] is Map ? l['employee'] as Map : const {};
    final ar = '${e['arabicName'] ?? ''}';
    return Lang.instance.ar && ar.isNotEmpty ? ar : '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
  }

  String _typeName(Map<String, dynamic> l) =>
      l['leaveType'] is Map ? tr('${l['leaveType']['nameAr'] ?? ''}', '${l['leaveType']['nameEn'] ?? ''}') : '';

  List<Map<String, dynamic>> get _base {
    final q = _foldAr(_q.trim());
    return _rows.where((l) {
      if (_source.isNotEmpty && l['source'] != _source) return false;
      if (_type.isNotEmpty && (l['leaveType'] is Map ? l['leaveType']['_id'] : '') != _type) return false;
      if (q.isEmpty) return true;
      final e = l['employee'] is Map ? l['employee'] as Map : const {};
      return _foldAr([e['arabicName'], e['firstName'], e['lastName'], e['employeeNumber'], e['iqamaNumber'], e['nationalId']].join(' ')).contains(q);
    }).toList();
  }

  void _openDetail(Map<String, dynamic> l) {
    final e = l['employee'] is Map ? l['employee'] as Map : const {};
    final src = _sources[l['source']];
    final bal = _balances['${e['_id'] ?? ''}'];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(_emp(l), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            if ('${e['employeeNumber'] ?? ''}'.isNotEmpty) Text('#${e['employeeNumber']}', style: const TextStyle(color: T.inkSoft)),
            const SizedBox(height: 8),
            LeaveReturnChip(l),
            const SizedBox(height: 4),
            LeaveDeductionBadge(leave: l),
            const SizedBox(height: 10),
            for (final row in [
              (tr('النوع', 'Type'), _typeName(l)),
              (tr('المدة', 'Period'), '${'${l['startDate']}' == '${l['endDate']}' ? '${tr('يوم واحد فقط:', 'One day only:')} ${_ymd(l['startDate'])}' : '${tr('من', 'From')} ${_ymd(l['startDate'])} ${tr('إلى', 'to')} ${_ymd(l['endDate'])}'} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}'),
              (tr('المصدر', 'Source'), src == null ? '—' : tr(src.$1, src.$2)),
              (tr('اعتمدها / سجّلها', 'Approved / recorded by'), '${l['approvedByName'] ?? '—'}${_ymd(l['approvedAt']).isEmpty ? '' : ' · ${_ymd(l['approvedAt'])}'}'),
              (tr('الرصيد المتاح الآن', 'Available balance now'), bal == null ? '—' : '$bal'),
              if ('${l['reason'] ?? ''}'.isNotEmpty) (tr('السبب', 'Reason'), '${l['reason']}'),
            ])
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 130, child: Text(row.$1, style: const TextStyle(color: T.inkSoft, fontSize: 13))),
                  Expanded(child: Text(row.$2, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                ]),
              ),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton.icon(
                onPressed: () { Navigator.pop(c); showLeaveReturnSheet(context, l, _load); },
                icon: const Icon(Icons.event_repeat_outlined, size: 18),
                label: Text(tr('عودة / تمديد / مخالفة', 'Return / extend / no-show')),
              ),
              if ('${e['_id'] ?? ''}'.isNotEmpty)
                OutlinedButton.icon(
                  onPressed: () { Navigator.pop(c); Navigator.of(context).push(MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: '${e['_id']}'))); },
                  icon: const Icon(Icons.person_outline, size: 18),
                  label: Text(tr('ملف الموظف', 'Employee profile')),
                ),
            ]),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final base = _base;
    final shown = _state.isEmpty ? base : base.where((l) => l['state'] == _state).toList();
    final types = <String, String>{};
    for (final l in _rows) {
      if (l['leaveType'] is Map) types['${l['leaveType']['_id']}'] = _typeName(l);
    }
    return AppScaffold(
      title: Text(tr('الإجازات', 'Leaves')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async { if (await showLeaveRecordSheet(context)) _load(); },
        icon: const Icon(Icons.event_available_outlined),
        label: Text(tr('تسجيل إجازة', 'Record a leave')),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? EmptyState(icon: Icons.error_outline, title: _error!)
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: SearchField(controller: _searchCtl, dense: true, onChanged: (v) => setState(() => _q = v), hint: tr('ابحث بالاسم أو الرقم الوظيفي أو الهوية', 'Name, employee no. or ID')),
                  ),
                  SizedBox(
                    height: 44,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14), children: [
                      for (final s in _states)
                        Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: ChoiceChip(
                            label: Text('${tr(s.$2, s.$3)} (${base.where((l) => l['state'] == s.$1).length})'),
                            selected: _state == s.$1,
                            onSelected: (_) => setState(() => _state = _state == s.$1 ? '' : s.$1),
                          ),
                        ),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                    child: Row(children: [
                      Expanded(child: DropdownButtonFormField<String>(
                        initialValue: _type,
                        isExpanded: true,
                        decoration: InputDecoration(labelText: tr('النوع', 'Type'), isDense: true),
                        items: [DropdownMenuItem(value: '', child: Text(tr('كل الأنواع', 'All types'))), ...types.entries.map((t) => DropdownMenuItem(value: t.key, child: Text(t.value, overflow: TextOverflow.ellipsis)))],
                        onChanged: (v) => setState(() => _type = v ?? ''),
                      )),
                      const SizedBox(width: 8),
                      Expanded(child: DropdownButtonFormField<String>(
                        initialValue: _source,
                        isExpanded: true,
                        decoration: InputDecoration(labelText: tr('المصدر', 'Source'), isDense: true),
                        items: [DropdownMenuItem(value: '', child: Text(tr('كل المصادر', 'All sources'))), ..._sources.entries.map((s) => DropdownMenuItem(value: s.key, child: Text(tr(s.value.$1, s.value.$2), overflow: TextOverflow.ellipsis)))],
                        onChanged: (v) => setState(() => _source = v ?? ''),
                      )),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: shown.isEmpty
                          ? ListView(children: [EmptyState(icon: Icons.event_busy_outlined, title: tr('لا توجد إجازات', 'No leaves'))])
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              itemCount: shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final l = shown[i];
                                final e = l['employee'] is Map ? l['employee'] as Map : const {};
                                final bal = _balances['${e['_id'] ?? ''}'];
                                return Pressable(
                                  onTap: () => _openDetail(l),
                                  child: AppCard(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(_emp(l), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        if (bal != null) Text('${tr('الرصيد', 'Bal.')} $bal', style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('${_typeName(l)} · ${'${l['startDate']}' == '${l['endDate']}' ? '${tr('يوم واحد فقط:', 'One day only:')} ${_ymd(l['startDate'])}' : '${tr('من', 'From')} ${_ymd(l['startDate'])} ${tr('إلى', 'to')} ${_ymd(l['endDate'])}'} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      const SizedBox(height: 6),
                                      LeaveReturnChip(l),
                                      const SizedBox(height: 4),
                                      LeaveDeductionBadge(leave: l),
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
