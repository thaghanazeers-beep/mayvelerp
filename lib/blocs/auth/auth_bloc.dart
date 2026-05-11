import 'dart:convert';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:http/http.dart' as http;
import 'auth_event.dart';
import 'auth_state.dart';
import '../../models/user_model.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final String baseUrl = 'http://127.0.0.1:3001/api/auth';

  AuthBloc() : super(AuthInitial()) {
    on<CheckAuth>(_onCheckAuth);
    on<Login>(_onLogin);
    on<Signup>(_onSignup);
    on<Logout>(_onLogout);
  }

  void _onCheckAuth(CheckAuth event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    await Future.delayed(const Duration(milliseconds: 500));
    emit(Unauthenticated());
  }

  void _onLogin(Login event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': event.email, 'password': event.password}),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        emit(Authenticated(UserModel(
          id: data['_id'],
          name: data['name'],
          email: data['email'],
          role: data['role'],
          profilePictureUrl: data['profilePictureUrl'],
        )));
      } else {
        emit(AuthError('Login failed: ${res.body}'));
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError('Network error: $e'));
      emit(Unauthenticated());
    }
  }

  void _onSignup(Signup event, Emitter<AuthState> emit) async {
    emit(AuthLoading());
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/signup'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': event.name,
          'email': event.email,
          'password': event.password,
          'role': event.role,
        }),
      );

      if (res.statusCode == 201) {
        final data = jsonDecode(res.body);
        emit(Authenticated(UserModel(
          id: data['_id'],
          name: data['name'],
          email: data['email'],
          role: data['role'],
          profilePictureUrl: data['profilePictureUrl'],
        )));
      } else {
        emit(AuthError('Signup failed: ${res.body}'));
        emit(Unauthenticated());
      }
    } catch (e) {
      emit(AuthError('Network error: $e'));
      emit(Unauthenticated());
    }
  }

  void _onLogout(Logout event, Emitter<AuthState> emit) {
    emit(Unauthenticated());
  }
}
