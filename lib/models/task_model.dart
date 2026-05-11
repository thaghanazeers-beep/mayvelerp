/// Represents the type of a custom property column (like Notion property types).
enum PropertyType {
  text,
  number,
  date,
  select,
  multiSelect,
  checkbox,
  url,
  email,
  phone,
}

/// A custom property definition — the "column" itself.
class PropertyDefinition {
  final String id;
  final String name;
  final PropertyType type;
  final List<String> options; // For select / multiSelect types

  PropertyDefinition({
    required this.id,
    required this.name,
    required this.type,
    this.options = const [],
  });

  PropertyDefinition copyWith({
    String? id,
    String? name,
    PropertyType? type,
    List<String>? options,
  }) {
    return PropertyDefinition(
      id: id ?? this.id,
      name: name ?? this.name,
      type: type ?? this.type,
      options: options ?? this.options,
    );
  }
}

/// A custom property value — the actual data for a task's property.
class CustomProperty {
  final String definitionId; // Links to PropertyDefinition.id
  final dynamic value; // String, num, DateTime, bool, List<String>, etc.

  CustomProperty({
    required this.definitionId,
    required this.value,
  });

  CustomProperty copyWith({
    String? definitionId,
    dynamic value,
  }) {
    return CustomProperty(
      definitionId: definitionId ?? this.definitionId,
      value: value ?? this.value,
    );
  }
}

/// Represents a file attachment on a task.
class Attachment {
  final String id;
  final String name;
  final String path; // local path or URL
  final int sizeBytes;
  final DateTime addedAt;

  Attachment({
    required this.id,
    required this.name,
    required this.path,
    required this.sizeBytes,
    required this.addedAt,
  });

  Attachment copyWith({
    String? id,
    String? name,
    String? path,
    int? sizeBytes,
    DateTime? addedAt,
  }) {
    return Attachment(
      id: id ?? this.id,
      name: name ?? this.name,
      path: path ?? this.path,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      addedAt: addedAt ?? this.addedAt,
    );
  }

  String get formattedSize {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class TaskModel {
  final String id;
  final String title;
  final String description;
  final String status; // 'To Do', 'In Progress', 'Done'
  final DateTime dueDate;
  final String? assignee;
  final DateTime createdDate;
  final List<CustomProperty> customProperties;
  final List<Attachment> attachments;
  final List<TaskModel> childTasks; // Subtasks — tasks inside tasks
  final String? parentId; // If this is a child task, the parent's ID

  TaskModel({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.dueDate,
    this.assignee,
    DateTime? createdDate,
    this.customProperties = const [],
    this.attachments = const [],
    this.childTasks = const [],
    this.parentId,
  }) : createdDate = createdDate ?? DateTime.now();

  TaskModel copyWith({
    String? id,
    String? title,
    String? description,
    String? status,
    DateTime? dueDate,
    String? assignee,
    DateTime? createdDate,
    List<CustomProperty>? customProperties,
    List<Attachment>? attachments,
    List<TaskModel>? childTasks,
    String? parentId,
  }) {
    return TaskModel(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      status: status ?? this.status,
      dueDate: dueDate ?? this.dueDate,
      assignee: assignee ?? this.assignee,
      createdDate: createdDate ?? this.createdDate,
      customProperties: customProperties ?? this.customProperties,
      attachments: attachments ?? this.attachments,
      childTasks: childTasks ?? this.childTasks,
      parentId: parentId ?? this.parentId,
    );
  }

  factory TaskModel.fromJson(Map<String, dynamic> json) {
    return TaskModel(
      id: json['id'] ?? json['_id'] ?? '',
      title: json['title'] ?? '',
      description: json['description'] ?? '',
      status: json['status'] ?? 'Not Yet Started',
      dueDate: json['dueDate'] != null ? DateTime.parse(json['dueDate']) : DateTime.now(),
      assignee: json['assignee'] ?? '',
      createdDate: json['createdDate'] != null ? DateTime.parse(json['createdDate']) : DateTime.now(),
      parentId: json['parentId'],
    );
  }
}
