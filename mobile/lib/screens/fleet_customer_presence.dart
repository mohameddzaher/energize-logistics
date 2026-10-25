import 'package:flutter/material.dart';
import '../resource/configs.dart';
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'collections_party.dart';
import 'crm_company_profile.dart';
import 'customer_registry_profile.dart';
import 'customs_party.dart';
import 'fleet_customer_profile.dart';

/// «نفس العميل في: …» — نظيرُ CustomerPresence في الويب. يقرأ من
/// /api/customer-hub/presence/:reg/:id أين يوجد العميلُ نفسُه في الأقسام
/// الأخرى ويعرضها روابطَ، ويستمع لـ`customers:changed` فيعيد قراءة الشاشة
/// التي هو فيها (onChanged) متى عُدِّل العميلُ من أيّ مكان.
class CustomerPresence extends StatefulWidget {
  final String reg; // crm | collections | shipment | fleet | customs | contracts
  final String id;
  final VoidCallback? onChanged;
  const CustomerPresence({super.key, required this.reg, required this.id, this.onChanged});

  @override
  State<CustomerPresence> createState() => _CustomerPresenceState();
}

class _CustomerPresenceState extends State<CustomerPresence> {
  String? _master;
  List<Map<String, dynamic>> _places = const [];
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = (d) {
      final m = d is Map ? d['master']?.toString() : null;
      if (_master == null || m == null || m == _master) { _load(); widget.onChanged?.call(); }
    };
    Live.instance.onData('customers:changed', _onLive);
    _load();
  }

  @override
  void dispose() { Live.instance.offData('customers:changed', _onLive); super.dispose(); }

  Future<void> _load() async {
    if (widget.id.isEmpty) return;
    try {
      final d = await Api.instance.get('/api/customer-hub/presence/${widget.reg}/${widget.id}');
      if (!mounted) return;
      setState(() {
        _master = d['master']?.toString();
        _places = List<Map<String, dynamic>>.from((d['places'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
      });
    } catch (_) { if (mounted) setState(() => _places = const []); }
  }

  Widget? _screenFor(Map<String, dynamic> p) {
    final id = (p['id'] ?? '').toString();
    final name = (p['name'] ?? '').toString();
    return switch (p['reg']) {
      'crm' => CrmCompanyProfileScreen(companyId: id, name: name),
      'shipment' => CustomerRegistryProfileScreen(customerId: id),
      'fleet' => FleetCustomerProfileScreen(customerId: id),
      'customs' => CustomsPartyScreen(partyId: id, name: name),
      'collections' => CollectionsPartyScreen(id: id),
      'contracts' => ResourceScreen(config: contractsCustomersCfg),
      _ => null,
    };
  }

  @override
  Widget build(BuildContext context) {
    final others = _places.where((p) => !(p['reg'] == widget.reg && p['id'] == widget.id)).toList();
    if (others.isEmpty) return const SizedBox.shrink();
    return AppCard(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        const Icon(Icons.link_rounded, size: 18, color: T.orange),
        Text(tr('نفس العميل في:', 'Same customer in:'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
        for (final p in others)
          ActionChip(
            visualDensity: VisualDensity.compact,
            label: Text((p['ar'] ?? p['reg'] ?? '').toString(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            onPressed: () {
              final s = _screenFor(p);
              if (s != null) Navigator.of(context).push(MaterialPageRoute(builder: (_) => s));
            },
          ),
        Text(tr('— بياناتُ التواصل واحدةٌ وتتحدّث في كلّها فورًا', '— contact details are shared and update everywhere'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ]),
    );
  }
}
