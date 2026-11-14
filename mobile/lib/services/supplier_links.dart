import 'package:flutter/material.dart';
import 'api.dart';
import 'lang.dart';

/// A carrier truck or driver may work for several suppliers (`supplier` = primary, `suppliers` = all, primary included).
/// Same rules as the web (lib/supplierLinks.ts): the supplier's own come first, the rest are marked as outside its
/// register, and picking one of those asks once whether to link it; declining uses it for this order only.

String _idOf(dynamic r) => r is Map ? '${r['_id'] ?? ''}' : '${r ?? ''}';

List<String> supplierIdsOf(Map? row) {
  final out = <String>[];
  for (final r in [row?['supplier'], ...((row?['suppliers'] as List?) ?? const [])]) {
    final k = _idOf(r);
    if (k.isNotEmpty && k != 'null' && !out.contains(k)) out.add(k);
  }
  return out;
}

bool isLinkedTo(Map? row, String? supplierId) =>
    supplierId != null && supplierId.isNotEmpty && supplierIdsOf(row).contains(supplierId);

String outsideHint(Map row) {
  final names = <String>[];
  for (final r in [row['supplier'], ...((row['suppliers'] as List?) ?? const [])]) {
    final n = r is Map ? '${r['name'] ?? ''}' : '';
    if (n.isNotEmpty && !names.contains(n)) names.add(n);
  }
  final base = tr('من خارج سجلّ هذا المورد', 'Outside this supplier');
  return names.isEmpty ? base : '$base — ${tr('مسجَّل على', 'with')} ${names.join('، ')}';
}

/// Returns true when linked. A refusal or a failed link never blocks the pick.
Future<bool> offerSupplierLink(BuildContext context, {
  required bool vehicle, required String id, required String label, required String supplierId, required String supplierName,
}) async {
  final yes = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(tr('ربطٌ بالمورد', 'Link to supplier')),
      content: Text(vehicle
          ? tr('الشاحنة «$label» ليست في سجلّ المورد «$supplierName». هل تُربط به لتظهر ضمن شاحناته من الآن؟',
              'Truck “$label” is not in “$supplierName”\'s register. Link it so it shows under this supplier from now on?')
          : tr('السائق «$label» ليس في سجلّ المورد «$supplierName». هل يُربط به ليظهر ضمن سائقيه من الآن؟',
              'Driver “$label” is not in “$supplierName”\'s register. Link him so he shows under this supplier from now on?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('لهذه الشحنة فقط', 'This order only'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('ربط بالمورد', 'Link'))),
      ],
    ),
  );
  if (yes != true) return false;
  try {
    await Api.instance.post(vehicle ? '/api/shipment-orders/vehicles/$id/suppliers' : '/api/shipment-orders/drivers/$id/suppliers', {'supplier': supplierId});
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(vehicle
          ? tr('رُبطت الشاحنة بالمورد «$supplierName»', 'Linked to “$supplierName”')
          : tr('رُبط السائق بالمورد «$supplierName»', 'Linked to “$supplierName”'))));
    }
    return true;
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تعذّر الربط', 'Could not link'))));
    return false;
  }
}
