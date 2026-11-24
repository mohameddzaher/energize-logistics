import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Customers archive and vendors archive: mirrors web /system/operations/customers-archive and /vendors-archive.
/// A customer deleted from any section lands here with every section it was in; restore brings it back everywhere, delete here is permanent.
class ArchiveScreen extends StatefulWidget {
  final bool vendors;
  const ArchiveScreen({super.key, this.vendors = false});
  @override
  State<ArchiveScreen> createState() => _ArchiveScreenState();
}

const _purgeRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'business_consultant', 'transition_account', 'backup_account', 'cfo', 'moderator', 'operations_manager', 'operations_team_leader', 'vendors_manager', 'vendors_team_leader', 'collections_manager', 'collections_team_leader'];
const _activity = {
  'orders': ('أوامر نقل', 'transport orders'),
  'loads': ('حمولات أسطول', 'fleet loads'),
  'clearances': ('معاملات تخليص', 'clearances'),
  'invoices': ('فواتير تحصيل', 'invoices'),
};

class _ArchiveScreenState extends State<ArchiveScreen> {
  List<Map<String, dynamic>>? _rows;
  String? _error;
  String _q = '';
  final _searchCtl = TextEditingController();
  String _busy = '';
  late final void Function() _onLive;

  String get _base => widget.vendors ? '/api/vendor-archive' : '/api/customer-archive';
  String get _event => widget.vendors ? 'vendors:archive' : 'customers:changed';

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on(_event, _onLive);
  }

  @override
  void dispose() {
    Live.instance.off(_event, _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(_base);
      if (mounted) setState(() { _rows = [for (final x in ((d as Map)['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : e.toString());
    }
  }

  String _qs(Map r) => !widget.vendors && r['master'] == false && r['reg'] != null ? '?reg=${r['reg']}' : '';
  String _fmt(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}');
    if (d == null) return '—';
    final l = d.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(l.day)}/${two(l.month)}/${l.year} ${two(l.hour)}:${two(l.minute)}';
  }
  List<String> _had(Map r) => [
        for (final e in ((r['activity'] as Map?) ?? const {}).entries) '${e.value} ${tr((_activity[e.key] ?? ('${e.key}', '${e.key}')).$1, (_activity[e.key] ?? ('${e.key}', '${e.key}')).$2)}',
        if (widget.vendors && (r['orders'] ?? 0) > 0) '${r['orders']} ${tr('أوامر نقل', 'transport orders')}',
      ];

  Future<void> _restore(Map r) async {
    setState(() => _busy = '${r['_id']}');
    try {
      await Api.instance.post('$_base/${r['_id']}/restore${_qs(r)}', {});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('استُعيد «${r['name']}» في كلّ الأقسام', 'Restored everywhere'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _purge(Map r) async {
    final had = _had(r);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف نهائي', 'Delete for good')),
        content: Text(tr('حذف «${r['name']}» نهائيًّا من النظام؟ لا يمكن التراجع.${had.isNotEmpty ? ' له ${had.join('، ')} تبقى بأسمائها دون ربطٍ به.' : ''}',
            'Delete “${r['name']}” for good? This cannot be undone.${had.isNotEmpty ? ' Its ${had.join(', ')} keep their names without a link.' : ''}')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف نهائي', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = '${r['_id']}');
    try {
      await Api.instance.delete('$_base/${r['_id']}${_qs(r)}');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُذف نهائيًّا', 'Deleted for good'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
    if (mounted) setState(() => _busy = '');
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final f = _q.trim().toLowerCase();
    final shown = rows == null ? const <Map<String, dynamic>>[] : rows.where((r) => f.isEmpty || '${r['name']} ${r['code'] ?? ''} ${r['phone'] ?? ''} ${r['archivedByName'] ?? ''}'.toLowerCase().contains(f)).toList();
    final canPurge = _purgeRoles.contains(context.watch<AuthProvider>().role);
    final title = widget.vendors ? tr('أرشيف الموردين', 'Vendors archive') : tr('أرشيف العملاء', 'Customers archive');
    return AppScaffold(
      title: Text(title),
      actions: [
        ExportButton(
          fileName: widget.vendors ? 'vendors-archive' : 'customers-archive',
          sheetName: title,
          rows: () => shown,
          columns: [
            ExportCol('الاسم', 'Name', (r) => r['name'] ?? ''),
            ExportCol('الكود', 'Code', (r) => r['code'] ?? ''),
            ExportCol('الجوال', 'Phone', (r) => r['phone'] ?? ''),
            if (!widget.vendors) ExportCol('الأقسام', 'Sections', (r) => [for (final s in (r['sections'] as List? ?? const [])) '${(s as Map)['ar']}'].join('، ')),
            if (!widget.vendors) ExportCol('حُذف من', 'Deleted from', (r) => r['archivedFromAr'] ?? ''),
            ExportCol('المعاملات', 'Activity', (r) => _had(r).join('، ')),
            ExportCol('تاريخ الحذف', 'Deleted on', (r) => _fmt(r['archivedAt'])),
            ExportCol('حذفه', 'Deleted by', (r) => r['archivedByName'] ?? ''),
          ],
        ),
      ],
      body: rows == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                Text(widget.vendors
                    ? tr('كلّ مورّدٍ يُحذف ينتقل إلى هنا. الاستعادة تعيده، والحذف من هنا نهائي.', 'Deleted vendors land here. Restore brings them back; deleting here is permanent.')
                    : tr('كلّ عميلٍ يُحذف من أيّ قسمٍ ينتقل إلى هنا ويختفي من كلّ القوائم. الاستعادة تعيده إلى كلّ الأقسام، والحذف من هنا نهائي.', 'Customers deleted anywhere land here. Restoring brings them back everywhere; deleting here is permanent.'),
                    style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: StatCard(label: tr('في الأرشيف', 'Archived'), value: rows.length, color: T.inkSoft, icon: Icons.archive_outlined)),
                  const SizedBox(width: 8),
                  Expanded(child: StatCard(label: tr('لهم معاملات', 'With activity'), value: rows.where((r) => _had(r).isNotEmpty).length, color: T.warn, icon: Icons.receipt_long_outlined)),
                ]),
                const SizedBox(height: 10),
                SearchField(controller: _searchCtl, dense: true, onChanged: (v) => setState(() => _q = v), hint: tr('الاسم أو الكود أو الجوال', 'Name, code or phone')),
                const SizedBox(height: 10),
                if (shown.isEmpty) EmptyState(icon: Icons.archive_outlined, title: rows.isEmpty ? tr('الأرشيف فارغ', 'The archive is empty') : tr('لا نتائج', 'No matches')),
                for (final r in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        if ('${r['code'] ?? ''}${r['phone'] ?? ''}'.isNotEmpty)
                          Text([r['code'], r['phone']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        const SizedBox(height: 6),
                        if (!widget.vendors)
                          Wrap(spacing: 4, runSpacing: 4, children: [
                            for (final s in (r['sections'] as List? ?? const [])) Chip2('${(s as Map)['ar']}', T.inkSoft),
                          ]),
                        if (_had(r).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_had(r).join(' · '), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.warn))),
                        const SizedBox(height: 4),
                        Text([_fmt(r['archivedAt']), r['archivedByName'], if ('${r['archivedFromAr'] ?? ''}'.isNotEmpty) tr('من ${r['archivedFromAr']}', 'from ${r['archivedFromAr']}')].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(child: FilledButton.icon(
                            onPressed: _busy == '${r['_id']}' ? null : () => _restore(r),
                            style: FilledButton.styleFrom(backgroundColor: T.success),
                            icon: const Icon(Icons.restore, size: 18), label: Text(tr('استعادة', 'Restore')),
                          )),
                          if (canPurge) ...[
                            const SizedBox(width: 8),
                            Expanded(child: OutlinedButton.icon(
                              onPressed: _busy == '${r['_id']}' ? null : () => _purge(r),
                              style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                              icon: const Icon(Icons.delete_forever_outlined, size: 18), label: Text(tr('حذف نهائي', 'Delete for good')),
                            )),
                          ],
                        ]),
                      ]),
                    ),
                  ),
              ]),
            ),
    );
  }
}
