import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/file_upload.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';

/// إضافةُ موظّفٍ إلى سجلّ النقل الخفيف — ومعها ملفُّه في الموارد البشريّة.
///
/// الخادمُ (`createEmployee` في lightTransportController) يربطه بملفّه إن كانت
/// هويّتُه في الموارد البشريّة، وإلّا يُنشئ له ملفًّا في قسم B2C ويُشعِرهم
/// ليُكملوه. ومستنداتُه تُحفَظ في ذلك الملفّ: اسمٌ لكلّ مستند، وقد تتعدّد.
/// مطابقٌ لنموذج «إضافة موظف» في `/system/b2c/light-transport`.
///
/// يردّ `true` إن حُفظ.
Future<bool?> showLtAddEmployee(BuildContext context) => showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => const _LtAddEmployeeSheet(),
    );

/// سطرُ مستند: اسمُه (ومتحكّمُه يعيش مع السطر) والملفُّ المختار.
class _Doc {
  final title = TextEditingController();
  PickedFile? file;
}

class _LtAddEmployeeSheet extends StatefulWidget {
  const _LtAddEmployeeSheet();
  @override
  State<_LtAddEmployeeSheet> createState() => _LtAddEmployeeSheetState();
}

class _LtAddEmployeeSheetState extends State<_LtAddEmployeeSheet> {
  final _name = TextEditingController();
  final _idNumber = TextEditingController();
  final _project = TextEditingController();
  final _city = TextEditingController();
  final _contract = TextEditingController();
  final _register = TextEditingController();
  final _nationality = TextEditingController();
  final _phone = TextEditingController();
  String _hireDate = '';
  String _birthDate = '';
  final List<_Doc> _docs = [];
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_name, _idNumber, _project, _city, _contract, _register, _nationality, _phone]) { c.dispose(); }
    for (final d in _docs) { d.title.dispose(); }
    super.dispose();
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  String _dmy(String ymd) => ymd.isEmpty ? '' : ymd.split('-').reversed.join('/');

  Future<void> _pickDate({required bool birth}) async {
    final now = DateTime.now();
    final cur = DateTime.tryParse(birth ? _birthDate : _hireDate) ?? (birth ? DateTime(now.year - 25) : now);
    final d = await showDatePicker(
      context: context,
      firstDate: birth ? DateTime(1940) : DateTime(2000),
      lastDate: birth ? now : DateTime(now.year + 1),
      initialDate: cur,
    );
    if (d != null) setState(() => birth ? _birthDate = _ymd(d) : _hireDate = _ymd(d));
  }

  Future<void> _pickDoc(_Doc doc) async {
    final f = await pickFileAsDataUrl();
    if (f == null || !mounted) return;
    setState(() {
      doc.file = f;
      // الاسمُ الفارغ يُملأ من اسم الملفّ بلا امتداده — ويبقى قابلًا للتعديل.
      if (doc.title.text.trim().isEmpty) doc.title.text = f.fileName.replaceFirst(RegExp(r'\.[^.]+$'), '');
    });
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final idNumber = _idNumber.text.replaceAll(RegExp(r'\s+'), '');
    if (name.isEmpty) return _say(tr('اكتب الاسم', 'Enter the name'));
    if (idNumber.isEmpty) return _say(tr('اكتب رقمَ الهوية أو الإقامة', 'Enter the ID / iqama number'));
    final ready = _docs.where((d) => d.file != null).toList();
    if (ready.any((d) => d.title.text.trim().isEmpty)) return _say(tr('اكتب اسمَ كلّ مستندٍ مرفق', 'Name every attached document'));
    setState(() => _saving = true);
    try {
      final r = await Api.instance.post('/api/light-transport/employees', {
        'name': name,
        'idNumber': idNumber,
        if (_hireDate.isNotEmpty) 'hireDate': _hireDate,
        if (_birthDate.isNotEmpty) 'dateOfBirth': _birthDate,
        'projectAr': _project.text.trim(),
        'cityAr': _city.text.trim(),
        'contractTypeAr': _contract.text.trim(),
        'registerNumber': _register.text.trim(),
        'nationalityAr': _nationality.text.trim(),
        'phone': _phone.text.trim(),
        'files': [
          for (final d in ready) {'title': d.title.text.trim(), 'fileName': d.file!.fileName, 'dataUrl': d.file!.dataUrl},
        ],
      });
      if (!mounted) return;
      _say(r is Map && r['hrCreated'] == true
          ? tr('أُنشئ ملفُّه في الموارد البشريّة — وصلهم إشعارٌ لإكمال بياناته.', 'His HR file was created — HR has been notified to complete it.')
          : tr('حُفظ', 'Saved'));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _saving = false); _say(e.toString()); }
    }
  }

  Widget _dateField(String label, String value, {required bool birth}) => InkWell(
        onTap: () => _pickDate(birth: birth),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: value.isEmpty
                ? const Icon(Icons.event, size: 18)
                : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => birth ? _birthDate = '' : _hireDate = '')),
          ),
          child: Text(_dmy(value), style: const TextStyle(fontSize: 14)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 10);
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('إضافة موظف', 'Add employee'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 12),
          TextField(controller: _name, decoration: InputDecoration(labelText: tr('الاسم *', 'Name *'))),
          gap,
          TextField(
            controller: _idNumber, keyboardType: TextInputType.number, textDirection: TextDirection.ltr,
            decoration: InputDecoration(labelText: tr('رقم الهوية / الإقامة *', 'ID / iqama number *')),
          ),
          gap,
          Row(children: [
            Expanded(child: _dateField(tr('تاريخ التعيين', 'Hire date'), _hireDate, birth: false)),
            const SizedBox(width: 10),
            Expanded(child: _dateField(tr('تاريخ الميلاد', 'Date of birth'), _birthDate, birth: true)),
          ]),
          gap,
          // القيمُ الثابتةُ قوائمُ مُدارةٌ من إعدادات القسم، وتُخزَّن بنصِّها العربيّ.
          Row(children: [
            Expanded(child: LookupField(type: 'lt_project', controller: _project, label: tr('المشروع', 'Project'))),
            const SizedBox(width: 10),
            Expanded(child: LookupField(type: 'lt_city', controller: _city, label: tr('المدينة / الفرع', 'City / branch'))),
          ]),
          gap,
          Row(children: [
            Expanded(child: LookupField(type: 'lt_contract_type', controller: _contract, label: tr('نوع التعاقد', 'Contract type'), fallback: const ['كفالة', 'فري لانسر'])),
            const SizedBox(width: 10),
            Expanded(child: LookupField(type: 'lt_register', controller: _register, label: tr('السجل', 'Register'))),
          ]),
          gap,
          Row(children: [
            Expanded(child: TextField(controller: _nationality, decoration: InputDecoration(labelText: tr('الجنسية', 'Nationality')))),
            const SizedBox(width: 10),
            Expanded(child: TextField(
              controller: _phone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: tr('الجوال', 'Phone')),
            )),
          ]),
          const SizedBox(height: 14),
          // ── مستنداتُ الموظّف ──────────────────────────────────────────────
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(tr('مستندات الموظف', 'Employee documents'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                TextButton.icon(
                  onPressed: _saving ? null : () => setState(() => _docs.add(_Doc())),
                  icon: const Icon(Icons.add, size: 16),
                  label: Text(tr('إضافة مستند', 'Add document')),
                ),
              ]),
              Text(
                tr('تُحفَظ في ملفّه بالموارد البشريّة (صورة الإقامة، الجواز، العقد…). اختياريّة، وقد تتعدّد.', 'Saved to his HR file (iqama, passport, contract…). Optional; add as many as needed.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
              ),
              for (final d in _docs) Padding(
                key: ObjectKey(d),
                padding: const EdgeInsets.only(top: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: TextField(
                      controller: d.title,
                      decoration: InputDecoration(isDense: true, labelText: tr('اسم المستند *', 'Document name *'), hintText: tr('مثل: صورة الإقامة', 'e.g. Iqama copy')),
                    )),
                    IconButton(
                      visualDensity: VisualDensity.compact, tooltip: tr('إزالة', 'Remove'),
                      icon: const Icon(Icons.close, size: 18, color: T.inkFaint),
                      // المتحكّمُ يُتلَف بعد أن يُرفَع حقلُه عن الشاشة، لا قبله.
                      onPressed: () { setState(() => _docs.remove(d)); WidgetsBinding.instance.addPostFrameCallback((_) => d.title.dispose()); },
                    ),
                  ]),
                  const SizedBox(height: 4),
                  OutlinedButton.icon(
                    onPressed: _saving ? null : () => _pickDoc(d),
                    icon: Icon(d.file == null ? Icons.attach_file : Icons.check_circle_outline, size: 16, color: d.file == null ? null : T.success),
                    label: Text(d.file?.fileName ?? tr('اختيار الملف', 'Choose file'), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                ]),
              ),
            ]),
          ),
          gap,
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.success.withValues(alpha: 0.3))),
            child: Text(
              tr('عند الحفظ يُنشأ ملفُّه في الموارد البشريّة (قسم B2C) إن لم يكن له ملفّ، وتُكمل الموارد البشريّة بقيّةَ بياناته.', 'On save his HR file is created (department B2C) if he has none; HR completes the rest.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _save, child: Text(tr('حفظ', 'Save')))),
        ]),
      ),
    );
  }
}
