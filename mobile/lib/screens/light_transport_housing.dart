import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'light_transport_list.dart' show canEditLtUser;
import 'reference_data.dart' show LookupValuesScreen;

/// Personnel section settings, matching `/system/b2c/settings`: housing (add, edit, delete and its rooms) and the dropdown lists. "App accounts" has its own page in the menu.
/// Rooms rather than one number: "how many employees does housing take" is not one question, since a riders' room holds eight and a supervisors' room three. Capacity is the sum of its rooms, each with its type.
/// Occupancy is computed from employees, not typed: a hand-updated number becomes unbelievable within weeks.
class LightTransportHousingScreen extends StatefulWidget {
  const LightTransportHousingScreen({super.key});
  @override
  State<LightTransportHousingScreen> createState() => _LightTransportHousingScreenState();
}

String _s(Map<String, dynamic>? m, String k) => (m?[k] ?? '').toString().trim();
int _i(Map<String, dynamic>? m, String k) => int.tryParse((m?[k] ?? 0).toString()) ?? 0;

const _kindAr = {'rep': 'مناديب', 'admin': 'إداريون', 'any': 'للجميع'};
const _kindEn = {'rep': 'Reps', 'admin': 'Admin', 'any': 'Anyone'};

class _LightTransportHousingScreenState extends State<LightTransportHousingScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;
  String _tab = 'housing';
  List<Map<String, dynamic>> _types = [];

  @override
  void initState() {
    super.initState();
    _load();
    _loadTypes();
    Live.instance.on('lt:*', _onLive);
  }

  void _onLive() { if (mounted) _load(); }

  @override
  void dispose() { Live.instance.off('lt:*', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/light-transport/housing') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _rows = [for (final x in (d['housing'] as List?) ?? const []) (x as Map).cast<String, dynamic>()];
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  // Dropdown lists: the b2c module lists plus the section's JP task list (as on the web).
  Future<void> _loadTypes() async {
    try {
      final d = await Api.instance.get('/api/lookups/types');
      if (!mounted) return;
      setState(() => _types = [
            for (final t in List<Map<String, dynamic>>.from(d['types'] ?? []))
              if (t['module'] == 'b2c' || t['type'] == 'jp_task_b2c') t,
          ]);
    } catch (_) {}
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _remove(Map<String, dynamic> h) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(tr('يُحذف سكن «${_s(h, 'name')}»؟', 'Delete housing "${_s(h, 'name')}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/light-transport/housing/${h['_id']}');
      _load();
    } catch (e) {
      _say(e is ApiException ? e.message : tr('تعذّر الحذف', 'Could not delete'));
    }
  }

  Future<void> _edit([Map<String, dynamic>? h]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (_) => _HousingSheet(housing: h),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = canEditLtUser(context.read<AuthProvider>());
    return AppScaffold(
      title: Text(tr('إعدادات قسم الأفراد', 'B2C settings')),
      floatingActionButton: canEdit && _tab == 'housing'
          ? FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add_home_outlined), label: Text(tr('إضافة سكن', 'Add housing')))
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'housing', icon: const Icon(Icons.home_work_outlined, size: 16), label: Text(tr('السكن', 'Housing'))),
              ButtonSegment(value: 'lists', icon: const Icon(Icons.sell_outlined, size: 16), label: Text(tr('القوائم المنسدلة', 'Dropdown lists'))),
            ],
            selected: {_tab},
            onSelectionChanged: (s) => setState(() => _tab = s.first),
          ),
        ),
        Expanded(child: _tab == 'lists' ? _lists() : _housing(canEdit)),
      ]),
    );
  }

  Widget _lists() {
    String name(Map<String, dynamic> t) => (Lang.instance.ar ? t['nameAr'] : t['nameEn'])?.toString() ?? '${t['type']}';
    if (_types.isEmpty) return ListView(children: [const SizedBox(height: 60), EmptyState(icon: Icons.list_alt_outlined, title: tr('لا قوائم', 'No lists'))]);
    return ListView(padding: const EdgeInsets.all(14), children: [
      for (final t in _types)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Pressable(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                type: '${t['type']}', title: name(t), canManage: t['canManage'] == true))),
            child: AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Row(children: [
                const Icon(Icons.list_alt_outlined, color: T.navy, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(name(t), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                if (t['canManage'] != true) const Icon(Icons.lock_outline, size: 15, color: T.inkFaint),
                Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
              ]),
            ),
          ),
        ),
    ]);
  }

  Widget _housing(bool canEdit) {
    if (_loading) return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)]);
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    final totalCap = _rows.fold<int>(0, (n, r) => n + _i(r, 'totalCapacity'));
    final totalOcc = _rows.fold<int>(0, (n, r) => n + _i(r, 'occupied'));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(14, 8, 14, 90), children: [
        Text(
          tr('سعةُ السكن مجموعُ غرفه. وكلُّ غرفةٍ لها نوعٌ: للمناديب أو للإداريين أو للجميع — فلا يُسكَن مشرفٌ في غرفةِ مناديب، ولا يُتجاوَز عددُ الغرفة. والإشغالُ محسوبٌ من الموظفين لا مكتوبًا باليد.',
             'A housing’s capacity is the sum of its rooms. Each room is for reps, for admin, or for anyone. Occupancy is counted from the employees, not typed in.'),
          style: const TextStyle(fontSize: 11.5, color: T.inkFaint, height: 1.5),
        ),
        const SizedBox(height: 8),
        if (_rows.isEmpty) EmptyState(icon: Icons.home_work_outlined, title: tr('لا سكن مسجَّل بعد.', 'No housing yet.'))
        else ...[
          AppCard(
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontSize: 12, color: Colors.black54)),
                Text('$totalOcc / $totalCap', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              ])),
              Chip2(tr('متاح ${totalCap - totalOcc}', '${totalCap - totalOcc} free'), totalCap - totalOcc > 0 ? T.success : T.danger),
            ]),
          ),
          const SizedBox(height: 10),
          for (final h in _rows) _card(h, canEdit),
        ],
      ]),
    );
  }

  Widget _card(Map<String, dynamic> h, bool canEdit) {
    final cap = _i(h, 'totalCapacity');
    final occ = _i(h, 'occupied');
    final full = cap > 0 && occ >= cap;
    final rooms = [for (final x in (h['rooms'] as List?) ?? const []) (x as Map).cast<String, dynamic>()];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Opacity(
        opacity: h['isActive'] == false ? 0.6 : 1,
        child: AppCard(
          topAccent: full ? T.danger : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.home_work_outlined, size: 18, color: Colors.black38),
              const SizedBox(width: 6),
              Expanded(child: Text(_s(h, 'name'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
              if (h['isActive'] == false) Chip2(tr('معطَّل', 'inactive'), T.inkFaint),
              if (canEdit) ...[
                IconButton(visualDensity: VisualDensity.compact, tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 19), onPressed: () => _edit(h)),
                IconButton(visualDensity: VisualDensity.compact, tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 19, color: T.danger), onPressed: () => _remove(h)),
              ],
            ]),
            Text([_s(h, 'cityAr'), _s(h, 'addressAr')].where((x) => x.isNotEmpty).join(' · ').ifEmpty('—'),
                style: const TextStyle(fontSize: 11.5, color: Colors.black45)),
            const SizedBox(height: 8),
            Row(children: [
              Text('$occ', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(width: 4),
              Text(tr('من $cap', 'of $cap'), style: const TextStyle(fontSize: 12.5, color: Colors.black38)),
              const Spacer(),
              Chip2(full ? tr('مكتمل', 'Full') : tr('باقي ${_i(h, 'free')}', '${_i(h, 'free')} free'), full ? T.danger : T.success),
            ]),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: cap > 0 ? (occ / cap).clamp(0, 1).toDouble() : 0, minHeight: 7, backgroundColor: T.line,
                valueColor: AlwaysStoppedAnimation(full ? T.danger : T.orange),
              ),
            ),
            if (rooms.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final r in rooms)
                Padding(
                  padding: const EdgeInsets.only(bottom: 5),
                  child: Row(children: [
                    Expanded(child: Text(_s(r, 'name'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                    Chip2(tr(_kindAr[_s(r, 'kind')] ?? _s(r, 'kind'), _kindEn[_s(r, 'kind')] ?? _s(r, 'kind')),
                        _s(r, 'kind') == 'rep' ? T.info : _s(r, 'kind') == 'admin' ? T.violet : T.inkFaint),
                    const SizedBox(width: 6),
                    Text('${_i(r, 'occupied')}/${_i(r, 'capacity')}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800,
                        color: _i(r, 'capacity') > 0 && _i(r, 'occupied') >= _i(r, 'capacity') ? T.danger : Colors.black87)),
                  ]),
                ),
            ] else
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(tr('لا غرف مسجَّلة — السعة المكتوبة تُستعمل حتى تُسجَّل الغرف.', 'No rooms yet — the declared capacity is used until rooms are added.'),
                    style: const TextStyle(fontSize: 11.5, color: Colors.black38)),
              ),
          ]),
        ),
      ),
    );
  }
}

extension on String {
  String ifEmpty(String o) => isEmpty ? o : this;
}

/// A room row in the form; its two controllers live with it.
class _Room {
  final name = TextEditingController();
  final cap = TextEditingController();
  String kind = 'any';
  int occupied = 0;
  _Room([Map<String, dynamic>? r]) {
    name.text = _s(r, 'name');
    cap.text = '${_i(r, 'capacity')}';
    kind = _s(r, 'kind').isEmpty ? 'any' : _s(r, 'kind');
    occupied = _i(r, 'occupied');
  }
  void dispose() { name.dispose(); cap.dispose(); }
}

class _HousingSheet extends StatefulWidget {
  final Map<String, dynamic>? housing;
  const _HousingSheet({this.housing});
  @override
  State<_HousingSheet> createState() => _HousingSheetState();
}

class _HousingSheetState extends State<_HousingSheet> {
  Map<String, dynamic>? get h => widget.housing;
  late final _name = TextEditingController(text: _s(h, 'name'));
  late final _city = TextEditingController(text: _s(h, 'cityAr'));
  late final _address = TextEditingController(text: _s(h, 'addressAr'));
  late final _declared = TextEditingController(text: '${_i(h, 'declaredCapacity')}');
  late final _notes = TextEditingController(text: _s(h, 'notes'));
  late final List<_Room> _rooms = [for (final r in (h?['rooms'] as List?) ?? const []) _Room((r as Map).cast<String, dynamic>())];
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_name, _city, _address, _declared, _notes]) { c.dispose(); }
    for (final r in _rooms) { r.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اسم السكن مطلوب', 'Housing name is required'))));
      return;
    }
    setState(() => _saving = true);
    final body = {
      'name': _name.text.trim(), 'cityAr': _city.text.trim(), 'addressAr': _address.text.trim(),
      'declaredCapacity': int.tryParse(_declared.text.trim()) ?? 0, 'notes': _notes.text.trim(),
      'rooms': [for (final r in _rooms) {'name': r.name.text.trim(), 'kind': r.kind, 'capacity': int.tryParse(r.cap.text.trim()) ?? 0}],
    };
    try {
      if (h?['_id'] != null) {
        await Api.instance.put('/api/light-transport/housing/${h!['_id']}', body);
      } else {
        await Api.instance.post('/api/light-transport/housing', body);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ', 'Saved'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'))));
    }
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    final roomsTotal = _rooms.fold<int>(0, (n, r) => n + (int.tryParse(r.cap.text.trim()) ?? 0));
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(h == null ? tr('إضافة سكن', 'Add housing') : tr('تعديل سكن', 'Edit housing'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          gap,
          TextField(controller: _name, decoration: InputDecoration(labelText: tr('اسم السكن', 'Name'))),
          gap,
          TextField(controller: _city, decoration: InputDecoration(labelText: tr('المدينة', 'City'))),
          gap,
          TextField(controller: _address, decoration: InputDecoration(labelText: tr('العنوان', 'Address'))),
          gap,
          TextField(controller: _declared, keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: tr('السعة المكتوبة (تُستعمل إن لم تُسجَّل غرف)', 'Declared capacity (used when there are no rooms)'))),
          const SizedBox(height: 6),
          Text('${tr('سعةُ الغرف المسجَّلة', 'Rooms capacity')}: $roomsTotal${roomsTotal > 0 ? tr(' — هي المعتمدة', ' — this is what counts') : ''}',
              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          gap,
          Row(children: [
            Expanded(child: Text(tr('الغرف', 'Rooms'), style: const TextStyle(fontWeight: FontWeight.w800))),
            TextButton.icon(onPressed: () => setState(() => _rooms.add(_Room())), icon: const Icon(Icons.add, size: 16), label: Text(tr('إضافة غرفة', 'Add room'))),
          ]),
          if (_rooms.isEmpty) Text(tr('بلا غرف — تُستعمل السعة المكتوبة أعلاه.', 'No rooms — the declared capacity above is used.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          for (final r in _rooms)
            Container(
              key: ObjectKey(r),
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(flex: 5, child: TextField(controller: r.name, decoration: InputDecoration(isDense: true, labelText: tr('اسم الغرفة', 'Room name')))),
                  const SizedBox(width: 6),
                  Expanded(flex: 4, child: DropdownButtonFormField<String>(
                    isExpanded: true, initialValue: r.kind,
                    decoration: InputDecoration(isDense: true, labelText: tr('لمن', 'For')),
                    items: [for (final k in const ['any', 'rep', 'admin']) DropdownMenuItem(value: k, child: Text(tr(_kindAr[k]!, _kindEn[k]!)))],
                    onChanged: (v) => setState(() => r.kind = v ?? 'any'),
                  )),
                  const SizedBox(width: 6),
                  Expanded(flex: 3, child: TextField(controller: r.cap, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(isDense: true, labelText: tr('السعة', 'Capacity')))),
                  IconButton(
                    visualDensity: VisualDensity.compact, tooltip: tr('حذف الغرفة', 'Remove room'),
                    icon: const Icon(Icons.close, size: 18, color: T.inkFaint),
                    onPressed: () { setState(() => _rooms.remove(r)); WidgetsBinding.instance.addPostFrameCallback((_) => r.dispose()); },
                  ),
                ]),
                if (r.occupied > 0)
                  Text(tr('يسكنها الآن ${r.occupied} — لا تُخفَّض السعة دونهم.', '${r.occupied} living here now — capacity cannot go below that.'),
                      style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              ]),
            ),
          gap,
          TextField(controller: _notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
          const SizedBox(height: 14),
          FilledButton(onPressed: _saving ? null : _save, child: Text(tr('حفظ', 'Save'))),
        ]),
      ),
    );
  }
}
