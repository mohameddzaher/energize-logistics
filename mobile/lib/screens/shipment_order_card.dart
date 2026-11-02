import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_orders_common.dart';

/// Large shipment card ("cards" view). Most users are on mobile, so each shipment is a large card with its data and no horizontal swiping; from it they change the status, call and write a note. Designed for a 320 width: each item is a titled line and buttons are at least 44 points.

/// Short relative time, e.g. "5 min ago".
String soAgo(dynamic iso) {
  final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  if (d == null) return '';
  final m = DateTime.now().difference(d).inMinutes;
  if (m < 1) return tr('الآن', 'just now');
  if (m < 60) return tr('منذ $m د', '${m}m ago');
  final h = m ~/ 60;
  if (h < 24) return tr('منذ $h س', '${h}h ago');
  final days = h ~/ 24;
  if (days < 30) return tr('منذ $days يوم', '${days}d ago');
  return soFmtDate(iso);
}

/// All follow-up notes, newest first.
List<Map<String, dynamic>> soFollowUpNotes(Map order) {
  final log = (order['statusLog'] as List?) ?? const [];
  return [
    for (final h in log.reversed)
      if (h is Map && '${h['note'] ?? ''}'.trim().isNotEmpty) Map<String, dynamic>.from(h),
  ];
}

const _noteManagers = {'super_admin', 'admin', 'shipment_orders_manager', 'operations_manager'};

/// Follow-up notes: a log that can be added to, edited and deleted, like the web dialog. A note is edited or deleted by its author or the section manager, and the server guards the same rule. Returns the shipment after the last change (or null if nothing changed).
Future<Map<String, dynamic>?> soQuickNote(BuildContext context, Map<String, dynamic> order) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (c) => _NoteSheet(order: order),
  );
}

class _NoteSheet extends StatefulWidget {
  final Map<String, dynamic> order;
  const _NoteSheet({required this.order});
  @override
  State<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends State<_NoteSheet> {
  final _ctl = TextEditingController();
  late Map<String, dynamic> _o = widget.order;
  Map<String, dynamic>? _changed;
  String? _busy;

  @override
  void dispose() { _ctl.dispose(); super.dispose(); }

  void _err(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
  }

  void _apply(dynamic d) {
    if (d is Map && d['order'] is Map) {
      final u = Map<String, dynamic>.from(d['order']);
      setState(() { _o = u; _changed = u; });
    }
  }

  Future<void> _add() async {
    final note = _ctl.text.trim();
    if (note.isEmpty) return;
    setState(() => _busy = 'new');
    try {
      _apply(await Api.instance.post('/api/shipment-orders/orders/${_o['_id']}/note', {'note': note}));
      _ctl.clear();
      if (mounted) FocusScope.of(context).unfocus();
    } catch (e) { _err(e); }
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _edit(Map<String, dynamic> n) async {
    final ctl = TextEditingController(text: '${n['note'] ?? ''}');
    final text = await showDialog<String>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تعديل الملاحظة', 'Edit note')),
      content: TextField(controller: ctl, autofocus: true, minLines: 3, maxLines: 6, maxLength: 500,
          style: const TextStyle(fontSize: 16)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, ctl.text.trim()), child: Text(tr('حفظ', 'Save'))),
      ],
    ));
    ctl.dispose();
    if (text == null || text.isEmpty || text == '${n['note']}') return;
    setState(() => _busy = '${n['_id']}');
    try {
      _apply(await Api.instance.put('/api/shipment-orders/orders/${_o['_id']}/note/${n['_id']}', {'note': text}));
    } catch (e) { _err(e); }
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _delete(Map<String, dynamic> n) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف هذه الملاحظة؟', 'Delete this note?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    setState(() => _busy = '${n['_id']}');
    try {
      _apply(await Api.instance.delete('/api/shipment-orders/orders/${_o['_id']}/note/${n['_id']}'));
    } catch (e) { _err(e); }
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final o = _o;
    final auth = context.read<AuthProvider>();
    final me = '${auth.user?['_id'] ?? auth.user?['id'] ?? ''}';
    final manager = _noteManagers.contains(auth.role);
    final notes = soFollowUpNotes(o);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) Navigator.pop(context, _changed); },
      child: SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('ملاحظات المتابعة', 'Follow-up notes'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
              const SizedBox(height: 2),
              Text('${tr('أمر نقل', 'Transport order')} ${soRef(o)}${'${o['customerName'] ?? ''}'.isNotEmpty ? ' · ${o['customerName']}' : ''}',
                  style: const TextStyle(fontSize: 13.5, color: T.inkSoft)),
            ])),
            IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context, _changed)),
          ]),
          const SizedBox(height: 12),
          TextField(
            controller: _ctl,
            minLines: 2,
            maxLines: 6,
            maxLength: 500,
            style: const TextStyle(fontSize: 16),
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(hintText: tr('اكتب ملاحظة جديدة… مثلًا: كلّمتُ السائق، يصل بعد ساعتين', 'Write a new note…')),
          ),
          SizedBox(height: 50, child: FilledButton.icon(
            onPressed: _busy != null || _ctl.text.trim().isEmpty ? null : _add,
            icon: _busy == 'new' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.add),
            label: Text(tr('إضافة ملاحظة', 'Add note'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          )),
          const SizedBox(height: 6),
          Text(tr('لا تغيّر الحالة ولا تُطبع في أمر النقل.', 'Does not change the status or print on the waybill.'),
              style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          const Divider(height: 24),
          Text('${tr('كلّ الملاحظات', 'All notes')} (${notes.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          if (notes.isEmpty)
            Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(tr('لا ملاحظات بعد.', 'No notes yet.'),
                textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint, fontSize: 14))),
          for (final n in notes) _noteTile(n, me, manager),
        ])),
      ),
    )));
  }

  Widget _noteTile(Map<String, dynamic> n, String me, bool manager) {
    final id = '${n['_id'] ?? ''}';
    final pure = '${n['from'] ?? ''}' == '${n['to'] ?? ''}' && '${n['fileUrl'] ?? ''}'.isEmpty;
    final canEdit = id.isNotEmpty && pure && (manager || (me.isNotEmpty && '${n['by'] ?? ''}' == me));
    final edited = '${n['editedAt'] ?? ''}'.isNotEmpty && n['editedAt'] != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 12),
      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${n['byName'] ?? ''}'.isEmpty ? tr('غير معروف', 'Unknown') : '${n['byName']}',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: T.ink)),
            const SizedBox(height: 2),
            Text([
              soFmtDT(n['at']), soAgo(n['at']),
              if (edited) tr('عُدّلت', 'edited'),
              if (!pure) tr('مع تغيير الحالة', 'with a status change'),
            ].where((s) => s.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          ])),
          if (canEdit && _busy == id)
            const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))
          else if (canEdit) ...[
            IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 21, color: T.info), onPressed: _busy != null ? null : () => _edit(n)),
            IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, size: 21, color: T.danger), onPressed: _busy != null ? null : () => _delete(n)),
          ],
        ]),
        const SizedBox(height: 6),
        Padding(padding: const EdgeInsetsDirectional.only(end: 6),
            child: Text('${n['note']}', style: const TextStyle(fontSize: 16, color: T.ink, height: 1.4))),
      ]),
    );
  }
}

/// Short "last follow-up" line for list mode.
class SoLatestFollowUpLine extends StatelessWidget {
  final Map order;
  final VoidCallback? onTap;
  const SoLatestFollowUpLine({super.key, required this.order, this.onTap});
  @override
  Widget build(BuildContext context) {
    final all = soFollowUpNotes(order);
    if (all.isEmpty) return const SizedBox.shrink();
    final f = all.first;
    final who = [if ('${f['byName'] ?? ''}'.isNotEmpty) '${f['byName']}', soAgo(f['at'])].where((s) => s.isNotEmpty).join(' · ');
    final line = Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text.rich(
        TextSpan(children: [
          WidgetSpan(alignment: PlaceholderAlignment.middle, child: Icon(Icons.forum_outlined, size: 13, color: T.violet.withValues(alpha: 0.9))),
          TextSpan(text: ' ${tr('آخر ملاحظة', 'Latest note')}: ', style: const TextStyle(fontWeight: FontWeight.w800, color: T.violet)),
          TextSpan(text: '${f['note']}'),
          if (who.isNotEmpty) TextSpan(text: '  ($who)', style: const TextStyle(color: T.inkFaint, fontSize: 11.5)),
          if (all.length > 1) TextSpan(text: '  · ${tr('${all.length} ملاحظات', '${all.length} notes')}',
              style: const TextStyle(color: T.violet, fontWeight: FontWeight.w700, fontSize: 11.5)),
        ]),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 13, color: T.inkSoft),
      ),
    );
    return onTap == null ? line : InkWell(onTap: onTap, child: line);
  }
}

class ShipmentOrderBigCard extends StatelessWidget {
  final Map<String, dynamic> order;
  final List<SoStatus> vocab;
  final bool editor;
  final bool selected;
  final VoidCallback onToggleSelect;
  final VoidCallback onOpen;
  /// After saving or editing a follow-up, the list is reloaded.
  final VoidCallback onChanged;
  /// After saving a note: the shipment as the server returned it, so the card updates immediately.
  final void Function(Map<String, dynamic> updated) onNoteSaved;
  final VoidCallback? onEdit;

  const ShipmentOrderBigCard({
    super.key,
    required this.order,
    required this.vocab,
    required this.editor,
    required this.selected,
    required this.onToggleSelect,
    required this.onOpen,
    required this.onChanged,
    required this.onNoteSaved,
    this.onEdit,
  });

  static String _s(dynamic v) => '${v ?? ''}'.trim();

  // Info line: a fixed-width label and a clearly styled value, with a thin divider between lines (the text was crowded and needed alignment, order and clarity).
  Widget _line(IconData icon, String label, String value, {String sub = ''}) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: T.line, width: 0.7))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, size: 19, color: T.inkFaint)),
        const SizedBox(width: 8),
        SizedBox(width: 74, child: Text(label, style: const TextStyle(fontSize: 14, color: T.inkSoft, fontWeight: FontWeight.w600))),
        const SizedBox(width: 6),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value, style: const TextStyle(fontSize: 16, color: T.ink, fontWeight: FontWeight.w700, height: 1.3)),
          if (sub.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub, textDirection: TextDirection.ltr,
                style: const TextStyle(fontSize: 14, color: T.inkSoft, fontFamily: 'monospace'))),
        ])),
      ]),
    );
  }

  Widget _route(String from, String to) {
    Widget row(Color dot, String label, String city) => Row(children: [
          Container(width: 11, height: 11, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
          const SizedBox(width: 10),
          SizedBox(width: 34, child: Text(label, style: const TextStyle(fontSize: 14, color: T.inkSoft, fontWeight: FontWeight.w600))),
          Expanded(child: Text(city, style: const TextStyle(fontSize: 17.5, fontWeight: FontWeight.w800, color: T.ink))),
        ]);
    return Container(
      margin: const EdgeInsets.only(top: 4, bottom: 4),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        row(T.navy, tr('من', 'From'), from.isEmpty ? '—' : from),
        Padding(padding: const EdgeInsetsDirectional.only(start: 5), child: Container(width: 1.2, height: 14, color: T.line)),
        row(T.orange, tr('إلى', 'To'), to.isEmpty ? '—' : to),
      ]),
    );
  }

  Widget _noteBox(IconData icon, String title, String text, Color color, {String meta = ''}) => Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 17, color: color),
            const SizedBox(width: 6),
            Flexible(child: Text(title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: color))),
          ]),
          if (meta.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(meta, style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
          const SizedBox(height: 5),
          Text(text, style: const TextStyle(fontSize: 15.5, color: T.ink, height: 1.4)),
        ]),
      );

  // Button with its icon and label; an icon alone would have to be guessed.
  Widget _iconBtn(IconData icon, Color color, String label, VoidCallback? onTap) => Expanded(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 56,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: onTap == null ? T.canvas : color.withValues(alpha: 0.09),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, size: 21, color: onTap == null ? T.line : color),
              const SizedBox(height: 2),
              FittedBox(fit: BoxFit.scaleDown, child: Text(label,
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: onTap == null ? T.inkFaint : color))),
            ]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final o = order;
    final st = soStatusOf(vocab, o['status']);
    final phone = _s(o['driverPhone']);
    final tripNote = _s(o['notes']);
    final notes = soFollowUpNotes(o);
    final f = notes.isEmpty ? null : notes.first;
    Future<void> openNotes() async {
      final u = await soQuickNote(context, o);
      if (u != null) onNoteSaved(u);
    }
    final hasMoney = _s(o['sellPrice']).isNotEmpty || _s(o['buyPrice']).isNotEmpty;

    return Pressable(
      onTap: onOpen,
      onLongPress: onToggleSelect,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: selected ? T.orange : Colors.transparent, width: 2),
        ),
        child: AppCard(
          topAccent: st.$4,
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // Header: number + source + status, then the customer
            Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              SizedBox(width: 40, height: 40, child: Checkbox(value: selected, onChanged: (_) => onToggleSelect())),
              const SizedBox(width: 4),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(soRef(o), maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 19, fontFamily: 'monospace', color: T.navy)),
                const SizedBox(height: 3),
                Chip2(o['source'] == 'platform' ? tr('المنصّة', 'Platform') : tr('الخاص بنا', 'Ours'),
                    o['source'] == 'platform' ? T.cyan : T.navy),
              ])),
              const SizedBox(width: 6),
              Flexible(child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                decoration: BoxDecoration(color: st.$4, borderRadius: BorderRadius.circular(20)),
                child: Text(tr(st.$2, st.$3), maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w800)),
              )),
            ]),
            const SizedBox(height: 8),
            Text(_s(o['customerName']).isEmpty ? '—' : _s(o['customerName']),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: T.ink, height: 1.3)),
            const SizedBox(height: 8),
            // The route in its box: "from" above "to"
            _route(_s(o['fromCity']), _s(o['toCity'])),
            // Info: one line for each
            _line(Icons.person_outline, tr('السائق', 'Driver'), _s(o['driverName']).isEmpty ? '—' : _s(o['driverName']), sub: phone),
            _line(Icons.local_shipping_outlined, tr('الشاحنة', 'Truck'), _s(o['truckType']).isEmpty ? '—' : _s(o['truckType']), sub: _s(o['vehiclePlate'])),
            _line(Icons.schedule, tr('الاستلام', 'Pickup'), soFmtDT(o['pickupTime'])),
            _line(Icons.inventory_2_outlined, tr('الحمولة', 'Cargo'), _s(o['cargoType'])),
            if (hasMoney)
              _line(Icons.payments_outlined, tr('بيع / شراء', 'Sell / Buy'), '${soMoney(o['sellPrice'])} / ${soMoney(o['buyPrice'])}'),
            // The two notes, each under its own name
            if (tripNote.isNotEmpty)
              _noteBox(Icons.description_outlined, tr('ملاحظة أمر النقل', 'Transport order note'), tripNote, T.inkSoft),
            if (f != null)
              GestureDetector(
                onTap: openNotes,
                child: _noteBox(Icons.forum_outlined,
                    notes.length > 1 ? '${tr('آخر ملاحظة', 'Latest note')} · ${tr('عرض الكلّ', 'view all')} (${notes.length})' : tr('آخر ملاحظة', 'Latest note'),
                    '${f['note']}', T.violet,
                    meta: [if (_s(f['byName']).isNotEmpty) _s(f['byName']), soAgo(f['at'])].where((s) => s.isNotEmpty).join(' · ')),
              ),
            const SizedBox(height: 12),
            // Actions: large buttons
            if (editor)
              Row(children: [
                Expanded(child: SizedBox(height: 52, child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: st.$4, padding: const EdgeInsets.symmetric(horizontal: 8)),
                  onPressed: () async { if (await soFollowUp(context, o, vocab)) onChanged(); },
                  icon: const Icon(Icons.sync, size: 21),
                  label: FittedBox(fit: BoxFit.scaleDown, child: Text(tr('تغيير الحالة', 'Change status'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                ))),
                const SizedBox(width: 8),
                Expanded(child: SizedBox(height: 52, child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
                  onPressed: openNotes,
                  icon: const Icon(Icons.edit_note, size: 23),
                  label: FittedBox(fit: BoxFit.scaleDown, child: Text(
                      notes.isEmpty ? tr('الملاحظات', 'Notes') : '${tr('الملاحظات', 'Notes')} (${notes.length})',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
                ))),
              ]),
            if (editor) const SizedBox(height: 8),
            Row(children: [
              _iconBtn(Icons.phone_rounded, T.info, tr('اتصال', 'Call'), phone.isEmpty ? null : () => callNumber(phone)),
              const SizedBox(width: 8),
              _iconBtn(Icons.chat, const Color(0xFF25D366), tr('واتساب', 'WhatsApp'), phone.isEmpty ? null : () => whatsappNumber(phone)),
              const SizedBox(width: 8),
              _iconBtn(Icons.picture_as_pdf_outlined, T.orange, tr('أمر النقل', 'Transport order'), () => soPrintWaybills(context, [o])),
              if (editor && onEdit != null) ...[
                const SizedBox(width: 8),
                _iconBtn(Icons.edit_outlined, T.navy, tr('تعديل', 'Edit'), onEdit),
              ],
            ]),
          ]),
        ),
      ),
    );
  }
}
