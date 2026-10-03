import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/lang.dart';
import 'theme.dart';

/// أزرار الاتصال/الواتساب لأي رقم — نستخدمها جنب السائق (وأي جهة اتصال) عشان
/// نكلّمه أو نفتح شات واتساب فورًا بدون ما ننسخ الرقم.
///
/// تطبيع الرقم للواتساب: أرقام فقط، والصفر البادئ (محلي سعودي) يتحوّل لـ 966.

String _digits(String raw) => raw.replaceAll(RegExp(r'[^0-9+]'), '');

/// الصيغة الدولية للواتساب (بدون + أو أصفار بادئة، مع كود الدولة).
String waNumber(String raw) {
  var d = raw.replaceAll(RegExp(r'[^0-9]'), '');
  if (d.startsWith('00')) { d = d.substring(2); }
  if (d.startsWith('0')) {
    d = '966${d.substring(1)}'; // محلي سعودي
  } else if (d.length == 9 && d.startsWith('5')) {
    d = '966$d'; // جوال بدون صفر
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

/// صفّ صغير فيه أيقونتَي اتصال + واتساب — يظهر فقط لو فيه رقم.
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

/// ── جوّالٌ سعوديّ: المفتاحُ على اليسار دائمًا ────────────────────────────────
///
/// الرقمُ يُكتب بالأرقام اللاتينيّة ويُقرأ من اليسار في كلّ لغة. وحين يكون
/// الحقلُ داخل شاشةٍ عربيّة (`rtl`) يذهب `prefixText` إلى **يمينه** وتجيء
/// الأرقامُ يسارَه: يُقرأ معكوسًا عمّا يُكتب، ومخالفًا لما يراه من يفتح
/// الشاشةَ بالإنجليزيّة. فالحقلُ وحدَه `ltr`: «+966» يسارًا والأرقامُ بعده.
///
/// والمخزَّنُ في المتحكّم تسعُ خاناتٍ محليّة، والكاملُ يُؤخَذ بـ`saPhone`.
class PhoneSA extends StatelessWidget {
  const PhoneSA({super.key, required this.controller, this.label, this.onChanged, this.hint = '5XXXXXXXX'});

  final TextEditingController controller;
  final String? label;
  /// يُنادى بالرقم الكامل «+9665XXXXXXXX» أو بالفراغ.
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

/// تسعُ خاناتٍ محليّة ← الرقمُ الكامل كما يُخزَّن في النظام.
String saPhone(String local) {
  var d = local.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('966')) d = d.substring(3);
  if (d.startsWith('0')) d = d.substring(1);
  if (d.isEmpty) return '';
  return '+966${d.length > 9 ? d.substring(0, 9) : d}';
}

/// والعكسُ: ما يُعرَض في الحقل من رقمٍ مخزَّن.
String saLocal(String full) {
  var d = full.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('966')) d = d.substring(3);
  if (d.startsWith('0')) d = d.substring(1);
  return d.length > 9 ? d.substring(0, 9) : d;
}
