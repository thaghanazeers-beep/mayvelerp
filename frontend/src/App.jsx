import { useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { TeamspaceProvider, useTeamspace } from './context/TeamspaceContext';
import { OrgProvider } from './context/OrgContext';
import { useToast, ToastContainer } from './components/Toast';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import ProjectsPage from './pages/ProjectsPage';
import WorkflowsPage from './pages/WorkflowsPage';
import SprintsPage from './pages/SprintsPage';
import TeamPage from './pages/TeamPage';
import ProfilePage from './pages/ProfilePage';
import OrgChartPage from './pages/OrgChartPage';
import OrgMembersPage from './pages/OrgMembersPage';
import AiChatPage from './pages/AiChatPage';
import HelpPage from './pages/HelpPage';
import AuditLogPage from './pages/AuditLogPage';
import ActivityPage from './pages/ActivityPage';
import TeamspaceControlPage from './pages/TeamspaceControlPage';
import PlanListPage from './pages/PlanListPage';
import PlanEditorPage from './pages/PlanEditorPage';
import PlanApprovalsPage from './pages/PlanApprovalsPage';
import AllocationsPage from './pages/AllocationsPage';
import MyTimesheetPage from './pages/MyTimesheetPage';
import WeekApprovalsPage from './pages/WeekApprovalsPage';
import TimeDashboardPage from './pages/TimeDashboardPage';
import ProjectPnLPage from './pages/ProjectPnLPage';
import NotificationsPage from './pages/NotificationsPage';
import Layout from './components/Layout';

// Sync the URL :teamspaceId param into TeamspaceContext.
// Used by every route under /t/:teamspaceId/*.
function TeamspaceSync({ children }) {
  const { teamspaceId } = useParams();
  const { activeTeamspaceId, setActiveTeamspaceId } = useTeamspace();
  useEffect(() => {
    if (teamspaceId && teamspaceId !== activeTeamspaceId) {
      setActiveTeamspaceId(teamspaceId);
    }
  }, [teamspaceId, activeTeamspaceId, setActiveTeamspaceId]);
  return children;
}

// Default landing: send the user to their last-used teamspace, or to /dashboard.
function RootRedirect() {
  const { activeTeamspaceId, teamspaces } = useTeamspace();
  if (activeTeamspaceId) return <Navigate to={`/t/${activeTeamspaceId}`} replace />;
  if (teamspaces.length > 0) return <Navigate to={`/t/${teamspaces[0]._id}`} replace />;
  return <Navigate to="/dashboard" replace />;
}

function AppContent() {
  const { user } = useAuth();
  const { toasts, addToast, removeToast } = useToast();
  const location = useLocation();

  if (!user) return <AuthPage />;

  // Bare-page routes (no teamspace in URL)
  const bare = (Page) => (
    <Layout onToast={addToast}>
      <Page />
    </Layout>
  );

  // Teamspace-scoped routes
  const ts = (Page) => (
    <TeamspaceSync>
      <Layout onToast={addToast}>
        <Page />
      </Layout>
    </TeamspaceSync>
  );

  return (
    <>
      <Routes>
        <Route path="/"             element={<RootRedirect />} />
        <Route path="/dashboard"    element={bare(DashboardPage)} />
        <Route path="/profile"      element={bare(ProfilePage)} />
        <Route path="/organization"          element={bare(OrgChartPage)} />
        <Route path="/organization/members"  element={bare(OrgMembersPage)} />
        <Route path="/ai"                    element={bare(AiChatPage)} />
        <Route path="/help"                  element={bare(HelpPage)} />
        <Route path="/notifications" element={bare(NotificationsPage)} />

        {/* Teamspace-scoped */}
        <Route path="/t/:teamspaceId"                              element={ts(TasksPage)} />
        <Route path="/t/:teamspaceId/tasks"                        element={ts(TasksPage)} />
        <Route path="/t/:teamspaceId/tasks/:taskId"                element={ts(TasksPage)} />
        <Route path="/t/:teamspaceId/sprints"                      element={ts(SprintsPage)} />
        <Route path="/t/:teamspaceId/projects"                     element={ts(ProjectsPage)} />
        <Route path="/t/:teamspaceId/projects/:projectId"          element={ts(ProjectsPage)} />
        <Route path="/t/:teamspaceId/workflows"                    element={ts(WorkflowsPage)} />
        <Route path="/t/:teamspaceId/team"                         element={ts(TeamPage)} />
        <Route path="/t/:teamspaceId/control"                      element={ts(TeamspaceControlPage)} />

        {/* Timesheet (ERP v1) */}
        <Route path="/t/:teamspaceId/time"                         element={ts(MyTimesheetPage)} />
        {/* legacy URL — redirect to the merged dashboard's Finance tab */}
        <Route path="/t/:teamspaceId/time/dashboard"               element={<Navigate to="/dashboard?tab=finance" replace />} />
        <Route path="/t/:teamspaceId/time/plans"                   element={ts(PlanListPage)} />
        <Route path="/t/:teamspaceId/time/plans/:planId"           element={ts(PlanEditorPage)} />
        <Route path="/t/:teamspaceId/time/plans/:planId/allocations" element={ts(AllocationsPage)} />
        <Route path="/t/:teamspaceId/time/approvals/plans"         element={ts(PlanApprovalsPage)} />
        <Route path="/t/:teamspaceId/time/approvals/weeks"         element={ts(WeekApprovalsPage)} />
        <Route path="/t/:teamspaceId/time/projects/:projectId/pnl" element={ts(ProjectPnLPage)} />
        <Route path="/t/:teamspaceId/time/audit"                   element={ts(AuditLogPage)} />
        <Route path="/t/:teamspaceId/activity"                     element={ts(ActivityPage)} />

        {/* Notion-style pretty task URL: /<project-slug>/<sprint-slug>/<task-slug>-<24hexId>
            Placed last so it doesn't shadow the explicit routes above. */}
        <Route path="/:projectSlug/:sprintSlug/:taskSlugWithId" element={
          <Layout onToast={addToast}><TasksPage /></Layout>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TeamspaceProvider>
          <OrgProvider>
            <AppContent />
          </OrgProvider>
        </TeamspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
