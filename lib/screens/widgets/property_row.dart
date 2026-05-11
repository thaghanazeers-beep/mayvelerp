import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/task_model.dart';

class PropertyRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Widget child;

  const PropertyRow({
    Key? key,
    required this.icon,
    required this.label,
    required this.child,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 160,
            child: Row(
              children: [
                Icon(icon, size: 16, color: const Color(0xFF94A3B8)),
                const SizedBox(width: 8),
                Text(label, style: const TextStyle(fontSize: 14, color: Color(0xFF64748B), fontWeight: FontWeight.w500)),
              ],
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  final String status;
  final VoidCallback? onTap;

  const StatusChip({Key? key, required this.status, this.onTap}) : super(key: key);

  Color get _bg {
    if (status == 'To Do') return const Color(0xFFE2E8F0);
    if (status == 'In Progress') return const Color(0xFFDBEAFE);
    return const Color(0xFFDCFCE7);
  }

  Color get _fg {
    if (status == 'To Do') return const Color(0xFF475569);
    if (status == 'In Progress') return const Color(0xFF2563EB);
    return const Color(0xFF16A34A);
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: _bg, borderRadius: BorderRadius.circular(6)),
        child: Text(status, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _fg)),
      ),
    );
  }
}

class CustomPropertyEditor extends StatelessWidget {
  final PropertyDefinition definition;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;

  const CustomPropertyEditor({
    Key? key,
    required this.definition,
    required this.value,
    required this.onChanged,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    switch (definition.type) {
      case PropertyType.text:
      case PropertyType.url:
      case PropertyType.email:
      case PropertyType.phone:
        return _buildTextInput();
      case PropertyType.number:
        return _buildNumberInput();
      case PropertyType.date:
        return _buildDateInput(context);
      case PropertyType.checkbox:
        return _buildCheckbox();
      case PropertyType.select:
        return _buildSelect();
      case PropertyType.multiSelect:
        return _buildMultiSelect();
    }
  }

  Widget _buildTextInput() {
    return TextField(
      controller: TextEditingController(text: value?.toString() ?? ''),
      style: const TextStyle(fontSize: 14),
      decoration: const InputDecoration(
        isDense: true,
        border: InputBorder.none,
        hintText: 'Empty',
        hintStyle: TextStyle(color: Color(0xFFCBD5E1)),
        contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      ),
      onSubmitted: onChanged,
    );
  }

  Widget _buildNumberInput() {
    return TextField(
      controller: TextEditingController(text: value?.toString() ?? ''),
      keyboardType: TextInputType.number,
      style: const TextStyle(fontSize: 14),
      decoration: const InputDecoration(
        isDense: true,
        border: InputBorder.none,
        hintText: '0',
        hintStyle: TextStyle(color: Color(0xFFCBD5E1)),
        contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      ),
      onSubmitted: (v) => onChanged(num.tryParse(v) ?? 0),
    );
  }

  Widget _buildDateInput(BuildContext context) {
    final dateVal = value is DateTime ? value as DateTime : null;
    return InkWell(
      onTap: () async {
        final d = await showDatePicker(
          context: context,
          initialDate: dateVal ?? DateTime.now(),
          firstDate: DateTime(2020),
          lastDate: DateTime(2035),
        );
        if (d != null) onChanged(d);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Text(
          dateVal != null ? DateFormat('MMM d, yyyy').format(dateVal) : 'Pick a date',
          style: TextStyle(fontSize: 14, color: dateVal != null ? const Color(0xFF1E293B) : const Color(0xFFCBD5E1)),
        ),
      ),
    );
  }

  Widget _buildCheckbox() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Checkbox(
        value: value == true,
        onChanged: (v) => onChanged(v ?? false),
      ),
    );
  }

  Widget _buildSelect() {
    return PopupMenuButton<String>(
      initialValue: value?.toString(),
      onSelected: onChanged,
      itemBuilder: (_) => definition.options
          .map((o) => PopupMenuItem(value: o, child: Text(o)))
          .toList(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Text(
          value?.toString() ?? 'Select...',
          style: TextStyle(fontSize: 14, color: value != null ? const Color(0xFF1E293B) : const Color(0xFFCBD5E1)),
        ),
      ),
    );
  }

  Widget _buildMultiSelect() {
    final selected = value is List ? List<String>.from(value) : <String>[];
    return Wrap(
      spacing: 4,
      children: [
        ...selected.map((s) => Chip(
              label: Text(s, style: const TextStyle(fontSize: 12)),
              deleteIcon: const Icon(Icons.close, size: 14),
              onDeleted: () {
                final updated = [...selected]..remove(s);
                onChanged(updated);
              },
            )),
        PopupMenuButton<String>(
          icon: const Icon(Icons.add, size: 16),
          onSelected: (val) => onChanged([...selected, val]),
          itemBuilder: (_) => definition.options
              .where((o) => !selected.contains(o))
              .map((o) => PopupMenuItem(value: o, child: Text(o)))
              .toList(),
        ),
      ],
    );
  }
}
