import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مركباتُ النقل الخفيف — مركباتُ مشاريع القسم (كيتا، هنقرستيشن، أمازون، نينجا).
///
/// نافذةٌ على سجلّ المركبات نفسِه لا نسخةٌ منه: ما يُعدَّل هنا يُكتب في قسم
/// المركبات ويظهر فيه في الحال، وما يُعدَّل هناك يظهر هنا — الشاشتان تسمعان
/// الحدثَ نفسَه. وما يُعدَّل من هنا أعمدةُ التشغيل: المشروع والمدينة والقائد
/// الفعليّ والتفويض. اللوحةُ والرقمُ التسلسليّ يبقيان لقسم المركبات.
/// مطابقةٌ لشاشة الموقع `/system/b2c/vehicles`.

String _s(dynamic v) => (v ?? '').toString();
String _dmy(dynamic v) { final s = _s(v); return s.length >= 10 ? s.substring(0, 10).split('-').reversed.join('/') : '—'; }
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _day(dynamic v) { final s = _s(v); return s.length >= 10 ? s.substring(0, 10) : ''; }

class B2cVehiclesScreen extends StatefulWidget {
  const B2cVehiclesScreen({super.key});
  @override
  State<B2cVehiclesScreen> createState() => _B2cVehiclesScreenState();
}

class _B2cVehiclesScreenState extends State<B2cVehiclesScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _q = '';
  // '' | noAuthorization | expired | expiringSoon | noDriver
  String _state = '';

  @override
  void initState() {
    super.initState();
    _load();
    // قسمُ المركبات يبثّ `vreg:updated` (ومعه `lt:updated`) عند كلّ تعديلٍ هناك.
    Live.instance.on('vreg:updated', _onLive);
    Live.instance.on('lt:updated', _onLive);
  }

  void _onLive() => _load();

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    Live.instance.off('lt:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/light-transport/vehicles');
      if (!mounted) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  List<Map<String, dynamic>> _shown(Map<String, dynamic> d) {
    final k = _q.trim().toLowerCase();
    return [
      for (final x in (d['vehicles'] as List? ?? const [])) Map<String, dynamic>.from(x as Map),
    ].where((r) {
      final left = r['daysLeft'] as num?;
      if (_state == 'noAuthorization' && (_s(r['authorizedName']).isNotEmpty || _s(r['authNumber']).isNotEmpty)) return false;
      if (_state == 'expired' && !(left != null && left < 0)) return false;
      if (_state == 'expiringSoon' && !(left != null && left >= 0 && left <= 30)) return false;
      if (_state == 'noDriver' && _s(r['driverName']).isNotEmpty) return false;
      return k.isEmpty || [
        r['plateNumber'], r['serialNumber'], r['project'], r['city'], r['driverName'], r['driverId'],
        r['authorizedName'], r['authorizedId'], r['authorizedPhone'], r['authNumber'],
      ].any((v) => _s(v).toLowerCase().contains(k));
    }).toList();
  }

  Future<void> _edit(Map<String, dynamic> row) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _VehicleSheet(row: row),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('مركبات النقل الخفيف', 'Light Transport Vehicles')),
      body: d == null
          ? (_error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _error = null); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]))
          : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final sum = Map<String, dynamic>.from(d['summary'] as Map? ?? const {});
    final canEdit = d['canEdit'] == true;
    final rows = _shown(d);
    final tiles = [
      ('', tr('عدد المركبات', 'Vehicles'), sum['total'], T.orange),
      ('noAuthorization', tr('بلا تفويض', 'No authorization'), sum['noAuthorization'], T.inkSoft),
      ('expired', tr('تفويض منتهٍ', 'Authorization expired'), sum['expired'], T.danger),
      ('expiringSoon', tr('ينتهي خلال ٣٠ يومًا', 'Expiring in 30 days'), sum['expiringSoon'], T.warn),
      ('noDriver', tr('بلا قائدٍ فعليّ', 'No actual driver'), sum['noDriver'], T.inkSoft),
    ];
    return ListView(padding: const EdgeInsets.all(14), children: [
      // ── الملخّص: بطاقةٌ تُضغَط فتُفلتَر القائمة، وتُضغَط ثانيةً فتعود ───────
      SizedBox(
        height: 74,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: tiles.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (c, i) {
            final t = tiles[i];
            final on = t.$1.isNotEmpty && _state == t.$1;
            return Pressable(
              onTap: () => setState(() => _state = _state == t.$1 ? '' : t.$1),
              child: Container(
                width: 124,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: on ? T.orange : T.line, width: on ? 2 : 1),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text('${t.$3 ?? 0}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 19, color: t.$4, height: 1)),
                  const SizedBox(height: 5),
                  Text(t.$2, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
                ]),
              ),
            );
          },
        ),
      ),
      const SizedBox(height: 10),
      TextField(
        onChanged: (v) => setState(() => _q = v),
        decoration: InputDecoration(hintText: tr('اللوحة / الاسم / الهوية / رقم التفويض…', 'plate / name / ID / auth. number…'), prefixIcon: const Icon(Icons.search), isDense: true),
      ),
      const SizedBox(height: 8),
      Text('${rows.length} ${tr('مركبة', 'vehicles')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      const SizedBox(height: 8),
      if (rows.isEmpty) EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا مركباتَ في هذا العرض', 'No vehicles in this view')),
      for (final r in rows) Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: canEdit ? Pressable(onTap: () => _edit(r), child: _card(r, canEdit)) : _card(r, canEdit),
      ),
      const SizedBox(height: 20),
    ]);
  }

  Widget _card(Map<String, dynamic> r, bool canEdit) {
    final left = r['daysLeft'] as num?;
    final endColor = left == null ? T.inkFaint : left < 0 ? T.danger : left <= 30 ? T.warn : T.ink;
    final endBold = left != null && left <= 30;
    Widget line(String label, dynamic value, {Color color = T.ink, bool bold = false, bool ltr = false, String? note}) => Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 138, child: Text(label, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_s(value).isEmpty ? '—' : _s(value), textDirection: ltr ? TextDirection.ltr : null,
                  style: TextStyle(fontSize: 12.5, color: color, fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
              if (note != null) Text(note, style: TextStyle(fontSize: 10.5, color: color, fontWeight: FontWeight.w700)),
            ])),
          ]),
        );
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.local_shipping_outlined, size: 17, color: T.orange),
          const SizedBox(width: 6),
          Expanded(child: Text(_s(r['plateNumber']).isEmpty ? '—' : _s(r['plateNumber']), textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14))),
          if (canEdit) const Icon(Icons.edit_outlined, size: 16, color: T.inkFaint),
        ]),
        const Divider(height: 14),
        line(tr('الرقم التسلسلي', 'Serial no.'), r['serialNumber'], ltr: true),
        line(tr('المشروع', 'Project'), r['project'], bold: true),
        line(tr('المدينة', 'City'), r['city']),
        line(tr('رقم اللوحة', 'Plate'), r['plateNumber'], bold: true, ltr: true),
        line(tr('هوية القائد الفعلي', 'Actual driver ID'), r['driverId'], ltr: true),
        line(tr('اسم القائد الفعلي للمركبة', 'Actual driver'), r['driverName']),
        line(tr('رقم هوية المفوض', 'Authorized ID'), r['authorizedId'], ltr: true),
        line(tr('اسم المفوض', 'Authorized person'), r['authorizedName']),
        line(tr('رقم جوال المفوض', 'Authorized phone'), r['authorizedPhone'], ltr: true),
        line(tr('بداية التفويض', 'Auth. start'), _dmy(r['authStart'])),
        line(tr('نهاية التفويض', 'Auth. end'), _dmy(r['authEnd']), color: endColor, bold: endBold,
            note: left != null && left <= 30
                ? (left < 0 ? tr('منتهٍ منذ ${-left} يومًا', 'expired ${-left}d ago') : tr('باقٍ $left يومًا', '${left}d left'))
                : null),
        line(tr('المدة بالأيام', 'Duration (days)'), r['durationDays']),
        line(tr('رقم التفويض', 'Auth. number'), r['authNumber'], ltr: true),
      ]),
    );
  }
}

/// تعديلُ أعمدة التشغيل لمركبةٍ واحدة — ويُرسَل ما تغيّر وحدَه.
class _VehicleSheet extends StatefulWidget {
  final Map<String, dynamic> row;
  const _VehicleSheet({required this.row});
  @override
  State<_VehicleSheet> createState() => _VehicleSheetState();
}

class _VehicleSheetState extends State<_VehicleSheet> {
  static const _textKeys = ['project', 'city', 'driverId', 'driverName', 'authorizedId', 'authorizedName', 'authorizedPhone', 'authNumber'];
  late final Map<String, TextEditingController> _c = {
    for (final k in _textKeys) k: TextEditingController(text: _s(widget.row[k])),
  };
  late String _start = _day(widget.row['authStart']);
  late String _end = _day(widget.row['authEnd']);
  bool _busy = false;

  @override
  void dispose() { for (final c in _c.values) { c.dispose(); } super.dispose(); }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  int? get _days {
    final a = DateTime.tryParse(_start), b = DateTime.tryParse(_end);
    return a == null || b == null ? null : b.difference(a).inDays;
  }

  Future<void> _pick({required bool start}) async {
    final now = DateTime.now();
    final cur = DateTime.tryParse(start ? _start : _end) ?? now;
    final d = await showDatePicker(context: context, firstDate: DateTime(2015), lastDate: DateTime(now.year + 10), initialDate: cur);
    if (d != null) setState(() => start ? _start = _ymd(d) : _end = _ymd(d));
  }

  Future<void> _save() async {
    final days = _days;
    if (days != null && days < 0) return _say(tr('نهايةُ التفويض قبل بدايته', 'End is before start'));
    // يُرسَل ما تغيّر وحدَه: خانةٌ لم تُمَسّ لا تُكتب فوق تعديلِ زميلٍ في قسم المركبات.
    final body = <String, dynamic>{
      for (final k in _textKeys)
        if (_c[k]!.text.trim() != _s(widget.row[k]).trim()) k: _c[k]!.text.trim(),
      if (_start != _day(widget.row['authStart'])) 'authStart': _start,
      if (_end != _day(widget.row['authEnd'])) 'authEnd': _end,
    };
    if (body.isEmpty) { Navigator.pop(context, false); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.put('/api/light-transport/vehicles/${widget.row['_id']}', body);
      if (!mounted) return;
      _say(tr('حُفظ — وظهر في قسم المركبات', 'Saved — and visible in the Vehicles section'));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _say(e.toString()); }
    }
  }

  Widget _text(String key, String ar, String en, {TextInputType? type, bool ltr = false}) => TextField(
        controller: _c[key], keyboardType: type, textDirection: ltr ? TextDirection.ltr : null,
        decoration: InputDecoration(labelText: tr(ar, en)),
      );

  Widget _dateField(String label, String value, {required bool start}) => InkWell(
        onTap: () => _pick(start: start),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            // التاريخُ الفارغُ يُرسَل فارغًا فيُمحى من السجلّ.
            suffixIcon: value.isEmpty
                ? const Icon(Icons.event, size: 18)
                : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => start ? _start = '' : _end = '')),
          ),
          child: Text(value.isEmpty ? '' : _dmy(value), style: const TextStyle(fontSize: 14)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final r = widget.row;
    final days = _days;
    const gap = SizedBox(height: 10);
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('مركبة ${_s(r['plateNumber'])}', 'Vehicle ${_s(r['plateNumber'])}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                '${tr('الرقم التسلسلي', 'Serial')}: ${_s(r['serialNumber']).isEmpty ? '—' : _s(r['serialNumber'])} · ${tr('اللوحة', 'Plate')}: ${_s(r['plateNumber'])}',
                style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w700),
              ),
              Text(tr('اللوحةُ والرقمُ التسلسليّ يُعدَّلان من قسم المركبات.', 'Plate and serial are edited in the Vehicles section.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            ]),
          ),
          gap,
          // قائمتا قسم المركبات: تُختار القيمةُ منهما، والمكتوبةُ تُقبَل ولا تُضاف إليهما.
          Row(children: [
            Expanded(child: LookupField(type: 'vehicle_department', controller: _c['project']!, label: tr('المشروع', 'Project'), noAdd: true)),
            const SizedBox(width: 10),
            Expanded(child: LookupField(type: 'vehicle_city', controller: _c['city']!, label: tr('المدينة', 'City'), noAdd: true)),
          ]),
          gap,
          _text('driverId', 'هوية القائد الفعلي', 'Actual driver ID', type: TextInputType.number, ltr: true),
          gap,
          _text('driverName', 'اسم القائد الفعلي للمركبة', 'Actual driver name'),
          gap,
          _text('authorizedId', 'رقم هوية المفوض', 'Authorized ID', type: TextInputType.number, ltr: true),
          gap,
          _text('authorizedName', 'اسم المفوض', 'Authorized person'),
          gap,
          _text('authorizedPhone', 'رقم جوال المفوض', 'Authorized phone', type: TextInputType.phone, ltr: true),
          gap,
          _text('authNumber', 'رقم التفويض', 'Authorization number', ltr: true),
          gap,
          Row(children: [
            Expanded(child: _dateField(tr('بداية التفويض', 'Authorization start'), _start, start: true)),
            const SizedBox(width: 10),
            Expanded(child: _dateField(tr('نهاية التفويض', 'Authorization end'), _end, start: false)),
          ]),
          const SizedBox(height: 8),
          Text.rich(TextSpan(style: const TextStyle(fontSize: 12.5, color: T.inkSoft), children: [
            TextSpan(text: '${tr('المدة بالأيام', 'Duration (days)')}: '),
            TextSpan(text: '${days ?? '—'}', style: TextStyle(fontWeight: FontWeight.w800, color: days != null && days < 0 ? T.danger : T.ink)),
            TextSpan(text: tr(' — تُحسَب من البداية إلى النهاية', ' — computed from start to end'), style: const TextStyle(color: T.inkFaint)),
          ])),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _busy ? null : _save, child: Text(tr('حفظ', 'Save')))),
        ]),
      ),
    );
  }
}
