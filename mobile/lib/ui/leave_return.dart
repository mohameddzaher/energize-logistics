import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';
import 'widgets.dart';

/// Return from leave: state chip + HR actions (record return, extend, no-show).
/// Server rules live in backend utils/leaveReturn; mirrors web LeaveReturn.tsx.

String _ymd(dynamic v) {
  final s = (v ?? '').toString();
  return s.length >= 10 ? s.substring(0, 10) : s;
}

String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
DateTime _parse(String ymd) => DateTime.utc(int.parse(ymd.substring(0, 4)), int.parse(ymd.substring(5, 7)), int.parse(ymd.substring(8, 10)));
String _addDays(String ymd, int n) => _iso(_parse(ymd).add(Duration(days: n)));
int _diff(String a, String b) => _parse(b).difference(_parse(a)).inDays;

/// Company day (Riyadh, UTC+3, no DST).
String companyToday() => _iso(DateTime.now().toUtc().add(const Duration(hours: 3)));

/// Where an approved leave stands today; null when it is not approved.
(String, Color)? leaveReturnState(Map<String, dynamic> l) {
  if (l['status'] != 'approved') return null;
  final today = companyToday();
  final start = _ymd(l['startDate']);
  final end = _ymd(l['endDate']);
  if (start.length < 10 || end.length < 10) return null;
  final planned = _ymd(l['plannedEndDate']).length == 10 ? _ymd(l['plannedEndDate']) : end;
  final rs = (l['returnState'] ?? '').toString();
  if (rs == 'no_show') {
    final since = (l['noShow'] is Map ? l['noShow']['since'] : null) ?? _addDays(end, 1);
    return (tr('لم يعد — مخالفة منذ $since', 'Did not return — since $since'), T.danger);
  }
  if (rs == 'returned') {
    final starts = (l['workStartsOn'] ?? '').toString().isNotEmpty ? l['workStartsOn'] : _addDays(end, 1);
    final shift = _diff(planned, end);
    final extra = shift < 0 ? tr(' · مبكرًا ${-shift} يوم', ' · ${-shift}d early') : shift > 0 ? tr(' · متأخرًا $shift يوم', ' · ${shift}d late') : '';
    final auto = l['returnAuto'] == true ? tr(' (تلقائي)', ' (auto)') : '';
    return (tr('عاد — يباشر $starts$extra$auto', 'Returned — works from $starts$extra$auto'), shift < 0 ? T.info : shift > 0 ? T.warn : T.success);
  }
  if (start.compareTo(today) > 0) return (tr('تبدأ $start', 'Starts $start'), T.inkFaint);
  if (end.compareTo(today) >= 0) {
    final ext = (l['extensions'] as List?)?.isNotEmpty == true ? tr(' · مُمدَّدة', ' · extended') : '';
    return (tr('في الإجازة — يعود ${_addDays(end, 1)}$ext', 'On leave — back ${_addDays(end, 1)}$ext'), T.info);
  }
  return (tr('انتهت $end — بانتظار العودة', 'Ended $end — return pending'), T.warn);
}

class LeaveReturnChip extends StatelessWidget {
  final Map<String, dynamic> leave;
  const LeaveReturnChip(this.leave, {super.key});
  @override
  Widget build(BuildContext context) {
    final s = leaveReturnState(leave);
    if (s == null) return const SizedBox.shrink();
    return Chip2(s.$1, s.$2);
  }
}

/// Opens the HR actions sheet for one approved leave. Calls [onDone] after a save.
Future<void> showLeaveReturnSheet(BuildContext context, Map<String, dynamic> leave, Future<void> Function() onDone) async {
  if (leave['status'] != 'approved') return;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (c) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
      child: _LeaveReturnSheet(leave: leave, onDone: onDone),
    ),
  );
}

class _LeaveReturnSheet extends StatefulWidget {
  final Map<String, dynamic> leave;
  final Future<void> Function() onDone;
  const _LeaveReturnSheet({required this.leave, required this.onDone});
  @override
  State<_LeaveReturnSheet> createState() => _LeaveReturnSheetState();
}

class _LeaveReturnSheetState extends State<_LeaveReturnSheet> {
  String _mode = '';
  late String _returnDate;
  bool _sameDay = false;
  late String _newEnd;
  final _note = TextEditingController();
  bool _busy = false;

  Map<String, dynamic> get l => widget.leave;
  String get _start => _ymd(l['startDate']);
  String get _end => _ymd(l['endDate']);
  String get _planned => _ymd(l['plannedEndDate']).length == 10 ? _ymd(l['plannedEndDate']) : _end;

  @override
  void initState() {
    super.initState();
    final today = companyToday();
    // Editing a recorded return starts from it; otherwise the return day is still leave by default, so an on-time return date is the end date.
    final recorded = l['returnState'] == 'returned' && l['returnAuto'] != true && _ymd(l['returnedOn']).length == 10;
    _returnDate = recorded ? _ymd(l['returnedOn']) : (_end.compareTo(today) < 0 ? _end : today);
    if (recorded) _sameDay = l['returnCountsAsWork'] == true;
    _newEnd = _addDays(_end, 1);
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _send(String path, Map<String, dynamic> body, String ok) async {
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/api/hr/leaves/${l['_id']}/$path', body);
      final bal = r is Map && r['balance'] is Map ? r['balance']['available'] : null;
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(bal == null ? ok : '$ok — ${tr('الرصيد المتاح', 'available balance')} $bal')));
      await widget.onDone();
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<String?> _pick(String initial, String first, String? last) async {
    final d = await showDatePicker(
      context: context,
      initialDate: _parse(initial).toLocal(),
      firstDate: _parse(first).toLocal(),
      lastDate: last == null ? DateTime(DateTime.now().year + 2) : _parse(last).toLocal(),
    );
    return d == null ? null : _iso(d);
  }

  @override
  Widget build(BuildContext context) {
    final today = companyToday();
    final rs = (l['returnState'] ?? '').toString();
    final manualReturn = rs == 'returned' && l['returnAuto'] != true;
    final canReturn = _start.compareTo(today) <= 0 && rs != 'returned';
    final canExtend = rs != 'returned';
    final canNoShow = _end.compareTo(today) < 0 && !manualReturn && rs != 'no_show';
    final state = leaveReturnState(l);
    final exts = List<Map<String, dynamic>>.from(l['extensions'] ?? []);

    final previewEnd = _sameDay ? _addDays(_returnDate, -1) : _returnDate;
    final previewDays = previewEnd.compareTo(_start) >= 0 ? _diff(_start, previewEnd) + 1 : 0;
    final shift = _diff(_planned, previewEnd);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Text(tr('العودة من الإجازة', 'Return from leave'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 6),
          Text('$_start ← $_end · ${l['days'] ?? '—'} ${tr('يوم', 'days')}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          if (state != null) ...[const SizedBox(height: 6), Align(alignment: AlignmentDirectional.centerStart, child: Chip2(state.$1, state.$2))],
          if (_planned != _end)
            Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('النهاية المخططة $_planned — الفعلية $_end', 'Planned end $_planned — actual $_end'), style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          for (final x in exts)
            Text(tr('تمديد: ${x['fromEnd']} → ${x['toEnd']} (+${x['days']} يوم)', 'Extended: ${x['fromEnd']} → ${x['toEnd']} (+${x['days']}d)'), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (canReturn) ChoiceChip(label: Text(tr('تسجيل عودة', 'Record return')), selected: _mode == 'return', onSelected: (_) => setState(() => _mode = 'return')),
            if (manualReturn) ChoiceChip(label: Text(tr('تعديل تاريخ العودة والمباشرة', 'Edit return date')), selected: _mode == 'return', onSelected: (_) => setState(() => _mode = 'return')),
            if (canExtend) ChoiceChip(label: Text(tr('تمديد', 'Extend')), selected: _mode == 'extend', onSelected: (_) => setState(() => _mode = 'extend')),
            if (canNoShow) ChoiceChip(label: Text(tr('مخالفة — لم يعد', 'No-show')), selected: _mode == 'noshow', onSelected: (_) => setState(() => _mode = 'noshow')),
          ]),
          if (!canReturn && !manualReturn && !canExtend && !canNoShow)
            Text(tr('لا إجراءات متاحة على هذه الإجازة.', 'No actions available on this leave.'), style: const TextStyle(color: T.inkFaint)),
          if (_mode == 'return') ...[
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () async {
                final d = await _pick(_returnDate, _start, today);
                if (d != null) setState(() => _returnDate = d);
              },
              child: Text('${tr('تاريخ العودة', 'Return date')}: $_returnDate'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _sameDay,
              onChanged: (v) => setState(() => _sameDay = v),
              title: Text(tr('يبدأ العمل في نفس يوم العودة', 'Starts work on the return day'), style: const TextStyle(fontSize: 13.5)),
              subtitle: Text(tr('يوم العودة يُحسب عملًا لا إجازة', 'The return day counts as work'), style: const TextStyle(fontSize: 12)),
            ),
            Text(
              tr('يباشر العمل ${_sameDay ? _returnDate : _addDays(_returnDate, 1)} · الإجازة $_start → $previewEnd ($previewDays يوم)',
                  'Works from ${_sameDay ? _returnDate : _addDays(_returnDate, 1)} · leave $_start → $previewEnd (${previewDays}d)')
                  + (shift < 0 ? tr(' · يُعاد ${-shift} يوم إلى رصيده', ' · ${-shift}d back to the balance') : '')
                  + (shift > 0 ? tr(' · يُخصم $shift يوم إضافي', ' · ${shift}d extra charged') : ''),
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            const SizedBox(height: 8),
            TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            const SizedBox(height: 10),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.success),
              onPressed: _busy || previewDays == 0 ? null : () => _send('return', {'returnDate': _returnDate, 'startsSameDay': _sameDay, 'note': _note.text.trim()}, manualReturn ? tr('عُدِّل تاريخ العودة', 'Return date updated') : tr('سُجِّلت العودة', 'Return recorded')),
              child: Text(tr('حفظ العودة', 'Save return')),
            ),
          ],
          if (_mode == 'extend') ...[
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () async {
                final d = await _pick(_newEnd, _addDays(_end, 1), null);
                if (d != null) setState(() => _newEnd = d);
              },
              child: Text('${tr('النهاية الجديدة', 'New end date')}: $_newEnd'),
            ),
            const SizedBox(height: 6),
            Text(tr('+${_diff(_end, _newEnd)} يوم تُخصم من الرصيد · يعود ${_addDays(_newEnd, 1)}', '+${_diff(_end, _newEnd)}d charged · back ${_addDays(_newEnd, 1)}'),
                style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 8),
            TextField(controller: _note, decoration: InputDecoration(labelText: tr('سبب التمديد (اختياري)', 'Reason (optional)'))),
            const SizedBox(height: 10),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.info),
              onPressed: _busy ? null : () => _send('extend', {'newEndDate': _newEnd, 'note': _note.text.trim()}, tr('مُدِّدت الإجازة', 'Leave extended')),
              child: Text(tr('حفظ التمديد', 'Save extension')),
            ),
          ],
          if (_mode == 'noshow') ...[
            const SizedBox(height: 12),
            Text(tr('انتهت الإجازة في $_end ولم يعد ولم تُمدَّد. يصبح «مخالفة — لم يعد من الإجازة» من ${_addDays(_end, 1)} حتى تُسجَّل عودته أو تُمدَّد.',
                'The leave ended on $_end. The employee becomes "violation — did not return" from ${_addDays(_end, 1)} until a return or extension is recorded.'),
                style: const TextStyle(fontSize: 12.5, color: T.danger)),
            const SizedBox(height: 8),
            TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            const SizedBox(height: 10),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.danger),
              onPressed: _busy ? null : () => _send('no-show', {'note': _note.text.trim()}, tr('سُجِّلت المخالفة', 'No-show recorded')),
              child: Text(tr('تسجيل المخالفة', 'Record no-show')),
            ),
          ],
        ]),
      ),
    );
  }
}
