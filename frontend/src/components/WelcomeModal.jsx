import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import './WelcomeModal.css';

const STORAGE_KEY_PREFIX = 'mayvel_welcome_dismissed_';

export default function WelcomeModal() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?._id) return;
    const dismissed = localStorage.getItem(STORAGE_KEY_PREFIX + user._id);
    if (!dismissed) setTimeout(() => setOpen(true), 600);    // small delay so nav renders first
  }, [user?._id]);

  const dismiss = () => {
    if (user?._id) localStorage.setItem(STORAGE_KEY_PREFIX + user._id, '1');
    setOpen(false);
  };

  const goAndDismiss = (path) => {
    dismiss();
    navigate(path);
  };

  if (!open) return null;
  const role = String(user?.role || '').toLowerCase();
  const isAdmin = role.includes('admin') || role.includes('owner');

  return (
    <div className="welcome-overlay" onClick={dismiss}>
      <div className="welcome-card animate-in" onClick={e => e.stopPropagation()}>
        <button className="welcome-close" onClick={dismiss} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div className="welcome-hero">
          <div className="welcome-emoji">👋</div>
          <h1>Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</h1>
          <p>Let's get you started with Mayvel Task. Pick what you want to do first:</p>
        </div>

        <div className="welcome-actions">
          <button className="welcome-action" onClick={() => goAndDismiss('/help')}>
            <span className="welcome-action-icon">📘</span>
            <div>
              <strong>Read the user guide</strong>
              <p>How tasks, plans, time tracking, and the AI assistant work — written for end users.</p>
            </div>
          </button>

          <button className="welcome-action" onClick={() => goAndDismiss(`/t/${activeTeamspaceId}/tasks`)}>
            <span className="welcome-action-icon">✓</span>
            <div>
              <strong>See my tasks</strong>
              <p>Find what's assigned to you, drag cards across the board, or switch to the table view.</p>
            </div>
          </button>

          {isAdmin ? (
            <button className="welcome-action" onClick={() => goAndDismiss(`/t/${activeTeamspaceId}/projects`)}>
              <span className="welcome-action-icon">📁</span>
              <div>
                <strong>Set up a project</strong>
                <p>Create or edit a project — set its billing type (T&M / fixed-bid) and contract value.</p>
              </div>
            </button>
          ) : (
            <button className="welcome-action" onClick={() => goAndDismiss(`/t/${activeTeamspaceId}/time`)}>
              <span className="welcome-action-icon">⏱</span>
              <div>
                <strong>Log my hours</strong>
                <p>Open this week's timesheet and fill in hours for each project. Submit Friday EOD.</p>
              </div>
            </button>
          )}

          <button className="welcome-action" onClick={() => goAndDismiss('/ai')}>
            <span className="welcome-action-icon">✨</span>
            <div>
              <strong>Try the AI assistant</strong>
              <p>Ask "show me my tasks this week" or "explain how the loss model works" — it has live data.</p>
            </div>
          </button>
        </div>

        <div className="welcome-footer">
          <button className="welcome-skip" onClick={dismiss}>Skip — I'll figure it out</button>
          <span className="muted welcome-tip">💡 You can always reopen this from <strong>Help &amp; Guide</strong> in the sidebar.</span>
        </div>
      </div>
    </div>
  );
}
