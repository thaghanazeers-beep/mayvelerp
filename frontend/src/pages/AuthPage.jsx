import { useState, useEffect } from 'react';
import { login, signup, forgotPassword, resetPassword } from '../api';
import { useAuth } from '../context/AuthContext';
import './AuthPage.css';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'reset'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [devResetUrl, setDevResetUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const { loginUser } = useAuth();

  // If URL contains ?reset=<token>, jump straight to reset mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (token) {
      setResetToken(token);
      setMode('reset');
    }
  }, []);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setInfo('');
    setDevResetUrl('');
    setPreviewUrl('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setDevResetUrl('');
    setPreviewUrl('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await login(email, password);
        loginUser(res.data);
      } else if (mode === 'signup') {
        // Public signup is disabled at the backend (403). If a future change
        // re-enables it, default new accounts to 'Member' so a stranger can't
        // hand themselves Admin power.
        const res = await signup(name, email, password, 'Member');
        loginUser(res.data);
      } else if (mode === 'forgot') {
        const res = await forgotPassword(email);
        setInfo(res.data.message || 'If an account exists for that email, a reset link has been sent.');
        if (res.data.previewUrl) setPreviewUrl(res.data.previewUrl);
        if (res.data.devResetUrl) setDevResetUrl(res.data.devResetUrl);
      } else if (mode === 'reset') {
        if (password !== confirmPassword) {
          setError("Passwords don't match");
          setLoading(false);
          return;
        }
        const res = await resetPassword(resetToken, password);
        // Strip ?reset= from URL so a refresh doesn't try to reuse the token
        if (window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        loginUser(res.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const headings = {
    login:  { title: 'Sign in to your workspace' },
    signup: { title: 'Create your admin account' },
    forgot: { title: 'Reset your password' },
    reset:  { title: 'Choose a new password' },
  };

  const submitLabel = {
    login:  'Sign In',
    signup: 'Create Account',
    forgot: 'Send Reset Link',
    reset:  'Update Password',
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />
      </div>

      <div className="auth-card animate-in">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2"/>
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>Mayvel Task</h1>
        </div>

        <p className="auth-subtitle">{headings[mode].title}</p>

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        {previewUrl && (
          <div className="auth-info" style={{ wordBreak: 'break-all' }}>
            Dev preview — view the email here:{' '}
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-light)' }}>
              {previewUrl}
            </a>
          </div>
        )}
        {devResetUrl && !previewUrl && (
          <div className="auth-info" style={{ wordBreak: 'break-all' }}>
            Dev mode — open this link to continue:{' '}
            <a href={devResetUrl} style={{ color: 'var(--primary-light)' }}>{devResetUrl}</a>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <div className="form-field">
              <label className="label">Full Name</label>
              <input
                className="input"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
            <div className="form-field">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="admin@mayvel.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
            <div className="form-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label className="label">{mode === 'reset' ? 'New Password' : 'Password'}</label>
                {mode === 'login' && (
                  <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'reset' ? 6 : undefined}
              />
            </div>
          )}

          {mode === 'reset' && (
            <div className="form-field">
              <label className="label">Confirm New Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : submitLabel[mode]}
          </button>
        </form>

        <p className="auth-toggle">
          {(mode === 'forgot' || mode === 'reset') && (
            <>
              Remembered it?
              <button onClick={() => switchMode('login')}>Back to Sign In</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
