import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// Public customer complaints, the counterpart of /system/complaints on the web: create, resolve, delete, filters for status, category and priority, search (server-side, 20 per page), export, and live on complaint:created/updated/resolved/deleted.
const _categories = [
  ('service', 'الخدمة', 'Service'), ('vehicle', 'المركبة', 'Vehicle'), ('delivery', 'التوصيل', 'Delivery'), ('billing', 'الفواتير', 'Billing'),
  ('damage', 'أضرار', 'Damage'), ('delay', 'تأخير', 'Delay'), ('staff', 'الموظفين', 'Staff'), ('other', 'أخرى', 'Other'),
];
const _priorities = {
  'low': ('منخفض', 'Low', T.inkFaint), 'medium': ('متوسط', 'Medium', T.warn),
  'high': ('عالي', 'High', T.orange), 'urgent': ('عاجل', 'Urgent', T.danger),
};
const _statuses = {
  'open': ('مفتوح', 'Open', T.warn), 'in_progress': ('قيد المعالجة', 'In Progress', T.info),
  'resolved': ('تم الحل', 'Resolved', T.success), 'closed': ('مغلق', 'Closed', T.inkFaint),
};
// Matches managerRoles in backend/routes/complaints.js; resolving and deleting are theirs.
const _managerRoles = ['super_admin', 'admin', 'operations_manager'];
const _limit = 20;

String _cat(dynamic v) { for (final c in _categories) { if (c.$1 == v) return tr(c.$2, c.$3); } return '${v ?? ''}'; }
String _day(dynamic v) => '${v ?? ''}'.split('T').first;

class AdminComplaintsScreen extends StatefulWidget {
  const AdminComplaintsScreen({super.key});
  @override
  State<AdminComplaintsScreen> createState() => _AdminComplaintsScreenState();
}

class _AdminComplaintsScreenState extends State<AdminComplaintsScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _total = 0, _page = 1, _seq = 0;
  bool _loading = true;
  String? _error;
  String _status = '', _category = '', _priority = '', _search = '';
  Timer? _debounce;
  late final void Function() _onLive;

  static const _events = ['complaint:created', 'complaint:updated', 'complaint:resolved', 'complaint:deleted'];

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    _debounce?.cancel();
    super.dispose();
  }

  String _qs({bool filters = true}) => [
    if (filters && _status.isNotEmpty) 'status=$_status',
    if (filters && _category.isNotEmpty) 'category=$_category',
    if (filters && _priority.isNotEmpty) 'priority=$_priority',
    if (filters && _search.isNotEmpty) 'search=${Uri.encodeQueryComponent(_search)}',
  ].join('&');

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/complaints?${_qs()}&page=$_page&limit=$_limit');
      if (!mounted || mine != _seq) return;
      setState(() {
        // The server does not read `search` yet (complaintController), so the received rows are also filtered here.
        final q = _search.toLowerCase();
        _rows = List<Map<String, dynamic>>.from((d['complaints'] ?? const []).map((e) => Map<String, dynamic>.from(e)))
            .where((r) => q.isEmpty || '${r['subject']} ${r['customerName']} ${r['description']} ${r['customerPhone']}'.toLowerCase().contains(q)).toList();
        _total = (d['total'] as num?)?.toInt() ?? _rows.length;
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  void _set(VoidCallback f) { setState(() { f(); _page = 1; _loading = true; }); _load(); }
  void _msg(Object e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString()))); }
  bool get _hasFilters => [_status, _category, _priority, _search].any((x) => x.isNotEmpty);

  static final _cols = [
    ExportCol('الموضوع', 'Subject', (r) => r['subject']),
    ExportCol('التصنيف', 'Category', (r) => _cat(r['category'])),
    ExportCol('الأولوية', 'Priority', (r) { final p = _priorities[r['priority']]; return p == null ? r['priority'] : tr(p.$1, p.$2); }),
    ExportCol('الحالة', 'Status', (r) { final s = _statuses[r['status']]; return s == null ? r['status'] : tr(s.$1, s.$2); }),
    ExportCol('العميل', 'Customer', (r) => r['customerName']),
    ExportCol('الهاتف', 'Phone', (r) => r['customerPhone']),
    ExportCol('الوصف', 'Description', (r) => r['description']),
    ExportCol('الحل', 'Resolution', (r) => r['resolution']),
    ExportCol('تاريخ الإنشاء', 'Created', (r) => _day(r['createdAt'])),
    ExportCol('تاريخ الحل', 'Resolved', (r) => _day(r['resolvedAt'])),
  ];

  Future<void> _export() async {
    final pick = await showModalBottomSheet<String>(
      context: context, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.description_outlined), title: Text(tr('هذه الصفحة', 'This page')), onTap: () => Navigator.pop(c, 'page')),
        ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(_hasFilters ? tr('كلُّ ما يطابق الفلاتر', 'All matching') : tr('الكلّ', 'All')), trailing: Text('$_total'), onTap: () => Navigator.pop(c, 'matching')),
        if (_hasFilters) ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('الكلّ', 'All')), onTap: () => Navigator.pop(c, 'all')),
      ])),
    );
    if (pick == null || !mounted) return;
    var rows = _rows;
    if (pick != 'page') {
      try {
        final d = await Api.instance.get('/api/complaints?${_qs(filters: pick == 'matching')}&page=1&limit=100000');
        rows = List<Map<String, dynamic>>.from((d['complaints'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
      } catch (e) { _msg(e); return; }
    }
    if (!mounted) return;
    if (rows.isEmpty) { _msg(tr('لا صفوف للتصدير', 'Nothing to export')); return; }
    await exportExcel(context, fileName: 'complaints', sheets: [(tr('الشكاوى', 'Complaints'), _cols, rows)]);
  }

  Future<void> _create() async {
    final subject = TextEditingController(), desc = TextEditingController(), name = TextEditingController(), phone = TextEditingController();
    String category = 'service', priority = 'medium';
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('شكوى جديدة', 'New complaint'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 10),
          TextField(controller: subject, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('الموضوع *', 'Subject *'))),
          TextField(controller: desc, maxLines: 3, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('الوصف *', 'Description *'))),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: category, isExpanded: true, decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
              items: [for (final x in _categories) DropdownMenuItem(value: x.$1, child: Text(tr(x.$2, x.$3)))],
              onChanged: (v) => set(() => category = v ?? category),
            )),
            const SizedBox(width: 10),
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: priority, isExpanded: true, decoration: InputDecoration(labelText: tr('الأولوية', 'Priority')),
              items: [for (final x in _priorities.entries) DropdownMenuItem(value: x.key, child: Text(tr(x.value.$1, x.value.$2)))],
              onChanged: (v) => set(() => priority = v ?? priority),
            )),
          ]),
          TextField(controller: name, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('اسم العميل *', 'Customer name *'))),
          TextField(controller: phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('هاتف العميل', 'Customer phone'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: subject.text.trim().isEmpty || desc.text.trim().isEmpty || name.text.trim().isEmpty ? null : () => Navigator.pop(c, true),
            child: Text(tr('إنشاء', 'Create')),
          ),
        ])),
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/complaints', {
        'subject': subject.text.trim(), 'description': desc.text.trim(), 'category': category, 'priority': priority,
        'customerName': name.text.trim(), 'customerPhone': phone.text.trim(),
      });
      _load();
    } catch (e) { _msg(e); }
  }

  Future<void> _resolve(Map<String, dynamic> r) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حل الشكوى', 'Resolve complaint')),
      content: TextField(controller: ctrl, maxLines: 4, autofocus: true, decoration: InputDecoration(labelText: tr('الحل', 'Resolution'), border: const OutlineInputBorder())),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.success), onPressed: () => Navigator.pop(c, true), child: Text(tr('حل', 'Resolve'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.put('/api/complaints/${r['_id']}/resolve', {'resolution': ctrl.text.trim()});
      _load();
    } catch (e) { _msg(e); }
  }

  Future<void> _delete(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف هذه الشكوى؟', 'Delete this complaint?')),
      content: Text('${r['subject'] ?? ''}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try { await Api.instance.delete('/api/complaints/${r['_id']}'); _load(); } catch (e) { _msg(e); }
  }

  void _view(Map<String, dynamic> r) {
    final st = _statuses[r['status']], pr = _priorities[r['priority']];
    showModalBottomSheet<void>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => SafeArea(child: Padding(
        padding: const EdgeInsets.all(18),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${r['subject'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (st != null) Chip2(tr(st.$1, st.$2), st.$3),
            if (pr != null) Chip2(tr(pr.$1, pr.$2), pr.$3),
            Chip2(_cat(r['category']), T.inkSoft),
          ]),
          const SizedBox(height: 12),
          Text('${r['description'] ?? ''}', style: const TextStyle(fontSize: 13.5)),
          const SizedBox(height: 12),
          Text('${tr('العميل', 'Customer')}: ${r['customerName'] ?? ''}${'${r['customerPhone'] ?? ''}'.isEmpty ? '' : ' · ${r['customerPhone']}'}', style: const TextStyle(color: T.inkSoft)),
          if ('${r['createdByName'] ?? ''}'.isNotEmpty) Text('${tr('أنشأها', 'Created by')}: ${r['createdByName']}', style: const TextStyle(color: T.inkSoft)),
          Text('${tr('تاريخ الإنشاء', 'Created')}: ${_day(r['createdAt'])}', style: const TextStyle(color: T.inkSoft)),
          if ('${r['resolution'] ?? ''}'.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(tr('الحل', 'Resolution'), style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('${r['resolution']}', style: const TextStyle(color: T.success)),
            if (r['resolvedAt'] != null) Text(_day(r['resolvedAt']), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
          ],
        ])),
      )),
    );
  }

  Widget _chip(String label, bool on, VoidCallback tap) => Padding(
    padding: const EdgeInsetsDirectional.only(end: 6),
    child: ChoiceChip(label: Text(label, style: const TextStyle(fontSize: 12)), selected: on, onSelected: (_) => tap()),
  );

  @override
  Widget build(BuildContext context) {
    final canManage = _managerRoles.contains(context.watch<AuthProvider>().role);
    final pages = (_total / _limit).ceil();
    return AppScaffold(
      title: Text(tr('الشكاوى', 'Complaints')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), onPressed: _export, icon: const Icon(Icons.file_download_outlined))],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white, onPressed: _create,
        icon: const Icon(Icons.add), label: Text(tr('شكوى جديدة', 'New complaint')),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: SearchField(
            onChanged: (v) { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 400), () => _set(() => _search = v.trim())); },
            hint: tr('ابحث بالموضوع أو العميل…', 'Search…'),
            suffixText: '$_total',
          ),
        ),
        SizedBox(height: 44, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4), children: [
          _chip(tr('كل الحالات', 'All statuses'), _status.isEmpty, () => _set(() => _status = '')),
          for (final e in _statuses.entries) _chip(tr(e.value.$1, e.value.$2), _status == e.key, () => _set(() => _status = e.key)),
        ])),
        SizedBox(height: 44, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4), children: [
          _chip(tr('كل الأولويات', 'All priorities'), _priority.isEmpty, () => _set(() => _priority = '')),
          for (final e in _priorities.entries) _chip(tr(e.value.$1, e.value.$2), _priority == e.key, () => _set(() => _priority = e.key)),
          const SizedBox(width: 10),
          _chip(tr('كل التصنيفات', 'All categories'), _category.isEmpty, () => _set(() => _category = '')),
          for (final c in _categories) _chip(tr(c.$2, c.$3), _category == c.$1, () => _set(() => _category = c.$1)),
        ])),
        Expanded(child: _loading && _rows.isEmpty
            ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
            : _error != null && _rows.isEmpty
                ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _rows.isEmpty
                        ? ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [const SizedBox(height: 80), EmptyState(icon: Icons.forum_outlined, title: _search.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا توجد شكاوى', 'No complaints'))])
                        : ListView.separated(
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            padding: const EdgeInsets.fromLTRB(14, 6, 14, 96),
                            itemCount: _rows.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (c, i) {
                              final r = _rows[i];
                              final st = _statuses[r['status']] ?? ('—', '—', T.inkFaint);
                              final pr = _priorities[r['priority']];
                              final open = r['status'] == 'open' || r['status'] == 'in_progress';
                              return Pressable(
                                onTap: () => _view(r),
                                child: AppCard(
                                  topAccent: st.$3,
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(child: Text('${r['subject'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                      Chip2(tr(st.$1, st.$2), st.$3),
                                    ]),
                                    const SizedBox(height: 4),
                                    Text('${r['description'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                    const SizedBox(height: 6),
                                    Wrap(spacing: 6, runSpacing: 4, children: [
                                      Chip2('${r['customerName'] ?? ''}', T.navy, icon: Icons.person_outline),
                                      if (pr != null) Chip2(tr(pr.$1, pr.$2), pr.$3, icon: Icons.flag_outlined),
                                      Chip2(_cat(r['category']), T.inkSoft),
                                      Chip2(_day(r['createdAt']), T.inkFaint, icon: Icons.schedule),
                                    ]),
                                    if (canManage) Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                      if (open) TextButton.icon(onPressed: () => _resolve(r), icon: const Icon(Icons.check, size: 18, color: T.success), label: Text(tr('حل', 'Resolve'), style: const TextStyle(color: T.success))),
                                      IconButton(tooltip: tr('حذف', 'Delete'), onPressed: () => _delete(r), icon: const Icon(Icons.delete_outline, size: 20, color: T.danger)),
                                    ]),
                                  ]),
                                ),
                              );
                            },
                          ),
                  )),
        if (pages > 1) SafeArea(top: false, child: Row(children: [
          IconButton(onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); }, icon: const Icon(Icons.chevron_left)),
          Expanded(child: Text(tr('صفحة $_page من $pages', 'Page $_page of $pages'), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
          IconButton(onPressed: _page >= pages ? null : () { setState(() => _page++); _load(); }, icon: const Icon(Icons.chevron_right)),
        ])),
      ]),
    );
  }
}
