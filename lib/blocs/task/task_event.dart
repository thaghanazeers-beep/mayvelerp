import 'package:equatable/equatable.dart';
import '../../models/task_model.dart';

abstract class TaskEvent extends Equatable {
  const TaskEvent();

  @override
  List<Object> get props => [];
}

class LoadTasks extends TaskEvent {}

class AddTask extends TaskEvent {
  final TaskModel task;

  const AddTask(this.task);

  @override
  List<Object> get props => [task];
}

class UpdateTask extends TaskEvent {
  final TaskModel task;

  const UpdateTask(this.task);

  @override
  List<Object> get props => [task];
}

class DeleteTask extends TaskEvent {
  final String taskId;

  const DeleteTask(this.taskId);

  @override
  List<Object> get props => [taskId];
}

/// Add a child task (subtask) to a parent task.
class AddChildTask extends TaskEvent {
  final String parentId;
  final TaskModel childTask;

  const AddChildTask({required this.parentId, required this.childTask});

  @override
  List<Object> get props => [parentId, childTask];
}

/// Delete a child task from a parent task.
class DeleteChildTask extends TaskEvent {
  final String parentId;
  final String childTaskId;

  const DeleteChildTask({required this.parentId, required this.childTaskId});

  @override
  List<Object> get props => [parentId, childTaskId];
}

/// Update a child task inside a parent task.
class UpdateChildTask extends TaskEvent {
  final String parentId;
  final TaskModel childTask;

  const UpdateChildTask({required this.parentId, required this.childTask});

  @override
  List<Object> get props => [parentId, childTask];
}

/// Add a custom property definition globally (shared across tasks).
class AddPropertyDefinition extends TaskEvent {
  final PropertyDefinition definition;

  const AddPropertyDefinition(this.definition);

  @override
  List<Object> get props => [definition];
}

/// Remove a custom property definition globally.
class RemovePropertyDefinition extends TaskEvent {
  final String definitionId;

  const RemovePropertyDefinition(this.definitionId);

  @override
  List<Object> get props => [definitionId];
}

/// Add an attachment to a task.
class AddAttachment extends TaskEvent {
  final String taskId;
  final Attachment attachment;

  const AddAttachment({required this.taskId, required this.attachment});

  @override
  List<Object> get props => [taskId, attachment];
}

/// Remove an attachment from a task.
class RemoveAttachment extends TaskEvent {
  final String taskId;
  final String attachmentId;

  const RemoveAttachment({required this.taskId, required this.attachmentId});

  @override
  List<Object> get props => [taskId, attachmentId];
}
