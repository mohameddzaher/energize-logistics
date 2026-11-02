import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

// Send to customer: the account statement by email from the collections mailbox. Counterpart of SendStatementModal and PartyStatementPicker. It takes the screen filter as is (customer, status, period, selection), the same one that prints the account statement PDF, so the employee sees the message filled from the section template and the customer's email from its file, previews the attached PDF, then sends. All computation is on the server.

/// Request parameters as pairs: a key may repeat (sel=a&sel=b, cf_x=...).
typedef QueryPairs = List<(String, String)>;

String queryString(QueryPairs p) =>
    p.map((x) => '${Uri.encodeQueryComponent(x.$1)}=${Uri.encodeQueryComponent(x.$2)}').join('&');

/// Pairs to an object that keeps duplicates as a list, as the web sends in `query`.
Map<String, dynamic> queryObject(QueryPairs p) {
  final out = <String, dynamic>{};
  for (final (k, v) in p) {
    final cur = out[k];
    if (cur == null) {
      out[k] = v;
    } else if (cur is List) {
      cur.add(v);
    } else {
      out[k] = [cur, v];
    }
  }
  return out;
}

/// Account statement PDF for what is on screen; opened for preview, print or share.
Future<void> openCollectionsStatement(BuildContext context, String kind, QueryPairs params) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(SnackBar(content: Text(tr('جارٍ إعداد الكشف…', 'Preparing the statement…')), duration: const Duration(seconds: 2)));
  try {
    final bytes = await Api.instance.getBytes('/api/collections-dept/invoices/$kind/statement?${queryString(params)}');
    await Printing.layoutPdf(onLayout: (_) async => bytes, name: '$kind-invoices-statement');
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر إصدار كشف الحساب', 'Could not issue the statement'))));
  }
}

/// Opens the send screen; returns true if the message was sent.
Future<bool> openSendStatement(BuildContext context, {required String kind, required QueryPairs params}) async {
  final r = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => SendStatementScreen(kind: kind, params: params)));
  return r == true;
}

final _rx = RegExp(r'^[^\s@<>()\[\],;:"]+@[^\s@<>()\[\],;:"]+\.[^\s@<>()\[\],;:"]{2,}$');

class SendStatementScreen extends StatefulWidget {
  final String kind;
  final QueryPairs params;
  const SendStatementScreen({super.key, required this.kind, required this.params});
  @override
  State<SendStatementScreen> createState() => _SendStatementScreenState();
}

class _SendStatementScreenState extends State<SendStatementScreen> {
  Map<String, dynamic>? _d;
  String? _err;
  final List<String> _to = [];
  final List<String> _cc = [];
  final _toCtrl = TextEditingController();
  final _ccCtrl = TextEditingController();
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _excel = true;
  bool _pdfBusy = false;
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

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/collections-dept/invoices/${widget.kind}/send-draft?${queryString(widget.params)}');
      if (!mounted) return;
      final m = Map<String, dynamic>.from(d as Map);
      setState(() {
        _d = m;
        _to..clear()..addAll([for (final e in (m['to'] as List? ?? const [])) '$e']);
        _subject.text = '${m['subject'] ?? ''}';
        _body.text = '${m['body'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _err = e is ApiException ? e.message : tr('تعذّر إعداد الرسالة', 'Could not prepare the message'));
    }
  }

  /// Splits the typed text on commas and spaces; valid entries are added and the rest stays in the field.
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

  Future<void> _preview() async {
    if (_pdfBusy) return;
    setState(() => _pdfBusy = true);
    try {
      final bytes = await Api.instance.getBytes('/api/collections-dept/invoices/${widget.kind}/statement?${queryString(widget.params)}');
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'statement');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر إعداد الكشف', 'Could not build the statement'))));
      }
    }
    if (mounted) setState(() => _pdfBusy = false);
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
      final r = await Api.instance.post('/api/collections-dept/invoices/${widget.kind}/send', {
        'query': queryObject(widget.params), 'to': _to, 'cc': _cc,
        'subject': _subject.text, 'body': _body.text, 'attachExcel': _excel, 'lang': Lang.instance.ar ? 'ar' : 'en',
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

  Widget _warn(String text) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: T.warn, size: 18),
          const SizedBox(width: 6),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 12.5))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('إرسال كشف الحساب إلى العميل', 'Email the statement')),
      body: _err != null
          ? ErrorRetry(message: _err!, onRetry: () { setState(() => _err = null); _load(); })
          : d == null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 10),
                  Text(tr('جارٍ إعداد الرسالة والكشف…', 'Preparing…'), style: const TextStyle(color: T.inkSoft)),
                ]))
              : ListView(padding: const EdgeInsets.all(14), children: [
                  AppCard(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${tr('من', 'From')}: ${d['mailbox'] ?? ''}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 3),
                      Text('${tr('العميل', 'Customer')}: ${'${d['partyName'] ?? ''}'.isNotEmpty ? d['partyName'] : tr('عدّة عملاء', 'Several customers')}'
                          '${'${d['partyCode'] ?? ''}'.isNotEmpty ? ' (${d['partyCode']})' : ''}'),
                      const SizedBox(height: 3),
                      Text(tr('${d['rows'] ?? 0} فاتورة في الكشف، منها ${d['openCount'] ?? 0} غير مسدّدة', '${d['rows'] ?? 0} invoices, ${d['openCount'] ?? 0} unpaid'),
                          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                    ]),
                  ),
                  const SizedBox(height: 10),
                  if (d['multipleCustomers'] == true)
                    _warn(tr('الفلتر يضمّ أكثر من عميل — فلتر على عميلٍ واحد ليصله كشفُه وحده.', 'The filter spans several customers — filter to one customer first.')),
                  if ((d['to'] as List? ?? const []).isEmpty && '${d['partyName'] ?? ''}'.isNotEmpty)
                    _warn(tr('لا بريد لهذا العميل في ملفّه — أضفه هنا، ويُفضَّل في ملفّ العميل ليُستخدَم دائمًا.', 'No email on file — add it here, and ideally in the customer profile.')),
                  _emails(tr('إلى — يمكن أكثر من بريد', 'To — more than one allowed'), _to, _toCtrl),
                  const SizedBox(height: 12),
                  _emails(tr('نسخة CC — يمكن أكثر من بريد (اختياري)', 'Cc — more than one allowed (optional)'), _cc, _ccCtrl),
                  const SizedBox(height: 12),
                  TextField(controller: _subject, decoration: InputDecoration(labelText: tr('الموضوع', 'Subject'))),
                  const SizedBox(height: 10),
                  TextField(controller: _body, minLines: 6, maxLines: 14, decoration: InputDecoration(labelText: tr('نصّ الرسالة', 'Message'), alignLabelWithHint: true)),
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
                  const SizedBox(height: 10),
                  AppCard(
                    padding: const EdgeInsets.all(10),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('المرفقات', 'Attachments'), style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      OutlinedButton.icon(
                        onPressed: _pdfBusy ? null : _preview,
                        icon: _pdfBusy
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                        label: Text(tr('كشف الحساب PDF — معاينة', 'Statement PDF — preview')),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        value: _excel,
                        onChanged: (v) => setState(() => _excel = v ?? true),
                        title: Text(tr('وملف Excel بالفواتير', 'and an Excel file')),
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                    ]),
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: T.orange, minimumSize: const Size.fromHeight(46)),
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.send_rounded),
                    label: Text(tr('إرسال الآن', 'Send now')),
                  ),
                ]),
    );
  }
}

// Send account statement from the customer file: type, period, status and specific marked invoices, then the preview and send screen with the same selection, so the attached statement is exactly what was chosen here.

Future<bool> openPartyStatementPicker(BuildContext context, {required String partyName, required String defaultKind}) async {
  final r = await Navigator.push<bool>(context,
      MaterialPageRoute(builder: (_) => PartyStatementPickerScreen(partyName: partyName, defaultKind: defaultKind)));
  return r == true;
}

class PartyStatementPickerScreen extends StatefulWidget {
  final String partyName;
  final String defaultKind;
  const PartyStatementPickerScreen({super.key, required this.partyName, required this.defaultKind});
  @override
  State<PartyStatementPickerScreen> createState() => _PartyStatementPickerScreenState();
}

const _states = [('', 'الكل', 'All'), ('no', 'غير مسدّدة', 'Unpaid'), ('partial', 'جزئية', 'Partial'), ('yes', 'مسدّدة', 'Paid')];

String _norm(dynamic s) => '${s ?? ''}'.replaceAll(RegExp(r'[\s ​-‏]+'), ' ').trim();
String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _money2(dynamic n) {
  final v = (n is num) ? n : num.tryParse('$n') ?? 0;
  final s = v.toStringAsFixed(2);
  final parts = s.split('.');
  return '${parts[0].replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},')}.${parts[1]}';
}
String _day(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  if (d == null) return '—';
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.day.toString().padLeft(2, '0')}/${r.month.toString().padLeft(2, '0')}/${r.year}';
}

class _PartyStatementPickerScreenState extends State<PartyStatementPickerScreen> {
  late String _kind = widget.defaultKind;
  String _from = '';
  String _to = '';
  String _state = 'no';
  List<Map<String, dynamic>>? _rows;
  final Set<String> _picked = {};
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _keyOf(Map r) => _kind == 'cash' ? '${r['_id']}' : '${r['invoiceNumber']}';

  Future<void> _load() async {
    final mine = ++_seq;
    setState(() { _rows = null; _picked.clear(); });
    final p = <(String, String)>[('customer', widget.partyName), ('limit', '500'), ('page', '1'),
      if (_from.isNotEmpty) ('from', _from), if (_to.isNotEmpty) ('to', _to), if (_state.isNotEmpty) ('collected', _state)];
    try {
      final d = await Api.instance.get('/api/collections-dept/invoices/$_kind?${queryString(p)}');
      if (!mounted || mine != _seq) return;
      final all = [for (final r in (d['invoices'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
      // A name matching another, longer customer does not enter this one's statement.
      setState(() => _rows = all.where((r) => _norm(r['customer']) == _norm(widget.partyName) || _norm(r['customer']).isEmpty).toList());
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _rows = []);
    }
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context, firstDate: DateTime(2020), lastDate: DateTime(now.year + 1),
      initialDateRange: _from.isNotEmpty && _to.isNotEmpty ? DateTimeRange(start: DateTime.parse(_from), end: DateTime.parse(_to)) : null,
    );
    if (r == null) return;
    setState(() { _from = _ymd(r.start); _to = _ymd(r.end); });
    _load();
  }

  void _next() {
    final rows = _rows ?? const [];
    final p = <(String, String)>[('customer', widget.partyName), ('lang', Lang.instance.ar ? 'ar' : 'en'),
      if (_from.isNotEmpty) ('from', _from), if (_to.isNotEmpty) ('to', _to), if (_state.isNotEmpty) ('collected', _state)];
    // The selected only if any are selected; otherwise all of this customer's rows.
    final keys = _picked.isNotEmpty ? _picked.toList() : rows.map(_keyOf).toList();
    for (final k in keys) {
      p.add(('sel', k));
    }
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => SendStatementScreen(kind: _kind, params: p)));
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows ?? const <Map<String, dynamic>>[];
    final due = rows.fold<num>(0, (a, r) => a + ((r['remaining'] is num) ? r['remaining'] as num : 0));
    final allOn = rows.isNotEmpty && rows.every((r) => _picked.contains(_keyOf(r)));
    return AppScaffold(
      title: Text('${tr('إرسال كشف حساب', 'Email a statement')} — ${widget.partyName}'),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'cash', label: Text(tr('فواتير كاش', 'Cash'))),
                ButtonSegment(value: 'tax', label: Text(tr('فواتير ضريبية', 'Tax'))),
              ],
              selected: {_kind},
              onSelectionChanged: (s) { setState(() => _kind = s.first); _load(); },
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final s in _states)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 6),
                    child: ChoiceChip(
                      label: Text(tr(s.$2, s.$3)),
                      selected: _state == s.$1,
                      onSelected: (_) { setState(() => _state = s.$1); _load(); },
                    ),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.date_range_rounded, size: 16),
                  label: Text(_from.isEmpty ? tr('كل الفترات', 'Any period') : '$_from → $_to'),
                  onPressed: _pickRange,
                ),
                if (_from.isNotEmpty)
                  IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () { setState(() { _from = ''; _to = ''; }); _load(); }),
              ]),
            ),
            const SizedBox(height: 6),
            Text(
              _picked.isNotEmpty
                  ? tr('سيُرسَل ${_picked.length} فاتورة مختارة', '${_picked.length} selected invoices will be sent')
                  : tr('لم تختر فواتير — سيُرسَل الكلّ (${rows.length}) · المتبقّي ${_money2(due)} ريال', 'Nothing selected — all ${rows.length} will be sent · due ${_money2(due)}'),
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            if (rows.isNotEmpty)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: allOn,
                title: Text(tr('تحديد الكل', 'Select all')),
                onChanged: (_) => setState(() { if (allOn) { _picked.clear(); } else { _picked.addAll(rows.map(_keyOf)); } }),
              ),
          ]),
        ),
        Expanded(
          child: _rows == null
              ? const Center(child: CircularProgressIndicator())
              : rows.isEmpty
                  ? EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا فواتير بهذا الاختيار — يمكن الإرسال وسيقول الكشفُ ذلك.', 'No invoices for this choice.'))
                  : ListView.builder(
                      itemCount: rows.length,
                      itemBuilder: (c, i) {
                        final r = rows[i];
                        final k = _keyOf(r);
                        return CheckboxListTile(
                          controlAffinity: ListTileControlAffinity.leading,
                          value: _picked.contains(k),
                          onChanged: (_) => setState(() { if (!_picked.remove(k)) _picked.add(k); }),
                          title: Text(_kind == 'cash' ? '${r['reportNumber'] ?? ''}' : '${r['invoiceNumber'] ?? ''}',
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                            '${_day(_kind == 'cash' ? r['paymentDate'] : r['invoiceDate'])} · ${tr('القيمة', 'Value')} ${_money2(r['value'])}'
                            ' · ${tr('المتبقّي', 'Due')} ${_money2(r['remaining'])}'
                            '${r['ageDays'] != null ? ' · ${r['ageDays']} ${tr('يوم', 'd')}' : ''}',
                            style: const TextStyle(fontSize: 12),
                          ),
                        );
                      },
                    ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.orange, minimumSize: const Size.fromHeight(46)),
              onPressed: _rows == null ? null : _next,
              icon: const Icon(Icons.arrow_forward_rounded),
              label: Text(tr('التالي: معاينة وإرسال', 'Next: preview & send')),
            ),
          ),
        ),
      ]),
    );
  }
}
