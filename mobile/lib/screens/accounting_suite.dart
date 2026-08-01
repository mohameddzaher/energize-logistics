import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الحسابات — شجرة الحسابات ودفتر اليومية (عرض وإنشاء قيد متوازن).

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

const _accTypes = {
  'asset': ('أصول', 'Assets', T.navy),
  'liability': ('التزامات', 'Liabilities', T.danger),
  'equity': ('حقوق ملكية', 'Equity', T.violet),
  'revenue': ('إيرادات', 'Revenue', T.success),
  'expense': ('مصروفات', 'Expenses', T.orange),
};

// ── شجرة الحسابات ───────────────────────────────────────────────────────────
class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key});
  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _type = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/accounting/accounts${_type.isEmpty ? '' : '?type=$_type'}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['accounts'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  void _rowMenu(Map<String, dynamic> r) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.edit_outlined, color: T.navy), title: Text(tr('تعديل الحساب', 'Edit account')), onTap: () { Navigator.pop(c); _openForm(row: r); }),
          ListTile(leading: const Icon(Icons.delete_outline, color: T.danger), title: Text(tr('حذف', 'Delete')), onTap: () { Navigator.pop(c); _delete(r); }),
          const SizedBox(height: 6),
        ]),
      ),
    );
  }

  Future<void> _delete(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف الحساب', 'Delete account')),
        content: Text(tr('حذف «${r['nameAr'] ?? r['nameEn']}»؟', 'Delete this account?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/accounting/accounts/${r['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  void _openForm({Map<String, dynamic>? row}) {
    final isEdit = row != null;
    final code = TextEditingController(text: (row?['code'] ?? '').toString());
    final nameAr = TextEditingController(text: (row?['nameAr'] ?? '').toString());
    final nameEn = TextEditingController(text: (row?['nameEn'] ?? '').toString());
    final desc = TextEditingController(text: (row?['description'] ?? '').toString());
    String type = (row?['type'] ?? 'asset').toString();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(isEdit ? tr('تعديل حساب', 'Edit account') : tr('حساب جديد', 'New account'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            TextField(controller: code, decoration: InputDecoration(labelText: tr('الكود *', 'Code *'))),
            const SizedBox(height: 10),
            TextField(controller: nameAr, decoration: InputDecoration(labelText: tr('الاسم بالعربي', 'Arabic name'))),
            const SizedBox(height: 10),
            TextField(controller: nameEn, decoration: InputDecoration(labelText: tr('الاسم بالإنجليزي *', 'English name *'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: type,
              decoration: InputDecoration(labelText: tr('النوع', 'Type')),
              items: _accTypes.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
              onChanged: (v) => setS(() => type = v ?? type),
            ),
            const SizedBox(height: 10),
            TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('الوصف', 'Description'))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(
              onPressed: () async {
                if (code.text.trim().isEmpty || nameEn.text.trim().isEmpty) {
                  ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('الكود والاسم الإنجليزي مطلوبان', 'Code and English name required'))));
                  return;
                }
                final body = {
                  'code': code.text.trim(), 'nameEn': nameEn.text.trim(), 'nameAr': nameAr.text.trim(),
                  'type': type, 'description': desc.text.trim(),
                };
                try {
                  if (isEdit) { await Api.instance.put('/api/accounting/accounts/${row['_id']}', body); }
                  else { await Api.instance.post('/api/accounting/accounts', body); }
                  if (c.mounted) Navigator.pop(c);
                  _load();
                } catch (e) {
                  if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                }
              },
              child: Text(isEdit ? tr('حفظ', 'Save') : tr('إضافة', 'Add')),
            )),
          ]),
        ),
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return _fold('${r['code'] ?? ''} ${r['nameAr'] ?? ''} ${r['nameEn'] ?? ''}').contains(q);
    }).toList();

    return AppScaffold(
      title: Text(tr('شجرة الحسابات', 'Chart of Accounts')),
      actions: [
        IconButton(
          icon: const Icon(Icons.assessment_outlined),
          tooltip: tr('التقارير المالية', 'Financial reports'),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountingReportsScreen())),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add), label: Text(tr('حساب', 'Account')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالكود أو الاسم…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _accTypes.entries.map((e) {
                          final selected = _type == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _type = selected ? '' : e.key; _loading = true; }); _load(); },
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
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.account_tree_outlined, title: tr('لا توجد حسابات', 'No accounts'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final ty = _accTypes[r['type']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 10).clamp(0, 100),
                                  child: Pressable(
                                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LedgerScreen(account: r))),
                                    onLongPress: () => _rowMenu(r),
                                    child: AppCard(
                                    topAccent: ty.$3,
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                    child: Row(children: [
                                      Chip2((r['code'] ?? '').toString(), T.navy),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(tr((r['nameAr'] ?? r['nameEn'] ?? '').toString(), (r['nameEn'] ?? r['nameAr'] ?? '').toString()),
                                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                      ),
                                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                        Text(_money(r['balance']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                                        Text(tr(ty.$1, ty.$2), style: TextStyle(fontSize: 10, color: ty.$3, fontWeight: FontWeight.w700)),
                                      ]),
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

// ── دفتر اليومية ────────────────────────────────────────────────────────────
class JournalScreen extends StatefulWidget {
  const JournalScreen({super.key});
  @override
  State<JournalScreen> createState() => _JournalScreenState();
}

class _JournalScreenState extends State<JournalScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _accounts = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/accounting/journal'),
        if (_accounts.isEmpty) Api.instance.get('/api/accounting/accounts').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['entries'] ?? []);
        if (results.length > 1) _accounts = List<Map<String, dynamic>>.from(results[1]['accounts'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  String _accLabel(Map<String, dynamic> a) => '${a['code'] ?? ''} · ${tr((a['nameAr'] ?? a['nameEn'] ?? '').toString(), (a['nameEn'] ?? a['nameAr'] ?? '').toString())}';

  // إنشاء قيد متوازن — بندان فأكثر، ولا يُرسل إلا إذا تساوى المدين والدائن.
  Future<void> _createEntry() async {
    final memo = TextEditingController();
    DateTime date = DateTime.now();
    final lines = <({ValueNotifier<Map<String, dynamic>?> account, TextEditingController debit, TextEditingController credit})>[
      (account: ValueNotifier(null), debit: TextEditingController(), credit: TextEditingController()),
      (account: ValueNotifier(null), debit: TextEditingController(), credit: TextEditingController()),
    ];
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        num tot(String which) => lines.fold<num>(0, (s, l) => s + (num.tryParse((which == 'd' ? l.debit : l.credit).text) ?? 0));
        final balanced = tot('d') > 0 && (tot('d') - tot('c')).abs() < 0.001;
        Future<void> pickAccount(ValueNotifier<Map<String, dynamic>?> slot) async {
          String q = '';
          final a = await showModalBottomSheet<Map<String, dynamic>>(
            context: c,
            isScrollControlled: true,
            builder: (p) => StatefulBuilder(builder: (p, setP) {
              final fq = _fold(q.trim());
              final list = _accounts.where((x) => fq.isEmpty || _fold(_accLabel(x)).contains(fq)).toList();
              return SafeArea(
                child: SizedBox(
                  height: MediaQuery.of(p).size.height * 0.7,
                  child: Column(children: [
                    Padding(
                      padding: const EdgeInsets.all(14),
                      child: TextField(autofocus: true, onChanged: (v) => setP(() => q = v),
                          decoration: InputDecoration(hintText: tr('ابحث عن الحساب…', 'Search account…'), prefixIcon: const Icon(Icons.search))),
                    ),
                    Expanded(
                      child: ListView.builder(
                        itemCount: list.length,
                        itemBuilder: (p, i) => ListTile(
                          dense: true,
                          title: Text(_accLabel(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          onTap: () => Navigator.pop(p, list[i]),
                        ),
                      ),
                    ),
                  ]),
                ),
              );
            }),
          );
          if (a != null) setS(() => slot.value = a);
        }

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('قيد يومية جديد', 'New journal entry'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: TextField(controller: memo, decoration: InputDecoration(labelText: tr('البيان *', 'Memo *')))),
                  const SizedBox(width: 10),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final v = await showDatePicker(context: c, initialDate: date, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 30)));
                      if (v != null) setS(() => date = v);
                    },
                    icon: const Icon(Icons.event, size: 16),
                    label: Text('${date.day}/${date.month}', style: const TextStyle(fontSize: 12)),
                  ),
                ]),
                const SizedBox(height: 12),
                ...lines.asMap().entries.map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: e.value.account,
                      builder: (_, acc, __) => OutlinedButton(
                        style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 42)),
                        onPressed: () => pickAccount(e.value.account),
                        child: Text(acc == null ? tr('اختر الحساب…', 'Choose account…') : _accLabel(acc),
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(children: [
                      Expanded(child: TextField(controller: e.value.debit, keyboardType: TextInputType.number, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('مدين', 'Debit'), isDense: true))),
                      const SizedBox(width: 8),
                      Expanded(child: TextField(controller: e.value.credit, keyboardType: TextInputType.number, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('دائن', 'Credit'), isDense: true))),
                      IconButton(
                        icon: const Icon(Icons.remove_circle_outline, size: 19, color: T.danger),
                        onPressed: lines.length <= 2 ? null : () => setS(() => lines.removeAt(e.key)),
                      ),
                    ]),
                  ]),
                )),
                TextButton.icon(
                  onPressed: () => setS(() => lines.add((account: ValueNotifier(null), debit: TextEditingController(), credit: TextEditingController()))),
                  icon: const Icon(Icons.add, size: 17),
                  label: Text(tr('إضافة بند', 'Add line')),
                ),
                const SizedBox(height: 6),
                Row(children: [
                  Chip2('${tr('مدين', 'Debit')}: ${_money(tot('d'))}', T.navy),
                  const SizedBox(width: 6),
                  Chip2('${tr('دائن', 'Credit')}: ${_money(tot('c'))}', T.violet),
                  const Spacer(),
                  Chip2(balanced ? tr('متوازن ✓', 'Balanced ✓') : tr('غير متوازن', 'Unbalanced'), balanced ? T.success : T.danger),
                ]),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: !balanced || memo.text.trim().isEmpty && false
                        ? null
                        : () async {
                            if (memo.text.trim().isEmpty) return;
                            final body = {
                              'date': '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
                              'memo': memo.text.trim(),
                              'lines': lines
                                  .where((l) => l.account.value != null)
                                  .map((l) => {
                                        'account': l.account.value!['_id'],
                                        'debit': num.tryParse(l.debit.text) ?? 0,
                                        'credit': num.tryParse(l.credit.text) ?? 0,
                                      })
                                  .toList(),
                            };
                            try {
                              await Api.instance.post('/api/accounting/journal', body);
                              if (c.mounted) Navigator.pop(c);
                              _load();
                            } catch (e) {
                              if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                            }
                          },
                    child: Text(tr('تسجيل القيد', 'Post entry')),
                  ),
                ),
              ]),
            ),
          ),
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return _fold('${r['entryNumber'] ?? ''} ${r['memo'] ?? ''}').contains(q);
    }).toList();

    return AppScaffold(
      title: Text(tr('دفتر اليومية', 'Journal')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createEntry,
        icon: const Icon(Icons.add),
        label: Text(tr('قيد', 'Entry')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالرقم أو البيان…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.menu_book_outlined, title: tr('لا توجد قيود', 'No entries'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final at = DateTime.tryParse((r['date'] ?? '').toString())?.toLocal();
                                return FadeSlideIn(
                                  delayMs: (i * 10).clamp(0, 100),
                                  child: AppCard(
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                    child: Row(children: [
                                      Expanded(
                                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Text('${r['entryNumber'] ?? ''} — ${r['memo'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), maxLines: 2, overflow: TextOverflow.ellipsis),
                                          Text(
                                            '${at != null ? '${at.day}/${at.month}/${at.year}' : ''}'
                                            '${r['source'] is Map && (r['source']['type'] ?? '').toString().isNotEmpty ? ' · ${r['source']['type']}' : ''}',
                                            style: const TextStyle(fontSize: 11, color: T.inkSoft),
                                          ),
                                        ]),
                                      ),
                                      Chip2('${_money(r['totalDebit'])} ${tr('ر.س', 'SAR')}', T.navy),
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

// ── التقارير المالية ────────────────────────────────────────────────────────
// ميزان المراجعة · الأرباح والخسائر · الذمم المدينة · الذمم الدائنة (تبويبات).
class AccountingReportsScreen extends StatelessWidget {
  const AccountingReportsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: AppScaffold(
        title: Text(tr('التقارير المالية', 'Financial Reports')),
        appBarBottom: TabBar(
          isScrollable: true,
          indicatorColor: T.orange,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: [
            Tab(text: tr('ميزان المراجعة', 'Trial Balance')),
            Tab(text: tr('الأرباح والخسائر', 'P&L')),
            Tab(text: tr('ذمم مدينة', 'Receivables')),
            Tab(text: tr('ذمم دائنة', 'Payables')),
          ],
        ),
        body: const TabBarView(children: [
          _ReportView(endpoint: '/api/accounting/trial-balance', kind: 'trial'),
          _ReportView(endpoint: '/api/accounting/profit-loss', kind: 'pl'),
          _ReportView(endpoint: '/api/accounting/receivables', kind: 'ar'),
          _ReportView(endpoint: '/api/accounting/payables', kind: 'ap'),
        ]),
      ),
    );
  }
}

class _ReportView extends StatefulWidget {
  final String endpoint;
  final String kind; // trial | pl | ar | ap
  const _ReportView({required this.endpoint, required this.kind});
  @override
  State<_ReportView> createState() => _ReportViewState();
}

class _ReportViewState extends State<_ReportView> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(widget.endpoint);
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _accName(dynamic acc) {
    if (acc is Map) return tr((acc['nameAr'] ?? acc['nameEn'] ?? '').toString(), (acc['nameEn'] ?? acc['nameAr'] ?? '').toString());
    return (acc ?? '').toString();
  }

  Widget _line(String label, dynamic value, {Color? color, bool bold = false, String? sub}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 13, fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
            if (sub != null) Text(sub, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
          ])),
          Text(_money(value), style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: color ?? T.ink)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 200)]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    final d = _d ?? {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: _content(d)),
    );
  }

  List<Widget> _content(Map<String, dynamic> d) {
    switch (widget.kind) {
      case 'trial':
        final rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        return [
          AppCard(child: Row(children: [
            Expanded(child: _kv(tr('إجمالي المدين', 'Total debit'), _money(d['totalDebit']))),
            Expanded(child: _kv(tr('إجمالي الدائن', 'Total credit'), _money(d['totalCredit']))),
          ])),
          const SizedBox(height: 6),
          Align(alignment: AlignmentDirectional.centerStart, child: Chip2(d['balanced'] == true ? tr('متوازن', 'Balanced') : tr('غير متوازن', 'Unbalanced'), d['balanced'] == true ? T.success : T.danger)),
          const SizedBox(height: 10),
          if (rows.isEmpty) EmptyState(icon: Icons.balance_outlined, title: tr('لا توجد بيانات', 'No data')),
          ...rows.map((r) => AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(children: [
              Chip2((r['account'] is Map ? r['account']['code'] : '').toString(), T.navy),
              const SizedBox(width: 8),
              Expanded(child: Text(_accName(r['account']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
              if ((r['debit'] ?? 0) != 0) Text('${_money(r['debit'])} ${tr('م', 'Dr')}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.info)),
              if ((r['credit'] ?? 0) != 0) Text('${_money(r['credit'])} ${tr('د', 'Cr')}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.orange)),
            ]),
          )),
        ];
      case 'pl':
        final rev = List<Map<String, dynamic>>.from(d['revenue'] ?? []);
        final exp = List<Map<String, dynamic>>.from(d['expenses'] ?? []);
        return [
          AppCard(topAccent: (d['netIncome'] ?? 0) >= 0 ? T.success : T.danger, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _line(tr('صافي الدخل', 'Net income'), d['netIncome'], bold: true, color: (d['netIncome'] ?? 0) >= 0 ? T.success : T.danger),
          ])),
          const SizedBox(height: 10),
          Text(tr('الإيرادات', 'Revenue'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
          ...rev.map((r) => _line(_accName(r['account']), r['amount'], color: T.success)),
          _line(tr('إجمالي الإيرادات', 'Total revenue'), d['totalRevenue'], bold: true, color: T.success),
          const Divider(height: 22),
          Text(tr('المصروفات', 'Expenses'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange)),
          ...exp.map((r) => _line(_accName(r['account']), r['amount'], color: T.orange)),
          _line(tr('إجمالي المصروفات', 'Total expenses'), d['totalExpenses'], bold: true, color: T.orange),
        ];
      default: // ar / ap
        final rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        final b = d['buckets'] is Map ? Map<String, dynamic>.from(d['buckets']) : {};
        final isAr = widget.kind == 'ar';
        return [
          AppCard(topAccent: T.navy, child: _line(tr('الإجمالي المستحق', 'Total outstanding'), d['total'], bold: true, color: T.navy)),
          const SizedBox(height: 8),
          AppCard(child: Wrap(spacing: 8, runSpacing: 8, children: [
            Chip2('${tr('جاري', 'Current')}: ${_money(b['current'])}', T.success),
            Chip2('1-30: ${_money(b['d30'])}', T.info),
            Chip2('31-60: ${_money(b['d60'])}', T.warn),
            Chip2('61-90: ${_money(b['d90'])}', T.orange),
            Chip2('90+: ${_money(b['over90'])}', T.danger),
          ])),
          const SizedBox(height: 10),
          if (rows.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد مستحقات', 'Nothing outstanding')),
          ...rows.map((r) {
            final party = isAr ? r['customer'] : r['vendor'];
            final pname = party is Map ? (party['companyName'] ?? party['name'] ?? '').toString() : '';
            final days = (r['daysOverdue'] ?? 0) as num;
            return AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(pname.isEmpty ? (r['invoice'] ?? r['bill'] ?? '—').toString() : pname, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                  Text('${isAr ? (r['invoice'] ?? '') : (r['bill'] ?? '')} · ${days > 0 ? '${tr('متأخر', 'overdue')} ${days.toInt()} ${tr('يوم', 'd')}' : tr('غير متأخر', 'current')}',
                      style: TextStyle(fontSize: 11, color: days > 0 ? T.danger : T.inkSoft)),
                ])),
                Text(_money(r['balance']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
              ]),
            );
          }),
        ];
    }
  }

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
        Text(v, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
      ]);
}

// ── كشف حساب (Ledger) ───────────────────────────────────────────────────────
// حركات حساب واحد مع الرصيد الجاري. /api/accounting/ledger/:id
class LedgerScreen extends StatefulWidget {
  final Map<String, dynamic> account;
  const LedgerScreen({super.key, required this.account});
  @override
  State<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends State<LedgerScreen> {
  List<Map<String, dynamic>> _rows = [];
  num _closing = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/accounting/ledger/${widget.account['_id']}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
        _closing = (d['closingBalance'] ?? 0) as num;
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _d(dynamic v) {
    final x = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return x == null ? '—' : '${x.day}/${x.month}/${x.year}';
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    final name = tr((a['nameAr'] ?? a['nameEn'] ?? '').toString(), (a['nameEn'] ?? a['nameAr'] ?? '').toString());
    return AppScaffold(
      title: Text('${a['code'] ?? ''} · $name'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      topAccent: T.navy,
                      child: Row(children: [
                        Expanded(child: Text(tr('الرصيد الختامي', 'Closing balance'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                        Text(_money(_closing), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    if (_rows.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد حركات', 'No transactions')),
                    ..._rows.map((r) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text('${r['entryNumber'] ?? ''} · ${_d(r['date'])}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                                Text('${tr('الرصيد', 'Bal')}: ${_money(r['balance'])}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.navy)),
                              ]),
                              if ((r['memo'] ?? '').toString().isNotEmpty)
                                Padding(padding: const EdgeInsets.only(top: 2), child: Text(r['memo'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                              const SizedBox(height: 4),
                              Row(children: [
                                if ((r['debit'] ?? 0) != 0) Chip2('${tr('مدين', 'Dr')} ${_money(r['debit'])}', T.info),
                                if ((r['credit'] ?? 0) != 0) Chip2('${tr('دائن', 'Cr')} ${_money(r['credit'])}', T.orange),
                              ]),
                            ]),
                          ),
                        )),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
