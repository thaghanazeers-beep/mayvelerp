class UserModel {
  final String id;
  final String name;
  final String email;
  final String role; // 'Admin', 'Member'
  final String? profilePictureUrl;

  UserModel({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.profilePictureUrl,
  });

  UserModel copyWith({
    String? id,
    String? name,
    String? email,
    String? role,
    String? profilePictureUrl,
  }) {
    return UserModel(
      id: id ?? this.id,
      name: name ?? this.name,
      email: email ?? this.email,
      role: role ?? this.role,
      profilePictureUrl: profilePictureUrl ?? this.profilePictureUrl,
    );
  }
}
