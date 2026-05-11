import 'dart:convert';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:http/http.dart' as http;
import 'team_event_state.dart';
import '../../models/user_model.dart';

class TeamBloc extends Bloc<TeamEvent, TeamState> {
  final String baseUrl = 'http://127.0.0.1:3001/api';

  TeamBloc() : super(TeamInitial()) {
    on<LoadTeam>(_onLoadTeam);
    on<InviteUser>(_onInviteUser);
    on<RemoveUser>(_onRemoveUser);
  }

  void _onLoadTeam(LoadTeam event, Emitter<TeamState> emit) async {
    emit(TeamLoading());
    try {
      final res = await http.get(Uri.parse('$baseUrl/team?teamspaceId=69f0d4c70c14f3d081540d9f'));
      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(res.body);
        final members = data.map((d) => UserModel(
          id: d['_id'],
          name: d['name'],
          email: d['email'],
          role: d['role'],
          profilePictureUrl: d['profilePictureUrl'],
        )).toList();
        emit(TeamLoaded(members));
      } else {
        emit(TeamError('Failed to load team'));
      }
    } catch (e) {
      emit(TeamError('Network error: $e'));
    }
  }

  void _onInviteUser(InviteUser event, Emitter<TeamState> emit) async {
    if (state is TeamLoaded) {
      final currentMembers = (state as TeamLoaded).members;
      try {
        final res = await http.post(
          Uri.parse('$baseUrl/auth/signup'), // Reusing signup for invite
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'name': event.email.split('@')[0],
            'email': event.email,
            'password': 'defaultpassword123', // Admin sets a default password
            'role': event.role,
          }),
        );
        
        if (res.statusCode == 201) {
          final d = jsonDecode(res.body);
          final newUser = UserModel(
            id: d['_id'],
            name: d['name'],
            email: d['email'],
            role: d['role'],
            profilePictureUrl: d['profilePictureUrl'],
          );
          emit(TeamLoaded([...currentMembers, newUser]));
        }
      } catch (e) {
        // Handle error
      }
    }
  }

  void _onRemoveUser(RemoveUser event, Emitter<TeamState> emit) async {
    if (state is TeamLoaded) {
      final currentMembers = (state as TeamLoaded).members;
      try {
        final res = await http.delete(Uri.parse('$baseUrl/team/${event.userId}'));
        if (res.statusCode == 200) {
          emit(TeamLoaded(currentMembers.where((u) => u.id != event.userId).toList()));
        }
      } catch (e) {
        // Handle error
      }
    }
  }
}
