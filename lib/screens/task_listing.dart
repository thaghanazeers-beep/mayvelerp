import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../blocs/task/task_bloc.dart';
import '../blocs/task/task_event.dart';
import '../blocs/task/task_state.dart';
import '../models/task_model.dart';
import 'task_detail.dart';

class TaskListing extends StatefulWidget {
  const TaskListing({Key? key}) : super(key: key);

  @override
  State<TaskListing> createState() => _TaskListingState();
}

class _TaskListingState extends State<TaskListing> {
  // 0: Kanban, 1: List, 2: Table
  int _currentViewMode = 0;

  // Modern subtle colors
  final Color _bgToDo = const Color(0xFFF1F5F9);
  final Color _bgInProgress = const Color(0xFFEFF6FF);
  final Color _bgDone = const Color(0xFFF0FDF4);
  
  final Color _chipToDo = const Color(0xFFE2E8F0);
  final Color _chipToDoText = const Color(0xFF475569);
  
  final Color _chipInProgress = const Color(0xFFDBEAFE);
  final Color _chipInProgressText = const Color(0xFF2563EB);
  
  final Color _chipDone = const Color(0xFFDCFCE7);
  final Color _chipDoneText = const Color(0xFF16A34A);

  Color _getChipBg(String status) {
    if (status == 'To Do') return _chipToDo;
    if (status == 'In Progress') return _chipInProgress;
    return _chipDone;
  }

  Color _getChipText(String status) {
    if (status == 'To Do') return _chipToDoText;
    if (status == 'In Progress') return _chipInProgressText;
    return _chipDoneText;
  }

  Widget _buildTaskCard(TaskModel task) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12.0),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (context) => TaskDetailPage(initialTask: task)),
          );
        }, // Open task details
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      task.title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                        color: Color(0xFF1E293B),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _getChipBg(task.status),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      task.status,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: _getChipText(task.status),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                task.description,
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 14,
                  height: 1.4,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  const Icon(Icons.calendar_today_outlined, size: 14, color: Color(0xFF94A3B8)),
                  const SizedBox(width: 4),
                  Text(
                    DateFormat('MMM d, yyyy').format(task.dueDate),
                    style: const TextStyle(
                      color: Color(0xFF94A3B8),
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildListView(List<TaskModel> tasks) {
    if (tasks.isEmpty) {
      return _buildEmptyState();
    }
    return ListView.builder(
      padding: const EdgeInsets.all(24.0),
      itemCount: tasks.length,
      itemBuilder: (context, index) {
        return _buildTaskCard(tasks[index]);
      },
    );
  }

  Widget _buildKanbanView(List<TaskModel> tasks) {
    final todoTasks = tasks.where((t) => t.status == 'To Do').toList();
    final inProgressTasks = tasks.where((t) => t.status == 'In Progress').toList();
    final doneTasks = tasks.where((t) => t.status == 'Done').toList();

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(24.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildKanbanColumn("To Do", _bgToDo, todoTasks),
          const SizedBox(width: 24),
          _buildKanbanColumn("In Progress", _bgInProgress, inProgressTasks),
          const SizedBox(width: 24),
          _buildKanbanColumn("Done", _bgDone, doneTasks),
        ],
      ),
    );
  }

  Widget _buildKanbanColumn(String title, Color bgColor, List<TaskModel> tasks) {
    return DragTarget<TaskModel>(
      onWillAccept: (data) => data?.status != title, // accept if it's from another column
      onAccept: (data) {
        // Dispatch update task event
        context.read<TaskBloc>().add(UpdateTask(data.copyWith(status: title)));
      },
      builder: (context, candidateData, rejectedData) {
        bool isHovering = candidateData.isNotEmpty;
        return Container(
          width: 320,
          decoration: BoxDecoration(
            color: isHovering ? bgColor.withOpacity(0.7) : bgColor,
            borderRadius: BorderRadius.circular(16),
            border: isHovering ? Border.all(color: Theme.of(context).colorScheme.primary, width: 2) : Border.all(color: Colors.transparent, width: 2),
          ),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 16.0, left: 4, right: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFF334155)),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Text(
                        "\${tasks.length}",
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFF64748B)),
                      ),
                    ),
                  ],
                ),
              ),
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: tasks.length,
                itemBuilder: (context, index) {
                  final task = tasks[index];
                  return Draggable<TaskModel>(
                    data: task,
                    feedback: SizedBox(
                      width: 300,
                      child: Material(
                        color: Colors.transparent,
                        child: Opacity(
                          opacity: 0.8,
                          child: _buildTaskCard(task),
                        ),
                      ),
                    ),
                    childWhenDragging: Opacity(
                      opacity: 0.3,
                      child: _buildTaskCard(task),
                    ),
                    child: _buildTaskCard(task),
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTableView(List<TaskModel> tasks) {
    if (tasks.isEmpty) return _buildEmptyState();
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowColor: MaterialStateProperty.all(const Color(0xFFF8FAFC)),
            columns: const [
              DataColumn(label: Text("Task ID", style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF475569)))),
              DataColumn(label: Text("Title", style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF475569)))),
              DataColumn(label: Text("Status", style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF475569)))),
              DataColumn(label: Text("Due Date", style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF475569)))),
            ],
            rows: tasks.map((task) {
              return DataRow(
                cells: [
                  DataCell(Text(task.id, style: const TextStyle(color: Color(0xFF64748B)))),
                  DataCell(Text(task.title, style: const TextStyle(fontWeight: FontWeight.w500))),
                  DataCell(
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: _getChipBg(task.status),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        task.status,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _getChipText(task.status),
                        ),
                      ),
                    ),
                  ),
                  DataCell(Text(DateFormat('MMM d, yyyy').format(task.dueDate), style: const TextStyle(color: Color(0xFF64748B)))),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.assignment_outlined, size: 64, color: const Color(0xFFCBD5E1)),
          const SizedBox(height: 16),
          const Text("No tasks yet", style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Color(0xFF475569))),
          const SizedBox(height: 8),
          const Text("Add a task to get started", style: TextStyle(color: Color(0xFF94A3B8))),
        ],
      ),
    );
  }

  Widget _buildBody() {
    return BlocBuilder<TaskBloc, TaskState>(
      builder: (context, state) {
        if (state is TaskLoading) {
          return const Center(child: CircularProgressIndicator());
        } else if (state is TaskLoaded) {
          switch (_currentViewMode) {
            case 0:
              return _buildKanbanView(state.tasks);
            case 1:
              return _buildListView(state.tasks);
            case 2:
              return _buildTableView(state.tasks);
            default:
              return _buildKanbanView(state.tasks);
          }
        } else if (state is TaskError) {
          return Center(child: Text(state.message, style: const TextStyle(color: Colors.red)));
        }
        return const Center(child: Text("Initializing..."));
      },
    );
  }

  void _showAddTaskDialog(BuildContext context) {
    // Instead of a dialog, we just create a new empty task and go to the detail page
    final newTask = TaskModel(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      title: 'Untitled',
      description: '',
      status: 'To Do',
      dueDate: DateTime.now(),
      createdDate: DateTime.now(),
    );
    context.read<TaskBloc>().add(AddTask(newTask));
    
    Navigator.push(
      context,
      MaterialPageRoute(builder: (context) => TaskDetailPage(initialTask: newTask)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(24.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text("Tasks", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                SegmentedButton<int>(
                  style: ButtonStyle(
                    shape: MaterialStateProperty.all(RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
                  ),
                  segments: const [
                    ButtonSegment(value: 0, icon: Icon(Icons.view_kanban), label: Text("Board")),
                    ButtonSegment(value: 1, icon: Icon(Icons.list), label: Text("List")),
                    ButtonSegment(value: 2, icon: Icon(Icons.table_chart), label: Text("Table")),
                  ],
                  selected: {_currentViewMode},
                  onSelectionChanged: (Set<int> newSelection) {
                    setState(() {
                      _currentViewMode = newSelection.first;
                    });
                  },
                ),
              ],
            ),
          ),
          Expanded(child: _buildBody()),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddTaskDialog(context),
        elevation: 2,
        icon: const Icon(Icons.add),
        label: const Text("New Task", style: TextStyle(fontWeight: FontWeight.w600)),
      ),
    );
  }
}
