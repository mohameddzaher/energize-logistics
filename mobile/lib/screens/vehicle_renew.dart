import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import 'vehicle_registry.dart' show fmtDate;

/// Renewal dialogs, twin of components/vehicles/RenewModals on web.
/// Single-document renewal (/renew) and bulk renewal (/renew-bulk), used by the vehicle profile, the family pages and the expiries screen: one dialog, not three copies that diverge at the first edit.

class RenewTarget {
  final String vehicleId;
  final String? driverCardId;
  final String plateNumber;
  final String docKey;
  final String? expiryDate;
  final String documentNumber;
  final String? startDate;
  const RenewTarget({
    required this.vehicleId,
    required this.plateNumber,
    required this.docKey,
    this.driverCardId,
    this.expiryDate,
    this.documentNumber = '',
    this.startDate,
  });
}

/// Document name, the same as DOC_TYPES on web (including the driver card).
const _docNames = {
  'insurance': ('التأمين', 'Insurance'),
  'operatingCard': ('بطاقة التشغيل', 'Operating Card'),
  'vehicleLicense': ('رخصة السير', 'Vehicle License'),
  'inspection': ('الفحص', 'Inspection'),
  'gps': ('اشتراك GPS', 'GPS'),
  'authorization': ('التفويض', 'Authorisation'),
  'driverCard': ('بطاقة السائق', 'Driver card'),
};
String renewDocLabelAr(String k) => _docNames[k]?.$1 ?? k;
String renewDocLabelEn(String k) => _docNames[k]?.$2 ?? k;
String renewDocLabel(String k) => tr(renewDocLabelAr(k), renewDocLabelEn(k));

/// Name of the document number, or null for a document with no separate number (driving licence and inspection).
String? docNumberLabel(String k) => switch (k) {
      'insurance' => tr('رقم وثيقة التأمين', 'Policy number'),
      'operatingCard' => tr('رقم بطاقة التشغيل', 'Operating card number'),
      'gps' => tr('سريال جهاز التتبّع', 'GPS serial'),
      'authorization' => tr('رقم التفويض', 'Authorisation number'),
      'driverCard' => tr('رقم بطاقة السائق', 'Driver card number'),
      _ => null,
    };

Map _sub(Map v, String k) => v[k] is Map ? v[k] as Map : const {};
String _s(dynamic v) => v == null ? '' : v.toString();

/// A document's expiry date and number on a register vehicle row.
String? docDateOf(Map v, String k) {
  final d = switch (k) {
    'insurance' => _sub(v, 'insurance')['expiryDate'],
    'operatingCard' => _sub(v, 'operatingCard')['expiryDate'],
    'vehicleLicense' => _sub(v, 'vehicleLicense')['expiryDate'],
    'inspection' => _sub(v, 'inspection')['expiryDate'],
    'gps' => _sub(v, 'gps')['expiryDate'],
    'authorization' => _sub(v, 'authorizedPerson')['expiryDate'],
    _ => null,
  };
  return d?.toString();
}

String docNumberOf(Map v, String k) => switch (k) {
      'insurance' => _s(_sub(v, 'insurance')['policyNumber']),
      'operatingCard' => _s(_sub(v, 'operatingCard')['cardNumber']),
      'gps' => _s(_sub(v, 'gps')['serialImei']),
      'authorization' => _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
      _ => '',
    };

/// Renewal target from a vehicle row.
RenewTarget renewTargetOf(Map v, String k) => RenewTarget(
      vehicleId: _s(v['_id']),
      plateNumber: _s(v['plateNumber']),
      docKey: k,
      expiryDate: docDateOf(v, k),
      documentNumber: docNumberOf(v, k),
      startDate: k == 'authorization' ? _sub(v, 'authorizedPerson')['startDate']?.toString() : null,
    );

String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

Widget _dateBtn(BuildContext c, String label, String value, ValueChanged<String> on, {DateTime? first}) => OutlinedButton.icon(
      icon: const Icon(Icons.calendar_month_outlined, size: 18),
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
      label: Text('$label: ${value.isEmpty ? tr('اختر', 'Pick') : value}'),
      onPressed: () async {
        final init = DateTime.tryParse(value) ?? DateTime.now();
        final f = first ?? DateTime(2000);
        final d = await showDatePicker(context: c, initialDate: init.isBefore(f) ? f : init, firstDate: f, lastDate: DateTime(2100));
        if (d != null) on(_ymd(d));
      },
    );

/// Renews one document. Returns true if renewed.
Future<bool> showRenewSheet(BuildContext context, RenewTarget row) async {
  final now = DateTime.now();
  final exp = row.expiryDate == null ? null : DateTime.tryParse(row.expiryDate!);
  final base = exp != null && exp.isAfter(now) ? exp : now;
  String newExpiry = _ymd(DateTime(base.year + 1, base.month, base.day));
  String startDate = _ymd(now);
  final hasStart = row.docKey == 'authorization';
  final numLabel = docNumberLabel(row.docKey);
  final number = TextEditingController(), cost = TextEditingController(), reference = TextEditingController(), note = TextEditingController();
  bool busy = false;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('تجديد المستند', 'Renew document'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: T.success)),
          Text('${row.plateNumber} · ${renewDocLabel(row.docKey)} · ${tr('ينتهي', 'expires')} ${fmtDate(row.expiryDate)}',
              style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          const SizedBox(height: 14),
          // Start first and then end, as the period is written.
          if (hasStart) ...[
            _dateBtn(c, '${tr('تاريخ بداية التفويض', 'Authorisation start date')} *${row.startDate != null ? ' (${tr('الحاليّ', 'current')}: ${fmtDate(row.startDate)})' : ''}', startDate, (x) => setS(() => startDate = x)),
            const SizedBox(height: 10),
          ],
          _dateBtn(c, hasStart ? tr('تاريخ النهاية الجديد *', 'New end date *') : tr('تاريخ الانتهاء الجديد *', 'New expiry *'), newExpiry,
              (x) => setS(() => newExpiry = x), first: hasStart ? DateTime.tryParse(startDate) : null),
          if (numLabel != null) ...[
            const SizedBox(height: 10),
            TextField(
              controller: number,
              textDirection: TextDirection.ltr,
              onChanged: (_) => setS(() {}),
              decoration: InputDecoration(
                labelText: '$numLabel — ${tr('اتركه فارغًا إن لم يتغيّر', 'leave blank if unchanged')}',
                hintText: row.documentNumber.isEmpty ? null : row.documentNumber,
                helperText: row.documentNumber.isEmpty ? null
                    : '${tr('الحالي', 'Current')}: ${row.documentNumber}${number.text.trim().isNotEmpty && number.text.trim() != row.documentNumber ? ' · ${tr('سيُستبدل، ويُقيَّد القديم في السجل', 'will be replaced; the old one is kept in the trail')}' : ''}',
              ),
            ),
          ],
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة (ر.س)', 'Cost (SAR)')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: reference, decoration: InputDecoration(labelText: tr('رقم الإيصال', 'Receipt reference')))),
          ]),
          const SizedBox(height: 10),
          TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
          const SizedBox(height: 8),
          Text(tr('يُقيَّد في سجل المركبة: التاريخ السابق والجديد واسم من نفّذه — حتى يبقى لسؤال «متى جُدِّدت وبكم؟» إجابة.',
                  'Recorded on the vehicle: old date, new date and your name — so "when did we renew, and for how much" keeps an answer.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(height: 12),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.success),
            icon: const Icon(Icons.check),
            label: Text(busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('تأكيد التجديد', 'Confirm renewal')),
            onPressed: busy || newExpiry.isEmpty ? null : () async {
              setS(() => busy = true);
              try {
                await Api.instance.post('/api/vehicle-registry/${row.vehicleId.isNotEmpty ? row.vehicleId : (row.driverCardId ?? '')}/renew', {
                  'document': row.docKey,
                  'newExpiry': newExpiry,
                  if (row.driverCardId != null) 'driverCardId': row.driverCardId,
                  if (hasStart && startDate.isNotEmpty) 'startDate': startDate,
                  'documentNumber': number.text.trim(),
                  'cost': cost.text.trim().isEmpty ? null : num.tryParse(cost.text.trim()),
                  'reference': reference.text.trim(),
                  'note': note.text.trim(),
                });
                if (c.mounted) Navigator.pop(c, true);
              } catch (e) {
                setS(() => busy = false);
                if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
              }
            },
          ),
        ]),
      ),
    )),
  );
  if (ok == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التجديد حتى $newExpiry', 'Renewed until $newExpiry'))));
  }
  return ok == true;
}

/// Bulk renewal: one date for the whole selection and optional new numbers per row.
/// The server rejects the whole batch if one line fails, and the line errors are shown.
Future<bool> showBulkRenewSheet(BuildContext context, List<RenewTarget> rows) async {
  String when = '';
  final reference = TextEditingController(), note = TextEditingController();
  final numbers = <int, TextEditingController>{
    for (var i = 0; i < rows.length; i++) if (docNumberLabel(rows[i].docKey) != null) i: TextEditingController(),
  };
  bool showNumbers = false, busy = false;
  List<String> errors = [];
  final byDoc = <String, int>{};
  for (final r in rows) { final k = renewDocLabel(r.docKey); byDoc[k] = (byDoc[k] ?? 0) + 1; }
  final today = _ymd(DateTime.now());
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => StatefulBuilder(builder: (c, setS) {
      final past = when.isNotEmpty && when.compareTo(today) < 0;
      final changed = numbers.entries.where((e) => e.value.text.trim().isNotEmpty && e.value.text.trim() != rows[e.key].documentNumber).length;
      return Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('تجديد جماعي', 'Bulk renewal'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(tr('${rows.length} مستند هيتجدّدوا لنفس التاريخ', '${rows.length} documents will get the same date'), style: const TextStyle(fontSize: 12.5)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: byDoc.entries.map((e) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(8)),
              child: Text('${e.key} ${e.value}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
            )).toList()),
            const SizedBox(height: 12),
            _dateBtn(c, tr('تاريخ الانتهاء الجديد *', 'New expiry date *'), when, (x) => setS(() => when = x), first: DateTime.now()),
            if (past) Text(tr('التاريخ في الماضي — راجعه', 'That date is in the past'), style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700)),
            if (numbers.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                decoration: BoxDecoration(border: Border.all(color: const Color(0xFFE2E8F0)), borderRadius: BorderRadius.circular(10)),
                child: Column(children: [
                  ListTile(
                    dense: true,
                    title: Text(tr('تحديث أرقام المستندات (اختياري)', 'Update document numbers (optional)'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                    subtitle: Text(changed > 0 ? tr('$changed رقمًا سيتغيّر', '$changed will change') : tr('${numbers.length} مستندًا له رقم', '${numbers.length} have a number'), style: const TextStyle(fontSize: 11)),
                    trailing: Icon(showNumbers ? Icons.expand_less : Icons.expand_more),
                    onTap: () => setS(() => showNumbers = !showNumbers),
                  ),
                  if (showNumbers)
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 220),
                      child: ListView(shrinkWrap: true, children: numbers.entries.map((e) => Padding(
                        padding: const EdgeInsets.fromLTRB(10, 2, 10, 6),
                        child: Row(children: [
                          SizedBox(width: 96, child: Text(rows[e.key].plateNumber, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
                          Expanded(child: TextField(
                            controller: e.value,
                            textDirection: TextDirection.ltr,
                            onChanged: (_) => setS(() {}),
                            style: const TextStyle(fontSize: 12),
                            decoration: InputDecoration(isDense: true, hintText: rows[e.key].documentNumber.isEmpty ? tr('الرقم الجديد', 'New number') : rows[e.key].documentNumber),
                          )),
                        ]),
                      )).toList()),
                    ),
                ]),
              ),
            ],
            const SizedBox(height: 10),
            TextField(controller: reference, decoration: InputDecoration(labelText: tr('رقم الإيصال (اختياري)', 'Receipt reference (optional)'))),
            const SizedBox(height: 10),
            TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            if (errors.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: const Color(0xFFFFF1F2), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFFECDD3))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: errors.map((x) => Text(x, style: const TextStyle(fontSize: 11.5, color: Color(0xFF9F1239)))).toList()),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.success),
              onPressed: busy || when.isEmpty || past ? null : () async {
                setS(() { busy = true; errors = []; });
                try {
                  final r = await Api.instance.post('/api/vehicle-registry/renew-bulk', {
                    'items': [
                      for (var i = 0; i < rows.length; i++) {
                        'vehicle': rows[i].vehicleId,
                        'document': rows[i].docKey,
                        if (rows[i].driverCardId != null) 'driverCardId': rows[i].driverCardId,
                        'documentNumber': (numbers[i]?.text ?? '').trim(),
                      },
                    ],
                    'newExpiry': when, 'reference': reference.text.trim(), 'note': note.text.trim(),
                  });
                  final sum = r is Map && r['summary'] is Map ? r['summary'] as Map : const {};
                  if (c.mounted) {
                    ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اتجدّد ${sum['count'] ?? rows.length} مستند على ${sum['vehicles'] ?? '—'} مركبة', 'Renewed ${sum['count'] ?? rows.length} documents'))));
                    Navigator.pop(c, true);
                  }
                } catch (e) {
                  // ApiException carries the response body: the per-line errors, if any.
                  final errs = e is ApiException && e.data['errors'] is List ? e.data['errors'] as List : null;
                  setS(() {
                    busy = false;
                    if (errs != null && errs.isNotEmpty) {
                      errors = errs.map((x) => '${tr('سطر', 'line')} ${x is Map ? x['line'] : ''}: ${x is Map ? x['message'] : x}').toList();
                    }
                  });
                  if (c.mounted) {
                    ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(errors.isNotEmpty
                        ? tr('رُفضت العملية بالكامل — لم تُجدَّد أي مركبة', 'Rejected in full — nothing renewed')
                        : e.toString())));
                  }
                }
              },
              child: Text(busy ? tr('جارٍ التجديد…', 'Renewing…') : when.isEmpty ? tr('اختر التاريخ أولًا', 'Pick the date first') : tr('تجديد ${rows.length} مستند', 'Renew ${rows.length} documents')),
            ),
          ]),
        ),
      );
    }),
  );
  return ok == true;
}
