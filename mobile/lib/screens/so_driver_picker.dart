import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';

/// ── اختيارُ السائق في إنشاء الشحنة (٢٠٢٦/١٠/٢٦) — نظيرُ خانة الموقع ──────────
/// «بحث برقم جوال السائق زي البحث بالاسم»، و«زر إضافة سائق زي المورّد».
/// بلا كتابة: سوّاقُ الشاحنة/المورّد المختار. ومع الكتابة: بحثٌ عند الخادم في
/// السوّاق كلِّهم بالاسم والجوال (كيفما كُتب) والإقامة. و«سائق جديد» يسجّله فورًا
/// — ومن كان مسجَّلًا بنفس الجوال أو الإقامة يُختار بدل تكراره (`reuse`).
/// «0» و«-» ليسا قيمة — السجلُّ المستورَد يحملهما حيث لا شيء (٢٠٢٦/١٠/٢٦).
String soRealVal(dynamic v) {
  final t = '${v ?? ''}'.trim();
  return RegExp(r'^(0+|-+|null|nan|n/a)$', caseSensitive: false).hasMatch(t) ? '' : t;
}

Future<Map<String, dynamic>?> pickShipmentDriver(
  BuildContext context, {
  required List<Map<String, dynamic>> local,
  String? supplierId,
  String? vehicleId,
  bool startWithNew = false,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _DriverSheet(local: local, supplierId: supplierId, vehicleId: vehicleId, startWithNew: startWithNew),
  );
}

class _DriverSheet extends StatefulWidget {
  final List<Map<String, dynamic>> local;
  final String? supplierId, vehicleId;
  final bool startWithNew;
  const _DriverSheet({required this.local, this.supplierId, this.vehicleId, this.startWithNew = false});
  @override
  State<_DriverSheet> createState() => _DriverSheetState();
}

class _DriverSheetState extends State<_DriverSheet> {
  final _q = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _iqama = TextEditingController();
  List<Map<String, dynamic>> _hits = [];
  bool _loading = false, _saving = false;
  late bool _adding = widget.startWithNew;
  Timer? _t;
  int _seq = 0;

  @override
  void dispose() {
    _t?.cancel();
    for (final c in [_q, _name, _phone, _iqama]) { c.dispose(); }
    super.dispose();
  }

  void _onType(String v) {
    _t?.cancel();
    _t = Timer(const Duration(milliseconds: 280), () => _search(v));
    setState(() {});
  }

  Future<void> _search(String v) async {
    final q = v.trim();
    if (q.isEmpty) { setState(() { _hits = []; _loading = false; }); return; }
    final mine = ++_seq;
    setState(() => _loading = true);
    try {
      final d = await Api.instance.get('/api/shipment-orders/drivers?limit=40&q=${Uri.encodeQueryComponent(q)}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _hits = List<Map<String, dynamic>>.from(((d is Map ? d['drivers'] : null) ?? const []).map((x) => Map<String, dynamic>.from(x as Map)));
        _loading = false;
      });
    } catch (_) { if (mounted && mine == _seq) setState(() => _loading = false); }
  }

  /// «موجودٌ بالفعل» تنبيهٌ لا اختيارٌ صامت: نختاره؟ والاسمُ وحدَه قد يكون شخصًا
  /// آخر فيُسمَح بإضافته؛ أمّا الجوالُ والإقامةُ فرجلٌ واحد.
  Future<void> _save({bool force = false}) async {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    setState(() => _saving = true);
    try {
      final r = await Api.instance.post('/api/shipment-orders/drivers', {
        'name': name,
        'phone': _phone.text.trim().isEmpty ? '' : saPhone(_phone.text),
        'residenceNumber': _iqama.text.trim(),
        'reuse': true,
        if (force) 'force': true,
        if ((widget.supplierId ?? '').isNotEmpty) 'supplier': widget.supplierId,
        if ((widget.vehicleId ?? '').isNotEmpty) 'vehicle': widget.vehicleId,
      });
      final d = Map<String, dynamic>.from((r is Map ? r['driver'] : null) ?? {});
      if (!mounted) return;
      if (r is Map && r['existed'] == true) {
        setState(() => _saving = false);
        final by = r['matchedBy'] == 'phone' ? tr('بنفس رقم الجوال', 'with the same phone')
            : r['matchedBy'] == 'iqama' ? tr('بنفس رقم الإقامة', 'with the same iqama') : tr('بنفس الاسم', 'with the same name');
        final info = [soRealVal(d['phone']), soRealVal(d['residenceNumber'])].where((e) => e.isNotEmpty).join(' · ');
        final byName = r['matchedBy'] == 'name';
        final pick = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
          title: Text(tr('هذا السائق موجود بالفعل', 'This driver already exists')),
          content: Text(tr('«${d['name']}» مسجَّل $by${info.isNotEmpty ? ' ($info)' : ''}. نختاره بدل إضافته مرّةً ثانية؟',
              '“${d['name']}” is registered $by${info.isNotEmpty ? ' ($info)' : ''}. Pick him instead of adding him again?')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(byName ? tr('شخص آخر — أضفه', 'Different person — add') : tr('رجوع', 'Back'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('اختيار الموجود', 'Pick existing'))),
          ],
        ));
        if (!mounted) return;
        if (pick == true) { Navigator.pop(context, d); return; }
        if (pick == false && byName) await _save(force: true);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('سُجِّل السائق «${d['name']}»', 'Driver “${d['name']}” registered'))));
      Navigator.pop(context, d);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  String _sub(Map<String, dynamic> d) {
    final raw = '${d['driverCardExpiry'] ?? ''}';
    final exp = RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(raw) ? raw.substring(0, 10) : '';
    final over = exp.isNotEmpty && (DateTime.tryParse(exp)?.isBefore(DateTime.now()) ?? false);
    return [soRealVal(d['phone']), soRealVal(d['residenceNumber']), soRealVal(d['nationality']),
      if (exp.isNotEmpty) over ? tr('بطاقة التشغيل منتهية $exp', 'Driver card expired $exp') : tr('بطاقة التشغيل حتى $exp', 'Card valid to $exp'),
    ].where((e) => e.isNotEmpty).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final list = _q.text.trim().isEmpty ? widget.local : _hits;
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: _adding ? _newForm() : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(tr('اختر السائق', 'Pick the driver'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
            TextButton.icon(onPressed: () => setState(() => _adding = true), icon: const Icon(Icons.person_add_alt_1), label: Text(tr('سائق جديد', 'New driver'))),
          ]),
          const SizedBox(height: 6),
          TextField(
            controller: _q, autofocus: true, onChanged: _onType,
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('الاسم أو الجوال أو رقم الإقامة…', 'Name, phone or iqama…')),
          ),
          const SizedBox(height: 6),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Flexible(child: list.isEmpty
              ? Padding(padding: const EdgeInsets.all(16), child: Text(
                  _q.text.trim().isEmpty ? tr('اكتب للبحث في كل السوّاق', 'Type to search all drivers') : tr('لا نتائج — سجّله كسائق جديد', 'No matches — register a new driver'),
                  textAlign: TextAlign.center, style: const TextStyle(color: T.inkSoft)))
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${list[i]['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(_sub(list[i])),
                    onTap: () => Navigator.pop(context, list[i]),
                  ),
                )),
        ]),
      ),
    ));
  }

  Widget _newForm() => SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('سائق جديد', 'New driver'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
        const SizedBox(height: 10),
        TextField(controller: _name, autofocus: true, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('اسم السائق *', 'Driver name *'))),
        const SizedBox(height: 8),
        PhoneSA(controller: _phone, label: tr('جوال السائق', 'Driver phone')),
        const SizedBox(height: 8),
        TextField(controller: _iqama, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('رقم الإقامة / الهوية (اختياري)', 'Iqama / ID (optional)'))),
        const SizedBox(height: 6),
        Text(tr('يُسجَّل في صفحة السوّاق فورًا — ومن كان مسجَّلًا بنفس الجوال أو الإقامة يُختار بدل تكراره.',
            'Registered at once — an existing driver with the same phone or iqama is picked instead.'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 12),
        Row(children: [
          TextButton(onPressed: () => setState(() => _adding = false), child: Text(tr('رجوع', 'Back'))),
          const Spacer(),
          FilledButton.icon(
            onPressed: _saving || _name.text.trim().isEmpty ? null : () => _save(),
            icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
            label: Text(tr('حفظ السائق', 'Save driver')),
          ),
        ]),
      ]));
}
