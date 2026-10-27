import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/hijri.dart';
import '../ui/export_sheet.dart';
import '../ui/filter_sheet.dart';
import '../ui/hr_quick.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import 'hr_employee_profile.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// الموظفون — native register: server-side search (name / iqama / number),
/// status chips and a detail sheet per employee.
class HrEmployeesScreen extends StatefulWidget {
  const HrEmployeesScreen({super.key});
  @override
  State<HrEmployeesScreen> createState() => _HrEmployeesScreenState();
}

const _empStatus = {
  // «حالة العمل»: يعمل أو لا يعمل (= إنهاءُ الخدمة بحالةٍ من ثلاث) — كالموقع.
  'active': ('يعمل', 'Working', T.success),
  'on_leave': ('يعمل — إجازة', 'Working — on leave', T.info),
  'suspended': ('موقوف (قديم)', 'Suspended (legacy)', T.warn),
  'terminated': ('لا يعمل', 'Not working', T.danger),
};

class _HrEmployeesScreenState extends State<HrEmployeesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  // الفلتر المتقدّم — نفس لغة لوحة الموارد البشرية في الموقع حرفيًّا، فالسؤال
  // الذي تسأله من المتصفّح تسأله من الهاتف وتحصل على العدد نفسه.
  Map<String, String> _filters = {};
  // ── ما أضافه قسمُ الأفراد من سجلّ النقل الخفيف ────────────────────────────
  // يُنشأ الملفُّ هناك ببياناتٍ قليلة، وتُكمله الموارد البشريّة. فزرٌّ يجمعهم:
  // ضغطةٌ تفلتر القائمةَ بهم، وضغطةٌ ثانيةٌ تعيدها.
  int _fromB2c = 0;
  bool _b2cOnly = false;
  Timer? _debounce;
  final _qCtrl = TextEditingController();
  // الأحدثُ وحدَه يُعرض: ردٌّ قديمٌ (أو ردُّ ما قبل المسح) لا يكتب فوق جديد.
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
    // تعديلُ الماستر أو ملفّ الموظّف أو بطاقةِ السائق من المركبات يصل هنا فورًا.
    Live.instance.on('hr:master', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  void _onLive() => _load();

  @override
  void dispose() {
    _debounce?.cancel();
    Live.instance.off('hr:master', _onLive);
    Live.instance.off('hr:employee', _onLive);
    _qCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final params = <String>[];
      if (_qCtrl.text.trim().isNotEmpty) params.add('q=${Uri.encodeComponent(_qCtrl.text.trim())}');
      if (_status.isNotEmpty) params.add('status=$_status');
      if (_b2cOnly) params.add('createdVia=b2c');
      _filters.forEach((k, v) { if (v.isNotEmpty) params.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/hr/employees${params.isEmpty ? '' : '?${params.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['employees'] ?? []);
        _fromB2c = ((d['fromB2c'] ?? 0) as num).toInt();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () { if (!mounted) return; setState(() => _loading = true); _load(); });
  }

  String _name(Map<String, dynamic> e) {
    final ar = (e['arabicName'] ?? '').toString();
    final en = '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
    return Lang.instance.ar ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);
  }

  // ── أفعالُ الصفّ كالموقع: تعديل · إنهاء الخدمة (يفتح الملفّ) · حذفٌ نهائيّ ──
  // إنهاءُ الخدمة لا يُفعَل من القائمة: يُكتب سببُه وتاريخُه في ملفّ الموظّف
  // ويُحرَس بالعهدة والتفويض — فالزرُّ يفتح الملفّ. والحذفُ لمدير النظام وحدَه.
  void _editRow(Map<String, dynamic> e) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => EditEmployeeSheet(employee: e, onDone: () async => _load()),
    );
  }

  Future<void> _removeForGood(Map<String, dynamic> e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف سجلّ «${_name(e)}» نهائيًّا؟', 'Permanently delete "${_name(e)}"?')),
        content: Text(tr(
          'يُحذَف السجلُّ ومستنداتُه وتجديداتُه ولا يظهر في أيّ قائمة. لمن ترك العمل استعمل «إنهاء الخدمة» — الحذفُ لسجلٍّ أُدخل خطأً أو مكرَّرًا. تُحفَظ نسخةٌ منه في سجلّ المراجعة.',
          'The record, its documents and renewals are removed. For someone who left, use "End service" — delete is for a record entered by mistake or duplicated. A copy is kept in the audit log.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف نهائيّ', 'Delete permanently'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/hr/employees/${e['_id']}');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُذف السجلّ', 'Record deleted'))));
      _load();
    } catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
    }
  }

  Widget _rowMenu(Map<String, dynamic> e) {
    final role = context.read<AuthProvider>().role;
    final canEnd = (const ['super_admin', 'admin'].contains(role) || role == 'hr_manager') && e['employmentStatus'] != 'terminated';
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert, color: T.inkFaint, size: 20),
      onSelected: (v) {
        if (v == 'edit') _editRow(e);
        if (v == 'end') _open(e);
        if (v == 'delete') _removeForGood(e);
      },
      itemBuilder: (_) => [
        PopupMenuItem(value: 'edit', child: Row(children: [const Icon(Icons.edit_outlined, size: 18, color: T.navy), const SizedBox(width: 10), Text(tr('تعديل', 'Edit'))])),
        if (canEnd)
          PopupMenuItem(value: 'end', child: Row(children: [const Icon(Icons.person_remove_outlined, size: 18, color: T.warn), const SizedBox(width: 10), Text(tr('إنهاء الخدمة — من ملفّ الموظّف', 'End service — in the employee file'))])),
        if (const ['super_admin', 'admin'].contains(role))
          PopupMenuItem(value: 'delete', child: Row(children: [const Icon(Icons.delete_forever_outlined, size: 18, color: T.danger), const SizedBox(width: 10), Text(tr('حذف السجلّ نهائيًّا (مدير النظام)', 'Delete permanently (system admin)'), style: const TextStyle(color: T.danger))])),
      ],
    );
  }

  String _d(dynamic v) => gregDay(v);

  List<ExportCol> get _exportCols => [
        ExportCol('الاسم', 'Name', (r) => '${r['firstName'] ?? ''} ${r['lastName'] ?? ''}'.trim()),
        ExportCol('الاسم بالعربي', 'Arabic Name', (r) => r['arabicName'] ?? ''),
        ExportCol('رقم الموظف', 'Employee no.', (r) => r['employeeNumber'] ?? ''),
        ExportCol('المسمى الوظيفي', 'Job Title', (r) => r['jobTitle'] ?? ''),
        ExportCol('نوع الهوية', 'ID Type', (r) => r['idType'] ?? ''),
        ExportCol('الإقامة', 'Iqama', (r) => r['iqamaNumber'] ?? ''),
        ExportCol('تاريخ انتهاء الإقامة الميلادي', 'Iqama Expiry (Gregorian)', (r) => _d(r['iqamaExpiry'])),
        ExportCol('تاريخ انتهاء الإقامة الهجري', 'Iqama Expiry (Hijri)', (r) => hijriDay(r['iqamaExpiry'])),
        ExportCol('الهوية الوطنية', 'National ID', (r) => r['nationalId'] ?? ''),
        ExportCol('الجنسية', 'Nationality', (r) => r['nationality'] ?? ''),
        ExportCol('الجوال', 'Phone', (r) => r['phone'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => r['employmentStatus'] ?? ''),
        ExportCol('تاريخ التعيين (ميلادي)', 'Hire Date (Gregorian)', (r) => _d(r['hireDate'])),
        ExportCol('تاريخ التعيين (هجري)', 'Hire Date (Hijri)', (r) => hijriDay(r['hireDate'])),
      ];

  Future<void> _open(Map<String, dynamic> e) async {
    final deleted = await Navigator.push<bool>(context, MaterialPageRoute(
        builder: (c) => HrEmployeeProfileScreen(employeeId: e['_id'].toString())));
    // حُذف السجلُّ من ملفّه: القائمةُ تُعاد قراءتُها فلا يبقى صفُّه.
    if (deleted == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('الموظفون', 'Employees')),
      // التصدير: المعروضُ تحت الفلتر، أو السجلُّ كلُّه — نطاقا الموقع.
      actions: [
        PopupMenuButton<String>(
          icon: const Icon(Icons.file_download_outlined),
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          onSelected: (v) async {
            var rows = _rows;
            final messenger = ScaffoldMessenger.of(context);
            if (v == 'all') {
              try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/hr/employees'))['employees'] ?? []); }
              catch (e) { messenger.showSnackBar(SnackBar(content: Text(e.toString()))); return; }
            }
            if (!context.mounted) return;
            exportExcel(context, fileName: 'employees', sheets: [('Employees', _exportCols, rows)]);
          },
          itemBuilder: (_) => [
            PopupMenuItem(value: 'shown', child: Text(tr('المعروض (${_rows.length})', 'Shown (${_rows.length})'))),
            PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
          ],
        ),
      ],
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
          child: Row(children: [
            Expanded(
              child: SearchField(
                controller: _qCtrl,
                onChanged: _onSearch,
                hint: tr('ابحث بالاسم أو الإقامة أو رقم الموظف…', 'Search name, iqama, number…'),
              ),
            ),
            const SizedBox(width: 8),
            Badge(
              isLabelVisible: _filters.isNotEmpty,
              label: Text('${_filters.length}'),
              child: IconButton.filled(
                style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                icon: const Icon(Icons.tune),
                tooltip: tr('التصفية', 'Filter'),
                onPressed: () async {
                  final r = await showFilterSheet(
                    context: context,
                    optionsUrl: '/api/hr/master/filters',
                    value: _filters,
                    extraLabels: {
                      'employment': tr('حالة التوظيف', 'Employment'),
                      'outsideKingdom': tr('خارج المملكة', 'Outside kingdom'),
                      'freelancer': tr('عمل حر', 'Freelancer'),
                    },
                  );
                  if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                },
              ),
            ),
          ]),
        ),
        // القسم · المدينة · حالة العمل · المشروع · الجنسية — الفلترُ نفسُه (ui/hr_quick.dart).
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: HrQuickFilters(
            value: _filters,
            params: const {'scope': 'all'},
            onChanged: (v) { setState(() { _filters = v; _loading = true; }); _load(); },
          ),
        ),
        if (_fromB2c > 0 || _b2cOnly)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: Tooltip(
                message: tr('موظفون أضافهم قسم الأفراد من سجلّ النقل الخفيف — أكمِل بياناتهم', 'Employees added by the B2C section — complete their files'),
                child: FilterChip(
                  selected: _b2cOnly,
                  showCheckmark: false,
                  onSelected: (_) { setState(() { _b2cOnly = !_b2cOnly; _loading = true; }); _load(); },
                  avatar: Icon(Icons.person_add_alt_outlined, size: 16, color: _b2cOnly ? Colors.white : T.warn),
                  label: Text('${tr('موظفون جدد من قسم الأفراد (B2C)', 'New from B2C')} · $_fromB2c'),
                  labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _b2cOnly ? Colors.white : T.warn),
                  selectedColor: T.navy,
                  backgroundColor: T.warn.withValues(alpha: 0.12),
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
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
                          // ── ولا يُقال «لا يوجد» وهو موجود ───────────────
                          // البحثُ يُطبَّق داخلَ الفلاتر القائمة، فمن فلتر
                          // بـ«نشط» ثمّ بحث عن واحدٍ من منتهيةِ خدمتُهم قرأ
                          // «لا يوجد موظفون» والموظّفُ في السجلّ. فالشاشةُ
                          // الفارغةُ تقول ما يحجب. (نفسُ الإصلاح في الويب.)
                          ? EmptyState(
                              icon: Icons.people_alt_outlined,
                              title: tr('لا يوجد موظفون مطابقون', 'No matching employees'),
                              subtitle: (_status.isNotEmpty || _filters.isNotEmpty || _b2cOnly)
                                  ? tr(
                                      'فيه فلاتر شغّالة والبحث بيتم جوّاها — امسحها وابحث في كل الموظفين.',
                                      'Filters are active and the search runs inside them — clear them to search everyone.')
                                  : null,
                            )
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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
                                            // رقم الهوية أول حاجة تحت الاسم — ده اللي بيتسيرش
                                            // بيه، ونفس ترتيب جداول الموقع بالظبط.
                                            Text([
                                              (e['idType'] == 'national_id' ? e['nationalId'] : e['iqamaNumber']),
                                              e['jobTitle'],
                                              e['department'],
                                            ].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ]),
                                        ),
                                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                          // حالتُه اليوم في قسم الأفراد (إجازة · موقوف · حادث).
                                          if (b2cOpChip(e['b2cOpStatus']) != null)
                                            Padding(padding: const EdgeInsets.only(top: 4), child: b2cOpChip(e['b2cOpStatus'])!),
                                        ]),
                                        _rowMenu(e),
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
