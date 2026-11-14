import 'package:flutter/services.dart';

/// Store quantity as typed: fractions allowed (1.5 belts), Arabic digits and the Arabic/comma decimal separator accepted.
/// Null when the text is not a number. Rounded to 3 decimals like the server.
num? parseQty(String raw) {
  var t = raw.trim();
  if (t.isEmpty) return null;
  t = t.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}')
      .replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06F0}')
      .replaceAll(RegExp('[٫,]'), '.');
  final v = num.tryParse(t);
  return v == null ? null : (v * 1000).round() / 1000;
}

/// Keyboard with a decimal point on both iOS and Android.
const qtyKeyboard = TextInputType.numberWithOptions(decimal: true);
