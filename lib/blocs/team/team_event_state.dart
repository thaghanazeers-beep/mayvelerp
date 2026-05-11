import 'package:equatable/equatable.dart';
import '../../models/user_model.dart';

abstract class TeamEvent extends Equatable {
  const TeamEvent();
  @override
  List<Object> get props => [];
}

class LoadTeam extends TeamEvent {}

class InviteUser extends TeamEvent {
  final String email;
  final String role;

  const InviteUser({required this.email, required this.role});

  @override
  List<Object> get props => [email, role];
}

class RemoveUser extends TeamEvent {
  final String userId;

  const RemoveUser({required this.userId});

  @override
  List<Object> get props => [userId];
}

abstract class TeamState extends Equatable {
  const TeamState();
  @override
  List<Object> get props => [];
}

class TeamInitial extends TeamState {}
class TeamLoading extends TeamState {}
class TeamLoaded extends TeamState {
  final List<UserModel> members;

  const TeamLoaded(this.members);

  @override
  List<Object> get props => [members];
}
class TeamError extends TeamState {
  final String message;
  const TeamError(this.message);
  @override
  List<Object> get props => [message];
}
