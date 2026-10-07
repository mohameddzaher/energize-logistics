import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';

/// طلباتُ الأقسام إلى الموارد البشريّة — شاشةٌ واحدةٌ من طرفين.
///
/// نظيرةُ `/system/b2c/hr-requests` و`/system/hr/staff-requests`: القسمُ يرى
/// الميدانَ فيقول ما رآه («هؤلاء عادوا على رأس العمل»)، والموارد البشريّة
/// تستلم ثمّ تنفّذ أو ترفض **بسببٍ مكتوب**. والجوابُ قد يكون جزئيًّا، فلكلّ
/// اسمٍ قرارُه — وبجانبه زرٌّ يفتح ملفَّه ليُعدَّل من هناك.
///
/// و`side` هو الفارقُ الوحيد: جانبُ القسم يُنشئ، وجانبُ الموارد البشريّة يجيب.
class StaffRequestsScreen extends StatefulWidget {
  const StaffRequestsScreen({super.key, required this.side, this.section = 'B2C'});
  final String side;      // 'section' | 'hr'
  final String section;
  @override
  State<StaffRequestsScreen> createState() => _StaffRequestsScreenState();
}

const _kinds = [
  ('back_to_work', 'عاد على رأس العمل', 'Back to work'),
  ('service_ended', 'لم يعد / أُنهيت خدمته', 'Service ended'),
  ('on_leave', 'في إجازة', 'On leave'),
  ('data_fix', 'تصحيح بيانات', 'Data correction'),
  ('other', 'طلب آخر', 'Other'),
];

const _statusMeta = {
  'new': ('جديد', 'New', T.info),
  'received': ('تم الاستلام', 'Received', T.warn),
  'done': ('تم التنفيذ', 'Done', T.success),
  'rejected': ('مرفوض', 'Rejected', T.danger),
};

class _StaffRequestsScreenState extends State<StaffRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  bool _isHr = false;
  String? _error;
  String _tab = 'open';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _tab = widget.side == 'hr' ? 'open' : 'all';
    _load();
    _onLive = () => _load();
    Live.instance.on('staff-requests:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('staff-requests:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = <String>[];
      if (widget.side == 'section') p.add('scope=${widget.section}');
      if (_tab == 'open') p.add('status=new,received');
      if (_tab == 'closed') p.add('status=done,rejected');
      final d = await Api.instance.get('/api/staff-requests${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from((d as Map)['requests'] ?? []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _isHr = d['isHr'] == true;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _kindLabel(String k) {
    final x = _kinds.firstWhere((e) => e.$1 == k, orElse: () => ('', k, k));
    return tr(x.$2, x.$3);
  }

  String _fmt(dynamic v) {
    final d = DateTime.tryParse((v ?? '').toString());
    if (d == null) return '—';
    final l = d.toLocal();
    return '${l.year}/${l.month.toString().padLeft(2, '0')}/${l.day.toString().padLeft(2, '0')} '
        '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  /// سببُ الرفض يُكتَب قبل الإرسال — والخادمُ يردّ الرفضَ بلا سببٍ أيضًا، فهذا
  /// ليس حارسًا بل كي لا تُردّ المحاولةُ بعد الضغط.
  Future<String?> _askReason(String title) async {
    final c = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: c, maxLines: 3, autofocus: true,
          decoration: InputDecoration(labelText: tr('السبب — يقرؤه القسمُ الطالب', 'Reason — the section reads it')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(tr('تسجيل', 'Record'))),
        ],
      ),
    );
    if (go != true) return null;
    final t = c.text.trim();
    return t.isEmpty ? null : t;
  }

  Future<void> _decide(Map<String, dynamic> r, String status) async {
    String note = '';
    if (status == 'rejected') {
      final reason = await _askReason(tr('رفضُ الطلب', 'Reject the request'));
      if (reason == null) return;
      note = reason;
    }
    try {
      await Api.instance.patch('/api/staff-requests/${r['_id']}', {'status': status, 'decisionNote': note});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ', 'Saved'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _decideSubject(Map<String, dynamic> r, Map<String, dynamic> s, String decision) async {
    String note = '';
    if (decision == 'rejected') {
      final reason = await _askReason('${tr('رفض', 'Reject')} — ${s['name']}');
      if (reason == null) return;
      note = reason;
    }
    try {
      await Api.instance.patch('/api/staff-requests/${r['_id']}/subjects/${s['_id']}',
          {'decision': decision, 'decisionNote': note});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _create() async {
    final title = TextEditingController();
    final body = TextEditingController();
    String kind = 'back_to_work';
    // الأسماءُ اختياريّة: «كلُّ من في سكن جدة عادوا» طلبٌ مفهوم، وإجبارُ المرسِل
    // على تسمية كلِّ واحدٍ يجعله لا يرسل.
    final picked = <Map<String, dynamic>>[];
    List<Map<String, dynamic>> emps = [];
    final search = TextEditingController();

    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) {
        Future<void> loadEmps() async {
          try {
            final d = await Api.instance.get('/api/hr/employees-search?limit=2000');
            emps = List<Map<String, dynamic>>.from(((d as Map)['employees'] as List? ?? const [])
                .map((e) => Map<String, dynamic>.from(e as Map)));
            setSt(() {});
          } catch (e) {
            if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
          }
        }
        if (emps.isEmpty) loadEmps();
        final q = search.text.trim().toLowerCase();
        final shown = q.isEmpty
            ? <Map<String, dynamic>>[]
            : emps.where((e) => [e['arabicName'], e['firstName'], e['lastName'], e['employeeNumber'], e['iqamaNumber']]
                .any((v) => (v ?? '').toString().toLowerCase().contains(q))).take(25).toList();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(14, 14, 14, MediaQuery.of(c).viewInsets.bottom + 14),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(tr('طلب جديد إلى الموارد البشرية', 'New request to HR'),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('نوع الطلب', 'Kind')),
                  items: [for (final k in _kinds) DropdownMenuItem(value: k.$1, child: Text(tr(k.$2, k.$3)))],
                  onChanged: (v) => setSt(() => kind = v ?? kind),
                ),
                const SizedBox(height: 10),
                TextField(controller: title, decoration: InputDecoration(labelText: tr('عنوان مختصر', 'Short title'))),
                const SizedBox(height: 10),
                TextField(controller: body, maxLines: 3, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
                const SizedBox(height: 10),
                TextField(
                  controller: search,
                  onChanged: (_) => setSt(() {}),
                  decoration: InputDecoration(
                    labelText: tr('أضِف موظفًا (اختياري)', 'Add an employee (optional)'),
                    hintText: tr('ابحث بالاسم أو الإقامة أو الرقم الوظيفي…', 'name, ID or number…'),
                    prefixIcon: const Icon(Icons.search),
                  ),
                ),
                for (final e in shown)
                  ListTile(
                    dense: true,
                    title: Text((e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString().trim()),
                    subtitle: Text([
                      if ((e['employeeNumber'] ?? '').toString().isNotEmpty) '#${e['employeeNumber']}',
                      if ((e['department'] ?? '').toString().isNotEmpty) e['department'].toString(),
                      if ((e['employmentStatus'] ?? 'active') != 'active') tr('ليس على رأس العمل', 'not active'),
                    ].join(' · ')),
                    trailing: const Icon(Icons.add_circle_outline),
                    onTap: () => setSt(() {
                      if (!picked.any((p) => p['_id'] == e['_id'])) picked.add(e);
                      search.clear();
                    }),
                  ),
                if (picked.isNotEmpty)
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final e in picked)
                      Chip(
                        label: Text((e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString().trim()),
                        onDeleted: () => setSt(() => picked.removeWhere((p) => p['_id'] == e['_id'])),
                      ),
                  ]),
                const SizedBox(height: 14),
                Row(children: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: () => Navigator.pop(c, true),
                    icon: const Icon(Icons.send_outlined, size: 18),
                    label: Text(tr('إرسال', 'Send')),
                  ),
                ]),
              ]),
            ),
          ),
        );
      }),
    );
    if (go != true) return;
    if (title.text.trim().isEmpty && body.text.trim().isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب الطلب', 'Write the request'))));
      return;
    }
    try {
      await Api.instance.post('/api/staff-requests', {
        'section': widget.section, 'kind': kind,
        'title': title.text.trim(), 'body': body.text.trim(),
        'employees': [for (final e in picked) {'employee': e['_id']}],
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُرسل الطلب', 'Sent'))));
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    context.watch<AuthProvider>();
    // ── ومن يجيب يقرّره الخادمُ لا الشاشة ───────────────────────────────
    // `side` يقول «أيُّ الطرفين فُتحت له الشاشة»، و`isHr` يقول «أيملك هذا
    // القارئُ الجوابَ فعلًا» — وهو جوابُ الخادم نفسِه. فلو عُرضت الأزرارُ على
    // `side` وحدَه ضغطها من لا يملكها وردّها الخادمُ ٤٠٣.
    final hrSide = widget.side == 'hr' && _isHr;
    final open = ((_counts['new'] ?? 0) as num) + ((_counts['received'] ?? 0) as num);

    return AppScaffold(
      title: Text(hrSide ? tr('طلبات الأقسام', 'Section Requests') : tr('طلبات الموارد البشرية', 'HR Requests')),
      floatingActionButton: hrSide ? null : FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب جديد', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final f in [
                          ('open', 'المفتوحة', 'Open'),
                          ('closed', 'المنتهية', 'Closed'),
                          ('all', 'الكل', 'All'),
                        ])
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _tab == f.$1,
                              onSelected: (_) => setState(() { _tab = f.$1; _loading = true; _load(); }),
                              label: Text(f.$1 == 'open' ? '${tr(f.$2, f.$3)} ($open)' : tr(f.$2, f.$3)),
                              labelStyle: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700,
                                color: _tab == f.$1 ? Colors.white : T.navy,
                              ),
                              selectedColor: T.orange,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    if (_rows.isEmpty)
                      EmptyState(
                        icon: Icons.inbox_outlined,
                        title: hrSide ? tr('لا طلباتَ هنا', 'No requests') : tr('لم تُرسِل طلبًا بعد', 'Nothing sent yet'),
                      ),
                    for (final r in _rows) _card(r, hrSide),
                  ]),
                ),
    );
  }

  Widget _card(Map<String, dynamic> r, bool hrSide) {
    final st = _statusMeta[(r['status'] ?? 'new').toString()] ?? _statusMeta['new']!;
    final subs = List<Map<String, dynamic>>.from((r['subjects'] as List? ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map)));
    final closed = ['done', 'rejected'].contains((r['status'] ?? '').toString());

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('#${r['number'] ?? '—'}', style: const TextStyle(fontSize: 11, color: Colors.black45)),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: st.$3.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
              child: Text(tr(st.$1, st.$2), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: st.$3)),
            ),
            const SizedBox(width: 6),
            Expanded(child: Text(_kindLabel((r['kind'] ?? '').toString()),
                style: const TextStyle(fontSize: 11, color: Colors.black54), overflow: TextOverflow.ellipsis)),
            if (hrSide) Text((r['section'] ?? '').toString(), style: const TextStyle(fontSize: 11, color: T.orange, fontWeight: FontWeight.w700)),
          ]),
          const SizedBox(height: 6),
          Text((r['title'] ?? '').toString().isEmpty ? _kindLabel((r['kind'] ?? '').toString()) : r['title'].toString(),
              style: const TextStyle(fontWeight: FontWeight.w800)),
          if ((r['body'] ?? '').toString().isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(r['body'].toString(), style: const TextStyle(fontSize: 13, color: Colors.black87)),
          ],
          const SizedBox(height: 4),
          Text('${tr('من', 'From')} ${r['createdByName'] ?? '—'} · ${_fmt(r['createdAt'])}',
              style: const TextStyle(fontSize: 11, color: Colors.black45)),
          if ((r['decisionNote'] ?? '').toString().isNotEmpty) ...[
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: ((r['status'] ?? '') == 'rejected' ? T.danger : T.navy).withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text('${tr('الرد: ', 'Reply: ')}${r['decisionNote']}', style: const TextStyle(fontSize: 12)),
            ),
          ],
          if (subs.isNotEmpty) ...[
            const Divider(height: 18),
            Text('${subs.length} ${tr('موظفًا', 'employees')}', style: const TextStyle(fontSize: 11, color: Colors.black45)),
            for (final s in subs) _subjectRow(r, s, hrSide),
          ],
          if (hrSide && !closed) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              if ((r['status'] ?? '') == 'new')
                OutlinedButton.icon(
                  onPressed: () => _decide(r, 'received'),
                  icon: const Icon(Icons.hourglass_top_outlined, size: 16),
                  label: Text(tr('تم الاستلام', 'Received')),
                ),
              FilledButton.icon(
                onPressed: () => _decide(r, 'done'),
                icon: const Icon(Icons.check, size: 16),
                label: Text(tr('تم التنفيذ', 'Done')),
              ),
              OutlinedButton.icon(
                onPressed: () => _decide(r, 'rejected'),
                icon: const Icon(Icons.close, size: 16),
                label: Text(tr('رفض بسبب', 'Reject')),
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
              ),
            ]),
          ],
        ]),
      ),
    );
  }

  Widget _subjectRow(Map<String, dynamic> r, Map<String, dynamic> s, bool hrSide) {
    final dec = (s['decision'] ?? 'pending').toString();
    final color = dec == 'done' ? T.success : dec == 'rejected' ? T.danger : Colors.black54;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(children: [
        Icon(dec == 'done' ? Icons.check_circle : dec == 'rejected' ? Icons.cancel : Icons.radio_button_unchecked,
            size: 16, color: color),
        const SizedBox(width: 6),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((s['name'] ?? '—').toString(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            if ((s['decisionNote'] ?? '').toString().isNotEmpty)
              Text(s['decisionNote'].toString(), style: TextStyle(fontSize: 11, color: color)),
          ]),
        ),
        // زرٌّ يفتح ملفَّ الموظّف: الموارد البشريّة تقرأ الاسمَ ثمّ تحتاج أن
        // تغيّر حالتَه — فالرابطُ هنا بدل البحث عنه في قائمةٍ أخرى.
        if ((s['employee'] ?? '').toString().isNotEmpty)
          IconButton(
            tooltip: tr('افتح ملفَّه', 'Open profile'),
            icon: const Icon(Icons.manage_accounts_outlined, size: 18),
            onPressed: () => Navigator.push(context, MaterialPageRoute(
              builder: (_) => HrEmployeeProfileScreen(employeeId: s['employee'].toString()),
            )),
          ),
        if (hrSide && dec == 'pending') ...[
          IconButton(
            tooltip: tr('نُفِّذ', 'Done'),
            icon: const Icon(Icons.check, size: 18, color: T.success),
            onPressed: () => _decideSubject(r, s, 'done'),
          ),
          IconButton(
            tooltip: tr('رفض بسبب', 'Reject'),
            icon: const Icon(Icons.close, size: 18, color: T.danger),
            onPressed: () => _decideSubject(r, s, 'rejected'),
          ),
        ],
      ]),
    );
  }
}
