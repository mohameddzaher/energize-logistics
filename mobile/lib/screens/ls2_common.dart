import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';

/// أدواتُ لوكيشن سوليوشن المشتركة بين شاشاتها — صورةُ lib/ls2.ts في الموقع:
/// أسماءُ أنواع التنبيهات ووصفُها بالعربيّة، حالاتُ المركبة والصيانة، الأرقام،
/// وشريطُ الفترة (هذا الشهر حتى اليوم افتراضًا) كـ RangePicker.

List<Map<String, dynamic>> ls2List(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : <Map<String, dynamic>>[];

Map<String, dynamic> ls2Map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

num? ls2Num(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '');

/// رقمٌ بفواصل الآلاف، و«—» للغائب (لا صفرًا: الغائبُ لا يُقرأ صفرًا).
String ls2Fmt(dynamic v) {
  final n = ls2Num(v);
  if (n == null) return '—';
  final neg = n < 0;
  final s = n.abs().round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  return neg ? '-$s' : s;
}

String ls2Km(dynamic v) => ls2Num(v) == null ? '—' : '${ls2Fmt(v)} ${tr('كم', 'km')}';

String ls2Ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String ls2Date(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

String ls2DateTime(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '' : '${ls2Date(v)} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String ls2Duration(dynamic sec) {
  final s = ls2Num(sec);
  if (s == null) return '—';
  final d = s ~/ 86400, h = (s % 86400) ~/ 3600, m = (s % 3600) ~/ 60;
  if (d > 0) return tr('$dي $hس', '${d}d ${h}h');
  if (h > 0) return tr('$hس $mد', '${h}h ${m}m');
  return tr('$mد', '${m}m');
}

String ls2TimeAgo(dynamic iso) {
  final t = iso == null ? null : DateTime.tryParse(iso.toString());
  if (t == null) return '—';
  final m = DateTime.now().difference(t).inMinutes;
  if (m < 1) return tr('الآن', 'now');
  if (m < 60) return tr('منذ $m د', '${m}m ago');
  final h = m ~/ 60;
  if (h < 24) return tr('منذ $h س', '${h}h ago');
  return tr('منذ ${h ~/ 24} يوم', '${h ~/ 24}d ago');
}

// ── الحالات ───────────────────────────────────────────────────────────────
const ls2Statuses = {
  'moving': ('يتحرك', 'Moving', T.success),
  'idle': ('خامل', 'Idle', T.warn),
  'stopped': ('متوقف', 'Stopped', T.inkFaint),
  'offline': ('غير متصل', 'Offline', T.danger),
};
(String, String, Color) ls2Status(dynamic s) => ls2Statuses[s] ?? ls2Statuses['stopped']!;

const ls2MaintStates = {
  'ok': ('سليم', 'OK', T.success),
  'due': ('صيانة قريبة', 'Service due', T.warn),
  'overdue': ('متأخرة', 'Overdue', T.danger),
};
(String, String, Color) ls2Maint(dynamic s) => ls2MaintStates[s] ?? ls2MaintStates['ok']!;

const ls2Severities = {
  'critical': ('حرِج', 'Critical', T.danger),
  'warning': ('تحذير', 'Warning', T.warn),
  'info': ('معلومة', 'Info', T.inkFaint),
};
(String, String, Color) ls2Severity(dynamic s) => ls2Severities[s] ?? ls2Severities['info']!;

const _alertTypes = {
  'tire_temp': ('حرارة الكاوتش', 'Tire temperature'),
  'tire_pressure_low': ('ضغط كاوتش منخفض', 'Low tire pressure'),
  'tire_pressure_critical': ('خطر: ضغط إطار شبه معدوم', 'Flat tire risk'),
  'tire_pressure_high': ('ضغط كاوتش مرتفع', 'High tire pressure'),
  'tire_imbalance': ('عدم اتزان ضغط المحور', 'Axle pressure imbalance'),
  'tire_fault': ('عطل حساس كاوتش', 'Tire sensor fault'),
  'coolant_temp': ('حرارة الموتور', 'Engine temperature'),
  'rpm_high': ('لفّات موتور عالية', 'Engine over-rev'),
  'fuel_low': ('وقود منخفض', 'Low fuel'),
  'overload': ('حمولة زائدة', 'Overload'),
  'speeding': ('سرعة زائدة', 'Speeding'),
  'battery_low': ('جهد منخفض', 'Low voltage'),
  'idling': ('تشغيل خامل طويل', 'Excessive idling'),
  'maintenance_due': ('صيانة قريبة', 'Service due'),
  'maintenance_overdue': ('صيانة متأخرة', 'Service overdue'),
  'deferred_task': ('بند مؤجّل مستحق', 'Deferred task due'),
  'tire_sensor_change': ('تغيير في سينسورات الكاوتش', 'Tire sensors changed'),
  'offline': ('غير متصل', 'Offline'),
};

String ls2AlertType(dynamic type) {
  final x = _alertTypes[type];
  return x == null ? (type ?? '').toString() : tr(x.$1, x.$2);
}

const _repairCats = {
  'breakdown': ('عطل', 'Breakdown'), 'accident': ('حادث', 'Accident'), 'tires': ('الإطارات', 'Tires'),
  'electrical': ('كهرباء', 'Electrical'), 'engine': ('المحرك', 'Engine'), 'body': ('الهيكل', 'Body'), 'other': ('أخرى', 'Other'),
};
String ls2RepairCategory(dynamic c) {
  final x = _repairCats[c];
  return x == null ? (c ?? '').toString() : tr(x.$1, x.$2);
}

/// وصفُ التنبيه من حقوله — بلغة القارئ (رسالةُ الخادم إنجليزيّةٌ فقط).
String ls2AlertMessage(Map<String, dynamic> a) {
  final v = a['value'];
  final key = (a['key'] ?? '').toString();
  final tm = RegExp(r'axle(\d+)-tire(\d+)').firstMatch(key);
  final loc = tm == null ? '' : tr('محور ${tm.group(1)} · إطار ${tm.group(2)}', 'axle ${tm.group(1)} · tire ${tm.group(2)}');
  final am = RegExp(r'^axle(\d+)$').firstMatch(key)?.group(1) ?? '';
  final n = ls2Fmt(v);
  switch (a['type']) {
    case 'tire_temp': return tr('حرارة الكاوتشة ($loc) $v°م', 'Tire ($loc) at $v°C');
    case 'tire_pressure_low': return tr('ضغط منخفض بالكاوتشة ($loc) $v psi', 'Under-inflated tire ($loc) $v psi');
    case 'tire_pressure_critical': return tr('إطار شبه فارغ ($loc) $v psi — خطر انفجار', 'Nearly-flat tire ($loc) $v psi — blow-out risk');
    case 'tire_pressure_high': return tr('ضغط مرتفع بالكاوتشة ($loc) $v psi', 'Over-inflated tire ($loc) $v psi');
    case 'tire_imbalance': return tr('فرق ضغط بالمحور $am = $v psi', 'Axle $am pressure spread $v psi');
    case 'tire_fault': return tr('$v حسّاس كاوتش لا يُرسل بيانات', '$v tire sensor(s) not reporting');
    case 'coolant_temp': return tr('حرارة الموتور $v°م', 'Engine coolant $v°C');
    case 'rpm_high': return tr('لفّات موتور عالية $n', 'Engine over-revving $n rpm');
    case 'fuel_low': return tr('وقود منخفض $v%', 'Low fuel $v%');
    case 'overload': return tr('حمولة زائدة $n كجم', 'Overloaded $n kg');
    case 'speeding': return tr('سرعة زائدة $v كم/س', 'Speeding $v km/h');
    case 'battery_low': return tr('جهد منخفض $v فولت', 'Low voltage $v V');
    case 'maintenance_due': return tr('الصيانة بعد $n كم', 'Service due in $n km');
    case 'maintenance_overdue': return tr('الصيانة متأخرة $n كم', 'Service overdue by $n km');
    case 'offline': return tr('لا توجد إشارة منذ $v دقيقة', 'No signal for $v min');
    case 'tire_sensor_change':
      final from = ls2Map(a['context'])['from'] ?? a['threshold'];
      return tr('تغيّر عدد حسّاسات الإطارات المُرسِلة من ${from ?? '؟'} إلى ${v ?? '؟'}', 'Tire sensors reporting changed from ${from ?? '?'} to ${v ?? '?'}');
    default: return (a['message'] ?? '').toString();
  }
}

// ── الفترة ────────────────────────────────────────────────────────────────
/// «هذا الشهر حتى اليوم» — افتراضُ فلاتر الفترة في القسم كلِّه.
DateTimeRange ls2ThisMonthToDate() {
  final now = DateTime.now();
  return DateTimeRange(start: DateTime(now.year, now.month, 1), end: DateTime(now.year, now.month, now.day));
}

/// شريطُ الفترة: نفسُ اختصارات RangePicker في الموقع + فترةٌ تُنتقى بالتقويم.
class Ls2RangeBar extends StatelessWidget {
  final DateTimeRange value;
  final ValueChanged<DateTimeRange> onChanged;
  const Ls2RangeBar({super.key, required this.value, required this.onChanged});

  static List<(String, String, String, DateTimeRange Function())> get presets {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    DateTimeRange month(int off) => DateTimeRange(start: DateTime(now.year, now.month + off, 1), end: DateTime(now.year, now.month + off + 1, 0));
    DateTimeRange lastN(int n) => DateTimeRange(start: today.subtract(Duration(days: n - 1)), end: today);
    return [
      ('mtd', 'الشهر الحالي', 'This month', ls2ThisMonthToDate),
      ('prev', 'الشهر السابق', 'Last month', () => month(-1)),
      ('d7', 'آخر ٧ أيام', 'Last 7 days', () => lastN(7)),
      ('d30', 'آخر ٣٠ يومًا', 'Last 30 days', () => lastN(30)),
      ('prev2', 'قبل شهرين', '2 months ago', () => month(-2)),
    ];
  }

  bool _same(DateTimeRange a, DateTimeRange b) => ls2Ymd(a.start) == ls2Ymd(b.start) && ls2Ymd(a.end) == ls2Ymd(b.end);

  @override
  Widget build(BuildContext context) {
    final ps = presets;
    final isPreset = ps.any((p) => _same(p.$4(), value));
    Widget chip(String label, bool sel, VoidCallback onTap) => Padding(
          padding: const EdgeInsetsDirectional.only(end: 6),
          child: ChoiceChip(
            selected: sel, label: Text(label), onSelected: (_) => onTap(),
            labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy),
            selectedColor: T.orange, backgroundColor: T.navy.withValues(alpha: 0.06), side: BorderSide.none, showCheckmark: false,
          ),
        );
    return SizedBox(
      height: 40,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14), children: [
        for (final p in ps) chip(tr(p.$2, p.$3), _same(p.$4(), value), () => onChanged(p.$4())),
        chip(
          isPreset ? tr('فترة…', 'Range…') : '${ls2Ymd(value.start)} → ${ls2Ymd(value.end)}',
          !isPreset,
          () async {
            final r = await showDateRangePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 1)), initialDateRange: value);
            if (r != null) onChanged(r);
          },
        ),
      ]),
    );
  }
}

/// قائمةُ خيارات التصدير — كـ ExportMenu في الموقع: كلّ خيارٍ ملفٌّ بأوراقه.
Future<void> ls2ExportMenu(
  BuildContext context, {
  required String fileName,
  required List<(String, String, List<(String, List<ExportCol>, List<Map<String, dynamic>>)>)> options,
}) async {
  if (options.length == 1) {
    await exportExcel(context, fileName: fileName, sheets: options.first.$3);
    return;
  }
  final i = await showModalBottomSheet<int>(
    context: context,
    builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      for (var k = 0; k < options.length; k++)
        ListTile(leading: const Icon(Icons.file_download_outlined), title: Text(tr(options[k].$1, options[k].$2)), onTap: () => Navigator.pop(c, k)),
    ])),
  );
  if (i == null || !context.mounted) return;
  await exportExcel(context, fileName: fileName, sheets: options[i].$3);
}
