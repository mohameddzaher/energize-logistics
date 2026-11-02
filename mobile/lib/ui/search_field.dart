import 'package:flutter/material.dart';
import '../services/lang.dart';

/// Unified search field in the app. An uncontrolled field was rebuilt on loading, error or live update, came back empty while the text still filtered the list, so content vanished with no cleared field. Here the text lives in a controller owned by the screen or the field itself so it is not lost, the clear button clears and closes the sheet in one tap, and Search in the sheet closes it.
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
