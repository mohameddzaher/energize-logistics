import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import 'leave_chain.dart';
import 'search_field.dart';
import 'theme.dart';

/// Record a leave from HR (past, current or future) for any employee, with or without a login.
/// Saved approved (POST /api/hr/leaves/backdated, mode 'manual'). Mirrors web LeaveRecordModal.

String _foldAr(String v) => v
    .toLowerCase()
    .replaceAll(RegExp('[أإآٱ]'), 'ا')
    .replaceAll('ة', 'ه')
    .replaceAll('ى', 'ي')
    .replaceAll(RegExp('[ًٌٍَُِّْ]'), '');

Future<bool> showLeaveRecordSheet(BuildContext context, {String? employeeId}) async {
  List<Map<String, dynamic>> emps = [];
  List<Map<String, dynamic>> types = [];
  try {
    // Light list rather than the full document: seven fields arrive instantly. Dash, not slash: `employees/search` matches `/employees/:id` and the id guard rejects it as an invalid id, so the sheet never opens.
    final a = await Api.instance.get('/api/hr/employees-search?limit=2000');
    emps = List<Map<String, dynamic>>.from(((a as Map)['employees'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final b = await Api.instance.get('/api/hr/leave-types');
    types = List<Map<String, dynamic>>.from(((b as Map)['leaveTypes'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    return false;
  }
  if (!context.mounted) return false;

  String? empId = employeeId;
  String? typeId;
  DateTime? start;
  DateTime? end;
  bool? deduct;
  final reason = TextEditingController();
  final search = TextEditingController();

  bool fridays() => types.where((t) => t['_id'] == typeId).firstOrNull?['countsFridays'] == true;
  int days() => countLeaveDays(start, end, countFridays: fridays());
  String fmt(DateTime? d) => d == null ? '—' : '${d.day}/${d.month}/${d.year}';

  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (c) => StatefulBuilder(
      builder: (c, setSt) {
        final q = search.text.trim().toLowerCase();
        final shown = q.isEmpty
            ? emps.take(60).toList()
            // Searches name, residency and employee number together; Arabic hamzas are folded so a plain alef name finds the hamza form.
            : emps.where((e) => [e['arabicName'], e['firstName'], e['lastName'], e['employeeNumber'], e['iqamaNumber'], e['nationalId']]
                .any((v) => _foldAr((v ?? '').toString()).contains(_foldAr(q)))).take(60).toList();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('تسجيل إجازة', 'Record a leave'),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 4),
                Text(
                  tr('تُسجَّل معتمَدةً، وتُخصَم من الرصيد أو لا بحسب اختيارك — لموظفٍ بلا حساب أو لإجازةٍ تسجّلها الموارد البشرية.',
                     'Saved as approved, deducted or not as you choose — for an employee without a login, or a leave HR records.'),
                  style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
                ),
                const SizedBox(height: 12),
                if (employeeId == null) ...[
                SearchField(
                  controller: search, dense: true,
                  onChanged: (_) => setSt(() {}),
                  hint: tr('ابحث عن الموظّف', 'Search employee'),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: shown.any((e) => e['_id'] == empId) ? empId : null,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('الموظّف', 'Employee')),
                  items: shown.map((e) {
                    final nm = (e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString().trim();
                    final num = (e['employeeNumber'] ?? '').toString();
                    return DropdownMenuItem(
                      value: e['_id'] as String,
                      child: Text(num.isEmpty ? nm : '$nm · #$num', overflow: TextOverflow.ellipsis),
                    );
                  }).toList(),
                  onChanged: (v) => setSt(() => empId = v),
                ),
                const SizedBox(height: 10),
                ],
                DropdownButtonFormField<String>(
                  initialValue: typeId,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('نوع الإجازة', 'Leave type')),
                  // No deduction hint here: HR's own choice decides it, and a type default beside it read as a contradiction.
                  items: types.map((t) {
                    final nm = tr('${t['nameAr']}', '${t['nameEn']}');
                    return DropdownMenuItem(
                      value: t['_id'] as String,
                      child: Text(nm, overflow: TextOverflow.ellipsis),
                    );
                  }).toList(),
                  onChanged: (v) => setSt(() => typeId = v),
                ),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        final d = await showDatePicker(context: c, initialDate: start ?? DateTime.now(),
                            firstDate: DateTime(DateTime.now().year - 5), lastDate: DateTime.now().add(const Duration(days: 365)));
                        if (d != null) setSt(() => start = d);
                      },
                      child: Text('${tr('من', 'From')}: ${fmt(start)}${start == null ? '' : '\n${hijriHint(start, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: start == null ? null : () async {
                        final d = await showDatePicker(context: c, initialDate: end ?? start!,
                            firstDate: start!, lastDate: DateTime.now().add(const Duration(days: 365)));
                        if (d != null) setSt(() => end = d);
                      },
                      child: Text('${tr('إلى', 'To')}: ${fmt(end)}${end == null ? '' : '\n${hijriHint(end, ar: Lang.instance.ar)}'}', textAlign: TextAlign.center),
                    ),
                  ),
                ]),
                if (days() > 0) ...[
                  const SizedBox(height: 8),
                  Text('${tr('المدّة', 'Duration')}: ${days()} ${tr('يوم', 'day(s)')}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                ],
                const SizedBox(height: 10),
                DeductionPicker(value: deduct, days: days() > 0 ? days() : null, onChanged: (v) => setSt(() => deduct = v)),
                const SizedBox(height: 10),
                TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: tr('السبب / ملاحظة', 'Reason / note'))),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: (empId == null || typeId == null || days() == 0 || deduct == null) ? null : () => Navigator.pop(c, true),
                    child: Text(tr('تسجيل', 'Record')),
                  ),
                ),
              ]),
            ),
          ),
        );
      },
    ),
  );
  if (ok != true) return false;
  String iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  try {
    final r = await Api.instance.post('/api/hr/leaves/backdated', {
      'employee': empId,
      'leaveType': typeId,
      'startDate': iso(start!),
      'endDate': iso(end!),
      'reason': reason.text.trim(),
      'mode': 'manual',
      'deductBalance': deduct,
    });
    final bal = (r is Map) ? r['balance'] : null;
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
        bal is Map
          ? tr('سُجّلت — الرصيد المتبقّي ${bal['available']} يوم', 'Recorded — remaining balance ${bal['available']}')
          : tr('سُجّلت', 'Recorded'),
      )));
    }
    return true;
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    return false;
  }
}

