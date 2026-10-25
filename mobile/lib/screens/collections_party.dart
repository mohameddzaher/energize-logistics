import 'dart:async';
import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/portal_account_card.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../resource/configs.dart' show collectionsCanEdit;
import 'collection_attachments.dart';
import 'collections_invoices.dart' show openTaxInvoice;
import 'collections_send.dart';
import 'fleet_customer_presence.dart';
import 'jp.dart' show JpTaskPanel;

// ═════════════════════════════════════════════════════════════════════════
// ملفُّ الطرف — عميلًا كان أو موردًا. نظيرُ /system/collections-dept/parties/[id].
//
// أرقامُه، وبياناتُه، وحركتُه بالشهر، وفواتيرُه ومديونيّتُه من دفتر التحصيل،
// ومتابعاتُه (تُضاف وتُقفَل وتُحذف)، وشغلُه من كلّ باب، وكشوفُه بصفحاتها —
// و«إرسال كشف حساب» و«كشف حساب PDF» بمداه، والتصدير.
// ═════════════════════════════════════════════════════════════════════════

String _s(Map r, String k) => '${r[k] ?? ''}';
num _num(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _m(dynamic n) => _num(n).round().toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
String _dt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  if (d == null) return '—';
  final r = d.toUtc().add(const Duration(hours: 3));
  return '${r.day.toString().padLeft(2, '0')}/${r.month.toString().padLeft(2, '0')}/${r.year}';
}
String _ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

const _fuTypes = {
  'call': ('اتصال', 'Call'),
  'whatsapp': ('واتساب', 'WhatsApp'),
  'email': ('بريد', 'Email'),
  'visit': ('زيارة', 'Visit'),
  'promise': ('وعد بالسداد', 'Promise'),
  'note': ('ملاحظة', 'Note'),
};

class CollectionsPartyScreen extends StatefulWidget {
  final String id;
  const CollectionsPartyScreen({super.key, required this.id});
  @override
  State<CollectionsPartyScreen> createState() => _CollectionsPartyScreenState();
}

class _CollectionsPartyScreenState extends State<CollectionsPartyScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  int _page = 1;
  int _seq = 0;
  List<Map<String, dynamic>> _fus = [];
  bool _showPaid = false;
  // مدى كشف الحساب — يبدأ على الشهر الجاري.
  late DateTime _stFrom = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _stTo = DateTime.now();
  late final void Function(dynamic) _onParty;
  late final void Function(dynamic) _onChanged;

  @override
  void initState() {
    super.initState();
    _load();
    _loadFollowUps();
    // تعديلُ الطرف من أيّ شاشة، وبريدُ كشفٍ أُرسل إليه — يظهر هنا في لحظته.
    _onParty = (d) { if (d is! Map || '${d['id'] ?? ''}'.isEmpty || '${d['id']}' == widget.id) _load(); };
    _onChanged = (d) {
      if (d is Map && d['source'] == 'email' && ('${d['party'] ?? ''}'.isEmpty || '${d['party']}' == widget.id)) _load();
    };
    Live.instance.onData('collections:party', _onParty);
    Live.instance.onData('collections:changed', _onChanged);
  }

  @override
  void dispose() {
    Live.instance.offData('collections:party', _onParty);
    Live.instance.offData('collections:changed', _onChanged);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/collections-dept/parties/${widget.id}?page=$_page&limit=100');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e is ApiException ? e.message : '$e');
    }
  }

  Future<void> _loadFollowUps() async {
    try {
      final d = await Api.instance.get('/api/collections-dept/parties/${widget.id}/follow-ups');
      if (!mounted) return;
      setState(() => _fus = [for (final f in (d['followUps'] as List? ?? const [])) Map<String, dynamic>.from(f as Map)]);
    } catch (_) {/* الملفُّ يُقرأ ولو تعذّرت المتابعات */}
  }

  void _snack(Object e, String fallback) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : fallback)));
  }

  Future<void> _closeFu(Map f) async {
    try {
      await Api.instance.put('/api/collections-dept/follow-ups/${f['_id']}', {'close': '${f['closedAt'] ?? ''}'.isEmpty});
      _loadFollowUps();
    } catch (e) { _snack(e, tr('تعذّر التحديث', 'Could not update')); }
  }

  Future<void> _removeFu(Map f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(tr('حذف هذه المتابعة؟', 'Delete this follow-up?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/collections-dept/follow-ups/${f['_id']}');
      _loadFollowUps();
    } catch (e) { _snack(e, tr('تعذّر الحذف', 'Could not delete')); }
  }

  Future<void> _newFollowUp() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _FollowUpSheet(partyId: widget.id),
    );
    if (saved == true) { _loadFollowUps(); _load(); }
  }

  Future<void> _pickStRange() async {
    final r = await showDateRangePicker(
      context: context, firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 1),
      initialDateRange: DateTimeRange(start: _stFrom, end: _stTo),
    );
    if (r != null) setState(() { _stFrom = r.start; _stTo = r.end; });
  }

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Widget _kv(String label, dynamic value, {String? tel, String? mail}) {
    final v = '${value ?? ''}';
    if (v.isEmpty || v == '0') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 120, child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
        Expanded(
          child: InkWell(
            onTap: tel != null ? () => _call(tel) : mail != null ? () => launchUrl(Uri(scheme: 'mailto', path: mail)) : null,
            child: Text(v, style: TextStyle(fontSize: 13, color: tel != null || mail != null ? T.orange : T.ink)),
          ),
        ),
      ]),
    );
  }

  Widget _section(String title, List<Widget> children) {
    final shown = children.where((w) => w is! SizedBox).toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          ...children,
        ]),
      ),
    );
  }

  Widget _stat(String l, String v, [Color c = T.ink]) => Container(
        width: 140,
        margin: const EdgeInsetsDirectional.only(end: 8),
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l, style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(v, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: c)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) {
      return AppScaffold(
        title: Text(tr('ملفّ الطرف', 'Party file')),
        body: _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()),
      );
    }
    final p = Map<String, dynamic>.from((d['party'] as Map?) ?? const {});
    final customer = _s(p, 'kind') != 'supplier';
    final totalLabel = customer ? tr('إجمالي المفوتَر', 'Total invoiced') : tr('إجمالي المشتريات', 'Total purchased');
    final settledLabel = customer ? tr('المحصَّل', 'Collected') : tr('المسدَّد', 'Paid');
    final dueLabel = customer ? tr('المستحق لنا', 'Receivable') : tr('المستحق عليه', 'Payable');
    final openLabel = customer ? tr('فواتير لم تُحصَّل', 'Open invoices') : tr('كشوف لم تُسدَّد', 'Unpaid reports');
    final openCount = customer ? _num(p['openInvoices']) : _num(p['openReports']);
    final valueKey = customer ? 'sellingValue' : 'purchaseValue';
    final closedKey = customer ? 'collectionDate' : 'paymentDate';
    final money = (d['money'] as Map?) ?? const {};
    final mt = (money['totals'] as Map?) ?? const {};
    final invoices = [for (final i in (money['invoices'] as List? ?? const [])) Map<String, dynamic>.from(i as Map)];
    final shownInv = invoices.where((i) => _showPaid || i['collected'] != true).toList();
    final reports = [for (final r in (d['reports'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final monthly = [for (final r in (d['monthly'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final work = (d['work'] as Map?) ?? const {};
    final loads = [for (final r in (work['fleetLoads'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final orders = [for (final r in (work['orders'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
    final emails = (p['emails'] is List && (p['emails'] as List).isNotEmpty) ? [for (final e in p['emails'] as List) '$e'] : [if (_s(p, 'email').isNotEmpty) _s(p, 'email')];
    final pages = _num(d['pages']).toInt();
    final maxMonth = monthly.fold<num>(1, (a, r) => [a, _num(r['total']), _num(r['settled']), _num(r['outstanding'])].reduce((x, y) => x > y ? x : y));

    final reportCols = [
      ExportCol('رقم الكشف', 'Report no.', (r) => r['reportNumber']),
      ExportCol('التاريخ', 'Date', (r) => _dt(r['reportDate'])),
      ExportCol('من', 'From', (r) => r['fromLocation']),
      ExportCol('إلى', 'To', (r) => r['toLocation']),
      ExportCol('الفرع', 'Branch', (r) => r['branch']),
      ExportCol('رقم السيارة', 'Vehicle', (r) => r['carNumber']),
      customer ? ExportCol('قيمة البيع', 'Selling', (r) => r[valueKey]) : ExportCol('قيمة الشراء', 'Purchase', (r) => r[valueKey]),
      ExportCol('رقم الفاتورة', 'Invoice no.', (r) => r['invoiceNumber']),
      customer ? ExportCol('تاريخ التحصيل', 'Collected on', (r) => _dt(r[closedKey])) : ExportCol('تاريخ السداد', 'Paid on', (r) => _dt(r[closedKey])),
      ExportCol('رقم السند', 'Voucher', (r) => r['documentNumber']),
    ];
    final invCols = [
      ExportCol('رقم الفاتورة', 'Invoice', (r) => r['invoiceNumber']),
      ExportCol('تاريخها', 'Date', (r) => _dt(r['invoiceDate'])),
      ExportCol('التسليم', 'Delivered', (r) => _dt(r['deliveryDate'])),
      ExportCol('القيمة', 'Value', (r) => r['total']),
      ExportCol('تاريخ التحصيل', 'Collected on', (r) => _dt(r['collectionDate'])),
      ExportCol('العمر (يوم)', 'Age (days)', (r) => r['ageDays']),
    ];

    return AppScaffold(
      title: Text(_s(p, 'name')),
      actions: [
        if (customer && collectionsCanEdit)
          IconButton(
            tooltip: tr('إرسال كشف حساب', 'Email a statement'),
            icon: const Icon(Icons.forward_to_inbox_rounded, color: T.orange),
            onPressed: () => openPartyStatementPicker(context, partyName: _s(p, 'name'), defaultKind: _s(p, 'paymentType') == 'tax' ? 'tax' : 'cash'),
          ),
        IconButton(
          tooltip: tr('تصدير Excel', 'Export to Excel'),
          icon: const Icon(Icons.file_download_outlined),
          onPressed: () => exportExcel(context, fileName: 'collections-${_s(p, 'name')}', sheets: [
            (tr('الكشوف', 'Reports'), reportCols, reports),
            if (shownInv.isNotEmpty) (tr('الفواتير', 'Invoices'), invCols, shownInv),
          ]),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () async { await Future.wait([_load(), _loadFollowUps()]); },
        child: ListView(padding: const EdgeInsets.all(12), children: [
          Text([_s(p, 'city'), _s(p, 'partyType'), _s(p, 'status')].where((x) => x.isNotEmpty).join(' · '),
              style: const TextStyle(color: T.inkSoft)),
          const SizedBox(height: 8),
          // ── كشفُ حسابٍ PDF بمداه — «اطبعه لي عن شهر ٨» ──────────────────
          if (customer)
            AppCard(
              padding: const EdgeInsets.all(10),
              child: Row(children: [
                Expanded(
                  child: InkWell(
                    onTap: _pickStRange,
                    child: Row(children: [
                      const Icon(Icons.date_range_rounded, size: 18, color: T.inkSoft),
                      const SizedBox(width: 6),
                      Flexible(child: Text('${_ymd(_stFrom)} → ${_ymd(_stTo)}', style: const TextStyle(fontSize: 12.5))),
                    ]),
                  ),
                ),
                _StatementButton(name: _s(p, 'name'), from: _ymd(_stFrom), to: _ymd(_stTo)),
              ]),
            ),
          if (customer) ...[
            const SizedBox(height: 8),
            CustomerPresence(reg: 'collections', id: _s(p, '_id').isNotEmpty ? _s(p, '_id') : widget.id, onChanged: _load),
          ],
          if (customer && p['crmCompany'] != null)
            PortalAccountCard(source: 'crm_company', refId: p['crmCompany'] is Map ? _s(p['crmCompany'] as Map, '_id') : '${p['crmCompany']}', name: _s(p, 'name')),
          const SizedBox(height: 10),
          SizedBox(
            height: 66,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              _stat(tr('كشوف', 'Reports'), _m(p['reports'])),
              _stat(totalLabel, _m(p['total'])),
              _stat(settledLabel, _m(p['settled']), T.success),
              _stat(dueLabel, _m(p['outstanding']), _num(p['outstanding']) > 0 ? T.danger : T.inkFaint),
              _stat(openLabel, _m(openCount), openCount > 0 ? T.warn : T.inkFaint),
            ]),
          ),
          const SizedBox(height: 10),
          _section(tr('التواصل', 'Contact'), [
            _kv(tr('الجوال', 'Phone'), p['phone'], tel: _s(p, 'phone').isEmpty ? null : _s(p, 'phone')),
            _kv(tr('البريد', 'Email'), emails.join(' · '), mail: emails.isEmpty ? null : emails.first),
            _kv(tr('مسؤول التواصل', 'Contact'), p['contactPerson']),
            _kv(tr('جوال المسؤول', 'Contact phone'), p['contactPhone'], tel: _s(p, 'contactPhone').isEmpty ? null : _s(p, 'contactPhone')),
            _kv(tr('محاسب الطرف', 'Their accountant'), p['accountantName']),
            _kv(tr('جوال المحاسب', 'Accountant phone'), p['accountantPhone'], tel: _s(p, 'accountantPhone').isEmpty ? null : _s(p, 'accountantPhone')),
          ]),
          _section(tr('الهوية التجارية', 'Commercial identity'), [
            _kv(tr('السجل التجاري', 'CR'), p['commercialRegister']),
            _kv(tr('الرقم الضريبي', 'Tax no.'), p['taxNumber']),
            _kv(tr('الآيبان', 'IBAN'), p['iban']),
            _kv(tr('البنك', 'Bank'), p['bankName']),
            _kv(tr('العنوان', 'Address'), p['address']),
          ]),
          _section(tr('الحساب', 'The account'), [
            _kv(tr('الكود', 'Code'), p['code']),
            _kv(tr('موظف التحصيل', 'Collection officer'), p['officerIsDefault'] == true && _s(p, 'effectiveOfficer').isNotEmpty
                ? '${p['effectiveOfficer']} — ${tr('مدير القسم (غير مُسنَد)', 'dept. manager (unassigned)')}'
                : (_s(p, 'effectiveOfficer').isNotEmpty ? p['effectiveOfficer'] : p['collectionOfficer'])),
            _kv(tr('التقييم', 'Grade'), p['grade']),
            _kv(tr('القسم', 'Department'), p['department']),
            _kv(tr('فرع العميل', 'Location'), p['hoLocation']),
            _kv(tr('المنطقة', 'Region'), p['region']),
            _kv(tr('مندوب المبيعات', 'Sales manager'), (p['salesManagers'] as List? ?? const []).join(' / ')),
          ]),
          _section(tr('شروط التحصيل', 'Collection terms'), [
            if (customer) _kv(tr('نوع الحساب', 'Account type'), _s(p, 'paymentType') == 'cash' ? tr('كاش', 'Cash') : _s(p, 'paymentType') == 'tax' ? tr('ضريبي', 'Tax') : '—'),
            _kv(tr('مهلة السداد (من تاريخ التسليم)', 'Credit days (from delivery)'), _num(p['creditDays']) > 0 ? tr('${p['creditDays']} يومًا', '${p['creditDays']} days') : ''),
            _kv(tr('شروط السداد', 'Payment terms'), p['paymentTerms']),
            _kv(tr('حد الائتمان', 'Credit limit'), _num(p['creditLimit']) > 0 ? _m(p['creditLimit']) : ''),
            _kv(tr('آخر كشف', 'Last report'), _s(p, 'lastReportAt').isEmpty ? '' : _dt(p['lastReportAt'])),
            _kv(customer ? tr('آخر تحصيل', 'Last collected') : tr('آخر سداد', 'Last paid'), _s(p, 'lastSettledAt').isEmpty ? '' : _dt(p['lastSettledAt'])),
            _kv(tr('المتابعة القادمة', 'Next follow-up'), _s(p, 'nextFollowUpAt').isEmpty ? '' : _dt(p['nextFollowUpAt'])),
            _kv(tr('ملاحظات', 'Notes'), p['notes']),
          ]),
          if (p['nameVariants'] is List && (p['nameVariants'] as List).length > 1)
            _section(tr('صيغ الاسم في الكشوف', 'Name spellings in the reports'), [
              for (final n in p['nameVariants'] as List) Text('· $n', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              Text(tr('كلُّها مجموعةٌ في هذا الملف', 'All merged into this profile'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ]),
          // ── الحركةُ بالشهر — أشرطةٌ بدل المنحنى ─────────────────────────────
          if (monthly.isNotEmpty)
            _section(tr('الحركة بالشهر', 'Monthly movement'), [
              Wrap(spacing: 10, children: [
                Chip2(totalLabel, T.navy), Chip2(settledLabel, T.success), Chip2(dueLabel, T.danger),
              ]),
              const SizedBox(height: 6),
              for (final r in monthly)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    SizedBox(width: 62, child: Text(_s(r, 'month'), style: const TextStyle(fontSize: 11.5))),
                    Expanded(
                      child: Column(children: [
                        for (final (k, c) in [('total', T.navy), ('settled', T.success), ('outstanding', T.danger)])
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 1),
                            child: Row(children: [
                              Expanded(
                                child: LinearProgressIndicator(value: (_num(r[k]) / maxMonth).clamp(0, 1).toDouble(), minHeight: 5,
                                    color: c, backgroundColor: c.withValues(alpha: 0.08)),
                              ),
                              SizedBox(width: 74, child: Text(_m(r[k]), textAlign: TextAlign.end, style: const TextStyle(fontSize: 10.5))),
                            ]),
                          ),
                      ]),
                    ),
                  ]),
                ),
            ]),
          // ── فواتيرُه ومديونيّتُه من دفتر التحصيل ──────────────────────────
          if (_num(mt['count']) > 0)
            _section(tr('الفواتير والمديونية (${mt['count']})', 'Invoices & debt (${mt['count']})'), [
              Wrap(spacing: 6, runSpacing: 4, children: [
                Chip2('${tr('ما فُوتِر', 'Invoiced')} ${_m(mt['invoiced'])}', T.ink),
                Chip2('${tr('ما حُصِّل', 'Collected')} ${_m(mt['collected'])}', T.success),
                Chip2('${tr('المستحق', 'Outstanding')} ${_m(mt['outstanding'])}', _num(mt['outstanding']) > 0 ? T.danger : T.inkFaint),
                Chip2('${tr('لم تُحصَّل', 'Open')} ${mt['openCount'] ?? 0}${_num(mt['oldestOpenDays']) > 0 ? ' · ${mt['oldestOpenDays']}${tr('ي', 'd')}' : ''}',
                    _num(mt['openCount']) > 0 ? T.danger : T.inkFaint),
              ]),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  onPressed: () => setState(() => _showPaid = !_showPaid),
                  child: Text(_showPaid ? tr('غير المحصَّل فقط', 'Unpaid only') : tr('إظهار الكل', 'Show all')),
                ),
              ),
              if (shownInv.isEmpty) Text(tr('لا فواتير غير محصَّلة', 'No unpaid invoices'), style: const TextStyle(color: T.inkFaint)),
              for (final i in shownInv)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  onTap: () => openTaxInvoice(context, _s(i, 'invoiceNumber')),
                  title: Text(_s(i, 'invoiceNumber'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.orange)),
                  subtitle: Text(
                    '${_dt(i['invoiceDate'])} · ${tr('التسليم', 'Delivered')} ${_dt(i['deliveryDate'])} · '
                    '${i['collected'] == true ? (_s(i, 'collectionDate').isNotEmpty ? _dt(i['collectionDate']) : tr('محصَّلة', 'collected')) : tr('لم تُحصَّل', 'open')}'
                    '${i['ageDays'] != null ? ' · ${i['ageDays']} ${tr('يوم', 'd')}' : ''}',
                    style: TextStyle(fontSize: 11.5, color: i['collected'] == true ? T.inkSoft : T.danger),
                  ),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(_m(i['total']), style: const TextStyle(fontWeight: FontWeight.w800)),
                    IconButton(
                      icon: const Icon(Icons.attach_file_rounded, size: 18, color: T.orange),
                      onPressed: () => openCollectionAttachments(context, kind: 'tax', key: _s(i, 'invoiceNumber'), label: _s(i, 'invoiceNumber')),
                    ),
                  ]),
                ),
              if (invoices.length < _num(mt['count']))
                Text(tr('تُعرض أحدث ${invoices.length} من ${mt['count']} — والكشف الكامل في PDF كشف الحساب.',
                        'Showing the latest ${invoices.length} of ${mt['count']} — the full list is in the statement PDF.'),
                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ]),
          // ── المتابعات ─────────────────────────────────────────────────────
          AppCard(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr('المتابعات (${_fus.length})', 'Follow-ups (${_fus.length})'), style: const TextStyle(fontWeight: FontWeight.w800))),
                if (collectionsCanEdit)
                  FilledButton.icon(onPressed: _newFollowUp, icon: const Icon(Icons.add, size: 18), label: Text(tr('متابعة جديدة', 'New follow-up'))),
              ]),
              if (_fus.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا متابعات بعد', 'No follow-ups yet'), style: const TextStyle(color: T.inkFaint))),
              for (final f in _fus)
                Opacity(
                  opacity: _s(f, 'closedAt').isNotEmpty ? 0.6 : 1,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Chip2(_fuTypes[_s(f, 'type')] != null ? tr(_fuTypes[_s(f, 'type')]!.$1, _fuTypes[_s(f, 'type')]!.$2) : _s(f, 'type'), T.inkSoft),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_s(f, 'notes'), style: const TextStyle(fontSize: 13)),
                          Text([
                            _dt(f['createdAt']),
                            if (f['collector'] is Map) '${(f['collector'] as Map)['firstName'] ?? ''} ${(f['collector'] as Map)['lastName'] ?? ''}'.trim(),
                            if (f['report'] is Map && '${(f['report'] as Map)['reportNumber'] ?? ''}'.isNotEmpty) '${(f['report'] as Map)['reportNumber']}',
                            if (_num(f['amountCollected']) > 0) '${tr('حُصِّل', 'collected')} ${_m(f['amountCollected'])}',
                          ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          if (_s(f, 'promiseDate').isNotEmpty || _s(f, 'nextFollowUpAt').isNotEmpty)
                            Text([
                              if (_s(f, 'promiseDate').isNotEmpty) '${tr('وعد بالسداد', 'promised')} ${_dt(f['promiseDate'])}${_num(f['promiseAmount']) > 0 ? ' · ${_m(f['promiseAmount'])}' : ''}',
                              if (_s(f, 'nextFollowUpAt').isNotEmpty) '${tr('المتابعة القادمة', 'next')} ${_dt(f['nextFollowUpAt'])}',
                            ].join(' · '), style: const TextStyle(fontSize: 11, color: T.warn)),
                        ]),
                      ),
                      if (collectionsCanEdit) ...[
                        IconButton(
                          tooltip: _s(f, 'closedAt').isNotEmpty ? tr('إعادة فتح', 'Reopen') : tr('إقفال', 'Close'),
                          icon: Icon(Icons.check_circle_outline, color: _s(f, 'closedAt').isNotEmpty ? T.success : T.inkFaint),
                          onPressed: () => _closeFu(f),
                        ),
                        IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, color: T.inkFaint), onPressed: () => _removeFu(f)),
                      ],
                    ]),
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 10),
          // ── شغلُه معنا من كلّ باب ────────────────────────────────────────
          if (loads.isNotEmpty)
            _workPanel(tr('حمولات بأسطولنا', 'Loads on our fleet'), loads, [
              ('waybillNumber', false), ('shipmentDate', true), ('__route', false), ('price', false), ('status', false),
            ]),
          if (orders.isNotEmpty)
            _workPanel(tr('طلبات الشحنات', 'Shipment orders'), orders, [
              ('orderNumber', false), ('orderDate', true), ('__route', false), (customer ? 'sellPrice' : 'buyPrice', false), ('status', false),
            ]),
          // ── الكشوف ────────────────────────────────────────────────────────
          AppCard(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr('الكشوف (${_m(d['reportsTotal'])})', 'Reports (${_m(d['reportsTotal'])})'), style: const TextStyle(fontWeight: FontWeight.w800))),
                Text(tr('الملغاة مستثناة', 'Cancelled excluded'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]),
              if (reports.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(tr('لا كشوف', 'No reports'), style: const TextStyle(color: T.inkFaint))),
              for (final r in reports)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_s(r, 'reportNumber').isEmpty ? '—' : _s(r, 'reportNumber'), style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text([_dt(r['reportDate']), [_s(r, 'fromLocation'), _s(r, 'toLocation')].where((x) => x.isNotEmpty).join(' — '), _s(r, 'branch'),
                              if (_s(r, 'invoiceNumber').isNotEmpty) '${tr('فاتورة', 'inv.')} ${_s(r, 'invoiceNumber')}', _s(r, 'executionStatus')]
                            .where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                      ]),
                    ),
                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(_m(r[valueKey]), style: const TextStyle(fontWeight: FontWeight.w800)),
                      Text(_s(r, closedKey).isNotEmpty ? _dt(r[closedKey]) : tr('لم يُغلق', 'open'),
                          style: TextStyle(fontSize: 11, color: _s(r, closedKey).isNotEmpty ? T.success : T.danger)),
                    ]),
                  ]),
                ),
              if (pages > 1)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    OutlinedButton(onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); }, child: Text(tr('السابق', 'Prev'))),
                    Text(tr('صفحة $_page من $pages', 'Page $_page of $pages'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    OutlinedButton(onPressed: _page >= pages ? null : () { setState(() => _page++); _load(); }, child: Text(tr('التالي', 'Next'))),
                  ]),
                ),
            ]),
          ),
          const SizedBox(height: 10),
          // مهامّ JP المربوطة بهذا الطرف — تُضاف من هنا.
          JpTaskPanel(section: 'collections', kind: 'collParty', refId: _s(p, '_id').isNotEmpty ? _s(p, '_id') : widget.id),
        ]),
      ),
    );
  }

  Widget _workPanel(String title, List<Map<String, dynamic>> rows, List<(String, bool)> cols) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$title (${rows.length})', style: const TextStyle(fontWeight: FontWeight.w800)),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  cols.map((c) => c.$1 == '__route'
                      ? [_s(r, 'fromCity'), _s(r, 'toCity')].where((x) => x.isNotEmpty).join(' — ')
                      : c.$2 ? _dt(r[c.$1]) : _s(r, c.$1)).where((x) => x.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
          ]),
        ),
      );
}

/// «كشف حساب PDF» للعميل بالمدى المختار — تقريرُ الخادم نفسُه (ReportButton).
class _StatementButton extends StatefulWidget {
  final String name, from, to;
  const _StatementButton({required this.name, required this.from, required this.to});
  @override
  State<_StatementButton> createState() => _StatementButtonState();
}

class _StatementButtonState extends State<_StatementButton> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      FilledButton.tonalIcon(
        onPressed: _busy ? null : () async {
          setState(() => _busy = true);
          final messenger = ScaffoldMessenger.of(context);
          try {
            final bytes = await Api.instance.getBytes('/api/reports/customer/${Uri.encodeComponent(widget.name)}'
                '?from=${widget.from}&to=${widget.to}&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf');
            await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'customer-statement');
          } catch (e) {
            messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر إصدار التقرير', 'Could not generate the report'))));
          }
          if (mounted) setState(() => _busy = false);
        },
        icon: _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.picture_as_pdf_outlined, size: 18),
        label: Text(tr('كشف حساب PDF', 'Statement PDF')),
      ),
    ]);
  }
}

/// متابعةٌ جديدة — النوعُ والحالةُ والملاحظات، وما حُصِّل، والوعدُ بتاريخه ومبلغه.
class _FollowUpSheet extends StatefulWidget {
  final String partyId;
  const _FollowUpSheet({required this.partyId});
  @override
  State<_FollowUpSheet> createState() => _FollowUpSheetState();
}

class _FollowUpSheetState extends State<_FollowUpSheet> {
  String _type = 'call';
  String _status = 'done';
  final _notes = TextEditingController();
  final _amount = TextEditingController();
  final _promiseAmount = TextEditingController();
  DateTime? _promiseDate, _next;
  bool _saving = false;
  String? _err;

  @override
  void dispose() {
    _notes.dispose();
    _amount.dispose();
    _promiseAmount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_notes.text.trim().isEmpty) { setState(() => _err = tr('الملاحظات مطلوبة', 'Notes required')); return; }
    setState(() { _saving = true; _err = null; });
    try {
      await Api.instance.post('/api/collections-dept/parties/${widget.partyId}/follow-ups', {
        'type': _type, 'status': _status, 'notes': _notes.text.trim(),
        if (_amount.text.trim().isNotEmpty) 'amountCollected': num.tryParse(_amount.text.trim()) ?? 0,
        if (_promiseDate != null) 'promiseDate': _ymd(_promiseDate!),
        if (_promiseAmount.text.trim().isNotEmpty) 'promiseAmount': num.tryParse(_promiseAmount.text.trim()) ?? 0,
        if (_next != null) 'nextFollowUpAt': _ymd(_next!),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _err = e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save'); });
    }
  }

  Widget _date(String label, DateTime? v, void Function(DateTime?) set) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        subtitle: Text(v == null ? '—' : _ymd(v)),
        trailing: v == null ? const Icon(Icons.event_outlined) : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => set(null))),
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: v ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 2));
          if (d != null) setState(() => set(d));
        },
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text(tr('متابعة جديدة', 'New follow-up'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: InputDecoration(labelText: tr('النوع', 'Type')),
              items: [for (final e in _fuTypes.entries) DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))],
              onChanged: (v) => setState(() => _type = v ?? 'call'),
            ),
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
              items: [
                DropdownMenuItem(value: 'done', child: Text(tr('تمّت', 'Done'))),
                DropdownMenuItem(value: 'postponed', child: Text(tr('مؤجَّلة', 'Postponed'))),
                DropdownMenuItem(value: 'cancelled', child: Text(tr('ملغاة', 'Cancelled'))),
              ],
              onChanged: (v) => setState(() => _status = v ?? 'done'),
            ),
            TextField(controller: _notes, maxLines: 3, minLines: 1, decoration: InputDecoration(labelText: tr('الملاحظات *', 'Notes *'))),
            TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('ما حُصِّل', 'Amount collected'))),
            _date(tr('وعد بالسداد — التاريخ', 'Promised on'), _promiseDate, (v) => _promiseDate = v),
            TextField(controller: _promiseAmount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('وعد بالسداد — المبلغ', 'Promised amount'))),
            _date(tr('المتابعة القادمة', 'Next follow-up'), _next, (v) => _next = v),
            if (_err != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_err!, style: const TextStyle(color: T.danger))),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
            ),
          ]),
        ),
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// إسنادُ حساباتٍ إلى موظّف تحصيل — جماعيًّا، كشريط التحديد في صفحة العملاء/الموردين.
// يبدأ بما اختير من الصفّ، ويُضاف إليه بالبحث. تركُ الموظّف فارغًا يُعيدها إلى
// مدير القسم (غير مُسنَدة). PUT /ledger/team/assign بالجسم نفسِه.
// ═════════════════════════════════════════════════════════════════════════
Future<bool> openCollectionsBulkAssign(BuildContext context, {required String kind, Map<String, dynamic>? initial}) async {
  final r = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => CollectionsBulkAssignScreen(kind: kind, initial: initial)));
  return r == true;
}

class CollectionsBulkAssignScreen extends StatefulWidget {
  final String kind;
  final Map<String, dynamic>? initial;
  const CollectionsBulkAssignScreen({super.key, required this.kind, this.initial});
  @override
  State<CollectionsBulkAssignScreen> createState() => _CollectionsBulkAssignScreenState();
}

class _CollectionsBulkAssignScreenState extends State<CollectionsBulkAssignScreen> {
  List<Map<String, dynamic>> _rows = [];
  final Map<String, Map<String, dynamic>> _sel = {};
  List<String> _officers = [];
  String _assignTo = '';
  String _q = '';
  bool _loading = true, _saving = false, _changed = false;
  int _seq = 0;
  Timer? _deb;

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    if (i != null && _s(i, '_id').isNotEmpty) _sel[_s(i, '_id')] = i;
    _load();
    Api.instance.get('/api/collections-dept/ledger/invoices/filters').then((d) {
      if (mounted && d is Map) setState(() => _officers = [for (final o in (d['officers'] as List? ?? const [])) '$o']);
    }).catchError((_) {});
  }

  @override
  void dispose() { _deb?.cancel(); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/collections-dept/parties?kind=${widget.kind}&limit=200${_q.isNotEmpty ? '&q=${Uri.encodeQueryComponent(_q)}' : ''}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = [for (final r in (d['parties'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)]; _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  Future<void> _pickOfficer() async {
    final v = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(tr('مدير القسم (غير مُسنَد)', 'Dept. manager (unassigned)')), onTap: () => Navigator.pop(c, '')),
          for (final o in _officers) ListTile(title: Text(o), trailing: _assignTo == o ? const Icon(Icons.check, color: T.orange) : null, onTap: () => Navigator.pop(c, o)),
        ]),
      ),
    );
    if (v != null) setState(() => _assignTo = v);
  }

  Future<void> _assign() async {
    if (_sel.isEmpty) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await Api.instance.put('/api/collections-dept/ledger/team/assign', {'parties': _sel.keys.toList(), 'officer': _assignTo});
      messenger.showSnackBar(SnackBar(content: Text(tr('أُسند ${r['updated']} حسابًا إلى ${_assignTo.isEmpty ? 'مدير القسم' : _assignTo}',
          '${r['updated']} accounts assigned to ${_assignTo.isEmpty ? 'the dept. manager' : _assignTo}'))));
      setState(() { _sel.clear(); _changed = true; });
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر الإسناد', 'Could not assign'))));
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final allOn = _rows.isNotEmpty && _rows.every((r) => _sel.containsKey(_s(r, '_id')));
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (did, _) { if (!did) Navigator.pop(context, _changed); },
      child: AppScaffold(
        title: Text(tr('إسناد إلى موظف تحصيل', 'Assign to an officer')),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search, size: 18), hintText: tr('ابحث بالاسم أو الكود…', 'Search name or code…')),
              onChanged: (v) {
                _deb?.cancel();
                _deb = Timer(const Duration(milliseconds: 350), () { _q = v.trim(); _load(); });
              },
            ),
          ),
          CheckboxListTile(
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            value: allOn,
            title: Text(_sel.isEmpty ? tr('تحديد المعروض', 'Select shown') : tr('محدَّد: ${_sel.length}', '${_sel.length} selected')),
            onChanged: (_) => setState(() {
              if (allOn) {
                for (final r in _rows) { _sel.remove(_s(r, '_id')); }
              } else {
                for (final r in _rows) { _sel[_s(r, '_id')] = r; }
              }
            }),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    itemCount: _rows.length,
                    itemBuilder: (c, i) {
                      final r = _rows[i];
                      final id = _s(r, '_id');
                      return CheckboxListTile(
                        controlAffinity: ListTileControlAffinity.leading,
                        value: _sel.containsKey(id),
                        onChanged: (_) => setState(() { if (_sel.remove(id) == null) _sel[id] = r; }),
                        title: Text(_s(r, 'name')),
                        subtitle: Text([_s(r, 'code'), _s(r, 'effectiveOfficer').isNotEmpty ? _s(r, 'effectiveOfficer') : _s(r, 'collectionOfficer')]
                            .where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12)),
                      );
                    },
                  ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickOfficer,
                    icon: const Icon(Icons.person_outline),
                    label: Text(_assignTo.isEmpty ? tr('مدير القسم (غير مُسنَد)', 'Dept. manager (unassigned)') : _assignTo, overflow: TextOverflow.ellipsis),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: _sel.isEmpty || _saving ? null : _assign,
                  icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check_circle_outline),
                  label: Text(tr('إسناد (${_sel.length})', 'Assign (${_sel.length})')),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
