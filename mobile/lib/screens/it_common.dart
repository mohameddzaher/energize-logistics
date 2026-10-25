import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// أدواتٌ مشتركة بين شاشات تقنية المعلومات — نظيرُ lib/it.ts في الويب:
/// تسمياتُ البلاغات، وتنسيقُ التاريخ وزمن الحلّ، ومنتقي الموظّف والتاريخ.

// ── التسميات — مطابقةٌ لـ TICKET_* في frontend/src/lib/it.ts ─────────────────
const ticketCategories = {
  'hardware': ('أجهزة', 'Hardware'),
  'software': ('برامج', 'Software'),
  'network': ('الشبكة', 'Network'),
  'email': ('البريد الإلكتروني', 'Email'),
  'printer': ('الطابعات', 'Printer'),
  'account_access': ('الحسابات والصلاحيات', 'Account / Access'),
  'erp_system': ('نظام ERP', 'ERP System'),
  'phone': ('الهاتف', 'Phone'),
  'security': ('الأمن السيبراني', 'Security'),
  'other': ('أخرى', 'Other'),
};

const ticketPriorities = {
  'low': ('منخفضة', 'Low'),
  'medium': ('متوسطة', 'Medium'),
  'high': ('عالية', 'High'),
  'urgent': ('عاجلة', 'Urgent'),
};

const ticketStatuses = {
  'open': ('مفتوحة', 'Open'),
  'in_progress': ('قيد التنفيذ', 'In Progress'),
  'resolved': ('تم الحل', 'Resolved'),
  'closed': ('مغلقة', 'Closed'),
  'reopened': ('أعيد فتحها', 'Reopened'),
};

const systemStatuses = {
  'operational': ('يعمل', 'Operational'),
  'degraded': ('أداء منخفض', 'Degraded'),
  'down': ('متوقف', 'Down'),
  'maintenance': ('صيانة', 'Maintenance'),
  'retired': ('خارج الخدمة', 'Retired'),
};

String _lbl(Map<String, (String, String)> m, dynamic k, {bool en = false}) {
  final e = m['${k ?? ''}'];
  if (e == null) return (k ?? '').toString().isEmpty ? '—' : k.toString();
  return en ? e.$2 : tr(e.$1, e.$2);
}

String categoryLabel(dynamic k, {bool en = false}) => _lbl(ticketCategories, k, en: en);
String priorityLabel(dynamic k, {bool en = false}) => _lbl(ticketPriorities, k, en: en);
String ticketStatusLabel(dynamic k, {bool en = false}) => _lbl(ticketStatuses, k, en: en);
String systemStatusLabel(dynamic k) => _lbl(systemStatuses, k);

Color ticketStatusColor(dynamic s) => switch ('$s') {
      'open' => T.warn,
      'in_progress' => T.info,
      'resolved' => T.success,
      'reopened' => T.danger,
      _ => T.inkFaint,
    };

Color priorityColor(dynamic p) => switch ('$p') {
      'urgent' => T.danger,
      'high' => T.warn,
      'medium' => T.info,
      _ => T.inkFaint,
    };

// ── التنسيق ─────────────────────────────────────────────────────────────────
String itDate(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

/// يومُ الشركة بصيغة YYYY-MM-DD.
String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String todayYmd() => ymd(DateTime.now());
String daysAgoYmd(int n) => ymd(DateTime.now().subtract(Duration(days: n)));

/// زمنُ الحلّ — نظيرُ fmtDuration: صفرٌ يعني «نفس اليوم» لا «٠ د».
String fmtDuration(dynamic minutes, {bool en = false}) {
  if (minutes is! num || !minutes.isFinite) return '—';
  final m = minutes.round() < 0 ? 0 : minutes.round();
  final ar = !en && Lang.instance.ar;
  if (m == 0) return ar ? 'نفس اليوم' : 'Same day';
  if (m < 60) return ar ? '$m د' : '${m}m';
  final h = m ~/ 60, mm = m % 60;
  if (h < 24) return ar ? (mm > 0 ? '$h س $mm د' : '$h س') : (mm > 0 ? '${h}h ${mm}m' : '${h}h');
  final d = h ~/ 24, hh = h % 24;
  return ar ? (hh > 0 ? '$d ي $hh س' : '$d ي') : (hh > 0 ? '${d}d ${hh}h' : '${d}d');
}

String fmtMoney(dynamic v) {
  if (v is! num) return '—';
  final s = v.toStringAsFixed(v == v.roundToDouble() ? 0 : 2);
  final parts = s.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return parts.length > 1 ? '$whole.${parts[1]}' : whole;
}

String userName(dynamic u) {
  if (u == null) return '—';
  if (u is String) return u;
  if (u is Map) {
    final n = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
    return n.isEmpty ? '—' : n;
  }
  return '—';
}

String itEmpName(dynamic e, {bool en = false}) {
  if (e == null) return '—';
  if (e is String) return e;
  if (e is! Map) return '—';
  final ar = (e['arabicName'] ?? '').toString();
  if (!en && Lang.instance.ar && ar.isNotEmpty) return ar;
  final n = '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
  return n.isNotEmpty ? n : (ar.isNotEmpty ? ar : '—');
}

String idOf(dynamic v) => v == null ? '' : v is Map ? '${v['_id'] ?? ''}' : '$v';

/// من يكتب في القسم — نظيرُ canEditIt: أدوارُ EDIT_ROLES في routes/it.js أو منحةُ «تعديل».
bool canEditIt(BuildContext context) {
  final a = context.read<AuthProvider>();
  return const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(a.role) || a.canEditSection('Software & IT');
}

String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

// ── قوائمُ القسم — تُجلب مرّةً وتبقى في الذاكرة ─────────────────────────────
List<Map<String, dynamic>>? _employeesCache;
Future<List<Map<String, dynamic>>> itEmployees() async {
  if (_employeesCache != null) return _employeesCache!;
  try {
    final d = await Api.instance.get('/api/it/employees');
    _employeesCache = List<Map<String, dynamic>>.from(d['employees'] ?? []);
  } catch (_) {
    return [];
  }
  return _employeesCache!;
}

/// منتقي موظّف بالبحث — الاسم والرقم الوظيفي والإقامة والقسم، كـSearchableSelect في الويب.
Future<Map<String, dynamic>?> pickItEmployee(BuildContext context, {String? title}) async {
  final emps = await itEmployees();
  if (!context.mounted) return null;
  return pickFromList(
    context,
    title: title ?? tr('اختر الموظف', 'Select an employee'),
    items: emps,
    label: (e) => itEmpName(e),
    hint: (e) => [e['employeeNumber'], e['department'], e['iqamaNumber']]
        .where((x) => x != null && '$x'.isNotEmpty).join(' · '),
  );
}

/// قائمةٌ قابلةٌ للبحث في ورقةٍ سفليّة — تعيد العنصرَ المختار.
Future<Map<String, dynamic>?> pickFromList(
  BuildContext context, {
  required String title,
  required List<Map<String, dynamic>> items,
  required String Function(Map<String, dynamic>) label,
  String Function(Map<String, dynamic>)? hint,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) {
      String q = '';
      return StatefulBuilder(builder: (c, setS) {
        final fq = _fold(q.trim());
        final list = items.where((e) => fq.isEmpty || _fold('${label(e)} ${hint?.call(e) ?? ''}').contains(fq)).toList();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.7,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                  child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 6, 14, 6),
                  child: TextField(
                    autofocus: true,
                    onChanged: (v) => setS(() => q = v),
                    decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search), isDense: true),
                  ),
                ),
                Expanded(
                  child: list.isEmpty
                      ? Center(child: Text(tr('لا توجد نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                      : ListView.separated(
                          itemCount: list.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (c, i) {
                            final h = hint?.call(list[i]) ?? '';
                            return ListTile(
                              dense: true,
                              title: Text(label(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                              subtitle: h.isEmpty ? null : Text(h, style: const TextStyle(fontSize: 11.5)),
                              onTap: () => Navigator.pop(c, list[i]),
                            );
                          },
                        ),
                ),
              ]),
            ),
          ),
        );
      });
    },
  );
}

/// خانةُ تاريخ تُفتح بالضغط — القيمة YYYY-MM-DD أو فارغة.
class ItDateField extends StatelessWidget {
  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final bool clearable;
  final String? emptyText;
  const ItDateField({super.key, required this.label, required this.value, required this.onChanged, this.clearable = false, this.emptyText});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final init = DateTime.tryParse(value) ?? DateTime.now();
        final d = await showDatePicker(context: context, initialDate: init, firstDate: DateTime(2015), lastDate: DateTime(2100));
        if (d != null) onChanged(ymd(d));
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          prefixIcon: const Icon(Icons.calendar_today_outlined, size: 16),
          suffixIcon: clearable && value.isNotEmpty
              ? IconButton(icon: const Icon(Icons.close, size: 16), onPressed: () => onChanged(''))
              : null,
        ),
        child: Text(value.isEmpty ? (emptyText ?? '—') : value,
            textDirection: TextDirection.ltr,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: value.isEmpty ? T.inkFaint : T.ink)),
      ),
    );
  }
}

/// «من — إلى» في صفّ واحد، و«إلى» الفارغة تُقرأ «حتى اليوم» — كـDateRangeFilter.
class ItDateRange extends StatelessWidget {
  final String from, to;
  final ValueChanged<String> onFrom, onTo;
  const ItDateRange({super.key, required this.from, required this.to, required this.onFrom, required this.onTo});
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(child: ItDateField(label: tr('من', 'From'), value: from, onChanged: onFrom, clearable: true, emptyText: tr('من البداية', 'Any'))),
        const SizedBox(width: 8),
        Expanded(child: ItDateField(label: tr('إلى', 'To'), value: to, onChanged: onTo, clearable: true, emptyText: tr('حتى اليوم', 'Today'))),
      ]);
}

/// قائمةٌ منسدلة صغيرة بخيار «الكل» — للفلاتر.
class ItFilterDropdown extends StatelessWidget {
  final String label;
  final String value;
  final Map<String, (String, String)> options;
  final ValueChanged<String> onChanged;
  final String allAr, allEn;
  const ItFilterDropdown({super.key, required this.label, required this.value, required this.options, required this.onChanged, required this.allAr, required this.allEn});
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
        // المفتاحُ بالقيمة: «مسح الفلاتر» يُعيد بناء الخانة على قيمتها الجديدة.
        key: ValueKey('$label=$value'),
        initialValue: options.containsKey(value) ? value : '',
        isExpanded: true,
        decoration: InputDecoration(labelText: label, isDense: true),
        items: [
          DropdownMenuItem(value: '', child: Text(tr(allAr, allEn), overflow: TextOverflow.ellipsis)),
          ...options.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2), overflow: TextOverflow.ellipsis))),
        ],
        onChanged: (v) => onChanged(v ?? ''),
      );
}

/// اختيارُ نطاق التصدير — «المعروض» أو «الكل» — حين يكون في الشاشة فلتر، كـExportMenu.
Future<String?> pickExportScope(BuildContext context, {required bool filtered, String? allHint}) async {
  if (!filtered) return 'all';
  return showModalBottomSheet<String>(
    context: context,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.filter_alt_outlined),
          title: Text(tr('المعروض فقط', 'Shown rows')),
          onTap: () => Navigator.pop(c, 'shown'),
        ),
        ListTile(
          leading: const Icon(Icons.select_all),
          title: Text(tr('الكل', 'Everything')),
          trailing: allHint == null ? null : Text(allHint, style: const TextStyle(color: T.inkFaint)),
          onTap: () => Navigator.pop(c, 'all'),
        ),
      ]),
    ),
  );
}
