import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_bloc/flutter_bloc.dart';
import 'task_event.dart';
import 'task_state.dart';
import '../../models/task_model.dart';

class TaskBloc extends Bloc<TaskEvent, TaskState> {
  TaskBloc() : super(TaskInitial()) {
    on<LoadTasks>(_onLoadTasks);
    on<AddTask>(_onAddTask);
    on<UpdateTask>(_onUpdateTask);
    on<DeleteTask>(_onDeleteTask);
    on<AddChildTask>(_onAddChildTask);
    on<DeleteChildTask>(_onDeleteChildTask);
    on<UpdateChildTask>(_onUpdateChildTask);
    on<AddPropertyDefinition>(_onAddPropertyDefinition);
    on<RemovePropertyDefinition>(_onRemovePropertyDefinition);
    on<AddAttachment>(_onAddAttachment);
    on<RemoveAttachment>(_onRemoveAttachment);
  }

  final String baseUrl = 'http://127.0.0.1:3001/api';

  void _onLoadTasks(LoadTasks event, Emitter<TaskState> emit) async {
    emit(TaskLoading());
    try {
      final res = await http.get(Uri.parse('$baseUrl/tasks?limit=500&teamspaceId=69f0d4c70c14f3d081540d9f'));
      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(res.body);
        final initialTasks = data.map((t) => TaskModel.fromJson(t)).toList();
        emit(TaskLoaded(initialTasks, propertyDefinitions: []));
      } else {
        emit(TaskLoaded(const [], propertyDefinitions: [])); // Or error state
      }
    } catch (e) {
      emit(TaskLoaded(const [], propertyDefinitions: []));
    }
  }

  void _onAddTask(AddTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      emit(TaskLoaded([...s.tasks, event.task],
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onUpdateTask(UpdateTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        return task.id == event.task.id ? event.task : task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onDeleteTask(DeleteTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks =
          s.tasks.where((task) => task.id != event.taskId).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onAddChildTask(AddChildTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        if (task.id == event.parentId) {
          return task.copyWith(
            childTasks: [...task.childTasks, event.childTask],
          );
        }
        return task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onDeleteChildTask(DeleteChildTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        if (task.id == event.parentId) {
          return task.copyWith(
            childTasks: task.childTasks
                .where((child) => child.id != event.childTaskId)
                .toList(),
          );
        }
        return task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onUpdateChildTask(UpdateChildTask event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        if (task.id == event.parentId) {
          return task.copyWith(
            childTasks: task.childTasks.map((child) {
              return child.id == event.childTask.id ? event.childTask : child;
            }).toList(),
          );
        }
        return task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onAddPropertyDefinition(
      AddPropertyDefinition event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      emit(TaskLoaded(s.tasks,
          propertyDefinitions: [...s.propertyDefinitions, event.definition]));
    }
  }

  void _onRemovePropertyDefinition(
      RemovePropertyDefinition event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      emit(TaskLoaded(s.tasks,
          propertyDefinitions: s.propertyDefinitions
              .where((d) => d.id != event.definitionId)
              .toList()));
    }
  }

  void _onAddAttachment(AddAttachment event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        if (task.id == event.taskId) {
          return task.copyWith(
            attachments: [...task.attachments, event.attachment],
          );
        }
        return task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }

  void _onRemoveAttachment(RemoveAttachment event, Emitter<TaskState> emit) {
    if (state is TaskLoaded) {
      final s = state as TaskLoaded;
      final updatedTasks = s.tasks.map((task) {
        if (task.id == event.taskId) {
          return task.copyWith(
            attachments: task.attachments
                .where((a) => a.id != event.attachmentId)
                .toList(),
          );
        }
        return task;
      }).toList();
      emit(TaskLoaded(updatedTasks,
          propertyDefinitions: s.propertyDefinitions));
    }
  }
}
