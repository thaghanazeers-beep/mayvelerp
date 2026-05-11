import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../blocs/auth/auth_bloc.dart';
import '../../blocs/auth/auth_state.dart';
import '../../blocs/team/team_bloc.dart';
import '../../blocs/team/team_event_state.dart';

class TeamPage extends StatelessWidget {
  const TeamPage({Key? key}) : super(key: key);

  void _showInviteDialog(BuildContext context) {
    String email = '';
    String role = 'Member';

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text("Invite User"),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    decoration: const InputDecoration(labelText: "Email Address", hintText: "user@mayvel.com"),
                    onChanged: (v) => email = v,
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: role,
                    decoration: const InputDecoration(labelText: "Role"),
                    items: ['Admin', 'Member'].map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
                    onChanged: (v) {
                      if (v != null) setDialogState(() => role = v);
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
                ElevatedButton(
                  onPressed: () {
                    if (email.isNotEmpty) {
                      context.read<TeamBloc>().add(InviteUser(email: email, role: role));
                      Navigator.pop(ctx);
                    }
                  },
                  child: const Text("Invite"),
                ),
              ],
            );
          }
        );
      }
    );
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<AuthBloc, AuthState>(
      builder: (context, authState) {
        bool isAdmin = false;
        if (authState is Authenticated && authState.user.role == 'Admin') {
          isAdmin = true;
        }

        return Scaffold(
          backgroundColor: const Color(0xFFF1F5F9),
          appBar: AppBar(
            title: const Text("Team Members", style: TextStyle(fontWeight: FontWeight.bold)),
            backgroundColor: Colors.transparent,
            actions: [
              if (isAdmin)
                Padding(
                  padding: const EdgeInsets.only(right: 24.0),
                  child: ElevatedButton.icon(
                    onPressed: () => _showInviteDialog(context),
                    icon: const Icon(Icons.person_add),
                    label: const Text("Invite User"),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF6366F1),
                      foregroundColor: Colors.white,
                    ),
                  ),
                )
            ],
          ),
          body: BlocBuilder<TeamBloc, TeamState>(
            builder: (context, state) {
              if (state is TeamLoading) {
                return const Center(child: CircularProgressIndicator());
              } else if (state is TeamLoaded) {
                return ListView.builder(
                  padding: const EdgeInsets.all(24),
                  itemCount: state.members.length,
                  itemBuilder: (context, index) {
                    final member = state.members[index];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundImage: member.profilePictureUrl != null ? NetworkImage(member.profilePictureUrl!) : null,
                          child: member.profilePictureUrl == null ? Text(member.name[0]) : null,
                        ),
                        title: Text(member.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(member.email),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: member.role == 'Admin' ? const Color(0xFFDBEAFE) : const Color(0xFFE2E8F0),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                member.role,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: member.role == 'Admin' ? const Color(0xFF2563EB) : const Color(0xFF475569)
                                ),
                              ),
                            ),
                            if (isAdmin && member.role != 'Admin') ...[
                              const SizedBox(width: 8),
                              IconButton(
                                icon: const Icon(Icons.remove_circle_outline, color: Colors.red),
                                onPressed: () {
                                  context.read<TeamBloc>().add(RemoveUser(userId: member.id));
                                },
                              )
                            ]
                          ],
                        ),
                      ),
                    );
                  },
                );
              }
              return const Center(child: Text("No team members found."));
            },
          ),
        );
      },
    );
  }
}
