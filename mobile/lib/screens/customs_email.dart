import 'package:flutter/material.dart';
import '../ui/email_attachments.dart';
import '../ui/file_upload.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

// Follow-up email to the customer from a clearance, sent from the customs mailbox (web: SendFollowUpEmail).
// The draft is built on the server from the section template and the transaction's stages; optionally about one container.

final _rx = RegExp(r'^[^\s@<>()\[\],;:"]+@[^\s@<>()\[\],;:"]+\.[^\s@<>()\[\],;:"]{2,}$');

/// Opens the send screen; returns true if the message was sent.
Future<bool> openCustomsFollowUpEmail(BuildContext context, String clearanceId) async {
  final r = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => CustomsFollowUpEmailScreen(clearanceId: clearanceId)));
  return r == true;
}

class CustomsFollowUpEmailScreen extends StatefulWidget {
  final String clearanceId;
  const CustomsFollowUpEmailScreen({super.key, required this.clearanceId});
  @override
  State<CustomsFollowUpEmailScreen> createState() => _CustomsFollowUpEmailScreenState();
}

class _CustomsFollowUpEmailScreenState extends State<CustomsFollowUpEmailScreen> {
  Map<String, dynamic>? _d;
  String? _err;
  String _unit = '';
  final List<String> _to = [];
  final List<String> _cc = [];
  final _toCtrl = TextEditingController();
  final _ccCtrl = TextEditingController();
  final _subject = TextEditingController();
  final _body = TextEditingController();
  List<PickedFile> _files = [];
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _toCtrl.dispose();
    _ccCtrl.dispose();
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  // Picking a container rebuilds subject and body for it; addresses typed by hand are kept.
  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}/email-draft${_unit.isEmpty ? '' : '?unit=$_unit'}');
      if (!mounted) return;
      final m = Map<String, dynamic>.from(d as Map);
      setState(() {
        _d = m;
        _err = null;
        if (_to.isEmpty) _to.addAll([for (final e in (m['to'] as List? ?? const [])) '$e']);
        if (_cc.isEmpty) _cc.addAll([for (final e in (m['cc'] as List? ?? const [])) '$e']);
        _subject.text = '${m['subject'] ?? ''}';
        _body.text = '${m['body'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _err = e is ApiException ? e.message : tr('تعذّر إعداد الرسالة', 'Could not prepare the message'));
    }
  }

  void _add(List<String> list, TextEditingController c) {
    final parts = c.text.split(RegExp(r'[\s,;،]+')).map((x) => x.trim().toLowerCase()).where((x) => x.isNotEmpty).toList();
    if (parts.isEmpty) return;
    setState(() {
      for (final x in parts) {
        if (_rx.hasMatch(x) && !list.contains(x)) list.add(x);
      }
      c.text = parts.where((x) => !_rx.hasMatch(x)).join(' ');
    });
  }

  Future<void> _send() async {
    _add(_to, _toCtrl);
    _add(_cc, _ccCtrl);
    if (_to.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أضف بريد العميل في «إلى»', 'Add the customer email in «To»'))));
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await Api.instance.post('/api/customs-clearance/${widget.clearanceId}/email', {
        'to': _to, 'cc': _cc, 'subject': _subject.text, 'body': _body.text, 'attachments': attachmentsPayload(_files),
        'unit': _unit.isEmpty ? null : int.parse(_unit),
      });
      if (!mounted) return;
      final to = (r is Map && r['to'] is List) ? (r['to'] as List).join('، ') : _to.join('، ');
      final saved = r is Map && r['savedToSent'] == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(tr('أُرسلت الرسالة إلى $to${saved ? ' — ونسختُها في «المرسل»' : ''}', 'Sent to $to'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _sending = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الإرسال', 'Send failed'))));
      }
    }
  }

  Widget _emails(String label, List<String> list, TextEditingController c) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
      const SizedBox(height: 4),
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (final e in list)
          InputChip(
            label: Text(e, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 12.5)),
            onDeleted: () => setState(() => list.remove(e)),
            visualDensity: VisualDensity.compact,
          ),
      ]),
      TextField(
        controller: c,
        keyboardType: TextInputType.emailAddress,
        textDirection: TextDirection.ltr,
        decoration: InputDecoration(
          isDense: true,
          hintText: tr('أضف بريدًا…', 'Add an email…'),
          suffixIcon: IconButton(icon: const Icon(Icons.add, color: T.orange), onPressed: () => _add(list, c)),
        ),
        onSubmitted: (_) => _add(list, c),
        onChanged: (v) { if (v.endsWith(' ') || v.endsWith(',') || v.endsWith('،')) _add(list, c); },
      ),
    ]);
  }

  String _when(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    if (d == null) return '';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final units = (d?['units'] as List? ?? const []).whereType<Map>().toList();
    final sent = (d?['sent'] as List? ?? const []).whereType<Map>().toList();
    return AppScaffold(
      title: Text(tr('إرسال بريد متابعة إلى العميل', 'Email a follow-up')),
      body: _err != null && d == null
          ? ErrorRetry(message: _err!, onRetry: () { setState(() => _err = null); _load(); })
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(14), children: [
                  AppCard(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${tr('من', 'From')}: ${d['mailbox'] ?? ''}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 3),
                      Text('${tr('العميل', 'Customer')}: ${'${d['customerName'] ?? ''}'.isNotEmpty ? d['customerName'] : '—'}'),
                    ]),
                  ),
                  const SizedBox(height: 10),
                  if (units.isNotEmpty) ...[
                    DropdownButtonFormField<String>(
                      initialValue: _unit,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('موضوع المتابعة', 'Follow-up about')),
                      items: [
                        DropdownMenuItem(value: '', child: Text(tr('المعاملة كاملة — كلّ الحاويات', 'Whole transaction — all containers'))),
                        for (final u in units)
                          DropdownMenuItem(value: '${u['index']}', child: Text('${tr('حاوية', 'Container')} ${u['number'] ?? ''}')),
                      ],
                      onChanged: (v) { setState(() => _unit = v ?? ''); _load(); },
                    ),
                    const SizedBox(height: 10),
                  ],
                  if ((d['to'] as List? ?? const []).isEmpty)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
                      child: Row(children: [
                        const Icon(Icons.warning_amber_rounded, color: T.warn, size: 18),
                        const SizedBox(width: 6),
                        Expanded(child: Text(tr('لا بريد لهذا العميل في ملفّه بالتخليص — أضفه هنا، ويُفضَّل في ملفّ العميل ليُستخدَم دائمًا.',
                            'No email on the customer file — add it here, and ideally on the customer file.'), style: const TextStyle(fontSize: 12.5))),
                      ]),
                    ),
                  _emails(tr('إلى — يمكن أكثر من بريد', 'To — more than one allowed'), _to, _toCtrl),
                  const SizedBox(height: 12),
                  _emails(tr('نسخة CC — اختياري', 'Cc — optional'), _cc, _ccCtrl),
                  const SizedBox(height: 12),
                  TextField(controller: _subject, decoration: InputDecoration(labelText: tr('الموضوع', 'Subject'))),
                  const SizedBox(height: 10),
                  TextField(controller: _body, minLines: 8, maxLines: 18, decoration: InputDecoration(labelText: tr('نصّ الرسالة', 'Message'), alignLabelWithHint: true)),
                  const SizedBox(height: 10),
                  EmailAttachmentsField(files: _files, onChanged: (v) => setState(() => _files = v)),
                  if ('${d['signature'] ?? ''}'.isNotEmpty || '${d['signatureImage'] ?? ''}'.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('التوقيع (من إعدادات القسم) — يُضاف في آخر الرسالة', 'Signature (from settings) — appended'),
                            style: const TextStyle(fontSize: 11.5, color: T.inkFaint, fontWeight: FontWeight.w700)),
                        if ('${d['signature'] ?? ''}'.isNotEmpty) Text('${d['signature']}', style: const TextStyle(fontSize: 13)),
                        if ('${d['signatureImage'] ?? ''}'.startsWith('data:image'))
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Image.memory(UriData.parse('${d['signatureImage']}').contentAsBytes(), height: 56, fit: BoxFit.contain),
                          ),
                      ]),
                    ),
                  ],
                  if (sent.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    AppCard(
                      padding: const EdgeInsets.all(10),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('آخر ما أُرسل من هذه المعاملة', 'Recently sent from this transaction'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                        for (final s in sent)
                          Text('${_when(s['at'])} · ${s['byName'] ?? ''} → ${((s['to'] as List?) ?? const []).join(', ')}'
                              '${'${s['unit'] ?? ''}'.isNotEmpty ? ' · ${tr('حاوية', 'container')} ${s['unit']}' : ''}',
                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                      ]),
                    ),
                  ],
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.send_rounded, size: 18),
                    label: Text(tr('إرسال الآن', 'Send now')),
                  ),
                ]),
    );
  }
}
