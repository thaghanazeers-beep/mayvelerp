import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_fonts/google_fonts.dart';
import 'screens/task_listing.dart';
import 'screens/auth/auth_page.dart';
import 'screens/layout/main_layout.dart';
import 'blocs/task/task_bloc.dart';
import 'blocs/task/task_event.dart';
import 'blocs/auth/auth_bloc.dart';
import 'blocs/auth/auth_event.dart';
import 'blocs/auth/auth_state.dart';
import 'blocs/team/team_bloc.dart';
import 'blocs/team/team_event_state.dart';


void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<AuthBloc>(create: (context) => AuthBloc()..add(CheckAuth())),
        BlocProvider<TaskBloc>(create: (context) => TaskBloc()..add(LoadTasks())),
        BlocProvider<TeamBloc>(create: (context) => TeamBloc()..add(LoadTeam())),
      ],
      child: MaterialApp(
        title: 'Task Tracker',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF6366F1), // Indigo
            brightness: Brightness.light,
            surface: const Color(0xFFF8FAFC),
            background: const Color(0xFFF1F5F9),
          ),
          textTheme: GoogleFonts.interTextTheme(Theme.of(context).textTheme),
          appBarTheme: const AppBarTheme(
            backgroundColor: Colors.transparent,
            elevation: 0,
            centerTitle: false,
            foregroundColor: Color(0xFF0F172A),
          ),
          cardTheme: CardThemeData(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: Color(0xFFE2E8F0), width: 1),
            ),
            color: Colors.white,
          ),
        ),
        home: BlocBuilder<AuthBloc, AuthState>(
          builder: (context, state) {
            if (state is AuthInitial) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            if (state is Authenticated) {
              return const MainLayout();
            }
            return const AuthPage();
          },
        ),
      ),
    );
  }
}
