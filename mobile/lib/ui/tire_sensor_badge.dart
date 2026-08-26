import 'package:flutter/material.dart';
import '../services/lang.dart';
import 'theme.dart';

/// شارة «حساسات الكاوتش» — نظيرة العمود الذي أُضيف إلى الأسطول المباشر وسجل
/// الأسطول على الموقع: «٧ / ٥ / ٢».
///
///   أخضر  = فردةٌ مركَّبةٌ على الأرض وحسّاسها يبثّ الآن
///   أحمر  = باقي مواضع الأرض بلا تغطية
///   الاستبن = عدده؛ أخضر إن كان مسلَّحًا، ورماديٌّ إن لم يكن
///
/// الأرقام تأتي جاهزةً من الخادم في حقل `tireSensors`
/// (backend/src/services/ls2TireSensors.js)، ولا يُشتقّ منها شيءٌ هنا: لو حسبها
/// التطبيق بنفسه لاختلف رقمه عن رقم الموقع عند أوّل تعديلٍ في قاعدة الاشتقاق،
/// والعمود كلُّه إنما وُجد ليكون رقمًا لا يُختلَف فيه.
class TireSensorBadge extends StatelessWidget {
  final Map<String, dynamic>? cov;
  final String plate;
  const TireSensorBadge({super.key, required this.cov, required this.plate});

  static int _i(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    final c = cov;
    if (c == null) return const SizedBox.shrink();
    final ok = _i(c['withSensor']);
    final missing = _i(c['withoutSensor']);
    final spare = _i(c['spare']);
    final spareOn = _i(c['spareWithSensor']) > 0;
    final silent = _i(c['silent']);

    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => _showDetail(context, c, plate),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: T.canvas,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: T.line),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.sensors_rounded, size: 13, color: T.inkFaint),
          const SizedBox(width: 5),
          Text.rich(TextSpan(children: [
            TextSpan(text: '$ok', style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
            const TextSpan(text: ' / ', style: TextStyle(color: T.inkFaint)),
            TextSpan(text: '$missing', style: TextStyle(fontWeight: FontWeight.w800, color: missing > 0 ? T.danger : T.inkFaint)),
            const TextSpan(text: ' / ', style: TextStyle(color: T.inkFaint)),
            TextSpan(text: '$spare', style: TextStyle(fontWeight: FontWeight.w800, color: spareOn ? T.success : T.inkFaint)),
          ]), style: const TextStyle(fontSize: 11.5)),
          // الحسّاس المركَّب الصامت لا يُدمَج في الأخضر ولا يُخفى: علامةٌ كهرمانية
          // تقول إن جزءًا من الأحمر عطلٌ يحتاج استبدالًا، لا موضعًا يحتاج تركيبًا.
          if (silent > 0) ...[
            const SizedBox(width: 5),
            const Icon(Icons.warning_amber_rounded, size: 12, color: T.warn),
            Text('$silent', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.warn)),
          ],
        ]),
      ),
    );
  }
}

void _showDetail(BuildContext context, Map<String, dynamic> c, String plate) {
  int i(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
  final positions = c['positionsWithoutSensor'] is List
      ? List<Map<String, dynamic>>.from((c['positionsWithoutSensor'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)))
      : const <Map<String, dynamic>>[];
  final channels = c['faultyChannels'] is List
      ? List<Map<String, dynamic>>.from((c['faultyChannels'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)))
      : const <Map<String, dynamic>>[];
  final silent = i(c['silent']);
  final unregistered = i(c['unregistered']);

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تغطية حساسات الكاوتش', 'Tire-sensor coverage'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            Text(plate, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 12),
            _line(T.success, '${i(c['withSensor'])}', tr('فرد مركّبة وحساسها يبثّ', 'mounted tires with a reporting sensor')),
            _line(i(c['withoutSensor']) > 0 ? T.danger : T.inkFaint, '${i(c['withoutSensor'])}', tr('فرد مركّبة بدون حساس', 'mounted tires with no sensor')),
            _line(i(c['spareWithSensor']) > 0 ? T.success : T.inkFaint, '${i(c['spare'])}',
                i(c['spareWithSensor']) > 0
                    ? tr('استبن — منه ${i(c['spareWithSensor'])} عليه حساس', 'spare — ${i(c['spareWithSensor'])} fitted with a sensor')
                    : tr('استبن — بدون حساس', 'spare — no sensor')),
            if (silent > 0) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.warn.withValues(alpha: 0.4))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.warning_amber_rounded, size: 16, color: T.warn),
                    const SizedBox(width: 6),
                    Expanded(child: Text('$silent ${tr('حساس مركّب ولا يبثّ (عطل / مش لاقط)', 'sensors fitted but not reporting')}',
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.warn))),
                  ]),
                  const SizedBox(height: 4),
                  Text(tr('محسوبة ضمن الرقم الأحمر لا الأخضر — الحساس الصامت ليس تغطية.', 'Counted with the red number, never the green one — a silent sensor is not coverage.'),
                      style: const TextStyle(fontSize: 11, color: T.warn)),
                  if (channels.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text('${tr('قنوات معطوبة (محور–إطار)', 'Faulty channels (axle–tire)')}: ${channels.map((x) => '${x['axle'] ?? '?'}–${x['position'] ?? '?'}').join('، ')}',
                        style: const TextStyle(fontSize: 11, color: T.warn)),
                  ],
                ]),
              ),
            ],
            if (positions.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('${tr('المواضع المسجّلة بدون حساس', 'Positions registered without a sensor')} (${positions.length})',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              ...positions.map((p) => Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Row(children: [
                      const Icon(Icons.circle_outlined, size: 13, color: T.danger),
                      const SizedBox(width: 6),
                      Expanded(child: Text(
                        [(p['positionLabel'] ?? '').toString().isNotEmpty ? p['positionLabel'] : '${tr('اطار', 'Tire')} ${p['positionNumber'] ?? '—'}', p['section'] ?? '']
                            .where((x) => x.toString().isNotEmpty).join(' — '),
                        style: const TextStyle(fontSize: 12),
                      )),
                      Text((p['serial'] ?? '').toString(), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                    ]),
                  )),
            ],
            // المواضع غير المجرودة ليست «بلا حسّاس»، بل مجهولة — والفرق يمنع أن
            // يُقرأ نقصُ الجرد على أنه نقصُ تسليح.
            if (unregistered > 0) ...[
              const SizedBox(height: 10),
              Text('$unregistered ${tr('موضع لم تجرده الورشة بعد', 'positions not yet stock-taken by the workshop')}',
                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            ],
          ]),
        ),
      ),
    ),
  );
}

Widget _line(Color color, String value, String label) => Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(children: [
        SizedBox(width: 34, child: Text(value, textAlign: TextAlign.center, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color))),
        const SizedBox(width: 8),
        Expanded(child: Text(label, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
      ]),
    );
