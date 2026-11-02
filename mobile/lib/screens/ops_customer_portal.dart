import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/portal_account_card.dart';

/// Portal account from a customer row in the customer register, counterpart of the key button in CustomersRegister on the web: a dialog with PortalAccountCard for the `shipment_order_customer` record (create, suspend and delete are for account managers only, and the card itself decides that).
Future<bool> openCustomerPortalLogin(BuildContext context, Map<String, dynamic> row) async {
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('${tr('حساب البوابة', 'Portal login')} — ${row['name'] ?? ''}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            PortalAccountCard(source: 'shipment_order_customer', refId: '${row['_id'] ?? ''}', name: '${row['name'] ?? ''}'),
          ]),
        ),
      ),
    ),
  );
  return false;
}
