import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// التحصيلات والنزاعات — متابعات التحصيل المعلّقة (إنهاء/تأجيل) وسجل النزاعات
/// على الفواتير (فتح/مراجعة/حل).

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _customerName(dynamic c) => c is Map ? (c['companyName'] ?? '—').toString() : '—';
String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

// ── متابعات التحصيل ─────────────────────────────────────────────────────────
class CollectionsScreen extends StatefulWidget {
  const CollectionsScreen({super.key});
  @override
  State<CollectionsScreen> createState() => _CollectionsScreenState();
}

const _actTypes = {
  'call': ('مكالمة', 'Call'),
  'email': ('بريد', 'Email'),
  'visit': ('زيارة', 'Visit'),
  'promise': ('وعد بالدفع', 'Promise'),
  'follow_up': ('متابعة', 'Follow-up'),
  'note': ('ملاحظة', 'Note'),
  'whatsapp': ('واتساب', 'WhatsApp'),
};

class _CollectionsScreenState extends State<CollectionsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('collection:updated', _onLive);
    Live.instance.on('collection:logged', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('collection:updated', _onLive);
    Live.instance.off('collection:logged', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/collections/follow-ups');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['followUps'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _complete(Map<String, dynamic> f) async {
    final amount = TextEditingController();
    final notes = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إنهاء المتابعة', 'Complete follow-up')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ المحصّل (اختياري)', 'Amount collected (optional)'))),
          const SizedBox(height: 10),
          TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إنهاء', 'Complete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/collections/${f['_id']}/complete', {
        if (amount.text.trim().isNotEmpty) 'amountCollected': num.tryParse(amount.text),
        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('متابعات التحصيل', 'Collection follow-ups')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد متابعات معلّقة 👌', 'No pending follow-ups 👌'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final f = _rows[i];
                            final ty = _actTypes[f['type']] ?? ('—', '—');
                            final due = DateTime.tryParse((f['followUpDate'] ?? f['nextFollowUpDate'] ?? '').toString());
                            final overdue = due != null && due.isBefore(DateTime.now());
                            return FadeSlideIn(
                              delayMs: (i * 12).clamp(0, 120),
                              child: AppCard(
                                topAccent: overdue ? T.danger : T.warn,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text(_customerName(f['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                    Chip2(tr(ty.$1, ty.$2), T.navy),
                                  ]),
                                  const SizedBox(height: 5),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    if (f['invoice'] is Map) Chip2('${f['invoice']['invoiceNumber'] ?? ''} · ${_money(f['invoice']['balance'] ?? f['invoice']['amount'])}', T.info),
                                    if (due != null) Chip2('${tr('الموعد', 'Due')}: ${_d(due.toIso8601String())}', overdue ? T.danger : T.warn, icon: Icons.event),
                                    if (f['promiseAmount'] != null) Chip2('${tr('وعد', 'Promise')}: ${_money(f['promiseAmount'])}', T.violet),
                                  ]),
                                  if ((f['notes'] ?? '').toString().isNotEmpty) ...[
                                    const SizedBox(height: 5),
                                    Text(f['notes'], style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                  ],
                                  const SizedBox(height: 6),
                                  Align(
                                    alignment: AlignmentDirectional.centerEnd,
                                    child: FilledButton.tonalIcon(
                                      onPressed: () => _complete(f),
                                      icon: const Icon(Icons.check, size: 17),
                                      label: Text(tr('إنهاء', 'Complete'), style: const TextStyle(fontSize: 12.5)),
                                    ),
                                  ),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// ── النزاعات ────────────────────────────────────────────────────────────────
class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});
  @override
  State<DisputesScreen> createState() => _DisputesScreenState();
}

const _disputeStatus = {
  'open': ('مفتوح', 'Open', T.warn),
  'under_review': ('قيد المراجعة', 'Under review', T.info),
  'resolved': ('محلول', 'Resolved', T.success),
};

class _DisputesScreenState extends State<DisputesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('dispute:updated', _onLive);
    Live.instance.on('dispute:opened', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('dispute:updated', _onLive);
    Live.instance.off('dispute:opened', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/disputes$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['disputes'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _update(Map<String, dynamic> disp, String status) async {
    final resolution = TextEditingController();
    final needsResolution = status == 'resolved';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(status == 'resolved' ? tr('حل النزاع', 'Resolve dispute') : tr('بدء المراجعة', 'Start review')),
        content: needsResolution
            ? TextField(controller: resolution, maxLines: 2, decoration: InputDecoration(labelText: tr('القرار / الحل', 'Resolution')))
            : Text(tr('نقل النزاع إلى قيد المراجعة؟', 'Move to under review?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/disputes/${disp['_id']}', {
        'status': status,
        if (needsResolution && resolution.text.trim().isNotEmpty) 'resolution': resolution.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('النزاعات', 'Disputes')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: Row(
                      children: _disputeStatus.entries.map((e) {
                        final selected = _status == e.key;
                        return Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: FilterChip(
                            selected: selected,
                            onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                            label: Text(tr(e.value.$1, e.value.$2)),
                            labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                            selectedColor: e.value.$3,
                            backgroundColor: e.value.$3.withValues(alpha: 0.1),
                            checkmarkColor: Colors.white,
                            side: BorderSide.none,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.gavel_outlined, title: tr('لا توجد نزاعات', 'No disputes'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final disp = _rows[i];
                                final st = _disputeStatus[disp['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(_customerName(disp['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text((disp['reason'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if (disp['invoice'] is Map) Chip2('${disp['invoice']['invoiceNumber'] ?? ''} · ${_money(disp['invoice']['balance'] ?? disp['invoice']['amount'])}', T.info),
                                        Chip2(_d(disp['createdAt']), T.inkFaint, icon: Icons.event),
                                      ]),
                                      if ((disp['resolution'] ?? '').toString().isNotEmpty) ...[
                                        const SizedBox(height: 5),
                                        Text('${tr('الحل', 'Resolution')}: ${disp['resolution']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: T.success)),
                                      ],
                                      if (disp['status'] != 'resolved') ...[
                                        const SizedBox(height: 6),
                                        Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                          if (disp['status'] == 'open')
                                            TextButton(onPressed: () => _update(disp, 'under_review'), child: Text(tr('مراجعة', 'Review'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.info))),
                                          const SizedBox(width: 4),
                                          FilledButton.tonal(
                                            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                                            onPressed: () => _update(disp, 'resolved'),
                                            child: Text(tr('حل', 'Resolve'), style: const TextStyle(fontSize: 12.5)),
                                          ),
                                        ]),
                                      ],
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }
}
