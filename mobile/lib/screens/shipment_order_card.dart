import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'shipment_orders_common.dart';

/// ── بطاقةُ الشحنة الكبيرة («بطاقات») ───────────────────────────────────────
/// صاحبُ الشركة (٢٠٢٦/١٠/٢٦): «أغلبُهم من الجوّال — كلُّ شحنةٍ بطاقةٌ كبيرةٌ
/// ببياناتها، بلا سحبٍ يمينًا ويسارًا؛ ومنها يغيّر الحالةَ ويتّصل ويكتب ملاحظة».
/// تُقرأ على عرض ٣٢٠: كلُّ معلومةٍ سطرٌ بعنوانه، والأزرارُ ≥٤٤ نقطة.

/// آخرُ متابعةٍ لها نصّ — من سجلّ الحالات (ملاحظةُ «تغيير الحالة» أو «ملاحظة» وحدَها).
Map<String, dynamic>? soLatestFollowUp(Map order) {
  final log = (order['statusLog'] as List?) ?? const [];
  for (var i = log.length - 1; i >= 0; i--) {
    final h = log[i];
    if (h is Map && '${h['note'] ?? ''}'.trim().isNotEmpty) return Map<String, dynamic>.from(h);
  }
  return null;
}

/// «منذ ٥ د» — وقتٌ نسبيٌّ قصير.
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

/// ملاحظةُ متابعةٍ بلا تغيير حالة → POST /orders/:id/note. يرجّع الشحنةَ بعد الحفظ.
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
  bool _busy = false;

  @override
  void dispose() { _ctl.dispose(); super.dispose(); }

  Future<void> _save() async {
    final note = _ctl.text.trim();
    if (note.isEmpty) return;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.post('/api/shipment-orders/orders/${widget.order['_id']}/note', {'note': note});
      if (!mounted) return;
      Navigator.pop(context, d['order'] is Map ? Map<String, dynamic>.from(d['order']) : <String, dynamic>{});
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('ملاحظة متابعة', 'Follow-up note'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        Text('${tr('بوليصة', 'Waybill')} ${soRef(o)}${'${o['customerName'] ?? ''}'.isNotEmpty ? ' · ${o['customerName']}' : ''}',
            style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const SizedBox(height: 12),
        TextField(
          controller: _ctl,
          autofocus: true,
          minLines: 3,
          maxLines: 6,
          maxLength: 500,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: tr('ماذا حدث؟ — تُقيَّد في سجلّ الشحنة باسمك ووقتها', 'What happened? — logged on the shipment with your name and time'),
          ),
        ),
        Text(tr('لا تغيّر الحالة، ولا تُطبع في البوليصة.', 'Does not change the status and is not printed on the waybill.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 12),
        SizedBox(height: 48, child: FilledButton.icon(
          onPressed: _busy || _ctl.text.trim().isEmpty ? null : _save,
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
          label: Text(tr('حفظ الملاحظة', 'Save note')),
        )),
      ])),
    ));
  }
}

/// سطرُ «آخر متابعة» المختصر — لوضع القائمة.
class SoLatestFollowUpLine extends StatelessWidget {
  final Map order;
  const SoLatestFollowUpLine({super.key, required this.order});
  @override
  Widget build(BuildContext context) {
    final f = soLatestFollowUp(order);
    if (f == null) return const SizedBox.shrink();
    final who = [if ('${f['byName'] ?? ''}'.isNotEmpty) '${f['byName']}', soAgo(f['at'])].where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text.rich(
        TextSpan(children: [
          WidgetSpan(alignment: PlaceholderAlignment.middle, child: Icon(Icons.forum_outlined, size: 13, color: T.violet.withValues(alpha: 0.9))),
          TextSpan(text: ' ${tr('آخر متابعة', 'Last follow-up')}: ', style: const TextStyle(fontWeight: FontWeight.w800, color: T.violet)),
          TextSpan(text: '${f['note']}'),
          if (who.isNotEmpty) TextSpan(text: '  ($who)', style: const TextStyle(color: T.inkFaint, fontSize: 11)),
        ]),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12, color: T.inkSoft),
      ),
    );
  }
}

class ShipmentOrderBigCard extends StatelessWidget {
  final Map<String, dynamic> order;
  final List<SoStatus> vocab;
  final bool editor;
  final bool selected;
  final VoidCallback onToggleSelect;
  final VoidCallback onOpen;
  /// بعد حفظ متابعةٍ أو تعديل — يُعاد تحميلُ القائمة.
  final VoidCallback onChanged;
  /// بعد حفظ ملاحظة — الشحنةُ كما ردّها الخادم، فتتحدّث البطاقةُ فورًا.
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

  Widget _line(IconData icon, String label, String value, {bool strong = false}) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 17, color: T.inkFaint)),
        const SizedBox(width: 8),
        SizedBox(width: 64, child: Text(label, style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600))),
        const SizedBox(width: 6),
        Expanded(child: Text(value, style: TextStyle(fontSize: strong ? 15 : 14, color: T.ink, fontWeight: strong ? FontWeight.w800 : FontWeight.w600, height: 1.3))),
      ]),
    );
  }

  Widget _noteBox(IconData icon, String title, String text, Color color, {String meta = ''}) => Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 15, color: color),
            const SizedBox(width: 5),
            Flexible(child: Text(title, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: color))),
          ]),
          const SizedBox(height: 4),
          Text(text, style: const TextStyle(fontSize: 13.5, color: T.ink, height: 1.35)),
          if (meta.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(meta, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
        ]),
      );

  Widget _iconBtn(IconData icon, Color color, String tip, VoidCallback? onTap) => Expanded(
        child: Tooltip(
          message: tip,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              height: 48,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: onTap == null ? T.canvas : color.withValues(alpha: 0.09),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 22, color: onTap == null ? T.line : color),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final o = order;
    final st = soStatusOf(vocab, o['status']);
    final phone = _s(o['driverPhone']);
    final tripNote = _s(o['notes']);
    final f = soLatestFollowUp(o);
    final truck = [_s(o['vehiclePlate']), _s(o['truckType'])].where((s) => s.isNotEmpty).join(' · ');
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
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // ── الرأس: الرقم + المصدر + الحالة ──
            Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              SizedBox(width: 40, height: 40, child: Checkbox(value: selected, onChanged: (_) => onToggleSelect())),
              const SizedBox(width: 4),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(soRef(o), maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, fontFamily: 'monospace', color: T.navy)),
                const SizedBox(height: 2),
                Chip2(o['source'] == 'platform' ? tr('المنصّة', 'Platform') : tr('الخاص بنا', 'Ours'),
                    o['source'] == 'platform' ? T.cyan : T.navy),
              ])),
              const SizedBox(width: 6),
              Flexible(child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                decoration: BoxDecoration(color: st.$4, borderRadius: BorderRadius.circular(20)),
                child: Text(tr(st.$2, st.$3), maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w800)),
              )),
            ]),
            const Divider(height: 16),
            // ── الجسم: كلُّ معلومةٍ سطرٌ بعنوانها ──
            _line(Icons.business_outlined, tr('العميل', 'Customer'), _s(o['customerName']).isEmpty ? '—' : _s(o['customerName']), strong: true),
            _line(Icons.trip_origin, tr('من', 'From'), _s(o['fromCity']).isEmpty ? '—' : _s(o['fromCity'])),
            _line(Icons.place_outlined, tr('إلى', 'To'), _s(o['toCity']).isEmpty ? '—' : _s(o['toCity'])),
            _line(Icons.person_outline, tr('السائق', 'Driver'), _s(o['driverName'])),
            _line(Icons.local_shipping_outlined, tr('الشاحنة', 'Truck'), truck),
            _line(Icons.schedule, tr('الاستلام', 'Pickup'), soFmtDT(o['pickupTime'])),
            _line(Icons.inventory_2_outlined, tr('الحمولة', 'Cargo'), _s(o['cargoType'])),
            if (hasMoney)
              _line(Icons.payments_outlined, tr('بيع / شراء', 'Sell / Buy'), '${soMoney(o['sellPrice'])} / ${soMoney(o['buyPrice'])}'),
            // ── الملاحظتان، كلٌّ باسمها ──
            if (tripNote.isNotEmpty)
              _noteBox(Icons.description_outlined, tr('ملاحظة البوليصة', 'Waybill note'), tripNote, T.inkSoft),
            if (f != null)
              _noteBox(Icons.forum_outlined, tr('آخر متابعة', 'Last follow-up'), '${f['note']}', T.violet,
                  meta: [if (_s(f['byName']).isNotEmpty) _s(f['byName']), soAgo(f['at'])].where((s) => s.isNotEmpty).join(' · ')),
            const SizedBox(height: 12),
            // ── الأفعال: أزرارٌ كبيرة ──
            if (editor)
              Row(children: [
                Expanded(child: SizedBox(height: 48, child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: st.$4, padding: const EdgeInsets.symmetric(horizontal: 8)),
                  onPressed: () async { if (await soFollowUp(context, o, vocab)) onChanged(); },
                  icon: const Icon(Icons.sync, size: 19),
                  label: FittedBox(fit: BoxFit.scaleDown, child: Text(tr('تغيير الحالة', 'Change status'))),
                ))),
                const SizedBox(width: 8),
                Expanded(child: SizedBox(height: 48, child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
                  onPressed: () async {
                    final u = await soQuickNote(context, o);
                    if (u != null) onNoteSaved(u);
                  },
                  icon: const Icon(Icons.edit_note, size: 21),
                  label: FittedBox(fit: BoxFit.scaleDown, child: Text(tr('ملاحظة', 'Note'))),
                ))),
              ]),
            if (editor) const SizedBox(height: 8),
            Row(children: [
              _iconBtn(Icons.phone_rounded, T.info, tr('اتصال بالسائق', 'Call driver'), phone.isEmpty ? null : () => callNumber(phone)),
              const SizedBox(width: 8),
              _iconBtn(Icons.chat, const Color(0xFF25D366), tr('واتساب السائق', 'WhatsApp driver'), phone.isEmpty ? null : () => whatsappNumber(phone)),
              const SizedBox(width: 8),
              _iconBtn(Icons.picture_as_pdf_outlined, T.orange, tr('تحميل البوليصة PDF', 'Download waybill PDF'), () => soPrintWaybills(context, [o])),
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
