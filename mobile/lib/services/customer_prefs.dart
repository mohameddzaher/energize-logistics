/// Customer shipment preferences (defaults.*) hold several values each; rows saved before hold one string.
/// Same rule as the web (lib/shipmentOrders prefList / prefOnly).
const customerPrefKeys = ['truckType', 'cargoType', 'paymentMethod', 'driverRentType', 'branch'];

List<String> prefList(dynamic v) {
  final raw = v is List ? v : (v == null ? const [] : [v]);
  final out = <String>[];
  for (final x in raw) {
    final s = (x ?? '').toString().trim();
    if (s.isNotEmpty && !out.contains(s)) out.add(s);
  }
  return out;
}

/// The value a form may fill by itself: only when the customer has exactly one; several are offered, never picked silently.
String prefOnly(dynamic v) {
  final l = prefList(v);
  return l.length == 1 ? l.first : '';
}
