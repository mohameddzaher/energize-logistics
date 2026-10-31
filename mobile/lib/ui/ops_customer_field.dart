import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'hr_quick.dart';

/// «العميل» in the operations workflow: picked from the approved customer names, never typed.
/// Mirrors web CustomerNamePicker; the server refuses other names (CUSTOMER_NOT_APPROVED).
// Read on every open, so a customer added a moment ago is listed.
Future<List<String>> _loadNames() => Api.instance.get('/api/workflows/customer-names')
    .then((d) => List<String>.from(((d as Map)['names'] as List? ?? const []).map((e) => '$e')))
    .catchError((_) => <String>[]);

class OpsCustomerField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final bool enabled;
  final VoidCallback? onChanged;
  const OpsCustomerField({super.key, required this.controller, required this.label, this.enabled = true, this.onChanged});
  @override
  State<OpsCustomerField> createState() => _OpsCustomerFieldState();
}

class _OpsCustomerFieldState extends State<OpsCustomerField> {
  Future<void> _pick() async {
    final names = await _loadNames();
    if (!mounted) return;
    final v = await pickFromList(context, title: widget.label, options: names, current: widget.controller.text);
    // '' (clear) is ignored: a workflow keeps a customer.
    if (v == null || v.isEmpty || !mounted) return;
    setState(() => widget.controller.text = v);
    widget.onChanged?.call();
  }

  @override
  Widget build(BuildContext context) => TextField(
        controller: widget.controller,
        readOnly: true,
        enabled: widget.enabled,
        onTap: widget.enabled ? _pick : null,
        decoration: InputDecoration(labelText: widget.label, isDense: true, hintText: tr('اختر العميل', 'Pick the customer'),
            suffixIcon: const Icon(Icons.arrow_drop_down)),
      );
}
