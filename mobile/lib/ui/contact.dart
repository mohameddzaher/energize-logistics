import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/lang.dart';
import 'theme.dart';

/// Call and WhatsApp buttons for any number, shown beside the driver or any contact to call or open a WhatsApp chat without copying the number. WhatsApp normalization: digits only, and a leading zero (Saudi local) becomes 966.

String _digits(String raw) => raw.replaceAll(RegExp(r'[^0-9+]'), '');

/// International WhatsApp format (no + or leading zeros, with country code).
String waNumber(String raw) {
  var d = raw.replaceAll(RegExp(r'[^0-9]'), '');
  if (d.startsWith('00')) { d = d.substring(2); }
  if (d.startsWith('0')) {
    d = '966${d.substring(1)}'; // Saudi local number
  } else if (d.length == 9 && d.startsWith('5')) {
    d = '966$d'; // Mobile number without the leading zero
  }
  return d;
}

Future<void> _open(Uri uri) async {
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

Future<void> callNumber(String phone) => _open(Uri.parse('tel:${_digits(phone)}'));
Future<void> whatsappNumber(String phone) => _open(Uri.parse('https://wa.me/${waNumber(phone)}'));

/// Small row with call and WhatsApp icons; shown only when a number exists.
class ContactButtons extends StatelessWidget {
  final String? phone;
  final double size;
  final bool compact;
  const ContactButtons({super.key, required this.phone, this.size = 20, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final p = (phone ?? '').trim();
    if (p.isEmpty) return const SizedBox.shrink();
    Widget btn(IconData icon, Color color, VoidCallback onTap, String tip) => IconButton(
          visualDensity: compact ? VisualDensity.compact : VisualDensity.standard,
          tooltip: tip,
          icon: Icon(icon, size: size, color: color),
          onPressed: onTap,
        );
    return Row(mainAxisSize: MainAxisSize.min, children: [
      btn(Icons.phone_rounded, T.info, () => callNumber(p), tr('اتصال', 'Call')),
      btn(Icons.chat, const Color(0xFF25D366), () => whatsappNumber(p), tr('واتساب', 'WhatsApp')),
    ]);
  }
}

/// Saudi mobile: prefix always on the left. Digits are Latin and read left to right in every language; in an RTL field `prefixText` would go to the right and read reversed. So the field alone is `ltr`: "+966" on the left, digits after it. The controller holds nine local digits; the full number comes from `saPhone`.
class PhoneSA extends StatelessWidget {
  const PhoneSA({super.key, required this.controller, this.label, this.onChanged, this.hint = '5XXXXXXXX'});

  final TextEditingController controller;
  final String? label;
  /// Called with the full number "+9665XXXXXXXX" or with empty.
  final void Function(String full)? onChanged;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        maxLength: 9,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        onChanged: (v) {
          var d = v.replaceAll(RegExp(r'\D'), '');
          if (d.startsWith('966')) d = d.substring(3);
          if (d.startsWith('0')) d = d.substring(1);
          if (d.length > 9) d = d.substring(0, 9);
          if (d != v) {
            controller.value = TextEditingValue(text: d, selection: TextSelection.collapsed(offset: d.length));
          }
          onChanged?.call(d.isEmpty ? '' : '+966$d');
        },
        decoration: InputDecoration(
          labelText: label,
          prefixText: '+966 ',
          counterText: '',
          hintText: hint,
        ),
      ),
    );
  }
}

/// Nine local digits to the full number as stored in the system.
String saPhone(String local) {
  var d = local.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('966')) d = d.substring(3);
  if (d.startsWith('0')) d = d.substring(1);
  if (d.isEmpty) return '';
  return '+966${d.length > 9 ? d.substring(0, 9) : d}';
}

/// The reverse: the displayed field value from a stored number.
String saLocal(String full) {
  var d = full.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('966')) d = d.substring(3);
  if (d.startsWith('0')) d = d.substring(1);
  return d.length > 9 ? d.substring(0, 9) : d;
}
