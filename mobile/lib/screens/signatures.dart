import 'dart:convert';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// توقيعاتي — إدارة تواقيع المستخدم (صورة توقيع) لاستخدامها في اعتماد الإجازات
/// وغيرها. /api/auth/signatures (GET/POST/PUT/DELETE). الصورة تُرفع كـ base64.
class SignaturesScreen extends StatefulWidget {
  const SignaturesScreen({super.key});
  @override
  State<SignaturesScreen> createState() => _SignaturesScreenState();
}

class _SignaturesScreenState extends State<SignaturesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/auth/signatures');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['signatures'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _add() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    if (!picked.dataUrl.startsWith('data:image/')) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('التوقيع لازم يكون صورة (PNG/JPG)', 'Signature must be an image'))));
      return;
    }
    if (picked.sizeBytes > 300 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('الصورة كبيرة (أقصى ~300KB)', 'Image too large (~300KB max)'))));
      return;
    }
    final name = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    bool makeDefault = _rows.isEmpty;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
        title: Text(tr('توقيع جديد', 'New signature')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            height: 90,
            decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFE2E8F0)), borderRadius: BorderRadius.circular(10)),
            alignment: Alignment.center,
            child: Image.memory(base64Decode(picked.dataUrl.split(',').last), fit: BoxFit.contain),
          ),
          const SizedBox(height: 10),
          TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم التوقيع', 'Signature name'))),
          const SizedBox(height: 4),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero, dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            value: makeDefault,
            title: Text(tr('تعيينه كافتراضي', 'Set as default'), style: const TextStyle(fontSize: 13)),
            onChanged: (v) => setD(() => makeDefault = v ?? false),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/auth/signatures', {
        'name': name.text.trim().isEmpty ? 'توقيع' : name.text.trim(),
        'dataUrl': picked.dataUrl,
        'isDefault': makeDefault,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _setDefault(Map<String, dynamic> s) async {
    try { await Api.instance.put('/api/auth/signatures/${s['_id']}', {'isDefault': true}); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Future<void> _delete(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف التوقيع', 'Delete signature')),
        content: Text(tr('حذف هذا التوقيع؟', 'Delete this signature?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/auth/signatures/${s['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('توقيعاتي', 'My Signatures')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: _add,
        icon: const Icon(Icons.add), label: Text(tr('توقيع', 'Signature')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 70),
                          EmptyState(icon: Icons.draw_outlined, title: tr('لا توجد توقيعات', 'No signatures'), subtitle: tr('أضِف صورة توقيعك لاستخدامها في اعتماد الإجازات.', 'Add a signature image to sign leave approvals.')),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) {
                            final s = _rows[i];
                            final isDefault = s['isDefault'] == true;
                            final data = (s['dataUrl'] ?? '').toString();
                            return AppCard(
                              topAccent: isDefault ? T.success : null,
                              child: Row(children: [
                                Container(
                                  width: 90, height: 54,
                                  decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFE2E8F0)), borderRadius: BorderRadius.circular(8)),
                                  alignment: Alignment.center,
                                  child: data.contains(',')
                                      ? Image.memory(base64Decode(data.split(',').last), fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Icon(Icons.draw_outlined, color: T.inkFaint))
                                      : const Icon(Icons.draw_outlined, color: T.inkFaint),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text((s['name'] ?? 'توقيع').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                    if (isDefault) Padding(padding: const EdgeInsets.only(top: 4), child: Chip2(tr('افتراضي', 'Default'), T.success)),
                                  ]),
                                ),
                                PopupMenuButton<int>(
                                  icon: const Icon(Icons.more_vert, color: T.inkFaint),
                                  onSelected: (v) => v == 0 ? _setDefault(s) : _delete(s),
                                  itemBuilder: (c2) => [
                                    if (!isDefault) PopupMenuItem(value: 0, child: Row(children: [const Icon(Icons.star_outline, size: 18, color: T.success), const SizedBox(width: 10), Text(tr('تعيين افتراضي', 'Set default'))])),
                                    PopupMenuItem(value: 1, child: Row(children: [const Icon(Icons.delete_outline, size: 18, color: T.danger), const SizedBox(width: 10), Text(tr('حذف', 'Delete'))])),
                                  ],
                                ),
                              ]),
                            );
                          },
                        ),
                ),
    );
  }
}
