import 'package:flutter/material.dart';
import '../services/lang.dart';

/// خانةُ البحث الموحَّدة في التطبيق (صاحبُ الشركة، ٢٠٢٦/١٠/٢٥: «سيرش كتير كنت
/// بعمله… بيلغي المحتوى ومبعرفش أقفله»).
///
/// ما كان يحدث: خانةُ بحثٍ بلا متحكِّم تُعاد رسمُها (تحميل/خطأ/تحديثٌ حيّ) فتعود
/// فارغة والكلمةُ ما زالت تُرشِّح القائمةَ في الخلفية — محتوى يختفي بلا سببٍ ظاهر
/// ولا خانةٌ تُمسَح. هنا: النصُّ في متحكِّمٍ يملكه صاحبُ الشاشة أو الخانةُ نفسُها
/// فلا يضيع، وزرُّ ✕ يمسح ويُغلق اللوحة في ضغطة، و«بحث» في اللوحة يُغلقها.
class SearchField extends StatefulWidget {
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final String? hint;
  final String? suffixText;
  final bool autofocus;
  final bool dense;
  const SearchField({super.key, required this.onChanged, this.controller, this.hint, this.suffixText, this.autofocus = false, this.dense = false});

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  TextEditingController? _own;
  TextEditingController get _ctl => widget.controller ?? (_own ??= TextEditingController());

  @override
  void initState() {
    super.initState();
    _ctl.addListener(_repaint);
  }

  void _repaint() { if (mounted) setState(() {}); }

  @override
  void dispose() {
    _ctl.removeListener(_repaint);
    _own?.dispose();
    super.dispose();
  }

  void _clear() {
    _ctl.clear();
    widget.onChanged('');
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _ctl,
      autofocus: widget.autofocus,
      textInputAction: TextInputAction.search,
      onChanged: widget.onChanged,
      onSubmitted: (_) => FocusScope.of(context).unfocus(),
      onTapOutside: (_) => FocusScope.of(context).unfocus(),
      decoration: InputDecoration(
        isDense: widget.dense,
        hintText: widget.hint ?? tr('ابحث…', 'Search…'),
        hintMaxLines: 1,
        prefixIcon: const Icon(Icons.search),
        suffixText: widget.suffixText,
        suffixIcon: _ctl.text.isEmpty
            ? null
            : IconButton(
                tooltip: tr('مسح البحث', 'Clear search'),
                icon: const Icon(Icons.close_rounded),
                onPressed: _clear,
              ),
      ),
    );
  }
}
