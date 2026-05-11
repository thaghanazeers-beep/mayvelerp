import 'package:equatable/equatable.dart';

abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object> get props => [];
}

class CheckAuth extends AuthEvent {}

class Login extends AuthEvent {
  final String email;
  final String password;

  const Login({required this.email, required this.password});

  @override
  List<Object> get props => [email, password];
}

class Signup extends AuthEvent {
  final String name;
  final String email;
  final String password;
  final String role; // Typically Admin for the first user

  const Signup({required this.name, required this.email, required this.password, this.role = 'Admin'});

  @override
  List<Object> get props => [name, email, password, role];
}

class Logout extends AuthEvent {}
