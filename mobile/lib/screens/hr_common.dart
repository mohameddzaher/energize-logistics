import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/search_field.dart';

/// أدواتٌ مشتركةٌ بين شاشات الموارد البشريّة في التطبيق — نظيرُ lib/hr.ts وHRKit
/// في الموقع: مَن هو من فريق القسم، ومنتقي الموظّف، وخانةُ التاريخ بتقويميها.

const hrStaffRoles = ['super_admin', 'admin', 'hr_manager', 'hr_specialist'];

/// فريقُ الموارد البشريّة بالدور أو بمنح القسم — isHRStaff في الموقع.
bool hrIsStaff(BuildContext context) {
  final a = context.read<AuthProvider>();
  return hrStaffRoles.contains(a.role) || a.canAccessSection('HR');
}

/// يكتب في الماستر: الدورُ أو منحُ «تعديل» على القسم — canEdit في صفحات الماستر.
bool hrCanEdit(BuildContext context) {
  final a = context.read<AuthProvider>();
  return hrStaffRoles.contains(a.role) || a.canEditSection('HR');
}

String hrEmpName(dynamic e) {
  if (e is! Map) return '';
  final ar = '${e['arabicName'] ?? ''}';
  final en = '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
  return Lang.instance.ar ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);
}

String hrIso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// «yyyy-mm-dd» أو DateTime أو null → DateTime.
DateTime? hrParse(dynamic v) {
  if (v == null || '$v'.isEmpty) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse('$v');
}

void hrSnack(BuildContext context, String m) {
  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
}

/// زرُّ تاريخٍ بتقويميه — نظيرُ DatePair: يُختار ميلاديًّا ويُكتب هجريُّه تحته،
/// والمُرسَل ميلاديٌّ وحدَه. `onChanged(null)` يمسحه.
class HrDateButton extends StatelessWidget {
  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  final DateTime? first;
  final bool clearable;
  const HrDateButton({super.key, required this.label, required this.value, required this.onChanged, this.first, this.clearable = true});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(child: OutlinedButton.icon(
        icon: const Icon(Icons.calendar_month_outlined, size: 18),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
        label: Text(
          '$label: ${value == null ? '—' : hrIso(value!)}${value == null ? '' : '\n${hijriHint(value, ar: Lang.instance.ar)}'}',
          style: const TextStyle(fontSize: 12.5),
        ),
        onPressed: () async {
          final now = DateTime.now();
          final d = await showDatePicker(
            context: context,
            initialDate: value ?? now,
            firstDate: first ?? DateTime(1950),
            lastDate: DateTime(now.year + 30),
          );
          if (d != null) onChanged(d);
        },
      )),
      if (clearable && value != null)
        IconButton(tooltip: tr('مسح', 'Clear'), onPressed: () => onChanged(null), icon: const Icon(Icons.close, size: 18)),
    ]);
  }
}

/// منتقي موظّفٍ فيه بحث — نظيرُ SearchableSelect على قائمة الموظّفين.
/// `rows` تُمرَّر حين تكون عند الشاشة (مرتّبةً بغرضها)، وإلّا تُقرأ من
/// GET /api/hr/employees. ويُرجع الصفَّ المختار.
Future<Map<String, dynamic>?> pickHrEmployee(BuildContext context, {
  List<Map<String, dynamic>>? rows,
  String Function(Map<String, dynamic>)? hintOf,
  (String, Color)? Function(Map<String, dynamic>)? badgeOf,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _EmpPicker(rows: rows, hintOf: hintOf, badgeOf: badgeOf),
  );
}

class _EmpPicker extends StatefulWidget {
  final List<Map<String, dynamic>>? rows;
  final String Function(Map<String, dynamic>)? hintOf;
  final (String, Color)? Function(Map<String, dynamic>)? badgeOf;
  const _EmpPicker({this.rows, this.hintOf, this.badgeOf});
  @override
  State<_EmpPicker> createState() => _EmpPickerState();
}

class _EmpPickerState extends State<_EmpPicker> {
  List<Map<String, dynamic>>? _rows;
  String _q = '';

  @override
  void initState() {
    super.initState();
    if (widget.rows != null) {
      _rows = widget.rows;
    } else {
      Api.instance.get('/api/hr/employees').then((d) {
        if (mounted) setState(() => _rows = List<Map<String, dynamic>>.from((d as Map)['employees'] ?? []));
      }).catchError((_) { if (mounted) setState(() => _rows = []); });
    }
  }

  String _name(Map<String, dynamic> e) => '${e['name'] ?? ''}'.isNotEmpty ? '${e['name']}' : hrEmpName(e);
  String _hint(Map<String, dynamic> e) => widget.hintOf != null
      ? widget.hintOf!(e)
      : [e['employeeNumber'], e['jobTitle'], e['iqamaNumber'] ?? e['nationalId']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');

  @override
  Widget build(BuildContext context) {
    final q = _q.trim().toLowerCase();
    final list = (_rows ?? const <Map<String, dynamic>>[]).where((e) =>
        q.isEmpty || '${_name(e)} ${e['arabicName'] ?? ''} ${_hint(e)}'.toLowerCase().contains(q)).take(300).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.8,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Text(tr('اختر الموظف', 'Pick an employee'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SearchField(
              autofocus: true, dense: true,
              onChanged: (v) => setState(() => _q = v),
              hint: tr('اسم / رقم وظيفي / رقم هوية…', 'name / employee no / ID…'),
            ),
          ),
          Expanded(
            child: _rows == null
                ? const Center(child: CircularProgressIndicator())
                : list.isEmpty
                    ? Center(child: Text(tr('لا موظف مطابق', 'No matching employee')))
                    : ListView.separated(
                        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (c, i) {
                          final e = list[i];
                          final b = widget.badgeOf?.call(e);
                          return ListTile(
                            dense: true,
                            title: Text(_name(e), style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text(_hint(e), style: const TextStyle(fontSize: 11.5)),
                            trailing: b == null ? null : Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(color: b.$2.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                              child: Text(b.$1, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: b.$2)),
                            ),
                            onTap: () => Navigator.pop(context, e),
                          );
                        },
                      ),
          ),
        ]),
      ),
    );
  }
}

/// مفاتيحُ الاستعلام من خريطة — تُسقط الفارغ.
String hrQs(Map<String, String> m) {
  final p = [for (final e in m.entries) if (e.value.isNotEmpty) '${e.key}=${Uri.encodeQueryComponent(e.value)}'];
  return p.isEmpty ? '' : '?${p.join('&')}';
}

/// نافذةُ تأكيدٍ قصيرة.
Future<bool> hrConfirm(BuildContext context, String message, {String? title, String? ok, bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: title == null ? null : Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: T.danger) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(ok ?? tr('تأكيد', 'Confirm')),
        ),
      ],
    ),
  );
  return r == true;
}

/// ورقةٌ سفليّةٌ بعنوانٍ وزرّ حفظ — يردّ true عند الحفظ.
Future<bool> hrSheet(BuildContext context, {required String title, required Widget Function(BuildContext, StateSetter) body, String? saveLabel}) async {
  final r = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        body(c, setS),
        const SizedBox(height: 14),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(saveLabel ?? tr('حفظ', 'Save'))),
      ])),
    )),
  );
  return r == true;
}
