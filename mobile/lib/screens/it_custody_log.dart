import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// IT — custody movement log: every receipt, handover, transfer, return, damage
/// and sale, with who recorded it. Mirrors web /system/it/custody-log.
const _actionLabels = {
  'added_to_store': ('أُضيف إلى المستودع', 'Added to store'),
  'assigned': ('سُلّم إلى موظف', 'Handed to employee'),
  'transferred': ('نُقل إلى موظف آخر', 'Transferred'),
  'returned': ('أُعيد إلى المستودع', 'Returned to store'),
  'damaged': ('أُبلغ عن تلفه', 'Reported damaged'),
  'lost': ('أُبلغ عن فقده', 'Reported lost'),
  'retired': ('سُجّل كتالف', 'Recorded faulty'),
  'updated': ('عُدّلت بياناته', 'Details updated'),
  'sold': ('بيع', 'Sold'),
  'sale_returned': ('أُرجع المبيع إلى المخزن', 'Sale returned to store'),
};
String _label(String k) { final l = _actionLabels[k]; return l == null ? k : tr(l.$1, l.$2); }
Color _tone(String k) => switch (k) {
      'assigned' => T.info,
      'transferred' => T.violet,
      'returned' => T.success,
      'damaged' || 'lost' || 'retired' => T.danger,
      'sold' || 'sale_returned' => T.violet,
      _ => T.inkFaint,
    };
String _dmy(String d) => d.length >= 10 ? '${d.substring(8, 10)}/${d.substring(5, 7)}/${d.substring(0, 4)}' : '—';
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class ItCustodyLogScreen extends StatefulWidget {
  const ItCustodyLogScreen({super.key});
  @override
  State<ItCustodyLogScreen> createState() => _ItCustodyLogScreenState();
}

class _ItCustodyLogScreenState extends State<ItCustodyLogScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<String> _actions = [];
  List<Map<String, dynamic>> _doers = [];
  bool _loading = true;
  String _q = '';
  String _action = '';
  String _by = '';
  DateTimeRange? _range;
  final _searchCtl = TextEditingController();
  int _seq = 0;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('hr:asset', _onLive);
    Live.instance.on('it:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:asset', _onLive);
    Live.instance.off('it:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final p = <String, String>{
      if (_action.isNotEmpty) 'action': _action,
      if (_by.isNotEmpty) 'by': _by,
      if (_range != null) 'from': _ymd(_range!.start),
      if (_range != null) 'to': _ymd(_range!.end),
    };
    final qs = p.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
    try {
      final d = await Api.instance.get('/api/it/custody/events${qs.isEmpty ? '' : '?$qs'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d as Map)['events'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _actions = List<String>.from((d['actions'] as List? ?? const []).map((e) => '$e'));
        _doers = List<Map<String, dynamic>>.from((d['doers'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fold(String v) => v.toLowerCase().replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ة', 'ه').replaceAll('ى', 'ي');

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final list = q.isEmpty ? _rows : _rows.where((e) {
      String n(dynamic m) => m is Map ? '${m['name'] ?? ''} ${m['employeeNumber'] ?? ''} ${m['serialNumber'] ?? ''}' : '';
      return _fold('${n(e['asset'])} ${n(e['from'])} ${n(e['to'])} ${e['byName'] ?? ''} ${e['notes'] ?? ''} ${e['buyerName'] ?? ''}').contains(q);
    }).toList();
    return AppScaffold(
      title: Text(tr('سجل حركة العهد', 'Custody log')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: SearchField(controller: _searchCtl, dense: true, onChanged: (v) => setState(() => _q = v), hint: tr('الجهاز أو الرقم التسلسلي أو الاسم', 'Item, serial or name')),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
          child: Row(children: [
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: _action, isExpanded: true,
              decoration: InputDecoration(labelText: tr('الحركة', 'Movement'), isDense: true),
              items: [DropdownMenuItem(value: '', child: Text(tr('كل الحركات', 'All'))), ..._actions.map((a) => DropdownMenuItem(value: a, child: Text(_label(a), overflow: TextOverflow.ellipsis)))],
              onChanged: (v) { setState(() => _action = v ?? ''); _load(); },
            )),
            const SizedBox(width: 8),
            Expanded(child: DropdownButtonFormField<String>(
              initialValue: _by, isExpanded: true,
              decoration: InputDecoration(labelText: tr('سجّلها', 'Recorded by'), isDense: true),
              items: [DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))), ..._doers.map((d) => DropdownMenuItem(value: '${d['_id']}', child: Text('${d['name']}', overflow: TextOverflow.ellipsis)))],
              onChanged: (v) { setState(() => _by = v ?? ''); _load(); },
            )),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 4),
          child: Row(children: [
            Expanded(child: OutlinedButton.icon(
              icon: const Icon(Icons.date_range_outlined, size: 18),
              label: Text(_range == null ? tr('كل التواريخ', 'All dates') : '${_dmy(_ymd(_range!.start))} → ${_dmy(_ymd(_range!.end))}'),
              onPressed: () async {
                final r = await showDateRangePicker(context: context, firstDate: DateTime(2024), lastDate: DateTime.now().add(const Duration(days: 1)), initialDateRange: _range);
                if (r != null) { setState(() => _range = r); _load(); }
              },
            )),
            if (_range != null) IconButton(icon: const Icon(Icons.close), onPressed: () { setState(() => _range = null); _load(); }),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Align(alignment: AlignmentDirectional.centerStart, child: Text('${list.length} ${tr('حركة', 'movements')}', style: const TextStyle(color: T.inkSoft, fontSize: 12))),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: list.isEmpty
                      ? ListView(children: [EmptyState(icon: Icons.history, title: tr('لا حركات', 'No movements'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: list.length > 800 ? 800 : list.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final e = list[i];
                            final a = e['action'].toString();
                            final asset = e['asset'] is Map ? e['asset'] as Map : const {};
                            final from = e['from'] is Map ? '${(e['from'] as Map)['name']}' : (a == 'assigned' ? tr('المستودع', 'Store') : '—');
                            final to = e['to'] is Map ? '${(e['to'] as Map)['name']}' : ('${e['buyerName'] ?? ''}'.isNotEmpty ? '${e['buyerName']}' : (a == 'returned' ? tr('المستودع', 'Store') : '—'));
                            return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Chip2(_label(a), _tone(a)),
                                const Spacer(),
                                Text(_dmy('${e['date'] ?? ''}'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                              ]),
                              const SizedBox(height: 6),
                              Text('${asset['name'] ?? '—'}${'${asset['serialNumber'] ?? ''}'.isEmpty ? '' : ' · ${asset['serialNumber']}'}', style: const TextStyle(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 4),
                              Text('${tr('من', 'From')}: $from  ←  ${tr('إلى', 'To')}: $to', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                              const SizedBox(height: 4),
                              Text('${tr('سجّلها', 'Recorded by')}: ${e['byName'] ?? '—'}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.navy)),
                              if ('${e['notes'] ?? ''}'.isNotEmpty) Text('${e['notes']}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                            ]));
                          },
                        ),
                ),
        ),
      ]),
    );
  }
}
