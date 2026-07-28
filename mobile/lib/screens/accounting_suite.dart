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

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return _fold('${r['code'] ?? ''} ${r['nameAr'] ?? ''} ${r['nameEn'] ?? ''}').contains(q);
    }).toList();

    return AppScaffold(
      title: Text(tr('شجرة الحسابات', 'Chart of Accounts')),
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
