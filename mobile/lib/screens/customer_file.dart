import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../ui/portal_account_card.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'insight_kit.dart' show inum, fmtNum;

/// Complete customer files: mirrors web /system/customers and /system/customers/[id] (backend services/customerFile).
/// Top management only: the server answers 403 to everyone else.
class CustomerFilesScreen extends StatefulWidget {
  const CustomerFilesScreen({super.key});
  @override
  State<CustomerFilesScreen> createState() => _CustomerFilesScreenState();
}

class _CustomerFilesScreenState extends State<CustomerFilesScreen> {
  List<Map<String, dynamic>>? _rows;
  String? _error;
  String _q = '';
  final _ctl = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _ctl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customer-hub/files');
      if (mounted) setState(() { _rows = [for (final x in ((d as Map)['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final f = _q.trim().toLowerCase();
    final shown = rows == null ? const <Map<String, dynamic>>[] : rows.where((r) => f.isEmpty || '${r['name']} ${r['code']} ${r['phone']} ${r['city']}'.toLowerCase().contains(f)).toList();
    return AppScaffold(
      title: Text(tr('ملفات العملاء الشاملة', 'Complete customer files')),
      body: rows == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                SearchField(controller: _ctl, dense: true, onChanged: (v) => setState(() => _q = v), hint: tr('الاسم أو الكود أو الجوال', 'Name, code or phone'), suffixText: '${shown.length}'),
                const SizedBox(height: 10),
                if (shown.isEmpty) EmptyState(icon: Icons.folder_open_outlined, title: tr('لا نتائج', 'No matches')),
                for (final r in shown.take(300))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Pressable(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerFileScreen(id: '${r['_id']}'))),
                      child: AppCard(child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                          Text([r['code'], r['phone'], r['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        ])),
                        const Icon(Icons.chevron_left, color: T.inkFaint),
                      ])),
                    ),
                  ),
              ]),
            ),
    );
  }
}

/// One customer across every section, money included.
class CustomerFileScreen extends StatefulWidget {
  final String id;
  /// Register of `id` when it is not the CRM master (shipment, fleet, customs, collections, contracts).
  final String? reg;
  const CustomerFileScreen({super.key, required this.id, this.reg});
  @override
  State<CustomerFileScreen> createState() => _CustomerFileScreenState();
}

const _customsState = {
  'open': ('مفتوحة', 'Open', T.warn),
  'upcoming': ('قادمة', 'Upcoming', T.info),
  'closedInvoiced': ('مغلقة ومفوترة', 'Closed, invoiced', T.success),
  'closedNotInvoiced': ('مغلقة لم تُفوتَر', 'Closed, not invoiced', T.danger),
  'cancelled': ('ملغاة', 'Cancelled', T.inkFaint),
};

class _CustomerFileScreenState extends State<CustomerFileScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('customers:changed', _onLive);
  }

  @override
  void dispose() { Live.instance.off('customers:changed', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customer-hub/file/${widget.id}${widget.reg == null ? '' : '?reg=${widget.reg}'}');
      if (mounted) setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : e.toString());
    }
  }

  static String _money(dynamic v) => fmtNum(inum(v));
  static String _day(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}');
    if (d == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    final l = d.toLocal();
    return '${two(l.day)}/${two(l.month)}/${l.year}';
  }
  List<Map<String, dynamic>> _list(String k) => [for (final x in ((_d?[k] as List?) ?? const [])) Map<String, dynamic>.from(x as Map)];

  Widget _kpi(String label, String value, String sub, Color color, IconData icon) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(icon, size: 16, color: color), const SizedBox(width: 6), Expanded(child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkSoft)))]),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: color)),
          if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
      );

  Widget _section(String title, IconData icon, List<Map<String, dynamic>> rows, Widget Function(Map<String, dynamic>) item) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: AppCard(
          child: Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              leading: Icon(icon, color: T.orange),
              title: Text('$title (${rows.length})', style: const TextStyle(fontWeight: FontWeight.w800)),
              children: rows.isEmpty
                  ? [Padding(padding: const EdgeInsets.all(8), child: Text(tr('لا شيء', 'None'), style: const TextStyle(color: T.inkFaint)))]
                  : [for (final r in rows.take(100)) item(r), if (rows.length > 100) Text(tr('صدِّر الملف لرؤية الكلّ', 'Export to see all'), style: const TextStyle(fontSize: 11, color: T.inkFaint))],
            ),
          ),
        ),
      );

  Widget _line(String a, String b, [String c = '']) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          Expanded(child: Text(a, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
          Expanded(child: Text(b, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
          if (c.isNotEmpty) Text(c, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
        ]),
      );

  static String _sourceName(String k) => switch (k) {
        'platform' => tr('المنصّة السابقة', 'Former platform'),
        'orders' => tr('طلبات الشحنات', 'Shipment requests'),
        'fleet' => tr('الأسطول', 'Fleet'),
        _ => tr('التشغيل', 'Operations'),
      };

  bool _pdfBusy = false;
  /// The branded PDF of the whole file, from the reporting engine (subject customerFile), all time.
  Future<void> _pdf() async {
    setState(() => _pdfBusy = true);
    try {
      final id = '${widget.id}${widget.reg == null ? '' : ':${widget.reg}'}';
      final bytes = await Api.instance.getBytes('/api/reports/customerFile/${Uri.encodeComponent(id)}?from=&to=&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf');
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'customer-file');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر إصدار الملف', 'Could not generate the file'))));
    }
    if (mounted) setState(() => _pdfBusy = false);
  }

  void _export() {
    final m = (_d!['master'] as Map);
    exportExcel(context, fileName: 'customer-file-${m['name']}', sheets: [
      (tr('أوامر النقل', 'Transport orders'), [
        ExportCol('الرقم', 'No.', (r) => r['number'] ?? ''), ExportCol('التاريخ', 'Date', (r) => _day(r['date'])),
        ExportCol('المصدر', 'Source', (r) => tr('${r['sourceAr'] ?? ''}', '${r['sourceEn'] ?? ''}')),
        ExportCol('من', 'From', (r) => r['from'] ?? ''), ExportCol('إلى', 'To', (r) => r['to'] ?? ''), ExportCol('الحالة', 'Status', (r) => r['status'] ?? ''),
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''), ExportCol('البيع', 'Sell', (r) => r['sell'] ?? 0), ExportCol('الشراء', 'Buy', (r) => r['buy'] ?? 0),
        ExportCol('رقم الفاتورة', 'Invoice no.', (r) => r['invoiceNumber'] ?? ''), ExportCol('المُحصَّل', 'Collected', (r) => r['collected'] ?? 0),
        ExportCol('معاملة التخليص', 'Customs file', (r) => r['clearance'] ?? ''),
      ], _list('transport')),
      (tr('الأسطول', 'Fleet'), [
        ExportCol('رقم البوليصة', 'Waybill', (r) => r['waybillNumber'] ?? ''), ExportCol('التاريخ', 'Date', (r) => _day(r['loadDate'] ?? r['createdAt'])),
        ExportCol('من', 'From', (r) => r['fromCity'] ?? ''), ExportCol('إلى', 'To', (r) => r['toCity'] ?? ''), ExportCol('الدخل', 'Income', (r) => r['price'] ?? ''),
      ], _list('loads')),
      (tr('التخليص', 'Customs'), [
        ExportCol('المرجع', 'Reference', (r) => r['refNumber'] ?? ''), ExportCol('البوليصة', 'BL', (r) => r['blNumber'] ?? ''),
        ExportCol('الحالة', 'State', (r) => (_customsState[r['state']] ?? _customsState['open']!).$1), ExportCol('الإيراد', 'Revenue', (r) => r['revenue'] ?? 0),
        ExportCol('التكلفة', 'Cost', (r) => r['cost'] ?? 0), ExportCol('الربح', 'Profit', (r) => r['profit'] ?? 0),
      ], _list('customs')),
      (tr('الفواتير', 'Invoices'), [
        ExportCol('رقم الفاتورة', 'Invoice', (r) => r['invoiceNumber'] ?? ''), ExportCol('التاريخ', 'Date', (r) => _day(r['invoiceDate'])),
        ExportCol('الإجمالي', 'Total', (r) => r['total'] ?? 0), ExportCol('المُحصَّل', 'Collected', (r) => r['collectedAmount'] ?? 0),
        ExportCol('المتبقّي', 'Remaining', (r) => inum(r['total']) - inum(r['collectedAmount'])),
      ], _list('invoices')),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) {
      return AppScaffold(title: Text(tr('الملف الشامل', 'Complete file')),
          body: _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final m = Map<String, dynamic>.from(d['master'] as Map);
    final s = Map<String, dynamic>.from(d['summary'] as Map);
    final places = [for (final x in (d['places'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    final coll = d['collections'] as Map?;
    final contract = d['contract'] as Map?;
    final accounts = _list('accounts');
    return AppScaffold(
      title: Text('${m['name']}'),
      actions: [
        IconButton(tooltip: tr('تصدير PDF', 'Export PDF'), icon: _pdfBusy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.picture_as_pdf_outlined), onPressed: _pdfBusy ? null : _pdf),
        IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('${m['name']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: T.ink)),
              Text([if ('${m['code'] ?? ''}'.isNotEmpty) '${tr('الكود', 'Code')} ${m['code']}', m['phone'], m['city']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
              if (m['archivedAt'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Chip2(tr('في أرشيف العملاء', 'In the customers archive'), T.danger)),
              const SizedBox(height: 8),
              Wrap(spacing: 4, runSpacing: 4, children: [for (final p in places) Chip2('${p['ar']}', T.navy)]),
            ]),
          ),
          const SizedBox(height: 10),
          GridView.count(
            crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.45,
            children: [
              _kpi(tr('أوامر النقل', 'Transport orders'), fmtNum(s['transport']),
                  [for (final e in ((s['bySource'] as Map?) ?? const {}).entries) '${_sourceName('${e.key}')} ${e.value}'].join(' · '), T.navy, Icons.route_outlined),
              _kpi(tr('إيراد النقل', 'Transport revenue'), _money(s['transportSell']), tr('شراء ${_money(s['transportBuy'])}', 'buy ${_money(s['transportBuy'])}'), T.info, Icons.local_shipping_outlined),
              _kpi(tr('التخليص', 'Customs'), '${s['clearances']}', tr('${s['clearancesOpen']} مفتوحة · ربح ${_money(s['customsProfit'])}', '${s['clearancesOpen']} open · profit ${_money(s['customsProfit'])}'), T.violet, Icons.directions_boat_outlined),
              _kpi(tr('المتبقّي للتحصيل', 'Outstanding'), _money(s['outstanding']), tr('${s['overdue']} فاتورة متأخرة', '${s['overdue']} overdue'), inum(s['overdue']) > 0 ? T.danger : T.success, Icons.account_balance_wallet_outlined),
            ],
          ),
          const SizedBox(height: 10),
          // Create, reset or disable the customer's portal login here; it is the same account every section shows.
          PortalAccountCard(source: 'crm_company', refId: '${m['_id']}', name: '${m['name']}'),
          const SizedBox(height: 10),
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('بطاقة العميل', 'Customer card'), style: const TextStyle(fontWeight: FontWeight.w800)),
            _line(tr('جهة الاتصال', 'Contact'), '${m['contactPerson'] ?? ''}'.isEmpty ? '—' : '${m['contactPerson']}'),
            _line(tr('الرقم الضريبي', 'Tax number'), '${m['taxNumber'] ?? ''}'.isEmpty ? '—' : '${m['taxNumber']}'),
            _line(tr('مسؤول التحصيل', 'Collections officer'), '${coll?['officer'] ?? ''}'.isEmpty ? '—' : '${coll?['officer']}'),
            _line(tr('مدة الائتمان', 'Credit days'), inum(coll?['creditDays']) > 0 ? '${coll?['creditDays']}' : '—'),
            _line(tr('العقد', 'Contract'), contract == null ? '—' : (contract['customerSideContract'] == true && contract['ourSideContract'] == true ? tr('موقَّع من الطرفين', 'Signed by both') : tr('غير مكتمل التوقيع', 'Not fully signed'))),
            _line(tr('نهاية العقد', 'Contract end'), _day(contract?['endDate'])),
            _line(tr('حساب البوابة', 'Portal account'), accounts.isEmpty ? tr('لا يوجد', 'None') : accounts.map((a) => a['email']).join('، ')),
            _line(tr('آخر نشاط', 'Last activity'), _day(s['lastActivity'])),
          ])),
          // One list of transport orders, each once, with where it came from (the old platform, shipment requests or the fleet).
          _section(tr('أوامر النقل', 'Transport orders'), Icons.route_outlined, _list('transport'),
              (r) => _line('#${r['number'] ?? '—'} · ${_day(r['date'])}', '${r['from'] ?? ''} ← ${r['to'] ?? ''} · ${tr('${r['sourceAr'] ?? ''}', '${r['sourceEn'] ?? ''}')}', _money(r['sell']))),
          _section(tr('حمولات الأسطول', 'Fleet loads'), Icons.local_shipping_outlined, _list('loads'),
              (r) => _line('#${r['waybillNumber'] ?? '—'} · ${_day(r['loadDate'] ?? r['createdAt'])}', '${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''}', _money(r['price']))),
          _section(tr('معاملات التخليص', 'Clearances'), Icons.directions_boat_outlined, _list('customs'), (r) {
            final st = _customsState[r['state']] ?? _customsState['open']!;
            return _line('${r['refNumber'] ?? r['blNumber'] ?? '—'}', tr(st.$1, st.$2), _money(r['profit']));
          }),
          _section(tr('فواتير التحصيل', 'Invoices'), Icons.account_balance_wallet_outlined, _list('invoices'),
              (r) => _line('${r['invoiceNumber'] ?? '—'} · ${_day(r['invoiceDate'])}', '${tr('المتبقّي', 'left')} ${_money(inum(r['total']) - inum(r['collectedAmount']))}', _money(r['total']))),
          _section(tr('طلبات الشحن', 'Shipment requests'), Icons.assignment_outlined, _list('requests'),
              (r) => _line('#${r['number']} · ${_day(r['createdAt'])}', '${r['fromCity'] ?? ''} ← ${r['toCity'] ?? ''}', '${((r['placed'] as List?) ?? const []).length}/${r['trucks'] ?? 0}')),
          _section(tr('صفقات إدارة العلاقات', 'CRM deals'), Icons.handshake_outlined, _list('deals'),
              (r) => _line('${r['title'] ?? ''}', '${r['stage'] ?? ''}', _money(r['value']))),
          const SizedBox(height: 20),
        ]),
      ),
    );
  }
}

/// «الملف الشامل» button for a section's customer screen; shown only to the roles the server allows.
class FullFileButton extends StatefulWidget {
  final String id;
  final String reg;
  const FullFileButton({super.key, required this.id, required this.reg});
  @override
  State<FullFileButton> createState() => _FullFileButtonState();
}

Future<bool>? _access;

class _FullFileButtonState extends State<FullFileButton> {
  bool _ok = false;
  @override
  void initState() {
    super.initState();
    (_access ??= Api.instance.get('/api/customer-hub/file-access').then((d) => (d as Map)['allowed'] == true).catchError((_) => false))
        .then((v) { if (mounted) setState(() => _ok = v); });
  }
  @override
  Widget build(BuildContext context) {
    if (!_ok || widget.id.isEmpty) return const SizedBox.shrink();
    return IconButton(
      tooltip: tr('الملف الشامل', 'Complete file'),
      icon: const Icon(Icons.folder_shared_outlined),
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerFileScreen(id: widget.id, reg: widget.reg == 'crm' ? null : widget.reg))),
    );
  }
}
