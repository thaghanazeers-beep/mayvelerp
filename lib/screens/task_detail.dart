import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../blocs/task/task_bloc.dart';
import '../../blocs/task/task_event.dart';
import '../../blocs/task/task_state.dart';
import '../../models/task_model.dart';
import 'widgets/property_row.dart';

class TaskDetailPage extends StatefulWidget {
  final TaskModel initialTask;

  const TaskDetailPage({Key? key, required this.initialTask}) : super(key: key);

  @override
  State<TaskDetailPage> createState() => _TaskDetailPageState();
}

class _TaskDetailPageState extends State<TaskDetailPage> {
  late TaskModel _task;
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _descController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _task = widget.initialTask;
    _titleController.text = _task.title;
    _descController.text = _task.description;
  }

  void _updateTask(TaskModel updatedTask) {
    setState(() {
      _task = updatedTask;
    });
    context.read<TaskBloc>().add(UpdateTask(_task));
  }

  void _showStatusPicker() {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: ['To Do', 'In Progress', 'Done'].map((status) {
              return ListTile(
                title: Text(status),
                trailing: _task.status == status ? const Icon(Icons.check) : null,
                onTap: () {
                  _updateTask(_task.copyWith(status: status));
                  Navigator.pop(context);
                },
              );
            }).toList(),
          ),
        );
      },
    );
  }

  void _pickDueDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _task.dueDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (date != null) {
      _updateTask(_task.copyWith(dueDate: date));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF64748B)),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_horiz, color: Color(0xFF64748B)),
            onPressed: () {}, // Add options like delete task
          )
        ],
      ),
      body: BlocBuilder<TaskBloc, TaskState>(
        builder: (context, state) {
          List<PropertyDefinition> defs = [];
          if (state is TaskLoaded) {
            defs = state.propertyDefinitions;
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Icon (Optional) -> Not implemented yet, just a placeholder
                const Text("📄", style: TextStyle(fontSize: 48)),
                const SizedBox(height: 16),

                // Title
                TextField(
                  controller: _titleController,
                  style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: "Untitled",
                    hintStyle: TextStyle(color: Color(0xFFCBD5E1)),
                  ),
                  onChanged: (val) => _updateTask(_task.copyWith(title: val)),
                ),
                const SizedBox(height: 16),

                // Properties (The Notion-like columns)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xFFF1F5F9)),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    children: [
                      PropertyRow(
                        icon: Icons.adjust,
                        label: 'Status',
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: StatusChip(status: _task.status, onTap: _showStatusPicker),
                        ),
                      ),
                      PropertyRow(
                        icon: Icons.person_outline,
                        label: 'Assignee',
                        child: TextField(
                          controller: TextEditingController(text: _task.assignee ?? ''),
                          decoration: const InputDecoration(
                            isDense: true,
                            border: InputBorder.none,
                            hintText: 'Empty',
                            hintStyle: TextStyle(color: Color(0xFFCBD5E1)),
                            contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          ),
                          onSubmitted: (val) => _updateTask(_task.copyWith(assignee: val)),
                        ),
                      ),
                      PropertyRow(
                        icon: Icons.calendar_today,
                        label: 'Due Date',
                        child: InkWell(
                          onTap: _pickDueDate,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            child: Text(
                              DateFormat('MMM d, yyyy').format(_task.dueDate),
                              style: const TextStyle(fontSize: 14, color: Color(0xFF1E293B)),
                            ),
                          ),
                        ),
                      ),
                      PropertyRow(
                        icon: Icons.access_time,
                        label: 'Created',
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          child: Text(
                            DateFormat('MMM d, yyyy HH:mm').format(_task.createdDate),
                            style: const TextStyle(fontSize: 14, color: Color(0xFF94A3B8)),
                          ),
                        ),
                      ),
                      
                      // Dynamic Custom Properties
                      ...defs.map((def) {
                        final prop = _task.customProperties.firstWhere(
                          (p) => p.definitionId == def.id,
                          orElse: () => CustomProperty(definitionId: def.id, value: null),
                        );
                        return PropertyRow(
                          icon: _getIconForType(def.type),
                          label: def.name,
                          child: CustomPropertyEditor(
                            definition: def,
                            value: prop.value,
                            onChanged: (val) {
                              final updatedProps = List<CustomProperty>.from(_task.customProperties);
                              final index = updatedProps.indexWhere((p) => p.definitionId == def.id);
                              if (index >= 0) {
                                updatedProps[index] = prop.copyWith(value: val);
                              } else {
                                updatedProps.add(prop.copyWith(value: val));
                              }
                              _updateTask(_task.copyWith(customProperties: updatedProps));
                            },
                          ),
                        );
                      }).toList(),

                      // Add Property Button
                      Padding(
                        padding: const EdgeInsets.only(top: 8.0),
                        child: InkWell(
                          onTap: () => _showAddPropertyDialog(context),
                          child: Row(
                            children: const [
                              Icon(Icons.add, size: 16, color: Color(0xFF94A3B8)),
                              SizedBox(width: 8),
                              Text("Add a property", style: TextStyle(color: Color(0xFF94A3B8))),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 32),
                
                // Content Description
                TextField(
                  controller: _descController,
                  maxLines: null,
                  style: const TextStyle(fontSize: 16, height: 1.5, color: Color(0xFF334155)),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: "Add a description...",
                    hintStyle: TextStyle(color: Color(0xFFCBD5E1)),
                  ),
                  onChanged: (val) => _updateTask(_task.copyWith(description: val)),
                ),

                const SizedBox(height: 32),
                const Divider(),
                const SizedBox(height: 16),

                // Attachments Section
                const Text("Attachments", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    ..._task.attachments.map((a) => Chip(
                      label: Text(a.name),
                      deleteIcon: const Icon(Icons.close, size: 16),
                      onDeleted: () {
                        context.read<TaskBloc>().add(RemoveAttachment(taskId: _task.id, attachmentId: a.id));
                        setState(() {
                          _task = _task.copyWith(
                            attachments: _task.attachments.where((att) => att.id != a.id).toList()
                          );
                        });
                      },
                    )),
                    ActionChip(
                      label: const Text("Add Attachment"),
                      avatar: const Icon(Icons.attach_file, size: 16),
                      onPressed: () {
                        // Dummy attachment addition
                        final newAtt = Attachment(
                          id: DateTime.now().toString(),
                          name: 'Document.pdf',
                          path: '/mock/path',
                          sizeBytes: 1024 * 500,
                          addedAt: DateTime.now(),
                        );
                        context.read<TaskBloc>().add(AddAttachment(taskId: _task.id, attachment: newAtt));
                        setState(() {
                          _task = _task.copyWith(attachments: [..._task.attachments, newAtt]);
                        });
                      },
                    )
                  ],
                ),

                const SizedBox(height: 32),

                // Child Tasks Section
                const Text("Subtasks", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ..._task.childTasks.map((child) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Checkbox(
                    value: child.status == 'Done',
                    onChanged: (val) {
                      final updated = child.copyWith(status: val == true ? 'Done' : 'To Do');
                      context.read<TaskBloc>().add(UpdateChildTask(parentId: _task.id, childTask: updated));
                      _refreshTaskFromBloc(context);
                    },
                  ),
                  title: Text(child.title, style: TextStyle(decoration: child.status == 'Done' ? TextDecoration.lineThrough : null)),
                  trailing: IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: () {
                      context.read<TaskBloc>().add(DeleteChildTask(parentId: _task.id, childTaskId: child.id));
                      _refreshTaskFromBloc(context);
                    },
                  ),
                )),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.add, color: Color(0xFF94A3B8)),
                  title: const Text("Add subtask", style: TextStyle(color: Color(0xFF94A3B8))),
                  onTap: () {
                     final newChild = TaskModel(
                        id: DateTime.now().toString(),
                        title: 'New Subtask',
                        description: '',
                        status: 'To Do',
                        dueDate: DateTime.now(),
                        parentId: _task.id,
                      );
                      context.read<TaskBloc>().add(AddChildTask(parentId: _task.id, childTask: newChild));
                      _refreshTaskFromBloc(context);
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _refreshTaskFromBloc(BuildContext context) {
    // Quick hack to refresh local state from bloc after child task ops
    Future.delayed(const Duration(milliseconds: 100), () {
       if(mounted) {
          final state = context.read<TaskBloc>().state;
          if (state is TaskLoaded) {
            final t = state.tasks.firstWhere((t) => t.id == _task.id, orElse: () => _task);
            setState(() { _task = t; });
          }
       }
    });
  }

  IconData _getIconForType(PropertyType type) {
    switch (type) {
      case PropertyType.text: return Icons.short_text;
      case PropertyType.number: return Icons.numbers;
      case PropertyType.date: return Icons.date_range;
      case PropertyType.select: return Icons.arrow_drop_down_circle_outlined;
      case PropertyType.multiSelect: return Icons.list_alt;
      case PropertyType.checkbox: return Icons.check_box_outlined;
      case PropertyType.url: return Icons.link;
      case PropertyType.email: return Icons.email_outlined;
      case PropertyType.phone: return Icons.phone_outlined;
    }
  }

  void _showAddPropertyDialog(BuildContext context) {
    String name = '';
    PropertyType type = PropertyType.text;

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(builder: (ctx, setDialogState) {
          return AlertDialog(
            title: const Text("New Property"),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  decoration: const InputDecoration(labelText: "Name"),
                  onChanged: (v) => name = v,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<PropertyType>(
                  value: type,
                  decoration: const InputDecoration(labelText: "Type"),
                  items: PropertyType.values.map((t) => DropdownMenuItem(value: t, child: Text(t.name))).toList(),
                  onChanged: (v) { if (v != null) setDialogState(() => type = v); },
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
              ElevatedButton(
                onPressed: () {
                  if (name.isNotEmpty) {
                    context.read<TaskBloc>().add(AddPropertyDefinition(
                      PropertyDefinition(id: DateTime.now().toString(), name: name, type: type)
                    ));
                    Navigator.pop(ctx);
                  }
                },
                child: const Text("Add"),
              ),
            ],
          );
        });
      },
    );
  }
}
