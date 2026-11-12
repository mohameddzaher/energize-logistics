import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/portal_account_card.dart';
import '../ui/report_button.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'crm_form.dart';
import 'customer_registry_profile.dart';
import 'jp.dart' show JpTaskPanel;

// The other CRM screens are opened from configs.dart, which imports only this file.
export 'crm_vendor_detail.dart';

// CRM roles, same as the web (lib/crm.ts).
const crmStaffRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'crm_manager', 'crm_team_leader', 'crm_team_lead', 'crm_specialist', 'crm_agent', 'operations_manager', 'operations_team_leader', 'operations_staff'];
const crmAdminRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'crm_manager', 'crm_team_leader', 'crm_team_lead'];
bool isCrmAdmin(AuthProvider a) => crmAdminRoles.contains(a.role) || a.canEditSection('CRM');
bool isCrmStaff(AuthProvider a) => crmStaffRoles.contains(a.role) || a.canAccessSection('CRM') || isCrmAdmin(a);

void _snack(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
}

/// Rating stars 0-5. An empty `onChanged` means read-only.
class CrmStars extends StatelessWidget {
  final int value;
  final double size;
  final ValueChanged<int>? onChanged;
  const CrmStars({super.key, required this.value, this.size = 22, this.onChanged});
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 1; i <= 5; i++)
          InkWell(
            onTap: onChanged == null ? null : () => onChanged!(i == value ? 0 : i),
            child: Padding(
              padding: const EdgeInsets.all(2),
              child: Icon(i <= value ? Icons.star_rounded : Icons.star_outline_rounded, size: size, color: const Color(0xFFF59E0B)),
            ),
          ),
      ]);
}

int _rating(dynamic v) => (v is num ? v : num.tryParse('${v ?? ''}') ?? 0).round().clamp(0, 5);

/// Company rating from the list: PATCH /api/crm/companies/:id/rate (like the web table stars).
Future<bool> crmRateCompany(BuildContext context, Map<String, dynamic> row) async {
  var v = _rating(row['rating']);
  final picked = await showDialog<int>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (c, set) => AlertDialog(
        title: Text(tr('التقييم', 'Rating')),
        content: Center(heightFactor: 1, child: CrmStars(value: v, size: 34, onChanged: (x) => set(() => v = x))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, v), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    ),
  );
  if (picked == null) return false;
  try {
    await Api.instance.patch('/api/crm/companies/${row['_id']}/rate', {'rating': picked});
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e);
    return false;
  }
}

// Deal stages, same as the server (config/crmDefaults PIPELINE_STAGES).
const crmDealStages = <(String, String, String)>[
  ('new', 'جديد', 'New'), ('contacted', 'تم التواصل', 'Contacted'), ('qualified', 'مؤهّل', 'Qualified'),
  ('proposal', 'عرض سعر', 'Proposal'), ('negotiation', 'تفاوض', 'Negotiation'),
  ('won', 'تم الفوز', 'Won'), ('lost', 'خسارة', 'Lost'),
];
const crmDealStageColors = {
  'new': T.inkSoft, 'contacted': T.info, 'qualified': T.violet, 'proposal': T.violet,
  'negotiation': T.orange, 'won': T.success, 'lost': T.danger,
};

/// Move a deal to another stage, the counterpart of dragging between board columns on the web.
/// PATCH /api/crm/deals/:id/move {stage}
Future<bool> crmMoveDeal(BuildContext context, Map<String, dynamic> row) async {
  final cur = (row['stage'] ?? '').toString();
  final picked = await showModalBottomSheet<String>(
    context: context,
    builder: (c) => SafeArea(
      child: ListView(shrinkWrap: true, children: [
        ListTile(title: Text(tr('نقل إلى مرحلة', 'Move to stage'), style: const TextStyle(fontWeight: FontWeight.w800))),
        for (final s in crmDealStages)
          ListTile(
            leading: Icon(Icons.circle, size: 12, color: crmDealStageColors[s.$1] ?? T.inkFaint),
            title: Text(tr(s.$2, s.$3)),
            trailing: s.$1 == cur ? const Icon(Icons.check, color: T.success) : null,
            onTap: () => Navigator.pop(c, s.$1),
          ),
      ]),
    ),
  );
  if (picked == null || picked == cur) return false;
  try {
    await Api.instance.patch('/api/crm/deals/${row['_id']}/move', {'stage': picked});
    return true;
  } catch (e) {
    if (context.mounted) _snack(context, e);
    return false;
  }
}

/// CRM company profile, same as web /system/crm/companies/[id]: in-place edit, star rating, contacts, activities, tasks and deals (add/delete), the same customer in other sections, portal account, report, and JP tasks.
class CrmCompanyProfileScreen extends StatefulWidget {
  final String companyId;
  final String name;
  const CrmCompanyProfileScreen({super.key, required this.companyId, required this.name});
  @override
  State<CrmCompanyProfileScreen> createState() => _CrmCompanyProfileScreenState();
}

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

String _d(dynamic v, {bool time = false}) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  if (d == null) return '—';
  final s = '${d.day}/${d.month}/${d.year}';
  return time ? '$s ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}' : s;
}

String _user(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';
String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

const _companyStatusColor = {'lead': T.inkSoft, 'prospect': T.info, 'active': T.success, 'inactive': T.warn, 'churned': T.danger};
const _taskStatus = {'todo': ('للتنفيذ', 'To Do', T.warn), 'in_progress': ('قيد التنفيذ', 'In Progress', T.info), 'done': ('مكتملة', 'Done', T.success), 'cancelled': ('ملغاة', 'Cancelled', T.inkFaint)};
const _dealStatus = {'open': ('مفتوحة', 'Open', T.info), 'won': ('رابحة', 'Won', T.success), 'lost': ('خاسرة', 'Lost', T.danger)};

class _CrmCompanyProfileScreenState extends State<CrmCompanyProfileScreen> {
  Map<String, dynamic>? _d0;
  Map<String, dynamic> _opts = const {};
  List<Map<String, dynamic>> _places = const [];
  bool _loading = true;
  String? _error;
  int _seq = 0;
  late final void Function() _onLive;
  static const _events = ['crm:company', 'crm:contact', 'crm:activity', 'crm:task', 'crm:deal', 'customers:changed'];

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    for (final e in _events) { Live.instance.on(e, _onLive); }
    _load();
    Api.instance.get('/api/crm/options').then((o) { if (mounted) setState(() => _opts = Map<String, dynamic>.from(o)); }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/crm/companies/${widget.companyId}');
      if (!mounted || mine != _seq) return;
      setState(() { _d0 = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
    // "Same customer in" block: /api/customer-hub/presence (CustomerPresence on the web).
    try {
      final p = await Api.instance.get('/api/customer-hub/presence/crm/${widget.companyId}');
      if (mounted && mine == _seq) {
        setState(() => _places = _l(p['places']).where((x) => !(x['reg'] == 'crm' && '${x['id']}' == widget.companyId)).toList());
      }
    } catch (_) {}
  }

  Map<String, dynamic> get _company => _d0?['company'] is Map ? Map<String, dynamic>.from(_d0!['company']) : <String, dynamic>{};

  Future<void> _rate(int v) async {
    try {
      await Api.instance.patch('/api/crm/companies/${widget.companyId}/rate', {'rating': v});
      await _load();
    } catch (e) { if (mounted) _snack(context, e); }
  }

  List<String> _tags(dynamic s) => '${s ?? ''}'.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();

  Future<void> _editCompany() async {
    final c = _company;
    await showCrmForm(
      context,
      title: tr('تعديل الشركة', 'Edit Company'),
      initial: {
        ...c,
        'tags': (c['tags'] is List ? (c['tags'] as List).join(', ') : ''),
        'score': c['score'] ?? 0,
      },
      fields: [
        const CrmField('name', 'الاسم', 'Name', required: true),
        const CrmField('arabicName', 'الاسم العربي', 'Arabic name'),
        CrmField('status', 'الحالة', 'Status', kind: CrmFieldKind.select, options: crmOpts(_opts['COMPANY_STATUSES'])),
        CrmField('type', 'النوع', 'Type', kind: CrmFieldKind.select, options: crmOpts(_opts['COMPANY_TYPES'])),
        CrmField('industry', 'المجال', 'Industry', kind: CrmFieldKind.select, options: crmOpts(_opts['INDUSTRIES'])),
        CrmField('size', 'الحجم', 'Size', kind: CrmFieldKind.select, options: crmOpts(_opts['COMPANY_SIZES'])),
        CrmField('source', 'المصدر', 'Source', kind: CrmFieldKind.select, options: crmOpts(_opts['SOURCES'])),
        const CrmField('score', 'النقاط', 'Score', kind: CrmFieldKind.number),
        const CrmField('phone', 'الهاتف', 'Phone', ltr: true),
        const CrmField('whatsapp', 'واتساب', 'WhatsApp', ltr: true),
        const CrmField('email', 'البريد', 'Email', ltr: true),
        const CrmField('website', 'الموقع', 'Website', ltr: true),
        const CrmField('city', 'المدينة', 'City'),
        const CrmField('country', 'الدولة', 'Country'),
        const CrmField('tags', 'الوسوم (مفصولة بفواصل)', 'Tags (comma-separated)'),
        const CrmField('address', 'العنوان', 'Address'),
        const CrmField('notes', 'ملاحظات', 'Notes', kind: CrmFieldKind.multiline),
      ],
      onSave: (v) async {
        try {
          await Api.instance.put('/api/crm/companies/${widget.companyId}', {
            ...v,
            'rating': _rating(c['rating']),
            'tags': _tags(v['tags']),
          });
          await _load();
          return null;
        } catch (e) { return e is ApiException ? e.message : e.toString(); }
      },
    );
  }

  /// Add a contact / activity / task / deal linked to the company, like the web add dialog.
  Future<void> _add(String kind) async {
    final me = context.read<AuthProvider>().user?['_id']?.toString() ?? '';
    final (title, fields, init, path) = switch (kind) {
      'contact' => (
          tr('إضافة جهة اتصال', 'Add contact'),
          const [
            CrmField('firstName', 'الاسم الأول', 'First name', required: true),
            CrmField('lastName', 'اسم العائلة', 'Last name'),
            CrmField('title', 'المسمى الوظيفي', 'Job title'),
            CrmField('phone', 'الهاتف', 'Phone', ltr: true),
            CrmField('whatsapp', 'واتساب', 'WhatsApp', ltr: true),
            CrmField('email', 'البريد', 'Email', ltr: true),
            CrmField('isPrimary', 'جهة الاتصال الرئيسية', 'Primary contact', kind: CrmFieldKind.check),
          ],
          <String, dynamic>{'isPrimary': false},
          '/api/crm/contacts',
        ),
      'activity' => (
          tr('تسجيل نشاط', 'Log activity'),
          [
            CrmField('type', 'النوع', 'Type', kind: CrmFieldKind.select, options: crmOpts(_opts['ACTIVITY_TYPES'])),
            const CrmField('date', 'التاريخ', 'Date', kind: CrmFieldKind.datetime),
            const CrmField('subject', 'الموضوع', 'Subject', required: true),
            const CrmField('direction', 'الاتجاه', 'Direction', kind: CrmFieldKind.select, options: [('outbound', 'صادر', 'Outbound'), ('inbound', 'وارد', 'Inbound')]),
            const CrmField('outcome', 'النتيجة', 'Outcome'),
            const CrmField('body', 'التفاصيل', 'Details', kind: CrmFieldKind.multiline),
          ],
          <String, dynamic>{'type': 'call', 'direction': 'outbound', 'date': DateTime.now()},
          '/api/crm/activities',
        ),
      'task' => (
          tr('إضافة مهمة', 'Add task'),
          [
            const CrmField('title', 'عنوان المهمة', 'Task title', required: true),
            const CrmField('dueDate', 'تاريخ الاستحقاق', 'Due date', kind: CrmFieldKind.date),
            CrmField('priority', 'الأولوية', 'Priority', kind: CrmFieldKind.select, options: crmOpts(_opts['TASK_PRIORITIES'])),
            CrmField('assignedTo', 'مسندة إلى', 'Assigned to', kind: CrmFieldKind.select, options: crmOwners(_opts['owners'])),
          ],
          <String, dynamic>{'priority': 'medium', 'status': 'todo', 'assignedTo': me},
          '/api/crm/tasks',
        ),
      _ => (
          tr('إضافة صفقة', 'Add deal'),
          [
            const CrmField('title', 'عنوان الصفقة', 'Deal title', required: true),
            CrmField('stage', 'المرحلة', 'Stage', kind: CrmFieldKind.select, options: crmOpts(_opts['PIPELINE_STAGES']).isEmpty ? crmDealStages : crmOpts(_opts['PIPELINE_STAGES'])),
            const CrmField('value', 'القيمة', 'Value', kind: CrmFieldKind.number),
            const CrmField('expectedCloseDate', 'الإغلاق المتوقع', 'Expected close', kind: CrmFieldKind.date),
          ],
          <String, dynamic>{'stage': 'new', 'value': 0},
          '/api/crm/deals',
        ),
    };
    await showCrmForm(context, title: title, fields: fields, initial: init, onSave: (v) async {
      final body = <String, dynamic>{...init, ...v, 'company': widget.companyId};
      if (kind == 'deal') body['currency'] = 'SAR';
      for (final k in ['dueDate', 'expectedCloseDate', 'assignedTo']) {
        if (body[k] == '') body.remove(k);
      }
      try {
        await Api.instance.post(path, body);
        await _load();
        return null;
      } catch (e) { return e is ApiException ? e.message : e.toString(); }
    });
  }

  Future<void> _delete(String kind, String id) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تأكيد الحذف', 'Confirm delete')),
      content: Text(tr('هل أنت متأكد من الحذف؟', 'Are you sure you want to delete this?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/crm/$kind/$id');
      await _load();
    } catch (e) { if (mounted) _snack(context, e); }
  }

  Widget _section(String title, int count, String addLabel, String kind, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text('$title ($count)', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            TextButton.icon(onPressed: () => _add(kind), icon: const Icon(Icons.add, size: 18), label: Text(addLabel)),
          ]),
          const SizedBox(height: 4),
          if (children.isEmpty)
            Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(tr('لا توجد نتائج', 'No results'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)))
          else
            ...children,
        ]),
      );

  Widget _item({required Widget child, required String kind, required String id}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: AppCard(
          padding: const EdgeInsets.fromLTRB(14, 8, 4, 8),
          child: Row(children: [
            Expanded(child: child),
            IconButton(
              tooltip: tr('حذف', 'Delete'),
              onPressed: () => _delete(kind, id),
              icon: const Icon(Icons.delete_outline, color: T.danger, size: 20),
            ),
          ]),
        ),
      );

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 110, child: Text(k, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(child: Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canEdit = isCrmStaff(auth);
    final company = _company;
    final contacts = _l(_d0?['contacts']);
    final deals = _l(_d0?['deals']);
    final tasks = _l(_d0?['tasks']);
    final activities = _l(_d0?['activities']);
    final name = (company['arabicName'] ?? '').toString().isNotEmpty && Lang.instance.ar
        ? company['arabicName'].toString()
        : (company['name'] ?? widget.name).toString();
    final linked = company['linkedCustomer'] is Map ? Map<String, dynamic>.from(company['linkedCustomer']) : null;
    final statusOpts = crmOpts(_opts['COMPANY_STATUSES']);

    return AppScaffold(
      title: Text(name),
      actions: [
        if (canEdit && _d0 != null) IconButton(tooltip: tr('تعديل', 'Edit'), onPressed: _editCompany, icon: const Icon(Icons.edit_outlined)),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      topAccent: T.navy,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          if ('${company['status'] ?? ''}'.isNotEmpty)
                            Chip2(crmOptLabel(statusOpts, company['status']), _companyStatusColor[company['status']] ?? T.info),
                          if ('${company['type'] ?? ''}'.isNotEmpty) Chip2(crmOptLabel(crmOpts(_opts['COMPANY_TYPES']), company['type']), T.navy),
                          if ('${company['industry'] ?? ''}'.isNotEmpty) Chip2(crmOptLabel(crmOpts(_opts['INDUSTRIES']), company['industry']), T.violet),
                          if ('${company['city'] ?? ''}${company['country'] ?? ''}'.isNotEmpty)
                            Chip2([company['city'], company['country']].where((x) => '${x ?? ''}'.isNotEmpty).join(', '), T.navy, icon: Icons.location_on_outlined),
                        ]),
                        const SizedBox(height: 6),
                        // Tapping a star saves immediately, as in the web page header.
                        CrmStars(value: _rating(company['rating']), onChanged: _rate),
                        const SizedBox(height: 6),
                        ...[
                          (Icons.phone_outlined, company['phone']),
                          (Icons.email_outlined, company['email']),
                          (Icons.language_outlined, company['website']),
                        ].where((x) => (x.$2 ?? '').toString().isNotEmpty).map((x) => Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Row(children: [
                                Icon(x.$1, size: 15, color: T.inkFaint),
                                const SizedBox(width: 8),
                                Expanded(child: SelectableText(x.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                              ]),
                            )),
                        ContactButtons(phone: (company['whatsapp'] ?? company['phone'])?.toString(), compact: true),
                        // The customer linked in the customer register (hybrid); opens its profile.
                        if (linked != null)
                          InkWell(
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerRegistryProfileScreen(customerId: '${linked['_id']}'))),
                            child: Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Row(children: [
                                const Icon(Icons.link, size: 16, color: T.orange),
                                const SizedBox(width: 6),
                                Expanded(child: Text('${linked['companyName'] ?? ''}', style: const TextStyle(color: T.orange, fontWeight: FontWeight.w700, fontSize: 12.5))),
                              ]),
                            ),
                          ),
                      ]),
                    ),
                    if (_places.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      AppCard(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                          const Icon(Icons.link, size: 16, color: T.orange),
                          Text(tr('نفس العميل في:', 'Same customer in:'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                          for (final p in _places) Chip2('${p['ar'] ?? p['reg']}', T.navy),
                          Text(tr('— بياناتُ التواصل واحدةٌ وتتحدّث في كلّها فورًا', '— contact details are shared and update everywhere'),
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: ReportButton(subject: 'customer', id: '${company['name'] ?? ''}', label: tr('التقرير الشامل للعميل', 'Full customer report')),
                    ),
                    const SizedBox(height: 6),
                    PortalAccountCard(source: 'crm_company', refId: '${company['_id'] ?? widget.companyId}', name: '${company['name'] ?? ''}'),
                    const SizedBox(height: 10),
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('التفاصيل', 'Details'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 8),
                        _row(tr('المسؤول', 'Owner'), _user(company['owner'])),
                        _row(tr('المصدر', 'Source'), crmOptLabel(crmOpts(_opts['SOURCES']), company['source'])),
                        _row(tr('الحجم', 'Size'), crmOptLabel(crmOpts(_opts['COMPANY_SIZES']), company['size'])),
                        _row(tr('النقاط', 'Score'), '${company['score'] ?? 0}'),
                        _row(tr('العنوان', 'Address'), '${company['address'] ?? ''}'),
                        _row(tr('الوسوم', 'Tags'), company['tags'] is List ? (company['tags'] as List).join(', ') : ''),
                        if ('${company['notes'] ?? ''}'.isNotEmpty) _row(tr('ملاحظات', 'Notes'), '${company['notes']}'),
                      ]),
                    ),
                    _section(tr('جهات الاتصال', 'Contacts'), contacts.length, tr('إضافة', 'Add'), 'contact', [
                      for (final c in contacts)
                        _item(kind: 'contacts', id: '${c['_id']}', child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Flexible(child: Text('${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'.trim(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                              if (c['isPrimary'] == true) const Padding(padding: EdgeInsets.symmetric(horizontal: 4), child: Icon(Icons.star_rounded, size: 15, color: Color(0xFFF59E0B))),
                            ]),
                            Text([c['title'], c['department'], c['email']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                                style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ])),
                          ContactButtons(phone: (c['phone'] ?? c['mobile'] ?? c['whatsapp'])?.toString(), compact: true, size: 18),
                        ])),
                    ]),
                    _section(tr('الأنشطة', 'Activities'), activities.length, tr('تسجيل', 'Log'), 'activity', [
                      for (final a in activities)
                        _item(kind: 'activities', id: '${a['_id']}', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${a['subject'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                          if ('${a['body'] ?? ''}'.isNotEmpty) Text('${a['body']}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                          Text('${crmOptLabel(crmOpts(_opts['ACTIVITY_TYPES']), a['type'])} · ${_d(a['date'], time: true)} · ${_user(a['createdBy'])}',
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ])),
                    ]),
                    _section(tr('المهام', 'Tasks'), tasks.length, tr('إضافة', 'Add'), 'task', [
                      for (final t in tasks)
                        () {
                          final st = _taskStatus[t['status']] ?? ('${t['status'] ?? ''}', '${t['status'] ?? ''}', T.inkFaint);
                          return _item(kind: 'tasks', id: '${t['_id']}', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${t['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                            const SizedBox(height: 3),
                            Wrap(spacing: 6, runSpacing: 4, children: [
                              Chip2(tr(st.$1, st.$2), st.$3),
                              Chip2(crmOptLabel(crmOpts(_opts['TASK_PRIORITIES']), t['priority']), T.navy),
                              if (t['dueDate'] != null) Chip2(_d(t['dueDate']), T.info, icon: Icons.event),
                              if (_user(t['assignedTo']).isNotEmpty) Chip2(_user(t['assignedTo']), T.inkSoft),
                            ]),
                          ]));
                        }(),
                    ]),
                    _section(tr('الصفقات', 'Deals'), deals.length, tr('إضافة', 'Add'), 'deal', [
                      for (final d in deals)
                        () {
                          final st = _dealStatus[d['status']] ?? ('${d['status'] ?? ''}', '${d['status'] ?? ''}', T.inkFaint);
                          return _item(kind: 'deals', id: '${d['_id']}', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${d['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                            const SizedBox(height: 3),
                            Wrap(spacing: 6, runSpacing: 4, children: [
                              Chip2(crmOptLabel(crmOpts(_opts['PIPELINE_STAGES']).isEmpty ? crmDealStages : crmOpts(_opts['PIPELINE_STAGES']), d['stage']),
                                  crmDealStageColors[d['stage']] ?? T.cyan),
                              Chip2('${_money(d['value'])} ${d['currency'] ?? 'SAR'}', T.success),
                              Chip2(tr(st.$1, st.$2), st.$3),
                              if (d['expectedCloseDate'] != null) Chip2(_d(d['expectedCloseDate']), T.info, icon: Icons.event),
                            ]),
                          ]));
                        }(),
                    ]),
                    const SizedBox(height: 12),
                    JpTaskPanel(section: 'crm', kind: 'company', refId: '${company['_id'] ?? widget.companyId}'),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
