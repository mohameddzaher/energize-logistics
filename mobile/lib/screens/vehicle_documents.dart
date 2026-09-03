import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/filter_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show docLabel, fmtDate, daysText, money, statusColor, statusLabel;
import '../services/flex_match.dart';

/// ── شاشةُ عائلةِ مستندٍ واحدة، نظيرُ صفحات المستندات في الموقع ─────────────
///
/// المشكلة التي تحلّها ليست نقصًا في البيانات: أرقام بطاقات التشغيل والتفاويض
/// ووثائق التأمين مسجَّلةٌ كلُّها منذ الاستيراد، وكانت لا تجد في أي شاشة عمودًا
/// يعرضها. فيفلتر المستخدم على بطاقة التشغيل فيحصل على المركبات الصحيحة بلا
/// رقمِ بطاقةٍ واحد، فيظنّ الملف لم يُستورَد.
///
/// وعائلةٌ واحدةٌ في الشاشة لا المستندات الستّة مجتمعة: مجموعُها يجاوز الأربعين
/// حقلًا، وهي في الملف المصدر مجموعةٌ عائلةً عائلة بلونها — والشاشة تتبع الورقة
/// التي يعرفها القسم.
///
/// ولماذا شاشةٌ واحدةٌ موصوفةٌ بالبيانات لا سبعُ شاشات منسوخة: النسخُ يفترق عند
/// أوّل تعديل — يُصلَح زرُّ التجديد في واحدة ويبقى معطوبًا في ستّ.

/// حقلٌ يُعرَض في بطاقة المركبة: كيف يُقرأ من المركبة وكيف يُسمّى.
class DocField {
  final String ar, en;
  final String Function(Map v) get;

  /// أرقامُ الأوراق تُقرأ يسارًا إلى يمين مهما كانت لغة الشاشة.
  final bool mono;
  const DocField(this.ar, this.en, this.get, {this.mono = false});
}

/// حقلٌ من حقول العائلة **يُكتب** — وهو غيرُ `DocField` الذي يُعرَض.
///
/// العرضُ قد يكون محسوبًا: «مفتوح — بلا سقف» نصٌّ يُبنى من حقلين، ولا يُكتب في
/// أيّ منهما بهذه الصيغة. أمّا ما يُكتب فلا بدّ له من مسارٍ حقيقيّ في المركبة،
/// وإلا حُفظ في لا مكان وعاد الصفُّ كما كان بعد التحديث.
class DocEditField {
  /// المسار في مستند المركبة: `operatingCard.cardNumber`.
  final String path;
  final String ar, en;

  /// text · date · number · flag
  final String kind;

  /// خانةُ الاختيار تكتب نصًّا لا صحيحًا/خطأً: «مفتوح» في `fuelCard.limitStatus`.
  final String on, off;
  final bool mono;

  /// نوعُ قائمةٍ منسدلة يُملأ منها الحقل بدل الكتابة الحرّة، تُدار من
  /// «إعدادات القسم ← القوائم المنسدلة». يُخزَّن الاسمُ العربيّ لا المفتاح،
  /// لأنّ المخزَّن نصٌّ عربيٌّ منذ أوّل استيراد وتقرؤه الفلاتر والتصديرات.
  final String? lookup;
  const DocEditField(this.path, this.ar, this.en,
      {this.kind = 'text', this.on = 'open', this.off = '', this.mono = false, this.lookup});
}

/// شريحةُ تصفيةٍ محلّيةٍ فوق الصفوف المحمَّلة.
class DocChip {
  final String key, ar, en;
  final Color tone;
  final bool Function(Map v)? test;
  const DocChip(this.key, this.ar, this.en, this.tone, [this.test]);
}

class DocFamily {
  /// مفتاح المستند ذي تاريخ الانتهاء — أو `null` لعائلةٍ لا تنتهي.
  ///
  /// شريحةُ بترو اب من هذا الثاني: لها رقمٌ وحالةٌ وسقفُ صرف ولا تاريخَ انتهاء.
  /// وإقحامُها في عمود «الأيام المتبقية» يجعل الأسطول كلَّه يظهر «بلا تاريخ» في
  /// شاشةٍ لا معنى للتاريخ فيها — نقصٌ مُختلَق يُوهم أن ثَمّ عملًا مطلوبًا.
  /// ومعه يسقط زرُّ التجديد: لا يُجدَّد ما لا ينتهي.
  final String? docKey;
  final String arTitle, enTitle;
  final IconData icon;
  final List<DocField> fields;
  final List<String> Function(Map v) searchIn;
  final List<DocChip>? chips;

  /// حقولُ هذه العائلة وحدها — وبها وحدها تُفتَح الإضافةُ والتعديل والمسح.
  ///
  /// ولا تُفتَح من هنا استمارةُ المركبة الكاملة: فيها سبعةٌ وأربعون حقلًا تخصّ
  /// سبعَ عائلاتٍ أخرى، ومن فتحها ليصحّح رقمَ بطاقةٍ مرّ على التأمين والفحص في
  /// طريقه — فتصير كلُّ شاشةٍ بابًا خلفيًّا إلى كل شيء. تلك شاشةُ سجل المركبات.
  final List<DocEditField> editable;

  /// هل هذا المستند ورقةٌ واحدةٌ تغطّي عدّة مركبات؟
  ///
  /// وثيقةُ تأمينٍ واحدة تغطّي مئةً وثمانيًا وتسعين مركبة، ورقمُها واحدٌ عليها
  /// كلِّها، وتجديدُها حدثٌ واحد. أمّا بطاقةُ التشغيل والتفويض فورقةٌ لكلّ
  /// مركبةٍ برقمها، ورقمٌ واحدٌ على مئةٍ منها يجعل المئةَ نسخةً من ورقةٍ واحدة.
  /// نسخةٌ من `sharedNumber` في الخادم، والخادمُ يرفض المخالف.
  final bool sharedPaper;
  const DocFamily({
    required this.docKey,
    required this.arTitle,
    required this.enTitle,
    required this.icon,
    required this.fields,
    required this.searchIn,
    this.chips,
    this.editable = const [],
    this.sharedPaper = false,
  });
}

String _s(dynamic v) => (v == null) ? '' : v.toString();
Map _sub(Map v, String k) => (v[k] is Map) ? v[k] as Map : const {};
/// قراءةُ مسارٍ منقوط — المسار نصٌّ لا يُعرَف إلا وقت التشغيل.
dynamic _readPath(Map v, String path) {
  dynamic cur = v;
  for (final k in path.split('.')) {
    if (cur is! Map) return null;
    cur = cur[k];
  }
  return cur;
}

/// ما يُرسَل إلى الخادم **متداخلٌ دائمًا**، لا `{'gps.serialImei': …}`.
///
/// `express-mongo-sanitize` على الخادم يحذف كلَّ مفتاحٍ فيه نقطة قبل أن يصل إلى
/// المتحكّم، فالمسارُ المنقوط يُرسَل ويختفي في صمت: تظهر «تم الحفظ» ولا يتغيّر
/// شيء. والمتحكّم هو الذي يُسطِّح المتداخلَ فيدمج بدل أن يستبدل الكائنَ كلَّه.
void _writePath(Map<String, dynamic> out, String path, dynamic val) {
  final ks = path.split('.');
  Map<String, dynamic> cur = out;
  for (final k in ks.sublist(0, ks.length - 1)) {
    cur[k] = (cur[k] is Map<String, dynamic>) ? cur[k] : <String, dynamic>{};
    cur = cur[k] as Map<String, dynamic>;
  }
  cur[ks.last] = val;
}

Map<String, dynamic> _buildPatch(List<DocEditField> fields, Map<String, dynamic> vals) {
  final out = <String, dynamic>{};
  for (final f in fields) {
    final raw = vals[f.path];
    dynamic v;
    if (f.kind == 'number') {
      v = (raw == null || '$raw'.trim().isEmpty) ? null : num.tryParse('$raw'.trim());
    } else if (f.kind == 'date') {
      v = (raw == null || '$raw'.isEmpty) ? null : raw;
    } else if (f.kind == 'flag') {
      v = (raw == true) ? f.on : f.off;
    } else {
      v = raw ?? '';
    }
    _writePath(out, f.path, v);
  }
  return out;
}

/// أوّلُ جزءٍ من كل مسار — الكائنُ الذي تعيش فيه العائلة (`gps`, `insurance`…).
List<String> _rootsOf(List<DocEditField> fields) =>
    fields.map((f) => f.path.split('.').first).toSet().toList();

/// أهذه المركبة مسجَّلٌ عليها شيءٌ من هذه العائلة أصلًا؟
bool _hasDoc(Map v, List<DocEditField> fields) => fields.any((f) {
      final x = _readPath(v, f.path);
      return x != null && '$x'.isNotEmpty;
    });

/// الطيُّ الموحَّد — راجع services/flex_match.
String _fold(String s) => flexFold(s);

/// حالةُ هذا المستند على هذه المركبة كما حسبها الخادم بعتبات الإعدادات.
/// لا تُحسَب هنا، وإلا اختلفت ألوانُ هذه الشاشة عن شاشة التنبيهات على المركبة
/// نفسِها — والمستخدم يرى الشاشتين في اليوم نفسه.
Map<String, dynamic> _state(Map v, String docKey) {
  final st = (v['docStatuses'] is Map) ? (v['docStatuses'][docKey] as Map?) : null;
  return {'status': _s(st?['status']).isEmpty ? 'none' : _s(st?['status']), 'days': st?['days']};
}

class VehicleDocumentsScreen extends StatefulWidget {
  final DocFamily family;
  const VehicleDocumentsScreen({super.key, required this.family});
  @override
  State<VehicleDocumentsScreen> createState() => _VehicleDocumentsScreenState();
}

class _VehicleDocumentsScreenState extends State<VehicleDocumentsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, String> _filters = {};
  String _q = '';
  String _chip = '';
  int _total = 0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (mounted) _load(); };
    Live.instance.on('vreg:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = <String>['limit=2000'];
      _filters.forEach((k, v) { if (v.isNotEmpty) p.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/vehicle-registry?${p.join('&')}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
        _total = (d['total'] ?? 0) as int;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<DocChip> get _chips {
    final f = widget.family;
    if (f.chips != null) return f.chips!;
    final k = f.docKey;
    if (k == null) return const [DocChip('', 'الكل', 'All', T.navy)];
    // ── أربعُ شرائحَ يقرؤها المستخدم ───────────────────────────────────────
    //
    // كانت خمسًا، وثلاثٌ منها شيءٌ واحدٌ بثلاث درجاتٍ من الإلحاح: «ينتهي قريبًا
    // جدًا» و«قارب على الانتهاء» و«على الرادار». وسأل صاحبُ القسم: «يا ساري يا
    // قارب على الانتهاء يا منتهي» — وهو محقّ، والشريحةُ التي تحتاج شرحًا ليست
    // فلترًا. فصارت باسمٍ واحد، واللونُ وحدَه يفرّق الدرجات.
    //
    // و«بلا تاريخ مسجَّل» انضمّت إلى «مطلوب»: كلتاهما عملٌ ينتظر، وفصلُهما يجعل
    // قائمةَ العمل نصفين لا يُقرآن معًا. والاسمُ يحمل اسمَ المستند — «التأمين
    // منتهٍ» لا «منتهٍ» — لأنّ «منتهٍ» وحدَها تترك السائل يسأل: منتهٍ ماذا؟
    // توأمُ هذا في components/vehicles/DocumentFamilyPage.tsx.
    final due = ['critical', 'warning', 'upcoming'];
    return [
      const DocChip('', 'الكل', 'All', T.navy),
      DocChip('expired', '${f.arTitle} منتهٍ', '${f.enTitle} expired', T.danger,
          (v) => _state(v, k)['status'] == 'expired'),
      DocChip('due', 'قارب على الانتهاء', 'Due soon', const Color(0xFFCA8A04),
          (v) => due.contains(_state(v, k)['status'])),
      DocChip('valid', 'ساري', 'Valid', T.success, (v) => _state(v, k)['status'] == 'valid'),
      DocChip('needed', 'مطلوب — ناقص', 'Needed — missing', T.danger,
          (v) => ['none', 'missing', 'required'].contains(_state(v, k)['status'])),
    ];
  }

  // ── مَن يكتب في القسم: نفس القسمة التي في الخادم وفي الموقع ───────────────
  // ثلاث قوائم متفرّقة كانت تفترق عند أوّل دورٍ جديد، فمديرُ المركبات يرى قسمه
  // ولا يقدر يعدّل فيه من الجوّال وحده.
  static const _editRoles = {'super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
    'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'};
  static const _adminRoles = {'super_admin', 'admin', 'vehicles_manager', 'hr_manager'};

  /// اختيارُ المركبة التي يُسجَّل عليها المستند.
  ///
  /// و«الإنشاء» هنا ليس إنشاءَ مركبة: المركبةُ تُولد في شاشة سجل المركبات بلوحتها
  /// وهيكلها وقطاعها، ولا يصحّ أن تُولد من شاشة بطاقات التشغيل ببطاقةٍ فقط فتدخل
  /// الأسطولَ ناقصةَ الهوية من بابٍ جانبيّ. الذي ينقص فعلًا مستندٌ لم يُسجَّل بعد
  /// على مركبةٍ قائمة — فالقائمة تبدأ بمن لا مستندَ له.
  Future<Map<String, dynamic>?> _pickVehicle() async {
    final fields = widget.family.editable;
    List<Map<String, dynamic>>? pool;
    var onlyMissing = true;
    var q = '';
    // القائمةُ تُجلب غيرَ مفلترة: فلترُ الشاشة سؤالٌ عن المعروض، لا حدٌّ لما
    // يجوز تسجيلُه — من يفلتر على «المنتهي» لا يقصد منعَ مركبةٍ سارية.
    Api.instance.get('/api/vehicle-registry?limit=2000').then((d) {
      pool = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
    }).catchError((_) { pool = <Map<String, dynamic>>[]; });

    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setSheet) {
        // إعادةُ الرسم حتى تصل القائمة — لا مؤقّت ولا تحميلٌ مسبق قبل الفتح.
        if (pool == null) {
          Future.delayed(const Duration(milliseconds: 120), () { if (c.mounted) setSheet(() {}); });
        }
        final all = pool ?? const <Map<String, dynamic>>[];
        final q2 = _fold(q);
        final list = all.where((v) {
          if (onlyMissing && _hasDoc(v, fields)) return false;
          if (q2.isEmpty) return true;
          return [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(v['departmentAr']), _s(v['sectorAr'])]
              .any((x) => _fold(x).contains(q2));
        }).take(400).toList();
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.7,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('اختر المركبة', 'Pick a vehicle'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              TextField(
                autofocus: false,
                onChanged: (v) => setSheet(() => q = v),
                decoration: InputDecoration(hintText: tr('ابحث بلوحة أو مالك أو إدارة…', 'Search plate, owner or department…'), prefixIcon: const Icon(Icons.search)),
              ),
              // الافتراضُ «التي بلا بيانات»: هي سببُ فتح الشاشة. ومن أراد تصحيح
              // مركبةٍ مسجَّلة يرفع العلامة — لا يُمنع منها.
              SwitchListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: onlyMissing,
                onChanged: (b) => setSheet(() => onlyMissing = b),
                title: Text(tr('التي لا بيانات لها فقط', 'Only vehicles with no data'), style: const TextStyle(fontSize: 12.5)),
              ),
              Expanded(
                child: pool == null
                    ? const Center(child: CircularProgressIndicator())
                    : list.isEmpty
                        ? Center(child: Text(tr('لا مركبات مطابقة', 'No matching vehicles'), style: const TextStyle(color: T.inkFaint)))
                        : ListView.separated(
                            itemCount: list.length,
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (c2, i) => ListTile(
                              dense: true,
                              title: Text(_s(list[i]['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                              subtitle: Text([_s(list[i]['ownerNameAr']), _s(list[i]['departmentAr']), _s(list[i]['cityAr'])].where((x) => x.isNotEmpty).join(' · '),
                                  maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5)),
                              onTap: () => Navigator.pop(c, list[i]),
                            ),
                          ),
              ),
            ]),
          ),
        );
      }),
    );
  }

  /// استمارةُ العائلة — حقولُها وحدها، على مركبةٍ قائمة.
  Future<void> _editDoc(Map<String, dynamic>? row) async {
    final fields = widget.family.editable;
    if (fields.isEmpty) return;
    var v = row;
    if (v == null) {
      v = await _pickVehicle();
      if (v == null || !mounted) return;
    }
    final target = v;
    final vals = <String, dynamic>{};
    final ctrls = <String, TextEditingController>{};
    // القوائمُ المنسدلة تُجلب قبل فتح الورقة: جلبُها داخل `build` يعيد النداء
    // مع كلّ إعادة رسم، وهو ما يجعل خانةً واحدةً تنادي الخادم عشراتِ المرّات.
    final lookups = <String, List<String>>{};
    for (final f in fields.where((x) => x.lookup != null)) {
      if (lookups.containsKey(f.lookup)) continue;
      try {
        final d = await Api.instance.get('/api/lookups?type=${Uri.encodeComponent(f.lookup!)}&active=true');
        lookups[f.lookup!] = List<Map<String, dynamic>>.from(d['items'] ?? [])
            .map((i) => _s(i['nameAr']).isEmpty ? _s(i['nameEn']) : _s(i['nameAr']))
            .where((x) => x.isNotEmpty).toList();
      } catch (_) { lookups[f.lookup!] = const []; }
    }
    // جلبُ القوائم انتظارٌ على الشبكة، وقد تُغلق الشاشة أثناءه.
    if (!mounted) { for (final ctl in ctrls.values) { ctl.dispose(); } return; }
    for (final f in fields) {
      final raw = _readPath(target, f.path);
      if (f.kind == 'flag') {
        vals[f.path] = raw != null && '$raw' == f.on;
      } else if (f.kind == 'date') {
        vals[f.path] = raw == null ? '' : '$raw'.split('T').first;
      } else {
        vals[f.path] = raw == null ? '' : '$raw';
        ctrls[f.path] = TextEditingController(text: '$raw' == 'null' ? '' : '${raw ?? ''}');
      }
      // الحقلُ ذو القائمة يُكتب من `vals` مباشرةً — ولو استمع لمراقبٍ نصّيّ
      // لأعاد الكتابةَ فوق ما اختير من القائمة.
      if (f.lookup == null && (f.kind == 'number' || f.kind == 'text')) {
        ctrls[f.path]!.addListener(() => vals[f.path] = ctrls[f.path]!.text);
      }
    }

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr(widget.family.arTitle, widget.family.enTitle),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              Text(_s(target['plateNumber']), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
              const SizedBox(height: 12),
              ...fields.map((f) {
                if (f.kind == 'flag') {
                  return SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: vals[f.path] == true,
                    onChanged: (b) => setSheet(() => vals[f.path] = b),
                    title: Text(tr(f.ar, f.en), style: const TextStyle(fontSize: 13)),
                  );
                }
                if (f.kind == 'date') {
                  final cur = '${vals[f.path] ?? ''}';
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.calendar_month_outlined, size: 18),
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                      label: Text('${tr(f.ar, f.en)}: ${cur.isEmpty ? tr('—', '—') : cur}'),
                      onPressed: () async {
                        final init = DateTime.tryParse(cur) ?? DateTime.now();
                        final d = await showDatePicker(context: c, initialDate: init, firstDate: DateTime(2000), lastDate: DateTime(2040));
                        if (d != null) setSheet(() => vals[f.path] = d.toIso8601String().split('T').first);
                      },
                    ),
                  );
                }
                if (f.lookup != null) {
                  final opts = lookups[f.lookup] ?? const <String>[];
                  final cur = '${vals[f.path] ?? ''}';
                  // القيمةُ المحفوظةُ التي خرجت من القائمة تبقى خيارًا يتيمًا:
                  // إسقاطُها من الشاشة يجعل الحقل يبدو فارغًا وهو ليس كذلك،
                  // فيُحفَظ الفراغ فوق قيمةٍ صحيحة عند أوّل تعديلٍ لحقلٍ آخر.
                  final items = [if (cur.isNotEmpty && !opts.contains(cur)) cur, ...opts];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DropdownButtonFormField<String>(
                      initialValue: cur.isEmpty ? null : cur,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr(f.ar, f.en)),
                      hint: Text(tr('اختر…', 'Select…')),
                      items: items.map((o) => DropdownMenuItem(value: o, child: Text(o, style: const TextStyle(fontSize: 13.5)))).toList(),
                      onChanged: (val) => setSheet(() => vals[f.path] = val ?? ''),
                    ),
                  );
                }
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TextField(
                    controller: ctrls[f.path],
                    keyboardType: f.kind == 'number' ? TextInputType.number : TextInputType.text,
                    textDirection: f.mono ? TextDirection.ltr : null,
                    decoration: InputDecoration(labelText: tr(f.ar, f.en)),
                  ),
                );
              }),
              Text(
                tr('لا يُكتب من هنا إلا حقول هذا المستند — بقيّة بيانات المركبة تُعدَّل من شاشة سجل المركبات.',
                    'Only this document\u2019s fields are written here — the rest of the vehicle is edited in the vehicle registry.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
              ),
              const SizedBox(height: 12),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
            ]),
          ),
        ),
      ),
    );
    for (final ctl in ctrls.values) { ctl.dispose(); }
    if (ok != true) return;
    try {
      await Api.instance.put('/api/vehicle-registry/${target['_id']}', _buildPatch(fields, vals));
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // ── «حذف» في شاشة مستند: مسحُ المستند لا مسحُ المركبة ─────────────────────
  // المركبة موجودةٌ في الواقع ولها لوحةٌ وحوادثُ وتفاويض؛ خطأٌ في رقم بطاقتها
  // لا يعني أنها لم تعد موجودة، وحذفُها من هنا يمحو معها ستَّ عائلاتٍ لا تظهر
  // في هذه الشاشة أصلًا — ضررٌ لا يراه الضاغطُ على الزرّ.
  Future<void> _clearDoc(Map<String, dynamic> v) async {
    final fields = widget.family.editable;
    if (fields.isEmpty) return;
    final name = tr(widget.family.arTitle, widget.family.enTitle);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('مسح بيانات المستند', 'Clear document data')),
        content: Text(tr(
            'ستُفرَّغ خانات «$name» على المركبة ${_s(v['plateNumber'])}. المركبة نفسها تبقى في السجلّ ببقيّة مستنداتها.',
            'The «$name» fields on ${_s(v['plateNumber'])} will be emptied. The vehicle stays in the registry with its other documents.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('مسح البيانات', 'Clear data')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final patch = _buildPatch(fields, const {});
    // ويُمسح معها `statusCode`: هو سببُ غياب التاريخ («غير مطلوب»، «لدى البنك»)،
    // وإبقاؤه بعد تفريغٍ صريح يجعل الصفَّ يعتذر عن نقصٍ لم يعد قائمًا.
    for (final r in _rootsOf(fields)) { _writePath(patch, '$r.statusCode', ''); }
    try {
      await Api.instance.put('/api/vehicle-registry/${v['_id']}', patch);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم مسح بيانات المستند', 'Document data cleared'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // ── حذفُ المركبة نفسها: لمن يملك الحذف، وبكتابة اللوحة بخطّ اليد ───────────
  // زرٌّ يُضغط بالخطأ في قائمةٍ من ثلاثمئة يمحو مركبةً بحوادثها وتفاويضها وسجلّ
  // تجديداتها كلِّه. وكتابةُ اللوحة تُجبر على قراءة أيِّ صفٍّ يُحذَف قبل حذفه.
  Future<void> _deleteVehicle(Map<String, dynamic> v) async {
    final plate = _s(v['plateNumber']).trim();
    final typed = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setD) => AlertDialog(
          title: Text(tr('حذف المركبة نهائيًا', 'Delete vehicle permanently')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr(
                'هذا ليس مسحًا للمستند. ستُحذف المركبة $plate من السجلّ نهائيًا بكل مستنداتها وتفاويضها وسجلّ تجديداتها — ولا رجعة.',
                'This is not clearing the document. Vehicle $plate will be removed from the registry with every document, authorisation and renewal record — this cannot be undone.'),
                style: const TextStyle(fontSize: 12.5)),
            const SizedBox(height: 10),
            TextField(
              controller: typed,
              onChanged: (_) => setD(() {}),
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: tr('اكتب رقم اللوحة للتأكيد', 'Type the plate to confirm'), hintText: plate),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.danger),
              onPressed: typed.text.trim() == plate ? () => Navigator.pop(c, true) : null,
              child: Text(tr('حذف المركبة', 'Delete vehicle')),
            ),
          ],
        ),
      ),
    );
    typed.dispose();
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/vehicle-registry/${v['_id']}');
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُذفت المركبة $plate', 'Deleted $plate'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// ── تجديدُ ورقةٍ واحدةٍ تغطّي مركباتٍ كثيرة ────────────────────────────────
  ///
  /// وثيقةُ تأمينٍ واحدة تغطّي مئةً وثمانيًا وتسعين مركبة. وتجديدُها مركبةً
  /// مركبةً ليس تجديدًا للوثيقة: هو مئةٌ وثمانٍ وتسعون عمليّةً لحدثٍ واحد،
  /// وأيُّ مركبةٍ تُنسى تبقى في الشاشة «منتهية» وهي مؤمَّنةٌ فعلًا.
  ///
  /// فتُسأل الوثيقةُ لا المركبات: تُعرَض الأرقامُ وأمام كلٍّ عددُ مركباته،
  /// ويُكتب التاريخُ مرّةً. والرقمُ الجديد يسري على الجميع وهو صحيحٌ هنا وحده —
  /// هي وثيقةٌ واحدة؛ والخادمُ يرفضه لأيّ مستندٍ ورقتُه لكلّ مركبة.
  Future<void> _renewSharedPaper() async {
    final k = widget.family.docKey;
    if (k == null) return;
    // المجموعاتُ تُبنى من الصفوف المحمَّلة، فما يُعرَض هو ما في الشاشة.
    final groups = <String, ({int count, dynamic expiry})>{};
    for (final v in _rows) {
      final n = _numberOf(v, k);
      if (n.isEmpty) continue;
      final g = groups[n];
      final exp = _dateOf(v, k);
      if (g == null) {
        groups[n] = (count: 1, expiry: exp);
      } else {
        final a = DateTime.tryParse('${g.expiry ?? ''}');
        final b = DateTime.tryParse('${exp ?? ''}');
        groups[n] = (count: g.count + 1, expiry: (b != null && (a == null || b.isBefore(a))) ? exp : g.expiry);
      }
    }
    if (groups.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا وثائقَ في المعروض', 'No policies in view'))));
      return;
    }
    final keys = groups.keys.toList()..sort((a, b) => groups[b]!.count.compareTo(groups[a]!.count));
    var number = keys.first;
    DateTime? when;
    final newNumber = TextEditingController();
    final note = TextEditingController();

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) {
          final g = groups[number]!;
          return Padding(
            padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('تجديد وثيقة كاملة', 'Renew a whole policy'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                Text(tr('الوثيقة الواحدة تغطّي عدّة مركبات، وتجديدها يسري عليها كلّها.',
                        'One policy covers many vehicles; renewing it applies to all of them.'),
                    style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: number,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: tr('رقم الوثيقة', 'Policy number')),
                  items: keys.map((n) => DropdownMenuItem(
                        value: n,
                        child: Text('$n — ${groups[n]!.count} ${tr('مركبة', 'vehicles')}',
                            style: const TextStyle(fontSize: 13)),
                      )).toList(),
                  onChanged: (v) => setSheet(() { number = v ?? number; when = null; }),
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: const Color(0xFFFFF7ED), borderRadius: BorderRadius.circular(10)),
                  child: Text(tr('سيُجدَّد على ${g.count} مركبة', 'Will renew on ${g.count} vehicles'),
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  icon: const Icon(Icons.calendar_month_outlined, size: 18),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
                  label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: '
                      '${when == null ? tr('اختر', 'pick') : when!.toIso8601String().split('T').first}'),
                  onPressed: () async {
                    // سنةٌ من انتهائها الحالي إن كانت سارية، وإلّا سنةٌ من اليوم.
                    final cur = DateTime.tryParse('${g.expiry ?? ''}');
                    final base = (cur != null && cur.isAfter(DateTime.now())) ? cur : DateTime.now();
                    final d = await showDatePicker(
                      context: c,
                      initialDate: DateTime(base.year + 1, base.month, base.day),
                      firstDate: DateTime.now(),
                      lastDate: DateTime(2040),
                    );
                    if (d != null) setSheet(() => when = d);
                  },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: newNumber,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: tr('رقم الوثيقة الجديد (إن تغيّر)', 'New policy number (if changed)'),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: when == null ? null : () => Navigator.pop(c, true),
                  child: Text(tr('تجديد على ${g.count} مركبة', 'Renew on ${g.count} vehicles')),
                ),
              ]),
            ),
          );
        },
      ),
    );
    final newNum = newNumber.text.trim();
    final noteTxt = note.text.trim();
    newNumber.dispose();
    note.dispose();
    if (ok != true || when == null) return;
    try {
      final r = await Api.instance.post('/api/vehicle-registry/renew-shared', {
        'document': k,
        'number': number,
        'newExpiry': when!.toIso8601String().split('T').first,
        if (newNum.isNotEmpty) 'newNumber': newNum,
        if (noteTxt.isNotEmpty) 'note': noteTxt,
      });
      await _load();
      final n = (r['summary'] is Map) ? r['summary']['count'] : null;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('اتجدّدت الوثيقة على ${n ?? '—'} مركبة', 'Renewed on ${n ?? '—'} vehicles'))));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  /// تجديدٌ يقبل الرقم الجديد: بطاقة التشغيل تخرج برقمٍ جديد كل مرة، والتفويض
  /// كذلك أحيانًا. وتركُ الخانة فارغة يعني «الرقم هو هو» — لا محوَه.
  Future<void> _renew(Map v) async {
    final k = widget.family.docKey;
    if (k == null) return;
    final numberLabel = _numberLabel(k);
    final current = numberLabel == null ? '' : _numberOf(v, k);
    DateTime? newExpiry;
    final number = TextEditingController();
    final cost = TextEditingController();
    final note = TextEditingController();

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تجديد ${docLabel(k)}', 'Renew ${docLabel(k)}'),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text('${_s(v['plateNumber'])} · ${tr('ينتهي', 'expires')} ${fmtDate(_dateOf(v, k))}',
                style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: '
                  '${newExpiry == null ? tr('اختر', 'Pick') : newExpiry!.toIso8601String().split('T').first}'),
              onPressed: () async {
                final d = await showDatePicker(
                  context: c,
                  initialDate: DateTime.now().add(const Duration(days: 365)),
                  // الخادم يرفض تاريخًا في الماضي، فمنعُه هنا أوضح من رسالة خطأ بعد الإرسال.
                  firstDate: DateTime.now(),
                  lastDate: DateTime(2040),
                );
                if (d != null) setSheet(() => newExpiry = d);
              },
            ),
            if (numberLabel != null) ...[
              const SizedBox(height: 10),
              TextField(
                controller: number,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: '$numberLabel — ${tr('اتركه فارغًا إن لم يتغيّر', 'blank if unchanged')}',
                  hintText: current.isEmpty ? null : current,
                  helperText: current.isEmpty ? null : '${tr('الحالي', 'Current')}: $current',
                ),
              ),
            ],
            const SizedBox(height: 10),
            TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة (ر.س)', 'Cost (SAR)'))),
            const SizedBox(height: 10),
            TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            const SizedBox(height: 8),
            Text(
              tr('يُقيَّد في سجل المركبة: التاريخ السابق والجديد، والرقم السابق إن استُبدل، واسم من نفّذه.',
                  'Recorded on the vehicle: old and new date, the old number if replaced, and who did it.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: newExpiry == null ? null : () => Navigator.pop(c, true),
              child: Text(tr('تأكيد التجديد', 'Confirm renewal')),
            ),
          ]),
        ),
      ),
    );
    if (ok != true || newExpiry == null) return;
    try {
      await Api.instance.post('/api/vehicle-registry/${v['_id']}/renew', {
        'document': k,
        'newExpiry': newExpiry!.toIso8601String().split('T').first,
        if (number.text.trim().isNotEmpty) 'documentNumber': number.text.trim(),
        if (cost.text.trim().isNotEmpty) 'cost': num.tryParse(cost.text.trim()),
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التجديد', 'Renewed'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // اسمُ رقم المستند ومسارُه — نفس ما يعرّفه الخادم في config/vehicleDocuments.
  // ورخصةُ السير والفحص لا رقم لهما، فلا خانةَ لهما في نافذة التجديد.
  String? _numberLabel(String k) => switch (k) {
        'insurance' => tr('رقم وثيقة التأمين', 'Policy number'),
        'operatingCard' => tr('رقم بطاقة التشغيل', 'Operating card number'),
        'gps' => tr('سريال جهاز التتبّع', 'GPS serial'),
        'authorization' => tr('رقم التفويض', 'Authorisation number'),
        _ => null,
      };
  String _numberOf(Map v, String k) => switch (k) {
        'insurance' => _s(_sub(v, 'insurance')['policyNumber']),
        'operatingCard' => _s(_sub(v, 'operatingCard')['cardNumber']),
        'gps' => _s(_sub(v, 'gps')['serialImei']),
        'authorization' => _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
        _ => '',
      };
  dynamic _dateOf(Map v, String k) => switch (k) {
        'insurance' => _sub(v, 'insurance')['expiryDate'],
        'operatingCard' => _sub(v, 'operatingCard')['expiryDate'],
        'vehicleLicense' => _sub(v, 'vehicleLicense')['expiryDate'],
        'inspection' => _sub(v, 'inspection')['expiryDate'],
        'gps' => _sub(v, 'gps')['expiryDate'],
        'authorization' => _sub(v, 'authorizedPerson')['expiryDate'],
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final f = widget.family;
    final auth = context.watch<AuthProvider>();
    // لا كتابةَ بلا حقولٍ معلومة: عائلةٌ لم تُصرّح بحقولها تبقى للقراءة والتجديد
    // كما كانت — فلا يظهر زرٌّ لا يعرف أين يكتب.
    final canEdit = f.editable.isNotEmpty
        && (_editRoles.contains(auth.role) || auth.canEditSection('Vehicles'));
    /// الحذف الحقيقيّ صلاحيةٌ أضيق من التعديل — وهذه هي القسمة نفسها في الخادم.
    final canDelete = _adminRoles.contains(auth.role)
        || (auth.role != 'client' && auth.canEditSection('Vehicles'));
    final q = _fold(_q);
    final searched = q.isEmpty
        ? _rows
        : _rows.where((v) => f.searchIn(v).any((x) => _fold(x).contains(q))).toList();
    final chips = _chips;
    final active = chips.firstWhere((c) => c.key == _chip, orElse: () => chips.first);
    final rows = active.test == null ? searched : searched.where((v) => active.test!(v)).toList();

    final canRenewShared = f.sharedPaper && f.docKey != null
        && (_editRoles.contains(auth.role) || auth.canEditSection('Vehicles'));

    return AppScaffold(
      title: Text(tr(f.arTitle, f.enTitle)),
      actions: [
        if (canRenewShared)
          IconButton(
            tooltip: tr('تجديد وثيقة كاملة', 'Renew a whole policy'),
            icon: const Icon(Icons.autorenew),
            onPressed: _renewSharedPaper,
          ),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () => _editDoc(null),
        icon: const Icon(Icons.add),
        label: Text(tr('إضافة', 'Add')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(
                        child: TextField(
                          onChanged: (v) => setState(() => _q = v),
                          decoration: InputDecoration(hintText: tr('ابحث بلوحة أو رقم…', 'Search plate or number…'), prefixIcon: const Icon(Icons.search)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // نفس فلاتر الموقع بالضبط: تأتي من الخادم وأعدادُها محسوبة
                      // بعد بقيّة الفلاتر، فلا يفترق ما يراه المستخدم هنا عمّا يراه هناك.
                      Badge(
                        isLabelVisible: _filters.isNotEmpty,
                        label: Text('${_filters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                          icon: const Icon(Icons.tune),
                          tooltip: tr('التصفية', 'Filter'),
                          onPressed: () async {
                            final r = await showFilterSheet(
                              context: context,
                              optionsUrl: '/api/vehicle-registry/filters',
                              value: _filters,
                            );
                            if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                          },
                        ),
                      ),
                    ]),
                  ),
                  SizedBox(
                    height: 42,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      children: chips.map((c) {
                        final n = c.test == null ? searched.length : searched.where(c.test!).length;
                        final on = c.key == active.key;
                        return Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: ChoiceChip(
                            selected: on,
                            selectedColor: c.tone.withValues(alpha: 0.18),
                            label: Text('${tr(c.ar, c.en)} $n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? c.tone : T.inkFaint)),
                            onSelected: (_) => setState(() => _chip = on ? '' : c.key),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: f.icon, title: tr('لا نتائج مطابقة', 'No matching rows'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final k = f.docKey;
                                final st = k == null ? null : _state(v, k);
                                final s = _s(st?['status']).isEmpty ? 'none' : _s(st?['status']);
                                return AppCard(
                                  topAccent: st == null ? T.navy : statusColor(s),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Text(_s(v['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                      const Spacer(),
                                      if (st != null)
                                        Chip2(st['days'] == null ? statusLabel(s) : daysText(st['days']), statusColor(s)),
                                    ]),
                                    const SizedBox(height: 6),
                                    ...f.fields.map((fl) {
                                      final val = fl.get(v);
                                      return Padding(
                                        padding: const EdgeInsets.symmetric(vertical: 2),
                                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Expanded(flex: 2, child: Text(tr(fl.ar, fl.en), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                                          Expanded(
                                            flex: 3,
                                            child: Text(
                                              val.isEmpty ? '—' : val,
                                              textAlign: TextAlign.end,
                                              textDirection: fl.mono ? TextDirection.ltr : null,
                                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                                            ),
                                          ),
                                        ]),
                                      );
                                    }),
                                    if (k != null || canEdit) ...[
                                      const SizedBox(height: 6),
                                      Align(
                                        alignment: AlignmentDirectional.centerEnd,
                                        child: Wrap(spacing: 2, children: [
                                          if (k != null)
                                            TextButton.icon(
                                              onPressed: () => _renew(v),
                                              icon: const Icon(Icons.autorenew_rounded, size: 17),
                                              label: Text(tr('تجديد', 'Renew')),
                                            ),
                                          if (canEdit)
                                            IconButton(
                                              tooltip: tr('تعديل بيانات هذا المستند', 'Edit this document'),
                                              icon: const Icon(Icons.edit_outlined, size: 18),
                                              onPressed: () => _editDoc(v),
                                            ),
                                          // المِمحاة لا سلّةُ المهملات: الأيقونةُ
                                          // نفسها تقول إن الممسوح بياناتٌ لا مركبة.
                                          if (canEdit && _hasDoc(v, f.editable))
                                            IconButton(
                                              tooltip: tr('مسح بيانات هذا المستند', 'Clear this document'),
                                              icon: const Icon(Icons.backspace_outlined, size: 18, color: T.danger),
                                              onPressed: () => _clearDoc(v),
                                            ),
                                          if (canEdit && canDelete)
                                            IconButton(
                                              tooltip: tr('حذف المركبة نهائيًا', 'Delete vehicle permanently'),
                                              icon: const Icon(Icons.delete_forever_outlined, size: 18, color: T.danger),
                                              onPressed: () => _deleteVehicle(v),
                                            ),
                                        ]),
                                      ),
                                    ],
                                  ]),
                                );
                              },
                            ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(tr('${rows.length} من $_total مركبة', '${rows.length} of $_total vehicles'),
                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  ),
                ]),
    );
  }
}

// ══════════════════ العائلات السبع ══════════════════
// نفس الأعمدة ونفس الترتيب ونفس الأسماء التي في الموقع — من يفتح الشاشتين في
// اليوم نفسه لا يجد جدولين مختلفين لبياناتٍ واحدة.

final vehicleInsuranceFamily = DocFamily(
  docKey: 'insurance',
  sharedPaper: true,
  arTitle: 'تأمين المركبات', enTitle: 'Vehicle Insurance',
  icon: Icons.shield_outlined,
  fields: [
    DocField('رقم وثيقة التأمين', 'Policy number', (v) => _s(_sub(v, 'insurance')['policyNumber']), mono: true),
    DocField('تاريخ انتهاء التأمين', 'Insurance expiry', (v) => fmtDate(_sub(v, 'insurance')['expiryDate'])),
    DocField('شركة التأمين', 'Insurer', (v) => _s(_sub(v, 'insurance')['companyAr'])),
    DocField('نوع التأمين', 'Coverage type', (v) => _s(_sub(v, 'insurance')['coverageTypeAr'])),
    // مركبةٌ يسدّد قسطَها المموِّل ليست «بلا قسط»: هي مؤمَّنة والرقم عنده.
    DocField('قيمة التأمين', 'Premium', (v) {
      final ins = _sub(v, 'insurance');
      return ins['premiumSar'] != null ? money(ins['premiumSar']) : _s(ins['premiumStatusAr']);
    }),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'insurance')['policyNumber']), _s(_sub(v, 'insurance')['companyAr']), _s(v['ownerNameAr'])],
  // و«قيمة التأمين» خانتان لا واحدة: رقمٌ حين ندفعه نحن، ونصٌّ حين يدفعه المموِّل
  // («ملكية بنك الراجحي»). دمجُهما يجبر المدخِل على ترك الرقم فارغًا فتُعدّ
  // المركبة بلا تأمين وهي مؤمَّنة.
  editable: const [
    DocEditField('insurance.policyNumber', 'رقم وثيقة التأمين', 'Policy number', mono: true),
    DocEditField('insurance.companyAr', 'شركة التأمين', 'Insurer'),
    DocEditField('insurance.coverageTypeAr', 'نوع التأمين', 'Coverage type'),
    DocEditField('insurance.expiryDate', 'تاريخ انتهاء التأمين', 'Insurance expiry', kind: 'date'),
    DocEditField('insurance.premiumSar', 'قيمة التأمين (ر.س)', 'Premium (SAR)', kind: 'number'),
    DocEditField('insurance.premiumStatusAr', 'جهة سداد القسط', 'Who pays the premium'),
  ],
);

final vehicleOperatingCardFamily = DocFamily(
  docKey: 'operatingCard',
  arTitle: 'بطاقات التشغيل', enTitle: 'Operating Cards',
  icon: Icons.credit_card_outlined,
  fields: [
    DocField('رقم بطاقة التشغيل', 'Operating card number', (v) => _s(_sub(v, 'operatingCard')['cardNumber']), mono: true),
    DocField('تاريخ الانتهاء', 'Expiry date', (v) => fmtDate(_sub(v, 'operatingCard')['expiryDate'])),
    DocField('الإدارة', 'Department', (v) => _s(v['departmentAr'])),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'operatingCard')['cardNumber']), _s(v['ownerNameAr']), _s(v['departmentAr'])],
  // الرقمُ والتاريخ هما البطاقةُ كلُّها — والإدارةُ والمالك يُعرَضان ولا يُكتبان
  // من هنا: هما هويّةُ المركبة لا مستندُها.
  editable: const [
    DocEditField('operatingCard.cardNumber', 'رقم بطاقة التشغيل', 'Operating card number', mono: true),
    DocEditField('operatingCard.expiryDate', 'تاريخ الانتهاء', 'Expiry date', kind: 'date'),
  ],
);

final vehicleAuthorizationFamily = DocFamily(
  docKey: 'authorization',
  arTitle: 'التفاويض', enTitle: 'Authorisations',
  icon: Icons.assignment_ind_outlined,
  fields: [
    DocField('اسم المفوَّض', 'Authorised person', (v) => _s(_sub(v, 'authorizedPerson')['name'])),
    DocField('رقم الإقامة', 'Iqama number', (v) => _s(_sub(v, 'authorizedPerson')['iqamaNumber']), mono: true),
    DocField('رقم التفويض', 'Authorisation number', (v) => _s(_sub(v, 'authorizedPerson')['authorizationNumber']), mono: true),
    DocField('تاريخ بداية التفويض', 'Start date', (v) => fmtDate(_sub(v, 'authorizedPerson')['startDate'])),
    DocField('تاريخ نهاية التفويض', 'End date', (v) => fmtDate(_sub(v, 'authorizedPerson')['expiryDate'])),
    // ── والسائقُ نفسُه ──────────────────────────────────────────────────────
    // التفويضُ ورقةٌ على مركبة، لكنّه يُعطى لشخص. وثلاثةُ أشياء تخصّ ذلك
    // الشخص: ورقتُه هذه، وبطاقةُ سائقه، وخيانةُ أمانته — ولا يقود بواحدةٍ
    // منها ناقصة. يجمعها الخادمُ برقم الإقامة.
    DocField('بطاقة السائق', 'Driver card', (v) {
      final c = _sub(v, 'driverCard');
      if (c.isEmpty) return _s(_sub(v, 'authorizedPerson')['iqamaNumber']).isEmpty ? '' : 'لا بطاقة';
      final exp = _s(c['expiryDate']);
      return [_s(c['cardNumber']), if (exp.isNotEmpty) '⟵ $exp'].where((x) => x.isNotEmpty).join(' ');
    }, mono: true),
    DocField('خيانة الأمانة', 'Fidelity insurance', (v) {
      final c = _sub(v, 'driverCard');
      if (c.isEmpty) return '';
      return switch (_s(c['fidelityStatus'])) {
        'covered' => 'مشمول',
        'required' => 'مطلوب ضمُّه',
        _ => 'غير محدَّد',
      };
    }),
  ],
  searchIn: (v) => [
    _s(v['plateNumber']), _s(_sub(v, 'authorizedPerson')['name']),
    _s(_sub(v, 'authorizedPerson')['iqamaNumber']), _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
    _s(_sub(v, 'driverCard')['cardNumber']),
  ],
  // ورقةُ التفويض كاملةً: مَن، وبأيّ إقامة، وبأيّ رقم، ومن متى إلى متى. واسمٌ
  // بلا رقمِ تفويضٍ ولا مدّة لا يُثبِت صفةَ السائق أمام أحد.
  editable: const [
    DocEditField('authorizedPerson.name', 'اسم المفوَّض', 'Authorised person'),
    DocEditField('authorizedPerson.iqamaNumber', 'رقم الإقامة', 'Iqama number', mono: true),
    // المسمّى قائمةٌ لا خانةٌ حرّة: «سائق نقل ثقيل» في سبعٍ وخمسين مركبة
    // و«مندوب توصيل» في ثلاثٍ وعشرين — والخانةُ الحرّة تجعلها عشرين مسمًّى.
    DocEditField('authorizedPerson.jobTitleAr', 'المسمّى الوظيفي لقائد المركبة', 'Driver job title',
        lookup: 'vehicle_job_title'),
    DocEditField('authorizedPerson.authorizationNumber', 'رقم التفويض', 'Authorisation number', mono: true),
    DocEditField('authorizedPerson.startDate', 'تاريخ بداية التفويض', 'Start date', kind: 'date'),
    DocEditField('authorizedPerson.expiryDate', 'تاريخ نهاية التفويض', 'End date', kind: 'date'),
  ],
);

final vehicleFuelCardFamily = DocFamily(
  // لا تاريخ انتهاء لشريحة الوقود، فلا عمودَ حالةٍ ولا زرَّ تجديد.
  docKey: null,
  arTitle: 'بترو اب — شرائح الوقود', enTitle: 'Petro App Cards',
  icon: Icons.local_gas_station_outlined,
  fields: [
    DocField('شريحة بترو اب', 'Petro App chip', (v) => _s(_sub(v, 'fuelCard')['cardNumber']), mono: true),
    // اللوحةُ في الفاتورة تُكتب بصيغةٍ أخرى، وهي المفتاح الوحيد لمطابقة بند
    // الفاتورة بالمركبة — فليست تكرارًا للوحة.
    DocField('رقم اللوحة في فاتورة بترو اب', 'Plate on invoice', (v) => _s(_sub(v, 'fuelCard')['plateOnInvoiceAr'])),
    DocField('حالة الشريحة', 'Chip status', (v) => _s(_sub(v, 'fuelCard')['statusAr'])),
    DocField('نوع الاستهلاك', 'Consumption type', (v) => _s(_sub(v, 'fuelCard')['consumptionTypeAr'])),
    DocField('حد الاستهلاك', 'Consumption limit', (v) {
      final fc = _sub(v, 'fuelCard');
      if (fc['limitStatus'] == 'open') return tr('مفتوح — بلا سقف', 'Open — no ceiling');
      return fc['limitSar'] != null ? money(fc['limitSar']) : '';
    }),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'fuelCard')['cardNumber']), _s(_sub(v, 'fuelCard')['plateOnInvoiceAr'])],
  // «مفتوح» علامةٌ لا رقم: صفرٌ في خانة السقف يعني «ممنوع الصرف»، وفراغٌ يعني
  // «لا نعلم» — وكلاهما عكسُ المقصود. فالعلامةُ مفتاحٌ يكتب `open`.
  editable: const [
    DocEditField('fuelCard.cardNumber', 'رقم شريحة بترو اب', 'Petro App chip number', mono: true),
    DocEditField('fuelCard.plateOnInvoiceAr', 'رقم اللوحة في فاتورة بترو اب', 'Plate on Petro App invoice'),
    DocEditField('fuelCard.provider', 'المزوّد', 'Provider'),
    DocEditField('fuelCard.statusAr', 'حالة الشريحة', 'Chip status'),
    DocEditField('fuelCard.consumptionTypeAr', 'نوع الاستهلاك', 'Consumption type'),
    DocEditField('fuelCard.limitSar', 'حد الاستهلاك (ر.س)', 'Consumption limit (SAR)', kind: 'number'),
    DocEditField('fuelCard.limitStatus', 'مفتوح — بلا سقف صرف', 'Open — no spending ceiling', kind: 'flag', on: 'open'),
  ],
  chips: [
    const DocChip('', 'الكل', 'All', T.navy),
    DocChip('has', 'لها شريحة', 'Has a chip', T.success, (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty),
    DocChip('none', 'بلا شريحة', 'No chip', T.danger, (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isEmpty),
    DocChip('open', 'بلا سقف استهلاك', 'No ceiling', T.orange, (v) => _sub(v, 'fuelCard')['limitStatus'] == 'open'),
    DocChip('noInvoicePlate', 'بلا لوحة على الفاتورة', 'No plate on invoice', T.violet,
        (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty && _s(_sub(v, 'fuelCard')['plateOnInvoiceAr']).isEmpty),
  ],
);

final vehicleGpsFamily = DocFamily(
  docKey: 'gps',
  arTitle: 'أجهزة التتبّع GPS', enTitle: 'GPS Devices',
  icon: Icons.satellite_alt_outlined,
  fields: [
    DocField('جهاز GPS', 'GPS device', (v) => _s(_sub(v, 'gps')['deviceModel'])),
    // حالةُ الجهاز غيرُ حالة الاشتراك: جهازٌ مسروق قد يكون اشتراكه ساريًا.
    DocField('حالة جهاز GPS', 'Device status', (v) => _s(_sub(v, 'gps')['deviceStatusAr'])),
    DocField('شركة الـGPS', 'GPS provider', (v) => _s(_sub(v, 'gps')['provider'])),
    DocField('سريال GPS', 'GPS serial', (v) => _s(_sub(v, 'gps')['serialImei']), mono: true),
    DocField('تاريخ انتهاء الـGPS', 'Subscription expiry', (v) => fmtDate(_sub(v, 'gps')['expiryDate'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'gps')['serialImei']), _s(_sub(v, 'gps')['deviceModel']), _s(_sub(v, 'gps')['provider'])],
  // وحالةُ الجهاز حقلٌ مستقلّ عن تاريخ الاشتراك: جهازٌ مسروق باشتراكٍ ساري وضعٌ
  // قائم، ولو اشتُقّت إحداهما من الأخرى لضاع.
  editable: const [
    DocEditField('gps.deviceModel', 'جهاز GPS', 'GPS device'),
    DocEditField('gps.deviceStatusAr', 'حالة جهاز GPS', 'Device status'),
    DocEditField('gps.provider', 'شركة الـGPS', 'GPS provider'),
    DocEditField('gps.serialImei', 'سريال GPS', 'GPS serial', mono: true),
    DocEditField('gps.simNumber', 'رقم الشريحة', 'SIM number', mono: true),
    DocEditField('gps.expiryDate', 'تاريخ انتهاء الـGPS', 'Subscription expiry', kind: 'date'),
  ],
);

final vehicleLicenceFamily = DocFamily(
  docKey: 'vehicleLicense',
  arTitle: 'رخص السير', enTitle: 'Vehicle Licences',
  icon: Icons.description_outlined,
  fields: [
    // الرخصة تُطبَع بالهجريّ والنظام يحسب بالميلاديّ؛ عرضُ أحدهما وحده يجعل
    // الموظف يقارن ما في يده بما في الشاشة فلا يتطابقان.
    DocField('انتهاء رخصة السير (ميلادي)', 'Licence expiry (Gregorian)', (v) => fmtDate(_sub(v, 'vehicleLicense')['expiryDate'])),
    DocField('انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', (v) => _s(_sub(v, 'vehicleLicense')['expiryDateHijri']), mono: true),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'vehicleLicense')['expiryDateHijri'])],
  // التاريخان يُكتبان معًا لا أحدُهما: من أدخل واحدًا وترك الآخر أعاد الخلافَ
  // الذي جاء العمودان لرفعه.
  editable: const [
    DocEditField('vehicleLicense.expiryDate', 'انتهاء رخصة السير (ميلادي)', 'Licence expiry (Gregorian)', kind: 'date'),
    DocEditField('vehicleLicense.expiryDateHijri', 'انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', mono: true),
  ],
);

final vehicleInspectionFamily = DocFamily(
  docKey: 'inspection',
  arTitle: 'الفحص الدوري', enTitle: 'Periodic Inspection',
  icon: Icons.fact_check_outlined,
  fields: [
    DocField('حالة الفحص', 'Inspection status', (v) => _s(_sub(v, 'inspection')['statusAr'])),
    DocField('تاريخ انتهاء الفحص (ميلادي)', 'Inspection expiry (Gregorian)', (v) => fmtDate(_sub(v, 'inspection')['expiryDate'])),
    DocField('تاريخ انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', (v) => _s(_sub(v, 'inspection')['expiryDateHijri']), mono: true),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'inspection')['statusAr'])],
  // حالةُ الفحص تُكتب نصًّا كما في الملف المصدر ولا تُشتقّ من التاريخ: المقطورةُ
  // لا تُفحص أصلًا، وتاريخُها الفارغ ليس رسوبًا.
  editable: const [
    DocEditField('inspection.statusAr', 'حالة الفحص', 'Inspection status'),
    DocEditField('inspection.expiryDate', 'تاريخ انتهاء الفحص (ميلادي)', 'Inspection expiry (Gregorian)', kind: 'date'),
    DocEditField('inspection.expiryDateHijri', 'تاريخ انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', mono: true),
  ],
);
